/**
 * Settlements: the foundation for later states, research and diplomacy.
 *
 * There are no people in the game yet, so a settlement here is a home area of a group of
 * one existing land species (grazers, raptors or hadrosaurs). Everything shown is derived
 * from the real simulation: members are real creatures (by id), the population is how many
 * of them are alive, the territory is the real land around the centre, and nothing is
 * invented. No random numbers are used, so the rules are deterministic.
 *
 *  - Founding is the player's action (`Settlements.canFound` / `found`).
 *  - `step()` runs every STEP_TICKS: dead members drop out, creatures of the species
 *    that live inside the territory join, members that wandered far away leave, the
 *    territory radius follows the population, and a settlement with no animals is abandoned.
 *  - Newborns of a member join at once (`onBirth`), so births are counted exactly.
 */
import { hash2 } from '../core/rng';
import { T, isWater } from '../world/terrain';
import type { World } from '../world/world';
import { SPECIES, type Creatures } from './creatures';
import { MOVE, passable } from './pathfinding';
import {
  RADIUS_BONUS, civStep, exportCiv, housing, importCiv, jobKind, newCiv, startBuilding, startResearch, startUpgrade, type JobKind, type UpgradeFail,
  type Building, type BuildFail, type BuildingType, type Civ, type CivHost, type CivSave, type TechId,
} from './civ';

export const STEP_TICKS = 20;
/** Creatures needed within FOUND_RADIUS tiles of the spot, all of one species and not yet in a settlement. */
export const MIN_FOUNDERS = 6;
export const FOUND_RADIUS = 8;
/** Share of land tiles around the spot that the species can eat (only for species that graze). */
export const MIN_FOOD_SHARE = 0.2;
export const MAX_SETTLEMENTS = 12;
/** A member farther than radius + LEAVE_MARGIN from the centre has moved away. */
export const LEAVE_MARGIN = 4;
/** Ticks between status samples (growing / stable / declining). */
export const STATUS_TICKS = 100;
/** Fewer animals than this for DISSOLVE_TICKS ticks dissolves the settlement. */
export const MIN_VIABLE = 2;
export const DISSOLVE_TICKS = 300;
export const MAX_EVENTS = 20;
/** Population milestones that are written to the history. */
export const MILESTONES = [10, 25, 50, 100, 200, 400] as const;
/** Pressure points that make part of a people leave, how long they cannot return, and the least time between departures. */
export const EMIGRATE_STRESS = 24;
export const EMIGRATE_MIN_POP = 8;
export const EMIGRATE_BAN_TICKS = 480;
export const EMIGRATE_COOLDOWN = 960;
export const MIN_EMIGRANTS = 3;
export const MIN_RADIUS = 6;
export const MAX_RADIUS = 18;
/** Largest territory radius including the stage bonus of a town. */
export const MAX_RADIUS_TOTAL = MAX_RADIUS + RADIUS_BONUS.town;
/** A settlement needs at least this much connected land. */
export const MIN_TERRITORY = 20;

export const COLORS = ['#e6584c', '#3f8fe0', '#e0b030', '#46b86a', '#b165d6', '#e8843a', '#2cb5b0', '#d9588e'] as const;

export type SettlementStatus = 'founding' | 'growing' | 'stable' | 'declining' | 'fading';

export interface SettlementEvent {
  tick: number;
  /** English text (for old tools and tests) with a code and values for the interface. */
  text: string;
  code: string;
  p: Record<string, string | number>;
}

