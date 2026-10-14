import { smoothCreatureModular } from './smoothart';
import { Rng } from '../core/rng';
import { T, TERRAIN, TERRAIN_COUNT } from '../world/terrain';

export const TILE_PX = 8;
export const VARIANTS = 4;
const TILE_BYTES = TILE_PX * TILE_PX * 4;

type RGB = readonly [number, number, number];

const shade = (c: RGB, f: number): RGB => [c[0] * f, c[1] * f, c[2] * f];

/**
 * Procedurally drawn 8×8 pixel-art tiles, generated at startup. All art is
 * original and produced in code; there are no external image assets.
 */
export class Tileset {
  /** RGBA for every (terrain, variant): index ((id * VARIANTS + v) * 64 + py * 8 + px) * 4. Whole-tile art (toolbar swatches). */
  readonly pixels = new Uint8ClampedArray(TERRAIN_COUNT * VARIANTS * TILE_BYTES);
  /**
   * Ground art for the map, same layout. Terrain with features (trees, peaks)
   * has bare ground here; the features are sprites (see SPRITES) that may
   * overlap neighbouring tiles, so the map does not look like a grid.
   */
  readonly ground = new Uint8ClampedArray(TERRAIN_COUNT * VARIANTS * TILE_BYTES);

  constructor(seed = 1337) {
    const rng = new Rng(seed);
    for (let id = 0; id < TERRAIN_COUNT; id++) {
      for (let v = 0; v < VARIANTS; v++) this.draw(id, v, rng);
    }
    this.ground.set(this.pixels);
    const grng = new Rng(seed ^ 0x5bd1e995);
    for (const id of [T.FOREST, T.JUNGLE, T.SAVANNA, T.MOUNTAIN, T.HILLS]) {
      for (let v = 0; v < VARIANTS; v++) this.drawGround(id, v, grng);
    }
  }

