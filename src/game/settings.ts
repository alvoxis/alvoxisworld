import { rewardsOf, type RewardId } from './promo';

/** Player preferences kept on this device (localStorage). None of them changes simulation rules. */
export type RingColor = 'default' | RewardId;

export interface Settings {
  /** Fewer decorative particles (rain, snow, smoke, dust). */
  fewerParticles: boolean;
  /** Skip glints, cloud shadows and flashes. */
  reducedEffects: boolean;
  /** Standard resolution and smaller repaint steps; also forces the two options above. */
  performanceMode: boolean;
  /** Decorative fair-weather clouds. */
  clouds: boolean;
  /** Settlement borders on the map. */
  borders: boolean;
  /** Area ring colour; a reward colour is only honoured if that gift was received. */
  ring: RingColor;
  /** Promo codes already used in this browser. */
  promoUsed: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  fewerParticles: false,
  reducedEffects: false,
  performanceMode: false,
  clouds: true,
  borders: true,
  ring: 'default',
  promoUsed: [],
};

const KEY = 'alvoxis.settings';
const OLD_CLOUDS_KEY = 'alvoxis.clouds';

interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Reads and validates stored settings; unknown or malformed fields fall back to defaults. */
export function parseSettings(raw: string | null, oldClouds: string | null = null): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS, promoUsed: [] };
  if (oldClouds === 'off') s.clouds = false;
  if (!raw) return s;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return s;
  }
  if (!o || typeof o !== 'object') return s;
  const r = o as Record<string, unknown>;
  for (const k of ['fewerParticles', 'reducedEffects', 'performanceMode', 'clouds', 'borders'] as const) {
    if (typeof r[k] === 'boolean') s[k] = r[k] as boolean;
  }
  if (Array.isArray(r.promoUsed)) s.promoUsed = r.promoUsed.filter((c): c is string => typeof c === 'string').slice(0, 50);
  if (r.ring === 'aurora' || r.ring === 'gold' || r.ring === 'default') s.ring = r.ring;
  if (s.ring !== 'default' && !rewardsOf(s.promoUsed).includes(s.ring)) s.ring = 'default';
  return s;
}

/** Settings plus change notification. */
export class SettingsStore {
  private value: Settings;
  private readonly listeners = new Set<(s: Settings) => void>();

  constructor(private readonly storage: StorageLike | null = defaultStorage()) {
    let raw: string | null = null;
    let old: string | null = null;
    try {
      raw = storage?.getItem(KEY) ?? null;
      old = storage?.getItem(OLD_CLOUDS_KEY) ?? null;
    } catch {
      /* storage unavailable */
    }
    this.value = parseSettings(raw, old);
  }

  get(): Readonly<Settings> {
    return this.value;
  }

  set(patch: Partial<Settings>): void {
    this.value = parseSettings(JSON.stringify({ ...this.value, ...patch }));
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.value));
    } catch {
      /* the choice lasts for this session */
    }
    for (const fn of this.listeners) fn(this.value);
  }

  onChange(fn: (s: Settings) => void): void {
    this.listeners.add(fn);
  }
}

/** What the renderer should use for a given set of settings (performance mode forces the reductions). */
export function renderQualityOf(s: Readonly<Settings>): { particleScale: number; reduced: boolean; lowRes: boolean } {
  const lowParticles = s.fewerParticles || s.performanceMode;
  return { particleScale: lowParticles ? 0.35 : 1, reduced: s.reducedEffects || s.performanceMode, lowRes: s.performanceMode };
}

export const RING_COLORS: Record<RingColor, string> = {
  default: 'rgba(255,255,255,0.95)',
  aurora: 'rgba(96,255,214,0.97)',
  gold: 'rgba(255,208,80,0.98)',
};
