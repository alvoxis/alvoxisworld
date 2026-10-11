import { describe, expect, it } from 'vitest';
import { deserializeInto, serialize, SAVE_VERSION } from '../src/save/serialize';
import { CENTRE_FREE, CLEARERS, CLEAR_JOB, buildBlock, centreTrees, preparing, siteTrees, startBuilding, type Building } from '../src/sim/civ';
import { HUMAN, ELF, STATE } from '../src/sim/creatures';
import { Forestry, STUMP_ROT_TICKS, WOOD_PER_TREE, fellable, woodOf } from '../src/sim/forestry';
import { STEP_TICKS, type Settlement } from '../src/sim/settlements';
import { Simulation } from '../src/sim/simulation';
import { vegetationTick } from '../src/sim/vegetation';
import { Rng } from '../src/core/rng';
import { SEA_LEVEL, T } from '../src/world/terrain';
import { treesOn } from '../src/world/trees';
import { World } from '../src/world/world';

function flat(w: number, h: number, fill: number = T.GRASS): World {
  const world = new World(w, h, 11);
  world.heights.fill(SEA_LEVEL + 20);
  world.temperature.fill(140);
  world.moisture.fill(150);
  world.baseTemperature.fill(140);
  world.baseMoisture.fill(150);
  world.terrain.fill(fill);
  return world;
}

function block(w: World, x0: number, y0: number, x1: number, y1: number, t: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) w.terrain[y * w.width + x] = t;
}

const steps = (sim: Simulation, n: number) => {
  for (let t = 0; t < n * STEP_TICKS; t++) sim.step();
};

/** People founding a settlement in the middle of a forest (with a pond to drink from). */
function forestCamp(sp = HUMAN, auto = false): { sim: Simulation; s: Settlement } {
  const w = flat(100, 90, T.FOREST);
  block(w, 30, 30, 70, 60, T.FOREST);
  block(w, 47, 36, 53, 37, T.LAKE);
  const sim = new Simulation(w);
  sim.weather.config.auto = false;
  sim.settlements.auto = auto;
  sim.groups.enabled = false;
  sim.spawnInCircle(sp, 50, 45, 3, 12);
  const s = sim.foundSettlement(50, 45, 'human') as Settlement;
  expect(typeof s).toBe('object');
  s.civ!.food = 200;
  return { sim, s };
}

const countTrees = (w: World, inside: (x: number, y: number) => boolean) => {
  let n = 0;
  for (let y = 0; y < w.height; y++) for (let x = 0; x < w.width; x++) if (inside(x, y)) n += treesOn(w, x, y);
  return n;
};

describe('founding in a forest: the centre is cleared first', () => {
  it('queues the trees of the centre, builds nothing until it is clear, then clears only what is needed', () => {
    const { sim, s } = forestCamp();
    const c = s.civ!;
    const W = sim.world.width;
    const queued = centreTrees(sim.world, s);
    expect(queued.length).toBeGreaterThan(10);
    expect(c.clear.slice().sort((a, b) => a - b)).toEqual(queued.slice().sort((a, b) => a - b));
    expect(preparing(c, s, W)).toBe(true);
    c.wood = 200;
    expect(buildBlock(sim.world, s, sim.settlements.owner, 'house')).toBe('clearing');
    expect(startBuilding(sim.world, s, sim.settlements.owner, 'house', sim.tick)).toBe('clearing');
    // Far away from the settlement the forest is left alone.
    const far = (x: number, y: number) => Math.hypot(x - s.x, y - s.y) > 14;
    const farTrees = countTrees(sim.world, far);
    const wood0 = c.wood;
    c.wood = 0;
    let felled = 0;
    for (let k = 0; k < 200 && preparing(c, s, W); k++) {
      steps(sim, 1);
      // Clearing is real work by at most two people.
      expect(c.jobs.filter((j) => j.b === CLEAR_JOB).length).toBeLessThanOrEqual(CLEARERS);
      felled = queued.filter((t) => !fellable(sim.world, t)).length;
    }
    expect(preparing(c, s, W)).toBe(false);
    expect(felled).toBe(queued.length);
    for (let dy = -CENTRE_FREE; dy <= CENTRE_FREE; dy++) {
      for (let dx = -CENTRE_FREE; dx <= CENTRE_FREE; dx++) {
        expect(treesOn(sim.world, s.x + dx, s.y + dy)).toBe(0);
        expect(sim.world.terrain[(s.y + dy) * W + s.x + dx]).not.toBe(T.FOREST);
      }
    }
    expect(c.wood).toBeGreaterThan(0); // the cleared trees gave wood
    // Nothing was felled away from the centre (every stump is in it); browsing may thin a few trees anywhere.
    for (const t of sim.settlements.forestry.stumps.keys()) {
      expect(Math.max(Math.abs((t % W) - s.x), Math.abs(Math.floor(t / W) - s.y))).toBeLessThanOrEqual(CENTRE_FREE);
    }
    expect(countTrees(sim.world, far)).toBeGreaterThan(farTrees * 0.99);
    void wood0;
    // Now building can start.
    c.wood = 200;
    expect(buildBlock(sim.world, s, sim.settlements.owner, 'house')).not.toBe('clearing');
  });
});

