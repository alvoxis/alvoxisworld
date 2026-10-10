import { describe, expect, it } from 'vitest';
import { deserializeInto, serialize, SAVE_VERSION } from '../src/save/serialize';
import { ELF, HUMAN } from '../src/sim/creatures';
import { FORM_TICKS, MIN_AGE, MIN_POP, REACH, kingdomName, type Kingdom } from '../src/sim/kingdoms';
import { STEP_TICKS, type Settlement } from '../src/sim/settlements';
import { Simulation } from '../src/sim/simulation';
import { SEA_LEVEL, T } from '../src/world/terrain';
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

const run = (sim: Simulation, ticks: number) => {
  for (let t = 0; t < ticks; t++) sim.step();
};

/** Settlements founded by hand (as the test's starting point), with food so they stay populated. */
function world(spots: Array<[number, number, number]>, size: [number, number] = [260, 120]): { sim: Simulation; s: Settlement[] } {
  const w = flat(size[0], size[1]);
  for (const [, x, y] of spots) block(w, x - 2, y - 9, x + 2, y - 8, T.LAKE);
  const sim = quiet(w);
  sim.settlements.auto = false;
  sim.groups.enabled = false;
  const s: Settlement[] = [];
  for (const [sp, x, y] of spots) {
    sim.spawnInCircle(sp, x, y, 3, 11);
    const st = sim.foundSettlement(x, y, 'human') as Settlement;
    expect(typeof st).toBe('object');
    st.civ!.food = 60;
    s.push(st);
  }
  return { sim, s };
}

/** Runs until settlements are old enough and one formation check has passed. */
const mature = (sim: Simulation) => run(sim, MIN_AGE + FORM_TICKS + 20);

/** No settlement in two kingdoms, every member real and of the kingdom's people, the ruler alive and a subject. */
function checkKingdoms(sim: Simulation): void {
  const seen = new Set<number>();
  for (const k of sim.kingdoms.list) {
    expect(k.members.length).toBeGreaterThan(0);
    expect(k.members).toContain(k.capital);
    for (const sid of k.members) {
      expect(seen.has(sid)).toBe(false);
      seen.add(sid);
      const s = sim.settlements.get(sid)!;
      expect(s).toBeDefined();
      expect(s.species).toBe(k.species);
      expect(sim.kingdoms.kingdomOf(sid)).toBe(k);
    }
    if (k.ruler) {
      const i = sim.creatures.indexOf(k.ruler);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(sim.creatures.species[i]).toBe(k.species);
      expect(k.members).toContain(sim.settlements.settlementOf(k.ruler)!.id);
      expect(sim.creatures.stage(i)).not.toBe('Juvenile');
      expect(k.status).toBe('stable');
    } else expect(k.status).toBe('succession');
  }
}

describe('forming kingdoms', () => {
  it('a lone settlement stays independent; young settlements do not unite yet', () => {
    const { sim } = world([[HUMAN, 60, 60]]);
    mature(sim);
    expect(sim.kingdoms.list.length).toBe(0);
    const two = world([[HUMAN, 60, 60], [HUMAN, 90, 60]]);
    run(two.sim, MIN_AGE - 40);
    expect(two.sim.kingdoms.list.length).toBe(0); // not old enough
  });

  it('neighbouring settlements of one people unite into one kingdom with a capital and a living ruler', () => {
    const { sim, s } = world([[HUMAN, 60, 60], [HUMAN, 90, 60], [HUMAN, 120, 60]]);
    const before = s.map((x) => ({ id: x.id, members: [...x.members].sort(), buildings: x.civ!.buildings.length }));
    mature(sim);
    expect(sim.kingdoms.list.length).toBe(1);
    const k = sim.kingdoms.list[0];
    expect(k.species).toBe(HUMAN);
    expect(k.members.length).toBeGreaterThanOrEqual(2);
    expect(k.ruler).toBeGreaterThan(0);
    checkKingdoms(sim);
    // Joining changes no settlement: same ids, same buildings; people only change by births and deaths.
    for (const b of before) {
      const st = sim.settlements.get(b.id)!;
      expect(st).toBeDefined();
      expect(st.civ!.buildings.length).toBe(b.buildings);
    }
    expect(sim.history.filter((h) => h.code === 'kingdom_founded').length).toBe(1);
    expect(sim.history.filter((h) => h.code === 'kingdom_ruler').length).toBe(1);
  });

  it('a kingdom grows by one neighbour at a time and never takes far settlements or another people', () => {
    const { sim } = world([[HUMAN, 40, 60], [HUMAN, 70, 60], [HUMAN, 100, 60], [ELF, 70, 95], [HUMAN, 230, 60]], [260, 130]);
    mature(sim);
    const k = sim.kingdoms.list.find((x) => x.species === HUMAN)!;
    expect(k).toBeDefined();
    run(sim, FORM_TICKS * 2);
    const far = sim.settlements.list.find((x) => x.x === 230)!;
    expect(sim.kingdoms.kingdomOf(far.id)).toBeUndefined(); // 130 tiles away: stays independent
    const elf = sim.settlements.list.find((x) => x.species === ELF)!;
    expect(sim.kingdoms.kingdomOf(elf.id)?.species ?? ELF).toBe(ELF); // never in the human kingdom
    expect(k.members.length).toBe(3);
    checkKingdoms(sim);
  });

  it('humans and elves form separate kingdoms', () => {
    const { sim } = world([[HUMAN, 40, 40], [HUMAN, 70, 40], [ELF, 150, 80], [ELF, 180, 80]], [260, 130]);
    mature(sim);
    const species = sim.kingdoms.list.map((k) => k.species).sort();
    expect(species).toEqual([HUMAN, ELF].sort());
    checkKingdoms(sim);
  });

  it('settlements too small to stand on their own do not unite', () => {
    const { sim, s } = world([[HUMAN, 60, 60], [HUMAN, 90, 60]]);
    run(sim, MIN_AGE - 20); // just before the first check
    for (const st of s) for (const id of st.members.slice(MIN_POP - 3)) sim.creatures.removeById(id);
    run(sim, 40);
    expect(sim.kingdoms.list.length).toBe(0);
    // Unrest blocks it too: the same villages under pressure stay apart.
    const calm = world([[HUMAN, 60, 60], [HUMAN, 90, 60]]);
    run(calm.sim, MIN_AGE - 20);
    for (const st of calm.s) st.stress = 20;
    run(calm.sim, 40);
    expect(calm.sim.kingdoms.list.length).toBe(0);
    expect(REACH).toBeGreaterThan(30);
  });
});

