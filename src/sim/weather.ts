import { Rng } from '../core/rng';
import { T, isWater } from '../world/terrain';
import { WATER_FLAG, World } from '../world/world';

export const WEATHER_KIND = { RAIN: 0, DROUGHT: 1 } as const;
export type WeatherKind = (typeof WEATHER_KIND)[keyof typeof WEATHER_KIND];

/** A moving weather system (rain, snow, thunderstorm or heat wave). Positions/radius in tiles. */
export interface WeatherSystem {
  /** Stable id (clouds drawn for a system keep their shape while it moves). */
  id: number;
  kind: WeatherKind;
  x: number;
  y: number;
  radius: number;
  /** 0..1 */
  intensity: number;
  /** Remaining lifetime in ticks. */
  ttl: number;
  /** Created by a god power (stationary, doesn't count toward the automatic cap). */
  manual: boolean;
  /** Rain with thunder: throws lightning (see Weather.strikes). Never set on droughts or snow. */
  storm: boolean;
  /** Precipitation under this system is currently falling as snow (updated every weather step). */
  snow: boolean;
  /** Snow everywhere under the system, whatever the temperature (the Snow god power). */
  forceSnow: boolean;
}

export const SEVERITY = ['Mild', 'Normal', 'Extreme'] as const;

export interface WeatherConfig {
  /** Weather systems form by themselves. */
  auto: boolean;
  /** 0 mild, 1 normal, 2 extreme: how often systems form and how strong they are. */
  severity: number;
}

/** Ticks between weather updates (effects are applied in batches). */
export const WEATHER_STEP = 10;
export const MAX_AUTO_SYSTEMS = 4;
export const MAX_MANUAL_SYSTEMS = 6;
/** Coarse grid cell size for fast "what's the weather here" lookups. */
const CELL = 16;
/** Precipitation falls as snow on tiles colder than this (0..255, about 0.39). */
export const SNOW_TEMPERATURE = 100;
/** Snow settles on tundra colder than this. */
const SNOW_COVER_TEMPERATURE = 85;
/** Most lightning strikes one weather step can produce (bounds work at any speed). */
const MAX_STRIKES_PER_STEP = 6;

/** Chance per weather step that a new automatic system forms, by season (spring…winter). */
const FORM_CHANCE = [
  { rain: 0.05, drought: 0.01 },
  { rain: 0.025, drought: 0.04 },
  { rain: 0.05, drought: 0.015 },
  { rain: 0.02, drought: 0.005 },
];

/** Chance per weather step that a new automatic thunderstorm forms, by season (spring…winter). */
const STORM_CHANCE = [0.008, 0.014, 0.007, 0.0015];

const NEIGHBOURS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
] as const;

/**
 * Simulation-driven weather. Advances only inside Simulation.step(), so pausing
 * stops it. Effects are applied by sampling a fraction of the tiles under each
 * system every WEATHER_STEP ticks, plus a light map-wide relaxation of climate
 * back to its long-term values, so cost does not grow with full-map scans.
 *
 * Rain raises moisture, lowers temperature, puts out fires, refills dried lake
 * and river beds and, when heavy, floods low land next to fresh water.
 * Drought lowers moisture, raises temperature, drains floods, shrinks lakes from
 * their shores, dries rivers, and withers vegetation.
 */
export class Weather {
  systems: WeatherSystem[] = [];
  config: WeatherConfig = { auto: true, severity: 1 };
  /** Wind direction (radians); systems drift with it. */
  wind = 0;
  /** Total wind drift so far in tiles: decorative clouds move by it, so they follow the wind and stop when paused. */
  drift = { x: 0, y: 0 };
  private nextId = 1;
  /** Lightning strikes decided this step; Simulation resolves (and clears) them right after. */
  strikes: Array<{ x: number; y: number }> = [];
  /** Coarse per-cell signed wetness (+1 rain … −1 drought), rebuilt each weather step. */
  private grid = new Float32Array(0);
  private gridW = 0;
  private gridH = 0;
  /** Counters for statistics and tests. */
  stats = { floods: 0, drained: 0, refilled: 0, dried: 0, withered: 0, greened: 0, snowCover: 0, melted: 0 };

