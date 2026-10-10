/**
 * Behaviour diagnostics (run with `npm run bench -- behavior` is not wired; use
 * `npx vite-node scripts/behavior.ts`): runs the mixed ecosystem for several
 * seeds and reports death causes, creatures that barely move for a long time
 * (possibly stuck), creatures on terrain their species cannot enter, and the
 * share of time spent in each state.
 */
import { Rng } from '../src/core/rng';
import { TICKS_PER_YEAR } from '../src/sim/clock';
import {
  CAUSE_NAMES, CAUSE_COUNT, Creatures, FISH, GRAZER, HADROSAUR, RAPTOR, SPECIES, STATE, STATE_NAMES, TYRANT,
} from '../src/sim/creatures';
import { Simulation } from '../src/sim/simulation';
import { generateWorld } from '../src/world/generator';
import { T } from '../src/world/terrain';

const g = globalThis as unknown as { process: { argv: string[] } };
const seeds = (g.process.argv[2] ?? '4,11,21').split(',').map(Number);
const years = Number(g.process.argv[3] ?? 4);

function place(sim: Simulation, seed: number, want: number, n: number, fn: (x: number, y: number, k: number) => void): void {
  const w = sim.world;
  const r = new Rng(seed);
  for (let a = 0, k = 0; a < 20000 && k < n; a++) {
    const x = r.next() * w.width;
    const y = r.next() * w.height;
    if (w.terrainAt(Math.floor(x), Math.floor(y)) !== want) continue;
    fn(x, y, k++);
  }
}

for (const seed of seeds) {
  const sim = new Simulation(generateWorld(512, 320, seed));
  place(sim, seed, T.GRASS, 15, (x, y, k) => {
    sim.spawnInCircle(GRAZER, x, y, 3, 8);
    if (k % 3 === 0) sim.spawnInCircle(RAPTOR, x, y, 3, 2);
  });
  place(sim, seed + 1, T.FOREST, 8, (x, y, k) => {
    sim.spawnInCircle(HADROSAUR, x, y, 3, 4);
    if (k % 4 === 0) sim.spawnInCircle(TYRANT, x, y, 3, 2);
  });
  place(sim, seed + 2, T.SHALLOW_WATER, 8, (x, y) => sim.spawnInCircle(FISH, x, y, 3, 6));
  const c = sim.creatures;
  const stateTicks = new Float64Array(SPECIES.length * STATE_NAMES.length);
  let samples = 0;
  const anchor = new Map<number, { x: number; y: number; t: number }>();
  const stuck = new Map<string, number>();
  let illegal = 0;
  const total = TICKS_PER_YEAR * years;
  for (let t = 0; t < total; t++) {
    sim.step();
    if (t % 50 !== 0) continue;
    samples++;
    for (let i = 0; i < c.count; i++) {
      stateTicks[c.species[i] * STATE_NAMES.length + c.state[i]]++;
      if (!Creatures.canEnter(sim.world, c.species[i], Math.floor(c.x[i]), Math.floor(c.y[i]))) illegal++;
      const a = anchor.get(c.id[i]);
      if (!a || Math.hypot(c.x[i] - a.x, c.y[i] - a.y) > 1.5) {
        anchor.set(c.id[i], { x: c.x[i], y: c.y[i], t });
      } else if (t - a.t >= 500 && c.state[i] !== STATE.EAT && c.state[i] !== STATE.DRINK) {
        const key = `${SPECIES[c.species[i]].key}/${STATE_NAMES[c.state[i]]}`;
        stuck.set(key, (stuck.get(key) ?? 0) + 1);
        a.t = t; // count once per 500 ticks
      }
    }
  }
  const lines: string[] = [];
  lines.push(`seed ${seed}, ${years} years: ${c.count} alive, births ${c.births}, deaths ${c.deaths}, illegal-terrain samples ${illegal}`);
  for (const sp of SPECIES) {
    const causes: string[] = [];
    for (let k = 1; k < CAUSE_COUNT; k++) {
      const n = c.deathsBy(sp.id, k);
      if (n) causes.push(`${CAUSE_NAMES[k]} ${n}`);
    }
    const st: string[] = [];
    let sum = 0;
    for (let k = 0; k < STATE_NAMES.length; k++) sum += stateTicks[sp.id * STATE_NAMES.length + k];
    for (let k = 0; k < STATE_NAMES.length; k++) {
      const v = stateTicks[sp.id * STATE_NAMES.length + k];
      if (sum && v / sum >= 0.03) st.push(`${STATE_NAMES[k]} ${Math.round((100 * v) / sum)}%`);
    }
    lines.push(`  ${sp.name.padEnd(9)} alive ${String(c.countSpecies(sp.id)).padStart(4)} | deaths: ${causes.join(', ') || 'none'} | states: ${st.join(', ')}`);
  }
  lines.push(`  barely-moving ≥500 ticks (samples): ${[...stuck].map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
  console.log(lines.join('\n'));
}
