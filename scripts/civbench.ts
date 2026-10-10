// Cost of human settlements: simulation time per tick with and without 12 developing settlements (Node, medians of 3).
import { generateWorld } from '../src/world/generator';
import { Simulation } from '../src/sim/simulation';
import { HUMAN } from '../src/sim/creatures';

function once(settlements: boolean, groups = true): { msPerTick: number; stepMs: number; pop: number; buildings: number } {
  const sim = new Simulation(generateWorld(512, 320, 77));
  sim.weather.config.auto = false;
  if (!groups) sim.groups.step = () => {}; // measure without groups and autonomous founding
  let founded = 0;
  const w = sim.world;
  for (let q = 0; q < 20000 && founded < 12; q++) {
    const x = 20 + ((q * 37) % (w.width - 40));
    const y = 20 + ((q * 53) % (w.height - 40));
    if (w.terrain[y * w.width + x] !== 3) continue;
    sim.spawnInCircle(HUMAN, x, y, 4, 12);
    if (settlements && typeof sim.foundSettlement(x, y, 'human') === 'object') founded++;
    else if (!settlements) founded++;
  }
  for (let t = 0; t < 600; t++) sim.step(); // warm up (navigation snapshots etc.)
  const step = sim.settlements.step.bind(sim.settlements);
  let stepNs = 0;
  sim.settlements.step = (...a: Parameters<typeof step>) => {
    const t0 = performance.now();
    step(...a);
    stepNs += (performance.now() - t0) * 1e6;
  };
  const t0 = performance.now();
  const N = 2400;
  for (let t = 0; t < N; t++) sim.step();
  const total = performance.now() - t0;
  return {
    msPerTick: total / N, stepMs: stepNs / 1e6 / N, pop: sim.settlements.list.reduce((n, s) => n + s.members.length, 0),
    buildings: sim.settlements.list.reduce((n, s) => n + (s.civ?.buildings.length ?? 0), 0),
  };
}
const med = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
for (const [on, groups] of [[false, false], [false, true], [true, true]] as const) {
  const runs = [once(on, groups), once(on, groups), once(on, groups)];
  console.log(`${on ? 'with 12 settlements   ' : groups ? 'people + groups (auto)' : 'people only           '}: ${med(runs.map((r) => r.msPerTick)).toFixed(3)} ms/tick, settlement step ${med(runs.map((r) => r.stepMs)).toFixed(4)} ms/tick, members ${runs[1].pop}, buildings ${runs[1].buildings}`);
}
