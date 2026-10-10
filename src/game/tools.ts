import { FISH, GRAZER, HADROSAUR, RAPTOR, SPECIES, TYRANT } from '../sim/creatures';
import { Simulation } from '../sim/simulation';
import { applyHeightBrush, applyPaintBrush, applySmoothBrush } from '../world/brush';
import { T, TERRAIN } from '../world/terrain';

export type ToolCategory = 'view' | 'terrain' | 'biomes' | 'life';

export const CATEGORIES: ReadonlyArray<{ id: ToolCategory; label: string }> = [
  { id: 'view', label: 'View' },
  { id: 'terrain', label: 'Terrain' },
  { id: 'biomes', label: 'Biomes' },
  { id: 'life', label: 'Life' },
];

export type ToolIcon = { emoji: string } | { terrain: number } | { species: number };

export interface ToolContext {
  sim: Simulation;
  inspect(x: number, y: number): void;
}

export interface Tool {
  id: string;
  label: string;
  category: ToolCategory;
  icon: ToolIcon;
  /** Whether the brush-size control applies. */
  usesBrush: boolean;
  /**
   * Milliseconds between repeated applications while held still.
   * 0 = apply only on press and while moving; Infinity = once per press.
   */
  repeatMs: number;
  apply(ctx: ToolContext, x: number, y: number, radius: number): void;
}

const paintTool = (id: number): Tool => ({
  id: `paint_${TERRAIN[id].key}`,
  label: TERRAIN[id].name,
  category: 'biomes',
  icon: { terrain: id },
  usesBrush: true,
  repeatMs: 0,
  apply: ({ sim }, x, y, r) => applyPaintBrush(sim.world, { x, y, radius: r }, id),
});

const spawnTool = (species: number, perDab: number): Tool => ({
  id: `spawn_${SPECIES[species].key}`,
  label: SPECIES[species].name,
  category: 'life',
  icon: { species },
  usesBrush: true,
  repeatMs: 180,
  apply: ({ sim }, x, y, r) => {
    sim.spawnInCircle(species, x, y, Math.max(1, r), perDab);
  },
});

export const TOOLS: readonly Tool[] = [
  {
    id: 'move', label: 'Move', category: 'view', icon: { emoji: '✋' }, usesBrush: false, repeatMs: Infinity,
    apply: () => {},
  },
  {
    id: 'inspect', label: 'Inspect', category: 'view', icon: { emoji: '🔍' }, usesBrush: false, repeatMs: Infinity,
    apply: (ctx, x, y) => ctx.inspect(x, y),
  },
  {
    id: 'raise', label: 'Raise', category: 'terrain', icon: { emoji: '⛰️' }, usesBrush: true, repeatMs: 50,
    apply: ({ sim }, x, y, r) => applyHeightBrush(sim.world, { x, y, radius: r }, 1),
  },
  {
    id: 'lower', label: 'Lower', category: 'terrain', icon: { emoji: '🕳️' }, usesBrush: true, repeatMs: 50,
    apply: ({ sim }, x, y, r) => applyHeightBrush(sim.world, { x, y, radius: r }, -1),
  },
  {
    id: 'smooth', label: 'Smooth', category: 'terrain', icon: { emoji: '〰️' }, usesBrush: true, repeatMs: 60,
    apply: ({ sim }, x, y, r) => applySmoothBrush(sim.world, { x, y, radius: r }),
  },
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
  {
    // Same action as Inspect, placed with the life tools: tap a creature to select it.
    id: 'select', label: 'Select', category: 'life', icon: { emoji: '👆' }, usesBrush: false, repeatMs: Infinity,
    apply: (ctx, x, y) => ctx.inspect(x, y),
  },
  spawnTool(GRAZER, 3),
  spawnTool(HADROSAUR, 2),
  spawnTool(FISH, 3),
  spawnTool(RAPTOR, 1),
  spawnTool(TYRANT, 1),
  {
    id: 'smite', label: 'Remove life', category: 'life', icon: { emoji: '⚡' }, usesBrush: true, repeatMs: 0,
    apply: ({ sim }, x, y, r) => {
      sim.creatures.removeInCircle(x, y, Math.max(1, r));
    },
  },
];

export const BRUSH_SIZES = [1, 2, 4, 7, 11, 16] as const;

export function toolById(id: string): Tool {
  const t = TOOLS.find((t) => t.id === id);
  if (!t) throw new Error(`Unknown tool ${id}`);
  return t;
}
