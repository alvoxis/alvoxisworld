import { describe, expect, it } from 'vitest';
import { PROMO_CODES, checkPromo, normalizeCode, rewardsOf } from '../src/game/promo';
import { DEFAULT_SETTINGS, SettingsStore, parseSettings, renderQualityOf } from '../src/game/settings';

class FakeStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

describe('promo codes (local test prototype)', () => {
  it('activates a valid code once and then reports it as used', () => {
    let used: string[] = [];
    const first = checkPromo('WELCOME', used);
    expect(first).toEqual({ status: 'ok', code: 'WELCOME', reward: 'aurora' });
    used = [...used, 'WELCOME'];
    expect(checkPromo('WELCOME', used)).toEqual({ status: 'used', code: 'WELCOME' });
    expect(checkPromo('ALVOXIS', used)).toEqual({ status: 'ok', code: 'ALVOXIS', reward: 'gold' });
  });

  it('ignores case and surrounding spaces, rejects unknown and empty input', () => {
    expect(normalizeCode('  wel come ')).toBe('WELCOME');
    expect(checkPromo(' alvoxis ', []).status).toBe('ok');
    expect(checkPromo('NOPE', []).status).toBe('invalid');
    expect(checkPromo('', []).status).toBe('empty');
    expect(checkPromo('   ', []).status).toBe('empty');
    expect(checkPromo('__proto__', []).status).toBe('invalid');
    expect(checkPromo('constructor', []).status).toBe('invalid');
    expect(Object.keys(PROMO_CODES).sort()).toEqual(['ALVOXIS', 'WELCOME']);
  });

  it('derives rewards from the codes used, without duplicates or unknown codes', () => {
    expect(rewardsOf([])).toEqual([]);
    expect(rewardsOf(['WELCOME', 'ALVOXIS', 'WELCOME', 'JUNK'])).toEqual(['aurora', 'gold']);
  });
});

describe('settings', () => {
  it('start from safe defaults and ignore malformed storage', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('[1,2]')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"clouds":"yes","ring":"purple","promoUsed":[1,"WELCOME"]}').promoUsed).toEqual(['WELCOME']);
    expect(parseSettings('{"clouds":"yes"}').clouds).toBe(true);
  });

  it('a reward ring colour only counts when the gift was received', () => {
    expect(parseSettings('{"ring":"gold"}').ring).toBe('default');
    expect(parseSettings('{"ring":"gold","promoUsed":["ALVOXIS"]}').ring).toBe('gold');
    expect(parseSettings('{"ring":"gold","promoUsed":["WELCOME"]}').ring).toBe('default');
  });

  it('are saved, restored after a restart, and tell listeners', () => {
    const storage = new FakeStorage();
    const a = new SettingsStore(storage);
    let calls = 0;
    a.onChange(() => calls++);
    a.set({ fewerParticles: true, clouds: false });
    a.set({ promoUsed: ['WELCOME'], ring: 'aurora' });
    expect(calls).toBe(2);
    const b = new SettingsStore(storage); // "restart"
    expect(b.get().fewerParticles).toBe(true);
    expect(b.get().clouds).toBe(false);
    expect(b.get().ring).toBe('aurora');
    expect(b.get().promoUsed).toEqual(['WELCOME']);
  });

  it('read the cloud choice stored by the previous version', () => {
    const storage = new FakeStorage();
    storage.setItem('alvoxis.clouds', 'off');
    expect(new SettingsStore(storage).get().clouds).toBe(false);
  });

  it('keep working when storage is unavailable', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    const s = new SettingsStore(broken);
    s.set({ performanceMode: true });
    expect(s.get().performanceMode).toBe(true);
  });

  it('only change drawing quality: performance mode forces the reductions', () => {
    expect(renderQualityOf(DEFAULT_SETTINGS)).toEqual({ particleScale: 1, reduced: false, lowRes: false });
    expect(renderQualityOf({ ...DEFAULT_SETTINGS, fewerParticles: true })).toEqual({ particleScale: 0.35, reduced: false, lowRes: false });
    expect(renderQualityOf({ ...DEFAULT_SETTINGS, reducedEffects: true }).reduced).toBe(true);
    expect(renderQualityOf({ ...DEFAULT_SETTINGS, performanceMode: true })).toEqual({ particleScale: 0.35, reduced: true, lowRes: true });
  });
});
