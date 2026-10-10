/**
 * Groups: people who travel and rest together before (and instead of) settling.
 *
 * A group is a set of real creature ids that are close to each other. It forms from free people standing
 * near each other, loses members who drift away, takes in people who come close, and splits when members
 * really end up far apart or when the place can no longer feed everyone. Its decisions (stay, look for a
 * home, join a settlement, found one) depend on the world around it through `assessSite`; nothing is
 * scripted and no random generator is used (positions and a hash of ids pick the places to try).
 * Each decision is spaced out in time, so nothing happens every few ticks.
 *
 * The group never moves creatures itself: it tells each member a goal tile, and the creature walks there
 * with its normal route-finding when it has no pressing need (state TRAVEL).
 */
import { hash2 } from '../core/rng';
import { isWater } from '../world/terrain';
import type { World } from '../world/world';
import { SPECIES, type Creatures } from './creatures';
import { housing } from './civ';
import { EMIGRATE_STRESS, MAX_SETTLEMENTS, type Settlements } from './settlements';
import { SETTLE_SCORE, assessSite } from './sites';

export const GROUP_STEP = 30;
/** Free people closer than this are one group. */
export const LINK_R = 4;
/** A person within this distance of a group's centre joins it. */
export const JOIN_R = 6;
/** A member farther than this from the centre has left the group (more while travelling). */
export const LEAVE_R = 10;
/** People alone look for company or a settlement within these distances. */
export const SEEK_R = 24;
export const SETTLEMENT_SEEK = 45;
/** Ticks between decisions of one group, and the longest wait after finding nothing. */
export const DECISION_TICKS = 150;
export const MAX_BACKOFF = 1200;
/** A group stays this long at a good place before founding a settlement there. */
export const DWELL_TICKS = 150;
/** Least time between two autonomous foundings in the world, and after a group's last founding. */
export const FOUND_COOLDOWN = 600;
export const COHESION = 4.5;
export const MAX_VISITED = 6;
const CANDIDATES = 10;

export type GroupMode = 'rest' | 'travel';

export interface Group {
  id: number;
  species: number;
  members: number[];
  mode: GroupMode;
  /** Tile index the group is heading for (-1 = none). */
  goal: number;
  since: number;
  /** Tick of the next decision. */
  next: number;
  backoff: number;
  /** Tick since which the group has been resting at a place worth settling (-1 = not). */
  dwell: number;
  /** Places already tried (tile indices), so the search does not go in circles. */
  visited: number[];
  /** Settlement the group left and will not rejoin until avoidUntil. */
  avoid: number;
  avoidUntil: number;
  /** Settlement the group is walking to (0 = none). */
  target: number;
  decisions: number;
  // derived each step
  cx: number;
  cy: number;
}

export class Groups {
  list: Group[] = [];
  nextId = 1;
  /** Groups found settlements by themselves (the player's choice; saved with the world). */
  enabled = true;
  /** No autonomous founding anywhere before this tick. */
  foundReadyAt = 0;
  private groupOf = new Map<number, number>();
  private goals = new Map<number, number>();

  get(id: number): Group | undefined {
    return this.list.find((g) => g.id === id);
  }

  groupOfCreature(id: number): Group | undefined {
    const gid = this.groupOf.get(id);
    return gid ? this.get(gid) : undefined;
  }

  /** The goal tile a creature should walk to when it has nothing pressing to do, or -1. */
  goalOf(id: number): number {
    return this.goals.get(id) ?? -1;
  }

  reset(): void {
    this.list = [];
    this.nextId = 1;
    this.foundReadyAt = 0;
    this.groupOf.clear();
    this.goals.clear();
  }

  onDeath(id: number): void {
    const gid = this.groupOf.get(id);
    this.groupOf.delete(id);
    this.goals.delete(id);
    if (!gid) return;
    const g = this.get(gid);
    if (g) g.members.splice(g.members.indexOf(id), 1);
  }

