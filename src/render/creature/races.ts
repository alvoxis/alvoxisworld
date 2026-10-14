/**
 * Race visual configurations: proportions, palettes and part selections.
 */
import type { Architecture } from '../../sim/creatures';

export interface RaceVisual {
  architecture: Architecture;
  headScale: number;
  bodyWidth: number;
  bodyHeight: number;
  hasEars: boolean;
  earLength: number;
  hasBeard: boolean;
  hasTusks: boolean;
  palette: readonly string[];
}

export const RACE_VISUALS: Readonly<Record<string, RaceVisual>> = {
  human: { architecture: 'human', headScale: 1.1, bodyWidth: 12, bodyHeight: 16, hasEars: false, earLength: 0, hasBeard: false, hasTusks: false, palette: ['#c9a078', '#d4b08a', '#b89068'] },
  elf: { architecture: 'elven', headScale: 0.9, bodyWidth: 8, bodyHeight: 20, hasEars: true, earLength: 14, hasBeard: false, hasTusks: false, palette: ['#e8d8c0', '#f0e0c8', '#d8c8b0'] },
  dwarf: { architecture: 'dwarf', headScale: 1.0, bodyWidth: 16, bodyHeight: 12, hasEars: false, earLength: 0, hasBeard: true, hasTusks: false, palette: ['#a08060', '#b09070', '#907050'] },
  orc: { architecture: 'orc', headScale: 1.2, bodyWidth: 18, bodyHeight: 16, hasEars: true, earLength: 6, hasBeard: false, hasTusks: true, palette: ['#5a8a3a', '#6a9a4a', '#4a7a2a'] },
  gnome: { architecture: 'gnome', headScale: 1.3, bodyWidth: 10, bodyHeight: 10, hasEars: false, earLength: 0, hasBeard: false, hasTusks: false, palette: ['#8aba70', '#9aca80', '#7aaa60'] },
  demigod: { architecture: 'demigod', headScale: 1.0, bodyWidth: 10, bodyHeight: 22, hasEars: false, earLength: 0, hasBeard: false, hasTusks: false, palette: ['#f0d080', '#ffe090', '#e0c070'] },
  merfolk: { architecture: 'merfolk', headScale: 1.0, bodyWidth: 10, bodyHeight: 14, hasEars: false, earLength: 0, hasBeard: false, hasTusks: false, palette: ['#5a9ab0', '#6aaac0', '#4a8aa0'] },
};

export function getRaceVisual(key: string): RaceVisual {
  return RACE_VISUALS[key] ?? RACE_VISUALS.human;
}
