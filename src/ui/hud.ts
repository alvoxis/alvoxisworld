import { CATEGORIES, TOOLS, BRUSH_SIZES, type Tool, type ToolCategory } from '../game/tools';
import type { Game, TileReport } from '../game/game';
import { creatureSprite } from '../render/tileset';
import { SLOTS, listSlots, deleteSlot, type SlotId } from '../save/storage';
import { dateFromTick } from '../sim/clock';
import { CAUSE_NAMES, SPECIES } from '../sim/creatures';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../sim/clock';
import { WORLD_SIZES } from '../world/generator';
import { TERRAIN, isWater } from '../world/terrain';
import { SEVERITY } from '../sim/weather';
import { EFFECTS, EFFECT_DURATIONS } from '../sim/effects';
import { Minimap } from './minimap';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** DOM user interface. Every control here calls a real Game action. */
export class Hud {
  private category: Exclude<ToolCategory, 'view'> = 'powers';
  private toastTimer = 0;
  private readonly menu = $<HTMLDialogElement>('menu');
  private readonly minimap: Minimap;

  constructor(private readonly game: Game) {
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
    this.syncUndo();
    this.syncSpeed();
    this.syncBrush();
    this.refreshStatus();
    window.setInterval(() => this.refreshStatus(), 250);

    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.closest?.('input, select, textarea')) return;
      if (e.key === ' ') {
        e.preventDefault();
        this.game.togglePause();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
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
      b.setAttribute('role', 'tab');
      const full = document.createElement('span');
      full.className = 'full';
      full.textContent = c.label;
      const short = document.createElement('span');
      short.className = 'short';
      short.textContent = c.short;
      b.append(full, short);
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
        const t = TOOLS.find((x) => x.id === tool)!;
        this.toast(`${t.label}: ${t.hint}`);
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
    }
    $('tool-move').classList.toggle('active', this.game.tool.id === 'move');
    $('tool-inspect').classList.toggle('active', this.game.tool.id === 'inspect');
    const row = $('tools');
    row.replaceChildren();
    for (const tool of TOOLS.filter((t) => t.category === this.category)) {
      const b = document.createElement('button');
      b.className = 'tool';
      b.classList.toggle('active', tool.id === this.game.tool.id);
      b.title = tool.label;
      b.append(this.icon(tool), tool.label);
      b.addEventListener('click', () => {
        this.game.setTool(tool.id);
        this.renderTools();
        this.syncBrush();
        this.toast(tool.hint ? `${tool.label}: ${tool.hint}` : tool.label);
      });
      row.appendChild(b);
    }
  }

  private layoutMinimap(): void {
    const small = window.innerWidth < 600;
    this.minimap.layout(small ? 120 : 190, small ? 90 : 140);
  }

  private syncUndo(): void {
    const b = $<HTMLButtonElement>('undo');
    b.disabled = !this.game.undo.canUndo;
    b.title = this.game.undo.nextLabel ? `Undo ${this.game.undo.nextLabel}` : 'Nothing to undo';
  }

  private doUndo(): void {
    const label = this.game.undoLast();
    this.toast(label ? `Undid: ${label}` : 'Nothing to undo');
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
    $('brush-minus').addEventListener('click', () => {
      this.game.setBrushIndex(this.game.brushIndex - 1);
      this.syncBrush();
    });
    $('brush-plus').addEventListener('click', () => {
      this.game.setBrushIndex(this.game.brushIndex + 1);
      this.syncBrush();
    });
  }

  private syncBrush(): void {
    $('brush-size').textContent = String(BRUSH_SIZES[this.game.brushIndex]);
    const enabled = this.game.tool.usesBrush;
    $('brush').classList.toggle('disabled', !enabled);
    $<HTMLButtonElement>('brush-minus').disabled = !enabled || this.game.brushIndex === 0;
    $<HTMLButtonElement>('brush-plus').disabled = !enabled || this.game.brushIndex === BRUSH_SIZES.length - 1;
    const pw = $<HTMLButtonElement>('intensity');
    pw.hidden = !this.game.tool.usesIntensity;
    pw.replaceChildren();
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = 'Power ';
    pw.append(lbl, `${'●'.repeat(this.game.intensity)}${'○'.repeat(3 - this.game.intensity)}`);
    pw.setAttribute('aria-label', `Power level ${this.game.intensity} of 3`);
    const du = $<HTMLButtonElement>('duration');
    du.hidden = !this.game.tool.usesDuration;
    const d = EFFECT_DURATIONS[this.game.durationIndex];
    du.textContent = `⏳ ${d.label}`;
    du.setAttribute('aria-label', `Effect duration: ${d.label} (${Math.round(d.ticks / TICKS_PER_DAY)} days)`);
  }

  private bindZoom(): void {
    $('zoom-in').addEventListener('click', () => this.game.input.zoomCenter(1.4));
    $('zoom-out').addEventListener('click', () => this.game.input.zoomCenter(1 / 1.4));
    $('zoom-fit').addEventListener('click', () => this.game.camera.fit());
    $('undo').addEventListener('click', () => this.doUndo());
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
    const t = this.game.time;
    $<HTMLButtonElement>('slower').disabled = !t.canSlower;
    $<HTMLButtonElement>('faster').disabled = !t.canFaster;
    const p = $('pause');
    p.textContent = t.paused ? '▶' : '⏸';
    p.setAttribute('aria-label', t.paused ? 'Resume' : 'Pause');
    p.classList.toggle('active', t.paused);
    $('speed-label').textContent = `${t.multiplier}×`;
  }

  private refreshStatus(): void {
    const sim = this.game.sim;
    const d = sim.date;
    $('date').textContent = `Year ${d.year} · ${d.season} · Day ${d.day}${sim.speed === 0 ? ' · Paused' : ''}`;
    let herb = 0;
    let pred = 0;
    for (const s of SPECIES) {
      const n = sim.creatures.countSpecies(s.id);
      if (s.diet === 'carnivore') pred += n;
      else herb += n;
    }
    $('pop').textContent = `Animals ${herb + pred} · Herbivores ${herb} · Predators ${pred}`;
    const wx = sim.weather.summary();
    const parts = [
      wx.rain ? `🌧 ${wx.rain} rain` : '',
      wx.drought ? `☀️ ${wx.drought} drought` : '',
      sim.fire.burning ? `🔥 ${sim.fire.burning} burning` : '',
    ].filter(Boolean);
    $('weather-status').textContent = parts.length ? parts.join(' · ') : sim.weather.config.auto ? 'Clear skies' : 'Weather off';
    if (this.game.selectedId) this.renderCreature();
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
      title.textContent = `Creature #${game.selectedId}`;
      const status = line('Status');
      const update = () => {
        status.textContent = game.selectedFate ? `Died (${game.selectedFate})` : 'Gone';
      };
      update();
      this.creaturePanel = { id: game.selectedId, alive: false, update };
      el.hidden = false;
      return;
    }

    title.textContent = `${info.species.name} #${info.id}`;
    const stage = line('Stage');
    const doing = line('Doing');
    const diet = line('Diet');
    diet.textContent = `${info.species.diet}, ${info.species.habitat === 'water' ? 'lives in water' : 'lives on land'}`;
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
    const health = meter('Health');
    const hunger = meter('Hunger');
    const thirst = info.species.thirstRate > 0 ? meter('Thirst') : null;
    // Active buffs/debuffs, each removable. Rebuilt only when the set changes.
    const effBox = document.createElement('div');
    effBox.className = 'effects';
    body.appendChild(effBox);
    let effMask = -1;
    const renderEffects = (now: NonNullable<ReturnType<Game['selectedInfo']>>) => {
      if (now.effectMask === effMask) {
        for (const e of now.effects) {
          const left = effBox.querySelector<HTMLElement>(`[data-eff="${e.id}"] .left`);
          if (left) left.textContent = `${Math.ceil(e.ticks / TICKS_PER_DAY)} d`;
        }
        return;
      }
      effMask = now.effectMask;
      effBox.replaceChildren();
      for (const e of now.effects) {
        const def = EFFECTS[e.id];
        const chip = document.createElement('span');
        chip.className = `eff ${def.kind}`;
        chip.dataset.eff = String(e.id);
        chip.title = def.description;
        const label = document.createElement('span');
        label.textContent = `${def.icon} ${def.name} ${'●'.repeat(e.power)} `;
        const left = document.createElement('span');
        left.className = 'left';
        left.textContent = `${Math.ceil(e.ticks / TICKS_PER_DAY)} d`;
        const x = document.createElement('button');
        x.textContent = '✕';
        x.setAttribute('aria-label', `Remove ${def.name}`);
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
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      const name = `${info.species.name} #${info.id}`;
      if (game.removeSelected()) this.toast(`${name} removed`);
      this.renderCreature();
    });
    actions.append(follow, remove);
    body.appendChild(actions);

    const update = () => {
      const now = game.selectedInfo();
      if (!now) return;
      const years = Math.floor(now.ageTicks / TICKS_PER_YEAR);
      const days = Math.floor((now.ageTicks % TICKS_PER_YEAR) / TICKS_PER_DAY);
      stage.textContent = `${now.stage}, ${years > 0 ? `${years} y ` : ''}${days} d`;
      doing.textContent = now.state;
      health(now.health, now.maxHealth, 'high');
      hunger(now.hunger, 100, 'low');
      thirst?.(now.thirst, 100, 'low');
      renderEffects(now);
      follow.textContent = game.follow ? 'Following' : 'Follow';
      follow.classList.toggle('primary', game.follow);
    };
    update();
    this.creaturePanel = { id: info.id, alive: true, update };
    el.hidden = false;
  }

  private showInfo(r: TileReport): void {
    const el = $('info');
    const body = $('info-body');
    body.dataset.mode = 'tile';
    body.replaceChildren();
    const lines: Array<[string, string]> = [
      ['Tile', `${r.x}, ${r.y}`],
      ['Terrain', r.terrain],
      [r.elevationM < 0 ? 'Depth' : 'Elevation', `${Math.abs(r.elevationM)} m`],
      ['Temperature', `${r.temperatureC} °C (annual mean)`],
      ['Moisture', `${r.moisturePct}%`],
      ['Life nearby', r.nearbyLife],
    ];
    for (const [k, v] of lines) {
      const div = document.createElement('div');
      const b = document.createElement('b');
      b.textContent = `${k}: `;
      div.append(b, v);
      body.appendChild(div);
    }
    el.hidden = false;
  }

  // ---- menu --------------------------------------------------------------

  private bindMenu(): void {
    const size = $<HTMLSelectElement>('size');
    for (const s of WORLD_SIZES) {
      const o = document.createElement('option');
      o.value = s.key;
      o.textContent = s.label;
      size.appendChild(o);
    }
    size.value = 'medium';
    $('menu-close').addEventListener('click', () => this.menu.close());
    this.menu.addEventListener('click', (e) => {
      if (e.target === this.menu) this.menu.close(); // tap on backdrop
    });
    $('seed-random').addEventListener('click', () => {
      $<HTMLInputElement>('seed').value = String((Math.random() * 1e9) >>> 0);
    });
    const gen = $<HTMLButtonElement>('generate');
    gen.addEventListener('click', async () => {
      if (this.game.generating) return;
      gen.disabled = true;
      gen.textContent = 'Generating…';
      try {
        const { seed } = await this.game.newWorld(size.value, $<HTMLInputElement>('seed').value);
        this.menu.close();
        this.toast(`New world · seed ${seed}`);
      } catch (err) {
        this.toast(`Could not create world: ${(err as Error).message}`);
      } finally {
        gen.disabled = false;
        gen.textContent = 'Generate';
      }
    });
    const auto = $<HTMLInputElement>('weather-auto');
    const sev = $<HTMLSelectElement>('weather-severity');
    auto.addEventListener('change', () => (this.game.sim.weather.config.auto = auto.checked));
    sev.addEventListener('change', () => (this.game.sim.weather.config.severity = Number(sev.value)));
  }

  private openMenu(): void {
    $<HTMLInputElement>('weather-auto').checked = this.game.sim.weather.config.auto;
    $<HTMLSelectElement>('weather-severity').value = String(this.game.sim.weather.config.severity);
    $('weather-severity').title = SEVERITY.join(' / ');
    this.renderStats();
    this.renderHistory();
    $('current-seed').textContent = `Current world: seed ${this.game.sim.world.seed}, ${this.game.sim.world.width}×${this.game.sim.world.height}`;
    void this.renderSlots();
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
    const rows: Array<[string, string]> = [
      ['Land', `${((land / total) * 100).toFixed(1)}%`],
      ...TERRAIN.filter((t) => !t.water && counts[t.id] > 0)
        .sort((a, b) => counts[b.id] - counts[a.id])
        .map((t): [string, string] => [`  ${t.name}`, `${((counts[t.id] / land) * 100).toFixed(1)}% of land`]),
      ['Births / deaths', `${sim.creatures.births} / ${sim.creatures.deaths}`],
      ...SPECIES.flatMap((s): Array<[string, string]> => {
        const c = sim.creatures;
        const causes = CAUSE_NAMES.map((name, k) => [name, c.deathsBy(s.id, k)] as const)
          .filter(([, n]) => n > 0)
          .map(([name, n]) => `${name} ${n}`)
          .join(', ');
        return [
          [s.plural, `${c.countSpecies(s.id)} alive · ${c.birthStats[s.id]} born`],
          ...(causes ? ([[`  deaths`, causes]] as Array<[string, string]>) : []),
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
  }

  private renderHistory(): void {
    const el = $('history');
    el.replaceChildren();
    const entries = this.game.sim.history.slice().reverse();
    for (const h of entries) {
      const d = dateFromTick(h.tick);
      const li = document.createElement('li');
      li.textContent = `Year ${d.year}, ${d.season}: ${h.text}`;
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
      el.textContent = `Saving is unavailable: ${(err as Error).message}`;
      return;
    }
    SLOTS.forEach((slot, k) => {
      const s = summaries[k];
      const row = document.createElement('div');
      row.className = 'slot';
      const meta = document.createElement('div');
      meta.className = 'meta';
      const title = document.createElement('b');
      title.textContent = `Slot ${k + 1}`;
      meta.append(title, document.createElement('br'));
      if (s) {
        const d = dateFromTick(s.tick);
        meta.append(`Year ${d.year} ${d.season} · ${s.width}×${s.height} · ${new Date(s.savedAt).toLocaleString()}`);
      } else meta.append('Empty');

      const save = this.button('Save', async () => {
        await this.game.save(slot);
        this.toast(`Saved to slot ${k + 1}`);
        void this.renderSlots();
      });
      const load = this.button('Load', async () => {
        if (await this.game.load(slot)) {
          this.menu.close();
          this.toast(`Loaded slot ${k + 1}`);
        }
      });
      load.disabled = !s;
      const del = this.button('🗑', async () => {
        await deleteSlot(slot as SlotId);
        this.toast(`Slot ${k + 1} cleared`);
        void this.renderSlots();
      });
      del.disabled = !s;
      del.setAttribute('aria-label', `Delete slot ${k + 1}`);
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
        .catch((err: Error) => this.toast(`Failed: ${err.message}`))
        .finally(() => {
          if (b.isConnected) b.disabled = false;
        });
    });
    return b;
  }
}
