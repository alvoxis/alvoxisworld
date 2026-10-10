import { Rng } from '../core/rng';
import { World } from '../world/world';
import { dateFromTick, SEASON_GROWTH, TICKS_PER_SECOND, type WorldDate } from './clock';
import { Creatures, SPECIES } from './creatures';
import { vegetationTick } from './vegetation';

export const SPEEDS = [0, 1, 3, 10] as const;
export type Speed = (typeof SPEEDS)[number];
const MAX_TICKS_PER_FRAME = 40;

export interface HistoryEntry {
  tick: number;
  text: string;
}

/**
 * Owns the world state and advances it on a fixed timestep, independent of frame rate.
 */
export class Simulation {
  world: World;
  readonly creatures = new Creatures();
  rng: Rng;
  tick = 0;
  speed: Speed = 1;
  history: HistoryEntry[] = [];
  private accumulator = 0;
  private lastSeason = -1;
  private seenSpecies = new Set<number>();

  /** Called when the season changes (renderer re-tints the map). */
  onSeasonChange: (seasonIndex: number) => void = () => {};

  constructor(world: World) {
    this.world = world;
    this.rng = new Rng(world.seed ^ 0x51ed270b);
    this.lastSeason = this.date.seasonIndex;
  }

  get date(): WorldDate {
    return dateFromTick(this.tick);
  }

  /** Replaces the world (new world or load). */
  reset(world: World, tick = 0, rngState?: number): void {
    this.world = world;
    this.creatures.clear();
    this.rng = new Rng(world.seed ^ 0x51ed270b);
    if (rngState !== undefined) this.rng.state = rngState;
    this.tick = tick;
    this.accumulator = 0;
    this.history = [];
    this.seenSpecies.clear();
    this.lastSeason = this.date.seasonIndex;
  }

  log(text: string): void {
    this.history.push({ tick: this.tick, text });
    if (this.history.length > 200) this.history.shift();
  }

  /**
   * Fraction (0..1) of the way to the next tick. The renderer uses it to draw
   * creatures between their previous and current positions.
   */
  get alpha(): number {
    return Math.min(1, Math.max(0, this.accumulator));
  }

  /** Advances by real elapsed seconds; returns the number of ticks run. */
  advance(dtSeconds: number): number {
    if (this.speed === 0) return 0;
    this.accumulator += Math.min(dtSeconds, 0.25) * TICKS_PER_SECOND * this.speed;
    let ran = 0;
    while (this.accumulator >= 1 && ran < MAX_TICKS_PER_FRAME) {
      this.step();
      this.accumulator -= 1;
      ran++;
    }
    if (ran === MAX_TICKS_PER_FRAME) this.accumulator = 0; // drop backlog instead of spiralling
    return ran;
  }

  step(): void {
    const date = this.date;
    vegetationTick(this.world, this.rng, SEASON_GROWTH[date.season]);
    const before = SPECIES.map((s) => this.creatures.countSpecies(s.id));
    this.creatures.tick(this.world, this.rng, this.tick);
    this.tick++;

    const now = this.date;
    if (now.seasonIndex !== this.lastSeason) {
      this.lastSeason = now.seasonIndex;
      this.onSeasonChange(now.seasonIndex);
    }
    SPECIES.forEach((s, k) => {
      const count = this.creatures.countSpecies(s.id);
      if (before[k] > 0 && count === 0) this.log(`${s.plural} went extinct.`);
    });
  }

  /**
   * Spawns creatures of a species inside a circle, only on tiles their habitat
   * allows (land animals on land, fish in water). Returns how many spawned.
   */
  spawnInCircle(species: number, cx: number, cy: number, radius: number, amount: number): number {
    let spawned = 0;
    for (let a = 0; a < amount * 6 && spawned < amount; a++) {
      const ang = this.rng.next() * Math.PI * 2;
      const r = Math.sqrt(this.rng.next()) * radius;
      const x = cx + Math.cos(ang) * r;
      const y = cy + Math.sin(ang) * r;
      if (!Creatures.canEnter(this.world, species, Math.floor(x), Math.floor(y))) continue;
      if (!this.creatures.spawn(species, x, y, this.rng)) break;
      spawned++;
    }
    if (spawned > 0 && !this.seenSpecies.has(species)) {
      this.seenSpecies.add(species);
      this.log(`The first ${SPECIES[species].plural.toLowerCase()} appeared.`);
    }
    return spawned;
  }
}
