import { describe, expect, it } from 'vitest';
import { deserializeInto, serialize } from '../src/save/serialize';
import {
  BASE_CAPACITY, BUILDERS, HOUSE_CAPACITY, HOUSE_LEVELS, MAX_CONSTRUCTIONS, MAX_HOUSE_LEVEL, constructions, housing, importCiv, jobOf,
  maxHouseLevel, slotsOf, startUpgrade, upgradeBlock, upgradeCost, upgradeSteps, upgradeTarget, wantsUpgrade, type Building, type BuildingType, type Civ,
} from '../src/sim/civ';
import { HUMAN } from '../src/sim/creatures';
import { STEP_TICKS, type Settlement } from '../src/sim/settlements';
import { Simulation } from '../src/sim/simulation';
import { SEA_LEVEL, T } from '../src/world/terrain';
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
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) w.setTerrain(x, y, t);
}

function civWorld(): World {
  const w = flat(120, 100);
  block(w, 46, 34, 52, 46, T.FOREST);
  block(w, 30, 38, 35, 46, T.HILLS);
  block(w, 40, 31, 44, 32, T.LAKE);
  return w;
}

function quiet(world: World): Simulation {
  const sim = new Simulation(world);
  sim.weather.config.auto = false;
  return sim;
}

const run = (sim: Simulation, ticks: number) => {
  for (let t = 0; t < ticks; t++) sim.step();
};
const steps = (sim: Simulation, n: number) => run(sim, n * STEP_TICKS);

/** A village of n people with plenty of stock (stage forced; it holds while the population stays above 70% of 12). */
function village(n = 10, auto = false): { sim: Simulation; s: Settlement; civ: Civ } {
  const sim = quiet(civWorld());
  sim.settlements.auto = auto;
  sim.spawnInCircle(HUMAN, 40, 40, 4, n);
  const s = sim.foundSettlement(40, 40, 'human') as Settlement;
  expect(typeof s).toBe('object');
  const civ = s.civ!;
  civ.stage = 'village';
  civ.food = 60;
  civ.wood = 60;
  civ.stone = 60;
  return { sim, s, civ };
}

function put(civ: Civ, type: BuildingType, x: number, y: number, level = 1): Building {
  const b: Building = {
    id: civ.nextBuildingId++, type, x, y, started: 0, progress: 6, needed: 6, done: true, reserve: 0, acc: 0, active: false, idle: 0, empty: false, here: 0,
    level, up: 0,
  };
  civ.buildings.push(b);
  return b;
}

/** Runs settlement steps until the condition holds; returns the steps taken (-1 = never). */
function until(sim: Simulation, cond: () => boolean, max = 80): number {
  for (let k = 1; k <= max; k++) {
    steps(sim, 1);
    if (cond()) return k;
  }
  return -1;
}

function checkJobs(s: Settlement): void {
  const c = s.civ!;
  const ids = c.jobs.map((j) => j.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const j of c.jobs) {
    expect(s.members).toContain(j.id);
    expect(c.buildings.some((b) => b.id === j.b)).toBe(true);
  }
  for (const b of c.buildings) expect(c.jobs.filter((j) => j.b === b.id).length).toBeLessThanOrEqual(slotsOf(b));
}

