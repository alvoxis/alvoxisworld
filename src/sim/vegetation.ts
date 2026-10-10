import { Rng } from '../core/rng';
import { classify, SEA_LEVEL, T } from '../world/terrain';
import { World } from '../world/world';

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

/**
 * Random-tick vegetation: a fixed fraction of tiles is sampled each tick, so cost
 * scales linearly with world area and never needs a full-map pass.
 *  - Bare soil regrows into its natural biome (grass first, as succession).
 *  - Forest and jungle spread into neighbouring grass when the climate is wet enough.
 *  - Grass colonises inland sand when the climate is wet enough.
 */
export function vegetationTick(world: World, rng: Rng, growth: number): void {
  const samples = Math.ceil(world.width * world.height * 0.003);
  for (let s = 0; s < samples; s++) {
    if (!rng.chance(growth / 1.6)) continue;
    const x = Math.floor(rng.next() * world.width);
    const y = Math.floor(rng.next() * world.height);
    const i = world.idx(x, y);
    const id = world.terrain[i];
    const temp = world.temperature[i] / 255;
    const moist = world.moisture[i] / 255;

    if (id === T.SOIL) {
      let natural: number = classify(world.heights[i], temp, moist);
      if (natural === T.FOREST || natural === T.JUNGLE || natural === T.SWAMP) natural = T.GRASS;
      if (rng.chance(0.35)) world.setTerrain(x, y, natural);
      continue;
    }

    const [dx, dy] = NEIGHBOURS[Math.floor(rng.next() * 4)];
    const nx = x + dx;
    const ny = y + dy;
    if (!world.inBounds(nx, ny)) continue;
    const n = world.terrain[world.idx(nx, ny)];

    if (id === T.GRASS) {
      if (n === T.FOREST && moist > 0.48 && temp > 0.3 && rng.chance(0.25)) world.setTerrain(x, y, T.FOREST);
      else if (n === T.JUNGLE && moist > 0.55 && temp > 0.65 && rng.chance(0.25)) world.setTerrain(x, y, T.JUNGLE);
    } else if (id === T.SAND) {
      if (n === T.GRASS && moist > 0.38 && world.heights[i] >= SEA_LEVEL + 4 && rng.chance(0.2)) {
        world.setTerrain(x, y, T.GRASS);
      }
    } else if (id === T.SAVANNA) {
      if (n === T.JUNGLE && moist > 0.5 && rng.chance(0.15)) world.setTerrain(x, y, T.JUNGLE);
    }
  }
}
