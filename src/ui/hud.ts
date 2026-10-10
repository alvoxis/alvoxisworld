import { CATEGORIES, TOOLS, BRUSH_SIZES, type Tool, type ToolCategory } from '../game/tools';
import { SHOWER_COUNTS } from '../sim/sky';
import type { Game, TileReport } from '../game/game';
import { creatureSprite } from '../render/tileset';
import { MAX_FILE_BYTES } from '../save/file';
import { SLOTS, listSlots, deleteSlot, type SlotId } from '../save/storage';
import { dateFromTick } from '../sim/clock';
import { CAUSE_NAMES, SPECIES, STATE_NAMES } from '../sim/creatures';
import { jobOf } from '../sim/civ';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../sim/clock';
import { checkWorldSize, WORLD_SIZES } from '../world/generator';
import { TERRAIN, isWater } from '../world/terrain';
import { EFFECTS, EFFECT_DURATIONS } from '../sim/effects';
import { SPEED_LEVELS } from '../sim/simulation';
import { SAVE_VERSION } from '../save/serialize';
import { Minimap } from './minimap';
import { SettlementCard } from './settlementcard';
import { CATEGORY_ICONS, GEAR_ICON } from './icons';
import { LANGS, getLang, onLangChange, setLang, t, td, tn, type Lang } from '../i18n';
import {
  causeName, effectDesc, effectName, errorText, messageText, seasonName, speciesName, stageName, stateName, terrainName,
  toolHint, toolLabel, undoLabel, worldSizeLabel, worldSizeProblem,
} from '../i18n/names';
import { RING_COLORS, renderQualityOf, type SettingsStore } from '../game/settings';
import { PROMO_CODES, checkPromo, rewardsOf, type RewardId } from '../game/promo';
import { CHANGELOG, VERSION } from '../app/version';
import { buildDiagnostics, recentErrors } from '../app/diagnostics';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** DOM user interface. Every control here calls a real Game action. */
export class Hud {
  private category: Exclude<ToolCategory, 'view'> = 'powers';
  private toastTimer = 0;
  private readonly menu = $<HTMLDialogElement>('menu');
  private readonly minimap: Minimap;

