/**
 * Human settlement economy: resources, buildings, population limits, stages and technologies.
 *
 * Everything here works on the real simulation: the stock is real numbers kept per settlement, food
 * really lowers the hunger of its people, housing really stops births when it is full, the lumber camp
 * really thins the forest, buildings really burn or drown, and nothing is produced without a source
 * (farm soil, forest, hills, people). No random numbers are used.
 *
 * Time unit: one *step* is STEP_TICKS ticks (2 s at 1×). A game year is 24 steps.
 *
 * Work (0.15): farms, lumber camps, quarries and building sites produce only through workers. Every step
 * adult residents get jobs (`assignJobs`); a worker walks to the building with the creatures' own
 * pathfinding (`Creatures.workGoal`) and, standing there in the WORK state, adds a share of the building's
 * yield (or of the construction work). Foraging and knowledge stay settlement-wide: they come from all
 * people and their land and are not tied to a building.
 */
import { treesOn } from '../world/trees';
import { WOOD_PER_TREE, fellable, woodOf } from './forestry';
import { hash2 } from '../core/rng';
import { T, isWater } from '../world/terrain';
import type { World } from '../world/world';
import type { Creatures } from './creatures';
import { SPECIES, STATE } from './creatures';
import { landClass, passable } from './pathfinding';
import type { Settlement } from './settlements';
import { chooseNextTech, RACE_BIAS, TECH_BY_ID } from './progress';

export type BuildingType = 'house' | 'storehouse' | 'farm' | 'lumber' | 'quarry' | 'shipyard' | 'bridge' | 'market' | 'temple' | 'workshop' | 'tower' | 'mill';
export const BUILDING_TYPES: readonly BuildingType[] = ['house', 'farm', 'lumber', 'quarry', 'storehouse', 'shipyard', 'bridge', 'market', 'temple', 'workshop', 'tower', 'mill'];
export type TechId = 'farming' | 'construction' | 'harvesting';
export const TECH_IDS: readonly TechId[] = ['farming', 'construction', 'harvesting'];
export type Stage = 'camp' | 'village' | 'town';
export const STAGES: readonly Stage[] = ['camp', 'village', 'town'];

export interface BuildingDef {
  wood: number;
  stone: number;
  /** Steps of work to finish. */
  steps: number;
}
export const BUILDINGS: Readonly<Record<BuildingType, BuildingDef>> = {
  house: { wood: 10, stone: 0, steps: 6 },
  storehouse: { wood: 20, stone: 10, steps: 8 },
  farm: { wood: 8, stone: 0, steps: 5 },
  lumber: { wood: 8, stone: 0, steps: 5 },
  quarry: { wood: 12, stone: 0, steps: 7 },
  /** A dock and slipway on the sea shore. A foundation: ships and sailing are not simulated yet. */
  shipyard: { wood: 24, stone: 6, steps: 9 },
  bridge: { wood: 16, stone: 8, steps: 7 },
  market: { wood: 18, stone: 4, steps: 6 },
  temple: { wood: 12, stone: 16, steps: 10 },
  workshop: { wood: 14, stone: 6, steps: 7 },
  tower: { wood: 8, stone: 18, steps: 9 },
  mill: { wood: 10, stone: 4, steps: 5 },
};

export interface TechDef {
  /** Knowledge spent when research starts. */
  knowledge: number;
  /** Steps the research takes. */
  steps: number;
  /** At least one finished building of any of these types is needed. */
  needs: readonly BuildingType[];
}
export const TECHS: Readonly<Record<TechId, TechDef>> = {
  farming: { knowledge: 30, steps: 12, needs: ['farm'] },
  construction: { knowledge: 40, steps: 12, needs: ['house'] },
  harvesting: { knowledge: 50, steps: 12, needs: ['lumber', 'quarry'] },
};

export const BASE_CAPACITY = 10;
export const HOUSE_CAPACITY = 5;
export const BASE_STORAGE = 60;
export const STOREHOUSE_BONUS = 120;
export const KNOWLEDGE_CAP = 500;
export const START_KIT = { food: 20, wood: 20, stone: 0 } as const;
/** Slots for buildings (finished or under construction) by stage. */
export const SLOTS: Readonly<Record<Stage, number>> = { camp: 4, village: 10, town: 24 };
export const RADIUS_BONUS: Readonly<Record<Stage, number>> = { camp: 0, village: 2, town: 4 };
export const MAX_CONSTRUCTIONS = 2;
export const MAX_BUILDINGS = 40;

/** A person eats from the stock when this hungry, and each meal lowers hunger by FEED_AMOUNT. */
export const FEED_HUNGER = 40;
export const FEED_AMOUNT = 30;
export const FORAGE_PER_PERSON = 0.06;
export const FORAGE_PER_TILE = 0.02;
export const FARM_YIELD = 1.0;
export const LUMBER_YIELD = 1.0;
export const QUARRY_YIELD = 0.7;
export const KNOWLEDGE_PER_ADULT = 0.05;
export { WOOD_PER_TREE };
export const STONE_PER_TILE = 60;
export const STONE_RESERVE_CAP = 1500;
export const LUMBER_RADIUS = 6;
export const QUARRY_RADIUS = 5;
export const FARM_TERRAIN: readonly number[] = [T.GRASS, T.SAVANNA, T.SOIL];
export const FOREST_TERRAIN: readonly number[] = [T.FOREST, T.JUNGLE];
export const STONE_TERRAIN: readonly number[] = [T.HILLS, T.MOUNTAIN];
export const OPEN_SEA: readonly number[] = [T.SHALLOW_WATER, T.DEEP_WATER];

/** Workers a finished building can use; the full yield needs all of them. */
export const WORK_SLOTS: Readonly<Record<BuildingType, number>> = { house: 0, storehouse: 0, farm: 2, lumber: 2, quarry: 2, shipyard: 0, bridge: 0, market: 1, temple: 1, workshop: 2, tower: 1, mill: 1 };
/** A shipyard stands on a shore tile next to open sea with at least this many sea tiles within SHIPYARD_REACH. */
export const SHIPYARD_SEA = 10;
export const SHIPYARD_REACH = 3;
/** Builders a site can use, and construction steps done per builder per step. */
export const BUILDERS = 3;
export const BUILD_PER_WORKER = 0.5;
/** A worker counts as at work within this many tiles of the building. */
export const WORK_RANGE = 3;
/** A worker that gets no closer for this many steps gives the job up, and does not take that building again for SKIP_TICKS. */
export const STUCK_STEPS = 15;
export const SKIP_TICKS = 600;
/** Least time in a job before a worker may be moved to a more urgent one. */
export const MIN_JOB_TICKS = 200;
/** A farm that produced nothing for this many steps has stopped. */
export const FARM_IDLE_STEPS = 15;
/** An exhausted lumber camp looks for regrown forest every this many steps. */
export const RECHECK_STEPS = 10;

export type JobKind = 'build' | 'farm' | 'wood' | 'stone';
export interface Job {
  /** Creature id of the worker. */
  id: number;
  /** Building id. */
  b: number;
  /** Tick the job was given. */
  since: number;
  /** Closest distance to the workplace so far, and steps without getting closer. */
  best: number;
  stuck: number;
  /**
   * Felling (0.23; lumber camps and clearing): the tree tile being cut (-1 = none yet), the tile the worker stands on
   * beside it, and the work put into it so far (in wood units; the tree falls when it reaches the tree's wood).
   */
  t: number;
  at: number;
  chop: number;
}

