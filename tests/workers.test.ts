import { describe, expect, it } from 'vitest';
import { computeNav, NAV_DELAY, NavScheduler, navTransferables, type NavRequest, type WorkerLike } from '../src/sim/navjobs';
import { computeWaterDist } from '../src/sim/pathfinding';
import { computeRegions } from '../src/sim/regions';
import { Simulation } from '../src/sim/simulation';
import { GRAZER } from '../src/sim/creatures';
import { generateWorld } from '../src/world/generator';
import { computeWorld, generateWorldAsync, worldFromResult, type GenWorkerLike } from '../src/world/genjobs';
import { T } from '../src/world/terrain';

/** A fake worker that runs the real job function, optionally failing or staying silent. */
class FakeWorker implements WorkerLike {
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  posted: NavRequest[] = [];
  terminated = false;
  constructor(private mode: 'ok' | 'crash' | 'error-result' | 'silent') {}
  postMessage(msg: unknown): void {
    const req = msg as NavRequest;
    this.posted.push(req);
    if (this.mode === 'crash') this.onerror?.(new Error('boom'));
    else if (this.mode === 'error-result') this.onmessage?.({ data: { id: req.id, ok: false, error: 'bad' } });
    else if (this.mode === 'ok') this.onmessage?.({ data: computeNav(req) });
  }
  terminate(): void {
    this.terminated = true;
  }
}

describe('navigation worker protocol', () => {
  it('computeNav equals the main-thread builders', () => {
    const w = generateWorld(96, 64, 2);
    const res = computeNav({ id: 1, width: 96, height: 64, terrain: w.terrain.slice(), passVersion: w.passVersion });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.water).toEqual(computeWaterDist(w));
    expect(res.regions.map((r) => r.count)).toEqual(computeRegions(w).map((r) => r.count));
    expect(navTransferables(res).length).toBeGreaterThan(0);
  });

  it('reports bad snapshots as errors instead of throwing', () => {
    const res = computeNav({ id: 7, width: 10, height: 10, terrain: new Uint8Array(3), passVersion: 0 });
    expect(res).toMatchObject({ id: 7, ok: false });
  });

  it('installs the worker result exactly NAV_DELAY ticks after the request', () => {
    const fake = new FakeWorker('ok');
    const nav = new NavScheduler(() => fake);
    const w = generateWorld(64, 64, 3);
    nav.request(w, 100);
    expect(fake.posted.length).toBe(1);
    expect(nav.takeDue(100 + NAV_DELAY - 1)).toBeNull();
    const res = nav.takeDue(100 + NAV_DELAY);
    expect(res?.result.passVersion).toBe(w.passVersion);
    expect(nav.stats.workerResults).toBe(1);
    expect(nav.stats.syncFallbacks).toBe(0);
  });

  it('falls back to the main thread when the worker crashes, errors, is silent, or is missing', () => {
    const w = generateWorld(64, 64, 4);
    const expected = computeWaterDist(w);
    for (const mode of ['crash', 'error-result', 'silent'] as const) {
      const fake = new FakeWorker(mode);
      const nav = new NavScheduler(() => fake);
      nav.request(w, 0);
      const res = nav.takeDue(NAV_DELAY);
      expect(res?.result.water).toEqual(expected);
      expect(nav.stats.syncFallbacks).toBe(1);
      if (mode !== 'silent') {
        expect(fake.terminated).toBe(true);
        expect(nav.usingWorker).toBe(false);
      }
    }
    const none = new NavScheduler(null);
    none.request(w, 0);
    expect(none.takeDue(NAV_DELAY)?.result.water).toEqual(expected);
    const throwing = new NavScheduler(() => {
      throw new Error('no workers here');
    });
    throwing.request(w, 0);
    expect(throwing.takeDue(NAV_DELAY)?.result.water).toEqual(expected);
  });

  it('uses the snapshot, not later terrain (deterministic regardless of timing)', () => {
    const w = generateWorld(64, 64, 5);
    const snapWater = computeWaterDist(w);
    const nav = new NavScheduler(() => new FakeWorker('silent'));
    nav.request(w, 0);
    for (let x = 0; x < 64; x++) w.setTerrain(x, 30, T.LAKE); // changes after the snapshot
    expect(nav.takeDue(NAV_DELAY)?.result.water).toEqual(snapWater);
  });

  it('a simulation with a worker matches one without, tick for tick', () => {
    const make = (factory: (() => WorkerLike) | null) => {
      const sim = new Simulation(generateWorld(128, 96, 6));
      sim.creatures.nav.setWorkerFactory(factory);
      sim.spawnInCircle(GRAZER, 64, 48, 20, 40);
      for (let t = 0; t < 120; t++) {
        if (t === 30) for (let x = 20; x < 100; x++) sim.world.setTerrain(x, 48, T.LAKE); // forces a rebuild
        sim.step();
      }
      return sim;
    };
    const a = make(() => new FakeWorker('ok'));
    const b = make(null);
    expect(a.creatures.nav.stats.workerResults).toBeGreaterThan(0);
    expect(b.creatures.nav.stats.syncFallbacks).toBeGreaterThan(0);
    expect(Array.from(a.creatures.x.slice(0, a.creatures.count))).toEqual(Array.from(b.creatures.x.slice(0, b.creatures.count)));
  });
});

describe('world generation worker', () => {
  it('computeWorld reproduces generateWorld exactly', () => {
    const res = computeWorld({ id: 1, width: 128, height: 80, seed: 42 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const w = worldFromResult(res);
    const ref = generateWorld(128, 80, 42);
    expect(w.terrain).toEqual(ref.terrain);
    expect(w.heights).toEqual(ref.heights);
    expect(w.waterFlags).toEqual(ref.waterFlags);
    expect(w.baseMoisture).toEqual(ref.baseMoisture);
  });

  it('rejects invalid sizes with an error result', () => {
    expect(computeWorld({ id: 2, width: 0, height: 10, seed: 1 }).ok).toBe(false);
  });

  it('generateWorldAsync uses the worker, or falls back on error/no worker', async () => {
    const ref = generateWorld(96, 64, 9);
    class GenFake implements GenWorkerLike {
      onmessage: ((ev: { data: unknown }) => void) | null = null;
      onerror: ((ev: unknown) => void) | null = null;
      terminated = false;
      constructor(private fail: boolean) {}
      postMessage(msg: unknown): void {
        if (this.fail) setTimeout(() => this.onerror?.(new Error('x')), 0);
        else setTimeout(() => this.onmessage?.({ data: computeWorld(msg as { id: number; width: number; height: number; seed: number }) }), 0);
      }
      terminate(): void {
        this.terminated = true;
      }
    }
    const ok = await generateWorldAsync(96, 64, 9, () => new GenFake(false));
    expect(ok.usedWorker).toBe(true);
    expect(ok.world.terrain).toEqual(ref.terrain);
    const bad = await generateWorldAsync(96, 64, 9, () => new GenFake(true));
    expect(bad.usedWorker).toBe(false);
    expect(bad.error).toBeTruthy();
    expect(bad.world.terrain).toEqual(ref.terrain);
    const none = await generateWorldAsync(96, 64, 9, null);
    expect(none.usedWorker).toBe(false);
    expect(none.world.terrain).toEqual(ref.terrain);
  });
});
