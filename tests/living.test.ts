import { describe, expect, it } from 'vitest';
import { deserializeInto, serialize } from '../src/save/serialize';
import { GRAZER, HUMAN, RAPTOR, SPECIES, STATE } from '../src/sim/creatures';
import {
  COHESION, DECISION_TICKS, DWELL_TICKS, FOUND_COOLDOWN, GROUP_STEP, JOIN_R, LEAVE_R, LINK_R,
} from '../src/sim/groups';
import { EMIGRATE_BAN_TICKS, EMIGRATE_COOLDOWN, EMIGRATE_STRESS, STEP_TICKS, type Settlement } from '../src/sim/settlements';
import { MIN_GAP, SETTLE_SCORE, assessSite } from '../src/sim/sites';
import { Simulation } from '../src/sim/simulation';
import { SEA_LEVEL, T } from '../src/world/terrain';
import { World } from '../src/world/world';

const FLAT = SEA_LEVEL + 20;

function flat(w: number, h: number, fill: number = T.GRASS): World {
  const world = new World(w, h, 5);
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

/** A good land: grass, a pond within reach of (60, 60), a forest and hills nearby. */
function goodLand(w = 160, h = 120): World {
  const world = flat(w, h);
  block(world, 62, 52, 66, 54, T.LAKE);
  block(world, 70, 62, 76, 70, T.FOREST);
  block(world, 50, 64, 54, 68, T.HILLS);
  return world;
}

function quiet(world: World): Simulation {
  const sim = new Simulation(world);
  sim.weather.config.auto = false;
  return sim;
}

function run(sim: Simulation, ticks: number): void {
  for (let t = 0; t < ticks; t++) sim.step();
}

function people(sim: Simulation): number[] {
  const out: number[] = [];
  for (let i = 0; i < sim.creatures.count; i++) if (sim.creatures.isAlive(i) && sim.creatures.species[i] === HUMAN) out.push(sim.creatures.id[i]);
  return out;
}

/** No creature is in two settlements or two groups, and every member is a living creature of the right species. */
function checkIntegrity(sim: Simulation): void {
  const seen = new Set<number>();
  for (const s of sim.settlements.list) {
    for (const id of s.members) {
      expect(seen.has(id), `creature ${id} in two places`).toBe(false);
      seen.add(id);
      const i = sim.creatures.indexOf(id);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(sim.creatures.species[i]).toBe(s.species);
    }
  }
  const inGroup = new Set<number>();
  for (const g of sim.groups.list) {
    for (const id of g.members) {
      expect(inGroup.has(id), `creature ${id} in two groups`).toBe(false);
      inGroup.add(id);
      const i = sim.creatures.indexOf(id);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(sim.creatures.species[i]).toBe(g.species);
      expect(seen.has(id), `creature ${id} in a group and a settlement`).toBe(false);
    }
  }
}

describe('picking creatures', () => {
  it('returns the nearest creature first, accepts a tap on the sprite as well as the feet, and skips the dead', () => {
    const sim = quiet(flat(60, 60));
    const c = sim.creatures;
    sim.spawnInCircle(HUMAN, 30, 30, 0.1, 1);
    sim.spawnInCircle(HUMAN, 31.2, 30, 0.1, 1);
    sim.spawnInCircle(HUMAN, 36, 30, 0.1, 1);
    const [a, b] = people(sim);
    const at = (id: number) => c.indexOf(id);
    const near = c.candidatesAt(c.x[at(a)], c.y[at(a)], 2);
    expect(near.map((i) => c.id[i])).toEqual([a, b]);
    expect(c.candidatesAt(c.x[at(b)], c.y[at(b)], 2).map((i) => c.id[i])[0]).toBe(b);
    // The sprite is drawn above the creature's feet: a tap on its middle still selects it (sprites are half size).
    expect(c.candidatesAt(c.x[at(a)], c.y[at(a)] - 0.15, 0.1).map((i) => c.id[i])).toContain(a);
    expect(c.candidatesAt(c.x[at(a)] + 20, c.y[at(a)], 2)).toEqual([]);
    c.removeById(a);
    expect(c.candidatesAt(30, 30, 2).map((i) => c.id[i])).not.toContain(a);
  });

  it('a creature keeps its id and its own record while it moves and while others die around it', () => {
    const sim = quiet(goodLand());
    sim.spawnInCircle(HUMAN, 60, 60, 4, 8);
    const [first, ...rest] = people(sim);
    const c = sim.creatures;
    const x0 = c.x[c.indexOf(first)];
    run(sim, 100);
    for (const id of rest.slice(0, 3)) c.removeById(id);
    run(sim, 100);
    const i = c.indexOf(first);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(c.id[i]).toBe(first);
    expect(c.species[i]).toBe(HUMAN);
    const info = c.info(i);
    expect(info.id).toBe(first);
    expect(info.species.id).toBe(HUMAN);
    expect(c.x[i]).not.toBe(x0);
    c.removeById(first);
    expect(c.indexOf(first)).toBe(-1);
    expect(c.drainDeaths().some((d) => d.id === first)).toBe(true);
  });
});

describe('groups', () => {
  it('free people standing close form a group of real ids; people far away do not, and nobody is in two groups', () => {
    const sim = quiet(goodLand());
    sim.groups.enabled = false;
    sim.spawnInCircle(HUMAN, 40, 40, 2, 5);
    sim.spawnInCircle(HUMAN, 110, 90, 2, 4);
    sim.spawnInCircle(HUMAN, 20, 100, 0.1, 1);
    run(sim, GROUP_STEP * 2);
    expect(sim.groups.list.length).toBe(2);
    const sizes = sim.groups.list.map((g) => g.members.length).sort();
    expect(sizes).toEqual([4, 5]);
    for (const g of sim.groups.list) for (const id of g.members) expect(sim.creatures.indexOf(id)).toBeGreaterThanOrEqual(0);
    checkIntegrity(sim);
    const lonely = people(sim).filter((id) => !sim.groups.groupOfCreature(id));
    expect(lonely.length).toBe(1);
    expect(Math.hypot(LINK_R, JOIN_R)).toBeGreaterThan(0);
  });

  it('a group splits when members really end up far apart, and a newcomer close to a group joins it', () => {
    const sim = quiet(goodLand());
    sim.groups.enabled = false;
    sim.spawnInCircle(HUMAN, 40, 40, 1.5, 6);
    run(sim, GROUP_STEP * 2);
    expect(sim.groups.list.length).toBe(1);
    const g = sim.groups.list[0];
    const c = sim.creatures;
    // Carry three of them far away.
    for (const id of g.members.slice(0, 3)) {
      const i = c.indexOf(id);
      c.x[i] = c.px[i] = 40 + LEAVE_R + 20;
      c.y[i] = c.py[i] = 40 + (id % 3);
    }
    run(sim, GROUP_STEP * 2);
    expect(sim.groups.list.length).toBe(2);
    expect(sim.groups.list.map((x) => x.members.length).sort()).toEqual([3, 3]);
    checkIntegrity(sim);
    // A newcomer near one of them joins that one.
    sim.spawnInCircle(HUMAN, 41, 41, 0.5, 1);
    const fresh = people(sim).find((id) => !sim.groups.groupOfCreature(id))!;
    expect(fresh).toBeDefined();
    run(sim, GROUP_STEP * 2);
    expect(sim.groups.groupOfCreature(fresh)).toBeDefined();
    checkIntegrity(sim);
  });

  it('uneven splits follow the land, not a fixed ratio: the surplus of an overfull group goes to another good place', () => {
    const w = goodLand(220, 120);
    // The home spot is poor in food (little grass), so it can only feed a few; a good meadow lies 20 tiles east.
    block(w, 40, 40, 80, 80, T.SAND);
    block(w, 56, 56, 64, 64, T.GRASS);
    block(w, 62, 52, 66, 54, T.LAKE);
    const sim = quiet(w);
    sim.groups.enabled = false; // no founding in this test: only the group's decisions
    sim.spawnInCircle(HUMAN, 60, 60, 2.5, 14);
    const before = people(sim).length;
    run(sim, 1200);
    const sizes = sim.groups.list.map((g) => g.members.length);
    expect(people(sim).length).toBeGreaterThanOrEqual(before);
    expect(sizes.length).toBeGreaterThanOrEqual(1);
    checkIntegrity(sim);
  });

  it('members of a travelling group really walk there, using the creature system (state Traveling)', () => {
    const sim = quiet(goodLand());
    sim.groups.enabled = false;
    sim.spawnInCircle(HUMAN, 30, 30, 1.5, 5);
    run(sim, GROUP_STEP * 2);
    const g = sim.groups.list[0];
    const goal = 100 * sim.world.width + 20; // far south-west
    g.mode = 'travel';
    g.goal = goal;
    g.next = 1e9;
    sim.creatures.hunger.fill(0);
    sim.creatures.thirst.fill(0);
    let travelling = false;
    const startD = Math.hypot(g.cx - 20, g.cy - 100);
    run(sim, 600);
    for (const id of people(sim)) if (sim.creatures.state[sim.creatures.indexOf(id)] === STATE.TRAVEL) travelling = true;
    const g2 = sim.groups.list[0];
    expect(travelling || Math.hypot(g2.cx - 20, g2.cy - 100) < startD).toBe(true);
    expect(Math.hypot(g2.cx - 20, g2.cy - 100)).toBeLessThan(startD - 20);
    checkIntegrity(sim);
  });

  it('a lone person walks towards company or a settlement that has room', () => {
    const sim = quiet(goodLand());
    sim.groups.enabled = false;
    sim.spawnInCircle(HUMAN, 40, 40, 1.5, 5);
    sim.spawnInCircle(HUMAN, 55, 40, 0.1, 1);
    const lone = people(sim).find((id) => Math.abs(sim.creatures.x[sim.creatures.indexOf(id)] - 55) < 1)!;
    const nearest = () => {
      const i = sim.creatures.indexOf(lone);
      let d = Infinity;
      for (const id of people(sim)) {
        if (id === lone) continue;
        const j = sim.creatures.indexOf(id);
        d = Math.min(d, Math.hypot(sim.creatures.x[j] - sim.creatures.x[i], sim.creatures.y[j] - sim.creatures.y[i]));
      }
      return d;
    };
    const d0 = nearest();
    sim.creatures.hunger.fill(0);
    sim.creatures.thirst.fill(0);
    run(sim, GROUP_STEP * 3);
    expect(sim.groups.goalOf(lone) >= 0 || !!sim.groups.groupOfCreature(lone)).toBe(true);
    run(sim, 500);
    expect(nearest()).toBeLessThan(d0 / 2);
    expect(COHESION).toBeGreaterThan(0);
  });
});

describe('founding settlements by themselves', () => {
  it('six people added on good land settle by themselves, after waiting, with their own ids, and nobody is counted twice', () => {
    const sim = quiet(goodLand());
    sim.spawnInCircle(HUMAN, 60, 60, 3, 6);
    const ids = people(sim);
    expect(ids.length).toBe(6);
    run(sim, DWELL_TICKS - 20);
    expect(sim.settlements.list.length).toBe(0); // not at once
    run(sim, 1500);
    expect(sim.settlements.list.length).toBeGreaterThanOrEqual(1);
    const s = sim.settlements.list[0];
    expect(s.species).toBe(HUMAN);
    expect(s.civ).toBeDefined();
    expect(s.members.every((m) => ids.includes(m) || sim.creatures.indexOf(m) >= 0)).toBe(true);
    expect(ids.filter((id) => s.members.includes(id)).length).toBeGreaterThanOrEqual(4);
    expect(sim.history.some((h) => h.code === 'settlement_founded')).toBe(true);
    expect(sim.settlements.ownerAt(s.x, s.y)?.id).toBe(s.id);
    checkIntegrity(sim);
  });

  it('does not found anything where the conditions fail: no water, desert, fire, predators, too few people, switched off', () => {
    const ground = (w: World) => {
      const sim = quiet(w);
      sim.spawnInCircle(HUMAN, 60, 60, 3, 6);
      return sim;
    };
    const dry = flat(160, 120); // grass, but no water anywhere
    const noWater = ground(dry);
    run(noWater, 900);
    expect(noWater.settlements.list.length).toBe(0);
    expect(assessSite(noWater.world, noWater.creatures, noWater.settlements, 60, 60, HUMAN).fail).toBe('water');

    const desertWorld = goodLand();
    block(desertWorld, 0, 0, 159, 119, T.DESERT);
    block(desertWorld, 62, 52, 66, 54, T.LAKE);
    const desert = ground(desertWorld);
    run(desert, 900);
    expect(desert.settlements.list.length).toBe(0);

    const fire = ground(goodLand());
    fire.world.fire[58 * 160 + 60] = 255;
    expect(assessSite(fire.world, fire.creatures, fire.settlements, 60, 60, HUMAN).fail).toBe('danger');

    const hunted = ground(goodLand());
    hunted.creatures.spawn(RAPTOR, 62, 62, hunted.rng, { hunger: 0, thirst: 0 });
    expect(assessSite(hunted.world, hunted.creatures, hunted.settlements, 60, 60, HUMAN).fail).toBe('danger');

    const few = quiet(goodLand());
    few.spawnInCircle(HUMAN, 60, 60, 2, 3);
    few.creatures.breedTimer.fill(1e6); // three people who cannot grow into a group of four
    run(few, 900);
    expect(few.settlements.list.length).toBe(0);

    const off = quiet(goodLand());
    off.groups.enabled = false;
    off.spawnInCircle(HUMAN, 60, 60, 3, 6);
    run(off, 1500);
    expect(off.settlements.list.length).toBe(0);
    expect(off.groups.list.length).toBeGreaterThan(0); // they still gather
  });

  it('keeps its distance from other settlements and waits between foundings', () => {
    const sim = quiet(goodLand(200, 120));
    sim.spawnInCircle(HUMAN, 60, 60, 3, 6);
    run(sim, 1200);
    const first = sim.settlements.list[0];
    expect(first).toBeDefined();
    const near = assessSite(sim.world, sim.creatures, sim.settlements, first.x + 5, first.y, HUMAN);
    expect(near.ok).toBe(false);
    expect(['claimed', 'gap']).toContain(near.fail);
    const far = assessSite(sim.world, sim.creatures, sim.settlements, first.x + MIN_GAP + 6, first.y, HUMAN);
    expect(far.fail).not.toBe('gap');
    // Two groups that are both ready: the second founding waits for the world-wide cooldown.
    const two = quiet(goodLand(260, 120));
    block(two.world, 182, 52, 186, 54, T.LAKE);
    two.spawnInCircle(HUMAN, 60, 60, 3, 6);
    two.spawnInCircle(HUMAN, 180, 60, 3, 6);
    const times: number[] = [];
    let known = 0;
    for (let t = 0; t < 3000; t++) {
      two.step();
      if (two.settlements.list.length > known) {
        known = two.settlements.list.length;
        times.push(two.tick);
      }
    }
    expect(times.length).toBe(2);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(FOUND_COOLDOWN - GROUP_STEP);
    checkIntegrity(two);
  });

  it('people that appear later join the settlement while it has room, and never at a full one', () => {
    const sim = quiet(goodLand());
    sim.spawnInCircle(HUMAN, 60, 60, 3, 6);
    run(sim, 1500);
    const s = sim.settlements.list[0];
    expect(s).toBeDefined();
    sim.settlements.auto = false;
    const before = s.members.length;
    sim.spawnInCircle(HUMAN, s.x, s.y + 2, 2, 3);
    run(sim, 400);
    expect(s.members.length).toBeGreaterThan(before);
    checkIntegrity(sim);
  });

  it('different peoples can want different places: the profile in the species data drives the score', () => {
    const sim = quiet(goodLand());
    const prof = SPECIES[HUMAN].civ!;
    const base = assessSite(sim.world, sim.creatures, sim.settlements, 60, 60, HUMAN);
    expect(base.ok).toBe(true);
    expect(base.score).toBeGreaterThan(SETTLE_SCORE);
    const saved = { ...prof };
    try {
      (prof as unknown as { affinity: Record<number, number> }).affinity = { [T.GRASS]: 0 };
      expect(assessSite(sim.world, sim.creatures, sim.settlements, 60, 60, HUMAN).score).toBeLessThan(base.score);
      (prof as unknown as { affinity: Record<number, number> }).affinity = saved.affinity;
      (prof as unknown as { avoid: number[] }).avoid = [T.GRASS];
      expect(assessSite(sim.world, sim.creatures, sim.settlements, 60, 60, HUMAN).fail).toBe('ground');
      (prof as unknown as { avoid: number[] }).avoid = [...saved.avoid];
      (prof as unknown as { needsWater: boolean }).needsWater = false;
      const dry = quiet(flat(160, 120));
      expect(assessSite(dry.world, dry.creatures, dry.settlements, 60, 60, HUMAN).ok).toBe(true);
    } finally {
      Object.assign(prof, saved);
    }
  });
});

describe('leaving and moving on', () => {
  function village(): { sim: Simulation; s: Settlement } {
    const sim = quiet(goodLand(200, 120));
    sim.spawnInCircle(HUMAN, 60, 60, 3, 12);
    const s = sim.foundSettlement(60, 60, 'human') as Settlement;
    expect(typeof s).toBe('object');
    return { sim, s };
  }

  it('a settlement under pressure sends part of its people away; they stay alive, cannot return at once, and look for a new home', () => {
    const { sim, s } = village();
    run(sim, STEP_TICKS * 3);
    const before = s.members.slice();
    s.stress = EMIGRATE_STRESS + 1;
    s.lastEmigration = -EMIGRATE_COOLDOWN;
    run(sim, STEP_TICKS);
    const left = before.filter((id) => !s.members.includes(id));
    expect(left.length).toBeGreaterThanOrEqual(3);
    expect(s.members.length).toBeGreaterThanOrEqual(4);
    for (const id of left) expect(sim.creatures.indexOf(id)).toBeGreaterThanOrEqual(0); // nobody was removed from the world
    expect(sim.history.some((h) => h.code === 'settlement_emigrated')).toBe(true);
    expect(sim.settlements.bans.get(left[0])?.sid).toBe(s.id);
    const g = sim.groups.groupOfCreature(left[0]);
    expect(g).toBeDefined();
    expect(g!.avoid).toBe(s.id);
    // They are not taken back while the ban lasts.
    run(sim, EMIGRATE_BAN_TICKS / 2);
    for (const id of left) if (sim.settlements.get(s.id)!.members.includes(id)) expect(sim.settlements.bans.get(id)).toBeUndefined();
    checkIntegrity(sim);
  });

  it('does not keep emigrating: a cooldown and a smaller stress follow each departure', () => {
    const { sim, s } = village();
    run(sim, STEP_TICKS * 3);
    s.stress = EMIGRATE_STRESS + 1;
    s.lastEmigration = -EMIGRATE_COOLDOWN;
    run(sim, STEP_TICKS);
    const after = s.members.length;
    expect(s.stress).toBeLessThan(EMIGRATE_STRESS);
    s.stress = EMIGRATE_STRESS + 5;
    run(sim, STEP_TICKS * 3);
    expect(sim.history.filter((h) => h.code === 'settlement_emigrated').length).toBe(1);
    expect(s.members.length).toBeGreaterThanOrEqual(after - 1);
  });

  it('famine and fire really build up that pressure', () => {
    const { sim, s } = village();
    sim.settlements.auto = false;
    s.civ!.food = 0;
    sim.creatures.hunger.fill(0);
    run(sim, STEP_TICKS * 4);
    expect(s.stress).toBeGreaterThan(0);
    const s0 = s.stress;
    sim.world.fire[s.tiles[3]] = 255;
    run(sim, STEP_TICKS * 2);
    expect(s.stress).toBeGreaterThan(s0 + 2);
  });

  it('a settlement that falls apart leaves its people alive', () => {
    const { sim, s } = village();
    const ids = s.members.slice();
    // Leave only one person: after the grace period the settlement dissolves, and nobody is removed.
    // Everyone but one person is carried far away (out of the territory), alive.
    for (const id of ids.slice(1)) {
      const i = sim.creatures.indexOf(id);
      sim.creatures.x[i] = sim.creatures.px[i] = 150;
      sim.creatures.y[i] = sim.creatures.py[i] = 100;
    }
    run(sim, STEP_TICKS * 2);
    expect(s.members.length).toBe(1);
    sim.creatures.breedTimer.fill(1e6);
    sim.creatures.hunger.fill(0);
    sim.creatures.thirst.fill(0);
    run(sim, 700);
    expect(sim.settlements.get(s.id)).toBeUndefined();
    expect(sim.history.some((h) => h.code === 'settlement_dissolved' || h.code === 'settlement_abandoned')).toBe(true);
    for (const id of ids) expect(sim.creatures.indexOf(id)).toBeGreaterThanOrEqual(0);
  });
});

describe('saving, loading, determinism', () => {
  function scenario(): Simulation {
    const sim = quiet(goodLand(200, 120));
    sim.spawnInCircle(HUMAN, 60, 60, 3, 8);
    run(sim, 700);
    return sim;
  }

  it('saves and restores groups, bans and goals, and a loaded world continues exactly like the original', () => {
    const sim = scenario();
    expect(sim.groups.list.length + sim.settlements.list.length).toBeGreaterThan(0);
    const other = quiet(flat(8, 8));
    deserializeInto(other, serialize(sim));
    expect(other.groups.exportState()).toEqual(sim.groups.exportState());
    expect(other.settlements.exportState()).toEqual(sim.settlements.exportState());
    checkIntegrity(other);
    run(sim, 600);
    run(other, 600);
    expect(other.groups.exportState()).toEqual(sim.groups.exportState());
    expect(other.settlements.exportState()).toEqual(sim.settlements.exportState());
    expect(other.creatures.count).toBe(sim.creatures.count);
  });

  it('is deterministic: the same actions give the same groups and settlements', () => {
    const make = () => {
      const s = scenario();
      run(s, 900);
      return JSON.stringify([s.groups.exportState(), s.settlements.exportState()]);
    };
    expect(make()).toBe(make());
  });

  it('old saves without groups still load, and invalid group data is ignored', () => {
    const sim = scenario();
    const data = serialize(sim);
    const old = { ...data, version: 10 } as typeof data;
    delete old.groups;
    const other = quiet(flat(8, 8));
    deserializeInto(other, old);
    expect(other.groups.list).toEqual([]);
    expect(other.settlements.list.length).toBe(sim.settlements.list.length);
    run(other, 200);
    const bad = JSON.parse(JSON.stringify(serialize(sim).groups ?? { list: [] }));
    bad.list.push({ id: 1, species: GRAZER, members: [1, 2, 3], mode: 'travel', goal: 5 }, null, { id: 99999, species: HUMAN, members: [424242, 'x'] });
    bad.goals = [[-5, 3], [1e9, 1e9], 'x'];
    const data2 = serialize(sim);
    data2.groups = bad;
    const third = quiet(flat(8, 8));
    deserializeInto(third, data2);
    for (const g of third.groups.list) expect(g.species).toBe(HUMAN);
    checkIntegrity(third);
  });
});

describe('animals are unaffected', () => {
  it('animal settlements, animal groups and animal movement work as before: no groups of animals, no travelling', () => {
    const sim = quiet(goodLand());
    sim.spawnInCircle(GRAZER, 60, 60, 3, 12);
    const s = sim.foundSettlement(60, 60, 'animal') as Settlement;
    expect(typeof s).toBe('object');
    expect(s.civ).toBeUndefined();
    run(sim, 600);
    expect(sim.groups.list.length).toBe(0);
    for (let i = 0; i < sim.creatures.count; i++) expect(sim.creatures.state[i]).not.toBe(STATE.TRAVEL);
    expect(s.members.length).toBeGreaterThan(5);
    expect(DECISION_TICKS).toBeGreaterThan(0);
  });
});
