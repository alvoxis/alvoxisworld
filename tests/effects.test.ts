import { describe, expect, it } from 'vitest';
import { deserializeInto, serialize } from '../src/save/serialize';
import { CAUSE, GRAZER, RAPTOR } from '../src/sim/creatures';
import { EFFECT, EFFECTS, EFFECT_DURATIONS } from '../src/sim/effects';
import { Simulation } from '../src/sim/simulation';
import { UndoHistory } from '../src/game/undo';
import { TOOLS } from '../src/game/tools';
import { SEA_LEVEL, T } from '../src/world/terrain';
import { WATER_FLAG, World } from '../src/world/world';

function testWorld(w: number, h: number, fill: number, rects: Array<[number, number, number, number, number]> = []): World {
  const world = new World(w, h, 1);
  world.heights.fill(SEA_LEVEL + 20);
  world.temperature.fill(140);
  world.moisture.fill(110);
  world.baseTemperature.fill(140);
  world.baseMoisture.fill(110);
  world.terrain.fill(fill);
  for (const [x0, y0, x1, y1, id] of rects) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = world.idx(x, y);
        world.terrain[i] = id;
        if (id === T.LAKE) world.waterFlags[i] = WATER_FLAG.LAKE_BED;
        if (id === T.RIVER) world.waterFlags[i] = WATER_FLAG.RIVER_BED;
        if (id === T.SHALLOW_WATER) world.heights[i] = SEA_LEVEL - 10;
      }
    }
  }
  return world;
}

function sim1(): { sim: Simulation; id: number } {
  const sim = new Simulation(testWorld(64, 64, T.GRASS, [[0, 0, 64, 2, T.SHALLOW_WATER]]));
  sim.weather.config.auto = false;
  const id = sim.creatures.spawn(GRAZER, 32.5, 32.5, sim.rng, { hunger: 0, thirst: 0 });
  return { sim, id };
}

const run = (sim: Simulation, n: number) => {
  for (let t = 0; t < n; t++) sim.step();
};

