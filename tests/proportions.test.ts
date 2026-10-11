import { describe, expect, it } from 'vitest';
import { buildingAt, pickAt } from '../src/game/pick';
import { BUILDING_SCALE, WORKPLACES, architectureOf, buildingRect, type Workplace } from '../src/render/architecture';
import { CREATURE_ART, CREATURE_SCALE, MIN_PERSON_PX, MIN_SPRITE_PX, creatureScale } from '../src/render/creatureart';
import { TerrainPainter } from '../src/render/painter';
import { Tileset } from '../src/render/tileset';
import { CENTRE_FREE, findSite, type Building, type BuildingType } from '../src/sim/civ';
import { ELF, HUMAN, SPECIES } from '../src/sim/creatures';
import type { Settlement } from '../src/sim/settlements';
import { Simulation } from '../src/sim/simulation';
import { generateWorld } from '../src/world/generator';
import { SEA_LEVEL, T } from '../src/world/terrain';
import { forestEdge, treesOn } from '../src/world/trees';
import { World } from '../src/world/world';

function flat(w: number, h: number, fill: number = T.GRASS): World {
  const world = new World(w, h, 11);
  world.heights.fill(SEA_LEVEL + 20);
  world.temperature.fill(140);
  world.moisture.fill(110);
  world.baseTemperature.fill(140);
  world.baseMoisture.fill(110);
  world.terrain.fill(fill);
  return world;
}

function quiet(world: World): Simulation {
  const sim = new Simulation(world);
  sim.weather.config.auto = false;
  sim.settlements.auto = false;
  sim.groups.enabled = false;
  return sim;
}

/** A settlement on grass with forest blocks around, grown by placing buildings where the layout puts them. */
function grown(sp: number): { sim: Simulation; s: Settlement } {
  const w = flat(110, 100);
  for (const [x0, y0, x1, y1] of [[20, 20, 34, 80], [60, 22, 90, 30], [62, 66, 92, 80]]) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) w.terrain[y * w.width + x] = T.FOREST;
  }
  const sim = quiet(w);
  sim.spawnInCircle(sp, 50, 50, 4, 30);
  const s = sim.foundSettlement(50, 50, 'human') as Settlement;
  expect(typeof s).toBe('object');
  const c = s.civ!;
  const plan: BuildingType[] = ['house', 'farm', 'lumber', 'storehouse', 'house', 'house', 'farm', 'quarry', 'house', 'house', 'house', 'farm', 'house', 'house'];
  for (const type of plan) {
    const i = findSite(sim.world, s, sim.settlements.owner!, type);
    if (i < 0) continue;
    const b: Building = {
      id: c.nextBuildingId++, type, x: i % w.width, y: Math.floor(i / w.width), started: 0, progress: 5, needed: 5, done: true,
      reserve: 0, acc: 0, active: false, idle: 0, empty: false, level: 1 + (c.nextBuildingId % 4), here: 0, up: 0,
    };
    c.buildings.push(b);
  }
  expect(c.buildings.length).toBeGreaterThanOrEqual(8);
  return { sim, s };
}

describe('creature size (drawing)', () => {
  it('every species is drawn at half its former size close up, never below the minimum far away', () => {
    for (const sp of SPECIES) {
      const art = CREATURE_ART[sp.id];
      expect(art).toBeDefined();
      const artW = Math.max(...art.frames[0].map((r) => r.length));
      for (const s of [48, 64, 96]) {
        const now = creatureScale(s, artW, !!sp.sentient, false, 2) * artW;
        const before = (s / 8) * artW; // one sprite pixel per terrain pixel
        expect(now).toBeCloseTo(before * CREATURE_SCALE, 5);
        expect(creatureScale(s, artW, !!sp.sentient, true, 2)).toBeCloseTo(creatureScale(s, artW, !!sp.sentient, false, 2) * 0.75, 6);
      }
      // Far away the minimum size holds (people a little larger than animals).
      const far = creatureScale(1, artW, !!sp.sentient, false, 2) * artW;
      expect(far).toBeCloseTo((sp.sentient ? MIN_PERSON_PX : MIN_SPRITE_PX) * 2, 5);
    }
    // Humans and elves keep different art (told apart at a glance).
    expect(CREATURE_ART[HUMAN].frames[0].join('')).not.toBe(CREATURE_ART[ELF].frames[0].join(''));
  });
});

