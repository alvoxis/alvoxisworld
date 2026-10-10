import { Creatures, MAX_CREATURES } from '../sim/creatures';
import { Simulation, type HistoryEntry } from '../sim/simulation';
import { World } from '../world/world';

export const SAVE_VERSION = 1;

/** Plain, structured-clone-friendly snapshot of a running world. */
export interface SaveData {
  version: number;
  savedAt: string;
  width: number;
  height: number;
  seed: number;
  tick: number;
  rngState: number;
  heights: Uint8Array;
  terrain: Uint8Array;
  temperature: Uint8Array;
  moisture: Uint8Array;
  creatures: {
    count: number;
    x: Float32Array;
    y: Float32Array;
    dx: Float32Array;
    dy: Float32Array;
    species: Uint8Array;
    energy: Float32Array;
    age: Float32Array;
    births: number;
    deaths: number;
  };
  history: HistoryEntry[];
}

export function serialize(sim: Simulation): SaveData {
  const w = sim.world;
  const c = sim.creatures;
  const n = c.count;
  return {
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    width: w.width,
    height: w.height,
    seed: w.seed,
    tick: sim.tick,
    rngState: sim.rng.state,
    heights: w.heights.slice(),
    terrain: w.terrain.slice(),
    temperature: w.temperature.slice(),
    moisture: w.moisture.slice(),
    creatures: {
      count: n,
      x: c.x.slice(0, n),
      y: c.y.slice(0, n),
      dx: c.dx.slice(0, n),
      dy: c.dy.slice(0, n),
      species: c.species.slice(0, n),
      energy: c.energy.slice(0, n),
      age: c.age.slice(0, n),
      births: c.births,
      deaths: c.deaths,
    },
    history: sim.history.map((h) => ({ ...h })),
  };
}

/** Validates a snapshot and loads it into the simulation, replacing the current world. */
export function deserializeInto(sim: Simulation, data: SaveData): World {
  if (!data || data.version !== SAVE_VERSION) throw new Error('Unsupported save version');
  const n = data.width * data.height;
  for (const arr of [data.heights, data.terrain, data.temperature, data.moisture]) {
    if (!(arr instanceof Uint8Array) || arr.length !== n) throw new Error('Corrupt save: map size mismatch');
  }
  const world = new World(data.width, data.height, data.seed);
  world.heights.set(data.heights);
  world.terrain.set(data.terrain);
  world.temperature.set(data.temperature);
  world.moisture.set(data.moisture);
  world.markAllDirty();

  sim.reset(world, data.tick, data.rngState);
  const src = data.creatures;
  const c: Creatures = sim.creatures;
  const count = Math.min(src.count, MAX_CREATURES);
  c.x.set(src.x.subarray(0, count));
  c.y.set(src.y.subarray(0, count));
  c.dx.set(src.dx.subarray(0, count));
  c.dy.set(src.dy.subarray(0, count));
  c.species.set(src.species.subarray(0, count));
  c.energy.set(src.energy.subarray(0, count));
  c.age.set(src.age.subarray(0, count));
  c.count = count;
  c.births = src.births;
  c.deaths = src.deaths;
  sim.history = data.history.map((h) => ({ ...h }));
  return world;
}
