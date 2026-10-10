import { describe, expect, it } from 'vitest';
import { UndoHistory } from '../src/game/undo';
import { deserializeInto, serialize } from '../src/save/serialize';
import { GRAZER, HADROSAUR, SPECIES, STATE } from '../src/sim/creatures';
import { computeNav, NavScheduler } from '../src/sim/navjobs';
import { MOVE, NOT_FOUND, Pathfinder, WaterField, navGridOf, passable, passableId, tileCost } from '../src/sim/pathfinding';
import { RegionGraph, computeRegions } from '../src/sim/regions';
import { Simulation } from '../src/sim/simulation';
import { generateWorld } from '../src/world/generator';
import { CLIFF_FROM, SLOPE, STEEP_FROM, navCode, slopeClassOf } from '../src/world/passability';
import { SEA_LEVEL, T } from '../src/world/terrain';
import { World } from '../src/world/world';

const FLAT = SEA_LEVEL + 20;

/** A flat grass world (heights set directly, slopes all gentle). */
function flat(w: number, h: number, fill: number = T.GRASS): World {
  const world = new World(w, h, 1);
  world.heights.fill(FLAT);
  world.temperature.fill(140);
  world.moisture.fill(110);
  world.baseTemperature.fill(140);
  world.baseMoisture.fill(110);
  world.terrain.fill(fill);
  return world;
}

/** Raises a rectangle of tiles by `rise` height units, through the normal setters (slopes follow). */
function raise(world: World, x0: number, y0: number, x1: number, y1: number, rise: number): void {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) world.setHeight(x, y, world.heights[world.idx(x, y)] + rise);
}

function freshSlopes(world: World): Uint8Array {
  const copy = new World(world.width, world.height, 1);
  copy.heights.set(world.heights);
  copy.terrain.set(world.terrain);
  copy.recomputeSlopes();
  return copy.slopeClass;
}

function search(world: World, cls: number, sx: number, sy: number, gx: number, gy: number): { n: number; tiles: number[] } {
  const pf = new Pathfinder();
  pf.beginTick(1e9);
  const out = new Int32Array(512);
  const n = pf.astar(world, cls, sx, sy, gx, gy, 20000, out, 0, 512);
  return { n, tiles: n > 0 ? Array.from(out.slice(0, n)) : [] };
}

function run(sim: Simulation, ticks: number, each?: (t: number) => void): void {
  for (let t = 0; t < ticks; t++) {
    sim.step();
    each?.(t);
  }
}

function quiet(world: World): Simulation {
  const sim = new Simulation(world);
  sim.weather.config.auto = false;
  return sim;
}

