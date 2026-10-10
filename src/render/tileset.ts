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

type PixelArt = { rows: readonly string[]; palette: Record<string, string> };

/**
 * Original pixel-art sprites as character maps (one char = one pixel, '.' = clear),
 * facing right. Sprite pixels are 1/8 of a tile, the same scale as terrain pixels.
 */
const PIXEL_ART: Record<number, PixelArt> = {
  2: {
    // Hadrosaur: crested plant-eater, 12×12 (1.5 tiles).
    rows: [
      '..........c.',
      '.........cc.',
      '........gggg',
      '........gegg',
      '.......ggg..',
      'd.....gggg..',
      'ddgggggggg..',
      '.dggggggggg.',
      '..gbbbbbbgg.',
      '...l....l...',
      '...l....l...',
      '..ll...ll...',
    ],
    palette: { g: '#6f8f4a', d: '#4e6a33', b: '#a9b979', c: '#c8643a', e: '#111111', l: '#3f5528' },
  },
  3: {
    // Tyrant: big two-legged predator, 14×14 (1.75 tiles).
    rows: [
      '.........rrrr.',
      '........rrrerr',
      '........rrrrrr',
      '........rrttt.',
      '........rrrr..',
      '.......rrr....',
      'd.....rrrr.a..',
      'dd..rrrrrrra..',
      '.ddrrrrrrrr...',
      '..drrrbbbrr...',
      '....rrbbrr....',
      '.....d...d....',
      '.....d...d....',
      '....dd..dd....',
    ],
    palette: { r: '#7a3b2a', d: '#552618', b: '#b0705a', t: '#f2efe6', e: '#f2c14e', a: '#6a3022' },
  },
  4: {
    // Fish, 6×6 (0.75 tiles).
    rows: ['......', '.d.ss.', 'ddsses', 'ddssss', '.d.ss.', '......'],
    palette: { s: '#9fc4d8', d: '#5f8fae', e: '#102030' },
  },
};

/** Creature sprites drawn in code, facing right. */
export function creatureSprite(species: number): HTMLCanvasElement {
  const art = PIXEL_ART[species];
  if (art) {
    const c = document.createElement('canvas');
    c.width = art.rows[0].length;
    c.height = art.rows.length;
    const ctx = c.getContext('2d')!;
    art.rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const color = art.palette[row[x]];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      }
    });
    return c;
  }
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 8;
  const ctx = c.getContext('2d')!;
  const px = (x: number, y: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
  };
  if (species === 0) {
    // Grazer: woolly body, dark head, legs.
    const body = '#efe6cf';
    for (let y = 3; y <= 5; y++) for (let x = 1; x <= 5; x++) px(x, y, body);
    px(1, 3, '#d8cdb2');
    px(6, 3, '#3a2e26');
    px(6, 4, '#3a2e26');
    px(7, 4, '#3a2e26');
    px(2, 6, '#3a2e26');
    px(5, 6, '#3a2e26');
  } else {
    // Raptor: lean reptile with a tail.
    const body = '#c8502e';
    px(0, 4, body);
    px(1, 4, body);
    for (let x = 2; x <= 5; x++) px(x, 3, body);
    for (let x = 2; x <= 4; x++) px(x, 4, '#e07a46');
    px(5, 2, body);
    px(6, 2, body);
    px(7, 2, '#f4d2a0');
    px(6, 1, '#1a1a1a');
    px(3, 5, '#7a2c18');
    px(3, 6, '#7a2c18');
    px(5, 5, '#7a2c18');
    px(5, 6, '#7a2c18');
  }
  return c;
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

/** Reeds for swamps. */
function reedSprite(): Sprite {
  return makeSprite(5, 5, 2, 4, (set) => {
    for (const [x, top] of [[0, 1], [2, 0], [4, 2]] as const) {
      for (let y = top; y < 5; y++) set(x, y, y === top ? [150, 120, 70] : [70, 104, 50]);
    }
  });
}

/** Sprite catalogue (drawn at 8 px per tile; halved copies are used at 4 px per tile). */
export const SPRITES = {
  oak: [treeSprite(3, [52, 118, 52], [92, 60, 34]), treeSprite(2, [64, 132, 58], [92, 60, 34]), treeSprite(3, [44, 106, 50], [84, 56, 32])],
  jungle: [treeSprite(4, [36, 128, 60], [70, 50, 30]), treeSprite(3, [48, 146, 66], [70, 50, 30])],
  pine: [pineSprite([40, 92, 60]), pineSprite([52, 104, 68])],
  acacia: [acaciaSprite()],
  /** Ridge-crest peaks (about two tiles wide) and smaller side peaks; snow-capped copies for high or cold ground. */
  peak: [peakSprite(18, 12, false, 1), peakSprite(16, 11, false, 2)],
  smallPeak: [peakSprite(10, 8, false, 5), peakSprite(8, 7, false, 6)],
  snowPeak: [peakSprite(18, 12, true, 3), peakSprite(16, 11, true, 4)],
  smallSnowPeak: [peakSprite(10, 8, true, 7), peakSprite(8, 7, true, 8)],
  reed: [reedSprite()],
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
