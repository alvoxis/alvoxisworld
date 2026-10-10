import { describe, expect, it } from 'vitest';
import { TOOLS } from '../src/game/tools';
import { HOUSE_STYLES, type Rect } from '../src/render/architecture';
import { SAVE_VERSION, deserializeInto, serialize } from '../src/save/serialize';
import { BUILDERS, housing, houseCapacity, slotsOf, type Building, type Civ } from '../src/sim/civ';
import { ELF, HUMAN, PREDATORS_OF, RAPTOR, SPECIES, STATE } from '../src/sim/creatures';
import { STEP_TICKS, type Settlement } from '../src/sim/settlements';
import { Simulation } from '../src/sim/simulation';
import { SETTLE_SCORE, assessSite } from '../src/sim/sites';
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

/** Open grassland in the west (with a lake) and a wide forest in the east (with its own lake and a clearing). */
function twoLands(): World {
  const w = flat(220, 120);
  block(w, 40, 52, 44, 54, T.LAKE); // the grassland lake
  block(w, 120, 20, 219, 119, T.FOREST);
  block(w, 158, 52, 162, 54, T.LAKE); // the forest lake
  block(w, 150, 62, 156, 66, T.GRASS); // a clearing
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

function ofSpecies(sim: Simulation, sp: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < sim.creatures.count; i++) if (sim.creatures.isAlive(i) && sim.creatures.species[i] === sp) out.push(sim.creatures.id[i]);
  return out;
}

/** Every member of a settlement or group is a living creature of that settlement's or group's species, in one place only. */
function checkIntegrity(sim: Simulation): void {
  const seen = new Set<number>();
  for (const s of sim.settlements.list) {
    for (const id of s.members) {
      expect(seen.has(id)).toBe(false);
      seen.add(id);
      const i = sim.creatures.indexOf(id);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(sim.creatures.species[i]).toBe(s.species);
    }
    for (const j of s.civ?.jobs ?? []) expect(s.members).toContain(j.id);
  }
  for (const g of sim.groups.list) {
    for (const id of g.members) {
      expect(seen.has(id)).toBe(false);
      seen.add(id);
      expect(sim.creatures.species[sim.creatures.indexOf(id)]).toBe(g.species);
    }
  }
}

/** The rectangles a house style draws for a level (as text, to compare looks). */
function art(style: 'human' | 'elven', level: number): string {
  const out: string[] = [];
  const r: Rect = (x, y, w, h, c) => out.push(`${x},${y},${w},${h},${c}`);
  HOUSE_STYLES[style].draw(r, level, '#ff0000');
  return out.join(';');
}

describe('elves as a species', () => {
  it('are registered as a seventh, sentient species with their own profile and spawn tool', () => {
    expect(SPECIES[ELF]).toMatchObject({ key: 'elf', sentient: true, habitat: 'land', diet: 'herbivore' });
    expect(SPECIES[ELF].civ!.architecture).toBe('elven');
    expect(SPECIES[HUMAN].civ!.architecture).toBe('human');
    const tool = TOOLS.find((t) => t.id === 'spawn_elf')!;
    expect(tool.category).toBe('creatures');
    const sim = quiet(flat(80, 80));
    tool.apply({ sim } as never, 40, 40, 2);
    const ids = ofSpecies(sim, ELF);
    expect(ids.length).toBeGreaterThan(0);
    const info = sim.creatures.info(sim.creatures.indexOf(ids[0]));
    expect(info.species.key).toBe('elf');
    // Predators hunt them as they hunt humans, so they flee like humans do.
    expect(PREDATORS_OF[ELF]).toEqual(PREDATORS_OF[HUMAN]);
  });

  it('live by the shared creature rules: needs, eating in the forest, fleeing, ageing', () => {
    const sim = quiet(twoLands());
    sim.spawnInCircle(ELF, 170, 70, 3, 6);
    const ids = ofSpecies(sim, ELF);
    for (const id of ids) sim.creatures.hunger[sim.creatures.indexOf(id)] = 80;
    let ate = false;
    for (let t = 0; t < 400 && !ate; t++) {
      sim.step();
      for (const id of ids) {
        const i = sim.creatures.indexOf(id);
        if (i >= 0 && sim.creatures.state[i] === STATE.EAT) ate = true;
      }
    }
    expect(ate).toBe(true);
    const i0 = sim.creatures.indexOf(ids[0]);
    const age = sim.creatures.age[i0];
    run(sim, 10);
    expect(sim.creatures.age[i0]).toBe(age + 10);
    // A raptor next to an elf makes it run.
    const i = sim.creatures.indexOf(ids[1]);
    sim.creatures.spawn(RAPTOR, sim.creatures.x[i] + 2, sim.creatures.y[i], sim.rng);
    let fled = false;
    for (let t = 0; t < 12 && !fled; t++) {
      sim.step();
      fled = sim.creatures.state[sim.creatures.indexOf(ids[1])] === STATE.FLEE;
    }
    expect(fled).toBe(true);
  });
});

