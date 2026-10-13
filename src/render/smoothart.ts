/**
 * Smooth 2D creature art — each species has a distinct silhouette.
 */
import { SPECIES } from '../sim/creatures';

export const SMOOTH_SIZE = 64;

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

/** Draw a smooth creature sprite facing right. Distinct shape per species. */
export function smoothCreature(species: number, frame = 0): HTMLCanvasElement {
  const sp = SPECIES[species] ?? SPECIES[0];
  const c = makeCanvas(SMOOTH_SIZE, SMOOTH_SIZE);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const color = sp.color || '#e0a878';
  const dark = shade(color, -0.3);
  const cx = 32;
  const cy = 36;
  const walk = frame ? 2 : -2;

  ctx.fillStyle = color;
  ctx.strokeStyle = dark;
  ctx.lineWidth = 1.5;

  switch (sp.key) {
    case 'human':
      // Upright biped
      ctx.fillRect(cx - 4, cy - 10, 8, 16);
      ctx.beginPath(); ctx.ellipse(cx + 6, cy - 14, 6, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx - 6, cy + 6, 4, 12 + walk);
      ctx.fillRect(cx + 2, cy + 6, 4, 12 - walk);
      break;

    case 'elf':
      // Taller, pointed ears
      ctx.fillRect(cx - 3, cy - 14, 7, 20);
      ctx.beginPath(); ctx.ellipse(cx + 8, cy - 18, 5, 5.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + 4, cy - 22); ctx.lineTo(cx + 10, cy - 28); ctx.lineTo(cx + 12, cy - 20);
      ctx.fill();
      ctx.fillRect(cx - 5, cy + 6, 3, 14 + walk);
      ctx.fillRect(cx + 3, cy + 6, 3, 14 - walk);
      break;

    case 'dwarf':
      // Short, stocky, beard
      ctx.fillRect(cx - 6, cy - 4, 12, 12);
      ctx.beginPath(); ctx.ellipse(cx + 6, cy - 8, 6, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = dark;
      ctx.fillRect(cx + 2, cy - 4, 10, 6); // beard
      ctx.fillStyle = color;
      ctx.fillRect(cx - 8, cy + 8, 5, 8 + walk);
      ctx.fillRect(cx + 2, cy + 8, 5, 8 - walk);
      break;

    case 'gnome':
      // Small with hat
      ctx.fillRect(cx - 3, cy - 2, 6, 10);
      ctx.beginPath(); ctx.ellipse(cx + 4, cy - 6, 4, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c44';
      ctx.beginPath(); ctx.moveTo(cx + 1, cy - 9); ctx.lineTo(cx + 8, cy - 16); ctx.lineTo(cx + 9, cy - 8); ctx.fill();
      ctx.fillStyle = color;
      ctx.fillRect(cx - 4, cy + 8, 3, 6 + walk);
      ctx.fillRect(cx + 2, cy + 8, 3, 6 - walk);
      break;

    case 'demigod':
      // Tall glowing figure
      ctx.fillStyle = shade(color, 0.2);
      ctx.fillRect(cx - 3, cy - 16, 7, 22);
      ctx.beginPath(); ctx.ellipse(cx + 8, cy - 20, 5, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd700';
      ctx.beginPath(); ctx.arc(cx + 8, cy - 26, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = color;
      ctx.fillRect(cx - 5, cy + 6, 3, 14);
      ctx.fillRect(cx + 2, cy + 6, 3, 14);
      break;

    case 'orc':
      // Bulky with tusks
      ctx.fillRect(cx - 7, cy - 8, 14, 16);
      ctx.beginPath(); ctx.ellipse(cx + 8, cy - 12, 7, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(cx + 12, cy - 8, 2, 4); // tusk
      ctx.fillStyle = color;
      ctx.fillRect(cx - 8, cy + 8, 5, 10 + walk);
      ctx.fillRect(cx + 2, cy + 8, 5, 10 - walk);
      break;

    case 'merfolk':
      // Upper body + fish tail
      ctx.fillRect(cx - 4, cy - 12, 8, 12);
      ctx.beginPath(); ctx.ellipse(cx + 6, cy - 16, 5, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - 2, cy); ctx.quadraticCurveTo(cx + 10, cy + 8, cx + 4, cy + 18);
      ctx.quadraticCurveTo(cx - 6, cy + 8, cx - 2, cy);
      ctx.fill();
      break;

    case 'rabbit':
      // Long ears
      ctx.beginPath(); ctx.ellipse(cx, cy, 10, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 8, cy - 6, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx + 6, cy - 16, 3, 10);
      ctx.fillRect(cx + 10, cy - 14, 3, 8);
      ctx.fillRect(cx - 6, cy + 6, 3, 6 + walk);
      ctx.fillRect(cx + 2, cy + 6, 3, 6 - walk);
      break;

    case 'deer':
      // Quadruped with antlers
      ctx.beginPath(); ctx.ellipse(cx - 2, cy, 14, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 14, cy - 4, 6, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#5a4030';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx + 12, cy - 8); ctx.lineTo(cx + 10, cy - 16); ctx.lineTo(cx + 14, cy - 14); ctx.stroke();
      ctx.fillRect(cx - 10, cy + 6, 3, 8 + walk);
      ctx.fillRect(cx + 4, cy + 6, 3, 8 - walk);
      break;

    case 'wolf':
    case 'raptor':
      // Snouted quadruped
      ctx.beginPath(); ctx.ellipse(cx - 2, cy, 12, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 12, cy - 2, 7, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx + 16, cy - 1, 6, 2); // snout
      ctx.fillRect(cx - 8, cy + 5, 3, 7 + walk);
      ctx.fillRect(cx + 2, cy + 5, 3, 7 - walk);
      break;

    case 'bear':
      // Large bulky
      ctx.beginPath(); ctx.ellipse(cx, cy, 16, 12, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 12, cy - 4, 8, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx - 10, cy + 8, 5, 6);
      ctx.fillRect(cx + 4, cy + 8, 5, 6);
      break;

    case 'fish':
      // Simple fish
      ctx.beginPath(); ctx.ellipse(cx, cy, 16, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx - 14, cy); ctx.lineTo(cx - 22, cy - 6); ctx.lineTo(cx - 22, cy + 6); ctx.fill();
      break;

    case 'shark':
      // Triangular fin
      ctx.beginPath(); ctx.ellipse(cx, cy, 18, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx, cy - 4); ctx.lineTo(cx + 4, cy - 14); ctx.lineTo(cx + 8, cy - 4); ctx.fill();
      break;

    case 'whale':
    case 'orca':
      // Large body
      ctx.beginPath(); ctx.ellipse(cx, cy, 20, 8, 0, 0, Math.PI * 2); ctx.fill();
      if (sp.key === 'orca') {
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.ellipse(cx + 4, cy - 2, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
      }
      break;

    case 'tyrant':
    case 'hadrosaur':
      // Large dino
      ctx.beginPath(); ctx.ellipse(cx - 4, cy, 18, 10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 14, cy - 6, 8, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx - 12, cy + 6, 4, 10);
      ctx.fillRect(cx + 6, cy + 6, 4, 10);
      break;

    default:
      // Generic quadruped
      ctx.beginPath(); ctx.ellipse(cx, cy, 12, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 10, cy - 3, 6, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx - 6, cy + 5, 3, 6 + walk);
      ctx.fillRect(cx + 2, cy + 5, 3, 6 - walk);
  }

  // Eye for most
  if (!['fish', 'shark', 'whale'].includes(sp.key)) {
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(cx + 14, cy - 6, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  return c;
}

/** Smooth terrain tile (higher res, gradient + soft noise). */
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

  ctx.globalAlpha = 0.12;
  ctx.fillStyle = variant % 2 ? '#fff' : '#000';
  ctx.beginPath();
  ctx.arc(size * 0.3 + (variant % 5), size * 0.4, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  return c;
}