  /** Bare ground under sprite features. */
  private drawGround(id: number, v: number, rng: Rng): void {
    const off = this.offset(id, v);
    const px = this.ground;
    const set = (x: number, y: number, c: RGB) => {
      const o = off + (y * TILE_PX + x) * 4;
      px[o] = c[0];
      px[o + 1] = c[1];
      px[o + 2] = c[2];
      px[o + 3] = 255;
    };
    const base: RGB =
      id === T.FOREST ? shade(TERRAIN[T.GRASS].color, 0.74)
      : id === T.JUNGLE ? shade(TERRAIN[T.JUNGLE].color, 0.62)
      : id === T.SAVANNA ? TERRAIN[T.SAVANNA].color
      : id === T.HILLS ? ([104, 138, 70] as RGB)
      : shade(TERRAIN[T.MOUNTAIN].color, 0.92);
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const r = rng.next();
        let f = 1 + (rng.next() - 0.5) * 0.1;
        if (r < 0.12) f *= 0.82; // litter / grit
        else if (r > 0.92) f *= 1.12;
        set(x, y, shade(base, f));
      }
    }
    if (id === T.HILLS) {
      // A few stones; the relief itself comes from hill shading.
      for (let k = 0; k < 1 + (v & 1); k++) {
        const x = rng.int(0, 6);
        const y = rng.int(1, 6);
        set(x, y, [150, 146, 128]);
        set(x + 1, y, [118, 114, 100]);
      }
    }
  }

  offset(id: number, variant: number): number {
    return (id * VARIANTS + variant) * TILE_BYTES;
  }

  /** Renders one tile into a canvas (used for toolbar swatches). */
  toCanvas(id: number, variant = 0, scale = 4): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = TILE_PX;
    c.height = TILE_PX;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(TILE_PX, TILE_PX);
    img.data.set(this.pixels.subarray(this.offset(id, variant), this.offset(id, variant) + TILE_BYTES));
    ctx.putImageData(img, 0, 0);
    c.style.width = `${TILE_PX * scale}px`;
    c.style.height = `${TILE_PX * scale}px`;
    c.style.imageRendering = 'pixelated';
    return c;
  }

  private draw(id: number, v: number, rng: Rng): void {
    const base = TERRAIN[id].color;
    const off = this.offset(id, v);
    const px = this.pixels;
    const set = (x: number, y: number, c: RGB) => {
      if (x < 0 || y < 0 || x >= TILE_PX || y >= TILE_PX) return;
      const o = off + (y * TILE_PX + x) * 4;
      px[o] = c[0];
      px[o + 1] = c[1];
      px[o + 2] = c[2];
      px[o + 3] = 255;
    };
    const fill = (c: RGB, jitter: number) => {
      for (let y = 0; y < TILE_PX; y++)
        for (let x = 0; x < TILE_PX; x++) set(x, y, shade(c, 1 + (rng.next() - 0.5) * jitter));
    };
    const speckle = (c: RGB, count: number) => {
      for (let k = 0; k < count; k++) set(rng.int(0, 7), rng.int(0, 7), c);
    };
    const tree = (cx: number, cy: number, r: number, leaf: RGB) => {
      set(cx, cy + r, [92, 60, 34]);
      set(cx, cy + r + 1, [70, 46, 26]);
      for (let y = -r; y <= r; y++)
        for (let x = -r; x <= r; x++) {
          const d = x * x + y * y;
          if (d > r * r + 1) continue;
          const lit = x + y < -1 ? 1.25 : x + y > 1 ? 0.75 : 1;
          set(cx + x, cy + y, shade(leaf, lit));
        }
    };

    switch (id) {
      case T.DEEP_WATER:
      case T.SHALLOW_WATER: {
        fill(base, 0.05);
        const light = shade(base, 1.25);
        const y = rng.int(1, 6);
        const x = rng.int(0, 4);
        if (v < 3) for (let k = 0; k < 3; k++) set(x + k, y, light);
        break;
      }
      case T.RIVER: {
        // Running water: bright, with diagonal flow streaks.
        fill(base, 0.04);
        const light = shade(base, 1.3);
        for (let k = 0; k < 3; k++) {
          const sx = (v * 2 + k * 3) % 8;
          set(sx, (k * 3 + v) % 8, light);
          set(sx + 1, (k * 3 + v + 1) % 8, light);
        }
        break;
      }
      case T.LAKE:
        // Still fresh water: darker, calm, a few soft glints.
        fill(base, 0.03);
        if (v < 2) set(rng.int(1, 6), rng.int(1, 6), shade(base, 1.22));
        break;
      case T.SAND:
        fill(base, 0.06);
        speckle(shade(base, 0.85), 4);
        speckle(shade(base, 1.08), 3);
        break;
      case T.GRASS:
        fill(base, 0.1);
        // Scattered tufts of varying height and the odd flower, so repeated tiles do not form rows.
        for (let k = 0; k < 3 + v; k++) {
          const x = rng.int(0, 7);
          const y = rng.int(2, 7);
          set(x, y, shade(base, 0.76));
          set(x, y - 1, shade(base, 1.16));
          if (rng.next() < 0.5) set(x + (rng.next() < 0.5 ? 1 : -1), y - 1, shade(base, 1.08));
        }
        if (v === 1) set(rng.int(1, 6), rng.int(1, 6), [236, 220, 120]);
        if (v === 3) set(rng.int(1, 6), rng.int(1, 6), [230, 236, 240]);
        break;
      case T.FOREST:
        fill(shade(TERRAIN[T.GRASS].color, 0.8), 0.08);
        tree(3 + (v & 1), 3 + (v >> 1 === 1 ? 0 : -1), 2 + (v === 3 ? 1 : 0), base);
        break;
      case T.JUNGLE:
        fill(shade(base, 0.7), 0.1);
        tree(2, 2, 2, base);
        tree(5 + (v & 1), 4, 2, shade(base, 1.1));
        break;
      case T.DESERT: {
        fill(base, 0.05);
        const y0 = rng.int(2, 5);
        for (let x = 0; x < 8; x++) set(x, y0 + Math.round(Math.sin((x + v) * 0.9)), shade(base, 0.86));
        break;
      }
      case T.SAVANNA:
        fill(base, 0.09);
        speckle(shade(base, 0.82), 4);
        if (v < 2) {
          const cx = rng.int(2, 5);
          for (let x = -2; x <= 2; x++) set(cx + x, 2, [70, 110, 40]);
          for (let x = -1; x <= 1; x++) set(cx + x, 1, [90, 130, 50]);
          set(cx, 3, [92, 64, 36]);
          set(cx, 4, [92, 64, 36]);
        }
        break;
      case T.SWAMP:
        fill(base, 0.1);
        for (let k = 0; k < 2; k++) {
          const x = rng.int(0, 5);
          const y = rng.int(1, 6);
          set(x, y, [62, 98, 104]);
          set(x + 1, y, [62, 98, 104]);
          set(x + 2, y, [74, 112, 118]);
        }
        speckle([50, 80, 40], 3);
        break;
      case T.TUNDRA:
        fill(base, 0.08);
        speckle([200, 206, 200], 4);
        speckle(shade(base, 0.8), 3);
        break;
      case T.SNOW:
        fill(base, 0.03);
        speckle([206, 220, 236], 4);
        break;
      case T.HILLS: {
        fill(TERRAIN[T.GRASS].color, 0.07);
        const cx = 3 + (v & 1);
        for (let y = 2; y < 7; y++)
          for (let x = -3; x <= 3; x++) {
            if (x * x + (y - 6) * (y - 6) * 1.6 > 12) continue;
            set(cx + x, y, shade(base, x < 0 ? 1.12 : 0.82));
          }
        break;
      }
      case T.MOUNTAIN: {
        fill(shade(base, 0.85), 0.06);
        const cx = 3 + (v & 1);
        for (let y = 1; y < 8; y++) {
          const half = Math.floor((y - 1) * 0.7) + 1;
          for (let x = -half; x <= half; x++) {
            const c = y <= 2 ? ([236, 240, 244] as RGB) : shade(base, x < 0 ? 1.18 : 0.78);
            set(cx + x, y, c);
          }
        }
        break;
      }
      case T.SOIL:
        fill(base, 0.1);
        speckle(shade(base, 0.7), 5);
        speckle([110, 150, 70], v);
        break;
      default:
        fill(base, 0.05);
    }
  }
}