export interface Settlement {
  id: number;
  name: string;
  /** Species of the animals that live here. */
  species: number;
  color: number;
  /** Centre tile. */
  x: number;
  y: number;
  founded: number;
  radius: number;
  /** Creature ids that belong here. */
  members: number[];
  peak: number;
  born: number;
  died: number;
  joined: number;
  left: number;
  status: SettlementStatus;
  /** Population at the last status sample, and when it was taken. */
  prevPop: number;
  sampleTick: number;
  /** Tick since which the population has been below MIN_VIABLE (-1 = not below). */
  lowSince: number;
  events: SettlementEvent[];
  /** Pressure built up by famine, fire and crowding (human settlements); at EMIGRATE_STRESS part of the people leave. */
  stress: number;
  lastEmigration: number;
  /** Economy of a human settlement (resources, buildings, technologies); absent for animal settlements. */
  civ?: Civ;
  // ---- derived from the world, never saved ----
  /** Tile indices of the territory. */
  tiles: Int32Array;
  /** Border segments: (tileIndex << 2) | side (0 top, 1 right, 2 bottom, 3 left) where the neighbour is not ours. */
  edges: Int32Array;
}

export type FoundFail = 'ground' | 'claimed' | 'few' | 'food' | 'max';
export type SettlementKind = 'animal' | 'human';
export interface FoundOptions {
  /** Fewest free creatures needed (default MIN_FOUNDERS). */
  minFounders?: number;
  /** Only this species may found (default: the most numerous eligible one). */
  species?: number;
}
export type FoundCheck = { ok: true; species: number; founders: number[] } | { ok: false; reason: FoundFail };

/** Radius of the territory for a population. */
export function radiusFor(population: number): number {
  return Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, Math.round(5 + 1.4 * Math.sqrt(Math.max(0, population)))));
}

const SYLLABLES = ['al', 'vo', 'ra', 'ten', 'mir', 'sa', 'kel', 'dun', 'or', 'ha', 'lis', 'bar', 'nel', 'tho', 've', 'ka', 'zu', 'em'];

/** Place name from the world seed and the settlement id (no random generator involved). */
export function nameFor(seed: number, id: number, salt = 0): string {
  const n = 2 + (hash2(id, salt, seed ^ 0x9e3779b1) < 0.4 ? 1 : 0);
  let s = '';
  for (let k = 0; k < n; k++) s += SYLLABLES[Math.floor(hash2(id * 7 + k, salt, seed ^ 0x51ed270b) * SYLLABLES.length)];
  return s[0].toUpperCase() + s.slice(1);
}

export class Settlements {
  list: Settlement[] = [];
  nextId = 1;
  /** Territory owner per tile (0 = nobody). Allocated only while settlements exist. */
  owner: Uint16Array | null = null;
  /** Bumped whenever territories change (the renderer and card can cache on it). */
  version = 0;
  private width = 0;
  private height = 0;
  private memberOf = new Map<number, number>();
  /** Workplace tile of every worker (creature id → tile), rebuilt from the jobs each step. */
  private workTile = new Map<number, number>();
  private workKindOf = new Map<number, JobKind>();
  private terrainVersion = -1;
  private dirty = false;
  /** Settlements run themselves (build, research) unless the player turns it off. */
  auto = true;
  /** People who left a settlement cannot rejoin that one before `until` (creature id → settlement and tick). */
  bans = new Map<number, { sid: number; until: number }>();
  /** Told when part of a settlement leaves (the groups system takes them in). */
  onEmigrate: ((ids: number[], s: Settlement, tick: number) => void) | null = null;
  /** Told when a free creature becomes a member (joins or founds), so the groups system lets it go at once. */
  onJoin: ((id: number) => void) | null = null;
  /** Called for every history-worthy event (the simulation adds it to the world history). */
  onEvent: ((text: string, code: string, p: Record<string, string | number>) => void) | null = null;

  get(id: number): Settlement | undefined {
    return this.list.find((s) => s.id === id);
  }

  /** Settlement whose territory covers the tile, if any. */
  ownerAt(x: number, y: number): Settlement | undefined {
    if (!this.owner || x < 0 || y < 0 || x >= this.width || y >= this.height) return undefined;
    const id = this.owner[y * this.width + x];
    return id ? this.get(id) : undefined;
  }

  /** The settlement a creature belongs to, if any. */
  settlementOf(id: number): Settlement | undefined {
    const sid = this.memberOf.get(id);
    return sid ? this.get(sid) : undefined;
  }