  constructor(private readonly game: Game, private readonly settings: SettingsStore) {
    this.minimap = new Minimap($<HTMLCanvasElement>('minimap'), game);
    // Keep the minimap and toasts just above the toolbar, whatever its height.
    const tb = $('toolbar');
    const setToolbarH = () => document.documentElement.style.setProperty('--toolbar-h', `${tb.getBoundingClientRect().height}px`);
    new ResizeObserver(setToolbarH).observe(tb);
    setToolbarH();
    this.layoutMinimap();
    window.addEventListener('resize', () => this.layoutMinimap());
    this.buildCategories();
    this.renderTools();
    this.bindTopbar();
    this.bindBrush();
    this.bindZoom();
    this.bindMenu();
    this.bindSettings();

    game.onInspect = (r) => this.showInfo(r);
    game.onSelect = () => this.renderCreature();
    game.onNotify = (text) => this.toast(text);
    game.onSpeedChanged = () => this.syncSpeed();
    game.onWorldChanged = () => {
      $('info').hidden = true;
      this.layoutMinimap();
      this.syncUndo();
      this.refreshStatus();
    };
    game.undo.onChange = () => this.syncUndo();
    onLangChange(() => this.retranslate());
    this.retranslate();
    this.applySettings();
    window.setInterval(() => this.refreshStatus(), 250);

    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.closest?.('input, select, textarea')) return;
      if (e.key === ' ') {
        e.preventDefault();
        this.game.togglePause();
      }
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault();
        this.doRedo();
      } else if (mod && key === 'z') {
        e.preventDefault();
        this.doUndo();
      }
    });
  }

  toast(text: string): void {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove('show'), 1800);
  }

  // ---- toolbar -----------------------------------------------------------

  private buildCategories(): void {
    const nav = $('cats');
    for (const c of CATEGORIES) {
      const b = document.createElement('button');
      b.className = 'tab';
      b.type = 'button';
      b.setAttribute('role', 'tab');
      const ico = document.createElement('span');
      ico.className = 'cat-ico';
      ico.innerHTML = CATEGORY_ICONS[c.id]; // fixed inline SVG from icons.ts, not user data
      const label = document.createElement('span');
      label.className = 'cat-label';
      b.append(ico, label);
      b.dataset.cat = c.id;
      b.addEventListener('click', () => {
        this.category = c.id;
        this.renderTools();
      });
      nav.appendChild(b);
    }
    for (const [id, tool] of [['tool-move', 'move'], ['tool-inspect', 'inspect']] as const) {
      $(id).addEventListener('click', () => {
        this.game.setTool(tool);
        this.renderTools();
        this.syncBrush();
        const tl = TOOLS.find((x) => x.id === tool)!;
        this.toast(t('tool.hint', { label: toolLabel(tl), hint: toolHint(tl) }));
      });
    }
  }

  private icon(tool: Tool): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'ico';
    if ('emoji' in tool.icon) wrap.textContent = tool.icon.emoji;
    else if ('terrain' in tool.icon) wrap.appendChild(this.game.renderer.tiles.toCanvas(tool.icon.terrain, 1, 3));
    else {
      const c = creatureSprite(tool.icon.species);
      c.style.width = '28px';
      c.style.height = '28px';
      c.style.imageRendering = 'pixelated';
      wrap.appendChild(c);
    }
    return wrap;
  }

  private renderTools(): void {
    for (const b of $('cats').querySelectorAll<HTMLButtonElement>('button')) {
      const on = b.dataset.cat === this.category;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
      b.querySelector('.cat-label')!.textContent = td(`cat.${b.dataset.cat}`);
    }
    $('tool-move').classList.toggle('active', this.game.tool.id === 'move');
    $('tool-inspect').classList.toggle('active', this.game.tool.id === 'inspect');
    const row = $('tools');
    row.replaceChildren();
    for (const tool of TOOLS.filter((t) => t.category === this.category)) {
      const b = document.createElement('button');
      b.className = 'tool';
      b.classList.toggle('active', tool.id === this.game.tool.id);
      const label = toolLabel(tool);
      b.title = label;
      b.append(this.icon(tool), label);
      b.addEventListener('click', () => {
        this.game.setTool(tool.id);
        this.renderTools();
        this.syncBrush();
        const hint = toolHint(tool);
        this.toast(hint ? t('tool.hint', { label, hint }) : label);
      });
      row.appendChild(b);
    }
  }

  private layoutMinimap(): void {
    const small = window.innerWidth < 600;
    this.minimap.layout(small ? 120 : 190, small ? 90 : 140);
  }

  private syncUndo(): void {
    const u = this.game.undo;
    const b = $<HTMLButtonElement>('undo');
    b.disabled = !u.canUndo;
    b.title = u.nextLabel ? t('undo.named', { label: undoLabel(u.nextLabel) }) : t('undo.none');
    const r = $<HTMLButtonElement>('redo');
    r.disabled = !u.canRedo;
    r.title = u.nextRedoLabel ? t('redo.named', { label: undoLabel(u.nextRedoLabel) }) : t('redo.none');
  }

  private doUndo(): void {
    const r = this.game.undoLast();
    this.toast(r ? t('undo.done', { label: undoLabel(r.label), note: keptNote(r.skipped) }) : t('undo.none'));
  }

  private doRedo(): void {
    const r = this.game.redoLast();
    this.toast(r ? t('redo.done', { label: undoLabel(r.label), note: keptNote(r.skipped) }) : t('redo.none'));
  }

  private bindBrush(): void {
    $('intensity').addEventListener('click', () => {
      this.game.setIntensity((this.game.intensity % 3) + 1);
      this.syncBrush();
    });
    $('duration').addEventListener('click', () => {
      this.game.durationIndex = (this.game.durationIndex + 1) % EFFECT_DURATIONS.length;
      this.syncBrush();
    });
    $('count').addEventListener('click', () => {
      this.game.setCountIndex((this.game.countIndex + 1) % SHOWER_COUNTS.length);
      this.syncBrush();
      this.game.showPreview();
    });
    // The area size: one round button per radius, from very small to very large.
    const sizes = $('sizes');
    BRUSH_SIZES.forEach((r, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'size';
      b.setAttribute('role', 'radio');
      b.dataset.index = String(i);
      const dot = document.createElement('span');
      dot.className = 'dot';
      const d = Math.round(7 + 5.2 * Math.sqrt(r)); // 12 px for radius 1 up to 32 px for radius 24
      dot.style.width = dot.style.height = `${d}px`;
      b.appendChild(dot);
      b.addEventListener('click', () => {
        this.game.setBrushIndex(i);
        this.syncBrush();
      });
      sizes.appendChild(b);
    });
  }

  private syncBrush(): void {
    const enabled = this.game.tool.usesBrush;
    $('sizes').classList.toggle('disabled', !enabled);
    for (const b of $('sizes').querySelectorAll<HTMLButtonElement>('.size')) {
      b.disabled = !enabled;
      b.setAttribute('aria-checked', String(enabled && Number(b.dataset.index) === this.game.brushIndex));
    }
    const pw = $<HTMLButtonElement>('intensity');
    pw.hidden = !this.game.tool.usesIntensity;
    pw.replaceChildren();
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = `${t('power.label')} `;
    pw.append(lbl, `${'●'.repeat(this.game.intensity)}${'○'.repeat(3 - this.game.intensity)}`);
    pw.setAttribute('aria-label', t('power.aria', { n: this.game.intensity }));
    const du = $<HTMLButtonElement>('duration');
    du.hidden = !this.game.tool.usesDuration;
    const d = EFFECT_DURATIONS[this.game.durationIndex];
    du.textContent = `⏳ ${td(`dur.${d.key}`)}`;
    du.setAttribute('aria-label', t('dur.aria', { name: td(`dur.${d.key}`), days: Math.round(d.ticks / TICKS_PER_DAY) }));
    const co = $<HTMLButtonElement>('count');
    co.hidden = !this.game.tool.usesCount;
    co.textContent = `☄ ×${SHOWER_COUNTS[this.game.countIndex]}`;
    co.setAttribute('aria-label', t('count.aria', { n: SHOWER_COUNTS[this.game.countIndex] }));
    BRUSH_SIZES.forEach((r, i) => {
      const b = $('sizes').children[i] as HTMLElement | undefined;
      if (!b) return;
      b.title = tn('size.title', r, { name: td(`size.${i}`), r });
      b.setAttribute('aria-label', b.title);
    });
  }

  private bindZoom(): void {
    $('zoom-in').addEventListener('click', () => this.game.input.zoomCenter(1.4));
    $('zoom-out').addEventListener('click', () => this.game.input.zoomCenter(1 / 1.4));
    $('zoom-fit').addEventListener('click', () => this.game.camera.fit());
    $('undo').addEventListener('click', () => this.doUndo());
    $('redo').addEventListener('click', () => this.doRedo());
    $('minimap-toggle').addEventListener('click', () => {
      const mm = $('minimap');
      mm.hidden = !mm.hidden;
      $('minimap-toggle').setAttribute('aria-pressed', String(!mm.hidden));
      $('minimap-toggle').classList.toggle('active', !mm.hidden);
    });
    $('minimap-toggle').classList.add('active');
    $('info-close').addEventListener('click', () => {
      $('info').hidden = true;
      if (this.game.selectedId) this.game.select(0);
    });
  }

  // ---- top bar -----------------------------------------------------------

  private bindTopbar(): void {
    $('slower').addEventListener('click', () => this.game.slower());
    $('faster').addEventListener('click', () => this.game.faster());
    $('pause').addEventListener('click', () => this.game.togglePause());
    $('btn-menu').addEventListener('click', () => this.openMenu());
  }

  private syncSpeed(): void {
    const tc = this.game.time;
    $<HTMLButtonElement>('slower').disabled = !tc.canSlower;
    $<HTMLButtonElement>('faster').disabled = !tc.canFaster;
    const p = $('pause');
    p.textContent = tc.paused ? '▶' : '⏸';
    p.setAttribute('aria-label', td(tc.paused ? 'top.resume' : 'top.pause'));
    p.classList.toggle('active', tc.paused);
    this.syncSpeedLabel();
    this.syncSpeedSelect();
  }

  /** "20×" normally; "≈9× of 20×" when the device cannot keep up with the selected speed. */
  private syncSpeedLabel(): void {
    const tc = this.game.time;
    const sim = this.game.sim;
    const el = $('speed-label');
    const slow = sim.throttled;
    el.textContent = slow ? `≈${Math.max(1, Math.round(sim.achievedSpeed))}× / ${tc.multiplier}×` : `${tc.multiplier}×`;
    el.classList.toggle('throttled', slow);
    el.title = slow ? t('top.throttled') : '';
  }

  /** Settlement events worth a notification (everything still goes to the history). */
  private static readonly NOTIFY = new Set([
    'settlement_built', 'settlement_destroyed_fire', 'settlement_destroyed_flood', 'settlement_famine', 'settlement_stage',
    'settlement_exhausted', 'settlement_farm_stopped', 'settlement_house_upgraded', 'settlement_housing_tier',
  ]);
  private seenEvent: object | null = null;
  private lastEventToast = 0;
  private eventsPrimed = false;

  /** Shows new important settlement events as a toast: at most one every few seconds, the newest one, with a count of the rest. */
  private notifyEvents(): void {
    const h = this.game.sim.history;
    const last = h[h.length - 1] ?? null;
    if (!this.eventsPrimed) {
      this.eventsPrimed = true; // events from before the page opened are not announced
      this.seenEvent = last;
      return;
    }
    if (last === this.seenEvent) return;
    const from = this.seenEvent ? h.lastIndexOf(this.seenEvent as (typeof h)[number]) : -1;
    if (from < 0 && this.seenEvent !== null && h.length) {
      // A new or loaded world: start from its end, nothing old is announced.
      this.seenEvent = last;
      return;
    }
    const now = performance.now();
    if (now - this.lastEventToast < 3000) return; // wait; the events stay pending until then
    const fresh = h.slice(from + 1).filter((e) => e.code && Hud.NOTIFY.has(e.code));
    this.seenEvent = last;
    if (!fresh.length) return;
    this.lastEventToast = now;
    const more = fresh.length - 1;
    this.toast(messageText(fresh[fresh.length - 1]) + (more > 0 ? ` (+${more})` : ''));
  }

  private refreshStatus(): void {
    const sim = this.game.sim;
    const d = sim.date;
    this.notifyEvents();
    this.syncSpeedLabel();
    $('date').textContent =
      t('status.date', { year: d.year, season: seasonName(d.seasonIndex), day: d.day }) + (sim.speed === 0 ? t('status.paused') : '');
    let herb = 0;
    let pred = 0;
    let people = 0;
    for (const s of SPECIES) {
      const n = sim.creatures.countSpecies(s.id);
      if (s.sentient) people += n;
      else if (s.diet === 'carnivore') pred += n;
      else herb += n;
    }
    $('pop').textContent = t('status.pop', { total: herb + pred, herb, pred }) + (people ? t('status.people', { n: people }) : '');
    const wx = sim.weather.summary();
    const parts = [
      wx.rain ? t('status.rain', { n: wx.rain }) : '',
      wx.storm ? t('status.storm', { n: wx.storm }) : '',
      wx.snow ? t('status.snow', { n: wx.snow }) : '',
      wx.drought ? t('status.drought', { n: wx.drought }) : '',
      sim.sky.meteors.length ? t('status.meteors', { n: sim.sky.meteors.length }) : '',
      sim.fire.burning ? t('status.fire', { n: sim.fire.burning }) : '',
    ].filter(Boolean);
    $('weather-status').textContent = parts.length ? parts.join(' · ') : sim.weather.config.auto ? t('status.clear') : t('status.weather_off');
    if (this.game.selectedId) this.renderCreature();
    // An open settlement card follows the simulation.
    const card = document.getElementById('settle-card');
    if (card && !$('info').hidden) this.card.update();
  }

  /**
   * Live panel for the selected creature. The DOM is built once per selection (or
   * when it dies) and only values are updated 4× per second, so taps on the
   * buttons are never lost to a re-render.
   */
  private creaturePanel: {
    id: number;
    alive: boolean;
    update: () => void;
  } | null = null;

  private renderCreature(): void {
    const el = $('info');
    const body = $('info-body');
    const game = this.game;
    if (!game.selectedId) {
      if (body.dataset.mode === 'creature') el.hidden = true;
      this.creaturePanel = null;
      return;
    }
    const info = game.selectedInfo();
    const p = this.creaturePanel;
    if (p && p.id === game.selectedId && p.alive === !!info && body.dataset.mode === 'creature') {
      p.update();
      return;
    }

    body.dataset.mode = 'creature';
    body.replaceChildren();
    const title = document.createElement('div');
    title.className = 'title';
    body.appendChild(title);
    const line = (k: string) => {
      const div = document.createElement('div');
      const b = document.createElement('b');
      b.textContent = `${k}: `;
      const v = document.createElement('span');
      div.append(b, v);
      body.appendChild(div);
      return v;
    };

    if (!info) {
      title.textContent = t('info.creature_n', { id: game.selectedId });
      const status = line(t('info.status'));
      const update = () => {
        status.textContent = game.selectedFate ? t('info.died', { cause: causeName(game.selectedFate, CAUSE_NAMES) }) : t('info.gone');
      };
      update();
      this.creaturePanel = { id: game.selectedId, alive: false, update };
      el.hidden = false;
      return;
    }

    title.textContent = `${speciesName(info.species.id)} #${info.id}`;
    const stage = line(t('info.stage'));
    const doing = line(t('info.doing'));
    const diet = line(t('info.diet'));
    diet.textContent = `${td(info.species.sentient ? 'diet.sentient.lower' : `diet.${info.species.diet}.lower`)}, ${td(`habitat.${info.species.habitat}`)}`;
    const home = line(t('info.home'));
    const homeBtn = document.createElement('button');
    homeBtn.className = 'btn small';
    homeBtn.type = 'button';
    homeBtn.textContent = t('info.home_open');
    homeBtn.hidden = true;
    homeBtn.addEventListener('click', () => {
      const st = game.sim.settlements.settlementOf(info.id);
      if (!st) return;
      const rep = game.report(st.x + 0.5, st.y + 0.5);
      if (rep) {
        game.select(0); // the card replaces the creature panel (a selection would bring it back)
        this.showInfo(rep);
      }
    });
    body.appendChild(homeBtn);
    const groupLine = line(t('info.group'));
    const jobLine = line(t('info.job'));
    const meter = (label: string) => {
      const wrap = document.createElement('div');
      wrap.className = 'meter';
      const name = document.createElement('span');
      name.textContent = label;
      const track = document.createElement('span');
      track.className = 'track';
      const fill = document.createElement('span');
      track.appendChild(fill);
      const num = document.createElement('span');
      wrap.append(name, track, num);
      body.appendChild(wrap);
      return (value: number, max: number, good: 'high' | 'low') => {
        const frac = Math.max(0, Math.min(1, value / max));
        const ok = good === 'high' ? frac : 1 - frac;
        fill.style.width = `${Math.round(frac * 100)}%`;
        fill.style.background = ok > 0.5 ? '#5fd35f' : ok > 0.25 ? '#f2c14e' : '#e0533a';
        num.textContent = `${Math.round(value)}`;
      };
    };
    const health = meter(t('info.health'));
    const hunger = meter(t('info.hunger'));
    const thirst = info.species.thirstRate > 0 ? meter(t('info.thirst')) : null;
    // Active buffs/debuffs, each removable. Rebuilt only when the set changes.
    const effBox = document.createElement('div');
    effBox.className = 'effects';
    body.appendChild(effBox);
    let effMask = -1;
    const renderEffects = (now: NonNullable<ReturnType<Game['selectedInfo']>>) => {
      if (now.effectMask === effMask) {
        for (const e of now.effects) {
          const left = effBox.querySelector<HTMLElement>(`[data-eff="${e.id}"] .left`);
          if (left) left.textContent = `${Math.ceil(e.ticks / TICKS_PER_DAY)} ${t('unit.day')}`;
        }
        return;
      }
      effMask = now.effectMask;
      effBox.replaceChildren();
      for (const e of now.effects) {
        const def = EFFECTS[e.id];
        const ename = effectName(e.id);
        const chip = document.createElement('span');
        chip.className = `eff ${def.kind}`;
        chip.dataset.eff = String(e.id);
        chip.title = effectDesc(e.id);
        const label = document.createElement('span');
        label.textContent = `${def.icon} ${ename} ${'●'.repeat(e.power)} `;
        const left = document.createElement('span');
        left.className = 'left';
        left.textContent = `${Math.ceil(e.ticks / TICKS_PER_DAY)} ${t('unit.day')}`;
        const x = document.createElement('button');
        x.textContent = '✕';
        x.setAttribute('aria-label', t('effect.remove', { name: ename }));
        x.addEventListener('click', () => {
          game.removeSelectedEffect(e.id);
          this.renderCreature();
        });
        chip.append(label, left, x);
        effBox.appendChild(chip);
      }
    };

    const actions = document.createElement('div');
    actions.className = 'actions';
    const follow = document.createElement('button');
    follow.className = 'btn';
    follow.addEventListener('click', () => {
      game.follow = !game.follow;
      update();
    });
    const remove = document.createElement('button');
    remove.className = 'btn';
    remove.textContent = t('info.remove');
    remove.addEventListener('click', () => {
      const name = `${speciesName(info.species.id)} #${info.id}`;
      if (game.removeSelected()) this.toast(t('toast.removed', { name }));
      this.renderCreature();
    });
    actions.append(follow, remove);
    body.appendChild(actions);

    const update = () => {
      const now = game.selectedInfo();
      if (!now) return;
      const years = Math.floor(now.ageTicks / TICKS_PER_YEAR);
      const days = Math.floor((now.ageTicks % TICKS_PER_YEAR) / TICKS_PER_DAY);
      stage.textContent = `${stageName(now.stage)}, ${years > 0 ? `${years} ${t('unit.year')} ` : ''}${days} ${t('unit.day')}`;
      const st = game.sim.settlements.settlementOf(now.id);
      const job = st?.civ ? jobOf(st.civ, now.id) : null;
      // What a resident is doing, from the real state and job.
      doing.textContent =
        job && now.state === 'Working'
          ? td(`doing.work.${job.kind}`, { type: td(`build.${job.building.type}`).toLowerCase() })
          : job && now.state === 'Traveling'
            ? t('doing.to_work')
            : st?.civ && now.state === 'Wandering'
              ? t('doing.rest')
              : stateName(now.state, STATE_NAMES);
      jobLine.parentElement!.hidden = !st?.civ;
      jobLine.textContent = job
        ? t('info.job_value', { task: td(`job.${job.kind}`), place: td(`build.${job.building.type}`), x: job.building.x, y: job.building.y })
        : t('info.job_none');
      health(now.health, now.maxHealth, 'high');
      hunger(now.hunger, 100, 'low');
      thirst?.(now.thirst, 100, 'low');
      renderEffects(now);
      home.textContent = st ? st.name : t('info.home_none');
      homeBtn.hidden = !st;
      const grp = game.sim.groups.groupOfCreature(now.id);
      groupLine.parentElement!.hidden = !now.species.sentient;
      groupLine.textContent = grp ? t('info.group_value', { n: grp.members.length, mode: td(`group.${grp.mode}`) }) : t('info.group_none');
      follow.textContent = game.follow ? t('info.following') : t('info.follow');
      follow.classList.toggle('primary', game.follow);
    };
    update();
    this.creaturePanel = { id: info.id, alive: true, update };
    el.hidden = false;
  }

  private lastTile: TileReport | null = null;
  private readonly card = new SettlementCard(this.game, (text) => this.toast(text));

  private showInfo(r: TileReport): void {
    this.lastTile = r;
    const el = $('info');
    const body = $('info-body');
    body.dataset.mode = 'tile';
    body.replaceChildren();
    const life = r.life.map((l) => `${speciesName(l.species)} ×${l.n}`).join(', ');
    const lines: Array<[string, string]> = [
      [t('info.tile'), `${r.x}, ${r.y}`],
      [t('info.terrain'), terrainName(r.terrainId)],
      [r.elevationM < 0 ? t('info.depth') : t('info.elevation'), `${Math.abs(r.elevationM)} m`],
      [t('info.temperature'), t('info.temperature_value', { n: r.temperatureC })],
      [t('info.moisture'), `${r.moisturePct}%`],
      [t('info.life_nearby'), life || t('info.life_none')],
    ];
    body.dataset.settlement = r.settlementId ? String(r.settlementId) : '';
    if (r.settlementId) {
      const card = document.createElement('div');
      card.id = 'settle-card';
      body.appendChild(card);
      this.card.mount(card, r.settlementId);
    }
    for (const [k, v] of lines) {
      const div = document.createElement('div');
      const b = document.createElement('b');
      b.textContent = `${k}: `;
      div.append(b, v);
      body.appendChild(div);
    }
    el.hidden = false;
  }

  // ---- settings ----------------------------------------------------------

  private section = 'language';
  private readonly SECTIONS = [
    { id: 'language', key: 'set.language', icon: '🌐' },
    { id: 'saves', key: 'set.saves', icon: '💾' },
    { id: 'graphics', key: 'set.graphics', icon: '🎨' },
    { id: 'simulation', key: 'set.simulation', icon: '⏱' },
    { id: 'stats', key: 'set.stats', icon: '📊' },
    { id: 'about', key: 'set.about', icon: 'ℹ️' },
    { id: 'promo', key: 'set.promo', icon: '🎁' },
  ] as const;

  /** Asks before something that loses progress. Resolves true only if the player confirms. */
  private confirm(text: string, yesLabel: string): Promise<boolean> {
    const dlg = $<HTMLDialogElement>('confirm');
    $('confirm-text').textContent = text;
    $('confirm-yes').textContent = yesLabel;
    return new Promise((resolve) => {
      const yes = $('confirm-yes');
      const no = $('confirm-no');
      const done = (ok: boolean) => {
        yes.removeEventListener('click', onYes);
        no.removeEventListener('click', onNo);
        dlg.removeEventListener('close', onClose);
        if (dlg.open) dlg.close();
        resolve(ok);
      };
      const onYes = () => done(true);
      const onNo = () => done(false);
      const onClose = () => done(false); // Escape
      yes.addEventListener('click', onYes);
      no.addEventListener('click', onNo);
      dlg.addEventListener('close', onClose);
      dlg.showModal();
    });
  }

  private bindSaveFiles(): void {
    // The menu is a modal dialog (top layer), so results are shown inside it as well as in a toast.
    const status = (text: string) => {
      const el = $('file-status');
      el.hidden = false;
      el.textContent = text;
      this.toast(text);
    };
    const exp = $<HTMLButtonElement>('export-save');
    exp.addEventListener('click', async () => {
      exp.disabled = true;
      try {
        const { bytes, name } = await this.game.exportFile();
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        status(t('save.exported', { name, size: formatBytes(bytes.length) }));
      } catch (err) {
        status(t('save.export_failed', { error: errorText(err) }));
      } finally {
        exp.disabled = false;
      }
    });
    const input = $<HTMLInputElement>('import-save');
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.value = ''; // picking the same file again fires change again
      if (!file) return;
      if (file.size > MAX_FILE_BYTES) {
        status(t('save.import_failed', { error: t('err.too_large') }));
        return;
      }
      if (!(await this.confirm(t('save.confirm_import'), t('save.import')))) return;
      try {
        const report = await this.game.importFile(new Uint8Array(await file.arrayBuffer()));
        this.menu.close();
        const note = report.migrated ? t('save.upgraded', { v: report.version }) : '';
        this.toast(t('save.imported', { w: report.width, h: report.height, note }));
      } catch (err) {
        status(t('save.import_failed', { error: errorText(err) }));
      }
    });
  }

  private bindMenu(): void {
    const size = $<HTMLSelectElement>('size');
    for (const s of WORLD_SIZES) {
      const o = document.createElement('option');
      o.value = s.key;
      size.appendChild(o);
    }
    const custom = document.createElement('option');
    custom.value = 'custom';
    size.appendChild(custom);
    size.value = 'medium';
    const cw = $<HTMLInputElement>('custom-w');
    const ch = $<HTMLInputElement>('custom-h');
    const chosen = (): { width: number; height: number } => {
      const preset = WORLD_SIZES.find((s) => s.key === size.value);
      return preset ?? { width: Number(cw.value), height: Number(ch.value) };
    };
    this.syncSize = () => {
      $('custom-size').hidden = size.value !== 'custom';
      const { width, height } = chosen();
      const problem = checkWorldSize(width, height);
      $<HTMLButtonElement>('generate').disabled = !!problem;
      $('size-note').textContent = problem ? worldSizeProblem(problem) : sizeNote(width, height);
    };
    size.addEventListener('change', this.syncSize);
    cw.addEventListener('input', this.syncSize);
    ch.addEventListener('input', this.syncSize);
    $('menu-close').addEventListener('click', () => this.menu.close());
    this.bindSaveFiles();
    this.menu.addEventListener('click', (e) => {
      if (e.target === this.menu) this.menu.close(); // tap on backdrop
    });
    $('seed-random').addEventListener('click', () => {
      $<HTMLInputElement>('seed').value = String((Math.random() * 1e9) >>> 0);
    });
    const gen = $<HTMLButtonElement>('generate');
    gen.addEventListener('click', async () => {
      if (this.game.generating) return;
      if (!(await this.confirm(t('new.confirm'), t('new.confirm_yes')))) return;
      gen.disabled = true;
      gen.textContent = t('new.generating');
      try {
        const { width, height } = chosen();
        const { seed } = await this.game.newWorld(width, height, $<HTMLInputElement>('seed').value);
        this.menu.close();
        this.toast(t('new.created', { seed }));
      } catch (err) {
        this.toast(t('new.failed', { error: errorText(err) }));
      } finally {
        gen.disabled = false;
        gen.textContent = t('new.generate');
      }
    });

    // Weather and disasters (Simulation section).
    const dis = {
      auto: $<HTMLInputElement>('disasters-auto'),
      frequency: $<HTMLSelectElement>('disasters-frequency'),
      meteors: $<HTMLInputElement>('disasters-meteors'),
      quakes: $<HTMLInputElement>('disasters-quakes'),
      wildfires: $<HTMLInputElement>('disasters-wildfires'),
    };
    const applyDisasters = () => {
      const c = this.game.sim.sky.config;
      c.auto = dis.auto.checked;
      c.frequency = Number(dis.frequency.value);
      c.meteors = dis.meteors.checked;
      c.quakes = dis.quakes.checked;
      c.wildfires = dis.wildfires.checked;
      dis.frequency.disabled = dis.meteors.disabled = dis.quakes.disabled = dis.wildfires.disabled = !c.auto;
    };
    for (const el of [dis.auto, dis.frequency, dis.meteors, dis.quakes, dis.wildfires]) el.addEventListener('change', applyDisasters);
    this.syncDisasters = () => {
      const c = this.game.sim.sky.config;
      dis.auto.checked = c.auto;
      dis.frequency.value = String(c.frequency);
      dis.meteors.checked = c.meteors;
      dis.quakes.checked = c.quakes;
      dis.wildfires.checked = c.wildfires;
      dis.frequency.disabled = dis.meteors.disabled = dis.quakes.disabled = dis.wildfires.disabled = !c.auto;
    };
    const auto = $<HTMLInputElement>('weather-auto');
    const sev = $<HTMLSelectElement>('weather-severity');
    auto.addEventListener('change', () => (this.game.sim.weather.config.auto = auto.checked));
    sev.addEventListener('change', () => (this.game.sim.weather.config.severity = Number(sev.value)));
    const autoFound = $<HTMLInputElement>('sim-autofound');
    autoFound.addEventListener('change', () => (this.game.sim.groups.enabled = autoFound.checked));
    const civAuto = $<HTMLInputElement>('sim-settlements-auto');
    civAuto.addEventListener('change', () => (this.game.sim.settlements.auto = civAuto.checked));
    const speed = $<HTMLSelectElement>('sim-speed');
    speed.addEventListener('change', () => this.game.setSpeed(Number(speed.value)));
  }

  /** Copies the simulation's disaster settings into the menu controls (set when the menu is built). */
  private syncDisasters: () => void = () => {};
  private syncSize: () => void = () => {};

  /** Time-speed list in Simulation: Paused plus every speed level, kept in step with the top-bar buttons. */
  private syncSpeedSelect(): void {
    const sel = $<HTMLSelectElement>('sim-speed');
    if (sel.options.length !== SPEED_LEVELS.length + 1) {
      sel.replaceChildren();
      for (const v of [0, ...SPEED_LEVELS]) {
        const o = document.createElement('option');
        o.value = String(v);
        sel.appendChild(o);
      }
    }
    sel.options[0].textContent = t('sim.speed_paused');
    SPEED_LEVELS.forEach((v, k) => (sel.options[k + 1].textContent = `${v}×`));
    sel.value = this.game.time.paused ? '0' : String(this.game.time.multiplier);
  }

  private bindSettings(): void {
    // Section tabs.
    const nav = $('set-nav');
    for (const sec of this.SECTIONS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'set-tab';
      b.setAttribute('role', 'tab');
      b.dataset.sec = sec.id;
      const ico = document.createElement('span');
      ico.className = 'set-ico';
      ico.textContent = sec.icon;
      const lbl = document.createElement('span');
      b.append(ico, lbl);
      b.addEventListener('click', () => this.showSection(sec.id));
      nav.appendChild(b);
    }
    $('btn-menu').innerHTML = GEAR_ICON; // fixed inline SVG from icons.ts

    // Language buttons.
    const list = $('lang-list');
    for (const l of LANGS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lang-btn';
      b.setAttribute('role', 'radio');
      b.dataset.lang = l.id;
      b.lang = l.html;
      b.textContent = l.native;
      b.addEventListener('click', () => {
        if (getLang() !== l.id) setLang(l.id as Lang);
      });
      list.appendChild(b);
    }

    // Graphics & performance.
    const s = this.settings;
    const opts: Array<[string, 'fewerParticles' | 'reducedEffects' | 'performanceMode' | 'clouds' | 'borders']> = [
      ['opt-particles', 'fewerParticles'], ['opt-effects', 'reducedEffects'], ['opt-performance', 'performanceMode'], ['ambient-clouds', 'clouds'],
      ['opt-borders', 'borders'],
    ];
    for (const [id, key] of opts) {
      $<HTMLInputElement>(id).addEventListener('change', (e) => s.set({ [key]: (e.target as HTMLInputElement).checked }));
    }
    const passOverlay = $<HTMLInputElement>('pass-overlay');
    passOverlay.addEventListener('change', () => this.game.renderer.setPassOverlay(passOverlay.checked));
    s.onChange(() => this.applySettings());

    // About.
    $('copy-diag').addEventListener('click', () => void this.copyDiagnostics());

    // Promo codes.
    $('promo-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.redeem();
    });
  }

  private showSection(id: string): void {
    this.section = id;
    for (const sec of document.querySelectorAll<HTMLElement>('#menu .set-sec')) sec.hidden = sec.dataset.sec !== id;
    for (const b of $('set-nav').querySelectorAll<HTMLButtonElement>('.set-tab')) {
      const on = b.dataset.sec === id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    }
    this.fillSection(id);
    $('menu').scrollTop = 0;
  }

  /** Builds the parts of a section that depend on the world (statistics, slots) when it is shown. */
  private fillSection(id: string): void {
    if (id === 'saves') {
      void this.renderSlots();
      $('current-seed').textContent = t('new.current', { seed: this.game.sim.world.seed, w: this.game.sim.world.width, h: this.game.sim.world.height });
      this.syncSize();
    } else if (id === 'simulation') {
      $<HTMLInputElement>('weather-auto').checked = this.game.sim.weather.config.auto;
      $<HTMLSelectElement>('weather-severity').value = String(this.game.sim.weather.config.severity);
      this.syncDisasters();
      $<HTMLInputElement>('sim-settlements-auto').checked = this.game.sim.settlements.auto;
      $<HTMLInputElement>('sim-autofound').checked = this.game.sim.groups.enabled;
      this.syncSpeedSelect();
    } else if (id === 'stats') {
      this.renderStats();
      this.renderHistory();
    } else if (id === 'about') {
      this.renderAbout();
    } else if (id === 'promo') {
      this.renderPromoRewards();
    } else if (id === 'graphics') {
      this.renderRingChoices();
    }
  }

  /** Pushes the stored preferences into the renderer and the controls. They change drawing only. */
  private applySettings(): void {
    const v = this.settings.get();
    this.game.renderer.setQuality(renderQualityOf(v));
    this.game.renderer.ringColor = RING_COLORS[v.ring];
    this.game.showAmbientClouds = v.clouds;
    this.game.showSettlementBorders = v.borders;
    $<HTMLInputElement>('opt-borders').checked = v.borders;
    $<HTMLInputElement>('opt-particles').checked = v.fewerParticles || v.performanceMode;
    $<HTMLInputElement>('opt-effects').checked = v.reducedEffects || v.performanceMode;
    // Performance mode forces the two reductions, so they cannot be switched off while it is on.
    $<HTMLInputElement>('opt-particles').disabled = v.performanceMode;
    $<HTMLInputElement>('opt-effects').disabled = v.performanceMode;
    $<HTMLInputElement>('opt-performance').checked = v.performanceMode;
    $<HTMLInputElement>('ambient-clouds').checked = v.clouds;
    this.renderRingChoices();
  }

  private renderRingChoices(): void {
    const v = this.settings.get();
    const list = $('ring-list');
    list.replaceChildren();
    const owned = rewardsOf(v.promoUsed);
    const choices: Array<{ id: 'default' | RewardId; key: string }> = [
      { id: 'default', key: 'gfx.ring_default' },
      ...owned.map((r) => ({ id: r, key: `gfx.ring_${r}` })),
    ];
    for (const c of choices) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ring-btn';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(v.ring === c.id));
      b.classList.toggle('active', v.ring === c.id);
      const dot = document.createElement('span');
      dot.className = 'ring-dot';
      dot.style.borderColor = RING_COLORS[c.id];
      b.append(dot, td(c.key));
      b.addEventListener('click', () => this.settings.set({ ring: c.id }));
      list.appendChild(b);
    }
    $('ring-note').hidden = owned.length === PROMO_REWARD_COUNT;
  }

  // ---- promo codes (local test prototype; see src/game/promo.ts) ---------------

  private redeem(): void {
    const input = $<HTMLInputElement>('promo-input');
    const status = $('promo-status');
    const r = checkPromo(input.value, this.settings.get().promoUsed);
    status.hidden = false;
    status.className = 'promo-status';
    if (r.status === 'ok') {
      this.settings.set({ promoUsed: [...this.settings.get().promoUsed, r.code], ring: r.reward });
      status.classList.add('ok');
      status.textContent = t('promo.ok', { reward: td(`promo.reward_${r.reward}`) });
      input.value = '';
      this.toast(status.textContent);
    } else {
      status.classList.add(r.status === 'used' ? 'used' : 'bad');
      status.textContent = td(`promo.${r.status}`);
    }
    this.renderPromoRewards();
  }

  private renderPromoRewards(): void {
    const el = $('promo-rewards');
    el.replaceChildren();
    const owned = rewardsOf(this.settings.get().promoUsed);
    if (!owned.length) {
      const li = document.createElement('li');
      li.textContent = t('promo.none');
      el.appendChild(li);
    }
    for (const r of owned) {
      const li = document.createElement('li');
      li.textContent = `🎁 ${td(`promo.reward_${r}`)}`;
      el.appendChild(li);
    }
  }

  // ---- about and diagnostics -------------------------------------------------

  private renderAbout(): void {
    $('about-version').textContent = `ALVOXIS · ${t('about.version', { v: VERSION })}`;
    $('about-format').textContent = t('about.save_format', { v: SAVE_VERSION });
    const help = $('about-help');
    help.replaceChildren();
    for (let k = 1; k <= 6; k++) {
      const li = document.createElement('li');
      li.textContent = td(`about.help_${k}`);
      help.appendChild(li);
    }
    const log = $('about-changelog');
    log.replaceChildren();
    for (const c of CHANGELOG) {
      const li = document.createElement('li');
      li.textContent = `${c.version} — ${td(c.key)}`;
      log.appendChild(li);
    }
  }

  private diagnosticsText(): string {
    const sim = this.game.sim;
    return buildDiagnostics({
      language: getLang(),
      userAgent: navigator.userAgent,
      viewport: `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio || 1}x`,
      world: { width: sim.world.width, height: sim.world.height, seed: sim.world.seed, tick: sim.tick, creatures: sim.creatures.count },
      saveVersion: SAVE_VERSION,
      speed: this.game.time.paused ? 'paused' : `${this.game.time.multiplier}x`,
      settings: { ...this.settings.get(), promoUsed: this.settings.get().promoUsed.length },
      errors: recentErrors(),
    });
  }

  private async copyDiagnostics(): Promise<void> {
    const text = this.diagnosticsText();
    const area = $<HTMLTextAreaElement>('diag-text');
    const status = $('diag-status');
    status.hidden = false;
    try {
      await navigator.clipboard.writeText(text);
      area.hidden = true;
      status.textContent = t('about.copied');
      this.toast(t('about.copied'));
    } catch {
      // No clipboard permission (or an insecure page): show the text selected so it can be copied by hand.
      area.hidden = false;
      area.value = text;
      area.focus();
      area.select();
      status.textContent = t('about.copy_failed');
    }
  }

  // ---- language -------------------------------------------------------------

  /** Rebuilds everything that was written by code (the static markup is handled by applyDom). */
  private retranslate(): void {
    document.title = t('app.title');
    for (const b of $('lang-list').querySelectorAll<HTMLButtonElement>('.lang-btn')) {
      const on = b.dataset.lang === getLang();
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    }
    for (const b of $('set-nav').querySelectorAll<HTMLButtonElement>('.set-tab')) {
      const sec = this.SECTIONS.find((x) => x.id === b.dataset.sec)!;
      b.lastElementChild!.textContent = td(sec.key);
    }
    // Option lists.
    const size = $<HTMLSelectElement>('size');
    for (const o of Array.from(size.options)) {
      const preset = WORLD_SIZES.find((s) => s.key === o.value);
      o.textContent = preset ? worldSizeLabel(preset.key, preset.width, preset.height) : t('new.custom');
    }
    const fill = (id: string, prefix: string, n: number) => {
      const sel = $<HTMLSelectElement>(id);
      const v = sel.value;
      sel.replaceChildren();
      for (let k = 0; k < n; k++) {
        const o = document.createElement('option');
        o.value = String(k);
        o.textContent = td(`${prefix}.${k}`);
        sel.appendChild(o);
      }
      sel.value = v || '1';
    };
    fill('weather-severity', 'sim.sev', 3);
    fill('disasters-frequency', 'sim.freq', 3);
    $<HTMLSelectElement>('weather-severity').value = String(this.game.sim.weather.config.severity);
    $<HTMLSelectElement>('disasters-frequency').value = String(this.game.sim.sky.config.frequency);
    $('generate').textContent = this.game.generating ? t('new.generating') : t('new.generate');
    // Live parts.
    this.renderTools();
    this.syncBrush();
    this.syncUndo();
    this.syncSpeed();
    this.refreshStatus();
    this.syncSize();
    if (this.lastTile && $('info-body').dataset.mode === 'tile' && !$('info').hidden) this.showInfo(this.lastTile);
    this.creaturePanel = null; // rebuilt on the next refresh, with translated labels
    $('info-body').dataset.mode = $('info-body').dataset.mode === 'creature' ? '' : $('info-body').dataset.mode ?? '';
    if (this.game.selectedId) this.renderCreature();
    this.renderRingChoices();
    // The open section (if the dialog is showing) is refreshed too.
    if (this.menu.open) this.fillSection(this.section);
    else this.fillSection('about');
    $('promo-status').hidden = true;
    $('diag-status').hidden = true;
    $('diag-text').hidden = true;
  }

  private openMenu(): void {
    this.showSection(this.section);
    if (!this.menu.open) this.menu.showModal();
  }

  private renderStats(): void {
    const sim = this.game.sim;
    const w = sim.world;
    const counts = w.terrainCounts();
    const total = w.width * w.height;
    let land = 0;
    counts.forEach((c, id) => {
      if (!isWater(id)) land += c;
    });
    let herb = 0;
    let pred = 0;
    let people = 0;
    for (const s of SPECIES) {
      const n = sim.creatures.countSpecies(s.id);
      if (s.sentient) people += n;
      else if (s.diet === 'carnivore') pred += n;
      else herb += n;
    }
    const age = sim.tick;
    const st = sim.sky.stats;
    const rows: Array<[string, string]> = [
      [t('stats.world_age'), t('stats.age_value', { years: Math.floor(age / TICKS_PER_YEAR), days: Math.floor((age % TICKS_PER_YEAR) / TICKS_PER_DAY), ticks: age })],
      [t('stats.size'), `${w.width}×${w.height}`],
      [t('stats.seed'), String(w.seed)],
      [t('stats.animals'), String(herb + pred)],
      [t('stats.herbivores'), String(herb)],
      [t('stats.predators'), String(pred)],
      ...(people ? ([[t('stats.people'), String(people)]] as Array<[string, string]>) : []),
      [t('stats.births_deaths'), `${sim.creatures.births} / ${sim.creatures.deaths}`],
      [t('stats.sky'), t('stats.sky_value', { m: st.meteors, l: st.lightning, q: st.quakes, w: st.wildfires })],
      [t('stats.land'), `${((land / total) * 100).toFixed(1)}%`],
      ...TERRAIN.filter((x) => !x.water && counts[x.id] > 0)
        .sort((a, b) => counts[b.id] - counts[a.id])
        .map((x): [string, string] => [`  ${terrainName(x.id)}`, t('stats.of_land', { pct: ((counts[x.id] / land) * 100).toFixed(1) })]),
      ...SPECIES.flatMap((s): Array<[string, string]> => {
        const c = sim.creatures;
        const causes = CAUSE_NAMES.map((_, k) => [td(`cause.${k}`), c.deathsBy(s.id, k)] as const)
          .filter(([, n]) => n > 0)
          .map(([name, n]) => `${name} ${n}`)
          .join(', ');
        return [
          [speciesName(s.id, true), t('stats.alive_born', { alive: c.countSpecies(s.id), born: c.birthStats[s.id] })],
          ...(causes ? ([[`  ${t('stats.deaths')}`, causes]] as Array<[string, string]>) : []),
        ];
      }),
    ];
    const el = $('stats');
    el.replaceChildren();
    for (const [k, v] of rows) {
      const a = document.createElement('span');
      a.textContent = k;
      const b = document.createElement('span');
      b.textContent = v;
      el.append(a, b);
    }
    const note = document.createElement('p');
    note.className = 'hint stats-note';
    note.textContent = t('stats.sky_note');
    el.append(note);
  }

  private renderHistory(): void {
    const el = $('history');
    el.replaceChildren();
    const entries = this.game.sim.history.slice().reverse();
    if (!entries.length) {
      const li = document.createElement('li');
      li.textContent = t('stats.history_empty');
      el.appendChild(li);
    }
    for (const h of entries) {
      const d = dateFromTick(h.tick);
      const li = document.createElement('li');
      li.textContent = t('stats.history_line', { year: d.year, season: seasonName(d.seasonIndex), text: messageText(h) });
      el.appendChild(li);
    }
  }

  private async renderSlots(): Promise<void> {
    const el = $('slots');
    el.replaceChildren();
    let summaries: Awaited<ReturnType<typeof listSlots>>;
    try {
      summaries = await listSlots();
    } catch (err) {
      el.textContent = t('save.unavailable', { error: errorText(err) });
      return;
    }
    SLOTS.forEach((slot, k) => {
      const s = summaries[k];
      const row = document.createElement('div');
      row.className = 'slot';
      const meta = document.createElement('div');
      meta.className = 'meta';
      const title = document.createElement('b');
      title.textContent = t('save.slot', { n: k + 1 });
      meta.append(title, document.createElement('br'));
      if (s) {
        const d = dateFromTick(s.tick);
        meta.append(t('save.slot_meta', { year: d.year, season: seasonName(d.seasonIndex), w: s.width, h: s.height, date: new Date(s.savedAt).toLocaleString(getLang()) }));
      } else meta.append(t('save.empty'));

      const save = this.button(t('save.save'), async () => {
        await this.game.save(slot);
        this.toast(t('save.saved', { n: k + 1 }));
        void this.renderSlots();
      });
      const load = this.button(t('save.load'), async () => {
        if (!(await this.confirm(t('save.confirm_load', { n: k + 1 }), t('save.load')))) return;
        if (await this.game.load(slot)) {
          this.menu.close();
          this.toast(t('save.loaded', { n: k + 1 }));
        }
      });
      load.disabled = !s;
      const del = this.button('🗑', async () => {
        await deleteSlot(slot as SlotId);
        this.toast(t('save.cleared', { n: k + 1 }));
        void this.renderSlots();
      });
      del.disabled = !s;
      del.setAttribute('aria-label', t('save.delete', { n: k + 1 }));
      row.append(meta, save, load, del);
      el.appendChild(row);
    });
  }

  private button(label: string, action: () => Promise<void>): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = label;
    b.addEventListener('click', () => {
      b.disabled = true;
      action()
        .catch((err: Error) => this.toast(t('save.failed', { error: errorText(err) })))
        .finally(() => {
          if (b.isConnected) b.disabled = false;
        });
    });
    return b;
  }
}

const PROMO_REWARD_COUNT = new Set(Object.values(PROMO_CODES).map((p) => p.reward)).size;

/** Toast suffix when undo/redo left tiles the world had changed since. */
function keptNote(skipped: number): string {
  return skipped ? tn('undo.kept', skipped) : '';
}

function formatBytes(n: number): string {
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/**
 * Size guidance from docs/PERFORMANCE.md measurements: about 37 bytes per tile
 * (simulation, navigation and map canvases) plus ~3 MB for creatures.
 */
function sizeNote(width: number, height: number): string {
  const tiles = width * height;
  const memMb = Math.round((tiles * 37) / 1048576 + 3);
  const params = { mtiles: (tiles / 1e6).toFixed(2), mb: memMb };
  if (tiles > 1_600_000) return t('world.note_huge', params);
  if (tiles > 700_000) return t('world.note_large', params);
  return t('world.note', params);
}
