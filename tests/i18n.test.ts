import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { CHANGELOG, VERSION } from '../src/app/version';
import { buildDiagnostics, recordError, recentErrors } from '../src/app/diagnostics';
import { TOOLS } from '../src/game/tools';
import { DICTS, LANGS, detectLang, getLang, setLang, t, td, tn, type Lang } from '../src/i18n';
import { en } from '../src/i18n/en';
import {
  causeName, effectDesc, effectName, errorText, messageText, seasonName, speciesName, stageName, stateName, terrainName,
  toolHint, toolLabel, undoLabel, worldSizeLabel, worldSizeProblem,
} from '../src/i18n/names';
import { deserializeInto, serialize } from '../src/save/serialize';
import { CAUSE_NAMES, SPECIES, STATE_NAMES } from '../src/sim/creatures';
import { EFFECTS } from '../src/sim/effects';
import { Simulation } from '../src/sim/simulation';
import { WORLD_SIZES, checkWorldSize, generateWorld } from '../src/world/generator';
import { TERRAIN } from '../src/world/terrain';

const ALL: Lang[] = ['en', 'ru', 'zh-CN'];
afterEach(() => setLang('en', false));

const baseKey = (k: string) => k.replace(/_(zero|one|two|few|many)$/, '_other').replace(/_other$/, '');
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('dictionaries', () => {
  it('have the same keys in every language (plural forms may differ)', () => {
    const bases = (d: Record<string, string>) => new Set(Object.keys(d).map(baseKey));
    const enBases = bases(en);
    for (const lang of ['ru', 'zh-CN'] as const) {
      const b = bases(DICTS[lang] as Record<string, string>);
      expect([...enBases].filter((k) => !b.has(k)), `missing in ${lang}`).toEqual([]);
      expect([...b].filter((k) => !enBases.has(k)), `extra in ${lang}`).toEqual([]);
    }
  });

  it('use the same {placeholders} as English, and are never empty', () => {
    for (const lang of ['ru', 'zh-CN'] as const) {
      const d = DICTS[lang] as Record<string, string>;
      for (const [k, v] of Object.entries(d)) {
        expect(v.length, `${lang} ${k}`).toBeGreaterThan(0);
        const ref = (en as Record<string, string>)[k] ?? (en as Record<string, string>)[`${baseKey(k)}_other`];
        expect(placeholders(v), `${lang} ${k}`).toEqual(placeholders(ref));
      }
    }
  });

  it('ru and zh really are translated (no English sentences left) and do not mix scripts', () => {
    // Proper names and technical terms that stay as they are in every language.
    const allowed = /ALVOXIS|IndexedDB|JSON|WASD|MB|KB|gzip|°C|\bv(?=\{|\d)|\bm\b/g;
    for (const lang of ['ru', 'zh-CN'] as const) {
      const d = DICTS[lang] as Record<string, string>;
      for (const [k, v] of Object.entries(d)) {
        const stripped = v.replace(/\{\w+\}/g, '').replace(allowed, '');
        const latin = stripped.match(/[A-Za-z]{2,}/g) ?? [];
        expect(latin, `${lang} ${k}: "${v}" has untranslated Latin words`).toEqual([]);
      }
    }
    // Every real sentence contains the script of its language.
    const sentence = (v: string) => (v.replace(/\{\w+\}/g, '').match(/[A-Za-z]{3,}/g) ?? []).length > 0;
    for (const [k, enText] of Object.entries(en)) {
      if (!sentence(enText)) continue;
      const pick = (d: Record<string, string>) => d[k] ?? d[k.replace(/_one$/, '_other')] ?? '';
      expect(pick(DICTS.ru as Record<string, string>), `ru ${k}`).toMatch(/[А-Яа-яЁё]/);
      expect(pick(DICTS['zh-CN'] as Record<string, string>), `zh ${k}`).toMatch(/[一-鿿]/);
    }
  });

  it('cover every key the markup asks for', () => {
    const html = readFileSync('index.html', 'utf8');
    const keys = [...html.matchAll(/data-i18n(?:-title|-aria|-ph)?="([^"]+)"/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(40);
    for (const k of keys) for (const lang of ALL) expect(DICTS[lang] as Record<string, string>, `${lang} ${k}`).toHaveProperty(k);
  });
});

describe('t, td and tn', () => {
  it('fills parameters and falls back safely', () => {
    expect(t('status.date', { year: 3, season: 'X', day: 9 })).toBe('Year 3 · X · Day 9');
    expect(td('no.such.key')).toBe('no.such.key');
    expect(t('save.slot')).toBe('Slot {n}'); // missing parameter is left visible, not blank
  });

  it('follows each language’s plural rules', () => {
    expect(tn('toast.cleansed', 1)).toBe('Cleansed 1 creature');
    expect(tn('toast.cleansed', 3)).toBe('Cleansed 3 creatures');
    setLang('ru', false);
    expect(tn('toast.cleansed', 1)).toBe('Очищено 1 существо');
    expect(tn('toast.cleansed', 2)).toBe('Очищено 2 существа');
    expect(tn('toast.cleansed', 5)).toBe('Очищено 5 существ');
    expect(tn('toast.cleansed', 21)).toBe('Очищено 21 существо');
    expect(tn('toast.cleansed', 11)).toBe('Очищено 11 существ');
    setLang('zh-CN', false);
    expect(tn('toast.cleansed', 1)).toBe('已净化 1 只生物');
    expect(tn('toast.cleansed', 8)).toBe('已净化 8 只生物');
  });

  it('switches language at once and reports it', () => {
    expect(getLang()).toBe('en');
    setLang('ru', false);
    expect(t('cat.powers')).toBe('Силы');
    setLang('zh-CN', false);
    expect(t('cat.powers')).toBe('神力');
    setLang('en', false);
    expect(t('cat.powers')).toBe('Powers');
  });

  it('chooses the first language from the saved choice, then the browser', () => {
    expect(detectLang('zh-CN', ['ru'])).toBe('zh-CN');
    expect(detectLang(null, ['ru-RU', 'en'])).toBe('ru');
    expect(detectLang(null, ['zh-Hans-CN'])).toBe('zh-CN');
    expect(detectLang('fr', ['de-DE'])).toBe('en');
    expect(LANGS.map((l) => l.id).sort()).toEqual(['en', 'ru', 'zh-CN']);
  });
});

describe('game data names', () => {
  it('every species, terrain, effect, state, cause, season and stage has a translation in every language', () => {
    for (const lang of ALL) {
      setLang(lang, false);
      const names: string[] = [];
      for (const s of SPECIES) names.push(speciesName(s.id), speciesName(s.id, true));
      for (const tr of TERRAIN) names.push(terrainName(tr.id));
      for (const e of EFFECTS) names.push(effectName(e.id), effectDesc(e.id));
      STATE_NAMES.forEach((n) => names.push(stateName(n, STATE_NAMES)));
      CAUSE_NAMES.forEach((n) => names.push(causeName(n, CAUSE_NAMES)));
      for (const k of [0, 1, 2, 3]) names.push(seasonName(k));
      for (const st of ['Juvenile', 'Adult', 'Elder']) names.push(stageName(st));
      for (const n of names) {
        expect(n, lang).not.toMatch(/^(species|terrain|effect|state|cause|season|stage)\./);
        expect(n.length).toBeGreaterThan(0);
      }
      if (lang !== 'en') expect(speciesName(0)).not.toBe('Grazer');
    }
  });

  it('every tool has a label and (where it has one) a hint in every language', () => {
    for (const lang of ALL) {
      setLang(lang, false);
      for (const tool of TOOLS) {
        const label = toolLabel(tool);
        expect(label, `${lang} ${tool.id}`).not.toMatch(/^(tool|terrain|species|effect)\./);
        const hint = toolHint(tool);
        if (!tool.id.startsWith('paint_')) expect(hint, `${lang} ${tool.id} hint`).not.toMatch(/^tool\..*\.hint$/);
        if (!tool.id.startsWith('paint_')) expect(hint.length).toBeGreaterThan(0);
      }
    }
    setLang('ru', false);
    expect(toolLabel(TOOLS.find((x) => x.id === 'shower')!)).toBe('Метеоритный дождь');
    expect(undoLabel('Meteor')).toBe('Метеорит');
    expect(undoLabel('Some other label')).toBe('Some other label');
  });

  it('world size labels and size problems are translated', () => {
    setLang('zh-CN', false);
    expect(worldSizeLabel(WORLD_SIZES[0].key, 256, 160)).toBe('小 (256×160)');
    expect(worldSizeProblem(checkWorldSize(100, 512)!)).toMatch(/128–4096/);
    expect(worldSizeProblem(checkWorldSize(130, 512)!)).toMatch(/32/);
  });
});

describe('history messages', () => {
  it('are shown in the current language, and old entries without a code keep their stored text', () => {
    const m = { tick: 1, text: 'A large meteor struck, killing 3.', code: 'meteor', p: { size: 'large', killed: 3 } };
    expect(messageText(m)).toBe('A large meteor struck, killing 3.');
    setLang('ru', false);
    expect(messageText(m)).toBe('Упал крупный метеорит, погибло: 3.');
    setLang('zh-CN', false);
    expect(messageText(m)).toBe('一颗大型陨石坠落，造成 3 只死亡。');
    expect(messageText({ tick: 0, text: 'World 5 was formed.' })).toBe('World 5 was formed.');
    setLang('ru', false);
    expect(messageText({ tick: 0, text: 'x', code: 'extinct', p: { species: 4 } })).toBe('Рыбы: вид вымер.');
    expect(messageText({ tick: 0, text: 'x', code: 'lightning', p: { n: 2 } })).toBe('Молния поразила 2 существа.');
  });

  it('every simulation message code exists in every language', () => {
    const codes = ['world_formed', 'imported', 'god_rain', 'god_storm', 'god_snow', 'god_drought', 'shower', 'wildfire', 'quake', 'quake_kills', 'meteor_plain', 'meteor_plain_kills', 'extinct', 'first'];
    for (const lang of ALL) {
      setLang(lang, false);
      for (const code of codes) {
        const text = messageText({ tick: 0, text: 'EN', code, p: { seed: 7, n: 4, killed: 2, species: 1 } });
        expect(text, `${lang} ${code}`).not.toMatch(/^msg\./);
      }
      for (const size of ['small', 'medium', 'large']) {
        expect(messageText({ tick: 0, text: 'EN', code: 'meteor', p: { size, killed: 0 } })).not.toMatch(/^msg\./);
      }
    }
  });

  it('the simulation stores codes, and they survive saving and loading, so a loaded world speaks the chosen language', () => {
    const sim = new Simulation(generateWorld(128, 96, 5));
    sim.log('World 5 was formed.', 'world_formed', { seed: 5 });
    sim.summonWeather(0, 10, 10, 6, 1);
    sim.launchMeteor(30, 30, 3, 2);
    for (let k = 0; k < 40; k++) sim.step();
    const before = sim.history.map((h) => h.code);
    expect(before).toContain('god_rain');
    expect(before).toContain('meteor');
    const other = new Simulation(generateWorld(128, 96, 5));
    deserializeInto(other, serialize(sim));
    expect(other.history.map((h) => h.code)).toEqual(before);
    setLang('ru', false);
    const lines = other.history.map((h) => messageText(h));
    expect(lines.some((l) => l.includes('Боги послали'))).toBe(true);
    expect(lines.some((l) => l.includes('метеорит'))).toBe(true);
    expect(lines.join(' ')).not.toMatch(/The gods|meteor struck/);
  });
});

describe('errors', () => {
  it('known save and storage errors are translated, unknown ones are wrapped', () => {
    setLang('ru', false);
    expect(errorText(new Error('This is not an ALVOXIS save file'))).toBe('Это не файл сохранения ALVOXIS');
    expect(errorText(new Error('Save file is too large'))).toBe('Файл сохранения слишком большой');
    expect(errorText(new Error('Save file is damaged (bad array data)'))).toBe('Файл сохранения повреждён');
    expect(errorText(new Error('weird'))).toBe('Что-то пошло не так: weird');
    setLang('zh-CN', false);
    expect(errorText(new Error('The file is empty'))).toBe('文件为空');
  });
});

describe('app info', () => {
  it('the version matches package.json and every changelog entry is translated', () => {
    expect(VERSION).toBe(JSON.parse(readFileSync('package.json', 'utf8')).version);
    for (const c of CHANGELOG) for (const lang of ALL) expect(DICTS[lang]).toHaveProperty(c.key);
  });

  it('diagnostics hold version and world facts but no save data, and keep only recent errors', () => {
    for (let k = 0; k < 8; k++) recordError(`boom ${k} ${'x'.repeat(400)}`);
    expect(recentErrors().length).toBe(5);
    expect(recentErrors()[4].length).toBeLessThanOrEqual(200);
    const text = buildDiagnostics({
      language: 'ru', userAgent: 'UA', viewport: '390x844', world: { width: 512, height: 320, seed: 9, tick: 100, creatures: 12 },
      saveVersion: 7, speed: '1x', settings: { clouds: true }, errors: recentErrors(),
    });
    expect(text).toContain(`ALVOXIS: World Evolution ${VERSION}`);
    expect(text).toContain('512x320, seed 9');
    expect(text).toContain('Language: ru');
    expect(text).toContain('boom 7');
    expect(text).not.toContain('boom 2');
  });
});