/** Job "building" id of clearing work: no building, the settlement's clearing list (Civ.clear). */
export const CLEAR_JOB = -1;
/** People clearing ground at once (founders all help: nothing else can be done before the centre is clear). */
export const CLEARERS = 4;
/** Clearing is quick work (the timber is not cut up carefully): it goes this much faster than a lumberjack's felling. */
export const CLEAR_SPEED = 3;
/** Work (wood units) one worker puts into felling per step (a tree of 10 wood takes 10 steps of work; walking to it, drinking and eating come on top, so two lumberjacks cut a little less than a camp did before 0.23). */
export const CHOP_PER_WORKER = 1;
/** Work needed to clear a gap in the woods (undergrowth, no timber). */
export const CLEAR_WORK = 2;
/** A worker chops when standing within this distance (tiles) of the tile beside the tree. */
export const CHOP_RANGE = 1.2;
/** Most tiles waiting to be cleared at once. */
export const MAX_CLEAR = 48;

/** Stage requirements: people, finished buildings, and what must exist. */
export const STAGE_REQ = {
  village: { people: 12, buildings: 3 },
  town: { people: 30, buildings: 8, techs: 2 },
} as const;

export interface Building {
  id: number;
  type: BuildingType;
  x: number;
  y: number;
  /** Tick when work started. */
  started: number;
  /** Steps of work done; the building is finished at BUILDINGS[type].steps (or fewer with construction). */
  progress: number;
  /** Steps of work needed (fixed when it was started). */
  needed: number;
  done: boolean;
  /** Quarry: stone left. Lumber camp: wood still on the tree being cut. */
  reserve: number;
  acc: number;
  /** Producing (farm), and steps without work. */
  active: boolean;
  idle: number;
  /** Nothing left to take (no forest in reach, quarry empty). */
  empty: boolean;
  /** Workers that were at work here in the last step. */
  here: number;
  /** House level (1 hut … 4 urban house; 1 for other buildings). */
  level: number;
  /** Level a finished house is being upgraded to (0 = no upgrade); the work uses `progress` / `needed`. */
  up: number;
}

export interface Civ {
  food: number;
  wood: number;
  stone: number;
  knowledge: number;
  stage: Stage;
  buildings: Building[];
  techs: TechId[];
  /** Advanced technologies from the AI progress tree (optional, for saves). */
  advanced: string[];
  research: { id: TechId; steps: number } | null;
  /** Current advanced research. */
  advancedResearch: { id: string; steps: number } | null;
  nextBuildingId: number;
  /** Food ran out and nobody has been told yet (reset when food is back). */
  famine: boolean;
  /** Rates of the last step (derived; shown as per-year numbers). */
  rate: { food: number; foodUse: number; wood: number; stone: number; knowledge: number };
  /** Jobs of the residents (one per worker). */
  jobs: Job[];
  /** Workers that could not reach a building: [creature id, building id, tick until]. */
  skip: Array<[number, number, number]>;
  /**
   * Ground to clear before building (0.23): tiles with trees (or woodland) in the settlement's centre when it was
   * founded, and around the sites of buildings started among trees. Cleared by felling, one tile at a time.
   */
  clear: number[];
  /** Road tiles (0.23, see sim/roads.ts): built step by step between the centre and the buildings. */
  roads: number[];
  /** Wood felled per step, averaged over recent steps (0.23; trees fall one at a time, so `rate.wood` comes in lumps). */
  woodFlow: number;
}

export function newCiv(): Civ {
  return {
    food: START_KIT.food, wood: START_KIT.wood, stone: START_KIT.stone, knowledge: 0, stage: 'camp', buildings: [], techs: [], advanced: [],
    research: null, advancedResearch: null, nextBuildingId: 1, famine: false, rate: { food: 0, foodUse: 0, wood: 0, stone: 0, knowledge: 0 },
    jobs: [], skip: [], clear: [], roads: [], woodFlow: 0,
  };
}

const done = (c: Civ, type: BuildingType) => c.buildings.filter((b) => b.done && b.type === type);

// ---- house levels (0.16) ----------------------------------------------------------

export interface HouseLevelDef {
  /** People the house holds. */
  capacity: number;
  /** Cost and steps of work to upgrade *to* this level (level 1 is built as a normal house). */
  wood: number;
  stone: number;
  steps: number;
}
/** Index = level: 1 hut, 2 wooden house, 3 reinforced house, 4 urban house. Level 1 holds HOUSE_CAPACITY, as before. */
export const HOUSE_LEVELS: readonly HouseLevelDef[] = [
  { capacity: 0, wood: 0, stone: 0, steps: 0 },
  { capacity: HOUSE_CAPACITY, wood: 0, stone: 0, steps: 0 },
  { capacity: 8, wood: 12, stone: 0, steps: 6 },
  { capacity: 12, wood: 12, stone: 12, steps: 8 },
  { capacity: 18, wood: 16, stone: 24, steps: 10 },
];
export const MAX_HOUSE_LEVEL = HOUSE_LEVELS.length - 1;
/** Upgrades the settlement starts by itself: one at a time, only while housing is nearly full, and only above these reserves. */
export const AUTO_UPGRADE_FOOD = 15;
export const AUTO_UPGRADE_WOOD_LEFT = 10;

/** Highest house level the settlement's stage and technologies allow now (camp 1; village 2, with Better building 3; town 4 with Better building). */
export function maxHouseLevel(c: Civ): number {
  if (c.stage === 'camp') return 1;
  if (!hasTech(c, 'construction')) return 2;
  return c.stage === 'town' ? 4 : 3;
}
export function houseCapacity(b: Building): number {
  return HOUSE_LEVELS[Math.max(1, Math.min(MAX_HOUSE_LEVEL, b.level))].capacity;
}
export function upgradeCost(c: Civ, level: number): { wood: number; stone: number } {
  const k = hasTech(c, 'construction') ? 0.75 : 1;
  const d = HOUSE_LEVELS[level];
  return { wood: Math.ceil(d.wood * k), stone: Math.ceil(d.stone * k) };
}
export function upgradeSteps(c: Civ, level: number): number {
  return Math.max(1, Math.ceil(HOUSE_LEVELS[level].steps * (hasTech(c, 'construction') ? 0.7 : 1)));
}
/** The house to upgrade next: a finished house below the allowed level, lowest level first, then the oldest. */
export function upgradeTarget(c: Civ): Building | null {
  const max = maxHouseLevel(c);
  let best: Building | null = null;
  for (const b of c.buildings) {
    if (b.type !== 'house' || !b.done || b.up || b.level >= max) continue;
    if (!best || b.level < best.level || (b.level === best.level && b.id < best.id)) best = b;
  }
  return best;
}
export type UpgradeFail = 'none' | 'level' | 'busy' | 'resources';
/** Why no house can be upgraded now (null = one can). */
export function upgradeBlock(c: Civ): UpgradeFail | null {
  if (!c.buildings.some((b) => b.type === 'house' && b.done)) return 'none';
  const b = upgradeTarget(c);
  if (!b) return 'level';
  if (constructions(c) >= MAX_CONSTRUCTIONS) return 'busy';
  const cost = upgradeCost(c, b.level + 1);
  if (c.wood < cost.wood || c.stone < cost.stone) return 'resources';
  return null;
}
/** Starts upgrading the next house in place: pays once, then builders do the work (the house keeps its people and capacity meanwhile). */
export function startUpgrade(c: Civ): Building | UpgradeFail {
  const block = upgradeBlock(c);
  if (block) return block;
  const b = upgradeTarget(c)!;
  const to = b.level + 1;
  const cost = upgradeCost(c, to);
  c.wood -= cost.wood;
  c.stone -= cost.stone;
  b.up = to;
  b.progress = 0;
  b.needed = upgradeSteps(c, to);
  return b;
}

