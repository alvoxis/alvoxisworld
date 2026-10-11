/**
 * Roads (0.23). A settlement lays roads step by step from its centre (the cleared plaza around the main building) to
 * the door of each building: the tile in front of it. A road follows passable, dry, gentle land inside the territory,
 * never over water, trees or the body of a building, and joins the network that is already there, so roads branch
 * instead of running side by side. A few tiles are added per step, so a network grows over time.
 *
 * Roads are settlement data (Civ.roads, saved), marked as built ground (World.built, ROAD_BIT): trees do not grow on
 * them, and people walk a little faster on them (Creatures, ROAD_SPEED). Planning is a small A* search inside the
 * territory, for one building per step at most, only every ROAD_STEPS steps.
 */
import { isWater } from '../world/terrain';
import { treesOn } from '../world/trees';
import type { World } from '../world/world';
import { CENTRE_FREE, type Civ } from './civ';
import { SPECIES } from './creatures';
import { landClass, passable } from './pathfinding';
import type { Settlement } from './settlements';

/** World.built bit of a road tile (other built ground is bit 1). */
export const ROAD_BIT = 2;
/** People walk this much faster on a road. */
export const ROAD_SPEED = 1.2;
/** Road tiles laid per settlement step. */
export const ROAD_TILES_PER_STEP = 2;
/** Roads are planned every this many settlement steps. */
export const ROAD_STEPS = 2;
/** Most road tiles a settlement has. */
export const MAX_ROADS = 600;

/** The door tile of a building: the tile in front of it (below on the map). */
export function doorOf(b: { x: number; y: number }): [number, number] {
  return [b.x, b.y + 1];
}

/** Whether (x, y) is on the settlement's plaza (the free centre around the main building). */
export function onPlaza(s: { x: number; y: number }, x: number, y: number): boolean {
  return Math.max(Math.abs(x - s.x), Math.abs(y - s.y)) <= CENTRE_FREE;
}

/** Tiles no road may cross: each building and the ground its larger drawing stands on (beside and behind it). */
export function blockedByBuildings(c: Civ, W: number): Set<number> {
  const out = new Set<number>();
  for (const b of c.buildings) for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 1; dx++) out.add((b.y + dy) * W + b.x + dx);
  return out;
}

/** Whether a road may run over tile (x, y) of this settlement. */
function roadable(world: World, s: Settlement, owner: Uint16Array, blocked: Set<number>, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return false;
  const i = y * world.width + x;
  if (owner[i] !== s.id || blocked.has(i) || isWater(world.terrain[i]) || world.slopeClass[i] !== 0) return false;
  if (treesOn(world, x, y) > 0 || world.fire[i] > 0) return false;
  return passable(world, landClass(SPECIES[s.species].move), x, y);
}

/** Whether a building's door is linked to the plaza (by a road, or by standing on its edge). */
export function connected(s: Settlement, roads: ReadonlySet<number>, W: number, b: { x: number; y: number }): boolean {
  const [dx, dy] = doorOf(b);
  if (onPlaza(s, dx, dy)) return true;
  return roads.has(dy * W + dx) && reachesPlaza(s, roads, W, dy * W + dx);
}