  /** Adds ids and the newer fields to systems loaded from older saves. */
  adopt(list: Array<Partial<WeatherSystem> & Pick<WeatherSystem, 'kind' | 'x' | 'y' | 'radius' | 'intensity' | 'ttl' | 'manual'>>): void {
    this.systems = list.map((s) => ({
      ...s,
      id: s.id ?? this.nextId++,
      storm: s.storm ?? false,
      snow: s.snow ?? false,
      forceSnow: s.forceSnow ?? false,
    }));
    this.nextId = Math.max(this.nextId, ...this.systems.map((s) => s.id + 1), 1);
  }

  /** Next system id (saved, so clouds stay stable across a reload). */
  get idCounter(): number {
    return this.nextId;
  }

  set idCounter(n: number) {
    this.nextId = Math.max(1, n);
  }

  addManual(
    kind: WeatherKind, x: number, y: number, radius: number, intensity: number, opts: { storm?: boolean; snow?: boolean } = {},
  ): WeatherSystem {
    const sys: WeatherSystem = {
      id: this.nextId++, kind, x, y, radius, intensity: Math.min(1, intensity), ttl: 400, manual: true,
      storm: !!opts.storm && kind === WEATHER_KIND.RAIN && !opts.snow,
      snow: !!opts.snow,
      forceSnow: !!opts.snow && kind === WEATHER_KIND.RAIN,
    };
    this.systems.push(sys);
    // Cap god-power systems: the oldest manual one ends.
    const manual = this.systems.filter((s) => s.manual);
    if (manual.length > MAX_MANUAL_SYSTEMS) this.systems.splice(this.systems.indexOf(manual[0]), 1);
    return sys;
  }

  /** Signed wetness at a tile: >0 under rain, <0 under drought, 0 otherwise. */
  wetnessAt(x: number, y: number): number {
    if (!this.gridW) return 0;
    const gx = Math.min(this.gridW - 1, Math.max(0, Math.floor(x / CELL)));
    const gy = Math.min(this.gridH - 1, Math.max(0, Math.floor(y / CELL)));
    return this.grid[gy * this.gridW + gx];
  }

  /** Multiplier on animals' thirst: drought makes them thirstier, rain less so. */
  thirstFactor(x: number, y: number): number {
    const w = this.wetnessAt(x, y);
    return w < 0 ? 1 - w * 0.6 : 1 - w * 0.3;
  }

  /** Called every tick; does work every WEATHER_STEP ticks. */
  step(world: World, rng: Rng, tick: number, seasonIndex: number): void {
    if (tick % WEATHER_STEP !== 0) return;
    this.form(world, rng, seasonIndex);
    this.move(world, rng);
    this.strikes.length = 0;
    for (const s of this.systems) {
      this.apply(world, rng, s, seasonIndex);
      if (s.storm && !s.snow && this.strikes.length < MAX_STRIKES_PER_STEP && rng.chance(0.3 + 0.45 * s.intensity)) {
        const a = rng.next() * Math.PI * 2;
        const r = Math.sqrt(rng.next()) * s.radius * 0.85;
        const x = Math.floor(s.x + Math.cos(a) * r);
        const y = Math.floor(s.y + Math.sin(a) * r);
        if (world.inBounds(x, y)) this.strikes.push({ x, y });
      }
    }
    this.relax(world, rng, seasonIndex);
    this.rebuildGrid(world);
  }

