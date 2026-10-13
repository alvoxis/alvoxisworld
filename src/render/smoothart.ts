/**
 * More realistic smooth 2D creature sprites.
 * Uses gradients, organic proportions and clearer anatomical features.
 */
import { SPECIES } from '../sim/creatures';

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
export function smoothCreature(species: number, frame = 0): HTMLCanvasElement {
  const sp = SPECIES[species] ?? SPECIES[0];
  const c = makeCanvas(SMOOTH_SIZE, SMOOTH_SIZE);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const color = sp.color || '#c9a078';
  const dark = shade(color, -0.45);
  const cx = 36;
  const cy = 40;
  const walk = frame ? 3 : -2.5;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (sp.key) {
    case 'human': {
      // Balanced, like WorldBox human
      ctx.fillStyle = bodyGradient(ctx, color, cx + 4, cy - 16, 6);
      ctx.beginPath(); ctx.ellipse(cx + 5, cy - 16, 4.8, 5.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = bodyGradient(ctx, shade(color, 0.05), cx, cy, 9);
      ctx.beginPath(); ctx.ellipse(cx, cy - 1, 5.5, 10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = dark;
      ctx.fillRect(cx - 6, cy - 4, 2.8, 11);
      ctx.fillRect(cx + 4, cy - 2, 2.8, 9);
      ctx.fillRect(cx - 3.5, cy + 8, 3, 12 + walk);
      ctx.fillRect(cx + 1, cy + 8, 3, 12 - walk);
      break;
    }
    case 'elf': {
      // Tall, slender, long pointed ears (WorldBox style)
      ctx.fillStyle = bodyGradient(ctx, color, cx + 6, cy - 20, 5.5);
      ctx.beginPath(); ctx.ellipse(cx + 6, cy - 20, 3.8, 4.8, 0, 0, Math.PI * 2); ctx.fill();
      // Long ears
      ctx.beginPath();
      ctx.moveTo(cx + 3.5, cy - 22); ctx.lineTo(cx + 1, cy - 32); ctx.lineTo(cx + 7, cy - 23); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + 8.5, cy - 22); ctx.lineTo(cx + 12, cy - 32); ctx.lineTo(cx + 9, cy - 21); ctx.fill();
      ctx.fillStyle = bodyGradient(ctx, shade(color, 0.1), cx, cy - 2, 8);
      ctx.beginPath(); ctx.ellipse(cx, cy - 2, 4, 12, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = dark;
      ctx.fillRect(cx - 2.5, cy + 9, 2.2, 15 + walk);
      ctx.fillRect(cx + 1, cy + 9, 2.2, 15 - walk);
      break;
    }
    case 'dwarf': {
      // Short, stocky, big beard (WorldBox dwarf)
      ctx.fillStyle = bodyGradient(ctx, color, cx, cy + 2, 11);
      ctx.beginPath(); ctx.ellipse(cx, cy + 2, 8.5, 7.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 7, cy - 6, 5, 4.2, 0, 0, Math.PI * 2); ctx.fill();
      // Big beard
      ctx.fillStyle = '#4a3020';
      ctx.beginPath();
      ctx.moveTo(cx + 1, cy - 2);
      ctx.quadraticCurveTo(cx + 15, cy + 4, cx + 5, cy + 18);
      ctx.quadraticCurveTo(cx + 12, cy + 16, cx + 14, cy + 8);
      ctx.quadraticCurveTo(cx + 10, cy - 1, cx + 1, cy - 2);
      ctx.fill();
      ctx.fillStyle = dark;
      ctx.fillRect(cx - 7, cy + 8, 4.5, 8 + walk);
      ctx.fillRect(cx + 1.5, cy + 8, 4.5, 8 - walk);
      break;
    }
    case 'orc': {
      // Muscular green, tusks (WorldBox orc)
      ctx.fillStyle = bodyGradient(ctx, color, cx, cy, 12);
      ctx.beginPath(); ctx.ellipse(cx, cy, 9.5, 8.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 10, cy - 8, 6, 5, 0, 0, Math.PI * 2); ctx.fill();
      // Tusks
      ctx.fillStyle = '#f8f8f8';
      ctx.fillRect(cx + 14, cy - 4, 2, 5);
      ctx.fillRect(cx + 11, cy - 2, 1.8, 4);
      // Ears
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(cx + 6, cy - 12); ctx.lineTo(cx + 3, cy - 19); ctx.lineTo(cx + 9, cy - 11); ctx.fill();
      ctx.fillStyle = dark;
      ctx.fillRect(cx - 9, cy + 7, 5, 10 + walk);
      ctx.fillRect(cx + 2, cy + 7, 5, 10 - walk);
      break;
    }
    case 'gnome': {
      ctx.fillStyle = bodyGradient(ctx, color, cx, cy + 4, 6.5);
      ctx.beginPath(); ctx.ellipse(cx, cy + 4, 4.5, 5.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 4, cy - 2, 2.8, 2.8, 0, 0, Math.PI * 2); ctx.fill();
      // Tall hat
      ctx.fillStyle = '#c44';
      ctx.beginPath();
      ctx.moveTo(cx + 0.5, cy - 4);
      ctx.lineTo(cx + 5, cy - 20);
      ctx.lineTo(cx + 9.5, cy - 4);
      ctx.fill();
      ctx.fillStyle = dark;
      ctx.fillRect(cx - 2.5, cy + 8, 2, 5 + walk);
      ctx.fillRect(cx + 1, cy + 8, 2, 5 - walk);
      break;
    }
    case 'demigod': {
      ctx.fillStyle = bodyGradient(ctx, shade(color, 0.2), cx, cy, 10);
      ctx.beginPath(); ctx.ellipse(cx, cy, 5, 13, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 7, cy - 18, 4.5, 4.5, 0, 0, Math.PI * 2); ctx.fill();
      // Halo
      ctx.strokeStyle = 'rgba(255,220,100,0.9)';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(cx + 7, cy - 26, 5.5, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ffe88a';
      ctx.beginPath(); ctx.arc(cx + 7, cy - 26, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = dark;
      ctx.fillRect(cx - 3.5, cy + 12, 2.5, 13);
      ctx.fillRect(cx + 1.5, cy + 12, 2.5, 13);
      break;
    }
    case 'merfolk': {
      ctx.fillStyle = bodyGradient(ctx, color, cx, cy - 8, 7);
      ctx.beginPath(); ctx.ellipse(cx, cy - 8, 5, 6.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 6, cy - 14, 4, 4, 0, 0, Math.PI * 2); ctx.fill();
      // Tail
      ctx.fillStyle = bodyGradient(ctx, shade(color, 0.15), cx, cy + 10, 12);
      ctx.beginPath();
      ctx.moveTo(cx - 2, cy - 2);
      ctx.quadraticCurveTo(cx + 12, cy + 10, cx + 1, cy + 22);
      ctx.quadraticCurveTo(cx - 8, cy + 12, cx - 2, cy - 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx, cy + 20); ctx.lineTo(cx - 6, cy + 28); ctx.lineTo(cx + 8, cy + 28); ctx.fill();
      break;
    }
    default: {
      // Animals keep previous style but with gradients
      ctx.fillStyle = bodyGradient(ctx, color, cx, cy, 10);
      ctx.beginPath(); ctx.ellipse(cx, cy, 10, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 10, cy - 2, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = dark;
      ctx.fillRect(cx - 5, cy + 4, 2.5, 6 + walk);
      ctx.fillRect(cx + 2, cy + 4, 2.5, 6 - walk);
    }
  }

  // Eye
  if (!['fish', 'shark', 'whale', 'orca'].includes(sp.key)) {
    const eyeX = ['elf', 'demigod'].includes(sp.key) ? cx + 8 : cx + 12;
    const eyeY = ['elf', 'demigod'].includes(sp.key) ? cy - 20 : cy - 4;
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(eyeX, eyeY, 1.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(eyeX + 0.3, eyeY - 0.3, 0.5, 0, Math.PI * 2); ctx.fill();
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
