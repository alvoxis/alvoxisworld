import { describe, expect, it } from 'vitest';
import { TOOLS, type ToolContext } from '../src/game/tools';
import { CREATURE_ART, silhouette } from '../src/render/creatureart';
import { deserializeInto, serialize, SAVE_VERSION } from '../src/save/serialize';
import { BUILDING_TYPES, OPEN_SEA, buildBlock, findSite, type Building } from '../src/sim/civ';
import { ELF, GRAZER, HUMAN, SPECIES } from '../src/sim/creatures';
import { MOVE, passable } from '../src/sim/pathfinding';
import { PATH_WEAR, STEP_TICKS, TRAIL_WEAR, type Settlement } from '../src/sim/settlements';
import { Simulation } from '../src/sim/simulation';
import { BRUSH_STRENGTH, HEIGHT_LIMITS, applyDeepenBrush, applyHeightBrush, reclassify } from '../src/world/brush';
import { MOUNTAIN_LEVEL, SEA_LEVEL, SHALLOW_DEPTH, T, isWater } from '../src/world/terrain';
import { World } from '../src/world/world';

function flat(w: number, h: number, fill: number = T.GRASS, height = SEA_LEVEL + 20): World {
  const world = new World(w, h, 11);
  world.heights.fill(height);
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

function quiet(world: World): Simulation {
  const sim = new Simulation(world);
  sim.weather.config.auto = false;
  return sim;
}

const run = (sim: Simulation, ticks: number) => {
  for (let t = 0; t < ticks; t++) sim.step();
};

function ctx(sim: Simulation, intensity = 2): ToolContext {
  return { sim, intensity, durationTicks: 100, notify: () => {}, inspect: () => {} } as unknown as ToolContext;
}

describe('terrain tab and sculpting', () => {
  it('the terrain tools live in their own tab, not twice', () => {
    const terrain = TOOLS.filter((t) => t.category === 'terrain').map((t) => t.id);
    expect(terrain).toEqual(['raise', 'lower', 'deepen', 'smooth']);
    expect(TOOLS.filter((t) => ['raise', 'lower', 'smooth', 'deepen'].includes(t.id)).length).toBe(4);
    for (const id of ['raise', 'lower', 'deepen']) expect(TOOLS.find((t) => t.id === id)!.usesIntensity).toBe(true);
  });

  it('repeated raising builds hills and then a mountain, up to the height limit; power sets the step', () => {
    const w = flat(40, 40);
    const i = w.idx(20, 20);
    const h0 = w.heights[i];
    applyHeightBrush(w, { x: 20.5, y: 20.5, radius: 3, strength: BRUSH_STRENGTH[0] }, 1);
    const weak = w.heights[i] - h0;
    const w2 = flat(40, 40);
    applyHeightBrush(w2, { x: 20.5, y: 20.5, radius: 3, strength: BRUSH_STRENGTH[2] }, 1);
    expect(w2.heights[i] - h0).toBeGreaterThan(weak);
    for (let k = 0; k < 40; k++) applyHeightBrush(w, { x: 20.5, y: 20.5, radius: 3, strength: BRUSH_STRENGTH[2] }, 1);
    expect(w.heights[i]).toBeGreaterThanOrEqual(MOUNTAIN_LEVEL);
    expect(w.heights[i]).toBeLessThanOrEqual(HEIGHT_LIMITS.max);
    expect([T.MOUNTAIN, T.SNOW]).toContain(w.terrain[i]);
    // Slopes fall off towards the edge: the rim is lower than the centre.
    expect(w.heights[w.idx(23, 20)]).toBeLessThan(w.heights[i]);
    for (let k = 0; k < 80; k++) applyHeightBrush(w, { x: 20.5, y: 20.5, radius: 3, strength: 10 }, -1);
    expect(w.heights[i]).toBeGreaterThanOrEqual(HEIGHT_LIMITS.min);
  });

  it('Deepen lowers water only: land stays, the sea gets deeper (shallow becomes deep), down to the limit', () => {
    const w = flat(40, 40, T.GRASS);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 20; x++) w.setHeight(x, y, SEA_LEVEL - 3);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 20; x++) w.setTerrain(x, y, T.SHALLOW_WATER);
    const land = w.idx(25, 20);
    const sea = w.idx(15, 20);
    const landH = w.heights[land];
    for (let k = 0; k < 6; k++) applyDeepenBrush(w, { x: 20, y: 20.5, radius: 8, strength: 6 });
    expect(w.heights[land]).toBe(landH);
    expect(w.terrain[land]).toBe(T.GRASS);
    expect(w.heights[sea]).toBeLessThan(SEA_LEVEL - SHALLOW_DEPTH);
    expect(w.terrain[sea]).toBe(T.DEEP_WATER);
    for (let k = 0; k < 60; k++) applyDeepenBrush(w, { x: 20, y: 20.5, radius: 8, strength: 10 });
    expect(w.heights[sea]).toBeGreaterThanOrEqual(HEIGHT_LIMITS.min);
  });

  it('a brush stroke only repaints the map chunks it touched', () => {
    const w = flat(256, 256);
    w.dirtyChunks.clear();
    applyHeightBrush(w, { x: 100, y: 100, radius: 3 }, 1);
    expect(w.dirtyChunks.size).toBeGreaterThan(0);
    expect(w.dirtyChunks.size).toBeLessThanOrEqual(4);
    expect(w.dirtyChunks.size).toBeLessThan(w.chunksX * w.chunksY);
  });

  it('a raised mountain is a wall for people: they cannot stand on it and routes go round it', () => {
    const w = flat(60, 40);
    for (let k = 0; k < 30; k++) for (let y = 0; y < 40; y += 3) applyHeightBrush(w, { x: 30.5, y: y + 0.5, radius: 2.5, strength: 10 }, 1);
    let blocked = 0;
    for (let y = 0; y < 40; y++) if (!passable(w, MOVE.LOWLAND, 30, y)) blocked++;
    expect(blocked).toBe(40);
    const sim = quiet(w);
    run(sim, 200); // navigation is built
    expect(sim.creatures.reachable(w, HUMAN, 10, 20, 50, 20)).toBe(false);
    // Cut a pass through the ridge back to the land around it: now there is a way.
    for (let y = 18; y <= 22; y++) for (let x = 24; x <= 37; x++) {
      w.setHeight(x, y, SEA_LEVEL + 20);
      reclassify(w, x, y);
    }
    run(sim, 200);
    expect(sim.creatures.reachable(w, HUMAN, 10, 20, 50, 20)).toBe(true);
  });

  it('people under a raised mountain are moved to usable ground, alive', () => {
    const w = flat(80, 80);
    const sim = quiet(w);
    sim.spawnInCircle(HUMAN, 40, 40, 3, 6);
    const ids: number[] = [];
    for (let i = 0; i < sim.creatures.count; i++) ids.push(sim.creatures.id[i]);
    for (let k = 0; k < 40; k++) applyHeightBrush(w, { x: 40.5, y: 40.5, radius: 9, strength: 10 }, 1);
    run(sim, 120);
    for (const id of ids) {
      const i = sim.creatures.indexOf(id);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(passable(w, MOVE.LOWLAND, Math.floor(sim.creatures.x[i]), Math.floor(sim.creatures.y[i]))).toBe(true);
    }
  });

  it('sculpted heights and depths are saved, and a loaded world continues exactly', () => {
    const w = flat(80, 60);
    const sim = quiet(w);
    sim.spawnInCircle(GRAZER, 20, 20, 3, 6);
    const tools = Object.fromEntries(TOOLS.map((t) => [t.id, t]));
    for (let k = 0; k < 10; k++) tools.raise.apply(ctx(sim, 3), 50, 30, 4);
    for (let k = 0; k < 10; k++) tools.lower.apply(ctx(sim, 3), 15, 45, 4);
    for (let k = 0; k < 5; k++) tools.deepen.apply(ctx(sim, 3), 15, 45, 3);
    run(sim, 50);
    const other = quiet(flat(8, 8));
    deserializeInto(other, serialize(sim));
    expect(Array.from(other.world.heights)).toEqual(Array.from(sim.world.heights));
    expect(Array.from(other.world.terrain)).toEqual(Array.from(sim.world.terrain));
    run(sim, 100);
    run(other, 100);
    expect(Array.from(other.creatures.x.subarray(0, other.creatures.count))).toEqual(Array.from(sim.creatures.x.subarray(0, sim.creatures.count)));
  });
});

