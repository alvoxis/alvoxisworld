/**
 * Close-up ground art: every terrain drawn natively at 16×16 pixels per tile (twice the map's normal 8), so close
 * zoom shows real material detail instead of enlarged pixels. Used by the painter's finest level only; normal and
 * far zoom keep the 8- and 4-pixel art. Deterministic, original and DOM-free (plain RGBA), so it can be tested.
 *
 * Every tile keeps its terrain's base colour on average (the painter derives water ripples and lighting from that),
 * and uses tileable noise (period = one tile) so neighbouring tiles join without seams. Features that stand above
 * the ground (trees, peaks, reeds) are separate sprites; here forest, jungle, savanna, hills and mountains get the
 * bare ground under them.
 *
 * Art direction (shared with the sprites): light from the north-west, highlights a step lighter and shadows a step
 * darker than the base, small clusters of 2–3 pixels instead of single-pixel noise, and a restrained palette per
 * material.
 */
import { Rng } from '../core/rng';
import { T, TERRAIN, TERRAIN_COUNT } from '../world/terrain';

export const FINE_PX = 16;
export const FINE_VARIANTS = 4;
const BYTES = FINE_PX * FINE_PX * 4;

type RGB = readonly [number, number, number];
const shade = (c: RGB, f: number): RGB => [c[0] * f, c[1] * f, c[2] * f];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Smooth value noise with period 16 on both axes (tiles seamlessly), 0..1. */
function periodicNoise(rng: Rng, cells: number): (x: number, y: number) => number {
  const lat = Float32Array.from({ length: cells * cells }, () => rng.next());
  const step = FINE_PX / cells;
  const s = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const gx = x / step;
    const gy = y / step;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const at = (i: number, j: number) => lat[((j + cells) % cells) * cells + ((i + cells) % cells)];
    const tx = s(gx - x0);
    const ty = s(gy - y0);
    return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
  };
}

/** Ground art for the finest level: index ((id * FINE_VARIANTS + v) * 256 + y * 16 + x) * 4. */
export function makeFineGround(seed = 0x4f1bbcdc): Uint8ClampedArray {
  const out = new Uint8ClampedArray(TERRAIN_COUNT * FINE_VARIANTS * BYTES);
  const rng = new Rng(seed);
  for (let id = 0; id < TERRAIN_COUNT; id++) for (let v = 0; v < FINE_VARIANTS; v++) drawTile(out, id, v, rng);
  return out;
}