/**
 * A creature sprite (facing right) from creatureart.ts, with a one-pixel dark outline baked in so it reads on any
 * ground. The canvas is the art plus a 1-pixel margin on every side (OUTLINE_PAD).
 */
export const OUTLINE_PAD = 1;
export function creatureSprite(species: number, frame = 0, seed?: number): HTMLCanvasElement {
  // Use creature ID for individual appearance when provided
  return smoothCreatureModular(species, frame, seed ?? species);
}

/** A sprite in RGBA (premultiplied-free; alpha 0..255), drawn at 8 px per tile. */
export interface Sprite {
  w: number;
  h: number;
  /** Anchor: sprite pixel placed at the feature's position (usually the base centre). */
  ax: number;
  ay: number;
  rgba: Uint8ClampedArray;
}

function makeSprite(w: number, h: number, ax: number, ay: number, draw: (set: (x: number, y: number, c: RGB, a?: number) => void) => void): Sprite {
  const rgba = new Uint8ClampedArray(w * h * 4);
  draw((x, y, c, a = 255) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const o = (y * w + x) * 4;
    rgba[o] = c[0];
    rgba[o + 1] = c[1];
    rgba[o + 2] = c[2];
    rgba[o + 3] = a;
  });
  return { w, h, ax, ay, rgba };
}

/** Round-canopy tree: shadow, trunk, canopy lit from the north-west. */
function treeSprite(r: number, leaf: RGB, trunk: RGB): Sprite {
  const d = r * 2 + 1;
  const w = d + 2;
  const h = d + 3;
  return makeSprite(w, h, r, d + 1, (set) => {
    // Soft shadow to the south-east.
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++) if (x * x + y * y * 2.2 <= r * r) set(r + 2 + x, d + y * 0.4 + 1 | 0, [10, 30, 10], 70);
    set(r, d, trunk);
    set(r, d + 1, shade(trunk, 0.8));
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++) {
        const q = x * x + y * y;
        if (q > r * r + r * 0.6) continue;
        const edge = q > (r - 1) * (r - 1) + 1;
        const lit = x + y < -r * 0.5 ? 1.22 : x + y > r * 0.6 ? 0.72 : 1;
        set(r + x, r + y, shade(leaf, edge ? lit * 0.82 : lit));
      }
  });
}

/**
 * A tall broadleaf (0.23): a long trunk with a fork of branches showing under an uneven crown of three leaf masses,
 * lit from the north-west. `k` is 1 for 8 px per tile and 2 for 16.
 */
