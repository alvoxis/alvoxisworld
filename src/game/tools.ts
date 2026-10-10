import { SPECIES } from '../sim/creatures';
import { EFFECTS } from '../sim/effects';
import { Simulation } from '../sim/simulation';
import { WEATHER_KIND } from '../sim/weather';
import { applyHeightBrush, applyPaintBrush, applySmoothBrush } from '../world/brush';
import { T, TERRAIN } from '../world/terrain';

/**
 * Tool tabs. 'view' tools (Move, Inspect) are not a tab: they are always-visible
 * quick buttons so the camera and inspection stay reachable from every tab.
 */
export type ToolCategory = 'view' | 'creatures' | 'biomes' | 'powers' | 'effects';

export const CATEGORIES: ReadonlyArray<{ id: Exclude<ToolCategory, 'view'>; label: string; short: string }> = [
  { id: 'creatures', label: 'Creatures', short: 'Life' },
  { id: 'biomes', label: 'Biomes', short: 'Biomes' },
  { id: 'powers', label: 'God Powers', short: 'Powers' },
  { id: 'effects', label: 'Buffs & Debuffs', short: 'Effects' },
];

export type ToolIcon = { emoji: string } | { terrain: number } | { species: number };

export interface ToolContext {
  sim: Simulation;
  inspect(x: number, y: number): void;
  /** Power level 1..3 chosen in the toolbar. */
  intensity: number;
  /** Effect duration in ticks chosen in the toolbar. */
  durationTicks: number;
  /** Shows a short visual effect (impact flash, quake ripple). */
  effect(kind: 'meteor' | 'quake', x: number, y: number, radius: number): void;
  /** Shows a short message to the player. */
  notify(text: string): void;
}

export interface Tool {
  id: string;
  label: string;
  category: ToolCategory;
  icon: ToolIcon;
  /** One-line explanation shown when the tool is picked. */
  hint?: string;
  /** Whether the brush-size control applies. */
  usesBrush: boolean;
  /**
   * Milliseconds between repeated applications while held still.
   * 0 = apply only on press and while moving; Infinity = once per press.
   */
  repeatMs: number;
  /** Terrain changes made by this tool are recorded for Undo/Redo. */
  undoable?: boolean;
  /** Uses the power level (1..3). */
  usesIntensity?: boolean;
  /** Uses the effect duration setting. */
  usesDuration?: boolean;
  apply(ctx: ToolContext, x: number, y: number, radius: number): void;
}

const paintTool = (id: number): Tool => ({
  id: `paint_${TERRAIN[id].key}`,
  label: TERRAIN[id].name,
  category: 'biomes',
  icon: { terrain: id },
  usesBrush: true,
  repeatMs: 0,
  undoable: true,
  apply: ({ sim }, x, y, r) => applyPaintBrush(sim.world, { x, y, radius: r }, id),
});

const spawnTool = (species: number): Tool => {
  const sp = SPECIES[species];
  const perDab = sp.diet === 'carnivore' ? 1 : sp.size > 1.2 ? 2 : 3;
  return {
    id: `spawn_${sp.key}`,
    label: sp.name,
    category: 'creatures',
    icon: { species },
    hint: `${sp.diet === 'carnivore' ? 'Predator' : 'Herbivore'} · ${sp.move === 2 ? 'lives in water' : 'lives on land'}`,
    usesBrush: true,
    repeatMs: 180,
    apply: ({ sim }, x, y, r) => {
      sim.spawnInCircle(species, x, y, Math.max(1, r), perDab);
    },
  };
};

const effectTool = (e: number): Tool => {
  const def = EFFECTS[e];
  return {
    id: `effect_${def.key}`,
    label: def.name,
    category: 'effects',
    icon: { emoji: def.icon },
    hint: `${def.kind === 'buff' ? 'Buff' : 'Debuff'}: ${def.description}`,
    usesBrush: true,
    usesIntensity: true,
    usesDuration: true,
    repeatMs: Infinity,
    apply: (ctx, x, y, r) => {
      const n = ctx.sim.applyEffect(e, x, y, r - 0.5, ctx.durationTicks, ctx.intensity);
      ctx.notify(n ? `${def.name} on ${n} creature${n > 1 ? 's' : ''}` : 'No creature there');
    },
  };
};

