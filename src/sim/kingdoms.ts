import { updateWarfare } from './warfare';
import { updateDiplomacy } from './diplomacy';
/**
 * Kingdoms: a light political layer above settlements. Nothing here is decided by the player and no random numbers
 * are used: kingdoms emerge from settlements of one people that live near each other long enough, and a kingdom's
 * ruler is always a real living member of one of its settlements.
 *
 * A kingdom stores ids only (settlements, capital, ruler); population, territory and the rest are read from the
 * settlements and creatures when needed. Each settlement is in at most one kingdom (`kingdomOf`), or independent.
 *
 *  - `step()` runs every settlement step (20 ticks): it drops settlements that no longer exist, moves the capital
 *    when needed, dissolves a kingdom with no settlements left and replaces a ruler who died or left.
 *  - Every FORM_TICKS it also lets kingdoms form and grow (one settlement per kingdom per check).
 *  - A ruler's death clears the ruler at once (`onDeath`), so a dead ruler is never shown; the next step picks a
 *    successor. Until then the kingdom is in 'succession'.
 *
 * Not in this stage: wars, diplomacy, alliances, trade, splitting, royal families or elections.
 */
import { hash2 } from '../core/rng';
import type { World } from '../world/world';
import { SPECIES, type Creatures } from './creatures';
import type { Settlement, Settlements } from './settlements';

export const KINGDOM_STEP = 20;
/** How often kingdoms may form or take in a settlement (ticks). */
export const FORM_TICKS = 240;
/** A settlement needs this many people, this age (ticks) and little pressure to found or join a kingdom. */
export const MIN_POP = 8;
export const MIN_AGE = 960;
export const MAX_STRESS = 12;
/** Largest distance between settlement centres that still counts as neighbours, and from the capital. */
export const REACH = 48;
export const CAPITAL_REACH = 72;
export const MAX_MEMBERS = 8;
export const MAX_KINGDOMS = 6;
export const MAX_RULERS = 8;
export const MAX_EVENTS = 12;

export const KINGDOM_COLORS = ['#ffd166', '#c77dff', '#4cc9f0', '#ff5d8f', '#80ed99', '#ff9f43'] as const;

export type KingdomStatus = 'stable' | 'succession';

export interface RulerRecord {
  /** Creature id. */
  id: number;
  from: number;
  /** Tick the reign ended (-1 = still ruling). */
  to: number;
  /** Why it ended: 'died', 'left' (no longer a member), or '' while ruling. */
  end: '' | 'died' | 'left';
}

export interface KingdomEvent {
  tick: number;
  text: string;
  code: string;
  p: Record<string, string | number>;
}

export interface Kingdom {
  id: number;
  name: string;
  species: number;
  color: number;
  /** Settlement ids (unique, all alive, all of `species`). */
  members: number[];
  /** Capital: one of `members` (the most populous when it was chosen). */
  capital: number;
  /** Ruling creature id; 0 while in succession. */
  ruler: number;
  founded: number;
  status: KingdomStatus;
  rulers: RulerRecord[];
  events: KingdomEvent[];
}

const SYLLABLES: Record<string, readonly string[]> = {
  human: ['al', 'vor', 'ran', 'ten', 'mar', 'kel', 'dun', 'bar', 'hal', 'gor', 'ste', 'wen', 'rod', 'lin'],
  elven: ['ae', 'lin', 'thal', 'sil', 'va', 'ren', 'el', 'ith', 'lor', 'mir', 'nal', 'sae', 'quel', 'ya'],
};
const ENDINGS: Record<string, readonly string[]> = {
  human: ['ia', 'mark', 'heim', 'land', 'or', 'mere'],
  elven: ['ion', 'dor', 'wen', 'ath', 'iel', 'oth'],
};

