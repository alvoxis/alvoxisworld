/**
 * Where trees stand (0.23). Trees are part of the terrain: forest and jungle tiles are woodland, and tundra and
 * savanna carry a lone conifer or acacia on some tiles. How many trees a tile shows comes from a fixed hash of the
 * tile and the world seed, so the painter (render/painter.ts), building placement (sim/civ.ts) and tree felling
 * (sim/forestry.ts) all agree on it without storing anything. A felled tree leaves a stump (World.stump), and a tile
 * with a stump has no tree until the stump has rotted away.
 */
import { hash2 } from '../core/rng';
import { T } from './terrain';
import type { World } from './world';

/** Terrain that is woodland (each tile a stand of trees; felling one clears it to grass). */
export const WOODLAND: readonly number[] = [T.FOREST, T.JUNGLE];

/** The fixed per-tile values the tree layout is made from. */
export function treeHashes(world: World, tx: number, ty: number): { h1: number; h2: number; h3: number } {
  const seed = world.seed;
  return {
    h1: hash2(tx, ty, seed ^ 0x68e31da4),
    h2: hash2(ty, tx, seed ^ 0x1b56c4e9),
    h3: hash2(tx * 3 + 1, ty * 5 + 2, seed ^ 0x2c1b3c6d),
  };
}

/** Whether a forest tile is at the forest's edge (a side neighbour is not woodland). */
export function forestEdge(world: World, tx: number, ty: number): boolean {
  const W = world.width;
  const i = ty * W + tx;
  const t = world.terrain;
  const wood = (n: number) => t[n] === T.FOREST || t[n] === T.JUNGLE;
  return (tx > 0 && !wood(i - 1)) || (tx < W - 1 && !wood(i + 1)) || (ty > 0 && !wood(i - W)) || (ty < world.height - 1 && !wood(i + W));
}

/** Whether a tile borders a river (banks stay clear of trees so canopies never hide the water). */
function riverBank(world: World, tx: number, ty: number): boolean {
  const W = world.width;
  const i = ty * W + tx;
  const t = world.terrain;
  return (tx > 0 && t[i - 1] === T.RIVER) || (tx < W - 1 && t[i + 1] === T.RIVER) || (ty > 0 && t[i - W] === T.RIVER) || (ty < world.height - 1 && t[i + W] === T.RIVER);
}

/**
 * Number of trees standing on tile (tx, ty): 0, 1 or 2. Forest has two trees on about a third of its interior tiles,
 * one on most others and natural gaps (0.23: about a quarter fewer than before); its edge thins out. Jungle is
 * dense; tundra and savanna have a lone tree on some tiles. No trees on river banks, where a stump stands, or on
 * built ground.
 */
export function treesOn(world: World, tx: number, ty: number): number {
  const i = ty * world.width + tx;
  if (world.stump[i] || world.built[i]) return 0;
  const id = world.terrain[i];
  let n = 0;
  if (id === T.FOREST) {
    const { h1 } = treeHashes(world, tx, ty);
    n = forestEdge(world, tx, ty) ? (h1 < 0.62 ? 1 : 0) : h1 < 0.36 ? 2 : h1 < 0.9 ? 1 : 0;
  } else if (id === T.JUNGLE) {
    n = treeHashes(world, tx, ty).h1 < 0.6 ? 2 : 1;
  } else if (id === T.TUNDRA) {
    n = treeHashes(world, tx, ty).h1 < 0.22 ? 1 : 0;
  } else if (id === T.SAVANNA) {
    n = treeHashes(world, tx, ty).h1 < 0.28 ? 1 : 0;
  } else return 0;
  return n && riverBank(world, tx, ty) ? 0 : n;
}
