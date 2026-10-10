import { hash2 } from '../core/rng';
import type { MeteorInFlight } from '../sim/sky';
import { WEATHER_KIND, type WeatherSystem } from '../sim/weather';
import type { Camera } from './camera';

/** Short-lived visual effect (pure decoration over a real simulation change). */
export interface VisualEffect {
  kind: 'meteor' | 'quake';
  x: number;
  y: number;
  radius: number;
  /** performance.now() when it started. */
  start: number;
}

export interface Bolt {
  x: number;
  y: number;
  start: number;
}

export interface Dust {
  x: number;
  y: number;
  radius: number;
  start: number;
}

/** Everything the sky layer needs for one frame. */
export interface SkyFrame {
  systems: readonly WeatherSystem[];
  meteors: readonly MeteorInFlight[];
  bolts: readonly Bolt[];
  dust: readonly Dust[];
  effects: readonly VisualEffect[];
  burning: readonly number[];
  drift: { x: number; y: number };
  ambientClouds: boolean;
  worldW: number;
  worldH: number;
  now: number;
}

type Palette = 'fair' | 'rain' | 'storm' | 'snow';
const PALETTES: Record<Palette, { top: readonly [number, number, number]; bottom: readonly [number, number, number] }> = {
  fair: { top: [255, 255, 255], bottom: [184, 204, 228] },
  rain: { top: [196, 205, 218], bottom: [116, 130, 154] },
  storm: { top: [128, 136, 156], bottom: [50, 56, 76] },
  snow: { top: [246, 249, 253], bottom: [198, 211, 228] },
};
const SHAPES = 4;
const SPRITE_W = 44;
const SPRITE_H = 24;

/** Budgets that keep the sky cheap on phones (all per frame). */
const MAX_AMBIENT = 120;
const MAX_RAIN_DROPS = 90;
const MAX_SNOW_FLAKES = 110;
const MAX_SMOKE_SOURCES = 40;

/** Cheap deterministic hash to a float in [0, 1). */
function rnd(a: number, b: number, c = 0): number {
  return hash2(a | 0, b | 0, c | 0);
}

/**
 * The sky layer drawn over the map: drifting clouds (decorative fair-weather ones,
 * and clouds that belong to rain, storm and snow systems), their shadows,
 * precipitation, lightning, meteors in flight with trails and landing markers,
 * smoke from fires, and impact dust. It only reads simulation state; every
 * effect that matters (rain, damage, fire) is computed by the simulation.
 * Clouds are pre-rendered pixel-art sprites, so drawing them is a handful of
 * drawImage calls.
 */
export class SkyRenderer {
  private readonly clouds: Record<Palette, HTMLCanvasElement[]>;
  private readonly shadows: HTMLCanvasElement[];

  constructor() {
    const palettes = Object.keys(PALETTES) as Palette[];
    this.clouds = {} as Record<Palette, HTMLCanvasElement[]>;
    for (const p of palettes) this.clouds[p] = Array.from({ length: SHAPES }, (_, k) => makeCloud(k, p));
    this.shadows = this.clouds.fair.map((c) => makeShadow(c));
  }

