import { classify, SEA_LEVEL, T, TERRAIN, isWater, MOUNTAIN_LEVEL, HILLS_LEVEL } from './terrain';
import { WATER_FLAG, World } from './world';

export type TerrainToolKind = 'raise' | 'lower' | 'smooth' | 'paint';

export interface BrushStroke {
  x: number;
  y: number;
  radius: number;
  /** Strength multiplier for height tools (per application). */
  strength?: number;
}

/** Calls fn for every tile in a circle with a 0..1 falloff weight (1 at the centre). */
export function forEachInCircle(
  world: World,
  cx: number,
  cy: number,
  radius: number,
  fn: (x: number, y: number, weight: number) => void,
): void {
  const r = Math.max(0.5, radius);
  const x0 = Math.max(0, Math.floor(cx - r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(world.width - 1, Math.ceil(cx + r));
  const y1 = Math.min(world.height - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > r) continue;
      fn(x, y, 1 - d / (r + 0.5));
    }
  }
}

/**
 * Re-derives a tile's terrain from its height and climate after a height edit.
 *
 * Water rule: rivers and lakes (including temporary flood water) keep their
 * terrain while the tile stays at or above sea level, so Raise/Lower/Smooth never
 * silently erase them. A fresh-water tile pushed below sea level becomes sea, and
 * its lake/river memory is cleared. Painting a biome over water replaces it.
 */
export function reclassify(world: World, x: number, y: number): void {
  const i = world.idx(x, y);
  const cur = world.terrain[i];
  if ((cur === T.RIVER || cur === T.LAKE) && world.heights[i] >= SEA_LEVEL) return;
  const id = classify(world.heights[i], world.temperature[i] / 255, world.moisture[i] / 255);
  if (cur === T.RIVER || cur === T.LAKE) world.setWaterFlags(i, 0);
  world.setTerrain(x, y, id);
}

/**
 * Height limits for the sculpting tools (heights are 0..255, sea level 110): the deepest sea floor and the highest
 * peak a brush may make. Mountains start at MOUNTAIN_LEVEL; land species that cannot climb never cross them.
 */
export const HEIGHT_LIMITS = { min: 8, max: 250 } as const;
/** Height change at the centre of a stroke for power 1, 2 and 3. */
export const BRUSH_STRENGTH: readonly number[] = [3, 6, 10];

function setHeight(world: World, x: number, y: number, h: number): void {
  world.setHeight(x, y, Math.max(HEIGHT_LIMITS.min, Math.min(HEIGHT_LIMITS.max, h)));
}

/**
 * Raises (sign 1) or lowers (sign -1) terrain, then re-derives biomes. The change falls off with the square of the
 * distance from the centre and slows down near the height limits, so repeated strokes build a peak with slopes
 * (not a flat-topped block) and a pit with sloping sides.
 */
export function applyHeightBrush(world: World, s: BrushStroke, sign: 1 | -1): void {
  const strength = s.strength ?? 6;
  forEachInCircle(world, s.x, s.y, s.radius, (x, y, w) => {
    const i = world.idx(x, y);
    const h = world.heights[i];
    const room = sign > 0 ? HEIGHT_LIMITS.max - h : h - HEIGHT_LIMITS.min;
    const soft = Math.max(0.15, Math.min(1, room / 60)); // slower in the last 60 steps before a limit
    const delta = sign * Math.max(w > 0.35 ? 1 : 0, strength * w * w * soft);
    if (!delta) return;
    setHeight(world, x, y, h + delta);
    reclassify(world, x, y);
  });
}

/**
 * Deepens water only: every water tile under the brush is lowered (land is left alone), so repeated strokes
 * make the sea deeper (shallow becomes deep water below SHALLOW_DEPTH). A lake or river pushed below sea
 * level becomes sea, as with Lower.
 */
