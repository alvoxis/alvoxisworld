import { Rng } from '../core/rng';
import { T, isWater } from '../world/terrain';
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
  /** Terrain this species cannot enter, in addition to its habitat rule. */
  impassable: readonly number[];
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
}

export const GRAZER = 0;
export const RAPTOR = 1;
export const HADROSAUR = 2;
export const TYRANT = 3;
export const FISH = 4;

export const SPECIES: readonly SpeciesDef[] = [
  {
    id: GRAZER, key: 'grazer', name: 'Grazer', plural: 'Grazers', diet: 'herbivore', habitat: 'land',
    speed: 0.11, size: 1, adultAge: 300, maxAge: 1900, maxHealth: 40, hungerRate: 0.25, thirstRate: 0.16,
    food: [T.GRASS, T.SAVANNA, T.TUNDRA, T.HILLS, T.SWAMP], biteGain: 3, prey: [], attack: 0, meat: 0,
    impassable: [], sight: 8, breedCooldown: 240, breedChance: 0.03, litter: 2, crowdLimit: 3, maxShare: 0.45,
    color: '#efe6cf',
  },
  {
    id: RAPTOR, key: 'raptor', name: 'Raptor', plural: 'Raptors', diet: 'carnivore', habitat: 'land',
    speed: 0.18, size: 1, adultAge: 400, maxAge: 2600, maxHealth: 60, hungerRate: 0.15, thirstRate: 0.14,
    food: [], biteGain: 0, prey: [GRAZER], attack: 8, meat: 90,
    impassable: [], sight: 14, breedCooldown: 420, breedChance: 0.02, litter: 1, crowdLimit: 2, maxShare: 0.15,
    color: '#c8502e',
  },
  {
    id: HADROSAUR, key: 'hadrosaur', name: 'Hadrosaur', plural: 'Hadrosaurs', diet: 'herbivore', habitat: 'land',
    speed: 0.09, size: 1.5, adultAge: 600, maxAge: 3400, maxHealth: 120, hungerRate: 0.2, thirstRate: 0.14,
    food: [T.FOREST, T.JUNGLE, T.SWAMP, T.GRASS], biteGain: 2.5, prey: [], attack: 0, meat: 0,
    impassable: [T.MOUNTAIN, T.SNOW], sight: 10, breedCooldown: 480, breedChance: 0.02, litter: 1, crowdLimit: 2,
    maxShare: 0.25, color: '#6f8f4a',
  },
  {
    id: TYRANT, key: 'tyrant', name: 'Tyrant', plural: 'Tyrants', diet: 'carnivore', habitat: 'land',
    speed: 0.14, size: 1.8, adultAge: 900, maxAge: 4000, maxHealth: 220, hungerRate: 0.14, thirstRate: 0.12,
    food: [], biteGain: 0, prey: [HADROSAUR, GRAZER, RAPTOR], attack: 25, meat: 100,
    impassable: [T.MOUNTAIN, T.SNOW], sight: 13, breedCooldown: 900, breedChance: 0.015, litter: 1, crowdLimit: 1,
    maxShare: 0.05, color: '#7a3b2a',
  },
  {
    id: FISH, key: 'fish', name: 'Fish', plural: 'Fish', diet: 'herbivore', habitat: 'water',
    speed: 0.1, size: 0.8, adultAge: 250, maxAge: 1500, maxHealth: 20, hungerRate: 0.2, thirstRate: 0,
    food: [T.SHALLOW_WATER], biteGain: 3, prey: [], attack: 0, meat: 0,
    impassable: [], sight: 8, breedCooldown: 200, breedChance: 0.03, litter: 2, crowdLimit: 3, maxShare: 0.3,
    color: '#9fc4d8',
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
} as const;
export const STATE_NAMES = [
  'Wandering', 'Looking for food', 'Eating', 'Looking for water', 'Drinking', 'Hunting', 'Fleeing', 'Looking for a mate',
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
} as const;
export const CAUSE_NAMES = ['unknown', 'starvation', 'thirst', 'predators', 'old age', 'drowning', 'stranding', 'divine removal'];
const CAUSE_COUNT = CAUSE_NAMES.length;

export const MAX_CREATURES = 6000;

const GRID = 8;
const THINK_EVERY = 4;
const HUNGRY = 40;
const THIRSTY = 50;
const SATED = 8;
const WATER_SEARCH = 32;
const ATTACK_RANGE = 0.8;

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
}