describe('slope classes', () => {
  it('turns height differences into gentle, steep and sheer', () => {
    expect(slopeClassOf(0)).toBe(SLOPE.GENTLE);
    expect(slopeClassOf(STEEP_FROM - 1)).toBe(SLOPE.GENTLE);
    expect(slopeClassOf(STEEP_FROM)).toBe(SLOPE.STEEP);
    expect(slopeClassOf(CLIFF_FROM - 1)).toBe(SLOPE.STEEP);
    expect(slopeClassOf(CLIFF_FROM)).toBe(SLOPE.CLIFF);
    expect(slopeClassOf(250)).toBe(SLOPE.CLIFF);
    expect(STEEP_FROM).toBeLessThan(CLIFF_FROM);
  });

  it('a pillar makes a ring of sheer tiles; a ramp is steep or gentle by its grade', () => {
    const w = flat(20, 20);
    w.setHeight(10, 10, FLAT + 30);
    for (const [x, y] of [[10, 10], [9, 10], [11, 10], [10, 9], [10, 11]]) expect(w.slopeClass[w.idx(x, y)]).toBe(SLOPE.CLIFF);
    expect(w.slopeClass[w.idx(8, 10)]).toBe(SLOPE.GENTLE);
    expect(w.slopeClass[w.idx(9, 9)]).toBe(SLOPE.GENTLE); // diagonal neighbours do not count
    const r = flat(40, 8);
    for (let x = 0; x < 40; x++) for (let y = 0; y < 8; y++) r.heights[r.idx(x, y)] = FLAT + (x < 20 ? x * 5 : 100 + (x - 20) * 15); // gentle 5/tile, then steep 15/tile
    r.recomputeSlopes();
    expect(r.slopeClass[r.idx(5, 3)]).toBe(SLOPE.GENTLE);
    expect(r.slopeClass[r.idx(30, 3)]).toBe(SLOPE.STEEP);
  });

  it('drops into the sea or a lake are shores, not cliffs; a river bank counts', () => {
    const w = flat(20, 10);
    for (let y = 0; y < 10; y++) for (let x = 0; x < 6; x++) {
      w.terrain[w.idx(x, y)] = T.SHALLOW_WATER;
      w.heights[w.idx(x, y)] = SEA_LEVEL - 40;
    }
    w.recomputeSlopes();
    expect(w.slopeClass[w.idx(6, 5)]).toBe(SLOPE.GENTLE); // 60 units above the sea floor, but it is a beach
    // The same drop to a river tile (wadable) is a real slope.
    const r = flat(20, 10);
    r.terrain[r.idx(5, 5)] = T.RIVER;
    r.heights[r.idx(5, 5)] = FLAT - 30;
    r.recomputeSlopes();
    expect(r.slopeClass[r.idx(6, 5)]).toBe(SLOPE.CLIFF);
  });

  it('stays equal to a full recomputation through random height and terrain edits and through undo and redo', () => {
    const w = flat(40, 40);
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const undo = new UndoHistory();
    for (let k = 0; k < 400; k++) {
      const x = Math.floor(rnd() * 40);
      const y = Math.floor(rnd() * 40);
      if (k % 5 === 0) w.setTerrain(x, y, rnd() < 0.5 ? T.LAKE : T.GRASS);
      else undo.record(w, 'edit', () => w.setHeight(x, y, FLAT + (rnd() - 0.3) * 80));
    }
    expect(Array.from(w.slopeClass)).toEqual(Array.from(freshSlopes(w)));
    while (undo.canUndo) undo.undo(w);
    expect(Array.from(w.slopeClass)).toEqual(Array.from(freshSlopes(w)));
    while (undo.canRedo) undo.redo(w);
    expect(Array.from(w.slopeClass)).toEqual(Array.from(freshSlopes(w)));
  });

  it('bumps the passability version only when where animals can walk changed', () => {
    const w = flat(20, 20);
    const v0 = w.passVersion;
    w.setHeight(5, 5, FLAT + 3); // still gentle
    expect(w.passVersion).toBe(v0);
    w.setHeight(10, 10, FLAT + 40); // a cliff appears
    expect(w.passVersion).toBeGreaterThan(v0);
    const v1 = w.passVersion;
    w.setHeight(10, 10, FLAT + 41); // still a cliff
    expect(w.passVersion).toBe(v1);
    w.setHeight(10, 10, FLAT); // gone
    expect(w.passVersion).toBeGreaterThan(v1);
    // Slopes in the sea matter to no walking animal.
    const s = flat(20, 20, T.DEEP_WATER);
    const v2 = s.passVersion;
    s.setHeight(10, 10, 255);
    expect(s.passVersion).toBe(v2);
  });
});