  /** Makes a group from given people (used when part of a settlement leaves). They start by looking for a new home. */
  createGroup(world: World, creatures: Creatures, ids: number[], tick: number, avoid = 0, avoidUntil = 0): Group | null {
    const members = ids.filter((id) => creatures.indexOf(id) >= 0 && !this.groupOf.has(id));
    if (members.length < 2) return null;
    const species = creatures.species[creatures.indexOf(members[0])];
    const g: Group = {
      id: this.nextId++, species, members, mode: 'rest', goal: -1, since: tick, next: tick, backoff: DECISION_TICKS, dwell: -1,
      visited: [], avoid, avoidUntil, target: 0, decisions: 0, cx: 0, cy: 0,
    };
    for (const m of members) this.groupOf.set(m, g.id);
    this.list.push(g);
    this.centre(creatures, g);
    void world;
    return g;
  }

  private centre(creatures: Creatures, g: Group): void {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const id of g.members) {
      const i = creatures.indexOf(id);
      if (i < 0) continue;
      sx += creatures.x[i];
      sy += creatures.y[i];
      n++;
    }
    if (n) {
      g.cx = sx / n;
      g.cy = sy / n;
    }
  }

  /** The member standing closest to the centre: its tile is a safe place to gather (the centre itself may be water). */
  private anchor(world: World, creatures: Creatures, g: Group): number {
    let best = -1;
    let bd = Infinity;
    for (const id of g.members) {
      const i = creatures.indexOf(id);
      if (i < 0) continue;
      const d = Math.hypot(creatures.x[i] - g.cx, creatures.y[i] - g.cy);
      if (d < bd || (d === bd && id < best)) {
        bd = d;
        best = i;
      }
    }
    return best < 0 ? -1 : Math.floor(creatures.y[best]) * world.width + Math.floor(creatures.x[best]);
  }

  step(world: World, creatures: Creatures, settlements: Settlements, tick: number): void {
    if (tick % GROUP_STEP !== 0) return;
    // Free people: sentient, alive, not in a settlement.
    const free: number[] = [];
    for (let i = 0; i < creatures.count; i++) {
      if (creatures.isAlive(i) && SPECIES[creatures.species[i]].civ && !settlements.settlementOf(creatures.id[i])) free.push(i);
    }
    if (!free.length) {
      if (this.list.length) this.reset();
      this.goals.clear();
      return;
    }
    const freeIds = new Set<number>();
    for (const i of free) freeIds.add(creatures.id[i]);

    // Keep only members who are still free; groups smaller than two fall apart.
    for (const g of this.list) {
      g.members = g.members.filter((id) => {
        const keep = freeIds.has(id);
        if (!keep) this.groupOf.delete(id);
        return keep;
      });
      this.centre(creatures, g);
      const maxR = g.mode === 'travel' ? LEAVE_R * 1.8 : LEAVE_R;
      g.members = g.members.filter((id) => {
        const i = creatures.indexOf(id);
        const stay = i >= 0 && Math.hypot(creatures.x[i] - g.cx, creatures.y[i] - g.cy) <= maxR;
        if (!stay) this.groupOf.delete(id);
        return stay;
      });
    }
    for (const g of this.list) if (g.members.length < 2) for (const id of g.members) this.groupOf.delete(id);
    this.list = this.list.filter((g) => g.members.length >= 2);
    for (const g of this.list) this.centre(creatures, g);

    // Free people without a group: join the nearest group, or form one with others standing close.
    const loners: number[] = [];
    for (const i of free) {
      const id = creatures.id[i];
      if (this.groupOf.has(id)) continue;
      const sp = SPECIES[creatures.species[i]];
      let best: Group | undefined;
      let bd = JOIN_R;
      for (const g of this.list) {
        if (g.species !== sp.id || g.members.length >= sp.civ!.groupMax) continue;
        const d = Math.hypot(creatures.x[i] - g.cx, creatures.y[i] - g.cy);
        if (d <= bd) {
          bd = d;
          best = g;
        }
      }
      if (best) {
        best.members.push(id);
        this.groupOf.set(id, best.id);
      } else loners.push(i);
    }
    this.formFromLoners(creatures, loners, tick);

    // Decisions, spaced out in time.
    for (const g of [...this.list]) {
      if (g.mode === 'travel' && g.goal >= 0) {
        const gx = g.goal % world.width;
        const gy = Math.floor(g.goal / world.width);
        if (Math.hypot(g.cx - gx, g.cy - gy) <= 4) {
          g.mode = 'rest';
          g.target = 0;
          g.next = Math.min(g.next, tick);
        }
      }
      if (tick >= g.next) this.decide(world, creatures, settlements, g, tick);
    }

    this.assignGoals(world, creatures, settlements, loners);
  }

  private formFromLoners(creatures: Creatures, loners: number[], tick: number): void {
    const used = new Set<number>();
    const capped = loners.slice(0, 400);
    for (const a of capped) {
      if (used.has(a)) continue;
      const species = creatures.species[a];
      const cluster = [a];
      used.add(a);
      for (let q = 0; q < cluster.length; q++) {
        const c = cluster[q];
        for (const b of capped) {
          if (used.has(b) || creatures.species[b] !== species) continue;
          if (Math.hypot(creatures.x[b] - creatures.x[c], creatures.y[b] - creatures.y[c]) <= LINK_R) {
            used.add(b);
            cluster.push(b);
          }
        }
      }
      if (cluster.length < 2) continue;
      const max = SPECIES[species].civ!.groupMax;
      const members = cluster.slice(0, max).map((i) => creatures.id[i]);
      const g: Group = {
        id: this.nextId++, species, members, mode: 'rest', goal: -1, since: tick, next: tick + DECISION_TICKS, backoff: DECISION_TICKS, dwell: -1,
        visited: [], avoid: 0, avoidUntil: 0, target: 0, decisions: 0, cx: 0, cy: 0,
      };
      for (const m of members) this.groupOf.set(m, g.id);
      this.list.push(g);
      this.centre(creatures, g);
    }
  }

  /** What each free person should walk to when it has no need: the group's goal, back to the group, or company. */
  private assignGoals(world: World, creatures: Creatures, settlements: Settlements, loners: number[]): void {
    this.goals.clear();
    for (const g of this.list) {
      const anchor = this.anchor(world, creatures, g);
      for (const id of g.members) {
        if (g.mode === 'travel' && g.goal >= 0) {
          this.goals.set(id, g.goal);
          continue;
        }
        const i = creatures.indexOf(id);
        if (i >= 0 && anchor >= 0 && Math.hypot(creatures.x[i] - g.cx, creatures.y[i] - g.cy) > COHESION) this.goals.set(id, anchor);
      }
    }
    for (const i of loners) {
      if (!this.list.length && !settlements.list.length) break;
      const sp = SPECIES[creatures.species[i]];
      const x = creatures.x[i];
      const y = creatures.y[i];
      let best = -1;
      let bd = SEEK_R;
      for (const g of this.list) {
        if (g.species !== sp.id || g.members.length >= sp.civ!.groupMax) continue;
        const d = Math.hypot(g.cx - x, g.cy - y);
        if (d < bd) {
          const a = this.anchor(world, creatures, g);
          if (a >= 0 && creatures.reachable(world, sp.id, Math.floor(x), Math.floor(y), a % world.width, Math.floor(a / world.width))) {
            bd = d;
            best = a;
          }
        }
      }
      for (const s of settlements.list) {
        if (s.species !== sp.id || !s.civ || s.members.length >= housing(s.civ) || this.troubled(s)) continue;
        const d = Math.hypot(s.x - x, s.y - y);
        if (d < bd) {
          bd = d;
          best = s.y * world.width + s.x;
        }
      }
      if (best >= 0) this.goals.set(creatures.id[i], best);
    }
  }

  private troubled(s: { stress: number; civ?: { famine: boolean } }): boolean {
    return s.stress >= EMIGRATE_STRESS / 2 || !!s.civ?.famine;
  }

  private decide(world: World, creatures: Creatures, settlements: Settlements, g: Group, tick: number): void {
    g.decisions++;
    const sp = SPECIES[g.species];
    const prof = sp.civ!;
    const W = world.width;
    const anchor = this.anchor(world, creatures, g);
    if (anchor < 0) return;
    const ax = anchor % W;
    const ay = Math.floor(anchor / W);

    // 1. A settlement with room nearby is the easiest home.
    let join = null as null | { id: number; tile: number; d: number };
    for (const s of settlements.list) {
      if (s.species !== g.species || !s.civ || this.troubled(s)) continue;
      if (s.id === g.avoid && tick < g.avoidUntil) continue;
      if (s.members.length >= housing(s.civ)) continue;
      const d = Math.hypot(s.x - g.cx, s.y - g.cy);
      if (d > SETTLEMENT_SEEK || !creatures.reachable(world, g.species, ax, ay, s.x, s.y)) continue;
      if (!join || d < join.d) join = { id: s.id, tile: s.y * W + s.x, d };
    }
    if (join) {
      if (settlements.ownerAt(ax, ay)?.id !== join.id) {
        g.mode = 'travel';
        g.goal = join.tile;
        g.target = join.id;
        g.dwell = -1;
        g.next = tick + DECISION_TICKS;
        return;
      }
      g.next = tick + DECISION_TICKS; // already at the settlement: the people join as they walk in
      return;
    }

    // 2. Too few to found anything: look for company.
    const here = assessSite(world, creatures, settlements, ax, ay, g.species);
    if (g.members.length < prof.minFounders) {
      let near: Group | undefined;
      let nd = SEEK_R * 2;
      for (const o of this.list) {
        if (o === g || o.species !== g.species) continue;
        const d = Math.hypot(o.cx - g.cx, o.cy - g.cy);
        if (d < nd && o.members.length + g.members.length <= prof.groupMax) {
          nd = d;
          near = o;
        }
      }
      if (near) {
        const a = this.anchor(world, creatures, near);
        if (a >= 0 && creatures.reachable(world, g.species, ax, ay, a % W, Math.floor(a / W))) {
          g.mode = 'travel';
          g.goal = a;
          g.next = tick + DECISION_TICKS;
          return;
        }
      }
      g.mode = 'rest';
      g.goal = -1;
      g.backoff = Math.min(MAX_BACKOFF, g.backoff * 2);
      g.next = tick + g.backoff;
      return;
    }

    // 3. Settle here if this is a good place and nothing speaks against it.
    if (here.ok && here.score >= SETTLE_SCORE) {
      g.mode = 'rest';
      g.goal = -1;
      if (g.dwell < 0) {
        g.dwell = tick;
        g.next = tick + DWELL_TICKS;
        return;
      }
      const ready = this.enabled && tick >= this.foundReadyAt && tick - g.dwell >= DWELL_TICKS && settlements.list.length < MAX_SETTLEMENTS;
      if (ready) {
        const r = settlements.found(world, creatures, tick, ax + 0.5, ay + 0.5, 'human', { minFounders: prof.minFounders, species: g.species });
        if (typeof r === 'object') {
          this.foundReadyAt = tick + FOUND_COOLDOWN;
          for (const id of r.members) this.groupOf.delete(id);
          return; // members are settlers now; the group is pruned at the next step
        }
      }
      // Too many people for this land: the surplus looks elsewhere.
      if (g.members.length > here.capacity + prof.minFounders - 1) this.splitSurplus(world, creatures, settlements, g, here.capacity, tick);
      g.next = tick + g.backoff;
      return;
    }
    g.dwell = -1;

    // 4. Look for a better place: a few candidates around, chosen from a hash of the group and the decision.
    let best = -1;
    let bestScore = -1;
    for (let k = 0; k < CANDIDATES; k++) {
      const ang = hash2(g.id, g.decisions, k * 2 + 1) * Math.PI * 2;
      const rad = 10 + 20 * hash2(g.id, g.decisions, k * 2 + 2);
      const tx = Math.round(g.cx + Math.cos(ang) * rad);
      const ty = Math.round(g.cy + Math.sin(ang) * rad);
      if (!world.inBounds(tx, ty) || isWater(world.terrain[ty * W + tx])) continue;
      const tile = ty * W + tx;
      if (g.visited.some((v) => Math.hypot((v % W) - tx, Math.floor(v / W) - ty) < 6)) continue;
      if (!creatures.reachable(world, g.species, ax, ay, tx, ty)) continue;
      const rep = assessSite(world, creatures, settlements, tx, ty, g.species);
      if (rep.ok && rep.score > bestScore) {
        bestScore = rep.score;
        best = tile;
      }
    }
    if (best >= 0 && bestScore >= SETTLE_SCORE - 0.05 && bestScore > (here.ok ? here.score : 0)) {
      g.mode = 'travel';
      g.goal = best;
      g.visited.push(best);
      if (g.visited.length > MAX_VISITED) g.visited.shift();
      g.backoff = DECISION_TICKS;
      g.next = tick + DECISION_TICKS;
      return;
    }
    // Nothing better in reach: stay together and look again later (the wait grows, so a group does not wander forever).
    g.mode = 'rest';
    g.goal = -1;
    g.backoff = Math.min(MAX_BACKOFF, g.backoff * 2);
    g.next = tick + g.backoff;
  }

  /**
   * A group that is bigger than the land around it can feed lets the surplus go: those who live
   * nearest to another good place walk there as a group of their own. The sizes come from the land,
   * not from a fixed ratio.
   */
  private splitSurplus(world: World, creatures: Creatures, settlements: Settlements, g: Group, capacity: number, tick: number): void {
    const prof = SPECIES[g.species].civ!;
    const W = world.width;
    const surplus = g.members.length - capacity;
    if (surplus < prof.minFounders) return;
    let site = -1;
    let siteScore = -1;
    for (let k = 0; k < CANDIDATES; k++) {
      const ang = hash2(g.id, g.decisions, k * 2 + 101) * Math.PI * 2;
      const rad = 14 + 14 * hash2(g.id, g.decisions, k * 2 + 102);
      const tx = Math.round(g.cx + Math.cos(ang) * rad);
      const ty = Math.round(g.cy + Math.sin(ang) * rad);
      if (!world.inBounds(tx, ty)) continue;
      const rep = assessSite(world, creatures, settlements, tx, ty, g.species);
      if (rep.ok && rep.score >= SETTLE_SCORE && rep.score > siteScore) {
        siteScore = rep.score;
        site = ty * W + tx;
      }
    }
    if (site < 0) return;
    const sx = site % W;
    const sy = Math.floor(site / W);
    const order = g.members
      .map((id) => ({ id, d: Math.hypot(creatures.x[creatures.indexOf(id)] - sx, creatures.y[creatures.indexOf(id)] - sy) }))
      .sort((a, b) => a.d - b.d || a.id - b.id);
    const leaving = order.slice(0, surplus).map((o) => o.id);
    g.members = g.members.filter((id) => !leaving.includes(id));
    for (const id of leaving) this.groupOf.delete(id);
    const ng = this.createGroup(world, creatures, leaving, tick);
    if (ng) {
      ng.mode = 'travel';
      ng.goal = site;
      ng.visited = [site];
      ng.next = tick + DECISION_TICKS;
    }
  }

  // ---- saving -----------------------------------------------------------------

  exportState(): GroupsSave {
    return {
      nextId: this.nextId, enabled: this.enabled, foundReadyAt: this.foundReadyAt,
      goals: [...this.goals].slice(0, 5000),
      list: this.list.map((g) => ({
        id: g.id, species: g.species, members: g.members.slice(), mode: g.mode, goal: g.goal, since: g.since, next: g.next, backoff: g.backoff,
        dwell: g.dwell, visited: g.visited.slice(), avoid: g.avoid, avoidUntil: g.avoidUntil, target: g.target, decisions: g.decisions,
      })),
    };
  }

  importState(save: GroupsSave | undefined, world: World, creatures: Creatures, settlements: Settlements): void {
    this.reset();
    if (!save || !Array.isArray(save.list)) return;
    const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
    this.enabled = save.enabled !== false;
    this.foundReadyAt = num(save.foundReadyAt, 0, 1e12, 0);
    const ids = new Set<number>();
    const seen = new Set<number>();
    const tiles = world.width * world.height;
    for (const raw of save.list.slice(0, 200)) {
      if (!raw || typeof raw !== 'object') continue;
      const id = Math.floor(num(raw.id, 1, 1e9, 0));
      const species = Math.floor(num(raw.species, 0, SPECIES.length - 1, -1));
      if (!id || ids.has(id) || species < 0 || !SPECIES[species].civ) continue;
      ids.add(id);
      const members: number[] = [];
      for (const m of Array.isArray(raw.members) ? raw.members : []) {
        const i = typeof m === 'number' ? creatures.indexOf(m) : -1;
        if (i >= 0 && !seen.has(m) && creatures.species[i] === species && !settlements.settlementOf(m)) {
          seen.add(m);
          members.push(m);
        }
      }
      if (members.length < 2) continue;
      const goal = Math.floor(num(raw.goal, -1, tiles - 1, -1));
      const g: Group = {
        id, species, members, mode: raw.mode === 'travel' && goal >= 0 ? 'travel' : 'rest', goal, since: num(raw.since, 0, 1e12, 0),
        next: num(raw.next, 0, 1e12, 0), backoff: num(raw.backoff, 1, MAX_BACKOFF, DECISION_TICKS), dwell: num(raw.dwell, -1, 1e12, -1),
        visited: (Array.isArray(raw.visited) ? raw.visited : []).filter((v) => Number.isInteger(v) && v >= 0 && v < tiles).slice(-MAX_VISITED),
        avoid: Math.floor(num(raw.avoid, 0, 65535, 0)), avoidUntil: num(raw.avoidUntil, 0, 1e12, 0), target: Math.floor(num(raw.target, 0, 65535, 0)),
        decisions: Math.floor(num(raw.decisions, 0, 1e9, 0)), cx: 0, cy: 0,
      };
      for (const m of members) this.groupOf.set(m, id);
      this.list.push(g);
      this.centre(creatures, g);
    }
    // The goals handed out at the last step: a loaded world must keep walking where it was going.
    for (const e of Array.isArray(save.goals) ? save.goals.slice(0, 5000) : []) {
      if (Array.isArray(e) && Number.isInteger(e[0]) && Number.isInteger(e[1]) && e[1] >= 0 && e[1] < tiles && creatures.indexOf(e[0]) >= 0) this.goals.set(e[0], e[1]);
    }
    this.nextId = Math.max(Math.floor(num(save.nextId, 1, 1e9, 1)), ...this.list.map((g) => g.id + 1), 1);
  }
}

export interface GroupsSave {
  nextId: number;
  enabled?: boolean;
  foundReadyAt?: number;
  /** Version 11: [creature id, goal tile] handed out at the last step. */
  goals?: Array<[number, number]>;
  list: Array<{
    id: number; species: number; members: number[]; mode: GroupMode; goal: number; since: number; next: number; backoff: number; dwell: number;
    visited: number[]; avoid: number; avoidUntil: number; target: number; decisions: number;
  }>;
}
