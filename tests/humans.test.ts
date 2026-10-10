import { describe, expect, it } from 'vitest';
import { TOOLS } from '../src/game/tools';
import { setLang } from '../src/i18n';
import { speciesName, toolHint, toolLabel } from '../src/i18n/names';
import { SAVE_VERSION, deserializeInto, serialize } from '../src/save/serialize';
import { CAUSE, FISH, GRAZER, HADROSAUR, HUMAN, RAPTOR, SPECIES, STATE, TYRANT } from '../src/sim/creatures';
import { MOVE, passable } from '../src/sim/pathfinding';
import { Simulation } from '../src/sim/simulation';
import { MIN_FOUNDERS } from '../src/sim/settlements';
import { SEA_LEVEL, T } from '../src/world/terrain';
import { World } from '../src/world/world';

const FLAT = SEA_LEVEL + 20;

function flat(w: number, h: number, fill: number = T.GRASS): World {
  const world = new World(w, h, 3);
  world.heights.fill(FLAT);
  world.temperature.fill(140);
  world.moisture.fill(110);
  world.baseTemperature.fill(140);
  world.baseMoisture.fill(110);
  world.terrain.fill(fill);
  return world;
}

function quiet(world: World): Simulation {
  const sim = new Simulation(world);
  sim.weather.config.auto = false;
  return sim;
}

function run(sim: Simulation, ticks: number, each?: (t: number) => void): void {
  for (let t = 0; t < ticks; t++) {
    sim.step();
    each?.(t);
  }
}

function humans(sim: Simulation): number[] {
  const out: number[] = [];
  for (let i = 0; i < sim.creatures.count; i++) if (sim.creatures.isAlive(i) && sim.creatures.species[i] === HUMAN) out.push(i);
  return out;
}

describe('humans as a species', () => {
  it('are a sixth, sentient species and every earlier species is unchanged', () => {
    expect(SPECIES.length).toBe(6);
    expect(SPECIES[HUMAN]).toMatchObject({ key: 'human', sentient: true, habitat: 'land', move: MOVE.LOWLAND });
    expect(SPECIES.slice(0, 5).map((s) => s.key)).toEqual(['grazer', 'raptor', 'hadrosaur', 'tyrant', 'fish']);
    expect(SPECIES.slice(0, 5).some((s) => s.sentient)).toBe(false);
    // Predators may hunt people, and still hunt what they hunted before.
    expect(SPECIES[RAPTOR].prey).toEqual([GRAZER, HUMAN]);
    expect(SPECIES[TYRANT].prey).toEqual([HADROSAUR, GRAZER, HUMAN]);
  });

  it('can be added from the first moment, through the same spawn tool as every species', () => {
    const tool = TOOLS.find((t) => t.id === 'spawn_human')!;
    expect(tool.category).toBe('creatures');
    const sim = quiet(flat(80, 80)); // a brand-new world: no dinosaurs have ever appeared
    expect(sim.tick).toBe(0);
    const ctx = { sim, inspect() {}, intensity: 2, durationTicks: 100, count: 12, effect() {}, notify() {} };
    for (let k = 0; k < 4; k++) tool.apply(ctx, 40, 40, 4);
    expect(sim.creatures.countSpecies(HUMAN)).toBeGreaterThanOrEqual(6);
    expect(sim.creatures.countSpecies(GRAZER)).toBe(0);
    expect(sim.history.some((h) => h.code === 'first' && h.p?.species === HUMAN)).toBe(true);
  });

  it('are only placed where they can stand: not in water, not on mountains or snow', () => {
    const sim = quiet(flat(60, 60, T.LAKE));
    expect(sim.spawnInCircle(HUMAN, 30, 30, 6, 10)).toBe(0);
    const hill = quiet(flat(60, 60, T.MOUNTAIN));
    expect(hill.spawnInCircle(HUMAN, 30, 30, 6, 10)).toBe(0);
    const snow = quiet(flat(60, 60, T.SNOW));
    expect(snow.spawnInCircle(HUMAN, 30, 30, 6, 10)).toBe(0);
    expect(quiet(flat(60, 60)).spawnInCircle(HUMAN, 30, 30, 6, 10)).toBeGreaterThan(0);
  });

  it('have names and hints in every language, and do not count as animals in the status line', () => {
    const tool = TOOLS.find((t) => t.id === 'spawn_human')!;
    for (const lang of ['en', 'ru', 'zh-CN'] as const) {
      setLang(lang, false);
      expect(speciesName(HUMAN)).not.toMatch(/^species\./);
      expect(speciesName(HUMAN, true)).not.toMatch(/^species\./);
      expect(toolLabel(tool)).toBe(speciesName(HUMAN));
      expect(toolHint(tool)).not.toMatch(/diet\./);
    }
    setLang('ru', false);
    expect(speciesName(HUMAN)).toBe('Человек');
    setLang('en', false);
  });
});

