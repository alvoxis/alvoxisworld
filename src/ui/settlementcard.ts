/**
 * Settlement card. The DOM is built once for a settlement and only its text is refreshed (4× per second),
 * so taps on the Build and Research buttons are never lost to a re-render. Every value is read from the
 * simulation when the card is refreshed.
 */
import type { Game } from '../game/game';
import { td, t } from '../i18n';
import { messageText, seasonName, speciesName, stageName } from '../i18n/names';
import {
  BUILDING_TYPES, SLOTS, STAGE_REQ, TECHS, TECH_IDS, FARM_TERRAIN, FOREST_TERRAIN, LUMBER_RADIUS, HOUSE_CAPACITY, STOREHOUSE_BONUS,
  buildBlock, costOf, finished, housing, researchBlock, storage, type BuildingType, type Building, type TechId,
} from '../sim/civ';
import { dateFromTick, TICKS_PER_DAY, TICKS_PER_YEAR } from '../sim/clock';
import { COLORS, EMIGRATE_STRESS } from '../sim/settlements';

const YEAR_STEPS = 24; // steps per game year (480 ticks / 20)
const ICON = { food: '🌾', wood: '🪵', stone: '🪨', knowledge: '📖' } as const;
const fmt = (n: number) => String(Math.round(n * 10) / 10).replace(/\.0$/, '');

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
}

export class SettlementCard {
  private id = 0;
  private lines: Record<string, HTMLElement> = {};
  private title!: HTMLElement;
  private civBox: HTMLElement | null = null;
  private buildList!: HTMLElement;
  private buildBtns = new Map<BuildingType, HTMLButtonElement>();
  private techRows = new Map<TechId, { name: HTMLElement; status: HTMLElement; btn: HTMLButtonElement }>();
  private histList!: HTMLElement;
  private buildSig = '';
  private histSig = '';

  constructor(private readonly game: Game, private readonly toast: (text: string) => void) {}

  get settlementId(): number {
    return this.id;
  }

  mount(container: HTMLElement, id: number): void {
    this.id = id;
    container.replaceChildren();
    this.lines = {};
    this.buildBtns.clear();
    this.techRows.clear();
    this.buildSig = this.histSig = '';
    const s = this.game.sim.settlements.get(id);
    this.title = el('div', 'title', container);
    for (const key of ['population', 'composition', 'territory', 'age', 'status']) this.addLine(container, key);
    this.civBox = null;
    if (s?.civ) {
      const box = el('div', 'civ', container);
      this.civBox = box;
      for (const key of ['stage', 'next', 'housing', 'pressure']) this.addLine(box, key);
      el('div', 'sub', box).dataset.k = 'resources';
      for (const key of ['food', 'wood', 'stone', 'knowledge']) this.addLine(box, key);
      this.addLine(box, 'famine');
      el('div', 'sub', box).dataset.k = 'buildings';
      this.buildList = el('ul', 'settle-list', box);
      const grid = el('div', 'build-grid', box);
      for (const type of BUILDING_TYPES) {
        const b = el('button', 'btn small', grid);
        b.type = 'button';
        b.addEventListener('click', () => this.build(type));
        this.buildBtns.set(type, b);
      }
      el('div', 'sub', box).dataset.k = 'tech';
      for (const id2 of TECH_IDS) {
        const row = el('div', 'tech-row', box);
        const info = el('div', 'tech-info', row);
        const name = el('b', '', info);
        const status = el('span', '', info);
        const btn = el('button', 'btn small', row);
        btn.type = 'button';
        btn.addEventListener('click', () => this.research(id2));
        this.techRows.set(id2, { name, status, btn });
      }
      this.addLine(box, 'auto');
    }
    this.addLine(container, 'flow');
    const hb = el('div', '', container);
    el('b', '', hb).dataset.k = 'history';
    this.histList = el('ul', 'settle-history', container);
    this.update();
  }

  private addLine(parent: HTMLElement, key: string): void {
    const div = el('div', '', parent);
    el('b', '', div);
    el('span', '', div);
    this.lines[key] = div;
  }

  private set(key: string, label: string, value: string): void {
    const div = this.lines[key];
    if (!div) return;
    (div.firstElementChild as HTMLElement).textContent = label ? `${label}: ` : '';
    (div.lastElementChild as HTMLElement).textContent = value;
  }

  private build(type: BuildingType): void {
    const sim = this.game.sim;
    const s = sim.settlements.get(this.id);
    if (!s?.civ) return;
    const r = sim.settlements.build(sim.world, s, type, sim.tick);
    if (typeof r === 'object') this.toast(t('build.started', { name: td(`build.${type}`) }));
    else if (r !== 'none') this.toast(this.buildReason(r, s.civ.stage));
    this.update();
  }

