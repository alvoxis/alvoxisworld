import { describe, expect, it } from 'vitest';
import { deserializeInto, serialize } from '../src/save/serialize';
import { findSite, type Building, type BuildingType } from '../src/sim/civ';
import { ELF, HUMAN, SPECIES } from '../src/sim/creatures';
import { ROAD_BIT, ROAD_STEPS, ROAD_TILES_PER_STEP, blockedByBuildings, buildRoads, connected, onPlaza } from '../src/sim/roads';
import { STEP_TICKS, type Settlement } from '../src/sim/settlements';
import { Simulation } from '../src/sim/simulation';
import { passable } from '../src/sim/pathfinding';
import { SEA_LEVEL, T, isWater } from '../src/world/terrain';
import { treesOn } from '../src/world/trees';
import { World } from '../src/world/world';

function flat(w: number, h: number, fill: number = T.GRASS): World {
  const world = new World(w, h, 11);
  world.heights.fill(SEA_LEVEL + 20);
  world.temperature.fill(140);
  world.moisture.fill(110);
  world.baseTemperature.fill(140);
  world.baseMoisture.fill(110);
  world.terrain.fill(fill);
  return world;
}

function block(w: World, x0: number, y0: number, x1: number, y1: number, t: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) w.terrain[y * w.width + x] = t;
}

/** A settlement with a pond and a forest strip, grown by placing buildings where the layout puts them. */
function town(sp = HUMAN): { sim: Simulation; s: Settlement } {
  const w = flat(110, 100);
  block(w, 56, 40, 60, 43, T.LAKE);
  block(w, 38, 56, 44, 70, T.FOREST);
  const sim = new Simulation(w);
  sim.weather.config.auto = false;
  sim.settlements.auto = false;
  sim.groups.enabled = false;
  sim.spawnInCircle(sp, 50, 50, 4, 40);
  const s = sim.foundSettlement(50, 50, 'human') as Settlement;
  expect(typeof s).toBe('object');
  const c = s.civ!;
  const plan: BuildingType[] = ['house', 'farm', 'storehouse', 'house', 'house', 'lumber', 'house', 'farm', 'house', 'house', 'quarry', 'house'];
  for (const type of plan) {
    const i = findSite(sim.world, s, sim.settlements.owner!, type);
    if (i < 0) continue;
    c.buildings.push({
      id: c.nextBuildingId++, type, x: i % w.width, y: Math.floor(i / w.width), started: 0, progress: 5, needed: 5, done: true,
      reserve: 0, acc: 0, active: false, idle: 0, empty: false, level: 1, here: 0, up: 0,
    } as Building);
  }
  expect(c.buildings.length).toBeGreaterThanOrEqual(7);
  return { sim, s };
}

const grow = (sim: Simulation, s: Settlement, n: number) => {
  for (let k = 0; k < n; k++) buildRoads(sim.world, s, sim.settlements.owner!, k * ROAD_STEPS);
};

describe('roads', () => {
  it('link every building door to the plaza, along open land inside the territory', () => {
    for (const sp of [HUMAN, ELF]) {
      const { sim, s } = town(sp);
      const c = s.civ!;
      grow(sim, s, 200);
      const W = sim.world.width;
      const roads = new Set(c.roads);
      for (const b of c.buildings) expect(connected(s, roads, W, b)).toBe(true);
      const blocked = blockedByBuildings(c, W);
      for (const b of c.buildings) blocked.delete((b.y + 1) * W + b.x);
      for (const t of c.roads) {
        const x = t % W;
        const y = Math.floor(t / W);
        expect(isWater(sim.world.terrain[t])).toBe(false); // never through water
        expect(treesOn(sim.world, x, y)).toBe(0); // around trunks, not through them
        expect(blocked.has(t)).toBe(false); // never through a building
        expect(sim.settlements.owner![t]).toBe(s.id);
        expect(onPlaza(s, x, y)).toBe(false);
        expect(passable(sim.world, SPECIES[sp].move, x, y)).toBe(true);
      }
      // No duplicates, and a network, not a paved grid.
      expect(roads.size).toBe(c.roads.length);
      expect(c.roads.length).toBeLessThan(s.tiles.length * 0.25);
    }
  });

  it('grow gradually: a few tiles every few steps, and nothing once everything is linked', () => {
    const { sim, s } = town();
    const c = s.civ!;
    let prev = 0;
    for (let step = 0; step < 400; step++) {
      buildRoads(sim.world, s, sim.settlements.owner!, step);
      const added = c.roads.length - prev;
      expect(added).toBeLessThanOrEqual(step % ROAD_STEPS === 0 ? ROAD_TILES_PER_STEP : 0);
      prev = c.roads.length;
    }
    const done = c.roads.length;
    expect(done).toBeGreaterThan(5);
    for (let step = 400; step < 420; step++) buildRoads(sim.world, s, sim.settlements.owner!, step);
    expect(c.roads.length).toBe(done); // stable: no re-planning churn
  });

  it('a road through a new building site is dropped; roads are marked as built ground (no trees grow there)', () => {
    const { sim, s } = town();
    const c = s.civ!;
    grow(sim, s, 200);
    sim.settlements.markBuilt(sim.world);
    for (const t of c.roads) expect(sim.world.built[t] & ROAD_BIT).toBe(ROAD_BIT);
    // Put a building on a road tile: that tile stops being road.
    const W = sim.world.width;
    const doors = new Set(c.buildings.map((b) => (b.y + 1) * W + b.x));
    const t = c.roads.filter((r) => !doors.has(r))[0];
    c.buildings.push({ id: c.nextBuildingId++, type: 'house', x: t % W, y: Math.floor(t / W), started: 0, progress: 5, needed: 5, done: true, reserve: 0, acc: 0, active: false, idle: 0, empty: false, level: 1, here: 0, up: 0 } as Building);
    buildRoads(sim.world, s, sim.settlements.owner!, 1000);
    expect(c.roads).not.toContain(t);
  });

  it('are laid by a living settlement over time, saved and loaded exactly, and absent in old saves', () => {
    const { sim, s } = town();
    for (let t = 0; t < 60 * STEP_TICKS; t++) sim.step();
    const c = s.civ!;
    expect(c.roads.length).toBeGreaterThan(0);
    const data = serialize(sim);
    const other = new Simulation(flat(8, 8));
    deserializeInto(other, data);
    const oc = other.settlements.list[0].civ!;
    expect(oc.roads).toEqual(c.roads);
    for (const r of oc.roads) expect(other.world.built[r] & ROAD_BIT).toBe(ROAD_BIT);
    // A version 14 save has no roads: they start empty and are laid later.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const old = structuredClone(data) as any;
    old.version = 14;
    for (const st of old.settlements.list) delete st.civ.roads;
    const third = new Simulation(flat(8, 8));
    deserializeInto(third, old);
    expect(third.settlements.list[0].civ!.roads).toEqual([]);
  });
});
