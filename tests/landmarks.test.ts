import { describe, expect, it } from 'vitest';
import { LANDMARK_CREATURE_RADIUS, landmarkAt, pickAt } from '../src/game/pick';
import { architectureOf, buildingRect, drawBuildingArt, type Rect } from '../src/render/architecture';
import { LANDMARK_BOUNDS, SHOWN_RESIDENTS, drawLandmark, hitsLandmark, LANDMARK_BASE_SCALE, MIN_LANDMARK_SCALE, landmarkBox, landmarkFireSide, landmarkGround, landmarkRects, landmarkScale, landmarkScaleFor, landmarkTop, shownResidents } from '../src/render/landmarks';
import { deserializeInto, serialize } from '../src/save/serialize';
import { STAGES, findSite, type Building, type BuildingType, type Stage } from '../src/sim/civ';
import { ELF, HUMAN, type Architecture } from '../src/sim/creatures';
import type { Settlement } from '../src/sim/settlements';
import { Simulation } from '../src/sim/simulation';
import { SEA_LEVEL, T } from '../src/world/terrain';
import { World } from '../src/world/world';

function flat(w: number, h: number): World {
  const world = new World(w, h, 11);
  world.heights.fill(SEA_LEVEL + 20);
  world.temperature.fill(140);
  world.moisture.fill(110);
  world.baseTemperature.fill(140);
  world.baseMoisture.fill(110);
  world.terrain.fill(T.GRASS);
  return world;
}

function quiet(world: World): Simulation {
  const sim = new Simulation(world);
  sim.weather.config.auto = false;
  sim.settlements.auto = false;
  sim.groups.enabled = false;
  return sim;
}

function settle(sp: number, x = 40, y = 40): { sim: Simulation; s: Settlement } {
  const sim = quiet(flat(100, 90));
  sim.spawnInCircle(sp, x, y, 4, 14);
  const s = sim.foundSettlement(x, y, 'human') as Settlement;
  expect(typeof s).toBe('object');
  s.civ!.food = 80;
  return { sim, s };
}

/** Places finished buildings where the layout puts them (as the settlement would build them). */
function build(sim: Simulation, s: Settlement, types: BuildingType[]): void {
  const c = s.civ!;
  for (const type of types) {
    const i = findSite(sim.world, s, sim.settlements.owner!, type);
    if (i < 0) continue; // no room left for this type in the territory
    const b: Building = {
      id: c.nextBuildingId++, type, x: i % sim.world.width, y: Math.floor(i / sim.world.width), started: 0, progress: 5, needed: 5, done: true,
      reserve: 0, acc: 0, active: false, idle: 0, empty: false, level: 1, here: 0, up: 0,
    };
    c.buildings.push(b);
  }
}

const TOWN_PLAN: BuildingType[] = ['house', 'house', 'farm', 'storehouse', 'house', 'lumber', 'house', 'quarry', 'house', 'house', 'farm', 'house'];

/** A look as text, its rectangle count and bounds. */
function look(arch: Architecture, stage: Stage, roof = '#e6584c') {
  const out: string[] = [];
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const r: Rect = (x, y, w, h, c) => {
    out.push(`${x.toFixed(2)},${y.toFixed(2)},${w.toFixed(2)},${h.toFixed(2)},${c}`);
    b.x0 = Math.min(b.x0, x);
    b.y0 = Math.min(b.y0, y);
    b.x1 = Math.max(b.x1, x + w);
    b.y1 = Math.max(b.y1, y + h);
  };
  drawLandmark(r, arch, stage, roof);
  return { text: out.join(';'), n: out.length, colors: new Set(out.map((s) => s.split(',')[4])), ...b };
}