export function applyDeepenBrush(world: World, s: BrushStroke): void {
  const strength = s.strength ?? 6;
  forEachInCircle(world, s.x, s.y, s.radius, (x, y, w) => {
    const i = world.idx(x, y);
    if (!isWater(world.terrain[i])) return;
    setHeight(world, x, y, world.heights[i] - Math.max(1, strength * w));
    reclassify(world, x, y);
  });
}

/** Averages heights with neighbours, flattening spikes and coasts. */
export function applySmoothBrush(world: World, s: BrushStroke): void {
  const updates: Array<[number, number, number]> = [];
  forEachInCircle(world, s.x, s.y, s.radius, (x, y, w) => {
    let sum = 0;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (!world.inBounds(nx, ny)) continue;
        sum += world.heights[world.idx(nx, ny)];
        n++;
      }
    }
    const cur = world.heights[world.idx(x, y)];
    updates.push([x, y, cur + (sum / n - cur) * Math.min(1, 0.6 * w + 0.2)]);
  });
  for (const [x, y, h] of updates) {
    setHeight(world, x, y, h);
    reclassify(world, x, y);
  }
}

/**
 * Paints a terrain type. Heights and climate are adjusted so the painted tile is
 * consistent with the simulation (water is below sea level, land above, and the
 * climate matches the biome so it can spread naturally).
 */
export function applyPaintBrush(world: World, s: BrushStroke, terrainId: number): void {
  const def = TERRAIN[terrainId];
  forEachInCircle(world, s.x, s.y, s.radius, (x, y) => {
    const i = world.idx(x, y);
    const h = world.heights[i];
    if (terrainId === T.RIVER || terrainId === T.LAKE) {
      // Fresh water sits above sea level; on the sea floor it would just be ocean.
      if (h < SEA_LEVEL) setHeight(world, x, y, SEA_LEVEL + 1);
      else if (h >= MOUNTAIN_LEVEL) setHeight(world, x, y, HILLS_LEVEL - 4);
      // Painted water is permanent: it remembers its bed so droughts can only dry it temporarily.
      world.setWaterFlags(i, terrainId === T.LAKE ? WATER_FLAG.LAKE_BED : WATER_FLAG.RIVER_BED);
      world.setTerrain(x, y, terrainId);
      return;
    }
    // Any other paint replaces water features, including their bed memory.
    if (world.waterFlags[i]) world.setWaterFlags(i, 0);
    if (def.water) {
      const target = terrainId === T.DEEP_WATER ? SEA_LEVEL - 26 : SEA_LEVEL - 6;
      if (terrainId === T.DEEP_WATER ? h > target : h >= SEA_LEVEL || h < target) setHeight(world, x, y, target);
      reclassify(world, x, y);
      return;
    }
    if (terrainId === T.MOUNTAIN) {
      if (h < MOUNTAIN_LEVEL + 6) setHeight(world, x, y, MOUNTAIN_LEVEL + 6 + ((x * 7 + y * 13) % 12));
    } else if (terrainId === T.HILLS) {
      if (h < HILLS_LEVEL + 2 || h >= MOUNTAIN_LEVEL) setHeight(world, x, y, HILLS_LEVEL + 4 + ((x * 5 + y * 3) % 10));
    } else if (h < SEA_LEVEL + 4 && terrainId !== T.SAND) {
      setHeight(world, x, y, SEA_LEVEL + 6);
    } else if (h < SEA_LEVEL) {
      setHeight(world, x, y, SEA_LEVEL + 2);
    } else if (h >= MOUNTAIN_LEVEL && terrainId !== T.SNOW) {
      setHeight(world, x, y, HILLS_LEVEL - 4);
    }
    if (def.climate) {
      world.setClimate(x, y, Math.round(def.climate.temperature * 255), Math.round(def.climate.moisture * 255));
    }
    world.setTerrain(x, y, terrainId);
  });
}

/** Returns true if the tile under (x, y) is land. */
export function isLand(world: World, x: number, y: number): boolean {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  return world.inBounds(tx, ty) && !isWater(world.terrain[world.idx(tx, ty)]);
}