describe('shipyard', () => {
  /** A settlement on a coast: sea to the west of x = 30. */
  function coast(): { sim: Simulation; s: Settlement } {
    const w = flat(120, 80);
    for (let y = 0; y < 80; y++) for (let x = 0; x < 30; x++) {
      w.setHeight(x, y, SEA_LEVEL - 20);
      w.setTerrain(x, y, x < 22 ? T.DEEP_WATER : T.SHALLOW_WATER);
    }
    block(w, 46, 30, 47, 31, T.LAKE);
    const sim = quiet(w);
    sim.settlements.auto = false;
    sim.groups.enabled = false;
    sim.spawnInCircle(HUMAN, 38, 40, 3, 10);
    const s = sim.foundSettlement(38, 40, 'human') as Settlement;
    expect(typeof s).toBe('object');
    s.civ!.wood = 100;
    s.civ!.stone = 50;
    return { sim, s };
  }

  it('is placed on the shore, next to open sea with room for a dock', () => {
    const { sim, s } = coast();
    const i = findSite(sim.world, s, sim.settlements.owner!, 'shipyard');
    expect(i).toBeGreaterThanOrEqual(0);
    const W = sim.world.width;
    expect(isWater(sim.world.terrain[i])).toBe(false);
    const next = [i - 1, i + 1, i - W, i + W].some((n) => OPEN_SEA.includes(sim.world.terrain[n]));
    expect(next).toBe(true);
    const b = sim.settlements.build(sim.world, s, 'shipyard', sim.tick) as Building;
    expect(typeof b).toBe('object');
    expect(BUILDING_TYPES).toContain('shipyard');
    // Builders finish it like any building.
    for (let k = 0; k < 60 && !b.done; k++) run(sim, STEP_TICKS);
    expect(b.done).toBe(true);
  });

  it('is refused inland or by a lake (no navigable sea)', () => {
    const w = flat(120, 80);
    block(w, 46, 30, 49, 33, T.LAKE);
    const sim = quiet(w);
    sim.settlements.auto = false;
    sim.groups.enabled = false;
    sim.spawnInCircle(HUMAN, 40, 40, 3, 10);
    const s = sim.foundSettlement(40, 40, 'human') as Settlement;
    s.civ!.wood = 100;
    s.civ!.stone = 50;
    expect(buildBlock(sim.world, s, sim.settlements.owner, 'shipyard')).toBe('site');
  });

  it('a coast adds a little to the site score (only open sea counts)', () => {
    expect(SPECIES[HUMAN].civ!.weights.coast).toBeGreaterThan(0);
    expect(SPECIES[HUMAN].civ!.weights.coast).toBeLessThan(0.1);
  });
});