  /** Tile a worker should be at (-1 = no job). Used by the creatures every few ticks, so it is a map lookup. */
  workGoal(id: number): number {
    return this.workTile.get(id) ?? -1;
  }

  /** Kind of work of a worker (for drawing). */
  workKind(id: number): JobKind | undefined {
    return this.workKindOf.get(id);
  }

  /** Population: members that are alive (members are pruned every step, so this is the live count). */
  population(s: Settlement): number {
    return s.members.length;
  }

  reset(): void {
    this.list = [];
    this.nextId = 1;
    this.owner = null;
    this.bans.clear();
    this.memberOf.clear();
    this.workTile.clear();
    this.workKindOf.clear();
    this.terrainVersion = -1;
    this.dirty = false;
    this.version++;
  }

  // ---- founding ---------------------------------------------------------------

  canFound(world: World, creatures: Creatures, x: number, y: number, kind: SettlementKind = 'animal', opts: FoundOptions = {}): FoundCheck {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (this.list.length >= MAX_SETTLEMENTS || this.nextId > 65535) return { ok: false, reason: 'max' };
    if (!world.inBounds(tx, ty)) return { ok: false, reason: 'ground' };
    const id = world.terrain[world.idx(tx, ty)];
    if (isWater(id) || id === T.MOUNTAIN || id === T.SNOW || !passable(world, kind === 'human' ? MOVE.LOWLAND : MOVE.LAND, tx, ty)) return { ok: false, reason: 'ground' };
    if (this.ownerAt(tx, ty)) return { ok: false, reason: 'claimed' };
    // Free creatures of each land species around the spot.
    // Free creatures of each land species around the spot. A settlement holds one species only: people form
    // human settlements and animals form animal settlements, never a mix.
    const free: number[][] = SPECIES.map(() => []);
    for (let i = 0; i < creatures.count; i++) {
      if (!creatures.isAlive(i) || this.memberOf.has(creatures.id[i])) continue;
      const sp = SPECIES[creatures.species[i]];
      if (sp.habitat !== 'land' || !!sp.sentient !== (kind === 'human') || (opts.species !== undefined && sp.id !== opts.species)) continue;
      if (Math.hypot(creatures.x[i] - x, creatures.y[i] - y) <= FOUND_RADIUS) free[sp.id].push(creatures.id[i]);
    }
    let best = -1;
    for (let s = 0; s < free.length; s++) if (free[s].length >= (opts.minFounders ?? MIN_FOUNDERS) && (best < 0 || free[s].length > free[best].length)) best = s;
    if (best < 0) return { ok: false, reason: 'few' };
    const food = SPECIES[best].food;
    if (food.length) {
      let land = 0;
      let eats = 0;
      for (let yy = Math.max(0, ty - 6); yy <= Math.min(world.height - 1, ty + 6); yy++) {
        for (let xx = Math.max(0, tx - 6); xx <= Math.min(world.width - 1, tx + 6); xx++) {
          if (Math.hypot(xx - tx, yy - ty) > 6) continue;
          const t = world.terrain[world.idx(xx, yy)];
          if (isWater(t)) continue;
          land++;
          if (food.includes(t)) eats++;
        }
      }
      if (!land || eats / land < MIN_FOOD_SHARE) return { ok: false, reason: 'food' };
    }
    return { ok: true, species: best, founders: free[best] };
  }

