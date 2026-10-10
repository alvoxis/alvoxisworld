import { SEA_LEVEL, T, isWater } from './terrain';
import { World } from './world';

/** Tunables for river and lake generation. */
export interface HydrologyOptions {
  /** Drained rain (in tile units) a tile must collect to become a river. */
  riverThreshold: number;
  /** Minimum depth (height units) of a closed basin before it holds a lake. */
  lakeDepth: number;
  /** Lakes smaller than this many tiles are dropped. */
  minLakeSize: number;
}

export const DEFAULT_HYDROLOGY: HydrologyOptions = {
  riverThreshold: 220,
  lakeDepth: 3,
  minLakeSize: 6,
};

export interface HydrologyResult {
  riverTiles: number;
  lakeTiles: number;
  lakes: number;
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

/** Minimal binary min-heap of tile indices keyed by float priority. */
class MinHeap {
  private keys: Float64Array;
  private vals: Int32Array;
  size = 0;

  constructor(capacity: number) {
    this.keys = new Float64Array(capacity);
    this.vals = new Int32Array(capacity);
  }

  push(key: number, val: number): void {
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= key) break;
      this.keys[i] = this.keys[p];
      this.vals[i] = this.vals[p];
      i = p;
    }
    this.keys[i] = key;
    this.vals[i] = val;
  }

  pop(): number {
    const top = this.vals[0];
    const key = this.keys[--this.size];
    const val = this.vals[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.keys[c + 1] < this.keys[c]) c++;
      if (this.keys[c] >= key) break;
      this.keys[i] = this.keys[c];
      this.vals[i] = this.vals[c];
      i = c;
    }
    this.keys[i] = key;
    this.vals[i] = val;
    return top;
  }
}

/**
 * Adds lakes and rivers to a generated world, deterministically from its heights
 * and moisture.
 *
 * 1. Priority-flood from the sea (and map border) fills every closed basin, giving
 *    each land tile a downstream neighbour that leads to the sea.
 * 2. Basins deeper than `lakeDepth` become lakes (tiny ones are dropped).
 * 3. Rain (more where it is wet) is accumulated downstream; tiles that drain enough
 *    land become river. Diagonal steps get an extra orthogonal tile, so a river is
 *    always 4-connected and fish can actually swim along it.
 *
 * Rivers are fordable for land animals, so they never cut land routes; lakes sit
 * in basins, so they don't either (except in rare degenerate cases).
 */
export function addHydrology(world: World, opts: HydrologyOptions = DEFAULT_HYDROLOGY): HydrologyResult {
  const { width: w, height: h } = world;
  const n = w * h;
  const heights = world.heights;
  const filled = new Float32Array(n);
  const down = new Int32Array(n).fill(-1);
  const visited = new Uint8Array(n);
  const order = new Int32Array(n);
  const heap = new MinHeap(n);
  let count = 0;

  // Seeds: the sea and every border tile.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (heights[i] < SEA_LEVEL || x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        visited[i] = 1;
        filled[i] = heights[i];
        heap.push(filled[i], i);
      }
    }
  }
  while (heap.size) {
    const c = heap.pop();
    order[count++] = c;
    const cx = c % w;
    const cy = (c - cx) / w;
    for (let k = 0; k < 8; k++) {
      const nx = cx + DX[k];
      const ny = cy + DY[k];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nb = ny * w + nx;
      if (visited[nb]) continue;
      visited[nb] = 1;
      filled[nb] = Math.max(heights[nb], filled[c] + 1e-3);
      down[nb] = c;
      heap.push(filled[nb], nb);
    }
  }

  // Lakes: connected basins deep enough and large enough.
  const lake = new Uint8Array(n);
  const queue = new Int32Array(n);
  let lakeTiles = 0;
  let lakes = 0;
  const isBasin = (i: number) => heights[i] >= SEA_LEVEL && filled[i] - heights[i] >= opts.lakeDepth;
  const seen = new Uint8Array(n);
  for (let s = 0; s < n; s++) {
    if (seen[s] || !isBasin(s)) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    seen[s] = 1;
    while (head < tail) {
      const c = queue[head++];
      const cx = c % w;
      const cy = (c - cx) / w;
      for (let k = 0; k < 4; k++) {
        const nx = cx + DX[k];
        const ny = cy + DY[k];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nb = ny * w + nx;
        if (seen[nb] || !isBasin(nb)) continue;
        seen[nb] = 1;
        queue[tail++] = nb;
      }
    }
    if (tail < opts.minLakeSize) continue;
    lakes++;
    for (let k = 0; k < tail; k++) {
      lake[queue[k]] = 1;
      world.terrain[queue[k]] = T.LAKE;
    }
    lakeTiles += tail;
  }

  // Flow accumulation, from the highest filled tile down to the sea.
  const acc = new Float32Array(n);
  for (let k = count - 1; k >= 0; k--) {
    const t = order[k];
    if (heights[t] >= SEA_LEVEL) acc[t] += 0.4 + world.moisture[t] / 255;
    const d = down[t];
    if (d >= 0) acc[d] += acc[t];
  }

  let riverTiles = 0;
  const makeRiver = (i: number) => {
    const id = world.terrain[i];
    if (isWater(id) || heights[i] < SEA_LEVEL) return;
    world.terrain[i] = T.RIVER;
    riverTiles++;
  };
  for (let i = 0; i < n; i++) {
    if (acc[i] < opts.riverThreshold || lake[i] || heights[i] < SEA_LEVEL) continue;
    makeRiver(i);
    // Keep the river 4-connected across diagonal steps.
    const d = down[i];
    if (d < 0) continue;
    const x = i % w;
    const y = (i - x) / w;
    const dx = (d % w) - x;
    const dy = Math.floor(d / w) - y;
    if (dx !== 0 && dy !== 0) {
      const a = y * w + (x + dx);
      const b = (y + dy) * w + x;
      makeRiver(heights[a] <= heights[b] ? a : b);
    }
  }
  return { riverTiles, lakeTiles, lakes };
}