export function housing(c: Civ): number {
  let n = BASE_CAPACITY;
  for (const b of c.buildings) if (b.done && b.type === 'house') n += houseCapacity(b);
  return n;
}
export function storage(c: Civ): number {
  return BASE_STORAGE + STOREHOUSE_BONUS * done(c, 'storehouse').length;
}
export function hasTech(c: Civ, id: TechId): boolean {
  return c.techs.includes(id);
}
export function costOf(c: Civ, type: BuildingType): { wood: number; stone: number } {
  const k = hasTech(c, 'construction') ? 0.75 : 1;
  return { wood: Math.ceil(BUILDINGS[type].wood * k), stone: Math.ceil(BUILDINGS[type].stone * k) };
}
export function stepsOf(c: Civ, type: BuildingType): number {
  return Math.max(1, Math.ceil(BUILDINGS[type].steps * (hasTech(c, 'construction') ? 0.7 : 1)));
}
/** Building sites and house upgrades under way (both take builders and count against MAX_CONSTRUCTIONS). */
export function constructions(c: Civ): number {
  return c.buildings.filter((b) => !b.done || b.up > 0).length;
}
export function finished(c: Civ): number {
  return c.buildings.filter((b) => b.done).length;
}
export function techNeedsMet(c: Civ, id: TechId): boolean {
  return TECHS[id].needs.some((t) => done(c, t).length > 0);
}

export type BuildFail = 'resources' | 'site' | 'slots' | 'busy' | 'clearing';

/**
 * The same count as countNear for many tiles of a box at once (0.23: site search asks it for every tile of a
 * territory): per-row prefix sums over the box, so each count costs one lookup per row of the circle.
 */
function nearCounter(world: World, terrains: readonly number[], r: number, x0: number, y0: number, x1: number, y1: number): (x: number, y: number) => number {
  const W = world.width;
  const H = world.height;
  const bx0 = Math.max(0, x0 - r);
  const by0 = Math.max(0, y0 - r);
  const bx1 = Math.min(W - 1, x1 + r);
  const by1 = Math.min(H - 1, y1 + r);
  const bw = bx1 - bx0 + 1;
  const bh = by1 - by0 + 1;
  const pre = new Int32Array(Math.max(0, bh) * (bw + 1));
  const want = new Uint8Array(256);
  for (const t of terrains) want[t] = 1;
  for (let y = 0; y < bh; y++) {
    let acc = 0;
    const row = y * (bw + 1);
    for (let x = 0; x < bw; x++) {
      acc += want[world.terrain[(by0 + y) * W + bx0 + x]];
      pre[row + x + 1] = acc;
    }
  }
  // Half-width of the circle's row at each dy: dx² + dy² <= r², exactly the tiles countNear counts.
  const half = Array.from({ length: 2 * r + 1 }, (_, k) => Math.floor(Math.sqrt(r * r - (k - r) * (k - r))));
  return (x, y) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return countNear(world, x, y, r, terrains); // outside the box: count directly
    let n = 0;
    for (let dy = -r; dy <= r; dy++) {
      const yy = y + dy;
      if (yy < by0 || yy > by1) continue;
      const h = half[dy + r];
      const a = Math.max(bx0, x - h);
      const b = Math.min(bx1, x + h);
      if (a > b) continue;
      const row = (yy - by0) * (bw + 1);
      n += pre[row + b - bx0 + 1] - pre[row + a - bx0];
    }
    return n;
  };
}

function countNear(world: World, x: number, y: number, r: number, terrains: readonly number[]): number {
  let n = 0;
  for (let yy = Math.max(0, y - r); yy <= Math.min(world.height - 1, y + r); yy++) {
    for (let xx = Math.max(0, x - r); xx <= Math.min(world.width - 1, x + r); xx++) {
      if (Math.hypot(xx - x, yy - y) <= r && terrains.includes(world.terrain[yy * world.width + xx])) n++;
    }
  }
  return n;
}

/**
 * Best free tile in the territory for a building of this type (deterministic), or -1.
 *
 * Layout (0.18): the tile at the centre and its neighbours stay open (the settlement marker, a gathering place);
 * houses form a loose ring around it that widens as there are more of them; a storehouse stands near the centre;
 * fields lie further out on moist farmland and may touch each other; lumber camps and quarries stand by their
 * forest or rock. Buildings avoid touching other buildings (sides more than corners), and a small fixed variation
 * per tile (from the settlement id, no random generator) keeps settlements from all looking the same.
 * Hard rules are unchanged: own territory, dry gentle passable ground, no fire, a free tile.
 */
export function findSite(world: World, s: Settlement, owner: Uint16Array, type: BuildingType, allowTrees = false): number {
  return searchSite(world, s, owner, type, allowTrees);
}

function searchSite(world: World, s: Settlement, owner: Uint16Array, type: BuildingType, allowTrees: boolean): number {
  const c = s.civ!;
  // Counters of forest, rock or sea around each candidate (the territory lies within the radius of the centre).
  const R = s.radius + 2;
  const counter = (terrains: readonly number[], r: number) => nearCounter(world, terrains, r, s.x - R, s.y - R, s.x + R, s.y + R);
  const forestNear = type === 'lumber' ? counter(FOREST_TERRAIN, LUMBER_RADIUS) : null;
  const rockNear = type === 'quarry' ? counter(STONE_TERRAIN, QUARRY_RADIUS) : null;
  const seaNear = type === 'shipyard' ? counter(OPEN_SEA, SHIPYARD_REACH) : null;
  const W = world.width;
  const at = new Map(c.buildings.map((b) => [b.y * W + b.x, b.type] as const));
  const cls = landClass(SPECIES[s.species].move); // on dry land
  const houses = c.buildings.filter((b) => b.type === 'house').length;
  const farms = c.buildings.filter((b) => b.type === 'farm').length;
  let best = -1;
  let bestScore = -Infinity;
  for (const i of s.tiles) {
    if (owner[i] !== s.id || at.has(i)) continue;
    const x = i % W;
    const y = (i - x) / W;
    const t = world.terrain[i];
    if (type !== 'bridge' && (isWater(t) || world.slopeClass[i] !== 0 || world.fire[i] > 0 || !passable(world, cls, x, y))) continue;
    if (type === 'bridge' && !isWater(t)) continue;
    const d = Math.hypot(x - s.x, y - s.y);
    if (Math.max(Math.abs(x - s.x), Math.abs(y - s.y)) <= CENTRE_FREE) continue; // the centre stays open (landmark)
    if (!siteClear(world, at, x, y, type, allowTrees)) continue;
    // Crowding: buildings on the sides weigh more than on the corners; houses next to fields count extra for fields.
    let side = 0;
    let corner = 0;
    let houseNear = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const k = at.get(i + dy * W + dx);
        if (!k || x + dx < 0 || x + dx >= W) continue;
        if (dx && dy) corner++;
        else side++;
        if (k === 'house') houseNear++;
      }
    }
    const crowd = side + 0.4 * corner;
    const vary = hash2(x, y, s.id * 7919 + 17);
    let score: number;
    if (type === 'farm') {
      if (!FARM_TERRAIN.includes(t) || world.moisture[i] < 40) continue;
      score = -Math.abs(d - (5 + 1.2 * farms)) - 1.5 * houseNear + world.moisture[i] / 100 + 0.5 * vary;
    } else if (type === 'lumber') {
      if (FOREST_TERRAIN.includes(t)) continue; // stands next to the forest, not in it
      const trees = forestNear!(x, y);
      if (trees < 6) continue;
      score = trees * 10 - d - 2 * crowd + vary;
    } else if (type === 'quarry') {
      if (STONE_TERRAIN.includes(t) && t === T.MOUNTAIN) continue;
      const rock = rockNear!(x, y);
      if (rock < 3) continue;
      score = rock * 10 - d - 2 * crowd + vary;
    } else if (type === 'bridge') {
      // Small water body: few water tiles around, not open sea
      let waterCount = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= world.height) continue;
          if (isWater(world.terrain[ny * W + nx])) waterCount++;
        }
      }
      if (waterCount < 3 || waterCount > 12) continue; // too small or too large
      score = 20 - Math.abs(waterCount - 6) - d + vary;
    } else if (type === 'shipyard') {
      // On the shore of open, navigable sea (not a lake or river): a sea tile on a side, enough sea around.
      let side = false;
      for (const n of [i - W, i + W, x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1]) if (n >= 0 && n < world.terrain.length && OPEN_SEA.includes(world.terrain[n])) side = true;
      if (!side) continue;
      const sea = seaNear!(x, y);
      if (sea < SHIPYARD_SEA) continue;
      score = sea - d - 2 * crowd + vary;
    } else if (type === 'storehouse') {
      score = -Math.abs(d - 3.5) - 2 * crowd + vary;
    } else {
      score = -1.2 * Math.abs(d - (3.5 + 1.1 * Math.sqrt(houses))) - 2.5 * crowd + 0.8 * vary;
    }
    if (allowTrees) score -= 2 * siteTrees(world, x, y).length; // the fewer trees to clear, the better
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/**
 * The site for a new building: a clear one if there is any; otherwise one among trees, which are then cleared before
 * the building goes up (0.23). -1 if neither exists.
 */
