import { describe, expect, it } from 'vitest';
import { getRaceVisual } from '../src/render/creature/races';

const RACES = ['human', 'elf', 'dwarf', 'gnome', 'demigod', 'orc', 'merfolk'];

describe('race visual configs', () => {
  it('all races have distinct body proportions', () => {
    const configs = RACES.map((r) => getRaceVisual(r));
    const widths = configs.map((c) => c.bodyWidth);
    const heights = configs.map((c) => c.bodyHeight);
    expect(new Set(widths).size).toBeGreaterThan(3);
    expect(new Set(heights).size).toBeGreaterThan(3);
  });

  it('elf and orc have ears, dwarf has beard, orc has tusks', () => {
    expect(getRaceVisual('elf').hasEars).toBe(true);
    expect(getRaceVisual('orc').hasEars).toBe(true);
    expect(getRaceVisual('dwarf').hasBeard).toBe(true);
    expect(getRaceVisual('orc').hasTusks).toBe(true);
  });

  it('each race has a unique palette', () => {
    const palettes = RACES.map((r) => getRaceVisual(r).palette[0]);
    expect(new Set(palettes).size).toBe(RACES.length);
  });
});