/** Kingdom name in the style of its people, from the world seed and the kingdom id (stable, no random generator). */
export function kingdomName(seed: number, id: number, species: number, salt = 0): string {
  const style = SPECIES[species]?.civ?.architecture ?? 'human';
  const syl = SYLLABLES[style] ?? SYLLABLES.human;
  const end = ENDINGS[style] ?? ENDINGS.human;
  const n = 1 + (hash2(id, salt, seed ^ 0x6b1d) < 0.5 ? 1 : 0);
  let s = '';
  for (let k = 0; k < n; k++) s += syl[Math.floor(hash2(id * 13 + k, salt, seed ^ 0x2f9a) * syl.length)];
  s += end[Math.floor(hash2(id * 17, salt, seed ^ 0x77c1) * end.length)];
  return s[0].toUpperCase() + s.slice(1);
}

export class Kingdoms {
  list: Kingdom[] = [];
  nextId = 1;
  /** Bumped whenever membership changes (the renderer caches territory on it). */
  version = 0;
  private bySettlement = new Map<number, number>();
  /** Called for every history-worthy event (the simulation adds it to the world history). */
  onEvent: ((text: string, code: string, p: Record<string, string | number>) => void) | null = null;

  get(id: number): Kingdom | undefined {
    return this.list.find((k) => k.id === id);
  }

  /** The kingdom a settlement belongs to, if any. */
  kingdomOf(settlementId: number): Kingdom | undefined {
    const id = this.bySettlement.get(settlementId);
    return id ? this.get(id) : undefined;
  }

  /** The kingdom a creature rules, if any. */
  ruledBy(creatureId: number): Kingdom | undefined {
    return creatureId ? this.list.find((k) => k.ruler === creatureId) : undefined;
  }

  reset(): void {
    this.list = [];
    this.nextId = 1;
    this.bySettlement.clear();
    this.version++;
  }

  /** People and territory of a kingdom, read from its settlements. */
  totals(k: Kingdom, settlements: Settlements): { people: number; tiles: number } {
    let people = 0;
    let tiles = 0;
    for (const sid of k.members) {
      const s = settlements.get(sid);
      if (s) {
        people += s.members.length;
        tiles += s.tiles.length;
      }
    }
    return { people, tiles };
  }

  /** A creature died: if it ruled, the throne is empty at once (a successor is chosen on the next step). */
  onDeath(id: number, tick: number): void {
    const k = this.ruledBy(id);
    if (k) this.endReign(k, tick, 'died');
  }

  // ---- periodic update -------------------------------------------------------

  step(world: World, creatures: Creatures, settlements: Settlements, tick: number): void {
    updateDiplomacy(this.list, settlements, tick);
    updateWarfare(this.list, settlements, tick);
    if (tick % KINGDOM_STEP !== 0) return;
    if (this.list.length) this.maintain(creatures, settlements, tick);
    if (tick % FORM_TICKS === 0 && settlements.list.length > 1) this.form(world, creatures, settlements, tick);
  }

  /** Keeps every kingdom valid: real settlements only, a capital among them, a living ruler from them. */
  private maintain(creatures: Creatures, settlements: Settlements, tick: number): void {
    for (const k of [...this.list]) {
      const alive = k.members.filter((sid) => {
        const s = settlements.get(sid);
        return !!s && s.species === k.species && !!s.civ;
      });
      if (alive.length !== k.members.length) {
        for (const sid of k.members) if (!alive.includes(sid)) this.bySettlement.delete(sid);
        k.members = alive;
        this.version++;
      }
      if (!k.members.length) {
        this.dissolve(k, tick);
        continue;
      }
      if (!k.members.includes(k.capital)) {
        k.capital = this.mostPopulous(k.members, settlements);
        const cap = settlements.get(k.capital)!;
        this.event(k, tick, `${cap.name} became the capital of ${k.name}.`, 'kingdom_capital', { kingdom: k.name, name: cap.name });
      }
      // A ruler who is no longer a member of any of the kingdom's settlements has left the throne.
      if (k.ruler && !this.isSubject(k, k.ruler, creatures, settlements)) this.endReign(k, tick, 'left');
      if (!k.ruler) this.crown(k, creatures, settlements, tick);
    }
  }