function drawTile(out: Uint8ClampedArray, id: number, v: number, rng: Rng): void {
  const off = (id * FINE_VARIANTS + v) * BYTES;
  const set = (x: number, y: number, c: RGB) => {
    const xx = ((x % FINE_PX) + FINE_PX) % FINE_PX; // wraps, so details crossing an edge continue on the next tile
    const yy = ((y % FINE_PX) + FINE_PX) % FINE_PX;
    const o = off + (yy * FINE_PX + xx) * 4;
    out[o] = c[0];
    out[o + 1] = c[1];
    out[o + 2] = c[2];
    out[o + 3] = 255;
  };
  const get = (x: number, y: number): RGB => {
    const o = off + ((((y % 16) + 16) % 16) * FINE_PX + (((x % 16) + 16) % 16)) * 4;
    return [out[o], out[o + 1], out[o + 2]];
  };
  /** Base fill: the colour modulated by soft noise (amplitude ±amp) and a little fine grain. */
  const base = (c: RGB, amp: number, cells = 4) => {
    const n = periodicNoise(rng, cells);
    for (let y = 0; y < FINE_PX; y++) {
      for (let x = 0; x < FINE_PX; x++) set(x, y, shade(c, 1 + (n(x, y) - 0.5) * 2 * amp + (rng.next() - 0.5) * 0.04));
    }
  };
  const rnd = (a: number, b: number) => rng.int(a, b);
  /** A grass blade: dark root, mid stem, light tip, leaning a little. */
  const blade = (x: number, y: number, c: RGB, h: number) => {
    const lean = rng.next() < 0.5 ? -1 : 1;
    set(x, y, shade(c, 0.72));
    for (let k = 1; k < h; k++) set(x + (k === h - 1 ? lean : 0), y - k, shade(c, k === h - 1 ? 1.24 : 1.06));
  };
  /** A stone: lit top-left, dark bottom-right, with a soft shadow. */
  const stone = (x: number, y: number, w: number, h: number, c: RGB) => {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const edge = i === 0 || j === 0 ? 1.2 : i === w - 1 || j === h - 1 ? 0.78 : 1;
        set(x + i, y + j, shade(c, edge));
      }
    }
    for (let i = 1; i <= w; i++) set(x + i, y + h, shade(get(x + i, y + h), 0.82));
  };
  const color = TERRAIN[id].color as RGB;
  const GRASS = TERRAIN[T.GRASS].color as RGB;

  switch (id) {
    case T.GRASS: {
      base(color, 0.07);
      for (let k = 0; k < 18 + v * 3; k++) blade(rnd(0, 15), rnd(2, 15), shade(color, 0.95 + rng.next() * 0.12), 2 + rnd(0, 1));
      if (v === 2) for (const [dx, dy] of [[0, 0], [1, 1], [-1, 1]]) set(9 + dx, 6 + dy, [128, 186, 92]); // clover
      break;
    }
    case T.FOREST: {
      // Forest floor: darker grass with leaf litter, a twig and a little moss.
      base(shade(color, 0.92), 0.1);
      const leaves: RGB[] = [[96, 86, 44], [112, 100, 50], [70, 108, 46], [74, 64, 36]];
      for (let k = 0; k < 14; k++) {
        const x = rnd(0, 15);
        const y = rnd(0, 15);
        const c = leaves[rnd(0, 3)];
        set(x, y, c);
        set(x + 1, y, shade(c, 0.85));
      }
      if (v & 1) for (let k = 0; k < 5; k++) set(3 + k, 10 - (k >> 1), [96, 70, 42]); // twig
      for (let k = 0; k < 3; k++) set(rnd(0, 15), rnd(0, 15), [118, 160, 72]); // moss
      break;
    }
    case T.JUNGLE: {
      base(shade(color, 0.85), 0.1);
      for (let k = 0; k < 6; k++) {
        const x = rnd(0, 15);
        const y = rnd(3, 15);
        for (let j = 0; j < 3; j++) {
          set(x - j, y - j, shade(color, 1.05 + j * 0.1)); // fern fronds
          set(x + j, y - j, shade(color, 1 + j * 0.1));
        }
      }
      break;
    }
    case T.SAVANNA: {
      base(color, 0.08);
      for (let k = 0; k < 14; k++) blade(rnd(0, 15), rnd(2, 15), shade(color, 0.9 + rng.next() * 0.2), 2 + rnd(0, 1));
      for (let k = 0; k < 2; k++) {
        const x = rnd(0, 14);
        const y = rnd(0, 14);
        set(x, y, [168, 136, 84]);
        set(x + 1, y, [156, 124, 76]); // bare patches
      }
      break;
    }
    case T.SAND: {
      // Sand: wind ripples (soft light and dark bands) and grains.
      const n = periodicNoise(rng, 2);
      for (let y = 0; y < FINE_PX; y++) {
        for (let x = 0; x < FINE_PX; x++) {
          const band = Math.sin(((y + n(x, y) * 3 + v) / 16) * Math.PI * 2 * 3);
          set(x, y, shade(color, 1 + band * 0.035 + (rng.next() - 0.5) * 0.04));
        }
      }
      for (let k = 0; k < 6; k++) set(rnd(0, 15), rnd(0, 15), shade(color, rng.next() < 0.5 ? 0.86 : 1.1));
      break;
    }
    case T.DESERT: {
      // Desert: broad dunes with a lit and a shaded side, a few pebbles.
      for (let y = 0; y < FINE_PX; y++) {
        for (let x = 0; x < FINE_PX; x++) {
          const dune = Math.sin(((x * 0.6 + y + v * 4) / 16) * Math.PI * 2);
          set(x, y, shade(color, 1 + dune * 0.06 + (rng.next() - 0.5) * 0.03));
        }
      }
      if (v < 2) stone(rnd(2, 12), rnd(2, 12), 2, 1, [150, 120, 84]);
      break;
    }
    case T.SOIL: {
      // Earth: clods with lit tops, a crack, small stones and the odd sprout.
      base(color, 0.12);
      for (let k = 0; k < 6; k++) {
        const x = rnd(0, 14);
        const y = rnd(0, 14);
        set(x, y, shade(color, 1.18));
        set(x + 1, y, shade(color, 1.1));
        set(x, y + 1, shade(color, 0.78));
        set(x + 1, y + 1, shade(color, 0.72));
      }
      let cx = rnd(0, 15);
      for (let y = 0; y < 16; y += 1) {
        set(cx, y, shade(color, 0.66));
        if (rng.next() < 0.4) cx += rng.next() < 0.5 ? -1 : 1;
      }
      stone(rnd(1, 12), rnd(1, 12), 2, 1, [140, 132, 120]);
      if (v === 3) blade(rnd(2, 13), rnd(6, 14), GRASS, 3);
      break;
    }
    case T.SWAMP: {
      base(color, 0.12);
      for (let k = 0; k < 2; k++) {
        const cx = rnd(3, 12);
        const cy = rnd(3, 12);
        const rx = 2 + rnd(0, 2);
        for (let y = -2; y <= 2; y++)
          for (let x = -rx; x <= rx; x++) {
            if ((x * x) / (rx * rx) + (y * y) / 4 > 1) continue;
            set(cx + x, cy + y, y === -2 || (y < 0 && Math.abs(x) === rx) ? [92, 132, 132] : [58, 90, 96]); // puddle, lit rim
          }
      }
      for (let k = 0; k < 6; k++) set(rnd(0, 15), rnd(0, 15), [52, 84, 42]);
      break;
    }
    case T.TUNDRA: {
      base(color, 0.08);
      for (let k = 0; k < 4; k++) {
        const x = rnd(0, 14);
        const y = rnd(0, 14);
        const lichen: RGB = rng.next() < 0.5 ? [188, 196, 150] : [168, 180, 128];
        set(x, y, lichen);
        set(x + 1, y, lichen);
        set(x, y + 1, shade(lichen, 0.9));
      }
      stone(rnd(1, 12), rnd(1, 12), 2, 2, [150, 150, 146]);
      break;
    }
    case T.SNOW: {
      // Snow: soft drifts with blue shadows on the south-east side, a few sparkles.
      const n = periodicNoise(rng, 4);
      for (let y = 0; y < FINE_PX; y++) {
        for (let x = 0; x < FINE_PX; x++) {
          const a = n(x, y);
          const b = n(x - 1, y - 1);
          const c = b > a + 0.05 ? mix(color, [180, 198, 226], 0.55) : b < a - 0.05 ? shade(color, 1.04) : shade(color, 0.96 + a * 0.06);
          set(x, y, c);
        }
      }
      for (let k = 0; k < 3; k++) set(rnd(0, 15), rnd(0, 15), [255, 255, 255]);
      break;
    }
    case T.HILLS: {
      // Hills: short grass with outcrops of rock.
      base([104, 138, 70], 0.09);
      for (let k = 0; k < 10; k++) blade(rnd(0, 15), rnd(2, 15), [104, 138, 70], 2);
      stone(rnd(1, 10), rnd(2, 10), 3 + (v & 1), 2, [148, 144, 128]);
      if (v > 1) stone(rnd(1, 12), rnd(2, 12), 2, 1, [138, 134, 120]);
      break;
    }
    case T.MOUNTAIN: {
      // Rock: strata (slanted light and dark bands), a crack and lit facets.
      const rock = shade(color, 0.92);
      for (let y = 0; y < FINE_PX; y++) {
        for (let x = 0; x < FINE_PX; x++) {
          const layer = Math.sin(((y + x * 0.35 + v * 3) / 16) * Math.PI * 2 * 2);
          set(x, y, shade(rock, 1 + layer * 0.06 + (rng.next() - 0.5) * 0.05));
        }
      }
      let cx = rnd(2, 13);
      for (let y = rnd(0, 4); y < 14; y++) {
        set(cx, y, shade(rock, 0.68));
        set(cx + 1, y, shade(rock, 1.14));
        if (rng.next() < 0.35) cx += rng.next() < 0.5 ? -1 : 1;
      }
      break;
    }
    case T.SHALLOW_WATER:
    case T.DEEP_WATER:
    case T.LAKE: {
      // Water: calm surface with a few soft wave crests (light line over a darker trough).
      base(color, 0.03, 2);
      for (let k = 0; k < (id === T.LAKE ? 1 : 2) + (v & 1); k++) {
        const x = rnd(0, 12);
        const y = rnd(2, 14);
        for (let i = 0; i < 4; i++) {
          set(x + i, y - (i === 1 || i === 2 ? 1 : 0), shade(color, 1.16));
          set(x + i, y + 1 - (i === 1 || i === 2 ? 1 : 0), shade(color, 0.93));
        }
      }
      break;
    }
    case T.RIVER: {
      // Running water: bright flow streaks along the current.
      base(color, 0.03, 2);
      for (let k = 0; k < 4; k++) {
        const x = (v * 4 + k * 5) % 16;
        const y = (k * 4 + v) % 16;
        for (let i = 0; i < 3; i++) set(x + i, y + i, shade(color, 1.22));
      }
      break;
    }
    default:
      base(color, 0.05);
  }
}