/** Coarse silhouette: which cells of a 1-unit grid over the landmark bounds are covered. */
function silhouette(arch: Architecture, stage: Stage): Set<number> {
  const a = landmarkRects(arch, stage);
  const cells = new Set<number>();
  for (let i = 0; i < a.length; i += 4) {
    for (let y = Math.floor(a[i + 1]); y < Math.ceil(a[i + 1] + a[i + 3]); y++)
      for (let x = Math.floor(a[i]); x < Math.ceil(a[i] + a[i + 2]); x++) cells.add((y + 40) * 100 + x + 40);
  }
  return cells;
}

const ARCHS = ['human', 'elven'] as const;

describe('settlement landmark art', () => {
  it('every people has a distinct, detailed landmark for every stage, within the bounds of the open centre', () => {
    const B = LANDMARK_BOUNDS;
    for (const arch of ARCHS) {
      const texts = STAGES.map((st) => look(arch, st).text);
      expect(new Set(texts).size).toBe(STAGES.length);
      for (const st of STAGES) {
        const l = look(arch, st);
        expect(l.n).toBeGreaterThanOrEqual(25); // far more than the old one-shape marker
        expect(l.colors.size).toBeGreaterThanOrEqual(8);
        expect(l.colors.has('#e6584c')).toBe(true); // the settlement colour shows
        expect(l.x0).toBeGreaterThanOrEqual(B.x0);
        expect(l.x1).toBeLessThanOrEqual(B.x1);
        expect(l.y0).toBeGreaterThanOrEqual(B.y0);
        expect(l.y1).toBeLessThanOrEqual(B.y1);
        expect(l.y1).toBeGreaterThan(14); // stands on the row below the centre
        expect(l.x1 - l.x0).toBeGreaterThanOrEqual(18); // more than two tiles wide: larger than any house
      }
    }
  });

  it('later stages are more developed: taller and at least as detailed', () => {
    for (const arch of ARCHS) {
      expect(landmarkTop(arch, 'village')).toBeLessThan(landmarkTop(arch, 'camp'));
      expect(landmarkTop(arch, 'town')).toBeLessThan(landmarkTop(arch, 'village'));
      expect(look(arch, 'town').n).toBeGreaterThanOrEqual(look(arch, 'camp').n);
    }
  });

  it('humans and elves have different silhouettes, not a recolour', () => {
    for (const st of STAGES) {
      const h = silhouette('human', st);
      const e = silhouette('elven', st);
      let shared = 0;
      for (const c of h) if (e.has(c)) shared++;
      const union = h.size + e.size - shared;
      expect(shared / union).toBeLessThan(0.8);
      // Different palettes too (apart from the shared settlement colour).
      const hc = look('human', st).colors;
      const ec = look('elven', st).colors;
      let same = 0;
      for (const c of hc) if (ec.has(c)) same++;
      expect(same / Math.min(hc.size, ec.size)).toBeLessThan(0.5);
    }
  });

  it('is not a scaled house: it differs from every house look', () => {
    for (const arch of ARCHS) {
      for (let level = 1; level <= 4; level++) {
        const house: string[] = [];
        drawBuildingArt((x, y, w, h, c) => house.push(`${x},${y},${w},${h},${c}`), arch, 'house', level, '#e6584c');
        for (const st of STAGES) expect(look(arch, st).text).not.toBe(house.join(';'));
      }
    }
  });

  it('is deterministic', () => {
    for (const arch of ARCHS) for (const st of STAGES) expect(look(arch, st).text).toBe(look(arch, st).text);
  });
});

