import { Rng } from '../core/rng';
import { World } from '../world/world';
import { dateFromTick, SEASON_GROWTH, TICKS_PER_SECOND, TICKS_PER_YEAR, type WorldDate } from './clock';
import { Creatures, SPECIES } from './creatures';
import { meteorStrike, earthquake, lightningStrike, meteorClass, type DisasterResult } from './disasters';
import { EFFECTS } from './effects';
import { Fire, fuelOf } from './fire';
import { DISASTER_RATES, DISASTER_STEP, FLIGHT_TICKS, MAX_METEORS, Sky, type MeteorInFlight } from './sky';
import { T, isWater } from '../world/terrain';
import { WATER_FLAG } from '../world/world';
import { Weather, WEATHER_KIND, type WeatherKind } from './weather';
import { vegetationTick } from './vegetation';

/** Selectable simulation speeds (multiples of real time). 0 means paused. */
export const SPEED_LEVELS = [1, 2, 3, 5, 10, 20] as const;
export type Speed = number;
const MAX_TICKS_PER_FRAME = 40;
/**
 * Real time (ms) one frame may spend running simulation ticks. At high speed on a big
 * or crowded world the requested ticks cost more than a frame can afford (40 ticks of
 * 1,600 animals took 200+ ms on 2048×1280, freezing the screen), so the simulation
 * runs slower than requested instead and the speed label says so. At least one tick
 * runs per frame. Only the pace changes, never the order of ticks, so results stay
 * deterministic.
 */
