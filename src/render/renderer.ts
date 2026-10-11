import { hash2 } from '../core/rng';
import { Creatures, SPECIES, STATE, type Architecture } from '../sim/creatures';
import { MOVE } from '../sim/pathfinding';
import type { WeatherSystem } from '../sim/weather';
import { SEA_LEVEL, T, TERRAIN, isWater } from '../world/terrain';
import { CHUNK, World } from '../world/world';
import { Camera } from './camera';
import { TerrainPainter, type ChunkPx, type PaintOptions } from './painter';
import { SkyRenderer, type Bolt, type Dust, type VisualEffect } from './skyfx';
import type { MeteorInFlight } from '../sim/sky';
import { COLORS, type Settlement } from '../sim/settlements';
import { KINGDOM_COLORS, type Kingdom } from '../sim/kingdoms';
import { CENTRE_FREE, preparing, type Building, type BuildingType, type JobKind, type Stage } from '../sim/civ';
import { OUTLINE_PAD, Tileset, creatureSprite, type Sprite } from './tileset';
import { CREATURE_SCALE, creatureScale } from './creatureart';
import { BUILDING_SCALE, architectureOf, buildingDot, drawBuildingArt } from './architecture';
import { LANDMARK_BOUNDS, LANDMARK_OVER_DOTS_BELOW, drawLandmark, landmarkBox, landmarkFireSide, landmarkGround, landmarkScaleFor, landmarkTop, shownResidents } from './landmarks';

/** Device pixels per tile at which 16-px-per-tile fine chunks (native close-up art) are used. */
export const FINE_SCALE = 18;
/** Device pixels per tile at which 8-px-per-tile detail chunks are used. */
export const DETAIL_SCALE = 9;
/** Device pixels per tile at which 4-px-per-tile chunks replace the 1-px map. */
export const MID_SCALE = 3;
/** Which cached terrain level a zoom draws over the 1-px base map (0 = the base map only). */
export function terrainLevel(s: number, q: { lowRes: boolean }): ChunkPx | 0 {
  if (s >= FINE_SCALE && !q.lowRes) return 16;
  if (s >= DETAIL_SCALE) return 8;
  return s >= MID_SCALE ? 4 : 0;
}
const MAX_PARTS = 4; // fine chunks painted band by band at once (1 MB buffer each)
const MAX_FINE_CHUNKS = 24; // 1 MB each (512×512): a close view needs about 6–12
const MAX_DETAIL_CHUNKS = 80;
const MAX_MID_CHUNKS = 160;
/** Chunk painting budget per frame (ms); at least one visible chunk is painted per frame. */
const PAINT_BUDGET_MS = 6;
/**
 * Time one frame may spend refreshing the 1-px map (and minimap source) after the
 * world changed. A season change, a big flood or a world load dirties thousands of
 * chunks at once; doing them all in one frame took 55–80 ms on 2048×1280.
 */
const FLUSH_BUDGET_MS = 4;
/** Smallest drawn width (CSS px) of a creature sprite, and of a person. */
/** Smaller repaint steps in performance mode. */
const FLUSH_BUDGET_LOW_MS = 2;
/** Terrain that carries trees (tree features in painter.ts). */
const WOODED: readonly boolean[] = TERRAIN.map((d) => d.id === T.FOREST || d.id === T.JUNGLE || d.id === T.TUNDRA || d.id === T.SAVANNA);
const FROST_TEMPERATURE = 0.45 * 255;
const SHALLOW_RGB = [66, 150, 196] as const;
const MAX_GLINTS = 500;
const DEEP_RGB = [20, 48, 108] as const;

export type { VisualEffect } from './skyfx';

/** Simulation state drawn on top of the map. */

export interface Overlay {
  burning: readonly number[];
  weather: readonly WeatherSystem[];
  effects: readonly VisualEffect[];
  meteors: readonly MeteorInFlight[];
  bolts: readonly Bolt[];
  dust: readonly Dust[];
  drift: { x: number; y: number };
  /** Decorative fair-weather clouds. */
  ambientClouds: boolean;
  /** Settlements and whether to draw their borders (the player's choice). */
  settlements: readonly Settlement[];
  settlementBorders: boolean;
  /** Trails worn by settlement people: [tile, wear] pairs, rebuilt into a cache only when `version` changes. */
  trails?: { version: number; tiles: () => number[] };
  /** Version of the settlements' roads (Settlements.roadVersion): road drawing is cached on it. */
  roadVersion?: number;
  /** Kingdoms above the settlements (territory tint, outer border, name at the capital). */
  kingdoms?: KingdomView;
  /** Kind of work of a settlement worker (drawn as a small tool over people at work). */
  workKind?: (id: number) => JobKind | undefined;
  now: number;
}

export interface KingdomView {
  list: readonly Kingdom[];
  /** Changes whenever kingdoms or territories change (the renderer rebuilds its cache then). */
  version: string;
  kingdomOf(settlementId: number): Kingdom | undefined;
  owner: Uint16Array | null;
}

interface KingdomCache {
  version: string;
  /** Per kingdom: a 1-pixel-per-tile tint of its land and where it sits. */
  tints: Map<number, { canvas: HTMLCanvasElement; x: number; y: number; color: string }>;
  /** Per member settlement: edges on the kingdom's outside, and edges facing another settlement of the same kingdom. */
  edges: Map<number, { outer: Int32Array; inner: Int32Array; color: string }>;
}

/** Circles previewing where the current tool acts (see AreaRing in game/tools.ts). */
export interface RenderQuality {
  particleScale: number;
  reduced: boolean;
  lowRes: boolean;
}

export interface BrushCursor {
  x: number;
  y: number;
  rings: ReadonlyArray<{ radius: number; kind: 'main' | 'outer' }>;
}

interface CachedChunk {
  canvas: HTMLCanvasElement;
  /** The world changed under it: still drawn until repainted (no flash of the coarse map). */
  stale: boolean;
}

/** One level of painted chunks (8 or 4 px per tile) with an LRU cache. */
class ChunkLevel {
  readonly chunks = new Map<number, CachedChunk>();
  private readonly pool: HTMLCanvasElement[] = [];
  private image: ImageData | null = null;

  constructor(
    readonly P: ChunkPx,
    private readonly max: number,
  ) {}

  markStale(c: number): void {
    const e = this.chunks.get(c);
    if (e) e.stale = true;
    const p = this.parts.get(c);
    if (p) p.row = 0; // edited mid-paint: start over so old and new rows never mix
  }

  clear(): void {
    for (const e of this.chunks.values()) this.pool.push(e.canvas);
    this.chunks.clear();
    for (const p of this.parts.values()) this.spare.push(p.image);
    this.parts.clear();
  }

  paint(painter: TerrainPainter, world: World, c: number, opts: PaintOptions, into?: HTMLCanvasElement): HTMLCanvasElement {
    const size = CHUNK * this.P;
    const canvas = into ?? this.pool.pop() ?? document.createElement('canvas');
    if (canvas.width !== size) {
      canvas.width = size;
      canvas.height = size;
    }
    const ctx = canvas.getContext('2d')!;
    if (!this.image) this.image = ctx.createImageData(size, size);
    painter.paintChunk(world, c % world.chunksX, Math.floor(c / world.chunksX), this.P, this.image.data, opts);
    ctx.putImageData(this.image, 0, 0);
    return canvas;
  }

  /** Chunks being painted band by band (fine level): each has its own buffer and the next row to paint. */
  private readonly parts = new Map<number, { row: number; image: ImageData }>();
  private readonly spare: ImageData[] = [];

  /**
   * Paints the next band of rows of chunk c (the fine level spreads one chunk over several frames). Returns the
   * finished canvas, or null while the chunk is not complete yet (or MAX_PARTS other chunks are still in progress).
   */
  paintPart(painter: TerrainPainter, world: World, c: number, opts: PaintOptions, rows: number, into?: HTMLCanvasElement): HTMLCanvasElement | null {
    const size = CHUNK * this.P;
    let p = this.parts.get(c);
    if (!p) {
      if (this.parts.size >= MAX_PARTS) return null;
      p = { row: 0, image: this.spare.pop() ?? new ImageData(size, size) };
      this.parts.set(c, p);
    }
    const end = Math.min(CHUNK, p.row + rows);
    painter.paintChunk(world, c % world.chunksX, Math.floor(c / world.chunksX), this.P, p.image.data, opts, p.row, end);
    p.row = end;
    if (end < CHUNK) return null;
    const canvas = into ?? this.pool.pop() ?? document.createElement('canvas');
    if (canvas.width !== size) {
      canvas.width = size;
      canvas.height = size;
    }
    canvas.getContext('2d')!.putImageData(p.image, 0, 0);
    this.parts.delete(c);
    this.spare.push(p.image);
    return canvas;
  }

  /** Drops band paints of chunks no longer in view (their buffers are reused). */
  dropParts(keep: ReadonlySet<number>): void {
    for (const [c, p] of this.parts) {
      if (keep.has(c)) continue;
      this.parts.delete(c);
      this.spare.push(p.image);
    }
  }

  trim(): void {
    while (this.chunks.size > this.max) {
      const oldest = this.chunks.keys().next().value as number;
      this.pool.push(this.chunks.get(oldest)!.canvas);
      this.chunks.delete(oldest);
    }
  }
}

/**
 * Three-level map renderer:
 *  - far: one pixel per tile in an offscreen canvas (also the minimap's source);
 *  - middle: 32×32-tile chunks painted at 4 px per tile;
 *  - near: the same chunks at 8 px per tile (pixel art).
 * Chunks are painted lazily by TerrainPainter within a per-frame time budget and
 * cached (LRU). When the world changes, affected chunks are marked stale and
 * repainted in place; until then the old image stays on screen.
 */
