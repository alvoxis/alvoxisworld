/**
 * Simple warfare: barracks produce soldiers, kingdoms at war lose population.
 */
import type { Kingdom } from './kingdoms';
import type { Settlements } from './settlements';
import { getAllRelations } from './diplomacy';

export function updateWarfare(kingdoms: Kingdom[], settlements: Settlements, tick: number): void {
  if (tick % 200 !== 0) return;
  const wars = getAllRelations().filter(r => r.relation === 'war');
  for (const w of wars) {
    const A = kingdoms.find(k => k.id === w.a);
    const B = kingdoms.find(k => k.id === w.b);
    if (!A || !B) continue;
    // Both sides lose a few people from their capital if they have barracks
    for (const k of [A, B]) {
      const cap = settlements.get(k.capital);
      if (!cap?.civ) continue;
      const hasBarracks = cap.civ.buildings.some(b => b.done && b.type === 'barracks');
      if (hasBarracks && cap.members.length > 5) {
        // Simulate losses
        const loss = Math.min(2, cap.members.length - 4);
        cap.members.splice(0, loss);
      }
    }
  }
}
