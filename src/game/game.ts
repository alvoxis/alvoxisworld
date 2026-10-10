import { seedFromString } from '../core/rng';
import { InputController } from '../input/input';
import { Camera } from '../render/camera';
import { Renderer, type BrushCursor, type VisualEffect } from '../render/renderer';
import { deserializeInto, serialize, type SaveData } from '../save/serialize';
import { decodeSaveFile, encodeSaveFile, saveFileName, type ImportReport } from '../save/file';
import { loadFromSlot, saveToSlot, type SlotId } from '../save/storage';
import { CAUSE, CAUSE_NAMES, SPECIES, type CreatureInfo } from '../sim/creatures';
import { EFFECT_DURATIONS } from '../sim/effects';
import type { WorkerLike } from '../sim/navjobs';
import { Simulation, type Speed } from '../sim/simulation';
import { TimeControl } from './timecontrol';
import { checkWorldSize, generateWorld, WORLD_SIZES } from '../world/generator';
import { generateWorldAsync, type GenWorkerLike } from '../world/genjobs';
import { SEA_LEVEL, TERRAIN } from '../world/terrain';
import { World } from '../world/world';
import { SHOWER_COUNTS } from '../sim/sky';
import { areaOf, BRUSH_SIZES, toolById, type AreaRing, type Tool, type ToolContext } from './tools';
import { UndoHistory, type UndoResult } from './undo';

export interface TileReport {
  x: number;
  y: number;
  terrain: string;
  elevationM: number;
  temperatureC: number;
  moisturePct: number;
  nearbyLife: string;
}

interface Stroke {
  x: number;
  y: number;
  lastApply: number;
}

/** Top-level game controller: owns the loop and exposes actions for the UI. */
export class Game {
  readonly camera = new Camera();
  readonly renderer: Renderer;
  readonly sim: Simulation;
  readonly input: InputController;
  tool: Tool = toolById('raise');
  brushIndex = 2;
  /** Power level 1..3 for god powers and effects. */
  intensity = 2;
  /** Index into EFFECT_DURATIONS for buffs/debuffs. */
  durationIndex = 1;
  /** Index into SHOWER_COUNTS for meteor showers. */
  countIndex = 1;
  /** Shows a short message (set by the UI). */
  onNotify: (text: string) => void = () => {};
  readonly undo = new UndoHistory();
  /** Short visual effects (meteor flash, quake ripple). */
  private effects: VisualEffect[] = [];
  /** Lightning bolts and impact dust being drawn (visual only; the damage already happened in the simulation). */
  private bolts: Array<{ x: number; y: number; start: number }> = [];
  private dust: Array<{ x: number; y: number; radius: number; start: number }> = [];
  /** Draw decorative fair-weather clouds (storm, rain and snow clouds always show). */
  showAmbientClouds = true;
  /** True while a new world is being generated. */
  generating = false;
  private genWorkerFactory: (() => GenWorkerLike) | null = null;
  private stroke: Stroke | null = null;
  private hoverPos: { x: number; y: number } | null = null;
  private previewUntil = 0;
  private lastFrame = 0;
  /** CPU time spent per frame (simulation + rendering), for performance measurements. */
  readonly frameStats = new FrameStats();
  private readonly toolCtx: ToolContext;

  /** Selected creature id (0 = none) and whether the camera follows it. */
  selectedId = 0;
  follow = false;
  /** Cause of death of the selected creature once it has died (null while alive). */
  selectedFate: string | null = null;

  /** UI hooks. */
  onInspect: (report: TileReport) => void = () => {};
  onSelect: () => void = () => {};
  onWorldChanged: () => void = () => {};
  onSpeedChanged: () => void = () => {};

  constructor(private readonly canvas: HTMLCanvasElement) {
    const game = this;
    this.renderer = new Renderer(canvas);
    const size = WORLD_SIZES[1];
    const seed = (Math.random() * 2 ** 32) >>> 0;
    this.sim = new Simulation(generateWorld(size.width, size.height, seed));
    this.sim.log(`World ${seed} was formed.`);
    this.sim.onSeasonChange = (s) => this.renderer.setWinter(s === 3);
    // A meteor the player launched is one undo step when it lands (natural ones are not recorded).
    // If a brush stroke is open when it lands, that stroke is closed first so the two never merge into one step.
    this.sim.impactRecorder = (label, run) => {
      this.undo.end();
      this.undo.record(this.sim.world, label, run);
    };
    this.attachWorld(this.sim.world);
    this.setupWorkers();

    this.toolCtx = {
      sim: this.sim,
      get intensity() {
        return game.intensity;
      },
      get durationTicks() {
        return EFFECT_DURATIONS[game.durationIndex].ticks;
      },
      get count() {
        return SHOWER_COUNTS[game.countIndex];
      },
      notify: (text) => this.onNotify(text),
      effect: (kind, x, y, radius) => {
        this.effects.push({ kind, x, y, radius, start: performance.now() });
        if (this.effects.length > 8) this.effects.shift();
      },
      inspect: (x, y) => {
        // Tap near a creature selects it; otherwise report the tile.
        const i = this.sim.creatures.nearestAt(x, y, Math.max(1, 22 / this.camera.zoom));
        if (i >= 0) {
          this.select(this.sim.creatures.id[i]);
          return;
        }
        this.select(0);
        const r = this.report(x, y);
        if (r) this.onInspect(r);
      },
    };

    this.input = new InputController(canvas, this.camera, {
      isPanMode: () => this.tool.id === 'move',
      beginStroke: (x, y) => this.beginStroke(x, y),
      moveStroke: (x, y) => this.moveStroke(x, y),
      endStroke: () => {
        this.stroke = null;
        this.undo.end();
      },
      hover: (p) => (this.hoverPos = p),
    });

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    this.camera.fit();
  }

