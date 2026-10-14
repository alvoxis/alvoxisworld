import { describe, expect, it } from 'vitest';
import { genomeFromSeed } from '../src/render/creature/assemble';

describe('render path integration', () => {
  it('genomeFromSeed is pure and deterministic', () => {
    const g1 = genomeFromSeed(123);
    const g2 = genomeFromSeed(123);
    expect(g1).toEqual(g2);
  });

  it('tileset imports modular path', async () => {
    const mod = await import('../src/render/tileset');
    expect(typeof mod.creatureSprite).toBe('function');
  });
});
