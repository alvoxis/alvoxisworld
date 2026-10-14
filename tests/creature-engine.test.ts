import { describe, expect, it } from 'vitest';
import { getRaceVisual, RACE_VISUALS } from '../src/render/creature/races';

describe('creature engine', () => {
  it('every sentient race has a visual config', () => {
    const races = ['human', 'elf', 'dwarf', 'orc', 'gnome', 'demigod', 'merfolk'];
    for (const r of races) {
      const v = getRaceVisual(r);
      expect(v).toBeDefined();
      expect(v.palette.length).toBeGreaterThan(0);
      expect(v.bodyWidth).toBeGreaterThan(0);
    }
  });

  it('race visuals map to known architectures', () => {
    for (const [, v] of Object.entries(RACE_VISUALS)) {
      expect(['human', 'elven', 'dwarf', 'gnome', 'demigod', 'orc', 'merfolk']).toContain(v.architecture);
    }
  });

  it('unknown race falls back to human', () => {
    expect(getRaceVisual('unknown').architecture).toBe('human');
  });
});