  private buildReason(r: string, stage: 'camp' | 'village' | 'town'): string {
    return r === 'slots' ? t('build.fail.slots', { n: SLOTS[stage] }) : td(`build.fail.${r}`);
  }

  private research(id: TechId): void {
    const sim = this.game.sim;
    const s = sim.settlements.get(this.id);
    if (!s?.civ) return;
    const r = sim.settlements.research(s, id);
    if (r === null) this.toast(t('tech.started', { name: td(`tech.${id}`) }));
    else if (r !== 'none') this.toast(r === 'needs' ? td(`tech.needs.${id}`) : r === 'known' ? td('tech.known') : td(`tech.fail.${r}`));
    this.update();
  }

  /** Refreshes the text from the simulation. Returns false when the settlement no longer exists. */
  update(): boolean {
    const sim = this.game.sim;
    const s = sim.settlements.get(this.id);
    if (!s) {
      this.title.textContent = t('settle.gone');
      return false;
    }
    this.title.replaceChildren();
    const sw = el('span', 'swatch');
    sw.style.background = COLORS[s.color];
    this.title.append(sw, s.name);
    const stages: Record<string, number> = { Juvenile: 0, Adult: 0, Elder: 0 };
    for (const m of s.members) {
      const i = sim.creatures.indexOf(m);
      if (i >= 0) stages[sim.creatures.stage(i)]++;
    }
    const age = sim.tick - s.founded;
    const c = s.civ;
    this.set('population', t('settle.population'), c ? t('civ.housing_value', { pop: s.members.length, cap: housing(c) }) + (s.members.length >= housing(c) ? ` (${t('civ.full')})` : '') : String(s.members.length));
    this.set('composition', t('settle.composition'), `${speciesName(s.species, true)} ×${s.members.length} (${Object.entries(stages).map(([k, n]) => `${stageName(k)} ${n}`).join(' · ')})`);
    this.set('territory', t('settle.territory'), t('settle.territory_value', { tiles: s.tiles.length, r: s.radius }));
    this.set('age', t('settle.age'), t('settle.age_value', { years: Math.floor(age / TICKS_PER_YEAR), days: Math.floor((age % TICKS_PER_YEAR) / TICKS_PER_DAY) }));
    this.set('status', t('settle.status'), td(`settle.status.${s.status}`));
    this.set('flow', t('settle.flow'), t('settle.flow_value', { born: s.born, died: s.died, joined: s.joined, left: s.left, peak: s.peak }));
    if (c && this.civBox) this.updateCiv(s, c);
    // History: rebuilt only when it changes.
    const hsig = `${s.events.length}:${s.events[s.events.length - 1]?.tick}:${td('settle.history')}`;
    if (hsig !== this.histSig) {
      this.histSig = hsig;
      (this.histList.previousElementSibling!.firstElementChild as HTMLElement).textContent = `${t('settle.history')}:`;
      this.histList.replaceChildren();
      for (const e of s.events.slice(-6).reverse()) {
        const d = dateFromTick(e.tick);
        const li = el('li', '', this.histList);
        li.textContent = t('stats.history_line', { year: d.year, season: seasonName(d.seasonIndex), text: messageText(e) });
      }
    }
    return true;
  }