  private isSubject(k: Kingdom, id: number, creatures: Creatures, settlements: Settlements): boolean {
    if (creatures.indexOf(id) < 0) return false;
    const s = settlements.settlementOf(id);
    return !!s && k.members.includes(s.id);
  }

  /**
   * The ruler is the oldest adult (not yet elderly) of the capital; if the capital has none, of any member settlement;
   * if there are only elders, the oldest elder. Ties go to the lower id. Children never rule.
   */
  chooseRuler(k: Kingdom, creatures: Creatures, settlements: Settlements): number {
    const order = [k.capital, ...k.members.filter((m) => m !== k.capital).sort((a, b) => a - b)];
    for (const elders of [false, true]) {
      for (const sid of [order[0], -1]) {
        let best = 0;
        let bestAge = -1;
        for (const s of sid === -1 ? order : [sid]) {
          for (const id of settlements.get(s)?.members ?? []) {
            const i = creatures.indexOf(id);
            if (i < 0 || creatures.species[i] !== k.species) continue;
            const st = creatures.stage(i);
            if (st === 'Juvenile' || (st === 'Elder') !== elders) continue;
            const age = creatures.age[i];
            if (age > bestAge || (age === bestAge && id < best)) {
              best = id;
              bestAge = age;
            }
          }
        }
        if (best) return best;
      }
    }
    return 0;
  }

  private crown(k: Kingdom, creatures: Creatures, settlements: Settlements, tick: number): void {
    const id = this.chooseRuler(k, creatures, settlements);
    if (!id) {
      k.status = 'succession'; // nobody old enough yet: the throne waits
      return;
    }
    const prev = k.rulers.length ? k.rulers[k.rulers.length - 1] : null;
    k.ruler = id;
    k.status = 'stable';
    k.rulers.push({ id, from: tick, to: -1, end: '' });
    if (k.rulers.length > MAX_RULERS) k.rulers.shift();
    if (prev && prev.to >= 0) {
      this.event(k, tick, `${k.name}: a new ruler (#${id}) succeeded #${prev.id}.`, 'kingdom_succession', { kingdom: k.name, ruler: id, prev: prev.id, species: k.species });
    } else {
      this.event(k, tick, `${k.name}: #${id} took power.`, 'kingdom_ruler', { kingdom: k.name, ruler: id, species: k.species });
    }
  }

  private endReign(k: Kingdom, tick: number, end: 'died' | 'left'): void {
    const r = k.rulers.find((x) => x.id === k.ruler && x.to < 0);
    if (r) {
      r.to = tick;
      r.end = end;
    }
    k.ruler = 0;
    k.status = 'succession';
  }

  private dissolve(k: Kingdom, tick: number): void {
    if (k.ruler) this.endReign(k, tick, 'left');
    for (const sid of k.members) this.bySettlement.delete(sid);
    this.list = this.list.filter((x) => x !== k);
    this.version++;
    this.onEvent?.(`${k.name} fell apart: no settlements are left.`, 'kingdom_dissolved', { kingdom: k.name });
  }

  private mostPopulous(ids: number[], settlements: Settlements): number {
    let best = ids[0];
    let bp = -1;
    for (const id of ids) {
      const n = settlements.get(id)?.members.length ?? 0;
      if (n > bp || (n === bp && id < best)) {
        best = id;
        bp = n;
      }
    }
    return best;
  }

  /** A settlement mature, settled and calm enough to found or join a kingdom. */
  eligible(s: Settlement, tick: number): boolean {
    return !!s.civ && !this.bySettlement.has(s.id) && s.members.length >= MIN_POP && tick - s.founded >= MIN_AGE && s.stress <= MAX_STRESS;
  }

  private connected(world: World, creatures: Creatures, a: Settlement, b: Settlement, reach: number): boolean {
    return Math.hypot(a.x - b.x, a.y - b.y) <= reach && creatures.reachable(world, a.species, a.x, a.y, b.x, b.y);
  }