  draw(
    ctx: CanvasRenderingContext2D, camera: Camera, s: number, ox: number, oy: number, dpr: number, f: SkyFrame,
  ): void {
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    const zoom = camera.zoom;
    ctx.save();
    ctx.imageSmoothingEnabled = false;

    this.drawSmoke(ctx, s, ox, oy, dpr, f, cw, ch);
    this.drawDust(ctx, s, ox, oy, f);
    this.drawGroundTint(ctx, s, ox, oy, f);
    this.drawImpactEffects(ctx, s, ox, oy, dpr, f);
    this.drawMeteorMarkers(ctx, s, ox, oy, dpr, f);

    // Clouds fade as the camera comes close, so the ground stays readable.
    // (and thin out when the whole world is in view, where they would cover the map).
    const ambientAlpha = f.ambientClouds ? clamp01((16 - zoom) / 10) * (0.35 + 0.25 * clamp01((zoom - 0.8) / 1.5)) : 0;
    const weatherAlpha = 0.4 + 0.6 * clamp01((22 - zoom) / 14);
    const list = this.collectClouds(camera, s, ox, oy, f, cw, ch, ambientAlpha, weatherAlpha);
    // Shadows first (offset toward the south-east, as if the sun is in the north-west), then clouds.
    for (const c of list) {
      ctx.globalAlpha = c.alpha * 0.32;
      ctx.drawImage(this.shadows[c.shape], c.x + c.w * 0.1, c.y + c.h * 0.55, c.w, c.h);
    }
    this.drawPrecipitation(ctx, s, ox, oy, dpr, f, cw, ch);
    for (const c of list) {
      ctx.globalAlpha = c.alpha;
      ctx.drawImage(this.clouds[c.palette][c.shape], c.x, c.y, c.w, c.h);
    }
    ctx.globalAlpha = 1;

    this.drawMeteors(ctx, s, ox, oy, dpr, f);
    this.drawBolts(ctx, s, ox, oy, dpr, f, cw, ch);
    ctx.restore();
  }

  // ---- clouds ---------------------------------------------------------------