export function pickSite(world: World, s: Settlement, owner: Uint16Array, type: BuildingType): number {
  const i = findSite(world, s, owner, type);
  return i >= 0 ? i : findSite(world, s, owner, type, true);
}

/** The centre tile and its neighbours up to this Chebyshev distance stay free of buildings (the landmark stands there). */
export const CENTRE_FREE = 2;

/**
 * Buildings are drawn twice the tile (render/architecture.ts BUILDING_SCALE), so a site needs room around it: no
 * other building on the eight tiles around, nor two rows in front or behind (doors stay open for roads; fields may
 * still touch fields), and no trees on the eight tiles around or on the site
 * itself (world/trees.ts, the same trees the map shows), so the larger drawing never covers a tree, and no house
 * stands in a trunk. The site itself is never woodland, even a gap in it.
 */
export function siteClear(world: World, at: ReadonlyMap<number, BuildingType>, x: number, y: number, type: BuildingType, allowTrees = false): boolean {
  const W = world.width;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= world.height) continue;
      const n = ny * W + nx;
      const near = Math.abs(dy) <= 1;
      if (near && !allowTrees && (treesOn(world, nx, ny) > 0 || (FOREST_TERRAIN.includes(world.terrain[n]) && !dx && !dy))) return false;
      if (!dx && !dy) continue;
      // Two rows in front or behind: that building's door (the tile in front of it) would be closed in by this one's
      // larger drawing, or this one's door by it, and no road could reach it (sim/roads.ts).
      const k = at.get(n);
      if (k && !(k === 'farm' && type === 'farm')) return false;
    }
  }
  return true;
}

/** Why a building cannot be started now (null = it can). */
export function buildBlock(world: World, s: Settlement, owner: Uint16Array | null, type: BuildingType): BuildFail | null {
  const c = s.civ;
  if (!c || !owner) return 'site';
  if (c.buildings.length >= SLOTS[c.stage] || c.buildings.length >= MAX_BUILDINGS) return 'slots';
  if (constructions(c) >= MAX_CONSTRUCTIONS) return 'busy';
  const cost = costOf(c, type);
  if (c.wood < cost.wood || c.stone < cost.stone) return 'resources';
  if (preparing(c, s, world.width)) return 'clearing';
  if (pickSite(world, s, owner, type) < 0) return 'site';
  return null;
}

/** Starts a building: pays the cost, picks the site. */
export function startBuilding(world: World, s: Settlement, owner: Uint16Array | null, type: BuildingType, tick: number): Building | BuildFail {
  const block = buildBlock(world, s, owner, type);
  if (block) return block;
  const c = s.civ!;
  const i = pickSite(world, s, owner!, type);
  const cost = costOf(c, type);
  c.wood -= cost.wood;
  c.stone -= cost.stone;
  const steps = stepsOf(c, type);
  const b: Building = {
    id: c.nextBuildingId++, type, x: i % world.width, y: Math.floor(i / world.width), started: tick, progress: 0, needed: steps,
    done: false, reserve: 0, acc: 0, active: false, idle: 0, empty: false, here: 0, level: 1, up: 0,
  };
  c.buildings.push(b);
  // Trees on and around the site are felled first (construction waits for them).
  for (const t of siteTrees(world, b.x, b.y)) if (!c.clear.includes(t) && c.clear.length < MAX_CLEAR) c.clear.push(t);
  return b;
}

export interface CivHost {
  world: World;
  creatures: Creatures;
  owner: Uint16Array;
  tick: number;
  auto: boolean;
  /** Records a history event for the settlement (and the world). */
  event(s: Settlement, text: string, code: string, p: Record<string, string | number>): void;
  /** Fells the trees on a tile (sim/forestry.ts): returns their wood, once. */
  fell(i: number): number;
  /** Tree tiles any worker of any settlement is cutting now (one worker per tree). */
  taken: Set<number>;
}

function stageFor(s: Settlement, c: Civ): Stage {
  const pop = s.members.length;
  const n = finished(c);
  const hasHouse = done(c, 'house').length > 0;
  const hasFood = done(c, 'farm').length > 0;
  const canTown =
    pop >= STAGE_REQ.town.people && n >= STAGE_REQ.town.buildings && done(c, 'storehouse').length > 0 && c.techs.length >= STAGE_REQ.town.techs;
  const canVillage = pop >= STAGE_REQ.village.people && n >= STAGE_REQ.village.buildings && hasHouse && hasFood;
  const idx = STAGES.indexOf(c.stage);
  // Stages go up as soon as the conditions hold and come down only when the population has clearly shrunk.
  if (canTown) return 'town';
  if (idx >= 2 && pop >= STAGE_REQ.town.people * 0.7) return 'town';
  if (canVillage) return 'village';
  if (idx >= 1 && pop >= STAGE_REQ.village.people * 0.7) return 'village';
  return 'camp';
}