  /**
   * Growth first: each kingdom takes in at most one eligible neighbour of its people (the nearest to any member,
   * also within reach of the capital). Then at most one new kingdom forms, from the eligible settlement with the most
   * eligible neighbours of its people (at least one), together with those neighbours.
   */
  private form(world: World, creatures: Creatures, settlements: Settlements, tick: number): void {
    for (const k of this.list) {
      if (k.members.length >= MAX_MEMBERS) continue;
      const cap = settlements.get(k.capital);
      if (!cap) continue;
      let pick: Settlement | null = null;
      let pd = Infinity;
      for (const s of settlements.list) {
        if (s.species !== k.species || !this.eligible(s, tick) || !this.connected(world, creatures, cap, s, CAPITAL_REACH)) continue;
        for (const sid of k.members) {
          const m = settlements.get(sid);
          if (!m) continue;
          const d = Math.hypot(m.x - s.x, m.y - s.y);
          if (d < pd && this.connected(world, creatures, m, s, REACH)) {
            pd = d;
            pick = s;
          }
        }
      }
      if (pick) this.join(k, pick, tick);
    }
    if (this.list.length >= MAX_KINGDOMS) return;
    let seed: Settlement | null = null;
    let partners: Settlement[] = [];
    for (const s of [...settlements.list].sort((a, b) => a.id - b.id)) {
      if (!this.eligible(s, tick)) continue;
      const near = settlements.list
        .filter((o) => o !== s && o.species === s.species && this.eligible(o, tick) && this.connected(world, creatures, s, o, REACH))
        .sort((a, b) => Math.hypot(a.x - s.x, a.y - s.y) - Math.hypot(b.x - s.x, b.y - s.y) || a.id - b.id)
        .slice(0, MAX_MEMBERS - 1);
      if (near.length > partners.length) {
        seed = s;
        partners = near;
      }
    }
    if (!seed || !partners.length) return;
    this.found(world, creatures, settlements, [seed, ...partners], tick);
  }

  private found(world: World, creatures: Creatures, settlements: Settlements, members: Settlement[], tick: number): Kingdom {
    const id = this.nextId++;
    const species = members[0].species;
    let salt = 0;
    let name = kingdomName(world.seed, id, species);
    while (this.list.some((k) => k.name === name) && salt < 50) name = kingdomName(world.seed, id, species, ++salt);
    const ids = members.map((s) => s.id);
    const k: Kingdom = {
      id, name, species, color: (id - 1) % KINGDOM_COLORS.length, members: ids, capital: this.mostPopulous(ids, settlements), ruler: 0, founded: tick,
      status: 'succession', rulers: [], events: [],
    };
    this.list.push(k);
    for (const sid of ids) this.bySettlement.set(sid, id);
    this.version++;
    const cap = settlements.get(k.capital)!;
    this.event(k, tick, `The kingdom of ${name} was founded by ${members.length} settlements (capital ${cap.name}).`, 'kingdom_founded', {
      kingdom: name, n: members.length, name: cap.name, species,
    });
    this.crown(k, creatures, settlements, tick);
    return k;
  }

  private join(k: Kingdom, s: Settlement, tick: number): void {
    k.members.push(s.id);
    this.bySettlement.set(s.id, k.id);
    this.version++;
    this.event(k, tick, `${s.name} joined the kingdom of ${k.name}.`, 'kingdom_joined', { kingdom: k.name, name: s.name });
  }

  private event(k: Kingdom, tick: number, text: string, code: string, p: Record<string, string | number>): void {
    k.events.push({ tick, text, code, p });
    if (k.events.length > MAX_EVENTS) k.events.shift();
    this.onEvent?.(text, code, p);
  }

  // ---- saving ----------------------------------------------------------------

  exportState(): KingdomsSave {
    return { nextId: this.nextId, list: JSON.parse(JSON.stringify(this.list)) as Kingdom[] };
  }

