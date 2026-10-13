import { t, td, tn } from '../i18n';
import { BEAR, DEER, DEMIGOD, DWARF, ELF, FISH, GNOME, GRAZER, HADROSAUR, HUMAN, MERFOLK, ORC, ORCA, RABBIT, RAPTOR, SHARK, SPECIES, TYRANT, WHALE, WOLF } from '../sim/creatures';
import { EFFECTS } from '../sim/effects';
import { Simulation } from '../sim/simulation';
import { WEATHER_KIND } from '../sim/weather';
import { applyDeepenBrush, applyHeightBrush, BRUSH_STRENGTH, applyPaintBrush, applySmoothBrush } from '../world/brush';
import { T, TERRAIN } from '../world/terrain';

/**
 * Tool tabs. 'view' tools (Move, Inspect) are not a tab: they are always-visible
 * quick buttons so the camera and inspection stay reachable from every tab.
 */
export type ToolCategory = 'view' | 'creatures' | 'biomes' | 'terrain' | 'powers' | 'effects';

export const CATEGORIES: ReadonlyArray<{ id: Exclude<ToolCategory, 'view'>; label: string; short: string }> = [
  { id: 'creatures', label: 'Creatures', short: 'Life' },
  { id: 'biomes', label: 'Biomes', short: 'Biomes' },
  { id: 'terrain', label: 'Terrain', short: 'Terrain' },
  { id: 'powers', label: 'God Powers', short: 'Powers' },
  { id: 'effects', label: 'Buffs & Debuffs', short: 'Effects' },
];

/** One circle drawn around the pointer to preview where a tool acts. */
export interface AreaRing {
  /** Radius in tiles. */
  radius: number;
  /** 'main' is where the tool acts directly; 'outer' is a wider zone of consequence (a blast, a weather area). */
  kind: 'main' | 'outer';
}

export type ToolIcon = { emoji: string } | { terrain: number } | { species: number };

export interface ToolContext {
  sim: Simulation;
  inspect(x: number, y: number): void;
  /** Power level 1..3 chosen in the toolbar. */
  intensity: number;
  /** Effect duration in ticks chosen in the toolbar. */
  durationTicks: number;
  /** Number of meteors chosen for a meteor shower. */
  count: number;
  /** Shows a short visual effect (impact flash, quake ripple). */
  effect(kind: 'meteor' | 'quake', x: number, y: number, radius: number): void;
  /** Shows a short message to the player. */
  notify(text: string): void;
}

/**
 * Kinds of life in the Creatures tab (0.23): two sections (land, sea) with groups of species, so the list stays short
 * on a phone. Every species is in exactly one group; groups only exist when they have species (no empty promises).
 */
export interface LifeGroup {
  id: string;
  section: 'land' | 'sea';
  icon: string;
  species: readonly number[];
}
export const LIFE_GROUPS: readonly LifeGroup[] = [
  { id: 'peoples', section: 'land', icon: '👥', species: [HUMAN, ELF, DWARF, GNOME, DEMIGOD, ORC, MERFOLK] },
  { id: 'herbivores', section: 'land', icon: '🦌', species: [GRAZER, DEER] },
  { id: 'small', section: 'land', icon: '🐇', species: [RABBIT] },
  { id: 'predators', section: 'land', icon: '🐺', species: [WOLF, BEAR] },
  { id: 'dinosaurs', section: 'land', icon: '🦖', species: [HADROSAUR, RAPTOR, TYRANT] },
  { id: 'fish', section: 'sea', icon: '🐟', species: [FISH] },
  { id: 'sea_predators', section: 'sea', icon: '🦈', species: [SHARK, ORCA] },
  { id: 'sea_mammals', section: 'sea', icon: '🐋', species: [WHALE] },
];

/** The group a species is listed in. */
export function lifeGroupOf(species: number): LifeGroup {
  return LIFE_GROUPS.find((g) => g.species.includes(species))!;
}

