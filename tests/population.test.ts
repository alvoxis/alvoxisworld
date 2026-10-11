import { describe, expect, it } from 'vitest';
import { ELF, HUMAN, SPECIES } from '../src/sim/creatures';
import type { Settlement } from '../src/sim/settlements';
import { Simulation } from '../src/sim/simulation';
import { TICKS_PER_YEAR } from '../src/sim/clock';
import { SEA_LEVEL, T } from '../src/world/terrain';
import { World } from '../src/world/world';

function land(seed: number): World {
  const w = new World(160, 120, seed);
  w.heights.fill(SEA_LEVEL + 20);
  w.temperature.fill(140);
  w.moisture.fill(120);
  w.baseTemperature.fill(140);
  w.baseMoisture.fill(120);
  w.terrain.fill(T.GRASS);
  const block = (x0: number, y0: number, x1: number, y1: number, t: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) w.terrain[y * w.width + x] = t;
  };
  block(36, 30, 42, 33, T.LAKE);
  block(116, 30, 122, 33, T.LAKE);
  block(60, 60, 100, 80, T.FOREST);
  return w;
}

/** One human and one elven settlement that run themselves; returns the simulation and both settlements. */
function world(seed: number): { sim: Simulation; s: Settlement[] } {
  const sim = new Simulation(land(seed));
  sim.weather.config.auto = false;
  sim.settlements.auto = true;
  const s: Settlement[] = [];
  for (const [sp, x, y] of [[HUMAN, 40, 40], [ELF, 120, 40]] as const) {
    sim.spawnInCircle(sp, x, y, 3, 12);
    const st = sim.foundSettlement(x, y, 'human') as Settlement;
    expect(typeof st).toBe('object');
    s.push(st);
  }
  return { sim, s };
}

describe('population growth (0.23: about three times slower)', () => {
  it('only the breeding cycle of humans and elves is slowed, by three, once (animals unchanged)', () => {
    expect(SPECIES[HUMAN].breedCooldown).toBe(3 * 500);
    expect(SPECIES[ELF].breedCooldown).toBe(3 * 650);
    // The chance per tick stays as it was: slowing both would make growth about nine times slower.
    expect(SPECIES[HUMAN].breedChance).toBe(0.02);
    expect(SPECIES[ELF].breedChance).toBe(0.015);
    // A ready adult waits about cooldown + 1 / chance ticks between births: about three times as long as before.
    for (const [sp, before] of [[HUMAN, 500], [ELF, 650]] as const) {
      const d = SPECIES[sp];
      const ratio = (d.breedCooldown + 1 / d.breedChance) / (before + 1 / d.breedChance);
      expect(ratio).toBeGreaterThan(2.6);
      expect(ratio).toBeLessThan(3.1);
    }
  });

  it('over ten years settlements of both peoples live on and grow slowly; nobody dies out', { timeout: 120000 }, () => {
    for (const seed of [3, 9]) {
      const { sim, s } = world(seed);
      const start = s.map((st) => st.members.length);
      const born = [HUMAN, ELF].map((sp) => sim.creatures.birthStats[sp]);
      for (let t = 0; t < 10 * TICKS_PER_YEAR; t++) sim.step();
      for (let k = 0; k < 2; k++) {
        expect(sim.settlements.list).toContain(s[k]); // not abandoned or dissolved
        expect(s[k].members.length).toBeGreaterThanOrEqual(start[k]); // at least holds its own
      }
      // Births: a handful per year per settlement, not dozens (before 0.23 about three times as many).
      const births = [HUMAN, ELF].map((sp, k) => sim.creatures.birthStats[sp] - born[k]);
      for (const b of births) {
        expect(b).toBeGreaterThan(5);
        expect(b / 10).toBeLessThan(8);
      }
      // Children are a real part of the population, not a flood.
      let kids = 0;
      let all = 0;
      for (let i = 0; i < sim.creatures.count; i++) {
        const sp = sim.creatures.species[i];
        if ((sp === HUMAN || sp === ELF) && sim.creatures.isAlive(i)) {
          all++;
          if (sim.creatures.stage(i) === 'Juvenile') kids++;
        }
      }
      expect(kids / all).toBeGreaterThan(0.05);
      expect(kids / all).toBeLessThan(0.4);
    }
  });
});