describe('who can walk where', () => {
  it('follows terrain and slope for each movement class', () => {
    const ok = (cls: number, id: number, slope: number) => passableId(cls, navCode(id, slope));
    // Gentle ground: every walker.
    expect(ok(MOVE.LAND, T.GRASS, SLOPE.GENTLE) && ok(MOVE.LOWLAND, T.GRASS, SLOPE.GENTLE)).toBe(true);
    // Steep slopes: climbers (LAND) yes, lowland species no.
    expect(ok(MOVE.LAND, T.HILLS, SLOPE.STEEP)).toBe(true);
    expect(ok(MOVE.LOWLAND, T.HILLS, SLOPE.STEEP)).toBe(false);
    // Mountains and snow: as before.
    expect(ok(MOVE.LAND, T.MOUNTAIN, SLOPE.GENTLE)).toBe(true);
    expect(ok(MOVE.LOWLAND, T.MOUNTAIN, SLOPE.GENTLE)).toBe(false);
    expect(ok(MOVE.LOWLAND, T.SNOW, SLOPE.GENTLE)).toBe(false);
    // Sheer cliffs: nobody who walks.
    for (const id of [T.GRASS, T.HILLS, T.MOUNTAIN, T.RIVER]) {
      expect(ok(MOVE.LAND, id, SLOPE.CLIFF)).toBe(false);
      expect(ok(MOVE.LOWLAND, id, SLOPE.CLIFF)).toBe(false);
    }
    // Water: swimmers ignore slope; walkers wade rivers but not lakes or sea.
    expect(ok(MOVE.WATER, T.LAKE, SLOPE.CLIFF)).toBe(true);
    expect(ok(MOVE.WATER, T.GRASS, SLOPE.GENTLE)).toBe(false);
    expect(ok(MOVE.LAND, T.RIVER, SLOPE.GENTLE)).toBe(true);
    expect(ok(MOVE.LAND, T.LAKE, SLOPE.GENTLE)).toBe(false);
    expect(ok(MOVE.LAND, T.SHALLOW_WATER, SLOPE.GENTLE)).toBe(false);
    // A plain terrain id is level ground.
    expect(passableId(MOVE.LOWLAND, T.GRASS)).toBe(true);
    // Climbing steep ground is slower.
    expect(tileCost(MOVE.LAND, navCode(T.HILLS, SLOPE.STEEP))).toBeGreaterThan(tileCost(MOVE.LAND, navCode(T.HILLS, SLOPE.GENTLE)));
    expect(T.LAKE).toBeLessThan(16); // terrain ids fit the low four bits of a navigation code
  });

  it('the live world agrees with the codes it hands to navigation', () => {
    const w = flat(30, 30);
    raise(w, 10, 0, 12, 30, 40);
    const codes = w.navCodes();
    for (let i = 0; i < codes.length; i++) {
      const x = i % 30;
      const y = (i - x) / 30;
      for (const cls of [MOVE.LAND, MOVE.LOWLAND, MOVE.WATER]) expect(passableId(cls, codes[i])).toBe(passable(w, cls, x, y));
    }
  });
});

describe('routes around obstacles', () => {
  /** 40×20 grass, a sheer wall at x = 20 from the top down to y = 16 (a gap below it). */
  function wallWithGap(): World {
    const w = flat(40, 20);
    raise(w, 20, 0, 21, 17, 40);
    return w;
  }

  it('finds a way around a sheer wall and never steps on a cliff', () => {
    const w = wallWithGap();
    const r = search(w, MOVE.LAND, 5, 10, 35, 10);
    expect(r.n).toBeGreaterThanOrEqual(30); // no shorter than the straight line
    for (const t of r.tiles) expect(passable(w, MOVE.LAND, t % 40, Math.floor(t / 40))).toBe(true);
    expect(r.tiles.some((t) => Math.floor(t / 40) >= 17)).toBe(true); // went through the gap at the bottom
    expect(r.tiles.every((t) => w.slopeClass[t] !== SLOPE.CLIFF)).toBe(true);
  });

  it('reports no path at all when the wall has no gap', () => {
    const w = wallWithGap();
    raise(w, 20, 17, 21, 20, 40);
    expect(search(w, MOVE.LAND, 5, 10, 35, 10).n).toBe(NOT_FOUND);
    expect(search(w, MOVE.LOWLAND, 5, 10, 35, 10).n).toBe(NOT_FOUND);
    // And the goal itself on a cliff is refused.
    expect(search(w, MOVE.LAND, 5, 10, 20, 5).n).toBe(NOT_FOUND);
  });

  it('a steep ridge stops lowland species but climbers cross it, taking the cheaper way where there is one', () => {
    const w = flat(40, 20);
    raise(w, 20, 0, 21, 20, 15); // steep on x = 19..21, no gap
    expect(search(w, MOVE.LOWLAND, 5, 10, 35, 10).n).toBe(NOT_FOUND);
    const climb = search(w, MOVE.LAND, 5, 10, 35, 10);
    expect(climb.n).toBeGreaterThanOrEqual(30);
    expect(climb.tiles.some((t) => w.slopeClass[t] === SLOPE.STEEP)).toBe(true);
    // With a low gap in the ridge, climbers prefer the easy pass over the steep slope when the detour is short.
    const gap = flat(40, 20);
    raise(gap, 20, 0, 21, 8, 15);
    raise(gap, 20, 12, 21, 20, 15); // gap at y = 8..11
    const easy = search(gap, MOVE.LAND, 5, 10, 35, 10);
    expect(easy.tiles.every((t) => gap.slopeClass[t] === SLOPE.GENTLE)).toBe(true);
    expect(search(gap, MOVE.LOWLAND, 5, 10, 35, 10).n).toBeGreaterThan(0);
  });

  it('the region graph and water field see cliffs and steep ground', () => {
    const w = flat(40, 20);
    raise(w, 20, 0, 21, 20, 40); // full sheer wall
    const g = new RegionGraph();
    g.build(w);
    const left = 10 * 40 + 5;
    const right = 10 * 40 + 35;
    expect(g.connected(MOVE.LAND, left, right)).toBe(false);
    const steep = flat(40, 20);
    raise(steep, 20, 0, 21, 20, 15);
    const g2 = new RegionGraph();
    g2.build(steep);
    expect(g2.connected(MOVE.LAND, left, right)).toBe(true);
    expect(g2.connected(MOVE.LOWLAND, left, right)).toBe(false);
    // Water on one side of a wall: land animals on the other side cannot reach it.
    const pond = flat(40, 20);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 4; x++) pond.terrain[pond.idx(x, y)] = T.LAKE;
    raise(pond, 20, 0, 21, 20, 40);
    const wf = new WaterField();
    wf.build(pond);
    expect(wf.distanceAt(pond, MOVE.LAND, 10, 10)).toBeLessThan(0xffff);
    expect(wf.distanceAt(pond, MOVE.LAND, 30, 10)).toBe(0xffff);
  });

  it('a navigation snapshot from a worker equals one computed from the live world', () => {
    const w = generateWorld(128, 96, 5);
    raise(w, 60, 20, 62, 70, 40);
    const res = computeNav({ id: 1, width: 128, height: 96, terrain: w.navCodes(), passVersion: w.passVersion });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const regions = computeRegions(navGridOf(w));
    expect(res.regions.map((r) => r.count)).toEqual(regions.map((r) => r.count));
    const nav = new NavScheduler(null);
    nav.request(w, 0);
    expect(nav.exportPending()?.terrain).toEqual(w.navCodes());
  });
});

