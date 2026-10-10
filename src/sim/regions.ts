import { World } from '../world/world';
import { MOVE_CLASSES, passableId, type NavGrid } from './pathfinding';

/** Side of a region cell in tiles. */
export const REGION_CELL = 16;
/** Leg length: long routes are walked as A* legs of at most about this many tiles. */
export const LEG = 24;

export interface ClassRegions {
  /**
   * Region id + 1 per tile (0 = impassable for the class). Uint16 when the class
   * has fewer than 65,535 regions (all generated maps so far), else Int32: half
   * the memory on big maps.
   */
  tileRegion: Uint16Array | Int32Array;
  /** Representative tile (passable, near the region's centre) per region. */
  rep: Int32Array;
  /** Connected component (over the region graph) per region: equal ⇔ mutually reachable. */
  comp: Int32Array;
  /** CSR adjacency: neighbours of r are adj[adjStart[r] .. adjStart[r+1]). */
  adjStart: Int32Array;
  adj: Int32Array;
  count: number;
}

/**
 * Hierarchical route planning (a simple HPA*-style abstraction).
 *
 * The map is cut into REGION_CELL×REGION_CELL cells; inside each cell, connected
 * passable tiles (per movement class) form regions, and regions touching across a
 * cell border are linked. A* on this small graph gives:
 *  - O(1) reachability checks (same connected component),
 *  - a corridor for routes of any length, walked as short low-level A* legs to the
 *    representative tile of a region about LEG tiles ahead.
 * Rebuilt (all classes, O(map)) only when the world's passability changes.
 */
export class RegionGraph {
  private classes: Array<ClassRegions | null> = [];
  private world: World | null = null;
  version = -1;
  builds = 0;
  lastBuildMs = 0;
  // Scratch for region A*.
  private g = new Float32Array(0);
  private came = new Int32Array(0);
  private stamp = new Uint32Array(0);
  private closed = new Uint32Array(0);
  private gen = 0;
  private heapK = new Float32Array(0);
  private heapV = new Int32Array(0);

  isStale(world: World): boolean {
    return this.world !== world || this.version !== world.passVersion;
  }

  build(world: World): void {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    this.apply(world, computeRegions(world), world.passVersion);
    if (t0) this.lastBuildMs = performance.now() - t0;
  }

  /** Installs regions computed elsewhere (e.g. a worker) for a given passVersion. */
  apply(world: World, classes: ClassRegions[], version: number): void {
    this.classes = classes;
    let maxRegions = 0;
    for (const c of classes) maxRegions = Math.max(maxRegions, c.count);
    if (this.g.length < maxRegions) {
      this.g = new Float32Array(maxRegions);
      this.came = new Int32Array(maxRegions);
      this.stamp = new Uint32Array(maxRegions);
      this.closed = new Uint32Array(maxRegions);
      this.heapK = new Float32Array(maxRegions * 8 + 8);
      this.heapV = new Int32Array(maxRegions * 8 + 8);
      this.gen = 0;
    }
    this.world = world;
    this.version = version;
    this.builds++;
  }

  regionCount(cls: number): number {
    return this.classes[cls]?.count ?? 0;
  }

  /** Whether tiles a and b are mutually reachable for a movement class. */
  connected(cls: number, a: number, b: number): boolean {
    const c = this.classes[cls];
    if (!c) return false;
    const ra = c.tileRegion[a] - 1;
    const rb = c.tileRegion[b] - 1;
    return ra >= 0 && rb >= 0 && c.comp[ra] === c.comp[rb];
  }

  /**
   * Next intermediate goal on a route from tile s to tile goal: the goal itself if
   * it is within LEG tiles, otherwise the representative tile of the farthest
   * region on the region route that is still within LEG tiles. -1 if unreachable.
   */
  waypoint(world: World, cls: number, s: number, goal: number): number {
    const c = this.classes[cls];
    if (!c) return -1;
    const rs = c.tileRegion[s] - 1;
    const rg = c.tileRegion[goal] - 1;
    if (rs < 0 || rg < 0 || c.comp[rs] !== c.comp[rg]) return -1;
    const w = world.width;
    const sx = s % w;
    const sy = (s - sx) / w;
    const cheb = (t: number) => Math.max(Math.abs((t % w) - sx), Math.abs(Math.floor(t / w) - sy));
    if (rs === rg || cheb(goal) <= LEG) return goal;
    const path = this.regionPath(world, c, rs, rg, goal);
    if (!path.length) return -1;
    let best = path[0];
    for (const r of path) {
      if (cheb(c.rep[r]) > LEG) break;
      best = r;
    }
    if (best === rs) best = path[Math.min(1, path.length - 1)];
    return best === rg ? goal : c.rep[best];
  }