describe('trails', () => {
  function village(): { sim: Simulation; s: Settlement } {
    const w = flat(120, 80);
    block(w, 38, 31, 42, 32, T.LAKE);
    const sim = quiet(w);
    sim.settlements.auto = false;
    sim.groups.enabled = false;
    sim.spawnInCircle(HUMAN, 40, 40, 3, 12);
    const s = sim.foundSettlement(40, 40, 'human') as Settlement;
    s.civ!.food = 60;
    s.civ!.buildings.push({ id: s.civ!.nextBuildingId++, type: 'farm', x: 46, y: 44, started: 0, progress: 5, needed: 5, done: true, reserve: 0, acc: 0, active: false, idle: 0, empty: false, here: 0, level: 1, up: 0 });
    return { sim, s };
  }

  it('people wear trails into the land of their settlement where they really walk', () => {
    const { sim, s } = village();
    run(sim, STEP_TICKS * 120);
    const pairs = sim.settlements.trailTiles();
    expect(pairs.length).toBeGreaterThan(0);
    const W = sim.world.width;
    let linked = 0;
    const set = new Set<number>();
    for (let k = 0; k < pairs.length; k += 2) set.add(pairs[k]);
    for (const t of set) {
      expect(isWater(sim.world.terrain[t])).toBe(false);
      expect(pairs[[...set].indexOf(t) * 2 + 1]).toBeGreaterThanOrEqual(TRAIL_WEAR);
      if (set.has(t + 1) || set.has(t - 1) || set.has(t + W) || set.has(t - W)) linked++;
    }
    expect(linked / set.size).toBeGreaterThan(0.5); // trails join up into paths, not scattered dots
    expect(sim.settlements.owner![[...set][0]]).toBe(s.id);
  });

  it('trails fade when nobody walks there any more, and are saved', () => {
    const { sim } = village();
    run(sim, STEP_TICKS * 120);
    const data = serialize(sim);
    expect(data.version).toBe(SAVE_VERSION);
    const other = quiet(flat(8, 8));
    deserializeInto(other, data);
    expect(other.settlements.exportWear()).toEqual(sim.settlements.exportWear());
    // Older saves have no trails: they load with none.
    const old = serialize(sim);
    delete (old.settlements as { wear?: number[] }).wear;
    const third = quiet(flat(8, 8));
    deserializeInto(third, { ...old, version: 13 });
    expect(third.settlements.trailTiles()).toEqual([]);
    // Everybody leaves: wear fades.
    const everyone: number[] = [];
    for (let i = 0; i < sim.creatures.count; i++) if (sim.creatures.isAlive(i)) everyone.push(sim.creatures.id[i]);
    for (const id of everyone) sim.creatures.removeById(id);
    const before = sim.settlements.exportWear().filter((_, k) => k % 2 === 1).reduce((a, b) => a + b, 0);
    run(sim, STEP_TICKS * 60);
    const after = sim.settlements.exportWear().filter((_, k) => k % 2 === 1).reduce((a, b) => a + b, 0);
    expect(after).toBeLessThan(before);
    expect(PATH_WEAR).toBeGreaterThan(TRAIL_WEAR);
  });
});

describe('creature art', () => {
  it('every species has two frames of equal size that differ (walking)', () => {
    for (const sp of SPECIES) {
      const art = CREATURE_ART[sp.id];
      expect(art.frames.length).toBe(2);
      expect(art.frames[1].length).toBe(art.frames[0].length);
      expect(art.frames[1].join('')).not.toBe(art.frames[0].join(''));
    }
  });

  it('elves have their own silhouette: taller, with ears and hair sticking out behind the head', () => {
    const human = silhouette(HUMAN);
    const elf = silhouette(ELF);
    expect(elf.length).toBeGreaterThan(human.length);
    expect(elf.join('\n')).not.toBe(human.join('\n'));
    // The swept-back ear: opaque pixels at the back of the head (left edge, facing right) that humans do not have.
    expect(elf[1][0]).toBe('#');
    expect(human[1][0]).toBe('.');
    // Animals keep their own shapes.
    expect(new Set(SPECIES.map((s) => silhouette(s.id).join('\n'))).size).toBe(SPECIES.length);
  });
});
