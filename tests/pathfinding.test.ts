import { describe, expect, it } from 'vitest';
import {
  MOVE, NOT_FOUND, NO_BUDGET, Pathfinder, UNREACHABLE, WaterField, isDrinkSpot, passable,
} from '../src/sim/pathfinding';
import { SEA_LEVEL, T } from '../src/world/terrain';
import { World } from '../src/world/world';

/** Map from ASCII art: '.' grass, '~' sea, 'r' river, 'L' lake, '^' mountain. */
function mapOf(rows: string[]): World {
  const w = new World(rows[0].length, rows.length, 1);
  const ids: Record<string, number> = { '.': T.GRASS, '~': T.SHALLOW_WATER, r: T.RIVER, L: T.LAKE, '^': T.MOUNTAIN };
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const i = y * w.width + x;
      w.terrain[i] = ids[row[x]];
      w.heights[i] = row[x] === '~' ? SEA_LEVEL - 5 : SEA_LEVEL + 10;
    }
  });
  return w;
}

const out = new Int32Array(256);

function pathTiles(w: World, n: number): Array<[number, number]> {
  return Array.from(out.slice(0, n), (t) => [t % w.width, Math.floor(t / w.width)] as [number, number]);
}

describe('A*', () => {
  it('goes around a wall instead of through it', () => {
    const w = mapOf([
      '..........',
      '....^.....',
      '....^.....',
      '....^.....',
      '..........',
    ]);
    const pf = new Pathfinder();
    pf.beginTick(10000);
    const n = pf.astar(w, MOVE.LOWLAND, 2, 2, 7, 2, 1000, out, 0, 64);
    expect(n).toBeGreaterThan(5);
    const tiles = pathTiles(w, n);
    expect(tiles[tiles.length - 1]).toEqual([7, 2]);
    for (const [x, y] of tiles) expect(passable(w, MOVE.LOWLAND, x, y)).toBe(true);
    // Consecutive steps are neighbours and never cut a blocked corner.
    let prev: [number, number] = [2, 2];
    for (const [x, y] of tiles) {
      expect(Math.max(Math.abs(x - prev[0]), Math.abs(y - prev[1]))).toBe(1);
      if (x !== prev[0] && y !== prev[1]) {
        expect(passable(w, MOVE.LOWLAND, x, prev[1])).toBe(true);
        expect(passable(w, MOVE.LOWLAND, prev[0], y)).toBe(true);
      }
      prev = [x, y];
    }
  });

  it('lets LAND animals cross a mountain that LOWLAND animals must avoid', () => {
    const w = mapOf([
      '....^....',
      '....^....',
      '....^....',
    ]);
    const pf = new Pathfinder();
    pf.beginTick(10000);
    expect(pf.astar(w, MOVE.LAND, 1, 1, 7, 1, 1000, out, 0, 64)).toBe(6);
    expect(pf.astar(w, MOVE.LOWLAND, 1, 1, 7, 1, 1000, out, 0, 64)).toBe(NOT_FOUND);
  });

  it('reports unreachable goals (other side of a lake) and blocked goals', () => {
    const w = mapOf([
      '...LLL...',
      '...LLL...',
      '...LLL...',
    ]);
    const pf = new Pathfinder();
    pf.beginTick(10000);
    expect(pf.astar(w, MOVE.LAND, 1, 1, 7, 1, 1000, out, 0, 64)).toBe(NOT_FOUND);
    expect(pf.astar(w, MOVE.LAND, 1, 1, 4, 1, 1000, out, 0, 64)).toBe(NOT_FOUND); // goal in the lake
  });

  it('prefers walking around a river when that is cheap, but fords it otherwise', () => {
    const w = mapOf([
      '....r....',
      '....r....',
      '....r....',
      '....r....',
      '....r....',
    ]);
    const pf = new Pathfinder();
    pf.beginTick(10000);
    const n = pf.astar(w, MOVE.LAND, 1, 2, 7, 2, 1000, out, 0, 64);
    expect(n).toBeGreaterThan(0);
    expect(pathTiles(w, n).some(([x]) => x === 4)).toBe(true); // had to wade: river spans the map
  });

  it('respects the per-tick node budget', () => {
    const w = mapOf(Array.from({ length: 60 }, () => '.'.repeat(60)));
    const pf = new Pathfinder();
    pf.beginTick(30);
    expect(pf.astar(w, MOVE.LAND, 0, 0, 59, 59, 5000, out, 0, 64)).toBe(NO_BUDGET);
    pf.beginTick(10000);
    expect(pf.astar(w, MOVE.LAND, 0, 0, 59, 59, 5000, out, 0, 32)).toBe(32); // truncated to outMax
    expect(pf.budget).toBeLessThan(10000);
  });
});