  found(world: World, creatures: Creatures, tick: number, x: number, y: number, kind: SettlementKind = 'animal', opts: FoundOptions = {}): Settlement | FoundFail {
    const check = this.canFound(world, creatures, x, y, kind, opts);
    if (!check.ok) return check.reason;
    this.ensureLayer(world);
    const id = this.nextId++;
    let salt = 0;
    let name = nameFor(world.seed, id, salt);
    while (this.list.some((s) => s.name === name) && salt < 50) name = nameFor(world.seed, id, ++salt);
    const pop = check.founders.length;
    const s: Settlement = {
      id, name, species: check.species, color: (id - 1) % COLORS.length, x: Math.floor(x), y: Math.floor(y),
      founded: tick, radius: radiusFor(pop), members: check.founders.slice(), peak: pop, born: 0, died: 0, joined: pop, left: 0,
      status: 'founding', prevPop: pop, sampleTick: tick, lowSince: -1, stress: 0, lastEmigration: tick, events: [], tiles: new Int32Array(0), edges: new Int32Array(0),
    };
    if (SPECIES[s.species].sentient) s.civ = newCiv();
    this.list.push(s);
    for (const m of s.members) this.memberOf.set(m, id);
    this.dirty = true;
    this.recomputeTerritory(world);
    if (s.tiles.length < MIN_TERRITORY) {
      // Too little connected land (a tiny island or a ledge): not a place to settle.
      this.list = this.list.filter((x) => x !== s);
      for (const m of s.members) this.memberOf.delete(m);
      this.nextId--;
      this.dirty = true;
      this.recomputeTerritory(world);
      return 'ground';
    }
    for (const m of s.members) this.onJoin?.(m);
    this.event(s, tick, `${name} was founded (${SPECIES[s.species].plural.toLowerCase()}, ${pop}).`, 'settlement_founded', { name, species: s.species, n: pop });
    return s;
  }

  /** A creature was born: it belongs to its parent's settlement. */
  onBirth(childId: number, parentId: number): void {
    const sid = this.memberOf.get(parentId);
    if (!sid) return;
    const s = this.get(sid);
    if (!s) return;
    s.members.push(childId);
    this.memberOf.set(childId, sid);
    s.born++;
    s.peak = Math.max(s.peak, s.members.length);
  }

  /** A creature died or was removed: it leaves its settlement at once, so the population is always exact. */
  onDeath(id: number): void {
    this.workTile.delete(id);
    const sid = this.memberOf.get(id);
    if (!sid) return;
    this.memberOf.delete(id);
    const s = this.get(sid);
    if (!s) return;
    const k = s.members.indexOf(id);
    if (k >= 0) s.members.splice(k, 1);
    s.died++;
  }

  // ---- human settlements: buildings and research (player actions) ---------------------

  build(world: World, s: Settlement, type: BuildingType, tick: number): Building | BuildFail | 'none' {
    if (!s.civ) return 'none';
    const b = startBuilding(world, s, this.owner, type, tick);
    if (typeof b === 'object') this.version++;
    return b;
  }

  /** Upgrades the next house of a human settlement (the card's Upgrade button). */
  upgradeHouse(s: Settlement): Building | UpgradeFail | 'no-civ' {
    if (!s.civ) return 'no-civ';
    const b = startUpgrade(s.civ);
    if (typeof b === 'object') this.version++;
    return b;
  }

  research(s: Settlement, id: TechId): ReturnType<typeof startResearch> | 'none' {
    return s.civ ? startResearch(s.civ, id) : 'none';
  }

  /** Whether a creature may breed: people in a settlement with full housing may not. */
  breedBlocked(id: number): boolean {
    const sid = this.memberOf.get(id);
    if (!sid) return false;
    const s = this.get(sid);
    return !!s?.civ && s.members.length >= housing(s.civ);
  }

  // ---- periodic update --------------------------------------------------------