describe('where elves want to live', () => {
  it('their profile changes the real site score: the forest pulls elves much more than humans', () => {
    const sim = quiet(twoLands());
    const grass = (sp: number) => assessSite(sim.world, sim.creatures, sim.settlements, 46, 60, sp);
    const forest = (sp: number) => assessSite(sim.world, sim.creatures, sim.settlements, 153, 60, sp);
    for (const sp of [ELF, HUMAN]) {
      expect(grass(sp).ok).toBe(true);
      expect(forest(sp).ok).toBe(true);
    }
    expect(forest(ELF).score).toBeGreaterThan(grass(ELF).score);
    // Humans (unchanged weights) also like trees near water, but the forest pull is clearly stronger for elves.
    expect(forest(ELF).score - grass(ELF).score).toBeGreaterThan(forest(HUMAN).score - grass(HUMAN).score + 0.1);
    expect(forest(ELF).score).toBeGreaterThanOrEqual(SETTLE_SCORE);
    // Neither people is better everywhere: each scores its own land higher than the other people does.
    expect(forest(ELF).score).toBeGreaterThan(forest(HUMAN).score);
    expect(grass(HUMAN).score).toBeGreaterThan(grass(ELF).score);
  });

  it('elves keep more distance from other settlements than humans do', () => {
    const sim = quiet(twoLands());
    sim.spawnInCircle(HUMAN, 46, 60, 3, 8);
    expect(typeof sim.foundSettlement(46, 60, 'human')).toBe('object');
    // 18 tiles away: far enough for humans (16), too close for elves (20).
    const s = sim.settlements.list[0];
    const human = assessSite(sim.world, sim.creatures, sim.settlements, s.x + 18, s.y, HUMAN);
    const elf = assessSite(sim.world, sim.creatures, sim.settlements, s.x + 18, s.y, ELF);
    expect(human.fail).not.toBe('gap');
    expect(elf.fail).toBe('gap');
  });

  it('have their own group size and keep groups to one people', () => {
    expect(SPECIES[ELF].civ!.groupMax).toBeLessThan(SPECIES[HUMAN].civ!.groupMax);
    const sim = quiet(twoLands());
    sim.spawnInCircle(ELF, 46, 70, 2, 5);
    sim.spawnInCircle(HUMAN, 47, 70, 2, 5);
    run(sim, 120);
    expect(sim.groups.list.length).toBeGreaterThanOrEqual(2);
    for (const g of sim.groups.list) expect(g.members.length).toBeLessThanOrEqual(SPECIES[g.species].civ!.groupMax);
    checkIntegrity(sim);
  });
});