describe('house levels', () => {
  it('older houses load as level 1 huts; invalid levels and upgrades are cleaned up', () => {
    const world = flat(40, 40);
    const old = importCiv({ buildings: [{ id: 1, type: 'house', x: 5, y: 5, done: true, progress: 6, needed: 6 }] }, world);
    expect(old.buildings[0].level).toBe(1);
    expect(old.buildings[0].up).toBe(0);
    expect(housing(old)).toBe(BASE_CAPACITY + HOUSE_CAPACITY);
    const bad = importCiv({
      buildings: [
        { id: 1, type: 'house', x: 5, y: 5, done: true, progress: 2, needed: 6, level: 99, up: 7 },
        { id: 2, type: 'house', x: 6, y: 5, done: true, progress: 2, needed: 6, level: 2, up: 4 }, // skipping a level is invalid
        { id: 3, type: 'farm', x: 7, y: 5, done: true, progress: 5, needed: 5, level: 3, up: 2 },
        { id: 4, type: 'house', x: 8, y: 5, done: false, progress: 2, needed: 6, level: 1, up: 2 }, // a site cannot be upgraded
        { id: 5, type: 'house', x: 9, y: 5, done: true, progress: 3, needed: 8, level: 2, up: 3 }, // a valid upgrade in progress
      ],
    }, world);
    const [a, b, f, site, ok] = bad.buildings;
    expect(a.level).toBe(MAX_HOUSE_LEVEL);
    expect(a.up).toBe(0);
    expect(a.progress).toBe(a.needed);
    expect(b.up).toBe(0);
    expect(f.level).toBe(1);
    expect(f.up).toBe(0);
    expect(site.up).toBe(0);
    expect(ok.up).toBe(3);
    expect(ok.progress).toBe(3);
  });

  it('the allowed level follows stage and Better building', () => {
    const { civ } = village();
    civ.stage = 'camp';
    expect(maxHouseLevel(civ)).toBe(1);
    civ.stage = 'village';
    expect(maxHouseLevel(civ)).toBe(2);
    civ.techs.push('construction');
    expect(maxHouseLevel(civ)).toBe(3);
    civ.stage = 'town';
    expect(maxHouseLevel(civ)).toBe(4);
    civ.techs = [];
    expect(maxHouseLevel(civ)).toBe(2);
  });

  it('upgrades need a finished house, the right stage and the resources', () => {
    const { civ } = village();
    expect(upgradeBlock(civ)).toBe('none');
    civ.stage = 'camp';
    put(civ, 'house', 38, 38);
    expect(upgradeBlock(civ)).toBe('level'); // a camp keeps huts
    civ.stage = 'village';
    civ.wood = upgradeCost(civ, 2).wood - 1;
    const before = { wood: civ.wood, stone: civ.stone };
    expect(startUpgrade(civ)).toBe('resources');
    expect({ wood: civ.wood, stone: civ.stone }).toEqual(before);
    expect(civ.buildings[0].up).toBe(0);
    // Level 3 also needs stone.
    civ.techs.push('construction');
    civ.buildings[0].level = 2;
    civ.wood = 100;
    civ.stone = upgradeCost(civ, 3).stone - 1;
    expect(upgradeBlock(civ)).toBe('resources');
    civ.stone = 100;
    expect(upgradeBlock(civ)).toBeNull();
    // Highest level allowed: nothing to do.
    civ.buildings[0].level = 3;
    expect(upgradeBlock(civ)).toBe('level');
  });

  it('pays exactly once, takes builders and time, and upgrades the same house in place', () => {
    const { sim, s, civ } = village(10);
    const house = put(civ, 'house', 38, 38);
    const ids = civ.buildings.map((b) => b.id);
    const cap0 = housing(civ);
    const wood0 = civ.wood;
    const r = sim.settlements.upgradeHouse(s);
    expect(r).toBe(house);
    expect(civ.wood).toBe(wood0 - upgradeCost(civ, 2).wood);
    expect(house.up).toBe(2);
    expect(house.needed).toBe(upgradeSteps(civ, 2));
    expect(housing(civ)).toBe(cap0); // the house keeps its people and capacity while it is upgraded
    expect(constructions(civ)).toBe(1);
    // A second request cannot pay for the same upgrade again.
    expect(startUpgrade(civ)).toBe('level');
    const paid = civ.wood;
    let last = 0;
    const took = until(sim, () => {
      expect(house.progress).toBeGreaterThanOrEqual(last); // progress only goes forward
      last = house.progress;
      checkJobs(s);
      return house.up === 0;
    });
    expect(took).toBeGreaterThanOrEqual(Math.ceil(upgradeSteps(civ, 2) / (BUILDERS * 0.5)));
    expect(house.level).toBe(2);
    expect(civ.wood).toBe(paid); // nothing more was taken (no lumber camp: no other wood income)
    expect(housing(civ)).toBe(cap0 - HOUSE_CAPACITY + HOUSE_LEVELS[2].capacity);
    expect(civ.buildings.map((b) => b.id)).toEqual(ids); // no duplicate, same identity
    expect(civ.buildings.filter((b) => b.type === 'house').length).toBe(1);
    expect(sim.history.filter((h) => h.code === 'settlement_house_upgraded').length).toBe(1);
    expect(sim.history.filter((h) => h.code === 'settlement_housing_tier').length).toBe(1);
    // Builders are free again.
    steps(sim, 1);
    expect(civ.jobs.some((j) => j.b === house.id)).toBe(false);
  });

  it('an upgrade neither creates nor removes people', () => {
    const { sim, s, civ } = village(10);
    const house = put(civ, 'house', 38, 38);
    sim.settlements.upgradeHouse(s);
    const before = { members: [...s.members].sort(), born: s.born, died: s.died, joined: s.joined, left: s.left, count: sim.creatures.count };
    for (let k = 0; k < 60 && house.up; k++) {
      const pop = s.members.length;
      steps(sim, 1);
      // Any change in members is explained by births, deaths, joins or departures, never by the upgrade.
      expect(s.members.length - pop).toBe(0 + (s.born - before.born) + (s.joined - before.joined) - (s.died - before.died) - (s.left - before.left) - (pop - before.members.length));
    }
    expect(house.up).toBe(0);
    expect(s.members.length).toBe(before.members.length + s.born - before.born + s.joined - before.joined - s.died + before.died - s.left + before.left);
    void civ;
  });

  it('builders are shared with building sites under the same limits', () => {
    const { sim, s, civ } = village(12);
    put(civ, 'house', 38, 38);
    put(civ, 'house', 39, 42);
    put(civ, 'farm', 42, 42);
    expect(typeof sim.settlements.upgradeHouse(s)).toBe('object');
    expect(typeof sim.settlements.build(sim.world, s, 'house', sim.tick)).toBe('object');
    expect(constructions(civ)).toBe(MAX_CONSTRUCTIONS);
    expect(sim.settlements.upgradeHouse(s)).toBe('busy');
    expect(sim.settlements.build(sim.world, s, 'house', sim.tick)).toBe('busy');
    const up = civ.buildings.find((b) => b.up)!;
    let builders = civ.jobs.filter((j) => j.b === up.id);
    for (let k = 0; k < 10 && !builders.length; k++) {
      steps(sim, 1);
      checkJobs(s);
      builders = civ.jobs.filter((j) => j.b === up.id);
    }
    expect(builders.length).toBeGreaterThan(0);
    expect(builders.length).toBeLessThanOrEqual(BUILDERS);
    for (const j of builders) expect(jobOf(civ, j.id)!.kind).toBe('build');
  });

  it('a house destroyed during its upgrade leaves no job, no site and no capacity behind', () => {
    const { sim, s, civ } = village(10);
    const house = put(civ, 'house', 38, 38);
    sim.settlements.upgradeHouse(s);
    until(sim, () => civ.jobs.some((j) => j.b === house.id));
    const builders = civ.jobs.filter((j) => j.b === house.id).map((j) => j.id);
    sim.world.fire[house.y * sim.world.width + house.x] = 50;
    steps(sim, 1);
    expect(civ.buildings.includes(house)).toBe(false);
    expect(civ.jobs.some((j) => j.b === house.id)).toBe(false);
    expect(constructions(civ)).toBe(0);
    expect(housing(civ)).toBe(BASE_CAPACITY);
    for (const id of builders) expect(sim.settlements.workGoal(id)).not.toBe(house.y * sim.world.width + house.x);
    expect(sim.history.some((h) => h.code === 'settlement_destroyed_fire')).toBe(true);
  });
});