describe('buffs and debuffs', () => {
  it('every exposed effect has a tool, a description and an opposite pair', () => {
    for (const e of EFFECTS) {
      expect(TOOLS.some((t) => t.id === `effect_${e.key}`)).toBe(true);
      expect(e.description.length).toBeGreaterThan(5);
      expect(EFFECTS[e.opposite].opposite).toBe(e.id);
      expect(EFFECTS[e.opposite].kind).not.toBe(e.kind);
    }
  });

  it('Haste speeds up and Slowness slows down movement', () => {
    const dist = (effect: number | null) => {
      const { sim, id } = sim1();
      const i = sim.creatures.indexOf(id);
      if (effect !== null) sim.creatures.applyEffect(i, effect, 500, 3, EFFECTS[effect].opposite);
      sim.creatures.state[i] = 6; // FLEE: steady straight movement
      sim.creatures.timer[i] = 60;
      sim.creatures.dx[i] = 1;
      sim.creatures.dy[i] = 0;
      sim.creatures.tx[i] = 0;
      sim.creatures.ty[i] = 32.5;
      const x0 = sim.creatures.x[i];
      sim.step();
      return sim.creatures.x[sim.creatures.indexOf(id)] - x0;
    };
    const normal = dist(null);
    expect(dist(EFFECT.HASTE)).toBeCloseTo(normal * 1.75, 3);
    expect(dist(EFFECT.SLOW)).toBeCloseTo(normal * 0.4, 3);
  });

  it('Regeneration heals; Poison hurts and can kill (cause: poison)', () => {
    const a = sim1();
    const i = a.sim.creatures.indexOf(a.id);
    a.sim.creatures.health[i] = 5;
    a.sim.creatures.applyEffect(i, EFFECT.REGEN, 100, 2, EFFECT.POISON);
    run(a.sim, 50);
    expect(a.sim.creatures.health[a.sim.creatures.indexOf(a.id)]).toBeGreaterThan(20);

    const b = sim1();
    b.sim.creatures.applyEffect(b.sim.creatures.indexOf(b.id), EFFECT.POISON, 2000, 3, EFFECT.REGEN);
    run(b.sim, 400);
    expect(b.sim.creatures.indexOf(b.id)).toBe(-1);
    expect(b.sim.creatures.deathsBy(GRAZER, CAUSE.POISON)).toBe(1);
  });

  it('Well fed stops hunger and thirst; Famished makes them grow faster', () => {
    const needs = (effect: number | null, power = 1) => {
      const { sim, id } = sim1();
      const i = sim.creatures.indexOf(id);
      if (effect !== null) sim.creatures.applyEffect(i, effect, 500, power, EFFECTS[effect].opposite);
      sim.creatures.state[i] = 0;
      sim.creatures.hunger[i] = 10;
      sim.step();
      return sim.creatures.hunger[sim.creatures.indexOf(id)] - 10;
    };
    const normal = needs(null);
    expect(normal).toBeGreaterThan(0);
    expect(needs(EFFECT.FED)).toBeLessThanOrEqual(0);
    expect(needs(EFFECT.FAMINE, 2)).toBeCloseTo(normal * 2, 4);
  });

  it('Sterility stops breeding; Fertility speeds it up', () => {
    const births = (effect: number | null) => {
      const sim = new Simulation(testWorld(48, 48, T.GRASS, [[0, 0, 48, 3, T.SHALLOW_WATER]]));
      sim.weather.config.auto = false;
      for (const x of [24, 24.5]) {
        const id = sim.creatures.spawn(GRAZER, x, 10, sim.rng);
        if (effect !== null) sim.creatures.applyEffect(sim.creatures.indexOf(id), effect, 2000, 3, EFFECTS[effect].opposite);
      }
      run(sim, 600);
      return sim.creatures.birthStats[GRAZER];
    };
    const normal = births(null);
    expect(normal).toBeGreaterThan(0);
    expect(births(EFFECT.STERILE)).toBe(0);
    expect(births(EFFECT.FERTILE)).toBeGreaterThan(normal);
  });

  it('applying refreshes (longest wins), cancels the opposite, and effects expire', () => {
    const { sim, id } = sim1();
    const c = sim.creatures;
    const i = c.indexOf(id);
    c.applyEffect(i, EFFECT.HASTE, 100, 1, EFFECT.SLOW);
    c.applyEffect(i, EFFECT.HASTE, 50, 3, EFFECT.SLOW);
    expect(c.effectTicks(i, EFFECT.HASTE)).toBe(100);
    expect(c.effectPower(i, EFFECT.HASTE)).toBe(3);
    c.applyEffect(i, EFFECT.SLOW, 30, 2, EFFECT.HASTE);
    expect(c.effectPower(i, EFFECT.HASTE)).toBe(0);
    expect(c.effectPower(i, EFFECT.SLOW)).toBe(2);
    run(sim, 30);
    expect(c.effectPower(c.indexOf(id), EFFECT.SLOW)).toBe(0);
    expect(c.effMask[c.indexOf(id)]).toBe(0);
  });

  it('the Simulation applies to creatures under the brush (or the nearest) and Cleanse removes all', () => {
    const sim = new Simulation(testWorld(64, 64, T.GRASS));
    sim.weather.config.auto = false;
    sim.spawnInCircle(GRAZER, 20, 20, 2, 5);
    const lone = sim.creatures.spawn(RAPTOR, 50.5, 50.5, sim.rng);
    expect(sim.applyEffect(EFFECT.FED, 20, 20, 4, EFFECT_DURATIONS[0].ticks, 1)).toBe(5);
    expect(sim.applyEffect(EFFECT.POISON, 51.5, 50.5, 0.3, 100, 1)).toBe(1); // nearest within 2 tiles
    expect(sim.creatures.effectPower(sim.creatures.indexOf(lone), EFFECT.POISON)).toBe(1);
    expect(sim.applyEffect(EFFECT.POISON, 5, 60, 0.3, 100, 1)).toBe(0);
    expect(sim.cleanse(20, 20, 4)).toBe(5);
    for (let i = 0; i < sim.creatures.count; i++) if (sim.creatures.species[i] === GRAZER) expect(sim.creatures.effMask[i]).toBe(0);
  });

  it('effects survive save/load (v5) and keep moving with compaction', () => {
    const { sim, id } = sim1();
    const other = sim.creatures.spawn(GRAZER, 40.5, 40.5, sim.rng);
    sim.creatures.applyEffect(sim.creatures.indexOf(other), EFFECT.HASTE, 300, 2, EFFECT.SLOW);
    sim.creatures.removeById(id); // compaction moves `other` into slot 0
    const j = sim.creatures.indexOf(other);
    expect(sim.creatures.effectPower(j, EFFECT.HASTE)).toBe(2);
    const loaded = new Simulation(testWorld(8, 8, T.GRASS));
    deserializeInto(loaded, serialize(sim));
    const k = loaded.creatures.indexOf(other);
    expect(loaded.creatures.effectPower(k, EFFECT.HASTE)).toBe(2);
    expect(loaded.creatures.effectTicks(k, EFFECT.HASTE)).toBe(sim.creatures.effectTicks(j, EFFECT.HASTE));
  });
});

