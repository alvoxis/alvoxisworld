import { describe, expect, it } from 'vitest';
import { deserializeInto, serialize } from '../src/save/serialize';
import {
  BUILDERS, FORAGE_PER_PERSON, FORAGE_PER_TILE, MIN_JOB_TICKS, WORK_RANGE, WORK_SLOTS, importCiv, jobOf, slotsOf, storage, type Building, type BuildingType, type Civ,
} from '../src/sim/civ';
import { GRAZER, HUMAN, SPECIES, STATE } from '../src/sim/creatures';
import { passable } from '../src/sim/pathfinding';
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

/** Grass with a forest east of the camp, hills to the west and a pond. */
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

function camp(n = 10, world: World = civWorld(), auto = false): { sim: Simulation; s: Settlement; civ: Civ } {
  const sim = quiet(world);
  sim.settlements.auto = auto;
  sim.spawnInCircle(HUMAN, 40, 40, 4, n);
  const s = sim.foundSettlement(40, 40, 'human') as Settlement;
  expect(typeof s).toBe('object');
  s.civ!.food = 60;
  s.civ!.wood = 200;
  s.civ!.stone = 60;
  return { sim, s, civ: s.civ! };
}

/** Adds a finished building on a given tile (as if built earlier). */
function put(civ: Civ, type: BuildingType, x: number, y: number): Building {
  const b: Building = { id: civ.nextBuildingId++, type, x, y, started: 0, progress: 5, needed: 5, done: true, reserve: type === 'quarry' ? 600 : 0, acc: 0, active: false, idle: 0, empty: false, here: 0, level: 1, up: 0 };
  civ.buildings.push(b);
  return b;
}

function checkJobs(sim: Simulation, s: Settlement): void {
  const civ = s.civ!;
  const ids = civ.jobs.map((j) => j.id);
  expect(new Set(ids).size).toBe(ids.length); // one job per worker
  for (const j of civ.jobs) {
    expect(s.members).toContain(j.id);
    const i = sim.creatures.indexOf(j.id);
    expect(sim.creatures.stage(i)).not.toBe('Juvenile');
    const b = civ.buildings.find((x) => x.id === j.b)!;
    expect(b).toBeTruthy();
  }
  for (const b of civ.buildings) expect(civ.jobs.filter((j) => j.b === b.id).length).toBeLessThanOrEqual(slotsOf(b) || 0);
}