export interface DeathRecord {
  id: number;
  species: number;
  cause: number;
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
  /** Movement target (tile coordinates) for SEEK_* states. */
  readonly tx = new Float32Array(MAX_CREATURES);
  readonly ty = new Float32Array(MAX_CREATURES);
  /** Hunted creature id for HUNT. */
  readonly targetId = new Uint32Array(MAX_CREATURES);
  /** Ticks left committed to the current wander/flee direction. */
  readonly timer = new Uint16Array(MAX_CREATURES);
  readonly breedTimer = new Uint16Array(MAX_CREATURES);
  /** Ticks before a failed food/water search may run again (keeps far-from-water animals cheap). */
  readonly searchCd = new Uint8Array(MAX_CREATURES);
  /** Last cause of damage, used to attribute death. */
  readonly harm = new Uint8Array(MAX_CREATURES);
  private readonly dead = new Uint8Array(MAX_CREATURES);

  private readonly fields = [
    this.id, this.species, this.x, this.y, this.px, this.py, this.dx, this.dy, this.health, this.hunger,
    this.thirst, this.age, this.state, this.tx, this.ty, this.targetId, this.timer, this.breedTimer, this.harm,
    this.searchCd, this.dead,
  ];

  births = 0;
  deaths = 0;
  /** deathStats[species * CAUSE_COUNT + cause]. */
  readonly deathStats = new Uint32Array(SPECIES.length * CAUSE_COUNT);
  readonly birthStats = new Uint32Array(SPECIES.length);
  /** Deaths since the last call to drainDeaths() (for UI/history). */
  private recentDeaths: DeathRecord[] = [];

  // Spatial hash of all creatures, rebuilt every tick (linked lists in typed arrays).
  private gridHead = new Int32Array(0);
  private readonly gridNext = new Int32Array(MAX_CREATURES);
  private gridW = 0;
  private gridH = 0;
  private crowd: Uint16Array[] = SPECIES.map(() => new Uint16Array(0));
  private readonly speciesCount = new Uint32Array(SPECIES.length);
  private readonly byId = new Map<number, number>();

  // ---- queries ---------------------------------------------------------