  /** A* over regions from rs to rg; returns the region sequence (excluding rs). */
  private regionPath(world: World, c: ClassRegions, rs: number, rg: number, goal: number): number[] {
    const w = world.width;
    const gx = goal % w;
    const gy = Math.floor(goal / w);
    const dist = (a: number, bx: number, by: number) => Math.hypot((c.rep[a] % w) - bx, Math.floor(c.rep[a] / w) - by);
    if (++this.gen === 0xffffffff) {
      this.stamp.fill(0);
      this.closed.fill(0);
      this.gen = 1;
    }
    const gen = this.gen;
    let size = 0;
    const push = (k: number, v: number) => {
      let i = size++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (this.heapK[p] <= k) break;
        this.heapK[i] = this.heapK[p];
        this.heapV[i] = this.heapV[p];
        i = p;
      }
      this.heapK[i] = k;
      this.heapV[i] = v;
    };
    const pop = () => {
      const top = this.heapV[0];
      const k = this.heapK[--size];
      const v = this.heapV[size];
      let i = 0;
      for (;;) {
        let ch = 2 * i + 1;
        if (ch >= size) break;
        if (ch + 1 < size && this.heapK[ch + 1] < this.heapK[ch]) ch++;
        if (this.heapK[ch] >= k) break;
        this.heapK[i] = this.heapK[ch];
        this.heapV[i] = this.heapV[ch];
        i = ch;
      }
      this.heapK[i] = k;
      this.heapV[i] = v;
      return top;
    };
    this.g[rs] = 0;
    this.stamp[rs] = gen;
    this.came[rs] = -1;
    push(dist(rs, gx, gy), rs);
    let found = false;
    while (size > 0 && size < this.heapK.length - 8) {
      const r = pop();
      if (this.closed[r] === gen) continue;
      this.closed[r] = gen;
      if (r === rg) {
        found = true;
        break;
      }
      const rx = c.rep[r] % w;
      const ry = Math.floor(c.rep[r] / w);
      for (let k = c.adjStart[r]; k < c.adjStart[r + 1]; k++) {
        const nb = c.adj[k];
        if (this.closed[nb] === gen) continue;
        const ng = this.g[r] + dist(nb, rx, ry);
        if (this.stamp[nb] === gen && this.g[nb] <= ng) continue;
        this.stamp[nb] = gen;
        this.g[nb] = ng;
        this.came[nb] = r;
        push(ng + dist(nb, gx, gy), nb);
      }
    }
    if (!found) return [];
    const out: number[] = [];
    for (let r = rg; r !== rs && r >= 0; r = this.came[r]) out.push(r);
    return out.reverse();
  }
}

/** Pure computation of all movement classes' regions from a grid (worker-safe). */
export function computeRegions(grid: NavGrid): ClassRegions[] {
  const out: ClassRegions[] = [];
  for (let cls = 0; cls < MOVE_CLASSES; cls++) out.push(buildClass(grid, cls));
  return out;
}

