import { hash2, Rng } from '../core/rng';
import { SLOPE } from '../world/passability';
import { MOUNTAIN_LEVEL, SEA_LEVEL, T, TERRAIN, TERRAIN_COUNT } from '../world/terrain';
import { CHUNK, World } from '../world/world';
import { SPRITES, Tileset, VARIANTS, halfSprite, type Sprite } from './tileset';

/** Options that change how chunks look (changing one requires repainting). */
export interface PaintOptions {
  /** Winter: cold land is frosted. */
  winter: boolean;
  /** Hatch terrain that blocks lowland animals (mountains, snow). */
  passOverlay: boolean;
}

const FROST_TEMPERATURE = 0.45 * 255;
/** Biome-edge warp amplitude in tiles. Rivers are never warped. */
const WARP = 0.34;
const WARP_SIZE = 64;
const M = CHUNK + 2; // chunk plus a one-tile margin on every side

/** Terrain the painter treats as open water (depth shading and shore foam). */
const OPEN_WATER = new Uint8Array(TERRAIN_COUNT);
OPEN_WATER[T.DEEP_WATER] = 1;
OPEN_WATER[T.SHALLOW_WATER] = 1;
OPEN_WATER[T.LAKE] = 1;
/** Terrain that counts as land for shore foam (rivers count as neither). */
const SHORE_LAND = new Uint8Array(TERRAIN_COUNT).fill(1);
/** Sea colours at the shore and in the deepest water. */
const SHALLOW_RGB = [66, 150, 196] as const;
const DEEP_RGB = [20, 48, 108] as const;
/** 1 / (r+g+b) of each terrain's base colour: turns tile art into a ripple factor around 1. */
const TEX_NORM = Float32Array.from(TERRAIN, (t) => 1 / Math.max(1, t.color[0] + t.color[1] + t.color[2]));
SHORE_LAND[T.DEEP_WATER] = SHORE_LAND[T.SHALLOW_WATER] = SHORE_LAND[T.LAKE] = SHORE_LAND[T.RIVER] = 0;

/**
 * A tileable field of smooth offsets (value noise on a 16-cell lattice plus a
 * little per-pixel jitter), in tiles, indexed by global 1/8-tile pixel position.
 * Sampling terrain at warped positions turns square tile edges into organic,
 * slightly dithered boundaries without changing which tile is which.
 */
function makeWarp(seed: number): { wx: Float32Array; wy: Float32Array } {
  const rng = new Rng(seed);
  const L = 4; // lattice cells across the table
  const lat = (): Float32Array => Float32Array.from({ length: L * L }, () => rng.next() * 2 - 1);
  const lx = lat();
  const ly = lat();
  const wx = new Float32Array(WARP_SIZE * WARP_SIZE);
  const wy = new Float32Array(WARP_SIZE * WARP_SIZE);
  const cell = WARP_SIZE / L;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < WARP_SIZE; y++) {
    for (let x = 0; x < WARP_SIZE; x++) {
      const gx = x / cell;
      const gy = y / cell;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const tx = smooth(gx - x0);
      const ty = smooth(gy - y0);
      const at = (a: Float32Array, i: number, j: number) => a[((j + L) % L) * L + ((i + L) % L)];
      const bil = (a: Float32Array) =>
        (at(a, x0, y0) * (1 - tx) + at(a, x0 + 1, y0) * tx) * (1 - ty) + (at(a, x0, y0 + 1) * (1 - tx) + at(a, x0 + 1, y0 + 1) * tx) * ty;
      const k = y * WARP_SIZE + x;
      wx[k] = (bil(lx) * 0.8 + (rng.next() - 0.5) * 0.4) * WARP;
      wy[k] = (bil(ly) * 0.8 + (rng.next() - 0.5) * 0.4) * WARP;
    }
  }
  return { wx, wy };
}

interface Feature {
  sprites8: Sprite[];
  sprites4: Sprite[];
}

const feature = (list: Sprite[]): Feature => ({ sprites8: list, sprites4: list.map(halfSprite) });
const FEATURES = {
  oak: feature(SPRITES.oak),
  jungle: feature(SPRITES.jungle),
  pine: feature(SPRITES.pine),
  acacia: feature(SPRITES.acacia),
  peak: feature(SPRITES.peak),
  smallPeak: feature(SPRITES.smallPeak),
  snowPeak: feature(SPRITES.snowPeak),
  smallSnowPeak: feature(SPRITES.smallSnowPeak),
  reed: feature(SPRITES.reed),
  bush: feature(SPRITES.bush),
  flowers: feature(SPRITES.flowers),
  stones: feature(SPRITES.stones),
  sandStones: feature(SPRITES.sandStones),
};

