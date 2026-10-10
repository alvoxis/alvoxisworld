/**
 * Terrain catalogue. Each tile stores one terrain id (Uint8).
 * Heights are 0..255; anything below SEA_LEVEL is water.
 */
export const T = {
  DEEP_WATER: 0,
  SHALLOW_WATER: 1,
  SAND: 2,
  GRASS: 3,
  FOREST: 4,
  JUNGLE: 5,
  DESERT: 6,
  SAVANNA: 7,
  SWAMP: 8,
  TUNDRA: 9,
  SNOW: 10,
  HILLS: 11,
  MOUNTAIN: 12,
  SOIL: 13,
} as const;

export type TerrainId = (typeof T)[keyof typeof T];

export const SEA_LEVEL = 110;
export const SHALLOW_DEPTH = 14;
export const HILLS_LEVEL = 172;
export const MOUNTAIN_LEVEL = 198;
export const PEAK_LEVEL = 230;

export interface TerrainDef {
  id: TerrainId;
  key: string;
  name: string;
  /** Base colour used for the zoomed-out map and tool swatches. */
  color: readonly [number, number, number];
  water: boolean;
  /** Herbivores can eat here. */
  edible: boolean;
  /** Ideal climate (0..1) applied when the player paints this biome. */
  climate?: { temperature: number; moisture: number };
}

export const TERRAIN: readonly TerrainDef[] = [
  { id: T.DEEP_WATER, key: 'deep_water', name: 'Deep ocean', color: [28, 64, 128], water: true, edible: false },
  { id: T.SHALLOW_WATER, key: 'shallow_water', name: 'Shallow water', color: [48, 112, 176], water: true, edible: false },
  { id: T.SAND, key: 'sand', name: 'Beach', color: [222, 204, 140], water: false, edible: false, climate: { temperature: 0.6, moisture: 0.35 } },
  { id: T.GRASS, key: 'grass', name: 'Grassland', color: [92, 164, 60], water: false, edible: true, climate: { temperature: 0.55, moisture: 0.42 } },
  { id: T.FOREST, key: 'forest', name: 'Forest', color: [42, 112, 44], water: false, edible: true, climate: { temperature: 0.5, moisture: 0.65 } },
  { id: T.JUNGLE, key: 'jungle', name: 'Jungle', color: [26, 120, 60], water: false, edible: true, climate: { temperature: 0.85, moisture: 0.85 } },
  { id: T.DESERT, key: 'desert', name: 'Desert', color: [232, 190, 110], water: false, edible: false, climate: { temperature: 0.85, moisture: 0.1 } },
  { id: T.SAVANNA, key: 'savanna', name: 'Savanna', color: [178, 172, 74], water: false, edible: true, climate: { temperature: 0.8, moisture: 0.4 } },
  { id: T.SWAMP, key: 'swamp', name: 'Swamp', color: [72, 98, 64], water: false, edible: true, climate: { temperature: 0.6, moisture: 0.92 } },
  { id: T.TUNDRA, key: 'tundra', name: 'Tundra', color: [140, 150, 120], water: false, edible: true, climate: { temperature: 0.25, moisture: 0.4 } },
  { id: T.SNOW, key: 'snow', name: 'Snow', color: [236, 242, 248], water: false, edible: false, climate: { temperature: 0.08, moisture: 0.5 } },
  { id: T.HILLS, key: 'hills', name: 'Hills', color: [110, 140, 70], water: false, edible: true },
  { id: T.MOUNTAIN, key: 'mountain', name: 'Mountain', color: [120, 116, 112], water: false, edible: false },
  { id: T.SOIL, key: 'soil', name: 'Bare soil', color: [128, 96, 64], water: false, edible: false },
];

export const TERRAIN_COUNT = TERRAIN.length;

export function isWater(id: number): boolean {
  return id === T.DEEP_WATER || id === T.SHALLOW_WATER;
}

/**
 * Derives the natural terrain for a tile from height and climate (all climate values 0..1).
 * Used by world generation and by height-changing brushes.
 */
export function classify(height: number, temperature: number, moisture: number): TerrainId {
  if (height < SEA_LEVEL - SHALLOW_DEPTH) return T.DEEP_WATER;
  if (height < SEA_LEVEL) return T.SHALLOW_WATER;
  if (height >= PEAK_LEVEL) return T.SNOW;
  if (height >= MOUNTAIN_LEVEL) return T.MOUNTAIN;
  if (temperature < 0.16) return T.SNOW;
  if (temperature < 0.3) return T.TUNDRA;
  if (height < SEA_LEVEL + 4) return T.SAND;
  if (height >= HILLS_LEVEL) return T.HILLS;
  if (temperature > 0.7) {
    if (moisture < 0.28) return T.DESERT;
    if (moisture < 0.55) return T.SAVANNA;
    return T.JUNGLE;
  }
  if (moisture < 0.2) return T.DESERT;
  if (moisture < 0.48) return T.GRASS;
  if (moisture > 0.74 && height < SEA_LEVEL + 24) return T.SWAMP;
  return T.FOREST;
}