describe('rulers', () => {
  function kingdom(): { sim: Simulation; k: Kingdom } {
    const { sim } = world([[HUMAN, 60, 60], [HUMAN, 90, 60]]);
    mature(sim);
    expect(sim.kingdoms.list.length).toBe(1);
    return { sim, k: sim.kingdoms.list[0] };
  }

  it('the ruler is the oldest adult of the capital', () => {
    const { sim, k } = kingdom();
    const cap = sim.settlements.get(k.capital)!;
    let oldest = 0;
    let age = -1;
    for (const id of cap.members) {
      const i = sim.creatures.indexOf(id);
      if (sim.creatures.stage(i) === 'Adult' && (sim.creatures.age[i] > age || (sim.creatures.age[i] === age && id < oldest))) {
        age = sim.creatures.age[i];
        oldest = id;
      }
    }
    expect(sim.kingdoms.chooseRuler(k, sim.creatures, sim.settlements)).toBe(oldest);
    expect(k.ruler).toBeGreaterThan(0);
  });

  it('a ruler who dies is removed at once and succeeded on the next step', () => {
    const { sim, k } = kingdom();
    const old = k.ruler;
    sim.creatures.removeById(old);
    expect(k.ruler).toBe(0); // never shown as ruling while dead
    expect(k.status).toBe('succession');
    run(sim, STEP_TICKS);
    expect(k.ruler).toBeGreaterThan(0);
    expect(k.ruler).not.toBe(old);
    expect(k.rulers.find((r) => r.id === old)?.end).toBe('died');
    expect(sim.history.filter((h) => h.code === 'kingdom_succession').length).toBe(1);
    checkKingdoms(sim);
  });

  it('a ruler who leaves the kingdom is replaced', () => {
    const { sim, k } = kingdom();
    const old = k.ruler;
    const i = sim.creatures.indexOf(old);
    sim.creatures.x[i] = 250.5; // far away: no longer a member of any settlement
    sim.creatures.y[i] = 110.5;
    run(sim, STEP_TICKS * 2);
    expect(k.ruler).not.toBe(old);
    expect(k.rulers.find((r) => r.id === old)?.end).toBe('left');
    checkKingdoms(sim);
  });

  it('when the capital is gone the kingdom moves its capital; with no settlements it dissolves, people stay alive', () => {
    const { sim, k } = kingdom();
    const capital = k.capital;
    const people = sim.settlements.get(capital)!.members.slice();
    // Everyone (and anyone who joins meanwhile) walks away: the capital is abandoned.
    const leave = (sid: number, y: number) => {
      for (let k2 = 0; k2 < 4 && sim.settlements.get(sid); k2++) {
        for (const id of sim.settlements.get(sid)!.members.slice()) {
          const i = sim.creatures.indexOf(id);
          sim.creatures.x[i] = 250.5;
          sim.creatures.y[i] = y;
        }
        run(sim, STEP_TICKS);
      }
    };
    leave(capital, 110.5);
    expect(sim.settlements.get(capital)).toBeUndefined();
    expect(k.members).not.toContain(capital);
    expect(k.capital).not.toBe(capital);
    expect(sim.history.some((h) => h.code === 'kingdom_capital')).toBe(true);
    for (const id of people) expect(sim.creatures.indexOf(id)).toBeGreaterThanOrEqual(0);
    checkKingdoms(sim);
    // The last settlement goes too: the kingdom dissolves.
    leave(k.capital, 5.5);
    run(sim, STEP_TICKS);
    expect(sim.kingdoms.list.length).toBe(0);
    expect(sim.history.filter((h) => h.code === 'kingdom_dissolved').length).toBe(1);
  });
});

