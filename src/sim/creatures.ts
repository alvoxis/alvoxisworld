import { Rng } from '../core/rng';
import { T, TERRAIN, isWater } from '../world/terrain';
import { World } from '../world/world';

export interface SpeciesDef {
  id: number;
  key: string;
  name: string;
  diet: 'herbivore' | 'carnivore';
  /** Tiles moved per tick. */
  speed: number;
  /** Lifespan in ticks. */
  maxAge: number;
  maxEnergy: number;
  /** Energy lost per tick. */
  metabolism: number;
  /** Energy needed before reproduction is possible. */
  breedEnergy: number;
  /** Per-tick chance to reproduce once breedEnergy is reached. */
  breedChance: number;
  color: string;
  /** Carrying capacity: breeding stops once this many others of the species share the parent's 8×8-tile cell. */
  crowdLimit: number;
  /** Share of MAX_CREATURES this species may occupy, so no species starves others of slots. */
  maxShare: number;
}

export const SPECIES: readonly SpeciesDef[] = [
  {
    id: 0, key: 'grazer', name: 'Grazer', diet: 'herbivore', speed: 0.11, maxAge: 1900,
    maxEnergy: 100, metabolism: 0.3, breedEnergy: 80, breedChance: 0.012, color: '#efe6cf',
    crowdLimit: 2, maxShare: 0.8,
  },
  {
    id: 1, key: 'raptor', name: 'Raptor', diet: 'carnivore', speed: 0.2, maxAge: 2600,
    maxEnergy: 120, metabolism: 0.28, breedEnergy: 95, breedChance: 0.01, color: '#c8502e',
    crowdLimit: 2, maxShare: 0.3,
  },
];

export const GRAZER = 0;
export const RAPTOR = 1;
export const MAX_CREATURES = 6000;

const GRID = 8;
const HUNT_RADIUS = 10;
const GRAZE_GAIN = 1.6;
const OVERGRAZE_CHANCE = 0.01;
const PREY_ENERGY = 55;

/**
 * Creatures stored as structure-of-arrays so thousands of them stay cheap to update
 * and trivial to serialise.
 */
export class Creatures {
  count = 0;
  readonly x = new Float32Array(MAX_CREATURES);
  readonly y = new Float32Array(MAX_CREATURES);
  readonly dx = new Float32Array(MAX_CREATURES);
  readonly dy = new Float32Array(MAX_CREATURES);
  readonly species = new Uint8Array(MAX_CREATURES);
  readonly energy = new Float32Array(MAX_CREATURES);
  readonly age = new Float32Array(MAX_CREATURES);
  private readonly dead = new Uint8Array(MAX_CREATURES);

  births = 0;
  deaths = 0;

  // Spatial hash of prey, rebuilt every tick (linked lists in typed arrays).
  private gridHead = new Int32Array(0);
  private readonly gridNext = new Int32Array(MAX_CREATURES);
  private gridW = 0;
  private gridH = 0;
  /** Per species, creatures per grid cell (rebuilt every tick). */
  private crowd: Uint16Array[] = SPECIES.map(() => new Uint16Array(0));
  private speciesCount = new Uint32Array(SPECIES.length);

  spawn(species: number, x: number, y: number, rng: Rng, energy?: number): boolean {
    if (this.count >= MAX_CREATURES) return false;
    const i = this.count++;
    const a = rng.next() * Math.PI * 2;
    this.x[i] = x;
    this.y[i] = y;
    this.dx[i] = Math.cos(a);
    this.dy[i] = Math.sin(a);
    this.species[i] = species;
    this.energy[i] = energy ?? SPECIES[species].maxEnergy * 0.6;
    this.age[i] = 0;
    this.dead[i] = 0;
    return true;
  }