describe('elves settle by themselves', () => {
  it('a band of elves in the forest founds an elven settlement of real inhabitants', () => {
    const sim = quiet(twoLands());
    sim.spawnInCircle(ELF, 153, 60, 3, 7);
    const ids = ofSpecies(sim, ELF);
    run(sim, 2000);
    const s = sim.settlements.list.find((x) => x.species === ELF);
    expect(s).toBeDefined();
    expect(s!.civ).toBeDefined();
    expect(sim.world.terrain[s!.y * sim.world.width + s!.x]).not.toBe(T.LAKE);
    expect(ids.filter((id) => s!.members.includes(id)).length).toBeGreaterThanOrEqual(4);
    expect(sim.history.some((h) => h.code === 'settlement_founded' && h.p?.species === ELF)).toBe(true);
    // Members stay individual creatures that can be picked.
    const i = sim.creatures.indexOf(s!.members[0]);
    expect(sim.creatures.candidatesAt(sim.creatures.x[i], sim.creatures.y[i], 1)).toContain(i);
    checkIntegrity(sim);
  });

  it('humans and elves in one world each found their own settlement and never mix', () => {
    const sim = quiet(twoLands());
    sim.spawnInCircle(HUMAN, 46, 60, 3, 7);
    sim.spawnInCircle(ELF, 153, 60, 3, 7);
    run(sim, 2400);
    const human = sim.settlements.list.filter((x) => x.species === HUMAN);
    const elven = sim.settlements.list.filter((x) => x.species === ELF);
    expect(human.length).toBeGreaterThanOrEqual(1);
    expect(elven.length).toBeGreaterThanOrEqual(1);
    expect(sim.settlements.list.length).toBeLessThanOrEqual(4); // no swarm of empty settlements
    for (const s of sim.settlements.list) expect(s.members.length).toBeGreaterThan(0);
    checkIntegrity(sim);
  });

  it('the found tool on a mixed crowd founds a settlement of one people only', () => {
    const sim = quiet(twoLands());
    sim.groups.enabled = false;
    sim.spawnInCircle(ELF, 46, 60, 3, 7);
    sim.spawnInCircle(HUMAN, 46, 60, 3, 3);
    const s = sim.foundSettlement(46, 60, 'human') as Settlement;
    expect(typeof s).toBe('object');
    expect(s.species).toBe(ELF);
    for (const m of s.members) expect(sim.creatures.species[sim.creatures.indexOf(m)]).toBe(ELF);
    run(sim, 400);
    checkIntegrity(sim);
  });

  it('people who join or found a settlement leave their group at once, so a save never holds them twice', () => {
    const sim = quiet(twoLands());
    sim.spawnInCircle(ELF, 153, 60, 2, 6);
    run(sim, 40); // a group forms
    const grouped = sim.groups.list.flatMap((g) => g.members);
    expect(grouped.length).toBeGreaterThan(0);
    sim.groups.enabled = false;
    const s = sim.foundSettlement(153, 60, 'human') as Settlement;
    expect(typeof s).toBe('object');
    for (const id of s.members) expect(sim.groups.groupOfCreature(id)).toBeUndefined();
    checkIntegrity(sim);
    const other = quiet(flat(8, 8));
    deserializeInto(other, serialize(sim));
    expect(other.groups.exportState()).toEqual(sim.groups.exportState());
  });

  it('a dissolved elven settlement leaves its elves alive', () => {
    const sim = quiet(twoLands());
    sim.groups.enabled = false;
    sim.spawnInCircle(ELF, 153, 60, 3, 7);
    const s = sim.foundSettlement(153, 60, 'human') as Settlement;
    const ids = [...s.members];
    for (const id of ids) {
      const i = sim.creatures.indexOf(id);
      sim.creatures.x[i] = 30.5; // all walk far away: they leave, the settlement is abandoned
      sim.creatures.y[i] = 100.5;
    }
    run(sim, STEP_TICKS * 2);
    expect(sim.settlements.list.some((x) => x.id === s.id)).toBe(false);
    for (const id of ids) expect(sim.creatures.indexOf(id)).toBeGreaterThanOrEqual(0);
  });
});