  private updateCiv(s: NonNullable<ReturnType<Game['sim']['settlements']['get']>>, c: NonNullable<typeof s.civ>): void {
    const sim = this.game.sim;
    const world = sim.world;
    this.set('stage', t('civ.stage'), td(`civstage.${c.stage}`));
    const pop = s.members.length;
    this.set(
      'next', '',
      c.stage === 'camp'
        ? t('civ.next_village', { pop, needPop: STAGE_REQ.village.people, b: finished(c), needB: STAGE_REQ.village.buildings })
        : c.stage === 'village'
          ? t('civ.next_town', { pop, needPop: STAGE_REQ.town.people, b: finished(c), needB: STAGE_REQ.town.buildings, t: c.techs.length, needT: STAGE_REQ.town.techs })
          : t('civ.top'),
    );
    this.set('pressure', t('civ.pressure'), t('civ.pressure_value', { n: Math.round(s.stress), max: EMIGRATE_STRESS }));
    this.lines.pressure.hidden = s.stress < 1;
    this.set('housing', t('civ.housing'), t('civ.housing_value', { pop, cap: housing(c) }) + (pop >= housing(c) ? ` — ${t('civ.full')}` : ''));
    const cap = storage(c);
    const r = c.rate;
    for (const [key, have, prod, use] of [['food', c.food, r.food, r.foodUse], ['wood', c.wood, r.wood, 0], ['stone', c.stone, r.stone, 0]] as const) {
      this.set(key, '', `${ICON[key]} ` + t('civ.res_line', { name: td(`res.${key}`), n: fmt(have), cap, prod: fmt(prod * YEAR_STEPS), use: fmt(use * YEAR_STEPS) }));
    }
    this.set('knowledge', '', `${ICON.knowledge} ` + t('civ.know_line', { name: td('res.knowledge'), n: fmt(c.knowledge), prod: fmt(r.knowledge * YEAR_STEPS) }));
    this.set('famine', '', c.famine ? `⚠ ${t('civ.famine')}` : '');
    this.lines.famine.hidden = !c.famine;
    for (const sub of this.civBox!.querySelectorAll<HTMLElement>('.sub')) sub.textContent = td(sub.dataset.k === 'tech' ? 'civ.tech' : sub.dataset.k === 'buildings' ? 'civ.buildings' : 'civ.resources');
    // Buildings: the list is text only, so it can be rebuilt whenever it changes.
    const sig = c.buildings.map((b) => `${b.id}:${b.done ? 1 : b.progress}:${Math.round(b.reserve)}`).join(',') + `|${td('civ.none')}|${world.terrain.length}`;
    if (sig !== this.buildSig) {
      this.buildSig = sig;
      this.buildList.replaceChildren();
      if (!c.buildings.length) el('li', '', this.buildList).textContent = t('civ.none');
      for (const b of c.buildings) el('li', '', this.buildList).textContent = `${td(`build.${b.type}`)} (${b.x}, ${b.y}) — ${this.buildingState(b)}`;
    }
    for (const [type, btn] of this.buildBtns) {
      const cost = costOf(c, type);
      const block = buildBlock(world, s, sim.settlements.owner, type);
      btn.textContent = `${td(`build.${type}`)} · ${cost.wood ? `${ICON.wood}${cost.wood}` : ''}${cost.stone ? ` ${ICON.stone}${cost.stone}` : ''}`;
      btn.title = `${td(`build.${type}.desc`)}${block ? ` — ${this.buildReason(block, c.stage)}` : ''}`;
      btn.classList.toggle('unavailable', !!block);
      btn.setAttribute('aria-disabled', String(!!block));
    }
    for (const [id, row] of this.techRows) {
      const def = TECHS[id];
      row.name.textContent = `${td(`tech.${id}`)}: `;
      const known = c.techs.includes(id);
      const going = c.research?.id === id;
      row.status.textContent = `${td(`tech.${id}.desc`)} — ${known ? td('tech.known') : going ? t('tech.progress', { pct: Math.round((c.research!.steps / def.steps) * 100) }) : t('tech.cost', { n: def.knowledge })}`;
      const block = researchBlock(c, id);
      row.btn.hidden = known || going;
      row.btn.textContent = `${ICON.knowledge} ${td('tech.research')}`;
      row.btn.classList.toggle('unavailable', !!block);
      row.btn.setAttribute('aria-disabled', String(!!block));
      row.btn.title = block ? (block === 'needs' ? td(`tech.needs.${id}`) : td(`tech.fail.${block}`)) : '';
    }
    this.set('auto', '', sim.settlements.auto ? td('civ.auto_on') : td('civ.auto_off'));
  }

  private buildingState(b: Building): string {
    if (!b.done) return t('bstate.progress', { pct: Math.round((b.progress / b.needed) * 100) });
    const world = this.game.sim.world;
    switch (b.type) {
      case 'house': return t('bstate.house', { n: HOUSE_CAPACITY });
      case 'storehouse': return t('bstate.storehouse', { n: STOREHOUSE_BONUS });
      case 'farm': return FARM_TERRAIN.includes(world.terrain[b.y * world.width + b.x]) ? td('bstate.farm_ok') : td('bstate.farm_barren');
      case 'lumber': return b.acc > 0 || this.treeNear(b) ? td('bstate.lumber_ok') : td('bstate.lumber_none');
      default: return b.reserve > 0.5 ? t('bstate.quarry_ok', { n: Math.round(b.reserve) }) : td('bstate.quarry_done');
    }
  }

  private treeNear(b: Building): boolean {
    const w = this.game.sim.world;
    for (let y = Math.max(0, b.y - 6); y <= Math.min(w.height - 1, b.y + 6); y++) {
      for (let x = Math.max(0, b.x - 6); x <= Math.min(w.width - 1, b.x + 6); x++) {
        if (FOREST_TERRAIN.includes(w.terrain[y * w.width + x]) && Math.hypot(x - b.x, y - b.y) <= LUMBER_RADIUS) return true;
      }
    }
    return false;
  }
}