  countSpecies(species: number): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.species[i] === species && !this.dead[i]) n++;
    return n;
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
    if (!world.inBounds(tx, ty)) return false;
    const id = world.terrain[world.idx(tx, ty)];
    const sp = SPECIES[species];
    if (isWater(id) !== (sp.habitat === 'water')) return false;
    return !sp.impassable.includes(id);
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
  }

  // ---- simulation ------------------------------------------------------

  tick(world: World, rng: Rng, tick: number): void {
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
      this.hunger[i] = Math.min(100, this.hunger[i] + sp.hungerRate * exertion);
      this.thirst[i] = Math.min(100, this.thirst[i] + sp.thirstRate * exertion);

      // Habitat check (the player may have flooded or drained the tile).
      const cx = Math.floor(this.x[i]);
      const cy = Math.floor(this.y[i]);
      if (!world.inBounds(cx, cy) || isWater(world.terrain[world.idx(cx, cy)]) !== (sp.habitat === 'water')) {
        this.kill(i, sp.habitat === 'water' ? CAUSE.STRANDED : CAUSE.DROWNED);
        continue;
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

  /** Chooses a behaviour. Runs every few ticks per creature (staggered by id). */
  private think(world: World, rng: Rng, i: number): void {
    const sp = SPECIES[this.species[i]];
    const s = this.state[i];

    // 1. Danger first.
    const threats = PREDATORS_OF[sp.id];
    if (threats.length) {
      const p = this.nearestOf(threats, this.x[i], this.y[i], Math.min(sp.sight, 6), i);
      if (p >= 0) {
        this.setDir(i, this.x[i] - this.x[p], this.y[i] - this.y[p]);
        this.state[i] = STATE.FLEE;
        this.timer[i] = 12;
        return;
      }
    }
    if (s === STATE.FLEE && this.timer[i] > 0) return;

    // 2. Keep eating/drinking until sated.
    if (s === STATE.EAT && this.hunger[i] > SATED) return;
    if (s === STATE.DRINK && this.thirst[i] > SATED) return;

    // 3. Most pressing need.
    const thirsty = sp.thirstRate > 0 && this.thirst[i] > THIRSTY;
    const hungry = this.hunger[i] > HUNGRY;
    const canSearch = this.searchCd[i] === 0;
    if (thirsty && (!hungry || this.thirst[i] >= this.hunger[i])) {
      if (s !== STATE.SEEK_WATER && canSearch) this.seekWater(world, rng, i);
      return;
    }
    if (hungry) {
      if (sp.diet === 'carnivore') this.seekPrey(i);
      else if (s !== STATE.SEEK_FOOD && canSearch) this.seekFood(world, rng, i);
      return;
    }
    if (thirsty) {
      if (s !== STATE.SEEK_WATER && canSearch) this.seekWater(world, rng, i);
      return;
    }
    // 4. No pressing needs: look for a mate if ready to breed.
    if (this.readyToBreed(i) && this.roomToBreed(i)) {
      const m = this.nearestMate(i, sp.sight * 1.5);
      if (m >= 0) {
        this.state[i] = STATE.SEEK_MATE;
        this.tx[i] = this.x[m];
        this.ty[i] = this.y[m];
        return;
      }
    }
    if (s !== STATE.WANDER) this.state[i] = STATE.WANDER;
  }

  private act(world: World, rng: Rng, i: number): void {
    const sp = SPECIES[this.species[i]];
    const stageMul = this.age[i] < sp.adultAge ? 0.85 : this.age[i] > sp.maxAge * 0.8 ? 0.85 : 1;
    const speed = sp.speed * stageMul;
    const tx = Math.floor(this.x[i]);
    const ty = Math.floor(this.y[i]);

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
        if (!this.nearWater(world, tx, ty)) {
          this.state[i] = STATE.WANDER;
          break;
        }
        this.thirst[i] = Math.max(0, this.thirst[i] - 5);
        if (this.thirst[i] <= SATED) this.state[i] = STATE.WANDER;
        break;
      case STATE.SEEK_FOOD:
        if (sp.food.includes(world.terrain[world.idx(tx, ty)])) {
          this.state[i] = STATE.EAT;
          break;
        }
        this.moveToward(world, rng, i, this.tx[i], this.ty[i], speed);
        break;
      case STATE.SEEK_WATER:
        if (this.nearWater(world, tx, ty)) {
          this.state[i] = STATE.DRINK;
          break;
        }
        this.moveToward(world, rng, i, this.tx[i], this.ty[i], speed);
        break;
      case STATE.HUNT: {
        const p = this.indexOf(this.targetId[i]);
        if (p < 0 || this.dead[p]) {
          this.state[i] = STATE.WANDER;
          this.targetId[i] = 0;
          break;
        }
        const ddx = this.x[p] - this.x[i];
        const ddy = this.y[p] - this.y[i];
        const d = Math.hypot(ddx, ddy);
        if (d > sp.sight * 1.5) {
          this.state[i] = STATE.WANDER; // lost the trail
          this.targetId[i] = 0;
          break;
        }
        if (d <= ATTACK_RANGE) {
          this.health[p] -= sp.attack;
          this.harm[p] = CAUSE.PREDATION;
          if (this.health[p] <= 0) {
            this.kill(p, CAUSE.PREDATION);
            this.hunger[i] = Math.max(0, this.hunger[i] - sp.meat);
            this.state[i] = STATE.WANDER;
            this.targetId[i] = 0;
          }
          break;
        }
        this.moveToward(world, rng, i, this.x[p], this.y[p], speed * 1.15);
        break;
      }
      case STATE.SEEK_MATE:
        if (Math.hypot(this.tx[i] - this.x[i], this.ty[i] - this.y[i]) < 1.5) {
          this.state[i] = STATE.WANDER;
          break;
        }
        this.moveToward(world, rng, i, this.tx[i], this.ty[i], speed * 0.8);
        break;
      case STATE.FLEE:
        if (this.timer[i] > 0) this.timer[i]--;
        else this.state[i] = STATE.WANDER;
        this.step(world, rng, i, speed * 1.25);
        break;
      default: {
        // WANDER: hold a heading for a while so animals explore instead of jittering.
        if (this.timer[i] > 0) this.timer[i]--;
        else {
          this.turn(rng, i);
          this.timer[i] = 20 + Math.floor(rng.next() * 40);
        }
        const searching = this.hunger[i] > HUNGRY || (sp.thirstRate > 0 && this.thirst[i] > THIRSTY);
        this.step(world, rng, i, speed * (searching ? 1 : 0.6));
      }
    }
  }

  /** Adult, healthy, fed, watered and off cooldown. */
  private readyToBreed(i: number): boolean {
    const sp = SPECIES[this.species[i]];
    if (this.dead[i] || this.breedTimer[i] > 0 || this.age[i] < sp.adultAge || this.age[i] > sp.maxAge * 0.8) return false;
    return this.health[i] >= sp.maxHealth * 0.6 && this.hunger[i] <= 50 && this.thirst[i] <= 50;
  }

  /** Population limits: species share of all slots, and local carrying capacity. */
  private roomToBreed(i: number): boolean {
    const sp = SPECIES[this.species[i]];
    if (this.speciesCount[sp.id] >= MAX_CREATURES * sp.maxShare) return false;
    return this.crowd[sp.id][this.cellOf(this.x[i], this.y[i])] - 1 < sp.crowdLimit; // excludes the parent itself
  }

  private tryBreed(world: World, rng: Rng, i: number): void {
    const sp = SPECIES[this.species[i]];
    if (!this.readyToBreed(i)) return;
    if (!rng.chance(sp.breedChance)) return;
    if (!this.roomToBreed(i) || !this.hasMate(i)) return;
    const cell = this.cellOf(this.x[i], this.y[i]);

    for (let k = 0; k < sp.litter; k++) {
      const ox = this.x[i] + (rng.next() - 0.5) * 0.6;
      const oy = this.y[i] + (rng.next() - 0.5) * 0.6;
      const spawnX = Creatures.canEnter(world, sp.id, Math.floor(ox), Math.floor(oy)) ? ox : this.x[i];
      const spawnY = spawnX === ox ? oy : this.y[i];
      if (!this.spawn(sp.id, spawnX, spawnY, rng, { age: 0, hunger: 30, thirst: 20 })) break;
      this.births++;
      this.birthStats[sp.id]++;
      this.crowd[sp.id][cell]++;
      this.speciesCount[sp.id]++;
    }
    this.hunger[i] = Math.min(100, this.hunger[i] + 25);
    this.breedTimer[i] = sp.breedCooldown;
  }

  // ---- behaviours ------------------------------------------------------

  private seekFood(world: World, rng: Rng, i: number): void {
    const sp = SPECIES[this.species[i]];
    const tx = Math.floor(this.x[i]);
    const ty = Math.floor(this.y[i]);
    if (sp.food.includes(world.terrain[world.idx(tx, ty)])) {
      this.state[i] = STATE.EAT;
      return;
    }
    const found = findTile(world, tx, ty, sp.sight, rng, (x, y) =>
      sp.food.includes(world.terrain[world.idx(x, y)]) && Creatures.canEnter(world, sp.id, x, y),
    );
    if (!found) this.searchCd[i] = 16;
    if (found) {
      this.state[i] = STATE.SEEK_FOOD;
      this.tx[i] = found[0] + 0.5;
      this.ty[i] = found[1] + 0.5;
    } else {
      this.state[i] = STATE.WANDER; // nothing in sight: roam and look again later
    }
  }

  private seekWater(world: World, rng: Rng, i: number): void {
    const tx = Math.floor(this.x[i]);
    const ty = Math.floor(this.y[i]);
    if (this.nearWater(world, tx, ty)) {
      this.state[i] = STATE.DRINK;
      return;
    }
    const found = findTile(world, tx, ty, WATER_SEARCH, rng, (x, y) => isWater(world.terrain[world.idx(x, y)]));
    if (!found) this.searchCd[i] = 24;
    if (found) {
      this.state[i] = STATE.SEEK_WATER;
      this.tx[i] = found[0] + 0.5;
      this.ty[i] = found[1] + 0.5;
    } else {
      this.state[i] = STATE.WANDER;
    }
  }

  private seekPrey(i: number): void {
    const sp = SPECIES[this.species[i]];
    const current = this.indexOf(this.targetId[i]);
    if (this.state[i] === STATE.HUNT && current >= 0) return;
    const p = this.nearestOf(sp.prey, this.x[i], this.y[i], sp.sight, i);
    if (p >= 0) {
      this.state[i] = STATE.HUNT;
      this.targetId[i] = this.id[p];
    } else {
      this.state[i] = STATE.WANDER;
      this.targetId[i] = 0;
    }
  }

  /** Drinking is possible on or next to water, or in a swamp. */
  private nearWater(world: World, tx: number, ty: number): boolean {
    if (world.inBounds(tx, ty) && world.terrain[world.idx(tx, ty)] === T.SWAMP) return true;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const x = tx + ox;
        const y = ty + oy;
        if (world.inBounds(x, y) && isWater(world.terrain[world.idx(x, y)])) return true;
      }
    }
    return false;
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

  // ---- movement --------------------------------------------------------

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

  private moveToward(world: World, rng: Rng, i: number, x: number, y: number, speed: number): void {
    if (this.timer[i] > 0) {
      // Committed to a detour around an obstacle.
      this.timer[i]--;
      this.step(world, rng, i, speed);
      return;
    }
    this.setDir(i, x - this.x[i], y - this.y[i]);
    if (!this.step(world, rng, i, speed)) this.timer[i] = 6;
  }

  /** Moves along the current heading, turning away from impassable tiles. Returns false if blocked. */
  private step(world: World, rng: Rng, i: number, speed: number): boolean {
    const sp = this.species[i];
    for (let attempt = 0; attempt < 4; attempt++) {
      const nx = this.x[i] + this.dx[i] * speed;
      const ny = this.y[i] + this.dy[i] * speed;
      if (Creatures.canEnter(world, sp, Math.floor(nx), Math.floor(ny))) {
        this.x[i] = nx;
        this.y[i] = ny;
        return attempt === 0;
      }
      // Try a side-step: rotate ±90° (random side), then a random heading.
      if (attempt < 2) {
        const side = rng.chance(0.5) ? 1 : -1;
        const ox = this.dx[i];
        this.dx[i] = -this.dy[i] * side;
        this.dy[i] = ox * side;
      } else {
        this.turn(rng, i);
      }
    }
    return false;
  }

  // ---- bookkeeping -----------------------------------------------------

  private kill(i: number, cause: number): void {
    if (this.dead[i]) return;
    this.dead[i] = 1;
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
    this.byId.clear();
    for (let i = 0; i < this.count; i++) {
      const cell = this.cellOf(this.x[i], this.y[i]);
      const sp = this.species[i];
      this.crowd[sp][cell]++;
      this.speciesCount[sp]++;
      this.gridNext[i] = this.gridHead[cell];
      this.gridHead[cell] = i;
      this.byId.set(this.id[i], i);
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

  private nearestOf(species: readonly number[], x: number, y: number, r: number, self: number): number {
    let best = -1;
    let bestD = Infinity;
    this.forEachNear(x, y, r, (j) => {
      if (j === self || !species.includes(this.species[j])) return false;
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
        this.byId.set(this.id[i], i);
      }
      this.dead[last] = 0;
    }
  }
}

/**
 * Finds the nearest tile matching a predicate, scanning square rings outward. Within
 * the first ring that has matches it returns the closest one by straight-line
 * distance; ties are broken by a random start offset so creatures don't all pick
 * the same tile.
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