/** One step (STEP_TICKS ticks) of a human settlement's economy. */
/** Returns how much the settlement is under pressure this step (0 = fine): famine, fire in the territory, crowding, little food land. */
export function civStep(host: CivHost, s: Settlement): number {
  const { world, creatures } = host;
  const c = s.civ!;
  const W = world.width;
  const pop = s.members.length;

  // 1. Hazards: water or fire destroys what stands on the tile.
  for (const b of [...c.buildings]) {
    const i = b.y * W + b.x;
    const cause = isWater(world.terrain[i]) ? 'flood' : world.fire[i] > 0 ? 'fire' : null;
    if (cause) {
      c.buildings.splice(c.buildings.indexOf(b), 1);
      host.event(s, `${s.name}: a ${b.type} was destroyed by ${cause}.`, `settlement_destroyed_${cause}`, { name: s.name, type: b.type });
    }
  }

  // 2. Jobs: who works where. Then each building works with the workers standing at it.
  const adults: number[] = [];
  for (const id of s.members) {
    const i = creatures.indexOf(id);
    if (i >= 0 && creatures.stage(i) !== 'Juvenile') adults.push(id);
  }
  assignJobs(host, s, adults);
  const here = workersHere(c, creatures);
  for (const b of c.buildings) b.here = here.get(b.id) ?? 0;

  // 3. Construction and house upgrades: builders at the site do the work, once the ground around it is clear
  //    (0.23: trees on the site are queued for clearing and felled first).
  for (const b of c.buildings) {
    if (b.done && !b.up) continue;
    const n = here.get(b.id) ?? 0;
    if (!b.done) {
      const trees = siteTrees(world, b.x, b.y);
      if (trees.length) {
        for (const t of trees) if (!c.clear.includes(t) && c.clear.length < MAX_CLEAR) c.clear.push(t);
        continue;
      }
    }
    if (!n) continue;
    b.progress = Math.min(b.needed, b.progress + BUILD_PER_WORKER * n);
    if (b.progress >= b.needed - 1e-9) {
      b.progress = b.needed;
      if (b.up) {
        // Upgrade finished: the same house, one level higher.
        const firstOfTier = !c.buildings.some((o) => o !== b && o.type === 'house' && o.done && o.level >= b.up);
        b.level = b.up;
        b.up = 0;
        host.event(s, `${s.name}: a house became level ${b.level}.`, 'settlement_house_upgraded', { name: s.name, level: b.level, species: s.species });
        if (firstOfTier) host.event(s, `${s.name} has its first level ${b.level} house.`, 'settlement_housing_tier', { name: s.name, level: b.level, species: s.species });
        continue;
      }
      b.done = true;
      if (b.type === 'quarry') b.reserve = Math.min(STONE_RESERVE_CAP, countNear(world, b.x, b.y, QUARRY_RADIUS, STONE_TERRAIN) * STONE_PER_TILE);
      host.event(s, `${s.name}: a ${b.type} was built.`, 'settlement_built', { name: s.name, type: b.type });
    }
  }

  // A finished site or upgrade needs no builders: free them now (a new farm keeps at most its own places).
  const left = new Map<number, number>();
  c.jobs = c.jobs.filter((j) => {
    if (j.b === CLEAR_JOB) return true; // clearing has no building
    const b = c.buildings.find((x) => x.id === j.b);
    const n = left.get(j.b) ?? 0;
    if (!b || n >= slotsOf(b)) {
      release(host, j);
      return false;
    }
    left.set(j.b, n + 1);
    return true;
  });

  // 4. Production.
  const cap = storage(c);
  const harvest = hasTech(c, 'harvesting') ? 1.5 : 1;
  const farming = hasTech(c, 'farming') ? 1.5 : 1;
  const rate = { food: 0, foodUse: 0, wood: 0, stone: 0, knowledge: 0 };
  // Foraging on the edible land of the territory (limited by the number of people and by the land).
  let edible = 0;
  const food = SPECIES[s.species].food;
  for (const i of s.tiles) if (food.includes(world.terrain[i])) edible++;
  rate.food += Math.min(FORAGE_PER_PERSON * pop, FORAGE_PER_TILE * edible);
  for (const b of done(c, 'farm')) {
    const out = farmOutput(world, b, farming);
    if (out > 0) {
      rate.food += out;
      b.idle = 0;
      if (!b.active) {
        b.active = true;
        host.event(s, `${s.name}: a farm started working.`, 'settlement_farm_started', { name: s.name });
      }
    } else if (b.active && ++b.idle >= FARM_IDLE_STEPS) {
      b.active = false;
      host.event(s, `${s.name}: a farm stopped working.`, 'settlement_farm_stopped', { name: s.name });
    }
  }
  // Wood comes only from trees the lumberjacks (and clearers) actually fell (0.23).
  rate.wood += chop(host, s, harvest, cap);
  for (const b of done(c, 'quarry')) {
    if (b.empty || c.stone >= cap) continue;
    const take = Math.min(b.reserve, QUARRY_YIELD * harvest * Math.min(1, (here.get(b.id) ?? 0) / WORK_SLOTS.quarry));
    b.reserve -= take;
    rate.stone += take;
    if (b.reserve <= 1e-9) {
      b.reserve = 0;
      b.empty = true;
      host.event(s, `${s.name}: a quarry ran out of stone.`, 'settlement_exhausted', { name: s.name, type: b.type });
    }
  }
  rate.knowledge = KNOWLEDGE_PER_ADULT * adults.length;

  // 5. Meals from the stock: hungry people eat, which really lowers their hunger.
  let used = 0;
  for (const id of s.members) {
    if (c.food + rate.food - used < 1) break;
    const i = creatures.indexOf(id);
    if (i >= 0 && creatures.hunger[i] >= FEED_HUNGER) {
      creatures.hunger[i] = Math.max(0, creatures.hunger[i] - FEED_AMOUNT);
      used++;
    }
  }
  rate.foodUse = used;
  c.food = Math.max(0, Math.min(cap, c.food + rate.food - used));
  c.wood = Math.min(cap, c.wood + rate.wood);
  c.woodFlow += (rate.wood - c.woodFlow) * 0.05;
  c.stone = Math.min(cap, c.stone + rate.stone);
  c.knowledge = Math.min(KNOWLEDGE_CAP, c.knowledge + rate.knowledge);
  c.rate = rate;
  if (c.food < 1 && pop >= 5) {
    if (!c.famine) {
      c.famine = true;
      host.event(s, `${s.name}: the food ran out.`, 'settlement_famine', { name: s.name });
    }
  } else if (c.food >= 5) c.famine = false;

  // 6. Research.
  if (c.research && ++c.research.steps >= TECHS[c.research.id].steps) {
    const id = c.research.id;
    c.techs.push(id);
    c.research = null;
    host.event(s, `${s.name} learned ${id}.`, 'settlement_tech', { name: s.name, tech: id });
  }
  if (c.advancedResearch) {
    const def = TECH_BY_ID[c.advancedResearch.id];
    if (def && ++c.advancedResearch.steps >= def.steps) {
      if (!c.advanced.includes(c.advancedResearch.id)) c.advanced.push(c.advancedResearch.id);
      c.advancedResearch = null;
      host.event(s, `${s.name} invented ${def.id}.`, 'settlement_tech', { name: s.name, tech: def.id });
    }
  }

  // 7. Stage.
  const stage = stageFor(s, c);
  if (stage !== c.stage) {
    c.stage = stage;
    host.event(s, `${s.name} became a ${stage}.`, 'settlement_stage', { name: s.name, stage });
  }

  // 8. Settlements that run themselves.
  if (host.auto) autoManage(host, s);

  // 9. Pressure to leave: famine, fire on the territory, full housing with no way to build, too little land to eat from.
  let pressure = 0;
  if (c.famine) pressure += 2;
  let burning = false;
  for (const i of s.tiles) {
    if (world.fire[i] > 0) {
      burning = true;
      break;
    }
  }
  if (burning) pressure += 3;
  if (pop >= housing(c) && c.wood < 10 && done(c, 'lumber').length === 0) pressure += 1;
  if (edible < 2 * pop) pressure += 1;
  return pressure;
}

/** Food a farm gives in one step with the workers now at it (a field that turned to desert, forest or similar yields nothing). */
export function farmOutput(world: World, b: Building, farming: number): number {
  const i = b.y * world.width + b.x;
  if (!b.here || !FARM_TERRAIN.includes(world.terrain[i])) return 0;
  const fertility = Math.max(0.4, Math.min(1.4, 0.4 + world.moisture[i] / 200));
  return FARM_YIELD * farming * fertility * Math.min(1, b.here / WORK_SLOTS.farm);
}


/** Kind of work a building gives (null: it needs no workers now). */
export function jobKind(b: Building): JobKind | null {
  if (!b.done || b.up) return 'build';
  if (b.empty) return null;
  return b.type === 'farm' ? 'farm' : b.type === 'lumber' ? 'wood' : b.type === 'quarry' ? 'stone' : null;
}

/** Workers a building wants now. */
export function slotsOf(b: Building): number {
  if (!b.done || b.up) return BUILDERS;
  return jobKind(b) ? WORK_SLOTS[b.type] : 0;
}

/** Workers standing at their workplace, per building id. */
export function workersHere(c: Civ, creatures: Creatures): Map<number, number> {
  const out = new Map<number, number>();
  for (const j of c.jobs) {
    const i = creatures.indexOf(j.id);
    if (i < 0 || creatures.state[i] !== STATE.WORK) continue;
    const b = c.buildings.find((x) => x.id === j.b);
    if (b && Math.hypot(creatures.x[i] - b.x - 0.5, creatures.y[i] - b.y - 0.5) <= WORK_RANGE) out.set(b.id, (out.get(b.id) ?? 0) + 1);
  }
  return out;
}

/** The job of a resident, if any. */
export function jobOf(c: Civ, id: number): { job: Job; building: Building; kind: JobKind } | null {
  const job = c.jobs.find((j) => j.id === id);
  const building = job && c.buildings.find((b) => b.id === job.b);
  const kind = building && jobKind(building);
  return job && building && kind ? { job, building, kind } : null;
}