  get brushRadius(): number {
    return BRUSH_SIZES[this.brushIndex];
  }

  start(): void {
    const loop = (t: number) => {
      const dt = this.lastFrame ? (t - this.lastFrame) / 1000 : 0;
      this.lastFrame = t;
      const t0 = performance.now();
      this.frame(t, dt);
      this.frameStats.record(performance.now() - t0);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private frame(now: number, dt: number): void {
    this.input.update(dt);
    if (this.stroke && Number.isFinite(this.tool.repeatMs) && this.tool.repeatMs > 0) {
      if (now - this.stroke.lastApply >= this.tool.repeatMs) {
        this.applyAt(this.stroke.x, this.stroke.y);
        this.stroke.lastApply = now;
      }
    }
    this.sim.advance(dt);
    this.collectSkyEvents(now);
    this.trackSelection();
    let cursor: BrushCursor | null = null;
    let pos = this.stroke ?? this.hoverPos;
    // On a touch screen there is no hover: after choosing a tool or a size, show its area at the middle of the view for a moment.
    if (!pos && now < this.previewUntil) pos = this.camera.screenToWorld(this.camera.viewW / 2, this.camera.viewH / 2);
    if (pos && this.tool.usesBrush) cursor = { x: pos.x, y: pos.y, rings: this.areaRings() };
    if (this.effects.length && now - this.effects[0].start > 1000) this.effects = this.effects.filter((e) => now - e.start <= 1000);
    this.renderer.render(this.camera, this.sim.creatures, cursor, this.sim.speed === 0 ? 1 : this.sim.alpha, this.selectedId, {
      burning: this.sim.fire.active,
      weather: this.sim.weather.systems,
      effects: this.effects,
      meteors: this.sim.sky.meteors,
      bolts: this.bolts,
      dust: this.dust,
      drift: this.sim.weather.drift,
      ambientClouds: this.showAmbientClouds,
      now,
    });
  }

  /** Turns the simulation's visual notices (bolts, impacts, quakes) into things the renderer draws. */
  private collectSkyEvents(now: number): void {
    for (const e of this.sim.sky.drainEvents()) {
      if (e.kind === 'bolt') this.bolts.push({ x: e.x, y: e.y, start: now });
      else if (e.kind === 'impact') {
        this.effects.push({ kind: 'meteor', x: e.x, y: e.y, radius: e.radius * 2, start: now });
        this.dust.push({ x: e.x, y: e.y, radius: e.radius, start: now });
      } else this.effects.push({ kind: 'quake', x: e.x, y: e.y, radius: e.radius, start: now });
    }
    if (this.effects.length > 12) this.effects.splice(0, this.effects.length - 12);
    if (this.dust.length > 8) this.dust.splice(0, this.dust.length - 8);
    if (this.bolts.length && now - this.bolts[0].start > 600) this.bolts = this.bolts.filter((b) => now - b.start <= 600);
    if (this.dust.length && now - this.dust[0].start > 7000) this.dust = this.dust.filter((d) => now - d.start <= 7000);
  }

  /**
   * Web Workers: navigation rebuilds and world generation run off the main thread
   * when the browser supports module workers; otherwise (or if a worker fails)
   * the same code runs on the main thread with identical results.
   */
  private setupWorkers(): void {
    if (typeof Worker === 'undefined') return;
    const navFactory = () =>
      new Worker(new URL('../sim/nav.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
    this.sim.creatures.nav.setWorkerFactory(navFactory);
    this.genWorkerFactory = () =>
      new Worker(new URL('../world/gen.worker.ts', import.meta.url), { type: 'module' }) as unknown as GenWorkerLike;
  }

  private resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.renderer.resize(r.width, r.height);
    this.camera.setViewport(r.width, r.height);
  }

  private attachWorld(world: World): void {
    this.renderer.setWorld(world);
    this.renderer.winter = false;
    this.renderer.setWinter(this.sim.date.seasonIndex === 3);
    this.camera.setWorldSize(world.width, world.height);
    world.markAllDirty();
    // Visual leftovers of the previous world (bolts, dust, rings) must not appear over the new one.
    this.bolts = [];
    this.dust = [];
    this.effects = [];
  }

  // ---- tools -------------------------------------------------------------

  setTool(id: string): void {
    this.tool = toolById(id);
    this.stroke = null;
    this.undo.end();
    this.showPreview();
  }

  setIntensity(level: number): void {
    this.intensity = Math.max(1, Math.min(3, Math.round(level)));
    this.showPreview();
  }

  setCountIndex(i: number): void {
    this.countIndex = Math.max(0, Math.min(SHOWER_COUNTS.length - 1, i));
  }

  /** The circles previewing the current tool's area at the chosen size and power. */
  areaRings(): AreaRing[] {
    return areaOf(this.tool, this.brushRadius, this.intensity);
  }

  /** Shows the area preview at the middle of the view for about two seconds. */
  showPreview(): void {
    this.previewUntil = performance.now() + 2000;
  }

  /** Reverts the last undoable action (tiles the world changed since are kept). Null if nothing to undo. */
  undoLast(): UndoResult | null {
    return this.undo.undo(this.sim.world);
  }

  /** Re-applies the last undone action. Null if nothing to redo. */
  redoLast(): UndoResult | null {
    return this.undo.redo(this.sim.world);
  }

  setBrushIndex(i: number): void {
    this.brushIndex = Math.max(0, Math.min(BRUSH_SIZES.length - 1, i));
    this.showPreview();
  }

  private applyAt(x: number, y: number): void {
    if (this.tool.undoable) {
      // One undo step per stroke: only tiles changed by the tool itself are recorded.
      this.undo.record(this.sim.world, this.tool.label, () => this.tool.apply(this.toolCtx, x, y, this.brushRadius));
    } else {
      this.tool.apply(this.toolCtx, x, y, this.brushRadius);
    }
  }

  private beginStroke(x: number, y: number): void {
    if (this.tool.id === 'move' || this.generating) return;
    this.stroke = { x, y, lastApply: performance.now() };
    if (this.tool.undoable) this.undo.begin(this.sim.world, this.tool.label);
    this.applyAt(x, y);
  }

  private moveStroke(x: number, y: number): void {
    const s = this.stroke;
    if (!s) return;
    if (this.tool.repeatMs === 0) {
      // Interpolate so fast drags leave a continuous line.
      const dist = Math.hypot(x - s.x, y - s.y);
      const step = Math.max(0.5, this.brushRadius * 0.5);
      const n = Math.ceil(dist / step);
      for (let k = 1; k <= n; k++) this.applyAt(s.x + ((x - s.x) * k) / n, s.y + ((y - s.y) * k) / n);
    }
    s.x = x;
    s.y = y;
  }

  report(wx: number, wy: number): TileReport | null {
    const w = this.sim.world;
    const x = Math.floor(wx);
    const y = Math.floor(wy);
    if (!w.inBounds(x, y)) return null;
    const i = w.idx(x, y);
    const c = this.sim.creatures;
    const counts = SPECIES.map(() => 0);
    for (let k = 0; k < c.count; k++) {
      if (Math.abs(c.x[k] - wx) <= 6 && Math.abs(c.y[k] - wy) <= 6) counts[c.species[k]]++;
    }
    const life = SPECIES.map((s, k) => (counts[k] ? `${counts[k]} ${(counts[k] > 1 ? s.plural : s.name).toLowerCase()}` : ''))
      .filter(Boolean)
      .join(', ');
    return {
      x,
      y,
      terrain: TERRAIN[w.terrain[i]].name,
      elevationM: (w.heights[i] - SEA_LEVEL) * 30,
      temperatureC: Math.round((w.temperature[i] / 255) * 56 - 16),
      moisturePct: Math.round((w.moisture[i] / 255) * 100),
      nearbyLife: life || 'none',
    };
  }

  // ---- creature selection ----------------------------------------------

  select(id: number): void {
    this.selectedId = id;
    this.selectedFate = null;
    if (!id) this.follow = false;
    this.onSelect();
  }

  selectedInfo(): CreatureInfo | null {
    const i = this.sim.creatures.indexOf(this.selectedId);
    return i < 0 ? null : this.sim.creatures.info(i);
  }

  /** Detects the selected creature's death and keeps the camera on it when following. */
  private trackSelection(): void {
    const deaths = this.sim.creatures.drainDeaths();
    if (!this.selectedId) return;
    if (this.selectedFate === null) {
      const d = deaths.find((r) => r.id === this.selectedId);
      if (d) {
        this.selectedFate = CAUSE_NAMES[d.cause];
        this.follow = false;
      }
    }
    if (this.follow) {
      const i = this.sim.creatures.indexOf(this.selectedId);
      if (i >= 0) this.camera.centerOn(this.sim.creatures.x[i], this.sim.creatures.y[i]);
    }
  }

  /** Removes one buff/debuff from the selected creature. */
  removeSelectedEffect(effect: number): boolean {
    const i = this.sim.creatures.indexOf(this.selectedId);
    if (i < 0) return false;
    this.sim.creatures.removeEffect(i, effect);
    return true;
  }

  removeSelected(): boolean {
    const ok = this.sim.creatures.removeById(this.selectedId);
    if (ok) {
      this.selectedFate = CAUSE_NAMES[CAUSE.REMOVED];
      this.follow = false;
    }
    return ok;
  }

  // ---- time --------------------------------------------------------------

  /** Pause and speed level (‹ ⏸ › controls). */
  readonly time = new TimeControl();

  /** Sets an exact speed; 0 pauses. Other values snap to the nearest level. */
  setSpeed(speed: Speed): void {
    this.time.set(speed);
    this.applySpeed();
  }

  togglePause(): void {
    this.time.togglePause();
    this.applySpeed();
  }

  faster(): boolean {
    const ok = this.time.faster();
    this.applySpeed();
    return ok;
  }

  slower(): boolean {
    const ok = this.time.slower();
    this.applySpeed();
    return ok;
  }

  private applySpeed(): void {
    this.sim.speed = this.time.speed;
    this.onSpeedChanged();
  }


  // ---- world lifecycle ---------------------------------------------------

  /**
   * Generates a new world (in a worker when available, so the page stays
   * responsive). Resolves with the seed; the old world keeps running until the
   * new one is ready.
   */
  async newWorld(width: number, height: number, seedText: string): Promise<{ seed: number; usedWorker: boolean }> {
    const problem = checkWorldSize(width, height);
    if (problem) throw new Error(problem);
    const size = { width, height };
    const seed = seedText.trim() ? seedFromString(seedText) : (Math.random() * 2 ** 32) >>> 0;
    this.generating = true;
    try {
      const { world, usedWorker } = await generateWorldAsync(size.width, size.height, seed, this.genWorkerFactory);
      const keep = { ...this.sim.weather.config };
      this.sim.reset(world);
      this.sim.weather.config = keep;
      this.sim.log(`World ${seed} was formed.`);
      this.attachWorld(world);
      this.camera.fit();
      this.select(0);
      this.undo.clear();
      this.onWorldChanged();
      return { seed, usedWorker };
    } finally {
      this.generating = false;
    }
  }

  async save(slot: SlotId): Promise<void> {
    await saveToSlot(slot, serialize(this.sim));
  }

  async load(slot: SlotId): Promise<boolean> {
    const data = await loadFromSlot(slot);
    if (!data) return false;
    this.install(data);
    return true;
  }

  /** The current world as a save file (gzip-compressed JSON when the browser supports it). */
  async exportFile(): Promise<{ bytes: Uint8Array; name: string }> {
    const data = serialize(this.sim);
    const { bytes } = await encodeSaveFile(data);
    return { bytes, name: saveFileName(data, `y${this.sim.date.year}`) };
  }

  /**
   * Validates a save file completely before touching the running world; throws
   * SaveFileError (world unchanged) for anything malformed.
   */
  async importFile(bytes: Uint8Array): Promise<ImportReport> {
    const report = await decodeSaveFile(bytes);
    this.install(report.data);
    this.sim.log(`World ${report.data.seed} was imported from a file.`);
    return report;
  }

  private install(data: SaveData): void {
    const world = deserializeInto(this.sim, data);
    this.attachWorld(world);
    this.camera.fit();
    this.select(0);
    this.undo.clear();
    this.onWorldChanged();
  }
}

/** Ring buffer of the last 240 frame costs (ms). */
export class FrameStats {
  private readonly samples = new Float32Array(240);
  private n = 0;

  record(ms: number): void {
    this.samples[this.n++ % this.samples.length] = ms;
  }

  reset(): void {
    this.n = 0;
  }

  /** Average, 95th percentile and maximum over the recorded window. */
  summary(): { frames: number; avg: number; p95: number; max: number } {
    const k = Math.min(this.n, this.samples.length);
    if (!k) return { frames: 0, avg: 0, p95: 0, max: 0 };
    const v = Array.from(this.samples.subarray(0, k)).sort((a, b) => a - b);
    return { frames: this.n, avg: v.reduce((a, b) => a + b, 0) / k, p95: v[Math.floor(k * 0.95)], max: v[k - 1] };
  }
}
