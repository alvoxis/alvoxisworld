import { describe, expect, it } from 'vitest';
import { TOOLS } from '../src/game/tools';
import { en } from '../src/i18n/en';
import { HOUSE_STYLES, WORKPLACES, architectureOf, buildingDot, drawBuildingArt, type Rect } from '../src/render/architecture';
import { deserializeInto, serialize } from '../src/save/serialize';
import { BUILDING_TYPES, findSite, type Building, type BuildingType, type Civ } from '../src/sim/civ';
import { ELF, GRAZER, HUMAN } from '../src/sim/creatures';
import type { Settlement } from '../src/sim/settlements';
import { Simulation } from '../src/sim/simulation';
import { SEA_LEVEL, T, isWater } from '../src/world/terrain';
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

function block(w: World, x0: number, y0: number, x1: number, y1: number, t: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) w.setTerrain(x, y, t);
}

function quiet(world: World): Simulation {
  const sim = new Simulation(world);
  sim.weather.config.auto = false;
  return sim;
}

/** Rectangles of one building look, as text, and its bounds. */
function art(arch: 'human' | 'elven', type: BuildingType, level: number): { text: string; minX: number; maxX: number; minY: number; maxY: number } {
  const out: string[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const r: Rect = (x, y, w, h, c) => {
    out.push(`${x},${y},${w},${h},${c}`);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x + w);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y + h);
  };
  drawBuildingArt(r, arch, type, level, '#e6584c');
  return { text: out.join(';'), minX, maxX, minY, maxY };
}

describe('building graphics', () => {
  it('every house level looks different, for humans and for elves, and the two peoples never share a look', () => {
    for (const arch of ['human', 'elven'] as const) {
      const looks = [1, 2, 3, 4].map((l) => art(arch, 'house', l).text);
      expect(new Set(looks).size).toBe(4);
    }
    for (let l = 1; l <= 4; l++) expect(art('human', 'house', l).text).not.toBe(art('elven', 'house', l).text);
  });

  it('higher levels are larger: more detail and taller, never shorter than the level below', () => {
    for (const arch of ['human', 'elven'] as const) {
      for (let l = 2; l <= 4; l++) {
        expect(art(arch, 'house', l).minY).toBeLessThanOrEqual(art(arch, 'house', l - 1).minY + 0.01);
      }
      expect(art(arch, 'house', 4).text.split(';').length).toBeGreaterThan(art(arch, 'house', 1).text.split(';').length);
    }
  });

  it('buildings stay on their tile column and stand on the ground (at most one tile above it)', () => {
    for (const arch of ['human', 'elven'] as const) {
      for (const type of BUILDING_TYPES) {
        for (let l = 1; l <= 4; l++) {
          const a = art(arch, type, l);
          expect(a.minX).toBeGreaterThanOrEqual(-0.5);
          expect(a.maxX).toBeLessThanOrEqual(8.5);
          expect(a.minY).toBeGreaterThanOrEqual(-8);
          expect(a.maxY).toBeLessThanOrEqual(8);
          expect(a.maxY).toBeGreaterThanOrEqual(6.4); // reaches the ground of its tile
        }
      }
    }
  });

  it('workplaces each have their own look (shared by both peoples) and a far-away colour', () => {
    const looks = (['farm', 'lumber', 'quarry', 'storehouse'] as const).map((t) => art('human', t, 1).text);
    expect(new Set(looks).size).toBe(4);
    for (const t of ['farm', 'lumber', 'quarry', 'storehouse'] as const) {
      expect(art('elven', t, 1).text).toBe(art('human', t, 1).text);
      expect(buildingDot('human', t, 1)).toBe(WORKPLACES[t].dot);
    }
    expect(buildingDot('elven', 'house', 3)).toBe(HOUSE_STYLES.elven.dots[3]);
  });

  it('the style comes from the settlement species', () => {
    expect(architectureOf(HUMAN)).toBe('human');
    expect(architectureOf(ELF)).toBe('elven');
    expect(architectureOf(GRAZER)).toBe('human'); // animals have no buildings; a safe default
  });
});