/** Whether a road tile is joined to the plaza through other road tiles. */
function reachesPlaza(s: Settlement, roads: ReadonlySet<number>, W: number, from: number): boolean {
  const seen = new Set<number>([from]);
  const stack = [from];
  while (stack.length) {
    const t = stack.pop()!;
    const x = t % W;
    const y = (t - x) / W;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (onPlaza(s, nx, ny)) return true;
      const n = ny * W + nx;
      if (roads.has(n) && !seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return false;
}

/**
 * The road a building still needs: the shortest route (A*, 4-way) from its door to the plaza or to a road already
 * joined to it, as tiles from the network outward (tiles already on a road excluded). Null if there is no way (water,
 * trees in between: tried again later, when the trees may be gone).
 */
export function planRoad(world: World, s: Settlement, owner: Uint16Array, b: { x: number; y: number }): number[] | null {
  const c = s.civ!;
  const W = world.width;
  const roads = new Set(c.roads);
  const blocked = blockedByBuildings(c, W);
  const [sx, sy] = doorOf(b);
  const start = sy * W + sx;
  blocked.delete(start); // a door may lie behind a neighbour's drawing: the road may still start there
  if (!roadable(world, s, owner, blocked, sx, sy) && !onPlaza(s, sx, sy)) return null;
  // A*: cost 1 per tile, existing road 0.3 (join the network), heuristic: distance to the plaza edge.
  const g = new Map<number, number>([[start, 0]]);
  const from = new Map<number, number>();
  const open: Array<[number, number]> = [[Math.max(0, Math.max(Math.abs(sx - s.x), Math.abs(sy - s.y)) - CENTRE_FREE), start]];
  const closed = new Set<number>();
  let goal = -1;
  let budget = 4000;
  while (open.length && budget-- > 0) {
    let k = 0;
    for (let n = 1; n < open.length; n++) if (open[n][0] < open[k][0] || (open[n][0] === open[k][0] && open[n][1] < open[k][1])) k = n;
    const [, t] = open.splice(k, 1)[0];
    if (closed.has(t)) continue;
    closed.add(t);
    const x = t % W;
    const y = (t - x) / W;
    if (onPlaza(s, x, y) || (t !== start && roads.has(t) && reachesPlaza(s, roads, W, t))) {
      goal = t;
      break;
    }
    for (const [nx, ny] of [[x, y - 1], [x - 1, y], [x + 1, y], [x, y + 1]]) {
      if (!onPlaza(s, nx, ny) && !roadable(world, s, owner, blocked, nx, ny)) continue;
      const n = ny * W + nx;
      const cost = (g.get(t) ?? 0) + (roads.has(n) ? 0.3 : 1);
      if (cost >= (g.get(n) ?? Infinity)) continue;
      g.set(n, cost);
      from.set(n, t);
      const h = Math.max(0, Math.max(Math.abs(nx - s.x), Math.abs(ny - s.y)) - CENTRE_FREE);
      open.push([cost + h, n]);
    }
  }
  if (goal < 0) return null;
  // From the network outward: walk back from the goal to the door, keeping tiles that are not road or plaza yet.
  const path: number[] = [];
  for (let t: number | undefined = goal; t !== undefined; t = from.get(t)) {
    const x = t % W;
    const y = (t - x) / W;
    if (!onPlaza(s, x, y) && !roads.has(t)) path.push(t);
  }
  return path;
}

/**
 * One step of road building: every ROAD_STEPS steps, the first building (oldest first) whose door is not yet linked
 * gets up to ROAD_TILES_PER_STEP new road tiles toward it. Unfinished buildings get their road too (builders walk
 * there). Returns whether roads changed.
 */
export function buildRoads(world: World, s: Settlement, owner: Uint16Array, step: number): boolean {
  const c = s.civ;
  if (!c || step % ROAD_STEPS !== 0 || c.roads.length >= MAX_ROADS) return false;
  const W = world.width;
  // Roads that can no longer be roads (a building on them, flooded, burnt land) are dropped.
  const blocked = blockedByBuildings(c, W);
  for (const b of c.buildings) blocked.delete((b.y + 1) * W + b.x); // doors stay open
  const before = c.roads.length;
  c.roads = c.roads.filter((t) => owner[t] === s.id && !blocked.has(t) && !isWater(world.terrain[t]));
  let changed = c.roads.length !== before;
  const roads = new Set(c.roads);
  let tries = 0;
  for (const b of [...c.buildings].sort((a, b) => a.id - b.id)) {
    if (connected(s, roads, W, b)) continue;
    if (++tries > 2) break; // a bounded amount of planning per step
    const path = planRoad(world, s, owner, b);
    if (!path || !path.length) continue;
    for (const t of path.slice(0, ROAD_TILES_PER_STEP)) {
      c.roads.push(t);
      roads.add(t);
    }
    changed = true;
    break; // one building per step: roads grow gradually
  }
  return changed;
}