describe('landmarks belong to their settlement', () => {
  it('follow the stage in place: no building record, no change to people, resources or buildings', () => {
    const { sim, s } = settle(HUMAN);
    const c = s.civ!;
    sim.step();
    const before = JSON.stringify({ id: s.id, x: s.x, y: s.y, members: s.members, buildings: c.buildings, food: c.food, wood: c.wood, stone: c.stone, techs: c.techs, list: sim.settlements.list.length });
    const looks: string[] = [];
    for (const stage of STAGES) {
      c.stage = stage;
      // The landmark is picked from the stage alone (renderer and hit test use architecture + stage).
      looks.push(look('human', c.stage).text);
      expect(hitsLandmark(s, s.x + 0.5, s.y + 1.5, 12)).toBe(true);
    }
    expect(new Set(looks).size).toBe(3);
    c.stage = 'camp';
    expect(JSON.stringify({ id: s.id, x: s.x, y: s.y, members: s.members, buildings: c.buildings, food: c.food, wood: c.wood, stone: c.stone, techs: c.techs, list: sim.settlements.list.length })).toBe(before);
    expect(c.buildings.some((b) => (b.type as string) === 'landmark')).toBe(false);
  });

  it('the centre stays free of ordinary buildings as the settlement grows, so the landmark never covers a house', () => {
    const { sim, s } = settle(ELF);
    const c = s.civ!;
    build(sim, s, TOWN_PLAN);
    expect(c.buildings.length).toBeGreaterThanOrEqual(6);
    for (const b of c.buildings) expect(Math.max(Math.abs(b.x - s.x), Math.abs(b.y - s.y))).toBeGreaterThanOrEqual(1);
    for (const b of c.buildings) expect(Math.hypot(b.x - s.x, b.y - s.y)).toBeGreaterThanOrEqual(1.5);
  });

  it('save and load: no new save data, and a loaded world shows the landmark of its stored stage and people', () => {
    for (const sp of [HUMAN, ELF]) {
      const { sim, s } = settle(sp);
      s.civ!.stage = 'village';
      const data = serialize(sim);
      expect(JSON.stringify(data).includes('landmark')).toBe(false);
      const other = quiet(flat(8, 8));
      deserializeInto(other, data);
      const t = other.settlements.get(s.id)!;
      expect(t.civ!.stage).toBe('village');
      expect(t.species).toBe(sp);
      expect(t.civ!.buildings.length).toBe(s.civ!.buildings.length);
      expect(landmarkAt(other.settlements.list, t.x + 0.5, t.y + 1.5, 12)?.id).toBe(s.id);
    }
  });
});

describe('tapping landmarks', () => {
  it('a tap on the landmark picks its settlement (on the roof too, above the territory centre)', () => {
    const { sim, s } = settle(HUMAN);
    s.civ!.stage = 'town';
    // Move everyone away so only the landmark is under the taps.
    for (let i = 0; i < sim.creatures.count; i++) {
      sim.creatures.x[i] = s.x + 12;
      sim.creatures.y[i] = s.y + 12;
    }
    for (const zoom of [24, 12, 5]) {
      const k = landmarkScale(zoom);
      const at = (ux: number, uy: number) => [s.x + 0.5 + ((ux - 4) * k) / 8, s.y + 0.5 + ((uy - 4) * k) / 8] as const;
      for (const [ux, uy] of [[4, 11], [-4, 6], [12, 6], [4, -10]]) {
        const [x, y] = at(ux, uy);
        const p = pickAt(sim.creatures, sim.settlements.list, x, y, zoom);
        expect(p?.kind).toBe('landmark');
        expect(p?.kind === 'landmark' && p.settlement.id).toBe(s.id);
      }
      // Empty sky beside the tower is not the landmark.
      const [x, y] = at(-6, -14);
      expect(landmarkAt(sim.settlements.list, x, y, zoom)).toBeNull();
    }
  });

  it('a creature right under the finger on the landmark is still selected; one a little away is not', () => {
    const { sim, s } = settle(ELF);
    s.civ!.stage = 'village';
    for (let i = 0; i < sim.creatures.count; i++) {
      sim.creatures.x[i] = s.x + 12;
      sim.creatures.y[i] = s.y + 12;
    }
    const i = 0;
    sim.creatures.x[i] = s.x + 0.5;
    sim.creatures.y[i] = s.y + 1.2;
    const p = pickAt(sim.creatures, sim.settlements.list, s.x + 0.55, s.y + 1.1, 12);
    expect(p?.kind).toBe('creatures');
    expect(p?.kind === 'creatures' && p.indices[0]).toBe(i);
    const q = pickAt(sim.creatures, sim.settlements.list, s.x + 0.5 + LANDMARK_CREATURE_RADIUS + 0.6, s.y + 1.2, 12);
    expect(q?.kind).toBe('landmark');
    // Away from the landmark the usual generous radius still applies.
    sim.creatures.x[i] = s.x + 6;
    sim.creatures.y[i] = s.y + 6;
    const r = pickAt(sim.creatures, sim.settlements.list, s.x + 6.8, s.y + 6, 12);
    expect(r?.kind).toBe('creatures');
  });

  it('hidden settlements are not tapped; the hit area scales with the drawn size far away', () => {
    const { sim, s } = settle(HUMAN);
    for (let i = 0; i < sim.creatures.count; i++) sim.creatures.x[i] = s.x + 20;
    expect(pickAt(sim.creatures, sim.settlements.list, s.x + 0.5, s.y + 1.5, 12, false)).toBeNull();
    // At zoom 1 a landmark is drawn 6× larger than the map, so a tap three tiles below the centre still hits it.
    expect(hitsLandmark(s, s.x + 0.5, s.y + 3.5, 1)).toBe(true);
    expect(hitsLandmark(s, s.x + 0.5, s.y + 3.5, 12)).toBe(false);
    expect(landmarkScale(12)).toBe(LANDMARK_BASE_SCALE);
    expect(landmarkScale(1)).toBe(6);
    expect(landmarkScale(5)).toBe(LANDMARK_BASE_SCALE);
  });
});