describe('jobs', () => {
  it('adults get jobs at the buildings that need work, never more than the places, juveniles never', () => {
    const { sim, s, civ } = camp(10);
    const young = sim.creatures.indexOf(s.members[0]);
    sim.creatures.age[young] = 0;
    put(civ, 'farm', 42, 42);
    put(civ, 'lumber', 44, 40);
    put(civ, 'house', 38, 38);
    steps(sim, 1);
    checkJobs(sim, s);
    expect(civ.jobs.length).toBe(WORK_SLOTS.farm + WORK_SLOTS.lumber);
    expect(civ.jobs.some((j) => j.id === s.members[0])).toBe(false);
    expect(civ.jobs.filter((j) => j.b === civ.buildings[2].id).length).toBe(0); // a house needs no workers
    const kinds = civ.jobs.map((j) => jobOf(civ, j.id)!.kind).sort();
    expect(kinds).toEqual(['farm', 'farm', 'wood', 'wood']);
    // A building site takes builders.
    expect(typeof sim.settlements.build(sim.world, s, 'house', sim.tick)).toBe('object');
    for (let k = 0; k < 20 && civ.jobs.filter((j) => jobOf(civ, j.id)?.kind === 'build').length < BUILDERS; k++) steps(sim, 1);
    expect(civ.jobs.filter((j) => jobOf(civ, j.id)?.kind === 'build').length).toBe(BUILDERS);
    checkJobs(sim, s);
  });

  it('workers walk to their workplace on passable ground and work there', () => {
    const { sim, s, civ } = camp(8);
    const farm = put(civ, 'farm', 50, 50);
    const lumber = put(civ, 'lumber', 44, 40);
    const cls = SPECIES[HUMAN].move;
    for (let k = 0; k < 40; k++) {
      steps(sim, 1);
      for (const id of s.members) {
        const i = sim.creatures.indexOf(id);
        expect(passable(sim.world, cls, Math.floor(sim.creatures.x[i]), Math.floor(sim.creatures.y[i]))).toBe(true);
      }
      if (farm.here === WORK_SLOTS.farm && lumber.here === WORK_SLOTS.lumber) break;
    }
    expect(farm.here).toBe(WORK_SLOTS.farm);
    expect(lumber.here).toBe(WORK_SLOTS.lumber);
    for (const j of civ.jobs.filter((x) => x.b === farm.id)) {
      const i = sim.creatures.indexOf(j.id);
      expect(sim.creatures.state[i]).toBe(STATE.WORK);
      expect(Math.hypot(sim.creatures.x[i] - farm.x - 0.5, sim.creatures.y[i] - farm.y - 0.5)).toBeLessThanOrEqual(WORK_RANGE);
      expect(sim.settlements.workGoal(j.id)).toBe(farm.y * sim.world.width + farm.x);
    }
  });

  it('jobs are stable: workers keep their task instead of switching around', () => {
    const { sim, s, civ } = camp(10);
    put(civ, 'farm', 42, 42);
    put(civ, 'lumber', 44, 40);
    put(civ, 'quarry', 36, 42);
    steps(sim, 2);
    const first = new Map(civ.jobs.map((j) => [j.id, j.b]));
    let changes = 0;
    for (let k = 0; k < 60; k++) {
      steps(sim, 1);
      for (const j of civ.jobs) if (first.has(j.id) && first.get(j.id) !== j.b) changes++;
      checkJobs(sim, s);
    }
    expect(changes).toBe(0);
  });

  it('a new building site gets workers even when everyone is busy, one move per step', () => {
    const { sim, s, civ } = camp(6);
    put(civ, 'farm', 42, 42);
    put(civ, 'lumber', 44, 40);
    put(civ, 'quarry', 36, 42);
    steps(sim, 1);
    expect(civ.jobs.length).toBe(6);
    run(sim, MIN_JOB_TICKS);
    expect(typeof sim.settlements.build(sim.world, s, 'house', sim.tick)).toBe('object');
    const site = civ.buildings.find((b) => !b.done)!;
    const before = civ.jobs.filter((j) => j.b === site.id).length;
    steps(sim, 1);
    expect(civ.jobs.filter((j) => j.b === site.id).length).toBe(before + 1);
    checkJobs(sim, s);
  });

  it('nobody is sent to a building that cannot be reached', () => {
    const { sim, civ } = camp(10);
    // A lumber camp on an island across a lake.
    block(sim.world, 60, 20, 80, 60, T.LAKE);
    block(sim.world, 68, 38, 72, 42, T.GRASS);
    const far = put(civ, 'lumber', 70, 40);
    put(civ, 'farm', 42, 42);
    steps(sim, 3);
    expect(civ.jobs.filter((j) => j.b === far.id).length).toBe(0);
    expect(civ.jobs.length).toBe(WORK_SLOTS.farm);
  });

  it('a worker that does not get closer gives the job up and takes something else', () => {
    const { sim, s, civ } = camp(6);
    const farm = put(civ, 'farm', 42, 42);
    steps(sim, 1);
    const j = civ.jobs.find((x) => x.b === farm.id)!;
    // Freeze the worker far away (as if stuck behind something the regions do not know about).
    const i = sim.creatures.indexOf(j.id);
    for (let k = 0; k < 20; k++) {
      sim.creatures.x[i] = 36.5; // inside the territory, but away from the farm
      sim.creatures.y[i] = 48.5;
      sim.creatures.state[i] = STATE.WANDER;
      j.best = 0; // never closer than before
      steps(sim, 1);
      if (!civ.jobs.some((x) => x.id === j.id && x.b === farm.id)) break;
    }
    expect(civ.jobs.some((x) => x.id === j.id && x.b === farm.id)).toBe(false);
    expect(civ.skip.some((k) => k[0] === j.id && k[1] === farm.id)).toBe(true);
    checkJobs(sim, s);
  });

  it('dead, departed and destroyed: jobs are dropped at once', () => {
    const { sim, s, civ } = camp(8);
    const farm = put(civ, 'farm', 42, 42);
    const lumber = put(civ, 'lumber', 44, 40);
    steps(sim, 1);
    const dead = civ.jobs[0].id;
    sim.creatures.removeById(dead);
    expect(sim.settlements.workGoal(dead)).toBe(-1);
    steps(sim, 1);
    expect(civ.jobs.some((j) => j.id === dead)).toBe(false);
    // Fire destroys the farm: its workers lose their job and their goal.
    const onFarm = civ.jobs.filter((j) => j.b === farm.id).map((j) => j.id);
    expect(onFarm.length).toBeGreaterThan(0);
    sim.world.fire[farm.y * sim.world.width + farm.x] = 50;
    steps(sim, 1);
    expect(civ.buildings.includes(farm)).toBe(false);
    for (const id of onFarm) expect(jobOf(civ, id)?.building.id ?? -1).not.toBe(farm.id);
    for (const id of onFarm) expect(sim.settlements.workGoal(id)).not.toBe(farm.y * sim.world.width + farm.x);
    // A worker who walked away from the settlement is no longer a member and has no job.
    const gone = civ.jobs.find((j) => j.b === lumber.id)!.id;
    const gi = sim.creatures.indexOf(gone);
    sim.creatures.x[gi] = 100.5;
    sim.creatures.y[gi] = 90.5;
    steps(sim, 1);
    expect(s.members).not.toContain(gone);
    steps(sim, 1);
    expect(civ.jobs.some((j) => j.id === gone)).toBe(false);
    expect(sim.settlements.workGoal(gone)).toBe(-1);
  });
});

