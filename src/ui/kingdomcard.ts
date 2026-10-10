/**
 * Kingdom card: compact by default (name, people, icon values, ruler with a Select button, capital with an Open
 * button, status), with the member settlements, the past rulers and recent events in a tap-to-open details section.
 * Like the settlement card, the DOM is built once and only text is refreshed; every value is read from the simulation.
 */
import type { Game } from '../game/game';
import { t, td } from '../i18n';
import { messageText, seasonName, speciesName, stageName } from '../i18n/names';
import { dateFromTick, TICKS_PER_DAY, TICKS_PER_YEAR } from '../sim/clock';
import { KINGDOM_COLORS } from '../sim/kingdoms';
import { creatureSprite } from '../render/tileset';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
}

export class KingdomCard {
  private id = 0;
  private title!: HTMLElement;
  private chips!: HTMLElement;
  private rulerText!: HTMLElement;
  private rulerBtn!: HTMLButtonElement;
  private sprite!: HTMLElement;
  private capitalText!: HTMLElement;
  private capitalBtn!: HTMLButtonElement;
  private more!: HTMLDetailsElement;
  private members!: HTMLElement;
  private rulers!: HTMLElement;
  private events!: HTMLElement;
  private sig = '';
  private static detailsOpen = false;

  constructor(
    private readonly game: Game,
    /** Opens a settlement's card (by id). */
    private readonly openSettlement: (id: number) => void,
    /** Selects a creature and shows its card. */
    private readonly selectCreature: (id: number) => void,
  ) {}

  get kingdomId(): number {
    return this.id;
  }

  mount(container: HTMLElement, id: number): void {
    this.id = id;
    this.sig = '';
    container.replaceChildren();
    this.title = el('div', 'title', container);
    this.chips = el('div', 'sc-chips', container);
    const ruler = el('div', 'kc-row', container);
    this.sprite = el('span', 'kc-sprite', ruler);
    this.rulerText = el('span', 'kc-text', ruler);
    this.rulerBtn = el('button', 'btn small', ruler);
    this.rulerBtn.type = 'button';
    this.rulerBtn.addEventListener('click', () => {
      const k = this.game.sim.kingdoms.get(this.id);
      if (k?.ruler) this.selectCreature(k.ruler);
    });
    const cap = el('div', 'kc-row', container);
    this.capitalText = el('span', 'kc-text', cap);
    this.capitalBtn = el('button', 'btn small', cap);
    this.capitalBtn.type = 'button';
    this.capitalBtn.addEventListener('click', () => {
      const k = this.game.sim.kingdoms.get(this.id);
      if (k) this.openSettlement(k.capital);
    });
    this.more = el('details', 'sc-more', container);
    this.more.open = KingdomCard.detailsOpen;
    this.more.addEventListener('toggle', () => {
      KingdomCard.detailsOpen = this.more.open;
    });
    el('summary', '', this.more);
    el('b', '', this.more).dataset.k = 'members';
    this.members = el('ul', 'settle-list', this.more);
    el('b', '', this.more).dataset.k = 'rulers';
    this.rulers = el('ul', 'settle-list', this.more);
    el('b', '', this.more).dataset.k = 'events';
    this.events = el('ul', 'settle-history', this.more);
    this.update();
  }

