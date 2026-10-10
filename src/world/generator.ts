import { Simplex2 } from '../core/noise';
import { addHydrology, DEFAULT_HYDROLOGY } from './hydrology';
import { classify, SEA_LEVEL } from './terrain';
import { World } from './world';

export interface WorldSize {
  key: string;
  label: string;
  width: number;
  height: number;
}

export const WORLD_SIZES: readonly WorldSize[] = [
  { key: 'small', label: 'Small (256×160)', width: 256, height: 160 },
  { key: 'medium', label: 'Medium (512×320)', width: 512, height: 320 },
  { key: 'large', label: 'Large (1024×640)', width: 1024, height: 640 },
  { key: 'huge', label: 'Huge (1536×960)', width: 1536, height: 960 },
  { key: 'giant', label: 'Giant (2048×1280)', width: 2048, height: 1280 },
];

/** Custom sizes: each side a multiple of CUSTOM_STEP within these bounds, and at most MAX_WORLD_TILES. */
export const CUSTOM_STEP = 32;
export const MIN_WORLD_SIDE = 128;
export const MAX_WORLD_SIDE = 4096;
export const MAX_WORLD_TILES = 4 * 1024 * 1024;

/** Validates a custom size; returns an error message or null. */
export function checkWorldSize(width: number, height: number): string | null {
  for (const v of [width, height]) {
    if (!Number.isInteger(v)) return 'Width and height must be whole numbers';
    if (v < MIN_WORLD_SIDE || v > MAX_WORLD_SIDE) return `Each side must be ${MIN_WORLD_SIDE}–${MAX_WORLD_SIDE} tiles`;
    if (v % CUSTOM_STEP) return `Each side must be a multiple of ${CUSTOM_STEP}`;
  }
  if (width * height > MAX_WORLD_TILES) return `At most ${(MAX_WORLD_TILES / 1048576).toFixed(0)}M tiles (e.g. 2048×2048)`;
  return null;
}

/** Reference area: medium maps (and smaller) use feature scale 1. */
const REFERENCE_TILES = 512 * 320;

/**
 * How much larger continents, mountain ranges and climate zones are on this map
 * than on a medium one: grows with the square root of the area, capped so giant
 * maps still hold several continents. 1 for medium and smaller maps, so those
 * generate exactly as before.
 */
export function featureScale(width: number, height: number): number {
  return Math.min(2.5, Math.max(1, Math.sqrt((width * height) / REFERENCE_TILES)));
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * Procedurally generates a world: continents surrounded by ocean, ridged mountain
 * ranges, latitude-based temperature and noise-based moisture, then classifies biomes.
 * Fully deterministic for a given (width, height, seed).
 */
export interface GenerateOptions {
  /** Add rivers and lakes (default true). */
  hydrology?: boolean;
}

export function generateWorld(width: number, height: number, seed: number, options: GenerateOptions = {}): World {
  const world = new World(width, height, seed);
  const elevationNoise = new Simplex2(seed);
  const continentNoise = new Simplex2(seed ^ 0x9e3779b9);
  const ridgeNoise = new Simplex2(seed ^ 0x85ebca6b);
  const tempNoise = new Simplex2(seed ^ 0xc2b2ae35);
  const moistNoise = new Simplex2(seed ^ 0x27d4eb2f);

  const f = featureScale(width, height);
  const cs = 210 * f; // continents
  const ds = 70 * Math.sqrt(f); // hills and coastline detail
  const rs = 90 * Math.sqrt(f); // mountain ranges
  const ts = 120 * Math.sqrt(f); // temperature variation
  const ms = 110 * Math.sqrt(f); // moisture (biome patches)
  const sea = SEA_LEVEL / 255;
  const edge = Math.min(width, height) * 0.12;

  for (let y = 0; y < height; y++) {
    const lat = Math.abs(y / (height - 1) - 0.5) * 2; // 0 at equator, 1 at the poles
    for (let x = 0; x < width; x++) {
      const continent = continentNoise.fbm(x / cs, y / cs, 3);
      const detail = elevationNoise.fbm(x / ds, y / ds, 5);
      let e = 0.47 + continent * 0.36 + detail * 0.16;

      // Ridged mountain ranges, only on already-high land.
      const r = 1 - Math.abs(ridgeNoise.fbm(x / rs, y / rs, 4));
      e += r * r * r * 0.32 * smoothstep(sea + 0.02, sea + 0.18, e);

      // Fade to ocean near the map border so the world reads as islands/continents.
      const d = Math.min(x, y, width - 1 - x, height - 1 - y);
      e -= (1 - smoothstep(0, edge, d)) * 0.75;
      e = clamp01(e);

      const above = Math.max(0, e - sea);
      const temperature = clamp01(1.04 - Math.pow(lat, 1.6) * 0.98 + tempNoise.fbm(x / ts, y / ts, 3) * 0.14 - above * 0.7);
      const moisture = clamp01(0.5 + moistNoise.fbm(x / ms, y / ms, 4) * 0.85);

      const i = y * width + x;
      const h = Math.round(e * 255);
      world.heights[i] = h;
      world.temperature[i] = Math.round(temperature * 255);
      world.moisture[i] = Math.round(moisture * 255);
      world.terrain[i] = classify(h, temperature, moisture);
    }
  }
  world.baseTemperature.set(world.temperature);
  world.baseMoisture.set(world.moisture);
  if (options.hydrology !== false) {
    // Bigger maps have bigger catchments: their main rivers widen to two tiles.
    // Their smoother, wider basins would also hold far more lakes, so lakes need deeper, larger basins.
    const opts = f > 1
      ? {
          ...DEFAULT_HYDROLOGY,
          lakeDepth: Math.round(DEFAULT_HYDROLOGY.lakeDepth * (1 + (f - 1) * 0.8)),
          minLakeSize: Math.round(DEFAULT_HYDROLOGY.minLakeSize * f * f),
          wideRiverFlow: DEFAULT_HYDROLOGY.riverThreshold * 14,
        }
      : DEFAULT_HYDROLOGY;
    addHydrology(world, opts);
  }
  world.markAllDirty();
  return world;
}
