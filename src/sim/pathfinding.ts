import { SLOPE, SLOPE_SHIFT, TERRAIN_MASK } from '../world/passability';
import { T, isWater } from '../world/terrain';
import { World } from '../world/world';

/**
 * Movement classes. Every species maps to one; passability depends only on the
 * class, so search results and the water field can be shared between species.
 */
export const MOVE = {
  /** Walks anywhere on land and wades through rivers. */
  LAND: 0,
  /** Like LAND, but cannot climb mountains or snowfields. */
  LOWLAND: 1,
  /** Swims in any water (sea, lakes, rivers); never leaves it. */
  WATER: 2,
} as const;
export type MoveClass = (typeof MOVE)[keyof typeof MOVE];
export const MOVE_CLASSES = 3;

/** Whether a movement class may stand on tile (x, y): its terrain and its slope (see world/passability.ts). */
export function passable(world: World, cls: number, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return false;
  const i = y * world.width + x;
  return passableId(cls, world.terrain[i] | (world.slopeClass[i] << SLOPE_SHIFT));
}

/**
 * Passability from a navigation code (terrain id in the low four bits, slope class
 * above; a plain terrain id is a code on level ground).
 *  - WATER swims anywhere there is water, whatever the slope under it.
 *  - Everything that walks wades rivers but not lakes or sea, and never stands on a sheer cliff.
 *  - LOWLAND also avoids mountains, snow and steep slopes; LAND climbs them (at a cost, see tileCost).
 */
export function passableId(cls: number, code: number): boolean {
  const id = code & TERRAIN_MASK;
  if (cls === MOVE.WATER) return isWater(id);
  if (isWater(id) && id !== T.RIVER) return false;
  const slope = code >> SLOPE_SHIFT;
  if (slope >= SLOPE.CLIFF) return false;
  if (cls === MOVE.LOWLAND && (id === T.MOUNTAIN || id === T.SNOW || slope === SLOPE.STEEP)) return false;
  return true;
}

/** Movement cost multiplier: land animals wade slowly through rivers and climb steep ground slowly. */
export function tileCost(cls: number, code: number): number {
  if (cls === MOVE.WATER) return 1;
  if ((code & TERRAIN_MASK) === T.RIVER) return 3;
  return code >> SLOPE_SHIFT === SLOPE.STEEP ? 2 : 1;
}

/** A tile where a land animal can drink: on a river or swamp, or next to any water. */
export function isDrinkSpot(world: World, x: number, y: number): boolean {
  const w = world.width;
  const t = world.terrain;
  const id = t[y * w + x];
  if (id === T.RIVER || id === T.SWAMP) return true;
  for (let oy = -1; oy <= 1; oy++) {
    const ny = y + oy;
    if (ny < 0 || ny >= world.height) continue;
    for (let ox = -1; ox <= 1; ox++) {
      const nx = x + ox;
      if (nx < 0 || nx >= w) continue;
      if (isWater(t[ny * w + nx])) return true;
    }
  }
  return false;
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];
const SQRT2 = Math.SQRT2;

/** Result codes (non-negative results are path lengths). */
export const NOT_FOUND = -1;
/** Initial capacity of the growable search arrays (a 40,000-node search fits after a few doublings). */
const INITIAL_SCRATCH = 16384;
export const NO_BUDGET = -2;

/**
 * Grid search shared by all creatures. Scratch arrays are allocated once per map
 * size and reused via a generation stamp, so searches allocate nothing.
 *
 * A per-tick node budget (`beginTick`) bounds the total search work in one
 * simulation tick; when it runs out, searches return NO_BUDGET and the caller
 * retries on a later tick instead of stalling the simulation.
 */
export class Pathfinder {
  private w = 0;
  private h = 0;
  private g = new Float32Array(0);
  /** Direction (0..7, see DX/DY) of the step that reached each tile in the current search. */
  private dir = new Uint8Array(0);
  /** Search state per tile: 2·gen = reached in this search, 2·gen+1 = closed; anything else = unseen. */
  private mark = new Uint32Array(0);
  private gen = 0;
  private heapKey = new Float32Array(0);
  private heapVal = new Int32Array(0);
  private heapSize = 0;
  private queue = new Int32Array(0);
  private scratch = new Int32Array(0);

  /** Node expansions left in this tick. */
  budget = 0;
  /** Stats since creation (for performance reporting). */
  searches = 0;
  expansions = 0;
  deferred = 0;