describe('nearest (BFS)', () => {
  it('finds the nearest reachable match, not the nearest by straight line', () => {
    // Target A is 2 tiles away but behind a lake; B is 5 tiles away on this side.
    const w = mapOf([
      '.....LLL..',
      '.....LAL..',
      '.....LLL..',
      '..........',
    ].map((r) => r.replace('A', '.')));
    const pf = new Pathfinder();
    pf.beginTick(10000);
    const targetA = 1 * w.width + 6;
    const targetB = 3 * w.width + 9;
    const n = pf.nearest(w, MOVE.LAND, 4, 1, 500, (t) => t === targetA || t === targetB, out, 0, 64);
    expect(n).toBeGreaterThan(0);
    expect(out[n - 1]).toBe(targetB);
  });

  it('returns 0 when standing on a match and NOT_FOUND when nothing is reachable', () => {
    const w = mapOf(['.....']);
    const pf = new Pathfinder();
    pf.beginTick(10000);
    expect(pf.nearest(w, MOVE.LAND, 2, 0, 100, (t) => t === 2, out, 0, 8)).toBe(0);
    expect(pf.nearest(w, MOVE.LAND, 2, 0, 100, () => false, out, 0, 8)).toBe(NOT_FOUND);
  });
});

describe('water field', () => {
  it('measures steps to the nearest reachable drink spot and leads there', () => {
    const w = mapOf([
      '~~.......',
      '~~.......',
      '~~...^^^^',
      '~~...^...',
      '~~...^...',
    ]);
    const f = new WaterField();
    f.build(w);
    expect(f.distanceAt(w, MOVE.LAND, 2, 0)).toBe(0); // next to the sea
    expect(f.distanceAt(w, MOVE.LAND, 6, 0)).toBe(4);
    // Behind the ridge: LAND climbs over, LOWLAND cannot reach any water.
    expect(f.distanceAt(w, MOVE.LAND, 8, 4)).toBeLessThan(UNREACHABLE);
    expect(f.distanceAt(w, MOVE.LOWLAND, 8, 4)).toBe(UNREACHABLE);
    // Following nextStep reaches a drink spot.
    let x = 6;
    let y = 0;
    for (let k = 0; k < 10 && !isDrinkSpot(w, x, y); k++) {
      const next = f.nextStep(w, MOVE.LAND, x, y);
      expect(next).toBeGreaterThanOrEqual(0);
      x = next % w.width;
      y = Math.floor(next / w.width);
    }
    expect(isDrinkSpot(w, x, y)).toBe(true);
  });

  it('counts rivers and lakes as drinking water and becomes stale when passability changes', () => {
    const w = mapOf([
      '....r....',
      '.........',
      '.........',
      '......LL.',
    ]);
    const f = new WaterField();
    f.build(w);
    expect(f.distanceAt(w, MOVE.LAND, 4, 0)).toBe(0); // standing in the river
    expect(f.distanceAt(w, MOVE.LAND, 5, 2)).toBe(0); // next to the lake
    expect(f.isStale(w)).toBe(false);
    w.setTerrain(1, 1, T.FOREST); // grass → forest: same movement class
    expect(f.isStale(w)).toBe(false);
    w.setTerrain(1, 1, T.LAKE); // land → water
    expect(f.isStale(w)).toBe(true);
  });
});

import { RegionGraph, LEG, computeRegions } from '../src/sim/regions';
import { Creatures } from '../src/sim/creatures';
import { generateWorld } from '../src/world/generator';

