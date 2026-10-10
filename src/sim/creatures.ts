import { Rng } from '../core/rng';
import { T, isWater } from '../world/terrain';
import { EFFECT, EFFECT_COUNT } from './effects';
import { FOOD_CELL, FoodMap } from './foodmap';
import { MOVE, NO_BUDGET, NOT_FOUND, Pathfinder, UNREACHABLE, WaterField, isDrinkSpot, passable, type MoveClass } from './pathfinding';
import { NavScheduler, computeNav } from './navjobs';
import { LEG, RegionGraph } from './regions';
import { World } from '../world/world';

// ---------------------------------------------------------------------------
// Species catalogue (data-driven: add a species by adding an entry + sprite)
// ---------------------------------------------------------------------------

export type Diet = 'herbivore' | 'carnivore';
export type Habitat = 'land' | 'water';

export interface SpeciesDef {
  id: number;
  key: string;
  name: string;
  plural: string;
  diet: Diet;
  habitat: Habitat;
  /** Tiles moved per tick by a healthy adult. */
  speed: number;
  /** Sprite scale relative to one tile. */
  size: number;
  /** Ticks until adulthood / death of old age. */
  adultAge: number;
  maxAge: number;
  maxHealth: number;
  /** Need growth per tick (needs run 0..100). thirstRate 0 = never thirsty. */
  hungerRate: number;
  thirstRate: number;
  /** Herbivores: terrain ids they can eat. */
  food: readonly number[];
  /** Hunger removed per tick of eating (herbivores). */
  biteGain: number;
  /** Carnivores: species ids they hunt. */
  prey: readonly number[];
  /** Damage dealt per tick in contact with prey. */
  attack: number;
  /** Hunger removed by a kill. */
  meat: number;
  /** Where it can move (see pathfinding.ts): LAND, LOWLAND (no mountains/snow) or WATER. */
  move: MoveClass;
  /** Search radius in tiles for food, prey, mates and threats. */
  sight: number;
  breedCooldown: number;
  breedChance: number;
  /** Offspring per birth. */
  litter: number;
  /** Carrying capacity: breeding stops once this many others of the species share the parent's 8×8-tile cell. */
  crowdLimit: number;
  /** Share of MAX_CREATURES this species may occupy, so no species starves others of slots. */
  maxShare: number;
  color: string;
  /** Intelligent species (people): kept apart from animal settlements; later stages build civilizations on this. */
  sentient?: boolean;
  /** Colour of the dot that marks a person when zoomed far out (people only). */
  marker?: string;
  /** How a sentient species chooses where to live and who it lives with. A new people (elves, ...) is a new SpeciesDef with its own profile. */
  civ?: CivProfile;
}

export interface CivProfile {
  /** Liking (0..1) for each terrain around a possible home; terrain not listed counts 0. */
  affinity: Readonly<Record<number, number>>;
  /** Terrain this people never settles on (the spot itself). */
  avoid: readonly number[];
  /** Needs open water within reach of the home. */
  needsWater: boolean;
  /** Smallest group that founds a settlement by itself. */
  minFounders: number;
  /** Largest group that travels together. */
  groupMax: number;
  /** Other species that may live in its settlements and groups. Empty today: settlements and groups are single-species. */
  compatible: readonly number[];
  /** Weights of the site score (sites.ts): edible land, liked terrain, trees, rock and free land within reach. */
  weights: Readonly<{ food: number; like: number; trees: number; rock: number; space: number; coast: number }>;
  /** Least distance (tiles) from a new home to the centre of any existing settlement. */
  gap: number;
  /** Building style of its settlements (render/architecture.ts); the rules of buildings are shared by all peoples. */
  architecture: Architecture;
}

export type Architecture = 'human' | 'elven';

export const GRAZER = 0;
export const RAPTOR = 1;
export const HADROSAUR = 2;
export const TYRANT = 3;
export const FISH = 4;
export const HUMAN = 5;
export const ELF = 6;

export const SPECIES: readonly SpeciesDef[] = [
  {
    id: GRAZER, key: 'grazer', name: 'Grazer', plural: 'Grazers', diet: 'herbivore', habitat: 'land',
    speed: 0.11, size: 1, adultAge: 300, maxAge: 1900, maxHealth: 40, hungerRate: 0.25, thirstRate: 0.16,
    food: [T.GRASS, T.SAVANNA, T.TUNDRA, T.HILLS, T.SWAMP], biteGain: 3, prey: [], attack: 0, meat: 0,
    move: MOVE.LAND, sight: 8, breedCooldown: 240, breedChance: 0.03, litter: 2, crowdLimit: 3, maxShare: 0.45,
    color: '#efe6cf',
  },
  {
    id: RAPTOR, key: 'raptor', name: 'Raptor', plural: 'Raptors', diet: 'carnivore', habitat: 'land',
    speed: 0.18, size: 1, adultAge: 400, maxAge: 2600, maxHealth: 60, hungerRate: 0.15, thirstRate: 0.14,
    food: [], biteGain: 0, prey: [GRAZER, HUMAN, ELF], attack: 8, meat: 90,
    move: MOVE.LAND, sight: 14, breedCooldown: 420, breedChance: 0.02, litter: 1, crowdLimit: 2, maxShare: 0.15,
    color: '#c8502e',
  },
  {
    id: HADROSAUR, key: 'hadrosaur', name: 'Hadrosaur', plural: 'Hadrosaurs', diet: 'herbivore', habitat: 'land',
    speed: 0.09, size: 1.5, adultAge: 600, maxAge: 3400, maxHealth: 120, hungerRate: 0.2, thirstRate: 0.14,
    food: [T.FOREST, T.JUNGLE, T.SWAMP, T.GRASS], biteGain: 2.5, prey: [], attack: 0, meat: 0,
    move: MOVE.LOWLAND, sight: 10, breedCooldown: 480, breedChance: 0.02, litter: 1, crowdLimit: 2,
    maxShare: 0.25, color: '#6f8f4a',
  },
  {
    id: TYRANT, key: 'tyrant', name: 'Tyrant', plural: 'Tyrants', diet: 'carnivore', habitat: 'land',
    speed: 0.14, size: 1.8, adultAge: 900, maxAge: 4000, maxHealth: 220, hungerRate: 0.14, thirstRate: 0.12,
    food: [], biteGain: 0, prey: [HADROSAUR, GRAZER, HUMAN, ELF], attack: 25, meat: 100,
    move: MOVE.LOWLAND, sight: 13, breedCooldown: 600, breedChance: 0.015, litter: 1, crowdLimit: 3,
    maxShare: 0.05, color: '#7a3b2a',
  },
  {
    id: FISH, key: 'fish', name: 'Fish', plural: 'Fish', diet: 'herbivore', habitat: 'water',
    speed: 0.1, size: 0.8, adultAge: 250, maxAge: 1500, maxHealth: 20, hungerRate: 0.2, thirstRate: 0,
    food: [T.SHALLOW_WATER, T.RIVER, T.LAKE], biteGain: 3, prey: [], attack: 0, meat: 0,
    move: MOVE.WATER, sight: 8, breedCooldown: 200, breedChance: 0.03, litter: 2, crowdLimit: 3, maxShare: 0.3,
    color: '#9fc4d8',
  },
  {
    // People: available from the start of the game. They forage plants like other land animals (no hunting, tools,
    // buildings or economy yet), walk where lowland animals can, flee predators and can be hunted by them.
    id: HUMAN, key: 'human', name: 'Human', plural: 'Humans', diet: 'herbivore', habitat: 'land',
    speed: 0.12, size: 1, adultAge: 600, maxAge: 3000, maxHealth: 50, hungerRate: 0.17, thirstRate: 0.14,
    food: [T.GRASS, T.FOREST, T.JUNGLE, T.SAVANNA, T.HILLS], biteGain: 3, prey: [], attack: 0, meat: 0,
    move: MOVE.LOWLAND, sight: 12, breedCooldown: 500, breedChance: 0.02, litter: 1, crowdLimit: 3, maxShare: 0.2,
    color: '#e0a878', sentient: true, marker: '#6fa8ff',
    civ: {
      affinity: { [T.GRASS]: 1, [T.SAVANNA]: 0.8, [T.FOREST]: 0.7, [T.HILLS]: 0.5, [T.JUNGLE]: 0.5, [T.SAND]: 0.3, [T.TUNDRA]: 0.3, [T.SWAMP]: 0.2, [T.SOIL]: 0.4 },
      avoid: [T.DESERT, T.MOUNTAIN, T.SNOW, T.SWAMP],
      needsWater: true,
      minFounders: 4,
      groupMax: 24,
      compatible: [],
      weights: { food: 0.45, like: 0.3, trees: 0.1, rock: 0.05, space: 0.1, coast: 0.04 },
      gap: 16,
      architecture: 'human',
    },
  },
  {
    // Elves: a second people. The same needs, dangers, life cycle and settlement rules as humans; what differs is data:
    // they forage the woods, live longer but have children more rarely, travel in smaller groups, look for forest
    // with water and trees around it (rock matters little to them) and keep more distance from other settlements.
    id: ELF, key: 'elf', name: 'Elf', plural: 'Elves', diet: 'herbivore', habitat: 'land',
    speed: 0.13, size: 1, adultAge: 700, maxAge: 3800, maxHealth: 45, hungerRate: 0.16, thirstRate: 0.14,
    food: [T.FOREST, T.JUNGLE, T.GRASS, T.SAVANNA], biteGain: 3, prey: [], attack: 0, meat: 0,
    move: MOVE.LOWLAND, sight: 13, breedCooldown: 650, breedChance: 0.015, litter: 1, crowdLimit: 3, maxShare: 0.15,
    color: '#8fd08a', sentient: true, marker: '#7fe08a',
    civ: {
      affinity: { [T.FOREST]: 1, [T.JUNGLE]: 0.8, [T.GRASS]: 0.6, [T.HILLS]: 0.3, [T.SAVANNA]: 0.3, [T.TUNDRA]: 0.2, [T.SOIL]: 0.2, [T.SAND]: 0.1 },
      avoid: [T.DESERT, T.MOUNTAIN, T.SNOW, T.SWAMP],
      needsWater: true,
      minFounders: 4,
      groupMax: 16,
      compatible: [],
      weights: { food: 0.35, like: 0.3, trees: 0.25, rock: 0, space: 0.1, coast: 0.02 },
      gap: 20,
      architecture: 'elven',
    },
  },
];

