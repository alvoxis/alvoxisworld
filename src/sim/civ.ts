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
import { T, isWater } from '../world/terrain';
import type { World } from '../world/world';
import type { Creatures } from './creatures';
import { SPECIES, STATE } from './creatures';
import { passable } from './pathfinding';
import type { Settlement } from './settlements';

export type BuildingType = 'house' | 'storehouse' | 'farm' | 'lumber' | 'quarry';
export const BUILDING_TYPES: readonly BuildingType[] = ['house', 'farm', 'lumber', 'quarry', 'storehouse'];
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
export const WOOD_PER_TREE = 10;
export const STONE_PER_TILE = 60;
export const STONE_RESERVE_CAP = 1500;
export const LUMBER_RADIUS = 6;
export const QUARRY_RADIUS = 5;
export const FARM_TERRAIN: readonly number[] = [T.GRASS, T.SAVANNA, T.SOIL];
export const FOREST_TERRAIN: readonly number[] = [T.FOREST, T.JUNGLE];
export const STONE_TERRAIN: readonly number[] = [T.HILLS, T.MOUNTAIN];

/** Workers a finished building can use; the full yield needs all of them. */
export const WORK_SLOTS: Readonly<Record<BuildingType, number>> = { house: 0, storehouse: 0, farm: 2, lumber: 2, quarry: 2 };
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
}

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
  research: { id: TechId; steps: number } | null;
  nextBuildingId: number;
  /** Food ran out and nobody has been told yet (reset when food is back). */
  famine: boolean;
  /** Rates of the last step (derived; shown as per-year numbers). */
  rate: { food: number; foodUse: number; wood: number; stone: number; knowledge: number };
  /** Jobs of the residents (one per worker). */
  jobs: Job[];
  /** Workers that could not reach a building: [creature id, building id, tick until]. */
  skip: Array<[number, number, number]>;
}

