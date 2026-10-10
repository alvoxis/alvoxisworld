import { describe, expect, it } from 'vitest';
import { TerrainPainter } from '../src/render/painter';
import { Tileset } from '../src/render/tileset';
import { generateWorld } from '../src/world/generator';
import { T } from '../src/world/terrain';
import { CHUNK, World } from '../src/world/world';

const tiles = new Tileset();
const opts = { winter: false, passOverlay: false };

function paint(world: World, cx: number, cy: number, P: 8 | 4, o = opts): Uint8ClampedArray {
  const out = new Uint8ClampedArray(CHUNK * P * CHUNK * P * 4);
  new TerrainPainter(tiles).paintChunk(world, cx, cy, P, out, o);
  return out;
}

/** RGB at the centre of tile (tx, ty) of chunk (cx, cy). */
function centre(out: Uint8ClampedArray, P: number, cx: number, cy: number, tx: number, ty: number): [number, number, number] {
  const lx = tx - cx * CHUNK;
  const ly = ty - cy * CHUNK;
  const o = ((ly * P + P / 2) * CHUNK * P + lx * P + P / 2) * 4;
  return [out[o], out[o + 1], out[o + 2]];
}

describe('terrain painter', () => {
  const world = generateWorld(256, 160, 31);

  it('is deterministic and fills every pixel', () => {
    for (const P of [8, 4] as const) {
      const a = paint(world, 3, 2, P);
      const b = paint(world, 3, 2, P);
      expect(a).toEqual(b);
      for (let i = 3; i < a.length; i += 4) expect(a[i]).toBe(255);
    }
  });

  it('keeps rivers where they are: every river tile centre is drawn as water', () => {
    let checked = 0;
    for (let cy = 0; cy < world.chunksY; cy++) {
      for (let cx = 0; cx < world.chunksX; cx++) {
        const out = paint(world, cx, cy, 8);
        for (let ty = cy * CHUNK; ty < Math.min(world.height, (cy + 1) * CHUNK); ty++) {
          for (let tx = cx * CHUNK; tx < Math.min(world.width, (cx + 1) * CHUNK); tx++) {
            if (world.terrain[ty * world.width + tx] !== T.RIVER) continue;
            const [r, g, b] = centre(out, 8, cx, cy, tx, ty);
            expect(b).toBeGreaterThan(r + 40);
            expect(b).toBeGreaterThan(g * 0.9);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('shades the sea by depth: deep water is darker than the shallows', () => {
    const w = new World(64, 64, 2);
    for (let i = 0; i < w.terrain.length; i++) {
      const x = i % 64;
      w.terrain[i] = x < 32 ? T.SHALLOW_WATER : T.DEEP_WATER;
      w.heights[i] = Math.max(10, 108 - x * 3); // deeper to the east
    }
    const out = paint(w, 0, 0, 8);
    const shallow = centre(out, 8, 0, 0, 2, 10);
    const deep = centre(out, 8, 0, 0, 30, 10);
    expect(shallow[0] + shallow[1] + shallow[2]).toBeGreaterThan(deep[0] + deep[1] + deep[2] + 60);
  });

  it('the passability overlay only changes pixels near mountains, snow, steep ground and cliffs', () => {
    let cx = -1;
    let cy = -1;
    for (let i = 0; i < world.terrain.length && cx < 0; i++) {
      if (world.terrain[i] === T.MOUNTAIN) {
        cx = Math.floor((i % world.width) / CHUNK);
        cy = Math.floor(Math.floor(i / world.width) / CHUNK);
      }
    }
    expect(cx).toBeGreaterThanOrEqual(0);
    const plain = paint(world, cx, cy, 8);
    const marked = paint(world, cx, cy, 8, { winter: false, passOverlay: true });
    let changed = 0;
    for (let p = 0; p < plain.length; p += 4) {
      if (plain[p] === marked[p] && plain[p + 1] === marked[p + 1] && plain[p + 2] === marked[p + 2]) continue;
      changed++;
      const px = (p / 4) % (CHUNK * 8);
      const py = Math.floor(p / 4 / (CHUNK * 8));
      const tx = cx * CHUNK + Math.floor(px / 8);
      const ty = cy * CHUNK + Math.floor(py / 8);
      let near = false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = Math.min(world.width - 1, Math.max(0, tx + dx));
          const y = Math.min(world.height - 1, Math.max(0, ty + dy));
          const k = y * world.width + x;
          const id = world.terrain[k];
          if (id === T.MOUNTAIN || id === T.SNOW || world.slopeClass[k] > 0) near = true;
        }
      }
      expect(near).toBe(true);
    }
    expect(changed).toBeGreaterThan(0);
  });

  it('frosts cold land in winter but not water', () => {
    const w = new World(32, 32, 3);
    for (let i = 0; i < w.terrain.length; i++) {
      w.terrain[i] = i % 32 < 16 ? T.GRASS : T.SHALLOW_WATER;
      w.heights[i] = i % 32 < 16 ? 130 : 100;
      w.temperature[i] = 40;
    }
    const summer = paint(w, 0, 0, 4);
    const winter = paint(w, 0, 0, 4, { winter: true, passOverlay: false });
    const land = (a: Uint8ClampedArray) => centre(a, 4, 0, 0, 4, 4);
    const sea = (a: Uint8ClampedArray) => centre(a, 4, 0, 0, 28, 4);
    expect(land(winter)[2]).toBeGreaterThan(land(summer)[2] + 30); // whiter
    expect(sea(winter)).toEqual(sea(summer));
  });
});
