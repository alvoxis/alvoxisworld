import { describe, expect, it } from 'vitest';
import { UndoHistory } from '../src/game/undo';
import { SAVE_VERSION, deserializeInto, serialize } from '../src/save/serialize';
import { CAUSE, FISH, GRAZER, RAPTOR, TYRANT } from '../src/sim/creatures';
import { meteorClass } from '../src/sim/disasters';
import { Fire } from '../src/sim/fire';
import { Simulation } from '../src/sim/simulation';
import { FLIGHT_TICKS, MAX_METEORS, MAX_QUEUED_METEORS, MAX_SHOWERS } from '../src/sim/sky';
import { SNOW_TEMPERATURE, WEATHER_KIND, Weather } from '../src/sim/weather';
import { SEA_LEVEL, T } from '../src/world/terrain';
import { WATER_FLAG, World } from '../src/world/world';

/** Flat test world with base climate set; rects of other terrain. */
function testWorld(
  w: number, h: number, fill: number, rects: Array<[number, number, number, number, number]> = [], moisture = 110, temperature = 140,
): World {
  const world = new World(w, h, 1);
  world.heights.fill(SEA_LEVEL + 20);
  world.temperature.fill(temperature);
  world.moisture.fill(moisture);
  world.baseTemperature.fill(temperature);
  world.baseMoisture.fill(moisture);
  world.terrain.fill(fill);
  for (const [x0, y0, x1, y1, id] of rects) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = world.idx(x, y);
        world.terrain[i] = id;
        if (id === T.LAKE) world.waterFlags[i] = WATER_FLAG.LAKE_BED;
        if (id === T.SHALLOW_WATER || id === T.DEEP_WATER) world.heights[i] = SEA_LEVEL - 10;
      }
    }
  }
  return world;
}

function quiet(sim: Simulation): Simulation {
  sim.weather.config.auto = false;
  return sim;
}

function run(sim: Simulation, ticks: number): void {
  for (let t = 0; t < ticks; t++) sim.step();
}

function count(world: World, id: number): number {
  let n = 0;
  for (const t of world.terrain) if (t === id) n++;
  return n;
}

describe('thunderstorms and lightning', () => {
  it('a storm throws lightning that is resolved by the simulation', () => {
    const sim = quiet(new Simulation(testWorld(96, 96, T.GRASS)));
    sim.summonWeather(WEATHER_KIND.RAIN, 48, 48, 20, 3, { storm: true });
    const sys = sim.weather.systems[0];
    expect(sys.storm).toBe(true);
    expect(sys.snow).toBe(false);
    run(sim, 300);
    expect(sim.sky.stats.lightning).toBeGreaterThan(5);
    const bolts = sim.sky.drainEvents().filter((e) => e.kind === 'bolt');
    expect(bolts.length).toBeGreaterThan(0);
    expect(sim.sky.drainEvents()).toEqual([]); // drained
  });

  it('a strike kills what it hits and ignites dry vegetation, but not wet ground reliably', () => {
    const dry = quiet(new Simulation(testWorld(40, 40, T.FOREST, [], 5)));
    dry.creatures.spawn(GRAZER, 20.5, 20.5, dry.rng);
    const r = dry.lightning(20, 20);
    expect(r.killed).toBe(1);
    expect(dry.creatures.deathsBy(GRAZER, CAUSE.LIGHTNING)).toBe(1);
    let lit = r.ignited;
    for (let k = 0; k < 15 && !lit; k++) lit = dry.lightning(20, 20).ignited;
    expect(lit).toBe(true);
    expect(dry.fire.burning).toBeGreaterThan(0);

    const wet = quiet(new Simulation(testWorld(40, 40, T.FOREST, [], 255)));
    let ignitions = 0;
    for (let k = 0; k < 40; k++) if (wet.lightning(10 + (k % 20), 10 + Math.floor(k / 20)).ignited) ignitions++;
    let dryIgnitions = 0;
    const dry2 = quiet(new Simulation(testWorld(40, 40, T.FOREST, [], 0)));
    for (let k = 0; k < 40; k++) if (dry2.lightning(10 + (k % 20), 10 + Math.floor(k / 20)).ignited) dryIgnitions++;
    expect(dryIgnitions).toBeGreaterThan(ignitions * 2);
  });

  it('droughts and snow never produce lightning; snow turns a storm into a snowfall', () => {
    const sim = quiet(new Simulation(testWorld(64, 64, T.GRASS)));
    sim.summonWeather(WEATHER_KIND.DROUGHT, 20, 20, 15, 3, { storm: true });
    sim.summonWeather(WEATHER_KIND.RAIN, 44, 44, 15, 3, { storm: true, snow: true });
    expect(sim.weather.systems.every((s) => !s.storm)).toBe(true);
    run(sim, 200);
    expect(sim.sky.stats.lightning).toBe(0);
  });
});

