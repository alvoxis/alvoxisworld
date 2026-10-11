import { World } from '../world/world';

/** Food-map cell size in tiles (matches the creature spatial hash). */
export const FOOD_CELL = 8;

/**
 * Coarse count of food tiles per cell for each distinct diet ("food group").
 * Lets hungry animals skip searches that cannot succeed (no food anywhere in
 * sight) and pick a direction to migrate in, instead of re-running a failing
 * breadth-first search every few ticks. Built in one pass when a world starts, then
 * refreshed a band of cell rows per tick (round robin, about every FOOD_MAP_TICKS
 * ticks per band), so a big map never pays an O(map) hitch in a single tick.
 */
export class FoodMap {
  /** Group index per species. */
  readonly groupOf: number[];
  /** Bitmask of groups that eat each terrain id. */
  /** Bitmask of food groups per terrain id (32 bits: there are more than eight diets since 0.23's new animals). */
  private readonly terrainMask: Uint32Array;
  readonly groups: number;
  private counts: Uint16Array[] = [];
  w = 0;
  h = 0;
  builtTick = -Infinity;
  /** Next band (row of cells) the incremental refresh will recount. */
  cursor = 0;

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
    this.terrainMask = new Uint32Array(256);
    if (keys.length > 32) throw new Error('Too many food groups for the food map');
    speciesFood.forEach((f, s) => {
      for (const id of f) this.terrainMask[id] |= (1 << this.groupOf[s]) >>> 0;
    });
  }

  /** Recounts every cell at once (a new world, or tests). */
  build(world: World, tick: number): void {
    this.w = Math.ceil(world.width / FOOD_CELL);
    this.h = Math.ceil(world.height / FOOD_CELL);
    const cells = this.w * this.h;
    if (this.counts.length !== this.groups || this.counts[0]?.length !== cells) {
      this.counts = Array.from({ length: this.groups }, () => new Uint16Array(cells));
    } else {
      for (const c of this.counts) c.fill(0);
    }
    for (let band = 0; band < this.h; band++) this.countBand(world, band);
    this.builtTick = tick;
    this.cursor = 0;
  }

  /** Counts food tiles in one band (FOOD_CELL tile rows) into the cells of that band row. */
  private countBand(world: World, band: number): void {
    const mask = this.terrainMask;
    const W = world.width;
    const y1 = Math.min(world.height, (band + 1) * FOOD_CELL);
    const rowCells = band * this.w;
    for (let g = 0; g < this.groups; g++) this.counts[g].fill(0, rowCells, rowCells + this.w);
    for (let y = band * FOOD_CELL; y < y1; y++) {
      const base = y * W;
      for (let x = 0; x < W; x++) {
        const m = mask[world.terrain[base + x]];
        if (!m) continue;
        const cell = rowCells + (x >> 3); // FOOD_CELL is 8
        for (let g = 0; g < this.groups; g++) if (m & (1 << g)) this.counts[g][cell]++;
      }
    }
  }

  /**
   * Called every tick. Builds everything on the first call for a world (or after a
   * time rewind), then recounts a few bands per tick, so the whole map is refreshed
   * about every FOOD_MAP_TICKS ticks with the cost spread evenly.
   */
  update(world: World, tick: number, period: number): void {
    const w = Math.ceil(world.width / FOOD_CELL);
    const h = Math.ceil(world.height / FOOD_CELL);
    if (this.w !== w || this.h !== h || this.builtTick > tick || !Number.isFinite(this.builtTick)) {
      this.build(world, tick);
      return;
    }
    const perTick = Math.max(1, Math.ceil(this.h / period));
    for (let k = 0; k < perTick; k++) {
      this.countBand(world, this.cursor);
      this.cursor = (this.cursor + 1) % this.h;
    }
    this.builtTick = tick;
  }

  /** Snapshot for saves (so a loaded world sees exactly the same food map). */
  exportState(): { builtTick: number; w: number; h: number; counts: Uint16Array[]; cursor: number } {
    return { builtTick: this.builtTick, w: this.w, h: this.h, counts: this.counts.map((c) => c.slice()), cursor: this.cursor };
  }

  importState(s: { builtTick: number; w: number; h: number; counts: Uint16Array[]; cursor?: number } | undefined): void {
    if (!s || s.counts.length !== this.groups) {
      this.builtTick = -Infinity;
      return;
    }
    this.builtTick = s.builtTick;
    this.w = s.w;
    this.h = s.h;
    this.counts = s.counts.map((c) => c.slice());
    this.cursor = Number.isInteger(s.cursor) && s.cursor! >= 0 && s.cursor! < s.h ? s.cursor! : 0;
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