/**
 * Paints map chunks (CHUNK×CHUNK tiles) into RGBA buffers at 8 or 4 pixels per
 * tile. Pure computation over the world's arrays, so it is deterministic and
 * testable without a DOM. Each pixel samples terrain at a slightly warped
 * position (organic biome edges), takes its texture from the tileset, and is lit
 * by bilinear hill shading from tile-corner slopes; open water is coloured by
 * depth with foam along the shore. Trees, peaks and reeds are sprites that may
 * overlap neighbouring tiles. Everything a chunk reads lies within one tile of
 * it, which World.markDirty already invalidates.
 */
export class TerrainPainter {
  private readonly warp: { wx: Float32Array; wy: Float32Array };
  // Scratch for one chunk (with margin).
  private readonly ids = new Uint8Array(M * M);
  private readonly variant = new Uint8Array(M * M);
  private readonly frost = new Uint8Array(M * M);
  /** Slope class per tile of the chunk plus margin (see world/passability.ts). */
  private readonly slope = new Uint8Array(M * M);
  private readonly vLight = new Float32Array((CHUNK + 1) * (CHUNK + 1));
  private readonly vDepth = new Float32Array((CHUNK + 1) * (CHUNK + 1));

  /** Per-pixel brightness grain (±5%, tileable) that breaks up repeated tile art. */
  private readonly grain: Float32Array;

  constructor(private readonly tiles: Tileset, seed = 0x2545f491) {
    this.warp = makeWarp(seed);
    const rng = new Rng(seed ^ 0x9e3779b9);
    this.grain = Float32Array.from({ length: WARP_SIZE * WARP_SIZE }, () => 0.95 + rng.next() * 0.1);
  }