  step(world: World, creatures: Creatures, tick: number): void {
    if (!this.list.length || tick % STEP_TICKS !== 0) return;
    this.creaturesRef = creatures;
    for (const [id, b] of this.bans) if (b.until <= tick) this.bans.delete(id);
    // Members that are gone have died (or been removed by the player).
    for (const s of this.list) {
      const alive: number[] = [];
      for (const m of s.members) {
        if (creatures.indexOf(m) >= 0) alive.push(m);
        else {
          this.memberOf.delete(m);
          s.died++;
        }
      }
      s.members = alive;
    }
    // One pass over the creatures: free ones inside a territory join it; members that moved far away leave.
    for (let i = 0; i < creatures.count; i++) {
      if (!creatures.isAlive(i)) continue;
      const cid = creatures.id[i];
      const cx = creatures.x[i];
      const cy = creatures.y[i];
      const owned = this.memberOf.get(cid);
      if (owned) {
        const s = this.get(owned)!;
        if (Math.hypot(cx - s.x - 0.5, cy - s.y - 0.5) > s.radius + LEAVE_MARGIN) {
          s.members.splice(s.members.indexOf(cid), 1);
          this.memberOf.delete(cid);
          s.left++;
        }
        continue;
      }
      let best: Settlement | undefined;
      let bestD = Infinity;
      for (const s of this.list) {
        if (s.species !== creatures.species[i]) continue;
        if (s.civ && s.members.length >= housing(s.civ)) continue; // no room: the person stays free
        const ban = this.bans.get(cid);
        if (ban && ban.sid === s.id && ban.until > tick) continue; // recently left this settlement
        const d = Math.hypot(cx - s.x - 0.5, cy - s.y - 0.5);
        if (d <= s.radius && d < bestD) {
          best = s;
          bestD = d;
        }
      }
      if (best) {
        best.members.push(cid);
        this.memberOf.set(cid, best.id);
        this.onJoin?.(cid);
        best.joined++;
      }
    }
    // Growth, status, milestones, disappearance.
    const host: CivHost = {
      world, creatures, owner: this.owner!, tick, auto: this.auto,
      event: (st, text, code, p) => this.event(st, tick, text, code, p),
    };
    for (const s of [...this.list]) {
      const pop = s.members.length;
      const before = s.peak;
      s.peak = Math.max(s.peak, pop);
      for (const m of MILESTONES) if (before < m && s.peak >= m) this.event(s, tick, `${s.name} reached ${m} animals.`, 'settlement_milestone', { name: s.name, n: m });
      if (pop === 0) {
        this.remove(s, `${s.name} was abandoned: no animals left.`, 'settlement_abandoned');
        continue;
      }
      if (pop < MIN_VIABLE) {
        if (s.lowSince < 0) s.lowSince = tick;
        if (tick - s.lowSince >= DISSOLVE_TICKS) {
          this.remove(s, `${s.name} dissolved: too few animals remained.`, 'settlement_dissolved');
          continue;
        }
      } else s.lowSince = -1;
      if (s.civ && this.owner) {
        const pressure = civStep(host, s);
        s.stress = pressure > 0 ? Math.min(100, s.stress + pressure) : Math.max(0, s.stress - 2);
        if (s.stress >= EMIGRATE_STRESS && s.members.length >= EMIGRATE_MIN_POP && tick - s.lastEmigration >= EMIGRATE_COOLDOWN) this.emigrate(s, tick);
      }
      const r = Math.min(MAX_RADIUS_TOTAL, radiusFor(pop) + (s.civ ? RADIUS_BONUS[s.civ.stage] : 0));
      if (r !== s.radius) {
        s.radius = r;
        this.dirty = true;
      }
      if (tick - s.sampleTick >= STATUS_TICKS) {
        const delta = pop - s.prevPop;
        const need = Math.max(1, Math.round(s.prevPop * 0.05));
        s.status = pop < MIN_VIABLE ? 'fading' : delta >= need ? 'growing' : -delta >= need ? 'declining' : 'stable';
        s.prevPop = pop;
        s.sampleTick = tick;
      } else if (pop < MIN_VIABLE) s.status = 'fading';
    }
    this.rebuildWork(world);
    // The land can change under a settlement (floods, craters, snow): territories follow.
    if (world.passVersion !== this.terrainVersion) this.dirty = true;
    if (this.dirty) this.recomputeTerritory(world);
  }

