import { Simplex2 } from '../core/noise';
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
];

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
export function generateWorld(width: number, height: number, seed: number): World {
  const world = new World(width, height, seed);
  const elevationNoise = new Simplex2(seed);
  const continentNoise = new Simplex2(seed ^ 0x9e3779b9);
  const ridgeNoise = new Simplex2(seed ^ 0x85ebca6b);
  const tempNoise = new Simplex2(seed ^ 0xc2b2ae35);
  const moistNoise = new Simplex2(seed ^ 0x27d4eb2f);

  const sea = SEA_LEVEL / 255;
  const edge = Math.min(width, height) * 0.12;

  for (let y = 0; y < height; y++) {
    const lat = Math.abs(y / (height - 1) - 0.5) * 2; // 0 at equator, 1 at the poles
    for (let x = 0; x < width; x++) {
      const continent = continentNoise.fbm(x / 210, y / 210, 3);
      const detail = elevationNoise.fbm(x / 70, y / 70, 5);
      let e = 0.47 + continent * 0.36 + detail * 0.16;

      // Ridged mountain ranges, only on already-high land.
      const r = 1 - Math.abs(ridgeNoise.fbm(x / 90, y / 90, 4));
      e += r * r * r * 0.32 * smoothstep(sea + 0.02, sea + 0.18, e);

      // Fade to ocean near the map border so the world reads as islands/continents.
      const d = Math.min(x, y, width - 1 - x, height - 1 - y);
      e -= (1 - smoothstep(0, edge, d)) * 0.75;
      e = clamp01(e);

      const above = Math.max(0, e - sea);
      const temperature = clamp01(1.04 - Math.pow(lat, 1.6) * 0.98 + tempNoise.fbm(x / 120, y / 120, 3) * 0.14 - above * 0.7);
      const moisture = clamp01(0.5 + moistNoise.fbm(x / 110, y / 110, 4) * 0.85);

      const i = y * width + x;
      const h = Math.round(e * 255);
      world.heights[i] = h;
      world.temperature[i] = Math.round(temperature * 255);
      world.moisture[i] = Math.round(moisture * 255);
      world.terrain[i] = classify(h, temperature, moisture);
    }
  }
  world.markAllDirty();
  return world;
}