describe('animals and obstacles', () => {
  it('a grazer walks around a sheer wall to food and never stands on impassable ground', () => {
    const w = flat(44, 24, T.DESERT);
    for (let y = 8; y < 14; y++) for (let x = 28; x < 34; x++) w.terrain[w.idx(x, y)] = T.GRASS; // the only food
    raise(w, 20, 0, 21, 19, 40); // a wall with a gap at the bottom
    const sim = quiet(w);
    const id = sim.creatures.spawn(GRAZER, 12.5, 10.5, sim.rng, { hunger: 70, thirst: 0 });
    let ate = false;
    run(sim, 1600, () => {
      const i = sim.creatures.indexOf(id);
      if (i < 0) return;
      expect(passable(w, MOVE.LAND, Math.floor(sim.creatures.x[i]), Math.floor(sim.creatures.y[i]))).toBe(true);
      if (sim.creatures.state[i] === STATE.EAT) ate = true;
    });
    expect(ate).toBe(true);
  });

  it('an animal in a pocket with no way out stays inside, does not pass through the walls and does not stall the simulation', () => {
    const w = flat(40, 40);
    // A ring of sheer pillars around (20, 20): interior tiles next to the ring become cliffs too, leaving a 3×3 floor.
    for (let k = 14; k <= 26; k++) {
      raise(w, k, 14, k + 1, 15, 40);
      raise(w, k, 26, k + 1, 27, 40);
      raise(w, 14, k, 15, k + 1, 40);
      raise(w, 26, k, 27, k + 1, 40);
    }
    const sim = quiet(w);
    sim.creatures.spawn(GRAZER, 20.5, 20.5, sim.rng, { hunger: 10, thirst: 10 });
    sim.creatures.spawn(HADROSAUR, 19.5, 19.5, sim.rng, { hunger: 10, thirst: 10 });
    const t0 = performance.now();
    run(sim, 700, () => {
      for (let i = 0; i < sim.creatures.count; i++) {
        const x = sim.creatures.x[i];
        const y = sim.creatures.y[i];
        expect(passable(w, sim.creatures.species[i] === GRAZER ? MOVE.LAND : MOVE.LOWLAND, Math.floor(x), Math.floor(y))).toBe(true);
        expect(x).toBeGreaterThan(14.99);
        expect(x).toBeLessThan(26.01);
        expect(y).toBeGreaterThan(14.99);
        expect(y).toBeLessThan(26.01);
      }
    });
    expect(performance.now() - t0).toBeLessThan(5000);
    expect(sim.creatures.count).toBeGreaterThan(0);
  });

  it('cannot squeeze diagonally between two blocked tiles', () => {
    const w = flat(24, 24);
    // (12,12) is open, enclosed on its four sides by sheer tiles; only its diagonal corners touch open ground.
    for (const [x, y] of [[11, 12], [13, 12], [12, 11], [12, 13]]) w.slopeClass[w.idx(x, y)] = SLOPE.CLIFF;
    w.passVersion++;
    expect(passable(w, MOVE.LAND, 12, 12)).toBe(true);
    const sim = quiet(w);
    for (let k = 0; k < 40; k++) sim.creatures.spawn(GRAZER, 3 + (k % 8) * 0.9, 3 + Math.floor(k / 8) * 0.9, sim.rng, { hunger: 5, thirst: 5 });
    let entered = 0;
    run(sim, 1500, () => {
      for (let i = 0; i < sim.creatures.count; i++) {
        if (Math.floor(sim.creatures.x[i]) === 12 && Math.floor(sim.creatures.y[i]) === 12) entered++;
        expect(passable(w, MOVE.LAND, Math.floor(sim.creatures.x[i]), Math.floor(sim.creatures.y[i]))).toBe(true);
      }
    });
    expect(entered).toBe(0);
  });

  it('an animal standing where a cliff or snow appears is moved to open ground, not left to walk through blocked ground', () => {
    const w = flat(40, 40, T.TUNDRA);
    const sim = quiet(w);
    sim.creatures.spawn(HADROSAUR, 20.5, 20.5, sim.rng, { hunger: 5, thirst: 5 });
    sim.step();
    // Snow settles on a 3×3 patch under it (blocked for lowland species).
    for (let y = 19; y <= 21; y++) for (let x = 19; x <= 21; x++) w.setTerrain(x, y, T.SNOW);
    run(sim, 25);
    const i = 0;
    expect(passable(w, MOVE.LOWLAND, Math.floor(sim.creatures.x[i]), Math.floor(sim.creatures.y[i]))).toBe(true);
    // A cliff raised right under a grazer: it ends up on a usable tile too.
    const w2 = flat(40, 40);
    const s2 = quiet(w2);
    s2.creatures.spawn(GRAZER, 20.5, 20.5, s2.rng, { hunger: 5, thirst: 5 });
    s2.step();
    w2.setHeight(20, 20, FLAT + 60);
    run(s2, 25);
    expect(passable(w2, MOVE.LAND, Math.floor(s2.creatures.x[0]), Math.floor(s2.creatures.y[0]))).toBe(true);
  });

  it('an animal walled in beyond its reach is carried (never walked through the rock) to the nearest usable tile, alive', () => {
    const w = flat(40, 40);
    const sim = quiet(w);
    sim.creatures.spawn(HADROSAUR, 20.5, 20.5, sim.rng, { hunger: 5, thirst: 5 });
    sim.step();
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) if (Math.hypot(x - 20, y - 20) < 9) w.slopeClass[w.idx(x, y)] = SLOPE.CLIFF;
    w.passVersion++;
    const x0 = sim.creatures.x[0];
    const y0 = sim.creatures.y[0];
    run(sim, 60);
    // 0.20: instead of standing forever inside the rock it is moved once to the nearest tile it can use.
    expect(sim.creatures.isAlive(0)).toBe(true);
    expect(sim.creatures.rescued).toBe(1);
    expect(sim.creatures.trapped).toBeGreaterThanOrEqual(1);
    expect(Math.hypot(sim.creatures.x[0] - 20, sim.creatures.y[0] - 20)).toBeGreaterThanOrEqual(8.5);
    expect(Math.hypot(sim.creatures.x[0] - x0, sim.creatures.y[0] - y0)).toBeLessThan(12);
    expect(passable(w, SPECIES[HADROSAUR].move, Math.floor(sim.creatures.x[0]), Math.floor(sim.creatures.y[0]))).toBe(true);
  });

  it('re-plans around a wall that rises while it is walking, and rebuilds shared navigation at most once per throttle window', () => {
    const w = flat(60, 24, T.DESERT);
    for (let y = 9; y < 15; y++) for (let x = 38; x < 44; x++) w.terrain[w.idx(x, y)] = T.GRASS;
    const sim = quiet(w);
    const id = sim.creatures.spawn(GRAZER, 18.5, 12.5, sim.rng, { hunger: 60, thirst: 0 });
    let ate = false;
    run(sim, 400, (t) => {
      if (t === 15) raise(w, 28, 0, 29, 20, 40); // a wall with a gap at y = 20..23 appears across its way
      const i = sim.creatures.indexOf(id);
      if (i >= 0) {
        expect(passable(w, MOVE.LAND, Math.floor(sim.creatures.x[i]), Math.floor(sim.creatures.y[i]))).toBe(true);
        if (sim.creatures.state[i] === STATE.EAT) ate = true;
      }
    });
    expect(ate).toBe(true);

    // A tile flipping between lake and grass every tick changes passability constantly,
    // yet navigation is rebuilt only a handful of times, never every tick.
    const w2 = flat(48, 48);
    const s2 = quiet(w2);
    s2.spawnInCircle(GRAZER, 24, 24, 10, 20);
    s2.step();
    const before = s2.creatures.nav.stats.requests;
    run(s2, 600, (t) => w2.setTerrain(5, 5, t % 2 ? T.GRASS : T.LAKE));
    const rebuilds = s2.creatures.nav.stats.requests - before;
    expect(rebuilds).toBeGreaterThan(0);
    expect(rebuilds).toBeLessThanOrEqual(600 / 60 + 1);
  });
});

