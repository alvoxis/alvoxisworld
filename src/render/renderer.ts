import { hash2 } from '../core/rng';
import { Creatures, SPECIES, STATE } from '../sim/creatures';
import type { WeatherSystem } from '../sim/weather';
import { SEA_LEVEL, T, TERRAIN, isWater } from '../world/terrain';
import { CHUNK, World } from '../world/world';
import { Camera } from './camera';
import { TerrainPainter, type PaintOptions } from './painter';
import { SkyRenderer, type Bolt, type Dust, type VisualEffect } from './skyfx';
import type { MeteorInFlight } from '../sim/sky';
import { COLORS, type Settlement } from '../sim/settlements';
import type { Building, BuildingType, JobKind } from '../sim/civ';
import { Tileset, TILE_PX, creatureSprite } from './tileset';

/** Device pixels per tile at which 8-px-per-tile detail chunks are used. */
export const DETAIL_SCALE = 9;
/** Device pixels per tile at which 4-px-per-tile chunks replace the 1-px map. */
export const MID_SCALE = 3;
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
const MIN_SPRITE_PX = 7;
const MIN_PERSON_PX = 10;
/** Smaller repaint steps in performance mode. */
const FLUSH_BUDGET_LOW_MS = 2;
const FROST_TEMPERATURE = 0.45 * 255;
const SHALLOW_RGB = [66, 150, 196] as const;
const MAX_GLINTS = 500;
const DEEP_RGB = [20, 48, 108] as const;

export type { VisualEffect } from './skyfx';