  private ensure(world: World): void {
    if (world.width === this.w && world.height === this.h) return;
    this.w = world.width;
    this.h = world.height;
    const n = this.w * this.h;
    this.g = new Float32Array(n);
    this.dir = new Uint8Array(n);
    this.mark = new Uint32Array(n);
    // Searches are bounded by the node budget, so the heap, queue and path
    // scratch start small and grow on demand instead of costing 16 bytes per tile.
    const start = Math.min(n, INITIAL_SCRATCH);
    this.heapKey = new Float32Array(start);
    this.heapVal = new Int32Array(start);
    this.queue = new Int32Array(start);
    this.scratch = new Int32Array(start);
    this.gen = 0;
  }

  /** Bytes held by search scratch arrays (for memory reporting). */
  get scratchBytes(): number {
    return (
      this.g.byteLength + this.dir.byteLength + this.mark.byteLength +
      this.heapKey.byteLength + this.heapVal.byteLength + this.queue.byteLength + this.scratch.byteLength
    );
  }

  private growHeap(): void {
    const k = new Float32Array(this.heapKey.length * 2);
    const v = new Int32Array(this.heapVal.length * 2);
    k.set(this.heapKey);
    v.set(this.heapVal);
    this.heapKey = k;
    this.heapVal = v;
  }

  beginTick(budget: number): void {
    this.budget = budget;
  }

  private nextGen(): void {
    this.gen++;
    if (this.gen >= 0x7fffffff) {
      this.mark.fill(0);
      this.gen = 1;
    }
  }

  /** True if moving from c to its neighbour k is allowed (no corner cutting). */
  private canStep(world: World, cls: number, cx: number, cy: number, k: number): boolean {
    const nx = cx + DX[k];
    const ny = cy + DY[k];
    if (!passable(world, cls, nx, ny)) return false;
    if (k >= 4) return passable(world, cls, cx + DX[k], cy) && passable(world, cls, cx, cy + DY[k]);
    return true;
  }

  /**
   * A* from (sx, sy) to (gx, gy). Writes up to `outMax` tile indices of the path
   * (excluding the start, ending at the goal unless truncated) into out[off..].
   * Returns the number written, NOT_FOUND if unreachable within maxNodes, or
   * NO_BUDGET if this tick's search budget is spent.
   */
  astar(
    world: World, cls: number, sx: number, sy: number, gx: number, gy: number, maxNodes: number,
    out: Int32Array, off: number, outMax: number,
  ): number {
    this.ensure(world);
    if (!passable(world, cls, gx, gy)) return NOT_FOUND;
    if (this.budget < 64) {
      this.deferred++;
      return NO_BUDGET;
    }
    const limit = Math.min(maxNodes, this.budget);
    this.searches++;
    this.nextGen();
    const w = this.w;
    const start = sy * w + sx;
    const goal = gy * w + gx;
    if (start === goal) return 0;
    const open = this.gen * 2;
    const done = open + 1;
    const mark = this.mark;
    this.heapSize = 0;
    this.g[start] = 0;
    mark[start] = open;
    this.heapPush(octile(sx, sy, gx, gy), start);
    let expanded = 0;
    let found = false;
    while (this.heapSize > 0) {
      const c = this.heapPop();
      if (mark[c] === done) continue;
      mark[c] = done;
      if (c === goal) {
        found = true;
        break;
      }
      if (++expanded > limit) break;
      const cx = c % w;
      const cy = (c - cx) / w;
      const gc = this.g[c];
      for (let k = 0; k < 8; k++) {
        if (!this.canStep(world, cls, cx, cy, k)) continue;
        const nx = cx + DX[k];
        const ny = cy + DY[k];
        const nb = ny * w + nx;
        const m = mark[nb];
        if (m === done) continue;
        const cost = (k >= 4 ? SQRT2 : 1) * tileCost(cls, world.terrain[nb] | (world.slopeClass[nb] << SLOPE_SHIFT));
        const ng = gc + cost;
        if (m === open && this.g[nb] <= ng) continue;
        mark[nb] = open;
        this.g[nb] = ng;
        this.dir[nb] = k;
        this.heapPush(ng + octile(nx, ny, gx, gy), nb);
      }
    }
    this.budget -= expanded;
    this.expansions += expanded;
    if (!found) return NOT_FOUND;
    return this.writePath(start, goal, out, off, outMax);
  }

