import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { deserializeInto, serialize, type SaveData } from '../src/save/serialize';
import { TICKS_PER_SECOND } from '../src/sim/clock';
import {
  CAUSE, Creatures, FISH, GRAZER, HADROSAUR, MAX_CREATURES, RAPTOR, SPECIES, STATE, TYRANT, findTile,
} from '../src/sim/creatures';
import { Simulation } from '../src/sim/simulation';
import { SEA_LEVEL, T } from '../src/world/terrain';
import { World } from '../src/world/world';

/**
 * Hand-built test world: everything is `fill` terrain on flat land, then optional
 * rectangles of other terrain. No generator, so each test controls the habitat exactly.
 */
function testWorld(w: number, h: number, fill: number, rects: Array<[number, number, number, number, number]> = []): World {
  const world = new World(w, h, 1);
  world.heights.fill(SEA_LEVEL + 20);
  world.temperature.fill(140);
  world.moisture.fill(110);
  world.terrain.fill(fill);
  for (const [x0, y0, x1, y1, id] of rects) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = world.idx(x, y);
        world.terrain[i] = id;
        if (id === T.DEEP_WATER || id === T.SHALLOW_WATER) world.heights[i] = SEA_LEVEL - 10;
      }
    }
  }
  return world;
}

function run(sim: Simulation, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.step();
}

function only(sim: Simulation): number {
  expect(sim.creatures.count).toBe(1);
  return 0;
}

describe('creature basics', () => {
  it('gives every creature a unique, never reused id', () => {
    const sim = new Simulation(testWorld(32, 32, T.GRASS));
    const ids = new Set<number>();
    for (let k = 0; k < 20; k++) ids.add(sim.creatures.spawn(GRAZER, 10, 10, sim.rng));
    sim.creatures.removeInCircle(10, 10, 5);
    const next = sim.creatures.spawn(GRAZER, 10, 10, sim.rng);
    expect(ids.size).toBe(20);
    expect(ids.has(next)).toBe(false);
  });

  it('spawns only where the habitat allows', () => {
    const sim = new Simulation(testWorld(40, 40, T.GRASS, [[0, 0, 20, 40, T.SHALLOW_WATER]]));
    expect(sim.spawnInCircle(FISH, 30, 20, 3, 5)).toBe(0); // fish on land: refused
    expect(sim.spawnInCircle(GRAZER, 10, 20, 3, 5)).toBe(0); // grazer in water: refused
    expect(sim.spawnInCircle(FISH, 10, 20, 3, 5)).toBe(5);
    expect(sim.spawnInCircle(GRAZER, 30, 20, 3, 5)).toBe(5);
  });

  it('removes a creature by id and records the cause', () => {
    const sim = new Simulation(testWorld(32, 32, T.GRASS));
    const id = sim.creatures.spawn(RAPTOR, 10, 10, sim.rng);
    expect(sim.creatures.removeById(id)).toBe(true);
    expect(sim.creatures.indexOf(id)).toBe(-1);
    expect(sim.creatures.deathsBy(RAPTOR, CAUSE.REMOVED)).toBe(1);
  });
});