/** Simulation state drawn on top of the map. */
const BUILDING_COLORS: Record<BuildingType, string> = { house: '#c9a36b', storehouse: '#8d8579', farm: '#7fb046', lumber: '#7a5530', quarry: '#9a9791' };

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
  /** Kind of work of a settlement worker (drawn as a small tool over people at work). */
  workKind?: (id: number) => JobKind | undefined;
  now: number;
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
    readonly P: 8 | 4,
    private readonly max: number,
  ) {}

  markStale(c: number): void {
    const e = this.chunks.get(c);
    if (e) e.stale = true;
  }

  clear(): void {
    for (const e of this.chunks.values()) this.pool.push(e.canvas);
    this.chunks.clear();
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
  private readonly detail = new ChunkLevel(8, MAX_DETAIL_CHUNKS);
  private readonly mid = new ChunkLevel(4, MAX_MID_CHUNKS);
  private readonly sprites: Array<{ right: HTMLCanvasElement; left: HTMLCanvasElement }>;
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
    this.sprites = SPECIES.map((s) => {
      const right = creatureSprite(s.id);
      const left = document.createElement('canvas');
      left.width = right.width;
      left.height = right.height;
      const lctx = left.getContext('2d')!;
      lctx.translate(right.width, 0);
      lctx.scale(-1, 1);
      lctx.drawImage(right, 0, 0);
      return { right, left };
    });
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
      this.detail.markStale(c);
      this.mid.markStale(c);
    }
    return w.dirtyChunks.size;
  }

  /** Draws the visible chunks of one level, painting missing or stale ones within the frame budget. */
  private drawLevel(level: ChunkLevel, camera: Camera, s: number, ox: number, oy: number, budgetEnd: number): void {
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
    for (const c of list) {
      let e = level.chunks.get(c);
      const canPaint = this.paintStats.lastFrame === 0 || performance.now() < budgetEnd;
      if (e) {
        level.chunks.delete(c); // refresh LRU position
        if (e.stale && canPaint) {
          const t0 = performance.now();
          level.paint(this.painter, w, c, opts, e.canvas);
          this.countPaint(performance.now() - t0);
          e.stale = false;
        }
      } else {
        if (!canPaint) continue; // the coarser map underneath stays visible
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
    if (s >= DETAIL_SCALE) this.drawLevel(this.detail, camera, s, ox, oy, budgetEnd);
    else if (s >= MID_SCALE) this.drawLevel(this.mid, camera, s, ox, oy, budgetEnd);
    if (s >= MID_SCALE && overlay && !this.quality.reduced) this.drawGlints(camera, s, ox, oy, overlay.now);

    if (overlay) this.drawFire(overlay, s, ox, oy);
    // Settlements (borders, buildings, centre marker) are drawn first so that people are never hidden behind them.
    if (overlay?.settlementBorders && overlay.settlements.length) this.drawSettlements(overlay.settlements, camera, s, ox, oy);
    this.drawCreatures(camera, creatures, s, ox, oy, alpha, overlay);
    if (overlay?.settlementBorders && overlay.settlements.length && s >= 3 * this.dpr) this.drawSettlementLabels(overlay.settlements, s, ox, oy);
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
  private drawSettlements(list: readonly Settlement[], camera: Camera, s: number, ox: number, oy: number): void {
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
    for (const st of list) {
      if (!st.edges.length) continue;
      ctx.beginPath();
      for (const e of st.edges) {
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
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = Math.max(3, 3 * this.dpr);
      ctx.stroke();
      ctx.strokeStyle = COLORS[st.color];
      ctx.lineWidth = Math.max(1.5, 1.6 * this.dpr);
      ctx.stroke();
      // Buildings of a human settlement (finished ones solid, under construction faded).
      if (st.civ) for (const b of st.civ.buildings) this.drawBuilding(b, st.color, s, ox, oy, x0, y0, x1, y1);
      // Centre marker.
      const cx = ox + (st.x + 0.5) * s;
      const cy = oy + (st.y + 0.5) * s;
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
  private drawSettlementLabels(list: readonly Settlement[], s: number, ox: number, oy: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `${Math.round(11 * this.dpr)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 3 * this.dpr;
    for (const st of list) {
      const cx = ox + (st.x + 0.5) * s;
      const cy = oy + (st.y + 0.5) * s - Math.max(10 * this.dpr, s * 1.6);
      if (cx < -80 || cy < -40 || cx > this.canvas.width + 80 || cy > this.canvas.height + 40) continue;
      const label = `${st.name} · ${st.members.length}`;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(label, cx, cy);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, cx, cy);
    }
    ctx.restore();
  }

  private drawBuilding(b: Building, color: number, s: number, ox: number, oy: number, x0: number, y0: number, x1: number, y1: number): void {
    if (b.x < x0 || b.x > x1 || b.y < y0 || b.y > y1) return;
    const ctx = this.ctx;
    const px = Math.round(ox + b.x * s);
    const py = Math.round(oy + b.y * s);
    const w = Math.max(2, Math.round(s));
    const a = ctx.globalAlpha;
    ctx.globalAlpha = a * (b.done ? 1 : 0.45);
    if (s < 3) {
      // Far away: a coloured dot per building.
      ctx.fillStyle = BUILDING_COLORS[b.type];
      ctx.fillRect(px, py, w, w);
    } else {
      const u = s / 8; // art is drawn on an 8×8 grid
      const r = (x: number, y: number, ww: number, hh: number, c: string) => {
        ctx.fillStyle = c;
        ctx.fillRect(Math.round(px + x * u), Math.round(py + y * u), Math.max(1, Math.round(ww * u)), Math.max(1, Math.round(hh * u)));
      };
      switch (b.type) {
        case 'house':
          r(1, 3, 6, 4, '#c9a36b');
          r(0, 2, 8, 2, COLORS[color]); // roof in the settlement colour
          r(3, 5, 2, 2, '#4a3220');
          break;
        case 'storehouse':
          r(0, 2, 8, 5, '#8d8579');
          r(0, 1, 8, 2, COLORS[color]);
          r(2, 4, 4, 3, '#4a4339');
          break;
        case 'farm':
          r(0, 1, 8, 6, '#9a7a44');
          for (let k = 0; k < 4; k++) r(1, 1 + k * 1.5, 6, 0.8, '#6fae3e');
          break;
        case 'lumber':
          r(1, 4, 5, 3, '#7a5530');
          r(5, 1, 2, 3, '#3f7d3a');
          r(0, 7, 8, 1, '#5a3e22');
          break;
        default:
          r(0, 3, 8, 4, '#7d7b78');
          r(1, 1, 4, 3, '#a09d98');
          r(5, 4, 2, 2, '#4a4947');
      }
    }
    ctx.globalAlpha = a;
    if (!b.done && s >= 3) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(px, py + w - 3, w, 3);
      ctx.fillStyle = '#ffd34d';
      ctx.fillRect(px, py + w - 3, Math.round((w * b.progress) / b.needed), 3);
    }
  }

  private drawFire(o: Overlay, s: number, ox: number, oy: number): void {
    if (!o.burning.length) return;
    const ctx = this.ctx;
    const w = this.world.width;
    const size = Math.max(1, Math.ceil(s));
    const phase = Math.floor(o.now / 110);
    const close = s >= 6;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    for (const i of o.burning) {
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

  private drawCreatures(camera: Camera, cr: Creatures, s: number, ox: number, oy: number, alpha: number, overlay?: Overlay): void {
    const workKind = overlay?.workKind;
    const frame = overlay ? Math.floor(overlay.now / 300) & 1 : 0;
    const ctx = this.ctx;
    const minX = camera.x - 2;
    const minY = camera.y - 2;
    const maxX = camera.x + this.canvas.width / s + 2;
    const maxY = camera.y + this.canvas.height / s + 2;
    const big = camera.zoom >= 3;
    for (let i = 0; i < cr.count; i++) {
      const x = cr.px[i] + (cr.x[i] - cr.px[i]) * alpha;
      const y = cr.py[i] + (cr.y[i] - cr.py[i]) * alpha;
      if (x < minX || y < minY || x > maxX || y > maxY) continue;
      const sp = cr.species[i];
      const def = SPECIES[sp];
      const px = Math.round(ox + x * s);
      const py = Math.round(oy + y * s);
      const juvenile = cr.age[i] < def.adultAge;
      if (big) {
        const set = this.sprites[sp];
        const sprite = cr.dx[i] >= 0 ? set.right : set.left;
        // One sprite pixel = 1/8 tile, like terrain; juveniles are drawn smaller. Nothing is drawn smaller than
        // MIN_SPRITE_PX device pixels (people a little larger), so creatures stay visible and tappable at any zoom.
        const minW = (def.sentient ? MIN_PERSON_PX : MIN_SPRITE_PX) * this.dpr;
        const scale = Math.max(s / TILE_PX, minW / sprite.width) * (juvenile ? 0.75 : 1);
        const w = Math.max(2, Math.round(sprite.width * scale));
        const h = Math.max(2, Math.round(sprite.height * scale));
        ctx.drawImage(sprite, px - (w >> 1), py - h + Math.round(h * 0.25), w, h);
        if (workKind && cr.state[i] === STATE.WORK) {
          const kind = workKind(cr.id[i]);
          // A tiny tool beside the head, swinging in two frames (cheap: only people at work).
          if (kind) drawWorkMark(ctx, kind, px + (w >> 1) - Math.round(w * 0.1), py - h + Math.round(h * 0.25) - frame * Math.max(1, Math.round(scale)), Math.max(1, Math.round(scale)), frame);
        }
      } else {
        // Far out: a dot with a dark rim, large enough to see (people brighter and bigger).
        const d = Math.max(2, Math.round(this.dpr * (def.sentient ? 4 : def.size > 1.2 ? 3.5 : 3)));
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(px - (d >> 1) - 1, py - (d >> 1) - 1, d + 2, d + 2);
        ctx.fillStyle = def.sentient ? '#6fa8ff' : def.color;
        ctx.fillRect(px - (d >> 1), py - (d >> 1), d, d);
      }
    }
  }

  private drawSelection(cr: Creatures, id: number, s: number, ox: number, oy: number, alpha: number): void {
    const i = cr.indexOf(id);
    if (i < 0) return;
    const ctx = this.ctx;
    const sp = SPECIES[cr.species[i]];
    const x = ox + (cr.px[i] + (cr.x[i] - cr.px[i]) * alpha) * s;
    const y = oy + (cr.py[i] + (cr.y[i] - cr.py[i]) * alpha) * s;
    const r = Math.max(8 * this.dpr, s * sp.size * 0.7);
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