/** For each species, the species that hunt it. */
export const PREDATORS_OF: readonly number[][] = SPECIES.map((s) =>
  SPECIES.filter((p) => p.prey.includes(s.id)).map((p) => p.id),
);

export const STATE = {
  WANDER: 0,
  SEEK_FOOD: 1,
  EAT: 2,
  SEEK_WATER: 3,
  DRINK: 4,
  HUNT: 5,
  FLEE: 6,
  SEEK_MATE: 7,
  /** Walking to a place chosen by the creature's group (or to a settlement). */
  TRAVEL: 8,
  /** At its workplace in a settlement (field, forest, quarry, building site). */
  WORK: 9,
} as const;
export const STATE_NAMES = [
  'Wandering', 'Looking for food', 'Eating', 'Looking for water', 'Drinking', 'Hunting', 'Fleeing', 'Looking for a mate', 'Traveling', 'Working',
];

export const CAUSE = {
  NONE: 0,
  STARVATION: 1,
  THIRST: 2,
  PREDATION: 3,
  OLD_AGE: 4,
  DROWNED: 5,
  STRANDED: 6,
  REMOVED: 7,
  FIRE: 8,
  METEOR: 9,
  EARTHQUAKE: 10,
  POISON: 11,
  LIGHTNING: 12,
} as const;
export const CAUSE_NAMES = [
  'unknown', 'starvation', 'thirst', 'predators', 'old age', 'drowning', 'stranding', 'divine removal', 'fire',
  'meteor', 'earthquake', 'poison', 'lightning',
];
export const CAUSE_COUNT = CAUSE_NAMES.length;
/** Damage per tick to an animal standing in fire, as a share of its max health. */
const FIRE_DAMAGE = 0.08;
/** How far (tiles) an animal in the wrong terrain looks for a place it can live, and health lost per tick meanwhile. */
const ESCAPE_RADIUS = 8;
const ESCAPE_DAMAGE = 0.045;
/** Animals notice fire this many tiles away and run from it. */
const FIRE_SIGHT = 3;
/** How far (tiles) an animal on blocked ground looks for a tile it can use. */
const UNSTICK_RADIUS = 4;
/** How far a creature walled in by raised ground is carried to the nearest usable tile. */
export const RESCUE_RADIUS = 24;

export const MAX_CREATURES = 6000;

const GRID = 8;
const THINK_EVERY = 4;
const HUNGRY = 40;
const THIRSTY = 50;
const SATED = 8;
/** A traveller counts as arrived within this many tiles of its goal. */
const ARRIVED = 2.5;
const ATTACK_RANGE = 0.8;
/** Waypoints stored per creature; longer routes are re-planned when the stored part is used up. */
export const PATH_MAX = 32;
/** Total search node expansions allowed per simulation tick (shared by all creatures). */
export const NODE_BUDGET = 40000;
/**
 * Minimum ticks between navigation rebuilds (water field + region graph) after
 * passability changes. Weather changes terrain often; routes are re-validated
 * step by step, so slightly stale navigation data is safe.
 */
const FIELD_REBUILD_TICKS = 60;
/** Radius (in 8×8 grid cells) a hungry predator scans for prey-rich areas. */
const PROWL_CELLS = 6;
/** Ticks between food-map rebuilds. */
const FOOD_MAP_TICKS = 50;
/** How far (in food-map cells) a hungry herbivore looks for somewhere to migrate. */
const MIGRATE_RINGS = 16;
/** Prey needed within sight per predator before predators breed. */
const PREY_PER_PREDATOR = 3;
/** Thirst above which water beats food, however hungry the animal is. */
const CRITICAL_THIRST = 85;
/** A chase that hasn't ended in a kill after this many ticks is abandoned. */
const MAX_CHASE_TICKS = 250;
/** Within this distance a predator pounces (short burst of speed). */
const POUNCE_RANGE = 2.5;

export type LifeStage = 'Juvenile' | 'Adult' | 'Elder';

export interface CreatureInfo {
  id: number;
  species: SpeciesDef;
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  hunger: number;
  thirst: number;
  ageTicks: number;
  stage: LifeStage;
  state: string;
  /** Active buffs/debuffs: effect id, remaining ticks, strength 1..3. */
  effects: Array<{ id: number; ticks: number; power: number }>;
  effectMask: number;
}

export interface DeathRecord {
  id: number;
  species: number;
  cause: number;
}

/** Whether a species may live on a tile (land animals wade in rivers; fish need water). */
function habitatOk(world: World, sp: SpeciesDef, tx: number, ty: number): boolean {
  if (!world.inBounds(tx, ty)) return false;
  const id = world.terrain[world.idx(tx, ty)];
  if (sp.move === MOVE.WATER) return isWater(id);
  return !isWater(id) || id === T.RIVER;
}

/**
 * Creatures stored as structure-of-arrays (one typed array per field) so thousands of
 * them stay cheap to update and trivial to serialise. Updated once per simulation
 * tick, never per rendered frame.
 */
export class Creatures {
  count = 0;
  /** Next unique id (ids are never reused; 0 means "none"). */
  nextId = 1;

  readonly id = new Uint32Array(MAX_CREATURES);
  readonly species = new Uint8Array(MAX_CREATURES);
  readonly x = new Float32Array(MAX_CREATURES);
  readonly y = new Float32Array(MAX_CREATURES);
  /** Position at the start of the last tick, for smooth rendering between ticks. */
  readonly px = new Float32Array(MAX_CREATURES);
  readonly py = new Float32Array(MAX_CREATURES);
  readonly dx = new Float32Array(MAX_CREATURES);
  readonly dy = new Float32Array(MAX_CREATURES);
  readonly health = new Float32Array(MAX_CREATURES);
  readonly hunger = new Float32Array(MAX_CREATURES);
  readonly thirst = new Float32Array(MAX_CREATURES);
  readonly age = new Float32Array(MAX_CREATURES);
  readonly state = new Uint8Array(MAX_CREATURES);
  /** Point to move away from while fleeing (the threat's position). */
  readonly tx = new Float32Array(MAX_CREATURES);
  readonly ty = new Float32Array(MAX_CREATURES);
  /** Hunted creature id for HUNT. */
  readonly targetId = new Uint32Array(MAX_CREATURES);
  /** Ticks left committed to the current wander/flee heading, or before a hunt re-plan. */
  readonly timer = new Uint16Array(MAX_CREATURES);
  readonly breedTimer = new Uint16Array(MAX_CREATURES);
  /** Ticks before a failed search may run again (keeps animals with no options cheap). */
  readonly searchCd = new Uint8Array(MAX_CREATURES);
  /** Last cause of damage, used to attribute death. */
  readonly harm = new Uint8Array(MAX_CREATURES);
  /** Planned route: tile indices path[i * PATH_MAX + k] for k < pathLen; pathPos = next waypoint. */
  readonly path = new Int32Array(MAX_CREATURES * PATH_MAX);
  readonly pathLen = new Uint8Array(MAX_CREATURES);
  readonly pathPos = new Uint8Array(MAX_CREATURES);
  /** Tile the path was planned to (the goal; may lie beyond a truncated path). */
  readonly pathGoal = new Int32Array(MAX_CREATURES);
  /** Ticks spent on the current chase (a chase is abandoned after MAX_CHASE_TICKS). */
  readonly huntTicks = new Uint16Array(MAX_CREATURES);
  /** A prey id this predator found unreachable or too fast; skipped when choosing targets. */
  readonly ignoreId = new Uint32Array(MAX_CREATURES);
  /** Buffs/debuffs: remaining ticks and strength per (creature, effect); mask = bit per active effect. */
  readonly effTicks = new Uint16Array(MAX_CREATURES * EFFECT_COUNT);
  readonly effPower = new Uint8Array(MAX_CREATURES * EFFECT_COUNT);
  readonly effMask = new Uint8Array(MAX_CREATURES);
  private readonly dead = new Uint8Array(MAX_CREATURES);

  private readonly fields = [
    this.id, this.species, this.x, this.y, this.px, this.py, this.dx, this.dy, this.health, this.hunger,
    this.thirst, this.age, this.state, this.tx, this.ty, this.targetId, this.timer, this.breedTimer, this.harm,
    this.searchCd, this.pathLen, this.pathPos, this.pathGoal, this.huntTicks, this.ignoreId, this.effMask, this.dead,
  ];

  births = 0;
  deaths = 0;
  /** deathStats[species * CAUSE_COUNT + cause]. */
  readonly deathStats = new Uint32Array(SPECIES.length * CAUSE_COUNT);
  readonly birthStats = new Uint32Array(SPECIES.length);
  /** Told of every birth (child id, parent id); settlements use it to keep their population exact. */
  onBirth: ((childId: number, parentId: number) => void) | null = null;
  /** Returns true when the creature may not breed (a settlement whose housing is full). */
  breedBlock: ((id: number) => boolean) | null = null;
  /** The tile (index) a creature's group wants it to walk to, or -1. Asked when a creature has no pressing need. */
  groupGoal: ((id: number) => number) | null = null;
  /** Workplace tile of a settlement worker (-1 = no job); it wins over the group goal. */
  workGoal: ((id: number) => number) | null = null;
  /** Told when a creature dies or is removed (its id). */
  onDeath: ((id: number) => void) | null = null;
  /** Deaths since the last call to drainDeaths() (for UI/history). */
  private recentDeaths: DeathRecord[] = [];

  /** Optional thirst multiplier by position (weather: drought makes animals thirstier). */
  envThirst: ((x: number, y: number) => number) | null = null;
  /** Set by the simulation when any tile is burning; skips fire checks otherwise. */
  anyFire = false;
  /** Animal-ticks spent standing on blocked ground (statistics and tests). */
  trapped = 0;
  /** Creatures carried out of ground they were walled in by (diagnostics). */
  rescued = 0;
  /** Zones to run from (around meteors about to land), set by Simulation each tick; empty most of the time. */
  dangers: Array<{ x: number; y: number; r: number }> = [];

