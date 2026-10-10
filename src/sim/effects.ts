/**
 * Buffs and debuffs on individual creatures. Each effect has a real behaviour
 * implemented in Creatures (speed, health, needs or breeding), a duration in
 * ticks and a strength 1..3. Rules:
 *  - applying an effect refreshes it (longest remaining duration wins, new strength);
 *  - applying an effect removes its opposite (Haste ↔ Slowness, …);
 *  - effects expire on their own or are removed by Cleanse / the creature panel.
 * Add an effect by adding an entry here and its behaviour in Creatures.
 */
export interface EffectDef {
  id: number;
  key: string;
  name: string;
  kind: 'buff' | 'debuff';
  icon: string;
  /** What it does, shown in the UI. */
  description: string;
  /** Effect removed when this one is applied (-1 = none). */
  opposite: number;
}

export const EFFECT = {
  HASTE: 0,
  SLOW: 1,
  REGEN: 2,
  POISON: 3,
  FED: 4,
  FAMINE: 5,
  FERTILE: 6,
  STERILE: 7,
} as const;

export const EFFECTS: readonly EffectDef[] = [
  { id: 0, key: 'haste', name: 'Haste', kind: 'buff', icon: '💨', description: 'Moves 25% faster per level', opposite: 1 },
  { id: 1, key: 'slow', name: 'Slowness', kind: 'debuff', icon: '🐌', description: 'Moves 20% slower per level', opposite: 0 },
  { id: 2, key: 'regen', name: 'Regeneration', kind: 'buff', icon: '💚', description: 'Heals 0.4% of max health per tick per level', opposite: 3 },
  { id: 3, key: 'poison', name: 'Poison', kind: 'debuff', icon: '☠️', description: 'Loses 0.2% of max health per tick per level; can kill', opposite: 2 },
  { id: 4, key: 'fed', name: 'Well fed', kind: 'buff', icon: '🍖', description: 'Hunger and thirst do not grow', opposite: 5 },
  { id: 5, key: 'famine', name: 'Famished', kind: 'debuff', icon: '🦴', description: 'Hunger and thirst grow 50% faster per level', opposite: 4 },
  { id: 6, key: 'fertile', name: 'Fertility', kind: 'buff', icon: '🥚', description: 'Breeds more often (shorter cooldown, higher chance)', opposite: 7 },
  { id: 7, key: 'sterile', name: 'Sterility', kind: 'debuff', icon: '🚫', description: 'Cannot breed', opposite: 6 },
];

export const EFFECT_COUNT = EFFECTS.length;

/** Duration presets in ticks (4 ticks = 1 day). */
export const EFFECT_DURATIONS = [
  { key: 'short', label: 'Short', ticks: 120 },
  { key: 'medium', label: 'Medium', ticks: 480 },
  { key: 'long', label: 'Long', ticks: 1440 },
] as const;
