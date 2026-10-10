import { Rng } from '../core/rng';
import { reclassify } from '../world/brush';
import { SEA_LEVEL, T, isWater } from '../world/terrain';
import { WATER_FLAG, World } from '../world/world';
import { CAUSE, Creatures } from './creatures';
import { Fire, fuelOf } from './fire';

export interface DisasterResult {
  /** Tiles whose height or terrain changed. */
  tiles: number;
  killed: number;
  ignited: number;
}

/** Maximum fires a single meteor can start (they still spread by the fire rules). */
export const METEOR_MAX_IGNITIONS = 60;

/**
 * Meteor impact: digs a bowl-shaped crater with a raised rim, scorches the floor to
 * bare soil (a crater below sea level fills as a crater lake), kills animals inside
 * the crater, injures those near it, and sets a ring of fires on burnable land.
 * intensity 1..3 scales size and depth.
 */
export function meteorStrike(
  world: World, creatures: Creatures, fire: Fire, rng: Rng, cx: number, cy: number, radius: number, intensity: number,
): DisasterResult {
  const R = Math.max(2, radius) * (0.7 + 0.3 * intensity);
  const depth = 18 + 14 * intensity;
  const reach = R * 1.4;
  let tiles = 0;
  let ignited = 0;
  const x0 = Math.max(0, Math.floor(cx - reach));
  const y0 = Math.max(0, Math.floor(cy - reach));
  const x1 = Math.min(world.width - 1, Math.ceil(cx + reach));
  const y1 = Math.min(world.height - 1, Math.ceil(cy + reach));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / R;
      if (d > 1.4) continue;
      const i = world.idx(x, y);
      const h = world.heights[i];
      if (d < 1) {
        world.setHeight(x, y, h - depth * (1 - d * d));
        const id = world.terrain[i];
        if (id === T.RIVER || id === T.LAKE) {
          if (world.heights[i] < SEA_LEVEL) world.setHeight(x, y, SEA_LEVEL); // fresh water stays above the sea
        } else if (world.waterFlags[i]) {
          world.setWaterFlags(i, 0);
        }
        if (world.heights[i] < SEA_LEVEL && !isWater(world.terrain[i])) {
          // Crater below sea level: a crater lake (fresh water, stays put).
          world.setHeight(x, y, SEA_LEVEL);
          world.setWaterFlags(i, WATER_FLAG.LAKE_BED);
          world.setTerrain(x, y, T.LAKE);
        } else if (!isWater(world.terrain[i])) {
          reclassify(world, x, y);
          world.setTerrain(x, y, T.SOIL);
        }
        world.fire[i] = 0;
        tiles++;
      } else if (d < 1.25) {
        world.setHeight(x, y, h + 5 * intensity * (1 - (d - 1) / 0.25));
        reclassify(world, x, y);
        tiles++;
      }
      if (d >= 0.9 && ignited < METEOR_MAX_IGNITIONS && fuelOf(world.terrain[i]) > 0 && rng.chance(0.5)) {
        if (fire.ignite(world, x, y)) ignited++;
      }
    }
  }
  const killed = creatures.hurtInCircle(cx, cy, R * 2, (d) => (d < 0.5 ? 10 : 1.2 * (1 - d)), CAUSE.METEOR);
  return { tiles, killed, ignited };
}

/**
 * Earthquake: a fault line through the epicentre drops into a rift, the ground
 * around it buckles (random height changes fading with distance), terrain is
 * re-derived (water features kept, per the brush water rule), and animals are
 * hurt by the shaking. intensity 1..3.
 */
export function earthquake(
  world: World, creatures: Creatures, rng: Rng, cx: number, cy: number, radius: number, intensity: number,
): DisasterResult {
  const R = Math.max(3, radius) * (0.8 + 0.4 * intensity);
  const angle = rng.next() * Math.PI;
  const fx = Math.cos(angle);
  const fy = Math.sin(angle);
  const drop = 6 + 6 * intensity;
  const jitter = 3 + 3 * intensity;
  let tiles = 0;
  const x0 = Math.max(0, Math.floor(cx - R));
  const y0 = Math.max(0, Math.floor(cy - R));
  const x1 = Math.min(world.width - 1, Math.ceil(cx + R));
  const y1 = Math.min(world.height - 1, Math.ceil(cy + R));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5 - cx;
      const py = y + 0.5 - cy;
      const d = Math.hypot(px, py) / R;
      if (d > 1) continue;
      const i = world.idx(x, y);
      const fromFault = Math.abs(px * fy - py * fx); // distance to the fault line
      let dh = (rng.next() - 0.5) * 2 * jitter * (1 - d);
      if (fromFault < 1.2) dh -= drop * (1 - d * 0.5);
      if (Math.round(dh) === 0) continue;
      world.setHeight(x, y, world.heights[i] + dh);
      reclassify(world, x, y);
      tiles++;
    }
  }
  const killed = creatures.hurtInCircle(cx, cy, R, (d) => (0.25 + 0.2 * intensity) * (1 - d), CAUSE.EARTHQUAKE);
  return { tiles, killed, ignited: 0 };
}