function buildClass(world: NavGrid, cls: number): ClassRegions {
  const w = world.width;
  const h = world.height;
  const n = w * h;
  const tileRegion = new Int32Array(n).fill(-1);
  const queue = new Int32Array(REGION_CELL * REGION_CELL);
  const reps: number[] = [];
  let count = 0;
  const pass = new Uint8Array(n);
  const terrain = world.terrain;
  for (let i = 0; i < n; i++) pass[i] = passableId(cls, terrain[i]) ? 1 : 0;

  for (let cy0 = 0; cy0 < h; cy0 += REGION_CELL) {
    for (let cx0 = 0; cx0 < w; cx0 += REGION_CELL) {
      const cx1 = Math.min(w, cx0 + REGION_CELL);
      const cy1 = Math.min(h, cy0 + REGION_CELL);
      for (let y = cy0; y < cy1; y++) {
        for (let x = cx0; x < cx1; x++) {
          const s = y * w + x;
          if (!pass[s] || tileRegion[s] >= 0) continue;
          const id = count++;
          let head = 0;
          let tail = 0;
          queue[tail++] = s;
          tileRegion[s] = id;
          let sumX = 0;
          let sumY = 0;
          while (head < tail) {
            const t = queue[head++];
            const tx = t % w;
            const ty = (t - tx) / w;
            sumX += tx;
            sumY += ty;
            if (tx > cx0 && pass[t - 1] && tileRegion[t - 1] < 0) { tileRegion[t - 1] = id; queue[tail++] = t - 1; }
            if (tx < cx1 - 1 && pass[t + 1] && tileRegion[t + 1] < 0) { tileRegion[t + 1] = id; queue[tail++] = t + 1; }
            if (ty > cy0 && pass[t - w] && tileRegion[t - w] < 0) { tileRegion[t - w] = id; queue[tail++] = t - w; }
            if (ty < cy1 - 1 && pass[t + w] && tileRegion[t + w] < 0) { tileRegion[t + w] = id; queue[tail++] = t + w; }
          }
          // Representative: the member closest to the centroid (always passable).
          const mx = sumX / tail;
          const my = sumY / tail;
          let best = queue[0];
          let bestD = Infinity;
          for (let k = 0; k < tail; k++) {
            const t = queue[k];
            const d = ((t % w) - mx) ** 2 + (Math.floor(t / w) - my) ** 2;
            if (d < bestD) {
              bestD = d;
              best = t;
            }
          }
          reps.push(best);
        }
      }
    }
  }

  // Links between regions across cell borders (4-neighbour tile contacts).
  const pairs = new Set<number>();
  const link = (a: number, b: number) => {
    if (a === b) return;
    pairs.add(a < b ? a * count + b : b * count + a);
  };
  // Only cell borders can link regions: walk the border columns and rows.
  for (let x = REGION_CELL - 1; x + 1 < w; x += REGION_CELL) {
    for (let y = 0; y < h; y++) {
      const t = y * w + x;
      const a = tileRegion[t];
      const b = tileRegion[t + 1];
      if (a >= 0 && b >= 0) link(a, b);
    }
  }
  for (let y = REGION_CELL - 1; y + 1 < h; y += REGION_CELL) {
    for (let x = 0; x < w; x++) {
      const t = y * w + x;
      const a = tileRegion[t];
      const b = tileRegion[t + w];
      if (a >= 0 && b >= 0) link(a, b);
    }
  }
  const degree = new Int32Array(count + 1);
  for (const p of pairs) {
    degree[Math.floor(p / count)]++;
    degree[p % count]++;
  }
  const adjStart = new Int32Array(count + 1);
  for (let r = 0; r < count; r++) adjStart[r + 1] = adjStart[r] + degree[r];
  const fill = adjStart.slice(0, count);
  const adj = new Int32Array(adjStart[count]);
  for (const p of pairs) {
    const a = Math.floor(p / count);
    const b = p % count;
    adj[fill[a]++] = b;
    adj[fill[b]++] = a;
  }
  // Connected components over the region graph.
  const comp = new Int32Array(count).fill(-1);
  const rq = new Int32Array(count);
  let label = 0;
  for (let s = 0; s < count; s++) {
    if (comp[s] >= 0) continue;
    let head = 0;
    let tail = 0;
    rq[tail++] = s;
    comp[s] = label;
    while (head < tail) {
      const r = rq[head++];
      for (let k = adjStart[r]; k < adjStart[r + 1]; k++) {
        const nb = adj[k];
        if (comp[nb] >= 0) continue;
        comp[nb] = label;
        rq[tail++] = nb;
      }
    }
    label++;
  }
  let packed: Uint16Array | Int32Array;
  if (count < 0xffff) {
    packed = new Uint16Array(n);
    for (let i = 0; i < n; i++) packed[i] = tileRegion[i] + 1;
  } else {
    packed = tileRegion;
    for (let i = 0; i < n; i++) packed[i] += 1;
  }
  return { tileRegion: packed, rep: Int32Array.from(reps), comp, adjStart, adj, count };
}
