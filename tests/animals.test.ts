import { describe, expect, it } from 'vitest';
import { ANIMAL_KEYS } from '../src/render/creature/animals';

describe('animal sprites', () => {
  it('covers all animal species', () => {
    const expected = ['bear', 'deer', 'rabbit', 'wolf', 'fish', 'shark', 'whale', 'orca', 'grazer', 'raptor', 'hadrosaur', 'tyrant'];
    for (const key of expected) {
      expect(ANIMAL_KEYS).toContain(key);
    }
  });

  it('animals are distinct from humanoid races', () => {
    const humanoids = ['human', 'elf', 'dwarf', 'gnome', 'demigod', 'orc', 'merfolk'];
    for (const key of ANIMAL_KEYS) {
      expect(humanoids).not.toContain(key);
    }
  });
});