describe('lumberjacks fell real trees', () => {
  function lumberCamp() {
    const { sim, s } = forestCamp();
    const c = s.civ!;
    // Skip the preparation: clear the centre by hand, then put a finished lumber camp east of it.
    for (const t of centreTrees(sim.world, s)) sim.settlements.forestry.fell(sim.world, t, 0);
    c.clear = [];
    const camp: Building = {
      id: c.nextBuildingId++, type: 'lumber', x: s.x + 4, y: s.y, started: 0, progress: 5, needed: 5, done: true,
      reserve: 0, acc: 0, active: false, idle: 0, empty: false, here: 0, level: 1, up: 0,
    };
    for (const t of siteTrees(sim.world, camp.x, camp.y)) sim.settlements.forestry.fell(sim.world, t, 0);
    c.buildings.push(camp);
    c.wood = 0;
    return { sim, s, c, camp };
  }

  it('one worker per tree; the felled tree is gone, a stump stands, and its wood is added exactly once', () => {
    const { sim, c } = lumberCamp();
    let credited = 0;
    let expected = 0;
    const W = sim.world.width;
    const watched = new Map<number, number>(); // tree tile → wood it holds
    for (let k = 0; k < 160; k++) {
      // Trees being cut: never two workers on one.
      const targets = c.jobs.filter((j) => j.t >= 0).map((j) => j.t);
      expect(new Set(targets).size).toBe(targets.length);
      for (const t of targets) if (!watched.has(t)) watched.set(t, woodOf(sim.world, t));
      const before = c.wood;
      steps(sim, 1);
      credited += c.wood - before;
      for (const [t, wood] of watched) {
        if (fellable(sim.world, t)) continue;
        // Felled: no tree, a stump (woodland became grass), its wood counted once.
        const x = t % W;
        const y = Math.floor(t / W);
        expect(treesOn(sim.world, x, y)).toBe(0);
        expect(sim.world.stump[t]).toBe(1);
        expect(sim.settlements.forestry.stumps.has(t)).toBe(true);
        expect(sim.world.terrain[t]).toBe(T.GRASS);
        expected += wood;
        watched.delete(t);
      }
    }
    expect(expected).toBeGreaterThanOrEqual(3 * WOOD_PER_TREE);
    expect(credited).toBeCloseTo(expected, 6); // wood comes only from felled trees, once each
  });

  it('workers stand beside their tree while cutting, and give it up when they die', () => {
    const { sim, c } = lumberCamp();
    let seen = false;
    const W = sim.world.width;
    for (let k = 0; k < 120 && !seen; k++) {
      steps(sim, 1);
      for (const j of c.jobs) {
        if (j.t < 0 || j.chop <= 0) continue;
        const i = sim.creatures.indexOf(j.id);
        if (sim.creatures.state[i] !== STATE.WORK) continue;
        const d = Math.hypot(sim.creatures.x[i] - (j.t % W) - 0.5, sim.creatures.y[i] - Math.floor(j.t / W) - 0.5);
        expect(d).toBeLessThan(2.3); // right next to the tree
        seen = true;
        // The worker dies: on the next step the tree is free again.
        const t = j.t;
        sim.creatures.removeById(j.id);
        steps(sim, 1);
        expect(c.jobs.some((x) => x.id === j.id)).toBe(false);
        expect(c.jobs.filter((x) => x.t === t).length).toBeLessThanOrEqual(1);
        break;
      }
    }
    expect(seen).toBe(true);
  });

  it('a save taken while a tree is being cut continues exactly: no wood twice, the same tree falls', () => {
    const { sim, c } = lumberCamp();
    for (let k = 0; k < 120 && !c.jobs.some((j) => j.chop > 2); k++) steps(sim, 1);
    expect(c.jobs.some((j) => j.chop > 2)).toBe(true);
    const data = serialize(sim);
    expect(data.version).toBe(SAVE_VERSION);
    const other = new Simulation(flat(8, 8));
    deserializeInto(other, data);
    const oc = other.settlements.list[0].civ!;
    expect(oc.jobs.map((j) => [j.id, j.t, j.at, j.chop])).toEqual(c.jobs.map((j) => [j.id, j.t, j.at, j.chop]));
    steps(sim, 30);
    steps(other, 30);
    expect(oc.wood).toBeCloseTo(c.wood, 9);
    expect(other.settlements.forestry.export()).toEqual(sim.settlements.forestry.export());
    expect(Array.from(other.world.terrain)).toEqual(Array.from(sim.world.terrain));
  });
});

