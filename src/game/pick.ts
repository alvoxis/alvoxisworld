/**
 * What a tap on the map picks (0.22). A creature under the finger wins, so people standing at a settlement's centre
 * stay selectable; on a settlement landmark only a creature right under the tap counts (the landmark would otherwise
 * be hard to tap through the people gathered around it); far away, where a landmark is an icon drawn over the creature
 * dots, only the residents drawn over it (`shownResidents`) can be picked there. A tap on an ordinary building's
 * drawing works like one on the landmark (it opens the settlement). Elsewhere the usual radius applies.
 */
import { architectureOf, buildingRect } from '../render/architecture';
import { LANDMARK_OVER_DOTS_BELOW, hitsLandmark, shownResidents } from '../render/landmarks';
import type { Creatures } from '../sim/creatures';
import type { Settlement } from '../sim/settlements';

/** Creature pick radius (tiles) for a tap on a landmark: about the size of a person's sprite. */
export const LANDMARK_CREATURE_RADIUS = 0.6;

export type Pick = { kind: 'creatures'; indices: number[] } | { kind: 'landmark'; settlement: Settlement } | null;

/** The settlement whose landmark is drawn under (x, y) at this zoom (CSS px per tile), nearest centre first. */
export function landmarkAt(list: readonly Settlement[], x: number, y: number, zoom: number): Settlement | null {
  let best: Settlement | null = null;
  let bestD = Infinity;
  for (const st of list) {
    if (!st.civ || !hitsLandmark(st, x, y, zoom)) continue;
    const d = Math.hypot(st.x + 0.5 - x, st.y + 0.5 - y);
    if (d < bestD) {
      bestD = d;
      best = st;
    }
  }
  return best;
}

/**
 * The settlement whose building is drawn under (x, y) (buildings are drawn twice the tile, see architecture.ts),
 * frontmost (lowest on screen) first. Only where buildings are drawn as sprites (zoom 3 and up); far away they are
 * dots on their own tile, which the tile report already covers.
 */
export function buildingAt(list: readonly Settlement[], x: number, y: number, zoom: number): Settlement | null {
  if (zoom < LANDMARK_OVER_DOTS_BELOW) return null;
  let best: Settlement | null = null;
  let by = -Infinity;
  for (const st of list) {
    if (!st.civ) continue;
    const arch = architectureOf(st.species);
    for (const b of st.civ.buildings) {
      if (Math.abs(b.x - x) > 3 || b.y < y - 1 || b.y > y + 6) continue;
      const r = buildingRect(b.x, b.y, arch, b.type, b.done ? b.level : 1);
      if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1 && b.y > by) {
        by = b.y;
        best = st;
      }
    }
  }
  return best;
}

/**
 * Picks at (x, y): the creatures near the tap (nearest first) if any, else the landmark under it, else nothing.
 * `landmarks` is false when settlements are hidden (their landmarks are not drawn then).
 */
export function pickAt(creatures: Creatures, settlements: readonly Settlement[], x: number, y: number, zoom: number, landmarks = true): Pick {
  const lm = landmarks ? landmarkAt(settlements, x, y, zoom) : null;
  if (lm && zoom < LANDMARK_OVER_DOTS_BELOW) {
    // The icon is drawn over the creature dots, except the few residents drawn over it: only those can be picked.
    const r = Math.max(LANDMARK_CREATURE_RADIUS, 5 / zoom); // about a dot's size
    const hit = shownResidents(lm, creatures, zoom)
      .map((i) => ({ i, d: Math.hypot(creatures.x[i] - x, creatures.y[i] - y) }))
      .filter((o) => o.d <= r)
      .sort((a, b) => a.d - b.d);
    return hit.length ? { kind: 'creatures', indices: hit.map((o) => o.i) } : { kind: 'landmark', settlement: lm };
  }
  const bd = lm ? null : buildingAt(settlements, x, y, zoom);
  const on = lm ?? bd;
  const near = creatures.candidatesAt(x, y, on ? LANDMARK_CREATURE_RADIUS : Math.max(0.9, 24 / zoom));
  if (near.length) return { kind: 'creatures', indices: near };
  return on ? { kind: 'landmark', settlement: on } : null;
}