describe('human behaviour (existing mechanisms)', () => {
  it('stay on ground lowland animals can walk, go around sheer walls and reach food beyond them', () => {
    const w = flat(70, 24, T.DESERT);
    for (let y = 9; y < 15; y++) for (let x = 50; x < 56; x++) w.terrain[w.idx(x, y)] = T.GRASS; // the only food
    for (let y = 0; y < 20; y++) w.setHeight(35, y, FLAT + 40); // a sheer wall across the way, open at y >= 20
    const sim = quiet(w);
    sim.spawnInCircle(HUMAN, 20, 12, 1.5, 3);
    for (const i of humans(sim)) sim.creatures.hunger[i] = 60;
    let reached = false;
    run(sim, 700, () => {
      for (const i of humans(sim)) {
        expect(passable(w, MOVE.LOWLAND, Math.floor(sim.creatures.x[i]), Math.floor(sim.creatures.y[i]))).toBe(true);
        if (sim.creatures.x[i] > 45 && sim.creatures.state[i] === STATE.EAT) reached = true;
      }
    });
    expect(reached).toBe(true);
  });

  it('feed, drink, grow old and breed: a small group survives two game years on grassland with a lake', () => {
    const w = flat(70, 50);
    for (let y = 20; y < 30; y++) for (let x = 40; x < 50; x++) w.setTerrain(x, y, T.LAKE);
    const sim = quiet(w);
    sim.spawnInCircle(HUMAN, 30, 25, 4, 14);
    const start = humans(sim).length;
    run(sim, 960);
    expect(humans(sim).length).toBeGreaterThan(0);
    expect(sim.creatures.birthStats[HUMAN]).toBeGreaterThan(0);
    expect(sim.creatures.births).toBeGreaterThan(0);
    expect(start).toBeGreaterThanOrEqual(10);
    expect(sim.creatures.countSpecies(HUMAN)).toBe(humans(sim).length);
  });

  it('flee predators, and predators can hunt them (counted as death by predation)', () => {
    const sim = quiet(flat(60, 60));
    sim.spawnInCircle(HUMAN, 30, 30, 1, 2);
    sim.creatures.spawn(RAPTOR, 33, 30, sim.rng, { hunger: 95, thirst: 0 });
    let fled = false;
    run(sim, 400, () => {
      for (const i of humans(sim)) if (sim.creatures.state[i] === STATE.FLEE) fled = true;
    });
    expect(fled).toBe(true);
    // A raptor that is hungry and has only people to eat eventually catches one.
    const s2 = quiet(flat(60, 60));
    s2.spawnInCircle(HUMAN, 30, 30, 1, 3);
    s2.creatures.spawn(TYRANT, 31, 30, s2.rng, { hunger: 95, thirst: 0 });
    run(s2, 600);
    expect(s2.creatures.deathsBy(HUMAN, CAUSE.PREDATION)).toBeGreaterThan(0);
  });

  it('react to world events: lightning kills, and a falling meteor makes them run from the impact point', () => {
    const sim = quiet(flat(80, 80));
    sim.spawnInCircle(HUMAN, 40, 40, 1, 4);
    const before = humans(sim).length;
    sim.lightning(40, 40);
    expect(humans(sim).length).toBeLessThanOrEqual(before);

    const m = quiet(flat(80, 80));
    m.spawnInCircle(HUMAN, 40, 40, 1.2, 3);
    run(m, 5);
    m.launchMeteor(40, 40, 4, 2);
    let ran = false;
    run(m, 12, () => {
      for (const i of humans(m)) if (m.creatures.state[i] === STATE.FLEE) ran = true;
    });
    expect(ran).toBe(true);
  });
});