describe('stumps and regrowth', () => {
  it('a stump rots after a while; forest grows back only after that, and never on built ground', () => {
    const w = flat(40, 40, T.GRASS);
    block(w, 0, 0, 39, 19, T.FOREST);
    const f = new Forestry();
    const i = 20 * 40 + 10; // grass right below the forest edge
    w.terrain[19 * 40 + 10] = T.FOREST;
    // Fell a forest tile: it becomes grass with a stump.
    const t = 19 * 40 + 12;
    expect(f.fell(w, t, 0)).toBeGreaterThanOrEqual(0);
    expect(w.terrain[t]).toBe(T.GRASS);
    const hadTrees = woodOf(w, t);
    expect(hadTrees).toBe(0); // its trees are gone
    const rng = new Rng(5);
    // Plenty of growth ticks before the stump rots: the stump tile stays grass.
    for (let k = 0; k < 4000; k++) vegetationTick(w, rng, 1);
    if (w.stump[t]) expect(w.terrain[t]).toBe(T.GRASS);
    // Built ground (a settlement keeps it clear) never turns to forest.
    w.built[i] = 1;
    for (let k = 0; k < 4000; k++) vegetationTick(w, rng, 1);
    expect(w.terrain[i]).toBe(T.GRASS);
    expect(treesOn(w, i % 40, Math.floor(i / 40))).toBe(0);
    // The stump rots on time.
    f.step(w, STUMP_ROT_TICKS - 20);
    expect(w.stump[t]).toBe(1);
    f.step(w, STUMP_ROT_TICKS);
    expect(w.stump[t]).toBe(0);
    expect(f.stumps.size).toBe(0);
  });
});

describe('building among trees', () => {
  it('a building whose site has trees waits for them to be cleared, then goes up', () => {
    const { sim, s } = forestCamp(ELF);
    const c = s.civ!;
    for (const t of centreTrees(sim.world, s)) sim.settlements.forestry.fell(sim.world, t, 0);
    c.clear = [];
    c.wood = 200;
    const b = startBuilding(sim.world, s, sim.settlements.owner, 'house', sim.tick) as Building;
    expect(typeof b).toBe('object');
    const trees = siteTrees(sim.world, b.x, b.y);
    expect(trees.length).toBeGreaterThan(0); // only forest around: the site had to be among trees
    for (const t of trees) expect(c.clear).toContain(t);
    let progressWhileTrees = 0;
    for (let k = 0; k < 300 && !b.done; k++) {
      const pending = siteTrees(sim.world, b.x, b.y).length > 0;
      steps(sim, 1);
      if (pending && siteTrees(sim.world, b.x, b.y).length > 0) progressWhileTrees = Math.max(progressWhileTrees, b.progress);
    }
    expect(progressWhileTrees).toBe(0);
    expect(b.done).toBe(true);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) expect(treesOn(sim.world, b.x + dx, b.y + dy)).toBe(0);
  });
});

describe('saves', () => {
  it('a version 14 save (no stumps, nothing to clear, jobs without a tree) loads and runs', () => {
    const { sim } = forestCamp();
    steps(sim, 5);
    const data = serialize(sim);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const old = structuredClone(data) as any;
    old.version = 14;
    delete old.stumps;
    for (const s of old.settlements.list) {
      delete s.civ.clear;
      delete s.civ.roads;
      delete s.civ.woodFlow;
      for (const j of s.civ.jobs) {
        delete j.t;
        delete j.at;
        delete j.chop;
      }
    }
    const other = new Simulation(flat(8, 8));
    deserializeInto(other, old);
    const c = other.settlements.list[0].civ!;
    expect(c.clear).toEqual([]);
    expect(c.jobs.every((j) => j.t === -1 && j.at === -1 && j.chop === 0)).toBe(true);
    expect(other.settlements.forestry.stumps.size).toBe(0);
    steps(other, 10);
    expect(other.settlements.list.length).toBe(1);
  });
});
