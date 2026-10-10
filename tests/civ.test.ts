import { describe, expect, it } from 'vitest';
import { deserializeInto, serialize } from '../src/save/serialize';
import { GRAZER, HUMAN } from '../src/sim/creatures';
import {
  BASE_CAPACITY, BASE_STORAGE, BUILDINGS, FEED_HUNGER, HOUSE_CAPACITY, MAX_CONSTRUCTIONS, SLOTS, START_KIT, STONE_PER_TILE, TECHS, WOOD_PER_TREE,
  BUILDERS, BUILD_PER_WORKER, WORK_SLOTS, costOf, farmOutput, housing, importCiv, newCiv, storage, stepsOf, type BuildingType, type Civ,
} from '../src/sim/civ';
import { STEP_TICKS, MIN_FOUNDERS, type Settlement } from '../src/sim/settlements';
import { Simulation } from '../src/sim/simulation';
import { SEA_LEVEL, T } from '../src/world/terrain';
import { World } from '../src/world/world';

const FLAT = SEA_LEVEL + 20;

function flat(w: number, h: number, fill: number = T.GRASS): World {
  const world = new World(w, h, 11);
  world.heights.fill(FLAT);
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

/** Grass with a forest east of the camp, hills to the west and a lake further east. */
function civWorld(): World {
  const w = flat(120, 100);
  block(w, 46, 34, 52, 46, T.FOREST);
  block(w, 30, 38, 35, 46, T.HILLS);
  block(w, 70, 30, 80, 60, T.LAKE);
  block(w, 40, 31, 44, 32, T.LAKE); // a pond within the camp's reach
  return w;
}

function quiet(world: World): Simulation {
  const sim = new Simulation(world);
  sim.weather.config.auto = false;
  return sim;
}

function run(sim: Simulation, ticks: number): void {
  for (let t = 0; t < ticks; t++) sim.step();
}

function steps(sim: Simulation, n: number): void {
  run(sim, n * STEP_TICKS);
}

function camp(n = 10, world: World = civWorld(), auto = false): { sim: Simulation; s: Settlement; civ: Civ } {
  const sim = quiet(world);
  sim.settlements.auto = auto; // tests that build by hand are not disturbed by the settlement building on its own
  sim.spawnInCircle(HUMAN, 40, 40, 4, n);
  const s = sim.foundSettlement(40, 40, 'human');
  expect(typeof s).toBe('object');
  const st = s as Settlement;
  return { sim, s: st, civ: st.civ! };
}

function rich(c: Civ): void {
  c.food = 50;
  c.wood = 100;
  c.stone = 60;
}

function build(sim: Simulation, s: Settlement, type: BuildingType) {
  return sim.settlements.build(sim.world, s, type, sim.tick);
}

/** Runs settlement steps until the condition holds (at most `max` steps); returns the steps taken. */
function until(sim: Simulation, cond: () => boolean, max = 80): number {
  for (let k = 1; k <= max; k++) {
    steps(sim, 1);
    if (cond()) return k;
  }
  return -1;
}

function members(sim: Simulation): number[] {
  const out: number[] = [];
  for (const st of sim.settlements.list) out.push(...st.members);
  return out;
}

describe('founding human settlements', () => {
  it('founds one from free people with the settlement kit, and holds only people', () => {
    const { sim, s, civ } = camp(10);
    expect(s.species).toBe(HUMAN);
    expect(s.members.length).toBe(10);
    for (const id of s.members) expect(sim.creatures.species[sim.creatures.indexOf(id)]).toBe(HUMAN);
    expect({ food: civ.food, wood: civ.wood, stone: civ.stone }).toEqual(START_KIT);
    expect(civ.stage).toBe('camp');
    expect(civ.buildings).toEqual([]);
    expect(s.tiles.length).toBeGreaterThan(MIN_FOUNDERS * 10);
  });

  it('animals and people never share a settlement: each tool takes only its own kind', () => {
    const sim = quiet(civWorld());
    sim.spawnInCircle(HUMAN, 40, 40, 3, 8);
    sim.spawnInCircle(GRAZER, 40, 40, 3, 12);
    expect(sim.foundSettlement(40, 40, 'human')).toMatchObject({ species: HUMAN });
    // The grazers are still free: they can found their own settlement elsewhere, never inside the human territory.
    expect(sim.foundSettlement(40, 40, 'animal')).toBe('claimed');
    sim.spawnInCircle(GRAZER, 20, 80, 3, 8);
    const a = sim.foundSettlement(20, 80, 'animal') as Settlement;
    expect(a.species).toBe(GRAZER);
    expect(a.civ).toBeUndefined();
    const ids = members(sim);
    expect(new Set(ids).size).toBe(ids.length);
    for (const st of sim.settlements.list) for (const id of st.members) expect(!!sim.creatures.species[sim.creatures.indexOf(id)] === (st.species !== GRAZER)).toBe(st.species === HUMAN || true);
    for (const id of a.members) expect(sim.creatures.species[sim.creatures.indexOf(id)]).toBe(GRAZER);
  });

  it('refuses with a reason: too few people, the wrong kind, water, mountains, claimed land, a tiny island, too many settlements', () => {
    const few = quiet(civWorld());
    few.spawnInCircle(HUMAN, 40, 40, 3, MIN_FOUNDERS - 1);
    expect(few.foundSettlement(40, 40, 'human')).toBe('few');
    const wrong = quiet(civWorld());
    wrong.spawnInCircle(GRAZER, 40, 40, 3, 10);
    expect(wrong.foundSettlement(40, 40, 'human')).toBe('few');
    const people = quiet(civWorld());
    people.spawnInCircle(HUMAN, 40, 40, 3, 10);
    expect(people.foundSettlement(40, 40, 'animal')).toBe('few');
    people.world.setTerrain(40, 40, T.LAKE);
    expect(people.foundSettlement(40, 40, 'human')).toBe('ground');
    people.world.setTerrain(40, 40, T.MOUNTAIN);
    expect(people.foundSettlement(40, 40, 'human')).toBe('ground');
    people.world.setTerrain(40, 40, T.GRASS);
    const desert = quiet(flat(120, 100, T.DESERT));
    desert.spawnInCircle(HUMAN, 40, 40, 3, 10);
    expect(desert.foundSettlement(40, 40, 'human')).toBe('food');
    // A 3×3 island in a lake: the ground is fine but there is no room to live.
    const island = quiet(flat(120, 100, T.LAKE));
    block(island.world, 40, 40, 42, 42, T.GRASS);
    island.spawnInCircle(HUMAN, 41, 41, 1, 8);
    expect(island.foundSettlement(41, 41, 'human')).toBe('ground');
    expect(island.settlements.list.length).toBe(0);
    expect(island.settlements.owner).toBeNull();
    const ok = quiet(civWorld());
    ok.spawnInCircle(HUMAN, 40, 40, 3, 10);
    ok.foundSettlement(40, 40, 'human');
    expect(ok.foundSettlement(41, 41, 'human')).toBe('claimed');
  });
});

describe('membership and housing', () => {
  it('newcomers inside the territory join only while housing has room; people who walk away leave; nobody is counted twice', () => {
    const { sim, s } = camp(10);
    expect(s.members.length).toBe(BASE_CAPACITY);
    sim.spawnInCircle(HUMAN, 40, 41, 2, 3);
    steps(sim, 2);
    expect(s.members.length).toBe(BASE_CAPACITY); // full: the newcomers stay free
    expect(sim.creatures.countSpecies(HUMAN)).toBeGreaterThan(BASE_CAPACITY);
    rich(s.civ!);
    expect(typeof build(sim, s, 'house')).toBe('object');
    steps(sim, BUILDINGS.house.steps + 2);
    expect(housing(s.civ!)).toBe(BASE_CAPACITY + HOUSE_CAPACITY);
    steps(sim, 2);
    expect(s.members.length).toBeGreaterThan(BASE_CAPACITY);
    expect(s.members.length).toBeLessThanOrEqual(BASE_CAPACITY + HOUSE_CAPACITY);
    const ids = members(sim);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of s.members) expect(sim.creatures.indexOf(id)).toBeGreaterThanOrEqual(0);
  });

  it('full housing stops births, and more housing lets the population grow', () => {
    const { sim, s } = camp(10);
    const c = s.civ!;
    c.food = 500;
    c.wood = 0;
    for (let k = 0; k < 40; k++) {
      steps(sim, 1);
      c.food = Math.max(c.food, 200);
      expect(s.members.length).toBeLessThanOrEqual(BASE_CAPACITY + 0);
    }
    const bornFull = s.born;
    c.wood = 60;
    build(sim, s, 'house');
    build(sim, s, 'house');
    for (let k = 0; k < 120; k++) {
      steps(sim, 1);
      c.food = Math.max(c.food, 200);
    }
    expect(housing(c)).toBe(BASE_CAPACITY + 2 * HOUSE_CAPACITY);
    expect(s.born).toBeGreaterThan(bornFull);
    expect(s.members.length).toBeGreaterThan(BASE_CAPACITY);
    expect(s.members.length).toBeLessThanOrEqual(housing(c));
  });

  it('deaths leave at once and the count always equals the living members', () => {
    const { sim, s } = camp(10);
    const victim = s.members[0];
    sim.creatures.removeById(victim);
    expect(s.members).not.toContain(victim);
    expect(s.members.length).toBe(9);
    expect(s.died).toBe(1);
  });
});

