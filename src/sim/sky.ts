/**
 * Things that fall from the sky: meteors in flight, and the settings and
 * bookkeeping for natural disasters. Pure state (no world access), advanced by
 * Simulation.step(), so it pauses with the simulation and is saved.
 */

/** A meteor on its way down. It lands at (x, y) when ttl reaches 0. */
export interface MeteorInFlight {
  id: number;
  /** Impact point (tiles). */
  x: number;
  y: number;
  /** Crater radius and energy, as for meteorStrike(). */
  radius: number;
  intensity: number;
  /** Ticks left, and ticks the flight started with (for drawing the approach). */
  ttl: number;
  total: number;
  /** Direction (radians) the meteor comes from, as seen from the impact point. */
  angle: number;
  /** Fell by itself (a natural disaster): not recorded in undo history. */
  natural: boolean;
}

/**
 * A meteor shower being fired: `remaining` meteors still to launch, one every `gap`
 * ticks, each at a random point within `spread` tiles of (x, y), from its own random
 * direction. Meteor sizes depend on `intensity` (1: small stones; 2: some medium; 3: medium and the odd large one).
 */
export interface Shower {
  id: number;
  x: number;
  y: number;
  spread: number;
  intensity: number;
  remaining: number;
  gap: number;
  /** Ticks until the next launch. */
  wait: number;
}

export interface DisasterConfig {
  /** Disasters strike by themselves. Off by default so a world only changes when you ask. */
  auto: boolean;
  /** Index into FREQUENCIES. */
  frequency: number;
  meteors: boolean;
  quakes: boolean;
  wildfires: boolean;
}

export const FREQUENCIES = ['Rare', 'Normal', 'Frequent'] as const;

/** Visual-only notices from the simulation to the renderer (drained by Game each frame, never saved). */
export type SkyEvent =
  | { kind: 'bolt'; x: number; y: number }
  | { kind: 'impact'; x: number; y: number; radius: number; intensity: number }
  | { kind: 'quake'; x: number; y: number; radius: number };

/** Most meteors that can be in the air at once. */
export const MAX_METEORS = 24;
/** Showers firing at once, and meteors still to be launched across all of them (bounds the work and the effects on screen). */
export const MAX_SHOWERS = 4;
export const MAX_QUEUED_METEORS = 120;
/** Meteor counts a shower tool offers. */
export const SHOWER_COUNTS = [6, 12, 24, 48] as const;
/** Ticks over which a shower spreads its meteors (about 5 s at 1×). */
export const SHOWER_TICKS = 50;
/** Ticks of flight of a normal meteor (about 2 s at 1×). */
export const FLIGHT_TICKS = 20;
/** Ticks between natural-disaster rolls (a year is 480 ticks). */
export const DISASTER_STEP = 40;
/** Expected events per game year on a medium map, for each frequency (Rare, Normal, Frequent). */
export const DISASTER_RATES = {
  meteors: [0.2, 0.7, 1.8],
  quakes: [0.15, 0.5, 1.3],
  wildfires: [0.3, 0.9, 2.2],
} as const;

export class Sky {
  meteors: MeteorInFlight[] = [];
  showers: Shower[] = [];
  nextId = 1;
  nextShowerId = 1;
  config: DisasterConfig = { auto: false, frequency: 1, meteors: true, quakes: true, wildfires: true };
  /** Events for the renderer. Capped so nothing piles up if nobody drains it (tests, headless runs). */
  events: SkyEvent[] = [];
  /** Counters since the world began (statistics and tests; not saved). */
  stats = { meteors: 0, lightning: 0, quakes: 0, wildfires: 0 };

  /** Adds a meteor to the sky. Returns null if too many are already in flight. */
  launch(
    x: number, y: number, radius: number, intensity: number, angle: number, natural: boolean, flight = FLIGHT_TICKS,
  ): MeteorInFlight | null {
    if (this.meteors.length >= MAX_METEORS) return null;
    const m: MeteorInFlight = {
      id: this.nextId++, x, y, radius, intensity, ttl: flight, total: flight, angle, natural,
    };
    this.meteors.push(m);
    return m;
  }

  /** Meteors still waiting to be launched by active showers. */
  get queued(): number {
    let n = 0;
    for (const s of this.showers) n += s.remaining;
    return n;
  }

  /**
   * Starts a shower of `count` meteors. Returns how many were accepted (fewer than
   * asked, or none, if too many showers or queued meteors already exist).
   */
  startShower(x: number, y: number, spread: number, count: number, intensity: number): number {
    if (this.showers.length >= MAX_SHOWERS) return 0;
    const n = Math.min(count, MAX_QUEUED_METEORS - this.queued);
    if (n <= 0) return 0;
    this.showers.push({
      id: this.nextShowerId++, x, y, spread, intensity, remaining: n, gap: Math.max(1, Math.round(SHOWER_TICKS / n)), wait: 0,
    });
    return n;
  }

  /** Advances one tick; returns the meteors that land now (removed from the sky, in launch order). */
  advance(): MeteorInFlight[] {
    if (!this.meteors.length) return [];
    const landed: MeteorInFlight[] = [];
    const flying: MeteorInFlight[] = [];
    for (const m of this.meteors) {
      if (--m.ttl <= 0) landed.push(m);
      else flying.push(m);
    }
    this.meteors = flying;
    return landed;
  }

  emit(e: SkyEvent): void {
    this.events.push(e);
    if (this.events.length > 64) this.events.shift();
  }

  /** Takes the pending visual events. */
  drainEvents(): SkyEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Zones animals run from: around meteors that are about to land. */
  dangerZones(): Array<{ x: number; y: number; r: number }> {
    const out: Array<{ x: number; y: number; r: number }> = [];
    for (const m of this.meteors) {
      if (m.ttl > m.total * 0.85) continue; // not yet noticed
      const R = Math.max(2, m.radius) * (0.7 + 0.3 * m.intensity);
      out.push({ x: m.x, y: m.y, r: R * 2.2 + 2 });
    }
    return out;
  }

  /** Clears the sky (new world or load); settings are kept. */
  reset(): void {
    this.meteors = [];
    this.showers = [];
    this.events = [];
    this.nextId = 1;
    this.nextShowerId = 1;
    this.stats = { meteors: 0, lightning: 0, quakes: 0, wildfires: 0 };
  }
}
