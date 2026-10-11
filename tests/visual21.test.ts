import { describe, expect, it } from 'vitest';
import { FINE_PX, FINE_VARIANTS, makeFineGround } from '../src/render/groundart';
import { TerrainPainter, type ChunkPx } from '../src/render/painter';
import { DETAIL_SCALE, FINE_SCALE, MID_SCALE, terrainLevel } from '../src/render/renderer';
import { SPRITES, SPRITES16, Tileset } from '../src/render/tileset';
import { applyHeightBrush } from '../src/world/brush';
import { generateWorld } from '../src/world/generator';
import { T, TERRAIN, TERRAIN_COUNT } from '../src/world/terrain';
import { CHUNK, World } from '../src/world/world';

const tiles = new Tileset();
const opts = { winter: false, passOverlay: false };

function paint(world: World, cx: number, cy: number, P: ChunkPx, painter = new TerrainPainter(tiles)): Uint8ClampedArray {
  const out = new Uint8ClampedArray(CHUNK * P * CHUNK * P * 4);
  painter.paintChunk(world, cx, cy, P, out, opts);
  return out;
}

describe('v0.21 close-up ground art', () => {
  const art = makeFineGround();

  it('covers every terrain with distinct variants that keep the terrain colour', () => {
    const tile = FINE_PX * FINE_PX * 4;
    expect(art.length).toBe(TERRAIN_COUNT * FINE_VARIANTS * tile);
    for (let id = 0; id < TERRAIN_COUNT; id++) {
      const base = TERRAIN[id].color;
      const variants: string[] = [];
      for (let v = 0; v < FINE_VARIANTS; v++) {
        const off = (id * FINE_VARIANTS + v) * tile;
        const sum = [0, 0, 0];
        for (let i = 0; i < tile; i += 4) {
          expect(art[off + i + 3]).toBe(255);
          for (let k = 0; k < 3; k++) sum[k] += art[off + i + k];
        }
        // On average the art stays near its terrain's colour, so lighting, frost and depth tints still read right.
        for (let k = 0; k < 3; k++) expect(Math.abs(sum[k] / (FINE_PX * FINE_PX) - base[k])).toBeLessThan(28);
        variants.push(art.slice(off, off + tile).join(','));
      }
      expect(new Set(variants).size).toBe(FINE_VARIANTS);
    }
  });

  it('is deterministic', () => {
    expect(makeFineGround()).toEqual(art);
  });

  it('has a 16-px copy of every feature sprite', () => {
    for (const key of Object.keys(SPRITES) as (keyof typeof SPRITES)[]) {
      expect(SPRITES16[key].length).toBeGreaterThan(0);
      for (const sp of SPRITES16[key]) expect(sp.w).toBeGreaterThan(0);
    }
  });
});

describe('v0.21 16-px chunk painting', () => {
  const world = generateWorld(256, 160, 77);

  it('fills every pixel deterministically and adds detail beyond the 8-px level', () => {
    const a = paint(world, 2, 2, 16);
    expect(paint(world, 2, 2, 16)).toEqual(a);
    for (let i = 3; i < a.length; i += 4) expect(a[i]).toBe(255);
    // Compare with the 8-px chunk scaled up: the fine level must show more than a blow-up.
    const b = paint(world, 2, 2, 8);
    let differ = 0;
    const S = CHUNK * 16;
    for (let y = 0; y < S; y += 3) {
      for (let x = 0; x < S; x += 3) {
        const o = (y * S + x) * 4;
        const q = ((y >> 1) * (S >> 1) + (x >> 1)) * 4;
        if (Math.abs(a[o] - b[q]) + Math.abs(a[o + 1] - b[q + 1]) + Math.abs(a[o + 2] - b[q + 2]) > 24) differ++;
      }
    }
    expect(differ).toBeGreaterThan(500);
  });

  it('painting in row bands gives exactly the same chunk as one full paint', () => {
    const painter = new TerrainPainter(tiles);
    for (const c of [[1, 1], [3, 2], [5, 4]] as const) {
      const full = paint(world, c[0], c[1], 16, painter);
      const banded = new Uint8ClampedArray(full.length);
      for (let r = 0; r < CHUNK; r += CHUNK / 4) painter.paintChunk(world, c[0], c[1], 16, banded, opts, r, r + CHUNK / 4);
      expect(banded).toEqual(full);
    }
  });

  it('a terrain edit marks only the chunks near the brush dirty and changes the repaint', () => {
    const w = generateWorld(256, 160, 77);
    w.dirtyChunks.clear();
    const before = paint(w, 3, 2, 16);
    applyHeightBrush(w, { x: 3 * CHUNK + 16, y: 2 * CHUNK + 16, radius: 4, strength: 10 }, 1);
    expect(w.dirtyChunks.has(2 * w.chunksX + 3)).toBe(true);
    expect(w.dirtyChunks.size).toBeLessThanOrEqual(4);
    expect(w.dirtyChunks.has(0)).toBe(false);
    expect(paint(w, 3, 2, 16)).not.toEqual(before);
  });

  it('raised land shades smoothly instead of forming a flat slab', () => {
    const w = new World(64, 64, 5);
    w.terrain.fill(T.GRASS);
    w.heights.fill(140);
    for (let i = 0; i < 6; i++) applyHeightBrush(w, { x: 32, y: 32, radius: 8, strength: 10 }, 1);
    const out = paint(w, 1, 1, 16);
    const S = CHUNK * 16;
    // Sample a line through the raised hill: the shading must vary across it.
    const seen = new Set<number>();
    for (let x = 0; x < 16 * 16; x += 8) {
      const o = (0 * S + x) * 4;
      seen.add((out[o] >> 3) * 1024 + (out[o + 1] >> 3) * 32 + (out[o + 2] >> 3));
    }
    expect(seen.size).toBeGreaterThan(6);
  });
});

describe('v0.21 zoom levels', () => {
  it('uses 16-px art up close, 8 and 4 px further out, and the base map far away', () => {
    const q = { lowRes: false };
    expect(terrainLevel(FINE_SCALE, q)).toBe(16);
    expect(terrainLevel(FINE_SCALE - 0.1, q)).toBe(8);
    expect(terrainLevel(DETAIL_SCALE, q)).toBe(8);
    expect(terrainLevel(MID_SCALE, q)).toBe(4);
    expect(terrainLevel(MID_SCALE - 0.1, q)).toBe(0);
  });

  it('low-resolution quality never uses the 16-px level', () => {
    expect(terrainLevel(64, { lowRes: true })).toBe(8);
  });
});