describe('movement constraints', () => {
  it('land animals never step into water and fish never leave it', () => {
    // Left half water, right half grass.
    const world = testWorld(48, 48, T.GRASS, [[0, 0, 24, 48, T.SHALLOW_WATER]]);
    const sim = new Simulation(world);
    sim.spawnInCircle(GRAZER, 30, 24, 4, 15);
    sim.spawnInCircle(RAPTOR, 30, 24, 4, 3);
    sim.spawnInCircle(FISH, 12, 24, 4, 15);
    for (let t = 0; t < 600; t++) {
      sim.step();
      const c = sim.creatures;
      for (let i = 0; i < c.count; i++) {
        const water = world.isWaterAt(Math.floor(c.x[i]), Math.floor(c.y[i]));
        expect(water).toBe(SPECIES[c.species[i]].habitat === 'water');
      }
    }
    expect(sim.creatures.deathsBy(GRAZER, CAUSE.DROWNED)).toBe(0);
    expect(sim.creatures.deathsBy(FISH, CAUSE.STRANDED)).toBe(0);
  });

  it('hadrosaurs and tyrants cannot climb mountains', () => {
    const world = testWorld(48, 48, T.FOREST, [[20, 0, 28, 48, T.MOUNTAIN]]);
    const sim = new Simulation(world);
    sim.spawnInCircle(HADROSAUR, 10, 24, 4, 6);
    sim.spawnInCircle(TYRANT, 10, 24, 4, 2);
    for (let t = 0; t < 800; t++) {
      sim.step();
      const c = sim.creatures;
      for (let i = 0; i < c.count; i++) {
        expect(world.terrainAt(Math.floor(c.x[i]), Math.floor(c.y[i]))).not.toBe(T.MOUNTAIN);
      }
    }
  });

  it('flooding the land drowns land animals; draining strands fish', () => {
    const world = testWorld(32, 32, T.GRASS, [[0, 0, 10, 32, T.SHALLOW_WATER]]);
    const sim = new Simulation(world);
    sim.creatures.spawn(GRAZER, 20, 16, sim.rng);
    sim.creatures.spawn(FISH, 5, 16, sim.rng);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) world.setTerrain(x, y, x < 10 ? T.GRASS : T.SHALLOW_WATER);
    }
    sim.step();
    expect(sim.creatures.count).toBe(0);
    expect(sim.creatures.deathsBy(GRAZER, CAUSE.DROWNED)).toBe(1);
    expect(sim.creatures.deathsBy(FISH, CAUSE.STRANDED)).toBe(1);
  });
});

describe('needs and food seeking', () => {
  it('a hungry herbivore walks to food it can see and eats', () => {
    // Desert everywhere except a grass patch 6 tiles east; water next to the start.
    const world = testWorld(40, 40, T.DESERT, [[26, 18, 30, 22, T.GRASS], [18, 25, 22, 28, T.SHALLOW_WATER]]);
    const sim = new Simulation(world);
    sim.creatures.spawn(GRAZER, 20.5, 20.5, sim.rng, { hunger: 80, thirst: 0 });
    let ate = false;
    for (let t = 0; t < 400 && !ate; t++) {
      sim.step();
      const i = only(sim);
      if (sim.creatures.state[i] === STATE.EAT) ate = true;
    }
    expect(ate).toBe(true);
    const i = only(sim);
    expect(world.terrainAt(Math.floor(sim.creatures.x[i]), Math.floor(sim.creatures.y[i]))).toBe(T.GRASS);
    run(sim, 40);
    expect(sim.creatures.hunger[only(sim)]).toBeLessThan(40);
  });

  it('a thirsty animal walks to water and drinks', () => {
    // Water 20 tiles east, out of sight for food but within the water search.
    const world = testWorld(48, 32, T.GRASS, [[30, 0, 48, 32, T.SHALLOW_WATER]]);
    const sim = new Simulation(world);
    sim.creatures.spawn(GRAZER, 10.5, 16.5, sim.rng, { hunger: 0, thirst: 70 });
    let drank = false;
    for (let t = 0; t < 600 && !drank; t++) {
      sim.step();
      if (sim.creatures.state[only(sim)] === STATE.DRINK) drank = true;
    }
    expect(drank).toBe(true);
    run(sim, 30);
    expect(sim.creatures.thirst[only(sim)]).toBeLessThan(30);
  });

  it('findTile returns the nearest match ring by ring', () => {
    const world = testWorld(30, 30, T.DESERT, [[20, 10, 21, 11, T.GRASS], [13, 10, 14, 11, T.GRASS]]);
    const hit = findTile(world, 10, 10, 15, new Rng(1), (x, y) => world.terrainAt(x, y) === T.GRASS);
    expect(hit).toEqual([13, 10]);
    expect(findTile(world, 10, 10, 2, new Rng(1), (x, y) => world.terrainAt(x, y) === T.GRASS)).toBeNull();
  });
});

