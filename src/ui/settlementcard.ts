/**
 * Settlement card. The DOM is built once for a settlement and only its text is refreshed (4× per second),
 * so taps on the Build and Research buttons are never lost to a re-render. Every value is read from the
 * simulation when the card is refreshed.
 */
import type { Game } from '../game/game';
import { td, t } from '../i18n';
import { houseName, messageText, seasonName, speciesName, stageName } from '../i18n/names';
import {
  BUILDING_TYPES, SLOTS, STAGE_REQ, TECHS, TECH_IDS, FARM_TERRAIN, FOREST_TERRAIN, LUMBER_RADIUS, STOREHOUSE_BONUS,
  MAX_HOUSE_LEVEL, buildBlock, costOf, finished, houseCapacity, housing, jobKind, maxHouseLevel, researchBlock, slotsOf, storage, upgradeBlock, upgradeCost,
  upgradeTarget, type BuildingType, type Building, type Civ, type JobKind, type TechId,
} from '../sim/civ';
import { dateFromTick, TICKS_PER_DAY, TICKS_PER_YEAR } from '../sim/clock';
import { COLORS, EMIGRATE_STRESS } from '../sim/settlements';

const YEAR_STEPS = 24; // steps per game year (480 ticks / 20)
const ICON = { food: '🌾', wood: '🪵', stone: '🪨', knowledge: '📖' } as const;
const BUILD_ICON: Readonly<Record<BuildingType, string>> = { house: '🏠', farm: '🌾', lumber: '🪓', quarry: '⛏', storehouse: '📦', shipyard: '⚓' };
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
  private upgradeBtn: HTMLButtonElement | null = null;
  private techRows = new Map<TechId, { name: HTMLElement; status: HTMLElement; btn: HTMLButtonElement }>();
  private histList!: HTMLElement;
  private chips!: HTMLElement;
  private alerts!: HTMLElement;
  private more!: HTMLDetailsElement;
  private chipSig = '';
  private buildSig = '';
  /** Whether the details are open (kept while the player moves between settlements). */
  private static detailsOpen = false;
  private histSig = '';

  constructor(
    private readonly game: Game,
    private readonly toast: (text: string) => void,
    /** Opens the card of a kingdom (from the ♛ chip). */
    private readonly openKingdom: (id: number) => void = () => {},
  ) {}

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
    this.chipSig = '';
    // Compact part: name and stage, a row of icon values, urgent alerts, and the build actions.
    this.title = el('div', 'title', container);
    this.chips = el('div', 'sc-chips', container);
    this.alerts = el('div', 'sc-alerts', container);
    this.alerts.setAttribute('role', 'status');
    this.civBox = null;
    if (s?.civ) {
      const grid = el('div', 'build-grid', container);
      for (const type of BUILDING_TYPES) {
        const b = el('button', 'btn small', grid);
        b.type = 'button';
        b.addEventListener('click', () => this.build(type));
        this.buildBtns.set(type, b);
      }
      const up = el('button', 'btn small', grid);
      up.type = 'button';
      up.addEventListener('click', () => this.upgrade());
      this.upgradeBtn = up;
    }
    // Everything else is in the details, which open and close with a tap (native <details>).
    this.more = el('details', 'sc-more', container);
    this.more.open = SettlementCard.detailsOpen;
    this.more.addEventListener('toggle', () => {
      SettlementCard.detailsOpen = this.more.open;
    });
    el('summary', '', this.more).dataset.k = 'details';
    const body = this.more;
    for (const key of ['population', 'composition', 'territory', 'age', 'status']) this.addLine(body, key);
    if (s?.civ) {
      const box = el('div', 'civ', body);
      this.civBox = box;
      for (const key of ['stage', 'next', 'housing', 'houses', 'housenext', 'pressure', 'workers', 'split', 'problems']) this.addLine(box, key);
      el('div', 'sub', box).dataset.k = 'resources';
      for (const key of ['food', 'wood', 'stone', 'knowledge']) this.addLine(box, key);
      this.addLine(box, 'famine');
      el('div', 'sub', box).dataset.k = 'buildings';
      this.buildList = el('ul', 'settle-list', box);
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
    this.addLine(body, 'flow');
    const hb = el('div', '', body);
    el('b', '', hb).dataset.k = 'history';
    this.histList = el('ul', 'settle-history', body);
    this.update();
  }

  /** The always-visible values (icons with short numbers; full names in tooltips and accessible names) and alerts. */
  private updateCompact(s: NonNullable<ReturnType<Game['sim']['settlements']['get']>>): void {
    const c = s.civ;
    const chips: Array<[string, string, string]> = [];
    const pop = s.members.length;
    if (c) {
      const cap = housing(c);
      chips.push(['👥', `${pop}/${cap}`, t('chip.people', { pop, cap })]);
      const houses = c.buildings.filter((b) => b.type === 'house' && b.done);
      const ups = houses.filter((b) => b.up).length;
      chips.push(['🏠', `${houses.length}${ups ? ` ⬆${ups}` : ''}`, t('chip.houses', { n: houses.length, up: ups })]);
      const sites = c.buildings.filter((b) => !b.done).length;
      if (sites) chips.push(['🔨', String(sites), t('chip.sites', { n: sites })]);
      for (const [k, v] of [['food', c.food], ['wood', c.wood], ['stone', c.stone]] as const) chips.push([ICON[k], fmt(Math.floor(v)), `${td(`res.${k}`)}: ${fmt(v)} / ${storage(c)}`]);
    } else {
      chips.push(['👥', String(pop), `${t('settle.population')}: ${pop}`]);
      chips.push(['📍', String(s.tiles.length), t('settle.territory_value', { tiles: s.tiles.length, r: s.radius })]);
    }
    const kingdom = this.game.sim.kingdoms.kingdomOf(s.id);
    const sig = chips.map((x) => x.join('|')).join(';') + `|${kingdom?.id ?? 0}:${kingdom?.name ?? ''}:${td('chip.kingdom')}`;
    if (sig !== this.chipSig) {
      this.chipSig = sig;
      this.chips.replaceChildren();
      if (kingdom) {
        // The kingdom this settlement belongs to: a chip that opens the kingdom card.
        const kb = el('button', 'sc-chip kc-link', this.chips);
        kb.type = 'button';
        kb.textContent = `♛ ${kingdom.name}`;
        kb.title = t('chip.kingdom', { name: kingdom.name });
        kb.setAttribute('aria-label', kb.title);
        kb.addEventListener('click', () => this.openKingdom(kingdom.id));
      }
      for (const [icon, value, label] of chips) {
        const chip = el('span', 'sc-chip', this.chips);
        chip.title = label;
        chip.setAttribute('aria-label', label);
        chip.textContent = `${icon} ${value}`;
      }
    }
    // At most two urgent conditions, only when they apply.
    const alerts: string[] = [];
    if (c?.famine) alerts.push(`⚠ ${t('civ.famine')}`);
    if (s.tiles.some((i) => this.game.sim.world.fire[i] > 0)) alerts.push(`🔥 ${t('alert.fire')}`);
    if (s.stress >= EMIGRATE_STRESS / 2) alerts.push(`⚠ ${t('civ.pressure')}: ${Math.round(s.stress)}/${EMIGRATE_STRESS}`);
    if (c && c.buildings.some((b) => slotsOf(b) > 0) && !c.jobs.length) alerts.push(`⚠ ${td('problem.unstaffed')}`);
    const text = alerts.slice(0, 2).join(' · ');
    if (this.alerts.textContent !== text) this.alerts.textContent = text;
    this.alerts.hidden = !text;
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

  private upgrade(): void {
    const sim = this.game.sim;
    const s = sim.settlements.get(this.id);
    if (!s?.civ) return;
    const r = sim.settlements.upgradeHouse(s);
    if (typeof r === 'object') this.toast(t('upgrade.started', { level: houseName(s.species, r.up) }));
    else if (r !== 'no-civ') this.toast(td(this.upgradeReason(r)));
    this.update();
  }

  private upgradeReason(r: 'none' | 'level' | 'busy' | 'resources'): string {
    return r === 'none' ? 'build.fail.no_house' : r === 'level' ? 'build.fail.level' : `build.fail.${r}`;
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
    const stageChip = el('span', 'sc-stage', this.title);
    stageChip.textContent = s.civ ? td(`civstage.${s.civ.stage}`) : td(`settle.status.${s.status}`);
    (this.more.firstElementChild as HTMLElement).textContent = td('card.details');
    this.updateCompact(s);
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
    // Houses by level, upgrades under way, and what opens the next level.
    const houses = c.buildings.filter((b) => b.type === 'house' && b.done);
    const byLevel: string[] = [];
    for (let l = 1; l <= MAX_HOUSE_LEVEL; l++) {
      const n = houses.filter((b) => b.level === l).length;
      if (n) byLevel.push(`${houseName(s.species, l)} ${n}`);
    }
    const ups = houses.filter((b) => b.up).length;
    this.set('houses', t('civ.houses'), houses.length ? t('civ.houses_value', { n: houses.length, list: byLevel.join(' · ') }) + (ups ? ` · ${t('civ.houses_up', { n: ups })}` : '') : t('civ.none'));
    const max = maxHouseLevel(c);
    const req = max >= MAX_HOUSE_LEVEL ? 'house.req.top' : c.stage === 'camp' ? 'house.req.village' : !c.techs.includes('construction') ? 'house.req.construction' : 'house.req.town';
    this.set('housenext', t('civ.house_next'), `${houseName(s.species, max)} — ${td(req)}`);
    const cap = storage(c);
    const r = c.rate;
    for (const [key, have, prod, use] of [['food', c.food, r.food, r.foodUse], ['wood', c.wood, c.woodFlow, 0], ['stone', c.stone, r.stone, 0]] as const) {
      this.set(key, '', `${ICON[key]} ` + t('civ.res_line', { name: td(`res.${key}`), n: fmt(have), cap, prod: fmt(prod * YEAR_STEPS), use: fmt(use * YEAR_STEPS) }));
    }
    this.set('knowledge', '', `${ICON.knowledge} ` + t('civ.know_line', { name: td('res.knowledge'), n: fmt(c.knowledge), prod: fmt(r.knowledge * YEAR_STEPS) }));
    this.updateWork(s, c);
    this.set('famine', '', c.famine ? `⚠ ${t('civ.famine')}` : '');
    this.lines.famine.hidden = !c.famine;
    for (const sub of this.civBox!.querySelectorAll<HTMLElement>('.sub')) sub.textContent = td(sub.dataset.k === 'tech' ? 'civ.tech' : sub.dataset.k === 'buildings' ? 'civ.buildings' : 'civ.resources');
    // Buildings: the list is text only, so it can be rebuilt whenever it changes.
    const sig = c.buildings.map((b) => `${b.id}:${b.done ? 1 : b.progress}:${Math.round(b.reserve)}:${b.here}:${c.jobs.filter((j) => j.b === b.id).length}:${b.active}:${b.empty}:${b.level}:${b.up}`).join(',') + `|${td('civ.none')}|${world.terrain.length}`;
    if (sig !== this.buildSig) {
      this.buildSig = sig;
      this.buildList.replaceChildren();
      if (!c.buildings.length) el('li', '', this.buildList).textContent = t('civ.none');
      for (const b of c.buildings) el('li', '', this.buildList).textContent = `${b.type === 'house' && b.done ? houseName(s.species, b.level) : td(`build.${b.type}`)} (${b.x}, ${b.y}) — ${this.buildingState(b)}${this.staffText(c, b)}`;
    }
    for (const [type, btn] of this.buildBtns) {
      const cost = costOf(c, type);
      const block = buildBlock(world, s, sim.settlements.owner, type);
      const price = `${cost.wood ? `${ICON.wood}${cost.wood}` : ''}${cost.stone ? ` ${ICON.stone}${cost.stone}` : ''}`;
      // Icon and price on the button; the name, what it does and why it is unavailable in its tooltip and accessible name.
      btn.textContent = `${BUILD_ICON[type]} ${price}`;
      btn.title = `${td(`build.${type}`)} (${price}): ${td(`build.${type}.desc`)}${block ? ` — ${this.buildReason(block, c.stage)}` : ''}`;
      btn.setAttribute('aria-label', btn.title);
      btn.classList.toggle('unavailable', !!block);
      btn.setAttribute('aria-disabled', String(!!block));
    }
    if (this.upgradeBtn) {
      const target = upgradeTarget(c);
      const cost = target ? upgradeCost(c, target.level + 1) : null;
      const block = upgradeBlock(c);
      const price = cost ? `${cost.wood ? `${ICON.wood}${cost.wood}` : ''}${cost.stone ? ` ${ICON.stone}${cost.stone}` : ''}` : '';
      this.upgradeBtn.textContent = `⬆${BUILD_ICON.house}${price ? ` ${price}` : ''}`;
      this.upgradeBtn.title = `${td('build.upgrade')}${price ? ` (${price})` : ''}: ${td('build.upgrade.desc')}${block ? ` — ${td(this.upgradeReason(block))}` : ''}`;
      this.upgradeBtn.setAttribute('aria-label', this.upgradeBtn.title);
      this.upgradeBtn.classList.toggle('unavailable', !!block);
      this.upgradeBtn.setAttribute('aria-disabled', String(!!block));
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

  /** Workers, the split by task and the problems that stop work, from the real jobs and buildings. */
  private updateWork(s: NonNullable<ReturnType<Game['sim']['settlements']['get']>>, c: Civ): void {
    const sim = this.game.sim;
    let adults = 0;
    for (const m of s.members) {
      const i = sim.creatures.indexOf(m);
      if (i >= 0 && sim.creatures.stage(i) !== 'Juvenile') adults++;
    }
    const here = c.buildings.reduce((n, b) => n + b.here, 0);
    this.set('workers', t('civ.workers'), t('civ.workers_value', { n: c.jobs.length, adults, here }));
    const split: Record<JobKind, number> = { build: 0, farm: 0, wood: 0, stone: 0 };
    for (const j of c.jobs) {
      const b = c.buildings.find((x) => x.id === j.b);
      const k = b && jobKind(b);
      if (k) split[k]++;
    }
    this.set('split', t('civ.work_split'), (Object.keys(split) as JobKind[]).map((k) => `${td(`job.${k}`)} ${split[k]}`).join(' · '));
    const world = sim.world;
    const cap = storage(c);
    const problems: string[] = [];
    const open = c.buildings.some((b) => slotsOf(b) > 0 && !c.jobs.some((j) => j.b === b.id));
    if (!adults && c.buildings.some((b) => slotsOf(b) > 0)) problems.push(td('problem.no_adults'));
    else if (open) problems.push(td('problem.unstaffed'));
    if (!c.buildings.some((b) => b.type === 'farm' || b.type === 'lumber')) problems.push(td('problem.no_production'));
    if (c.buildings.some((b) => b.done && b.empty)) problems.push(td('problem.exhausted'));
    if (c.buildings.some((b) => b.done && b.type === 'farm' && !FARM_TERRAIN.includes(world.terrain[b.y * world.width + b.x]))) problems.push(td('problem.barren'));
    const full = (['food', 'wood', 'stone'] as const).filter((k) => c[k] >= cap).map((k) => td(`res.${k}`).toLowerCase());
    if (full.length) problems.push(t('problem.full', { res: full.join(', ') }));
    this.set('problems', t('civ.problems'), problems.join(' · '));
    this.lines.problems.hidden = !problems.length;
  }

  private staffText(c: Civ, b: Building): string {
    const slots = slotsOf(b);
    if (!slots) return '';
    const assigned = c.jobs.filter((j) => j.b === b.id).length;
    if (!assigned) return ` · ${td(b.done ? 'bstate.farm_idle' : 'bstate.waiting')}`;
    const away = assigned - b.here;
    return ` · ${t('bstate.workers', { here: b.here, slots })}${away > 0 ? `, ${t('bstate.assigned', { n: away })}` : ''}`;
  }

  private speciesOf(): number {
    return this.game.sim.settlements.get(this.id)?.species ?? -1;
  }

  private buildingState(b: Building): string {
    if (!b.done) return t('bstate.progress', { pct: Math.round((b.progress / b.needed) * 100) });
    if (b.up) return t('bstate.upgrading', { level: houseName(this.speciesOf(), b.up).toLowerCase(), pct: Math.round((b.progress / b.needed) * 100) });
    const world = this.game.sim.world;
    switch (b.type) {
      case 'house': return t('bstate.house_level', { level: houseName(this.speciesOf(), b.level), n: houseCapacity(b) });
      case 'storehouse': return t('bstate.storehouse', { n: STOREHOUSE_BONUS });
      case 'farm': return FARM_TERRAIN.includes(world.terrain[b.y * world.width + b.x]) ? td('bstate.farm_ok') : td('bstate.farm_barren');
      case 'lumber': return !b.empty && (b.acc > 0 || this.treeNear(b)) ? td('bstate.lumber_ok') : td('bstate.lumber_none');
      case 'shipyard': return td('bstate.shipyard');
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

