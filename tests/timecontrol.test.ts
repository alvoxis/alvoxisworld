import { describe, expect, it } from 'vitest';
import { TimeControl } from '../src/game/timecontrol';
import { TICKS_PER_SECOND } from '../src/sim/clock';
import { SPEED_LEVELS, Simulation } from '../src/sim/simulation';
import { World } from '../src/world/world';

describe('time controls (‹ ⏸ ›)', () => {
  it('steps through every speed level and disables arrows at the limits', () => {
    const t = new TimeControl();
    expect(t.speed).toBe(1);
    expect(t.canSlower).toBe(false);
    expect(t.slower()).toBe(false);
    const seen = [t.speed];
    while (t.faster()) seen.push(t.speed);
    expect(seen).toEqual([...SPEED_LEVELS]);
    expect(t.canFaster).toBe(false);
    while (t.slower());
    expect(t.speed).toBe(SPEED_LEVELS[0]);
  });

  it('pause keeps the chosen level; › resumes; set(0) pauses', () => {
    const t = new TimeControl();
    t.faster();
    t.faster();
    const level = t.speed;
    t.togglePause();
    expect(t.speed).toBe(0);
    expect(t.multiplier).toBe(level);
    expect(t.canFaster).toBe(true);
    t.faster(); // resumes at the same level
    expect(t.speed).toBe(level);
    t.set(0);
    expect(t.paused).toBe(true);
    t.set(9);
    expect(t.speed).toBe(10);
  });

  it('changes real simulation timing', () => {
    const sim = new Simulation(new World(32, 32, 1));
    const t = new TimeControl();
    for (const level of SPEED_LEVELS) {
      t.set(level);
      sim.speed = t.speed;
      expect(sim.advance(0.1)).toBe(Math.min(40, Math.round(0.1 * TICKS_PER_SECOND * level)));
    }
    t.togglePause();
    sim.speed = t.speed;
    expect(sim.advance(1)).toBe(0);
  });
});

describe('frame time budget', () => {
  it('runs fewer ticks per frame when ticks are expensive, keeps backlog small, and reports the real speed', () => {
    const sim = new Simulation(new World(16, 16, 1));
    sim.speed = 20;
    const busy = () => {
      const t = performance.now();
      while (performance.now() - t < 4) {
        /* a deliberately slow tick */
      }
    };
    sim.step = () => {
      busy();
      sim.tick++;
    };
    let max = 0;
    for (let f = 0; f < 6; f++) {
      const ran = sim.advance(0.25); // 50 ticks requested per frame
      max = Math.max(max, ran);
      expect(ran).toBeGreaterThanOrEqual(1);
    }
    expect(max).toBeLessThanOrEqual(5); // ≈12 ms of 4 ms ticks, plus the one that crosses the budget
    expect(sim.throttled).toBe(true);
    expect(sim.achievedSpeed).toBeGreaterThan(0);
    expect(sim.achievedSpeed).toBeLessThan(20 * 0.85);
    // Paused: nothing runs and the measurement resets.
    sim.speed = 0;
    expect(sim.advance(1)).toBe(0);
    expect(sim.throttled).toBe(false);
  });

  it('is not throttled when ticks are cheap', () => {
    const sim = new Simulation(new World(16, 16, 1));
    sim.speed = 10;
    for (let f = 0; f < 12; f++) sim.advance(0.1);
    expect(sim.throttled).toBe(false);
    expect(sim.achievedSpeed).toBeGreaterThan(8);
  });
});