describe('health and death', () => {
  it('starvation drains health until the animal dies of starvation', () => {
    // Desert has no food; a lake keeps it watered so hunger is the only killer.
    const world = testWorld(24, 24, T.DESERT, [[0, 0, 24, 3, T.SHALLOW_WATER]]);
    const sim = new Simulation(world);
    sim.creatures.spawn(GRAZER, 12, 5, sim.rng, { hunger: 99, thirst: 0 });
    const start = sim.creatures.health[0];
    run(sim, 50);
    expect(sim.creatures.health[0]).toBeLessThan(start);
    run(sim, 2000);
    expect(sim.creatures.count).toBe(0);
    expect(sim.creatures.deathsBy(GRAZER, CAUSE.STARVATION)).toBe(1);
  });

  it('thirst kills an animal with no water in reach', () => {
    const sim = new Simulation(testWorld(24, 24, T.GRASS));
    sim.creatures.spawn(GRAZER, 12, 12, sim.rng, { hunger: 0, thirst: 99 });
    run(sim, 2000);
    expect(sim.creatures.count).toBe(0);
    expect(sim.creatures.deathsBy(GRAZER, CAUSE.THIRST)).toBe(1);
  });

  it('old age ends every life', () => {
    const world = testWorld(24, 24, T.GRASS, [[0, 0, 24, 3, T.SHALLOW_WATER]]);
    const sim = new Simulation(world);
    sim.creatures.spawn(FISH, 12, 1.5, sim.rng, { age: SPECIES[FISH].maxAge - 5 });
    run(sim, 10);
    expect(sim.creatures.deathsBy(FISH, CAUSE.OLD_AGE)).toBe(1);
  });

  it('wounded but fed animals heal', () => {
    const world = testWorld(24, 24, T.GRASS, [[0, 0, 24, 3, T.SHALLOW_WATER]]);
    const sim = new Simulation(world);
    sim.creatures.spawn(GRAZER, 12, 6, sim.rng, { hunger: 0, thirst: 0 });
    sim.creatures.health[0] = 10;
    run(sim, 100);
    expect(sim.creatures.health[0]).toBeGreaterThan(10);
  });
});

describe('predators and prey', () => {
  it('a hungry raptor hunts, damages and kills a grazer, and gets fed', () => {
    const world = testWorld(64, 64, T.GRASS, [[0, 0, 64, 2, T.SHALLOW_WATER]]);
    const sim = new Simulation(world);
    const prey = sim.creatures.spawn(GRAZER, 32, 32, sim.rng);
    const hunter = sim.creatures.spawn(RAPTOR, 38, 32, sim.rng, { hunger: 70, thirst: 0 });
    let hunted = false;
    for (let t = 0; t < 600 && sim.creatures.indexOf(prey) >= 0; t++) {
      sim.step();
      const h = sim.creatures.indexOf(hunter);
      if (sim.creatures.state[h] === STATE.HUNT) hunted = true;
    }
    expect(hunted).toBe(true);
    expect(sim.creatures.indexOf(prey)).toBe(-1);
    expect(sim.creatures.deathsBy(GRAZER, CAUSE.PREDATION)).toBe(1);
    expect(sim.creatures.hunger[sim.creatures.indexOf(hunter)]).toBeLessThan(40);
  });

  it('prey flees from a nearby predator', () => {
    const sim = new Simulation(testWorld(64, 64, T.GRASS));
    const prey = sim.creatures.spawn(GRAZER, 32, 32, sim.rng, { hunger: 0, thirst: 0 });
    sim.creatures.spawn(TYRANT, 35, 32, sim.rng, { hunger: 0, thirst: 0 });
    let fled = false;
    for (let t = 0; t < 8; t++) {
      sim.step();
      if (sim.creatures.state[sim.creatures.indexOf(prey)] === STATE.FLEE) fled = true;
    }
    expect(fled).toBe(true);
  });

  it('a tyrant population can feed on hadrosaurs', () => {
    const world = testWorld(96, 96, T.FOREST, [[0, 40, 96, 46, T.SHALLOW_WATER]]);
    const sim = new Simulation(world);
    sim.spawnInCircle(HADROSAUR, 48, 30, 10, 30);
    sim.spawnInCircle(TYRANT, 48, 30, 4, 2);
    for (let i = 0; i < sim.creatures.count; i++) {
      if (sim.creatures.species[i] === TYRANT) sim.creatures.hunger[i] = 60;
    }
    run(sim, 600);
    expect(sim.creatures.deathsBy(HADROSAUR, CAUSE.PREDATION)).toBeGreaterThan(0);
    expect(sim.creatures.countSpecies(TYRANT)).toBe(2);
  });
});