export function newCiv(): Civ {
  return {
    food: START_KIT.food, wood: START_KIT.wood, stone: START_KIT.stone, knowledge: 0, stage: 'camp', buildings: [], techs: [],
    research: null, nextBuildingId: 1, famine: false, rate: { food: 0, foodUse: 0, wood: 0, stone: 0, knowledge: 0 },
    jobs: [], skip: [],
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

export type BuildFail = 'resources' | 'site' | 'slots' | 'busy';

function countNear(world: World, x: number, y: number, r: number, terrains: readonly number[]): number {
  let n = 0;
  for (let yy = Math.max(0, y - r); yy <= Math.min(world.height - 1, y + r); yy++) {
    for (let xx = Math.max(0, x - r); xx <= Math.min(world.width - 1, x + r); xx++) {
      if (Math.hypot(xx - x, yy - y) <= r && terrains.includes(world.terrain[yy * world.width + xx])) n++;
    }
  }
  return n;
}

/** Best free tile in the territory for a building of this type (deterministic), or -1. */
export function findSite(world: World, s: Settlement, owner: Uint16Array, type: BuildingType): number {
  const c = s.civ!;
  const taken = new Set(c.buildings.map((b) => b.y * world.width + b.x));
  const cls = SPECIES[s.species].move;
  let best = -1;
  let bestScore = -Infinity;
  for (const i of s.tiles) {
    if (owner[i] !== s.id || taken.has(i)) continue;
    const x = i % world.width;
    const y = (i - x) / world.width;
    const t = world.terrain[i];
    if (isWater(t) || world.slopeClass[i] !== 0 || world.fire[i] > 0 || !passable(world, cls, x, y)) continue;
    let score = -Math.hypot(x - s.x, y - s.y); // near the centre by default
    if (type === 'farm') {
      if (!FARM_TERRAIN.includes(t) || world.moisture[i] < 40) continue;
    } else if (type === 'lumber') {
      if (FOREST_TERRAIN.includes(t)) continue; // stands next to the forest, not in it
      const trees = countNear(world, x, y, LUMBER_RADIUS, FOREST_TERRAIN);
      if (trees < 6) continue;
      score += trees * 10;
    } else if (type === 'quarry') {
      if (STONE_TERRAIN.includes(t) && t === T.MOUNTAIN) continue;
      const rock = countNear(world, x, y, QUARRY_RADIUS, STONE_TERRAIN);
      if (rock < 3) continue;
      score += rock * 10;
    }
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** Why a building cannot be started now (null = it can). */
export function buildBlock(world: World, s: Settlement, owner: Uint16Array | null, type: BuildingType): BuildFail | null {
  const c = s.civ;
  if (!c || !owner) return 'site';
  if (c.buildings.length >= SLOTS[c.stage] || c.buildings.length >= MAX_BUILDINGS) return 'slots';
  if (constructions(c) >= MAX_CONSTRUCTIONS) return 'busy';
  const cost = costOf(c, type);
  if (c.wood < cost.wood || c.stone < cost.stone) return 'resources';
  if (findSite(world, s, owner, type) < 0) return 'site';
  return null;
}

/** Starts a building: pays the cost, picks the site. */
export function startBuilding(world: World, s: Settlement, owner: Uint16Array | null, type: BuildingType, tick: number): Building | BuildFail {
  const block = buildBlock(world, s, owner, type);
  if (block) return block;
  const c = s.civ!;
  const i = findSite(world, s, owner!, type);
  const cost = costOf(c, type);
  c.wood -= cost.wood;
  c.stone -= cost.stone;
  const steps = stepsOf(c, type);
  const b: Building = {
    id: c.nextBuildingId++, type, x: i % world.width, y: Math.floor(i / world.width), started: tick, progress: 0, needed: steps,
    done: false, reserve: 0, acc: 0, active: false, idle: 0, empty: false, here: 0, level: 1, up: 0,
  };
  c.buildings.push(b);
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

  // 3. Construction and house upgrades: builders at the site do the work.
  for (const b of c.buildings) {
    if (b.done && !b.up) continue;
    const n = here.get(b.id) ?? 0;
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
    const b = c.buildings.find((x) => x.id === j.b);
    const n = left.get(j.b) ?? 0;
    if (!b || n >= slotsOf(b)) return false;
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
  const step = Math.floor(host.tick / STEP);
  for (const b of done(c, 'lumber')) {
    if (b.empty) {
      if (step % RECHECK_STEPS === 0 && nearestTree(world, b) >= 0) b.empty = false;
      continue;
    }
    if (c.wood >= cap) continue; // the store is full: no trees are cut for nothing
    // `acc` is the wood still on the tree being cut; a new tree is felled (the forest thins) when it is used up.
    let left = LUMBER_YIELD * harvest * Math.min(1, (here.get(b.id) ?? 0) / WORK_SLOTS.lumber);
    while (left > 1e-9) {
      if (b.acc <= 1e-9) {
        if (!fellTree(world, b)) {
          // No forest within reach: nothing to cut.
          b.empty = true;
          host.event(s, `${s.name}: the forest near a lumber camp is gone.`, 'settlement_exhausted', { name: s.name, type: b.type });
          break;
        }
        b.acc = WOOD_PER_TREE;
      }
      const take = Math.min(left, b.acc);
      b.acc -= take;
      rate.wood += take;
      left -= take;
    }
  }
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

const STEP = 20; // settlement step in ticks (STEP_TICKS in settlements.ts)

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
  const adultSet = new Set(adults);
  const byId = new Map(c.buildings.map((b) => [b.id, b] as const));
  c.skip = c.skip.filter((k) => k[2] > tick && adultSet.has(k[0]) && byId.has(k[1]));
  const skipped = (id: number, b: number) => c.skip.some((k) => k[0] === id && k[1] === b);
  const count = new Map<number, number>();
  const kept: Job[] = [];
  for (const j of c.jobs) {
    const b = byId.get(j.b);
    if (!b || !adultSet.has(j.id) || kept.some((k) => k.id === j.id) || (count.get(b.id) ?? 0) >= slotsOf(b)) continue;
    const i = creatures.indexOf(j.id);
    const d = Math.hypot(creatures.x[i] - b.x - 0.5, creatures.y[i] - b.y - 0.5);
    const st = creatures.state[i];
    if (d <= WORK_RANGE) {
      j.best = d;
      j.stuck = 0;
    } else if (d < j.best - 0.5) {
      j.best = d;
      j.stuck = 0;
    } else if (st === STATE.TRAVEL || st === STATE.WANDER || st === STATE.WORK) {
      // Only time spent trying to get there counts (not eating, drinking or running away).
      if (++j.stuck >= STUCK_STEPS) {
        if (c.skip.length < 64) c.skip.push([j.id, b.id, tick + SKIP_TICKS]);
        continue;
      }
    }
    kept.push(j);
    count.set(b.id, (count.get(b.id) ?? 0) + 1);
  }
  c.jobs = kept;
  const working = new Set(kept.map((j) => j.id));
  const free = adults.filter((id) => !working.has(id));
  const foodShort = c.food < Math.max(10, s.members.length);
  const rank = (b: Building) => (!b.done || b.up ? (foodShort ? 1 : 0) : b.type === 'farm' ? (foodShort ? 0 : 1) : b.type === 'lumber' ? 2 : 3);
  const order = c.buildings.filter((b) => slotsOf(b) > 0).sort((a, b) => rank(a) - rank(b) || a.id - b.id);
  const give = (id: number, b: Building) => {
    const i = creatures.indexOf(id);
    c.jobs.push({ id, b: b.id, since: tick, best: Math.hypot(creatures.x[i] - b.x - 0.5, creatures.y[i] - b.y - 0.5), stuck: 0 });
    count.set(b.id, (count.get(b.id) ?? 0) + 1);
  };
  const canReach = (id: number, b: Building) => {
    const i = creatures.indexOf(id);
    return !skipped(id, b.id) && creatures.reachable(world, sp, Math.floor(creatures.x[i]), Math.floor(creatures.y[i]), b.x, b.y);
  };
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
        give(free[pick], b);
        free.splice(pick, 1);
        continue;
      }
      // Nobody free: take one settled worker from the least urgent work (once per step).
      if (moved) break;
      let from: Job | null = null;
      for (const j of c.jobs) {
        const jb = byId.get(j.b)!;
        if (rank(jb) <= rank(b) || tick - j.since < MIN_JOB_TICKS || !canReach(j.id, b)) continue;
        if (!from || rank(jb) > rank(byId.get(from.b)!) || (rank(jb) === rank(byId.get(from.b)!) && j.id < from.id)) from = j;
      }
      if (!from) break;
      c.jobs.splice(c.jobs.indexOf(from), 1);
      count.set(from.b, (count.get(from.b) ?? 1) - 1);
      give(from.id, b);
      moved = true;
    }
  }
}

function nearestTree(world: World, b: Building): number {
  let best = -1;
  let bd = Infinity;
  for (let y = Math.max(0, b.y - LUMBER_RADIUS); y <= Math.min(world.height - 1, b.y + LUMBER_RADIUS); y++) {
    for (let x = Math.max(0, b.x - LUMBER_RADIUS); x <= Math.min(world.width - 1, b.x + LUMBER_RADIUS); x++) {
      const d = Math.hypot(x - b.x, y - b.y);
      if (d <= LUMBER_RADIUS && d < bd && FOREST_TERRAIN.includes(world.terrain[y * world.width + x])) {
        bd = d;
        best = y * world.width + x;
      }
    }
  }
  return best;
}

function fellTree(world: World, b: Building): boolean {
  const i = nearestTree(world, b);
  if (i < 0) return false;
  world.setTerrain(i % world.width, Math.floor(i / world.width), T.GRASS);
  return true;
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
    if (!j || typeof j !== 'object' || typeof j.id !== 'number' || !Number.isInteger(j.id) || workers.has(j.id) || !ids.has(j.b)) continue;
    workers.add(j.id);
    c.jobs.push({ id: j.id, b: j.b, since: num(j.since, 0, 1e12, 0), best: num(j.best, 0, 1e6, 0), stuck: Math.floor(num(j.stuck, 0, STUCK_STEPS, 0)) });
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
