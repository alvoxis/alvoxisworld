import { hash2 } from '../core/rng';
import { Creatures, SPECIES } from '../sim/creatures';
import { SEA_LEVEL, T, TERRAIN, isWater } from '../world/terrain';
import { CHUNK, World } from '../world/world';
import { Camera } from './camera';
import { Tileset, TILE_PX, VARIANTS, creatureSprite } from './tileset';

/** Zoom (CSS px per tile) at which 8×8 pixel-art tiles replace the 1px-per-tile map. */
export const DETAIL_ZOOM = 6;
const MAX_CACHED_CHUNKS = 80;
const MAX_CHUNK_BUILDS_PER_FRAME = 8;
const FROST_TEMPERATURE = 0.45 * 255;

export interface BrushCursor {
  x: number;
  y: number;
  radius: number;
}

/**
 * Two-level map renderer:
 *  - zoomed out: one pixel per tile in an offscreen canvas, scaled up without smoothing;
 *  - zoomed in: lazily built 32×32-tile chunks of 8×8 pixel-art tiles (LRU cached).
 * Only chunks the world marks dirty are rebuilt.
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
  private readonly chunks = new Map<number, HTMLCanvasElement>();
  private readonly pool: HTMLCanvasElement[] = [];
  private readonly sprites: Array<{ right: HTMLCanvasElement; left: HTMLCanvasElement }>;
  winter = false;

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
  }

  get tiles(): Tileset {
    return this.tileset;
  }

  setWorld(world: World): void {
    this.world = world;
    this.base = document.createElement('canvas');
    this.base.width = world.width;
    this.base.height = world.height;
    this.baseCtx = this.base.getContext('2d')!;
    this.baseImage = this.baseCtx.createImageData(world.width, world.height);
    for (const c of this.chunks.values()) this.pool.push(c);
    this.chunks.clear();
    world.markAllDirty();
  }

  setWinter(winter: boolean): void {
    if (winter === this.winter) return;
    this.winter = winter;
    this.world.markAllDirty();
  }

  /** Resizes the backing store to the element's CSS size × devicePixelRatio (capped at 2). */
  resize(cssW: number, cssH: number): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
  }

  /** Brightness multiplier from elevation (hill shading) or water depth. */
  private tileLight(i: number, x: number, y: number): number {
    const w = this.world;
    const h = w.heights[i];
    if (isWater(w.terrain[i])) return 0.62 + 0.38 * Math.min(1, h / SEA_LEVEL);
    const nx = x > 0 ? x - 1 : x;
    const ny = y > 0 ? y - 1 : y;
    const diff = h - w.heights[w.idx(nx, ny)];
    return 1 + Math.max(-0.28, Math.min(0.28, diff * 0.035));
  }

  private frosted(i: number): boolean {
    const w = this.world;
    return this.winter && !isWater(w.terrain[i]) && w.terrain[i] !== T.SNOW && w.temperature[i] < FROST_TEMPERATURE;
  }

  /** Rebuilds the 1px map and drops cached detail chunks for every dirty chunk. */
  private flushDirty(): void {
    const w = this.world;
    if (w.dirtyChunks.size === 0) return;
    const data = this.baseImage.data;
    for (const c of w.dirtyChunks) {
      const cx = c % w.chunksX;
      const cy = Math.floor(c / w.chunksX);
      const x0 = cx * CHUNK;
      const y0 = cy * CHUNK;
      const x1 = Math.min(w.width, x0 + CHUNK);
      const y1 = Math.min(w.height, y0 + CHUNK);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * w.width + x;
          const col = TERRAIN[w.terrain[i]].color;
          const f = this.tileLight(i, x, y) * (0.95 + hash2(x, y, w.seed) * 0.1);
          let r = col[0] * f;
          let g = col[1] * f;
          let b = col[2] * f;
          if (this.frosted(i)) {
            r = r * 0.45 + 130;
            g = g * 0.45 + 134;
            b = b * 0.45 + 140;
          }
          const o = i * 4;
          data[o] = r;
          data[o + 1] = g;
          data[o + 2] = b;
          data[o + 3] = 255;
        }
      }
      this.baseCtx.putImageData(this.baseImage, 0, 0, x0, y0, x1 - x0, y1 - y0);
      const cached = this.chunks.get(c);
      if (cached) {
        this.chunks.delete(c);
        this.pool.push(cached);
      }
    }
    w.dirtyChunks.clear();
  }

  private buildChunk(c: number): HTMLCanvasElement {
    const w = this.world;
    const size = CHUNK * TILE_PX;
    const canvas = this.pool.pop() ?? document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(size, size);
    const out = img.data;
    const src = this.tileset.pixels;
    const x0 = (c % w.chunksX) * CHUNK;
    const y0 = Math.floor(c / w.chunksX) * CHUNK;

    for (let ly = 0; ly < CHUNK; ly++) {
      const y = y0 + ly;
      if (y >= w.height) break;
      for (let lx = 0; lx < CHUNK; lx++) {
        const x = x0 + lx;
        if (x >= w.width) break;
        const i = y * w.width + x;
        const id = w.terrain[i];
        const variant = Math.floor(hash2(x, y, w.seed) * VARIANTS);
        const so = this.tileset.offset(id, variant);
        const f = this.tileLight(i, x, y);
        const frost = this.frosted(i);
        // Foam where shallow water meets land.
        const foam =
          id === T.SHALLOW_WATER
            ? [
                y > 0 && !isWater(w.terrain[i - w.width]),
                y < w.height - 1 && !isWater(w.terrain[i + w.width]),
                x > 0 && !isWater(w.terrain[i - 1]),
                x < w.width - 1 && !isWater(w.terrain[i + 1]),
              ]
            : null;
        for (let py = 0; py < TILE_PX; py++) {
          let o = ((ly * TILE_PX + py) * size + lx * TILE_PX) * 4;
          let s = so + py * TILE_PX * 4;
          for (let px = 0; px < TILE_PX; px++, o += 4, s += 4) {
            let r = src[s] * f;
            let g = src[s + 1] * f;
            let b = src[s + 2] * f;
            if (frost && (px + py) % 3 !== 0) {
              r = r * 0.4 + 140;
              g = g * 0.4 + 145;
              b = b * 0.4 + 152;
            }
            if (foam && ((foam[0] && py === 0) || (foam[1] && py === 7) || (foam[2] && px === 0) || (foam[3] && px === 7))) {
              r = 196;
              g = 222;
              b = 236;
            }
            out[o] = r;
            out[o + 1] = g;
            out[o + 2] = b;
            out[o + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  /**
   * @param alpha  interpolation (0..1) between each creature's previous and current tick position
   * @param selectedId  creature id to highlight (0 = none)
   */
  render(camera: Camera, creatures: Creatures, cursor: BrushCursor | null, alpha = 1, selectedId = 0): void {
    this.flushDirty();
    const ctx = this.ctx;
    const w = this.world;
    const s = camera.zoom * this.dpr; // device px per tile
    const ox = -camera.x * s;
    const oy = -camera.y * s;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0d1f3a';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(this.base, Math.round(ox), Math.round(oy), Math.round(w.width * s), Math.round(w.height * s));

    if (camera.zoom >= DETAIL_ZOOM) {
      const cx0 = Math.max(0, Math.floor(camera.x / CHUNK));
      const cy0 = Math.max(0, Math.floor(camera.y / CHUNK));
      const cx1 = Math.min(w.chunksX - 1, Math.floor((camera.x + cw / s) / CHUNK));
      const cy1 = Math.min(w.chunksY - 1, Math.floor((camera.y + ch / s) / CHUNK));
      let builds = 0;
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const c = cy * w.chunksX + cx;
          let canvas = this.chunks.get(c);
          if (canvas) {
            this.chunks.delete(c); // refresh LRU position
          } else {
            if (builds >= MAX_CHUNK_BUILDS_PER_FRAME) continue; // 1px map stays visible underneath
            canvas = this.buildChunk(c);
            builds++;
          }
          this.chunks.set(c, canvas);
          const sx = Math.round(ox + cx * CHUNK * s);
          const sy = Math.round(oy + cy * CHUNK * s);
          const ex = Math.round(ox + (cx + 1) * CHUNK * s);
          const ey = Math.round(oy + (cy + 1) * CHUNK * s);
          ctx.drawImage(canvas, sx, sy, ex - sx, ey - sy);
        }
      }
      while (this.chunks.size > MAX_CACHED_CHUNKS) {
        const oldest = this.chunks.keys().next().value as number;
        this.pool.push(this.chunks.get(oldest)!);
        this.chunks.delete(oldest);
      }
    }

    this.drawCreatures(camera, creatures, s, ox, oy, alpha);
    if (selectedId) this.drawSelection(creatures, selectedId, s, ox, oy, alpha);

    if (cursor) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = Math.max(1, this.dpr);
      ctx.beginPath();
      ctx.arc(ox + cursor.x * s, oy + cursor.y * s, Math.max(3, cursor.radius * s), 0, Math.PI * 2);
      ctx.stroke();
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
