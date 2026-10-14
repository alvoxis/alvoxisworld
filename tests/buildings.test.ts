import { describe, expect, it } from 'vitest';
import { HOUSE_STYLES } from '../src/render/architecture';
import type { Architecture } from '../src/sim/creatures';

const RACES: Architecture[] = ['human', 'elven', 'dwarf', 'gnome', 'demigod', 'orc', 'merfolk'];

describe('building styles', () => {
  it('all races have a house style', () => {
    for (const race of RACES) {
      expect(HOUSE_STYLES[race]).toBeDefined();
      expect(typeof HOUSE_STYLES[race].draw).toBe('function');
    }
  });

  it('each race has 5 color dots (levels 0-4)', () => {
    for (const race of RACES) {
      expect(HOUSE_STYLES[race].dots.length).toBe(5);
    }
  });

  it('draw function accepts level and roof', () => {
    const calls: string[] = [];
    const mockRect = (_x: number, _y: number, _w: number, _h: number, c: string) => {
      calls.push(c);
    };
    HOUSE_STYLES.human.draw(mockRect, 2, '#ff0000');
    expect(calls.length).toBeGreaterThan(0);
  });
});