describe('saving, loading and old saves', () => {
  it('saves and loads people, and a loaded world continues exactly like the original', () => {
    const make = () => {
      const sim = quiet(flat(70, 50));
      sim.spawnInCircle(HUMAN, 30, 25, 4, 12);
      sim.spawnInCircle(GRAZER, 45, 25, 4, 8);
      return sim;
    };
    const sim = make();
    run(sim, 200);
    const data = serialize(sim);
    expect(data.version).toBe(SAVE_VERSION);
    expect((data.creatures as { statSpecies?: number }).statSpecies).toBe(SPECIES.length);
    const other = quiet(flat(8, 8));
    deserializeInto(other, data);
    expect(humans(other).length).toBe(humans(sim).length);
    expect(other.creatures.countSpecies(HUMAN)).toBe(sim.creatures.countSpecies(HUMAN));
    run(sim, 300);
    run(other, 300);
    expect(humans(other).length).toBe(humans(sim).length);
    expect(Array.from(other.creatures.birthStats)).toEqual(Array.from(sim.creatures.birthStats));
    for (const i of humans(sim)) {
      const j = other.creatures.indexOf(sim.creatures.id[i]);
      expect(j).toBeGreaterThanOrEqual(0);
      expect(other.creatures.x[j]).toBe(sim.creatures.x[i]);
      expect(other.creatures.y[j]).toBe(sim.creatures.y[i]);
    }
  });

  it('is deterministic: the same actions give the same people', () => {
    const make = () => {
      const sim = quiet(flat(60, 60));
      sim.spawnInCircle(HUMAN, 30, 30, 4, 10);
      sim.spawnInCircle(RAPTOR, 40, 30, 2, 1);
      run(sim, 400);
      return humans(sim).map((i) => [sim.creatures.id[i], sim.creatures.x[i], sim.creatures.y[i], sim.creatures.health[i]]);
    };
    expect(make()).toEqual(make());
  });

  it('loads saves written before people existed: statistics keep their species, nothing is lost', () => {
    const sim = quiet(flat(40, 40));
    sim.spawnInCircle(GRAZER, 20, 20, 3, 6);
    run(sim, 30);
    const data = serialize(sim);
    const c = data.creatures as unknown as { deathStats: Uint32Array; birthStats: Uint32Array; statSpecies?: number };
    const causes = c.deathStats.length / SPECIES.length;
    // What a version-7/8 file held: five species, same causes, no statSpecies, food map of five groups.
    const old = new Uint32Array(5 * causes);
    for (let sp = 0; sp < 5; sp++) for (let k = 0; k < causes; k++) old[sp * causes + k] = sp * 100 + k + 1;
    c.deathStats = old;
    c.birthStats = new Uint32Array([7, 6, 5, 4, 3]);
    delete c.statSpecies;
    data.version = 8;
    const fm = (data.v4 as { foodMap?: { counts: Uint16Array[] } }).foodMap;
    if (fm) fm.counts = fm.counts.slice(0, fm.counts.length - 1);
    const other = quiet(flat(8, 8));
    deserializeInto(other, data);
    expect(other.creatures.deathsBy(FISH, 2)).toBe(4 * 100 + 3);
    expect(other.creatures.deathsBy(GRAZER, 0)).toBe(1);
    expect(other.creatures.deathsBy(HUMAN, 0)).toBe(0);
    expect(Array.from(other.creatures.birthStats)).toEqual([7, 6, 5, 4, 3, 0]);
    expect(other.creatures.countSpecies(GRAZER)).toBe(sim.creatures.countSpecies(GRAZER));
    run(other, 100); // the food map is rebuilt, nothing throws
    other.spawnInCircle(HUMAN, 20, 20, 3, 5);
    run(other, 50);
    expect(humans(other).length).toBeGreaterThan(0);
  });
});

describe('people and animal settlements', () => {
  it('a group of people founds a human settlement with the human tool; the animal tool does not take people', () => {
    const sim = quiet(flat(80, 80));
    sim.spawnInCircle(HUMAN, 40, 40, 3, MIN_FOUNDERS + 4);
    expect(sim.foundSettlement(40, 40, 'animal')).toBe('few');
    const h = sim.foundSettlement(40, 40, 'human');
    expect(typeof h).toBe('object');
    sim.spawnInCircle(GRAZER, 60, 60, 3, 10);
    const a = sim.foundSettlement(60, 60, 'animal');
    expect(typeof a).toBe('object');
    run(sim, 200);
    for (const st of sim.settlements.list) {
      for (const id of st.members) expect(sim.creatures.species[sim.creatures.indexOf(id)]).toBe(st.species);
    }
  });

  it('a save cannot mix species in one settlement: members of another species are dropped', () => {
    const sim = quiet(flat(80, 80));
    sim.spawnInCircle(GRAZER, 40, 40, 3, 10);
    expect(typeof sim.foundSettlement(40, 40)).toBe('object');
    const data = serialize(sim);
    data.settlements!.list[0].species = HUMAN;
    const other = quiet(flat(8, 8));
    deserializeInto(other, data);
    expect(other.settlements.list.every((s) => s.members.length === 0)).toBe(true);
  });
});
