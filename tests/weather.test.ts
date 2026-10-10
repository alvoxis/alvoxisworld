import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { CAUSE, GRAZER, HADROSAUR } from '../src/sim/creatures';
import { Fire, MAX_BURNING } from '../src/sim/fire';
import { Simulation } from '../src/sim/simulation';
import { MAX_AUTO_SYSTEMS, MAX_MANUAL_SYSTEMS, WEATHER_KIND, WEATHER_STEP, Weather } from '../src/sim/weather';
import { meteorStrike, earthquake, METEOR_MAX_IGNITIONS } from '../src/sim/disasters';
import { applyHeightBrush } from '../src/world/brush';
import { SEA_LEVEL, T, isWater } from '../src/world/terrain';
import { WATER_FLAG, World } from '../src/world/world';

/** Flat test world with base climate set; rects of other terrain (lakes/rivers get bed flags). */
function testWorld(w: number, h: number, fill: number, rects: Array<[number, number, number, number, number]> = [], moisture = 110): World {
  const world = new World(w, h, 1);
  world.heights.fill(SEA_LEVEL + 20);
  world.temperature.fill(140);
  world.moisture.fill(moisture);
  world.baseTemperature.fill(140);
  world.baseMoisture.fill(moisture);
  world.terrain.fill(fill);
  for (const [x0, y0, x1, y1, id] of rects) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = world.idx(x, y);
        world.terrain[i] = id;
        if (id === T.LAKE) world.waterFlags[i] = WATER_FLAG.LAKE_BED;
        if (id === T.RIVER) world.waterFlags[i] = WATER_FLAG.RIVER_BED;
        if (id === T.SHALLOW_WATER || id === T.DEEP_WATER) world.heights[i] = SEA_LEVEL - 10;
      }
    }
  }
  return world;
}

function count(world: World, id: number): number {
  let n = 0;
  for (const t of world.terrain) if (t === id) n++;
  return n;
}

function runWeather(sim: Simulation, ticks: number): void {
  for (let t = 0; t < ticks; t++) sim.step();
}

