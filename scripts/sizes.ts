/**
 * World-size measurements (run with `npm run bench:sizes`): generation time,
 * memory held by the simulation's per-tile data, navigation build time, save
 * size, and tick cost with a population scaled to the map area. Node only; the
 * renderer's canvases are estimated from their pixel counts (see PERFORMANCE.md).
 */
import { encodeSaveFile } from '../src/save/file';
import { serialize } from '../src/save/serialize';
import { GRAZER, RAPTOR } from '../src/sim/creatures';
import { Simulation } from '../src/sim/simulation';
import { generateWorld, WORLD_SIZES } from '../src/world/generator';
import { T } from '../src/world/terrain';
import { Rng } from '../src/core/rng';

const g = globalThis as unknown as {
  process: { argv: string[] };
};
const process = g.process;
const mb = (b: number) => (b / 1048576).toFixed(1);
/** Exact bytes of every distinct ArrayBuffer reachable from `root`. */
function retainedBytes(root: unknown): number {
  const seenObj = new Set<object>();
  const seenBuf = new Set<ArrayBufferLike>();
  let total = 0;
  const stack: unknown[] = [root];
  while (stack.length) {
    const v = stack.pop();
    if (!v || typeof v !== 'object' || seenObj.has(v)) continue;
    seenObj.add(v);
    if (ArrayBuffer.isView(v)) {
      if (!seenBuf.has(v.buffer)) {
        seenBuf.add(v.buffer);
        total += v.buffer.byteLength;
      }
      continue;
    }
    if (v instanceof Map || v instanceof Set) {
      for (const x of v.values()) stack.push(x);
      if (v instanceof Map) for (const x of v.keys()) stack.push(x);
      continue;
    }
    for (const k of Object.keys(v)) stack.push((v as Record<string, unknown>)[k]);
  }
  return total;
}


const only = process.argv.slice(2);
const rows: string[] = [];
for (const size of WORLD_SIZES) {
  if (only.length && !only.includes(size.key)) continue;
  const t0 = performance.now();
  const world = generateWorld(size.width, size.height, 12345);
  const genMs = performance.now() - t0;
  const worldBytes = retainedBytes(world);
  const sim = new Simulation(world);
  sim.weather.config.auto = true;
  // Population scaled to area: one herd of 8 grazers (+ 2 raptors every 3rd) per 6,000 land tiles.
  let land = 0;
  for (let i = 0; i < world.terrain.length; i++) if (world.terrain[i] === T.GRASS || world.terrain[i] === T.SAVANNA) land++;
  const herds = Math.max(4, Math.min(400, Math.round(land / 6000)));
  const r = new Rng(7);
  for (let k = 0, a = 0; k < herds && a < 200000; a++) {
    const x = r.next() * world.width;
    const y = r.next() * world.height;
    const id = world.terrainAt(Math.floor(x), Math.floor(y));
    if (id !== T.GRASS && id !== T.SAVANNA) continue;
    sim.spawnInCircle(GRAZER, x, y, 3, 8);
    if (k % 3 === 0) sim.spawnInCircle(RAPTOR, x, y, 3, 2);
    k++;
  }
  const t1 = performance.now();
  sim.step(); // first tick builds navigation (main thread in Node)
  const firstTickMs = performance.now() - t1;
  for (let t = 0; t < 200; t++) sim.step();
  // Measure with no navigation rebuild in flight (one would briefly add a snapshot and new fields).
  for (let t = 0; t < 400 && sim.creatures.nav.busy; t++) sim.step();
  const simBytes = retainedBytes(sim);
  const pfMb = mb(sim.creatures.pathfinder.scratchBytes);
  const samples: number[] = [];
  for (let t = 0; t < 300; t++) {
    const s = performance.now();
    sim.step();
    samples.push(performance.now() - s);
  }
  samples.sort((a, b) => a - b);
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  const p95 = samples[Math.floor(samples.length * 0.95)];
  const t2 = performance.now();
  const data = serialize(sim);
  const serMs = performance.now() - t2;
  const t3 = performance.now();
  const file = await encodeSaveFile(data);
  const fileMs = performance.now() - t3;
  const tiles = size.width * size.height;
  rows.push(
    `${size.key.padEnd(6)} ${`${size.width}×${size.height}`.padEnd(10)} ${(tiles / 1e6).toFixed(2)}M tiles | gen ${genMs.toFixed(0)} ms | world ${mb(worldBytes)} MB, whole sim ${mb(simBytes)} MB (search ${pfMb}) | first tick ${firstTickMs.toFixed(0)} ms | ${sim.creatures.count} animals: avg ${avg.toFixed(2)} ms/tick, p95 ${p95.toFixed(2)} | serialize ${serMs.toFixed(0)} ms, file ${mb(file.bytes.length)} MB in ${fileMs.toFixed(0)} ms | canvases ≈${mb(tiles * 8)} MB`,
  );
  console.log(rows[rows.length - 1]);
}
