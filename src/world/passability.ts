/**
 * Slope classes and the navigation code of a tile.
 *
 * A tile's slope is the largest height difference between it and its four
 * neighbours (heights are 0..255, sea level 110). Natural land is mostly gentle
 * (80% of a medium map's land differs by 8 or less from every neighbour; 97.7% by
 * 14 or less; 99.9% by 20 or less), so the thresholds leave ordinary terrain open
 * and only turn the steepest ground into obstacles:
 *
 *  - GENTLE (difference below STEEP_FROM): walkable by every land species.
 *  - STEEP  (STEEP_FROM to CLIFF_FROM - 1): steep mountainsides. Species that climb
 *    (movement class LAND: grazers, raptors) cross them at a higher cost; lowland
 *    species (hadrosaurs, tyrants) cannot.
 *  - CLIFF  (CLIFF_FROM and above): sheer rock faces, crater walls and rift edges.
 *    No walking species can stand on them.
 *
 * Players and disasters create steep ground too: a Raise brush, a meteor crater
 * rim or an earthquake rift can make a cliff anywhere.
 *
 * Navigation snapshots (see World.navCodes) pack the terrain id into the low four
 * bits and the slope class into the next two, so workers, saves and the region
 * graph keep using one byte per tile.
 */
export const SLOPE = { GENTLE: 0, STEEP: 1, CLIFF: 2 } as const;
export const STEEP_FROM = 13;
export const CLIFF_FROM = 20;
export const SLOPE_SHIFT = 4;
export const TERRAIN_MASK = 15;

export function slopeClassOf(heightDifference: number): number {
  return heightDifference >= CLIFF_FROM ? SLOPE.CLIFF : heightDifference >= STEEP_FROM ? SLOPE.STEEP : SLOPE.GENTLE;
}

/** Packs a terrain id (0..15) and a slope class (0..2) into one navigation byte. */
export function navCode(terrainId: number, slopeClass: number): number {
  return terrainId | (slopeClass << SLOPE_SHIFT);
}

export const SLOPE_NAMES = ['gentle', 'steep', 'sheer cliff'] as const;