describe('reproduction and population limits', () => {
  it('two fed adults breed; juveniles grow up', () => {
    const world = testWorld(48, 48, T.GRASS, [[0, 0, 48, 3, T.SHALLOW_WATER]]);
    const sim = new Simulation(world);
    sim.creatures.spawn(GRAZER, 24, 10, sim.rng);
    sim.creatures.spawn(GRAZER, 24.5, 10, sim.rng);
    run(sim, 800);
    expect(sim.creatures.birthStats[GRAZER]).toBeGreaterThan(0);
    expect(sim.creatures.countSpecies(GRAZER)).toBeGreaterThan(2);
  });

  it('a lone animal cannot breed', () => {
    const world = testWorld(48, 48, T.GRASS, [[0, 0, 48, 3, T.SHALLOW_WATER]]);
    const sim = new Simulation(world);
    sim.creatures.spawn(GRAZER, 24, 10, sim.rng);
    run(sim, 1000);
    expect(sim.creatures.birthStats[GRAZER]).toBe(0);
  });

  it('juveniles do not breed', () => {
    const world = testWorld(48, 48, T.GRASS, [[0, 0, 48, 3, T.SHALLOW_WATER]]);
    const sim = new Simulation(world);
    sim.creatures.spawn(GRAZER, 24, 10, sim.rng, { age: 0 });
    sim.creatures.spawn(GRAZER, 24.5, 10, sim.rng, { age: 0 });
    run(sim, SPECIES[GRAZER].adultAge - 10);
    expect(sim.creatures.birthStats[GRAZER]).toBe(0);
  });

  it('growth stops at the carrying capacity', () => {
    const world = testWorld(64, 64, T.GRASS, [[0, 30, 64, 34, T.SHALLOW_WATER]]);
    const sim = new Simulation(world);
    sim.spawnInCircle(GRAZER, 32, 20, 6, 20);
    run(sim, 4000);
    const cells = (64 / 8) * (64 / 8);
    // crowdLimit others + the parent, per 8×8 cell, plus the newborns of one tick.
    const cap = cells * (SPECIES[GRAZER].crowdLimit + 1 + SPECIES[GRAZER].litter);
    expect(sim.creatures.countSpecies(GRAZER)).toBeLessThanOrEqual(cap);
    expect(sim.creatures.count).toBeLessThanOrEqual(MAX_CREATURES);
  });
});

describe('time controls and determinism', () => {
  it('pause freezes creatures; speed scales ticks per real second', () => {
    const world = testWorld(32, 32, T.GRASS, [[0, 0, 32, 3, T.SHALLOW_WATER]]);
    const sim = new Simulation(world);
    sim.spawnInCircle(GRAZER, 16, 16, 3, 5);
    const before = Array.from(sim.creatures.x.slice(0, 5));
    sim.speed = 0;
    expect(sim.advance(2)).toBe(0);
    expect(Array.from(sim.creatures.x.slice(0, 5))).toEqual(before);
    expect(sim.tick).toBe(0);

    sim.speed = 1;
    expect(sim.advance(0.2)).toBe(0.2 * TICKS_PER_SECOND);
    sim.speed = 3;
    expect(sim.advance(0.2)).toBe(0.2 * TICKS_PER_SECOND * 3);
    sim.speed = 10;
    expect(sim.advance(0.2)).toBe(0.2 * TICKS_PER_SECOND * 10);
  });

  it('the same seed and actions give the same world', () => {
    const make = () => {
      const s = new Simulation(testWorld(64, 64, T.GRASS, [[0, 28, 64, 32, T.SHALLOW_WATER]]));
      s.spawnInCircle(GRAZER, 20, 15, 5, 20);
      s.spawnInCircle(RAPTOR, 40, 15, 3, 3);
      s.spawnInCircle(FISH, 30, 30, 3, 6);
      run(s, 1500);
      return s;
    };
    const a = make();
    const b = make();
    expect(a.creatures.count).toBe(b.creatures.count);
    expect(Array.from(a.creatures.id.slice(0, a.creatures.count))).toEqual(Array.from(b.creatures.id.slice(0, b.creatures.count)));
    expect(Array.from(a.creatures.x.slice(0, a.creatures.count))).toEqual(Array.from(b.creatures.x.slice(0, b.creatures.count)));
    expect(a.world.terrain).toEqual(b.world.terrain);
  });
});

