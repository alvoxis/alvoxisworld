import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { SAVE_VERSION, deserializeInto, serialize, type SaveData } from '../src/save/serialize';
import { TICKS_PER_SECOND } from '../src/sim/clock';
import {
  CAUSE, Creatures, FISH, GRAZER, HADROSAUR, MAX_CREATURES, RAPTOR, SPECIES, STATE, TYRANT, findTile,
} from '../src/sim/creatures';
import { Simulation } from '../src/sim/simulation';
import { SEA_LEVEL, T } from '../src/world/terrain';
import { WATER_FLAG, World } from '../src/world/world';

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

  it('flooding the land drowns land animals; draining strands fish (when no shore is near)', () => {
    const world = testWorld(48, 32, T.GRASS, [[0, 0, 20, 32, T.SHALLOW_WATER]]);
    const sim = new Simulation(world);
    sim.creatures.spawn(GRAZER, 40, 16, sim.rng);
    sim.creatures.spawn(FISH, 2, 16, sim.rng);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 48; x++) world.setTerrain(x, y, x < 20 ? T.GRASS : T.SHALLOW_WATER);
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
    expect(sim.creatures.countSpecies(TYRANT)).toBeGreaterThanOrEqual(2); // both alive (they may also breed)
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

describe('navigation (pathfinding, rivers and lakes)', () => {
  it('drinks from rivers (standing in them) and from lakes', () => {
    const world = testWorld(40, 20, T.GRASS, [[30, 0, 31, 20, T.RIVER], [2, 2, 6, 6, T.LAKE]]);
    const sim = new Simulation(world);
    const a = sim.creatures.spawn(GRAZER, 20.5, 10.5, sim.rng, { hunger: 0, thirst: 70 });
    const b = sim.creatures.spawn(GRAZER, 10.5, 4.5, sim.rng, { hunger: 0, thirst: 70 });
    const drank = new Set<number>();
    for (let t = 0; t < 400 && drank.size < 2; t++) {
      sim.step();
      for (const id of [a, b]) {
        const i = sim.creatures.indexOf(id);
        if (i >= 0 && sim.creatures.state[i] === STATE.DRINK) drank.add(id);
      }
    }
    expect(drank.size).toBe(2);
    expect(sim.creatures.deathsBy(GRAZER, CAUSE.DROWNED)).toBe(0);
  });

  it('wades across a river to reach food on the far side', () => {
    // Desert on this side, grass beyond a river that spans the map.
    const world = testWorld(40, 20, T.DESERT, [[20, 0, 21, 20, T.RIVER], [21, 0, 40, 20, T.GRASS]]);
    const sim = new Simulation(world);
    const id = sim.creatures.spawn(GRAZER, 16.5, 10.5, sim.rng, { hunger: 70, thirst: 0 });
    let ate = false;
    for (let t = 0; t < 300 && !ate; t++) {
      sim.step();
      if (sim.creatures.state[sim.creatures.indexOf(id)] === STATE.EAT) ate = true;
    }
    expect(ate).toBe(true);
    expect(sim.creatures.x[sim.creatures.indexOf(id)]).toBeGreaterThan(21);
  });

  it('walks around a mountain ridge to food it cannot reach in a straight line', () => {
    // Hadrosaur (no mountains) in a desert pocket; forest behind a ridge with a gap at the bottom.
    const world = testWorld(40, 30, T.DESERT, [[20, 0, 22, 24, T.MOUNTAIN], [24, 8, 30, 14, T.FOREST], [0, 28, 40, 30, T.SHALLOW_WATER]]);
    const sim = new Simulation(world);
    const id = sim.creatures.spawn(HADROSAUR, 15.5, 10.5, sim.rng, { hunger: 70, thirst: 0 });
    let ate = false;
    for (let t = 0; t < 900 && !ate; t++) {
      sim.step();
      const i = sim.creatures.indexOf(id);
      expect(world.terrainAt(Math.floor(sim.creatures.x[i]), Math.floor(sim.creatures.y[i]))).not.toBe(T.MOUNTAIN);
      if (sim.creatures.state[i] === STATE.EAT) ate = true;
    }
    expect(ate).toBe(true);
  });

  it('gives up on unreachable food instead of pushing against the obstacle', () => {
    // Forest fully enclosed by a lake ring: visible but unreachable for land animals.
    const world = testWorld(40, 40, T.DESERT, [[18, 18, 30, 30, T.LAKE], [21, 21, 27, 27, T.FOREST], [0, 0, 40, 2, T.SHALLOW_WATER]]);
    const sim = new Simulation(world);
    const id = sim.creatures.spawn(HADROSAUR, 16.5, 23.5, sim.rng, { hunger: 70, thirst: 0 });
    let cooled = false;
    for (let t = 0; t < 200; t++) {
      sim.step();
      const i = sim.creatures.indexOf(id);
      if (i < 0) break;
      expect(sim.creatures.state[i]).not.toBe(STATE.EAT);
      if (sim.creatures.searchCd[i] > 0) cooled = true;
    }
    expect(cooled).toBe(true); // the failed search put it on cooldown
    expect(sim.creatures.deathsBy(HADROSAUR, CAUSE.DROWNED)).toBe(0);
  });

  it('a predator follows a path around a lake to reach its prey', () => {
    // Lake between them; the way round is open below.
    const world = testWorld(48, 40, T.GRASS, [[20, 0, 26, 30, T.LAKE]]);
    const sim = new Simulation(world);
    const prey = sim.creatures.spawn(GRAZER, 32.5, 10.5, sim.rng, { hunger: 0, thirst: 0 });
    const hunter = sim.creatures.spawn(RAPTOR, 14.5, 10.5, sim.rng, { hunger: 70, thirst: 0 });
    for (let t = 0; t < 800 && sim.creatures.indexOf(prey) >= 0; t++) {
      sim.step();
      const h = sim.creatures.indexOf(hunter);
      expect(world.terrainAt(Math.floor(sim.creatures.x[h]), Math.floor(sim.creatures.y[h]))).not.toBe(T.LAKE);
    }
    expect(sim.creatures.deathsBy(GRAZER, CAUSE.PREDATION)).toBe(1);
  });

  it('a predator does not chase prey it can never reach', () => {
    // Grazer on a mountain plateau; tyrants cannot climb.
    const world = testWorld(40, 30, T.GRASS, [[22, 5, 34, 25, T.MOUNTAIN], [26, 9, 30, 21, T.GRASS], [0, 0, 40, 2, T.SHALLOW_WATER]]);
    const sim = new Simulation(world);
    const prey = sim.creatures.spawn(GRAZER, 28.5, 15.5, sim.rng, { hunger: 0, thirst: 0 });
    const hunter = sim.creatures.spawn(TYRANT, 16.5, 15.5, sim.rng, { hunger: 70, thirst: 0 });
    let gaveUp = false;
    for (let t = 0; t < 200; t++) {
      sim.step();
      const h = sim.creatures.indexOf(hunter);
      if (sim.creatures.ignoreId[h] === prey) gaveUp = true;
    }
    expect(gaveUp).toBe(true);
    expect(sim.creatures.indexOf(prey)).toBeGreaterThanOrEqual(0);
  });

  it('fleeing prey keeps a steady heading along a coast instead of dithering', () => {
    // Prey with its back to the sea, predator approaching from the land side.
    const world = testWorld(60, 40, T.GRASS, [[0, 30, 60, 40, T.SHALLOW_WATER]]);
    const sim = new Simulation(world);
    const prey = sim.creatures.spawn(GRAZER, 30.5, 28.5, sim.rng, { hunger: 0, thirst: 0 });
    sim.creatures.spawn(TYRANT, 30.5, 24.5, sim.rng, { hunger: 0, thirst: 0 });
    let reversals = 0;
    let fleeTicks = 0;
    let prevDx = 0;
    let prevDy = 0;
    let fled = 0;
    const start = [sim.creatures.x[0], sim.creatures.y[0]];
    for (let t = 0; t < 80; t++) {
      sim.step();
      const i = sim.creatures.indexOf(prey);
      if (sim.creatures.state[i] !== STATE.FLEE) continue;
      fleeTicks++;
      const dx = sim.creatures.dx[i];
      const dy = sim.creatures.dy[i];
      if (dx * prevDx + dy * prevDy < -0.5) reversals++;
      prevDx = dx;
      prevDy = dy;
      expect(world.isWaterAt(Math.floor(sim.creatures.x[i]), Math.floor(sim.creatures.y[i]))).toBe(false);
      fled = Math.max(fled, Math.hypot(sim.creatures.x[i] - start[0], sim.creatures.y[i] - start[1]));
    }
    expect(fleeTicks).toBeGreaterThan(10);
    expect(reversals).toBeLessThanOrEqual(2);
    expect(fled).toBeGreaterThan(3); // got clear while fleeing (it may wander back afterwards)
  });

  it('re-plans when the terrain on its route changes', () => {
    const world = testWorld(50, 20, T.DESERT, [[22, 0, 50, 20, T.GRASS], [0, 0, 50, 1, T.SHALLOW_WATER]]);
    const sim = new Simulation(world);
    const id = sim.creatures.spawn(GRAZER, 15.5, 10.5, sim.rng, { hunger: 70, thirst: 0 });
    // Wait until it is walking a route east, then flood a band across that route.
    let i = 0;
    for (let t = 0; t < 10; t++) {
      sim.step();
      i = sim.creatures.indexOf(id);
      if (sim.creatures.state[i] === STATE.SEEK_FOOD) break;
    }
    expect(sim.creatures.state[i]).toBe(STATE.SEEK_FOOD);
    expect(sim.creatures.pathLen[i]).toBeGreaterThan(0);
    for (let y = 1; y < 15; y++) for (let x = 18; x < 21; x++) world.setTerrain(x, y, T.LAKE);
    let ate = false;
    for (let t = 0; t < 600 && !ate; t++) {
      sim.step();
      i = sim.creatures.indexOf(id);
      if (i < 0) break;
      expect(world.terrainAt(Math.floor(sim.creatures.x[i]), Math.floor(sim.creatures.y[i]))).not.toBe(T.LAKE);
      if (sim.creatures.state[i] === STATE.EAT) ate = true;
    }
    expect(sim.creatures.deathsBy(GRAZER, CAUSE.DROWNED)).toBe(0);
    expect(ate).toBe(true); // found the way round the new lake
  });

  it('saves keep routes, so a loaded world continues identically', () => {
    const world = testWorld(64, 40, T.DESERT, [[44, 0, 64, 40, T.GRASS], [30, 0, 33, 30, T.MOUNTAIN], [0, 38, 64, 40, T.SHALLOW_WATER]]);
    const sim = new Simulation(world);
    sim.spawnInCircle(HADROSAUR, 12, 15, 5, 6);
    sim.spawnInCircle(GRAZER, 12, 20, 5, 8);
    sim.spawnInCircle(RAPTOR, 50, 20, 3, 2);
    for (let i = 0; i < sim.creatures.count; i++) sim.creatures.hunger[i] = 70;
    run(sim, 60);
    expect(Array.from(sim.creatures.pathLen.slice(0, sim.creatures.count)).some((n) => n > 0)).toBe(true);
    const data = serialize(sim);
    expect(data.version).toBe(SAVE_VERSION);
    const other = new Simulation(testWorld(8, 8, T.GRASS));
    deserializeInto(other, data);
    run(sim, 200);
    run(other, 200);
    expect(other.creatures.count).toBe(sim.creatures.count);
    expect(Array.from(other.creatures.x.slice(0, other.creatures.count))).toEqual(
      Array.from(sim.creatures.x.slice(0, sim.creatures.count)),
    );
  });

  it('still loads version 2 saves (no routes stored)', () => {
    const sim = new Simulation(testWorld(32, 32, T.GRASS, [[0, 0, 32, 2, T.SHALLOW_WATER]]));
    sim.spawnInCircle(GRAZER, 16, 16, 4, 6);
    run(sim, 30);
    const data = serialize(sim);
    data.version = 2;
    const c = data.creatures as unknown as Record<string, unknown>;
    for (const k of ['searchCd', 'harm', 'pathLen', 'pathPos', 'pathGoal', 'huntTicks', 'ignoreId', 'path']) delete c[k];
    const other = new Simulation(testWorld(8, 8, T.GRASS));
    deserializeInto(other, data);
    expect(other.creatures.count).toBe(sim.creatures.count);
    expect(Array.from(other.creatures.pathLen.slice(0, other.creatures.count)).every((n) => n === 0)).toBe(true);
    run(other, 50);
  });
});

describe('save format v4', () => {
  it('round-trips weather, fire, water memory and long-term climate', () => {
    const world = testWorld(80, 60, T.FOREST, [[0, 0, 80, 3, T.SHALLOW_WATER], [30, 20, 40, 30, T.LAKE]]);
    world.baseMoisture.fill(110);
    world.baseTemperature.fill(140);
    const sim = new Simulation(world);
    sim.summonWeather(0, 20, 20, 15, 2);
    sim.summonWeather(1, 60, 40, 15, 3);
    sim.igniteArea(60, 40, 3);
    sim.spawnInCircle(HADROSAUR, 20, 40, 5, 6);
    run(sim, 120);
    const data = serialize(sim);
    expect(data.version).toBe(SAVE_VERSION);
    const other = new Simulation(testWorld(8, 8, T.GRASS));
    deserializeInto(other, data);
    expect(other.weather.systems).toEqual(sim.weather.systems);
    expect(other.fire.burning).toBe(sim.fire.burning);
    expect(other.world.fire).toEqual(sim.world.fire);
    expect(other.world.waterFlags).toEqual(sim.world.waterFlags);
    expect(other.world.baseMoisture).toEqual(sim.world.baseMoisture);
    run(sim, 150);
    run(other, 150);
    expect(other.world.terrain).toEqual(sim.world.terrain);
    expect(other.fire.burning).toBe(sim.fire.burning);
    expect(Array.from(other.creatures.x.slice(0, other.creatures.count))).toEqual(
      Array.from(sim.creatures.x.slice(0, sim.creatures.count)),
    );
  });

  it('migrates v3 saves: base climate from current climate, lakes and rivers remember their beds', () => {
    const world = testWorld(40, 30, T.GRASS, [[5, 5, 10, 10, T.LAKE], [20, 0, 21, 30, T.RIVER]]);
    const sim = new Simulation(world);
    sim.spawnInCircle(GRAZER, 30, 15, 4, 5);
    run(sim, 20);
    const data = serialize(sim);
    data.version = 3;
    delete data.v4;
    // v3 had 8 death causes per species.
    const c = data.creatures as unknown as { deathStats: Uint32Array };
    c.deathStats = new Uint32Array(SPECIES.length * 8).fill(1);
    const other = new Simulation(testWorld(8, 8, T.GRASS));
    deserializeInto(other, data);
    const w = other.world;
    expect(w.baseMoisture).toEqual(w.moisture);
    expect(w.waterFlags[w.idx(6, 6)]).toBe(WATER_FLAG.LAKE_BED);
    expect(w.waterFlags[w.idx(20, 4)]).toBe(WATER_FLAG.RIVER_BED);
    expect(other.weather.systems).toEqual([]);
    expect(other.creatures.deathsBy(GRAZER, CAUSE.STARVATION)).toBe(1);
    expect(other.creatures.deathsBy(GRAZER, CAUSE.FIRE)).toBe(0);
    run(other, 50);
  });
});

describe('performance budget', () => {
  it('keeps search work per tick bounded with a large population', async () => {
    const { generateWorld } = await import('../src/world/generator');
    const { NODE_BUDGET } = await import('../src/sim/creatures');
    const world = generateWorld(512, 320, 4);
    const sim = new Simulation(world);
    const r = new Rng(3);
    for (let a = 0; a < 40000 && sim.creatures.count < 3000; a++) {
      const sp = [GRAZER, GRAZER, HADROSAUR, FISH, RAPTOR][a % 5];
      sim.spawnInCircle(sp, r.next() * 512, r.next() * 320, 2, 1);
    }
    for (let i = 0; i < sim.creatures.count; i++) {
      sim.creatures.hunger[i] = 60; // everyone searching at once: worst case for pathfinding
      sim.creatures.thirst[i] = 40;
    }
    let worstExpansions = 0;
    const t0 = performance.now();
    for (let t = 0; t < 200; t++) {
      const before = sim.creatures.pathfinder.expansions;
      sim.step();
      worstExpansions = Math.max(worstExpansions, sim.creatures.pathfinder.expansions - before);
    }
    const msPerTick = (performance.now() - t0) / 200;
    // A single search may finish past the remaining budget, but never by more than its own limit.
    expect(worstExpansions).toBeLessThanOrEqual(NODE_BUDGET + 6000);
    expect(sim.creatures.count).toBeGreaterThan(2000);
    // Generous bound so slow CI machines don't flake; typical desktop result is far lower.
    expect(msPerTick).toBeLessThan(40);
  });

  it('herbivores pinned at their caps do not keep re-running failing food searches', async () => {
    const { generateWorld } = await import('../src/world/generator');
    const world = generateWorld(256, 160, 4);
    const sim = new Simulation(world);
    sim.weather.config.auto = false;
    const r = new Rng(9);
    for (let a = 0; a < 100000 && sim.creatures.countSpecies(GRAZER) < 1500; a++) {
      sim.spawnInCircle(GRAZER, r.next() * 256, r.next() * 160, 1, 1);
    }
    for (let t = 0; t < 300; t++) sim.step(); // overgraze
    const pf = sim.creatures.pathfinder;
    const s0 = pf.searches;
    const e0 = pf.expansions;
    for (let t = 0; t < 200; t++) sim.step();
    const n = sim.creatures.count;
    // Food searches per animal per tick stay low (failed searches back off; no food in sight skips the search).
    expect((pf.searches - s0) / (n * 200)).toBeLessThan(0.05);
    expect((pf.expansions - e0) / 200).toBeLessThan(40000);
  });
});