describe('self-running settlements', () => {
  it('upgrade only with auto on, one house at a time, when housing is nearly full and reserves stay', () => {
    const on = village(12, true);
    const houses = [put(on.civ, 'house', 38, 38), put(on.civ, 'house', 39, 42)];
    put(on.civ, 'farm', 42, 42);
    put(on.civ, 'lumber', 44, 40);
    on.civ.buildings.length = Math.min(on.civ.buildings.length, 4);
    // 12 people, housing 20: not full, so no upgrade.
    expect(wantsUpgrade(on.civ, on.s.members.length)).toBe(false);
    // Fill housing: 19 people would be enough; simulate by asking with that population.
    expect(wantsUpgrade(on.civ, housing(on.civ) - 1)).toBe(true);
    // Low food blocks it (survival first).
    on.civ.food = 5;
    expect(wantsUpgrade(on.civ, housing(on.civ) - 1)).toBe(false);
    on.civ.food = 60;
    // Paying must leave a wood reserve.
    on.civ.wood = upgradeCost(on.civ, 2).wood + 5;
    expect(wantsUpgrade(on.civ, housing(on.civ) - 1)).toBe(false);
    on.civ.wood = 60;
    // With one upgrade under way, no second one.
    startUpgrade(on.civ);
    expect(houses.filter((h) => h.up).length).toBe(1);
    expect(wantsUpgrade(on.civ, housing(on.civ) - 1)).toBe(false);
  });

  it('a settlement left alone grows its houses over time; with auto off nothing is upgraded', () => {
    const grow = (auto: boolean) => {
      const sim = quiet(civWorld());
      sim.settlements.auto = auto;
      sim.spawnInCircle(HUMAN, 40, 40, 4, 12);
      const s = sim.foundSettlement(40, 40, 'human') as Settlement;
      const civ = s.civ!;
      civ.food = 60;
      civ.wood = 60;
      put(civ, 'house', 38, 38);
      put(civ, 'house', 39, 42);
      run(sim, 480 * 8); // 0.18 layout: buildings are farther apart, so the first upgrade comes a little later
      return { sim, civ };
    };
    const on = grow(true);
    const off = grow(false);
    expect(off.civ.buildings.every((b) => b.type !== 'house' || (b.level === 1 && b.up === 0))).toBe(true);
    expect(off.sim.history.some((h) => h.code === 'settlement_house_upgraded')).toBe(false);
    // Auto on: once a village, its houses start to become wooden houses.
    expect(on.civ.stage).not.toBe('camp');
    expect(on.civ.buildings.some((b) => b.type === 'house' && (b.level >= 2 || b.up >= 2))).toBe(true);
    for (const b of on.civ.buildings) if (b.type === 'house') expect(b.level).toBeLessThanOrEqual(maxHouseLevel(on.civ));
  });
});

