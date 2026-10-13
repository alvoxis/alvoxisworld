/**
 * Smooth 2D creature and terrain art (non-pixel).
 * Drawn with canvas paths, gradients and antialiasing instead of 8×8 pixel maps.
 */
import { SPECIES } from '../sim/creatures';

export const SMOOTH_SIZE = 64; // base canvas size for creature sprites

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Draw a smooth creature sprite facing right. */
export function smoothCreature(species: number, frame = 0): HTMLCanvasElement {
  const sp = SPECIES[species] ?? SPECIES[0];
  const c = makeCanvas(SMOOTH_SIZE, SMOOTH_SIZE);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const color = sp.color || '#e0a878';
  const cx = SMOOTH_SIZE / 2;
  const cy = SMOOTH_SIZE / 2 + 4;

  // Body
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(cx - 4, cy, 18, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head
  ctx.beginPath();
  ctx.ellipse(cx + 14, cy - 6, 10, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  // Eye
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(cx + 18, cy - 8, 2.2, 0, Math.PI * 2);
  ctx.fill();

  // Simple legs / base (frame-dependent wiggle)
  const legOffset = frame ? 3 : -2;
  ctx.fillStyle = shade(color, -0.25);
  ctx.fillRect(cx - 12, cy + 8, 6, 10 + legOffset);
  ctx.fillRect(cx + 2, cy + 8, 6, 10 - legOffset);

  // Special touches per race
  if (sp.key === 'elf') {
    ctx.strokeStyle = '#2f7d45';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx + 10, cy - 14);
    ctx.lineTo(cx + 22, cy - 22);
    ctx.stroke();
  } else if (sp.key === 'dwarf') {
    ctx.fillStyle = '#5a4030';
    ctx.fillRect(cx + 8, cy - 16, 14, 4); // beard hint
  } else if (sp.key === 'demigod') {
    ctx.fillStyle = '#ffd700';
    ctx.beginPath();
    ctx.arc(cx + 14, cy - 18, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  return c;
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => f(v).toString(16).padStart(2, '0')).join('')}`;
}

/** Smooth terrain tile (higher res, gradient + soft noise). */
export function smoothTile(id: number, variant = 0): HTMLCanvasElement {
  const size = 32;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;

  const colors: Record<number, string> = {
    0: '#1a3a6a', // deep water
    1: '#2a7aaa', // shallow
    2: '#e8d4a0', // sand
    3: '#6a9a4a', // grass
    4: '#3a6a2a', // forest
    5: '#2a5a1a', // jungle
    6: '#d4b070', // desert
    7: '#c4a050', // savanna
    8: '#4a6a4a', // swamp
    9: '#a0b0c0', // tundra
    10: '#f0f4f8', // snow
    11: '#7a6a5a', // hills
    12: '#5a4a3a', // mountain
    13: '#8a7a6a', // soil
    14: '#4a8aaa', // river
    15: '#3a7a9a', // lake
  };
  const base = colors[id] || '#888';
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, base);
  g.addColorStop(1, shade(base, -0.15));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // Soft variation
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = variant % 2 ? '#fff' : '#000';
  ctx.beginPath();
  ctx.arc(size * 0.3 + (variant % 5), size * 0.4, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  return c;
}
