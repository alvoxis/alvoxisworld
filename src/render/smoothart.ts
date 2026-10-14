/**
 * More realistic smooth 2D creature sprites.
 * Uses gradients, organic proportions and clearer anatomical features.
 */
import { SPECIES } from '../sim/creatures';
import { getRaceVisual } from './creature/races';

export const SMOOTH_SIZE = 72;

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => f(v).toString(16).padStart(2, '0')).join('')}`;
}

function bodyGradient(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, r: number): CanvasGradient {
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r);
  g.addColorStop(0, shade(color, 0.35));
  g.addColorStop(0.6, color);
  g.addColorStop(1, shade(color, -0.4));
  return g;
}

/** Draw a realistic-looking creature sprite facing right. */
export function smoothCreature(species: number, frame = 0, variant = 0): HTMLCanvasElement {
  const sp = SPECIES[species] ?? SPECIES[0];
  const c = makeCanvas(SMOOTH_SIZE, SMOOTH_SIZE);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const race = getRaceVisual(sp.key);
  const color = race.palette[variant % race.palette.length] || sp.color || '#c9a078';
  const dark = shade(color, -0.5);
  const cx = 36;
  const cy = 42;
  const walk = frame ? 4 : -3;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2.5;

  // Chunky cartoon style like Butcher Hero: big heads, simple shapes, bold outlines
  switch (sp.key) {
    case 'human': {
      // Big head, chubby body
      ctx.fillStyle = bodyGradient(ctx, color, cx + 4, cy - 14, 8);
      ctx.beginPath(); ctx.ellipse(cx + 4, cy - 14, 7, 6.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = dark; ctx.stroke();
      ctx.fillStyle = bodyGradient(ctx, shade(color, -0.05), cx, cy + 2, 10);
      ctx.beginPath(); ctx.roundRect(cx - 7, cy - 6, 14, 16, 5); ctx.fill();
      ctx.stroke();
      // Arms
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.roundRect(cx - 11, cy - 2, 5, 9, 2.5); ctx.fill();
      ctx.beginPath(); ctx.roundRect(cx + 6, cy, 5, 8, 2.5); ctx.fill();
      // Legs
      ctx.beginPath(); ctx.roundRect(cx - 5, cy + 10, 4.5, 10 + walk, 2); ctx.fill();
      ctx.beginPath(); ctx.roundRect(cx + 0.5, cy + 10, 4.5, 10 - walk, 2); ctx.fill();
      break;
    }
    case 'elf': {
      // Big head, tall ears, slender body
      ctx.fillStyle = bodyGradient(ctx, color, cx + 5, cy - 16, 6);
      ctx.beginPath(); ctx.ellipse(cx + 5, cy - 16, 5.5, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = dark; ctx.stroke();
      // Long ears
      ctx.fillStyle = shade(color, 0.1);
      ctx.beginPath();
      ctx.moveTo(cx + 1, cy - 18); ctx.lineTo(cx - 2, cy - 32); ctx.lineTo(cx + 6, cy - 17); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + 9, cy - 18); ctx.lineTo(cx + 13, cy - 32); ctx.lineTo(cx + 10, cy - 16); ctx.fill();
      ctx.fillStyle = bodyGradient(ctx, shade(color, 0.05), cx, cy, 7);
      ctx.beginPath(); ctx.ellipse(cx, cy, 4.5, 12, 0, 0, Math.PI * 2); ctx.fill();
      ctx.stroke();
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.roundRect(cx - 2.5, cy + 11, 2.2, 14 + walk, 1); ctx.fill();
      ctx.beginPath(); ctx.roundRect(cx + 0.5, cy + 11, 2.2, 14 - walk, 1); ctx.fill();
      break;
    }
    case 'dwarf': {
      // Very chubby, huge beard
      ctx.fillStyle = bodyGradient(ctx, color, cx, cy + 2, 12);
      ctx.beginPath(); ctx.roundRect(cx - 10, cy - 6, 20, 16, 6); ctx.fill();
      ctx.strokeStyle = dark; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(cx + 6, cy - 8, 6, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.stroke();
      // Massive beard
      ctx.fillStyle = '#3a2010';
      ctx.beginPath();
      ctx.moveTo(cx + 1, cy - 2);
      ctx.quadraticCurveTo(cx + 18, cy + 8, cx + 5, cy + 22);
      ctx.quadraticCurveTo(cx + 16, cy + 20, cx + 16, cy + 6);
      ctx.quadraticCurveTo(cx + 10, cy, cx + 1, cy - 2);
      ctx.fill();
      ctx.strokeStyle = '#2a1508'; ctx.stroke();
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.roundRect(cx - 7, cy + 9, 5, 7 + walk, 2); ctx.fill();
      ctx.beginPath(); ctx.roundRect(cx + 1, cy + 9, 5, 7 - walk, 2); ctx.fill();
      break;
    }
    case 'orc': {
      // Big, muscular, tusks
      ctx.fillStyle = bodyGradient(ctx, color, cx, cy + 1, 14);
      ctx.beginPath(); ctx.ellipse(cx, cy + 1, 11, 10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = dark; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(cx + 10, cy - 10, 6.5, 5.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.stroke();
      // Big tusks
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.roundRect(cx + 14, cy - 4, 2.8, 7, 1.2); ctx.fill();
      ctx.beginPath(); ctx.roundRect(cx + 11, cy - 1, 2.2, 6, 1); ctx.fill();
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.roundRect(cx - 9, cy + 9, 6, 10 + walk, 2); ctx.fill();
      ctx.beginPath(); ctx.roundRect(cx + 2, cy + 9, 6, 10 - walk, 2); ctx.fill();
      break;
    }
    case 'gnome': {
      ctx.fillStyle = bodyGradient(ctx, color, cx, cy + 4, 7);
      ctx.beginPath(); ctx.ellipse(cx, cy + 4, 5.5, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = dark; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(cx + 3, cy - 2, 3.5, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.stroke();
      // Tall hat
      ctx.fillStyle = '#c44';
      ctx.beginPath();
      ctx.moveTo(cx - 1, cy - 4);
      ctx.lineTo(cx + 4, cy - 22);
      ctx.lineTo(cx + 9, cy - 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.roundRect(cx - 2, cy + 9, 2.2, 5 + walk, 1); ctx.fill();
      ctx.beginPath(); ctx.roundRect(cx + 0.5, cy + 9, 2.2, 5 - walk, 1); ctx.fill();
      break;
    }
    case 'demigod': {
      ctx.fillStyle = bodyGradient(ctx, shade(color, 0.2), cx, cy, 9);
      ctx.beginPath(); ctx.ellipse(cx, cy, 5.5, 13, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = dark; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(cx + 6, cy - 18, 5, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.stroke();
      // Halo
      ctx.strokeStyle = 'rgba(255,220,100,0.95)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx + 6, cy - 28, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ffe88a';
      ctx.beginPath(); ctx.arc(cx + 6, cy - 28, 2.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.roundRect(cx - 3, cy + 12, 2.8, 12, 1); ctx.fill();
      ctx.beginPath(); ctx.roundRect(cx + 1, cy + 12, 2.8, 12, 1); ctx.fill();
      break;
    }
    default: {
      // Animals: chunky cartoon
      ctx.fillStyle = bodyGradient(ctx, color, cx, cy, 11);
      ctx.beginPath(); ctx.ellipse(cx, cy, 11, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = dark; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(cx + 10, cy - 2, 5.5, 4.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.stroke();
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.roundRect(cx - 6, cy + 5, 3, 6 + walk, 1.5); ctx.fill();
      ctx.beginPath(); ctx.roundRect(cx + 2, cy + 5, 3, 6 - walk, 1.5); ctx.fill();
    }
  }

  // Simple eye
  if (!['fish', 'shark', 'whale', 'orca'].includes(sp.key)) {
    const eyeX = ['elf', 'demigod'].includes(sp.key) ? cx + 7 : cx + 10;
    const eyeY = ['elf', 'demigod'].includes(sp.key) ? cy - 16 : cy - 4;
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(eyeX, eyeY, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(eyeX + 0.4, eyeY - 0.4, 0.6, 0, Math.PI * 2); ctx.fill();
  }

  return c;
}

/** Smooth terrain tile. */
export function smoothTile(id: number, variant = 0): HTMLCanvasElement {
  const size = 32;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  const colors: Record<number, string> = {
    0: '#1a3a6a', 1: '#2a7aaa', 2: '#e8d4a0', 3: '#6a9a4a',
    4: '#3a6a2a', 5: '#2a5a1a', 6: '#d4b070', 7: '#c4a050',
    8: '#4a6a4a', 9: '#a0b0c0', 10: '#f0f4f8', 11: '#7a6a5a',
    12: '#5a4a3a', 13: '#8a7a6a', 14: '#4a8aaa', 15: '#3a7a9a',
  };
  const base = colors[id] || '#888';
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, base);
  g.addColorStop(1, shade(base, -0.15));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = variant % 2 ? '#fff' : '#000';
  ctx.beginPath();
  ctx.arc(size * 0.35 + (variant % 4), size * 0.45, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  return c;
}