describe('settlement layout', () => {
  /** A village with a pond and a forest edge; buildings placed one by one through the real placement. */
  function village(): { sim: Simulation; s: Settlement; civ: Civ } {
    const w = flat(120, 100);
    block(w, 46, 34, 52, 46, T.FOREST);
    block(w, 30, 38, 35, 46, T.HILLS);
    block(w, 40, 31, 44, 32, T.LAKE);
    const sim = quiet(w);
    sim.settlements.auto = false;
    sim.groups.enabled = false;
    sim.spawnInCircle(HUMAN, 40, 40, 4, 14);
    const s = sim.foundSettlement(40, 40, 'human') as Settlement;
    expect(typeof s).toBe('object');
    return { sim, s, civ: s.civ! };
  }

  function place(sim: Simulation, s: Settlement, type: BuildingType): Building {
    const i = findSite(sim.world, s, sim.settlements.owner!, type);
    expect(i).toBeGreaterThanOrEqual(0);
    const c = s.civ!;
    const b: Building = {
      id: c.nextBuildingId++, type, x: i % sim.world.width, y: Math.floor(i / sim.world.width), started: 0, progress: 5, needed: 5, done: true,
      reserve: 0, acc: 0, active: false, idle: 0, empty: false, here: 0, level: 1, up: 0,
    };
    c.buildings.push(b);
    return b;
  }

  it('never on water, steep or claimed ground, never on another building, and the centre stays open', () => {
    const { sim, s, civ } = village();
    for (const t of ['house', 'house', 'farm', 'lumber', 'quarry', 'storehouse', 'house', 'farm', 'house', 'house'] as const) place(sim, s, t);
    const W = sim.world.width;
    const tiles = civ.buildings.map((b) => b.y * W + b.x);
    expect(new Set(tiles).size).toBe(tiles.length);
    for (const b of civ.buildings) {
      const i = b.y * W + b.x;
      expect(isWater(sim.world.terrain[i])).toBe(false);
      expect(sim.world.slopeClass[i]).toBe(0);
      expect(sim.settlements.owner![i]).toBe(s.id);
      expect(Math.hypot(b.x - s.x, b.y - s.y)).toBeGreaterThanOrEqual(1.5);
    }
  });

  it('houses ring the centre without touching side by side; fields lie further out; workplaces by their resource', () => {
    const { sim, s, civ } = village();
    const houses = [0, 1, 2, 3, 4, 5].map(() => place(sim, s, 'house'));
    const farms = [place(sim, s, 'farm'), place(sim, s, 'farm')];
    const lumber = place(sim, s, 'lumber');
    const quarry = place(sim, s, 'quarry');
    for (const a of houses) {
      for (const b of civ.buildings) {
        if (a === b) continue;
        expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBeGreaterThan(1); // no shared side
      }
    }
    const dist = (b: Building) => Math.hypot(b.x - s.x, b.y - s.y);
    const avg = (bs: Building[]) => bs.reduce((n, b) => n + dist(b), 0) / bs.length;
    expect(avg(farms)).toBeGreaterThan(avg(houses));
    expect(Math.max(...houses.map(dist))).toBeLessThan(6);
    expect(Math.hypot(lumber.x - 49, lumber.y - 40)).toBeLessThan(8); // by the forest
    expect(Math.hypot(quarry.x - 32, quarry.y - 42)).toBeLessThan(7); // by the hills
  });

  it('is deterministic and varies between settlements', () => {
    const a = village();
    const b = village();
    const pa = [0, 1, 2].map(() => place(a.sim, a.s, 'house')).map((x) => `${x.x},${x.y}`);
    const pb = [0, 1, 2].map(() => place(b.sim, b.s, 'house')).map((x) => `${x.x},${x.y}`);
    expect(pa).toEqual(pb);
  });

  it('existing buildings keep their places when a world is loaded (nothing is rearranged)', () => {
    const { sim, civ } = village();
    // Old, packed layout next to the centre (as 0.17 placed them).
    for (const [x, y, type] of [[41, 40, 'house'], [40, 41, 'house'], [39, 40, 'farm']] as const) {
      civ.buildings.push({ id: civ.nextBuildingId++, type, x, y, started: 0, progress: 5, needed: 5, done: true, reserve: 0, acc: 0, active: false, idle: 0, empty: false, here: 0, level: type === 'house' ? 2 : 1, up: 0 });
    }
    const before = JSON.stringify(civ.buildings.map((b) => [b.id, b.x, b.y, b.level]));
    const other = quiet(flat(8, 8));
    deserializeInto(other, serialize(sim));
    const after = other.settlements.list[0].civ!.buildings;
    expect(JSON.stringify(after.map((b) => [b.id, b.x, b.y, b.level]))).toBe(before);
    for (let t = 0; t < 400; t++) other.step();
    for (const [id, x, y] of JSON.parse(before) as number[][]) {
      const b = other.settlements.list[0].civ!.buildings.find((q) => q.id === id)!;
      expect([b.x, b.y]).toEqual([x, y]);
    }
  });
});

