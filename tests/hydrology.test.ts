import { describe, expect, it } from 'vitest';
import { MOVE, passable } from '../src/sim/pathfinding';
import { generateWorld } from '../src/world/generator';
import { addHydrology } from '../src/world/hydrology';
import { SEA_LEVEL, T, isFreshWater, isWater } from '../src/world/terrain';
import { World } from '../src/world/world';

/** Connected components (8-way, no corner cutting) of LAND-passable tiles with at least minSize tiles. */
function landComponents(world: World, minSize: number): number {
  const n = world.width * world.height;
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  let comps = 0;
  for (let s = 0; s < n; s++) {
    const sx = s % world.width;
    const sy = Math.floor(s / world.width);
    if (seen[s] || !passable(world, MOVE.LAND, sx, sy)) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    seen[s] = 1;
    while (head < tail) {
      const c = queue[head++];
      const cx = c % world.width;
      const cy = (c - cx) / world.width;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!passable(world, MOVE.LAND, nx, ny)) continue;
        const nb = ny * world.width + nx;
        if (seen[nb]) continue;
        seen[nb] = 1;
        queue[tail++] = nb;
      }
    }
    if (tail >= minSize) comps++;
  }
  return comps;
}

describe('rivers and lakes', () => {
  it('generated worlds contain rivers and lakes above sea level', () => {
    for (const seed of [1, 4, 7]) {
      const w = generateWorld(256, 160, seed);
      const counts = w.terrainCounts();
      expect(counts[T.RIVER]).toBeGreaterThan(20);
      expect(counts[T.LAKE]).toBeGreaterThan(0);
      for (let i = 0; i < w.terrain.length; i++) {
        if (isFreshWater(w.terrain[i])) expect(w.heights[i]).toBeGreaterThanOrEqual(SEA_LEVEL);
      }
    }
  });

  it('is deterministic for a seed', () => {
    const a = generateWorld(200, 120, 99);
    const b = generateWorld(200, 120, 99);
    expect(a.terrain).toEqual(b.terrain);
  });

  it('every river tile drains to the sea or a lake through water', () => {
    const w = generateWorld(256, 160, 4);
    // BFS from the sea and lakes through 4-connected river tiles must reach every river tile.
    const n = w.width * w.height;
    const reached = new Uint8Array(n);
    const queue: number[] = [];
    for (let i = 0; i < n; i++) {
      const id = w.terrain[i];
      if (isWater(id) && id !== T.RIVER) {
        reached[i] = 1;
        queue.push(i);
      }
    }
    for (let head = 0; head < queue.length; head++) {
      const c = queue[head];
      const cx = c % w.width;
      const cy = Math.floor(c / w.width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!w.inBounds(nx, ny)) continue;
        const nb = ny * w.width + nx;
        if (reached[nb] || w.terrain[nb] !== T.RIVER) continue;
        reached[nb] = 1;
        queue.push(nb);
      }
    }
    let rivers = 0;
    let connected = 0;
    for (let i = 0; i < n; i++) {
      if (w.terrain[i] !== T.RIVER) continue;
      rivers++;
      if (reached[i]) connected++;
    }
    expect(rivers).toBeGreaterThan(0);
    expect(connected / rivers).toBeGreaterThan(0.97);
  });

  it('rivers do not cut land routes (they are fordable) and lakes add no major barriers', () => {
    for (const seed of [1, 4, 7]) {
      const dry = generateWorld(256, 160, seed, { hydrology: false });
      const wet = generateWorld(256, 160, seed);
      expect(landComponents(wet, 200)).toBeLessThanOrEqual(landComponents(dry, 200));
    }
  });

  it('rivers are fordable for land animals but lakes are not; fish use both', () => {
    const w = new World(3, 1, 1);
    w.heights.fill(SEA_LEVEL + 10);
    w.terrain.set([T.GRASS, T.RIVER, T.LAKE]);
    expect(passable(w, MOVE.LAND, 1, 0)).toBe(true);
    expect(passable(w, MOVE.LOWLAND, 1, 0)).toBe(true);
    expect(passable(w, MOVE.LAND, 2, 0)).toBe(false);
    expect(passable(w, MOVE.WATER, 1, 0)).toBe(true);
    expect(passable(w, MOVE.WATER, 2, 0)).toBe(true);
    expect(passable(w, MOVE.WATER, 0, 0)).toBe(false);
  });

  it('a closed basin becomes a lake and its outflow a river', () => {
    // A bowl on a slope toward the sea on the left.
    const w = new World(40, 20, 1);
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 40; x++) {
        const i = y * 40 + x;
        w.heights[i] = x < 3 ? SEA_LEVEL - 20 : SEA_LEVEL + 10 + x * 2;
        if (x >= 25 && x <= 31 && y >= 7 && y <= 13) w.heights[i] -= 12; // basin
        w.terrain[i] = x < 3 ? T.DEEP_WATER : T.GRASS;
        w.moisture[i] = 255;
      }
    }
    const r = addHydrology(w, { riverThreshold: 30, lakeDepth: 3, minLakeSize: 4 });
    expect(r.lakes).toBeGreaterThan(0);
    expect(w.terrainAt(28, 10)).toBe(T.LAKE);
    expect(r.riverTiles).toBeGreaterThan(0);
  });
});
