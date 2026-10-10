import { TILE_FIELDS, World } from '../world/world';

/** One undoable player action: the previous values of every tile it changed. */
interface UndoAction {
  label: string;
  /** Tile indices, in first-touched order. */
  tiles: Int32Array;
  /** TILE_FIELDS values per tile (see World.readTile). */
  values: Uint8Array;
}

export const MAX_UNDO_ACTIONS = 40;
/** Total tiles kept across all actions (≈ 9 bytes each), so history stays a few MB at most. */
export const MAX_UNDO_TILES = 400_000;

/**
 * Change-based undo for terrain-editing actions (brushes, paint, meteor and
 * earthquake terrain). While an action is open, the world's recorder saves each
 * tile's previous values the first time it is touched; a brush stroke that passes
 * over the same tile 50 times stores it once. No full-world snapshots.
 */
export class UndoHistory {
  private actions: UndoAction[] = [];
  private totalTiles = 0;
  private current: { label: string; seen: Set<number>; tiles: number[]; values: number[] } | null = null;
  private world: World | null = null;
  private readonly buf = new Uint8Array(TILE_FIELDS);
  /** Called whenever canUndo may have changed. */
  onChange: () => void = () => {};

  get canUndo(): boolean {
    return this.actions.length > 0;
  }

  get size(): number {
    return this.actions.length;
  }

  get nextLabel(): string | null {
    return this.actions.length ? this.actions[this.actions.length - 1].label : null;
  }

  /**
   * Opens an action (e.g. at the start of a brush stroke). Nothing is recorded
   * until record() runs, so simulation changes between applications (grazing,
   * weather) are never captured.
   */
  begin(world: World, label: string): void {
    if (this.current && this.world === world) return;
    this.end();
    this.world = world;
    this.current = { label, seen: new Set<number>(), tiles: [], values: [] };
  }

  /** Runs fn with recording on, into the open action (opening and closing one if none is open). */
  record<T>(world: World, label: string, fn: () => T): T {
    const opened = !this.current || this.world !== world;
    if (opened) this.begin(world, label);
    const cur = this.current!;
    world.recorder = (i) => {
      if (cur.seen.has(i)) return;
      cur.seen.add(i);
      cur.tiles.push(i);
      world.readTile(i, this.buf, 0);
      for (let k = 0; k < TILE_FIELDS; k++) cur.values.push(this.buf[k]);
    };
    try {
      return fn();
    } finally {
      world.recorder = null;
      if (opened) this.end();
    }
  }

  /** Closes the open action; empty actions (nothing changed) are discarded. */
  end(): void {
    const cur = this.current;
    if (!cur) return;
    this.current = null;
    if (cur.tiles.length === 0) return;
    this.actions.push({ label: cur.label, tiles: Int32Array.from(cur.tiles), values: Uint8Array.from(cur.values) });
    this.totalTiles += cur.tiles.length;
    while (this.actions.length > MAX_UNDO_ACTIONS || (this.totalTiles > MAX_UNDO_TILES && this.actions.length > 1)) {
      this.totalTiles -= this.actions.shift()!.tiles.length;
    }
    this.onChange();
  }

  /**
   * Restores the tiles of the most recent action to their values before it, and
   * puts out any fire on them. Returns the action's label, or null if empty.
   */
  undo(world: World): string | null {
    this.end();
    const a = this.actions.pop();
    if (!a) return null;
    this.totalTiles -= a.tiles.length;
    // Restore in reverse so the earliest saved value wins if a tile appears twice.
    for (let k = a.tiles.length - 1; k >= 0; k--) {
      const i = a.tiles[k];
      world.writeTile(i, a.values, k * TILE_FIELDS);
      world.fire[i] = 0;
    }
    this.onChange();
    return a.label;
  }

  /** Forgets everything (new world or load: old actions refer to another map). */
  clear(): void {
    this.end();
    this.actions = [];
    this.totalTiles = 0;
    this.world = null;
    this.onChange();
  }
}