  /**
   * Breadth-first search for the nearest reachable tile (in steps) satisfying
   * `match`, exploring at most maxNodes tiles. Writes the path like astar().
   * Returns the path length, 0 if the start already matches, or NOT_FOUND / NO_BUDGET.
   */
  nearest(
    world: World, cls: number, sx: number, sy: number, maxNodes: number, match: (i: number) => boolean,
    out: Int32Array, off: number, outMax: number,
  ): number {
    this.ensure(world);
    const w = this.w;
    const start = sy * w + sx;
    if (match(start)) return 0;
    if (this.budget < 32) {
      this.deferred++;
      return NO_BUDGET;
    }
    const limit = Math.min(maxNodes, this.budget);
    this.searches++;
    this.nextGen();
    const seen = this.gen * 2;
    const mark = this.mark;
    let q = this.queue;
    let head = 0;
    let tail = 0;
    q[tail++] = start;
    mark[start] = seen;
    let found = -1;
    while (head < tail && head < limit) {
      const c = q[head++];
      const cx = c % w;
      const cy = (c - cx) / w;
      for (let k = 0; k < 8; k++) {
        if (!this.canStep(world, cls, cx, cy, k)) continue;
        const nb = (cy + DY[k]) * w + cx + DX[k];
        if (mark[nb] === seen) continue;
        mark[nb] = seen;
        this.dir[nb] = k;
        if (match(nb)) {
          found = nb;
          break;
        }
        if (tail === q.length) {
          const bigger = new Int32Array(q.length * 2);
          bigger.set(q);
          q = this.queue = bigger;
        }
        q[tail++] = nb;
      }
      if (found >= 0) break;
    }
    this.budget -= head;
    this.expansions += head;
    if (found < 0) return NOT_FOUND;
    return this.writePath(start, found, out, off, outMax);
  }

  private writePath(start: number, goal: number, out: Int32Array, off: number, outMax: number): number {
    // Walk back from the goal, then copy the first outMax steps from the start side.
    let len = 0;
    const w = this.w;
    for (let c = goal; c !== start; c -= DY[this.dir[c]] * w + DX[this.dir[c]]) {
      if (len === this.scratch.length) {
        const bigger = new Int32Array(this.scratch.length * 2);
        bigger.set(this.scratch);
        this.scratch = bigger;
      }
      this.scratch[len++] = c;
    }
    const n = Math.min(len, outMax);
    for (let k = 0; k < n; k++) out[off + k] = this.scratch[len - 1 - k];
    return n;
  }

  private heapPush(key: number, val: number): void {
    if (this.heapSize === this.heapKey.length) this.growHeap();
    let i = this.heapSize++;
    const hk = this.heapKey;
    const hv = this.heapVal;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hk[p] <= key) break;
      hk[i] = hk[p];
      hv[i] = hv[p];
      i = p;
    }
    hk[i] = key;
    hv[i] = val;
  }

  private heapPop(): number {
    const hk = this.heapKey;
    const hv = this.heapVal;
    const top = hv[0];
    const key = hk[--this.heapSize];
    const val = hv[this.heapSize];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.heapSize) break;
      if (c + 1 < this.heapSize && hk[c + 1] < hk[c]) c++;
      if (hk[c] >= key) break;
      hk[i] = hk[c];
      hv[i] = hv[c];
      i = c;
    }
    hk[i] = key;
    hv[i] = val;
    return top;
  }
}

function octile(x0: number, y0: number, x1: number, y1: number): number {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
}

export const UNREACHABLE = 0xffff;

/**
 * Distance (in steps) from every tile to the nearest drink spot, per land movement
 * class, computed by a multi-source BFS over passable tiles. Thirsty animals just
 * walk downhill on this field, so finding the nearest *reachable* water costs O(1)
 * per step and is shared by every animal. Rebuilt only when passability changes.
 */
/** The part of a world that navigation data depends on (lets it be built from a snapshot). */
export interface NavGrid {
  width: number;
  height: number;
  /** Navigation codes: terrain id plus slope class (see World.navCodes). */
  terrain: Uint8Array;
  passVersion: number;
}

/** The navigation view of a live world (snapshotted codes; costs one pass over the map). */
export function navGridOf(world: World): NavGrid {
  return { width: world.width, height: world.height, terrain: world.navCodes(), passVersion: world.passVersion };
}

/**
 * Pure computation of the water-distance field (see WaterField). Depends only on
 * the grid, so it can run on a terrain snapshot in a worker with identical results.
 */