export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private cssW = 0;
  private cssH = 0;
  /**
   * Drawing quality chosen by the player (settings). It only changes how things are drawn,
   * never the simulation: particle counts, skipped flashes/shadows/glints, resolution.
   */
  quality: RenderQuality = { particleScale: 1, reduced: false, lowRes: false };
  /** Colour of the action-area ring (a cosmetic choice). */
  ringColor = 'rgba(255,255,255,0.95)';
  private world!: World;
  private base!: HTMLCanvasElement;
  private baseCtx!: CanvasRenderingContext2D;
  private baseImage!: ImageData;
  private readonly tileset = new Tileset();
  private readonly painter = new TerrainPainter(this.tileset);
  private readonly fine = new ChunkLevel(16, MAX_FINE_CHUNKS);
  private readonly detail = new ChunkLevel(8, MAX_DETAIL_CHUNKS);
  private readonly mid = new ChunkLevel(4, MAX_MID_CHUNKS);
  /** Per species, two walking frames, each facing right and left. */
  private readonly sprites: Array<Array<{ right: HTMLCanvasElement; left: HTMLCanvasElement }>>;
  private readonly flames: HTMLCanvasElement[];
  private readonly skyfx = new SkyRenderer();
  winter = false;
  /** Hatch mountains and snow (impassable for lowland animals). */
  passOverlay = false;
  /** Chunks painted in the last frame and in total (performance reporting). */
  readonly paintStats = { lastFrame: 0, total: 0, totalMs: 0 };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.sprites = SPECIES.map((s) =>
      [0, 1].map((frame) => {
        const right = creatureSprite(s.id, frame);
        const left = document.createElement('canvas');
        left.width = right.width;
        left.height = right.height;
        const lctx = left.getContext('2d')!;
        lctx.translate(right.width, 0);
        lctx.scale(-1, 1);
        lctx.drawImage(right, 0, 0);
        return { right, left };
      }),
    );
    this.flames = flameFrames();
  }

  get tiles(): Tileset {
    return this.tileset;
  }

  /** The 1-pixel-per-tile map (the minimap draws it scaled down). */
  get baseCanvas(): HTMLCanvasElement {
    return this.base;
  }

  setWorld(world: World): void {
    this.world = world;
    this.base = document.createElement('canvas');
    this.base.width = world.width;
    this.base.height = world.height;
    this.baseCtx = this.base.getContext('2d')!;
    this.baseImage = this.baseCtx.createImageData(world.width, world.height);
    this.fine.clear();
    this.detail.clear();
    this.mid.clear();
    world.markAllDirty();
    this.flushDirty(null, 0, Infinity); // a new world is shown complete at once
  }

  setWinter(winter: boolean): void {
    if (winter === this.winter) return;
    this.winter = winter;
    this.world.markAllDirty();
  }

  setPassOverlay(on: boolean): void {
    if (on === this.passOverlay) return;
    this.passOverlay = on;
    this.world.markAllDirty();
  }

  setQuality(q: RenderQuality): void {
    const res = q.lowRes !== this.quality.lowRes;
    this.quality = { ...q };
    if (res && this.cssW) this.resize(this.cssW, this.cssH);
  }

  /** Resizes the backing store to the element's CSS size × devicePixelRatio (capped at 2). */
  resize(cssW: number, cssH: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = Math.min(this.quality.lowRes ? 1 : 2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
  }

  /**
   * Rebuilds the 1px map for dirty chunks and marks painted chunks stale. Chunks in
   * view go first, and work stops after `budgetMs`; the rest stays dirty and is done
   * on the next frames. Returns how many chunks remain dirty.
   */
  private flushDirty(camera: Camera | null, s: number, budgetMs: number): number {
    const w = this.world;
    if (w.dirtyChunks.size === 0) return 0;
    const start = performance.now();
    const order: number[] = [];
    if (camera && w.dirtyChunks.size > 1) {
      const cx0 = Math.floor(camera.x / CHUNK) - 1;
      const cy0 = Math.floor(camera.y / CHUNK) - 1;
      const cx1 = Math.floor((camera.x + this.canvas.width / s) / CHUNK) + 1;
      const cy1 = Math.floor((camera.y + this.canvas.height / s) / CHUNK) + 1;
      const rest: number[] = [];
      for (const c of w.dirtyChunks) {
        const cx = c % w.chunksX;
        const cy = (c - cx) / w.chunksX;
        (cx >= cx0 && cx <= cx1 && cy >= cy0 && cy <= cy1 ? order : rest).push(c);
      }
      for (const c of rest) order.push(c);
    } else {
      for (const c of w.dirtyChunks) order.push(c);
    }
    const data = this.baseImage.data;
    const W = w.width;
    const H = w.height;
    const hs = w.heights;
    for (const c of order) {
      if (performance.now() - start > budgetMs) break;
      w.dirtyChunks.delete(c);
      const cx = c % w.chunksX;
      const cy = Math.floor(c / w.chunksX);
      const x0 = cx * CHUNK;
      const y0 = cy * CHUNK;
      const x1 = Math.min(W, x0 + CHUNK);
      const y1 = Math.min(H, y0 + CHUNK);
      for (let y = y0; y < y1; y++) {
        const yu = y > 0 ? y - 1 : y;
        const yd = y < H - 1 ? y + 1 : y;
        for (let x = x0; x < x1; x++) {
          const i = y * W + x;
          const id = w.terrain[i];
          const col = TERRAIN[id].color;
          const grain = 0.96 + hash2(x, y, w.seed) * 0.08;
          let r: number;
          let g: number;
          let b: number;
          if (id === T.DEEP_WATER || id === T.SHALLOW_WATER) {
            const t = Math.sqrt(Math.max(0, Math.min(1, (SEA_LEVEL - hs[i]) / 90)));
            r = (SHALLOW_RGB[0] + (DEEP_RGB[0] - SHALLOW_RGB[0]) * t) * grain;
            g = (SHALLOW_RGB[1] + (DEEP_RGB[1] - SHALLOW_RGB[1]) * t) * grain;
            b = (SHALLOW_RGB[2] + (DEEP_RGB[2] - SHALLOW_RGB[2]) * t) * grain;
          } else {
            // Hill shading from the slope toward the north-west light (central differences).
            const xl = x > 0 ? x - 1 : x;
            const xr = x < W - 1 ? x + 1 : x;
            const slope = hs[y * W + xr] - hs[y * W + xl] + hs[yd * W + x] - hs[yu * W + x];
            const f = grain * (1 + Math.max(-0.3, Math.min(0.3, slope * 0.018)));
            r = col[0] * f;
            g = col[1] * f;
            b = col[2] * f;
            if (this.winter && !isWater(id) && id !== T.SNOW && w.temperature[i] < FROST_TEMPERATURE) {
              r = r * 0.45 + 130;
              g = g * 0.45 + 134;
              b = b * 0.45 + 140;
            }
          }
          const o = i * 4;
          data[o] = r;
          data[o + 1] = g;
          data[o + 2] = b;
          data[o + 3] = 255;
        }
      }
      this.baseCtx.putImageData(this.baseImage, 0, 0, x0, y0, x1 - x0, y1 - y0);
      this.fine.markStale(c);
      this.detail.markStale(c);
      this.mid.markStale(c);
    }
    return w.dirtyChunks.size;
  }

  /** Draws the visible chunks of one level, painting missing or stale ones within the frame budget. */
  private drawLevel(level: ChunkLevel, camera: Camera, s: number, ox: number, oy: number, budgetEnd: number, fallback?: ChunkLevel): void {
    const w = this.world;
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const opts: PaintOptions = { winter: this.winter, passOverlay: this.passOverlay };
    const cx0 = Math.max(0, Math.floor(camera.x / CHUNK));
    const cy0 = Math.max(0, Math.floor(camera.y / CHUNK));
    const cx1 = Math.min(w.chunksX - 1, Math.floor((camera.x + cw / s) / CHUNK));
    const cy1 = Math.min(w.chunksY - 1, Math.floor((camera.y + ch / s) / CHUNK));
    // Centre-out order, so the middle of the screen sharpens first.
    const mx = (cx0 + cx1) / 2;
    const my = (cy0 + cy1) / 2;
    const list: number[] = [];
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) list.push(cy * w.chunksX + cx);
    list.sort((a, b) => {
      const ax = (a % w.chunksX) - mx;
      const ay = Math.floor(a / w.chunksX) - my;
      const bx = (b % w.chunksX) - mx;
      const by = Math.floor(b / w.chunksX) - my;
      return ax * ax + ay * ay - (bx * bx + by * by);
    });
    if (level.P === 16) level.dropParts(new Set(list));
    for (const c of list) {
      let e = level.chunks.get(c);
      const canPaint = this.paintStats.lastFrame === 0 || performance.now() < budgetEnd;
      const banded = level.P === 16; // the fine level paints a quarter of a chunk per turn (about 6 ms)
      if (e) {
        level.chunks.delete(c); // refresh LRU position
        if (e.stale && canPaint) {
          const t0 = performance.now();
          if (!banded) {
            level.paint(this.painter, w, c, opts, e.canvas);
            e.stale = false;
          } else if (level.paintPart(this.painter, w, c, opts, CHUNK / 4, e.canvas)) e.stale = false; // the old picture stays until done
          this.countPaint(performance.now() - t0);
        }
      } else if (banded && canPaint) {
        const t0 = performance.now();
        const done = level.paintPart(this.painter, w, c, opts, CHUNK / 4);
        this.countPaint(performance.now() - t0);
        if (done) e = { canvas: done, stale: false };
        else {
          const f = fallback?.chunks.get(c);
          if (f) {
            const cx = c % w.chunksX;
            const cy = Math.floor(c / w.chunksX);
            const sx = Math.round(ox + cx * CHUNK * s);
            const sy = Math.round(oy + cy * CHUNK * s);
            ctx.drawImage(f.canvas, sx, sy, Math.round(ox + (cx + 1) * CHUNK * s) - sx, Math.round(oy + (cy + 1) * CHUNK * s) - sy);
          }
          continue;
        }
      } else {
        if (!canPaint) {
          // Not painted yet: show the coarser level's chunk meanwhile (if it has one), else the 1-px map stays.
          const f = fallback?.chunks.get(c);
          if (f) {
            const cx = c % w.chunksX;
            const cy = Math.floor(c / w.chunksX);
            const sx = Math.round(ox + cx * CHUNK * s);
            const sy = Math.round(oy + cy * CHUNK * s);
            ctx.drawImage(f.canvas, sx, sy, Math.round(ox + (cx + 1) * CHUNK * s) - sx, Math.round(oy + (cy + 1) * CHUNK * s) - sy);
          }
          continue;
        }
        const t0 = performance.now();
        e = { canvas: level.paint(this.painter, w, c, opts), stale: false };
        this.countPaint(performance.now() - t0);
      }
      level.chunks.set(c, e);
      const cx = c % w.chunksX;
      const cy = Math.floor(c / w.chunksX);
      const sx = Math.round(ox + cx * CHUNK * s);
      const sy = Math.round(oy + cy * CHUNK * s);
      const ex = Math.round(ox + (cx + 1) * CHUNK * s);
      const ey = Math.round(oy + (cy + 1) * CHUNK * s);
      ctx.drawImage(e.canvas, sx, sy, ex - sx, ey - sy);
    }
    level.trim();
  }

  private countPaint(ms: number): void {
    this.paintStats.lastFrame++;
    this.paintStats.total++;
    this.paintStats.totalMs += ms;
  }

  /**
   * @param alpha  interpolation (0..1) between each creature's previous and current tick position
   * @param selectedId  creature id to highlight (0 = none)
   */
  render(
    camera: Camera, creatures: Creatures, cursor: BrushCursor | null, alpha = 1, selectedId = 0, overlay?: Overlay,
  ): void {
    const ctx = this.ctx;
    const w = this.world;
    this.frameNow = overlay?.now ?? 0;
    const s = camera.zoom * this.dpr; // device px per tile
    this.flushDirty(camera, s, this.quality.lowRes ? FLUSH_BUDGET_LOW_MS : FLUSH_BUDGET_MS);
    const ox = -camera.x * s;
    const oy = -camera.y * s;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#10264a';
    ctx.fillRect(0, 0, cw, ch);
    // Zoomed far out the 1px map is shrunk: smoothing avoids shimmering speckle.
    ctx.imageSmoothingEnabled = s < 1;
    ctx.drawImage(this.base, Math.round(ox), Math.round(oy), Math.round(w.width * s), Math.round(w.height * s));
    ctx.imageSmoothingEnabled = false;

    this.paintStats.lastFrame = 0;
    const budgetEnd = performance.now() + PAINT_BUDGET_MS;
    // Close zoom uses the native 16-px art (not in low-resolution mode, which keeps memory and painting cheaper).
    const lvl = terrainLevel(s, this.quality);
    if (lvl === 16) this.drawLevel(this.fine, camera, s, ox, oy, budgetEnd, this.detail);
    else if (lvl === 8) this.drawLevel(this.detail, camera, s, ox, oy, budgetEnd);
    else if (lvl === 4) this.drawLevel(this.mid, camera, s, ox, oy, budgetEnd);
    if (s >= MID_SCALE && overlay && !this.quality.reduced) this.drawGlints(camera, s, ox, oy, overlay.now);

    // Fire on a landmark's centre is sorted out first: in front of its walls it is drawn after the landmark, behind
    // them it shows as glow and smoke over the building (never as flames through walls), elsewhere as usual.
    this.landmarkFire = overlay?.settlementBorders ? this.sortLandmarkFire(overlay, camera.zoom) : null;
    const lf = this.landmarkFire;
    if (overlay) this.drawFire(overlay, s, ox, oy, lf ? (i) => !lf.late.has(i) && !lf.hidden.has(i) : undefined);
    // Settlements (borders, buildings, centre marker) are drawn first so that people are never hidden behind them.
    if (overlay?.trails) this.drawTrails(overlay.trails, camera, s, ox, oy);
    if (overlay?.settlementBorders && overlay.settlements.length) this.drawRoads(overlay.settlements, overlay.roadVersion ?? 0, camera, s, ox, oy);
    if (overlay?.settlementBorders && overlay.settlements.length) {
      const kc = overlay.kingdoms?.list.length ? this.kingdomCache(overlay.settlements, overlay.kingdoms) : null;
      if (kc && !this.quality.reduced) this.drawKingdomTints(kc, s, ox, oy);
      this.drawSettlements(overlay.settlements, camera, s, ox, oy, kc);
    }
    this.drawCreatures(camera, creatures, s, ox, oy, alpha, overlay);
    // Far away creatures are dots and landmarks icons over them, so each settlement's main building stays
    // recognisable; the settlement's buildings under the icon and a few of its residents are drawn again on top.
    if (overlay?.settlementBorders && camera.zoom < LANDMARK_OVER_DOTS_BELOW) {
      const vx0 = camera.x - 1;
      const vy0 = camera.y - 1;
      const vx1 = camera.x + this.canvas.width / s + 1;
      const vy1 = camera.y + this.canvas.height / s + 1;
      for (const st of overlay.settlements) {
        if (!st.civ) continue;
        const box = landmarkBox(st, camera.zoom);
        if (box.x1 < vx0 || box.y1 < vy0 || box.x0 > vx1 || box.y0 > vy1) continue;
        const arch = architectureOf(st.species);
        this.drawLandmark(st, arch, st.civ.stage, ox + (st.x + 0.5) * s, oy + (st.y + 0.5) * s, s);
        for (const b of st.civ.buildings) {
          if (b.x + 1 > box.x0 && b.x < box.x1 && b.y + 1 > box.y0 && b.y < box.y1) this.drawBuilding(b, st.color, arch, s, ox, oy, vx0, vy0, vx1, vy1);
        }
        this.drawLandmarkFire(st, s, ox, oy);
        for (const i of shownResidents(st, creatures, camera.zoom)) {
          const x = creatures.px[i] + (creatures.x[i] - creatures.px[i]) * alpha;
          const y = creatures.py[i] + (creatures.y[i] - creatures.py[i]) * alpha;
          this.drawDot(creatures.species[i], Math.round(ox + x * s), Math.round(oy + y * s));
        }
      }
    }
    if (overlay?.settlementBorders && overlay.settlements.length && s >= 3 * this.dpr) this.drawSettlementLabels(overlay.settlements, s, ox, oy, overlay.kingdoms);
    if (overlay) {
      this.skyfx.draw(ctx, camera, s, ox, oy, this.dpr, {
        systems: overlay.weather,
        meteors: overlay.meteors,
        bolts: overlay.bolts,
        dust: overlay.dust,
        effects: overlay.effects,
        burning: overlay.burning,
        drift: overlay.drift,
        ambientClouds: overlay.ambientClouds,
        particleScale: this.quality.particleScale,
        reduced: this.quality.reduced,
        worldW: w.width,
        worldH: w.height,
        now: overlay.now,
      });
    }
    if (selectedId) this.drawSelection(creatures, selectedId, s, ox, oy, alpha);

    if (cursor) this.drawCursor(cursor, s, ox, oy);
  }

  /**
   * Moving glints on open water (decoration only): a sparse grid of slots, each
   * flashing briefly at its own phase. Cost is bounded by MAX_GLINTS per frame.
   */
  private drawGlints(camera: Camera, s: number, ox: number, oy: number, now: number): void {
    const w = this.world;
    const ctx = this.ctx;
    const spacing = s >= DETAIL_SCALE ? 2 : 4;
    const gx0 = Math.max(0, Math.floor(camera.x / spacing));
    const gy0 = Math.max(0, Math.floor(camera.y / spacing));
    const gx1 = Math.min(Math.ceil(w.width / spacing) - 1, Math.floor((camera.x + this.canvas.width / s) / spacing));
    const gy1 = Math.min(Math.ceil(w.height / spacing) - 1, Math.floor((camera.y + this.canvas.height / s) / spacing));
    const t = now / 1000;
    const len = Math.max(2, Math.round(s * 0.35));
    const thick = Math.max(1, Math.round(s / 10));
    let drawn = 0;
    ctx.fillStyle = 'rgba(235,248,255,0.75)';
    for (let gy = gy0; gy <= gy1 && drawn < MAX_GLINTS; gy++) {
      for (let gx = gx0; gx <= gx1 && drawn < MAX_GLINTS; gx++) {
        let h = Math.imul(gx * 374761393 + gy * 668265263, 1274126177) >>> 0;
        const phase = (t * 0.45 + (h & 1023) / 1024) % 1;
        if (phase > 0.1) continue;
        h = Math.imul(h ^ (h >>> 13), 1103515245) >>> 0;
        const x = gx * spacing + (h & 3) * 0.5;
        const y = gy * spacing + ((h >>> 2) & 3) * 0.5;
        const id = w.terrain[Math.min(w.height - 1, y | 0) * w.width + Math.min(w.width - 1, x | 0)];
        if (id !== T.DEEP_WATER && id !== T.SHALLOW_WATER && id !== T.LAKE) continue;
        const drift = phase * s * 0.8;
        ctx.fillRect(Math.round(ox + x * s + drift), Math.round(oy + y * s), len, thick);
        drawn++;
      }
    }
  }

  /** The action-area preview: a solid ring (with a faint fill) where the tool acts, dashed rings for wider zones. */
  private drawCursor(cursor: BrushCursor, s: number, ox: number, oy: number): void {
    const ctx = this.ctx;
    const cx = ox + cursor.x * s;
    const cy = oy + cursor.y * s;
    for (const ring of cursor.rings) {
      const r = Math.max(3 * this.dpr, ring.radius * s);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      if (ring.kind === 'main') {
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.fill();
        // A dark under-stroke keeps the white ring visible over snow and sand.
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.lineWidth = Math.max(3, 3 * this.dpr);
        ctx.stroke();
        ctx.strokeStyle = this.ringColor;
        ctx.lineWidth = Math.max(1.5, 1.6 * this.dpr);
        ctx.setLineDash([]);
        ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(255,170,70,0.9)';
        ctx.lineWidth = Math.max(1.5, 1.5 * this.dpr);
        ctx.setLineDash([7 * this.dpr, 6 * this.dpr]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  /** Burning tiles: animated pixel flames up close, flickering embers from afar. */
  /**
   * Settlement borders: the precomputed edge segments of each territory (only those in view),
   * in the settlement's colour with a dark outline, a marker at the centre and, close up, the name.
   * Nothing is recomputed here; the lists change only when a territory changes.
   */
  private trailCache: { version: number; blocks: Map<number, HTMLCanvasElement> } | null = null;

  /**
   * Trails: per 64×64-tile block one small canvas (4 px per tile) with a narrow dirt path through each worn tile,
   * joined to worn neighbours, so the trails people walk read as a connected network. Rebuilt only on a new version.
   */
  private drawTrails(tr: NonNullable<Overlay['trails']>, camera: Camera, s: number, ox: number, oy: number): void {
    const W = this.world.width;
    const B = 64;
    const P = 4;
    if (!this.trailCache || this.trailCache.version !== tr.version) {
      const pairs = tr.tiles();
      const wear = new Map<number, number>();
      for (let k = 0; k < pairs.length; k += 2) wear.set(pairs[k], pairs[k + 1]);
      const blocks = new Map<number, HTMLCanvasElement>();
      const bw = Math.ceil(W / B);
      for (const [t, v] of wear) {
        const x = t % W;
        const y = (t - x) / W;
        const key = Math.floor(y / B) * bw + Math.floor(x / B);
        let c = blocks.get(key);
        if (!c) {
          c = document.createElement('canvas');
          c.width = c.height = B * P;
          blocks.set(key, c);
        }
        const ctx = c.getContext('2d')!;
        const lx = (x % B) * P;
        const ly = (y % B) * P;
        // A soft patch of trodden earth: the side facing unworn land stops one pixel short, so trails have
        // rounded, organic edges and join seamlessly where neighbours are worn too.
        ctx.fillStyle = v >= 160 ? 'rgba(184,152,104,0.75)' : 'rgba(150,118,74,0.5)';
        const l = x > 0 && wear.has(t - 1) ? 0 : 1;
        const r = x + 1 < W && wear.has(t + 1) ? 0 : 1;
        const u = wear.has(t - W) ? 0 : 1;
        const d = wear.has(t + W) ? 0 : 1;
        ctx.fillRect(lx + l, ly + u, P - l - r, P - u - d);
      }
      this.trailCache = { version: tr.version, blocks };
    }
    if (!this.trailCache.blocks.size) return;
    const ctx = this.ctx;
    const smooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    const bw = Math.ceil(W / B);
    const vx0 = camera.x - B;
    const vy0 = camera.y - B;
    const vx1 = camera.x + this.canvas.width / s;
    const vy1 = camera.y + this.canvas.height / s;
    for (const [key, c] of this.trailCache.blocks) {
      const bx = (key % bw) * B;
      const by = Math.floor(key / bw) * B;
      if (bx < vx0 || by < vy0 || bx > vx1 || by > vy1) continue;
      ctx.drawImage(c, ox + bx * s, oy + by * s, B * s, B * s);
    }
    ctx.imageSmoothingEnabled = smooth;
  }

  private roadCache: { version: number; blocks: Map<number, HTMLCanvasElement> } | null = null;

  /**
   * Roads (0.23, sim/roads.ts): per 32×32-tile block one canvas at 8 px per tile, rebuilt only when roads change.
   * Each road tile is a strip of ground joined to its road neighbours, the plaza and building doors: a narrow
   * trodden path in a camp, a wider dirt road with darker verges in a village, a cobbled road in a town.
   */
  private drawRoads(list: readonly Settlement[], version: number, camera: Camera, s: number, ox: number, oy: number): void {
    const W = this.world.width;
    const B = 32;
    const P = 8;
    if (!this.roadCache || this.roadCache.version !== version) {
      const blocks = new Map<number, HTMLCanvasElement>();
      const bw = Math.ceil(W / B);
      for (const st of list) {
        const c = st.civ;
        if (!c || !c.roads.length) continue;
        const roads = new Set(c.roads);
        const doors = new Set(c.buildings.map((b) => (b.y + 1) * W + b.x));
        const link = (x: number, y: number) => {
          const n = y * W + x;
          return roads.has(n) || doors.has(n) || Math.max(Math.abs(x - st.x), Math.abs(y - st.y)) <= CENTRE_FREE;
        };
        // Humans: trodden earth, then dirt roads with pebbles, then cobbles. Elves: soft paths, then pale stone with moss.
        const elven = architectureOf(st.species) === 'elven';
        const style = elven
          ? c.stage === 'town' ? { w: 4, fill: '#c2b892', edge: '#8f9a66', dot: '#7fa060' } : c.stage === 'village' ? { w: 4, fill: '#a99a6c', edge: '#7d8a55', dot: '#8fae6a' } : { w: 3, fill: '#9a8c62', edge: '#738050', dot: '' }
          : c.stage === 'town' ? { w: 4, fill: '#ab9f88', edge: '#857a66', dot: '#c7bca6' } : c.stage === 'village' ? { w: 4, fill: '#a98a5e', edge: '#86693f', dot: '#bfa274' } : { w: 3, fill: '#9c8058', edge: '#7f6644', dot: '' };
        // The plaza around the main building: the hub every road starts from (trodden earth, or paved in a town).
        const plaza: number[] = [];
        if (!preparing(c, st, W)) {
          for (let dy = -CENTRE_FREE; dy <= CENTRE_FREE; dy++) {
            for (let dx = -CENTRE_FREE; dx <= CENTRE_FREE; dx++) {
              const px = st.x + dx;
              const py = st.y + dy;
              if (px >= 0 && py >= 0 && px < W && py < this.world.height && !isWater(this.world.terrain[py * W + px])) plaza.push(py * W + px);
            }
          }
        }
        const block = (t: number) => {
          const x = t % W;
          const y = (t - x) / W;
          const key = Math.floor(y / B) * bw + Math.floor(x / B);
          let cv = blocks.get(key);
          if (!cv) {
            cv = document.createElement('canvas');
            cv.width = cv.height = B * P;
            blocks.set(key, cv);
          }
          return { ctx: cv.getContext('2d')!, x, y, lx: (x % B) * P, ly: (y % B) * P };
        };
        for (const t of plaza) {
          const { ctx, x, y, lx, ly } = block(t);
          // Inset from the plaza's outer border (1 px verge, 2 px to the fill), none between plaza tiles.
          const out = (nx: number, ny: number) => Math.max(Math.abs(nx - st.x), Math.abs(ny - st.y)) > CENTRE_FREE;
          const [l, r, u, d] = [out(x - 1, y), out(x + 1, y), out(x, y - 1), out(x, y + 1)];
          const rect = (k: number) => ctx.fillRect(lx + (l ? k : 0), ly + (u ? k : 0), P - (l ? k : 0) - (r ? k : 0), P - (u ? k : 0) - (d ? k : 0));
          ctx.fillStyle = style.edge;
          rect(1);
          ctx.fillStyle = style.fill;
          rect(2);
          if (style.dot) {
            ctx.fillStyle = style.dot;
            for (let k = 0; k < 2; k++) {
              const h = hash2(x * 5 + k, y * 11 + k, 0x2f6b8a1d);
              ctx.fillRect(lx + 1 + Math.floor(h * (P - 2)), ly + 1 + Math.floor(((h * 991) % 1) * (P - 2)), 1, 1);
            }
          }
        }
        for (const t of c.roads) {
          const { ctx, x, y, lx, ly } = block(t);
          const a = (P - style.w) >> 1;
          const parts: Array<[number, number, number, number]> = [[a, a, style.w, style.w]];
          if (link(x, y - 1)) parts.push([a, 0, style.w, a]);
          if (link(x, y + 1)) parts.push([a, a + style.w, style.w, P - a - style.w]);
          if (link(x - 1, y)) parts.push([0, a, a, style.w]);
          if (link(x + 1, y)) parts.push([a + style.w, a, P - a - style.w, style.w]);
          ctx.fillStyle = style.edge; // verges: the strip one pixel wider, darker
          for (const [px, py, pw, ph] of parts) ctx.fillRect(lx + px - 1, ly + py - 1, pw + 2, ph + 2);
          ctx.fillStyle = style.fill;
          for (const [px, py, pw, ph] of parts) ctx.fillRect(lx + px, ly + py, pw, ph);
          if (style.dot) {
            // Pebbles (village) or cobbles (town), placed by a fixed hash of the tile.
            ctx.fillStyle = style.dot;
            for (let k = 0; k < 3; k++) {
              const h = hash2(x * 3 + k, y * 7 + k, 0x5bd1e995);
              ctx.fillRect(lx + a + Math.floor(h * style.w), ly + a + Math.floor(((h * 997) % 1) * style.w), 1, 1);
            }
          }
        }
      }
      this.roadCache = { version, blocks };
    }
    if (!this.roadCache.blocks.size) return;
    const ctx = this.ctx;
    const smooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = s < P;
    const bw = Math.ceil(W / B);
    const vx0 = camera.x - B;
    const vy0 = camera.y - B;
    const vx1 = camera.x + this.canvas.width / s;
    const vy1 = camera.y + this.canvas.height / s;
    for (const [key, c] of this.roadCache.blocks) {
      const bx = (key % bw) * B;
      const by = Math.floor(key / bw) * B;
      if (bx < vx0 || by < vy0 || bx > vx1 || by > vy1) continue;
      ctx.drawImage(c, Math.round(ox + bx * s), Math.round(oy + by * s), Math.round(B * s), Math.round(B * s));
    }
    ctx.imageSmoothingEnabled = smooth;
  }

  private kc: KingdomCache | null = null;

  /** Rebuilt only when kingdoms or territories change (never per frame). */
  private kingdomCache(list: readonly Settlement[], kv: KingdomView): KingdomCache {
    if (this.kc && this.kc.version === kv.version) return this.kc;
    const W = this.world.width;
    const H = this.world.height;
    const owner = kv.owner;
    const tints: KingdomCache['tints'] = new Map();
    const edges: KingdomCache['edges'] = new Map();
    for (const k of kv.list) {
      const color = KINGDOM_COLORS[k.color] ?? KINGDOM_COLORS[0];
      const members = list.filter((st) => k.members.includes(st.id));
      let x0 = W;
      let y0 = H;
      let x1 = -1;
      let y1 = -1;
      for (const st of members) {
        for (const i of st.tiles) {
          const x = i % W;
          const y = (i - x) / W;
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
        // Split the border: sides facing land of the same kingdom are inner, everything else is the kingdom's edge.
        const outer: number[] = [];
        const inner: number[] = [];
        for (const e of st.edges) {
          const i = e >> 2;
          const x = i % W;
          const y = (i - x) / W;
          const side = e & 3;
          const nx = side === 1 ? x + 1 : side === 3 ? x - 1 : x;
          const ny = side === 0 ? y - 1 : side === 2 ? y + 1 : y;
          const n = nx >= 0 && ny >= 0 && nx < W && ny < H && owner ? owner[ny * W + nx] : 0;
          (n && n !== st.id && kv.kingdomOf(n) === k ? inner : outer).push(e);
        }
        edges.set(st.id, { outer: Int32Array.from(outer), inner: Int32Array.from(inner), color });
      }
      if (x1 < 0) continue;
      const c = document.createElement('canvas');
      c.width = x1 - x0 + 1;
      c.height = y1 - y0 + 1;
      const cx = c.getContext('2d')!;
      const img = cx.createImageData(c.width, c.height);
      const n = parseInt(color.slice(1), 16);
      for (const st of members) {
        for (const i of st.tiles) {
          const x = i % W;
          const y = (i - x) / W;
          const o = ((y - y0) * c.width + (x - x0)) * 4;
          img.data[o] = (n >> 16) & 255;
          img.data[o + 1] = (n >> 8) & 255;
          img.data[o + 2] = n & 255;
          img.data[o + 3] = 40; // a light tint: terrain, buildings and people stay readable
        }
      }
      cx.putImageData(img, 0, 0);
      tints.set(k.id, { canvas: c, x: x0, y: y0, color });
    }
    this.kc = { version: kv.version, tints, edges };
    return this.kc;
  }

  private drawKingdomTints(kc: KingdomCache, s: number, ox: number, oy: number): void {
    const ctx = this.ctx;
    const smooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    for (const t of kc.tints.values()) ctx.drawImage(t.canvas, ox + t.x * s, oy + t.y * s, t.canvas.width * s, t.canvas.height * s);
    ctx.imageSmoothingEnabled = smooth;
  }

  private drawSettlements(list: readonly Settlement[], camera: Camera, s: number, ox: number, oy: number, kc: KingdomCache | null = null): void {
    const ctx = this.ctx;
    const W = this.world.width;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const x0 = camera.x - 1;
    const y0 = camera.y - 1;
    const x1 = camera.x + cw / s + 1;
    const y1 = camera.y + ch / s + 1;
    ctx.save();
    ctx.lineCap = 'butt';
    const path = (es: Int32Array) => {
      ctx.beginPath();
      for (const e of es) {
        const i = e >> 2;
        const x = i % W;
        const y = (i - x) / W;
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        const px = ox + x * s;
        const py = oy + y * s;
        switch (e & 3) {
          case 0: ctx.moveTo(px, py); ctx.lineTo(px + s, py); break;
          case 1: ctx.moveTo(px + s, py); ctx.lineTo(px + s, py + s); break;
          case 2: ctx.moveTo(px, py + s); ctx.lineTo(px + s, py + s); break;
          default: ctx.moveTo(px, py); ctx.lineTo(px, py + s);
        }
      }
    };
    for (const st of list) {
      if (!st.edges.length) continue;
      const ke = kc?.edges.get(st.id);
      if (ke) {
        // In a kingdom: the kingdom's outer border, a little bolder, in its colour; faint lines between its settlements.
        path(ke.outer);
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = Math.max(3.5, 3.6 * this.dpr);
        ctx.stroke();
        ctx.strokeStyle = ke.color;
        ctx.lineWidth = Math.max(2, 2.1 * this.dpr);
        ctx.stroke();
        if (ke.inner.length) {
          path(ke.inner);
          ctx.globalAlpha = 0.45;
          ctx.lineWidth = Math.max(1, this.dpr);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      } else {
        path(st.edges);
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = Math.max(3, 3 * this.dpr);
        ctx.stroke();
        ctx.strokeStyle = COLORS[st.color];
        ctx.lineWidth = Math.max(1.5, 1.6 * this.dpr);
        ctx.stroke();
      }
      const cx = ox + (st.x + 0.5) * s;
      const cy = oy + (st.y + 0.5) * s;
      // Buildings of a people's settlement (finished ones solid, under construction faded) and, at the centre, its
      // landmark: buildings behind it (rows up to the landmark's ground row) first, those in front after it.
      if (st.civ) {
        const arch = architectureOf(st.species);
        // Back to front (larger buildings overlap the row behind them), the landmark at its ground row.
        const sorted = st.civ.buildings.slice().sort((a, b) => a.y - b.y || a.x - b.x);
        const ground = Math.floor(landmarkGround(st, camera.zoom));
        let k = 0;
        for (; k < sorted.length && sorted[k].y <= ground; k++) this.drawBuilding(sorted[k], st.color, arch, s, ox, oy, x0, y0, x1, y1);
        if (camera.zoom >= LANDMARK_OVER_DOTS_BELOW) {
          this.drawLandmark(st, arch, st.civ.stage, cx, cy, s);
          this.drawLandmarkFire(st, s, ox, oy);
        }
        for (; k < sorted.length; k++) this.drawBuilding(sorted[k], st.color, arch, s, ox, oy, x0, y0, x1, y1);
        continue;
      }
      // Centre marker of a settlement without buildings.
      if (cx < -40 || cy < -40 || cx > cw + 40 || cy > ch + 40) continue;
      const r = Math.max(4 * this.dpr, s * 0.7);
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      ctx.fillStyle = COLORS[st.color];
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = Math.max(1, this.dpr);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Names and populations above the settlement centres, drawn over the people (small text, offset upward). */
  private drawSettlementLabels(list: readonly Settlement[], s: number, ox: number, oy: number, kv?: KingdomView): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `${Math.round(11 * this.dpr)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 3 * this.dpr;
    for (const st of list) {
      const cx = ox + (st.x + 0.5) * s;
      const lift = st.civ ? ((4 - landmarkTop(architectureOf(st.species), st.civ.stage)) * s * landmarkScaleFor(st, s / this.dpr)) / 8 + 5 * this.dpr : 0;
      const cy = oy + (st.y + 0.5) * s - Math.max(10 * this.dpr, s * 1.6, lift);
      if (cx < -80 || cy < -40 || cx > this.canvas.width + 80 || cy > this.canvas.height + 40) continue;
      const label = `${st.name} · ${st.members.length}`;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(label, cx, cy);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, cx, cy);
      // The capital also names its kingdom, in the kingdom's colour, just above.
      const k = kv?.kingdomOf(st.id);
      if (k && k.capital === st.id) {
        const name = `♛ ${k.name}`;
        const ky = cy - Math.round(13 * this.dpr);
        ctx.strokeText(name, cx, ky);
        ctx.fillStyle = KINGDOM_COLORS[k.color] ?? '#fff';
        ctx.fillText(name, cx, ky);
      }
    }
    ctx.restore();
  }

  /**
   * A building at BUILDING_SCALE times the tile (architecture.ts): its art is drawn as if on a tile BUILDING_SCALE
   * tiles wide, standing on the bottom of its own tile and centred on it. Only the drawing grows; the building
   * still occupies one tile, and the layout (civ.ts findSite) keeps the tiles around it clear so it fits.
   */
  private drawBuilding(b: Building, color: number, arch: Architecture, s: number, ox: number, oy: number, x0: number, y0: number, x1: number, y1: number): void {
    if (b.x < x0 - 1 || b.x > x1 + 1 || b.y < y0 || b.y > y1 + 2 * BUILDING_SCALE) return;
    const ctx = this.ctx;
    const a = ctx.globalAlpha;
    ctx.globalAlpha = a * (b.done ? 1 : 0.45);
    const level = b.done ? b.level : 1;
    const w = Math.max(2, Math.round(s * BUILDING_SCALE));
    const px = Math.round(ox + (b.x + 0.5) * s - w / 2);
    const py = Math.round(oy + (b.y + 1) * s - w);
    if (s < 3) {
      // Far away: a coloured dot per building (houses by level, so towns read lighter and larger).
      ctx.fillStyle = buildingDot(arch, b.type, level);
      ctx.fillRect(px, py, w, w);
      if (b.type === 'house' && level >= 3) ctx.fillRect(px, py - w, w, w);
    } else {
      // Close: the outlined, shadowed sprite (built once per look and zoom, then reused).
      const sprite = this.buildingSprite(arch, b.type, level, color, w);
      ctx.drawImage(sprite.canvas, px - sprite.pad, py - w - sprite.pad);
      if (!this.quality.reduced) this.drawBuildingLife(b, arch, level, px, py, w);
    }
    ctx.globalAlpha = a;
    if (b.up && s >= 3) {
      // Upgrade under way: wooden scaffolding around the house (which keeps standing and housing its people).
      const u = w / 8;
      const top = b.up >= 3 ? -4 : -1;
      ctx.fillStyle = '#b07a3a';
      for (const x of [0, 7]) ctx.fillRect(Math.round(px + x * u), Math.round(py + top * u), Math.max(1, Math.round(u)), Math.round((8 - top) * u));
      for (let y = top + 1; y < 8; y += 3) ctx.fillRect(px, Math.round(py + y * u), w, Math.max(1, Math.round(u * 0.6)));
    }
    if ((!b.done || b.up) && s >= 3) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(px, py + w - 3, w, 3);
      ctx.fillStyle = b.up ? '#7fd3ff' : '#ffd34d';
      ctx.fillRect(px, py + w - 3, Math.round((w * b.progress) / b.needed), 3);
    }
  }

  private frameNow = 0;

  /**
   * Small cosmetic signs of life and damage on a building (drawing only): smoke drifting from the chimneys of human
   * houses (levels 3–4), a slow warm glow in elven windows (levels 2–4), and soot over any building that has fire on
   * or next to its tile (fire destroys it on the next settlement step, as before).
   */
  private drawBuildingLife(b: Building, arch: Architecture, level: number, px: number, py: number, w: number): void {
    const ctx = this.ctx;
    const u = w / 8;
    const t = this.frameNow / 1000;
    if (b.done && b.type === 'house' && arch === 'human' && level >= 3) {
      const chimneys = level >= 4 ? [[6.5, -7], [1.45, -6.6]] : [[6.3, -3.4]];
      for (const [cx, cy] of chimneys) {
        for (let k = 0; k < 3; k++) {
          const ph = (t * 0.6 + k / 3 + (b.id % 7) * 0.13) % 1; // each puff rises and fades
          const r = Math.max(1, u * (0.5 + ph * 0.9));
          ctx.fillStyle = `rgba(225,225,230,${(0.45 * (1 - ph)).toFixed(3)})`;
          ctx.fillRect(Math.round(px + (cx + ph * 1.4) * u - r / 2), Math.round(py + (cy - ph * 3.2) * u - r / 2), Math.round(r), Math.round(r));
        }
      }
    } else if (b.done && b.type === 'house' && arch === 'elven' && level >= 2) {
      // A soft halo around each lit window, pulsing slowly (window places as in architecture.ts).
      const a = 0.16 + 0.1 * Math.sin(t * 1.7 + b.id);
      ctx.fillStyle = `rgba(200,255,170,${a.toFixed(3)})`;
      const windows = level === 2 ? [[1.6, 4.3], [5.4, 4.3]] : level === 3 ? [[1.8, -0.6], [5.2, -0.6]] : [[3.5, -1.8], [3.5, 1.2], [0.6, 2.4], [6.6, 2.4]];
      for (const [wx, wy] of windows) ctx.fillRect(Math.round(px + (wx - 0.5) * u), Math.round(py + (wy - 0.5) * u), Math.round(2 * u), Math.round(2 * u));
    }
    const W = this.world.width;
    const i = b.y * W + b.x;
    const fire = this.world.fire;
    if (fire[i] || (b.x > 0 && fire[i - 1]) || (b.x < W - 1 && fire[i + 1]) || fire[i - W] || fire[i + W]) {
      ctx.fillStyle = 'rgba(30,18,10,0.45)'; // soot
      ctx.fillRect(px, py - (level >= 3 ? w : 0), w, level >= 3 ? 2 * w : w);
    }
  }

  private spriteCache = new Map<string, { canvas: HTMLCanvasElement; pad: number }>();

  /**
   * A settlement's landmark (render/landmarks.ts) at its centre: the outlined, shadowed sprite cached per look and
   * size, scaled about the centre tile (landmarkScaleFor: within the free centre from zoom 3 up, an icon further out).
   * Close up and not in reduced quality, the hearth of a human camp or village flickers.
   */
  private drawLandmark(st: Settlement, arch: Architecture, stage: Stage, cx: number, cy: number, s: number): void {
    const size = Math.max(2, Math.round(s * landmarkScaleFor(st, s / this.dpr)));
    const B = LANDMARK_BOUNDS;
    const left = cx + ((B.x0 - 4) * size) / 8;
    const top = cy + ((B.y0 - 4) * size) / 8;
    const wpx = ((B.x1 - B.x0) * size) / 8;
    const hpx = ((B.y1 - B.y0) * size) / 8;
    if (left > this.canvas.width || top > this.canvas.height || left + wpx < 0 || top + hpx < 0) return;
    const sp = this.landmarkSprite(arch, stage, st.color, size);
    // While the founders still clear the centre of trees the main building is only marked out (drawn faded).
    const prep = !!st.civ && preparing(st.civ, st, this.world.width);
    const a = this.ctx.globalAlpha;
    if (prep) this.ctx.globalAlpha = a * 0.4;
    this.ctx.drawImage(sp.canvas, Math.round(left) - sp.pad, Math.round(top) - sp.pad);
    this.ctx.globalAlpha = a;
    if (prep) return;
    if (!this.quality.reduced && arch === 'human' && stage !== 'town' && s >= 6) {
      const [hx, hy] = stage === 'camp' ? [4, 14.2] : [12.5, 14.4];
      const u = size / 8;
      const f = Math.floor(this.frameNow / 140 + st.id) % 3;
      this.ctx.fillStyle = f === 0 ? '#ffe27a' : f === 1 ? '#ffb340' : '#ff8a2a';
      this.ctx.fillRect(Math.round(cx + (hx - 4 - 0.3 + (f - 1) * 0.2) * u), Math.round(cy + (hy - 4 - 1.6 - f * 0.2) * u), Math.max(1, Math.round(0.6 * u)), Math.max(1, Math.round(0.7 * u)));
    }
  }

  private landmarkSprite(arch: Architecture, stage: Stage, color: number, size: number): { canvas: HTMLCanvasElement; pad: number } {
    const key = `L|${arch}|${stage}|${color}|${size}`;
    const hit = this.spriteCache.get(key);
    if (hit) return hit;
    if (this.spriteCache.size > 400) this.spriteCache.clear();
    const B = LANDMARK_BOUNDS;
    const u = size / 8;
    const pad = Math.max(1, Math.round(size / 24));
    const out = this.outlinedSprite(Math.ceil((B.x1 - B.x0) * u), Math.ceil((B.y1 - B.y0) * u), pad, (ac) =>
      drawLandmark(
        (x, y, ww, hh, col) => {
          ac.fillStyle = col;
          ac.fillRect(pad + Math.round((x - B.x0) * u), pad + Math.round((y - B.y0) * u), Math.max(1, Math.round(ww * u)), Math.max(1, Math.round(hh * u)));
        },
        arch, stage, COLORS[color],
      ),
      (fc) => {
        fc.fillStyle = 'rgba(0,0,0,0.28)'; // ground shadow along the base
        fc.fillRect(pad + Math.round((-6 - B.x0) * u), pad + Math.round((15 - B.y0) * u), Math.round(22 * u), Math.max(1, Math.round(1.2 * u)));
      },
    );
    const entry = { canvas: out, pad };
    this.spriteCache.set(key, entry);
    return entry;
  }

  /** Art drawn by `draw` on a padded canvas, with a dark outline of `pad` pixels and an optional shadow beneath. */
  private outlinedSprite(w: number, h: number, pad: number, draw: (c: CanvasRenderingContext2D) => void, shadow?: (c: CanvasRenderingContext2D) => void): HTMLCanvasElement {
    const make = () => {
      const c = document.createElement('canvas');
      c.width = w + 2 * pad;
      c.height = h + 2 * pad;
      return c;
    };
    const art = make();
    draw(art.getContext('2d')!);
    const outline = make();
    const oc = outline.getContext('2d')!;
    for (const [dx, dy] of [[pad, 0], [-pad, 0], [0, pad], [0, -pad]]) oc.drawImage(art, dx, dy);
    oc.globalCompositeOperation = 'source-in';
    oc.fillStyle = 'rgba(20,14,10,0.85)';
    oc.fillRect(0, 0, outline.width, outline.height);
    const out = make();
    const fc = out.getContext('2d')!;
    shadow?.(fc);
    fc.drawImage(outline, 0, 0);
    fc.drawImage(art, 0, 0);
    return out;
  }

  /** Burning tiles on landmarks this frame: drawn after the landmark (`late`) or behind its walls (`hidden`). */
  private landmarkFire: { late: Map<number, number>; hidden: Map<number, number> } | null = null;

  /**
   * Sorts burning tiles that a landmark covers, by settlement id: from zoom 3 up, tiles on the landmark's ground row
   * (in front of its walls) are drawn after it, tiles it covers further back are hidden behind its walls and shown
   * as glow and smoke; an icon (far away) has every covered fire drawn over it, as a plain marker.
   */
  private sortLandmarkFire(o: Overlay, zoom: number): { late: Map<number, number>; hidden: Map<number, number> } | null {
    if (!o.burning.length) return null;
    const W = this.world.width;
    const late = new Map<number, number>();
    const hidden = new Map<number, number>();
    for (const st of o.settlements) {
      if (!st.civ) continue;
      for (const i of o.burning) {
        const x = i % W;
        const side = landmarkFireSide(st, x, (i - x) / W, zoom);
        if (side === 'behind') hidden.set(i, st.id);
        else if (side) late.set(i, st.id);
      }
    }
    return late.size || hidden.size ? { late, hidden } : null;
  }

  /** The fire of one landmark: flames in front of it, and glow on its walls with smoke over its roof for fire behind. */
  private drawLandmarkFire(st: Settlement, s: number, ox: number, oy: number): void {
    const lf = this.landmarkFire;
    if (!lf) return;
    const mine = (m: Map<number, number>) => [...m].filter(([, id]) => id === st.id).map(([i]) => i);
    const late = mine(lf.late);
    if (late.length) this.drawFireTiles(late, s, ox, oy);
    const hidden = mine(lf.hidden);
    if (!hidden.length) return;
    const ctx = this.ctx;
    const W = this.world.width;
    const t = this.frameNow / 1000;
    const zoom = s / this.dpr;
    const k = landmarkScaleFor(st, zoom);
    const roof = oy + (st.y + 0.5 + ((landmarkTop(architectureOf(st.species), st.civ!.stage) - 4) * k) / 8) * s;
    for (const i of hidden) {
      const x = i % W;
      const y = (i - x) / W;
      const px = Math.round(ox + x * s);
      const py = Math.round(oy + y * s);
      const a = 0.22 + 0.1 * Math.sin(t * 9 + i);
      ctx.fillStyle = `rgba(255,120,30,${a.toFixed(3)})`; // firelight on the walls
      ctx.fillRect(px, py, Math.ceil(s), Math.ceil(s));
      for (let p = 0; p < 3; p++) {
        const ph = (t * 0.7 + p / 3 + (i % 5) * 0.2) % 1; // smoke rising over the roof
        const r = Math.max(2, Math.round(s * (0.25 + ph * 0.35)));
        ctx.fillStyle = `rgba(70,64,60,${(0.55 * (1 - ph)).toFixed(3)})`;
        ctx.fillRect(Math.round(px + s * 0.5 + ph * s * 0.4 - r / 2), Math.round(roof - ph * s * 2 - r / 2), r, r);
      }
    }
  }

  /**
   * A building's sprite for one tile size: the art on a canvas one tile wide and two tiles tall (it may rise a tile
   * above its own), with a dark outline so it reads against any ground and a soft shadow that sets it on its tile.
   */
  private buildingSprite(arch: Architecture, type: BuildingType, level: number, color: number, size: number): { canvas: HTMLCanvasElement; pad: number } {
    const key = `${arch}|${type}|${level}|${color}|${size}`;
    let hit = this.spriteCache.get(key);
    if (hit) return hit;
    if (this.spriteCache.size > 400) this.spriteCache.clear(); // zoom changes leave old sizes behind
    const pad = Math.max(1, Math.round(size / 24));
    const u = size / 8;
    const make = () => {
      const c = document.createElement('canvas');
      c.width = size + 2 * pad;
      c.height = 2 * size + 2 * pad;
      return c;
    };
    const art = make();
    const ac = art.getContext('2d')!;
    drawBuildingArt(
      (x, y, ww, hh, col) => {
        ac.fillStyle = col;
        ac.fillRect(pad + Math.round(x * u), pad + Math.round((y + 8) * u), Math.max(1, Math.round(ww * u)), Math.max(1, Math.round(hh * u)));
      },
      arch, type, level, COLORS[color],
    );
    const outline = make();
    const oc = outline.getContext('2d')!;
    for (const [dx, dy] of [[pad, 0], [-pad, 0], [0, pad], [0, -pad]]) oc.drawImage(art, dx, dy);
    oc.globalCompositeOperation = 'source-in';
    oc.fillStyle = 'rgba(20,14,10,0.85)';
    oc.fillRect(0, 0, outline.width, outline.height);
    const out = make();
    const fc = out.getContext('2d')!;
    fc.fillStyle = 'rgba(0,0,0,0.28)'; // ground shadow
    fc.fillRect(pad + Math.round(0.4 * u), pad + Math.round(15 * u), Math.round(7.6 * u), Math.max(1, Math.round(1.2 * u)));
    fc.drawImage(outline, 0, 0);
    fc.drawImage(art, 0, 0);
    hit = { canvas: out, pad };
    this.spriteCache.set(key, hit);
    return hit;
  }

  private drawFire(o: Overlay, s: number, ox: number, oy: number, keep?: (i: number) => boolean): void {
    if (!o.burning.length) return;
    this.drawFireTiles(keep ? o.burning.filter(keep) : o.burning, s, ox, oy);
  }

  private drawFireTiles(tiles: readonly number[], s: number, ox: number, oy: number): void {
    const ctx = this.ctx;
    const w = this.world.width;
    const size = Math.max(1, Math.ceil(s));
    const phase = Math.floor(this.frameNow / 110);
    const close = s >= 6;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    for (const i of tiles) {
      const x = i % w;
      const y = (i - x) / w;
      const px = Math.round(ox + x * s);
      const py = Math.round(oy + y * s);
      if (px < -2 * size || py < -2 * size || px > cw + size || py > ch + size) continue;
      const flick = (x * 7 + y * 13 + phase) % 3;
      if (close) {
        // Scorched ground, then a flame sprite rising a little above the tile.
        ctx.fillStyle = 'rgba(40,16,8,0.55)';
        ctx.fillRect(px, py, size, size);
        const f = this.flames[flick];
        const fw = Math.round(s);
        const fh = Math.round(s * 1.25);
        ctx.drawImage(f, px, py + size - fh, fw, fh);
      } else {
        ctx.fillStyle = flick === 0 ? 'rgba(255,200,60,0.9)' : flick === 1 ? 'rgba(255,120,30,0.9)' : 'rgba(220,60,20,0.9)';
        ctx.fillRect(px, py, size, size);
      }
    }
  }

  /**
   * Creatures. Close up they are drawn back to front together with the trees standing in front of them (0.23): the
   * chunk already shows every tree, so only trees whose base is below a creature's feet and whose sprite overlaps it
   * are drawn again, in order, so people walk under and behind canopies instead of on top of them. Far out: dots.
   */
  private drawCreatures(camera: Camera, cr: Creatures, s: number, ox: number, oy: number, alpha: number, overlay?: Overlay): void {
    const minX = camera.x - 2;
    const minY = camera.y - 2;
    const maxX = camera.x + this.canvas.width / s + 2;
    const maxY = camera.y + this.canvas.height / s + 2;
    const big = camera.zoom >= 3;
    if (!big) {
      for (let i = 0; i < cr.count; i++) {
        const x = cr.px[i] + (cr.x[i] - cr.px[i]) * alpha;
        const y = cr.py[i] + (cr.y[i] - cr.py[i]) * alpha;
        if (x < minX || y < minY || x > maxX || y > maxY) continue;
        this.drawDot(cr.species[i], Math.round(ox + x * s), Math.round(oy + y * s));
      }
      return;
    }
    // Visible creatures, by the y of their feet.
    const order: number[] = [];
    const ys = this.creatureYs.length >= cr.count ? this.creatureYs : (this.creatureYs = new Float32Array(Math.max(64, cr.count * 2)));
    for (let i = 0; i < cr.count; i++) {
      const x = cr.px[i] + (cr.x[i] - cr.px[i]) * alpha;
      const y = cr.py[i] + (cr.y[i] - cr.py[i]) * alpha;
      if (x < minX || y < minY || x > maxX || y > maxY) continue;
      ys[i] = y;
      order.push(i);
    }
    // Trees in front of creatures (only on wooded ground, only at the levels that draw trees).
    const P = terrainLevel(s, this.quality);
    const trees: Array<{ y: number; sp: Sprite; x: number; yy: number }> = [];
    if (P) {
      const W = this.world.width;
      const H = this.world.height;
      const seen = new Set<number>();
      for (const i of order) {
        const x = cr.px[i] + (cr.x[i] - cr.px[i]) * alpha;
        const y = ys[i];
        const tx = Math.floor(x);
        const ty = Math.floor(y);
        for (let dy = 0; dy <= 2; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = tx + dx;
            const ny = ty + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H || !WOODED[this.world.terrain[ny * W + nx]]) continue;
            const key = ny * W + nx;
            if (seen.has(key)) continue;
            const fs = this.painter.featuresAt(this.world, nx, ny, P);
            for (let n = 0; n < fs.length; n++) {
              const f = fs[n];
              if (!f.tree) continue;
              const by = ny + f.fy / 8; // the tree's base (world y)
              if (by <= y) continue; // behind the creature: the chunk already draws it below
              // Tree sprite in world units at this level: left/top from its base point and anchor.
              const left = nx + (Math.floor((f.fx * P) / 8) - f.sp.ax) / P;
              const top = ny + (Math.floor((f.fy * P) / 8) - f.sp.ay) / P;
              const cw = 0.35; // half a creature's width and its height, generously (tiles)
              if (left > x + cw || left + f.sp.w / P < x - cw || top > y || top + f.sp.h / P < y - 0.6) continue;
              seen.add(key);
              trees.push({ y: by, sp: f.sp, x: left, yy: top });
            }
          }
        }
      }
    }
    if (!trees.length) {
      order.sort((a, b) => ys[a] - ys[b] || a - b);
      for (const i of order) this.drawCreatureSprite(cr, i, s, ox, oy, alpha, overlay);
      return;
    }
    // Merge creatures and trees by y (trees first at equal y).
    trees.sort((a, b) => a.y - b.y);
    order.sort((a, b) => ys[a] - ys[b] || a - b);
    const ctx = this.ctx;
    const smooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    let t = 0;
    for (const i of order) {
      while (t < trees.length && trees[t].y <= ys[i]) this.drawTreeSprite(trees[t++], P, s, ox, oy);
      this.drawCreatureSprite(cr, i, s, ox, oy, alpha, overlay);
    }
    while (t < trees.length) this.drawTreeSprite(trees[t++], P, s, ox, oy);
    ctx.imageSmoothingEnabled = smooth;
  }

  private creatureYs = new Float32Array(0);
  private treeCanvas = new Map<Sprite, HTMLCanvasElement>();

  /** A tree sprite (cached as a canvas) at its world position, scaled like the terrain chunk it belongs to. */
  private drawTreeSprite(tr: { sp: Sprite; x: number; yy: number }, P: number, s: number, ox: number, oy: number): void {
    let c = this.treeCanvas.get(tr.sp);
    if (!c) {
      c = document.createElement('canvas');
      c.width = tr.sp.w;
      c.height = tr.sp.h;
      const img = new ImageData(new Uint8ClampedArray(tr.sp.rgba), tr.sp.w, tr.sp.h);
      c.getContext('2d')!.putImageData(img, 0, 0);
      this.treeCanvas.set(tr.sp, c);
    }
    const k = s / P;
    this.ctx.drawImage(c, Math.round(ox + tr.x * s), Math.round(oy + tr.yy * s), Math.round(tr.sp.w * k), Math.round(tr.sp.h * k));
  }

  private drawCreatureSprite(cr: Creatures, i: number, s: number, ox: number, oy: number, alpha: number, overlay?: Overlay): void {
    const ctx = this.ctx;
    const now = overlay?.now ?? 0;
    const x = cr.px[i] + (cr.x[i] - cr.px[i]) * alpha;
    const y = cr.py[i] + (cr.y[i] - cr.py[i]) * alpha;
    const sp = cr.species[i];
    const def = SPECIES[sp];
    const px = Math.round(ox + x * s);
    const py = Math.round(oy + y * s);
    const juvenile = cr.age[i] < def.adultAge;
    // Walking creatures alternate two frames (fleeing ones faster); standing, eating or working ones hold still.
    const moving = cr.x[i] !== cr.px[i] || cr.y[i] !== cr.py[i];
    const frame = moving ? (Math.floor(now / (cr.state[i] === STATE.FLEE ? 110 : 190)) + cr.id[i]) & 1 : 0;
    const set = this.sprites[sp][frame];
    const sprite = cr.dx[i] >= 0 ? set.right : set.left;
    // Half a terrain pixel per sprite pixel (creatureScale), with a minimum size far away; juveniles smaller.
    // The sprite canvas carries a 1-pixel outline margin, so the scale is taken from the art inside it.
    const artW = sprite.width - 2 * OUTLINE_PAD;
    const scale = creatureScale(s, artW, !!def.sentient, juvenile, this.dpr);
    const w = Math.max(2, Math.round(sprite.width * scale));
    const h = Math.max(2, Math.round(sprite.height * scale));
    // Swimming (0.23): only head and shoulders above the water, bobbing gently, with a ripple at the waterline.
    if (def.move === MOVE.SWIM) {
      const id = this.world.terrain[Math.floor(y) * this.world.width + Math.floor(x)];
      if (isWater(id) && id !== T.RIVER) {
        const top = py - h + Math.round(h * 0.25) + (Math.floor(now / 400 + cr.id[i]) & 1);
        const keep = Math.round(h * 0.55);
        ctx.drawImage(sprite, 0, 0, sprite.width, Math.round(sprite.height * 0.55), px - (w >> 1), top, w, keep);
        ctx.fillStyle = 'rgba(220,240,255,0.7)';
        ctx.fillRect(px - Math.round(w * 0.55), top + keep - 1, Math.round(w * 1.1), Math.max(1, Math.round(h * 0.06)));
        return;
      }
    }
    // A soft ground shadow under the feet, so nobody floats.
    if (def.habitat === 'land') {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(px - Math.round(w * 0.3), py + Math.round(h * 0.2), Math.round(w * 0.6), Math.max(1, Math.round(h * 0.08)));
    }
    ctx.drawImage(sprite, px - (w >> 1), py - h + Math.round(h * 0.25), w, h);
    const workKind = overlay?.workKind;
    if (workKind && cr.state[i] === STATE.WORK) {
      const kind = workKind(cr.id[i]);
      const markFrame = overlay ? Math.floor(overlay.now / 300) & 1 : 0;
      // A tiny tool beside the head, swinging in two frames (cheap: only people at work).
      if (kind) drawWorkMark(ctx, kind, px + (w >> 1) - Math.round(w * 0.1), py - h + Math.round(h * 0.25) - markFrame * Math.max(1, Math.round(scale)), Math.max(1, Math.round(scale)), markFrame);
    }
  }

  /** Far out: a creature as a dot with a dark rim, large enough to see (people brighter and bigger). */
  private drawDot(sp: number, px: number, py: number): void {
    const ctx = this.ctx;
    const def = SPECIES[sp];
    const d = Math.max(2, Math.round(this.dpr * (def.sentient ? 4 : def.size > 1.2 ? 3.5 : 3)));
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(px - (d >> 1) - 1, py - (d >> 1) - 1, d + 2, d + 2);
    ctx.fillStyle = def.marker ?? def.color;
    ctx.fillRect(px - (d >> 1), py - (d >> 1), d, d);
  }

  private drawSelection(cr: Creatures, id: number, s: number, ox: number, oy: number, alpha: number): void {
    const i = cr.indexOf(id);
    if (i < 0) return;
    const ctx = this.ctx;
    const sp = SPECIES[cr.species[i]];
    const x = ox + (cr.px[i] + (cr.x[i] - cr.px[i]) * alpha) * s;
    const y = oy + (cr.py[i] + (cr.y[i] - cr.py[i]) * alpha) * s;
    const r = Math.max(7 * this.dpr, s * sp.size * 0.7 * CREATURE_SCALE);
    ctx.lineWidth = Math.max(1.5, this.dpr * 1.5);
    ctx.strokeStyle = '#f2c14e';
    ctx.beginPath();
    ctx.arc(x, y - r * 0.2, r, 0, Math.PI * 2);
    ctx.stroke();
    // Health bar above the creature.
    const bw = Math.max(20 * this.dpr, r * 1.6);
    const bh = Math.max(3, 3 * this.dpr);
    const bx = x - bw / 2;
    const by = y - r * 1.4 - bh;
    const frac = Math.max(0, Math.min(1, cr.health[i] / sp.maxHealth));
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    ctx.fillStyle = frac > 0.5 ? '#5fd35f' : frac > 0.25 ? '#f2c14e' : '#e0533a';
    ctx.fillRect(bx, by, bw * frac, bh);
  }
}

const WORK_MARKS: Record<JobKind, readonly string[][]> = {
  // h: metal, w: wooden handle, g: green shoot, s: stone. Two frames each.
  wood: [['hh.', 'hw.', '..w'], ['.hh', '.wh', 'w..']],
  stone: [['hhh', '.w.', '.w.'], ['h..', '.wh', '..w']],
  build: [['hh.', 'hw.', '..w'], ['hh.', 'hw.', '.w.']],
  farm: [['.g.', 'gwg', '.w.'], ['g.g', '.w.', '.w.']],
};
const MARK_COLORS: Record<string, string> = { h: '#d6dbe2', w: '#9a6a34', g: '#7bd65a', s: '#9aa3ad' };

function drawWorkMark(ctx: CanvasRenderingContext2D, kind: JobKind, x: number, y: number, u: number, frame: number): void {
  const rows = WORK_MARKS[kind][frame];
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x - 1, y - 1, 3 * u + 2, 3 * u + 2);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const col = MARK_COLORS[rows[r][c]];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x + c * u, y + r * u, u, u);
    }
  }
}

/** Three frames of an original 8×10 pixel flame. */
function flameFrames(): HTMLCanvasElement[] {
  const frames = [
    ['...y....', '...yy...', '..yoy...', '..yoo.y.', '.yooo.y.', '.yoroyo.', 'yoorroo.', 'yorrroy.', '.orrrro.', '..rddr..'],
    ['....y...', '...yy...', '...yoy..', '.y.ooy..', '.yoooy..', '.oyrooy.', '.oorrooy', 'yorrrroy', '.orrrro.', '..rddr..'],
    ['..y.....', '..yy..y.', '..yoy.y.', '.yooyy..', '.yoooo..', 'yoorooy.', 'yoorroo.', 'yorrrroy', '.orrrro.', '..rddr..'],
  ];
  const pal: Record<string, string> = { y: '#ffe27a', o: '#ff9a2e', r: '#e2461f', d: '#5a1c0e' };
  return frames.map((rows) => {
    const c = document.createElement('canvas');
    c.width = 8;
    c.height = 10;
    const ctx = c.getContext('2d')!;
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const col = pal[row[x]];
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect(x, y, 1, 1);
      }
    });
    return c;
  });
}