describe('production comes from work', () => {
  it('without workers there is no farm, wood or stone production: only foraging and knowledge', () => {
    const { sim, s, civ } = camp(8);
    for (const id of s.members) sim.creatures.age[sim.creatures.indexOf(id)] = 0; // all children: nobody can work
    put(civ, 'farm', 42, 42);
    put(civ, 'lumber', 44, 40);
    put(civ, 'quarry', 36, 42);
    civ.food = 60;
    steps(sim, 3);
    expect(civ.jobs.length).toBe(0);
    expect(civ.rate.wood).toBe(0);
    expect(civ.rate.stone).toBe(0);
    let edible = 0;
    for (const i of s.tiles) if (SPECIES[HUMAN].food.includes(sim.world.terrain[i])) edible++;
    expect(civ.rate.food).toBeCloseTo(Math.min(FORAGE_PER_PERSON * s.members.length, FORAGE_PER_TILE * edible), 6);
  });

  it('production is counted once: the stock grows by exactly the rates of the step', () => {
    const { sim, civ } = camp(10);
    put(civ, 'farm', 42, 42);
    put(civ, 'lumber', 44, 40);
    put(civ, 'quarry', 36, 42);
    civ.food = 20;
    civ.wood = 0;
    civ.stone = 0;
    for (let k = 0; k < 40; k++) {
      const before = { food: civ.food, wood: civ.wood, stone: civ.stone };
      steps(sim, 1);
      expect(civ.wood).toBeCloseTo(before.wood + civ.rate.wood, 6);
      expect(civ.stone).toBeCloseTo(before.stone + civ.rate.stone, 6);
      expect(civ.food).toBeCloseTo(Math.min(storage(civ), Math.max(0, before.food + civ.rate.food - civ.rate.foodUse)), 6);
      // Never more than a fully staffed building gives.
      expect(civ.rate.wood).toBeLessThanOrEqual(1 + 1e-9);
      expect(civ.rate.stone).toBeLessThanOrEqual(0.7 + 1e-9);
    }
    expect(civ.wood).toBeGreaterThan(5);
    expect(civ.stone).toBeGreaterThan(3);
  });

  it('a building under construction does nothing; construction needs builders at the site', () => {
    const { sim, s, civ } = camp(6);
    for (const id of s.members) sim.creatures.age[sim.creatures.indexOf(id)] = 0;
    expect(typeof sim.settlements.build(sim.world, s, 'farm', sim.tick)).toBe('object');
    steps(sim, 20);
    expect(civ.buildings[0].progress).toBe(0); // children do not build
    expect(civ.buildings[0].done).toBe(false);
  });

  it('an exhausted quarry stops, is announced once and gets no workers', () => {
    const { sim, civ } = camp(8);
    const q = put(civ, 'quarry', 36, 42);
    q.reserve = 0.3;
    civ.stone = 0;
    for (let k = 0; k < 40 && !q.empty; k++) steps(sim, 1);
    expect(q.empty).toBe(true);
    steps(sim, 5);
    expect(sim.history.filter((h) => h.code === 'settlement_exhausted').length).toBe(1);
    expect(civ.jobs.some((j) => j.b === q.id)).toBe(false);
  });

  it('a farm reports starting and stopping work, without repeating itself', () => {
    const { sim, s, civ } = camp(6);
    const farm = put(civ, 'farm', 42, 42);
    for (let k = 0; k < 40 && !farm.active; k++) steps(sim, 1);
    expect(farm.active).toBe(true);
    expect(sim.history.filter((h) => h.code === 'settlement_farm_started').length).toBe(1);
    // The field turns to desert: nothing grows, and after a while the farm has stopped.
    sim.world.setTerrain(farm.x, farm.y, T.DESERT);
    steps(sim, 20);
    expect(farm.active).toBe(false);
    expect(sim.history.filter((h) => h.code === 'settlement_farm_stopped').length).toBe(1);
    void s;
  });
});

