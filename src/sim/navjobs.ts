import { World } from '../world/world';
import { computeWaterDist } from './pathfinding';
import { computeRegions, type ClassRegions } from './regions';

/** Snapshot of the terrain sent to a navigation worker. */
export interface NavRequest {
  id: number;
  width: number;
  height: number;
  terrain: Uint8Array;
  passVersion: number;
}

export type NavResult =
  | { id: number; ok: true; passVersion: number; water: Uint16Array[]; regions: ClassRegions[] }
  | { id: number; ok: false; error: string };

/** Pure: computes navigation data for a snapshot. Never throws (errors become results). */
export function computeNav(req: NavRequest): NavResult {
  try {
    if (req.terrain.length !== req.width * req.height) throw new Error('terrain size mismatch');
    return {
      id: req.id,
      ok: true,
      passVersion: req.passVersion,
      water: computeWaterDist(req),
      regions: computeRegions(req),
    };
  } catch (err) {
    return { id: req.id, ok: false, error: String((err as Error)?.message ?? err) };
  }
}

/** Buffers in a result that can be transferred (moved, not copied) between threads. */
export function navTransferables(res: NavResult): ArrayBuffer[] {
  if (!res.ok) return [];
  const out: ArrayBuffer[] = res.water.map((d) => d.buffer as ArrayBuffer);
  for (const c of res.regions) {
    out.push(c.tileRegion.buffer as ArrayBuffer, c.rep.buffer as ArrayBuffer, c.comp.buffer as ArrayBuffer);
    out.push(c.adjStart.buffer as ArrayBuffer, c.adj.buffer as ArrayBuffer);
  }
  return out;
}

/** Minimal worker interface (lets tests inject a fake worker). */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  terminate(): void;
}

/** Ticks between taking a terrain snapshot and installing its navigation data. */
export const NAV_DELAY = 20;

/**
 * Runs navigation rebuilds (water field + region graph) off the main thread while
 * keeping the simulation deterministic:
 *  - request() copies the terrain at tick t and posts it to the worker;
 *  - takeDue() at tick t + NAV_DELAY returns the worker's result, or — if the
 *    worker hasn't answered, failed, or doesn't exist (tests, old browsers) —
 *    computes the identical result from the same snapshot on the spot.
 * Either way the same data is installed at the same tick.
 */
export class NavScheduler {
  private worker: WorkerLike | null = null;
  private broken = false;
  private pending: { req: NavRequest; due: number; result: NavResult | null } | null = null;
  private nextId = 1;
  readonly stats = { requests: 0, workerResults: 0, syncFallbacks: 0, workerErrors: 0, lastSyncMs: 0 };

  constructor(private factory: (() => WorkerLike) | null = null) {}

  /** Enables a worker (browser). Passing null forces main-thread computation. */
  setWorkerFactory(factory: (() => WorkerLike) | null): void {
    this.dispose();
    this.factory = factory;
    this.broken = false;
  }

  get busy(): boolean {
    return this.pending !== null;
  }

  get usingWorker(): boolean {
    return !!this.worker && !this.broken;
  }

  private ensureWorker(): WorkerLike | null {
    if (this.worker || this.broken || !this.factory) return this.worker;
    try {
      const w = this.factory();
      w.onmessage = (ev) => this.onResult(ev.data as NavResult);
      w.onerror = () => this.fail();
      this.worker = w;
    } catch {
      this.fail();
    }
    return this.worker;
  }

  private onResult(res: NavResult): void {
    const p = this.pending;
    if (!p || !res || res.id !== p.req.id) return; // stale answer (cancelled request)
    if (!res.ok) {
      this.fail();
      return;
    }
    p.result = res;
    this.stats.workerResults++;
  }

  /** Worker crashed or reported an error: stop using it; due results are computed locally. */
  private fail(): void {
    this.stats.workerErrors++;
    this.broken = true;
    try {
      this.worker?.terminate();
    } catch {
      /* already gone */
    }
    this.worker = null;
  }

  request(world: World, tick: number): void {
    const req: NavRequest = {
      id: this.nextId++,
      width: world.width,
      height: world.height,
      terrain: world.terrain.slice(),
      passVersion: world.passVersion,
    };
    this.pending = { req, due: tick + NAV_DELAY, result: null };
    this.stats.requests++;
    const w = this.ensureWorker();
    if (!w) return;
    try {
      // Send a copy so the snapshot stays available for the main-thread fallback.
      const copy = req.terrain.slice();
      w.postMessage({ ...req, terrain: copy }, [copy.buffer]);
    } catch {
      this.fail();
    }
  }

  /**
   * The result to install now, if a request is due at this tick (else null), with
   * the terrain snapshot it was computed from.
   */
  takeDue(tick: number): { result: Extract<NavResult, { ok: true }>; snapshot: Uint8Array } | null {
    const p = this.pending;
    if (!p || tick < p.due) return null;
    this.pending = null;
    if (p.result && p.result.ok) return { result: p.result, snapshot: p.req.terrain };
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const res = computeNav(p.req);
    if (t0) this.stats.lastSyncMs = performance.now() - t0;
    this.stats.syncFallbacks++;
    return res.ok ? { result: res, snapshot: p.req.terrain } : null;
  }

  /** Pending request for saves: { snapshot, passVersion, due } or null. */
  exportPending(): { terrain: Uint8Array; passVersion: number; due: number } | null {
    const p = this.pending;
    return p ? { terrain: p.req.terrain.slice(), passVersion: p.req.passVersion, due: p.due } : null;
  }

  /** Restores a saved pending request (the result is recomputed when due, or by the worker). */
  importPending(world: World, p: { terrain: Uint8Array; passVersion: number; due: number } | null): void {
    this.pending = null;
    if (!p) return;
    const req: NavRequest = { id: this.nextId++, width: world.width, height: world.height, terrain: p.terrain.slice(), passVersion: p.passVersion };
    this.pending = { req, due: p.due, result: null };
    const w = this.ensureWorker();
    if (!w) return;
    try {
      const copy = req.terrain.slice();
      w.postMessage({ ...req, terrain: copy }, [copy.buffer]);
    } catch {
      this.fail();
    }
  }

  /** Drops a pending request (world replaced). */
  cancel(): void {
    this.pending = null;
  }

  dispose(): void {
    this.pending = null;
    try {
      this.worker?.terminate();
    } catch {
      /* ignore */
    }
    this.worker = null;
  }
}
