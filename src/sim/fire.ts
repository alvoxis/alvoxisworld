import { Rng } from '../core/rng';
import { T, isWater } from '../world/terrain';
import { World } from '../world/world';
import type { Weather } from './weather';

/** Fuel per terrain id: how readily it burns (0 = never). */
export const FUEL: Readonly<Record<number, number>> = {
  [T.FOREST]: 0.9,
  [T.JUNGLE]: 0.6,
  [T.SAVANNA]: 0.85,
  [T.GRASS]: 0.65,
  [T.HILLS]: 0.45,
  [T.TUNDRA]: 0.3,
  [T.SWAMP]: 0.12,
};

export function fuelOf(id: number): number {
  return FUEL[id] ?? 0;
}

/** Hard cap on simultaneously burning tiles: no fire can overwhelm the simulation. */
export const MAX_BURNING = 3000;
/** Damage per tick to an animal standing in fire, as a share of its max health. */
export const FIRE_DAMAGE = 0.08;

const NEIGHBOURS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
] as const;

/**
 * Wildfire on the tile grid. Burning tiles live in world.fire (remaining burn
 * ticks) plus an active list here, so each tick only touches tiles that burn.
 * Spread depends on the neighbour's fuel, its moisture and rain; burned-out land
 * becomes bare soil, which the vegetation system regrows.
 */
export class Fire {
  /** Indices of burning tiles (order matters for determinism and is saved). */
  active: number[] = [];
  /** Tiles burned out since creation (statistics/tests). */
  burnedOut = 0;
  /** Exact number of tiles burning right now (the active list is rebuilt during a step). */
  private count = 0;

  get burning(): number {
    return this.count;
  }

  /** Sets a tile alight if it has fuel and is dry enough. Returns true if it caught. */
  ignite(world: World, x: number, y: number): boolean {
    if (!world.inBounds(x, y) || this.count >= MAX_BURNING) return false;
    const i = world.idx(x, y);
    const id = world.terrain[i];
    const fuel = fuelOf(id);
    if (fuel <= 0 || isWater(id) || world.fire[i]) return false;
    world.fire[i] = 20 + Math.round(fuel * 30);
    this.active.push(i);
    this.count++;
    world.markDirty(x, y);
    return true;
  }

  step(world: World, rng: Rng, weather: Weather): void {
    if (!this.active.length) return;
    const list = this.active;
    this.active = [];
    for (const i of list) {
      if (!world.fire[i]) {
        this.count--; // put out by rain or undo since the last step
        continue;
      }
      const x = i % world.width;
      const y = (i - x) / world.width;
      const wet = weather.wetnessAt(x, y);
      if (wet > 0 && rng.chance(0.25 * wet)) {
        world.fire[i] = 0;
        this.count--;
        world.markDirty(x, y);
        continue;
      }
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!world.inBounds(nx, ny)) continue;
        const j = world.idx(nx, ny);
        if (world.fire[j]) continue;
        const fuel = fuelOf(world.terrain[j]);
        if (fuel <= 0) continue;
        const dryness = 1 - world.moisture[j] / 255;
        const p = 0.12 * fuel * dryness * dryness * (wet < 0 ? 1.6 : 1);
        if (rng.chance(p)) this.ignite(world, nx, ny);
      }
      world.fire[i]--;
      if (world.fire[i] === 0) {
        if (fuelOf(world.terrain[i]) > 0) world.setTerrain(x, y, T.SOIL);
        world.moisture[i] = Math.max(0, world.moisture[i] - 20);
        this.burnedOut++;
        this.count--;
        world.markDirty(x, y);
      } else {
        this.active.push(i);
      }
    }
  }

  /** Rebuilds the active list from world.fire (after an old save without one). */
  rebuild(world: World): void {
    this.active = [];
    for (let i = 0; i < world.fire.length; i++) if (world.fire[i]) this.active.push(i);
    this.count = this.active.length;
  }

  /** Installs a saved burning list (order matters for determinism). */
  restore(active: number[]): void {
    this.active = active.slice();
    this.count = active.length;
  }

  clear(): void {
    this.active = [];
    this.burnedOut = 0;
    this.count = 0;
  }
}
