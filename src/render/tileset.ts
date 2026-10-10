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
  /** RGBA for every (terrain, variant): index ((id * VARIANTS + v) * 64 + py * 8 + px) * 4. */
  readonly pixels = new Uint8ClampedArray(TERRAIN_COUNT * VARIANTS * TILE_BYTES);

  constructor(seed = 1337) {
    const rng = new Rng(seed);
    for (let id = 0; id < TERRAIN_COUNT; id++) {
      for (let v = 0; v < VARIANTS; v++) this.draw(id, v, rng);
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
      case T.SAND:
        fill(base, 0.06);
        speckle(shade(base, 0.85), 4);
        speckle(shade(base, 1.08), 3);
        break;
      case T.GRASS:
        fill(base, 0.08);
        for (let k = 0; k < 5; k++) {
          const x = rng.int(0, 7);
          const y = rng.int(1, 7);
          set(x, y, shade(base, 0.78));
          set(x, y - 1, shade(base, 1.18));
        }
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

/** 8×8 creature sprites drawn in code, facing right. */
export function creatureSprite(species: number): HTMLCanvasElement {
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