export function computeWaterDist(grid: NavGrid): Uint16Array[] {
  const w = grid.width;
  const h = grid.height;
  const n = w * h;
  const t = grid.terrain;
  const queue = new Int32Array(n);
  const pass = new Uint8Array(n);
  // Drink spots (class-independent): on a river or swamp, or next to any water.
  const drink = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const id = t[i] & TERRAIN_MASK;
    if (id === T.RIVER || id === T.SWAMP) drink[i] = 1;
    if (!isWater(id)) continue;
    const x = i % w;
    const y = (i - x) / w;
    for (let oy = -1; oy <= 1; oy++) {
      const ny = y + oy;
      if (ny < 0 || ny >= h) continue;
      for (let ox = -1; ox <= 1; ox++) {
        const nx = x + ox;
        if (nx >= 0 && nx < w) drink[ny * w + nx] = 1;
      }
    }
  }
  const out: Uint16Array[] = [];
  for (const cls of [MOVE.LAND, MOVE.LOWLAND]) {
    const dist = new Uint16Array(n).fill(UNREACHABLE);
    out[cls] = dist;
    let tail = 0;
    for (let i = 0; i < n; i++) {
      pass[i] = passableId(cls, t[i]) ? 1 : 0;
      if (pass[i] && drink[i]) {
        dist[i] = 0;
        queue[tail++] = i;
      }
    }
    let head = 0;
    while (head < tail) {
      const c = queue[head++];
      const cx = c % w;
      const cy = (c - cx) / w;
      const d = dist[c] + 1;
      if (d >= UNREACHABLE) continue;
      const pl = cx > 0 && pass[c - 1];
      const pr = cx < w - 1 && pass[c + 1];
      const pu = cy > 0 && pass[c - w];
      const pd = cy < h - 1 && pass[c + w];
      if (pl && dist[c - 1] === UNREACHABLE) { dist[c - 1] = d; queue[tail++] = c - 1; }
      if (pr && dist[c + 1] === UNREACHABLE) { dist[c + 1] = d; queue[tail++] = c + 1; }
      if (pu && dist[c - w] === UNREACHABLE) { dist[c - w] = d; queue[tail++] = c - w; }
      if (pd && dist[c + w] === UNREACHABLE) { dist[c + w] = d; queue[tail++] = c + w; }
      // Diagonals only where both orthogonal neighbours are passable (no corner cutting).
      if (pl && pu && pass[c - w - 1] && dist[c - w - 1] === UNREACHABLE) { dist[c - w - 1] = d; queue[tail++] = c - w - 1; }
      if (pr && pu && pass[c - w + 1] && dist[c - w + 1] === UNREACHABLE) { dist[c - w + 1] = d; queue[tail++] = c - w + 1; }
      if (pl && pd && pass[c + w - 1] && dist[c + w - 1] === UNREACHABLE) { dist[c + w - 1] = d; queue[tail++] = c + w - 1; }
      if (pr && pd && pass[c + w + 1] && dist[c + w + 1] === UNREACHABLE) { dist[c + w + 1] = d; queue[tail++] = c + w + 1; }
    }
  }
  return out;
}

/**
 * Distance (in steps) from every tile to the nearest drink spot, per land movement
 * class, computed by a multi-source BFS over passable tiles. Thirsty animals just
 * walk downhill on this field, so finding the nearest *reachable* water costs O(1)
 * per step and is shared by every animal. Rebuilt only when passability changes.
 */
export class WaterField {
  /** dist[cls] for MOVE.LAND and MOVE.LOWLAND (water animals never need to drink). */
  dist: Uint16Array[] = [new Uint16Array(0), new Uint16Array(0)];
  /** world.passVersion the field was built for (-1 = never built). */
  version = -1;
  private owner: World | null = null;
  builds = 0;
  lastBuildMs = 0;

  isStale(world: World): boolean {
    return this.owner !== world || this.version !== world.passVersion;
  }

  /** True if the field has ever been built for this world (possibly from an older version). */
  builtFor(world: World): boolean {
    return this.owner === world;
  }

  build(world: World): void {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    this.apply(world, computeWaterDist(navGridOf(world)), world.passVersion);
    if (t0) this.lastBuildMs = performance.now() - t0;
  }

  /** Installs a field computed elsewhere (e.g. a worker) for a given passVersion. */
  apply(world: World, dist: Uint16Array[], version: number): void {
    this.dist = dist;
    this.owner = world;
    this.version = version;
    this.builds++;
  }

  distanceAt(world: World, cls: number, x: number, y: number): number {
    if (cls === MOVE.WATER || !world.inBounds(x, y)) return UNREACHABLE;
    return this.dist[cls][y * world.width + x] ?? UNREACHABLE;
  }

  /** Neighbouring tile index one step closer to water, or -1 if none. */
  nextStep(world: World, cls: number, x: number, y: number): number {
    if (cls === MOVE.WATER) return -1;
    const dist = this.dist[cls];
    const w = world.width;
    let best = -1;
    let bestD = this.distanceAt(world, cls, x, y);
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k];
      const ny = y + DY[k];
      if (!passable(world, cls, nx, ny)) continue;
      if (k >= 4 && (!passable(world, cls, nx, y) || !passable(world, cls, x, ny))) continue;
      const d = dist[ny * w + nx];
      if (d < bestD) {
        bestD = d;
        best = ny * w + nx;
      }
    }
    return best;
  }
}