/**
 * Gives adult residents jobs. Jobs are kept while they make sense (the worker is a living adult resident,
 * the building stands and still needs work, and the worker is not stuck), so nobody changes task all
 * the time. Free adults take the nearest reachable building with a free place, most urgent first; when
 * nobody is free, at most one worker per step moves from the least to the most urgent work.
 */
export function assignJobs(host: CivHost, s: Settlement, adults: number[]): void {
  const { world, creatures, tick } = host;
  const c = s.civ!;
  const sp = s.species;
  const W = world.width;
  const adultSet = new Set(adults);
  const byId = new Map(c.buildings.map((b) => [b.id, b] as const));
  // Clearing: drop tiles that no longer need it (felled, burnt, flooded).
  c.clear = c.clear.filter((t) => fellable(world, t));
  c.skip = c.skip.filter((k) => k[2] > tick && adultSet.has(k[0]) && (k[1] < 0 || byId.has(k[1])));
  const skipped = (id: number, b: number) => c.skip.some((k) => k[0] === id && k[1] === b);
  const count = new Map<number, number>();
  const kept: Job[] = [];
  const clearSlots = Math.min(CLEARERS, c.clear.length);
  // Where a job's worker should be: beside its tree when felling, else at the building.
  const goal = (j: Job): [number, number] => {
    if (j.at >= 0) return [(j.at % W) + 0.5, Math.floor(j.at / W) + 0.5];
    const b = byId.get(j.b);
    return b ? [b.x + 0.5, b.y + 0.5] : [s.x + 0.5, s.y + 0.5];
  };
  for (const j of c.jobs) {
    const clearing = j.b === CLEAR_JOB;
    const b = byId.get(j.b);
    if ((!b && !clearing) || !adultSet.has(j.id) || kept.some((k) => k.id === j.id)) continue;
    if ((count.get(j.b) ?? 0) >= (clearing ? clearSlots : slotsOf(b!))) continue;
    const i = creatures.indexOf(j.id);
    const [gx, gy] = goal(j);
    const d = Math.hypot(creatures.x[i] - gx, creatures.y[i] - gy);
    const st = creatures.state[i];
    if (d <= (j.at >= 0 ? CHOP_RANGE : WORK_RANGE)) {
      j.best = d;
      j.stuck = 0;
    } else if (d < j.best - 0.5) {
      j.best = d;
      j.stuck = 0;
    } else if (st === STATE.TRAVEL || st === STATE.WANDER || st === STATE.WORK) {
      // Only time spent trying to get there counts (not eating, drinking or running away).
      if (++j.stuck >= STUCK_STEPS) {
        if (j.t >= 0) {
          // That tree cannot be reached: leave it for a while and pick another one.
          if (c.skip.length < 64) c.skip.push([j.id, treeSkip(j.t), tick + SKIP_TICKS]);
          release(host, j);
          j.stuck = 0;
          j.best = Infinity;
        } else {
          if (c.skip.length < 64 && b) c.skip.push([j.id, b.id, tick + SKIP_TICKS]);
          continue;
        }
      }
    }
    kept.push(j);
    count.set(j.b, (count.get(j.b) ?? 0) + 1);
  }
  // Jobs that were dropped give their tree back.
  for (const j of c.jobs) if (!kept.includes(j)) release(host, j);
  c.jobs = kept;
  const working = new Set(kept.map((j) => j.id));
  const free = adults.filter((id) => !working.has(id));
  const foodShort = c.food < Math.max(10, s.members.length);
  const rank = (b: Building) => (!b.done || b.up ? (foodShort ? 1 : 0) : b.type === 'farm' ? (foodShort ? 0 : 1) : b.type === 'lumber' ? 2 : 3);
  const order = c.buildings.filter((b) => slotsOf(b) > 0).sort((a, b) => rank(a) - rank(b) || a.id - b.id);
  const give = (id: number, b: number) => {
    const i = creatures.indexOf(id);
    const bb = byId.get(b);
    const [gx, gy] = bb ? [bb.x + 0.5, bb.y + 0.5] : [s.x + 0.5, s.y + 0.5];
    c.jobs.push({ id, b, since: tick, best: Math.hypot(creatures.x[i] - gx, creatures.y[i] - gy), stuck: 0, t: -1, at: -1, chop: 0 });
    count.set(b, (count.get(b) ?? 0) + 1);
  };
  const canReach = (id: number, b: Building) => {
    const i = creatures.indexOf(id);
    return !skipped(id, b.id) && creatures.reachable(world, sp, Math.floor(creatures.x[i]), Math.floor(creatures.y[i]), b.x, b.y);
  };
  // Clearing comes first: nothing can be built on ground that is not clear.
  while ((count.get(CLEAR_JOB) ?? 0) < clearSlots && free.length) {
    let pick = 0;
    let pd = Infinity;
    for (let k = 0; k < free.length; k++) {
      const i = creatures.indexOf(free[k]);
      const d = Math.hypot(creatures.x[i] - s.x, creatures.y[i] - s.y);
      if (d < pd) {
        pd = d;
        pick = k;
      }
    }
    give(free[pick], CLEAR_JOB);
    free.splice(pick, 1);
  }
  let moved = false;
  for (const b of order) {
    while ((count.get(b.id) ?? 0) < slotsOf(b)) {
      // Nearest free adult that can get there.
      let pick = -1;
      let pd = Infinity;
      for (let k = 0; k < free.length; k++) {
        const i = creatures.indexOf(free[k]);
        const d = Math.hypot(creatures.x[i] - b.x - 0.5, creatures.y[i] - b.y - 0.5);
        if (d < pd && canReach(free[k], b)) {
          pd = d;
          pick = k;
        }
      }
      if (pick >= 0) {
        give(free[pick], b.id);
        free.splice(pick, 1);
        continue;
      }
      // Nobody free: take one settled worker from the least urgent work (once per step).
      if (moved) break;
      let from: Job | null = null;
      for (const j of c.jobs) {
        const jb = byId.get(j.b);
        if (!jb || rank(jb) <= rank(b) || tick - j.since < MIN_JOB_TICKS || !canReach(j.id, b)) continue;
        if (!from || rank(jb) > rank(byId.get(from.b)!) || (rank(jb) === rank(byId.get(from.b)!) && j.id < from.id)) from = j;
      }
      if (!from) break;
      c.jobs.splice(c.jobs.indexOf(from), 1);
      release(host, from);
      count.set(from.b, (count.get(from.b) ?? 1) - 1);
      give(from.id, b.id);
      moved = true;
    }
  }
  // Felling jobs (lumber camps and clearing) without a tree get the nearest free one they can reach.
  for (const j of c.jobs) {
    if (j.t >= 0) {
      if (fellable(world, j.t)) continue;
      release(host, j); // the tree is gone (felled by someone else, burnt, flooded)
    }
    const b = byId.get(j.b);
    if (j.b === CLEAR_JOB) pickTree(host, s, j, c.clear, skipped);
    else if (b && b.done && !b.up && b.type === 'lumber') {
      if (!pickTree(host, s, j, treesNear(world, b.x, b.y, LUMBER_RADIUS), skipped)) {
        if (!b.empty) {
          b.empty = true;
          host.event(s, `${s.name}: the forest near a lumber camp is gone.`, 'settlement_exhausted', { name: s.name, type: b.type });
        }
      } else b.empty = false;
    }
  }
}

/** Skip-list code of a tree tile (buildings use positive ids). */
const treeSkip = (t: number) => -2 - t;

/** Frees a job's tree (another worker may take it). Work already done on it is kept with the tree being left. */
function release(host: CivHost, j: Job): void {
  if (j.t >= 0) host.taken.delete(j.t);
  j.t = -1;
  j.at = -1;
  j.chop = 0;
}