describe('weather', () => {
  it('forms systems by itself, moves them, and respects the caps', () => {
    const sim = new Simulation(testWorld(200, 120, T.GRASS));
    sim.weather.config = { auto: true, severity: 2 };
    let maxAuto = 0;
    let moved = false;
    let first: { x: number; y: number } | null = null;
    for (let t = 0; t < 6000; t++) {
      sim.step();
      const auto = sim.weather.systems.filter((s) => !s.manual);
      maxAuto = Math.max(maxAuto, auto.length);
      if (auto.length && !first) first = { x: auto[0].x, y: auto[0].y };
      if (first && auto.length && (auto[0].x !== first.x || auto[0].y !== first.y)) moved = true;
    }
    expect(maxAuto).toBeGreaterThan(0);
    expect(maxAuto).toBeLessThanOrEqual(MAX_AUTO_SYSTEMS);
    expect(moved).toBe(true);
  });

  it('does not advance while paused, and runs only on weather steps', () => {
    const sim = new Simulation(testWorld(64, 64, T.GRASS));
    sim.summonWeather(WEATHER_KIND.RAIN, 32, 32, 20, 3);
    const before = sim.world.moisture.slice();
    const ttl = sim.weather.systems[0].ttl;
    sim.speed = 0;
    sim.advance(5);
    expect(sim.world.moisture).toEqual(before);
    expect(sim.weather.systems[0].ttl).toBe(ttl);
    sim.speed = 1;
    sim.advance(WEATHER_STEP / 10 + 0.01); // ≥ one weather step at 10 ticks/s
    expect(sim.weather.systems[0].ttl).toBeLessThan(ttl);
  });

  it('auto weather can be switched off', () => {
    const sim = new Simulation(testWorld(200, 120, T.GRASS));
    sim.weather.config.auto = false;
    runWeather(sim, 5000);
    expect(sim.weather.systems.length).toBe(0);
  });

  it('rain raises moisture and lowers temperature; drought does the opposite; both relax afterwards', () => {
    const sim = new Simulation(testWorld(80, 80, T.GRASS));
    sim.weather.config.auto = false;
    sim.summonWeather(WEATHER_KIND.RAIN, 20, 40, 15, 3);
    sim.summonWeather(WEATHER_KIND.DROUGHT, 60, 40, 15, 3);
    runWeather(sim, 200);
    const w = sim.world;
    const at = (x: number, y: number) => w.idx(x, y);
    // Averages over each system's core (effects are applied to sampled tiles).
    const avg = (arr: Uint8Array, cx: number) => {
      let sum = 0;
      let n = 0;
      for (let y = 30; y < 50; y++) for (let x = cx - 10; x < cx + 10; x++) {
        sum += arr[at(x, y)];
        n++;
      }
      return sum / n;
    };
    expect(avg(w.moisture, 20)).toBeGreaterThan(118);
    expect(avg(w.temperature, 20)).toBeLessThan(138);
    expect(avg(w.moisture, 60)).toBeLessThan(102);
    expect(avg(w.temperature, 60)).toBeGreaterThan(142);
    // Thirst under drought is higher than under rain.
    expect(sim.weather.thirstFactor(60, 40)).toBeGreaterThan(sim.weather.thirstFactor(20, 40));
    // After the systems end, climate drifts back toward its long-term values.
    sim.weather.systems = [];
    runWeather(sim, 3000);
    expect(Math.abs(avg(w.moisture, 20) - 110)).toBeLessThan(15);
    expect(Math.abs(avg(w.moisture, 60) - 110)).toBeLessThan(15);
  });

  it('drought dries lakes from the shore and dries rivers; rain refills the beds', () => {
    const world = testWorld(80, 60, T.GRASS, [[20, 20, 40, 40, T.LAKE], [50, 0, 51, 60, T.RIVER]]);
    const sim = new Simulation(world);
    sim.weather.config.auto = false;
    const lake0 = count(world, T.LAKE);
    const river0 = count(world, T.RIVER);
    sim.summonWeather(WEATHER_KIND.DROUGHT, 40, 30, 40, 3);
    runWeather(sim, 400);
    const lake1 = count(world, T.LAKE);
    const river1 = count(world, T.RIVER);
    expect(lake1).toBeLessThan(lake0);
    expect(river1).toBeLessThan(river0);
    // The dried tiles remember their beds.
    let beds = 0;
    for (let i = 0; i < world.terrain.length; i++) if (!isWater(world.terrain[i]) && world.waterFlags[i] & WATER_FLAG.LAKE_BED) beds++;
    expect(beds).toBe(lake0 - lake1);
    sim.weather.systems = [];
    sim.summonWeather(WEATHER_KIND.RAIN, 40, 30, 40, 3);
    runWeather(sim, 400);
    expect(count(world, T.LAKE)).toBeGreaterThan(lake1);
    expect(count(world, T.RIVER)).toBeGreaterThan(river1);
  });

  it('heavy rain floods low land beside rivers; floods drain afterwards', () => {
    const world = testWorld(60, 40, T.GRASS, [[30, 0, 31, 40, T.RIVER]]);
    // Banks lower than the river's surface flood first.
    for (let y = 0; y < 40; y++) for (const x of [29, 31]) world.heights[world.idx(x, y)] = SEA_LEVEL + 18;
    const sim = new Simulation(world);
    sim.weather.config.auto = false;
    sim.summonWeather(WEATHER_KIND.RAIN, 30, 20, 25, 3);
    runWeather(sim, 300);
    let floods = 0;
    for (let i = 0; i < world.terrain.length; i++) if (world.waterFlags[i] & WATER_FLAG.FLOOD) floods++;
    expect(floods).toBeGreaterThan(0);
    // Flood water sits over the original terrain, which is restored when it drains.
    sim.weather.systems = [];
    sim.summonWeather(WEATHER_KIND.DROUGHT, 30, 20, 25, 3);
    runWeather(sim, 300);
    let left = 0;
    for (let i = 0; i < world.terrain.length; i++) if (world.waterFlags[i] & WATER_FLAG.FLOOD) left++;
    expect(left).toBeLessThan(floods);
    expect(sim.weather.stats.drained).toBeGreaterThan(0);
  });

  it('drought withers vegetation', () => {
    const world = testWorld(60, 60, T.FOREST, [], 40);
    const sim = new Simulation(world);
    sim.weather.config.auto = false;
    sim.summonWeather(WEATHER_KIND.DROUGHT, 30, 30, 30, 3);
    runWeather(sim, 400);
    expect(count(world, T.FOREST)).toBeLessThan(3600);
  });

  it('caps god-power weather systems', () => {
    const w = new Weather();
    for (let k = 0; k < 20; k++) w.addManual(WEATHER_KIND.RAIN, k, k, 10, 1);
    expect(w.systems.filter((s) => s.manual).length).toBe(MAX_MANUAL_SYSTEMS);
  });
});

