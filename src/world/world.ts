import { T, TERRAIN, isWater, passClass } from './terrain';

export const CHUNK = 32;

/** Per-tile water memory (World.waterFlags). */
export const WATER_FLAG = {
  /** The tile is (or was) part of a lake; a dried bed can refill. */
  LAKE_BED: 1,
  /** The tile is (or was) part of a river; a dried bed can flow again. */
  RIVER_BED: 2,
  /** Temporary flood water; World.under holds the terrain to restore when it drains. */
  FLOOD: 4,
  /** Seasonal snow cover on tundra; World.under holds the terrain to restore when it melts. */
  SNOWCOVER: 8,
} as const;

/** Values saved per tile when recording for undo (see World.touch). */
export const TILE_FIELDS = 8;

/**
 * The tile grid of a world. Pure data + change tracking; no rendering, no DOM.
 *
 * Every mutation made on behalf of the player goes through touch()/setters so an
 * undo recorder can capture the previous values of exactly the tiles that change.
 */
export class World {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  /** Elevation 0..255. */
  readonly heights: Uint8Array;
  /** Terrain id per tile (see terrain.ts). */
  readonly terrain: Uint8Array;
  /** Current climate 0..255 (maps to 0..1). Weather pushes these around. */
  readonly temperature: Uint8Array;
  readonly moisture: Uint8Array;
  /** Long-term climate the current values relax back to after weather passes. */
  readonly baseTemperature: Uint8Array;
  readonly baseMoisture: Uint8Array;
  /** WATER_FLAG bits per tile. */
  readonly waterFlags: Uint8Array;
  /** Terrain under temporary flood water. */
  readonly under: Uint8Array;
  /** Fire: remaining burn ticks (0 = not burning). */
  readonly fire: Uint8Array;

  readonly chunksX: number;
  readonly chunksY: number;
  /** Chunks changed since the renderer last consumed them. */
  readonly dirtyChunks = new Set<number>();
  /**
   * Incremented whenever a tile changes between movement classes (land, water,
   * fordable river, mountain/snow). Pathfinding caches compare against it.
   */
  passVersion = 0;
  /** When set, called with a tile index before that tile is modified (undo recording). */
  recorder: ((i: number) => void) | null = null;

  constructor(width: number, height: number, seed: number) {
    this.width = width;
    this.height = height;
    this.seed = seed >>> 0;
    const n = width * height;
    this.heights = new Uint8Array(n);
    this.terrain = new Uint8Array(n);
    this.temperature = new Uint8Array(n);
    this.moisture = new Uint8Array(n);
    this.baseTemperature = new Uint8Array(n);
    this.baseMoisture = new Uint8Array(n);
    this.waterFlags = new Uint8Array(n);
    this.under = new Uint8Array(n);
    this.fire = new Uint8Array(n);
    this.chunksX = Math.ceil(width / CHUNK);
    this.chunksY = Math.ceil(height / CHUNK);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  idx(x: number, y: number): number {
    return y * this.width + x;
  }

  terrainAt(x: number, y: number): number {
    return this.terrain[this.idx(x, y)];
  }

  isWaterAt(x: number, y: number): boolean {
    return isWater(this.terrain[this.idx(x, y)]);
  }

  /**
   * Marks every chunk within two tiles of the tile dirty: map painting reads a
   * one-tile margin, and decoration on margin tiles depends on their neighbours.
   */
  markDirty(x: number, y: number): void {
    const cx0 = Math.max(0, Math.floor((x - 2) / CHUNK));
    const cy0 = Math.max(0, Math.floor((y - 2) / CHUNK));
    const cx1 = Math.min(this.chunksX - 1, Math.floor((x + 2) / CHUNK));
    const cy1 = Math.min(this.chunksY - 1, Math.floor((y + 2) / CHUNK));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) this.dirtyChunks.add(cy * this.chunksX + cx);
    }
  }

  markAllDirty(): void {
    for (let i = 0; i < this.chunksX * this.chunksY; i++) this.dirtyChunks.add(i);
  }

  /** Announces that tile i is about to change (lets an undo recorder save it first). */
  touch(i: number): void {
    if (this.recorder) this.recorder(i);
  }

  setTerrain(x: number, y: number, id: number): void {
    const i = this.idx(x, y);
    const old = this.terrain[i];
    if (old === id) return;
    this.touch(i);
    this.terrain[i] = id;
    if (passClass(old) !== passClass(id)) this.passVersion++;
    this.markDirty(x, y);
  }

  setHeight(x: number, y: number, h: number): void {
    const i = this.idx(x, y);
    const v = Math.max(0, Math.min(255, Math.round(h)));
    if (this.heights[i] === v) return;
    this.touch(i);
    this.heights[i] = v;
    this.markDirty(x, y);
  }

  /** Sets current and long-term climate (painting a biome changes the climate for good). */
  setClimate(x: number, y: number, temperature: number, moisture: number): void {
    const i = this.idx(x, y);
    this.touch(i);
    this.temperature[i] = this.baseTemperature[i] = temperature;
    this.moisture[i] = this.baseMoisture[i] = moisture;
  }

  setWaterFlags(i: number, flags: number): void {
    if (this.waterFlags[i] === flags) return;
    this.touch(i);
    this.waterFlags[i] = flags;
  }

  /** Copies every per-tile value of tile i into out[off..off+TILE_FIELDS). */
  readTile(i: number, out: Uint8Array, off: number): void {
    out[off] = this.heights[i];
    out[off + 1] = this.terrain[i];
    out[off + 2] = this.temperature[i];
    out[off + 3] = this.moisture[i];
    out[off + 4] = this.baseTemperature[i];
    out[off + 5] = this.baseMoisture[i];
    out[off + 6] = this.waterFlags[i];
    out[off + 7] = this.under[i];
  }

  /** Restores tile i from values saved by readTile (keeps passVersion and dirty chunks right). */
  writeTile(i: number, src: Uint8Array, off: number): void {
    const x = i % this.width;
    const y = (i - x) / this.width;
    if (passClass(this.terrain[i]) !== passClass(src[off + 1])) this.passVersion++;
    this.heights[i] = src[off];
    this.terrain[i] = src[off + 1];
    this.temperature[i] = src[off + 2];
    this.moisture[i] = src[off + 3];
    this.baseTemperature[i] = src[off + 4];
    this.baseMoisture[i] = src[off + 5];
    this.waterFlags[i] = src[off + 6];
    this.under[i] = src[off + 7];
    this.markDirty(x, y);
  }

  /** Share of tiles per terrain id, for statistics. */
  terrainCounts(): Uint32Array {
    const counts = new Uint32Array(TERRAIN.length);
    for (let i = 0; i < this.terrain.length; i++) counts[this.terrain[i]]++;
    return counts;
  }

  landShare(): number {
    let land = 0;
    for (let i = 0; i < this.terrain.length; i++) {
      if (!isWater(this.terrain[i])) land++;
    }
    return land / this.terrain.length;
  }
}

export { T };