/** Tiles with trees within r of (x, y), nearest first (ties by tile index, so the choice is deterministic). */
function treesNear(world: World, x: number, y: number, r: number): number[] {
  const out: Array<[number, number]> = [];
  for (let yy = Math.max(0, y - r); yy <= Math.min(world.height - 1, y + r); yy++) {
    for (let xx = Math.max(0, x - r); xx <= Math.min(world.width - 1, x + r); xx++) {
      const d = Math.hypot(xx - x, yy - y);
      if (d <= r && treesOn(world, xx, yy) > 0) out.push([yy * world.width + xx, d]);
    }
  }
  out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return out.map((o) => o[0]);
}

/**
 * Gives a felling job a tree: the first candidate that nobody is cutting, that the worker has not given up on, and
 * that has a tile beside it the worker can stand on and reach. Returns whether one was found.
 */
function pickTree(host: CivHost, s: Settlement, j: Job, candidates: readonly number[], skipped: (id: number, b: number) => boolean): boolean {
  const { world, creatures } = host;
  const i = creatures.indexOf(j.id);
  if (i < 0) return false;
  const W = world.width;
  const cls = landClass(SPECIES[s.species].move); // on dry land
  const fx = Math.floor(creatures.x[i]);
  const fy = Math.floor(creatures.y[i]);
  let tries = 0;
  for (const t of candidates) {
    if (host.taken.has(t) || skipped(j.id, treeSkip(t)) || !fellable(world, t)) continue;
    if (++tries > 12) break; // a bounded search per step
    const tx = t % W;
    const ty = (t - tx) / W;
    // The tile to stand on: a passable neighbour (open ground first, then woods), nearest to the worker.
    let at = -1;
    let best = Infinity;
    for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1], [-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= world.height || !passable(world, cls, nx, ny)) continue;
      const n = ny * W + nx;
      const score = Math.hypot(nx - fx, ny - fy) + (FOREST_TERRAIN.includes(world.terrain[n]) ? 3 : 0) + (dx && dy ? 0.5 : 0);
      if (score < best) {
        best = score;
        at = n;
      }
    }
    if (at < 0) continue;
    if (!creatures.reachable(world, s.species, fx, fy, at % W, Math.floor(at / W))) continue;
    j.t = t;
    j.at = at;
    j.chop = 0;
    j.best = Math.hypot(creatures.x[i] - (at % W) - 0.5, creatures.y[i] - Math.floor(at / W) - 0.5);
    j.stuck = 0;
    host.taken.add(t);
    return true;
  }
  return false;
}

/**
 * Felling work of one step: each worker standing at work beside its tree adds CHOP_PER_WORKER (more with
 * Harvesting); when the work reaches the tree's wood the tree falls (host.fell) and its wood is added, once.
 * Lumberjacks rest while the store is full. Returns the wood felled. Counts lumberjacks at work per camp.
 */
function chop(host: CivHost, s: Settlement, harvest: number, cap: number): number {
  const { world, creatures } = host;
  const c = s.civ!;
  const W = world.width;
  let wood = 0;
  for (const b of c.buildings) if (b.type === 'lumber') b.here = 0;
  for (const j of c.jobs) {
    if (j.t < 0 || j.at < 0) continue;
    const i = creatures.indexOf(j.id);
    if (i < 0 || creatures.state[i] !== STATE.WORK) continue;
    if (Math.hypot(creatures.x[i] - (j.at % W) - 0.5, creatures.y[i] - Math.floor(j.at / W) - 0.5) > CHOP_RANGE) continue;
    const clearing = j.b === CLEAR_JOB;
    if (!clearing && c.wood + wood >= cap) continue; // the store is full: no trees are cut for nothing
    const b = clearing ? null : c.buildings.find((x) => x.id === j.b);
    if (b) b.here++;
    j.chop += CHOP_PER_WORKER * harvest * (clearing ? CLEAR_SPEED : 1);
    const need = Math.max(CLEAR_WORK, woodOf(world, j.t));
    if (j.chop + 1e-9 < need) continue;
    wood += host.fell(j.t);
    c.clear = c.clear.filter((t) => t !== j.t);
    release(host, j);
  }
  return wood;
}

/** Tiles to clear around a building site: its own tile and the eight around it, where trees (or woodland) stand. */
export function siteTrees(world: World, x: number, y: number): number[] {
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue;
      const n = ny * world.width + nx;
      if (treesOn(world, nx, ny) > 0 || (!dx && !dy && FOREST_TERRAIN.includes(world.terrain[n]))) out.push(n);
    }
  }
  return out;
}

/** Tiles of a settlement's free centre that still have trees or woodland (cleared before anything is built). */
export function centreTrees(world: World, s: { x: number; y: number }): number[] {
  const out: number[] = [];
  for (let dy = -CENTRE_FREE; dy <= CENTRE_FREE; dy++) {
    for (let dx = -CENTRE_FREE; dx <= CENTRE_FREE; dx++) {
      const nx = s.x + dx;
      const ny = s.y + dy;
      if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue;
      const n = ny * world.width + nx;
      if (fellable(world, n)) out.push(n);
    }
  }
  return out;
}

/** Whether the settlement is still preparing its site: trees in its centre wait to be cleared. */
export function preparing(c: Civ, s: { x: number; y: number }, W: number): boolean {
  return c.clear.some((t) => Math.max(Math.abs((t % W) - s.x), Math.abs(Math.floor(t / W) - s.y)) <= CENTRE_FREE);
}

/** Simple, readable rules for a settlement that builds and researches by itself. */
function autoManage(host: CivHost, s: Settlement): void {
  const { world, owner, tick } = host;
  const c = s.civ!;
  const pop = s.members.length;
  const count = (t: BuildingType) => c.buildings.filter((b) => b.type === t).length;
  // In order of need: food and a wood supply first (nothing else can be paid without wood), then housing, then growth.
  const wants: BuildingType[] = [];
  if (count('farm') === 0) wants.push('farm');
  if (count('lumber') === 0 && c.wood < 40) wants.push('lumber');
  if (pop >= housing(c) - 1) wants.push('house');
  if (c.food < 30 && count('farm') < Math.ceil(pop / 7)) wants.push('farm');
  if (count('storehouse') === 0 && pop >= 14) wants.push('storehouse');
  if (count('quarry') === 0 && c.stage !== 'camp') wants.push('quarry');
  if (count('shipyard') === 0 && c.stage === 'town' && count('storehouse') > 0) wants.push('shipyard'); // only where findSite finds a shore
  // Bridges over small water once masonry or wheel is known
  if (count('bridge') < 2 && (c.advanced.includes('masonry') || c.advanced.includes('wheel')) && c.stage !== 'camp') wants.push('bridge');
  if (count('mill') === 0 && count('farm') > 0 && c.stage !== 'camp') wants.push('mill');
  if (count('workshop') === 0 && c.stage === 'village' || c.stage === 'town') wants.push('workshop');
  if (count('market') === 0 && pop >= 18) wants.push('market');
  if (count('temple') === 0 && c.advanced.includes('religion') && c.stage !== 'camp') wants.push('temple');
  if (count('tower') === 0 && c.stage === 'town') wants.push('tower');
  for (const t of wants) {
    if (buildBlock(world, s, owner, t) === null) {
      const b = startBuilding(world, s, owner, t, tick);
      if (typeof b === 'object') break;
    }
  }
  if (wantsUpgrade(c, pop)) startUpgrade(c);
  if (!c.research) {
    for (const id of TECH_IDS) {
      if (!hasTech(c, id) && techNeedsMet(c, id) && c.knowledge >= TECHS[id].knowledge) {
        c.knowledge -= TECHS[id].knowledge;
        c.research = { id, steps: 0 };
        break;
      }
    }
  }
  // AI advanced research
  if (!c.advancedResearch && c.knowledge > 40) {
    const race = SPECIES[s.species]?.key ?? 'human';
    const bias = RACE_BIAS[race] ?? {};
    const next = chooseNextTech(c.advanced, c.knowledge, {
      defense: c.food < 20 || s.stress > 8,
      housing: s.members.length >= housing(c) - 2,
      transport: c.stage === 'town',
    }, bias);
    if (next) {
      const def = TECH_BY_ID[next];
      if (def && c.knowledge >= def.knowledge) {
        c.knowledge -= def.knowledge;
        c.advancedResearch = { id: next, steps: 0 };
      }
    }
  }
}

