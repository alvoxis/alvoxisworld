import { describe, expect, it } from 'vitest';
import { deserializeInto, serialize } from '../src/save/serialize';
import { CAUSE, CAUSE_COUNT, FISH, HUMAN, ORCA, SHARK, SPECIES, WHALE } from '../src/sim/creatures';
import { MOVE, passable } from '../src/sim/pathfinding';
import { Simulation } from '../src/sim/simulation';
import { SEA_LEVEL, T, isWater } from '../src/world/terrain';
import { World } from '../src/world/world';

function base(w: number, h: number, fill: number): World {
  const world = new World(w, h, 9);
  world.heights.fill(SEA_LEVEL + 20);
  world.temperature.fill(140);
  world.moisture.fill(120);
  world.baseTemperature.fill(140);
  world.baseMoisture.fill(120);
  world.terrain.fill(fill);
  return world;
}

function block(w: World, x0: number, y0: number, x1: number, y1: number, t: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) w.terrain[y * w.width + x] = t;
}

function quiet(w: World): Simulation {
  const sim = new Simulation(w);
  sim.weather.config.auto = false;
  sim.settlements.auto = false;
  sim.groups.enabled = false;
  return sim;
}

/** An ocean: deep water with a shallow coastal band and an island. */
function ocean(): World {
  const w = base(120, 90, T.DEEP_WATER);
  block(w, 0, 0, 119, 9, T.SHALLOW_WATER);
  block(w, 40, 35, 60, 50, T.SHALLOW_WATER);
  block(w, 45, 39, 55, 46, T.GRASS);
  return w;
}

describe('sea animals', () => {
  it('sharks, whales and orcas (and fish) live in water only and move about', { timeout: 120000 }, () => {
    const sim = quiet(ocean());
    sim.spawnInCircle(FISH, 30, 5, 4, 30);
    sim.spawnInCircle(SHARK, 30, 20, 3, 3);
    sim.spawnInCircle(WHALE, 80, 60, 3, 3);
    sim.spawnInCircle(ORCA, 90, 30, 3, 2);
    const c = sim.creatures;
    const start = new Map<number, [number, number]>();
    for (let i = 0; i < c.count; i++) start.set(c.id[i], [c.x[i], c.y[i]]);
    expect([SHARK, WHALE, ORCA].every((sp) => Array.from({ length: c.count }, (_, i) => c.species[i]).includes(sp))).toBe(true);
    for (let t = 0; t < 1200; t++) {
      sim.step();
      if (t % 10) continue;
      for (let i = 0; i < c.count; i++) {
        if (!c.isAlive(i) || SPECIES[c.species[i]].habitat !== 'water') continue;
        expect(isWater(sim.world.terrain[Math.floor(c.y[i]) * sim.world.width + Math.floor(c.x[i])])).toBe(true);
      }
    }
    // They really swim around.
    let moved = 0;
    for (let i = 0; i < c.count; i++) {
      const s = start.get(c.id[i]);
      if (s && [SHARK, WHALE, ORCA].includes(c.species[i]) && Math.hypot(c.x[i] - s[0], c.y[i] - s[1]) > 3) moved++;
    }
    expect(moved).toBeGreaterThanOrEqual(4);
    // Spawning on land puts no sea animal there.
    const before = c.count;
    sim.spawnInCircle(WHALE, 50, 42, 1, 3);
    for (let i = before; i < c.count; i++) expect(isWater(sim.world.terrain[Math.floor(c.y[i]) * sim.world.width + Math.floor(c.x[i])])).toBe(true);
  });

  it('sharks and orcas hunt (fish and sharks); whales feed in deep water and do not starve', { timeout: 120000 }, () => {
    const sim = quiet(ocean());
    sim.spawnInCircle(FISH, 30, 5, 5, 40);
    sim.spawnInCircle(SHARK, 30, 6, 2, 3);
    sim.spawnInCircle(ORCA, 34, 6, 2, 1);
    sim.spawnInCircle(WHALE, 80, 60, 3, 3);
    for (let t = 0; t < 2000; t++) sim.step();
    const d = sim.creatures.deathStats;
    expect(d[FISH * CAUSE_COUNT + CAUSE.PREDATION] + d[SHARK * CAUSE_COUNT + CAUSE.PREDATION]).toBeGreaterThan(0);
    expect(d[WHALE * CAUSE_COUNT + CAUSE.STARVATION]).toBe(0);
    expect(SPECIES[SHARK].prey).not.toContain(HUMAN);
    expect(SPECIES[ORCA].prey).not.toContain(HUMAN);
  });
});

