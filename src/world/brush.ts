import { classify, SEA_LEVEL, T, TERRAIN, isWater, MOUNTAIN_LEVEL, HILLS_LEVEL } from './terrain';
import { World } from './world';

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

function reclassify(world: World, x: number, y: number): void {
  const i = world.idx(x, y);
  const id = classify(world.heights[i], world.temperature[i] / 255, world.moisture[i] / 255);
  world.setTerrain(x, y, id);
}

function setHeight(world: World, x: number, y: number, h: number): void {
  const i = world.idx(x, y);
  const v = Math.max(0, Math.min(255, Math.round(h)));
  if (world.heights[i] !== v) {
    world.heights[i] = v;
    world.markDirty(x, y);
  }
}

/** Raises (sign 1) or lowers (sign -1) terrain with a soft falloff, then re-derives biomes. */
export function applyHeightBrush(world: World, s: BrushStroke, sign: 1 | -1): void {
  const strength = s.strength ?? 6;
  forEachInCircle(world, s.x, s.y, s.radius, (x, y, w) => {
    const i = world.idx(x, y);
    const delta = sign * Math.max(1, strength * w);
    setHeight(world, x, y, world.heights[i] + delta);
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
      world.setTerrain(x, y, terrainId);
      return;
    }
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
      world.temperature[i] = Math.round(def.climate.temperature * 255);
      world.moisture[i] = Math.round(def.climate.moisture * 255);
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
