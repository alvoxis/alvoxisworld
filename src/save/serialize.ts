import { CAUSE, Creatures, MAX_CREATURES, PATH_MAX, SPECIES, STATE } from '../sim/creatures';
import { Simulation, type HistoryEntry } from '../sim/simulation';
import { World } from '../world/world';

/**
 * Save versions: 1 = Milestone 1 (energy only), 2 = creature ids/needs/states,
 * 3 = adds routes and remaining behaviour fields so a loaded world continues exactly.
 */
export const SAVE_VERSION = 3;

/** Creature fields stored in a save (one typed array per field, length = count). */
export interface CreatureSave {
  count: number;
  nextId: number;
  id: Uint32Array;
  species: Uint8Array;
  x: Float32Array;
  y: Float32Array;
  dx: Float32Array;
  dy: Float32Array;
  health: Float32Array;
  hunger: Float32Array;
  thirst: Float32Array;
  age: Float32Array;
  state: Uint8Array;
  tx: Float32Array;
  ty: Float32Array;
  targetId: Uint32Array;
  timer: Uint16Array;
  breedTimer: Uint16Array;
  /** Version 3 additions (absent in version 2 saves). */
  searchCd?: Uint8Array;
  harm?: Uint8Array;
  pathLen?: Uint8Array;
  pathPos?: Uint8Array;
  pathGoal?: Int32Array;
  huntTicks?: Uint16Array;
  ignoreId?: Uint32Array;
  /** count × PATH_MAX waypoint tile indices. */
  path?: Int32Array;
  births: number;
  deaths: number;
  deathStats: Uint32Array;
  birthStats: Uint32Array;
}

/** Version 1 creature block (Milestone 1: grazers and raptors with energy only). */
interface CreatureSaveV1 {
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
}

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
  creatures: CreatureSave | CreatureSaveV1;
  history: HistoryEntry[];
}

const COPIED = [
  'id', 'species', 'x', 'y', 'dx', 'dy', 'health', 'hunger', 'thirst', 'age', 'state', 'tx', 'ty', 'targetId',
  'timer', 'breedTimer',
] as const;
/** Fields added in version 3; missing ones (version 2 saves) get neutral defaults. */
const COPIED_V3 = ['searchCd', 'harm', 'pathLen', 'pathPos', 'pathGoal', 'huntTicks', 'ignoreId'] as const;

export function serialize(sim: Simulation): SaveData {
  const w = sim.world;
  const c = sim.creatures;
  const n = c.count;
  const creatures = {
    count: n,
    nextId: c.nextId,
    births: c.births,
    deaths: c.deaths,
    deathStats: c.deathStats.slice(),
    birthStats: c.birthStats.slice(),
  } as CreatureSave;
  for (const k of [...COPIED, ...COPIED_V3]) (creatures as unknown as Record<string, unknown>)[k] = c[k].slice(0, n);
  creatures.path = c.path.slice(0, n * PATH_MAX);
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
    creatures,
    history: sim.history.map((h) => ({ ...h })),
  };
}

/** Versions 2 and 3 (version 2 lacks the COPIED_V3 fields and routes). */
function loadCreatures(c: Creatures, src: CreatureSave): void {
  const count = Math.min(src.count, MAX_CREATURES);
  for (const k of COPIED) {
    const arr = src[k];
    if (!arr || arr.length < count) throw new Error(`Corrupt save: creature field ${k}`);
    (c[k] as Uint8Array).set(arr.subarray(0, count) as unknown as ArrayLike<number>);
  }
  c.px.set(c.x.subarray(0, count));
  c.py.set(c.y.subarray(0, count));
  for (const k of COPIED_V3) {
    const arr = src[k];
    if (arr && arr.length >= count) (c[k] as Uint8Array).set(arr.subarray(0, count) as unknown as ArrayLike<number>);
    else (c[k] as Uint8Array).fill(k === 'pathGoal' ? -1 : 0, 0, count);
  }
  if (src.path && src.path.length >= count * PATH_MAX) c.path.set(src.path.subarray(0, count * PATH_MAX));
  else c.pathLen.fill(0, 0, count);
  c.count = count;
  c.nextId = src.nextId;
  c.births = src.births;
  c.deaths = src.deaths;
  if (src.deathStats?.length === c.deathStats.length) c.deathStats.set(src.deathStats);
  if (src.birthStats?.length === c.birthStats.length) c.birthStats.set(src.birthStats);
}

/** Milestone 1 saves: energy becomes hunger, everyone gets full health and a fresh id. */
function loadCreaturesV1(c: Creatures, src: CreatureSaveV1): void {
  const count = Math.min(src.count, MAX_CREATURES);
  for (let i = 0; i < count; i++) {
    const sp = SPECIES[src.species[i]] ?? SPECIES[0];
    c.id[i] = i + 1;
    c.species[i] = sp.id;
    c.x[i] = c.px[i] = src.x[i];
    c.y[i] = c.py[i] = src.y[i];
    c.dx[i] = src.dx[i];
    c.dy[i] = src.dy[i];
    c.health[i] = sp.maxHealth;
    c.hunger[i] = Math.max(0, Math.min(100, 100 - src.energy[i]));
    c.thirst[i] = sp.thirstRate > 0 ? 20 : 0;
    c.age[i] = src.age[i];
    c.state[i] = STATE.WANDER;
    c.targetId[i] = 0;
    c.timer[i] = 0;
    c.breedTimer[i] = 0;
    c.harm[i] = CAUSE.NONE;
    c.searchCd[i] = 0;
    c.pathLen[i] = c.pathPos[i] = 0;
    c.pathGoal[i] = -1;
    c.huntTicks[i] = 0;
    c.ignoreId[i] = 0;
  }
  c.count = count;
  c.nextId = count + 1;
  c.births = src.births;
  c.deaths = src.deaths;
}

/** Validates a snapshot and loads it into the simulation, replacing the current world. */
export function deserializeInto(sim: Simulation, data: SaveData): World {
  if (!data || ![1, 2, SAVE_VERSION].includes(data.version)) throw new Error('Unsupported save version');
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
  if (data.version === 1) loadCreaturesV1(sim.creatures, data.creatures as CreatureSaveV1);
  else loadCreatures(sim.creatures, data.creatures as CreatureSave);
  sim.creatures.reindex();
  sim.history = data.history.map((h) => ({ ...h }));
  return world;
}