  /** Shared grid search and water-distance field (see pathfinding.ts). */
  readonly pathfinder = new Pathfinder();
  readonly water = new WaterField();
  /** Coarse region graph for long routes and instant reachability checks. */
  readonly regions = new RegionGraph();
  /** Off-thread (worker) navigation rebuilds with a deterministic delivery tick. */
  readonly nav = new NavScheduler();
  /** Coarse food availability per diet. */
  readonly foodMap = new FoodMap(SPECIES.map((s) => s.food));
  private fieldWorld: World | null = null;
  private lastFieldBuild = -Infinity;
  /** Terrain snapshot the installed navigation data was built from (saved, for exact reloads). */
  private navTerrain: Uint8Array | null = null;
  private navVersion = 0;

  // Spatial hash of all creatures, rebuilt every tick (linked lists in typed arrays).
  private gridHead = new Int32Array(0);
  private readonly gridNext = new Int32Array(MAX_CREATURES);
  private gridW = 0;
  private gridH = 0;
  private crowd: Uint16Array[] = SPECIES.map(() => new Uint16Array(0));
  private readonly speciesCount = new Uint32Array(SPECIES.length);
  private readonly byId = new Map<number, number>();

  // ---- queries ---------------------------------------------------------

  /** Living creatures per species, in one pass. */
  countAll(): Uint32Array {
    const out = new Uint32Array(SPECIES.length);
    for (let i = 0; i < this.count; i++) if (!this.dead[i]) out[this.species[i]]++;
    return out;
  }

  /** Rebuilds the id → index lookup (after bulk loading arrays, e.g. from a save). */
  reindex(): void {
    this.byId.clear();
    for (let i = 0; i < this.count; i++) this.byId.set(this.id[i], i);
  }