describe('save format', () => {
  it('round-trips ids, needs, health and states', () => {
    const world = testWorld(48, 48, T.GRASS, [[0, 0, 48, 3, T.SHALLOW_WATER]]);
    const sim = new Simulation(world);
    sim.spawnInCircle(GRAZER, 24, 20, 5, 10);
    sim.spawnInCircle(RAPTOR, 24, 20, 3, 2);
    run(sim, 200);
    const other = new Simulation(testWorld(8, 8, T.GRASS));
    deserializeInto(other, serialize(sim));
    const n = sim.creatures.count;
    expect(other.creatures.count).toBe(n);
    expect(other.creatures.nextId).toBe(sim.creatures.nextId);
    for (const k of ['id', 'health', 'hunger', 'thirst', 'state', 'age'] as const) {
      expect(Array.from(other.creatures[k].slice(0, n))).toEqual(Array.from(sim.creatures[k].slice(0, n)));
    }
    run(sim, 100);
    run(other, 100);
    expect(Array.from(other.creatures.x.slice(0, other.creatures.count))).toEqual(
      Array.from(sim.creatures.x.slice(0, sim.creatures.count)),
    );
  });

  it('migrates Milestone 1 (v1) saves', () => {
    const world = testWorld(16, 16, T.GRASS);
    const v1: SaveData = {
      version: 1, savedAt: '', width: 16, height: 16, seed: 1, tick: 5, rngState: 42,
      heights: world.heights.slice(), terrain: world.terrain.slice(),
      temperature: world.temperature.slice(), moisture: world.moisture.slice(),
      creatures: {
        count: 2, x: new Float32Array([3, 9]), y: new Float32Array([3, 9]), dx: new Float32Array([1, 0]),
        dy: new Float32Array([0, 1]), species: new Uint8Array([GRAZER, RAPTOR]), energy: new Float32Array([80, 30]),
        age: new Float32Array([500, 600]), births: 4, deaths: 1,
      } as unknown as SaveData['creatures'],
      history: [{ tick: 0, text: 'World 1 was formed.' }],
    };
    const sim = new Simulation(testWorld(8, 8, T.GRASS));
    deserializeInto(sim, v1);
    const c = sim.creatures;
    expect(c.count).toBe(2);
    expect(c.id[0]).not.toBe(c.id[1]);
    expect(c.hunger[0]).toBe(20);
    expect(c.health[1]).toBe(SPECIES[RAPTOR].maxHealth);
    expect(c.nextId).toBe(3);
    sim.step(); // and it keeps running
  });
});

describe('Creatures.canEnter', () => {
  it('respects habitat and impassable terrain', () => {
    const world = testWorld(4, 1, T.GRASS, [[1, 0, 2, 1, T.SHALLOW_WATER], [2, 0, 3, 1, T.MOUNTAIN]]);
    expect(Creatures.canEnter(world, GRAZER, 0, 0)).toBe(true);
    expect(Creatures.canEnter(world, GRAZER, 1, 0)).toBe(false);
    expect(Creatures.canEnter(world, FISH, 1, 0)).toBe(true);
    expect(Creatures.canEnter(world, GRAZER, 2, 0)).toBe(true);
    expect(Creatures.canEnter(world, HADROSAUR, 2, 0)).toBe(false);
    expect(Creatures.canEnter(world, GRAZER, 9, 0)).toBe(false);
  });
});
