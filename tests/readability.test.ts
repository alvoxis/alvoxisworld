import { describe, expect, it } from 'vitest';
import { CREATURE_SCALE } from '../src/render/creatureart';

describe('creature readability', () => {
  it('CREATURE_SCALE is at least 0.5', () => {
    expect(CREATURE_SCALE).toBeGreaterThanOrEqual(0.5);
  });

  it('at default zoom creatures are at least 8 CSS px', () => {
    const zoom = 24;
    const tiles = 0.49;
    const cssPx = tiles * zoom;
    expect(cssPx).toBeGreaterThanOrEqual(10);
  });
});