describe('settings, saves and determinism', () => {
  it('with auto off nothing is built, so the only jobs are at buildings the player made', () => {
    const { sim, civ } = camp(12);
    run(sim, 1500);
    expect(civ.buildings.length).toBe(0);
    expect(civ.jobs.length).toBe(0);
  });

  it('jobs are saved and a loaded world continues exactly like the original', () => {
    const { sim, civ } = camp(12, civWorld(), true);
    put(civ, 'lumber', 44, 40);
    run(sim, 900);
    expect(civ.jobs.length).toBeGreaterThan(0);
    const other = quiet(flat(8, 8));
    deserializeInto(other, serialize(sim));
    expect(other.settlements.exportState()).toEqual(sim.settlements.exportState());
    for (const j of civ.jobs) expect(other.settlements.workGoal(j.id)).toBe(sim.settlements.workGoal(j.id));
    run(sim, 600);
    run(other, 600);
    expect(other.settlements.exportState()).toEqual(sim.settlements.exportState());
    expect(Array.from(other.creatures.state.subarray(0, other.creatures.count))).toEqual(Array.from(sim.creatures.state.subarray(0, sim.creatures.count)));
  });

  it('is deterministic', () => {
    const make = () => {
      const { sim } = camp(12, civWorld(), true);
      run(sim, 1200);
      return JSON.stringify(sim.settlements.exportState());
    };
    expect(make()).toBe(make());
  });

  it('old civ data without jobs loads, and invalid jobs are dropped', () => {
    const { sim, civ } = camp(8);
    put(civ, 'farm', 42, 42);
    steps(sim, 2);
    const raw = JSON.parse(JSON.stringify(civ));
    delete raw.jobs;
    delete raw.skip;
    for (const b of raw.buildings) {
      delete b.active;
      delete b.idle;
      delete b.empty;
      delete b.here;
    }
    const old = importCiv(raw, sim.world);
    expect(old.jobs).toEqual([]);
    expect(old.buildings[0].active).toBe(true);
    expect(old.buildings[0].empty).toBe(false);
    const bad = JSON.parse(JSON.stringify(civ));
    bad.jobs = [{ id: 1, b: 999 }, null, 'x', { id: 'a', b: 1 }, { id: civ.jobs[0].id, b: civ.jobs[0].b }, { id: civ.jobs[0].id, b: civ.jobs[0].b }];
    bad.buildings[0].here = 1e9;
    const fixed = importCiv(bad, sim.world);
    expect(fixed.jobs.length).toBe(1);
    expect(fixed.buildings[0].here).toBeLessThanOrEqual(BUILDERS);
    // A world with jobs for people who are not members: the jobs are dropped on load.
    const data = serialize(sim);
    const st = data.settlements!.list[0];
    st.civ!.jobs.push({ id: 987654, b: st.civ!.buildings[0].id, since: 0, best: 0, stuck: 0 });
    const other = quiet(flat(8, 8));
    deserializeInto(other, data);
    expect(other.settlements.list[0].civ!.jobs.some((j) => j.id === 987654)).toBe(false);
  });

  it('animals are unaffected: no jobs, no work state', () => {
    const sim = quiet(civWorld());
    sim.spawnInCircle(GRAZER, 60, 60, 3, 12);
    const s = sim.foundSettlement(60, 60, 'animal') as Settlement;
    expect(s.civ).toBeUndefined();
    run(sim, 600);
    for (let i = 0; i < sim.creatures.count; i++) expect(sim.creatures.state[i]).not.toBe(STATE.WORK);
  });
});
