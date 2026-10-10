/**
 * Repeatable simulation benchmarks (run with `npm run bench`). Single-threaded,
 * deterministic scenarios; timings depend on the machine, so compare runs made on
 * the same machine only.
 */
import { Rng } from '../src/core/rng';
import { TICKS_PER_YEAR } from '../src/sim/clock';
import { FISH, GRAZER, HADROSAUR, MAX_CREATURES, RAPTOR, SPECIES, TYRANT } from '../src/sim/creatures';
import { Simulation } from '../src/sim/simulation';
import { generateWorld } from '../src/world/generator';
import { T } from '../src/world/terrain';

function timeTicks(sim: Simulation, ticks: number): { avg: number; p95: number } {
  const samples: number[] = [];
  for (let t = 0; t < ticks; t++) {
    const t0 = performance.now();
    sim.step();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return { avg: samples.reduce((a, b) => a + b, 0) / ticks, p95: samples[Math.floor(ticks * 0.95)] };
}

function place(sim: Simulation, seed: number, want: number, n: number, fn: (x: number, y: number, k: number) => void) {
  const w = sim.world;
  const r = new Rng(seed);
  let k = 0;
  for (let a = 0; a < 20000 && k < n; a++) {
    const x = r.next() * w.width;
    const y = r.next() * w.height;
    if (w.terrainAt(Math.floor(x), Math.floor(y)) !== want) continue;
    fn(x, y, k);
    k++;
  }
}

/**
 * The ecosystem scenario from docs/ECOSYSTEM.md, timed over its 6th year.
 * weather=false matches the pre-weather baseline; navigation rebuilds run on the
 * main thread here (no worker in Node), which is the worst case.
 */
function mixed(seed: number, weather = true): string {
  const sim = new Simulation(generateWorld(512, 320, seed));
  sim.weather.config.auto = weather;
  place(sim, seed, T.GRASS, 15, (x, y, k) => {
    sim.spawnInCircle(GRAZER, x, y, 3, 8);
    if (k % 3 === 0) sim.spawnInCircle(RAPTOR, x, y, 3, 2);
  });
  place(sim, seed + 1, T.FOREST, 8, (x, y, k) => {
    sim.spawnInCircle(HADROSAUR, x, y, 3, 4);
    if (k % 4 === 0) sim.spawnInCircle(TYRANT, x, y, 3, 2);
  });
  place(sim, seed + 2, T.SHALLOW_WATER, 8, (x, y) => sim.spawnInCircle(FISH, x, y, 3, 6));
  for (let t = 0; t < TICKS_PER_YEAR * 5; t++) sim.step();
  const r = timeTicks(sim, TICKS_PER_YEAR);
  const nav = sim.creatures.nav.stats;
  return `mixed seed ${seed} weather ${weather ? 'on ' : 'off'}, year 6: ${sim.creatures.count} animals, avg ${r.avg.toFixed(2)} ms/tick, p95 ${r.p95.toFixed(2)} (nav rebuilds ${nav.syncFallbacks}, last ${nav.lastSyncMs.toFixed(1)} ms on main thread)`;
}

/** Herbivores pinned at their population caps: the worst case for wasted work. */
function capped(): string {
  const w = generateWorld(512, 320, 4);
  const sim = new Simulation(w);
  const r = new Rng(9);
  const want = [
    [GRAZER, Math.floor(MAX_CREATURES * SPECIES[GRAZER].maxShare)],
    [FISH, Math.floor(MAX_CREATURES * SPECIES[FISH].maxShare)],
    [HADROSAUR, 300],
    [RAPTOR, 100],
  ];
  for (const [sp, n] of want) {
    for (let a = 0; a < 400000 && sim.creatures.countSpecies(sp) < n; a++) {
      sim.spawnInCircle(sp, r.next() * w.width, r.next() * w.height, 1, 1);
    }
  }
  for (let t = 0; t < 100; t++) sim.step(); // settle
  const res = timeTicks(sim, 600);
  return `capped: ${sim.creatures.count} animals, avg ${res.avg.toFixed(2)} ms/tick, p95 ${res.p95.toFixed(2)}`;
}

/** Long journeys: can hadrosaurs plan routes to targets ~200 tiles away? */
function longRoutes(): string {
  const w = generateWorld(1024, 640, 7);
  const sim = new Simulation(w);
  const c = sim.creatures;
  const r = new Rng(5);
  // Pairs of reachable land tiles far apart (checked with a full flood fill).
  const n = w.width * w.height;
  const comp = new Int32Array(n).fill(-1);
  const q = new Int32Array(n);
  let label = 0;
  for (let s = 0; s < n; s++) {
    if (comp[s] >= 0 || !passableLow(w, s)) continue;
    let h = 0;
    let t = 0;
    q[t++] = s;
    comp[s] = label;
    while (h < t) {
      const cur = q[h++];
      const x = cur % w.width;
      const y = (cur - x) / w.width;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (!w.inBounds(nx, ny)) continue;
        const nb = ny * w.width + nx;
        if (comp[nb] >= 0 || !passableLow(w, nb)) continue;
        comp[nb] = label;
        q[t++] = nb;
      }
    }
    label++;
  }
  let ok = 0;
  let tried = 0;
  const pf = c.pathfinder;
  const out = new Int32Array(64);
  const t0 = performance.now();
  const e0 = pf.expansions;
  for (let a = 0; a < 200000 && tried < 40; a++) {
    const s = Math.floor(r.next() * n);
    const g = Math.floor(r.next() * n);
    if (comp[s] < 0 || comp[s] !== comp[g]) continue;
    const sx = s % w.width;
    const sy = Math.floor(s / w.width);
    const gx = g % w.width;
    const gy = Math.floor(g / w.width);
    if (Math.hypot(gx - sx, gy - sy) < 150) continue;
    tried++;
    pf.beginTick(1e9);
    if (planLong(sim, sx, sy, gx, gy, out)) ok++;
  }
  const ms = performance.now() - t0;
  return `long routes (1024×640, ≥150 tiles, reachable): ${ok}/${tried} found, ${(ms / tried).toFixed(1)} ms and ${Math.round((pf.expansions - e0) / tried)} expansions per route`;
}

import { MOVE, passable } from '../src/sim/pathfinding';
function passableLow(w: ReturnType<typeof generateWorld>, i: number): boolean {
  return passable(w, MOVE.LOWLAND, i % w.width, Math.floor(i / w.width));
}
/** Uses whatever long-route planning the creature system offers (see planLongRoute). */
function planLong(sim: Simulation, sx: number, sy: number, gx: number, gy: number, out: Int32Array): boolean {
  const c = sim.creatures as unknown as {
    planLongRoute?: (cls: number, sx: number, sy: number, gx: number, gy: number, world: unknown) => boolean;
  };
  if (c.planLongRoute) return c.planLongRoute(MOVE.LOWLAND, sx, sy, gx, gy, sim.world);
  // Baseline: the plain A* used for prowling (6,000-node cap).
  return sim.creatures.pathfinder.astar(sim.world, MOVE.LOWLAND, sx, sy, gx, gy, 6000, out, 0, 32) >= 0;
}

const which = ((globalThis as unknown as { process?: { argv: string[] } }).process?.argv[2]) ?? 'all';
const t0 = performance.now();
if (which === 'all' || which === 'mixed') for (const s of [4, 11]) for (const wx of [false, true]) console.log(mixed(s, wx));
if (which === 'all' || which === 'capped') console.log(capped());
if (which === 'all' || which === 'long') console.log(longRoutes());
console.log(`total ${(performance.now() - t0) / 1000 | 0}s`);