function tallOakSprite(k: 1 | 2, leaf: RGB, trunk: RGB, seed: number): Sprite {
  const rng = new Rng(seed);
  const w = 9 * k;
  const h = 13 * k;
  const cx = Math.floor(w / 2);
  return makeSprite(w + k, h, cx, h - 1, (set) => {
    for (let x = 0; x < 4 * k; x++) set(cx + 1 + x, h - 1, [10, 30, 10], 60); // shadow
    for (let y = 6 * k; y < h - 1; y++) for (let t = 0; t < k; t++) set(cx + t, y, shade(trunk, t ? 0.78 : 1.08)); // trunk
    for (let t = 0; t < 2 * k; t++) {
      set(cx - 1 - Math.floor(t / 2), 6 * k - t, shade(trunk, 1.05)); // branches forking up into the crown
      set(cx + k + Math.floor(t / 2), 6 * k - t, shade(trunk, 0.8));
    }
    const masses: Array<[number, number, number]> = [[cx - 1.6 * k, 3 * k, 2.6 * k], [cx + 1.6 * k, 2.6 * k, 2.4 * k], [cx, 1.8 * k, 2.4 * k]];
    for (const [mx, my, r] of masses) {
      for (let y = Math.floor(my - r); y <= Math.ceil(my + r); y++)
        for (let x = Math.floor(mx - r); x <= Math.ceil(mx + r); x++) {
          const q = (x - mx) ** 2 + (y - my) ** 2;
          if (q > r * r || y < 0) continue;
          const lit = x - mx + (y - my) < -r * 0.5 ? 1.22 : x - mx + (y - my) > r * 0.5 ? 0.74 : 1;
          if (rng.next() < 0.07) continue; // a gap between leaves
          set(x, y, shade(leaf, q > (r - 1) ** 2 ? lit * 0.86 : lit));
        }
    }
  });
}

/** A broad, low broadleaf with a wide round crown and a short thick trunk. */
function broadOakSprite(k: 1 | 2, leaf: RGB, trunk: RGB, seed: number): Sprite {
  const rng = new Rng(seed);
  const r = 4 * k;
  const w = 2 * r + 2;
  const h = 2 * r + 3 * k;
  return makeSprite(w, h, r, h - 1, (set) => {
    for (let x = 0; x < r + 2; x++) set(r + 1 + x, h - 1, [10, 30, 10], 60);
    for (let y = 2 * r - k; y < h - 1; y++) for (let t = -Math.floor(k / 2); t <= Math.floor(k / 2); t++) set(r + t, y, shade(trunk, t < 0 ? 1.08 : 0.86));
    for (let y = 0; y <= 2 * r; y++)
      for (let x = 0; x <= 2 * r; x++) {
        const dx = x - r;
        const dy = (y - r) * 1.15;
        const q = dx * dx + dy * dy;
        if (q > r * r) continue;
        let lit = dx + dy < -r * 0.45 ? 1.2 : dx + dy > r * 0.55 ? 0.72 : 1;
        if (rng.next() < 0.12) lit *= 0.88; // leaf clusters
        set(x, y, shade(leaf, q > (r - 1) ** 2 ? lit * 0.84 : lit));
      }
    for (let n = 0; n < 2 * k; n++) set(Math.floor(r * 0.5 + rng.next() * r * 0.6), Math.floor(r * 0.4 + rng.next() * r * 0.5), shade(leaf, 1.35)); // sunlit
  });
}

/** A palm for the jungle: a curved bare trunk with rings and long drooping fronds. */
function palmSprite(k: 1 | 2): Sprite {
  const w = 11 * k;
  const h = 12 * k;
  const cx = Math.floor(w / 2);
  const leaf: RGB = [44, 140, 64];
  return makeSprite(w, h, cx, h - 1, (set) => {
    for (let x = 0; x < 3 * k; x++) set(cx + 1 + x, h - 1, [10, 30, 10], 60);
    for (let y = 3 * k; y < h - 1; y++) {
      const bend = Math.round(((h - 1 - y) / (h - 3 * k)) * k * 1.4);
      for (let t = 0; t < k; t++) set(cx + bend + t - 1, y, y % (2 * k) === 0 ? [118, 88, 54] : [140, 108, 66]);
    }
    const top = cx + Math.round(k * 1.4) - 1;
    for (const dir of [-1, 1]) {
      for (let j = 0; j < 5 * k; j++) {
        const x = top + dir * j;
        const y = 2 * k + Math.round((j * j) / (5 * k)) - k;
        set(x, y, shade(leaf, dir < 0 ? 1.15 : 0.85));
        set(x, y + 1, shade(leaf, 0.7));
      }
      for (let j = 0; j < 3 * k; j++) set(top + dir * j, 2 * k - j, shade(leaf, 1.1)); // fronds reaching up
    }
    set(top, 2 * k, [96, 70, 40]); // coconuts
    if (k === 2) set(top + 1, 2 * k + 1, [96, 70, 40]);
  });
}