  /** Paints chunk (cx, cy) at `P` (8 or 4) pixels per tile into out (CHUNK·P squared RGBA). */
  paintChunk(world: World, cx: number, cy: number, P: 8 | 4, out: Uint8ClampedArray, opts: PaintOptions): void {
    const W = world.width;
    const H = world.height;
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    const terrain = world.terrain;
    const ids = this.ids;
    const variant = this.variant;
    const frost = this.frost;
    const slope = this.slope;

    // Tile data for the chunk plus margin (clamped at the map edge).
    for (let my = 0; my < M; my++) {
      const y = Math.min(H - 1, Math.max(0, y0 + my - 1));
      for (let mx = 0; mx < M; mx++) {
        const x = Math.min(W - 1, Math.max(0, x0 + mx - 1));
        const i = y * W + x;
        const id = terrain[i];
        const k = my * M + mx;
        ids[k] = id;
        variant[k] = Math.floor(hash2(x, y, world.seed) * VARIANTS);
        slope[k] = world.slopeClass[i];
        frost[k] = opts.winter && !OPEN_WATER[id] && id !== T.RIVER && id !== T.SNOW && world.temperature[i] < FROST_TEMPERATURE ? 1 : 0;
      }
    }

    // Light and water depth at tile corners: corner (vx, vy) touches tiles (vx-1..vx, vy-1..vy).
    const heights = world.heights;
    const hAt = (x: number, y: number) => heights[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
    for (let vy = 0; vy <= CHUNK; vy++) {
      for (let vx = 0; vx <= CHUNK; vx++) {
        const gx = x0 + vx;
        const gy = y0 + vy;
        const a = hAt(gx - 1, gy - 1);
        const b = hAt(gx, gy - 1);
        const c = hAt(gx - 1, gy);
        const d = hAt(gx, gy);
        // Slope facing the north-west light is brighter: height rising toward the south-east.
        const sx = b + d - a - c;
        const sy = c + d - a - b;
        const avg = (a + b + c + d) * 0.25;
        const k = vy * (CHUNK + 1) + vx;
        this.vLight[k] = 1 + Math.max(-0.32, Math.min(0.32, (sx + sy) * 0.016)) + Math.max(0, avg - SEA_LEVEL) * 0.0008;
        this.vDepth[k] = Math.max(0, Math.min(1, (SEA_LEVEL - avg) / 90));
      }
    }

    const S = CHUNK * P;
    const art = this.tiles.ground;
    const wx = this.warp.wx;
    const wy = this.warp.wy;
    const step = 8 / P; // art pixels per output pixel
    const pass = opts.passOverlay;
    const VL = CHUNK + 1;

    for (let ly = 0; ly < CHUNK; ly++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const ownK = (ly + 1) * M + (lx + 1);
        const own = ids[ownK];
        const riverAround =
          ids[ownK - 1] === T.RIVER || ids[ownK + 1] === T.RIVER || ids[ownK - M] === T.RIVER || ids[ownK + M] === T.RIVER;
        const v00 = ly * VL + lx;
        const l00 = this.vLight[v00];
        const l10 = this.vLight[v00 + 1];
        const l01 = this.vLight[v00 + VL];
        const l11 = this.vLight[v00 + VL + 1];
        const d00 = this.vDepth[v00];
        const d10 = this.vDepth[v00 + 1];
        const d01 = this.vDepth[v00 + VL];
        const d11 = this.vDepth[v00 + VL + 1];
        for (let py = 0; py < P; py++) {
          const fy = (py + 0.5) / P;
          const gpy = ((y0 + ly) * 8 + py * step) & (WARP_SIZE - 1);
          let o = ((ly * P + py) * S + lx * P) * 4;
          for (let px = 0; px < P; px++, o += 4) {
            const fx = (px + 0.5) / P;
            const gpx = ((x0 + lx) * 8 + px * step) & (WARP_SIZE - 1);
            const wk = gpy * WARP_SIZE + gpx;
            // Warped sample (stays within the one-tile margin).
            const sxf = lx + 1 + fx + wx[wk];
            const syf = ly + 1 + fy + wy[wk];
            let k = (syf | 0) * M + (sxf | 0);
            let id = ids[k];
            if (own === T.RIVER || id === T.RIVER) {
              k = ownK;
              id = own;
            }
            // Rivers are 4-connected staircases: cut their outer corners and fill the
            // inner ones along the diagonal so they read as smooth channels.
            const nearRiver = own === T.RIVER || riverAround;
            if (nearRiver) {
              const qx = fx < 0.5 ? -1 : 1;
              const qy = fy < 0.5 ? -M : M;
              const ex = qx < 0 ? fx : 1 - fx;
              const ey = qy < 0 ? fy : 1 - fy;
              if (ex + ey < 0.5) {
                const nh = ids[ownK + qx];
                const nv = ids[ownK + qy];
                if (own === T.RIVER && nh !== T.RIVER && nv !== T.RIVER && nh === nv) {
                  k = ownK + qx;
                  id = nh;
                } else if (own !== T.RIVER && SHORE_LAND[own] && nh === T.RIVER && nv === T.RIVER) {
                  k = ownK + qx;
                  id = T.RIVER;
                }
              }
            }
            const vk = variant[k];
            const ax = vk & 1 ? 7 - px * step : px * step; // odd variants mirrored: more variety from the same art
            const so = ((id * VARIANTS + vk) * 64 + (py * step) * 8 + ax) * 4;
            let r = art[so];
            let g = art[so + 1];
            let b = art[so + 2];
            const top = l00 + (l10 - l00) * fx;
            const bot = l01 + (l11 - l01) * fx;
            if (OPEN_WATER[id]) {
              const dt = d00 + (d10 - d00) * fx;
              const db = d01 + (d11 - d01) * fx;
              const depth = dt + (db - dt) * fy;
              // Sea colour comes from depth alone (no hard deep/shallow tile edge);
              // the tile art only adds its ripples. Lakes keep their own tint.
              const tex = (r + g + b) * TEX_NORM[id];
              if (id === T.LAKE) {
                const f = tex * (1.08 - depth * 0.3);
                r *= f / tex;
                g *= f / tex;
                b *= f / tex;
              } else {
                const t = Math.sqrt(depth);
                r = (SHALLOW_RGB[0] + (DEEP_RGB[0] - SHALLOW_RGB[0]) * t) * tex;
                g = (SHALLOW_RGB[1] + (DEEP_RGB[1] - SHALLOW_RGB[1]) * t) * tex;
                b = (SHALLOW_RGB[2] + (DEEP_RGB[2] - SHALLOW_RGB[2]) * t) * tex;
              }
              // Shore foam where land is just beside the warped sample point.
              const near =
                SHORE_LAND[ids[(syf | 0) * M + ((sxf + 0.24) | 0)]] |
                SHORE_LAND[ids[(syf | 0) * M + ((sxf - 0.24) | 0)]] |
                SHORE_LAND[ids[((syf + 0.24) | 0) * M + (sxf | 0)]] |
                SHORE_LAND[ids[((syf - 0.24) | 0) * M + (sxf | 0)]];
              if (near) {
                r = r * 0.35 + 150;
                g = g * 0.35 + 162;
                b = b * 0.35 + 166;
              } else {
                const wet =
                  SHORE_LAND[ids[(syf | 0) * M + ((sxf + 0.55) | 0)]] |
                  SHORE_LAND[ids[(syf | 0) * M + ((sxf - 0.55) | 0)]] |
                  SHORE_LAND[ids[((syf + 0.55) | 0) * M + (sxf | 0)]] |
                  SHORE_LAND[ids[((syf - 0.55) | 0) * M + (sxf | 0)]];
                if (wet) {
                  r = r * 0.82 + 30;
                  g = g * 0.82 + 44;
                  b = b * 0.82 + 40;
                }
              }
            } else {
              const light = (top + (bot - top) * fy) * this.grain[((gpy + 23) & (WARP_SIZE - 1)) * WARP_SIZE + ((gpx + 41) & (WARP_SIZE - 1))];
              r *= light;
              g *= light;
              b *= light;
              if (frost[k] && ((px + py * 2) & 3) !== 0) {
                r = r * 0.42 + 140;
                g = g * 0.42 + 145;
                b = b * 0.42 + 152;
              }
              // Sheer cliffs always read as rock faces (dark vertical streaks), steep ground slightly darker.
              const sc = slope[k];
              if (sc === SLOPE.CLIFF) {
                const streak = 0.5 + 0.22 * (((gpx * 5 + (gpy >> 2)) & 3) / 3);
                r = r * streak + 14;
                g = g * streak + 14;
                b = b * streak + 20;
              } else if (sc === SLOPE.STEEP) {
                r *= 0.93;
                g *= 0.93;
                b *= 0.93;
              }
              if (pass) {
                // Passability overlay: red hatching where lowland animals cannot go (mountains, snow, steep
                // slopes) and a dense cross-hatch where nothing can (sheer cliffs).
                if (sc === SLOPE.CLIFF && (((gpx + gpy) & 3) < 2 || ((gpx - gpy) & 3) === 0)) {
                  r = r * 0.35 + 130;
                  g *= 0.3;
                  b *= 0.3;
                } else if ((id === T.MOUNTAIN || id === T.SNOW || sc === SLOPE.STEEP) && ((gpx + gpy) & 7) < 2) {
                  r = r * 0.5 + 90;
                  g *= 0.45;
                  b *= 0.45;
                }
              }
            }
            out[o] = r;
            out[o + 1] = g;
            out[o + 2] = b;
            out[o + 3] = 255;
          }
        }
      }
    }

    this.paintFeatures(world, x0, y0, P, out);
  }