export interface Tool {
  id: string;
  label: string;
  category: ToolCategory;
  /** Creatures tab: the kind of life it belongs to (LIFE_GROUPS id); tools without one are always shown. */
  group?: string;
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
  /** Uses the meteor count setting. */
  usesCount?: boolean;
  /**
   * The circles to preview for the chosen size and power, in tiles. Defaults to one main
   * ring of the chosen radius. Must describe what apply() really does with its radius.
   */
  area?(radius: number, power: number): AreaRing[];
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
  const perDab = sp.diet === 'carnivore' ? 1 : sp.sentient || sp.size > 1.2 ? 2 : 3;
  return {
    id: `spawn_${sp.key}`,
    label: sp.name,
    category: 'creatures',
    group: lifeGroupOf(species).id,
    icon: { species },
    hint: `${sp.diet === 'carnivore' ? 'Predator' : 'Herbivore'} · ${sp.move === 2 ? 'lives in water' : 'lives on land'}`,
    usesBrush: true,
    repeatMs: 180,
    area: (r) => [{ radius: Math.max(1, r), kind: 'main' }],
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
    area: (r) => [{ radius: Math.max(0.6, r - 0.5), kind: 'main' }],
    apply: (ctx, x, y, r) => {
      const n = ctx.sim.applyEffect(e, x, y, r - 0.5, ctx.durationTicks, ctx.intensity);
      ctx.notify(n ? tn('toast.effect_on', n, { name: td(`effect.${def.key}`) }) : t('toast.no_creature'));
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
    area: (r) => [{ radius: Math.max(1, r), kind: 'main' }],
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

  // Terrain: sculpt the real heights (passability, slopes and water follow). Power sets the strength per stroke.
  {
    id: 'raise', label: 'Raise', category: 'terrain', icon: { emoji: '⛰️' }, usesBrush: true, usesIntensity: true, repeatMs: 50, undoable: true,
    hint: 'Raises land (keeps rivers and lakes above sea level)',
    apply: ({ sim, intensity }, x, y, r) => applyHeightBrush(sim.world, { x, y, radius: r, strength: BRUSH_STRENGTH[intensity - 1] ?? 6 }, 1),
  },
  {
    id: 'lower', label: 'Lower', category: 'terrain', icon: { emoji: '🕳️' }, usesBrush: true, usesIntensity: true, repeatMs: 50, undoable: true,
    hint: 'Lowers land; below sea level it becomes sea',
    apply: ({ sim, intensity }, x, y, r) => applyHeightBrush(sim.world, { x, y, radius: r, strength: BRUSH_STRENGTH[intensity - 1] ?? 6 }, -1),
  },
  {
    id: 'deepen', label: 'Deepen water', category: 'terrain', icon: { emoji: '🌀' }, usesBrush: true, usesIntensity: true, repeatMs: 50, undoable: true,
    hint: 'Makes water deeper; land is not touched',
    apply: ({ sim, intensity }, x, y, r) => applyDeepenBrush(sim.world, { x, y, radius: r, strength: BRUSH_STRENGTH[intensity - 1] ?? 6 }),
  },
  {
    id: 'smooth', label: 'Smooth', category: 'terrain', icon: { emoji: '〰️' }, usesBrush: true, repeatMs: 60, undoable: true,
    hint: 'Evens out heights',
    apply: ({ sim }, x, y, r) => applySmoothBrush(sim.world, { x, y, radius: r }),
  },
  // God powers: water.
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
    repeatMs: Infinity, hint: 'Rain cloud: wetter, cooler, refills water, greens bare soil, puts out fire',
    area: (r) => [{ radius: Math.max(6, r * 4), kind: 'main' }],
    apply: ({ sim, intensity }, x, y, r) => sim.summonWeather(WEATHER_KIND.RAIN, x, y, Math.max(6, r * 4), intensity),
  },
  {
    id: 'storm', label: 'Storm', category: 'powers', icon: { emoji: '⛈️' }, usesBrush: true, usesIntensity: true,
    repeatMs: Infinity, hint: 'Thunderstorm: heavy rain with lightning that can kill and start fires',
    area: (r) => [{ radius: Math.max(6, r * 3), kind: 'main' }],
    apply: ({ sim, intensity }, x, y, r) =>
      sim.summonWeather(WEATHER_KIND.RAIN, x, y, Math.max(6, r * 3), Math.max(2, intensity), { storm: true }),
  },
  {
    id: 'snow', label: 'Snow', category: 'powers', icon: { emoji: '❄️' }, usesBrush: true, usesIntensity: true,
    repeatMs: Infinity, hint: 'Snowfall: colder and wetter; settles on tundra until spring; puts out fire',
    area: (r) => [{ radius: Math.max(6, r * 4), kind: 'main' }],
    apply: ({ sim, intensity }, x, y, r) => sim.summonWeather(WEATHER_KIND.RAIN, x, y, Math.max(6, r * 4), intensity, { snow: true }),
  },
  {
    id: 'drought', label: 'Drought', category: 'powers', icon: { emoji: '☀️' }, usesBrush: true, usesIntensity: true,
    repeatMs: Infinity, hint: 'Drought: drier, hotter, dries water and plants, fires spread faster',
    area: (r) => [{ radius: Math.max(6, r * 4), kind: 'main' }],
    apply: ({ sim, intensity }, x, y, r) => sim.summonWeather(WEATHER_KIND.DROUGHT, x, y, Math.max(6, r * 4), intensity),
  },
  {
    id: 'lightning', label: 'Lightning', category: 'powers', icon: { emoji: '🌩️' }, usesBrush: false, repeatMs: 350,
    hint: 'A lightning bolt: hurts creatures at the spot and may ignite dry vegetation',
    apply: ({ sim }, x, y) => {
      sim.lightning(x, y);
    },
  },
  {
    id: 'fire', label: 'Fire', category: 'powers', icon: { emoji: '🔥' }, usesBrush: true, repeatMs: 120,
    hint: 'Sets dry vegetation alight; spreads by fuel, dryness, wind and slope',
    area: (r) => [{ radius: Math.max(1, r * 0.5), kind: 'main' }],
    apply: ({ sim }, x, y, r) => {
      sim.igniteArea(x, y, Math.max(1, r * 0.5));
    },
  },
  {
    id: 'extinguish', label: 'Extinguish', category: 'powers', icon: { emoji: '🧯' }, usesBrush: true, repeatMs: 0,
    hint: 'Puts out fires under the brush',
    area: (r) => [{ radius: Math.max(1, r), kind: 'main' }],
    apply: ({ sim }, x, y, r) => {
      sim.extinguish(x, y, Math.max(1, r));
    },
  },
  {
    id: 'meteor', label: 'Meteor', category: 'powers', icon: { emoji: '☄️' }, usesBrush: true, usesIntensity: true,
    repeatMs: Infinity,
    hint: 'A meteor falls: the circle sets its size (crater), Power its energy. The dashed ring is the blast zone',
    area: (r, power) => {
      const crater = Math.max(2, r) * (0.7 + 0.3 * power);
      return [{ radius: crater, kind: 'main' }, { radius: crater * 2.2, kind: 'outer' }];
    },
    apply: (ctx, x, y, r) => {
      if (!ctx.sim.launchMeteor(x, y, Math.max(2, r), ctx.intensity)) ctx.notify(t('toast.too_many_meteors'));
    },
  },
  {
    id: 'shower', label: 'Meteor shower', category: 'powers', icon: { emoji: '🌠' }, usesBrush: true, usesIntensity: true,
    usesCount: true, repeatMs: Infinity,
    hint: 'Meteor shower: the circle is the area, Count sets how many, Power how big (cannot be undone)',
    area: (r) => [{ radius: Math.max(3, r), kind: 'main' }],
    apply: (ctx, x, y, r) => {
      const n = ctx.sim.launchShower(x, y, Math.max(3, r), ctx.count, ctx.intensity);
      ctx.notify(n ? tn('toast.shower', n) : t('toast.too_many_meteors'));
    },
  },
  {
    id: 'quake', label: 'Earthquake', category: 'powers', icon: { emoji: '🌋' }, usesBrush: true, usesIntensity: true,
    repeatMs: Infinity, undoable: true, hint: 'Rift and buckled ground; injures creatures',
    area: (r, power) => [{ radius: Math.max(3, r * 1.5) * (0.8 + 0.4 * power), kind: 'main' }],
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
      ctx.notify(n ? tn('toast.cleansed', n) : t('toast.no_creature'));
    },
  },
];

/**
 * The area sizes offered by the round size buttons, from very small to very large:
 * one shared radius (in tiles) for every tool that uses an area. What a tool does with it
 * (a brush, a weather area, a crater) is described by its `area` function.
 */
export const BRUSH_SIZES = [1, 2, 4, 7, 11, 16, 24] as const;
export const SIZE_NAMES = ['Very small', 'Small', 'Medium-small', 'Medium', 'Medium-large', 'Large', 'Very large'] as const;

/** The circles to preview for a tool at a chosen size and power (empty if the tool has no area). */
export function areaOf(tool: Tool, radius: number, power: number): AreaRing[] {
  if (!tool.usesBrush) return [];
  return tool.area ? tool.area(radius, power) : [{ radius, kind: 'main' }];
}

export function toolById(id: string): Tool {
  const t = TOOLS.find((t) => t.id === id);
  if (!t) throw new Error(`Unknown tool ${id}`);
  return t;
}