describe('far zoom', () => {
  it('a few residents (members, at most 3, at their own positions) are shown on the icon and can be tapped there', () => {
    const { sim, s } = settle(HUMAN);
    const c = sim.creatures;
    const zoom = 2;
    const box = landmarkBox(s, zoom);
    // Five members spread over the icon, the rest away from it.
    const ids = [...s.members];
    ids.forEach((id, k) => {
      const i = c.indexOf(id);
      if (k < 5) {
        c.x[i] = s.x + 0.5 + (k - 2) * 1.2;
        c.y[i] = s.y + 0.5 + k * 0.6;
      } else {
        c.x[i] = s.x + 20;
        c.y[i] = s.y + 20;
      }
    });
    const shown = shownResidents(s, c, zoom);
    expect(shown.length).toBe(SHOWN_RESIDENTS);
    for (const i of shown) {
      expect(s.members).toContain(c.id[i]);
      expect(c.x[i]).toBeGreaterThanOrEqual(box.x0);
      expect(c.y[i]).toBeLessThanOrEqual(box.y1);
    }
    // Front-most first; the same creatures every time (no new ones).
    for (let k = 1; k < shown.length; k++) expect(c.y[shown[k - 1]]).toBeGreaterThanOrEqual(c.y[shown[k]]);
    expect(shownResidents(s, c, zoom)).toEqual(shown);
    const count = c.count;
    // A tap on a shown resident selects it; a tap on a hidden one (covered by the icon) opens the settlement.
    const a = pickAt(c, sim.settlements.list, c.x[shown[0]], c.y[shown[0]], zoom);
    expect(a?.kind === 'creatures' && a.indices[0]).toBe(shown[0]);
    // A tap on the icon away from the shown residents (the town hall's tower) opens the settlement.
    s.civ!.stage = 'town';
    const k = landmarkScaleFor(s, zoom);
    const b = pickAt(c, sim.settlements.list, s.x + 0.5, s.y + 0.5 + ((-10 - 4) * k) / 8, zoom);
    expect(b?.kind === 'landmark' && b.settlement.id).toBe(s.id);
    expect(c.count).toBe(count);
    // Closer in nothing is redrawn: people are drawn over the landmark anyway.
    expect(shownResidents(s, c, 4)).toEqual([]);
  });
});