export const SIM_BUDGET_MS = 12;

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
  readonly sky = new Sky();
  rng: Rng;
  tick = 0;
  speed: Speed = 1;
  history: HistoryEntry[] = [];
  private accumulator = 0;
  /** Ticks and seconds counted since the last speed measurement (see achievedSpeed). */
  private pace = { ticks: 0, secs: 0 };
  /** Speed actually reached over the last second or so, in multiples of real time (0 = not measured yet). */
  achievedSpeed = 0;
  private lastSeason = -1;
  private seenSpecies = new Set<number>();

  /**
   * Wraps the terrain change of a meteor that the player launched, so the game can
   * record it as one undo step. Natural meteors are never wrapped.
   */
  impactRecorder: ((label: string, run: () => void) => void) | null = null;

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
    this.weather.drift = { x: 0, y: 0 };
    this.weather.relaxCursor = 0;
    this.weather.strikes = [];
    this.sky.reset();
    this.creatures.dangers = [];
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

  /** True when the simulation is running clearly slower than the selected speed because frames cannot afford more. */
  get throttled(): boolean {
    return this.speed > 0 && this.achievedSpeed > 0 && this.achievedSpeed < this.speed * 0.85;
  }

  /** Advances by real elapsed seconds; returns the number of ticks run. */
  advance(dtSeconds: number): number {
    if (this.speed === 0) {
      this.pace = { ticks: 0, secs: 0 };
      this.achievedSpeed = 0;
      return 0;
    }
    const dt = Math.min(dtSeconds, 0.25);
    this.accumulator += dt * TICKS_PER_SECOND * this.speed;
    const start = performance.now();
    let ran = 0;
    while (this.accumulator >= 1 && ran < MAX_TICKS_PER_FRAME) {
      this.step();
      this.accumulator -= 1;
      ran++;
      if (performance.now() - start > SIM_BUDGET_MS) break;
    }
    // Out of time or ticks: keep at most a couple of ticks of backlog instead of spiralling.
    if (this.accumulator > 2) this.accumulator = 2;
    this.pace.ticks += ran;
    this.pace.secs += dt;
    if (this.pace.secs >= 1) {
      this.achievedSpeed = this.pace.ticks / (this.pace.secs * TICKS_PER_SECOND);
      this.pace = { ticks: 0, secs: 0 };
    }
    return ran;
  }

  step(): void {
    const date = this.date;
    this.weather.step(this.world, this.rng, this.tick, date.seasonIndex);
    if (this.weather.strikes.length) this.resolveLightning();
    if (this.sky.config.auto && this.tick % DISASTER_STEP === 0) this.naturalDisasters();
    if (this.sky.showers.length) this.tickShowers();
    if (this.sky.meteors.length) {
      for (const m of this.sky.advance()) this.impact(m);
      this.creatures.dangers = this.sky.dangerZones();
    } else if (this.creatures.dangers.length) this.creatures.dangers = [];
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

  /** Rain, a thunderstorm, snow or a drought centred on a point. intensity 1..3. */
  summonWeather(
    kind: WeatherKind, x: number, y: number, radius: number, intensity: number, opts: { storm?: boolean; snow?: boolean } = {},
  ): void {
    this.weather.addManual(kind, x, y, radius, 0.35 + 0.25 * intensity, opts);
    this.log(
      kind === WEATHER_KIND.DROUGHT ? 'The gods sent a drought.'
      : opts.snow ? 'The gods sent snow.'
      : opts.storm ? 'The gods sent a thunderstorm.'
      : 'The gods sent rain.',
    );
  }

  // ---- sky: lightning, meteors in flight, natural disasters ---------------

  /** Lightning at a tile (a god power, and what storms do). Real damage and ignition. */
  lightning(x: number, y: number): { killed: number; ignited: boolean } {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (!this.world.inBounds(tx, ty)) return { killed: 0, ignited: false };
    const r = lightningStrike(this.world, this.creatures, this.fire, this.rng, tx, ty);
    this.creatures.anyFire = this.fire.burning > 0;
    this.sky.stats.lightning++;
    this.sky.emit({ kind: 'bolt', x: tx + 0.5, y: ty + 0.5 });
    if (r.killed) this.log(`Lightning struck down ${r.killed} creature${r.killed > 1 ? 's' : ''}.`);
    return r;
  }

  private resolveLightning(): void {
    const list = this.weather.strikes.slice();
    this.weather.strikes.length = 0;
    for (const s of list) this.lightning(s.x, s.y);
  }

  /**
   * Sends a meteor: it flies for about 2 seconds (of simulated time) and then lands,
   * digging its crater. radius sets the crater and intensity (1..3) its energy.
   * Returns false if too many are already in the sky.
   */
  launchMeteor(x: number, y: number, radius: number, intensity: number, natural = false, flight = FLIGHT_TICKS): boolean {
    const angle = this.rng.next() * Math.PI * 2;
    return this.sky.launch(x, y, Math.max(2, radius), intensity, angle, natural, flight) !== null;
  }

  /**
   * A meteor shower: `count` meteors, one every few ticks over about 5 seconds, each
   * landing at its own random point within `spread` tiles and coming in from its own
   * direction. `intensity` (1..3) sets their sizes. Returns how many were accepted
   * (none when too many showers or meteors are already queued). Cannot be undone.
   */
  launchShower(x: number, y: number, spread: number, count: number, intensity = 1): number {
    const n = this.sky.startShower(x, y, Math.max(2, spread), count, Math.min(3, Math.max(1, Math.round(intensity))));
    if (n) this.log(`A meteor shower began (${n} meteors).`);
    return n;
  }

  /** Fires the next meteor of each active shower when its turn comes (at most one per shower per tick, within the cap in the air). */
  private tickShowers(): void {
    for (const sh of this.sky.showers) {
      if (--sh.wait > 0) continue;
      if (this.sky.meteors.length >= MAX_METEORS) {
        sh.wait = 1; // the sky is full: try again next tick
        continue;
      }
      const a = this.rng.next() * Math.PI * 2;
      const d = Math.sqrt(this.rng.next()) * sh.spread;
      const tx = Math.min(this.world.width - 1, Math.max(0, sh.x + Math.cos(a) * d));
      const ty = Math.min(this.world.height - 1, Math.max(0, sh.y + Math.sin(a) * d));
      const roll = this.rng.next();
      // Size mix by intensity: 1 = small stones; 2 = mostly small, some medium; 3 = small, medium and the odd large.
      const [radius, energy] =
        sh.intensity >= 3 && roll > 0.85 ? [8 + this.rng.next() * 2.5, 3]
        : sh.intensity >= 2 && roll > (sh.intensity >= 3 ? 0.5 : 0.7) ? [4.5 + this.rng.next() * 1.8, 2]
        : [2 + this.rng.next() * 1.2, 1];
      this.launchMeteor(tx, ty, radius, energy, false, FLIGHT_TICKS - 4 + Math.floor(this.rng.next() * 24));
      sh.remaining--;
      sh.wait = sh.gap;
    }
    this.sky.showers = this.sky.showers.filter((sh) => sh.remaining > 0);
  }

  /** A meteor lands. Player-launched ones are recorded as one undo step. */
  private impact(m: MeteorInFlight): void {
    let result: DisasterResult | null = null;
    const run = () => {
      result = meteorStrike(this.world, this.creatures, this.fire, this.rng, m.x, m.y, m.radius, m.intensity);
    };
    if (!m.natural && this.impactRecorder) this.impactRecorder('Meteor', run);
    else run();
    const r = result as DisasterResult | null;
    this.creatures.anyFire = this.fire.burning > 0;
    this.sky.stats.meteors++;
    this.sky.emit({ kind: 'impact', x: m.x, y: m.y, radius: Math.max(2, m.radius) * (0.7 + 0.3 * m.intensity), intensity: m.intensity });
    const size = meteorClass(m.radius);
    this.log(`A ${size} meteor struck${r && r.killed ? `, killing ${r.killed}` : ''}.`);
  }

  /** Natural disasters: rolled every DISASTER_STEP ticks from the settings. Uses the simulation RNG, so it is deterministic. */
  private naturalDisasters(): void {
    const c = this.sky.config;
    const w = this.world;
    // Bigger maps get proportionally more events (their area is bigger), up to 2.5×.
    const scale = Math.min(2.5, Math.max(1, Math.sqrt((w.width * w.height) / (512 * 320))));
    const perStep = (rate: number) => (rate * scale * DISASTER_STEP) / TICKS_PER_YEAR;
    const f = Math.min(2, Math.max(0, c.frequency));
    const pickLand = (): [number, number] | null => {
      for (let k = 0; k < 12; k++) {
        const x = Math.floor(this.rng.next() * w.width);
        const y = Math.floor(this.rng.next() * w.height);
        if (!isWater(w.terrain[w.idx(x, y)])) return [x, y];
      }
      return null;
    };
    if (c.meteors && this.rng.chance(perStep(DISASTER_RATES.meteors[f]))) {
      const at = pickLand();
      if (at) {
        const roll = this.rng.next();
        // Mostly small stones, sometimes a medium one, rarely a large one.
        const [r, i] = roll < 0.7 ? [2 + this.rng.next() * 1.5, 1] : roll < 0.95 ? [5 + this.rng.next() * 2, 2] : [9 + this.rng.next() * 3, 3];
        this.launchMeteor(at[0] + 0.5, at[1] + 0.5, r, i, true);
      }
    }
    if (c.quakes && this.rng.chance(perStep(DISASTER_RATES.quakes[f]))) {
      const at = pickLand();
      if (at) {
        const radius = 5 + this.rng.next() * 6;
        this.earthquake(at[0] + 0.5, at[1] + 0.5, radius, this.rng.next() < 0.2 ? 2 : 1);
        this.sky.emit({ kind: 'quake', x: at[0] + 0.5, y: at[1] + 0.5, radius: radius * 1.6 });
      }
    }
    if (c.wildfires && this.rng.chance(perStep(DISASTER_RATES.wildfires[f]))) {
      // A dry, burnable spot where it is not raining (dry lightning, a spark…).
      for (let k = 0; k < 30; k++) {
        const x = Math.floor(this.rng.next() * w.width);
        const y = Math.floor(this.rng.next() * w.height);
        const i = w.idx(x, y);
        if (fuelOf(w.terrain[i]) <= 0 || w.moisture[i] > 120 || this.weather.wetnessAt(x, y) > 0) continue;
        if (this.fire.ignite(w, x, y)) {
          this.creatures.anyFire = true;
          this.sky.stats.wildfires++;
          this.log('A wildfire broke out.');
          break;
        }
      }
    }
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
    this.sky.stats.quakes++;
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
