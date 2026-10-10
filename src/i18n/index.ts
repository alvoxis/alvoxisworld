/**
 * Interface translations.
 *
 * One flat dictionary per language (en.ts is the source of truth; ru.ts and zh.ts
 * must have exactly the same keys, which the compiler and tests enforce). Text is
 * looked up with t('key', { params }); counts with tn('key', n), which picks the
 * `_one` / `_few` / `_many` / `_other` form for the language. Static HTML carries
 * data-i18n attributes and is refreshed by applyDom(). Game data (species,
 * terrain, tools, effects) keep their English ids; their display names come from
 * names.ts, so no game rule depends on a translation.
 */
import { en, type Dict, type Key } from './en';
import { ru } from './ru';
import { zh } from './zh';

export type Lang = 'en' | 'ru' | 'zh-CN';
export const LANGS: ReadonlyArray<{ id: Lang; native: string; html: string }> = [
  { id: 'ru', native: 'Русский', html: 'ru' },
  { id: 'en', native: 'English', html: 'en' },
  { id: 'zh-CN', native: '简体中文', html: 'zh-CN' },
];

const DICTS: Record<Lang, Dict> = { en, ru, 'zh-CN': zh };
const STORAGE_KEY = 'alvoxis.lang';

export type Params = Record<string, string | number>;
export type { Key };

let current: Lang = 'en';
const listeners = new Set<(lang: Lang) => void>();

export function isLang(v: unknown): v is Lang {
  return v === 'en' || v === 'ru' || v === 'zh-CN';
}

/** Language for first start: the saved choice, else the browser's language, else English. */
export function detectLang(stored: string | null, browser: readonly string[]): Lang {
  if (isLang(stored)) return stored;
  for (const l of browser) {
    const x = l.toLowerCase();
    if (x.startsWith('ru')) return 'ru';
    if (x.startsWith('zh')) return 'zh-CN';
    if (x.startsWith('en')) return 'en';
  }
  return 'en';
}

export function getLang(): Lang {
  return current;
}

function fill(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/** Translated text for a key (falls back to English, then to the key itself, so nothing ever renders blank). */
export function t(key: Key, params?: Params): string {
  const text = DICTS[current][key] ?? en[key] ?? key;
  return fill(text, params);
}

/** Like t() for keys built at run time (e.g. `species.${id}`); unknown keys come back as the key. */
export function td(key: string, params?: Params): string {
  const text = (DICTS[current] as Record<string, string>)[key] ?? (en as Record<string, string>)[key];
  return text === undefined ? key : fill(text, params);
}

/** Text with a count: uses base_one / base_few / base_many / base_other by the language's plural rules; {n} is filled in. */
export function tn(base: string, n: number, params: Params = {}): string {
  const rule = new Intl.PluralRules(current).select(n);
  const d = DICTS[current] as Record<string, string>;
  const text = d[`${base}_${rule}`] ?? d[`${base}_other`] ?? (en as Record<string, string>)[`${base}_other`] ?? base;
  return fill(text, { n, ...params });
}

export function onLangChange(fn: (lang: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Switches the language, remembers it, updates the page and tells listeners (no reload, the world is untouched). */
export function setLang(lang: Lang, persist = true): void {
  current = lang;
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* storage unavailable: the choice lasts for this session */
    }
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = LANGS.find((l) => l.id === lang)!.html;
    applyDom(document);
  }
  for (const fn of listeners) fn(lang);
}

export function initLang(): Lang {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  const browser = typeof navigator === 'undefined' ? [] : [...(navigator.languages ?? []), navigator.language ?? ''];
  setLang(detectLang(stored, browser), false);
  return current;
}

/**
 * Fills static markup: data-i18n (text), data-i18n-title, data-i18n-aria (aria-label),
 * data-i18n-ph (placeholder). Values are dictionary keys.
 */
export function applyDom(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = td(el.dataset.i18n!);
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) el.title = td(el.dataset.i18nTitle!);
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-aria]')) el.setAttribute('aria-label', td(el.dataset.i18nAria!));
  for (const el of root.querySelectorAll<HTMLInputElement>('[data-i18n-ph]')) el.placeholder = td(el.dataset.i18nPh!);
}

export { DICTS };
