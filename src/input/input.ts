import { Camera } from '../render/camera';

export interface InputHandlers {
  /** True when one-finger / left-button drag should pan instead of using a tool. */
  isPanMode(): boolean;
  beginStroke(wx: number, wy: number): void;
  moveStroke(wx: number, wy: number): void;
  endStroke(): void;
  hover(pos: { x: number; y: number } | null): void;
  /** A short tap that did not move while the Move tool pans (so creatures can still be picked). */
  tap?(wx: number, wy: number): void;
}

const TOUCH_STROKE_DELAY_MS = 70;

interface PointerInfo {
  x: number;
  y: number;
  type: string;
}

/**
 * Unified pointer input for touch (iOS Safari), mouse and pen.
 *  - 1 finger / left mouse: use the active tool (or pan in Move mode)
 *  - 2 fingers: pan + pinch zoom (never paints)
 *  - right / middle mouse drag: pan; wheel: zoom at cursor
 *  - keyboard: arrows/WASD pan, +/- zoom
 */
export class InputController {
  private readonly pointers = new Map<number, PointerInfo>();
  private mode: 'none' | 'stroke' | 'pan' | 'gesture' | 'pending' = 'none';
  private pendingTimer = 0;
  private pendingPos: { x: number; y: number } | null = null;
  private lastGesture: { cx: number; cy: number; dist: number } | null = null;
  private readonly keys = new Set<string>();

  constructor(
    private readonly el: HTMLElement,
    private readonly camera: Camera,
    private readonly h: InputHandlers,
  ) {
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
    el.addEventListener('pointerleave', () => this.h.hover(null));
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    // iOS Safari: stop page-level pinch/double-tap zoom over the map.
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
      el.addEventListener(ev, (e) => e.preventDefault());
    }
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.closest?.('input, select, textarea, dialog')) return;
      this.keys.add(e.key.toLowerCase());
      if (e.key === '+' || e.key === '=') this.zoomCenter(1.25);
      if (e.key === '-' || e.key === '_') this.zoomCenter(0.8);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Applies held-key panning; call once per frame. */
  update(dt: number): void {
    const speed = 600 * dt;
    let dx = 0;
    let dy = 0;
    if (this.keys.has('arrowleft') || this.keys.has('a')) dx += speed;
    if (this.keys.has('arrowright') || this.keys.has('d')) dx -= speed;
    if (this.keys.has('arrowup') || this.keys.has('w')) dy += speed;
    if (this.keys.has('arrowdown') || this.keys.has('s')) dy -= speed;
    if (dx || dy) this.camera.pan(dx, dy);
  }

  zoomCenter(factor: number): void {
    this.camera.zoomAt(factor, this.camera.viewW / 2, this.camera.viewH / 2);
  }

  private local(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private world(p: { x: number; y: number }) {
    return this.camera.screenToWorld(p.x, p.y);
  }

  private tapStart: { x: number; y: number; t: number } | null = null;

  private onDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.el.setPointerCapture?.(e.pointerId);
    const p = this.local(e);
    this.pointers.set(e.pointerId, { ...p, type: e.pointerType });
    this.tapStart = this.pointers.size === 1 ? { x: p.x, y: p.y, t: performance.now() } : null;

    if (this.pointers.size >= 2) {
      this.cancelPending();
      if (this.mode === 'stroke') this.h.endStroke();
      this.mode = 'gesture';
      this.lastGesture = this.gestureState();
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) {
      this.mode = 'pan';
      return;
    }
    if (this.h.isPanMode()) {
      this.mode = 'pan';
      return;
    }
    if (e.pointerType === 'touch') {
      // Wait briefly so a second finger (pinch) doesn't paint a stray dab.
      this.mode = 'pending';
      this.pendingPos = p;
      this.pendingTimer = window.setTimeout(() => this.startStroke(), TOUCH_STROKE_DELAY_MS);
    } else {
      this.pendingPos = p;
      this.startStroke();
    }
  };

  private startStroke(): void {
    if (!this.pendingPos) return;
    this.mode = 'stroke';
    const w = this.world(this.pendingPos);
    this.pendingPos = null;
    this.h.beginStroke(w.x, w.y);
  }

  private cancelPending(): void {
    window.clearTimeout(this.pendingTimer);
    this.pendingPos = null;
  }

  private onMove = (e: PointerEvent): void => {
    const p = this.local(e);
    const prev = this.pointers.get(e.pointerId);
    if (!prev) {
      if (e.pointerType === 'mouse') this.h.hover(this.world(p));
      return;
    }
    e.preventDefault();
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    prev.x = p.x;
    prev.y = p.y;

    switch (this.mode) {
      case 'pan':
        this.camera.pan(dx, dy);
        break;
      case 'pending':
        this.pendingPos = p;
        if (Math.abs(dx) + Math.abs(dy) > 0) {
          window.clearTimeout(this.pendingTimer);
          this.startStroke();
        }
        break;
      case 'stroke': {
        const w = this.world(p);
        this.h.moveStroke(w.x, w.y);
        this.h.hover(w);
        break;
      }
      case 'gesture': {
        const g = this.gestureState();
        if (g && this.lastGesture) {
          this.camera.pan(g.cx - this.lastGesture.cx, g.cy - this.lastGesture.cy);
          if (this.lastGesture.dist > 0) this.camera.zoomAt(g.dist / this.lastGesture.dist, g.cx, g.cy);
        }
        this.lastGesture = g;
        break;
      }
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    const down = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.mode === 'pan' && this.tapStart && this.pointers.size === 0 && down) {
      const moved = Math.hypot(down.x - this.tapStart.x, down.y - this.tapStart.y);
      if (moved < 8 && performance.now() - this.tapStart.t < 450) {
        const w = this.world(down);
        this.h.tap?.(w.x, w.y);
      }
    }
    this.tapStart = null;
    if (this.mode === 'pending') {
      window.clearTimeout(this.pendingTimer);
      this.startStroke(); // a quick tap still applies the tool once
    }
    if (this.mode === 'stroke') this.h.endStroke();
    if (e.pointerType !== 'mouse') this.h.hover(null);

    if (this.pointers.size === 0) {
      this.mode = 'none';
      this.lastGesture = null;
    } else if (this.mode === 'gesture') {
      // Lifting one finger of a pinch: keep panning with the remaining one.
      this.mode = this.pointers.size >= 2 ? 'gesture' : 'pan';
      this.lastGesture = this.gestureState();
    } else {
      this.mode = 'none';
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = this.local(e);
    if (e.ctrlKey) {
      this.camera.zoomAt(Math.exp(-e.deltaY * 0.01), p.x, p.y); // trackpad pinch
    } else {
      this.camera.zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
    }
  };

  private gestureState(): { cx: number; cy: number; dist: number } | null {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return null;
    const [a, b] = pts;
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) };
  }
}