  /**
   * Part of a people leaves a settlement that cannot keep them (famine, fire, crowding). The ones living
   * farthest from the centre go; at least four stay. They are alive, free, and may not return to this
   * settlement for a while; the groups system lets them look for a new home.
   */
  private emigrate(s: Settlement, tick: number): void {
    const byDist = [...s.members].sort((a, b) => a - b);
    const n = Math.min(s.members.length - 4, Math.max(MIN_EMIGRANTS, Math.ceil(s.members.length * 0.35)));
    if (n < MIN_EMIGRANTS) return;
    const ids = this.pickLeavers(s, byDist, n);
    if (s.civ) s.civ.jobs = s.civ.jobs.filter((j) => !ids.includes(j.id));
    for (const id of ids) {
      this.workTile.delete(id);
      s.members.splice(s.members.indexOf(id), 1);
      this.memberOf.delete(id);
      this.bans.set(id, { sid: s.id, until: tick + EMIGRATE_BAN_TICKS });
    }
    s.left += ids.length;
    s.stress = Math.floor(s.stress / 2);
    s.lastEmigration = tick;
    this.event(s, tick, `${s.name}: ${ids.length} people left to look for a new home.`, 'settlement_emigrated', { name: s.name, n: ids.length });
    this.onEmigrate?.(ids, s, tick);
  }

  private creaturesRef: Creatures | null = null;

  private rebuildWork(world: World): void {
    this.workTile.clear();
    this.workKindOf.clear();
    for (const s of this.list) {
      if (!s.civ) continue;
      for (const j of s.civ.jobs) {
        const b = s.civ.buildings.find((x) => x.id === j.b);
        const kind = b && jobKind(b);
        if (!b || !kind) continue;
        this.workTile.set(j.id, b.y * world.width + b.x);
        this.workKindOf.set(j.id, kind);
      }
    }
  }

  private pickLeavers(s: Settlement, ids: number[], n: number): number[] {
    const c = this.creaturesRef;
    if (!c) return ids.slice(0, n);
    const d = (id: number) => {
      const i = c.indexOf(id);
      return i < 0 ? 0 : Math.hypot(c.x[i] - s.x, c.y[i] - s.y);
    };
    return ids.sort((a, b) => d(b) - d(a) || a - b).slice(0, n);
  }

  private remove(s: Settlement, text: string, code: string): void {
    for (const m of s.members) {
      this.memberOf.delete(m);
      this.workTile.delete(m);
    }
    this.list = this.list.filter((x) => x !== s);
    this.onEvent?.(text, code, { name: s.name });
    this.dirty = true;
  }

  private event(s: Settlement, tick: number, text: string, code: string, p: Record<string, string | number>): void {
    s.events.push({ tick, text, code, p });
    if (s.events.length > MAX_EVENTS) s.events.shift();
    this.onEvent?.(text, code, p);
  }

  // ---- territory -------------------------------------------------------------

  private ensureLayer(world: World): void {
    if (!this.owner || this.width !== world.width || this.height !== world.height) {
      this.width = world.width;
      this.height = world.height;
      this.owner = new Uint16Array(world.width * world.height);
    }
  }

