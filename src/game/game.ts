import { seedFromString } from '../core/rng';
import { InputController } from '../input/input';
import { Camera } from '../render/camera';
import { Renderer, type BrushCursor } from '../render/renderer';
import { deserializeInto, serialize } from '../save/serialize';
import { loadFromSlot, saveToSlot, type SlotId } from '../save/storage';
import { SPECIES } from '../sim/creatures';
import { Simulation, type Speed } from '../sim/simulation';
import { generateWorld, WORLD_SIZES } from '../world/generator';
import { SEA_LEVEL, TERRAIN } from '../world/terrain';
import { World } from '../world/world';
import { BRUSH_SIZES, toolById, type Tool, type ToolContext } from './tools';

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
  private stroke: Stroke | null = null;
  private hoverPos: { x: number; y: number } | null = null;
  private lastFrame = 0;
  private readonly toolCtx: ToolContext;

  /** UI hooks. */
  onInspect: (report: TileReport) => void = () => {};
  onWorldChanged: () => void = () => {};
  onSpeedChanged: () => void = () => {};

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    const size = WORLD_SIZES[1];
    const seed = (Math.random() * 2 ** 32) >>> 0;
    this.sim = new Simulation(generateWorld(size.width, size.height, seed));
    this.sim.log(`World ${seed} was formed.`);
    this.sim.onSeasonChange = (s) => this.renderer.setWinter(s === 3);
    this.attachWorld(this.sim.world);

    this.toolCtx = {
      sim: this.sim,
      inspect: (x, y) => {
        const r = this.report(x, y);
        if (r) this.onInspect(r);
      },
    };

    this.input = new InputController(canvas, this.camera, {
      isPanMode: () => this.tool.id === 'move',
      beginStroke: (x, y) => this.beginStroke(x, y),
      moveStroke: (x, y) => this.moveStroke(x, y),
      endStroke: () => (this.stroke = null),
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
      this.frame(t, dt);
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
    let cursor: BrushCursor | null = null;
    const pos = this.stroke ?? this.hoverPos;
    if (pos && this.tool.usesBrush) cursor = { x: pos.x, y: pos.y, radius: this.brushRadius };
    this.renderer.render(this.camera, this.sim.creatures, cursor);
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
  }

  // ---- tools -------------------------------------------------------------

  setTool(id: string): void {
    this.tool = toolById(id);
    this.stroke = null;
  }

  setBrushIndex(i: number): void {
    this.brushIndex = Math.max(0, Math.min(BRUSH_SIZES.length - 1, i));
  }

  private applyAt(x: number, y: number): void {
    this.tool.apply(this.toolCtx, x, y, this.brushRadius);
  }

  private beginStroke(x: number, y: number): void {
    if (this.tool.id === 'move') return;
    this.stroke = { x, y, lastApply: performance.now() };
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
    const life = SPECIES.map((s, k) => (counts[k] ? `${counts[k]} ${s.name.toLowerCase()}${counts[k] > 1 ? 's' : ''}` : ''))
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

  // ---- time --------------------------------------------------------------

  setSpeed(speed: Speed): void {
    this.sim.speed = speed;
    this.onSpeedChanged();
  }

  // ---- world lifecycle ---------------------------------------------------

  newWorld(sizeKey: string, seedText: string): number {
    const size = WORLD_SIZES.find((s) => s.key === sizeKey) ?? WORLD_SIZES[1];
    const seed = seedText.trim() ? seedFromString(seedText) : (Math.random() * 2 ** 32) >>> 0;
    const world = generateWorld(size.width, size.height, seed);
    this.sim.reset(world);
    this.sim.log(`World ${seed} was formed.`);
    this.attachWorld(world);
    this.camera.fit();
    this.onWorldChanged();
    return seed;
  }

  async save(slot: SlotId): Promise<void> {
    await saveToSlot(slot, serialize(this.sim));
  }

  async load(slot: SlotId): Promise<boolean> {
    const data = await loadFromSlot(slot);
    if (!data) return false;
    const world = deserializeInto(this.sim, data);
    this.attachWorld(world);
    this.camera.fit();
    this.onWorldChanged();
    return true;
  }
}
