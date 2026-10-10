import { describe, expect, it } from 'vitest';
import { BRUSH_SIZES, SIZE_NAMES, TOOLS, areaOf, toolById, type ToolContext } from '../src/game/tools';
import { FoodMap } from '../src/sim/foodmap';
import { SPECIES } from '../src/sim/creatures';
import { Simulation } from '../src/sim/simulation';
import { SEA_LEVEL, T } from '../src/world/terrain';
import { World } from '../src/world/world';

function flat(w: number, h: number, fill: number = T.GRASS): World {
  const world = new World(w, h, 1);
  world.heights.fill(SEA_LEVEL + 20);
  world.temperature.fill(140);
  world.moisture.fill(110);
  world.baseTemperature.fill(140);
  world.baseMoisture.fill(110);
  world.terrain.fill(fill);
  return world;
}

function ctx(sim: Simulation, over: Partial<ToolContext> = {}): ToolContext {
  return { sim, inspect() {}, intensity: 2, durationTicks: 100, count: 12, effect() {}, notify() {}, ...over };
}

describe('area sizes', () => {
  it('offers named sizes that strictly increase, and every area tool grows with them', () => {
    expect(SIZE_NAMES.length).toBe(BRUSH_SIZES.length);
    for (let i = 1; i < BRUSH_SIZES.length; i++) expect(BRUSH_SIZES[i]).toBeGreaterThan(BRUSH_SIZES[i - 1]);
    for (const tool of TOOLS) {
      if (!tool.usesBrush) continue;
      let last = -1;
      for (const r of BRUSH_SIZES) {
        const main = areaOf(tool, r, 2).find((a) => a.kind === 'main')!.radius;
        expect(main, tool.id).toBeGreaterThanOrEqual(last);
        last = main;
      }
      const small = areaOf(tool, BRUSH_SIZES[0], 2)[0].radius;
      expect(areaOf(tool, BRUSH_SIZES[BRUSH_SIZES.length - 1], 2)[0].radius, tool.id).toBeGreaterThan(small);
    }
  });

  it('a biome brush changes tiles within the previewed circle, and reaches close to its edge', () => {
    for (const r of BRUSH_SIZES) {
      const sim = new Simulation(flat(80, 80, T.GRASS));
      const tool = toolById('paint_desert');
      tool.apply(ctx(sim), 40, 40, r);
      const ring = areaOf(tool, r, 2)[0].radius;
      let far = 0;
      let n = 0;
      for (let y = 0; y < 80; y++) {
        for (let x = 0; x < 80; x++) {
          if (sim.world.terrain[y * 80 + x] === T.DESERT) {
            n++;
            far = Math.max(far, Math.hypot(x + 0.5 - 40, y + 0.5 - 40));
          }
        }
      }
      expect(n).toBeGreaterThan(0);
      expect(far).toBeLessThanOrEqual(ring + 1.5);
      expect(far).toBeGreaterThan(ring - 2);
    }
  });

  it('a weather power covers exactly the previewed circle', () => {
    for (const r of [1, 7, 24]) {
      const sim = new Simulation(flat(100, 100));
      const tool = toolById('rain');
      tool.apply(ctx(sim), 50, 50, r);
      const ring = areaOf(tool, r, 2)[0].radius;
      const a = sim.weather.systems[sim.weather.systems.length - 1];
      expect(a.radius).toBeCloseTo(ring, 5);
    }
  });

  it('a meteor changes the world inside its outer ring and leaves the rest alone', () => {
    const sim = new Simulation(flat(100, 100, T.FOREST));
    sim.weather.config.auto = false;
    const before = sim.world.terrain.slice();
    const heights = sim.world.heights.slice();
    const tool = toolById('meteor');
    tool.apply(ctx(sim, { intensity: 3 }), 50, 50, 7);
    for (let t = 0; t < 40; t++) sim.step();
    expect(sim.sky.stats.meteors).toBe(1);
    const outer = areaOf(tool, 7, 3).find((a) => a.kind === 'outer')!.radius;
    let changed = 0;
    for (let y = 0; y < 100; y++) {
      for (let x = 0; x < 100; x++) {
        const i = y * 100 + x;
        if (before[i] !== sim.world.terrain[i] || heights[i] !== sim.world.heights[i]) {
          changed++;
          expect(Math.hypot(x + 0.5 - 50, y + 0.5 - 50), `tile ${x},${y}`).toBeLessThanOrEqual(outer + 2);
        }
      }
    }
    expect(changed).toBeGreaterThan(20);
  });
});