  /**
   * Rebuilds every territory: land tiles (passable for the species) within the radius of the centre,
   * earlier settlements keep contested tiles. Cost is a few thousand tiles, and it runs only when
   * something changed (founding, radius, disappearance, terrain), never per frame.
   */
  recomputeTerritory(world: World): void {
    if (!this.list.length) {
      this.owner = null;
      this.terrainVersion = world.passVersion;
      this.dirty = false;
      this.version++;
      return;
    }
    this.ensureLayer(world);
    const owner = this.owner!;
    owner.fill(0);
    const W = world.width;
    for (const s of [...this.list].sort((a, b) => a.id - b.id)) {
      const cls = SPECIES[s.species].move;
      const r = s.radius;
      const x0 = Math.max(0, s.x - r);
      const y0 = Math.max(0, s.y - r);
      const bw = Math.min(world.width - 1, s.x + r) - x0 + 1;
      const bh = Math.min(world.height - 1, s.y + r) - y0 + 1;
      // Candidate tiles: land the species can stand on, in range and not claimed before.
      const cand = new Uint8Array(bw * bh);
      let seed = -1;
      let seedD = Infinity;
      for (let y = y0; y < y0 + bh; y++) {
        for (let x = x0; x < x0 + bw; x++) {
          const d = Math.hypot(x - s.x, y - s.y);
          if (d > r) continue;
          const i = y * W + x;
          if (owner[i] || !passable(world, cls, x, y) || isWater(world.terrain[i])) continue; // water is not home ground
          cand[(y - y0) * bw + (x - x0)] = 1;
          if (d < seedD) {
            seedD = d;
            seed = (y - y0) * bw + (x - x0);
          }
        }
      }
      // Only land connected to the centre (4-neighbours) counts: a river or lake cuts the territory.
      const out: number[] = [];
      if (seed >= 0) {
        const queue = [seed];
        cand[seed] = 2;
        for (let q = 0; q < queue.length; q++) {
          const c = queue[q];
          const cx = c % bw;
          const cy = (c - cx) / bw;
          out.push((cy + y0) * W + cx + x0);
          for (const n of [cx > 0 ? c - 1 : -1, cx < bw - 1 ? c + 1 : -1, cy > 0 ? c - bw : -1, cy < bh - 1 ? c + bw : -1]) {
            if (n >= 0 && cand[n] === 1) {
              cand[n] = 2;
              queue.push(n);
            }
          }
        }
      }
      out.sort((a, b) => a - b);
      for (const i of out) owner[i] = s.id;
      s.tiles = Int32Array.from(out);
    }
    for (const s of this.list) {
      const edges: number[] = [];
      for (const i of s.tiles) {
        const x = i % W;
        const y = (i - x) / W;
        if (y === 0 || owner[i - W] !== s.id) edges.push(i << 2);
        if (x === W - 1 || owner[i + 1] !== s.id) edges.push((i << 2) | 1);
        if (y === world.height - 1 || owner[i + W] !== s.id) edges.push((i << 2) | 2);
        if (x === 0 || owner[i - 1] !== s.id) edges.push((i << 2) | 3);
      }
      s.edges = Int32Array.from(edges);
    }
    this.terrainVersion = world.passVersion;
    this.dirty = false;
    this.version++;
  }

  // ---- saving ----------------------------------------------------------------

  exportState(): SettlementsSave {
    return {
      nextId: this.nextId,
      auto: this.auto,
      bans: [...this.bans].map(([id, b]) => [id, b.sid, b.until] as [number, number, number]),
      list: this.list.map((s) => ({
        id: s.id, name: s.name, species: s.species, color: s.color, x: s.x, y: s.y, founded: s.founded, radius: s.radius,
        members: s.members.slice(), peak: s.peak, born: s.born, died: s.died, joined: s.joined, left: s.left, status: s.status,
        prevPop: s.prevPop, sampleTick: s.sampleTick, lowSince: s.lowSince, stress: s.stress, lastEmigration: s.lastEmigration, events: s.events.map((e) => ({ ...e, p: { ...e.p } })),
        ...(s.civ ? { civ: exportCiv(s.civ) } : {}),
      })),
    };
  }