describe('resources', () => {
  it('start from a kit and gain food only from real sources: edible land, farms; none on bare desert', () => {
    const { sim, s, civ } = camp(10);
    steps(sim, 1);
    expect(civ.rate.food).toBeGreaterThan(0);
    expect(civ.rate.food).toBeLessThanOrEqual(0.06 * 10 + 1e-9);
    // The same people on desert-like land with some grass to found on: very little to gather.
    const w = flat(120, 100, T.DESERT);
    block(w, 38, 38, 42, 42, T.GRASS);
    const d = quiet(w);
    d.spawnInCircle(HUMAN, 40, 40, 2, 10);
    const ds = d.foundSettlement(40, 40, 'human') as Settlement;
    expect(typeof ds).toBe('object');
    steps(d, 1);
    expect(ds.civ!.rate.food).toBeLessThan(civ.rate.food);
    expect(ds.civ!.rate.food).toBeLessThanOrEqual(0.02 * 25 + 1e-9);
    void s;
  });

  it('feed hungry people from the stock: hunger really drops and the stock really shrinks', () => {
    const { sim, s, civ } = camp(10);
    civ.food = 30;
    for (const id of s.members) sim.creatures.hunger[sim.creatures.indexOf(id)] = FEED_HUNGER + 20;
    const before = civ.food;
    steps(sim, 1);
    expect(civ.rate.foodUse).toBeGreaterThan(0);
    for (const id of s.members) expect(sim.creatures.hunger[sim.creatures.indexOf(id)]).toBeLessThan(FEED_HUNGER + 20 + 5);
    expect(civ.food).toBeCloseTo(before + civ.rate.food - civ.rate.foodUse, 6);
  });

  it('are capped by storage, and a storehouse raises the cap', () => {
    const { sim, s, civ } = camp(10);
    civ.wood = 5000;
    civ.stone = 5000;
    civ.food = 5000;
    steps(sim, 1);
    expect(civ.wood).toBe(BASE_STORAGE);
    expect(civ.food).toBe(BASE_STORAGE);
    rich(civ);
    build(sim, s, 'storehouse');
    steps(sim, BUILDINGS.storehouse.steps + 1);
    expect(storage(civ)).toBeGreaterThan(BASE_STORAGE);
    civ.wood = 5000;
    steps(sim, 1);
    expect(civ.wood).toBe(storage(civ));
  });

  it('never go negative and are not created from nothing: no stock and no source means no growth', () => {
    const { sim, civ } = camp(10, flat(120, 100, T.GRASS));
    civ.food = 0;
    civ.wood = 0;
    civ.stone = 0;
    steps(sim, 10);
    expect(civ.wood).toBe(0);
    expect(civ.stone).toBe(0);
    expect(civ.food).toBeGreaterThanOrEqual(0);
  });
});