describe('elven architecture', () => {
  it('human and elven houses look different at every level, and each style differs between levels', () => {
    for (let l = 1; l <= 4; l++) expect(art('elven', l)).not.toBe(art('human', l));
    for (const style of ['human', 'elven'] as const) {
      const looks = new Set([1, 2, 3, 4].map((l) => art(style, l)));
      expect(looks.size).toBe(4);
      expect(HOUSE_STYLES[style].dots.slice(1).length).toBe(4);
    }
    expect(HOUSE_STYLES.elven.dots.slice(1)).not.toEqual(HOUSE_STYLES.human.dots.slice(1));
  });

  it('elven houses use the shared upgrade rules: same id, capacity, builders, no duplicates', () => {
    const sim = quiet(twoLands());
    sim.settlements.auto = false;
    sim.groups.enabled = false;
    sim.spawnInCircle(ELF, 153, 60, 3, 10);
    const s = sim.foundSettlement(153, 60, 'human') as Settlement;
    const civ = s.civ as Civ;
    civ.stage = 'village';
    civ.wood = 60;
    civ.food = 60;
    const house: Building = {
      id: civ.nextBuildingId++, type: 'house', x: 153, y: 64, started: 0, progress: 6, needed: 6, done: true, reserve: 0, acc: 0, active: false, idle: 0,
      empty: false, here: 0, level: 1, up: 0,
    };
    civ.buildings.push(house);
    const cap = housing(civ);
    expect(typeof sim.settlements.upgradeHouse(s)).toBe('object');
    for (let k = 0; k < 60 && house.up; k++) {
      run(sim, STEP_TICKS);
      expect(civ.jobs.filter((j) => j.b === house.id).length).toBeLessThanOrEqual(BUILDERS);
      for (const b of civ.buildings) expect(civ.jobs.filter((j) => j.b === b.id).length).toBeLessThanOrEqual(slotsOf(b));
    }
    expect(house.level).toBe(2);
    expect(civ.buildings.filter((b) => b.type === 'house').length).toBe(1);
    expect(civ.buildings.find((b) => b.type === 'house')).toBe(house);
    expect(housing(civ)).toBe(cap - houseCapacity({ ...house, level: 1 }) + houseCapacity(house));
    expect(sim.history.some((h) => h.code === 'settlement_house_upgraded' && h.p?.species === ELF)).toBe(true);
  });
});

describe('saves', () => {
  function world(): Simulation {
    const sim = quiet(twoLands());
    sim.spawnInCircle(HUMAN, 46, 60, 3, 7);
    sim.spawnInCircle(ELF, 153, 60, 3, 7);
    run(sim, 2000);
    return sim;
  }

  it('humans and elves, their settlements and house levels survive a save, and the world continues exactly', () => {
    const sim = world();
    const elven = sim.settlements.list.find((s) => s.species === ELF)!;
    expect(elven).toBeDefined();
    const h = { id: elven.civ!.nextBuildingId++, type: 'house' as const, x: elven.x, y: elven.y + 3, started: 0, progress: 2, needed: 8, done: true, reserve: 0, acc: 0, active: false, idle: 0, empty: false, here: 0, level: 2, up: 3 };
    elven.civ!.buildings.push(h);
    const data = serialize(sim);
    expect(data.version).toBe(SAVE_VERSION);
    const other = quiet(flat(8, 8));
    deserializeInto(other, data);
    expect(other.settlements.exportState()).toEqual(sim.settlements.exportState());
    expect(other.groups.exportState()).toEqual(sim.groups.exportState());
    const h2 = other.settlements.list.find((s) => s.id === elven.id)!.civ!.buildings.find((b) => b.id === h.id)!;
    expect([h2.level, h2.up, h2.progress]).toEqual([2, 3, 2]);
    expect(ofSpecies(other, ELF)).toEqual(ofSpecies(sim, ELF));
    run(sim, 600);
    run(other, 600);
    expect(other.settlements.exportState()).toEqual(sim.settlements.exportState());
    checkIntegrity(other);
  });

  it('a save from the previous format (11, no elves) loads with its human settlement intact', () => {
    const sim = quiet(twoLands());
    sim.spawnInCircle(HUMAN, 46, 60, 3, 8);
    run(sim, 1500);
    expect(sim.settlements.list.length).toBeGreaterThan(0);
    const data = serialize(sim);
    const old = { ...data, version: 11 } as typeof data;
    const c = old.creatures as unknown as { statSpecies: number; birthStats: Uint32Array; deathStats: Uint32Array };
    c.statSpecies = 6;
    c.birthStats = c.birthStats.slice(0, 6);
    c.deathStats = c.deathStats.slice(0, (c.deathStats.length / SPECIES.length) * 6);
    const other = quiet(flat(8, 8));
    deserializeInto(other, old);
    expect(other.settlements.exportState()).toEqual(sim.settlements.exportState());
    expect(ofSpecies(other, HUMAN)).toEqual(ofSpecies(sim, HUMAN));
    expect(other.creatures.birthStats[ELF]).toBe(0);
  });

  it('is deterministic with both peoples', () => {
    const make = () => JSON.stringify(world().settlements.exportState());
    expect(make()).toBe(make());
  });
});