/** Two meadows separated by a strait of shallow water (3 tiles wide); optionally a land bridge far to the south. */
function strait(bridge: number | null, deep = false): World {
  const w = base(80, 60, T.GRASS);
  block(w, 38, 0, 40, 59, deep ? T.DEEP_WATER : T.SHALLOW_WATER);
  if (bridge !== null) block(w, 38, bridge, 40, bridge, T.GRASS);
  block(w, 10, 28, 12, 30, T.LAKE); // drinking water on both sides
  block(w, 66, 28, 68, 30, T.LAKE);
  return w;
}

/** Sends one person to (gx, gy) through the work-goal hook; returns what happened on the way. */
function cross(world: World, gx: number, gy: number, ticks = 900): { sim: Simulation; swam: boolean; inDeep: boolean; arrived: boolean } {
  const sim = quiet(world);
  sim.spawnInCircle(HUMAN, 30, 30, 0.2, 1);
  const c = sim.creatures;
  const id = c.id[0];
  c.workGoal = (q) => (q === id ? gy * world.width + gx : -1);
  let swam = false;
  let inDeep = false;
  let arrived = false;
  for (let t = 0; t < ticks && !arrived; t++) {
    sim.step();
    const i = c.indexOf(id);
    if (i < 0) break;
    c.hunger[i] = 0; // keep the trip about the trip
    c.thirst[i] = 0;
    const tile = world.terrain[Math.floor(c.y[i]) * world.width + Math.floor(c.x[i])];
    if (c.swimming(world, i)) swam = true;
    if (tile === T.DEEP_WATER) inDeep = true;
    if (Math.hypot(c.x[i] - gx - 0.5, c.y[i] - gy - 0.5) < 3 && !isWater(tile)) arrived = true;
  }
  return { sim, swam, inDeep, arrived };
}

describe('people swim', () => {
  it('cross a narrow strait when there is no land way, and climb out on the other side', { timeout: 60000 }, () => {
    const r = cross(strait(null), 50, 30);
    expect(r.swam).toBe(true);
    expect(r.arrived).toBe(true);
    expect(SPECIES[HUMAN].move).toBe(MOVE.SWIM);
  });

  it('take the land way when it is not much longer', { timeout: 60000 }, () => {
    const r = cross(strait(31), 50, 30);
    expect(r.arrived).toBe(true);
    expect(r.swam).toBe(false);
  });

  it('never swim through deep ocean (no way across it)', { timeout: 60000 }, () => {
    const w = strait(null, true);
    const r = cross(w, 50, 30, 600);
    expect(r.inDeep).toBe(false);
    expect(r.arrived).toBe(false);
    expect(passable(w, MOVE.SWIM, 39, 30)).toBe(false);
  });

  it('do not wander into water by themselves; one left in a lake swims back to the shore', { timeout: 60000 }, () => {
    const w = base(60, 60, T.GRASS);
    block(w, 20, 20, 40, 40, T.LAKE);
    const sim = quiet(w);
    sim.spawnInCircle(HUMAN, 10, 10, 3, 6);
    const c = sim.creatures;
    let inWater = 0;
    let samples = 0;
    for (let t = 0; t < 1500; t++) {
      sim.step();
      for (let i = 0; i < c.count; i++) {
        if (!c.isAlive(i)) continue;
        samples++;
        if (c.swimming(w, i)) inWater++;
      }
    }
    expect(inWater / samples).toBeLessThan(0.02);
    // Someone in the middle of the lake gets out (and does not drown in a lake).
    const before = c.count;
    sim.spawnInCircle(HUMAN, 10, 10, 0.2, 1);
    const i = before;
    c.x[i] = c.px[i] = 30.5;
    c.y[i] = c.py[i] = 30.5;
    const id = c.id[i];
    let out = false;
    for (let t = 0; t < 1500 && !out; t++) {
      sim.step();
      const k = c.indexOf(id);
      expect(k).toBeGreaterThanOrEqual(0);
      if (!c.swimming(w, k)) out = true;
    }
    expect(out).toBe(true);
  });

  it('a save taken mid-swim continues exactly', { timeout: 60000 }, () => {
    const world = strait(null);
    const sim = quiet(world);
    sim.spawnInCircle(HUMAN, 30, 30, 0.2, 1);
    const c = sim.creatures;
    const id = c.id[0];
    const goal = (q: number) => (q === id ? 30 * world.width + 50 : -1);
    c.workGoal = goal;
    for (let t = 0; t < 900 && !c.swimming(world, c.indexOf(id)); t++) sim.step();
    expect(c.swimming(world, c.indexOf(id))).toBe(true);
    const data = serialize(sim);
    const other = quiet(base(8, 8, T.GRASS));
    deserializeInto(other, data);
    other.creatures.workGoal = goal;
    for (let t = 0; t < 200; t++) {
      sim.step();
      other.step();
    }
    const a = c.indexOf(id);
    const b = other.creatures.indexOf(id);
    expect([other.creatures.x[b], other.creatures.y[b]]).toEqual([c.x[a], c.y[a]]);
  });
});