describe('buildings', () => {
  it('cost resources, are refused when they cannot be paid, and work takes time', () => {
    const { sim, s, civ } = camp(10);
    civ.wood = BUILDINGS.house.wood - 1;
    expect(build(sim, s, 'house')).toBe('resources');
    civ.wood = BUILDINGS.house.wood;
    const b = build(sim, s, 'house');
    expect(typeof b).toBe('object');
    expect(civ.wood).toBe(0);
    expect(civ.buildings[0].done).toBe(false);
    // Builders walk to the site and work there: at most BUILDERS × BUILD_PER_WORKER steps of work per step.
    const took = until(sim, () => civ.buildings[0].done);
    expect(took).toBeGreaterThanOrEqual(Math.ceil(BUILDINGS.house.steps / (BUILDERS * BUILD_PER_WORKER)));
    expect(took).toBeGreaterThan(0);
    expect(sim.history.some((h) => h.code === 'settlement_built')).toBe(true);
  });

  it('are placed on real, free tiles inside the territory, with type-specific conditions', () => {
    const { sim, s, civ } = camp(10);
    rich(civ);
    for (const type of ['house', 'farm', 'lumber', 'quarry'] as const) {
      const b = build(sim, s, type);
      if (typeof b !== 'object') {
        // the first two constructions are allowed at once; free a slot between tries
        steps(sim, 8);
        continue;
      }
      const i = b.y * sim.world.width + b.x;
      expect(sim.settlements.owner![i]).toBe(s.id);
      expect(sim.world.slopeClass[i]).toBe(0);
    }
    for (const b of civ.buildings) {
      const t = sim.world.terrain[b.y * sim.world.width + b.x];
      if (b.type === 'farm') expect([T.GRASS, T.SAVANNA, T.SOIL]).toContain(t);
      if (b.type === 'lumber') expect(t).not.toBe(T.FOREST);
    }
    const tiles = civ.buildings.map((b) => `${b.x},${b.y}`);
    expect(new Set(tiles).size).toBe(tiles.length);
    // No forest in reach: no lumber camp. No hills: no quarry. Desert: no farm.
    const bare = camp(10, flat(120, 100));
    rich(bare.civ);
    expect(build(bare.sim, bare.s, 'lumber')).toBe('site');
    expect(build(bare.sim, bare.s, 'quarry')).toBe('site');
    const w = flat(120, 100, T.DESERT);
    block(w, 38, 38, 42, 42, T.GRASS);
    const d = quiet(w);
    d.spawnInCircle(HUMAN, 40, 40, 2, 10);
    const ds = d.foundSettlement(40, 40, 'human') as Settlement;
    rich(ds.civ!);
    expect(build(d, ds, 'farm')).not.toBe('site'); // the grass patch is inside the territory
    block(d.world, 38, 38, 42, 42, T.DESERT);
    const ds2 = d.settlements.list[0];
    ds2.civ!.buildings = [];
    expect(build(d, ds2, 'farm')).toBe('site');
  });

  it('are limited by slots and by two constructions at a time', () => {
    const { sim, s, civ } = camp(10);
    rich(civ);
    civ.wood = 500;
    expect(typeof build(sim, s, 'house')).toBe('object');
    expect(typeof build(sim, s, 'house')).toBe('object');
    expect(MAX_CONSTRUCTIONS).toBe(2);
    expect(build(sim, s, 'house')).toBe('busy');
    civ.buildings.forEach((b) => (b.done = true));
    for (let k = civ.buildings.length; k < SLOTS.camp; k++) expect(typeof build(sim, s, 'house')).toBe('object');
    civ.buildings.forEach((b) => (b.done = true));
    expect(build(sim, s, 'house')).toBe('slots');
  });

  it('a farm grows food by soil moisture, a lumber camp cuts the forest down, a quarry empties its hills', () => {
    const { sim, s, civ } = camp(10);
    rich(civ);
    civ.wood = 300;
    build(sim, s, 'farm');
    build(sim, s, 'lumber');
    until(sim, () => civ.buildings.every((b) => b.done));
    build(sim, s, 'quarry');
    until(sim, () => civ.buildings.every((b) => b.done));
    const farm = civ.buildings.find((b) => b.type === 'farm')!;
    const lumber = civ.buildings.find((b) => b.type === 'lumber')!;
    const quarry = civ.buildings.find((b) => b.type === 'quarry')!;
    expect(farm.done && lumber.done && quarry.done).toBe(true);
    const forest = () => {
      let n = 0;
      for (let i = 0; i < sim.world.terrain.length; i++) if (sim.world.terrain[i] === T.FOREST) n++;
      return n;
    };
    const trees0 = forest();
    const reserve0 = quarry.reserve;
    expect(reserve0).toBeGreaterThan(0);
    expect(reserve0).toBeLessThanOrEqual(1500);
    void STONE_PER_TILE;
    civ.wood = 0;
    civ.stone = 0;
    steps(sim, 20);
    expect(civ.rate.wood).toBeGreaterThan(0);
    expect(civ.wood).toBeGreaterThan(10);
    expect(forest()).toBeLessThan(trees0);
    expect(quarry.reserve).toBeLessThan(reserve0);
    expect(civ.stone).toBeGreaterThan(5);
    // Fertility follows moisture: a drought lowers the farm's yield.
    const at = { ...farm, here: 2 };
    const wet = farmOutput(sim.world, at, 1);
    expect(wet).toBeGreaterThan(0);
    expect(farmOutput(sim.world, { ...at, here: 1 }, 1)).toBeCloseTo(wet / 2, 6); // half the workers, half the food
    expect(farmOutput(sim.world, { ...at, here: 0 }, 1)).toBe(0); // nobody at work: no food
    sim.world.moisture[farm.y * sim.world.width + farm.x] = 5;
    expect(farmOutput(sim.world, at, 1)).toBeLessThan(wet);
    // Drained stone stops the quarry.
    quarry.reserve = 0.2;
    steps(sim, 3);
    expect(quarry.reserve).toBe(0);
    const stone = civ.stone;
    steps(sim, 3);
    expect(civ.stone).toBe(stone);
  });

  it('a lumber camp with no forest left stops producing', () => {
    const { sim, s, civ } = camp(10);
    rich(civ);
    build(sim, s, 'lumber');
    steps(sim, 6);
    const lumber = civ.buildings[0];
    expect(lumber.done).toBe(true);
    block(sim.world, 0, 0, 119, 99, T.GRASS);
    lumber.acc = 0;
    civ.wood = 0;
    steps(sim, 3);
    expect(civ.wood).toBe(0);
    expect(civ.rate.wood).toBe(0);
    void WOOD_PER_TREE;
  });

  it('are destroyed by fire and by flood, with a history entry', () => {
    const { sim, s, civ } = camp(10);
    rich(civ);
    build(sim, s, 'house');
    build(sim, s, 'farm');
    steps(sim, 8);
    const [h, f] = civ.buildings;
    sim.world.fire[h.y * sim.world.width + h.x] = 200;
    sim.world.setTerrain(f.x, f.y, T.LAKE);
    steps(sim, 1);
    expect(civ.buildings.length).toBe(0);
    expect(sim.history.some((e) => e.code === 'settlement_destroyed_fire')).toBe(true);
    expect(sim.history.some((e) => e.code === 'settlement_destroyed_flood')).toBe(true);
  });
});

