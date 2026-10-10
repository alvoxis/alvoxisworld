import { TILE_FIELDS, World } from '../world/world';

/** One undoable player action: each changed tile's values before and after it. */
interface UndoAction {
  label: string;
  /** Tile indices, in first-touched order. */
  tiles: Int32Array;
  /** TILE_FIELDS values per tile before the action (see World.readTile). */
  before: Uint8Array;
  /** TILE_FIELDS values per tile when the action ended. */
  after: Uint8Array;
}

/** What undo() or redo() did. */
export interface UndoResult {
  label: string;
  /** Tiles put back. */
  applied: number;
  /** Tiles left alone because the world changed them after the action (weather, grazing, fire, floods…). */
  skipped: number;
}

export const MAX_UNDO_ACTIONS = 40;
/** Total tiles kept across undo and redo stacks (≈ 20 bytes each), so history stays a few MB at most. */
export const MAX_UNDO_TILES = 400_000;

/**
 * Field offsets (see World.readTile) that must still match before a tile is
 * reverted: height, terrain, long-term climate, water memory, flood terrain.
 * Current temperature/moisture (2, 3) are transient weather and never block.
 */
const CHECKED = [0, 1, 4, 5, 6, 7] as const;
const CUR_TEMP = 2;
const CUR_MOIST = 3;

/**
 * Change-based undo/redo for terrain-editing actions (brushes, paint, flood,
 * drain, meteor and earthquake terrain). While an action is open, the world's
 * recorder saves each tile's previous values the first time it is touched; when
 * the action ends its resulting values are saved too. No full-world snapshots.
 *
 * Conflict rule: undo reverts a tile only if it still holds exactly what the
 * action left there; redo re-applies a tile only if it still holds what undo
 * restored. A tile the simulation changed in between (a lake that dried, grass
 * that was grazed, a forest that burned) keeps its newer state, so undo never
 * resurrects stale terrain over later changes. Skipped tiles are reported.
 */
export class UndoHistory {
  private actions: UndoAction[] = [];
  private redoStack: UndoAction[] = [];
  private totalTiles = 0;
  private current: { label: string; seen: Set<number>; tiles: number[]; values: number[] } | null = null;
  private world: World | null = null;
  private readonly buf = new Uint8Array(TILE_FIELDS);
  /** Called whenever canUndo/canRedo may have changed. */
  onChange: () => void = () => {};

  get canUndo(): boolean {
    return this.actions.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get size(): number {
    return this.actions.length;
  }

  get redoSize(): number {
    return this.redoStack.length;
  }

  /** Tiles held across both stacks (memory ≈ 20 bytes each). */
  get storedTiles(): number {
    return this.totalTiles;
  }

  get nextLabel(): string | null {
    return this.actions.length ? this.actions[this.actions.length - 1].label : null;
  }

  get nextRedoLabel(): string | null {
    return this.redoStack.length ? this.redoStack[this.redoStack.length - 1].label : null;
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

  /**
   * Closes the open action, saving each tile's resulting values. Actions that
   * changed nothing are discarded. A new action clears the redo stack.
   */
  end(): void {
    const cur = this.current;
    const world = this.world;
    if (!cur || !world) return;
    this.current = null;
    const n = cur.tiles.length;
    const before = Uint8Array.from(cur.values);
    const after = new Uint8Array(n * TILE_FIELDS);
    let changed = false;
    for (let k = 0; k < n; k++) {
      world.readTile(cur.tiles[k], after, k * TILE_FIELDS);
      if (!changed) {
        for (let f = 0; f < TILE_FIELDS; f++) {
          if (after[k * TILE_FIELDS + f] !== before[k * TILE_FIELDS + f]) {
            changed = true;
            break;
          }
        }
      }
    }
    if (!changed) return;
    this.dropRedo();
    this.actions.push({ label: cur.label, tiles: Int32Array.from(cur.tiles), before, after });
    this.totalTiles += n;
    this.trim();
    this.onChange();
  }

  /** Reverts the most recent action where the world still matches it. */
  undo(world: World): UndoResult | null {
    this.end();
    const a = this.actions.pop();
    if (!a) return null;
    const res = apply(world, a, a.after, a.before, true);
    this.redoStack.push(a);
    this.onChange();
    return res;
  }

  /** Re-applies the most recently undone action where the world still matches the undo. */
  redo(world: World): UndoResult | null {
    this.end();
    const a = this.redoStack.pop();
    if (!a) return null;
    const res = apply(world, a, a.before, a.after, false);
    this.actions.push(a);
    this.onChange();
    return res;
  }

  /** Forgets everything (new world or load: old actions refer to another map). */
  clear(): void {
    this.current = null;
    this.actions = [];
    this.redoStack = [];
    this.totalTiles = 0;
    this.world = null;
    this.onChange();
  }

  private dropRedo(): void {
    for (const a of this.redoStack) this.totalTiles -= a.tiles.length;
    this.redoStack = [];
  }

  private trim(): void {
    while (this.actions.length > MAX_UNDO_ACTIONS || (this.totalTiles > MAX_UNDO_TILES && this.actions.length > 1)) {
      this.totalTiles -= this.actions.shift()!.tiles.length;
    }
  }
}

/**
 * Moves the action's tiles from `expect` to `target`, skipping tiles whose
 * checked fields no longer equal `expect`. Current climate follows only where
 * the action itself changed it. Fire is put out on reverted tiles when undoing.
 */
function apply(world: World, a: UndoAction, expect: Uint8Array, target: Uint8Array, undoing: boolean): UndoResult {
  const cur = new Uint8Array(TILE_FIELDS);
  const out = new Uint8Array(TILE_FIELDS);
  let applied = 0;
  let skipped = 0;
  for (let k = a.tiles.length - 1; k >= 0; k--) {
    const i = a.tiles[k];
    const off = k * TILE_FIELDS;
    world.readTile(i, cur, 0);
    let ok = true;
    for (const f of CHECKED) {
      if (cur[f] !== expect[off + f]) {
        ok = false;
        break;
      }
    }
    if (!ok) {
      skipped++;
      continue;
    }
    for (let f = 0; f < TILE_FIELDS; f++) out[f] = target[off + f];
    if (a.before[off + CUR_TEMP] === a.after[off + CUR_TEMP]) out[CUR_TEMP] = cur[CUR_TEMP];
    if (a.before[off + CUR_MOIST] === a.after[off + CUR_MOIST]) out[CUR_MOIST] = cur[CUR_MOIST];
    world.writeTile(i, out, 0);
    if (undoing) world.fire[i] = 0;
    applied++;
  }
  return { label: a.label, applied, skipped };
}