describe('fire', () => {
  it('spreads through dry forest but not across water or bare desert', () => {
    // Forest | river | forest, desert strip at the bottom.
    const world = testWorld(60, 40, T.FOREST, [[30, 0, 32, 30, T.LAKE], [0, 30, 60, 40, T.DESERT]], 20);
    const sim = new Simulation(world);
    sim.weather.config.auto = false;
    sim.igniteArea(10, 15, 1.5);
    let burnedLeft = 0;
    for (let t = 0; t < 600; t++) sim.step();
    for (let y = 0; y < 30; y++) for (let x = 0; x < 30; x++) if (world.terrainAt(x, y) === T.SOIL) burnedLeft++;
    let burnedRight = 0;
    for (let y = 0; y < 30; y++) for (let x = 32; x < 60; x++) if (world.terrainAt(x, y) === T.SOIL) burnedRight++;
    expect(burnedLeft).toBeGreaterThan(50);
    expect(burnedRight).toBe(0); // the lake is a firebreak
    for (let y = 30; y < 40; y++) for (let x = 0; x < 60; x++) expect(world.terrainAt(x, y)).toBe(T.DESERT);
  });

  it('wet ground stops fire; rain puts it out', () => {
    const wet = testWorld(40, 40, T.FOREST, [], 250);
    const a = new Simulation(wet);
    a.weather.config.auto = false;
    a.igniteArea(20, 20, 1);
    for (let t = 0; t < 400; t++) a.step();
    expect(a.fire.burnedOut).toBeLessThan(20); // barely spreads in soaked forest

    const dry = testWorld(40, 40, T.FOREST, [], 10);
    const b = new Simulation(dry);
    b.weather.config.auto = false;
    b.igniteArea(20, 20, 2);
    b.summonWeather(WEATHER_KIND.RAIN, 20, 20, 30, 3);
    for (let t = 0; t < 400; t++) b.step();
    expect(b.fire.burning).toBe(0);
  });

  it('never exceeds the burning-tile cap', () => {
    const world = testWorld(200, 200, T.FOREST, [], 0);
    const sim = new Simulation(world);
    sim.weather.config.auto = false;
    for (let k = 0; k < 40; k++) sim.igniteArea(5 + k * 5, 100, 3);
    let peak = 0;
    for (let t = 0; t < 300; t++) {
      sim.step();
      peak = Math.max(peak, sim.fire.burning);
    }
    expect(peak).toBeLessThanOrEqual(MAX_BURNING);
  });

  it('burns animals standing in it and they flee it', () => {
    const world = testWorld(60, 40, T.FOREST, [[0, 0, 60, 2, T.LAKE]], 5);
    const sim = new Simulation(world);
    sim.weather.config.auto = false;
    const id = sim.creatures.spawn(HADROSAUR, 30.5, 20.5, sim.rng, { hunger: 0, thirst: 0 });
    sim.igniteArea(30.5, 20.5, 1);
    let fled = false;
    for (let t = 0; t < 30; t++) {
      sim.step();
      const i = sim.creatures.indexOf(id);
      if (i < 0) break;
      if (sim.creatures.state[i] === 6) fled = true; // STATE.FLEE
    }
    const i = sim.creatures.indexOf(id);
    expect(fled || i < 0).toBe(true);
    if (i >= 0) expect(sim.creatures.health[i]).toBeLessThan(120);
    else expect(sim.creatures.deathsBy(HADROSAUR, CAUSE.FIRE)).toBe(1);
  });

  it('rebuilds its burning list from the world', () => {
    const world = testWorld(20, 20, T.FOREST);
    const f = new Fire();
    f.ignite(world, 3, 3);
    f.ignite(world, 5, 5);
    const g = new Fire();
    g.rebuild(world);
    expect(g.burning).toBe(2);
  });
});