describe('snow', () => {
  it('snow cools and wets the land, puts out fire, never floods, and settles on tundra', () => {
    const w = testWorld(64, 64, T.TUNDRA, [[0, 0, 8, 64, T.LAKE]], 100, 80);
    const sim = quiet(new Simulation(w));
    w.fire[w.idx(40, 40)] = 30;
    sim.fire.rebuild(w);
    sim.summonWeather(WEATHER_KIND.RAIN, 36, 32, 30, 3, { snow: true });
    const before = w.temperature[w.idx(36, 32)];
    run(sim, 300);
    expect(sim.weather.systems[0].snow).toBe(true);
    expect(sim.weather.stats.snowCover).toBeGreaterThan(20);
    expect(count(w, T.SNOW)).toBeGreaterThan(20);
    expect(w.temperature[w.idx(36, 32)]).toBeLessThan(before);
    expect(w.fire[w.idx(40, 40)]).toBe(0);
    expect(sim.weather.stats.floods).toBe(0);
    // Every snow tile remembers what it covers.
    for (let i = 0; i < w.terrain.length; i++) {
      if (w.terrain[i] === T.SNOW) {
        expect(w.waterFlags[i] & WATER_FLAG.SNOWCOVER).toBeTruthy();
        expect(w.under[i]).toBe(T.TUNDRA);
      }
    }
  });

  it('snow cover melts from spring to autumn but stays in winter', () => {
    const w = testWorld(64, 64, T.TUNDRA, [], 100, 80);
    const sim = quiet(new Simulation(w));
    sim.tick = 3 * 120 + 10; // winter
    sim.summonWeather(WEATHER_KIND.RAIN, 32, 32, 30, 3, { snow: true });
    run(sim, 400);
    const covered = count(w, T.SNOW);
    expect(covered).toBeGreaterThan(20);
    sim.weather.systems = []; // the snowfall ends
    run(sim, 200);
    expect(count(w, T.SNOW)).toBeGreaterThanOrEqual(covered * 0.9); // still winter: stays
    sim.tick = 480 + 10; // next spring
    run(sim, 3000);
    expect(count(w, T.SNOW)).toBeLessThan(covered * 0.3);
    expect(sim.weather.stats.melted).toBeGreaterThan(0);
  });

  it('only sufficiently cold ground gets snow when it precipitates; warm ground gets rain', () => {
    const w = testWorld(64, 64, T.GRASS, [], 100, 150);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 32; x++) w.temperature[w.idx(x, y)] = SNOW_TEMPERATURE - 30;
    const sim = quiet(new Simulation(w));
    sim.summonWeather(WEATHER_KIND.RAIN, 16, 32, 6, 3); // centred over the cold half
    run(sim, 10);
    expect(sim.weather.systems[0].snow).toBe(true);
    const warm = quiet(new Simulation(testWorld(64, 64, T.GRASS, [], 100, 150)));
    warm.summonWeather(WEATHER_KIND.RAIN, 32, 32, 10, 3);
    run(warm, 10);
    expect(warm.weather.systems[0].snow).toBe(false);
  });

  it('rain washes snow cover away and greens bare soil outside winter', () => {
    const w = testWorld(64, 64, T.SOIL, [], 150, 150);
    const sim = quiet(new Simulation(w));
    sim.summonWeather(WEATHER_KIND.RAIN, 32, 32, 25, 3);
    const before = count(w, T.GRASS);
    run(sim, 200);
    expect(count(w, T.GRASS)).toBeGreaterThan(before + 50);
    expect(sim.weather.stats.greened).toBeGreaterThan(50);
  });
});

