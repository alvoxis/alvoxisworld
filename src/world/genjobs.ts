import { generateWorld, MAX_WORLD_TILES } from './generator';
import { World } from './world';

/** Request to generate a world off the main thread. */
export interface GenRequest {
  id: number;
  width: number;
  height: number;
  seed: number;
}

/** Every per-tile layer of a freshly generated world. */
const LAYERS = ['heights', 'terrain', 'temperature', 'moisture', 'baseTemperature', 'baseMoisture', 'waterFlags', 'slopeClass'] as const;
type Layer = (typeof LAYERS)[number];

export type GenResult =
  | ({ id: number; ok: true; width: number; height: number; seed: number } & Record<Layer, Uint8Array>)
  | { id: number; ok: false; error: string };

/** Pure: generates a world and packs its layers. Never throws. */
export function computeWorld(req: GenRequest): GenResult {
  try {
    if (!(req.width > 0 && req.height > 0 && req.width * req.height <= MAX_WORLD_TILES)) throw new Error('invalid world size');
    const w = generateWorld(req.width, req.height, req.seed);
    const out = { id: req.id, ok: true as const, width: w.width, height: w.height, seed: w.seed } as Extract<GenResult, { ok: true }>;
    for (const k of LAYERS) out[k] = w[k];
    return out;
  } catch (err) {
    return { id: req.id, ok: false, error: String((err as Error)?.message ?? err) };
  }
}

export function genTransferables(res: GenResult): ArrayBuffer[] {
  return res.ok ? LAYERS.map((k) => res[k].buffer as ArrayBuffer) : [];
}

/** Rebuilds a World from a worker result. */
export function worldFromResult(res: Extract<GenResult, { ok: true }>): World {
  const w = new World(res.width, res.height, res.seed);
  for (const k of LAYERS) {
    if (res[k].length !== res.width * res.height) throw new Error(`generated layer ${k} has the wrong size`);
    w[k].set(res[k]);
  }
  w.markAllDirty();
  return w;
}

export interface GenWorkerLike {
  postMessage(message: unknown): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  terminate(): void;
}

/**
 * Generates a world in a worker so the page stays responsive (large maps take
 * around a second). Falls back to generating on the main thread if there is no
 * worker, it fails, returns an error, or takes longer than timeoutMs. The result
 * is identical either way (same deterministic generator).
 */
export function generateWorldAsync(
  width: number,
  height: number,
  seed: number,
  makeWorker: (() => GenWorkerLike) | null,
  timeoutMs = 20000,
): Promise<{ world: World; usedWorker: boolean; error?: string }> {
  const local = (error?: string) => ({ world: generateWorld(width, height, seed), usedWorker: false, error });
  if (!makeWorker) return Promise.resolve(local());
  return new Promise((resolve) => {
    let worker: GenWorkerLike;
    let done = false;
    const finish = (r: { world: World; usedWorker: boolean; error?: string }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        worker?.terminate();
      } catch {
        /* ignore */
      }
      resolve(r);
    };
    const timer = setTimeout(() => finish(local('worker timed out')), timeoutMs);
    try {
      worker = makeWorker();
    } catch (err) {
      finish(local(String(err)));
      return;
    }
    worker.onmessage = (ev) => {
      const res = ev.data as GenResult;
      if (!res || !res.ok) {
        finish(local(res && !res.ok ? res.error : 'bad worker reply'));
        return;
      }
      try {
        finish({ world: worldFromResult(res), usedWorker: true });
      } catch (err) {
        finish(local(String(err)));
      }
    };
    worker.onerror = () => finish(local('worker error'));
    try {
      worker.postMessage({ id: 1, width, height, seed } satisfies GenRequest);
    } catch (err) {
      finish(local(String(err)));
    }
  });
}
