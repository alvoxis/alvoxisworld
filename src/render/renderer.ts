import { hash2 } from '../core/rng';
import { Creatures, SPECIES } from '../sim/creatures';
import { WEATHER_KIND, type WeatherSystem } from '../sim/weather';
import { SEA_LEVEL, T, TERRAIN, isWater } from '../world/terrain';
import { CHUNK, World } from '../world/world';
import { Camera } from './camera';
import { TerrainPainter, type PaintOptions } from './painter';
import { Tileset, TILE_PX, creatureSprite } from './tileset';

/** Device pixels per tile at which 8-px-per-tile detail chunks are used. */
export const DETAIL_SCALE = 9;
/** Device pixels per tile at which 4-px-per-tile chunks replace the 1-px map. */
export const MID_SCALE = 3;
const MAX_DETAIL_CHUNKS = 80;
const MAX_MID_CHUNKS = 160;
/** Chunk painting budget per frame (ms); at least one visible chunk is painted per frame. */
const PAINT_BUDGET_MS = 6;
const FROST_TEMPERATURE = 0.45 * 255;
const SHALLOW_RGB = [66, 150, 196] as const;
const MAX_GLINTS = 500;
const DEEP_RGB = [20, 48, 108] as const;

/** Short-lived visual effect (pure decoration over a real simulation change). */
export interface VisualEffect {
  kind: 'meteor' | 'quake';
  x: number;
  y: number;
  radius: number;
  /** performance.now() when it started. */
  start: number;
}

/** Simulation state drawn on top of the map. */
export interface Overlay {
  burning: readonly number[];
  weather: readonly WeatherSystem[];
  effects: readonly VisualEffect[];
  now: number;
}

export interface BrushCursor {
  x: number;
  y: number;
  radius: number;
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

  /** Resizes the backing store to the element's CSS size × devicePixelRatio (capped at 2). */
  resize(cssW: number, cssH: number): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
  }

  /** Rebuilds the 1px map for every dirty chunk and marks painted chunks stale. */
  private flushDirty(): void {
    const w = this.world;
    if (w.dirtyChunks.size === 0) return;
    const data = this.baseImage.data;
    const W = w.width;
    const H = w.height;
    const hs = w.heights;
    for (const c of w.dirtyChunks) {
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
    w.dirtyChunks.clear();
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
    this.flushDirty();
    const ctx = this.ctx;
    const w = this.world;
    const s = camera.zoom * this.dpr; // device px per tile
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
    if (s >= MID_SCALE && overlay) this.drawGlints(camera, s, ox, oy, overlay.now);

    if (overlay) this.drawFire(overlay, s, ox, oy);
    this.drawCreatures(camera, creatures, s, ox, oy, alpha);
    if (overlay) this.drawWeather(overlay, s, ox, oy);
    if (selectedId) this.drawSelection(creatures, selectedId, s, ox, oy, alpha);

    if (cursor) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = Math.max(1, this.dpr);
      ctx.beginPath();
      ctx.arc(ox + cursor.x * s, oy + cursor.y * s, Math.max(3, cursor.radius * s), 0, Math.PI * 2);
      ctx.stroke();
    }
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

  /** Burning tiles: animated pixel flames up close, flickering embers from afar. */
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

  /** Weather systems (soft tinted discs with rain streaks / heat shimmer) and impact effects. */
  private drawWeather(o: Overlay, s: number, ox: number, oy: number): void {
    const ctx = this.ctx;
    for (const sys of o.weather) {
      const cx = ox + sys.x * s;
      const cy = oy + sys.y * s;
      const r = sys.radius * s;
      const rain = sys.kind === WEATHER_KIND.RAIN;
      const g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
      const a = 0.2 + 0.25 * sys.intensity;
      g.addColorStop(0, rain ? `rgba(70,90,120,${a})` : `rgba(240,150,40,${a * 0.8})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      if (rain) {
        ctx.strokeStyle = 'rgba(200,225,255,0.7)';
        ctx.lineWidth = Math.max(1, this.dpr);
        const drops = Math.min(120, Math.round(r / 6));
        const t = o.now / 400;
        ctx.beginPath();
        for (let k = 0; k < drops; k++) {
          const ang = (k * 2.399) % (Math.PI * 2);
          const rr = r * Math.sqrt(((k * 0.618) % 1));
          const dx = cx + Math.cos(ang) * rr;
          const dy = cy + Math.sin(ang) * rr + (((t + k * 0.37) % 1) - 0.5) * 12 * this.dpr;
          ctx.moveTo(dx, dy);
          ctx.lineTo(dx - 2 * this.dpr, dy + 7 * this.dpr);
        }
        ctx.stroke();
      }
    }
    for (const e of o.effects) {
      const age = (o.now - e.start) / 900;
      if (age < 0 || age > 1) continue;
      const cx = ox + e.x * s;
      const cy = oy + e.y * s;
      const r = e.radius * s * (0.3 + age);
      ctx.lineWidth = Math.max(2, 4 * this.dpr * (1 - age));
      ctx.strokeStyle = e.kind === 'meteor' ? `rgba(255,220,140,${1 - age})` : `rgba(200,170,120,${1 - age})`;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      if (e.kind === 'meteor' && age < 0.3) {
        ctx.fillStyle = `rgba(255,240,200,${0.6 * (1 - age / 0.3)})`;
        ctx.beginPath();
        ctx.arc(cx, cy, e.radius * s * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawCreatures(camera: Camera, cr: Creatures, s: number, ox: number, oy: number, alpha: number): void {
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
      const px = Math.round(ox + x * s);
      const py = Math.round(oy + y * s);
      const juvenile = cr.age[i] < SPECIES[sp].adultAge;
      if (big) {
        const set = this.sprites[sp];
        const sprite = cr.dx[i] >= 0 ? set.right : set.left;
        // One sprite pixel = 1/8 tile, like terrain; juveniles are drawn smaller.
        const scale = (s / TILE_PX) * (juvenile ? 0.7 : 1);
        const w = Math.max(2, Math.round(sprite.width * scale));
        const h = Math.max(2, Math.round(sprite.height * scale));
        ctx.drawImage(sprite, px - (w >> 1), py - h + Math.round(h * 0.25), w, h);
      } else {
        const d = Math.max(2, Math.round(this.dpr * (SPECIES[sp].size > 1.2 ? 2.5 : 1.5)));
        ctx.fillStyle = SPECIES[sp].color;
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