describe('meteors in flight', () => {
  it('a launched meteor changes nothing until it lands, then digs its crater', () => {
    const w = testWorld(96, 96, T.GRASS);
    const sim = quiet(new Simulation(w));
    const h0 = w.heights[w.idx(48, 48)];
    expect(sim.launchMeteor(48.5, 48.5, 6, 2)).toBe(true);
    expect(sim.sky.meteors).toHaveLength(1);
    run(sim, FLIGHT_TICKS - 2);
    expect(w.heights[w.idx(48, 48)]).toBe(h0);
    expect(sim.sky.meteors).toHaveLength(1);
    run(sim, 3);
    expect(sim.sky.meteors).toHaveLength(0);
    expect(w.heights[w.idx(48, 48)]).toBeLessThan(h0 - 10);
    const events = sim.sky.drainEvents();
    expect(events.some((e) => e.kind === 'impact')).toBe(true);
    expect(sim.sky.stats.meteors).toBe(1);
    expect(sim.history[sim.history.length - 1].text).toMatch(/medium meteor struck/);
  });

  it('bigger meteors make bigger craters and wider blast zones', () => {
    const crater = (radius: number, intensity: number) => {
      const w = testWorld(160, 160, T.FOREST);
      const sim = quiet(new Simulation(w));
      sim.launchMeteor(80.5, 80.5, radius, intensity);
      run(sim, FLIGHT_TICKS + 1);
      let low = 0;
      for (let i = 0; i < w.heights.length; i++) if (w.heights[i] < SEA_LEVEL + 10) low++;
      return { low, soil: count(w, T.SOIL), forest: count(w, T.FOREST), burning: sim.fire.burning };
    };
    const small = crater(2.5, 1);
    const large = crater(10, 3);
    expect(large.low).toBeGreaterThan(small.low * 5);
    expect(large.soil).toBeGreaterThan(small.soil * 5);
    expect(meteorClass(2.5)).toBe('small');
    expect(meteorClass(6)).toBe('medium');
    expect(meteorClass(10)).toBe('large');
  });

  it('flattens vegetation in a blast zone beyond the crater and starts fires, within the cap', () => {
    const w = testWorld(160, 160, T.FOREST, [], 20);
    const sim = quiet(new Simulation(w));
    const impact = sim.meteor(80.5, 80.5, 8, 3);
    expect(impact.ignited).toBeLessThanOrEqual(60);
    expect(impact.blasted).toBeGreaterThan(100);
    const R = 8 * (0.7 + 0.3 * 3);
    // Ring between 1.5 and 2.1 crater radii: much of the forest is gone, but not all.
    let ring = 0;
    let gone = 0;
    for (let y = 0; y < 160; y++) {
      for (let x = 0; x < 160; x++) {
        const d = Math.hypot(x + 0.5 - 80.5, y + 0.5 - 80.5) / R;
        if (d < 1.5 || d > 2.1) continue;
        ring++;
        if (w.terrain[w.idx(x, y)] !== T.FOREST) gone++;
      }
    }
    expect(gone / ring).toBeGreaterThan(0.1);
    expect(gone / ring).toBeLessThan(0.9);
    expect(impact.ignited).toBeGreaterThan(5);
  });

  it('animals run from the impact zone while the meteor is falling', () => {
    const w = testWorld(96, 96, T.GRASS);
    const sim = quiet(new Simulation(w));
    sim.spawnInCircle(GRAZER, 48, 48, 4, 10);
    const c = sim.creatures;
    const meanDist = () => {
      let s = 0;
      for (let i = 0; i < c.count; i++) s += Math.hypot(c.x[i] - 48.5, c.y[i] - 48.5);
      return s / c.count;
    };
    const before = meanDist();
    sim.launchMeteor(48.5, 48.5, 5, 2, false, 60);
    run(sim, 58);
    expect(meanDist()).toBeGreaterThan(before + 3);
    expect(c.dangers.length).toBe(1);
  });

  it('a meteor that kills at the centre is recorded as a cause of death', () => {
    const w = testWorld(64, 64, T.GRASS);
    const sim = quiet(new Simulation(w));
    sim.creatures.spawn(TYRANT, 32.5, 32.5, sim.rng);
    sim.creatures.spawn(RAPTOR, 33.5, 32.5, sim.rng);
    sim.meteor(32.5, 32.5, 4, 3);
    expect(sim.creatures.deathsBy(TYRANT, CAUSE.METEOR) + sim.creatures.deathsBy(RAPTOR, CAUSE.METEOR)).toBe(2);
  });

  it('caps the meteors in the sky at once', () => {
    const w = testWorld(128, 128, T.GRASS);
    const sim = quiet(new Simulation(w));
    for (let k = 0; k < MAX_METEORS + 5; k++) sim.launchMeteor(10 + k, 10, 2, 1);
    expect(sim.sky.meteors).toHaveLength(MAX_METEORS);
    expect(sim.launchMeteor(5, 5, 2, 1)).toBe(false);
    run(sim, FLIGHT_TICKS + 2);
    expect(sim.sky.meteors).toHaveLength(0);
  });

  it('pausing the simulation pauses meteors (they only advance in step())', () => {
    const sim = quiet(new Simulation(testWorld(64, 64, T.GRASS)));
    sim.launchMeteor(32, 32, 4, 2);
    sim.speed = 0;
    sim.advance(5);
    expect(sim.sky.meteors[0].ttl).toBe(FLIGHT_TICKS);
  });

  it('a player-launched meteor is one undo step when it lands; a natural one is not recorded', () => {
    const w = testWorld(96, 96, T.GRASS);
    const sim = quiet(new Simulation(w));
    const undo = new UndoHistory();
    sim.impactRecorder = (label, fn) => undo.record(sim.world, label, fn);
    const before = Array.from(w.heights);
    sim.launchMeteor(48.5, 48.5, 5, 2);
    expect(undo.canUndo).toBe(false); // nothing has happened yet
    run(sim, FLIGHT_TICKS + 1);
    expect(undo.size).toBe(1);
    expect(Array.from(w.heights)).not.toEqual(before);
    expect(undo.undo(w)?.skipped).toBe(0);
    expect(Array.from(w.heights)).toEqual(before);
    expect(undo.redo(w)?.label).toBe('Meteor');

    const natural = quiet(new Simulation(testWorld(96, 96, T.GRASS)));
    const u2 = new UndoHistory();
    natural.impactRecorder = (label, fn) => u2.record(natural.world, label, fn);
    natural.launchMeteor(48.5, 48.5, 5, 2, true);
    run(natural, FLIGHT_TICKS + 1);
    expect(u2.canUndo).toBe(false);
  });
});

