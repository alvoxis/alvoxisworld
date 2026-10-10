import { describe, expect, it } from 'vitest';
import { Simplex2 } from '../src/core/noise';
import { Rng, seedFromString } from '../src/core/rng';
import { applyHeightBrush, applyPaintBrush, applySmoothBrush } from '../src/world/brush';
import { generateWorld } from '../src/world/generator';
import { SEA_LEVEL, T, TERRAIN, classify, isWater } from '../src/world/terrain';

describe('rng & noise', () => {
  it('is deterministic per seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
  });

  it('noise stays roughly within [-1, 1]', () => {
    const n = new Simplex2(7);
    for (let i = 0; i < 2000; i++) {
      const v = n.fbm(i * 0.37, i * 0.11, 4);
      expect(Math.abs(v)).toBeLessThanOrEqual(1.05);
    }
  });

  it('maps text seeds to stable numbers', () => {
    expect(seedFromString('123')).toBe(123);
    expect(seedFromString('dinosaurs')).toBe(seedFromString(' dinosaurs '));
  });
});

describe('world generation', () => {
  it('is deterministic for the same seed', () => {
    const a = generateWorld(128, 80, 99);
    const b = generateWorld(128, 80, 99);
    expect(a.terrain).toEqual(b.terrain);
    expect(a.heights).toEqual(b.heights);
  });

  it('produces both land and ocean with several biomes', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const w = generateWorld(256, 160, seed);
      const land = w.landShare();
      expect(land).toBeGreaterThan(0.15);
      expect(land).toBeLessThan(0.8);
      const counts = w.terrainCounts();
      const biomes = TERRAIN.filter((t) => !t.water && counts[t.id] > 0).length;
      expect(biomes).toBeGreaterThanOrEqual(5);
    }
  });

  it('keeps the map border as water', () => {
    const w = generateWorld(200, 120, 11);
    for (let x = 0; x < w.width; x++) {
      expect(isWater(w.terrainAt(x, 0))).toBe(true);
      expect(isWater(w.terrainAt(x, w.height - 1))).toBe(true);
    }
  });

  it('classifies by height and climate', () => {
    expect(classify(10, 0.5, 0.5)).toBe(T.DEEP_WATER);
    expect(classify(SEA_LEVEL - 1, 0.5, 0.5)).toBe(T.SHALLOW_WATER);
    expect(classify(250, 0.9, 0.5)).toBe(T.SNOW);
    expect(classify(SEA_LEVEL + 20, 0.9, 0.05)).toBe(T.DESERT);
    expect(classify(SEA_LEVEL + 20, 0.9, 0.9)).toBe(T.JUNGLE);
    expect(classify(SEA_LEVEL + 40, 0.5, 0.35)).toBe(T.GRASS);
  });
});

describe('brushes', () => {
  it('raise turns ocean into land and lower turns it back', () => {
    const w = generateWorld(64, 64, 5);
    // Border tiles are ocean.
    expect(w.isWaterAt(3, 3)).toBe(true);
    for (let k = 0; k < 60; k++) applyHeightBrush(w, { x: 3.5, y: 3.5, radius: 2 }, 1);
    expect(w.isWaterAt(3, 3)).toBe(false);
    for (let k = 0; k < 80; k++) applyHeightBrush(w, { x: 3.5, y: 3.5, radius: 2 }, -1);
    expect(w.isWaterAt(3, 3)).toBe(true);
  });

  it('paint sets terrain, consistent height and marks chunks dirty', () => {
    const w = generateWorld(64, 64, 5);
    w.dirtyChunks.clear();
    applyPaintBrush(w, { x: 32, y: 32, radius: 3 }, T.FOREST);
    expect(w.terrainAt(32, 32)).toBe(T.FOREST);
    expect(w.heights[w.idx(32, 32)]).toBeGreaterThanOrEqual(SEA_LEVEL);
    expect(w.dirtyChunks.size).toBeGreaterThan(0);

    applyPaintBrush(w, { x: 32, y: 32, radius: 3 }, T.DEEP_WATER);
    expect(w.terrainAt(32, 32)).toBe(T.DEEP_WATER);
    expect(w.heights[w.idx(32, 32)]).toBeLessThan(SEA_LEVEL);

    applyPaintBrush(w, { x: 32, y: 32, radius: 3 }, T.MOUNTAIN);
    expect(w.terrainAt(32, 32)).toBe(T.MOUNTAIN);
  });

  it('smooth reduces a spike', () => {
    const w = generateWorld(64, 64, 8);
    const i = w.idx(30, 30);
    w.heights[i] = 255;
    applySmoothBrush(w, { x: 30.5, y: 30.5, radius: 1 });
    expect(w.heights[i]).toBeLessThan(255);
  });

  it('ignores strokes outside the map', () => {
    const w = generateWorld(32, 32, 3);
    const before = w.terrain.slice();
    applyPaintBrush(w, { x: -50, y: -50, radius: 4 }, T.GRASS);
    expect(w.terrain).toEqual(before);
  });
});