  /** Refreshes the text from the simulation. Returns false when the kingdom no longer exists. */
  update(): boolean {
    const sim = this.game.sim;
    const k = sim.kingdoms.get(this.id);
    if (!k) {
      this.title.textContent = t('kingdom.gone');
      return false;
    }
    const totals = sim.kingdoms.totals(k, sim.settlements);
    const age = sim.tick - k.founded;
    const capital = sim.settlements.get(k.capital);
    const ri = k.ruler ? sim.creatures.indexOf(k.ruler) : -1;
    const sig = [
      k.name, k.members.join(','), totals.people, totals.tiles, Math.floor(age / TICKS_PER_DAY), k.ruler, k.status, capital?.name,
      ri >= 0 ? sim.creatures.stage(ri) : '', k.rulers.length, k.events.length, td('kingdom.details'),
    ].join('|');
    if (sig === this.sig) return true;
    this.sig = sig;
    const color = KINGDOM_COLORS[k.color] ?? KINGDOM_COLORS[0];
    this.title.replaceChildren();
    const crown = el('span', 'kc-crown', this.title);
    crown.textContent = '♛';
    crown.style.color = color;
    this.title.append(` ${k.name}`);
    el('span', 'sc-stage', this.title).textContent = speciesName(k.species, true);
    const years = Math.floor(age / TICKS_PER_YEAR);
    const chips: Array<[string, string, string]> = [
      ['🏘', String(k.members.length), t('kingdom.settlements', { n: k.members.length })],
      ['👥', String(totals.people), t('kingdom.people', { n: totals.people })],
      ['📍', String(totals.tiles), t('kingdom.territory', { n: totals.tiles })],
      ['⏳', t('kingdom.age_short', { years, days: Math.floor((age % TICKS_PER_YEAR) / TICKS_PER_DAY) }), t('kingdom.founded', { year: dateFromTick(k.founded).year })],
    ];
    this.chips.replaceChildren();
    for (const [icon, value, label] of chips) {
      const chip = el('span', 'sc-chip', this.chips);
      chip.title = label;
      chip.setAttribute('aria-label', label);
      chip.textContent = `${icon} ${value}`;
    }
    const status = el('span', `sc-chip kc-status ${k.status}`, this.chips);
    status.textContent = k.status === 'stable' ? `✓ ${td('kingdom.status.stable')}` : `⌛ ${td('kingdom.status.succession')}`;
    // Ruler: a real creature (sprite, id, life stage and age), selectable through the normal selection.
    this.sprite.replaceChildren();
    if (ri >= 0) {
      const c = creatureSprite(k.species);
      c.style.width = '24px';
      c.style.height = '24px';
      c.style.imageRendering = 'pixelated';
      this.sprite.appendChild(c);
      const ageT = sim.creatures.age[ri];
      this.rulerText.textContent = t('kingdom.ruler', {
        name: `${speciesName(k.species)} #${k.ruler}`, stage: stageName(sim.creatures.stage(ri)).toLowerCase(), years: Math.floor(ageT / TICKS_PER_YEAR),
      });
    } else this.rulerText.textContent = t('kingdom.no_ruler');
    this.rulerBtn.hidden = ri < 0;
    this.rulerBtn.textContent = `👆 ${td('kingdom.select_ruler')}`;
    this.capitalText.textContent = t('kingdom.capital', { name: capital?.name ?? '—' });
    this.capitalBtn.textContent = `🏘 ${td('kingdom.open_capital')}`;
    this.capitalBtn.hidden = !capital;
    (this.more.firstElementChild as HTMLElement).textContent = td('kingdom.details');
    for (const b of this.more.querySelectorAll<HTMLElement>('b[data-k]')) b.textContent = td(`kingdom.list.${b.dataset.k}`);
    this.members.replaceChildren();
    for (const sid of k.members) {
      const s = sim.settlements.get(sid);
      if (s) el('li', '', this.members).textContent = `${sid === k.capital ? '♛ ' : ''}${s.name} · 👥 ${s.members.length}`;
    }
    this.rulers.replaceChildren();
    for (const r of [...k.rulers].reverse()) {
      const from = dateFromTick(r.from).year;
      el('li', '', this.rulers).textContent = r.to < 0
        ? t('kingdom.reign_now', { id: r.id, from })
        : t(`kingdom.reign_${r.end === 'died' ? 'died' : 'left'}`, { id: r.id, from, to: dateFromTick(r.to).year });
    }
    this.events.replaceChildren();
    for (const e of k.events.slice(-6).reverse()) {
      const d = dateFromTick(e.tick);
      el('li', '', this.events).textContent = t('stats.history_line', { year: d.year, season: seasonName(d.seasonIndex), text: messageText(e) });
    }
    return true;
  }
}
