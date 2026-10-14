import { describe, expect, it } from 'vitest';
import { genomeFromSeed } from '../src/render/creature/assemble';

describe('creature assembly', () => {
  it('genomeFromSeed is deterministic', () => {
    const a = genomeFromSeed(42);
    const b = genomeFromSeed(42);
    expect(a.paletteIndex).toBe(b.paletteIndex);
    expect(a.bodyScale).toBe(b.bodyScale);
    expect(a.headScale).toBe(b.headScale);
  });

  it('different seeds produce different genomes', () => {
    const a = genomeFromSeed(1);
    const b = genomeFromSeed(2);
    expect(a.paletteIndex !== b.paletteIndex || a.bodyScale !== b.bodyScale).toBe(true);
  });

  it('genome values are in valid ranges', () => {
    for (let i = 0; i < 20; i++) {
      const g = genomeFromSeed(i * 100);
      expect(g.paletteIndex).toBeGreaterThanOrEqual(0);
      expect(g.paletteIndex).toBeLessThan(3);
      expect(g.bodyScale).toBeGreaterThan(0.6);
      expect(g.bodyScale).toBeLessThan(1.3);
      expect(g.headScale).toBeGreaterThan(0.8);
      expect(g.headScale).toBeLessThan(1.2);
    }
  });
});
