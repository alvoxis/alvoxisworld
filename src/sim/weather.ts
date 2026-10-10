import { Rng } from '../core/rng';
import { T, isWater } from '../world/terrain';
import { WATER_FLAG, World } from '../world/world';

export const WEATHER_KIND = { RAIN: 0, DROUGHT: 1 } as const;
export type WeatherKind = (typeof WEATHER_KIND)[keyof typeof WEATHER_KIND];

/** A moving weather system (storm or heat wave). Positions/radius in tiles. */
export interface WeatherSystem {
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

/** Chance per weather step that a new automatic system forms, by season (spring…winter). */
const FORM_CHANCE = [
  { rain: 0.05, drought: 0.01 },
  { rain: 0.025, drought: 0.04 },
  { rain: 0.05, drought: 0.015 },
  { rain: 0.02, drought: 0.005 },
];

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
  /** Coarse per-cell signed wetness (+1 rain … −1 drought), rebuilt each weather step. */
  private grid = new Float32Array(0);
  private gridW = 0;
  private gridH = 0;
  /** Counters for statistics and tests. */
  stats = { floods: 0, drained: 0, refilled: 0, dried: 0, withered: 0 };

  addManual(kind: WeatherKind, x: number, y: number, radius: number, intensity: number): WeatherSystem {
    const sys: WeatherSystem = { kind, x, y, radius, intensity: Math.min(1, intensity), ttl: 400, manual: true };
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
    for (const s of this.systems) this.apply(world, rng, s);
    this.relax(world, rng);
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
    const make = (kind: WeatherKind) => {
      const size = Math.min(world.width, world.height);
      this.systems.push({
        kind,
        x: rng.next() * world.width,
        y: rng.next() * world.height,
        radius: size * (0.08 + rng.next() * 0.12),
        intensity: strength * (0.6 + rng.next() * 0.4),
        ttl: 600 + Math.floor(rng.next() * 1200),
        manual: false,
      });
    };
    if (rng.chance(c.rain * freq)) make(WEATHER_KIND.RAIN);
    else if (rng.chance(c.drought * freq)) make(WEATHER_KIND.DROUGHT);
  }

  private move(world: World, rng: Rng): void {
    this.wind += (rng.next() - 0.5) * 0.3;
    const vx = Math.cos(this.wind) * 0.04 * WEATHER_STEP;
    const vy = Math.sin(this.wind) * 0.04 * WEATHER_STEP;
    this.systems = this.systems.filter((s) => {
      s.ttl -= WEATHER_STEP;
      if (!s.manual) {
        s.x += vx;
        s.y += vy;
      }
      const off = s.x < -s.radius || s.y < -s.radius || s.x > world.width + s.radius || s.y > world.height + s.radius;
      return s.ttl > 0 && !off;
    });
  }

  /** Samples tiles under a system and applies its effects. */
  private apply(world: World, rng: Rng, s: WeatherSystem): void {
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
      if (rain) this.rainOn(world, rng, x, y, i, k);
      else this.droughtOn(world, rng, x, y, i, k);
    }
  }

  private rainOn(world: World, rng: Rng, x: number, y: number, i: number, k: number): void {
    world.moisture[i] = Math.min(255, world.moisture[i] + Math.round(14 * k));
    world.temperature[i] = Math.max(0, world.temperature[i] - Math.round(3 * k));
    if (world.fire[i]) world.fire[i] = 0;
    const id = world.terrain[i];
    const flags = world.waterFlags[i];
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
  private relax(world: World, rng: Rng): void {
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
      if (this.wetnessAt(x, y) > 0) continue; // still raining here
      if (flags & WATER_FLAG.FLOOD) {
        if (rng.chance(0.3)) this.drain(world, x, y, i);
      } else if (!isWater(world.terrain[i]) && this.wetnessAt(x, y) === 0 && world.moisture[i] >= world.baseMoisture[i] - 10) {
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
  summary(): { rain: number; drought: number } {
    let rain = 0;
    let drought = 0;
    for (const s of this.systems) {
      if (s.kind === WEATHER_KIND.RAIN) rain++;
      else drought++;
    }
    return { rain, drought };
  }
}
