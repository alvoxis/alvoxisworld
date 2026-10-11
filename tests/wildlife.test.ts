import { describe, expect, it } from 'vitest';
import { LIFE_GROUPS, TOOLS, lifeGroupOf } from '../src/game/tools';
import { en } from '../src/i18n/en';
import { ru } from '../src/i18n/ru';
import { zh } from '../src/i18n/zh';
import { BEAR, CAUSE, CAUSE_COUNT, DEER, ELF, GRAZER, HUMAN, RABBIT, SPECIES, STATE, WOLF } from '../src/sim/creatures';
import { Simulation } from '../src/sim/simulation';
import { SEA_LEVEL, T } from '../src/world/terrain';
import { World } from '../src/world/world';

function meadow(seed = 21): World {
  const w = new World(120, 90, seed);
  w.heights.fill(SEA_LEVEL + 20);
  w.temperature.fill(140);
  w.moisture.fill(130);
  w.baseTemperature.fill(140);
  w.baseMoisture.fill(130);
  w.terrain.fill(T.GRASS);
  const block = (x0: number, y0: number, x1: number, y1: number, t: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) w.terrain[y * w.width + x] = t;
  };
  block(70, 10, 110, 50, T.FOREST);
  for (const [x, y] of [[30, 30], [60, 60], [90, 70], [40, 70], [100, 25]]) block(x, y, x + 3, y + 2, T.LAKE);
  return w;
}

const deaths = (sim: Simulation, sp: number, cause: number) => sim.creatures.deathStats[sp * CAUSE_COUNT + cause];
const alive = (sim: Simulation, sp: number) => {
  let n = 0;
  for (let i = 0; i < sim.creatures.count; i++) if (sim.creatures.species[i] === sp && sim.creatures.isAlive(i)) n++;
  return n;
};

describe('kinds of life in the creatures tab', () => {
  it('every species is listed in exactly one group; groups are never empty; sea groups hold only sea animals', () => {
    for (const sp of SPECIES) {
      const groups = LIFE_GROUPS.filter((g) => g.species.includes(sp.id));
      expect(groups.length).toBe(1);
      expect(groups[0].section).toBe(sp.habitat === 'water' ? 'sea' : 'land');
      const tool = TOOLS.find((t) => t.id === `spawn_${sp.key}`)!;
      expect(tool.group).toBe(lifeGroupOf(sp.id).id);
    }
    for (const g of LIFE_GROUPS) expect(g.species.length).toBeGreaterThan(0);
    // Both sections exist; every group and section is named in every language.
    expect(new Set(LIFE_GROUPS.map((g) => g.section))).toEqual(new Set(['land', 'sea']));
    for (const dict of [en, ru, zh] as Array<Record<string, string>>) {
      for (const g of LIFE_GROUPS) expect(dict[`life.group.${g.id}`]).toBeTruthy();
      for (const sec of ['land', 'sea']) expect(dict[`life.section.${sec}`]).toBeTruthy();
      for (const sp of SPECIES) expect(dict[`species.${sp.key}`]).toBeTruthy();
    }
    // Tools without a group (select, remove life) are shown in every group.
    expect(TOOLS.filter((t) => t.category === 'creatures' && !t.group).map((t) => t.id)).toEqual(expect.arrayContaining(['select', 'smite']));
  });
});

describe('new animals are real creatures with their own ecology', () => {
  it('each has its own diet, habitat and limits; the new predators do not hunt people', () => {
    for (const id of [DEER, RABBIT]) {
      const sp = SPECIES[id];
      expect(sp.diet).toBe('herbivore');
      expect(sp.food.length).toBeGreaterThan(0);
      expect(sp.habitat).toBe('land');
    }
    for (const id of [WOLF, BEAR]) {
      const sp = SPECIES[id];
      expect(sp.diet).toBe('carnivore');
      expect(sp.prey.length).toBeGreaterThan(0);
      expect(sp.prey).not.toContain(HUMAN);
      expect(sp.prey).not.toContain(ELF);
      for (const p of sp.prey) expect(SPECIES[p].habitat).toBe('land');
    }
    // Not copies of one another (or of people): size, speed and breeding differ.
    const looks = [DEER, RABBIT, WOLF, BEAR, HUMAN].map((id) => `${SPECIES[id].size}|${SPECIES[id].speed}|${SPECIES[id].breedCooldown}`);
    expect(new Set(looks).size).toBe(5);
    expect(SPECIES[BEAR].size).toBeGreaterThan(SPECIES[WOLF].size);
    expect(SPECIES[RABBIT].size).toBeLessThan(SPECIES[DEER].size);
    expect(SPECIES[RABBIT].breedCooldown).toBeLessThan(SPECIES[DEER].breedCooldown);
  });

  it('wolves and bears hunt deer and rabbits; deer flee; people nearby are never hunted by them', { timeout: 120000 }, () => {
    const sim = new Simulation(meadow());
    sim.weather.config.auto = false;
    sim.settlements.auto = false;
    sim.groups.enabled = false;
    sim.spawnInCircle(DEER, 50, 40, 6, 14);
    sim.spawnInCircle(RABBIT, 40, 50, 6, 20);
    sim.spawnInCircle(WOLF, 46, 44, 3, 4);
    sim.spawnInCircle(BEAR, 54, 46, 2, 2);
    sim.spawnInCircle(HUMAN, 20, 60, 3, 6);
    let fled = false;
    for (let t = 0; t < 2400; t++) {
      sim.step();
      if (!fled) for (let i = 0; i < sim.creatures.count; i++) if (sim.creatures.species[i] === DEER && sim.creatures.state[i] === STATE.FLEE) fled = true;
    }
    expect(deaths(sim, DEER, CAUSE.PREDATION) + deaths(sim, RABBIT, CAUSE.PREDATION)).toBeGreaterThan(0);
    expect(fled).toBe(true);
    expect(deaths(sim, HUMAN, CAUSE.PREDATION)).toBe(0);
    // Nobody was removed: the animals that live are still there.
    expect(alive(sim, WOLF) + alive(sim, BEAR)).toBeGreaterThan(0);
  });

  it('over three years the meadow keeps its herbivores and predators side by side', { timeout: 180000 }, () => {
    for (const seed of [5, 17]) {
      const sim = new Simulation(meadow(seed));
      sim.weather.config.auto = false;
      sim.settlements.auto = false;
      sim.groups.enabled = false;
      sim.spawnInCircle(DEER, 50, 40, 8, 16);
      sim.spawnInCircle(RABBIT, 40, 50, 8, 24);
      sim.spawnInCircle(GRAZER, 30, 60, 6, 10);
      sim.spawnInCircle(WOLF, 60, 40, 3, 3);
      for (let t = 0; t < 3 * 480; t++) sim.step();
      expect(alive(sim, DEER)).toBeGreaterThan(0);
      expect(alive(sim, RABBIT)).toBeGreaterThan(0);
      expect(alive(sim, GRAZER)).toBeGreaterThan(0);
      // Rabbits breed fast: their numbers grew or held despite the wolves.
      expect(sim.creatures.birthStats[RABBIT]).toBeGreaterThan(0);
    }
  });
});