  /**
   * Restores kingdoms, keeping only what is valid: real settlements of the kingdom's people that are in no other
   * kingdom, a capital among them, a living ruler who is a member of one of them (otherwise the kingdom waits for
   * a successor). Kingdoms with no valid settlement are dropped; settlements and creatures are never touched.
   */
  importState(save: KingdomsSave | undefined, world: World, creatures: Creatures, settlements: Settlements): void {
    this.reset();
    if (!save || !Array.isArray(save.list)) return;
    const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
    const ids = new Set<number>();
    for (const raw of save.list.slice(0, 64)) {
      if (!raw || typeof raw !== 'object') continue;
      const id = Math.floor(num(raw.id, 0, 1e9, 0));
      const species = Math.floor(num(raw.species, 0, SPECIES.length - 1, -1));
      if (!id || ids.has(id) || species < 0 || !SPECIES[species].civ) continue;
      const members: number[] = [];
      for (const sid of Array.isArray(raw.members) ? raw.members : []) {
        const s = typeof sid === 'number' ? settlements.get(sid) : undefined;
        if (s && s.species === species && s.civ && !this.bySettlement.has(sid) && !members.includes(sid)) members.push(sid);
      }
      if (!members.length) continue;
      ids.add(id);
      const rulers: RulerRecord[] = [];
      for (const r of (Array.isArray(raw.rulers) ? raw.rulers : []).slice(-MAX_RULERS)) {
        if (r && typeof r.id === 'number' && Number.isInteger(r.id)) {
          rulers.push({ id: r.id, from: num(r.from, 0, 1e12, 0), to: num(r.to, -1, 1e12, -1), end: r.end === 'died' || r.end === 'left' ? r.end : '' });
        }
      }
      const events: KingdomEvent[] = [];
      for (const e of (Array.isArray(raw.events) ? raw.events : []).slice(-MAX_EVENTS)) {
        if (e && typeof e.text === 'string' && typeof e.code === 'string' && typeof e.tick === 'number') {
          const p: Record<string, string | number> = {};
          for (const [k2, v] of Object.entries(e.p ?? {})) if (typeof v === 'string' || typeof v === 'number') p[k2] = v;
          events.push({ tick: e.tick, text: e.text.slice(0, 200), code: e.code.slice(0, 40), p });
        }
      }
      const k: Kingdom = {
        id, species, members, events, rulers,
        name: typeof raw.name === 'string' && raw.name ? raw.name.slice(0, 32) : kingdomName(world.seed, id, species),
        color: Math.floor(num(raw.color, 0, KINGDOM_COLORS.length - 1, 0)),
        capital: members.includes(raw.capital) ? raw.capital : this.mostPopulous(members, settlements),
        ruler: 0, founded: num(raw.founded, 0, 1e12, 0), status: 'succession',
      };
      for (const sid of members) this.bySettlement.set(sid, id);
      // The ruler must be a living member of one of these settlements; otherwise the next step picks one.
      const r = typeof raw.ruler === 'number' ? raw.ruler : 0;
      if (r && this.isSubject(k, r, creatures, settlements) && creatures.species[creatures.indexOf(r)] === species) {
        k.ruler = r;
        k.status = 'stable';
        if (!k.rulers.some((x) => x.id === r && x.to < 0)) k.rulers.push({ id: r, from: num(raw.founded, 0, 1e12, 0), to: -1, end: '' });
      } else {
        for (const x of k.rulers) {
          if (x.to >= 0) continue;
          x.to = Math.max(x.from, 0);
          x.end = 'left';
        }
      }
      this.list.push(k);
    }
    this.nextId = Math.max(Math.floor(num(save.nextId, 1, 1e9, 1)), ...this.list.map((k) => k.id + 1), 1);
    this.version++;
  }
}

/** Saved form (save format 13). */
export interface KingdomsSave {
  nextId: number;
  list: Kingdom[];
}