  countSpecies(species: number): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.species[i] === species && !this.dead[i]) n++;
    return n;
  }

  /** Whether a land species can walk from one tile to another (true while the region map is not ready yet, so callers do not stall). */
  reachable(world: World, species: number, ax: number, ay: number, bx: number, by: number): boolean {
    if (this.fieldWorld !== world) return true;
    const w = world.width;
    return this.regions.connected(SPECIES[species].move, ay * w + ax, by * w + bx);
  }

  /** Whether the creature at index i is alive. */
  isAlive(i: number): boolean {
    return i >= 0 && i < this.count && !this.dead[i];
  }

  /** Current index of a creature id, or -1 if it no longer exists. */
  indexOf(id: number): number {
    if (!id) return -1;
    const cached = this.byId.get(id);
    if (cached !== undefined && cached < this.count && this.id[cached] === id && !this.dead[cached]) return cached;
    for (let i = 0; i < this.count; i++) if (this.id[i] === id && !this.dead[i]) return i;
    return -1;
  }

  /** Nearest living creature to (x, y) within radius, or -1. */
  nearestAt(x: number, y: number, radius: number): number {
    let best = -1;
    let bestD = radius * radius;
    for (let i = 0; i < this.count; i++) {
      if (this.dead[i]) continue;
      const ddx = this.x[i] - x;
      const ddy = this.y[i] - y;
      const d = ddx * ddx + ddy * ddy;
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /**
   * Creatures near a tap, nearest first. A creature counts as touched when the tap is near its feet or near
   * the middle of its sprite (drawn above its position), so tapping the picture selects it.
   */
  candidatesAt(x: number, y: number, radius: number, max = 6): number[] {
    const out: Array<{ i: number; d: number }> = [];
    for (let i = 0; i < this.count; i++) {
      if (this.dead[i]) continue;
      const lift = SPECIES[this.species[i]].size * 0.3;
      const d = Math.min(Math.hypot(this.x[i] - x, this.y[i] - y), Math.hypot(this.x[i] - x, this.y[i] - lift - y));
      if (d <= radius) out.push({ i, d });
    }
    out.sort((a, b) => a.d - b.d || this.id[a.i] - this.id[b.i]);
    return out.slice(0, max).map((o) => o.i);
  }

  stage(i: number): LifeStage {
    const sp = SPECIES[this.species[i]];
    if (this.age[i] < sp.adultAge) return 'Juvenile';
    if (this.age[i] > sp.maxAge * 0.8) return 'Elder';
    return 'Adult';
  }

  info(i: number): CreatureInfo {
    const sp = SPECIES[this.species[i]];
    return {
      id: this.id[i],
      species: sp,
      x: this.x[i],
      y: this.y[i],
      health: this.health[i],
      maxHealth: sp.maxHealth,
      hunger: this.hunger[i],
      thirst: this.thirst[i],
      ageTicks: this.age[i],
      stage: this.stage(i),
      state: STATE_NAMES[this.state[i]],
      effects: Array.from({ length: EFFECT_COUNT }, (_, e) => ({ id: e, ticks: this.effectTicks(i, e), power: this.effectPower(i, e) }))
        .filter((x) => x.ticks > 0),
      effectMask: this.effMask[i],
    };
  }

  deathsBy(species: number, cause: number): number {
    return this.deathStats[species * CAUSE_COUNT + cause];
  }

  /** Returns and clears deaths recorded since the last call. */
  drainDeaths(): DeathRecord[] {
    const d = this.recentDeaths;
    this.recentDeaths = [];
    return d;
  }

  // ---- habitat ---------------------------------------------------------

  /** Whether a species may stand on the given tile. */
  static canEnter(world: World, species: number, tx: number, ty: number): boolean {
    return passable(world, SPECIES[species].move, tx, ty);
  }

  // ---- lifecycle -------------------------------------------------------

  /**
   * Adds a creature. Returns its id, or 0 if the population is full.
   * Player-spawned creatures start as young adults so they can breed.
   */
  spawn(species: number, x: number, y: number, rng: Rng, opts: { age?: number; hunger?: number; thirst?: number } = {}): number {
    if (this.count >= MAX_CREATURES) return 0;
    const sp = SPECIES[species];
    const i = this.count++;
    const a = rng.next() * Math.PI * 2;
    const id = this.nextId++;
    this.id[i] = id;
    this.species[i] = species;
    this.x[i] = this.px[i] = x;
    this.y[i] = this.py[i] = y;
    this.dx[i] = Math.cos(a);
    this.dy[i] = Math.sin(a);
    this.health[i] = sp.maxHealth;
    this.hunger[i] = opts.hunger ?? 20;
    this.thirst[i] = sp.thirstRate > 0 ? (opts.thirst ?? 20) : 0;
    this.age[i] = opts.age ?? sp.adultAge;
    this.state[i] = STATE.WANDER;
    this.tx[i] = this.ty[i] = 0;
    this.targetId[i] = 0;
    this.timer[i] = 0;
    this.breedTimer[i] = Math.floor(sp.breedCooldown / 2);
    this.harm[i] = CAUSE.NONE;
    this.searchCd[i] = 0;
    this.pathLen[i] = this.pathPos[i] = 0;
    this.pathGoal[i] = -1;
    this.huntTicks[i] = 0;
    this.ignoreId[i] = 0;
    this.effMask[i] = 0;
    this.effTicks.fill(0, i * EFFECT_COUNT, i * EFFECT_COUNT + EFFECT_COUNT);
    this.effPower.fill(0, i * EFFECT_COUNT, i * EFFECT_COUNT + EFFECT_COUNT);
    this.dead[i] = 0;
    this.byId.set(id, i);
    return id;
  }

  /** Removes every creature within radius. Returns how many were removed. */
  removeInCircle(cx: number, cy: number, r: number): number {
    let removed = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.dead[i]) continue;
      const ddx = this.x[i] - cx;
      const ddy = this.y[i] - cy;
      if (ddx * ddx + ddy * ddy <= r * r) {
        this.kill(i, CAUSE.REMOVED);
        removed++;
      }
    }
    this.compact();
    return removed;
  }

  // ---- buffs & debuffs ---------------------------------------------------

  /** Strength (0 = inactive) of an effect on creature i. */
  effectPower(i: number, e: number): number {
    return this.effMask[i] & (1 << e) ? this.effPower[i * EFFECT_COUNT + e] : 0;
  }

  effectTicks(i: number, e: number): number {
    return this.effMask[i] & (1 << e) ? this.effTicks[i * EFFECT_COUNT + e] : 0;
  }

  /**
   * Applies an effect (rules in effects.ts): refreshes the duration (longest
   * wins), sets the strength 1..3, and removes the opposite effect.
   */
  applyEffect(i: number, e: number, ticks: number, power: number, opposite: number): void {
    if (opposite >= 0) this.removeEffect(i, opposite);
    const k = i * EFFECT_COUNT + e;
    const active = this.effMask[i] & (1 << e);
    this.effTicks[k] = Math.min(65535, Math.max(active ? this.effTicks[k] : 0, ticks));
    this.effPower[k] = Math.max(1, Math.min(3, power));
    this.effMask[i] |= 1 << e;
  }

  removeEffect(i: number, e: number): void {
    this.effMask[i] &= ~(1 << e);
    this.effTicks[i * EFFECT_COUNT + e] = 0;
    this.effPower[i * EFFECT_COUNT + e] = 0;
  }

  clearEffects(i: number): void {
    for (let e = 0; e < EFFECT_COUNT; e++) this.removeEffect(i, e);
  }

  /** Living creatures within radius r of a point. */
  inCircle(cx: number, cy: number, r: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.count; i++) {
      if (this.dead[i]) continue;
      if (Math.hypot(this.x[i] - cx, this.y[i] - cy) <= r) out.push(i);
    }
    return out;
  }

  /** Counts down creature i's effects and applies regeneration, poison and fertility. */
  private tickEffects(i: number, maxHealth: number): void {
    const m = this.effMask[i];
    const base = i * EFFECT_COUNT;
    for (let e = 0; e < EFFECT_COUNT; e++) {
      if (!(m & (1 << e))) continue;
      const p = this.effPower[base + e];
      if (e === EFFECT.REGEN) this.health[i] = Math.min(maxHealth, this.health[i] + maxHealth * 0.004 * p);
      else if (e === EFFECT.POISON) {
        this.health[i] -= maxHealth * 0.002 * p;
        this.harm[i] = CAUSE.POISON;
      } else if (e === EFFECT.FERTILE && this.breedTimer[i] > 0) {
        this.breedTimer[i] = Math.max(0, this.breedTimer[i] - p);
      }
      if (--this.effTicks[base + e] === 0) this.removeEffect(i, e);
    }
  }

  /**
   * Damages every creature within radius r of (cx, cy). damage(d) gives the share
   * of max health lost at normalised distance d (0 at the centre, 1 at the edge).
   * Returns how many died.
   */
  hurtInCircle(cx: number, cy: number, r: number, damage: (d: number) => number, cause: number): number {
    let killed = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.dead[i]) continue;
      const d = Math.hypot(this.x[i] - cx, this.y[i] - cy) / r;
      if (d > 1) continue;
      const sp = SPECIES[this.species[i]];
      this.health[i] -= sp.maxHealth * damage(d);
      this.harm[i] = cause;
      if (this.health[i] <= 0) {
        this.kill(i, cause);
        killed++;
      }
    }
    this.compact();
    return killed;
  }

  /** A burning tile within FIRE_SIGHT tiles of creature i, or -1. */
  private nearbyFire(world: World, i: number): number {
    const tx = Math.floor(this.x[i]);
    const ty = Math.floor(this.y[i]);
    for (let dy = -FIRE_SIGHT; dy <= FIRE_SIGHT; dy++) {
      for (let dx = -FIRE_SIGHT; dx <= FIRE_SIGHT; dx++) {
        const x = tx + dx;
        const y = ty + dy;
        if (world.inBounds(x, y) && world.fire[y * world.width + x]) return y * world.width + x;
      }
    }
    return -1;
  }

  removeById(id: number): boolean {
    const i = this.indexOf(id);
    if (i < 0) return false;
    this.kill(i, CAUSE.REMOVED);
    this.compact();
    return true;
  }

  clear(): void {
    this.count = 0;
    this.nextId = 1;
    this.births = 0;
    this.deaths = 0;
    this.deathStats.fill(0);
    this.birthStats.fill(0);
    this.recentDeaths = [];
    this.byId.clear();
    this.fieldWorld = null;
    this.lastFieldBuild = -Infinity;
    this.foodMap.builtTick = -Infinity;
    this.navTerrain = null;
    this.nav.cancel();
  }

  // ---- simulation ------------------------------------------------------

  /** Rebuilds the shared water field if the map's passability changed (throttled). */
  /**
   * Rebuilds shared navigation data when the map's passability changed (water
   * field + region graph, throttled) and refreshes the food map periodically.
   */
  private updateNavigation(world: World, tick: number): void {
    this.foodMap.update(world, tick, FOOD_MAP_TICKS);
    if (this.fieldWorld !== world) {
      // New or loaded world: navigation is needed right away.
      this.nav.cancel();
      this.water.build(world);
      this.regions.build(world);
      this.navTerrain = world.navCodes();
      this.navVersion = world.passVersion;
      this.fieldWorld = world;
      this.lastFieldBuild = tick;
      return;
    }
    const due = this.nav.takeDue(tick);
    if (due) {
      this.water.apply(world, due.result.water, due.result.passVersion);
      this.regions.apply(world, due.result.regions, due.result.passVersion);
      this.navTerrain = due.snapshot;
      this.navVersion = due.result.passVersion;
    }
    if (!this.nav.busy && this.water.isStale(world) && tick - this.lastFieldBuild >= FIELD_REBUILD_TICKS) {
      this.nav.request(world, tick);
      this.lastFieldBuild = tick;
    }
  }

  tick(world: World, rng: Rng, tick: number): void {
    this.updateNavigation(world, tick);
    this.pathfinder.beginTick(NODE_BUDGET);
    this.buildGrid(world);
    const n = this.count; // newborns appended this tick act next tick
    for (let i = 0; i < n; i++) {
      this.px[i] = this.x[i];
      this.py[i] = this.y[i];
    }
    for (let i = 0; i < n; i++) {
      if (this.dead[i]) continue;
      const sp = SPECIES[this.species[i]];

      // Ageing and needs.
      this.age[i] += 1;
      if (this.breedTimer[i] > 0) this.breedTimer[i]--;
      if (this.searchCd[i] > 0) this.searchCd[i]--;
      const exertion = this.state[i] === STATE.FLEE || this.state[i] === STATE.HUNT ? 1.5 : 1;
      let needs = 1;
      if (this.effMask[i]) {
        if (this.effMask[i] & (1 << EFFECT.FED)) needs = 0;
        else if (this.effMask[i] & (1 << EFFECT.FAMINE)) needs = 1 + 0.5 * this.effectPower(i, EFFECT.FAMINE);
        this.tickEffects(i, sp.maxHealth);
      }
      this.hunger[i] = Math.min(100, this.hunger[i] + sp.hungerRate * exertion * needs);
      const env = this.envThirst && sp.thirstRate > 0 ? this.envThirst(this.x[i], this.y[i]) : 1;
      this.thirst[i] = Math.min(100, this.thirst[i] + sp.thirstRate * exertion * env * needs);

      // Habitat check (the player may have flooded or drained the tile).
      const cx = Math.floor(this.x[i]);
      const cy = Math.floor(this.y[i]);
      if (!habitatOk(world, sp, cx, cy)) {
        // Flooded, drained or hit by a crater: swim or scramble to the nearest place it can live
        // (within ESCAPE_RADIUS), losing health meanwhile; with nowhere close, it dies at once.
        const cause = sp.move === MOVE.WATER ? CAUSE.STRANDED : CAUSE.DROWNED;
        if (!this.escape(world, i, sp, cx, cy)) {
          this.kill(i, cause);
          continue;
        }
        this.health[i] -= sp.maxHealth * ESCAPE_DAMAGE;
        this.harm[i] = cause;
        if (this.health[i] <= 0) this.kill(i, cause);
        continue; // all of its effort goes into getting out
      }

      // Standing on ground this species cannot use (new snow cover, a cliff raised underneath…).
      if (!passable(world, sp.move, cx, cy)) {
        this.unstick(world, i, sp, cx, cy);
        continue;
      }

      // Fire burns anything standing in it.
      if (world.fire[world.idx(cx, cy)]) {
        this.health[i] -= sp.maxHealth * FIRE_DAMAGE;
        this.harm[i] = CAUSE.FIRE;
      }

      // Health: starvation and thirst hurt, being fed heals.
      if (this.hunger[i] >= 100) {
        this.health[i] -= sp.maxHealth * 0.004;
        this.harm[i] = CAUSE.STARVATION;
      }
      if (this.thirst[i] >= 100) {
        this.health[i] -= sp.maxHealth * 0.006;
        this.harm[i] = CAUSE.THIRST;
      }
      if (this.hunger[i] < 60 && this.thirst[i] < 60) {
        this.health[i] = Math.min(sp.maxHealth, this.health[i] + sp.maxHealth * 0.002);
      }
      if (this.health[i] <= 0) {
        this.kill(i, this.harm[i] || CAUSE.STARVATION);
        continue;
      }
      if (this.age[i] > sp.maxAge) {
        this.kill(i, CAUSE.OLD_AGE);
        continue;
      }

      if ((tick + this.id[i]) % THINK_EVERY === 0) this.think(world, rng, i);
      this.act(world, rng, i);
      this.tryBreed(world, rng, i);
    }
    this.compact();
  }

  /**
   * Moves a creature that is standing where it cannot live toward the nearest tile
   * it can, within the distance it can cover before its health runs out. It ignores
   * the usual terrain rules for this short dash (a fish must cross dry land to reach
   * water, a grazer must wade out of a pond). Returns false if there is no such tile.
   */
  private escape(world: World, i: number, sp: SpeciesDef, cx: number, cy: number): boolean {
    const v = this.speedOf(i) * 1.25;
    const reach = Math.min(ESCAPE_RADIUS, (this.health[i] / (sp.maxHealth * ESCAPE_DAMAGE)) * v + 0.8);
    let bx = -1;
    let by = -1;
    let bd = Infinity;
    for (let r = 1; r <= Math.ceil(reach) && bx < 0; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (!Creatures.canEnter(world, sp.id, cx + dx, cy + dy)) continue;
          const d = dx * dx + dy * dy;
          if (d <= reach * reach && d < bd) {
            bd = d;
            bx = cx + dx;
            by = cy + dy;
          }
        }
      }
    }
    if (bx < 0) return false;
    const ux = bx + 0.5 - this.x[i];
    const uy = by + 0.5 - this.y[i];
    const d = Math.hypot(ux, uy) || 1;
    const step = Math.min(v, d);
    this.dx[i] = ux / d;
    this.dy[i] = uy / d;
    this.x[i] += this.dx[i] * step;
    this.y[i] += this.dy[i] * step;
    this.clearPath(i);
    this.state[i] = STATE.FLEE;
    this.timer[i] = 4;
    return true;
  }

  /** Chooses a behaviour. Runs every few ticks per creature (staggered by id). */
  private think(world: World, rng: Rng, i: number): void {
    const sp = SPECIES[this.species[i]];
    const s = this.state[i];

    // 1. Danger first. Keep the current escape heading for a while to avoid dithering.
    for (const z of this.dangers) {
      if (Math.hypot(this.x[i] - z.x, this.y[i] - z.y) < z.r) {
        this.tx[i] = z.x;
        this.ty[i] = z.y;
        this.clearPath(i);
        this.state[i] = STATE.FLEE;
        this.chooseHeading(world, rng, i, z.x, z.y);
        this.timer[i] = 14;
        return;
      }
    }
    const fire = this.anyFire ? this.nearbyFire(world, i) : -1;
    if (fire >= 0) {
      const fx = (fire % world.width) + 0.5;
      const fy = Math.floor(fire / world.width) + 0.5;
      this.tx[i] = fx;
      this.ty[i] = fy;
      this.clearPath(i);
      this.state[i] = STATE.FLEE;
      this.chooseHeading(world, rng, i, fx, fy);
      this.timer[i] = 12;
      return;
    }
    const threats = PREDATORS_OF[sp.id];
    if (threats.length) {
      const p = this.nearestOf(threats, this.x[i], this.y[i], Math.min(sp.sight, 6), i, 0);
      if (p >= 0) {
        this.tx[i] = this.x[p];
        this.ty[i] = this.y[p];
        if (s !== STATE.FLEE || this.timer[i] < 6) {
          this.clearPath(i);
          this.state[i] = STATE.FLEE;
          this.chooseHeading(world, rng, i, this.x[p], this.y[p]);
          this.timer[i] = 16;
        }
        return;
      }
    }
    if (s === STATE.FLEE && this.timer[i] > 0) return;

    // 2. Keep eating/drinking until sated.
    if (s === STATE.EAT && this.hunger[i] > SATED) return;
    if (s === STATE.DRINK && this.thirst[i] > SATED) return;

    // 3. Most pressing need.
    const canSearch = this.searchCd[i] === 0;
    const thirsty = sp.thirstRate > 0 && this.thirst[i] > THIRSTY;
    const hungry = this.hunger[i] > HUNGRY;
    if (thirsty && (!hungry || this.thirst[i] >= this.hunger[i] || this.thirst[i] > CRITICAL_THIRST)) {
      if (s !== STATE.SEEK_WATER && canSearch) this.seekWater(world, i);
      return;
    }
    if (hungry) {
      if (sp.diet === 'carnivore') this.seekPrey(world, i);
      else if (s !== STATE.SEEK_FOOD && canSearch) this.seekFood(world, i);
      return;
    }
    if (thirsty) {
      if (s !== STATE.SEEK_WATER && canSearch) this.seekWater(world, i);
      return;
    }

    // 4. No pressing needs: look for a mate if ready to breed. The route is re-planned
    //    when the mate has moved, and a pair within breeding range waits (courtship).
    if (canSearch && this.readyToBreed(i) && this.roomToBreed(i)) {
      const m = this.nearestMate(i, sp.sight * 1.5);
      if (m >= 0) {
        const mx = Math.floor(this.x[m]);
        const my = Math.floor(this.y[m]);
        const near = Math.hypot(this.x[m] - this.x[i], this.y[m] - this.y[i]) < 3;
        const g = this.pathGoal[i];
        const w = world.width;
        const stale = g < 0 || Math.max(Math.abs((g % w) - mx), Math.abs(Math.floor(g / w) - my)) > 2;
        if (near || (s === STATE.SEEK_MATE && !stale && this.pathPos[i] < this.pathLen[i])) {
          this.state[i] = STATE.SEEK_MATE;
          if (near) this.clearPath(i);
          return;
        }
        const r = this.planTo(world, i, mx, my, 1500);
        if (r >= 0) {
          this.state[i] = STATE.SEEK_MATE;
          return;
        }
        if (r === NOT_FOUND) this.searchCd[i] = 20;
        if (r === NO_BUDGET && s === STATE.SEEK_MATE) return;
      }
    }
    // 5. Nothing pressing: follow the group's wish (a place to go to, or back to the others).
    //    A settlement job comes first: walk to the workplace, then work there.
    if (this.groupGoal || this.workGoal) {
      const work = this.workGoal ? this.workGoal(this.id[i]) : -1;
      const goal = work >= 0 ? work : this.groupGoal ? this.groupGoal(this.id[i]) : -1;
      if (goal >= 0) {
        const gx = goal % world.width;
        const gy = Math.floor(goal / world.width);
        if (Math.hypot(this.x[i] - gx - 0.5, this.y[i] - gy - 0.5) <= ARRIVED) {
          if (work >= 0) {
            if (s !== STATE.WORK) {
              this.state[i] = STATE.WORK;
              this.clearPath(i);
            }
            return;
          }
          if (s === STATE.TRAVEL) {
            this.state[i] = STATE.WANDER;
            this.clearPath(i);
          }
          return;
        }
        if (s === STATE.TRAVEL && this.pathGoal[i] === goal) return; // already on the way
        if (canSearch) {
          const r = this.planTo(world, i, gx, gy, 2500);
          if (r >= 0) {
            this.state[i] = STATE.TRAVEL;
            return;
          }
          if (r === NOT_FOUND) this.searchCd[i] = 60;
        }
        if (s === STATE.TRAVEL) return; // keep going while a plan is pending
      }
    }
    if (s !== STATE.WANDER) {
      this.state[i] = STATE.WANDER;
      this.clearPath(i);
    }
  }

  private act(world: World, rng: Rng, i: number): void {
    const sp = SPECIES[this.species[i]];
    const tx = Math.floor(this.x[i]);
    const ty = Math.floor(this.y[i]);
    const wading = sp.move !== MOVE.WATER && world.terrain[world.idx(tx, ty)] === T.RIVER;
    const speed = this.speedOf(i) * (wading ? 0.6 : 1);

    switch (this.state[i]) {
      case STATE.EAT: {
        const ti = world.idx(tx, ty);
        const terrain = world.terrain[ti];
        if (!sp.food.includes(terrain)) {
          this.state[i] = STATE.WANDER;
          break;
        }
        this.hunger[i] = Math.max(0, this.hunger[i] - sp.biteGain);
        // Grazing wears open land down to soil; browsing thins forest to grassland.
        if ((terrain === T.GRASS || terrain === T.SAVANNA || terrain === T.TUNDRA || terrain === T.HILLS) && sp.id === GRAZER) {
          if (rng.chance(0.01)) world.setTerrain(tx, ty, T.SOIL);
        } else if ((terrain === T.FOREST || terrain === T.JUNGLE) && rng.chance(0.004)) {
          world.setTerrain(tx, ty, T.GRASS);
        }
        if (this.hunger[i] <= SATED) this.state[i] = STATE.WANDER;
        break;
      }
      case STATE.DRINK:
        if (!isDrinkSpot(world, tx, ty)) {
          this.state[i] = STATE.WANDER;
          break;
        }
        this.thirst[i] = Math.max(0, this.thirst[i] - 5);
        if (this.thirst[i] <= SATED) this.state[i] = STATE.WANDER;
        break;
      case STATE.SEEK_FOOD:
        if (sp.diet === 'herbivore' && sp.food.includes(world.terrain[world.idx(tx, ty)])) {
          this.clearPath(i);
          this.state[i] = STATE.EAT;
          break;
        }
        // Herbivores walk to (or migrate toward) food; predators prowl toward prey-rich ground.
        {
          const res = this.followPath(world, i, speed);
          if (res === 'done' && this.continueRoute(world, i)) break;
          if (res !== 'moving') {
            this.clearPath(i);
            this.state[i] = STATE.WANDER;
          }
        }
        break;
      case STATE.SEEK_WATER: {
        if (isDrinkSpot(world, tx, ty)) {
          this.state[i] = STATE.DRINK;
          break;
        }
        const next = this.water.nextStep(world, sp.move, tx, ty);
        if (next < 0) {
          this.state[i] = STATE.WANDER; // no reachable water from here (or field not ready)
          this.searchCd[i] = 24;
          break;
        }
        const w = world.width;
        this.moveToPoint(world, i, (next % w) + 0.5, Math.floor(next / w) + 0.5, speed);
        break;
      }
      case STATE.HUNT:
        this.actHunt(world, rng, i, speed);
        break;
      case STATE.TRAVEL: {
        const res = this.followPath(world, i, speed * 0.9);
        if (res === 'done' && this.continueRoute(world, i)) break;
        if (res !== 'moving') {
          this.clearPath(i);
          this.state[i] = STATE.WANDER;
        }
        break;
      }
      case STATE.WORK:
        break; // stays at the workplace; the settlement counts the work
      case STATE.SEEK_MATE:
        // With no route left the pair is together (courtship): wait for the breeding roll.
        if (this.pathPos[i] >= this.pathLen[i]) {
          if (this.pathGoal[i] >= 0 && !this.continueRoute(world, i)) this.pathGoal[i] = -1;
          break;
        }
        if (this.followPath(world, i, speed * 0.8) === 'blocked') this.clearPath(i);
        break;
      case STATE.FLEE:
        if (this.timer[i] > 0) this.timer[i]--;
        else this.state[i] = STATE.WANDER;
        if (!this.stepHeading(world, i, speed * 1.25)) {
          // Cornered against water or a ridge: pick the best open heading away.
          this.chooseHeading(world, rng, i, this.tx[i], this.ty[i]);
          this.stepHeading(world, i, speed * 1.25);
        }
        break;
      default: {
        // WANDER: hold a heading for a while so animals explore instead of jittering.
        if (this.timer[i] > 0) this.timer[i]--;
        else {
          this.turn(rng, i);
          this.timer[i] = 20 + Math.floor(rng.next() * 40);
        }
        const searching = this.hunger[i] > HUNGRY || (sp.thirstRate > 0 && this.thirst[i] > THIRSTY);
        const v = speed * (searching ? 1 : 0.6);
        if (!this.stepHeading(world, i, v)) {
          this.chooseHeading(world, rng, i);
          this.stepHeading(world, i, v);
        }
      }
    }
  }

  private actHunt(world: World, rng: Rng, i: number, speed: number): void {
    const sp = SPECIES[this.species[i]];
    const p = this.indexOf(this.targetId[i]);
    if (p < 0) {
      this.endHunt(i);
      return;
    }
    const d = Math.hypot(this.x[p] - this.x[i], this.y[p] - this.y[i]);
    if (d > sp.sight * 2) {
      this.endHunt(i); // lost the trail
      return;
    }
    if (++this.huntTicks[i] > MAX_CHASE_TICKS) {
      // Not closing in: give up on this one and look for easier prey.
      this.ignoreId[i] = this.targetId[i];
      this.endHunt(i);
      this.searchCd[i] = 10;
      return;
    }
    if (d <= ATTACK_RANGE) {
      this.health[p] -= sp.attack;
      this.harm[p] = CAUSE.PREDATION;
      if (this.health[p] <= 0) {
        this.kill(p, CAUSE.PREDATION);
        this.hunger[i] = Math.max(0, this.hunger[i] - sp.meat);
        this.ignoreId[i] = 0;
        this.endHunt(i);
      }
      return;
    }
    // Sprint while chasing; a short burst (pounce) to close the final gap.
    const chase = speed * (d < POUNCE_RANGE ? 1.6 : 1.15);
    // Close and in the open: run straight at it.
    if (d < 6 && this.rayClear(world, sp.move, this.x[i], this.y[i], this.x[p], this.y[p])) {
      this.clearPath(i);
      this.setDir(i, this.x[p] - this.x[i], this.y[p] - this.y[i]);
      if (this.stepHeading(world, i, chase)) return;
    }
    // Otherwise follow a path, re-planned when the prey has moved away from its end.
    const w = world.width;
    const goal = Math.floor(this.y[p]) * w + Math.floor(this.x[p]);
    const g = this.pathGoal[i];
    const drift = g < 0 ? Infinity : Math.max(Math.abs((g % w) - (goal % w)), Math.abs(Math.floor(g / w) - Math.floor(goal / w)));
    if (this.pathPos[i] >= this.pathLen[i] || (drift > 2 && this.timer[i] === 0)) {
      const r = this.planTo(world, i, goal % w, Math.floor(goal / w), 2500);
      this.timer[i] = 8;
      if (r === NOT_FOUND) {
        // Unreachable (across a lake, behind a ridge…): give up on this one.
        this.ignoreId[i] = this.targetId[i];
        this.endHunt(i);
        this.searchCd[i] = 20;
        return;
      }
      if (r === NO_BUDGET) {
        this.setDir(i, this.x[p] - this.x[i], this.y[p] - this.y[i]);
        if (!this.stepHeading(world, i, chase)) this.chooseHeading(world, rng, i);
        return;
      }
    }
    if (this.timer[i] > 0) this.timer[i]--;
    if (this.followPath(world, i, chase) === 'blocked') this.clearPath(i);
  }

  /** Current base speed of creature i (juveniles and elders are slower). */
  private speedOf(i: number): number {
    const sp = SPECIES[this.species[i]];
    const stageMul = this.age[i] < sp.adultAge ? 0.85 : this.age[i] > sp.maxAge * 0.8 ? 0.85 : 1;
    let fx = 1;
    if (this.effMask[i]) {
      fx += 0.25 * this.effectPower(i, EFFECT.HASTE);
      fx = Math.max(0.3, fx - 0.2 * this.effectPower(i, EFFECT.SLOW));
    }
    return sp.speed * stageMul * fx;
  }

  /** Whether predator i, sprinting, is faster than prey j fleeing. */
  private canCatch(i: number, j: number): boolean {
    return this.speedOf(i) * 1.15 > this.speedOf(j) * 1.25;
  }

  private endHunt(i: number): void {
    this.state[i] = STATE.WANDER;
    this.targetId[i] = 0;
    this.huntTicks[i] = 0;
    this.clearPath(i);
  }

  private tryBreed(world: World, rng: Rng, i: number): void {
    const sp = SPECIES[this.species[i]];
    if (!this.readyToBreed(i)) return;
    if (!rng.chance(sp.breedChance * (1 + this.effectPower(i, EFFECT.FERTILE)))) return;
    if (!this.roomToBreed(i) || !this.hasMate(i)) return;
    if (sp.diet === 'carnivore' && !this.preyCanSupport(i)) return;
    const cell = this.cellOf(this.x[i], this.y[i]);

    for (let k = 0; k < sp.litter; k++) {
      const ox = this.x[i] + (rng.next() - 0.5) * 0.6;
      const oy = this.y[i] + (rng.next() - 0.5) * 0.6;
      const spawnX = Creatures.canEnter(world, sp.id, Math.floor(ox), Math.floor(oy)) ? ox : this.x[i];
      const spawnY = spawnX === ox ? oy : this.y[i];
      const child = this.spawn(sp.id, spawnX, spawnY, rng, { age: 0, hunger: 30, thirst: 20 });
      if (!child) break;
      this.onBirth?.(child, this.id[i]);
      this.births++;
      this.birthStats[sp.id]++;
      this.crowd[sp.id][cell]++;
      this.speciesCount[sp.id]++;
    }
    this.hunger[i] = Math.min(100, this.hunger[i] + 25);
    this.breedTimer[i] = sp.breedCooldown;
  }

  /** Adult, healthy, fed, watered and off cooldown. */
  private readyToBreed(i: number): boolean {
    const sp = SPECIES[this.species[i]];
    if (this.dead[i] || this.breedTimer[i] > 0 || this.age[i] < sp.adultAge || this.age[i] > sp.maxAge * 0.8) return false;
    if (this.effMask[i] & (1 << EFFECT.STERILE)) return false;
    return this.health[i] >= sp.maxHealth * 0.6 && this.hunger[i] <= 50 && this.thirst[i] <= 50;
  }

  /**
   * Predators only breed where prey is plentiful: at least PREY_PER_PREDATOR prey
   * per predator of the same species within sight. Without this, efficient hunters
   * out-breed their food supply and crash it (seen in long simulations).
   */
  private preyCanSupport(i: number): boolean {
    const sp = SPECIES[this.species[i]];
    let prey = 0;
    let rivals = 1;
    this.forEachNear(this.x[i], this.y[i], sp.sight, (j) => {
      if (sp.prey.includes(this.species[j])) prey++;
      else if (j !== i && this.species[j] === sp.id) rivals++;
      return false;
    });
    return prey >= PREY_PER_PREDATOR * rivals;
  }

  /** Population limits: species share of all slots, and local carrying capacity. */
  private roomToBreed(i: number): boolean {
    const sp = SPECIES[this.species[i]];
    if (this.speciesCount[sp.id] >= MAX_CREATURES * sp.maxShare) return false;
    if (this.breedBlock?.(this.id[i])) return false;
    return this.crowd[sp.id][this.cellOf(this.x[i], this.y[i])] - 1 < sp.crowdLimit; // excludes the parent itself
  }

  // ---- behaviours ------------------------------------------------------

  /** Herbivores: path to the nearest *reachable* food tile within sight. */
  private seekFood(world: World, i: number): void {
    const sp = SPECIES[this.species[i]];
    const tx = Math.floor(this.x[i]);
    const ty = Math.floor(this.y[i]);
    const terrain = world.terrain;
    const food = sp.food;
    const group = this.foodMap.groupOf[sp.id];
    // Nothing edible anywhere in sight (coarse check): skip the search and migrate.
    const r = this.foodMap.around(group, this.x[i], this.y[i], sp.sight) === 0
      ? NOT_FOUND
      : this.pathfinder.nearest(
        world, sp.move, tx, ty, (2 * sp.sight + 1) ** 2, (t) => food.includes(terrain[t]),
        this.path, i * PATH_MAX, PATH_MAX,
      );
    if (r === NOT_FOUND && this.migrateToFood(world, i)) return;
    if (r === 0) {
      this.clearPath(i);
      this.state[i] = STATE.EAT;
    } else if (r > 0) {
      this.pathLen[i] = r;
      this.pathPos[i] = 0;
      this.pathGoal[i] = this.path[i * PATH_MAX + r - 1];
      this.state[i] = STATE.SEEK_FOOD;
    } else if (r === NOT_FOUND) {
      this.clearPath(i);
      this.searchCd[i] = 40;
      this.state[i] = STATE.WANDER; // no reachable food anywhere near: roam and look again later
    }
    // NO_BUDGET: keep the current state and retry on a later think.
  }

  /**
   * Heads for the nearest food-map cell with reachable food (beyond sight). Returns
   * true if a route was planned (or will be retried when the search budget allows).
   */
  private migrateToFood(world: World, i: number): boolean {
    if (this.fieldWorld !== world) return false;
    const sp = SPECIES[this.species[i]];
    const group = this.foodMap.groupOf[sp.id];
    const w = world.width;
    const here = Math.floor(this.y[i]) * w + Math.floor(this.x[i]);
    let target = -1;
    const cell = this.foodMap.nearestCell(group, this.x[i], this.y[i], MIGRATE_RINGS, (c) => {
      const cx0 = (c % this.foodMap.w) * FOOD_CELL;
      const cy0 = Math.floor(c / this.foodMap.w) * FOOD_CELL;
      for (let y = cy0; y < Math.min(world.height, cy0 + FOOD_CELL); y++) {
        for (let x = cx0; x < Math.min(w, cx0 + FOOD_CELL); x++) {
          const t = y * w + x;
          if (sp.food.includes(world.terrain[t]) && this.regions.connected(sp.move, here, t)) {
            target = t;
            return true;
          }
        }
      }
      return false;
    });
    if (cell < 0 || target < 0) return false;
    const r = this.planTo(world, i, target % w, Math.floor(target / w), 4000);
    if (r > 0 || r === NO_BUDGET) {
      this.state[i] = STATE.SEEK_FOOD;
      return r > 0;
    }
    return false;
  }

  /** Land animals follow the shared water field, which only leads to reachable water. */
  private seekWater(world: World, i: number): void {
    const sp = SPECIES[this.species[i]];
    const tx = Math.floor(this.x[i]);
    const ty = Math.floor(this.y[i]);
    if (isDrinkSpot(world, tx, ty)) {
      this.state[i] = STATE.DRINK;
      return;
    }
    this.clearPath(i);
    if (this.water.distanceAt(world, sp.move, tx, ty) === UNREACHABLE) {
      this.state[i] = STATE.WANDER;
      this.searchCd[i] = 24;
      return;
    }
    this.state[i] = STATE.SEEK_WATER;
  }

  /**
   * Predators: hunt the nearest visible prey; if none is in sight, prowl toward the
   * nearby area with the most prey (from the spatial hash's per-cell counts).
   */
  private seekPrey(world: World, i: number): void {
    const sp = SPECIES[this.species[i]];
    const current = this.indexOf(this.targetId[i]);
    if (this.state[i] === STATE.HUNT && current >= 0) return;
    const p = this.nearestOf(sp.prey, this.x[i], this.y[i], sp.sight, i, this.ignoreId[i], true);
    if (p >= 0) {
      this.clearPath(i);
      this.state[i] = STATE.HUNT;
      this.targetId[i] = this.id[p];
      this.timer[i] = 0;
      this.huntTicks[i] = 0;
      return;
    }
    if (this.state[i] === STATE.SEEK_FOOD && this.pathPos[i] < this.pathLen[i]) return; // still prowling
    if (this.searchCd[i] > 0) {
      this.state[i] = STATE.WANDER;
      return;
    }
    const prey = this.densestPrey(i);
    if (prey >= 0) {
      const r = this.planTo(world, i, Math.floor(this.x[prey]), Math.floor(this.y[prey]), 6000);
      if (r > 0) {
        this.state[i] = STATE.SEEK_FOOD;
        return;
      }
      if (r === NO_BUDGET) return;
    }
    this.searchCd[i] = 30;
    this.state[i] = STATE.WANDER;
  }

  /**
   * A catchable prey animal in the most prey-rich cell nearby (nearer cells
   * preferred), looking within PROWL_CELLS first and further out if that is empty.
   */
  private densestPrey(i: number): number {
    const near = this.densestPreyWithin(i, PROWL_CELLS);
    return near >= 0 ? near : this.densestPreyWithin(i, PROWL_CELLS * 2 + 2);
  }

  private densestPreyWithin(i: number, radius: number): number {
    const sp = SPECIES[this.species[i]];
    const gx = Math.min(this.gridW - 1, Math.max(0, Math.floor(this.x[i] / GRID)));
    const gy = Math.min(this.gridH - 1, Math.max(0, Math.floor(this.y[i] / GRID)));
    let bestCell = -1;
    let bestScore = 0;
    for (let cy = Math.max(0, gy - radius); cy <= Math.min(this.gridH - 1, gy + radius); cy++) {
      for (let cx = Math.max(0, gx - radius); cx <= Math.min(this.gridW - 1, gx + radius); cx++) {
        const cell = cy * this.gridW + cx;
        let n = 0;
        for (const s of sp.prey) n += this.crowd[s][cell];
        if (!n) continue;
        const score = n / (1 + 0.5 * Math.max(Math.abs(cx - gx), Math.abs(cy - gy)));
        if (score > bestScore) {
          bestScore = score;
          bestCell = cell;
        }
      }
    }
    if (bestCell < 0) return -1;
    for (let j = this.gridHead[bestCell]; j !== -1; j = this.gridNext[j]) {
      if (!this.dead[j] && sp.prey.includes(this.species[j]) && this.id[j] !== this.ignoreId[i] && this.canCatch(i, j)) return j;
    }
    return -1;
  }

  private hasMate(i: number): boolean {
    return this.nearestMate(i, 3) >= 0;
  }

  /** Nearest other adult of the same species within radius, or -1. */
  private nearestMate(i: number, r: number): number {
    const sp = this.species[i];
    const adult = SPECIES[sp].adultAge;
    let best = -1;
    let bestD = Infinity;
    this.forEachNear(this.x[i], this.y[i], r, (j) => {
      if (j === i || this.species[j] !== sp || this.age[j] < adult) return false;
      const d = (this.x[j] - this.x[i]) ** 2 + (this.y[j] - this.y[i]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
      return d < 9; // a mate within breeding range is good enough
    });
    return best;
  }

  // ---- paths & movement --------------------------------------------------

  private clearPath(i: number): void {
    this.pathLen[i] = 0;
    this.pathPos[i] = 0;
    this.pathGoal[i] = -1;
  }

  /** A* to a tile; stores the route. Returns path length or NOT_FOUND / NO_BUDGET. */
  /**
   * Plans a route to a tile and stores it. Goals further than LEG tiles go through
   * the region graph: unreachable goals fail instantly, and the stored path is one
   * leg toward an intermediate waypoint; pathGoal keeps the final goal so the walk
   * continues (continueRoute) when the leg is used up.
   * Returns the stored path length, or NOT_FOUND / NO_BUDGET.
   */
  private planTo(world: World, i: number, gx: number, gy: number, maxNodes: number): number {
    const sp = SPECIES[this.species[i]];
    const sx = Math.floor(this.x[i]);
    const sy = Math.floor(this.y[i]);
    const goal = gy * world.width + gx;
    let tx = gx;
    let ty = gy;
    if (Math.max(Math.abs(gx - sx), Math.abs(gy - sy)) > LEG && this.fieldWorld === world) {
      const wp = this.regions.waypoint(world, sp.move, sy * world.width + sx, goal);
      if (wp < 0) {
        this.clearPath(i);
        return NOT_FOUND;
      }
      tx = wp % world.width;
      ty = Math.floor(wp / world.width);
    }
    const r = this.pathfinder.astar(world, sp.move, sx, sy, tx, ty, Math.min(maxNodes, 4000), this.path, i * PATH_MAX, PATH_MAX);
    if (r >= 0) {
      this.pathLen[i] = r;
      this.pathPos[i] = 0;
      this.pathGoal[i] = goal;
    } else if (r === NOT_FOUND) {
      this.clearPath(i);
    }
    return r;
  }

  /**
   * After a leg is used up: plans the next leg toward pathGoal if it hasn't been
   * reached. Returns true if the route continues (or will retry next tick).
   */
  private continueRoute(world: World, i: number): boolean {
    const g = this.pathGoal[i];
    if (g < 0) return false;
    const w = world.width;
    const tx = Math.floor(this.x[i]);
    const ty = Math.floor(this.y[i]);
    if (Math.max(Math.abs((g % w) - tx), Math.abs(Math.floor(g / w) - ty)) <= 1) return false;
    const r = this.planTo(world, i, g % w, Math.floor(g / w), 4000);
    if (r === NO_BUDGET) {
      this.pathLen[i] = this.pathPos[i] = 0;
      this.pathGoal[i] = g; // keep the goal; try again next tick
      return true;
    }
    return r > 0;
  }

  /** Navigation state for saves (snapshot-based, so a reload rebuilds identical data). */
  exportNav(): { terrain: Uint8Array; passVersion: number; lastFieldBuild: number; pending: ReturnType<NavScheduler['exportPending']> } | null {
    if (!this.navTerrain) return null;
    return {
      terrain: this.navTerrain.slice(),
      passVersion: this.navVersion,
      lastFieldBuild: this.lastFieldBuild,
      pending: this.nav.exportPending(),
    };
  }

  /** Rebuilds navigation exactly as it was when saved (from the saved snapshot). */
  importNav(world: World, s: NonNullable<ReturnType<Creatures['exportNav']>>): void {
    const res = computeNav({ id: 0, width: world.width, height: world.height, terrain: s.terrain, passVersion: s.passVersion });
    if (!res.ok) return;
    this.water.apply(world, res.water, s.passVersion);
    this.regions.apply(world, res.regions, s.passVersion);
    this.navTerrain = s.terrain.slice();
    this.navVersion = s.passVersion;
    this.fieldWorld = world;
    this.lastFieldBuild = s.lastFieldBuild;
    this.nav.importPending(world, s.pending);
  }

  /**
   * Plans a complete long route leg by leg without moving anything (benchmarks and
   * tests): true if the goal is reachable this way.
   */
  planLongRoute(cls: number, sx: number, sy: number, gx: number, gy: number, world?: World): boolean {
    const wld = world ?? this.fieldWorld;
    if (!wld) return false;
    if (this.regions.isStale(wld)) this.regions.build(wld);
    const w = wld.width;
    const goal = gy * w + gx;
    const out = new Int32Array(8192);
    let cur = sy * w + sx;
    for (let legs = 0; legs < 500; legs++) {
      if (cur === goal) return true;
      const wp = this.regions.waypoint(wld, cls, cur, goal);
      if (wp < 0) return false;
      this.pathfinder.beginTick(1e9);
      const n = this.pathfinder.astar(wld, cls, cur % w, Math.floor(cur / w), wp % w, Math.floor(wp / w), 4000, out, 0, out.length);
      if (n < 0) return false;
      cur = n > 0 ? out[n - 1] : wp;
    }
    return false;
  }

  /**
   * Walks the stored route. Each waypoint is re-validated before use, so terrain
   * edits (flooding, new mountains) invalidate the path instead of letting the
   * animal walk into it. Returns 'moving', 'done' (route used up) or 'blocked'.
   */
  private followPath(world: World, i: number, speed: number): 'moving' | 'done' | 'blocked' {
    const cls = SPECIES[this.species[i]].move;
    const w = world.width;
    let budget = speed;
    while (budget > 1e-6) {
      if (this.pathPos[i] >= this.pathLen[i]) return 'done';
      const t = this.path[i * PATH_MAX + this.pathPos[i]];
      const cx = (t % w) + 0.5;
      const cy = Math.floor(t / w) + 0.5;
      if (!passable(world, cls, t % w, Math.floor(t / w))) return 'blocked';
      const ddx = cx - this.x[i];
      const ddy = cy - this.y[i];
      const d = Math.hypot(ddx, ddy);
      if (d <= budget) {
        this.x[i] = cx;
        this.y[i] = cy;
        if (d > 1e-6) this.setDir(i, ddx, ddy);
        budget -= d;
        this.pathPos[i]++;
        continue;
      }
      if (!this.moveToPoint(world, i, cx, cy, budget)) return 'blocked';
      return 'moving';
    }
    return this.pathPos[i] >= this.pathLen[i] ? 'done' : 'moving';
  }

  /** Moves straight toward a point (normally an adjacent tile centre). Returns false if blocked. */
  private moveToPoint(world: World, i: number, x: number, y: number, speed: number): boolean {
    const ddx = x - this.x[i];
    const ddy = y - this.y[i];
    const d = Math.hypot(ddx, ddy);
    if (d < 1e-6) return true;
    this.setDir(i, ddx, ddy);
    const k = Math.min(1, speed / d);
    const nx = this.x[i] + ddx * k;
    const ny = this.y[i] + ddy * k;
    if (this.canMove(world, i, nx, ny)) {
      this.x[i] = nx;
      this.y[i] = ny;
      return true;
    }
    // Off-centre start clipped a corner: re-centre on the current tile first.
    const ox = Math.floor(this.x[i]) + 0.5;
    const oy = Math.floor(this.y[i]) + 0.5;
    const cd = Math.hypot(ox - this.x[i], oy - this.y[i]);
    if (cd < 1e-6) return false;
    const c = Math.min(1, speed / cd);
    this.x[i] += (ox - this.x[i]) * c;
    this.y[i] += (oy - this.y[i]) * c;
    return true;
  }

  /**
   * Whether creature i may move to (nx, ny): the tile must be passable for its species
   * (terrain and slope), and a step that changes both tile coordinates at once must not
   * squeeze through the corner between two blocked tiles. An animal that ends up on
   * blocked ground is moved off it by unstick() before it can act, never by walking
   * through more blocked ground.
   */
  private canMove(world: World, i: number, nx: number, ny: number): boolean {
    const cls = SPECIES[this.species[i]].move;
    const tx = Math.floor(nx);
    const ty = Math.floor(ny);
    if (!passable(world, cls, tx, ty)) return false;
    const cx = Math.floor(this.x[i]);
    const cy = Math.floor(this.y[i]);
    if (tx !== cx && ty !== cy) return passable(world, cls, tx, cy) && passable(world, cls, cx, ty);
    return true;
  }

  /**
   * An animal standing on ground it cannot stand on (snow settled under it, a cliff
   * raised under it, a mountain painted there) scrambles to the nearest tile it can
   * use within UNSTICK_RADIUS, free of charge. With none in reach it is trapped: it
   * stays put (it never walks through blocked ground) and hunger or thirst will
   * eventually decide its fate. Returns true if the animal spent its tick on this.
   */
  private unstick(world: World, i: number, sp: SpeciesDef, cx: number, cy: number): boolean {
    let bx = -1;
    let by = -1;
    let bd = Infinity;
    for (let r = 1; r <= UNSTICK_RADIUS && bx < 0; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !Creatures.canEnter(world, sp.id, cx + dx, cy + dy)) continue;
          const d = dx * dx + dy * dy;
          if (d < bd) {
            bd = d;
            bx = cx + dx;
            by = cy + dy;
          }
        }
      }
    }
    this.clearPath(i);
    this.state[i] = STATE.WANDER;
    this.trapped++;
    if (bx < 0) {
      // Walled in (a whole mountain was raised around it): it is carried to the nearest tile it can use within
      // RESCUE_RADIUS (nearest first, then scan order: deterministic). Nobody is killed by a raised mountain.
      const to = this.rescueTile(world, sp, cx, cy);
      if (to >= 0) {
        this.x[i] = this.px[i] = (to % world.width) + 0.5;
        this.y[i] = this.py[i] = Math.floor(to / world.width) + 0.5;
        this.rescued++;
      }
      return true;
    }
    const ux = bx + 0.5 - this.x[i];
    const uy = by + 0.5 - this.y[i];
    const d = Math.hypot(ux, uy) || 1;
    const step = Math.min(this.speedOf(i) * 1.25, d);
    this.dx[i] = ux / d;
    this.dy[i] = uy / d;
    this.x[i] += this.dx[i] * step;
    this.y[i] += this.dy[i] * step;
    return true;
  }

  /** Nearest tile within RESCUE_RADIUS that the species can stand on (-1 = none). */
  private rescueTile(world: World, sp: SpeciesDef, cx: number, cy: number): number {
    for (let r = UNSTICK_RADIUS + 1; r <= RESCUE_RADIUS; r++) {
      let best = -1;
      let bd = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !Creatures.canEnter(world, sp.id, cx + dx, cy + dy)) continue;
          const d = dx * dx + dy * dy;
          if (d < bd) {
            bd = d;
            best = (cy + dy) * world.width + cx + dx;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** Moves along the current heading. Returns false (without moving) if blocked. */
  private stepHeading(world: World, i: number, speed: number): boolean {
    const nx = this.x[i] + this.dx[i] * speed;
    const ny = this.y[i] + this.dy[i] * speed;
    if (!this.canMove(world, i, nx, ny)) return false;
    this.x[i] = nx;
    this.y[i] = ny;
    return true;
  }

  /** Free run (in tiles, up to 4) along a heading before hitting impassable ground. */
  private openRun(world: World, cls: number, x: number, y: number, dx: number, dy: number): number {
    let run = 0;
    for (let k = 1; k <= 4; k++) {
      if (!passable(world, cls, Math.floor(x + dx * k), Math.floor(y + dy * k))) break;
      run = k;
    }
    return run;
  }

  /**
   * Picks a new heading among 16 directions, scored by open ground ahead, keeping
   * close to the current heading, and (when fleeing) moving away from (awayX, awayY).
   */
  private chooseHeading(world: World, rng: Rng, i: number, awayX?: number, awayY?: number): void {
    const cls = SPECIES[this.species[i]].move;
    let ax = 0;
    let ay = 0;
    if (awayX !== undefined && awayY !== undefined) {
      const d = Math.hypot(this.x[i] - awayX, this.y[i] - awayY) || 1;
      ax = (this.x[i] - awayX) / d;
      ay = (this.y[i] - awayY) / d;
    }
    let best = -Infinity;
    let bx = this.dx[i];
    let by = this.dy[i];
    const offset = rng.next() * (Math.PI / 8);
    for (let k = 0; k < 16; k++) {
      const a = offset + (k * Math.PI) / 8;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const run = this.openRun(world, cls, this.x[i], this.y[i], dx, dy);
      if (run === 0) continue;
      const score = run + 3 * (dx * ax + dy * ay) + 0.5 * (dx * this.dx[i] + dy * this.dy[i]) + rng.next() * 0.5;
      if (score > best) {
        best = score;
        bx = dx;
        by = dy;
      }
    }
    this.dx[i] = bx;
    this.dy[i] = by;
  }

  /** Whether a straight line between two points stays on passable tiles. */
  private rayClear(world: World, cls: number, x0: number, y0: number, x1: number, y1: number): boolean {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.ceil(d / 0.4);
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      if (!passable(world, cls, Math.floor(x0 + (x1 - x0) * t), Math.floor(y0 + (y1 - y0) * t))) return false;
    }
    return true;
  }

  private setDir(i: number, vx: number, vy: number): void {
    const d = Math.hypot(vx, vy);
    if (d < 1e-6) return;
    this.dx[i] = vx / d;
    this.dy[i] = vy / d;
  }

  private turn(rng: Rng, i: number): void {
    const a = rng.next() * Math.PI * 2;
    this.dx[i] = Math.cos(a);
    this.dy[i] = Math.sin(a);
  }

  // ---- bookkeeping -----------------------------------------------------

  private kill(i: number, cause: number): void {
    if (this.dead[i]) return;
    this.dead[i] = 1;
    this.byId.delete(this.id[i]);
    this.onDeath?.(this.id[i]);
    this.deaths++;
    this.deathStats[this.species[i] * CAUSE_COUNT + cause]++;
    this.recentDeaths.push({ id: this.id[i], species: this.species[i], cause });
    if (this.recentDeaths.length > 500) this.recentDeaths.shift();
  }

  private cellOf(x: number, y: number): number {
    const gx = Math.min(this.gridW - 1, Math.max(0, Math.floor(x / GRID)));
    const gy = Math.min(this.gridH - 1, Math.max(0, Math.floor(y / GRID)));
    return gy * this.gridW + gx;
  }

  private buildGrid(world: World): void {
    this.gridW = Math.ceil(world.width / GRID);
    this.gridH = Math.ceil(world.height / GRID);
    const cells = this.gridW * this.gridH;
    if (this.gridHead.length !== cells) {
      this.gridHead = new Int32Array(cells);
      this.crowd = SPECIES.map(() => new Uint16Array(cells));
    }
    this.gridHead.fill(-1);
    for (const c of this.crowd) c.fill(0);
    this.speciesCount.fill(0);
    for (let i = 0; i < this.count; i++) {
      const cell = this.cellOf(this.x[i], this.y[i]);
      const sp = this.species[i];
      this.crowd[sp][cell]++;
      this.speciesCount[sp]++;
      this.gridNext[i] = this.gridHead[cell];
      this.gridHead[cell] = i;
    }
  }

  /** Visits living creatures in grid cells overlapping the radius; stop by returning true. */
  private forEachNear(x: number, y: number, r: number, fn: (j: number) => boolean): void {
    if (!this.gridW) return;
    const gx0 = Math.max(0, Math.floor((x - r) / GRID));
    const gy0 = Math.max(0, Math.floor((y - r) / GRID));
    const gx1 = Math.min(this.gridW - 1, Math.floor((x + r) / GRID));
    const gy1 = Math.min(this.gridH - 1, Math.floor((y + r) / GRID));
    const r2 = r * r;
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let j = this.gridHead[gy * this.gridW + gx]; j !== -1; j = this.gridNext[j]) {
          if (this.dead[j]) continue;
          const ddx = this.x[j] - x;
          const ddy = this.y[j] - y;
          if (ddx * ddx + ddy * ddy > r2) continue;
          if (fn(j)) return;
        }
      }
    }
  }

  private nearestOf(
    species: readonly number[], x: number, y: number, r: number, self: number, skipId: number, catchable = false,
  ): number {
    let best = -1;
    let bestD = Infinity;
    this.forEachNear(x, y, r, (j) => {
      if (j === self || !species.includes(this.species[j]) || (skipId && this.id[j] === skipId)) return false;
      if (catchable && !this.canCatch(self, j)) return false;
      const d = (this.x[j] - x) ** 2 + (this.y[j] - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
      return false;
    });
    return best;
  }

  /** Swap-removes dead creatures. */
  private compact(): void {
    let i = 0;
    while (i < this.count) {
      if (!this.dead[i]) {
        i++;
        continue;
      }
      const last = --this.count;
      if (i !== last) {
        for (const f of this.fields) f[i] = f[last];
        this.path.copyWithin(i * PATH_MAX, last * PATH_MAX, last * PATH_MAX + PATH_MAX);
        this.effTicks.copyWithin(i * EFFECT_COUNT, last * EFFECT_COUNT, last * EFFECT_COUNT + EFFECT_COUNT);
        this.effPower.copyWithin(i * EFFECT_COUNT, last * EFFECT_COUNT, last * EFFECT_COUNT + EFFECT_COUNT);
        this.byId.set(this.id[i], i);
      }
      this.dead[last] = 0;
    }
  }
}