describe('meteor showers', () => {
  const world = () => testWorld(160, 160, T.FOREST, [], 60);

  it('fire their meteors one after another over a few seconds, each from its own direction to its own point', () => {
    const sim = quiet(new Simulation(world()));
    expect(sim.launchShower(80, 80, 20, 24, 1)).toBe(24);
    expect(sim.sky.showers).toHaveLength(1);
    const seen = new Map<number, { x: number; y: number; angle: number }>();
    let peak = 0;
    for (let t = 0; t < 140; t++) {
      sim.step();
      peak = Math.max(peak, sim.sky.meteors.length);
      for (const m of sim.sky.meteors) seen.set(m.id, { x: m.x, y: m.y, angle: m.angle });
    }
    expect(seen.size).toBe(24); // all of them were launched
    expect(sim.sky.stats.meteors).toBe(24); // and all of them landed
    expect(sim.sky.showers).toHaveLength(0);
    expect(sim.sky.meteors).toHaveLength(0);
    expect(peak).toBeLessThanOrEqual(MAX_METEORS);
    expect(peak).toBeGreaterThan(3); // not all at the same instant, but several in the air together
    const pts = [...seen.values()];
    for (const p of pts) expect(Math.hypot(p.x - 80, p.y - 80)).toBeLessThanOrEqual(20.01);
    expect(new Set(pts.map((p) => Math.round(p.x) + ',' + Math.round(p.y))).size).toBeGreaterThan(15); // different spots
    expect(new Set(pts.map((p) => p.angle.toFixed(1))).size).toBeGreaterThan(12); // different trajectories (directions spread around the circle)
  });

  it('really change the world: every meteor digs a crater, hurts creatures, flattens plants and lights fires', () => {
    const w = world();
    const sim = quiet(new Simulation(w));
    sim.spawnInCircle(GRAZER, 80, 80, 12, 30);
    const forest0 = count(w, T.FOREST);
    const craters: Array<[number, number, number]> = [];
    const h0 = Array.from(w.heights);
    sim.launchShower(80, 80, 16, 12, 2);
    let events = 0;
    for (let t = 0; t < 160; t++) {
      sim.step();
      events += sim.sky.drainEvents().filter((e) => e.kind === 'impact').length;
    }
    expect(events).toBe(12); // one visual impact per simulated impact
    let lowered = 0;
    for (let i = 0; i < w.heights.length; i++) if (w.heights[i] < h0[i]) lowered++;
    craters.push([lowered, 0, 0]);
    expect(lowered).toBeGreaterThan(100);
    expect(count(w, T.FOREST)).toBeLessThan(forest0 - 100);
    expect(count(w, T.SOIL)).toBeGreaterThan(100);
    expect(sim.fire.burnedOut + sim.fire.burning).toBeGreaterThan(0);
    expect(sim.creatures.count).toBeLessThan(30);
  });

  it('intensity sets the sizes: stones only, then medium ones, then the odd large one', () => {
    const biggest = (intensity: number) => {
      const sim = quiet(new Simulation(world()));
      sim.launchShower(80, 80, 20, 48, intensity);
      const radii: number[] = [];
      const seen = new Set<number>();
      for (let t = 0; t < 140; t++) {
        sim.step();
        for (const m of sim.sky.meteors) if (!seen.has(m.id)) (seen.add(m.id), radii.push(m.radius));
      }
      return { max: Math.max(...radii), mediumOrMore: radii.filter((r) => r >= 4).length, large: radii.filter((r) => r >= 8).length, n: radii.length };
    };
    const a = biggest(1);
    const b = biggest(2);
    const c = biggest(3);
    expect(a.n).toBe(48);
    expect(a.max).toBeLessThan(4);
    expect(b.mediumOrMore).toBeGreaterThan(5);
    expect(b.large).toBe(0);
    expect(c.large).toBeGreaterThan(0);
    expect(c.mediumOrMore).toBeGreaterThan(b.mediumOrMore);
  });

  it('are bounded: few showers at once, a cap on queued meteors, and never more than the sky allows in flight', () => {
    const sim = quiet(new Simulation(world()));
    let accepted = 0;
    for (let k = 0; k < 10; k++) accepted += sim.launchShower(40 + k * 8, 40, 10, 48, 1);
    expect(sim.sky.showers.length).toBeLessThanOrEqual(MAX_SHOWERS);
    expect(accepted).toBeLessThanOrEqual(MAX_QUEUED_METEORS);
    expect(sim.sky.queued).toBe(accepted);
    let peak = 0;
    for (let t = 0; t < 400; t++) {
      sim.step();
      peak = Math.max(peak, sim.sky.meteors.length);
    }
    expect(peak).toBeLessThanOrEqual(MAX_METEORS);
    expect(sim.sky.stats.meteors).toBe(accepted); // every accepted meteor landed
    expect(sim.sky.showers).toHaveLength(0);
  });

  it('a meteor already launched cannot be cancelled: it lands at its chosen point', () => {
    const sim = quiet(new Simulation(world()));
    sim.launchMeteor(100.5, 60.5, 5, 2);
    const m = sim.sky.meteors[0];
    const target = [m.x, m.y];
    // Even an undo of something else, a world edit or a pause/resume does not remove it.
    const undo = new UndoHistory();
    undo.undo(sim.world);
    sim.speed = 0;
    sim.advance(1);
    expect(sim.sky.meteors).toHaveLength(1);
    sim.speed = 1;
    run(sim, FLIGHT_TICKS + 1);
    expect(sim.sky.meteors).toHaveLength(0);
    expect(sim.sky.stats.meteors).toBe(1);
    expect(sim.world.heights[sim.world.idx(Math.floor(target[0]), Math.floor(target[1]))]).toBeLessThan(SEA_LEVEL + 20);
  });

  it('are saved and continue identically after loading, and survive malformed data', () => {
    const sim = quiet(new Simulation(world()));
    sim.launchShower(80, 80, 18, 30, 2);
    run(sim, 20);
    const data = serialize(sim);
    expect(data.sky?.showers?.length).toBe(1);
    const other = new Simulation(testWorld(8, 8, T.GRASS));
    deserializeInto(other, data);
    expect(other.sky.showers).toEqual(sim.sky.showers);
    run(sim, 150);
    run(other, 150);
    expect(Array.from(other.world.heights)).toEqual(Array.from(sim.world.heights));
    expect(other.sky.stats.meteors).toBe(sim.sky.stats.meteors);
    const bad = serialize(sim);
    bad.sky!.showers = [null, { id: 1, x: Number.NaN, y: 2, spread: 3, intensity: 1, remaining: 5, gap: 1, wait: 0 }, { id: 2, x: 10, y: 10, spread: 9999, intensity: 99, remaining: 9999, gap: -4, wait: 0 }] as never;
    const third = new Simulation(testWorld(8, 8, T.GRASS));
    deserializeInto(third, bad);
    expect(third.sky.showers).toHaveLength(1);
    expect(third.sky.showers[0].remaining).toBeLessThanOrEqual(MAX_QUEUED_METEORS);
    expect(third.sky.showers[0].intensity).toBe(3);
    run(third, 10);
  });
});