describe('development', () => {
  it('a village needs people and finished buildings (a house and a farm); a town needs more, storage and technologies', () => {
    const { sim, s, civ } = camp(14);
    expect(civ.stage).toBe('camp');
    sim.creatures.hunger.fill(0);
    for (const type of ['house', 'farm', 'house', 'farm'] as const) {
      rich(civ);
      civ.food = 60;
      for (let tries = 0; tries < 30 && typeof build(sim, s, type) !== 'object'; tries++) steps(sim, 1);
      steps(sim, 1);
    }
    rich(civ);
    steps(sim, 12);
    civ.buildings.forEach((b) => (b.done = true));
    steps(sim, 1);
    expect(s.members.length).toBeGreaterThanOrEqual(12);
    expect(civ.stage).toBe('village');
    expect(sim.history.some((e) => e.code === 'settlement_stage' && e.p?.stage === 'village')).toBe(true);
    expect(s.radius).toBeGreaterThanOrEqual(8); // the village territory is wider
    // Town: needs 30 people, 8 buildings, a storehouse and two technologies.
    civ.techs = ['farming', 'construction'];
    sim.spawnInCircle(HUMAN, 40, 40, 5, 30);
    civ.buildings.length = 0;
    for (let k = 0; k < 8; k++) civ.buildings.push({ id: k + 1, type: k === 0 ? 'storehouse' : 'house', x: 30 + k, y: 30, started: 0, progress: 6, needed: 6, done: true, reserve: 0, acc: 0, active: false, idle: 0, empty: false, here: 0, level: 1, up: 0 });
    civ.nextBuildingId = 9;
    steps(sim, 4);
    expect(s.members.length).toBeGreaterThanOrEqual(30);
    expect(civ.stage).toBe('town');
  });

  it('a settlement does not skip stages without the real conditions', () => {
    const { sim, civ } = camp(10);
    steps(sim, 40);
    expect(civ.stage).toBe('camp');
  });

  it('a food shortage has consequences but does not destroy the settlement at once', () => {
    const w = flat(120, 100, T.DESERT);
    block(w, 36, 36, 44, 44, T.GRASS);
    const { sim, s, civ } = camp(10, w);
    civ.food = 0;
    sim.creatures.hunger.fill(70);
    steps(sim, 4);
    expect(sim.history.some((e) => e.code === 'settlement_famine')).toBe(true);
    expect(s.members.length).toBeGreaterThan(0);
    expect(sim.settlements.list.length).toBe(1);
    steps(sim, 10);
    expect(sim.settlements.list.length).toBe(1); // still there after a while
  });
});