describe('building size (drawing)', () => {
  it('houses of every level and people, and every workplace, are drawn twice the tile, standing on their tile', () => {
    expect(BUILDING_SCALE).toBe(2);
    const looks: Array<[('human' | 'elven'), BuildingType, number]> = [];
    for (const arch of ['human', 'elven'] as const) {
      for (let l = 1; l <= 4; l++) looks.push([arch, 'house', l]);
      for (const t of Object.keys(WORKPLACES) as Workplace[]) looks.push([arch, t, 1]);
      looks.push([arch, 'shipyard', 1]);
    }
    for (const [arch, type, level] of looks) {
      const r = buildingRect(10, 10, arch, type, level);
      expect(r.x1 - r.x0).toBeGreaterThan(1.4); // was at most one tile
      expect(r.x0).toBeGreaterThanOrEqual(10.5 - BUILDING_SCALE / 2 - 1e-9);
      expect(r.x1).toBeLessThanOrEqual(10.5 + BUILDING_SCALE / 2 + 1e-9);
      expect(r.y1).toBeLessThanOrEqual(11 + 1e-9); // stands on its own tile
      expect(r.y1).toBeGreaterThan(10.5);
      expect(r.y0).toBeGreaterThanOrEqual(11 - 2 * BUILDING_SCALE - 1e-9);
    }
    // Higher house levels stay taller.
    for (const arch of ['human', 'elven'] as const) expect(buildingRect(0, 0, arch, 'house', 4).y0).toBeLessThan(buildingRect(0, 0, arch, 'house', 1).y0);
  });

  it('the layout gives the larger buildings room: no overlap beside each other, no trees under them, a free centre', () => {
    for (const sp of [HUMAN, ELF]) {
      const { sim, s } = grown(sp);
      const bs = s.civ!.buildings;
      const arch = architectureOf(sp);
      for (const a of bs) {
        expect(Math.max(Math.abs(a.x - s.x), Math.abs(a.y - s.y))).toBeGreaterThan(CENTRE_FREE);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) expect(treesOn(sim.world, a.x + dx, a.y + dy)).toBe(0);
        expect([T.FOREST, T.JUNGLE]).not.toContain(sim.world.terrain[a.y * sim.world.width + a.x]);
        for (const b of bs) {
          if (a === b || Math.abs(a.y - b.y) > 1 || (a.type === 'farm' && b.type === 'farm')) continue;
          const ra = buildingRect(a.x, a.y, arch, a.type, a.level);
          const rb = buildingRect(b.x, b.y, arch, b.type, b.level);
          expect(Math.min(ra.x1, rb.x1) - Math.max(ra.x0, rb.x0)).toBeLessThanOrEqual(1e-9);
        }
      }
    }
  });

  it('a tap on a building drawing opens its settlement; a tap right on a person in front of it selects the person', () => {
    const { sim, s } = grown(HUMAN);
    const house = s.civ!.buildings.find((b) => b.type === 'house')!;
    for (let i = 0; i < sim.creatures.count; i++) {
      sim.creatures.x[i] = s.x + 40;
      sim.creatures.y[i] = s.y + 40;
    }
    // The roof of a 2× house rises above its own tile: a tap there still picks the settlement.
    const r = buildingRect(house.x, house.y, 'human', 'house', house.level);
    const roof = { x: house.x + 0.5, y: r.y0 + 0.3 };
    expect(roof.y).toBeLessThan(house.y);
    expect(buildingAt(sim.settlements.list, roof.x, roof.y, 12)?.id).toBe(s.id);
    const p = pickAt(sim.creatures, sim.settlements.list, roof.x, roof.y, 12);
    expect(p?.kind === 'landmark' && p.settlement.id).toBe(s.id);
    // Beside the drawing: nothing of the building.
    expect(buildingAt(sim.settlements.list, r.x1 + 0.3, house.y + 0.5, 12)).toBeNull();
    // A person standing in front of the house, tapped directly.
    sim.creatures.x[0] = house.x + 0.5;
    sim.creatures.y[0] = house.y + 0.9;
    const q = pickAt(sim.creatures, sim.settlements.list, house.x + 0.5, house.y + 0.85, 12);
    expect(q?.kind === 'creatures' && q.indices[0]).toBe(0);
  });
});

describe('trees', () => {
  const world = generateWorld(256, 160, 77);
  const painter = new TerrainPainter(new Tileset());

  it('the painter shows exactly the trees world/trees.ts counts (shared by placement and felling)', () => {
    let checked = 0;
    for (let y = 1; y < world.height - 1; y += 3) {
      for (let x = 1; x < world.width - 1; x += 3) {
        const n = treesOn(world, x, y);
        const drawn = painter.featuresAt(world, x, y, 8).filter((f) => f.tree).length;
        expect(drawn).toBe(n);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(3000);
  });

  it('forests are moderately thinner, with natural gaps, but never bare', () => {
    let interior = 0;
    let trees = 0;
    let gaps = 0;
    for (let y = 1; y < world.height - 1; y++) {
      for (let x = 1; x < world.width - 1; x++) {
        if (world.terrain[y * world.width + x] !== T.FOREST || forestEdge(world, x, y)) continue;
        interior++;
        const n = treesOn(world, x, y);
        trees += n;
        if (!n) gaps++;
      }
    }
    expect(interior).toBeGreaterThan(200);
    const density = trees / interior;
    expect(density).toBeGreaterThan(1.0); // still a forest
    expect(density).toBeLessThan(1.45); // before 0.23 about 1.55 trees per interior tile
    expect(gaps / interior).toBeGreaterThan(0.05); // clearings inside
    expect(gaps / interior).toBeLessThan(0.2);
  });

  it('neighbouring trees are not identical copies: variants and positions vary', () => {
    const looks = new Set<string>();
    let n = 0;
    for (let y = 10; y < 150 && n < 400; y++) {
      for (let x = 10; x < 240 && n < 400; x++) {
        for (const f of painter.featuresAt(world, x, y, 16)) {
          if (!f.tree) continue;
          looks.add(`${f.sp.w}x${f.sp.h}:${f.fx},${f.fy}`);
          n++;
        }
      }
    }
    expect(n).toBe(400);
    expect(looks.size).toBeGreaterThan(20);
  });
});