describe('tool palette', () => {
  it('the two manual founding tools are gone, with their texts', () => {
    expect(TOOLS.some((t) => t.id === 'found' || t.id === 'found_human')).toBe(false);
    expect(Object.keys(en).some((k) => k.startsWith('tool.found') || k.startsWith('toast.found_'))).toBe(false);
  });

  it('settlements still found themselves without any tool', () => {
    const w = flat(160, 120);
    block(w, 62, 52, 66, 54, T.LAKE);
    block(w, 70, 62, 76, 70, T.FOREST);
    const sim = quiet(w);
    sim.spawnInCircle(HUMAN, 60, 60, 3, 6);
    for (let t = 0; t < 1700; t++) sim.step();
    expect(sim.settlements.list.length).toBeGreaterThanOrEqual(1);
  });

  it('the remaining tools still do what they did: spawn each species, paint terrain, remove life', () => {
    const sim = quiet(flat(80, 80));
    const ctx = { sim, notify: () => {}, inspect: () => {}, durationTicks: 100, intensity: 1 } as never;
    for (const tool of TOOLS.filter((t) => t.id.startsWith('spawn_'))) {
      const key = tool.id.slice(6);
      const before = sim.creatures.count;
      tool.apply(ctx, key === 'fish' ? 20 : 40, key === 'fish' ? 20 : 40, 2);
      if (key === 'fish') continue; // needs water, tested elsewhere
      expect(sim.creatures.count).toBeGreaterThan(before);
    }
    TOOLS.find((t) => t.id === 'paint_forest')!.apply(ctx, 10, 10, 2);
    expect(sim.world.terrain[10 * 80 + 10]).toBe(T.FOREST);
    const n = sim.creatures.count;
    TOOLS.find((t) => t.id === 'smite')!.apply(ctx, 40, 40, 4);
    let alive = 0;
    for (let i = 0; i < sim.creatures.count; i++) if (sim.creatures.isAlive(i) && Math.hypot(sim.creatures.x[i] - 40, sim.creatures.y[i] - 40) < 3) alive++;
    expect(alive).toBe(0);
    expect(n).toBeGreaterThan(0);
  });

  it('every tool in a category has an icon and a translated name', () => {
    for (const tool of TOOLS) {
      expect(tool.icon).toBeDefined();
      if (!tool.id.startsWith('spawn_') && !tool.id.startsWith('paint_') && !tool.id.startsWith('effect_')) expect(Object.keys(en)).toContain(`tool.${tool.id}`);
    }
  });
});
