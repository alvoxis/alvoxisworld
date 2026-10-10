import { World } from '../world/world';

/** Food-map cell size in tiles (matches the creature spatial hash). */
export const FOOD_CELL = 8;

/**
 * Coarse count of food tiles per cell for each distinct diet ("food group").
 * Lets hungry animals skip searches that cannot succeed (no food anywhere in
 * sight) and pick a direction to migrate in, instead of re-running a failing
 * breadth-first search every few ticks. Rebuilt periodically in one O(map) pass.
 */
export class FoodMap {
  /** Group index per species. */
  readonly groupOf: number[];
  /** Bitmask of groups that eat each terrain id. */
  private readonly terrainMask: Uint8Array;
  readonly groups: number;
  private counts: Uint16Array[] = [];
  w = 0;
  h = 0;
  builtTick = -Infinity;

  constructor(speciesFood: ReadonlyArray<readonly number[]>) {
    const keys: string[] = [];
    this.groupOf = speciesFood.map((f) => {
      const key = [...f].sort((a, b) => a - b).join(',');
      let g = keys.indexOf(key);
      if (g < 0) {
        g = keys.length;
        keys.push(key);
      }
      return g;
    });
    this.groups = keys.length;
    this.terrainMask = new Uint8Array(256);
    speciesFood.forEach((f, s) => {
      for (const id of f) this.terrainMask[id] |= 1 << this.groupOf[s];
    });
  }

  build(world: World, tick: number): void {
    this.w = Math.ceil(world.width / FOOD_CELL);
    this.h = Math.ceil(world.height / FOOD_CELL);
    const cells = this.w * this.h;
    if (this.counts.length !== this.groups || this.counts[0]?.length !== cells) {
      this.counts = Array.from({ length: this.groups }, () => new Uint16Array(cells));
    } else {
      for (const c of this.counts) c.fill(0);
    }
    const mask = this.terrainMask;
    for (let y = 0; y < world.height; y++) {
      const row = Math.floor(y / FOOD_CELL) * this.w;
      for (let x = 0; x < world.width; x++) {
        const m = mask[world.terrain[y * world.width + x]];
        if (!m) continue;
        const cell = row + Math.floor(x / FOOD_CELL);
        for (let g = 0; g < this.groups; g++) if (m & (1 << g)) this.counts[g][cell]++;
      }
    }
    this.builtTick = tick;
  }

  /** Snapshot for saves (so a loaded world sees exactly the same food map). */
  exportState(): { builtTick: number; w: number; h: number; counts: Uint16Array[] } {
    return { builtTick: this.builtTick, w: this.w, h: this.h, counts: this.counts.map((c) => c.slice()) };
  }

  importState(s: { builtTick: number; w: number; h: number; counts: Uint16Array[] } | undefined): void {
    if (!s || s.counts.length !== this.groups) {
      this.builtTick = -Infinity;
      return;
    }
    this.builtTick = s.builtTick;
    this.w = s.w;
    this.h = s.h;
    this.counts = s.counts.map((c) => c.slice());
  }

  /** Food tiles of a group in cells overlapping the square of radius r around (x, y). */
  around(group: number, x: number, y: number, r: number): number {
    if (!this.w) return 1; // not built yet: don't block searches
    const c = this.counts[group];
    const gx0 = Math.max(0, Math.floor((x - r) / FOOD_CELL));
    const gy0 = Math.max(0, Math.floor((y - r) / FOOD_CELL));
    const gx1 = Math.min(this.w - 1, Math.floor((x + r) / FOOD_CELL));
    const gy1 = Math.min(this.h - 1, Math.floor((y + r) / FOOD_CELL));
    let n = 0;
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) n += c[gy * this.w + gx];
    return n;
  }

  /**
   * Cells with food of a group, nearest first (ring by ring), up to maxRings
   * rings out. accept(cell) filters candidates (e.g. reachability). Returns the
   * first accepted cell or -1.
   */
  nearestCell(group: number, x: number, y: number, maxRings: number, accept: (cell: number) => boolean): number {
    if (!this.w) return -1;
    const c = this.counts[group];
    const gx = Math.min(this.w - 1, Math.max(0, Math.floor(x / FOOD_CELL)));
    const gy = Math.min(this.h - 1, Math.max(0, Math.floor(y / FOOD_CELL)));
    for (let r = 1; r <= maxRings; r++) {
      let best = -1;
      let bestN = 0;
      for (let cy = gy - r; cy <= gy + r; cy++) {
        if (cy < 0 || cy >= this.h) continue;
        for (let cx = gx - r; cx <= gx + r; cx++) {
          if (cx < 0 || cx >= this.w) continue;
          if (Math.max(Math.abs(cx - gx), Math.abs(cy - gy)) !== r) continue;
          const cell = cy * this.w + cx;
          if (c[cell] > bestN && accept(cell)) {
            bestN = c[cell];
            best = cell;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }
}
