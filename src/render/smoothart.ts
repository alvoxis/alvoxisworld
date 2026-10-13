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
  const dark = shade(color, -0.4);
  const cx = 36;
  const cy = 38;
  const walk = frame ? 2.5 : -2;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (sp.key) {
    case 'human': {
      // Natural proportions
      ctx.fillStyle = bodyGradient(ctx, color, cx + 6, cy - 14, 7);
      ctx.beginPath(); ctx.ellipse(cx + 7, cy - 16, 5.2, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = bodyGradient(ctx, shade(color, 0.05), cx, cy - 2, 10);
      ctx.beginPath(); ctx.ellipse(cx, cy - 2, 6, 11, 0, 0, Math.PI * 2); ctx.fill();
      // Arms
      ctx.fillStyle = dark;
      ctx.fillRect(cx - 7, cy - 6, 3, 12);
      ctx.fillRect(cx + 5, cy - 4, 3, 10);
      // Legs
      ctx.fillRect(cx - 4, cy + 8, 3.2, 13 + walk);
      ctx.fillRect(cx + 1, cy + 8, 3.2, 13 - walk);
      break;
    }
    case 'elf': {
      // Slender, elegant, long thin ears
      ctx.fillStyle = bodyGradient(ctx, color, cx + 8, cy - 18, 6);
      ctx.beginPath(); ctx.ellipse(cx + 8, cy - 20, 4.2, 5.2, 0, 0, Math.PI * 2); ctx.fill();
      // Long pointed ears
      ctx.beginPath();
      ctx.moveTo(cx + 5, cy - 22); ctx.lineTo(cx + 2, cy - 32); ctx.lineTo(cx + 9, cy - 24); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + 11, cy - 22); ctx.lineTo(cx + 15, cy - 32); ctx.lineTo(cx + 12, cy - 21); ctx.fill();
      ctx.fillStyle = bodyGradient(ctx, shade(color, 0.1), cx, cy - 4, 9);
      ctx.beginPath(); ctx.ellipse(cx, cy - 4, 4.5, 13, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = dark;
      ctx.fillRect(cx - 3, cy + 8, 2.4, 16 + walk);
      ctx.fillRect(cx + 1, cy + 8, 2.4, 16 - walk);
      break;
    }
    case 'dwarf': {
      // Stocky, broad, full beard
      ctx.fillStyle = bodyGradient(ctx, color, cx, cy, 12);
      ctx.beginPath(); ctx.ellipse(cx, cy, 9, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 8, cy - 8, 5.5, 4.8, 0, 0, Math.PI * 2); ctx.fill();
      // Thick beard
      ctx.fillStyle = '#5a3a22';
      ctx.beginPath();
      ctx.moveTo(cx + 2, cy - 4);
      ctx.quadraticCurveTo(cx + 16, cy + 2, cx + 6, cy + 16);
      ctx.quadraticCurveTo(cx + 10, cy + 18, cx + 14, cy + 10);
      ctx.quadraticCurveTo(cx + 12, cy - 2, cx + 2, cy - 4);
      ctx.fill();
      ctx.fillStyle = dark;
      ctx.fillRect(cx - 8, cy + 6, 5, 9 + walk);
      ctx.fillRect(cx + 1, cy + 6, 5, 9 - walk);
      break;
    }
    case 'gnome': {
      // Small, rounded, tall hat
      ctx.fillStyle = bodyGradient(ctx, color, cx, cy + 2, 7);
      ctx.beginPath(); ctx.ellipse(cx, cy + 2, 5, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 5, cy - 4, 3.2, 3.2, 0, 0, Math.PI * 2); ctx.fill();
      // Tall pointed hat
      ctx.fillStyle = '#b33';
      ctx.beginPath();
      ctx.moveTo(cx + 1, cy - 6);
      ctx.lineTo(cx + 5.5, cy - 22);
      ctx.lineTo(cx + 10, cy - 6);
      ctx.fill();
      ctx.fillStyle = dark;
      ctx.fillRect(cx - 3, cy + 7, 2.2, 5 + walk);
      ctx.fillRect(cx + 1, cy + 7, 2.2, 5 - walk);
      break;
    }
    case 'demigod': {
      // Tall, luminous
      ctx.fillStyle = bodyGradient(ctx, shade(color, 0.2), cx, cy - 2, 11);
      ctx.beginPath(); ctx.ellipse(cx, cy - 2, 5.5, 14, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 8, cy - 20, 4.8, 5, 0, 0, Math.PI * 2); ctx.fill();
      // Soft glow halo
      ctx.strokeStyle = 'rgba(255,220,80,0.8)';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(cx + 8, cy - 28, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ffe88a';
      ctx.beginPath(); ctx.arc(cx + 8, cy - 28, 2.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = dark;
      ctx.fillRect(cx - 4, cy + 10, 2.8, 14);
      ctx.fillRect(cx + 1.5, cy + 10, 2.8, 14);
      break;
    }
    case 'orc': {
      // Muscular, heavy brow, large tusks
      ctx.fillStyle = bodyGradient(ctx, color, cx, cy, 13);
      ctx.beginPath(); ctx.ellipse(cx, cy, 10, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 11, cy - 10, 6.5, 5.5, 0, 0, Math.PI * 2); ctx.fill();
      // Tusks
      ctx.fillStyle = '#f5f5f5';
      ctx.fillRect(cx + 15, cy - 6, 2.2, 5.5);
      ctx.fillRect(cx + 12, cy - 4, 2, 4);
      // Pointed ears
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(cx + 7, cy - 14); ctx.lineTo(cx + 4, cy - 21); ctx.lineTo(cx + 10, cy - 13); ctx.fill();
      ctx.fillStyle = dark;
      ctx.fillRect(cx - 10, cy + 7, 5.5, 10 + walk);
      ctx.fillRect(cx + 2, cy + 7, 5.5, 10 - walk);
      break;
    }
    case 'merfolk': {
      // Smooth upper body + flowing tail
      ctx.fillStyle = bodyGradient(ctx, color, cx, cy - 10, 8);
      ctx.beginPath(); ctx.ellipse(cx, cy - 10, 5.5, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 7, cy - 16, 4.5, 4.5, 0, 0, Math.PI * 2); ctx.fill();
      // Tail
      const tg = bodyGradient(ctx, shade(color, 0.15), cx, cy + 8, 14);
      ctx.fillStyle = tg;
      ctx.beginPath();
      ctx.moveTo(cx - 3, cy - 4);
      ctx.quadraticCurveTo(cx + 14, cy + 8, cx + 1, cy + 22);
      ctx.quadraticCurveTo(cx - 10, cy + 10, cx - 3, cy - 4);
      ctx.fill();
      // Fin
      ctx.beginPath();
      ctx.moveTo(cx, cy + 20);
      ctx.lineTo(cx - 7, cy + 28);
      ctx.lineTo(cx + 9, cy + 28);
      ctx.fill();
      break;
    }
    case 'rabbit': {
      ctx.fillStyle = bodyGradient(ctx, color, cx, cy + 2, 9);
      ctx.beginPath(); ctx.ellipse(cx, cy + 2, 8, 6.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 8, cy - 3, 4, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      // Long ears with inner color
      ctx.fillStyle = color;
      ctx.fillRect(cx + 5, cy - 16, 2.8, 13);
      ctx.fillRect(cx + 9, cy - 14, 2.8, 11);
      ctx.fillStyle = shade(color, 0.45);
      ctx.fillRect(cx + 5.8, cy - 14, 1.4, 9);
      ctx.fillStyle = dark;
      ctx.fillRect(cx - 5, cy + 7, 2.8, 6 + walk);
      ctx.fillRect(cx + 2, cy + 7, 2.8, 6 - walk);
      break;
    }
    case 'deer': {
      ctx.fillStyle = bodyGradient(ctx, color, cx, cy, 12);
      ctx.beginPath(); ctx.ellipse(cx - 1, cy, 12, 6.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 14, cy - 4, 5.5, 4.2, 0, 0, Math.PI * 2); ctx.fill();
      // Antlers
      ctx.strokeStyle = '#4a3020';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(cx + 12, cy - 7);
      ctx.lineTo(cx + 10, cy - 15);
      ctx.lineTo(cx + 14, cy - 17);
      ctx.moveTo(cx + 11, cy - 13);
      ctx.lineTo(cx + 7, cy - 11);
      ctx.stroke();
      ctx.fillStyle = dark;
      ctx.fillRect(cx - 9, cy + 5, 2.8, 8 + walk);
      ctx.fillRect(cx + 4, cy + 5, 2.8, 8 - walk);
      break;
    }
    case 'wolf':
    case 'raptor': {
      ctx.fillStyle = bodyGradient(ctx, color, cx, cy, 11);
      ctx.beginPath(); ctx.ellipse(cx - 1, cy, 10, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 12, cy - 2, 5.5, 3.8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx + 16, cy - 1, 6, 2.2);
      // Ears
      ctx.beginPath(); ctx.moveTo(cx + 10, cy - 5); ctx.lineTo(cx + 8, cy - 11); ctx.lineTo(cx + 13, cy - 5); ctx.fill();
      ctx.fillStyle = dark;
      ctx.fillRect(cx - 7, cy + 4, 2.8, 7 + walk);
      ctx.fillRect(cx + 2, cy + 4, 2.8, 7 - walk);
      break;
    }
    case 'bear': {
      ctx.fillStyle = bodyGradient(ctx, color, cx, cy, 14);
      ctx.beginPath(); ctx.ellipse(cx, cy, 14, 10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 12, cy - 3, 7, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 9, cy - 9, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 16, cy - 7, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = dark;
      ctx.fillRect(cx - 9, cy + 7, 4.5, 6);
      ctx.fillRect(cx + 4, cy + 7, 4.5, 6);
      break;
    }
    case 'fish': {
      ctx.fillStyle = bodyGradient(ctx, color, cx, cy, 12);
      ctx.beginPath(); ctx.ellipse(cx, cy, 14, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - 13, cy); ctx.lineTo(cx - 20, cy - 5); ctx.lineTo(cx - 20, cy + 5); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx - 1, cy - 4); ctx.lineTo(cx + 2, cy - 11); ctx.lineTo(cx + 5, cy - 4); ctx.fill();
      break;
    }
    case 'shark': {
      ctx.fillStyle = bodyGradient(ctx, color, cx, cy, 13);
      ctx.beginPath(); ctx.ellipse(cx, cy, 16, 4.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx, cy - 3); ctx.lineTo(cx + 1, cy - 13); ctx.lineTo(cx + 7, cy - 3); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - 14, cy); ctx.lineTo(cx - 21, cy - 3); ctx.lineTo(cx - 21, cy + 3); ctx.fill();
      break;
    }
    case 'whale': {
      ctx.fillStyle = bodyGradient(ctx, color, cx, cy, 16);
      ctx.beginPath(); ctx.ellipse(cx, cy, 19, 7.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - 17, cy); ctx.lineTo(cx - 25, cy - 3); ctx.lineTo(cx - 25, cy + 3); ctx.fill();
      break;
    }
    case 'orca': {
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath(); ctx.ellipse(cx, cy, 19, 6.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f5f5f5';
      ctx.beginPath(); ctx.ellipse(cx + 5, cy - 1, 6.5, 3.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - 17, cy); ctx.lineTo(cx - 25, cy - 2.5); ctx.lineTo(cx - 25, cy + 2.5); ctx.fill();
      break;
    }
    case 'tyrant': {
      ctx.fillStyle = bodyGradient(ctx, color, cx, cy, 12);
      ctx.beginPath(); ctx.ellipse(cx, cy, 11, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 15, cy - 6, 6, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx + 5, cy - 1, 3, 1.5);
      ctx.fillStyle = dark;
      ctx.fillRect(cx - 7, cy + 6, 3.5, 12);
      ctx.fillRect(cx + 2, cy + 6, 3.5, 12);
      break;
    }
    case 'hadrosaur': {
      ctx.fillStyle = bodyGradient(ctx, color, cx, cy, 13);
      ctx.beginPath(); ctx.ellipse(cx - 1, cy, 15, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 16, cy - 3, 5.5, 3.8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx + 20, cy - 1, 5, 1.8);
      ctx.fillStyle = dark;
      ctx.fillRect(cx - 9, cy + 5, 3.5, 10);
      ctx.fillRect(cx + 4, cy + 5, 3.5, 10);
      break;
    }
    default: {
      ctx.fillStyle = bodyGradient(ctx, color, cx, cy, 11);
      ctx.beginPath(); ctx.ellipse(cx, cy, 11, 6.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 10, cy - 2, 5, 4.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = dark;
      ctx.fillRect(cx - 6, cy + 4, 2.8, 6 + walk);
      ctx.fillRect(cx + 2, cy + 4, 2.8, 6 - walk);
    }
  }

  // Eye
  if (!['fish', 'shark', 'whale', 'orca'].includes(sp.key)) {
    const eyeX = ['elf', 'demigod'].includes(sp.key) ? cx + 10 : cx + 13;
    const eyeY = ['elf', 'demigod'].includes(sp.key) ? cy - 20 : cy - 5;
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.arc(eyeX, eyeY, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(eyeX + 0.4, eyeY - 0.3, 0.55, 0, Math.PI * 2); ctx.fill();
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
