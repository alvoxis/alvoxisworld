import { describe, expect, it } from 'vitest';
import { genomeFromSeed } from '../src/render/creature/assemble';

describe('individual appearance', () => {
  it('same ID always produces same genome', () => {
    const id = 12345;
    const a = genomeFromSeed(id);
    const b = genomeFromSeed(id);
    expect(a).toEqual(b);
  });

  it('different IDs can produce different genomes', () => {
    const a = genomeFromSeed(100);
    const b = genomeFromSeed(200);
    const different = a.paletteIndex !== b.paletteIndex || a.bodyScale !== b.bodyScale;
    expect(different).toBe(true);
  });

  it('genome is stable across many calls', () => {
    const id = 999;
    const first = genomeFromSeed(id);
    for (let i = 0; i < 10; i++) {
      expect(genomeFromSeed(id)).toEqual(first);
    }
  });
});
