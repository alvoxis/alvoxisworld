import { describe, expect, it } from 'vitest';
import { creatureScale, MIN_PERSON_PX } from '../src/render/creatureart';

describe('minimum screen size', () => {
  it('MIN_PERSON_PX is at least 14', () => {
    expect(MIN_PERSON_PX).toBeGreaterThanOrEqual(14);
  });

  it('at zoom 4 creatures are at least 14 CSS px', () => {
    const dpr = 2;
    const s = 4 * dpr;
    const artW = 70;
    const scale = creatureScale(s, artW, true, false, dpr);
    const cssPx = (artW * scale) / dpr;
    expect(cssPx).toBeGreaterThanOrEqual(13);
  });
});