describe('natural disasters', () => {
  const fresh = (seed = 3) => {
    const w = testWorld(256, 160, T.FOREST, [], 40);
    const sim = quiet(new Simulation(w));
    sim.rng.state = seed;
    return sim;
  };

  it('do nothing while switched off (the default)', () => {
    const sim = fresh();
    expect(sim.sky.config.auto).toBe(false);
    run(sim, 480 * 3);
    expect(sim.sky.stats.meteors + sim.sky.stats.quakes + sim.sky.stats.wildfires).toBe(0);
  });

  it('strike by themselves when switched on, more often when set to Frequent', () => {
    const events = (frequency: number) => {
      const sim = fresh(7);
      sim.sky.config = { auto: true, frequency, meteors: true, quakes: true, wildfires: true };
      run(sim, 480 * 12);
      const s = sim.sky.stats;
      return s.meteors + s.quakes + s.wildfires;
    };
    const rare = events(0);
    const frequent = events(2);
    expect(rare).toBeGreaterThan(0);
    expect(frequent).toBeGreaterThan(rare * 2);
  });

  it('each kind can be switched off separately', () => {
    const sim = fresh(9);
    sim.sky.config = { auto: true, frequency: 2, meteors: false, quakes: true, wildfires: false };
    run(sim, 480 * 12);
    expect(sim.sky.stats.meteors).toBe(0);
    expect(sim.sky.stats.wildfires).toBe(0);
    expect(sim.sky.stats.quakes).toBeGreaterThan(0);
  });

  it('are deterministic for a given seed', () => {
    const go = () => {
      const sim = fresh(11);
      sim.sky.config = { auto: true, frequency: 2, meteors: true, quakes: true, wildfires: true };
      run(sim, 480 * 4);
      return { terrain: Array.from(sim.world.terrain), heights: Array.from(sim.world.heights), tick: sim.tick, stats: { ...sim.sky.stats } };
    };
    expect(go()).toEqual(go());
  });

  it('wildfires only start on dry ground', () => {
    const w = testWorld(128, 128, T.FOREST, [], 200); // everything wet
    const sim = quiet(new Simulation(w));
    sim.sky.config = { auto: true, frequency: 2, meteors: false, quakes: false, wildfires: true };
    run(sim, 480 * 8);
    expect(sim.sky.stats.wildfires).toBe(0);
  });
});

