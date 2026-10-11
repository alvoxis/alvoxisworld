/**
 * Tree felling and stumps (0.23). Trees are part of the terrain (world/trees.ts); felling one is a real change of the
 * world: woodland becomes grass, a lone tree on tundra or savanna disappears, and a stump stands on the tile
 * (World.stump) until it rots away STUMP_ROT_TICKS later. Only then can a tree grow there again (woodland spreading
 * back in vegetation.ts, or a lone tree returning), and never on built ground (World.built).
 *
 * Wood comes from felled trees only: `fell` returns the wood of the trees that stood on the tile, once, and the
 * settlement adds it. Stumps are saved with the tick they were cut, so a loaded world rots them on time.
 */
import { T } from '../world/terrain';
import { treesOn } from '../world/trees';
import type { World } from '../world/world';

/** Wood of one tree before a species factor (as before 0.23: a lumber camp's tree). */
export const WOOD_PER_TREE = 10;
/** A stump rots away this many ticks after the tree was cut (two years). */
export const STUMP_ROT_TICKS = 960;
/** Stumps are checked for rot every this many ticks. */
const ROT_CHECK = 20;

/** Wood per tree by the terrain it grows on: oak and birch woods, dense jungle, lone conifers and acacias. */
export const TREE_WOOD: Readonly<Partial<Record<number, number>>> = {
  [T.FOREST]: 1,
  [T.JUNGLE]: 1.2,
  [T.TUNDRA]: 0.8,
  [T.SAVANNA]: 0.6,
};

/** Whether tile i has something to fell: trees, or woodland ground (a gap in a forest still has undergrowth to clear). */
export function fellable(world: World, i: number): boolean {
  const x = i % world.width;
  const y = (i - x) / world.width;
  return treesOn(world, x, y) > 0 || isWoodland(world, i);
}

function isWoodland(world: World, i: number): boolean {
  const t = world.terrain[i];
  return t === T.FOREST || t === T.JUNGLE;
}

/** Wood that felling tile i gives (0 for a gap in the woods). */
export function woodOf(world: World, i: number): number {
  const x = i % world.width;
  const y = (i - x) / world.width;
  const n = treesOn(world, x, y);
  return n * WOOD_PER_TREE * (TREE_WOOD[world.terrain[i]] ?? 1);
}

export class Forestry {
  /** Stumps: tile → tick the tree was cut. */
  readonly stumps = new Map<number, number>();

  /**
   * Fells the trees on tile i: returns their wood (0 if there were none). Woodland turns to grass; a stump marks the
   * tile (no tree shows or grows there until it rots). Nothing happens on a tile without trees or woodland.
   */
  fell(world: World, i: number, tick: number): number {
    if (!fellable(world, i)) return 0;
    const wood = woodOf(world, i);
    const x = i % world.width;
    const y = (i - x) / world.width;
    if (isWoodland(world, i)) world.setTerrain(x, y, T.GRASS);
    if (wood > 0) {
      world.stump[i] = 1;
      this.stumps.set(i, tick);
    }
    world.markDirty(x, y);
    return wood;
  }

  /** Rots stumps that are old enough (checked every ROT_CHECK ticks). */
  step(world: World, tick: number): void {
    if (tick % ROT_CHECK !== 0 || !this.stumps.size) return;
    for (const [i, t] of this.stumps) {
      if (tick - t < STUMP_ROT_TICKS) continue;
      this.stumps.delete(i);
      world.stump[i] = 0;
      const x = i % world.width;
      world.markDirty(x, (i - x) / world.width);
    }
  }

  /** Removes a stump at once (building on the tile, a fire, a terrain edit). */
  clear(world: World, i: number): void {
    if (!this.stumps.delete(i)) return;
    world.stump[i] = 0;
    const x = i % world.width;
    world.markDirty(x, (i - x) / world.width);
  }

  reset(): void {
    this.stumps.clear();
  }

  /** Stumps as [tile, tick] pairs, by tile (for saving). */
  export(): number[] {
    const out: number[] = [];
    for (const i of [...this.stumps.keys()].sort((a, b) => a - b)) out.push(i, this.stumps.get(i)!);
    return out;
  }

  /** Restores stumps from saved pairs, ignoring anything invalid; marks them on the world. */
  import(world: World, raw: unknown, tick: number): void {
    this.stumps.clear();
    world.stump.fill(0);
    if (!Array.isArray(raw)) return;
    const n = world.width * world.height;
    for (let k = 0; k + 1 < raw.length && this.stumps.size < n; k += 2) {
      const i = raw[k];
      const t = raw[k + 1];
      if (!Number.isInteger(i) || i < 0 || i >= n || typeof t !== 'number' || !Number.isFinite(t)) continue;
      this.stumps.set(i, Math.min(t, tick));
      world.stump[i] = 1;
    }
  }
}