/** A tall narrow spruce: many short tiers, darker, with a pale tip. */
function tallPineSprite(k: 1 | 2, leaf: RGB): Sprite {
  const h = 12 * k;
  const w = 7 * k;
  const cx = Math.floor(w / 2);
  return makeSprite(w, h, cx, h - 1, (set) => {
    const crown = h - 2 * k;
    for (let y = 0; y < crown; y++) {
      const tier = y % (2 * k);
      const half = Math.min(cx, Math.floor((y * cx) / crown) + (tier === 2 * k - 1 ? 1 : 0));
      for (let x = -half; x <= half; x++) set(cx + x, y, shade(leaf, x < 0 ? (tier === 0 ? 1.25 : 1.08) : x === half ? 0.62 : 0.8));
    }
    set(cx, 0, shade(leaf, 1.4));
    for (let y = crown; y < h - 1; y++) set(cx, y, [72, 48, 28]);
    for (let x = 1; x <= 2 * k; x++) set(cx + x, h - 1, [10, 30, 10], 60);
  });
}

/** A tree stump where a tree was felled: a short trunk with a pale cut top showing rings, roots and a few chips. */
function stumpSprite(k: 1 | 2): Sprite {
  return makeSprite(4 * k, 3 * k, 2 * k, 3 * k - 1, (set) => {
    for (let y = k; y < 3 * k; y++) for (let x = k; x < 3 * k; x++) set(x, y, x < 2 * k ? [110, 76, 44] : [86, 58, 34]); // bark
    for (let x = k; x < 3 * k; x++) set(x, k, [214, 180, 128]); // cut top
    if (k === 2) {
      set(3, 2, [176, 140, 96]); // rings
      set(2, 0, [214, 180, 128]);
      set(3, 0, [200, 166, 116]);
    }
    set(0, 3 * k - 1, [96, 64, 38]); // roots
    set(4 * k - 1, 3 * k - 1, [78, 52, 30]);
    set(4 * k - 1, k, [230, 200, 150]); // wood chips
  });
}

/** Conifer: narrow layered triangle. */
function pineSprite(leaf: RGB): Sprite {
  return makeSprite(7, 9, 3, 8, (set) => {
    for (let y = 0; y < 7; y++) {
      const half = Math.floor(y * 0.5) + (y % 3 === 2 ? 1 : 0);
      for (let x = -half; x <= half; x++) set(3 + x, y, shade(leaf, x < 0 ? 1.15 : 0.8));
    }
    set(3, 7, [80, 54, 32]);
    set(3, 8, [64, 42, 26]);
    set(4, 8, [10, 30, 10], 70);
    set(5, 8, [10, 30, 10], 50);
  });
}

/** Acacia: flat crown on a thin trunk. */
function acaciaSprite(): Sprite {
  const leaf: RGB = [96, 128, 52];
  return makeSprite(9, 7, 4, 6, (set) => {
    for (let x = 0; x < 9; x++) set(x, 1, shade(leaf, x < 4 ? 1.1 : 0.88));
    for (let x = 1; x < 8; x++) set(x, 0, shade(leaf, 1.2));
    for (let x = 2; x < 7; x++) set(x, 2, shade(leaf, 0.75));
    set(4, 3, [92, 64, 36]);
    set(4, 4, [92, 64, 36]);
    set(4, 5, [80, 54, 30]);
    set(5, 6, [10, 30, 10], 60);
    set(6, 6, [10, 30, 10], 40);
  });
}

/** Mountain peak: lit west face, shaded east face, optional snow cap. */
function peakSprite(w: number, h: number, snow: boolean, seed: number): Sprite {
  const rock: RGB = [128, 122, 116];
  const rng = new Rng(seed);
  const cx = Math.floor(w / 2);
  return makeSprite(w + 2, h + 1, cx, h - 1, (set) => {
    for (let y = 0; y < h; y++) {
      const half = Math.round((y + 1) * (w / 2) / h);
      for (let x = -half; x <= half; x++) {
        const westFace = x < (y % 4 === 0 ? 1 : 0);
        let c = shade(rock, westFace ? 1.24 : 0.7);
        if (rng.next() < 0.12) c = shade(c, 0.9);
        if (snow && y < h * 0.38 + (x & 1)) c = westFace ? [240, 244, 248] : [196, 206, 220];
        set(cx + x, y, c);
      }
    }
    // Shadow cast to the south-east.
    for (let x = 1; x <= Math.floor(w / 2) + 1; x++) set(cx + x, h, [20, 20, 30], 80);
  });
}

