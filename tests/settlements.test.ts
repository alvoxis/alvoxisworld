import { describe, expect, it } from 'vitest';
import { deserializeInto, serialize, SAVE_VERSION } from '../src/save/serialize';
import { FISH, GRAZER, RAPTOR } from '../src/sim/creatures';
import {
  DISSOLVE_TICKS, FOUND_RADIUS, LEAVE_MARGIN, MAX_RADIUS, MAX_SETTLEMENTS, MIN_FOUNDERS, STEP_TICKS, nameFor, radiusFor, type Settlement,
} from '../src/sim/settlements';
import { Simulation } from '../src/sim/simulation';
import { generateWorld } from '../src/world/generator';
import { SEA_LEVEL, T } from '../src/world/terrain';
import { World } from '../src/world/world';

const FLAT = SEA_LEVEL + 20;

function flat(w: number, h: number, fill: number = T.GRASS): World {
  const world = new World(w, h, 7);
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

/** A calm grass world with a herd of grazers around (40, 40). */
function herdWorld(n = 12): Simulation {
  const sim = quiet(flat(96, 96));
  sim.spawnInCircle(GRAZER, 40, 40, 4, n);
  return sim;
}

function found(sim: Simulation, x = 40, y = 40): Settlement {
  const r = sim.foundSettlement(x, y);
  expect(typeof r).toBe('object');
  return r as Settlement;
}

function run(sim: Simulation, ticks: number): void {
  for (let t = 0; t < ticks; t++) sim.step();
}

/** Every member exists, is of the settlement's species, and belongs to one settlement only. */
function checkMembers(sim: Simulation): void {
  const seen = new Set<number>();
  for (const s of sim.settlements.list) {
    for (const m of s.members) {
      const i = sim.creatures.indexOf(m);
      expect(i, `member ${m} of ${s.name}`).toBeGreaterThanOrEqual(0);
      expect(sim.creatures.species[i]).toBe(s.species);
      expect(seen.has(m)).toBe(false);
      seen.add(m);
    }
  }
}

describe('founding', () => {
  it('founds a settlement from a herd: id, name, members, territory and a history entry', () => {
    const sim = herdWorld();
    const free = sim.creatures.countSpecies(GRAZER);
    const s = found(sim);
    expect(s.id).toBe(1);
    expect(s.name).toMatch(/^[A-Z][a-z]+$/);
    expect(s.species).toBe(GRAZER);
    expect(sim.settlements.population(s)).toBe(free);
    expect(s.tiles.length).toBeGreaterThan(50);
    for (const i of s.tiles) {
      expect(sim.settlements.owner![i]).toBe(s.id);
      const x = i % 96;
      const y = Math.floor(i / 96);
      expect(Math.hypot(x - s.x, y - s.y)).toBeLessThanOrEqual(s.radius);
    }
    expect(sim.history.some((h) => h.code === 'settlement_founded' && h.p?.name === s.name)).toBe(true);
    expect(sim.settlements.ownerAt(40, 40)?.id).toBe(1);
    checkMembers(sim);
  });

  it('refuses without enough animals of one species, on water, mountains and claimed ground, and without food', () => {
    const few = quiet(flat(96, 96));
    few.spawnInCircle(GRAZER, 40, 40, 3, MIN_FOUNDERS - 1);
    expect(few.foundSettlement(40, 40)).toBe('few');

    const mixed = quiet(flat(96, 96));
    mixed.spawnInCircle(GRAZER, 40, 40, 3, MIN_FOUNDERS - 1);
    mixed.spawnInCircle(RAPTOR, 40, 40, 3, 4);
    expect(mixed.foundSettlement(40, 40)).toBe('few'); // five of one kind and four of another are not a group

    const far = herdWorld();
    expect(far.foundSettlement(40 + FOUND_RADIUS + 12, 40)).toBe('few');

    const wet = herdWorld();
    wet.world.setTerrain(40, 40, T.LAKE);
    expect(wet.foundSettlement(40, 40)).toBe('ground');
    wet.world.setTerrain(40, 40, T.MOUNTAIN);
    expect(wet.foundSettlement(40, 40)).toBe('ground');

    const desert = quiet(flat(96, 96, T.DESERT));
    desert.spawnInCircle(GRAZER, 40, 40, 4, 12);
    expect(desert.foundSettlement(40, 40)).toBe('food');

    const sim = herdWorld();
    found(sim);
    expect(sim.foundSettlement(40, 40)).toBe('claimed');
    expect(sim.foundSettlement(-5, 10)).toBe('ground');
  });

  it('does not take water animals and limits the number of settlements', () => {
    const sim = quiet(flat(200, 60));
    sim.world.terrain.fill(T.LAKE);
    for (let y = 0; y < 60; y++) for (let x = 0; x < 200; x++) if (y >= 10) sim.world.terrain[y * 200 + x] = T.GRASS;
    sim.spawnInCircle(FISH, 20, 5, 3, 10);
    expect(sim.foundSettlement(20, 20)).toBe('few');
    for (let k = 0; k < MAX_SETTLEMENTS; k++) {
      sim.spawnInCircle(GRAZER, 10 + k * 14, 30, 3, 8);
      expect(typeof sim.foundSettlement(10 + k * 14, 30)).toBe('object');
    }
    sim.spawnInCircle(GRAZER, 10, 50, 3, 8);
    expect(sim.foundSettlement(10, 50)).toBe('max');
  });

  it('names depend only on the world seed and the id', () => {
    expect(nameFor(5, 1)).toBe(nameFor(5, 1));
    expect(nameFor(5, 1)).not.toBe(nameFor(5, 2));
    expect(nameFor(5, 1, 0)).toMatch(/^[A-Z][a-z]{3,9}$/);
  });
});

describe('population', () => {
  it('counts only living members: deaths drop out, newborns of members join, strangers are not counted', () => {
    const sim = herdWorld(14);
    const s = found(sim);
    const start = s.members.length;
    // Remove a few members.
    const victims = s.members.slice(0, 3);
    for (const id of victims) expect(sim.creatures.removeById(id)).toBe(true);
    run(sim, STEP_TICKS);
    expect(s.members.length).toBeLessThanOrEqual(start - victims.length + s.joined - start);
    for (const id of victims) expect(s.members).not.toContain(id);
    expect(s.died).toBeGreaterThanOrEqual(3);
    checkMembers(sim);
    // A far-away animal of the same species is not counted.
    sim.spawnInCircle(GRAZER, 80, 80, 2, 3);
    run(sim, STEP_TICKS * 2);
    for (const m of s.members) {
      const i = sim.creatures.indexOf(m);
      expect(Math.hypot(sim.creatures.x[i] - s.x, sim.creatures.y[i] - s.y)).toBeLessThan(s.radius + LEAVE_MARGIN + 1);
    }
    checkMembers(sim);
  });

  it('removing animals lowers the population by exactly that many, and the count equals the living members', () => {
    const sim = herdWorld(16);
    const s = found(sim);
    const before = s.members.length;
    const removed = sim.creatures.removeInCircle(40, 40, 1.5);
    run(sim, STEP_TICKS);
    expect(s.members.length).toBe(before - removed);
    expect(s.died).toBe(removed);
    checkMembers(sim);
  });

  it('births raise the population and are counted; animals of the species that live inside join; those who move away leave', () => {
    const sim = herdWorld(14);
    const s = found(sim);
    run(sim, 600);
    checkMembers(sim);
    expect(s.born).toBeGreaterThan(0);
    expect(s.peak).toBeGreaterThanOrEqual(s.members.length);
    // Newcomers inside the territory join at the next step.
    const joinedBefore = s.joined;
    sim.spawnInCircle(GRAZER, s.x + 1, s.y + 1, 1.5, 3);
    run(sim, STEP_TICKS);
    expect(s.joined).toBeGreaterThan(joinedBefore);
    // A member carried far away leaves.
    const m = s.members[0];
    const i = sim.creatures.indexOf(m);
    sim.creatures.x[i] = Math.min(95, s.x + s.radius + LEAVE_MARGIN + 12);
    sim.creatures.y[i] = s.y;
    const leftBefore = s.left;
    run(sim, STEP_TICKS);
    expect(s.left).toBeGreaterThan(leftBefore);
    expect(s.members).not.toContain(m);
    checkMembers(sim);
  });

  it('the territory grows with the population and never beyond the limit', () => {
    expect(radiusFor(0)).toBeLessThan(radiusFor(40));
    expect(radiusFor(1e6)).toBe(MAX_RADIUS);
    const sim = herdWorld(8);
    const s = found(sim);
    const r0 = s.radius;
    const area0 = s.tiles.length;
    sim.spawnInCircle(GRAZER, 40, 40, 3, 60);
    run(sim, STEP_TICKS);
    expect(s.radius).toBeGreaterThan(r0);
    expect(s.tiles.length).toBeGreaterThan(area0);
    expect(s.peak).toBeGreaterThan(30);
    expect(sim.history.some((h) => h.code === 'settlement_milestone')).toBe(true);
  });
});

describe('territory', () => {
  it('follows the land: new water inside it is dropped, and the owner layer matches the tile lists', () => {
    const sim = herdWorld(12);
    const s = found(sim);
    const area = s.tiles.length;
    for (let y = 36; y <= 44; y++) for (let x = 36; x <= 44; x++) sim.world.setTerrain(x, y, T.LAKE);
    run(sim, STEP_TICKS);
    expect(s.tiles.length).toBeLessThan(area);
    for (const i of s.tiles) expect(sim.world.terrain[i]).not.toBe(T.LAKE);
    expect(sim.settlements.owner![40 * 96 + 40]).toBe(0);
    let owned = 0;
    for (const v of sim.settlements.owner!) if (v === s.id) owned++;
    expect(owned).toBe(s.tiles.length);
  });

  it('is one connected piece of land: a river cuts off what lies beyond it', () => {
    const sim = herdWorld(12);
    for (let y = 0; y < 96; y++) for (let x = 44; x <= 45; x++) sim.world.setTerrain(x, y, T.RIVER);
    const s = found(sim);
    run(sim, STEP_TICKS);
    for (const i of s.tiles) expect(i % 96).toBeLessThan(44);
    const seen = new Set<number>([s.tiles[0]]);
    const queue = [s.tiles[0]];
    const mine = new Set(s.tiles);
    for (let q = 0; q < queue.length; q++) {
      for (const n of [queue[q] - 1, queue[q] + 1, queue[q] - 96, queue[q] + 96]) if (mine.has(n) && !seen.has(n)) (seen.add(n), queue.push(n));
    }
    expect(seen.size).toBe(s.tiles.length);
  });

  it('border segments are exactly the sides that face tiles of another owner or the map edge', () => {
    const sim = herdWorld(12);
    const s = found(sim);
    const owner = sim.settlements.owner!;
    const expected = new Set<number>();
    for (const i of s.tiles) {
      const x = i % 96;
      const y = Math.floor(i / 96);
      if (y === 0 || owner[i - 96] !== s.id) expected.add(i << 2);
      if (x === 95 || owner[i + 1] !== s.id) expected.add((i << 2) | 1);
      if (y === 95 || owner[i + 96] !== s.id) expected.add((i << 2) | 2);
      if (x === 0 || owner[i - 1] !== s.id) expected.add((i << 2) | 3);
    }
    expect(new Set(s.edges)).toEqual(expected);
    expect(s.edges.length).toBeGreaterThan(20);
  });

  it('two settlements never share a tile, and each has its own colour', () => {
    const sim = quiet(flat(120, 96));
    sim.spawnInCircle(GRAZER, 40, 40, 3, 10);
    sim.spawnInCircle(GRAZER, 56, 40, 3, 10);
    const a = found(sim, 40, 40);
    const b = found(sim, 56, 40);
    const setA = new Set(a.tiles);
    for (const i of b.tiles) expect(setA.has(i)).toBe(false);
    expect(a.color).not.toBe(b.color);
    expect(a.name).not.toBe(b.name);
  });

  it('disappears with the settlement and frees the layer', () => {
    const sim = herdWorld(10);
    const s = found(sim);
    sim.creatures.removeInCircle(40, 40, 30);
    run(sim, STEP_TICKS);
    expect(sim.settlements.list.length).toBe(0);
    expect(sim.settlements.owner).toBeNull();
    expect(sim.history.some((h) => h.code === 'settlement_abandoned' && h.p?.name === s.name)).toBe(true);
    expect(sim.settlements.ownerAt(40, 40)).toBeUndefined();
  });

  it('a settlement with almost no animals left dissolves after a while, and the last animal is free again', () => {
    const sim = quiet(flat(96, 96));
    sim.spawnInCircle(GRAZER, 40, 40, 3, MIN_FOUNDERS);
    const s = found(sim);
    const keep = s.members[0];
    for (const id of s.members.slice(1)) sim.creatures.removeById(id);
    sim.creatures.hunger.fill(0);
    sim.creatures.thirst.fill(0);
    sim.creatures.breedTimer.fill(1e6); // the survivor cannot breed in this test
    run(sim, DISSOLVE_TICKS + STEP_TICKS * 3);
    expect(sim.creatures.indexOf(keep)).toBeGreaterThanOrEqual(0);
    expect(sim.settlements.list.length).toBe(0);
    expect(sim.history.some((h) => h.code === 'settlement_dissolved')).toBe(true);
  });
});

describe('saving and determinism', () => {
  it('saves and loads settlements: same members, stats and territory', () => {
    const sim = herdWorld(14);
    found(sim);
    run(sim, 200);
    const data = serialize(sim);
    expect(data.version).toBe(SAVE_VERSION);
    const other = quiet(flat(96, 96));
    deserializeInto(other, data);
    expect(other.settlements.exportState()).toEqual(sim.settlements.exportState());
    const a = sim.settlements.list[0];
    const b = other.settlements.list[0];
    expect(Array.from(b.tiles)).toEqual(Array.from(a.tiles));
    expect(Array.from(b.edges)).toEqual(Array.from(a.edges));
    expect(other.settlements.ownerAt(40, 40)?.name).toBe(a.name);
    checkMembers(other);
  });

  it('a loaded world continues exactly like the original', () => {
    const sim = herdWorld(14);
    found(sim);
    run(sim, 100);
    const other = quiet(flat(96, 96));
    deserializeInto(other, serialize(sim));
    run(sim, 300);
    run(other, 300);
    expect(other.settlements.exportState()).toEqual(sim.settlements.exportState());
    expect(other.creatures.count).toBe(sim.creatures.count);
  });

  it('is deterministic: the same actions give the same settlements', () => {
    const make = () => {
      const sim = new Simulation(generateWorld(160, 120, 21));
      sim.weather.config.auto = false;
      sim.spawnInCircle(GRAZER, 80, 60, 4, 14);
      found(sim, 80, 60);
      run(sim, 500);
      return sim.settlements.exportState();
    };
    const a = make();
    expect(a.list.length).toBeGreaterThan(0);
    expect(make()).toEqual(a);
  });

  it('old saves without settlements load unchanged (versions up to 7)', () => {
    const sim = herdWorld(10);
    const data = serialize(sim);
    delete data.settlements;
    data.version = 7;
    const other = quiet(flat(96, 96));
    deserializeInto(other, data);
    expect(other.settlements.list).toEqual([]);
    expect(other.settlements.owner).toBeNull();
    expect(other.creatures.count).toBe(sim.creatures.count);
    data.version = 6;
    deserializeInto(other, data);
    expect(other.settlements.list).toEqual([]);
  });

  it('ignores invalid settlement data in a save: missing creatures, water species, duplicates', () => {
    const sim = herdWorld(10);
    const s = found(sim);
    const data = serialize(sim);
    const good = data.settlements!;
    const bad = JSON.parse(JSON.stringify(good));
    bad.list[0].members = [...bad.list[0].members, 99999, bad.list[0].members[0], 'x'];
    bad.list.push({ ...bad.list[0], id: 2, species: FISH });
    bad.list.push({ ...bad.list[0], id: 1 });
    bad.list.push(null);
    data.settlements = bad;
    const other = quiet(flat(96, 96));
    deserializeInto(other, data);
    expect(other.settlements.list.length).toBe(1);
    expect(other.settlements.list[0].members).toEqual(s.members);
    checkMembers(other);
  });

  it('loads a settlement into a world where the land changed (territory is recomputed, not trusted)', () => {
    const sim = herdWorld(10);
    found(sim);
    const data = serialize(sim);
    for (let y = 30; y < 50; y++) for (let x = 30; x < 50; x++) data.terrain[y * 96 + x] = T.LAKE;
    const other = quiet(flat(96, 96));
    deserializeInto(other, data);
    const t = other.settlements.list[0];
    for (const i of t.tiles) expect(other.world.terrain[i]).not.toBe(T.LAKE);
  });
});