describe('terrain and water powers', () => {
  it('Flood covers land with temporary water that remembers the land beneath; Drain restores it', () => {
    const world = testWorld(40, 40, T.GRASS, [[0, 0, 40, 3, T.SHALLOW_WATER], [30, 30, 33, 33, T.MOUNTAIN]]);
    const sim = new Simulation(world);
    sim.weather.config.auto = false;
    const v = world.passVersion;
    const n = sim.flood(20, 20, 4);
    expect(n).toBeGreaterThan(30);
    expect(world.terrainAt(20, 20)).toBe(T.LAKE);
    expect(world.waterFlags[world.idx(20, 20)] & WATER_FLAG.FLOOD).toBeTruthy();
    expect(world.under[world.idx(20, 20)]).toBe(T.GRASS);
    expect(world.passVersion).toBeGreaterThan(v); // navigation will rebuild
    sim.flood(31, 31, 1); // mountains stay dry
    expect(world.terrainAt(31, 31)).toBe(T.MOUNTAIN);
    expect(sim.drain(20, 20, 4)).toBe(n);
    expect(world.terrainAt(20, 20)).toBe(T.GRASS);
    expect(world.waterFlags[world.idx(20, 20)]).toBe(0);
  });

  it('flood water drains away on its own over time', () => {
    const world = testWorld(40, 40, T.GRASS);
    const sim = new Simulation(world);
    sim.weather.config.auto = false;
    const n = sim.flood(20, 20, 5);
    run(sim, 6000);
    let left = 0;
    for (let i = 0; i < world.terrain.length; i++) if (world.waterFlags[i] & WATER_FLAG.FLOOD) left++;
    expect(left).toBeLessThan(n * 0.2);
  });

  it('Drain dries lakes and rivers into beds that rain refills; the sea is untouched', () => {
    const world = testWorld(40, 40, T.GRASS, [[5, 5, 15, 15, T.LAKE], [20, 0, 21, 40, T.RIVER], [30, 30, 40, 40, T.SHALLOW_WATER]]);
    const sim = new Simulation(world);
    sim.weather.config.auto = false;
    sim.drain(10, 10, 3);
    expect(world.terrainAt(10, 10)).toBe(T.SOIL);
    expect(world.waterFlags[world.idx(10, 10)] & WATER_FLAG.LAKE_BED).toBeTruthy();
    sim.drain(20.5, 20, 2);
    expect(world.terrainAt(20, 20)).toBe(T.SAND);
    sim.drain(35, 35, 3);
    expect(world.terrainAt(35, 35)).toBe(T.SHALLOW_WATER);
    const lakeTiles = () => {
      let n = 0;
      for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) if (world.terrainAt(x, y) === T.LAKE) n++;
      return n;
    };
    const dried = lakeTiles();
    sim.summonWeather(0, 15, 15, 20, 3);
    run(sim, 600);
    expect(lakeTiles() - dried).toBeGreaterThan(10); // most of the drained bed refilled
  });

  it('Extinguish puts out fires', () => {
    const world = testWorld(40, 40, T.FOREST);
    world.moisture.fill(0);
    const sim = new Simulation(world);
    sim.weather.config.auto = false;
    sim.igniteArea(20, 20, 3);
    expect(sim.fire.burning).toBeGreaterThan(0);
    sim.extinguish(20, 20, 10);
    sim.step();
    expect(sim.fire.burning).toBe(0);
  });

  it('Flood and Drain are undoable terrain actions', () => {
    const world = testWorld(40, 40, T.GRASS);
    const sim = new Simulation(world);
    const before = world.terrain.slice();
    const u = new UndoHistory();
    u.record(world, 'Flood', () => sim.flood(20, 20, 4));
    u.undo(world);
    expect(world.terrain).toEqual(before);
    expect(world.waterFlags.every((f) => f === 0)).toBe(true);
  });
});
