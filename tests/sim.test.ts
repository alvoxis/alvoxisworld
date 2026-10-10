import { describe, expect, it } from 'vitest';
import { Camera } from '../src/render/camera';
import { deserializeInto, serialize } from '../src/save/serialize';
import { dateFromTick, TICKS_PER_YEAR } from '../src/sim/clock';
import { CAUSE, FISH, GRAZER, HADROSAUR, MAX_CREATURES, RAPTOR, SPECIES, TYRANT } from '../src/sim/creatures';
import { Simulation } from '../src/sim/simulation';
import { applyPaintBrush } from '../src/world/brush';
import { generateWorld } from '../src/world/generator';
import { T } from '../src/world/terrain';
import { Rng } from '../src/core/rng';

function grassWorld() {
  const w = generateWorld(96, 96, 21);
  applyPaintBrush(w, { x: 48, y: 48, radius: 30 }, T.GRASS);
  return w;
}

describe('clock', () => {
  it('advances days, seasons and years', () => {
    expect(dateFromTick(0)).toMatchObject({ year: 1, season: 'Spring', day: 1 });
    expect(dateFromTick(TICKS_PER_YEAR)).toMatchObject({ year: 2, season: 'Spring', day: 1 });
    expect(dateFromTick(TICKS_PER_YEAR - 1).season).toBe('Winter');
  });
});

describe('simulation', () => {
  it('runs nothing while paused and fixed steps while running', () => {
    const sim = new Simulation(grassWorld());
    sim.speed = 0;
    expect(sim.advance(1)).toBe(0);
    sim.speed = 1;
    sim.step(); // the first tick of a world builds navigation, which can exceed a frame's tick budget
    expect(sim.advance(0.2)).toBe(2);
    expect(sim.tick).toBe(3);
  });

  it('spawns only on land and grazers survive on grass', () => {
    const sim = new Simulation(grassWorld());
    expect(sim.spawnInCircle(GRAZER, 2, 2, 1, 5)).toBe(0); // ocean corner
    expect(sim.spawnInCircle(GRAZER, 48, 48, 5, 20)).toBe(20);
    for (let i = 0; i < 300; i++) sim.step();
    expect(sim.creatures.countSpecies(GRAZER)).toBeGreaterThan(0);
  });

  it('raptors without prey eventually starve', () => {
    const sim = new Simulation(grassWorld());
    sim.spawnInCircle(RAPTOR, 48, 48, 5, 5);
    for (let i = 0; i < 1200; i++) sim.step();
    expect(sim.creatures.countSpecies(RAPTOR)).toBe(0);
    expect(sim.history.some((h) => h.text.includes('extinct'))).toBe(true);
  });

  it('creatures drown when their land is flooded', () => {
    const sim = new Simulation(grassWorld());
    sim.spawnInCircle(GRAZER, 48, 48, 3, 10);
    applyPaintBrush(sim.world, { x: 48, y: 48, radius: 12 }, T.DEEP_WATER);
    sim.step();
    expect(sim.creatures.count).toBe(0);
  });

  it('predators and prey coexist and grazers stay below capacity', () => {
    const w = generateWorld(512, 320, 4);
    const sim = new Simulation(w);
    const r = new Rng(5);
    let placed = 0;
    for (let k = 0; k < 4000 && placed < 15; k++) {
      const x = r.next() * 512;
      const y = r.next() * 320;
      if (w.terrainAt(Math.floor(x), Math.floor(y)) !== T.GRASS) continue;
      sim.spawnInCircle(GRAZER, x, y, 3, 8);
      if (placed % 3 === 0) sim.spawnInCircle(RAPTOR, x, y, 3, 2);
      placed++;
    }
    for (let i = 0; i < TICKS_PER_YEAR * 4; i++) sim.step();
    const grazers = sim.creatures.countSpecies(GRAZER);
    expect(grazers).toBeGreaterThan(100);
    expect(grazers).toBeLessThan(MAX_CREATURES * SPECIES[GRAZER].maxShare + 10);
    expect(sim.creatures.countSpecies(RAPTOR)).toBeGreaterThan(0);
    expect(sim.creatures.deathsBy(GRAZER, CAUSE.PREDATION)).toBeGreaterThan(10);
  });

  it('mixed ecosystem: predators persist and rarely die of thirst (long run, rivers on)', () => {
    // Same scenario as the stability investigation in docs/ECOSYSTEM.md (seed 11, 6 years).
    const w = generateWorld(512, 320, 11);
    const sim = new Simulation(w);
    const r = new Rng(11);
    const place = (want: number, n: number, fn: (x: number, y: number, k: number) => void) => {
      let k = 0;
      for (let a = 0; a < 20000 && k < n; a++) {
        const x = r.next() * w.width;
        const y = r.next() * w.height;
        if (w.terrainAt(Math.floor(x), Math.floor(y)) !== want) continue;
        fn(x, y, k);
        k++;
      }
    };
    place(T.GRASS, 15, (x, y, k) => {
      sim.spawnInCircle(GRAZER, x, y, 3, 8);
      if (k % 3 === 0) sim.spawnInCircle(RAPTOR, x, y, 3, 2);
    });
    place(T.FOREST, 8, (x, y, k) => {
      sim.spawnInCircle(HADROSAUR, x, y, 3, 4);
      if (k % 4 === 0) sim.spawnInCircle(TYRANT, x, y, 3, 2);
    });
    place(T.SHALLOW_WATER, 8, (x, y) => sim.spawnInCircle(FISH, x, y, 3, 6));
    for (let i = 0; i < TICKS_PER_YEAR * 6; i++) sim.step();
    const c = sim.creatures;
    for (const s of [GRAZER, RAPTOR, HADROSAUR, TYRANT]) expect(c.countSpecies(s)).toBeGreaterThan(0);
    const raptorDeaths = [1, 2, 3, 4, 5].reduce((n, k) => n + c.deathsBy(RAPTOR, k), 0);
    expect(c.deathsBy(RAPTOR, CAUSE.THIRST)).toBeLessThanOrEqual(Math.max(2, raptorDeaths * 0.1));
    expect(c.deathsBy(TYRANT, CAUSE.THIRST)).toBeLessThanOrEqual(1);
    // Predators don't out-breed their prey.
    expect(c.countSpecies(GRAZER)).toBeGreaterThan(c.countSpecies(RAPTOR) * 5);
  });

  it('bare soil regrows over time', () => {
    const w = grassWorld();
    applyPaintBrush(w, { x: 48, y: 48, radius: 10 }, T.GRASS);
    for (let y = 40; y < 56; y++) for (let x = 40; x < 56; x++) w.setTerrain(x, y, T.SOIL);
    const sim = new Simulation(w);
    for (let i = 0; i < 2000; i++) sim.step();
    let soil = 0;
    for (let y = 40; y < 56; y++) for (let x = 40; x < 56; x++) if (w.terrainAt(x, y) === T.SOIL) soil++;
    expect(soil).toBeLessThan(256 * 0.5);
  });
});

