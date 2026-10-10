/**
 * Promo codes: a LOCAL TEST PROTOTYPE. Codes are checked inside this app and remembered
 * only in this browser. There is no server, so nothing prevents reuse on another device or
 * after clearing browser data, and the code list is readable in the game's source. The
 * rewards are cosmetic (an area-ring colour); nothing here involves money or game economy.
 */
export type RewardId = 'aurora' | 'gold';

export interface PromoDef {
  reward: RewardId;
}

/** Test codes (upper case). */
export const PROMO_CODES: Readonly<Record<string, PromoDef>> = {
  WELCOME: { reward: 'aurora' },
  ALVOXIS: { reward: 'gold' },
};

export type PromoResult =
  | { status: 'ok'; code: string; reward: RewardId }
  | { status: 'used'; code: string }
  | { status: 'invalid' }
  | { status: 'empty' };

export const normalizeCode = (input: string): string => input.trim().toUpperCase().replace(/\s+/g, '');

/** Checks a code against the list of codes already used in this browser. Pure: the caller stores the result. */
export function checkPromo(input: string, used: readonly string[]): PromoResult {
  const code = normalizeCode(input);
  if (!code) return { status: 'empty' };
  const def = Object.prototype.hasOwnProperty.call(PROMO_CODES, code) ? PROMO_CODES[code] : undefined;
  if (!def) return { status: 'invalid' };
  if (used.includes(code)) return { status: 'used', code };
  return { status: 'ok', code, reward: def.reward };
}

/** Rewards owned, derived from the codes used (so they cannot get out of step). */
export function rewardsOf(used: readonly string[]): RewardId[] {
  const out: RewardId[] = [];
  for (const c of used) {
    const def = Object.prototype.hasOwnProperty.call(PROMO_CODES, c) ? PROMO_CODES[c] : undefined;
    if (def && !out.includes(def.reward)) out.push(def.reward);
  }
  return out;
}