describe('region graph (long routes)', () => {
  /** A long serpentine: walls with alternating gaps force a route many times the straight distance. */
  function serpentine(): World {
    const rows: string[] = [];
    for (let y = 0; y < 60; y++) {
      let row = '';
      for (let x = 0; x < 200; x++) {
        const wall = x % 20 === 10 && (Math.floor(x / 20) % 2 === 0 ? y < 55 : y > 4);
        row += wall ? '^' : '.';
      }
      rows.push(row);
    }
    return mapOf(rows);
  }

  it('knows reachability instantly and gives waypoints within a leg', () => {
    const w = serpentine();
    const g = new RegionGraph();
    g.build(w);
    const s = 30 * w.width + 2;
    const goal = 30 * w.width + 197;
    expect(g.connected(MOVE.LOWLAND, s, goal)).toBe(true);
    const wp = g.waypoint(w, MOVE.LOWLAND, s, goal);
    expect(wp).toBeGreaterThanOrEqual(0);
    const dx = Math.abs((wp % w.width) - 2);
    const dy = Math.abs(Math.floor(wp / w.width) - 30);
    expect(Math.max(dx, dy)).toBeLessThanOrEqual(LEG + 16);
    expect(passable(w, MOVE.LOWLAND, wp % w.width, Math.floor(wp / w.width))).toBe(true);
  });

  it('routes across a maze far beyond the single-search cap', () => {
    const w = serpentine();
    const c = new Creatures();
    // Plain A* with the old prowling cap cannot find it…
    const pf = new Pathfinder();
    pf.beginTick(1e9);
    expect(pf.astar(w, MOVE.LOWLAND, 2, 30, 197, 30, 1500, out, 0, 64)).toBe(NOT_FOUND);
    // …the hierarchical planner can, leg by leg.
    expect(c.planLongRoute(MOVE.LOWLAND, 2, 30, 197, 30, w)).toBe(true);
  });

  it('reports unreachable goals without searching the map', () => {
    const w = mapOf(['....LLLL....', '....LLLL....', '....LLLL....']);
    const g = new RegionGraph();
    g.build(w);
    expect(g.connected(MOVE.LAND, 1, 10)).toBe(false);
    expect(g.waypoint(w, MOVE.LAND, 1, 10)).toBe(-1);
    expect(g.connected(MOVE.WATER, 5, 6)).toBe(true);
  });

  it('packs region labels into 16 bits, falling back to 32 bits for very fragmented maps', () => {
    const normal = computeRegions(generateWorld(256, 160, 3));
    expect(normal[MOVE.LAND].tileRegion).toBeInstanceOf(Uint16Array);
    // Checkerboard of grass and lake: every grass tile is its own region (> 65,535 of them).
    const w = new World(512, 300, 1);
    for (let y = 0; y < 300; y++) for (let x = 0; x < 512; x++) w.terrain[y * 512 + x] = (x + y) % 2 ? T.LAKE : T.GRASS;
    const g = new RegionGraph();
    g.build(w);
    const frag = computeRegions(w);
    expect(frag[MOVE.LAND].count).toBeGreaterThan(65535);
    expect(frag[MOVE.LAND].tileRegion).toBeInstanceOf(Int32Array);
    expect(g.connected(MOVE.LAND, 0, 0)).toBe(true);
    expect(g.connected(MOVE.LAND, 0, 2)).toBe(false);
    expect(g.connected(MOVE.LAND, 1, 1)).toBe(false); // lake tile
    expect(g.connected(MOVE.WATER, 1, 3)).toBe(false);
    expect(g.connected(MOVE.LAND, 299 * 512 + 511, 299 * 512 + 511)).toBe(true);
  });

  it('plans long routes on a generated large map', () => {
    const w = generateWorld(512, 320, 7);
    const c = new Creatures();
    const g = new RegionGraph();
    g.build(w);
    // Pick far-apart reachable land tiles.
    let found = 0;
    let tried = 0;
    for (let a = 1; a < w.terrain.length && tried < 10; a += 7919) {
      const b = (a * 31 + 12345) % w.terrain.length;
      if (!g.connected(MOVE.LAND, a, b)) continue;
      const ax = a % w.width;
      const bx = b % w.width;
      if (Math.abs(ax - bx) < 100) continue;
      tried++;
      if (c.planLongRoute(MOVE.LAND, ax, Math.floor(a / w.width), bx, Math.floor(b / w.width), w)) found++;
    }
    expect(tried).toBeGreaterThan(3);
    expect(found).toBe(tried);
  });
});