describe('names, territory and events', () => {
  it('names are stable, follow the people and do not change over time', () => {
    expect(kingdomName(7, 1, HUMAN)).toBe(kingdomName(7, 1, HUMAN));
    expect(kingdomName(7, 1, HUMAN)).not.toBe(kingdomName(7, 1, ELF));
    const { sim } = world([[HUMAN, 60, 60], [HUMAN, 90, 60]]);
    mature(sim);
    const name = sim.kingdoms.list[0].name;
    run(sim, FORM_TICKS * 3);
    expect(sim.kingdoms.list[0].name).toBe(name);
  });

  it('territory is the territory of its settlements, and changes when a settlement joins', () => {
    const { sim } = world([[HUMAN, 40, 60], [HUMAN, 70, 60], [HUMAN, 100, 60]]);
    mature(sim);
    const k = sim.kingdoms.list[0];
    const sum = () => k.members.reduce((n, sid) => n + sim.settlements.get(sid)!.tiles.length, 0);
    expect(sim.kingdoms.totals(k, sim.settlements).tiles).toBe(sum());
    const v = sim.kingdoms.version;
    const n = k.members.length;
    run(sim, FORM_TICKS * 2);
    if (k.members.length > n) expect(sim.kingdoms.version).toBeGreaterThan(v);
    expect(sim.kingdoms.totals(k, sim.settlements).tiles).toBe(sum());
  });

  it('events are written once, not every step', () => {
    const { sim } = world([[HUMAN, 60, 60], [HUMAN, 90, 60]]);
    mature(sim);
    const count = () => sim.history.filter((h) => h.code?.startsWith('kingdom_')).length;
    const c = count();
    run(sim, FORM_TICKS * 2);
    expect(count() - c).toBeLessThanOrEqual(2); // at most a real succession, not a line per step
    expect(sim.kingdoms.list[0].events.length).toBeLessThanOrEqual(12);
  });
});

describe('saves and determinism', () => {
  it('kingdoms, membership and the ruler survive a save, and the world continues exactly', () => {
    const { sim } = world([[HUMAN, 60, 60], [HUMAN, 90, 60], [ELF, 150, 60], [ELF, 180, 60]]);
    mature(sim);
    expect(sim.kingdoms.list.length).toBe(2);
    const data = serialize(sim);
    expect(data.version).toBe(SAVE_VERSION);
    const other = quiet(flat(8, 8));
    deserializeInto(other, data);
    expect(other.kingdoms.exportState()).toEqual(sim.kingdoms.exportState());
    for (const k of other.kingdoms.list) for (const sid of k.members) expect(other.kingdoms.kingdomOf(sid)?.id).toBe(k.id);
    run(sim, 600);
    run(other, 600);
    expect(other.kingdoms.exportState()).toEqual(sim.kingdoms.exportState());
    expect(other.settlements.exportState()).toEqual(sim.settlements.exportState());
    checkKingdoms(other);
  });

  it('older saves load without kingdoms; invalid references are repaired without touching settlements', () => {
    const { sim } = world([[HUMAN, 60, 60], [HUMAN, 90, 60], [ELF, 150, 60]]);
    mature(sim);
    const data = serialize(sim);
    const old = { ...data, version: 12 } as typeof data;
    delete old.kingdoms;
    const a = quiet(flat(8, 8));
    deserializeInto(a, old);
    expect(a.kingdoms.list).toEqual([]);
    expect(a.settlements.list.length).toBe(sim.settlements.list.length);
    const elf = sim.settlements.list.find((s) => s.species === ELF)!;
    const bad = serialize(sim);
    const k = bad.kingdoms!.list[0];
    k.members = [...k.members, 999, elf.id, k.members[0]]; // a missing settlement, another people, a duplicate
    k.ruler = 424242; // nobody
    k.capital = 999;
    bad.kingdoms!.list.push({ ...k, id: 77, members: [k.members[0]] } as Kingdom, null as unknown as Kingdom, { id: 'x' } as unknown as Kingdom);
    const b = quiet(flat(8, 8));
    deserializeInto(b, bad);
    expect(b.settlements.list.length).toBe(sim.settlements.list.length);
    expect(b.kingdoms.list.length).toBe(1); // the copy that reused a settlement is dropped
    const kk = b.kingdoms.list[0];
    expect(kk.members).not.toContain(999);
    expect(kk.members).not.toContain(elf.id);
    expect(new Set(kk.members).size).toBe(kk.members.length);
    expect(kk.members).toContain(kk.capital);
    expect(kk.ruler).toBe(0);
    expect(kk.status).toBe('succession');
    run(b, STEP_TICKS);
    expect(kk.ruler).toBeGreaterThan(0);
    checkKingdoms(b);
  });

  it('is deterministic', () => {
    const make = () => {
      const { sim } = world([[HUMAN, 60, 60], [HUMAN, 90, 60], [HUMAN, 120, 60]]);
      run(sim, MIN_AGE + FORM_TICKS * 3);
      return JSON.stringify(sim.kingdoms.exportState());
    };
    expect(make()).toBe(make());
  });
});