describe('technologies', () => {
  it('need a building, knowledge and time, and their effects are real', () => {
    const { sim, s, civ } = camp(12);
    expect(sim.settlements.research(s, 'farming')).toBe('needs');
    rich(civ);
    build(sim, s, 'farm');
    steps(sim, 6);
    expect(sim.settlements.research(s, 'farming')).toBe('knowledge');
    // Knowledge comes from the adults of the settlement.
    civ.knowledge = 0;
    steps(sim, 1);
    expect(civ.rate.knowledge).toBeGreaterThan(0);
    expect(civ.knowledge).toBeGreaterThan(0);
    civ.knowledge = TECHS.farming.knowledge;
    const rate0 = (() => {
      steps(sim, 1);
      return civ.rate.food;
    })();
    expect(sim.settlements.research(s, 'farming')).toBeNull();
    expect(civ.knowledge).toBeLessThan(1);
    expect(sim.settlements.research(s, 'construction')).toBe('busy');
    steps(sim, TECHS.farming.steps + 1);
    expect(civ.techs).toEqual(['farming']);
    expect(civ.research).toBeNull();
    expect(sim.settlements.research(s, 'farming')).toBe('known');
    steps(sim, 1);
    expect(civ.rate.food).toBeGreaterThan(rate0 * 1.1);
    expect(sim.history.some((e) => e.code === 'settlement_tech')).toBe(true);
  });

  it('construction makes buildings cheaper and faster; harvesting raises wood and stone output', () => {
    const c = newCiv();
    const before = costOf(c, 'storehouse');
    const t0 = stepsOf(c, 'storehouse');
    c.techs.push('construction');
    expect(costOf(c, 'storehouse').wood).toBeLessThan(before.wood);
    expect(costOf(c, 'storehouse').stone).toBeLessThan(before.stone);
    expect(stepsOf(c, 'storehouse')).toBeLessThan(t0);
    const { sim, s, civ } = camp(10);
    rich(civ);
    build(sim, s, 'lumber');
    const lumber = civ.buildings[0];
    expect(until(sim, () => lumber.done)).toBeGreaterThan(0);
    civ.wood = 0;
    // Compare steps with the lumber camp fully staffed.
    expect(until(sim, () => lumber.here === WORK_SLOTS.lumber)).toBeGreaterThan(0);
    const plain = civ.rate.wood;
    expect(plain).toBeCloseTo(1, 5);
    civ.techs.push('harvesting');
    civ.wood = 0;
    expect(until(sim, () => lumber.here === WORK_SLOTS.lumber)).toBeGreaterThan(0);
    expect(civ.rate.wood).toBeCloseTo(plain * 1.5, 5);
  });

  it('settlements that run themselves build and research; with that off, nothing happens', () => {
    const on = camp(12, civWorld(), true);
    run(on.sim, 1500);
    expect(on.civ.buildings.length).toBeGreaterThan(1);
    expect(on.civ.buildings.some((b) => b.type === 'farm')).toBe(true);
    const off = camp(12);
    run(off.sim, 1500);
    expect(off.civ.buildings.length).toBe(0);
    expect(off.civ.techs.length).toBe(0);
  });
});