/** A low bush for grassland: darker leaf mass with a lit top edge and a short shadow. */
function bushSprite(leaf: RGB): Sprite {
  return makeSprite(7, 5, 3, 4, (set) => {
    const rows: Array<[number, number]> = [[1, 4], [0, 5], [0, 6], [1, 5]];
    rows.forEach(([a, b], y) => {
      for (let x = a; x <= b; x++) set(x, y, shade(leaf, y === 0 ? 1.25 : x < 3 ? 1.08 : 0.8));
    });
    set(4, 4, [10, 30, 10], 70);
    set(5, 4, [10, 30, 10], 50);
  });
}

/** Reeds for swamps. */
function reedSprite(): Sprite {
  return makeSprite(5, 5, 2, 4, (set) => {
    for (const [x, top] of [[0, 1], [2, 0], [4, 2]] as const) {
      for (let y = top; y < 5; y++) set(x, y, y === top ? [150, 120, 70] : [70, 104, 50]);
    }
  });
}

/** A small cluster of flowers on grass: three blossoms on short stems. */
function flowerSprite(petal: RGB): Sprite {
  return makeSprite(5, 4, 2, 3, (set) => {
    for (const [x, y] of [[0, 1], [2, 0], [4, 1]] as const) {
      set(x, y, petal);
      set(x, y + 1, [62, 120, 50]);
    }
    set(2, 1, [255, 236, 140]);
    set(2, 2, [62, 120, 50]);
  });
}

/** One or two stones with a lit top and a shadow. */
function stoneSprite(base: RGB, pair: boolean): Sprite {
  return makeSprite(5, 3, 2, 2, (set) => {
    set(1, 0, shade(base, 1.25));
    set(2, 0, shade(base, 1.15));
    set(1, 1, base);
    set(2, 1, shade(base, 0.85));
    set(3, 2, [20, 20, 20], 60);
    if (pair) {
      set(4, 1, shade(base, 1.1));
      set(4, 2, shade(base, 0.8));
    }
  });
}

/** A birch: a pale trunk with dark marks under a small, light canopy (scale 1 = 8 px per tile, 2 = 16). */
function birchSprite(k: 1 | 2): Sprite {
  const r = 2 * k;
  const d = r * 2 + 1;
  return makeSprite(d + 2, d + 3 * k, r, d + 3 * k - 1, (set) => {
    for (let y = 0; y < 3 * k; y++) {
      for (let t = 0; t < k; t++) set(r + t, d - 1 + y, y % 3 === 1 ? [60, 56, 52] : [226, 222, 210]);
    }
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y > r * r + r * 0.5) continue;
        const lit = x + y < -r * 0.4 ? 1.2 : x + y > r * 0.6 ? 0.78 : 1;
        set(r + x, r + y, shade([128, 172, 70], lit));
      }
  });
}

/** A fallen log on the forest floor: bark, a pale cut end and a little moss. */
function logSprite(k: 1 | 2): Sprite {
  const w = 5 * k;
  const h = 2 * k;
  return makeSprite(w + 1, h + 1, Math.floor(w / 2), h, (set) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(x, y, y === 0 ? [122, 84, 48] : [92, 62, 36]);
    for (let y = 0; y < h; y++) set(w - 1, y, [196, 160, 112]);
    set(1, 0, [110, 150, 70]);
    if (k === 2) set(2, 0, [110, 150, 70]);
    for (let x = 1; x <= w; x++) set(x, h, [10, 20, 10], 60);
  });
}

/** A few mushrooms: red caps with white dots on pale stems. */
function mushroomSprite(k: 1 | 2): Sprite {
  return makeSprite(4 * k, 3 * k, 2 * k, 3 * k - 1, (set) => {
    for (const [cx, cy] of [[1, 0], [3, 1]] as const) {
      for (let j = 0; j < k; j++) for (let i = -k + 1; i < k + 1; i++) set(cx * k + i, cy * k + j, j === 0 && i === 0 ? [250, 240, 230] : [196, 52, 44]);
      for (let j = k; j < 2 * k; j++) set(cx * k, cy * k + j, [236, 226, 206]);
    }
  });
}

