/**
 * Smooth 2D creature art — detailed, distinctive silhouettes based on classic fantasy and animal designs.
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

/** Draw a smooth creature sprite facing right. */
export function smoothCreature(species: number, frame = 0): HTMLCanvasElement {
  const sp = SPECIES[species] ?? SPECIES[0];
  const c = makeCanvas(SMOOTH_SIZE, SMOOTH_SIZE);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const color = sp.color || '#e0a878';
  const dark = shade(color, -0.35);
  const light = shade(color, 0.25);
  const cx = 32;
  const cy = 34;
  const walk = frame ? 3 : -2;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (sp.key) {
    case 'human':
      // Balanced biped with clothing hint
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.ellipse(cx + 8, cy - 16, 5.5, 6, 0, 0, Math.PI * 2); ctx.fill(); // head
      ctx.fillStyle = light;
      ctx.fillRect(cx - 3, cy - 10, 7, 14); // torso
      ctx.fillStyle = dark;
      ctx.fillRect(cx - 4, cy + 4, 3.5, 14 + walk); // legs
      ctx.fillRect(cx + 1, cy + 4, 3.5, 14 - walk);
      ctx.fillStyle = '#4a3a2a';
      ctx.fillRect(cx - 5, cy - 4, 10, 4); // belt / tunic
      break;

    case 'elf':
      // Tall, slender, long pointed ears, elegant
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.ellipse(cx + 9, cy - 20, 4.5, 5.5, 0, 0, Math.PI * 2); ctx.fill();
      // Pointed ears
      ctx.beginPath();
      ctx.moveTo(cx + 6, cy - 22); ctx.lineTo(cx + 4, cy - 30); ctx.lineTo(cx + 10, cy - 24); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + 12, cy - 22); ctx.lineTo(cx + 16, cy - 30); ctx.lineTo(cx + 13, cy - 20); ctx.fill();
      ctx.fillStyle = light;
      ctx.fillRect(cx - 2, cy - 14, 6, 18); // slender body
      ctx.fillStyle = dark;
      ctx.fillRect(cx - 3, cy + 4, 2.5, 16 + walk);
      ctx.fillRect(cx + 1.5, cy + 4, 2.5, 16 - walk);
      // Hair suggestion
      ctx.fillStyle = shade(color, -0.1);
      ctx.beginPath(); ctx.ellipse(cx + 8, cy - 22, 6, 3, 0, 0, Math.PI); ctx.fill();
      break;

    case 'dwarf':
      // Short, stocky, prominent long beard, broad
      ctx.fillStyle = color;
      ctx.fillRect(cx - 7, cy - 6, 14, 12); // wide torso
      ctx.beginPath(); ctx.ellipse(cx + 8, cy - 10, 6, 5, 0, 0, Math.PI * 2); ctx.fill();
      // Long braided beard
      ctx.fillStyle = '#6b4a2a';
      ctx.fillRect(cx + 2, cy - 6, 12, 14);
      ctx.fillRect(cx + 4, cy + 6, 3, 6);
      ctx.fillRect(cx + 9, cy + 6, 3, 6);
      ctx.fillStyle = color;
      ctx.fillRect(cx - 9, cy + 6, 5, 9 + walk);
      ctx.fillRect(cx + 1, cy + 6, 5, 9 - walk);
      // Helmet hint
      ctx.fillStyle = '#7a7a8a';
      ctx.fillRect(cx + 4, cy - 16, 10, 4);
      break;

    case 'gnome':
      // Very small, tall pointed hat
      ctx.fillStyle = color;
      ctx.fillRect(cx - 2, cy - 2, 5, 9);
      ctx.beginPath(); ctx.ellipse(cx + 4, cy - 6, 3.5, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      // Tall red hat
      ctx.fillStyle = '#c44';
      ctx.beginPath();
      ctx.moveTo(cx + 1, cy - 8);
      ctx.lineTo(cx + 5, cy - 20);
      ctx.lineTo(cx + 9, cy - 8);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.fillRect(cx - 3, cy + 7, 2.5, 5 + walk);
      ctx.fillRect(cx + 1, cy + 7, 2.5, 5 - walk);
      break;

    case 'demigod':
      // Tall, glowing, regal
      ctx.fillStyle = light;
      ctx.fillRect(cx - 3, cy - 18, 7, 24);
      ctx.beginPath(); ctx.ellipse(cx + 8, cy - 22, 5, 5, 0, 0, Math.PI * 2); ctx.fill();
      // Halo / glow
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx + 8, cy - 28, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ffee88';
      ctx.beginPath(); ctx.arc(cx + 8, cy - 28, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = dark;
      ctx.fillRect(cx - 4, cy + 6, 3, 14);
      ctx.fillRect(cx + 2, cy + 6, 3, 14);
      break;

    case 'orc':
      // Muscular, greenish (uses color), large tusks, pointed ears
      ctx.fillStyle = color;
      ctx.fillRect(cx - 8, cy - 8, 16, 16); // broad body
      ctx.beginPath(); ctx.ellipse(cx + 10, cy - 12, 7, 6, 0, 0, Math.PI * 2); ctx.fill();
      // Tusks
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(cx + 14, cy - 8, 2, 5);
      ctx.fillRect(cx + 11, cy - 6, 2, 4);
      // Pointed ears
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx + 6, cy - 14); ctx.lineTo(cx + 4, cy - 20); ctx.lineTo(cx + 9, cy - 14); ctx.fill();
      ctx.fillRect(cx - 10, cy + 8, 6, 10 + walk);
      ctx.fillRect(cx + 2, cy + 8, 6, 10 - walk);
      break;

    case 'merfolk':
      // Humanoid upper body + detailed fish tail
      ctx.fillStyle = color;
      ctx.fillRect(cx - 4, cy - 14, 8, 12);
      ctx.beginPath(); ctx.ellipse(cx + 6, cy - 18, 5, 5, 0, 0, Math.PI * 2); ctx.fill();
      // Hair / fin hint
      ctx.fillStyle = shade(color, -0.15);
      ctx.beginPath(); ctx.ellipse(cx + 6, cy - 22, 6, 2.5, 0, 0, Math.PI); ctx.fill();
      // Fish tail
      ctx.fillStyle = shade(color, 0.1);
      ctx.beginPath();
      ctx.moveTo(cx - 2, cy - 2);
      ctx.quadraticCurveTo(cx + 12, cy + 6, cx + 2, cy + 20);
      ctx.quadraticCurveTo(cx - 8, cy + 8, cx - 2, cy - 2);
      ctx.fill();
      // Tail fin
      ctx.beginPath();
      ctx.moveTo(cx + 0, cy + 18);
      ctx.lineTo(cx - 6, cy + 24);
      ctx.lineTo(cx + 8, cy + 24);
      ctx.fill();
      break;

    case 'rabbit':
      // Long upright ears, small body
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.ellipse(cx, cy + 2, 9, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 8, cy - 4, 4.5, 4, 0, 0, Math.PI * 2); ctx.fill();
      // Long ears
      ctx.fillRect(cx + 5, cy - 18, 3, 14);
      ctx.fillRect(cx + 9, cy - 16, 3, 12);
      ctx.fillStyle = shade(color, 0.3);
      ctx.fillRect(cx + 6, cy - 16, 1.5, 10);
      ctx.fillRect(cx - 5, cy + 8, 3, 6 + walk);
      ctx.fillRect(cx + 2, cy + 8, 3, 6 - walk);
      break;

    case 'deer':
      // Elegant, antlers
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.ellipse(cx - 2, cy, 13, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 14, cy - 4, 6, 4.5, 0, 0, Math.PI * 2); ctx.fill();
      // Antlers
      ctx.strokeStyle = '#5a4030';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(cx + 12, cy - 8);
      ctx.lineTo(cx + 10, cy - 16);
      ctx.lineTo(cx + 14, cy - 18);
      ctx.moveTo(cx + 11, cy - 14);
      ctx.lineTo(cx + 8, cy - 12);
      ctx.stroke();
      ctx.fillRect(cx - 10, cy + 6, 3, 8 + walk);
      ctx.fillRect(cx + 4, cy + 6, 3, 8 - walk);
      break;

    case 'wolf':
    case 'raptor':
      // Snouted, alert
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.ellipse(cx - 2, cy, 11, 6.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 12, cy - 2, 6, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx + 16, cy - 1, 7, 2.5); // snout
      // Ears
      ctx.beginPath(); ctx.moveTo(cx + 10, cy - 6); ctx.lineTo(cx + 8, cy - 12); ctx.lineTo(cx + 13, cy - 6); ctx.fill();
      ctx.fillRect(cx - 8, cy + 5, 3, 7 + walk);
      ctx.fillRect(cx + 2, cy + 5, 3, 7 - walk);
      break;

    case 'bear':
      // Large, bulky, rounded
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.ellipse(cx, cy, 15, 11, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 12, cy - 4, 8, 7, 0, 0, Math.PI * 2); ctx.fill();
      // Ears
      ctx.beginPath(); ctx.arc(cx + 8, cy - 10, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 16, cy - 8, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx - 10, cy + 8, 5, 6);
      ctx.fillRect(cx + 4, cy + 8, 5, 6);
      break;

    case 'fish':
      // Streamlined with fins
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.ellipse(cx, cy, 15, 5.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - 14, cy);
      ctx.lineTo(cx - 22, cy - 6);
      ctx.lineTo(cx - 22, cy + 6);
      ctx.fill();
      // Dorsal fin
      ctx.beginPath(); ctx.moveTo(cx - 2, cy - 5); ctx.lineTo(cx + 2, cy - 12); ctx.lineTo(cx + 6, cy - 5); ctx.fill();
      break;

    case 'shark':
      // Streamlined with prominent dorsal fin
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.ellipse(cx, cy, 17, 4.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx, cy - 4);
      ctx.lineTo(cx + 2, cy - 14);
      ctx.lineTo(cx + 8, cy - 4);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - 15, cy);
      ctx.lineTo(cx - 22, cy - 4);
      ctx.lineTo(cx - 22, cy + 4);
      ctx.fill();
      break;

    case 'whale':
      // Large smooth body
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.ellipse(cx, cy, 20, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - 18, cy);
      ctx.lineTo(cx - 26, cy - 4);
      ctx.lineTo(cx - 26, cy + 4);
      ctx.fill();
      break;

    case 'orca':
      // Black body with white patches
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath(); ctx.ellipse(cx, cy, 20, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f0f0f0';
      ctx.beginPath(); ctx.ellipse(cx + 4, cy - 1, 7, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - 18, cy);
      ctx.lineTo(cx - 26, cy - 3);
      ctx.lineTo(cx - 26, cy + 3);
      ctx.fill();
      break;

    case 'tyrant':
      // Large bipedal predator
      ctx.fillStyle = color;
      ctx.fillRect(cx - 6, cy - 4, 14, 12);
      ctx.beginPath(); ctx.ellipse(cx + 14, cy - 8, 7, 5.5, 0, 0, Math.PI * 2); ctx.fill();
      // Tiny arms
      ctx.fillRect(cx + 4, cy - 2, 4, 2);
      ctx.fillRect(cx - 8, cy + 8, 4, 12);
      ctx.fillRect(cx + 2, cy + 8, 4, 12);
      break;

    case 'hadrosaur':
      // Duck-billed herbivore
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.ellipse(cx - 2, cy, 16, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 16, cy - 4, 6, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx + 20, cy - 2, 6, 2); // bill
      ctx.fillRect(cx - 10, cy + 6, 4, 10);
      ctx.fillRect(cx + 4, cy + 6, 4, 10);
      break;

    default:
      // Generic quadruped
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.ellipse(cx, cy, 12, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 10, cy - 3, 6, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx - 6, cy + 5, 3, 6 + walk);
      ctx.fillRect(cx + 2, cy + 5, 3, 6 - walk);
  }

  // Eye for most land creatures
  if (!['fish', 'shark', 'whale', 'orca'].includes(sp.key)) {
    ctx.fillStyle = '#111';
    const eyeX = sp.key === 'elf' || sp.key === 'demigod' ? cx + 11 : cx + 14;
    const eyeY = sp.key === 'elf' || sp.key === 'demigod' ? cy - 20 : cy - 6;
    ctx.beginPath();
    ctx.arc(eyeX, eyeY, 1.6, 0, Math.PI * 2);
    ctx.fill();
    // Highlight
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(eyeX + 0.4, eyeY - 0.4, 0.6, 0, Math.PI * 2);
    ctx.fill();
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

  ctx.globalAlpha = 0.1;
  ctx.fillStyle = variant % 2 ? '#fff' : '#000';
  ctx.beginPath();
  ctx.arc(size * 0.35 + (variant % 4), size * 0.45, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  return c;
}