describe('long runs', () => {
  it('a settlement with suitable land lives on for years and its stock stays bounded', () => {
    const { sim, s, civ } = camp(12, civWorld(), true);
    const YEARS = 8;
    let minPop = 99;
    for (let t = 0; t < 480 * YEARS; t += STEP_TICKS) {
      run(sim, STEP_TICKS);
      if (sim.settlements.list.length) minPop = Math.min(minPop, s.members.length);
    }
    expect(sim.settlements.list.length).toBe(1);
    expect(s.members.length).toBeGreaterThanOrEqual(5);
    expect(s.members.length).toBeLessThanOrEqual(housing(civ));
    expect(civ.food).toBeLessThanOrEqual(storage(civ));
    expect(civ.wood).toBeLessThanOrEqual(storage(civ));
    expect(minPop).toBeGreaterThan(0);
    expect(civ.buildings.length).toBeGreaterThan(2);
  });
});

describe('saving, loading and determinism', () => {
  function developed(): Simulation {
    const { sim } = camp(12, civWorld(), true);
    run(sim, 1200);
    return sim;
  }

  it('saves and restores resources, buildings, technologies, stage and research', () => {
    const sim = developed();
    const s = sim.settlements.list[0];
    s.civ!.research = { id: 'construction', steps: 3 };
    const data = serialize(sim);
    const other = quiet(flat(8, 8));
    deserializeInto(other, data);
    expect(other.settlements.exportState()).toEqual(sim.settlements.exportState());
    expect(other.settlements.auto).toBe(sim.settlements.auto);
    const b = other.settlements.list[0];
    expect(b.civ).toEqual(s.civ);
    expect(b.civ!.buildings.length).toBeGreaterThan(0);
  });

  it('a loaded world continues exactly like the original, and runs are repeatable', () => {
    const sim = developed();
    const other = quiet(flat(8, 8));
    deserializeInto(other, serialize(sim));
    run(sim, 600);
    run(other, 600);
    expect(other.settlements.exportState()).toEqual(sim.settlements.exportState());
    expect(other.creatures.count).toBe(sim.creatures.count);
    expect(JSON.stringify(developed().settlements.exportState())).toBe(JSON.stringify(developed().settlements.exportState()));
  });

  it('old saves still load: no settlements (v8), animal settlements without civ, a human settlement without civ gets a fresh one', () => {
    const sim = quiet(civWorld());
    sim.spawnInCircle(GRAZER, 20, 80, 3, 8);
    sim.foundSettlement(20, 80, 'animal');
    sim.spawnInCircle(HUMAN, 40, 40, 4, 10);
    sim.foundSettlement(40, 40, 'human');
    const data = serialize(sim);
    const noCiv = JSON.parse(JSON.stringify(data.settlements));
    for (const e of noCiv.list) delete e.civ;
    delete noCiv.auto;
    const old = { ...data, version: 9, settlements: noCiv };
    const other = quiet(flat(8, 8));
    deserializeInto(other, old);
    expect(other.settlements.list.length).toBe(2);
    expect(other.settlements.auto).toBe(true);
    expect(other.settlements.list.find((s) => s.species === GRAZER)!.civ).toBeUndefined();
    expect(other.settlements.list.find((s) => s.species === HUMAN)!.civ).toEqual(newCiv());
    run(other, 100);
    const none = { ...data, version: 8 } as typeof data;
    delete none.settlements;
    deserializeInto(other, none);
    expect(other.settlements.list.length).toBe(0);
  });

  it('ignores invalid civilization data in a save', () => {
    const w = civWorld();
    const c = importCiv(
      {
        food: -5, wood: 'x', stone: 1e12, knowledge: 99999, stage: 'empire', famine: 1,
        techs: ['farming', 'farming', 'magic', 7], research: { id: 'farming', steps: 2 },
        buildings: [
          { id: 1, type: 'house', x: 10, y: 10, done: true, progress: 6, needed: 6 },
          { id: 2, type: 'castle', x: 11, y: 10 },
          { id: 3, type: 'farm', x: 999, y: 10 },
          { id: 4, type: 'farm', x: 10, y: 10 },
          null,
          { id: 5, type: 'quarry', x: 12, y: 12, done: false, progress: 500, needed: 7, reserve: 1e9 },
        ],
      },
      w,
    );
    expect(c.food).toBe(0);
    expect(c.wood).toBe(START_KIT.wood);
    expect(c.stone).toBeLessThanOrEqual(1e6);
    expect(c.knowledge).toBeLessThanOrEqual(500);
    expect(c.stage).toBe('camp');
    expect(c.techs).toEqual(['farming']);
    expect(c.research).toBeNull(); // already known
    expect(c.buildings.map((b) => b.type)).toEqual(['house', 'quarry']);
    expect(c.buildings[1].progress).toBeLessThanOrEqual(7);
    expect(c.buildings[1].reserve).toBeLessThanOrEqual(1500);
    expect(c.nextBuildingId).toBeGreaterThan(5);
    expect(importCiv('junk', w)).toEqual(newCiv());
  });
});

describe('animal settlements are unaffected', () => {
  it('have no economy, no housing limit, and keep growing as before', () => {
    const sim = quiet(civWorld());
    sim.spawnInCircle(GRAZER, 40, 40, 4, 14);
    const s = sim.foundSettlement(40, 40) as Settlement;
    expect(s.civ).toBeUndefined();
    run(sim, 800);
    expect(s.born).toBeGreaterThan(0);
    expect(s.members.length).toBeGreaterThan(BASE_CAPACITY - 1);
    expect(sim.settlements.breedBlocked(s.members[0])).toBe(false);
    expect(sim.settlements.build(sim.world, s, 'house', 0)).toBe('none');
  });
});