  /** Restores settlements from a save, ignoring anything invalid, then rebuilds the territories. */
  importState(save: SettlementsSave | undefined, world: World, creatures: Creatures): void {
    this.reset();
    if (!save || !Array.isArray(save.list)) return;
    const seen = new Set<number>();
    const ids = new Set<number>();
    const STATUSES: SettlementStatus[] = ['founding', 'growing', 'stable', 'declining', 'fading'];
    const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
    for (const raw of save.list.slice(0, MAX_SETTLEMENTS)) {
      if (!raw || typeof raw !== 'object') continue;
      const id = Math.floor(num(raw.id, 0, 65535, 0));
      const species = Math.floor(num(raw.species, 0, SPECIES.length - 1, -1));
      const x = Math.floor(num(raw.x, -1, world.width, -1));
      const y = Math.floor(num(raw.y, -1, world.height, -1));
      if (!id || ids.has(id) || species < 0 || SPECIES[species].habitat !== 'land' || !world.inBounds(x, y)) continue;
      ids.add(id);
      const members: number[] = [];
      for (const m of Array.isArray(raw.members) ? raw.members : []) {
        if (typeof m === 'number' && Number.isInteger(m) && !seen.has(m) && creatures.indexOf(m) >= 0 && creatures.species[creatures.indexOf(m)] === species) {
          seen.add(m);
          members.push(m);
        }
      }
      const events: SettlementEvent[] = [];
      for (const e of (Array.isArray(raw.events) ? raw.events : []).slice(-MAX_EVENTS)) {
        if (e && typeof e.text === 'string' && typeof e.code === 'string' && typeof e.tick === 'number') {
          const p: Record<string, string | number> = {};
          for (const [k, v] of Object.entries(e.p ?? {})) if (typeof v === 'string' || typeof v === 'number') p[k] = v;
          events.push({ tick: e.tick, text: e.text.slice(0, 200), code: e.code.slice(0, 40), p });
        }
      }
      this.list.push({
        id, name: typeof raw.name === 'string' && raw.name ? raw.name.slice(0, 24) : nameFor(world.seed, id), species,
        color: Math.floor(num(raw.color, 0, COLORS.length - 1, 0)), x, y, founded: num(raw.founded, 0, 1e12, 0),
        radius: Math.floor(num(raw.radius, MIN_RADIUS, MAX_RADIUS_TOTAL, MIN_RADIUS)), members, peak: Math.floor(num(raw.peak, 0, 1e9, members.length)),
        born: Math.floor(num(raw.born, 0, 1e9, 0)), died: Math.floor(num(raw.died, 0, 1e9, 0)), joined: Math.floor(num(raw.joined, 0, 1e9, 0)),
        left: Math.floor(num(raw.left, 0, 1e9, 0)), status: STATUSES.includes(raw.status) ? raw.status : 'stable',
        prevPop: Math.floor(num(raw.prevPop, 0, 1e9, members.length)), sampleTick: num(raw.sampleTick, 0, 1e12, 0),
        lowSince: num(raw.lowSince, -1, 1e12, -1), stress: num(raw.stress, 0, 100, 0), lastEmigration: num(raw.lastEmigration, 0, 1e12, 0), events, tiles: new Int32Array(0), edges: new Int32Array(0),
        ...(SPECIES[species].sentient ? { civ: importCiv(raw.civ, world) } : {}),
      });
    }
    this.auto = save.auto !== false;
    for (const b of Array.isArray(save.bans) ? save.bans.slice(0, 500) : []) {
      if (Array.isArray(b) && b.every((v) => typeof v === 'number' && Number.isFinite(v)) && ids.has(b[1])) this.bans.set(b[0], { sid: b[1], until: b[2] });
    }
    this.nextId = Math.max(Math.floor(num(save.nextId, 1, 65536, 1)), ...this.list.map((s) => s.id + 1), 1);
    for (const s of this.list) {
      for (const m of s.members) this.memberOf.set(m, s.id);
      // Jobs belong to members of this settlement only.
      if (s.civ) s.civ.jobs = s.civ.jobs.filter((j) => this.memberOf.get(j.id) === s.id);
    }
    this.rebuildWork(world);
    this.recomputeTerritory(world);
  }
}

/** Saved form (save format 8). Territory is not saved: it is rebuilt from the land. */
export interface SettlementsSave {
  nextId: number;
  /** Version 10: settlements build and research by themselves (absent = true). */
  auto?: boolean;
  /** Version 11: people who recently left a settlement: [creature id, settlement id, tick until which they cannot return]. */
  bans?: Array<[number, number, number]>;
  list: Array<{
    id: number; name: string; species: number; color: number; x: number; y: number; founded: number; radius: number;
    members: number[]; peak: number; born: number; died: number; joined: number; left: number; status: SettlementStatus;
    prevPop: number; sampleTick: number; lowSince: number; stress?: number; lastEmigration?: number; events: SettlementEvent[]; civ?: CivSave;
  }>;
}