describe('food map', () => {
  it('a full cycle of incremental updates equals a fresh build', () => {
    const world = flat(96, 80, T.GRASS);
    for (let y = 10; y < 40; y++) for (let x = 20; x < 70; x++) world.terrain[y * 96 + x] = T.FOREST;
    const food = SPECIES.map((s) => s.food);
    const inc = new FoodMap(food);
    inc.update(world, 0, 50);
    for (let y = 30; y < 60; y++) for (let x = 5; x < 50; x++) world.terrain[y * 96 + x] = T.DESERT;
    for (let t = 1; t <= 50; t++) inc.update(world, t, 50);
    const full = new FoodMap(food);
    full.build(world, 50);
    expect(inc.exportState().counts).toEqual(full.exportState().counts);
  });

  it('refreshes only a few bands per tick', () => {
    const world = flat(96, 160, T.GRASS);
    const food = SPECIES.map((s) => s.food);
    const fm = new FoodMap(food);
    fm.update(world, 0, 50);
    const c0 = fm.cursor;
    fm.update(world, 1, 50);
    const moved = (fm.cursor - c0 + fm.h) % fm.h;
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThanOrEqual(Math.ceil(fm.h / 50));
  });
});

describe('visual events match the simulation', () => {
  it('every lightning bolt event is a real strike that is counted', () => {
    const sim = new Simulation(flat(60, 60));
    sim.weather.config.auto = false;
    for (let k = 0; k < 5; k++) sim.lightning(10 + k * 5, 30);
    const bolts = sim.sky.drainEvents().filter((e) => e.kind === 'bolt');
    expect(bolts.length).toBe(5);
    expect(sim.sky.stats.lightning).toBe(5);
  });

  it('every impact event comes with a counted meteor, a crater and a log entry', () => {
    const sim = new Simulation(flat(80, 80, T.FOREST));
    sim.weather.config.auto = false;
    sim.launchMeteor(40, 40, 4, 2);
    sim.launchMeteor(20, 20, 3, 1);
    expect(sim.sky.drainEvents().filter((e) => e.kind === 'impact').length).toBe(0); // still in the air
    const h0 = sim.world.heights[40 * 80 + 40];
    for (let t = 0; t < 40; t++) sim.step();
    const impacts = sim.sky.drainEvents().filter((e) => e.kind === 'impact');
    expect(impacts.length).toBe(2);
    expect(sim.sky.stats.meteors).toBe(2);
    expect(sim.world.heights[40 * 80 + 40]).toBeLessThan(h0);
  });

  it('a shower of N meteors yields N impacts, never more than allowed at once', () => {
    const sim = new Simulation(flat(120, 120, T.FOREST));
    sim.weather.config.auto = false;
    const n = sim.launchShower(60, 60, 12, 24, 2);
    expect(n).toBe(24);
    let impacts = 0;
    let peak = 0;
    for (let t = 0; t < 200; t++) {
      sim.step();
      peak = Math.max(peak, sim.sky.meteors.length);
      impacts += sim.sky.drainEvents().filter((e) => e.kind === 'impact').length;
    }
    expect(impacts).toBe(24);
    expect(sim.sky.stats.meteors).toBe(24);
    expect(peak).toBeLessThanOrEqual(24);
  });

  it('fire burns tiles that really lose their vegetation and can spread', () => {
    const sim = new Simulation(flat(60, 60, T.FOREST));
    sim.weather.config.auto = false;
    sim.world.moisture.fill(10);
    sim.igniteArea(30, 30, 2);
    expect(sim.fire.burning).toBeGreaterThan(0);
    const start = sim.fire.burning;
    let peak = start;
    for (let t = 0; t < 200; t++) {
      sim.step();
      peak = Math.max(peak, sim.fire.burning);
    }
    expect(peak).toBeGreaterThan(start);
    let burnt = 0;
    for (let i = 0; i < sim.world.terrain.length; i++) if (sim.world.terrain[i] !== T.FOREST) burnt++;
    expect(burnt).toBeGreaterThan(0);
  });
});
