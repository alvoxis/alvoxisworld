import { CATEGORIES, TOOLS, BRUSH_SIZES, type Tool, type ToolCategory } from '../game/tools';
import type { Game, TileReport } from '../game/game';
import { creatureSprite } from '../render/tileset';
import { SLOTS, listSlots, deleteSlot, type SlotId } from '../save/storage';
import { dateFromTick } from '../sim/clock';
import { CAUSE_NAMES, SPECIES } from '../sim/creatures';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../sim/clock';
import { SPEEDS, type Speed } from '../sim/simulation';
import { WORLD_SIZES } from '../world/generator';
import { TERRAIN, isWater } from '../world/terrain';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** DOM user interface. Every control here calls a real Game action. */
export class Hud {
  private category: ToolCategory = 'terrain';
  private toastTimer = 0;
  private readonly menu = $<HTMLDialogElement>('menu');

  constructor(private readonly game: Game) {
    this.buildCategories();
    this.renderTools();
    this.bindTopbar();
    this.bindBrush();
    this.bindZoom();
    this.bindMenu();

    game.onInspect = (r) => this.showInfo(r);
    game.onSelect = () => this.renderCreature();
    game.onSpeedChanged = () => this.syncSpeed();
    game.onWorldChanged = () => {
      $('info').hidden = true;
      this.refreshStatus();
    };
    this.syncSpeed();
    this.syncBrush();
    this.refreshStatus();
    window.setInterval(() => this.refreshStatus(), 250);

    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.closest?.('input, select, textarea')) return;
      if (e.key === ' ') {
        e.preventDefault();
        this.game.setSpeed(this.game.sim.speed === 0 ? 1 : 0);
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
      b.className = 'chip';
      b.textContent = c.label;
      b.dataset.cat = c.id;
      b.addEventListener('click', () => {
        this.category = c.id;
        this.renderTools();
      });
      nav.appendChild(b);
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
      b.classList.toggle('active', b.dataset.cat === this.category);
    }
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
        this.toast(tool.id === 'move' ? 'Drag to move the map' : tool.label);
      });
      row.appendChild(b);
    }
  }

  private bindBrush(): void {
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
  }

  private bindZoom(): void {
    $('zoom-in').addEventListener('click', () => this.game.input.zoomCenter(1.4));
    $('zoom-out').addEventListener('click', () => this.game.input.zoomCenter(1 / 1.4));
    $('zoom-fit').addEventListener('click', () => this.game.camera.fit());
    $('info-close').addEventListener('click', () => {
      $('info').hidden = true;
      if (this.game.selectedId) this.game.select(0);
    });
  }

  // ---- top bar -----------------------------------------------------------

  private bindTopbar(): void {
    for (const b of $('speed').querySelectorAll<HTMLButtonElement>('button')) {
      b.addEventListener('click', () => {
        const s = Number(b.dataset.speed) as Speed;
        if ((SPEEDS as readonly number[]).includes(s)) this.game.setSpeed(s);
      });
    }
    $('btn-menu').addEventListener('click', () => this.openMenu());
  }

  private syncSpeed(): void {
    for (const b of $('speed').querySelectorAll<HTMLButtonElement>('button')) {
      b.classList.toggle('active', Number(b.dataset.speed) === this.game.sim.speed);
    }
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
    $('generate').addEventListener('click', () => {
      const seed = this.game.newWorld(size.value, $<HTMLInputElement>('seed').value);
      this.menu.close();
      this.toast(`New world · seed ${seed}`);
    });
  }

  private openMenu(): void {
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
