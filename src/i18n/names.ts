/**
 * Display text for game data. Species, terrain, tools and effects keep their English
 * ids and fields (saves and rules use those); the screen shows these translations.
 */
import { TOOLS, type Tool } from '../game/tools';
import { EFFECTS } from '../sim/effects';
import { SPECIES } from '../sim/creatures';
import { TERRAIN } from '../world/terrain';
import { WORLD_SIZES } from '../world/generator';
import { td, t, tn, type Key } from './index';

export const speciesName = (id: number, plural = false): string => td(`species.${SPECIES[id].key}${plural ? '.plural' : ''}`);
export const terrainName = (id: number): string => td(`terrain.${TERRAIN[id].key}`);
export const effectName = (id: number): string => td(`effect.${EFFECTS[id].key}`);
export const effectDesc = (id: number): string => td(`effect.${EFFECTS[id].key}.desc`);
export const stateName = (englishState: string, names: readonly string[]): string => {
  const i = names.indexOf(englishState);
  return i < 0 ? englishState : td(`state.${i}`);
};
export const causeName = (englishCause: string, names: readonly string[]): string => {
  const i = names.indexOf(englishCause);
  return i < 0 ? englishCause : td(`cause.${i}`);
};
export const seasonName = (index: number): string => td(`season.${index}`);
export const stageName = (stage: string): string => td(`stage.${stage}`);

/** Label and hint of a tool in the current language. */
export function toolLabel(tool: Tool): string {
  if (tool.id.startsWith('paint_')) return td(`terrain.${tool.id.slice(6)}`);
  if (tool.id.startsWith('spawn_')) return td(`species.${tool.id.slice(6)}`);
  if (tool.id.startsWith('effect_')) return td(`effect.${tool.id.slice(7)}`);
  return td(`tool.${tool.id}`);
}

export function toolHint(tool: Tool): string {
  if (tool.id.startsWith('paint_')) return '';
  if (tool.id.startsWith('spawn_')) {
    const sp = SPECIES.find((s) => s.key === tool.id.slice(6))!;
    return t('hint.spawn', { diet: td(sp.sentient ? 'diet.sentient' : `diet.${sp.diet}`), habitat: td(`habitat.${sp.habitat}`) });
  }
  if (tool.id.startsWith('effect_')) {
    const def = EFFECTS.find((e) => e.key === tool.id.slice(7))!;
    return t('hint.effect', { kind: td(`kind.${def.kind}`), description: effectDesc(def.id) });
  }
  return td(`tool.${tool.id}.hint`);
}

/** Undo/redo labels are stored as the (English) tool label; show them in the current language. */
export function undoLabel(label: string): string {
  const tool = TOOLS.find((x) => x.label === label);
  return tool ? toolLabel(tool) : label;
}

export const worldSizeLabel = (key: string, width: number, height: number): string =>
  `${td(`world.${key}`)} (${width}×${height})`;
export const worldSizeKeys = WORLD_SIZES.map((s) => s.key);

// ---- messages the simulation stores with a code --------------------------------

export interface CodedMessage {
  tick?: number;
  text: string;
  code?: string;
  p?: Record<string, string | number>;
}

/** History line in the current language. Entries without a code (old saves) show their stored English text. */
export function messageText(m: CodedMessage): string {
  if (!m.code) return m.text;
  const p = m.p ?? {};
  const species = typeof p.species === 'number' ? speciesName(p.species, true) : '';
  const size = String(p.size ?? '');
  switch (m.code) {
    case 'lightning':
      return tn('msg.lightning', Number(p.n));
    case 'meteor':
      return Number(p.killed) > 0
        ? td(`msg.meteor_kills.${size}`, { killed: p.killed })
        : td(`msg.meteor.${size}`);
    default: {
      const extra: Record<string, string> = {};
      if (species) extra.species = species;
      if (typeof p.type === 'string') extra.type = td(`build.${p.type}`);
      if (typeof p.tech === 'string') extra.tech = td(`tech.${p.tech}`);
      if (typeof p.level === 'number') extra.level = td(`house.level.${p.level}`).toLowerCase();
      if (typeof p.stage === 'string') extra.stage = td(`civstage.${p.stage}`).toLowerCase();
      return td(`msg.${m.code}`, { ...(p as Record<string, string | number>), ...extra });
    }
  }
}

// ---- errors ----------------------------------------------------------------------

const ERROR_KEYS: ReadonlyArray<[RegExp, Key]> = [
  [/no IndexedDB/i, 'err.no_indexeddb'],
  [/Could not open save database/i, 'err.db_open'],
  [/Save database error/i, 'err.db'],
  [/Save cancelled/i, 'err.db_full'],
  [/too large/i, 'err.too_large'],
  [/^The file is empty/i, 'err.empty'],
  [/not valid JSON/i, 'err.not_json'],
  [/not an ALVOXIS save file/i, 'err.not_save'],
  [/newer version|is newer than this game/i, 'err.newer'],
  [/cannot open compressed/i, 'err.no_gzip'],
  [/Unsupported save version/i, 'err.unsupported_version'],
  [/invalid map size/i, 'err.bad_map'],
  [/damaged|Corrupt/i, 'err.damaged'],
];

/** Translates the known save and storage error messages; anything else is shown inside a generic sentence. */
export function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  for (const [re, key] of ERROR_KEYS) if (re.test(msg)) return t(key);
  return t('err.generic', { detail: msg });
}

/** Translates checkWorldSize() problems. */
export function worldSizeProblem(problem: string): string {
  if (/whole numbers/.test(problem)) return t('world.err_whole');
  const range = /(\d+)–(\d+) tiles/.exec(problem);
  if (range) return t('world.err_range', { min: range[1], max: range[2] });
  const step = /multiple of (\d+)/.exec(problem);
  if (step) return t('world.err_step', { step: step[1] });
  const total = /At most (\d+)M/.exec(problem);
  if (total) return t('world.err_total', { n: total[1] });
  return problem;
}