/**
 * Finds the nearest tile matching a predicate by straight-line distance (ignoring
 * obstacles), scanning square rings outward. Kept for tools and tests; creatures
 * use reachability-aware searches from pathfinding.ts instead.
 */
export function findTile(
  world: World,
  cx: number,
  cy: number,
  radius: number,
  rng: Rng,
  match: (x: number, y: number) => boolean,
): [number, number] | null {
  let bestX = 0;
  let bestY = 0;
  let bestD = Infinity;
  for (let r = 1; r <= radius; r++) {
    const perimeter = 8 * r;
    const start = Math.floor(rng.next() * perimeter);
    for (let k = 0; k < perimeter; k++) {
      const p = (start + k) % perimeter;
      let x: number;
      let y: number;
      if (p < 2 * r) {
        x = cx - r + p;
        y = cy - r;
      } else if (p < 4 * r) {
        x = cx + r;
        y = cy - r + (p - 2 * r);
      } else if (p < 6 * r) {
        x = cx + r - (p - 4 * r);
        y = cy + r;
      } else {
        x = cx - r;
        y = cy + r - (p - 6 * r);
      }
      if (!world.inBounds(x, y) || !match(x, y)) continue;
      const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d < bestD) {
        bestD = d;
        bestX = x;
        bestY = y;
      }
    }
    // Tiles on later rings are at least r+1 away; stop once nothing closer can exist.
    if (bestD <= (r + 1) * (r + 1)) return [bestX, bestY];
  }
  return bestD < Infinity ? [bestX, bestY] : null;
}