describe('fire and the wind', () => {
  it('spreads farther downwind than upwind, and uphill than downhill', () => {
    const burnedSides = (wind: number) => {
      let east = 0;
      let west = 0;
      for (let trial = 0; trial < 6; trial++) {
        const w = testWorld(101, 41, T.FOREST, [], 20);
        const weather = new Weather();
        weather.wind = wind;
        const fire = new Fire();
        const rng = new Rng2(trial + 1);
        fire.ignite(w, 50, 20);
        for (let t = 0; t < 30; t++) fire.step(w, rng, weather);
        for (let i = 0; i < w.fire.length; i++) {
          if (!w.fire[i] && w.terrain[i] === T.FOREST) continue;
          const x = i % 101;
          if (x > 50) east++;
          else if (x < 50) west++;
        }
      }
      return { east, west };
    };
    const eastWind = burnedSides(0);
    expect(eastWind.east).toBeGreaterThan(eastWind.west * 1.3);
    const westWind = burnedSides(Math.PI);
    expect(westWind.west).toBeGreaterThan(westWind.east * 1.3);

    const slope = (rise: number) => {
      let total = 0;
      for (let trial = 0; trial < 6; trial++) {
        const w = testWorld(61, 61, T.FOREST, [], 20);
        for (let y = 0; y < 61; y++) for (let x = 0; x < 61; x++) w.heights[w.idx(x, y)] = SEA_LEVEL + 60 + rise * (30 - y) * 2; // north is uphill when rise > 0
        const weather = new Weather();
        weather.wind = Math.PI / 2; // wind along y, cancelled below by symmetric comparison
        weather.wind = 0.0001;
        const fire = new Fire();
        const rng = new Rng2(trial + 100);
        fire.ignite(w, 30, 30);
        for (let t = 0; t < 25; t++) fire.step(w, rng, weather);
        let north = 0;
        let south = 0;
        for (let i = 0; i < w.fire.length; i++) {
          if (!w.fire[i] && w.terrain[i] === T.FOREST) continue;
          const y = Math.floor(i / 61);
          if (y < 30) north++;
          else if (y > 30) south++;
        }
        total += north - south;
      }
      return total;
    };
    expect(slope(1)).toBeGreaterThan(0); // uphill (north) burns more
    expect(slope(-1)).toBeLessThan(0);
  });

  it('burnt land is bare soil and wet ground burns far less than dry ground', () => {
    const burn = (moisture: number) => {
      const w = testWorld(80, 80, T.GRASS, [], moisture);
      const fire = new Fire();
      const weather = new Weather();
      const rng = new Rng2(5);
      fire.ignite(w, 40, 40);
      for (let t = 0; t < 120; t++) fire.step(w, rng, weather);
      return count(w, T.SOIL);
    };
    expect(burn(10)).toBeGreaterThan(burn(200) * 3);
  });
});

