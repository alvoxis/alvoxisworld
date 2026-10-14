/**
 * 2D camera. (x, y) is the world coordinate (in tiles) at the top-left of the
 * viewport; zoom is CSS pixels per tile.
 */
export class Camera {
  x = 0;
  y = 0;
  zoom = 24;
  viewW = 1;
  viewH = 1;
  minZoom = 0.5;
  maxZoom = 48;
  worldW = 1;
  worldH = 1;

  setViewport(w: number, h: number): void {
    this.viewW = Math.max(1, w);
    this.viewH = Math.max(1, h);
    this.updateLimits();
    this.clamp();
  }

  setWorldSize(w: number, h: number): void {
    this.worldW = w;
    this.worldH = h;
    this.updateLimits();
  }

  private updateLimits(): void {
    const fit = Math.min(this.viewW / this.worldW, this.viewH / this.worldH);
    this.minZoom = Math.min(fit * 0.8, 2);
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: this.x + sx / this.zoom, y: this.y + sy / this.zoom };
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: (wx - this.x) * this.zoom, y: (wy - this.y) * this.zoom };
  }

  /** Pans by a screen-space delta (CSS px). */
  pan(dxScreen: number, dyScreen: number): void {
    this.x -= dxScreen / this.zoom;
    this.y -= dyScreen / this.zoom;
    this.clamp();
  }

  /** Zooms by a factor while keeping the world point under (sx, sy) fixed. */
  zoomAt(factor: number, sx: number, sy: number): void {
    const before = this.screenToWorld(sx, sy);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    this.x = before.x - sx / this.zoom;
    this.y = before.y - sy / this.zoom;
    this.clamp();
  }

  centerOn(wx: number, wy: number): void {
    this.x = wx - this.viewW / this.zoom / 2;
    this.y = wy - this.viewH / this.zoom / 2;
    this.clamp();
  }

  /** Shows the whole world. */
  fit(): void {
    this.zoom = Math.max(this.minZoom, Math.min(this.viewW / this.worldW, this.viewH / this.worldH) * 0.98);
    this.centerOn(this.worldW / 2, this.worldH / 2);
  }

  /** Keeps the viewport centre inside the world. */
  clamp(): void {
    const halfW = this.viewW / this.zoom / 2;
    const halfH = this.viewH / this.zoom / 2;
    const cx = Math.min(this.worldW, Math.max(0, this.x + halfW));
    const cy = Math.min(this.worldH, Math.max(0, this.y + halfH));
    this.x = cx - halfW;
    this.y = cy - halfH;
  }
}

/**
 * Minimap ↔ world conversions (pure, so they can be unit-tested). The minimap
 * shows the whole world scaled to mmW × mmH pixels.
 */
export function minimapToWorld(mx: number, my: number, mmW: number, mmH: number, worldW: number, worldH: number) {
  return {
    x: Math.min(worldW, Math.max(0, (mx / mmW) * worldW)),
    y: Math.min(worldH, Math.max(0, (my / mmH) * worldH)),
  };
}

/** The camera's visible area as a rectangle in minimap pixels. */
export function viewportOnMinimap(camera: Camera, mmW: number, mmH: number) {
  const sx = mmW / camera.worldW;
  const sy = mmH / camera.worldH;
  return {
    x: camera.x * sx,
    y: camera.y * sy,
    w: (camera.viewW / camera.zoom) * sx,
    h: (camera.viewH / camera.zoom) * sy,
  };
}
