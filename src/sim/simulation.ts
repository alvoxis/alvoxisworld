import { Rng } from '../core/rng';
import { World } from '../world/world';
import { dateFromTick, SEASON_GROWTH, TICKS_PER_SECOND, type WorldDate } from './clock';
import { Creatures, SPECIES } from './creatures';
import { meteorStrike, earthquake, type DisasterResult } from './disasters';
import { EFFECTS } from './effects';
import { Fire } from './fire';
import { T, isWater } from '../world/terrain';
import { WATER_FLAG } from '../world/world';
import { Weather, WEATHER_KIND, type WeatherKind } from './weather';
import { vegetationTick } from './vegetation';

/** Selectable simulation speeds (multiples of real time). 0 means paused. */
export const SPEED_LEVELS = [1, 2, 3, 5, 10, 20] as const;
export type Speed = number;
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
  readonly weather = new Weather();
  readonly fire = new Fire();
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
    this.creatures.envThirst = (x, y) => this.weather.thirstFactor(x, y);
  }

  get date(): WorldDate {
    return dateFromTick(this.tick);
  }

  /** Replaces the world (new world or load). */
  reset(world: World, tick = 0, rngState?: number): void {
    this.world = world;
    this.creatures.clear();
    this.fire.clear();
    this.weather.systems = [];
    this.weather.wind = 0;
    this.weather.refresh(world);
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
    this.weather.step(this.world, this.rng, this.tick, date.seasonIndex);
    this.fire.step(this.world, this.rng, this.weather);
    this.creatures.anyFire = this.fire.burning > 0;
    vegetationTick(this.world, this.rng, SEASON_GROWTH[date.season]);
    const before = this.creatures.countAll();
    this.creatures.tick(this.world, this.rng, this.tick);
    this.tick++;

    const now = this.date;
    if (now.seasonIndex !== this.lastSeason) {
      this.lastSeason = now.seasonIndex;
      this.onSeasonChange(now.seasonIndex);
    }
    const after = this.creatures.countAll();
    SPECIES.forEach((s, k) => {
      if (before[k] > 0 && after[k] === 0) this.log(`${s.plural} went extinct.`);
    });
  }

  // ---- god powers (each changes real simulation state) --------------------

  /** Rain or drought centred on a point. intensity 1..3. */
  summonWeather(kind: WeatherKind, x: number, y: number, radius: number, intensity: number): void {
    this.weather.addManual(kind, x, y, radius, 0.35 + 0.25 * intensity);
    this.log(kind === WEATHER_KIND.RAIN ? 'The gods sent rain.' : 'The gods sent a drought.');
  }

  /** Sets burnable tiles alight within a radius. Returns how many caught. */
  igniteArea(x: number, y: number, radius: number): number {
    let n = 0;
    const r = Math.max(0.5, radius);
    for (let ty = Math.floor(y - r); ty <= Math.ceil(y + r); ty++) {
      for (let tx = Math.floor(x - r); tx <= Math.ceil(x + r); tx++) {
        if (Math.hypot(tx + 0.5 - x, ty + 0.5 - y) > r) continue;
        if (this.fire.ignite(this.world, tx, ty)) n++;
      }
    }
    this.creatures.anyFire = this.fire.burning > 0;
    return n;
  }

  /** Visits the tiles of a disc. */
  private forDisc(x: number, y: number, radius: number, fn: (tx: number, ty: number, i: number) => void): void {
    const r = Math.max(0.5, radius);
    const w = this.world;
    for (let ty = Math.max(0, Math.floor(y - r)); ty <= Math.min(w.height - 1, Math.ceil(y + r)); ty++) {
      for (let tx = Math.max(0, Math.floor(x - r)); tx <= Math.min(w.width - 1, Math.ceil(x + r)); tx++) {
        if (Math.hypot(tx + 0.5 - x, ty + 0.5 - y) <= r) fn(tx, ty, w.idx(tx, ty));
      }
    }
  }

  /**
   * Flood: covers land with temporary flood water (it drains back to the original
   * terrain through the normal weather rules). Mountains and snow stay dry.
   * Returns the number of tiles flooded.
   */
  flood(x: number, y: number, radius: number): number {
    const w = this.world;
    let n = 0;
    this.forDisc(x, y, radius, (tx, ty, i) => {
      const id = w.terrain[i];
      if (isWater(id) || id === T.MOUNTAIN || id === T.SNOW) return;
      w.touch(i);
      w.under[i] = id;
      w.fire[i] = 0;
      w.setWaterFlags(i, w.waterFlags[i] | WATER_FLAG.FLOOD);
      w.setTerrain(tx, ty, T.LAKE);
      n++;
    });
    return n;
  }

  /**
   * Drain: dries fresh water. Flood water returns to the land beneath; lakes become
   * dry lake beds and rivers dry river beds (both refill with rain). The sea is not
   * drained (use Raise). Returns the number of tiles drained.
   */
  drain(x: number, y: number, radius: number): number {
    const w = this.world;
    let n = 0;
    this.forDisc(x, y, radius, (tx, ty, i) => {
      const id = w.terrain[i];
      const flags = w.waterFlags[i];
      if (flags & WATER_FLAG.FLOOD) {
        w.setWaterFlags(i, flags & ~WATER_FLAG.FLOOD);
        w.setTerrain(tx, ty, w.under[i]);
      } else if (id === T.LAKE) {
        w.setWaterFlags(i, flags | WATER_FLAG.LAKE_BED);
        w.setTerrain(tx, ty, T.SOIL);
      } else if (id === T.RIVER) {
        w.setWaterFlags(i, flags | WATER_FLAG.RIVER_BED);
        w.setTerrain(tx, ty, T.SAND);
      } else return;
      n++;
    });
    return n;
  }

  /** Puts out every fire in a radius. Returns how many tiles stopped burning. */
  extinguish(x: number, y: number, radius: number): number {
    let n = 0;
    this.forDisc(x, y, radius, (tx, ty, i) => {
      if (!this.world.fire[i]) return;
      this.world.fire[i] = 0;
      this.world.markDirty(tx, ty);
      n++;
    });
    return n;
  }

  /**
   * Applies a buff/debuff to the creatures within radius (at least the one nearest
   * the point, within 2 tiles). Returns how many were affected.
   */
  applyEffect(effect: number, x: number, y: number, radius: number, ticks: number, power: number): number {
    const c = this.creatures;
    let targets = c.inCircle(x, y, Math.max(0.5, radius));
    if (!targets.length) {
      const i = c.nearestAt(x, y, 2);
      if (i >= 0) targets = [i];
    }
    for (const i of targets) c.applyEffect(i, effect, ticks, power, EFFECTS[effect].opposite);
    return targets.length;
  }

  /** Removes all buffs and debuffs from creatures within radius (or the nearest one). */
  cleanse(x: number, y: number, radius: number): number {
    const c = this.creatures;
    let targets = c.inCircle(x, y, Math.max(0.5, radius));
    if (!targets.length) {
      const i = c.nearestAt(x, y, 2);
      if (i >= 0) targets = [i];
    }
    for (const i of targets) c.clearEffects(i);
    return targets.length;
  }

  meteor(x: number, y: number, radius: number, intensity: number): DisasterResult {
    const r = meteorStrike(this.world, this.creatures, this.fire, this.rng, x, y, radius, intensity);
    this.creatures.anyFire = this.fire.burning > 0;
    this.log(`A meteor struck${r.killed ? `, killing ${r.killed}` : ''}.`);
    return r;
  }

  earthquake(x: number, y: number, radius: number, intensity: number): DisasterResult {
    const r = earthquake(this.world, this.creatures, this.rng, x, y, radius, intensity);
    this.log(`An earthquake shook the land${r.killed ? `, killing ${r.killed}` : ''}.`);
    return r;
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