/**
 * Whether a self-running settlement should upgrade a house now: housing is (nearly) full, no other upgrade is under
 * way, food and wood production exist, there is no famine, and paying leaves the food and wood reserves intact.
 */
export function wantsUpgrade(c: Civ, pop: number): boolean {
  if (pop < housing(c) - 2 || c.famine || c.food < Math.max(AUTO_UPGRADE_FOOD, pop)) return false;
  if (c.buildings.some((b) => b.up > 0)) return false;
  if (!done(c, 'farm').length || !c.buildings.some((b) => b.type === 'lumber')) return false;
  const b = upgradeTarget(c);
  if (!b || upgradeBlock(c)) return false;
  return c.wood - upgradeCost(c, b.level + 1).wood >= AUTO_UPGRADE_WOOD_LEFT;
}

/** Why research cannot start now (null = it can). */
export function researchBlock(c: Civ, id: TechId): 'known' | 'busy' | 'needs' | 'knowledge' | null {
  if (hasTech(c, id)) return 'known';
  if (c.research) return 'busy';
  if (!techNeedsMet(c, id)) return 'needs';
  if (c.knowledge < TECHS[id].knowledge) return 'knowledge';
  return null;
}

export function startResearch(c: Civ, id: TechId): ReturnType<typeof researchBlock> {
  const block = researchBlock(c, id);
  if (block) return block;
  c.knowledge -= TECHS[id].knowledge;
  c.research = { id, steps: 0 };
  return null;
}

// ---- saving ------------------------------------------------------------------------

export type CivSave = Civ;

export function exportCiv(c: Civ): CivSave {
  return JSON.parse(JSON.stringify(c)) as CivSave;
}

/** Rebuilds a Civ from saved data, ignoring anything invalid (unknown types, out-of-range numbers). */
export function importCiv(raw: unknown, world: World): Civ {
  const c = newCiv();
  if (!raw || typeof raw !== 'object') return c;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  c.food = num(r.food, 0, 1e6, c.food);
  c.wood = num(r.wood, 0, 1e6, c.wood);
  c.stone = num(r.stone, 0, 1e6, c.stone);
  c.knowledge = num(r.knowledge, 0, KNOWLEDGE_CAP, 0);
  c.woodFlow = num(r.woodFlow, 0, 100, 0);
  c.stage = STAGES.includes(r.stage as Stage) ? (r.stage as Stage) : 'camp';
  c.famine = r.famine === true;
  c.techs = Array.isArray(r.techs) ? Array.from(new Set((r.techs as unknown[]).filter((t): t is TechId => TECH_IDS.includes(t as TechId)))) : [];
  const rs = r.research as { id?: unknown; steps?: unknown } | null | undefined;
  if (rs && TECH_IDS.includes(rs.id as TechId) && !c.techs.includes(rs.id as TechId)) {
    c.research = { id: rs.id as TechId, steps: Math.floor(num(rs.steps, 0, TECHS[rs.id as TechId].steps, 0)) };
  }
  const seen = new Set<number>();
  let maxId = 0;
  for (const b of (Array.isArray(r.buildings) ? r.buildings : []).slice(0, MAX_BUILDINGS)) {
    if (!b || typeof b !== 'object' || !BUILDING_TYPES.includes(b.type)) continue;
    const x = Math.floor(num(b.x, -1, world.width, -1));
    const y = Math.floor(num(b.y, -1, world.height, -1));
    if (!world.inBounds(x, y) || seen.has(y * world.width + x)) continue;
    seen.add(y * world.width + x);
    const id = Math.floor(num(b.id, 1, 1e9, maxId + 1));
    maxId = Math.max(maxId, id);
    const needed = Math.floor(num(b.needed, 1, 100, BUILDINGS[b.type as BuildingType].steps));
    const isDone = b.done === true;
    // House level and upgrade (0.16; older saves: every house is level 1, nothing is being upgraded).
    const level = b.type === 'house' ? Math.floor(num(b.level, 1, MAX_HOUSE_LEVEL, 1)) : 1;
    const up = b.type === 'house' && isDone && b.up === level + 1 && level < MAX_HOUSE_LEVEL ? level + 1 : 0;
    c.buildings.push({
      id, type: b.type, x, y, started: num(b.started, 0, 1e12, 0), progress: isDone && !up ? needed : num(b.progress, 0, needed, 0), needed, level, up,
      done: isDone, reserve: num(b.reserve, 0, STONE_RESERVE_CAP, 0), acc: num(b.acc, 0, WOOD_PER_TREE, 0),
      // Version 12 fields; older saves: a farm counts as working, nothing is exhausted.
      active: typeof b.active === 'boolean' ? b.active : isDone && b.type === 'farm', idle: Math.floor(num(b.idle, 0, 1e6, 0)), empty: b.empty === true,
      here: Math.floor(num(b.here, 0, BUILDERS, 0)),
    });
  }
  c.nextBuildingId = Math.max(Math.floor(num(r.nextBuildingId, 1, 1e9, 1)), maxId + 1);
  // Jobs (version 12): one per worker, at a standing building; older saves start without jobs and get them on the next step.
  const ids = new Set(c.buildings.map((b) => b.id));
  const workers = new Set<number>();
  for (const j of (Array.isArray(r.jobs) ? r.jobs : []).slice(0, 2000)) {
    if (!j || typeof j !== 'object' || typeof j.id !== 'number' || !Number.isInteger(j.id) || workers.has(j.id) || !(ids.has(j.b) || j.b === CLEAR_JOB)) continue;
    workers.add(j.id);
    // Felling (0.23; older saves: no tree yet, one is picked on the next step).
    const n = world.width * world.height;
    const tile = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < n ? v : -1);
    let t = tile(j.t);
    let at = tile(j.at);
    if (t < 0 || at < 0) t = at = -1;
    c.jobs.push({
      id: j.id, b: j.b, since: num(j.since, 0, 1e12, 0), best: num(j.best, 0, 1e6, 0), stuck: Math.floor(num(j.stuck, 0, STUCK_STEPS, 0)),
      t, at, chop: t >= 0 ? num(j.chop, 0, 1e4, 0) : 0,
    });
  }
  // Roads (0.23; older saves: none, they are laid over the next years).
  const roadSet = new Set<number>();
  for (const t of (Array.isArray(r.roads) ? r.roads : []).slice(0, 600)) {
    if (Number.isInteger(t) && t >= 0 && t < world.width * world.height && !isWater(world.terrain[t])) roadSet.add(t);
  }
  c.roads = [...roadSet];
  // Ground to clear (0.23; older saves: nothing queued, buildings among trees queue their site on the next step).
  const cells = world.width * world.height;
  for (const t of (Array.isArray(r.clear) ? r.clear : []).slice(0, MAX_CLEAR)) {
    if (Number.isInteger(t) && t >= 0 && t < cells && !c.clear.includes(t)) c.clear.push(t);
  }
  for (const k of (Array.isArray(r.skip) ? r.skip : []).slice(0, 64)) {
    if (Array.isArray(k) && k.length === 3 && k.every((v) => typeof v === 'number' && Number.isFinite(v)) && ids.has(k[1])) c.skip.push([k[0], k[1], k[2]]);
  }
  const rate = (r.rate ?? {}) as Record<string, unknown>;
  c.rate = {
    food: num(rate.food, 0, 1e6, 0), foodUse: num(rate.foodUse, 0, 1e6, 0), wood: num(rate.wood, 0, 1e6, 0),
    stone: num(rate.stone, 0, 1e6, 0), knowledge: num(rate.knowledge, 0, 1e6, 0),
  };
  return c;
}
