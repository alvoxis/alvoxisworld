/**
 * Where could a people settle? One scoring function used both by the groups that look for a home
 * (groups.ts) and by autonomous founding, so what a group is looking for is exactly what a
 * settlement needs. It reads the real world: terrain, water, fire, predators, existing territories.
 * What a species likes comes from its CivProfile (creatures.ts), so another people only needs data.
 */
import { T, isWater } from '../world/terrain';
import type { World } from '../world/world';
import { PREDATORS_OF, SPECIES, type Creatures } from './creatures';
import { passable } from './pathfinding';
import type { Settlements } from './settlements';

/** Closest allowed distance between the centres of a new home and any settlement. */
export const MIN_GAP = 16;
/** Share of the land around the spot that the species can eat, at least. */
export const MIN_FOOD = 0.2;
/** Free (unclaimed) walkable land needed around the spot. */
export const MIN_SPACE = 60;
export const SITE_RADIUS = 7;
export const WATER_REACH = 9;
export const DANGER_REACH = 10;
export const PREDATOR_REACH = 14;
/** A site this good is worth settling. */
export const SETTLE_SCORE = 0.5;

export type SiteFail = 'ground' | 'claimed' | 'gap' | 'water' | 'danger' | 'food' | 'space';

export interface SiteReport {
  ok: boolean;
  /** 0..~1.1, higher is better; 0 when a hard condition fails. */
  score: number;
  fail?: SiteFail;
  /** How many people the surroundings can feed, as a rough guide for splitting a group. */
  capacity: number;
}

export function assessSite(world: World, creatures: Creatures, settlements: Settlements, tx: number, ty: number, species: number): SiteReport {
  const sp = SPECIES[species];
  const prof = sp.civ;
  const bad = (fail: SiteFail): SiteReport => ({ ok: false, score: 0, fail, capacity: 0 });
  if (!prof || !world.inBounds(tx, ty)) return bad('ground');
  const W = world.width;
  const here = world.terrain[ty * W + tx];
  if (isWater(here) || prof.avoid.includes(here) || !passable(world, sp.move, tx, ty)) return bad('ground');
  if (settlements.ownerAt(tx, ty)) return bad('claimed');
  for (const s of settlements.list) if (Math.hypot(s.x - tx, s.y - ty) < Math.max(MIN_GAP, prof.gap)) return bad('gap');

  const R = Math.max(SITE_RADIUS, WATER_REACH, DANGER_REACH);
  let land = 0;
  let edible = 0;
  let free = 0;
  let like = 0;
  let water = 0;
  let sea = 0;
  let fire = 0;
  let trees = 0;
  let rock = 0;
  let edible8 = 0;
  for (let y = Math.max(0, ty - R); y <= Math.min(world.height - 1, ty + R); y++) {
    for (let x = Math.max(0, tx - R); x <= Math.min(W - 1, tx + R); x++) {
      const d = Math.hypot(x - tx, y - ty);
      if (d > R) continue;
      const i = y * W + x;
      const t = world.terrain[i];
      if ((t === T.SHALLOW_WATER || t === T.DEEP_WATER) && d <= WATER_REACH) sea++; // open sea: a coast for harbours later
      if (d <= SITE_RADIUS) {
        if (isWater(t)) {
          if (d <= WATER_REACH) water++;
          continue;
        }
        land++;
        if (sp.food.includes(t)) edible++;
        like += prof.affinity[t] ?? 0;
        if (!settlements.owner || !settlements.owner[i]) free++;
      } else if (isWater(t) && d <= WATER_REACH) water++;
      if (d <= 8 && !isWater(t) && sp.food.includes(t)) edible8++;
      if (world.fire[i] > 0 && d <= DANGER_REACH) fire++;
      if (!isWater(t) && d <= 10) {
        if (t === T.FOREST || t === T.JUNGLE) trees++;
        else if (t === T.HILLS || t === T.MOUNTAIN) rock++;
      }
    }
  }
  if (prof.needsWater && water === 0) return bad('water');
  if (fire > 0) return bad('danger');
  if (land < MIN_SPACE * 0.5 || free < MIN_SPACE) return bad('space');
  const foodShare = edible / Math.max(1, land);
  if (sp.food.length && foodShare < MIN_FOOD) return bad('food');
  let predators = 0;
  for (const p of PREDATORS_OF[species]) {
    for (let i = 0; i < creatures.count; i++) {
      if (creatures.species[i] === p && creatures.isAlive(i)) {
        const d = Math.hypot(creatures.x[i] - tx, creatures.y[i] - ty);
        if (d <= 6) return bad('danger');
        if (d <= PREDATOR_REACH) predators++;
      }
    }
  }
  const k = prof.weights;
  const score =
    k.food * Math.min(1, foodShare / 0.6) + k.like * Math.min(1, like / Math.max(1, land)) + k.trees * Math.min(1, trees / 30) + k.rock * Math.min(1, rock / 15) +
    k.space * Math.min(1, free / 150) + k.coast * Math.min(1, sea / 20) - Math.min(0.3, predators * 0.1);
  return { ok: true, score, capacity: Math.max(3, Math.min(16, Math.floor(edible8 / 12))) };
}
