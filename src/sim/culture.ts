/**
 * Simple culture and religion tracking + rebellions.
 */
import type { Settlement } from './settlements';
import type { Civ } from './civ';
import { getUnrest } from './unrest';

export interface Culture {
  id: number;
  name: string;
  religion: string;
  level: number;
}

const cultures = new Map<number, Culture>();

export function updateCulture(s: Settlement, c: Civ, tick: number): void {
  if (!cultures.has(s.id)) {
    cultures.set(s.id, { id: s.id, name: 'Culture ' + s.id, religion: c.advanced.includes('religion') ? 'Faith' : 'None', level: 1 });
  }
  const cult = cultures.get(s.id)!;
  if (c.advanced.includes('writing')) cult.level = Math.min(5, cult.level + 0.01);
  if (c.advanced.includes('religion')) cult.religion = 'Faith';

  // Rebellion chance based on unrest
  const u = getUnrest(s.id);
  if (u && u.level > 60 && tick % 300 === 0 && s.members.length > 10) {
    // Simple rebellion: drop a few members
    const drop = Math.min(3, s.members.length - 5);
    s.members.splice(0, drop);
    u.level = 30;
  }
}

export function getCulture(id: number): Culture | undefined {
  return cultures.get(id);
}
