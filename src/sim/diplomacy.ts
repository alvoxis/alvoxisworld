/**
 * Simple WorldBox-style diplomacy: kingdoms form opinions, go to war or ally.
 */
import type { Kingdom } from './kingdoms';
import type { Settlements } from './settlements';

export type Relation = 'peace' | 'war' | 'alliance';

export interface Diplomacy {
  a: number;
  b: number;
  relation: Relation;
  opinion: number; // -100..100
  since: number;
}

const relations = new Map<string, Diplomacy>();

function key(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export function getRelation(a: number, b: number): Diplomacy | undefined {
  return relations.get(key(a, b));
}

export function updateDiplomacy(kingdoms: Kingdom[], settlements: Settlements, tick: number): void {
  if (tick % 120 !== 0 || kingdoms.length < 2) return;

  for (let i = 0; i < kingdoms.length; i++) {
    for (let j = i + 1; j < kingdoms.length; j++) {
      const A = kingdoms[i];
      const B = kingdoms[j];
      const k = key(A.id, B.id);
      let d = relations.get(k) ?? { a: A.id, b: B.id, relation: 'peace' as Relation, opinion: 0, since: tick };

      // Same race = friendlier, different race = more hostile
      const sameRace = A.species === B.species;
      d.opinion += sameRace ? 2 : -3;
      d.opinion = Math.max(-100, Math.min(100, d.opinion));

      // Distance between capitals
      const capA = settlements.get(A.capital);
      const capB = settlements.get(B.capital);
      if (capA && capB) {
        const dist = Math.hypot(capA.x - capB.x, capA.y - capB.y);
        if (dist < 30) d.opinion -= 4; // close = more friction
      }

      // Decide relation
      if (d.opinion > 40 && d.relation !== 'alliance') {
        d.relation = 'alliance';
        d.since = tick;
      } else if (d.opinion < -50 && d.relation !== 'war') {
        d.relation = 'war';
        d.since = tick;
      } else if (d.opinion > -20 && d.relation === 'war') {
        d.relation = 'peace';
        d.since = tick;
      }

      relations.set(k, d);
    }
  }
}

export function getAllRelations(): Diplomacy[] {
  return [...relations.values()];
}