describe('the landmark stays in the free centre', () => {
  it('from zoom 3 up it never reaches the nearest building; far away it becomes an icon', () => {
    for (const sp of [HUMAN, ELF]) {
      const { sim, s } = settle(sp);
      const c = s.civ!;
      build(sim, s, TOWN_PLAN);
      expect(c.buildings.length).toBeGreaterThanOrEqual(6);
      for (const stage of STAGES) {
        c.stage = stage;
        for (const zoom of [3, 4, 5, 8, 12, 24]) {
          const box = landmarkBox(s, zoom);
          for (const b of c.buildings) {
            // No building's drawing (twice the tile) may reach under the landmark's sides or base; tall parts may
            // rise behind one another, as any building rises over the row behind it.
            const r = buildingRect(b.x, b.y, architectureOf(s.species), b.type, b.level);
            const overlapX = r.x1 > box.x0 + 1e-9 && r.x0 < box.x1 - 1e-9;
            const besideOrBelow = b.y >= s.y - 1;
            if (besideOrBelow) expect(overlapX && b.y + 1 > box.y0 && b.y < landmarkGround(s, zoom) - 1e-9).toBe(false);
          }
          expect(landmarkScaleFor(s, zoom)).toBeGreaterThanOrEqual(1);
        }
        expect(landmarkScaleFor(s, 1)).toBe(landmarkScale(1)); // icon
      }
    }
  });

  it('with nothing built around it, a camp may be drawn larger at normal zoom, still clear of the free centre edge', () => {
    const { s } = settle(HUMAN);
    s.civ!.buildings.length = 0;
    expect(landmarkScaleFor(s, 4)).toBe(landmarkScale(4));
    s.civ!.buildings.push({ x: s.x + 2, y: s.y } as never); // an old world's house close to the centre
    expect(landmarkScaleFor(s, 4)).toBe(MIN_LANDMARK_SCALE);
    // Hit testing follows the drawn scale: the camp's banner pole (grid x 13.8) moves out with the scale.
    const pole = (k: number) => s.x + 0.5 + ((13.8 - 4) * k) / 8;
    expect(hitsLandmark(s, pole(MIN_LANDMARK_SCALE), s.y + 0.5, 4)).toBe(true);
    expect(hitsLandmark(s, pole(landmarkScale(4)), s.y + 0.5, 4)).toBe(false);
    s.civ!.buildings.length = 0;
    expect(hitsLandmark(s, pole(landmarkScale(4)), s.y + 0.5, 4)).toBe(true);
  });
});

describe('fire on the centre', () => {
  it('in front of the walls it is drawn in front, behind them hidden (glow and smoke), far away over the icon', () => {
    const { s } = settle(HUMAN);
    s.civ!.stage = 'village';
    s.civ!.buildings.length = 0;
    s.civ!.buildings.push({ x: s.x + 2, y: s.y + 2 } as never); // keeps the landmark at scale 1
    expect(landmarkFireSide(s, s.x, s.y + 1, 12)).toBe('front');
    expect(landmarkFireSide(s, s.x - 1, s.y + 1, 12)).toBe('front');
    expect(landmarkFireSide(s, s.x, s.y, 12)).toBe('behind');
    expect(landmarkFireSide(s, s.x, s.y - 1, 12)).toBe('behind'); // under the roof
    expect(landmarkFireSide(s, s.x + 1, s.y - 1, 12)).toBeNull(); // beside the roof: drawn as usual
    expect(landmarkFireSide(s, s.x + 3, s.y, 12)).toBeNull();
    expect(landmarkFireSide(s, s.x, s.y + 3, 12)).toBeNull();
    expect(landmarkFireSide(s, s.x, s.y, 1.5)).toBe('icon');
  });
});