  private form(world: World, rng: Rng, season: number): void {
    if (!this.config.auto) return;
    const auto = this.systems.filter((s) => !s.manual).length;
    if (auto >= MAX_AUTO_SYSTEMS) return;
    const sev = this.config.severity;
    const freq = [0.5, 1, 1.8][sev];
    const strength = [0.35, 0.6, 0.9][sev];
    const c = FORM_CHANCE[season];
    const make = (kind: WeatherKind, storm = false) => {
      const size = Math.min(world.width, world.height);
      this.systems.push({
        id: this.nextId++,
        kind,
        x: rng.next() * world.width,
        y: rng.next() * world.height,
        radius: size * (storm ? 0.06 + rng.next() * 0.08 : 0.08 + rng.next() * 0.12),
        intensity: storm ? Math.min(1, strength * 1.3 * (0.75 + rng.next() * 0.25)) : strength * (0.6 + rng.next() * 0.4),
        ttl: storm ? 500 + Math.floor(rng.next() * 700) : 600 + Math.floor(rng.next() * 1200),
        manual: false,
        storm,
        snow: false,
        forceSnow: false,
      });
    };
    if (rng.chance(c.rain * freq)) make(WEATHER_KIND.RAIN);
    else if (rng.chance(c.drought * freq)) make(WEATHER_KIND.DROUGHT);
    else if (rng.chance(STORM_CHANCE[season] * freq)) make(WEATHER_KIND.RAIN, true);
  }

  private move(world: World, rng: Rng): void {
    this.wind += (rng.next() - 0.5) * 0.3;
    const vx = Math.cos(this.wind) * 0.04 * WEATHER_STEP;
    const vy = Math.sin(this.wind) * 0.04 * WEATHER_STEP;
    this.drift.x += vx;
    this.drift.y += vy;
    this.systems = this.systems.filter((s) => {
      s.ttl -= WEATHER_STEP;
      if (!s.manual) {
        s.x += vx;
        s.y += vy;
      }
      const off = s.x < -s.radius || s.y < -s.radius || s.x > world.width + s.radius || s.y > world.height + s.radius;
      if (s.kind === WEATHER_KIND.RAIN) {
        const cx = Math.floor(s.x);
        const cy = Math.floor(s.y);
        s.snow = s.forceSnow || (world.inBounds(cx, cy) && world.temperature[world.idx(cx, cy)] < SNOW_TEMPERATURE);
        if (s.snow) s.storm = false;
      }
      return s.ttl > 0 && !off;
    });
  }

  /** Samples tiles under a system and applies its effects. */
  private apply(world: World, rng: Rng, s: WeatherSystem, season: number): void {
    const area = Math.PI * s.radius * s.radius;
    const samples = Math.min(4000, Math.ceil(area * 0.06));
    const rain = s.kind === WEATHER_KIND.RAIN;
    const k = s.intensity;
    for (let n = 0; n < samples; n++) {
      const a = rng.next() * Math.PI * 2;
      const r = Math.sqrt(rng.next()) * s.radius;
      const x = Math.floor(s.x + Math.cos(a) * r);
      const y = Math.floor(s.y + Math.sin(a) * r);
      if (!world.inBounds(x, y)) continue;
      const i = world.idx(x, y);
      if (!rain) this.droughtOn(world, rng, x, y, i, k);
      else if (s.forceSnow || world.temperature[i] < SNOW_TEMPERATURE) this.snowOn(world, rng, x, y, i, k);
      else this.rainOn(world, rng, x, y, i, k, season);
    }
  }

  /** Snowfall: wetter and colder, puts out fire, and settles on cold tundra. No floods, no refilling (frozen). */
  private snowOn(world: World, rng: Rng, x: number, y: number, i: number, k: number): void {
    world.moisture[i] = Math.min(255, world.moisture[i] + Math.round(8 * k));
    world.temperature[i] = Math.max(0, world.temperature[i] - Math.round(2 * k));
    if (world.fire[i]) world.fire[i] = 0;
    if (
      world.terrain[i] === T.TUNDRA && world.temperature[i] < SNOW_COVER_TEMPERATURE && !world.waterFlags[i] &&
      rng.chance(0.1 * k)
    ) {
      world.under[i] = T.TUNDRA;
      world.setWaterFlags(i, WATER_FLAG.SNOWCOVER);
      world.setTerrain(x, y, T.SNOW);
      this.stats.snowCover++;
    }
  }

