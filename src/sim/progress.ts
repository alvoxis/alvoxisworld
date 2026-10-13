/**
 * AI-driven civilization progress: eras, tech tree, weapons, architecture, transport and political levels.
 *
 * Races learn and invent according to their needs, resources, personality and current era.
 * Everything is data-driven and deterministic (no Math.random).
 *
 * Integrates with the existing Civ system (knowledge, research, stages, buildings).
 */

export type Era = 'stone' | 'bronze' | 'iron' | 'medieval' | 'industrial' | 'modern' | 'future';
export const ERAS: readonly Era[] = ['stone', 'bronze', 'iron', 'medieval', 'industrial', 'modern', 'future'];

export type TechCategory = 'tools' | 'weapons' | 'architecture' | 'transport' | 'knowledge' | 'society' | 'production';

export interface TechDef {
  id: string;
  era: Era;
  category: TechCategory;
  /** Knowledge cost. */
  knowledge: number;
  /** Steps to research. */
  steps: number;
  /** Prerequisite tech ids. */
  requires: readonly string[];
  /** Description key for i18n. */
  desc: string;
  /** Bonus or unlock tag (used by simulation). */
  unlock?: string;
}

export const TECH_TREE: readonly TechDef[] = [
  // Stone Age
  { id: 'stone_tools', era: 'stone', category: 'tools', knowledge: 20, steps: 8, requires: [], desc: 'tech.stone_tools', unlock: 'better_forage' },
  { id: 'fire_control', era: 'stone', category: 'tools', knowledge: 15, steps: 6, requires: [], desc: 'tech.fire_control' },
  { id: 'stone_weapons', era: 'stone', category: 'weapons', knowledge: 25, steps: 10, requires: ['stone_tools'], desc: 'tech.stone_weapons', unlock: 'attack+2' },
  { id: 'cave_homes', era: 'stone', category: 'architecture', knowledge: 18, steps: 7, requires: [], desc: 'tech.cave_homes' },

  // Bronze
  { id: 'bronze_working', era: 'bronze', category: 'tools', knowledge: 40, steps: 12, requires: ['stone_tools'], desc: 'tech.bronze_working' },
  { id: 'bronze_weapons', era: 'bronze', category: 'weapons', knowledge: 45, steps: 14, requires: ['bronze_working', 'stone_weapons'], desc: 'tech.bronze_weapons', unlock: 'attack+4' },
  { id: 'writing', era: 'bronze', category: 'knowledge', knowledge: 35, steps: 12, requires: [], desc: 'tech.writing' },
  { id: 'wheel', era: 'bronze', category: 'transport', knowledge: 30, steps: 10, requires: [], desc: 'tech.wheel', unlock: 'cart' },

  // Iron
  { id: 'iron_working', era: 'iron', category: 'tools', knowledge: 60, steps: 16, requires: ['bronze_working'], desc: 'tech.iron_working' },
  { id: 'iron_weapons', era: 'iron', category: 'weapons', knowledge: 70, steps: 18, requires: ['iron_working', 'bronze_weapons'], desc: 'tech.iron_weapons', unlock: 'attack+6' },
  { id: 'horse_riding', era: 'iron', category: 'transport', knowledge: 50, steps: 14, requires: ['wheel'], desc: 'tech.horse_riding', unlock: 'horse' },
  { id: 'masonry', era: 'iron', category: 'architecture', knowledge: 55, steps: 15, requires: ['cave_homes'], desc: 'tech.masonry' },

  // Medieval
  { id: 'steel', era: 'medieval', category: 'weapons', knowledge: 90, steps: 20, requires: ['iron_weapons'], desc: 'tech.steel', unlock: 'attack+8' },
  { id: 'castles', era: 'medieval', category: 'architecture', knowledge: 80, steps: 18, requires: ['masonry'], desc: 'tech.castles' },
  { id: 'religion', era: 'medieval', category: 'knowledge', knowledge: 70, steps: 16, requires: ['writing'], desc: 'tech.religion', unlock: 'bible' },
  { id: 'sailing', era: 'medieval', category: 'transport', knowledge: 65, steps: 15, requires: ['wheel'], desc: 'tech.sailing', unlock: 'ship' },

  // Industrial
  { id: 'steam', era: 'industrial', category: 'production', knowledge: 120, steps: 24, requires: ['iron_working'], desc: 'tech.steam' },
  { id: 'railways', era: 'industrial', category: 'transport', knowledge: 110, steps: 22, requires: ['steam', 'horse_riding'], desc: 'tech.railways', unlock: 'train' },
  { id: 'firearms', era: 'industrial', category: 'weapons', knowledge: 130, steps: 26, requires: ['steel'], desc: 'tech.firearms', unlock: 'attack+12' },
  { id: 'factories', era: 'industrial', category: 'production', knowledge: 100, steps: 20, requires: ['steam'], desc: 'tech.factories' },

  // Modern
  { id: 'electricity', era: 'modern', category: 'production', knowledge: 150, steps: 28, requires: ['steam'], desc: 'tech.electricity' },
  { id: 'automobiles', era: 'modern', category: 'transport', knowledge: 140, steps: 26, requires: ['railways'], desc: 'tech.automobiles', unlock: 'car' },
  { id: 'aircraft', era: 'modern', category: 'transport', knowledge: 160, steps: 30, requires: ['automobiles'], desc: 'tech.aircraft', unlock: 'plane' },
  { id: 'modern_housing', era: 'modern', category: 'architecture', knowledge: 120, steps: 22, requires: ['castles'], desc: 'tech.modern_housing' },
  { id: 'computers', era: 'modern', category: 'knowledge', knowledge: 170, steps: 32, requires: ['electricity'], desc: 'tech.computers' },

  // Future
  { id: 'spaceflight', era: 'future', category: 'transport', knowledge: 200, steps: 40, requires: ['aircraft'], desc: 'tech.spaceflight', unlock: 'shuttle' },
  { id: 'ai_research', era: 'future', category: 'knowledge', knowledge: 180, steps: 36, requires: ['computers'], desc: 'tech.ai_research' },
  { id: 'advanced_weapons', era: 'future', category: 'weapons', knowledge: 190, steps: 38, requires: ['firearms'], desc: 'tech.advanced_weapons', unlock: 'attack+20' },
];