describe('meteor and earthquake', () => {
  it('a meteor digs a crater, scorches it, kills animals inside and starts limited fires', () => {
    const world = testWorld(100, 100, T.FOREST, [], 20);
    world.heights.fill(SEA_LEVEL + 70); // high ground: the crater stays dry
    const sim = new Simulation(world);
    sim.weather.config.auto = false;
    sim.spawnInCircle(GRAZER, 50, 50, 3, 10);
    const far = sim.creatures.spawn(GRAZER, 90, 90, sim.rng);
    const h0 = world.heights[world.idx(50, 50)];
    const r = meteorStrike(world, sim.creatures, sim.fire, new Rng(1), 50, 50, 6, 2);
    expect(world.heights[world.idx(50, 50)]).toBeLessThan(h0 - 20);
    expect(world.terrainAt(50, 50)).toBe(T.SOIL);
    // Raised rim just outside the crater.
    expect(world.heights[world.idx(50 + Math.round(6 * 1.3 * 1.1), 50)]).toBeGreaterThan(h0);
    expect(r.killed).toBeGreaterThanOrEqual(10);
    expect(sim.creatures.deathsBy(GRAZER, CAUSE.METEOR)).toBeGreaterThanOrEqual(10);
    expect(sim.creatures.indexOf(far)).toBeGreaterThanOrEqual(0);
    expect(r.ignited).toBeGreaterThan(0);
    expect(r.ignited).toBeLessThanOrEqual(METEOR_MAX_IGNITIONS);
  });

  it('a meteor below sea level leaves a crater lake', () => {
    const world = testWorld(60, 60, T.GRASS);
    world.heights.fill(SEA_LEVEL + 5);
    const sim = new Simulation(world);
    meteorStrike(world, sim.creatures, sim.fire, new Rng(2), 30, 30, 6, 3);
    expect(world.terrainAt(30, 30)).toBe(T.LAKE);
    expect(world.waterFlags[world.idx(30, 30)] & WATER_FLAG.LAKE_BED).toBeTruthy();
  });

  it('an earthquake opens a rift, buckles the ground and injures animals', () => {
    const world = testWorld(80, 80, T.GRASS);
    const sim = new Simulation(world);
    const id = sim.creatures.spawn(GRAZER, 40.5, 40.5, sim.rng);
    const before = world.heights.slice();
    const r = earthquake(world, sim.creatures, new Rng(3), 40, 40, 15, 3);
    let lowered = 0;
    let changed = 0;
    for (let i = 0; i < before.length; i++) {
      if (world.heights[i] !== before[i]) changed++;
      if (world.heights[i] < before[i] - 8) lowered++;
    }
    expect(r.tiles).toBe(changed);
    expect(lowered).toBeGreaterThan(10); // the rift
    const i = sim.creatures.indexOf(id);
    expect(i < 0 || sim.creatures.health[i] < 40).toBe(true);
    // Nothing outside the radius changed.
    expect(world.heights[world.idx(5, 5)]).toBe(before[world.idx(5, 5)]);
  });

  it('earthquakes keep rivers and lakes (brush water rule)', () => {
    const world = testWorld(60, 60, T.GRASS, [[28, 0, 30, 60, T.RIVER]]);
    const sim = new Simulation(world);
    earthquake(world, sim.creatures, new Rng(4), 29, 30, 12, 1);
    // Heights only drop ~12 at most, still above sea level: the river stays.
    for (let y = 0; y < 60; y++) expect(world.terrainAt(28, y)).toBe(T.RIVER);
  });
});

describe('brush water rule', () => {
  it('raise and lower keep rivers and lakes unless pushed below sea level', () => {
    const world = testWorld(40, 40, T.GRASS, [[10, 10, 20, 20, T.LAKE]]);
    applyHeightBrush(world, { x: 15, y: 15, radius: 3 }, 1);
    expect(world.terrainAt(15, 15)).toBe(T.LAKE);
    for (let k = 0; k < 20; k++) applyHeightBrush(world, { x: 15, y: 15, radius: 2, strength: 10 }, -1);
    expect(world.heights[world.idx(15, 15)]).toBeLessThan(SEA_LEVEL);
    expect([T.SHALLOW_WATER, T.DEEP_WATER]).toContain(world.terrainAt(15, 15));
    expect(world.waterFlags[world.idx(15, 15)]).toBe(0);
  });
});