export const TOOLS: readonly Tool[] = [
  // Quick view tools (always visible).
  {
    id: 'move', label: 'Move', category: 'view', icon: { emoji: '✋' }, usesBrush: false, repeatMs: Infinity,
    hint: 'Drag to move the map', apply: () => {},
  },
  {
    id: 'inspect', label: 'Inspect', category: 'view', icon: { emoji: '🔍' }, usesBrush: false, repeatMs: Infinity,
    hint: 'Tap a creature to select it, or land to inspect it', apply: (ctx, x, y) => ctx.inspect(x, y),
  },

  // Creatures.
  {
    id: 'select', label: 'Select', category: 'creatures', icon: { emoji: '👆' }, usesBrush: false, repeatMs: Infinity,
    hint: 'Tap a creature to select it', apply: (ctx, x, y) => ctx.inspect(x, y),
  },
  ...SPECIES.map((s) => spawnTool(s.id)),
  {
    id: 'smite', label: 'Remove life', category: 'creatures', icon: { emoji: '⚡' }, usesBrush: true, repeatMs: 0,
    hint: 'Removes creatures under the brush',
    apply: ({ sim }, x, y, r) => {
      sim.creatures.removeInCircle(x, y, Math.max(1, r));
    },
  },

  // Biomes.
  paintTool(T.DEEP_WATER),
  paintTool(T.SHALLOW_WATER),
  paintTool(T.LAKE),
  paintTool(T.RIVER),
  paintTool(T.SAND),
  paintTool(T.GRASS),
  paintTool(T.FOREST),
  paintTool(T.JUNGLE),
  paintTool(T.SAVANNA),
  paintTool(T.DESERT),
  paintTool(T.SWAMP),
  paintTool(T.TUNDRA),
  paintTool(T.SNOW),
  paintTool(T.HILLS),
  paintTool(T.MOUNTAIN),

  // God powers: terrain and water.
  {
    id: 'raise', label: 'Raise', category: 'powers', icon: { emoji: '⛰️' }, usesBrush: true, repeatMs: 50, undoable: true,
    hint: 'Raises land (keeps rivers and lakes above sea level)',
    apply: ({ sim }, x, y, r) => applyHeightBrush(sim.world, { x, y, radius: r }, 1),
  },
  {
    id: 'lower', label: 'Lower', category: 'powers', icon: { emoji: '🕳️' }, usesBrush: true, repeatMs: 50, undoable: true,
    hint: 'Lowers land; below sea level it becomes sea',
    apply: ({ sim }, x, y, r) => applyHeightBrush(sim.world, { x, y, radius: r }, -1),
  },
  {
    id: 'smooth', label: 'Smooth', category: 'powers', icon: { emoji: '〰️' }, usesBrush: true, repeatMs: 60, undoable: true,
    hint: 'Evens out heights',
    apply: ({ sim }, x, y, r) => applySmoothBrush(sim.world, { x, y, radius: r }),
  },
  {
    id: 'flood', label: 'Flood', category: 'powers', icon: { emoji: '🌊' }, usesBrush: true, repeatMs: 0, undoable: true,
    hint: 'Temporary flood water; drains back to the land beneath',
    apply: ({ sim }, x, y, r) => {
      sim.flood(x, y, r);
    },
  },
  {
    id: 'drain', label: 'Drain', category: 'powers', icon: { emoji: '🏜️' }, usesBrush: true, repeatMs: 0, undoable: true,
    hint: 'Dries floods, lakes and rivers (their beds refill with rain)',
    apply: ({ sim }, x, y, r) => {
      sim.drain(x, y, r);
    },
  },
  // God powers: weather and disasters.
  {
    id: 'rain', label: 'Rain', category: 'powers', icon: { emoji: '🌧️' }, usesBrush: true, usesIntensity: true,
    repeatMs: Infinity, hint: 'Rain system: wetter, cooler, refills water, puts out fire',
    apply: ({ sim, intensity }, x, y, r) => sim.summonWeather(WEATHER_KIND.RAIN, x, y, Math.max(6, r * 4), intensity),
  },
  {
    id: 'drought', label: 'Drought', category: 'powers', icon: { emoji: '☀️' }, usesBrush: true, usesIntensity: true,
    repeatMs: Infinity, hint: 'Drought: drier, hotter, dries water and plants',
    apply: ({ sim, intensity }, x, y, r) => sim.summonWeather(WEATHER_KIND.DROUGHT, x, y, Math.max(6, r * 4), intensity),
  },
  {
    id: 'fire', label: 'Fire', category: 'powers', icon: { emoji: '🔥' }, usesBrush: true, repeatMs: 120,
    hint: 'Sets dry vegetation alight; spreads by fuel and dryness',
    apply: ({ sim }, x, y, r) => {
      sim.igniteArea(x, y, Math.max(1, r * 0.5));
    },
  },
  {
    id: 'extinguish', label: 'Extinguish', category: 'powers', icon: { emoji: '🧯' }, usesBrush: true, repeatMs: 0,
    hint: 'Puts out fires under the brush',
    apply: ({ sim }, x, y, r) => {
      sim.extinguish(x, y, Math.max(1, r));
    },
  },
  {
    id: 'meteor', label: 'Meteor', category: 'powers', icon: { emoji: '☄️' }, usesBrush: true, usesIntensity: true,
    repeatMs: Infinity, undoable: true, hint: 'Crater, scorched ground, fires; kills creatures inside',
    apply: (ctx, x, y, r) => {
      ctx.sim.meteor(x, y, Math.max(2, r), ctx.intensity);
      ctx.effect('meteor', x, y, Math.max(2, r) * 2);
    },
  },
  {
    id: 'quake', label: 'Earthquake', category: 'powers', icon: { emoji: '🌋' }, usesBrush: true, usesIntensity: true,
    repeatMs: Infinity, undoable: true, hint: 'Rift and buckled ground; injures creatures',
    apply: (ctx, x, y, r) => {
      ctx.sim.earthquake(x, y, Math.max(3, r * 1.5), ctx.intensity);
      ctx.effect('quake', x, y, Math.max(3, r * 1.5) * 1.6);
    },
  },

  // Buffs & debuffs.
  ...EFFECTS.map((e) => effectTool(e.id)),
  {
    id: 'cleanse', label: 'Cleanse', category: 'effects', icon: { emoji: '✨' }, usesBrush: true, repeatMs: Infinity,
    hint: 'Removes all buffs and debuffs',
    apply: (ctx, x, y, r) => {
      const n = ctx.sim.cleanse(x, y, r - 0.5);
      ctx.notify(n ? `Cleansed ${n} creature${n > 1 ? 's' : ''}` : 'No creature there');
    },
  },
];

export const BRUSH_SIZES = [1, 2, 4, 7, 11, 16, 24] as const;

export function toolById(id: string): Tool {
  const t = TOOLS.find((t) => t.id === id);
  if (!t) throw new Error(`Unknown tool ${id}`);
  return t;
}