  /** Snow cover melts: the tile returns to the terrain beneath (unless it was repainted meanwhile). */
  private melt(world: World, x: number, y: number, i: number): void {
    world.setWaterFlags(i, world.waterFlags[i] & ~WATER_FLAG.SNOWCOVER);
    if (world.terrain[i] === T.SNOW) world.setTerrain(x, y, world.under[i]);
    this.stats.melted++;
  }

  private rainOn(world: World, rng: Rng, x: number, y: number, i: number, k: number, season: number): void {
    world.moisture[i] = Math.min(255, world.moisture[i] + Math.round(14 * k));
    world.temperature[i] = Math.max(0, world.temperature[i] - Math.round(3 * k));
    if (world.fire[i]) world.fire[i] = 0;
    const id = world.terrain[i];
    const flags = world.waterFlags[i];
    if (flags & WATER_FLAG.SNOWCOVER) {
      if (rng.chance(0.3)) this.melt(world, x, y, i); // rain washes snow away
      return;
    }
    // Rain greens bare ground (faster than vegetation succession alone) when the soil is wet enough
    // and it is not winter.
    if (id === T.SOIL && season !== 3 && world.moisture[i] >= 110 && rng.chance(0.06 * k)) {
      world.setTerrain(x, y, T.GRASS);
      this.stats.greened++;
      return;
    }
    // Dried beds refill.
    if (!isWater(id) && flags & (WATER_FLAG.LAKE_BED | WATER_FLAG.RIVER_BED) && rng.chance(0.25 * k)) {
      world.setTerrain(x, y, flags & WATER_FLAG.LAKE_BED ? T.LAKE : T.RIVER);
      this.stats.refilled++;
      return;
    }
    // Heavy rain: low land next to fresh water floods (temporary water).
    if (k > 0.5 && !isWater(id) && id !== T.MOUNTAIN && id !== T.SNOW && rng.chance(0.08 * k)) {
      const h = world.heights[i];
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!world.inBounds(nx, ny)) continue;
        const j = world.idx(nx, ny);
        const nid = world.terrain[j];
        if ((nid === T.RIVER || nid === T.LAKE) && h <= world.heights[j] + 2) {
          world.under[i] = id;
          world.setWaterFlags(i, flags | WATER_FLAG.FLOOD);
          world.setTerrain(x, y, T.LAKE);
          this.stats.floods++;
          return;
        }
      }
    }
  }

  private droughtOn(world: World, rng: Rng, x: number, y: number, i: number, k: number): void {
    world.moisture[i] = Math.max(0, world.moisture[i] - Math.round(14 * k));
    world.temperature[i] = Math.min(255, world.temperature[i] + Math.round(3 * k));
    const id = world.terrain[i];
    const flags = world.waterFlags[i];
    if (flags & WATER_FLAG.SNOWCOVER) {
      if (rng.chance(0.5)) this.melt(world, x, y, i);
      return;
    }
    if (flags & WATER_FLAG.FLOOD) {
      if (rng.chance(0.5)) this.drain(world, x, y, i);
      return;
    }
    if (id === T.LAKE && flags & WATER_FLAG.LAKE_BED && this.isShore(world, x, y) && rng.chance(0.12 * k)) {
      world.setTerrain(x, y, T.SOIL); // dried lake bed (mud)
      this.stats.dried++;
      return;
    }
    if (id === T.RIVER && flags & WATER_FLAG.RIVER_BED && rng.chance(0.06 * k)) {
      world.setTerrain(x, y, T.SAND); // dry river bed
      this.stats.dried++;
      return;
    }
    // Vegetation withers when the ground is parched.
    if (world.moisture[i] < 50) {
      if ((id === T.GRASS || id === T.SAVANNA) && rng.chance(0.05 * k)) {
        world.setTerrain(x, y, T.SOIL);
        this.stats.withered++;
      } else if ((id === T.FOREST || id === T.JUNGLE) && rng.chance(0.02 * k)) {
        world.setTerrain(x, y, T.GRASS);
        this.stats.withered++;
      }
    }
  }

  /** Flood water drains: the tile returns to the terrain it covered. */
  private drain(world: World, x: number, y: number, i: number): void {
    world.setWaterFlags(i, world.waterFlags[i] & ~WATER_FLAG.FLOOD);
    world.setTerrain(x, y, world.under[i]);
    this.stats.drained++;
  }

  private isShore(world: World, x: number, y: number): boolean {
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (world.inBounds(nx, ny) && !isWater(world.terrain[world.idx(nx, ny)])) return true;
    }
    return false;
  }

  /**
   * Map-wide, sampled: climate relaxes toward its long-term values, flood water
   * evaporates, and dried beds slowly recover where the climate is not dry.
   */
  private relax(world: World, rng: Rng, season: number): void {
    const n = world.width * world.height;
    const samples = Math.ceil(n * 0.02); // each tile ≈ once per game year
    for (let s = 0; s < samples; s++) {
      const i = Math.floor(rng.next() * n);
      world.moisture[i] += Math.round((world.baseMoisture[i] - world.moisture[i]) * 0.25);
      world.temperature[i] += Math.round((world.baseTemperature[i] - world.temperature[i]) * 0.25);
      const flags = world.waterFlags[i];
      if (!flags) continue;
      const x = i % world.width;
      const y = (i - x) / world.width;
      if (this.wetnessAt(x, y) > 0) continue; // still raining or snowing here
      if (flags & WATER_FLAG.SNOWCOVER) {
        if (season !== 3 && rng.chance(0.3)) this.melt(world, x, y, i); // melts from spring to autumn
      } else if (flags & WATER_FLAG.FLOOD) {
        if (rng.chance(0.3)) this.drain(world, x, y, i);
      } else if (
        flags & (WATER_FLAG.LAKE_BED | WATER_FLAG.RIVER_BED) && !isWater(world.terrain[i]) && this.wetnessAt(x, y) === 0 &&
        world.moisture[i] >= world.baseMoisture[i] - 10
      ) {
        if (rng.chance(0.3)) {
          world.setTerrain(x, y, flags & WATER_FLAG.LAKE_BED ? T.LAKE : T.RIVER);
          this.stats.refilled++;
        }
      }
    }
  }

  private rebuildGrid(world: World): void {
    this.gridW = Math.ceil(world.width / CELL);
    this.gridH = Math.ceil(world.height / CELL);
    const cells = this.gridW * this.gridH;
    if (this.grid.length !== cells) this.grid = new Float32Array(cells);
    this.grid.fill(0);
    for (const s of this.systems) {
      const sign = s.kind === WEATHER_KIND.RAIN ? 1 : -1;
      const r = s.radius;
      const gx0 = Math.max(0, Math.floor((s.x - r) / CELL));
      const gy0 = Math.max(0, Math.floor((s.y - r) / CELL));
      const gx1 = Math.min(this.gridW - 1, Math.floor((s.x + r) / CELL));
      const gy1 = Math.min(this.gridH - 1, Math.floor((s.y + r) / CELL));
      for (let gy = gy0; gy <= gy1; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const cx = (gx + 0.5) * CELL;
          const cy = (gy + 0.5) * CELL;
          if (Math.hypot(cx - s.x, cy - s.y) > r) continue;
          const c = gy * this.gridW + gx;
          this.grid[c] = Math.max(-1, Math.min(1, this.grid[c] + sign * s.intensity));
        }
      }
    }
  }

  /** Recomputes derived data after loading. */
  refresh(world: World): void {
    this.rebuildGrid(world);
  }

  /** Overall state for the HUD. */
  summary(): { rain: number; storm: number; snow: number; drought: number } {
    let rain = 0;
    let storm = 0;
    let snow = 0;
    let drought = 0;
    for (const s of this.systems) {
      if (s.kind === WEATHER_KIND.DROUGHT) drought++;
      else if (s.snow) snow++;
      else if (s.storm) storm++;
      else rain++;
    }
    return { rain, storm, snow, drought };
  }
}
