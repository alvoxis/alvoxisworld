/**
 * Simple unrest and revolution system.
 * Settlements can become unhappy (no libraries, bad government, etc.) and stage a coup.
 */
import type { Settlement } from './settlements';
import type { Civ } from './civ';

export interface Unrest {
  level: number; // 0-100
  lastEvent: string;
}

const unrest = new Map<number, Unrest>();

export function updateUnrest(s: Settlement, c: Civ, tick: number): void {
  let u = unrest.get(s.id) ?? { level: 10, lastEvent: '' };
  // Rise if no temple/library-like building and large population
  const hasTemple = c.buildings.some(b => b.done && (b.type === 'temple' || b.type === 'storehouse'));
  const pop = s.members.length;
  if (!hasTemple && pop > 20) u.level += 0.4;
  if (c.stage === 'town' && !c.advanced.includes('religion')) u.level += 0.2;
  // Decay
  u.level = Math.max(0, u.level - 0.1);
  // Coup
  if (u.level > 70 && tick % 200 === 0) {
    u.lastEvent = 'Переворот! Народ сверг старое правительство.';
    u.level = 20;
    // Simple effect: clear some advanced techs or reset stage slightly
    if (c.advanced.length > 2) c.advanced.pop();
  }
  unrest.set(s.id, u);
}

export function getUnrest(id: number): Unrest | undefined {
  return unrest.get(id);
}