  /** Trees, peaks and reeds, back to front, including those of margin tiles that overlap the chunk. */
  private paintFeatures(world: World, x0: number, y0: number, P: 8 | 4, out: Uint8ClampedArray): void {
    const ids = this.ids;
    const S = CHUNK * P;
    const seed = world.seed;
    for (let my = 0; my < M; my++) {
      for (let mx = 0; mx < M; mx++) {
        const k = my * M + mx;
        const id = ids[k];
        const tx = x0 + mx - 1;
        const ty = y0 + my - 1;
        if (tx < 0 || ty < 0 || tx >= world.width || ty >= world.height) continue;
        const h1 = hash2(tx, ty, seed ^ 0x68e31da4);
        const h2 = hash2(ty, tx, seed ^ 0x1b56c4e9);
        let feat: Feature | null = null;
        let count = 1;
        switch (id) {
          case T.FOREST: {
            feat = FEATURES.oak;
            // Dense in the interior, thinning toward the edge with clearings, so forests do not end in a hard line.
            const ti = ty * world.width + tx;
            const tt = world.terrain;
            const W = world.width;
            const open =
              (tx > 0 && tt[ti - 1] !== T.FOREST && tt[ti - 1] !== T.JUNGLE) ||
              (tx < W - 1 && tt[ti + 1] !== T.FOREST && tt[ti + 1] !== T.JUNGLE) ||
              (ty > 0 && tt[ti - W] !== T.FOREST && tt[ti - W] !== T.JUNGLE) ||
              (ty < world.height - 1 && tt[ti + W] !== T.FOREST && tt[ti + W] !== T.JUNGLE);
            count = open ? (h1 < 0.7 ? 1 : 0) : h1 < 0.55 ? 2 : 1;
            break;
          }
          case T.GRASS:
            // Sparse ground detail: a bush on about 6% of grass tiles, a few flowers on another 7%.
            if (h1 < 0.06) feat = FEATURES.bush;
            else if (h1 < 0.13) feat = FEATURES.flowers;
            break;
          case T.HILLS:
            if (h1 < 0.12) feat = FEATURES.stones;
            break;
          case T.DESERT:
          case T.SAND:
            if (h1 < 0.04) feat = FEATURES.sandStones;
            break;
          case T.JUNGLE:
            feat = FEATURES.jungle;
            count = 2;
            break;
          case T.TUNDRA:
            if (h1 < 0.22) feat = FEATURES.pine;
            break;
          case T.SAVANNA:
            if (h1 < 0.28) feat = FEATURES.acacia;
            break;
          case T.SNOW:
          case T.MOUNTAIN: {
            // Big peaks on ridge crests (highest tile among its neighbours), smaller ones scattered elsewhere.
            // Snow at mountain height is a snow-capped mountain too; snow on cold lowland has no peaks.
            const ti = ty * world.width + tx;
            const hh = world.heights[ti];
            if (id === T.SNOW && hh < MOUNTAIN_LEVEL) break;
            let crest = true;
            let ties = 0;
            for (let dy = -1; dy <= 1 && crest; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                const nx = tx + dx;
                const ny = ty + dy;
                if (!(dx || dy) || nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue;
                const nh = world.heights[ny * world.width + nx];
                if (nh > hh) {
                  crest = false;
                  break;
                }
                if (nh === hh) ties++;
              }
            }
            if (crest && ties > 0 && h1 < 0.6) crest = false; // flat tops: only some tiles carry a big peak
            const snowy = hh > 200 || world.temperature[ti] < 70;
            if (crest) feat = snowy ? FEATURES.snowPeak : FEATURES.peak;
            else if (h1 < 0.22) feat = snowy ? FEATURES.smallSnowPeak : FEATURES.smallPeak;
            break;
          }
          case T.SWAMP:
            if (h1 < 0.4) feat = FEATURES.reed;
            break;
        }
        if (!feat) continue;
        // Keep river banks clear so canopies never hide where the water runs.
        // (Checked on the world, not the chunk scratch, so neighbouring chunks agree at their seams.)
        const ti = ty * world.width + tx;
        const tt = world.terrain;
        if (
          (tx > 0 && tt[ti - 1] === T.RIVER) || (tx < world.width - 1 && tt[ti + 1] === T.RIVER) ||
          (ty > 0 && tt[ti - world.width] === T.RIVER) || (ty < world.height - 1 && tt[ti + world.width] === T.RIVER)
        ) continue;
        const list = P === 8 ? feat.sprites8 : feat.sprites4;
        for (let n = 0; n < count; n++) {
          const r1 = n === 0 ? h1 : h2;
          const r2 = n === 0 ? h2 : (h1 * 7.31) % 1;
          const sp = list[Math.floor(r1 * 997) % list.length];
          // Feature base position inside the tile (in 1/8 tiles).
          const fx = n === 0 ? 2 + Math.floor(r1 * 4) : 4 + Math.floor(r2 * 3) - 2 * (Math.floor(r1 * 3) % 2);
          const fy = n === 0 ? 4 + Math.floor(r2 * 3) : 7;
          const bx = Math.floor((((mx - 1) * 8 + fx) * P) / 8) - sp.ax;
          const by = Math.floor((((my - 1) * 8 + fy) * P) / 8) - sp.ay;
          blit(sp, bx, by, out, S);
        }
      }
    }
  }
}

/** Alpha-blends a sprite into an S×S RGBA buffer, clipped. */
function blit(sp: Sprite, bx: number, by: number, out: Uint8ClampedArray, S: number): void {
  const xs = Math.max(0, -bx);
  const ys = Math.max(0, -by);
  const xe = Math.min(sp.w, S - bx);
  const ye = Math.min(sp.h, S - by);
  if (xs >= xe || ys >= ye) return;
  const src = sp.rgba;
  for (let y = ys; y < ye; y++) {
    let s = (y * sp.w + xs) * 4;
    let o = ((by + y) * S + bx + xs) * 4;
    for (let x = xs; x < xe; x++, s += 4, o += 4) {
      const a = src[s + 3];
      if (a === 0) continue;
      if (a === 255) {
        out[o] = src[s];
        out[o + 1] = src[s + 1];
        out[o + 2] = src[s + 2];
      } else {
        const t = a / 255;
        out[o] += (src[s] - out[o]) * t;
        out[o + 1] += (src[s + 1] - out[o + 1]) * t;
        out[o + 2] += (src[s + 2] - out[o + 2]) * t;
      }
    }
  }
}