  private collectClouds(
    camera: Camera, s: number, ox: number, oy: number, f: SkyFrame, cw: number, ch: number, ambientAlpha: number,
    weatherAlpha: number,
  ): Array<{ x: number; y: number; w: number; h: number; alpha: number; shape: number; palette: Palette }> {
    const out: Array<{ x: number; y: number; w: number; h: number; alpha: number; shape: number; palette: Palette }> = [];
    const push = (wx: number, wy: number, wTiles: number, alpha: number, shape: number, palette: Palette) => {
      const w = wTiles * s;
      const h = w * (SPRITE_H / SPRITE_W);
      const x = ox + wx * s - w / 2;
      const y = oy + wy * s - h / 2;
      if (x > cw || y > ch || x + w < 0 || y + h < 0 || w < 2) return;
      out.push({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), alpha, shape, palette });
    };
    if (ambientAlpha > 0.01) {
      // About one cloud per 50×50 tiles; only those on screen are drawn.
      const n = Math.max(14, Math.min(MAX_AMBIENT, Math.round((f.worldW * f.worldH) / 2500)));
      const margin = 40;
      const spanX = f.worldW + margin * 2;
      const spanY = f.worldH + margin * 2;
      for (let k = 0; k < n; k++) {
        const speed = 0.6 + 0.8 * rnd(k, 5, 1);
        // Positions wrap around the world (with a margin, so they leave and enter off the map).
        const wx = mod(rnd(k, 1, 1) * spanX + f.drift.x * speed, spanX) - margin;
        const wy = mod(rnd(k, 2, 1) * spanY + f.drift.y * speed, spanY) - margin;
        const size = 11 + 18 * rnd(k, 3, 1);
        push(wx, wy, size, ambientAlpha * (0.6 + 0.4 * rnd(k, 4, 1)), k % SHAPES, 'fair');
      }
    }
    for (const sys of f.systems) {
      if (sys.kind !== WEATHER_KIND.RAIN) continue;
      const palette: Palette = sys.snow ? 'snow' : sys.storm ? 'storm' : 'rain';
      const puffs = Math.max(4, Math.min(12, Math.round(sys.radius / 3.5)));
      const alpha = Math.min(0.95, (0.55 + 0.4 * sys.intensity) * weatherAlpha * (sys.ttl < 60 ? sys.ttl / 60 : 1));
      for (let k = 0; k < puffs; k++) {
        const a = rnd(sys.id, k, 7) * Math.PI * 2 + f.now / 60000 * (k % 2 ? 1 : -1);
        const r = Math.sqrt(rnd(sys.id, k, 8)) * sys.radius * 0.75;
        const bob = Math.sin(f.now / 3500 + k * 1.7) * sys.radius * 0.02;
        push(
          sys.x + Math.cos(a) * r + bob, sys.y + Math.sin(a) * r * 0.8, sys.radius * (0.55 + 0.45 * rnd(sys.id, k, 9)),
          alpha, (sys.id + k) % SHAPES, palette,
        );
      }
    }
    void camera;
    return out;
  }

  // ---- ground effects --------------------------------------------------------

  /** Soft tint on the ground under rain (blue-grey), snow (white), storms (dark) and droughts (warm haze). */
  private drawGroundTint(ctx: CanvasRenderingContext2D, s: number, ox: number, oy: number, f: SkyFrame): void {
    for (const sys of f.systems) {
      const cx = ox + sys.x * s;
      const cy = oy + sys.y * s;
      const r = sys.radius * s;
      if (cx + r < 0 || cy + r < 0 || cx - r > ctx.canvas.width || cy - r > ctx.canvas.height) continue;
      const a = 0.12 + 0.18 * sys.intensity;
      const g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
      if (sys.kind === WEATHER_KIND.DROUGHT) g.addColorStop(0, `rgba(240,150,40,${a * 0.9})`);
      else if (sys.snow) g.addColorStop(0, `rgba(235,244,255,${a * 1.2})`);
      else if (sys.storm) g.addColorStop(0, `rgba(30,38,60,${a * 1.7})`);
      else g.addColorStop(0, `rgba(60,80,110,${a * 1.2})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Falling rain streaks and snowflakes, placed only over the part of each system that is on screen. */
  private drawPrecipitation(
    ctx: CanvasRenderingContext2D, s: number, ox: number, oy: number, dpr: number, f: SkyFrame, cw: number, ch: number,
  ): void {
    const t = f.now / 1000;
    for (const sys of f.systems) {
      if (sys.kind !== WEATHER_KIND.RAIN) continue;
      const cx = ox + sys.x * s;
      const cy = oy + sys.y * s;
      const r = sys.radius * s;
      const x0 = Math.max(0, cx - r);
      const y0 = Math.max(0, cy - r);
      const x1 = Math.min(cw, cx + r);
      const y1 = Math.min(ch, cy + r);
      if (x1 <= x0 || y1 <= y0) continue;
      const area = (x1 - x0) * (y1 - y0);
      const snow = sys.snow;
      const cap = snow ? MAX_SNOW_FLAKES : MAX_RAIN_DROPS;
      const n = Math.min(cap, Math.round((8 + area / (1800 * dpr * dpr)) * (0.4 + 0.6 * sys.intensity)));
      const w = x1 - x0;
      const h = y1 - y0;
      if (snow) {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        const px = Math.max(3, Math.round(3 * dpr));
        for (let k = 0; k < n; k++) {
          const fx = rnd(sys.id, k, 21);
          const fall = (rnd(sys.id, k, 22) + t * (0.08 + 0.05 * rnd(sys.id, k, 23))) % 1;
          const x = x0 + fx * w + Math.sin(t * 1.3 + k) * 4 * dpr;
          const y = y0 + fall * h;
          if (Math.hypot(x - cx, y - cy) > r) continue;
          ctx.fillRect(Math.round(x), Math.round(y), px, px);
        }
      } else {
        ctx.strokeStyle = sys.storm ? 'rgba(190,210,240,0.7)' : 'rgba(200,225,255,0.55)';
        ctx.lineWidth = Math.max(1, dpr);
        ctx.beginPath();
        const len = 9 * dpr;
        for (let k = 0; k < n; k++) {
          const fx = rnd(sys.id, k, 11);
          const fall = (rnd(sys.id, k, 12) + t * (sys.storm ? 1.5 : 1.1)) % 1;
          const x = x0 + fx * w;
          const y = y0 + fall * h;
          if (Math.hypot(x - cx, y - cy) > r) continue;
          ctx.moveTo(x, y);
          ctx.lineTo(x - 2.5 * dpr, y + len);
        }
        ctx.stroke();
      }
    }
  }

  // ---- fire smoke and impact dust ----------------------------------------------

  /** Rising smoke over burning tiles (a bounded sample, only those on screen). */
  private drawSmoke(
    ctx: CanvasRenderingContext2D, s: number, ox: number, oy: number, dpr: number, f: SkyFrame, cw: number, ch: number,
  ): void {
    const list = f.burning;
    if (!list.length || s < 1.5) return;
    const stride = Math.max(1, Math.ceil(list.length / 240));
    let drawn = 0;
    const W = f.worldW;
    for (let k = 0; k < list.length && drawn < MAX_SMOKE_SOURCES; k += stride) {
      const i = list[k];
      const x = i % W;
      const y = (i - x) / W;
      const px = ox + (x + 0.5) * s;
      const py = oy + (y + 0.5) * s;
      if (px < -s * 3 || py < -s * 6 || px > cw + s * 3 || py > ch + s) continue;
      drawn++;
      for (let q = 0; q < 2; q++) {
        const ph = (f.now / 2400 + rnd(i, q, 31) + q * 0.5) % 1;
        const rise = ph * Math.max(2.2 * s, 18 * dpr);
        const rad = Math.max(2 * dpr, (0.35 + 0.8 * ph) * s * 0.55);
        const sway = Math.sin(f.now / 900 + i) * ph * s * 0.4;
        ctx.fillStyle = `rgba(38,36,40,${0.38 * (1 - ph)})`;
        ctx.beginPath();
        ctx.arc(px + sway + ph * s * 0.5, py - rise, rad, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /** Dust and smoke that rises from a meteor crater for several seconds. */
  private drawDust(ctx: CanvasRenderingContext2D, s: number, ox: number, oy: number, f: SkyFrame): void {
    for (const d of f.dust) {
      const age = (f.now - d.start) / 7000;
      if (age < 0 || age > 1) continue;
      const cx = ox + d.x * s;
      const cy = oy + d.y * s;
      for (let k = 0; k < 14; k++) {
        const a = rnd(Math.round(d.start), k, 41) * Math.PI * 2;
        const dist = d.radius * s * (0.2 + 0.9 * rnd(Math.round(d.start), k, 42)) * (0.4 + 0.6 * Math.min(1, age * 4));
        const rise = age * d.radius * s * (0.6 + 0.8 * rnd(Math.round(d.start), k, 43));
        const rad = d.radius * s * (0.12 + 0.2 * age) * (0.6 + 0.6 * rnd(Math.round(d.start), k, 44));
        const dark = 1 - Math.min(1, age * 1.6);
        ctx.fillStyle = `rgba(${Math.round(70 + 40 * (1 - dark))},${Math.round(62 + 40 * (1 - dark))},${Math.round(58 + 40 * (1 - dark))},${0.45 * (1 - age)})`;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * dist, cy + Math.sin(a) * dist * 0.7 - rise, Math.max(1.5, rad), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /** Expanding rings for meteor impacts and earthquakes. */
  private drawImpactEffects(ctx: CanvasRenderingContext2D, s: number, ox: number, oy: number, dpr: number, f: SkyFrame): void {
    for (const e of f.effects) {
      const age = (f.now - e.start) / 900;
      if (age < 0 || age > 1) continue;
      const cx = ox + e.x * s;
      const cy = oy + e.y * s;
      const r = e.radius * s * (0.3 + age);
      ctx.lineWidth = Math.max(2, 4 * dpr * (1 - age));
      ctx.strokeStyle = e.kind === 'meteor' ? `rgba(255,220,140,${1 - age})` : `rgba(200,170,120,${1 - age})`;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      if (e.kind === 'meteor' && age < 0.3) {
        ctx.fillStyle = `rgba(255,240,200,${0.6 * (1 - age / 0.3)})`;
        ctx.beginPath();
        ctx.arc(cx, cy, e.radius * s * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ---- meteors -----------------------------------------------------------------

  /** Where a meteor is on screen: it comes in along `angle`, higher (and farther back) the more time it has left. */
  private meteorPos(m: MeteorInFlight, s: number, ox: number, oy: number): { x: number; y: number; f: number } {
    const f = m.ttl / m.total;
    const dist = f * (30 + 5 * m.radius);
    return {
      x: ox + (m.x + Math.cos(m.angle) * dist) * s,
      y: oy + (m.y + Math.sin(m.angle) * dist - dist * 0.55) * s,
      f,
    };
  }

  /** A pulsing ring where each meteor will land, so the impact is never a surprise. */
  private drawMeteorMarkers(ctx: CanvasRenderingContext2D, s: number, ox: number, oy: number, dpr: number, f: SkyFrame): void {
    for (const m of f.meteors) {
      const R = Math.max(2, m.radius) * (0.7 + 0.3 * m.intensity);
      const cx = ox + m.x * s;
      const cy = oy + m.y * s;
      const k = 1 - m.ttl / m.total;
      ctx.strokeStyle = `rgba(255,${Math.round(150 - 80 * k)},60,${0.25 + 0.5 * k})`;
      ctx.lineWidth = Math.max(1.5, 2 * dpr);
      ctx.setLineDash([6 * dpr, 5 * dpr]);
      ctx.beginPath();
      ctx.arc(cx, cy, R * s * (1.1 - 0.15 * Math.sin(f.now / 120)), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // The shadow grows as it nears the ground.
      ctx.fillStyle = `rgba(0,0,0,${0.12 + 0.25 * k})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, R * s * 0.5 * k + 2, R * s * 0.3 * k + 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawMeteors(ctx: CanvasRenderingContext2D, s: number, ox: number, oy: number, dpr: number, f: SkyFrame): void {
    for (const m of f.meteors) {
      const head = this.meteorPos(m, s, ox, oy);
      const R = Math.max(2, m.radius);
      const size = Math.max(5 * dpr, Math.min(46 * dpr, (0.8 + R * 0.16) * s));
      // Trail: puffs back along the flight path, cooling from fire to smoke.
      const back = 16;
      for (let j = back; j >= 1; j--) {
        const fk = Math.min(1.35, m.ttl / m.total + j * 0.035);
        const dist = fk * (30 + 5 * m.radius);
        const x = ox + (m.x + Math.cos(m.angle) * dist) * s;
        const y = oy + (m.y + Math.sin(m.angle) * dist - dist * 0.55) * s;
        const k = j / back;
        ctx.fillStyle =
          k < 0.35 ? `rgba(255,${Math.round(200 - 120 * k)},70,${0.75 * (1 - k)})` : `rgba(90,80,78,${0.55 * (1 - k)})`;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1.5 * dpr, size * 0.5 * (1 - k * 0.6)), 0, Math.PI * 2);
        ctx.fill();
      }
      const g = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, size * 1.5);
      g.addColorStop(0, 'rgba(255,250,220,1)');
      g.addColorStop(0.35, 'rgba(255,170,60,0.85)');
      g.addColorStop(1, 'rgba(255,90,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(head.x, head.y, size * 1.5, 0, Math.PI * 2);
      ctx.fill();
      // A blocky rock core, in keeping with the pixel-art look.
      ctx.fillStyle = '#3b2f2a';
      const c = Math.round(size * 0.5);
      ctx.fillRect(Math.round(head.x - c / 2), Math.round(head.y - c / 2), c, c);
    }
  }

  // ---- lightning -----------------------------------------------------------------

  private drawBolts(ctx: CanvasRenderingContext2D, s: number, ox: number, oy: number, dpr: number, f: SkyFrame, cw: number, ch: number): void {
    for (const b of f.bolts) {
      const age = (f.now - b.start) / 450;
      if (age < 0 || age > 1) continue;
      const gx = ox + b.x * s;
      const gy = oy + b.y * s;
      if (gx < -50 || gx > cw + 50 || gy < -50 || gy > ch + 300) continue;
      if (age < 0.22) {
        ctx.fillStyle = `rgba(235,240,255,${0.2 * (1 - age / 0.22)})`;
        ctx.fillRect(0, 0, cw, ch); // the whole sky flashes
      }
      const topY = gy - Math.max(120 * dpr, 12 * s);
      const seed = Math.round(b.start) & 0xffff;
      const segs = 9;
      const pts: Array<[number, number]> = [];
      for (let k = 0; k <= segs; k++) {
        const t = k / segs;
        const jitter = k === 0 || k === segs ? 0 : (rnd(seed, k, 51) - 0.5) * 26 * dpr;
        pts.push([gx + (1 - t) * 20 * dpr + jitter - 20 * dpr * (1 - t), topY + (gy - topY) * t]);
      }
      const a = Math.pow(1 - age, 1.4);
      for (const [width, col] of [[7 * dpr, `rgba(170,190,255,${0.35 * a})`], [2.2 * dpr, `rgba(255,255,255,${a})`]] as const) {
        ctx.strokeStyle = col;
        ctx.lineWidth = Math.max(1, width);
        ctx.lineJoin = 'round';
        ctx.beginPath();
        pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      }
      ctx.fillStyle = `rgba(255,255,255,${0.7 * a})`;
      ctx.beginPath();
      ctx.arc(gx, gy, Math.max(3 * dpr, s * 0.9) * (1 - age * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mod = (a: number, n: number) => ((a % n) + n) % n;

/** A pixel-art cloud: union of soft discs, lit from the north-west, with a lighter rim. */
function makeCloud(shape: number, palette: Palette): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = SPRITE_W;
  c.height = SPRITE_H;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(SPRITE_W, SPRITE_H);
  const blobs: Array<[number, number, number]> = [];
  const n = 5 + (shape % 3);
  for (let k = 0; k < n; k++) {
    const t = n === 1 ? 0.5 : k / (n - 1);
    blobs.push([
      7 + t * (SPRITE_W - 14) + (rnd(shape, k, 61) - 0.5) * 4,
      SPRITE_H * 0.55 + (rnd(shape, k, 62) - 0.5) * 6 - Math.sin(t * Math.PI) * 3,
      4.5 + rnd(shape, k, 63) * 3.5 + Math.sin(t * Math.PI) * 2.5,
    ]);
  }
  const pal = PALETTES[palette];
  let minY = SPRITE_H;
  let maxY = 0;
  const cover = new Float32Array(SPRITE_W * SPRITE_H);
  for (let y = 0; y < SPRITE_H; y++) {
    for (let x = 0; x < SPRITE_W; x++) {
      let d = 0;
      for (const [bx, by, br] of blobs) d = Math.max(d, 1 - Math.hypot(x - bx, (y - by) * 1.15) / br);
      cover[y * SPRITE_W + x] = d;
      if (d > 0.12) {
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  for (let y = 0; y < SPRITE_H; y++) {
    for (let x = 0; x < SPRITE_W; x++) {
      const d = cover[y * SPRITE_W + x];
      if (d <= 0.12) continue;
      const v = (y - minY) / Math.max(1, maxY - minY);
      const lit = Math.max(0, Math.min(1, v * 1.05 + (x / SPRITE_W - 0.5) * 0.25));
      const o = (y * SPRITE_W + x) * 4;
      for (let q = 0; q < 3; q++) img.data[o + q] = pal.top[q] + (pal.bottom[q] - pal.top[q]) * lit;
      img.data[o + 3] = d < 0.28 ? 120 : 235; // a translucent rim, a firm body
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** The silhouette of a cloud, for its shadow on the ground. */
function makeShadow(cloud: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = cloud.width;
  c.height = cloud.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(cloud, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = 'rgb(8,16,34)';
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}
