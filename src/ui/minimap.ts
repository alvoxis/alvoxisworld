import { minimapToWorld, viewportOnMinimap } from '../render/camera';
import type { Game } from '../game/game';

/** How often the minimap's map image is refreshed (ms). The viewport box updates every frame it changes. */
const REFRESH_MS = 250;
/** How often the scaled map image is rebuilt from the 1px map (ms). */
const SHRINK_MS = 1000;

/**
 * Minimap: the renderer's 1-pixel-per-tile map scaled down (no extra map
 * rendering), the camera's view as a rectangle, and tap/drag to move the camera.
 */
export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private lastDraw = 0;
  private lastKey = '';
  private dragging = false;
  private small: HTMLCanvasElement | null = null;
  private lastShrink = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly game: Game,
  ) {
    this.ctx = canvas.getContext('2d')!;
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.dragging = true;
      canvas.setPointerCapture?.(e.pointerId);
      this.jump(e);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      e.preventDefault();
      this.jump(e);
    });
    const stop = () => (this.dragging = false);
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
    const loop = (t: number) => {
      this.draw(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /** Resizes the minimap to the world's aspect ratio within maxW × maxH CSS pixels. */
  layout(maxW: number, maxH: number): void {
    const w = this.game.sim.world;
    const scale = Math.min(maxW / w.width, maxH / w.height);
    const cssW = Math.round(w.width * scale);
    const cssH = Math.round(w.height * scale);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.lastKey = '';
    this.small = null; // world may have changed size
  }

  /**
   * Caches the 1px map scaled to the minimap with high-quality smoothing (the
   * browser averages instead of point-sampling, so huge maps do not speckle).
   * Measured at about 2 ms for a 2048×1280 map in headless Chromium; done at most
   * once per SHRINK_MS, and every frame only copies the cached image.
   */
  private shrink(W: number, H: number, now: number): void {
    this.lastShrink = now;
    const dst = (this.small ??= document.createElement('canvas'));
    if (dst.width !== W || dst.height !== H) {
      dst.width = W;
      dst.height = H;
    }
    const c = dst.getContext('2d')!;
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(this.game.renderer.baseCanvas, 0, 0, W, H);
  }

  private jump(e: PointerEvent): void {
    const r = this.canvas.getBoundingClientRect();
    const w = this.game.sim.world;
    const p = minimapToWorld(e.clientX - r.left, e.clientY - r.top, r.width, r.height, w.width, w.height);
    this.game.follow = false;
    this.game.camera.centerOn(p.x, p.y);
  }

  private draw(now: number): void {
    if (this.canvas.offsetParent === null) return; // hidden
    const cam = this.game.camera;
    const key = `${cam.x.toFixed(1)},${cam.y.toFixed(1)},${cam.zoom.toFixed(3)}`;
    if (key === this.lastKey && now - this.lastDraw < REFRESH_MS) return;
    this.lastKey = key;
    this.lastDraw = now;
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (!this.small || now - this.lastShrink > SHRINK_MS || this.small.width !== W || this.small.height !== H) this.shrink(W, H, now);
    ctx.drawImage(this.small!, 0, 0);
    const v = viewportOnMinimap(cam, W, H);
    ctx.lineWidth = Math.max(1.5, W / 120);
    ctx.strokeStyle = '#f2c14e';
    ctx.strokeRect(v.x, v.y, Math.max(3, v.w), Math.max(3, v.h));
  }
}