describe('save / load', () => {
  it('round-trips world, time and creatures', () => {
    const sim = new Simulation(grassWorld());
    sim.spawnInCircle(GRAZER, 48, 48, 5, 10);
    for (let i = 0; i < 50; i++) sim.step();
    const data = serialize(sim);

    const other = new Simulation(generateWorld(32, 32, 1));
    const world = deserializeInto(other, data);
    expect(world.width).toBe(96);
    expect(world.terrain).toEqual(sim.world.terrain);
    expect(other.tick).toBe(sim.tick);
    expect(other.creatures.count).toBe(sim.creatures.count);
    expect(Array.from(other.creatures.x.slice(0, other.creatures.count))).toEqual(
      Array.from(sim.creatures.x.slice(0, sim.creatures.count)),
    );
    // Same RNG state ⇒ identical futures.
    for (let i = 0; i < 30; i++) {
      sim.step();
      other.step();
    }
    expect(other.world.terrain).toEqual(sim.world.terrain);
    expect(other.creatures.count).toBe(sim.creatures.count);
  });

  it('rejects corrupt saves', () => {
    const sim = new Simulation(grassWorld());
    const data = serialize(sim);
    data.terrain = new Uint8Array(3);
    expect(() => deserializeInto(new Simulation(grassWorld()), data)).toThrow();
  });
});

describe('camera', () => {
  it('keeps the world point under the cursor fixed while zooming', () => {
    const c = new Camera();
    c.setWorldSize(512, 320);
    c.setViewport(400, 800);
    c.zoom = 4;
    c.centerOn(256, 160);
    const before = c.screenToWorld(100, 200);
    c.zoomAt(2, 100, 200);
    const after = c.screenToWorld(100, 200);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it('clamps zoom and keeps the view over the world', () => {
    const c = new Camera();
    c.setWorldSize(100, 100);
    c.setViewport(400, 400);
    c.zoomAt(1000, 0, 0);
    expect(c.zoom).toBe(c.maxZoom);
    c.pan(1e6, 1e6);
    const centre = c.screenToWorld(200, 200);
    expect(centre.x).toBeGreaterThanOrEqual(0);
    expect(centre.y).toBeGreaterThanOrEqual(0);
  });
});