describe('creatures and floods', () => {
  it('a land animal washed into a nearby flood scrambles to shore; one far out drowns', () => {
    const w = testWorld(64, 64, T.GRASS);
    const sim = quiet(new Simulation(w));
    sim.creatures.spawn(GRAZER, 32.5, 32.5, sim.rng);
    // A small pond appears under it.
    for (let y = 28; y < 37; y++) for (let x = 28; x < 37; x++) if (Math.hypot(x - 32, y - 32) <= 2.6) w.setTerrain(x, y, T.LAKE);
    run(sim, 60);
    expect(sim.creatures.count).toBe(1);
    expect(w.terrain[w.idx(Math.floor(sim.creatures.x[0]), Math.floor(sim.creatures.y[0]))]).not.toBe(T.LAKE);
    expect(sim.creatures.deathsBy(GRAZER, CAUSE.DROWNED)).toBe(0);

    const deep = quiet(new Simulation(testWorld(96, 96, T.GRASS)));
    deep.creatures.spawn(GRAZER, 48.5, 48.5, deep.rng);
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) if (Math.hypot(x - 48, y - 48) <= 25) deep.world.setTerrain(x, y, T.LAKE);
    run(deep, 5);
    expect(deep.creatures.deathsBy(GRAZER, CAUSE.DROWNED)).toBe(1);
  });

  it('a fish in a shrinking pond swims to the water next to it instead of stranding', () => {
    const w = testWorld(64, 32, T.GRASS, [[0, 0, 20, 32, T.SHALLOW_WATER]]);
    const sim = quiet(new Simulation(w));
    sim.creatures.spawn(FISH, 17.5, 16.5, sim.rng);
    for (let y = 0; y < 32; y++) for (let x = 15; x < 20; x++) w.setTerrain(x, y, T.GRASS); // shore moves west
    run(sim, 50);
    expect(sim.creatures.count).toBe(1);
    expect(w.terrain[w.idx(Math.floor(sim.creatures.x[0]), Math.floor(sim.creatures.y[0]))]).toBe(T.SHALLOW_WATER);
  });
});