describe('generated worlds and saves', () => {
  it('slopes remove only a little walkable land from natural worlds', () => {
    for (const seed of [4, 11]) {
      const w = generateWorld(512, 320, seed);
      const level = { width: 512, height: 320, terrain: w.terrain, passVersion: 0 };
      const sloped = navGridOf(w);
      for (const cls of [MOVE.LAND, MOVE.LOWLAND]) {
        const biggest = (grid: typeof level) => {
          const c = computeRegions(grid)[cls];
          const size = new Map<number, number>();
          let walkable = 0;
          for (let i = 0; i < c.tileRegion.length; i++) {
            const r = c.tileRegion[i] - 1;
            if (r < 0) continue;
            walkable++;
            size.set(c.comp[r], (size.get(c.comp[r]) ?? 0) + 1);
          }
          return { walkable, big: Math.max(...size.values()) };
        };
        const a = biggest(level);
        const b = biggest(sloped);
        expect(b.walkable).toBeGreaterThan(a.walkable * 0.93); // few tiles are too steep
        expect(b.big).toBeGreaterThan(a.big * (cls === MOVE.LAND ? 0.97 : 0.6)); // and the main landmass stays whole
      }
    }
  });

  it('derives slopes on load, keeps navigation identical across a save, and rebuilds navigation once for older saves', () => {
    const w = generateWorld(96, 64, 9);
    raise(w, 40, 10, 42, 50, 50);
    const sim = quiet(w);
    sim.spawnInCircle(GRAZER, 20, 30, 8, 12);
    run(sim, 120);
    const data = serialize(sim);
    const other = new Simulation(flat(8, 8));
    deserializeInto(other, data);
    expect(Array.from(other.world.slopeClass)).toEqual(Array.from(sim.world.slopeClass));
    run(sim, 100);
    run(other, 100);
    expect(Array.from(other.creatures.x.slice(0, other.creatures.count))).toEqual(Array.from(sim.creatures.x.slice(0, sim.creatures.count)));
    // An older save: navigation data was built without slopes, so it is flagged for one rebuild.
    const old = serialize(sim);
    old.version = 6;
    const loaded = new Simulation(flat(8, 8));
    const world = deserializeInto(loaded, old);
    expect(world.passVersion).toBeGreaterThan(sim.world.passVersion - 1);
    const fresh = serialize(sim);
    const loaded2 = new Simulation(flat(8, 8));
    expect(deserializeInto(loaded2, fresh).passVersion).toBe(sim.world.passVersion);
  });
});