/**
 * A broadleaf tree at 16 px per tile: a canopy of three overlapping leaf masses, lit from the north-west with darker
 * gaps and clusters of highlights, a two-pixel trunk with a root flare, and a soft shadow to the south-east.
 */
function treeSprite16(r: number, leaf: RGB, trunk: RGB, seed: number): Sprite {
  const rng = new Rng(seed);
  const d = r * 2 + 1;
  const w = d + 4;
  const h = d + 6;
  return makeSprite(w, h, r, d + 4, (set) => {
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++) if (x * x + y * y * 3 <= r * r) set(r + 3 + x, d + 3 + Math.round(y * 0.4), [10, 30, 10], 70);
    for (let y = 0; y < 5; y++) {
      set(r, d - 1 + y, shade(trunk, 1.1));
      set(r + 1, d - 1 + y, shade(trunk, 0.8));
    }
    set(r - 1, d + 3, shade(trunk, 0.9));
    set(r + 2, d + 3, shade(trunk, 0.7));
    const blobs: Array<[number, number, number]> = [[0, 1, r * 0.75], [-r * 0.35, -r * 0.3, r * 0.7], [r * 0.35, -r * 0.2, r * 0.65]];
    for (const [bx, by, br] of blobs) {
      for (let y = -r; y <= r; y++)
        for (let x = -r; x <= r; x++) {
          const q = (x - bx) * (x - bx) + (y - by) * (y - by);
          if (q > br * br) continue;
          const edge = q > (br - 1.2) * (br - 1.2);
          const ux = x - bx;
          const uy = y - by;
          let lit = ux + uy < -br * 0.45 ? 1.24 : ux + uy > br * 0.55 ? 0.72 : 1;
          if (edge) lit *= 0.84;
          if (rng.next() < 0.1) lit *= 0.86; // gaps between leaves
          set(r + x, r + y, shade(leaf, lit));
        }
    }
    for (let k2 = 0; k2 < r; k2++) {
      const x = Math.round(-r * 0.6 + rng.next() * r * 0.8);
      const y = Math.round(-r * 0.7 + rng.next() * r * 0.7);
      set(r + x, r + y, shade(leaf, 1.38)); // sunlit clusters
    }
  });
}

/** A conifer at 16 px per tile: tiers of boughs, lit on the west, with a trunk and shadow. */
function pineSprite16(leaf: RGB): Sprite {
  return makeSprite(13, 18, 6, 17, (set) => {
    for (let y = 0; y < 14; y++) {
      const tier = y % 5;
      const half = Math.floor(y * 0.42) + (tier >= 3 ? 1 : 0);
      for (let x = -half; x <= half; x++) set(6 + x, y, shade(leaf, x < 0 ? (tier === 3 ? 1.28 : 1.12) : x === half ? 0.66 : 0.82));
    }
    for (let y = 14; y < 17; y++) {
      set(6, y, [86, 58, 34]);
      set(7, y, [64, 42, 26]);
    }
    for (let x = 7; x <= 11; x++) set(x, 17, [10, 30, 10], 70);
  });
}

/** Nearest-neighbour double size (for small details that read fine at twice the size). */
export function doubleSprite(sp: Sprite): Sprite {
  const w = sp.w * 2;
  const h = sp.h * 2;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((y >> 1) * sp.w + (x >> 1)) * 4;
      const di = (y * w + x) * 4;
      for (let k = 0; k < 4; k++) rgba[di + k] = sp.rgba[si + k];
    }
  }
  return { w, h, ax: sp.ax * 2, ay: sp.ay * 2, rgba };
}

