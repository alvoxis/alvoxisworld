import { T, TERRAIN, isWater, passClass } from './terrain';

export const CHUNK = 32;

/** The tile grid of a world. Pure data + change tracking; no rendering, no DOM. */
export class World {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  /** Elevation 0..255. */
  readonly heights: Uint8Array;
  /** Terrain id per tile (see terrain.ts). */
  readonly terrain: Uint8Array;
  /** Climate 0..255 (maps to 0..1). */
  readonly temperature: Uint8Array;
  readonly moisture: Uint8Array;

  readonly chunksX: number;
  readonly chunksY: number;
  /** Chunks changed since the renderer last consumed them. */
  readonly dirtyChunks = new Set<number>();
  /**
   * Incremented whenever a tile changes between movement classes (land, water,
   * fordable river, mountain/snow). Pathfinding caches compare against it.
   */
  passVersion = 0;

  constructor(width: number, height: number, seed: number) {
    this.width = width;
    this.height = height;
    this.seed = seed >>> 0;
    const n = width * height;
    this.heights = new Uint8Array(n);
    this.terrain = new Uint8Array(n);
    this.temperature = new Uint8Array(n);
    this.moisture = new Uint8Array(n);
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

  /** Marks the tile and its neighbours' chunks dirty (shading depends on neighbours). */
  markDirty(x: number, y: number): void {
    const cx0 = Math.max(0, Math.floor((x - 1) / CHUNK));
    const cy0 = Math.max(0, Math.floor((y - 1) / CHUNK));
    const cx1 = Math.min(this.chunksX - 1, Math.floor((x + 1) / CHUNK));
    const cy1 = Math.min(this.chunksY - 1, Math.floor((y + 1) / CHUNK));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) this.dirtyChunks.add(cy * this.chunksX + cx);
    }
  }

  markAllDirty(): void {
    for (let i = 0; i < this.chunksX * this.chunksY; i++) this.dirtyChunks.add(i);
  }

  setTerrain(x: number, y: number, id: number): void {
    const i = this.idx(x, y);
    const old = this.terrain[i];
    if (old === id) return;
    this.terrain[i] = id;
    if (passClass(old) !== passClass(id)) this.passVersion++;
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
