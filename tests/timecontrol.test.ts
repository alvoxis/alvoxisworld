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