export const TECH_BY_ID = Object.fromEntries(TECH_TREE.map(t => [t.id, t]));

/** Political levels beyond the basic settlement stages. */
export type PoliticalLevel = 'settlement' | 'village' | 'town' | 'kingdom' | 'empire' | 'nation';
export const POLITICAL_LEVELS: readonly PoliticalLevel[] = ['settlement', 'village', 'town', 'kingdom', 'empire', 'nation'];

/** Transport tiers unlocked by tech. */
export type Transport = 'none' | 'cart' | 'horse' | 'ship' | 'train' | 'car' | 'plane' | 'shuttle';

/** Architecture styles that evolve with tech. */
export type ArchStyle = 'cave' | 'hut' | 'house' | 'castle' | 'modern' | 'futuristic';

/**
 * Simple AI that chooses the next technology for a civilization.
 * Considers: current era, knowledge, unmet needs (food, defense, housing), race traits.
 */
export function chooseNextTech(
  known: readonly string[],
  knowledge: number,
  needs: { food?: boolean; defense?: boolean; housing?: boolean; transport?: boolean },
  raceBias: Partial<Record<TechCategory, number>> = {},
): string | null {
  const candidates = TECH_TREE.filter(t =>
    !known.includes(t.id) &&
    t.requires.every(r => known.includes(r)) &&
    t.knowledge <= knowledge
  );
  if (candidates.length === 0) return null;

  // Score by category bias + need
  const scored = candidates.map(t => {
    let score = raceBias[t.category] ?? 1;
    if (needs.defense && t.category === 'weapons') score += 3;
    if (needs.food && t.category === 'production') score += 2;
    if (needs.housing && t.category === 'architecture') score += 2;
    if (needs.transport && t.category === 'transport') score += 2;
    // Prefer earlier eras slightly
    score += (ERAS.indexOf(t.era) * -0.1);
    return { id: t.id, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].id;
}

/** Race biases for research preferences. */
export const RACE_BIAS: Record<string, Partial<Record<TechCategory, number>>> = {
  human: { tools: 1.2, society: 1.1 },
  elf: { knowledge: 1.4, architecture: 1.2 },
  dwarf: { tools: 1.5, architecture: 1.3, production: 1.2 },
  gnome: { knowledge: 1.6, tools: 1.3 },
  demigod: { knowledge: 1.5, society: 1.4 },
  orc: { weapons: 1.8, society: 0.8 },
  merfolk: { transport: 1.4, production: 1.2 },
};