describe('saves and determinism', () => {
  it('saving during an upgrade keeps cost, progress and builders, and the world continues exactly', () => {
    const { sim, s, civ } = village(10);
    const house = put(civ, 'house', 38, 38);
    sim.settlements.upgradeHouse(s);
    until(sim, () => house.progress > 0);
    expect(house.up).toBe(2);
    const other = quiet(flat(8, 8));
    deserializeInto(other, serialize(sim));
    expect(other.settlements.exportState()).toEqual(sim.settlements.exportState());
    const h2 = other.settlements.list[0].civ!.buildings.find((b) => b.id === house.id)!;
    expect(h2.up).toBe(2);
    expect(h2.progress).toBe(house.progress);
    run(sim, 400);
    run(other, 400);
    expect(other.settlements.exportState()).toEqual(sim.settlements.exportState());
    expect(house.up).toBe(0);
    expect(house.level).toBe(2);
  });

  it('is deterministic with upgrades', () => {
    const make = () => {
      const { sim, s, civ } = village(12, true);
      put(civ, 'house', 38, 38);
      put(civ, 'farm', 42, 42);
      put(civ, 'lumber', 44, 40);
      sim.settlements.upgradeHouse(s);
      run(sim, 1200);
      return JSON.stringify(sim.settlements.exportState());
    };
    expect(make()).toBe(make());
  });

  it('upgradeTarget picks the lowest level, then the oldest house', () => {
    const { civ } = village();
    civ.techs.push('construction');
    const a = put(civ, 'house', 38, 38, 2);
    const b = put(civ, 'house', 39, 42, 1);
    put(civ, 'house', 37, 42, 1);
    expect(upgradeTarget(civ)).toBe(b);
    b.level = 3;
    expect(upgradeTarget(civ)!.level).toBe(1);
    void a;
  });
});