/** Sprite catalogue (drawn at 8 px per tile; halved copies are used at 4 px per tile). */
export const SPRITES = {
  oak: [
    treeSprite(3, [52, 118, 52], [92, 60, 34]), treeSprite(2, [64, 132, 58], [92, 60, 34]), treeSprite(3, [44, 106, 50], [84, 56, 32]),
    tallOakSprite(1, [58, 124, 54], [96, 64, 36], 21), broadOakSprite(1, [48, 112, 48], [88, 58, 32], 22),
  ],
  jungle: [treeSprite(4, [36, 128, 60], [70, 50, 30]), treeSprite(3, [48, 146, 66], [70, 50, 30]), palmSprite(1)],
  pine: [pineSprite([40, 92, 60]), pineSprite([52, 104, 68]), tallPineSprite(1, [34, 84, 56])],
  acacia: [acaciaSprite()],
  /** Ridge-crest peaks (about two tiles wide) and smaller side peaks; snow-capped copies for high or cold ground. */
  peak: [peakSprite(18, 12, false, 1), peakSprite(16, 11, false, 2)],
  smallPeak: [peakSprite(10, 8, false, 5), peakSprite(8, 7, false, 6)],
  snowPeak: [peakSprite(18, 12, true, 3), peakSprite(16, 11, true, 4)],
  smallSnowPeak: [peakSprite(10, 8, true, 7), peakSprite(8, 7, true, 8)],
  reed: [reedSprite()],
  bush: [bushSprite([74, 138, 58]), bushSprite([92, 150, 62])],
  flowers: [flowerSprite([235, 92, 110]), flowerSprite([250, 220, 90]), flowerSprite([170, 140, 235])],
  stones: [stoneSprite([138, 134, 126], false), stoneSprite([150, 144, 132], true)],
  sandStones: [stoneSprite([196, 176, 138], false), stoneSprite([180, 160, 124], true)],
  birch: [birchSprite(1)],
  log: [logSprite(1)],
  mushrooms: [mushroomSprite(1)],
  stump: [stumpSprite(1)],
};

/**
 * The same features drawn natively for 16 px per tile (the finest map level): trees, conifers, peaks and the forest
 * floor details are redrawn at double size with more structure; small details are doubled.
 */
export const SPRITES16: { [K in keyof typeof SPRITES]: Sprite[] } = {
  oak: [
    treeSprite16(7, [52, 118, 52], [92, 60, 34], 11), treeSprite16(5, [64, 132, 58], [92, 60, 34], 12), treeSprite16(7, [44, 106, 50], [84, 56, 32], 13),
    tallOakSprite(2, [58, 124, 54], [96, 64, 36], 21), broadOakSprite(2, [48, 112, 48], [88, 58, 32], 22),
  ],
  jungle: [treeSprite16(9, [36, 128, 60], [70, 50, 30], 14), treeSprite16(7, [48, 146, 66], [70, 50, 30], 15), palmSprite(2)],
  pine: [pineSprite16([40, 92, 60]), pineSprite16([52, 104, 68]), tallPineSprite(2, [34, 84, 56])],
  acacia: SPRITES.acacia.map(doubleSprite),
  peak: [peakSprite(36, 24, false, 1), peakSprite(32, 22, false, 2)],
  smallPeak: [peakSprite(20, 16, false, 5), peakSprite(16, 14, false, 6)],
  snowPeak: [peakSprite(36, 24, true, 3), peakSprite(32, 22, true, 4)],
  smallSnowPeak: [peakSprite(20, 16, true, 7), peakSprite(16, 14, true, 8)],
  reed: SPRITES.reed.map(doubleSprite),
  bush: SPRITES.bush.map(doubleSprite),
  flowers: SPRITES.flowers.map(doubleSprite),
  stones: SPRITES.stones.map(doubleSprite),
  sandStones: SPRITES.sandStones.map(doubleSprite),
  birch: [birchSprite(2)],
  log: [logSprite(2)],
  mushrooms: [mushroomSprite(2)],
  stump: [stumpSprite(2)],
};

/** Half-resolution copy (2×2 box filter with alpha weighting) for 4-px-per-tile chunks. */
export function halfSprite(sp: Sprite): Sprite {
  const w = Math.ceil(sp.w / 2);
  const h = Math.ceil(sp.h / 2);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const sx = x * 2 + dx;
          const sy = y * 2 + dy;
          if (sx >= sp.w || sy >= sp.h) continue;
          const o = (sy * sp.w + sx) * 4;
          const al = sp.rgba[o + 3];
          r += sp.rgba[o] * al;
          g += sp.rgba[o + 1] * al;
          b += sp.rgba[o + 2] * al;
          a += al;
        }
      }
      const o = (y * w + x) * 4;
      if (a > 0) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
        out[o + 3] = a / 4;
      }
    }
  }
  return { w, h, ax: Math.floor(sp.ax / 2), ay: Math.floor(sp.ay / 2), rgba: out };
}