describe('saving the sky', () => {
  it('round-trips storms, snow, ids, drift, meteors in flight and disaster settings', () => {
    const w = testWorld(96, 96, T.GRASS);
    const sim = quiet(new Simulation(w));
    sim.summonWeather(WEATHER_KIND.RAIN, 30, 30, 15, 3, { storm: true });
    sim.summonWeather(WEATHER_KIND.RAIN, 60, 60, 15, 2, { snow: true });
    sim.sky.config = { auto: true, frequency: 2, meteors: false, quakes: true, wildfires: false };
    sim.launchMeteor(50.5, 20.5, 5, 2);
    run(sim, 8);
    const data = serialize(sim);
    expect(data.version).toBe(SAVE_VERSION);
    const other = new Simulation(testWorld(8, 8, T.GRASS));
    deserializeInto(other, data);
    expect(other.weather.systems.map((s) => ({ id: s.id, storm: s.storm, snow: s.snow, forceSnow: s.forceSnow }))).toEqual(
      sim.weather.systems.map((s) => ({ id: s.id, storm: s.storm, snow: s.snow, forceSnow: s.forceSnow })),
    );
    expect(other.sky.config).toEqual(sim.sky.config);
    expect(other.sky.meteors).toEqual(sim.sky.meteors);
    expect(other.weather.drift).toEqual(sim.weather.drift);
    // And both continue identically, including the landing.
    run(sim, 40);
    run(other, 40);
    expect(Array.from(other.world.heights)).toEqual(Array.from(sim.world.heights));
    expect(other.sky.stats.meteors).toBe(sim.sky.stats.meteors);
  });

  it('loads an older save without a sky block and gives weather systems ids', () => {
    const sim = quiet(new Simulation(testWorld(64, 64, T.GRASS)));
    sim.summonWeather(WEATHER_KIND.RAIN, 30, 30, 15, 2);
    sim.summonWeather(WEATHER_KIND.DROUGHT, 10, 10, 8, 2);
    const data = serialize(sim);
    delete data.sky;
    data.version = 5;
    for (const s of data.v4!.weather.systems) {
      const o = s as unknown as Record<string, unknown>;
      delete o.id;
      delete o.storm;
      delete o.snow;
      delete o.forceSnow;
    }
    const other = new Simulation(testWorld(8, 8, T.GRASS));
    deserializeInto(other, data);
    const ids = other.weather.systems.map((s) => s.id);
    expect(new Set(ids).size).toBe(2);
    expect(other.weather.systems.every((s) => s.storm === false && s.snow === false)).toBe(true);
    other.summonWeather(WEATHER_KIND.RAIN, 5, 5, 5, 1);
    expect(new Set(other.weather.systems.map((s) => s.id)).size).toBe(3);
    run(other, 20);
  });

  it('ignores malformed sky data instead of failing or crashing', () => {
    const sim = quiet(new Simulation(testWorld(64, 64, T.GRASS)));
    const data = serialize(sim);
    data.sky = {
      config: { auto: 'yes', frequency: 99, meteors: null, quakes: 0, wildfires: undefined },
      meteors: [{ id: 1, x: Number.NaN, y: 3, radius: 2, intensity: 1, ttl: 5, total: 5, angle: 0, natural: false }, null, { id: 2, x: 9999, y: 3, radius: 2, intensity: 1, ttl: 5, total: 5, angle: 0, natural: false }, { id: 3, x: 10, y: 10, radius: 4, intensity: 2, ttl: 7, total: 20, angle: 1, natural: true }],
      nextMeteorId: 'x',
      weatherNextId: -4,
      drift: { x: 'a', y: 1 },
    } as unknown as NonNullable<typeof data.sky>;
    data.v4!.weather.systems = [{ kind: 9, x: 1 }, null, { kind: 0, x: 5, y: 5, radius: 4, intensity: 7, ttl: 100, manual: false }] as never;
    const other = new Simulation(testWorld(8, 8, T.GRASS));
    deserializeInto(other, data);
    expect(other.sky.meteors.map((m) => m.id)).toEqual([3]);
    expect(other.sky.config.frequency).toBe(2);
    expect(other.weather.systems).toHaveLength(1);
    expect(other.weather.systems[0].intensity).toBe(1);
    run(other, 50);
  });
});

/** Minimal seeded generator with the Rng interface Fire needs. */
import { Rng } from '../src/core/rng';
class Rng2 extends Rng {
  constructor(seed: number) {
    super(seed);
  }
}