  countSpecies(species: number): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.species[i] === species) n++;
    return n;
  }

  /** Removes every creature within radius. Returns how many were removed. */
  removeInCircle(cx: number, cy: number, r: number): number {
    let removed = 0;
    for (let i = 0; i < this.count; i++) {
      const ddx = this.x[i] - cx;
      const ddy = this.y[i] - cy;
      if (ddx * ddx + ddy * ddy <= r * r) {
        this.dead[i] = 1;
        removed++;
      }
    }
    this.deaths += removed;
    this.compact();
    return removed;
  }

  clear(): void {
    this.count = 0;
    this.births = 0;
    this.deaths = 0;
  }

  tick(world: World, rng: Rng): void {
    this.buildPreyGrid(world);
    const n = this.count; // newborns appended this tick act next tick
    for (let i = 0; i < n; i++) {
      if (this.dead[i]) continue;
      const sp = SPECIES[this.species[i]];
      this.age[i] += 1;
      this.energy[i] -= sp.metabolism;
      if (this.energy[i] <= 0 || this.age[i] > sp.maxAge) {
        this.kill(i);
        continue;
      }
      const tx = Math.floor(this.x[i]);
      const ty = Math.floor(this.y[i]);
      if (!world.inBounds(tx, ty) || isWater(world.terrain[world.idx(tx, ty)])) {
        this.kill(i); // drowned (e.g. the player flooded the land)
        continue;
      }

      if (sp.diet === 'herbivore') this.graze(world, rng, i, tx, ty);
      else this.hunt(rng, i);

      this.move(world, rng, i, sp.speed);

      if (this.energy[i] >= sp.breedEnergy && rng.chance(sp.breedChance) && this.canBreed(i)) {
        const half = this.energy[i] / 2;
        if (this.spawn(this.species[i], this.x[i], this.y[i], rng, half)) {
          this.energy[i] = half;
          this.births++;
          this.crowd[this.species[i]][this.cellOf(i)]++;
          this.speciesCount[this.species[i]]++;
        }
      }
    }
    this.compact();
  }

  private graze(world: World, rng: Rng, i: number, tx: number, ty: number): void {
    const ti = world.idx(tx, ty);
    const id = world.terrain[ti];
    if (!TERRAIN[id].edible) return;
    const max = SPECIES[this.species[i]].maxEnergy;
    if (this.energy[i] >= max) return;
    this.energy[i] = Math.min(max, this.energy[i] + GRAZE_GAIN);
    // Open grassland gets worn down to bare soil; it regrows via the vegetation system.
    if ((id === T.GRASS || id === T.SAVANNA || id === T.TUNDRA || id === T.HILLS) && rng.chance(OVERGRAZE_CHANCE)) {
      world.setTerrain(tx, ty, T.SOIL);
    }
  }

  private hunt(rng: Rng, i: number): void {
    const x = this.x[i];
    const y = this.y[i];
    let best = -1;
    let bestD = HUNT_RADIUS * HUNT_RADIUS;
    const gx0 = Math.max(0, Math.floor((x - HUNT_RADIUS) / GRID));
    const gy0 = Math.max(0, Math.floor((y - HUNT_RADIUS) / GRID));
    const gx1 = Math.min(this.gridW - 1, Math.floor((x + HUNT_RADIUS) / GRID));
    const gy1 = Math.min(this.gridH - 1, Math.floor((y + HUNT_RADIUS) / GRID));
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let j = this.gridHead[gy * this.gridW + gx]; j !== -1; j = this.gridNext[j]) {
          if (this.dead[j]) continue;
          const ddx = this.x[j] - x;
          const ddy = this.y[j] - y;
          const d = ddx * ddx + ddy * ddy;
          if (d < bestD) {
            bestD = d;
            best = j;
          }
        }
      }
    }
    if (best === -1) {
      if (rng.chance(0.08)) this.turn(rng, i);
      return;
    }
    if (bestD < 0.5) {
      this.kill(best);
      this.energy[i] = Math.min(SPECIES[this.species[i]].maxEnergy, this.energy[i] + PREY_ENERGY);
      return;
    }
    const d = Math.sqrt(bestD);
    this.dx[i] = (this.x[best] - x) / d;
    this.dy[i] = (this.y[best] - y) / d;
  }

  private move(world: World, rng: Rng, i: number, speed: number): void {
    if (this.species[i] === GRAZER && rng.chance(0.06)) this.turn(rng, i);
    const nx = this.x[i] + this.dx[i] * speed;
    const ny = this.y[i] + this.dy[i] * speed;
    const tx = Math.floor(nx);
    const ty = Math.floor(ny);
    if (!world.inBounds(tx, ty) || isWater(world.terrain[world.idx(tx, ty)])) {
      this.turn(rng, i);
      return;
    }
    this.x[i] = nx;
    this.y[i] = ny;
  }

  private turn(rng: Rng, i: number): void {
    const a = rng.next() * Math.PI * 2;
    this.dx[i] = Math.cos(a);
    this.dy[i] = Math.sin(a);
  }

  private kill(i: number): void {
    if (this.dead[i]) return;
    this.dead[i] = 1;
    this.deaths++;
  }

  private cellOf(i: number): number {
    const gx = Math.min(this.gridW - 1, Math.max(0, Math.floor(this.x[i] / GRID)));
    const gy = Math.min(this.gridH - 1, Math.max(0, Math.floor(this.y[i] / GRID)));
    return gy * this.gridW + gx;
  }

  private canBreed(i: number): boolean {
    const sp = SPECIES[this.species[i]];
    if (this.speciesCount[sp.id] >= MAX_CREATURES * sp.maxShare) return false;
    return this.crowd[sp.id][this.cellOf(i)] - 1 < sp.crowdLimit; // excludes the parent itself
  }

  private buildPreyGrid(world: World): void {
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
      const cell = this.cellOf(i);
      const sp = this.species[i];
      this.crowd[sp][cell]++;
      this.speciesCount[sp]++;
      if (sp !== GRAZER) continue;
      this.gridNext[i] = this.gridHead[cell];
      this.gridHead[cell] = i;
    }
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
        this.x[i] = this.x[last];
        this.y[i] = this.y[last];
        this.dx[i] = this.dx[last];
        this.dy[i] = this.dy[last];
        this.species[i] = this.species[last];
        this.energy[i] = this.energy[last];
        this.age[i] = this.age[last];
        this.dead[i] = this.dead[last];
      }
      this.dead[last] = 0;
    }
  }
}
