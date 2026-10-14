/**
 * Animal sprite drawing with distinct silhouettes.
 * Each animal is recognizable by shape, not just color.
 */
export function drawAnimal(ctx: CanvasRenderingContext2D, key: string, cx: number, cy: number, color: string, frame: number): void {
  const walk = frame === 1 ? 2 : 0;
  ctx.fillStyle = color;

  switch (key) {
    case 'bear':
      // Massive body, small head, rounded ears, short legs
      ctx.beginPath(); ctx.ellipse(cx, cy + 2, 16, 11, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx - 12, cy - 6, 7, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx - 16, cy - 14, 4, 5); ctx.fillRect(cx - 9, cy - 14, 4, 5);
      ctx.fillRect(cx - 8, cy + 10, 5, 7 + walk); ctx.fillRect(cx + 2, cy + 10, 5, 7 - walk);
      ctx.fillRect(cx - 10, cy + 16, 6, 2); ctx.fillRect(cx, cy + 16, 6, 2);
      break;

    case 'deer':
      // Slender body, long legs, branching antlers
      ctx.beginPath(); ctx.ellipse(cx, cy, 11, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx - 14, cy - 8, 4, 4, 0, 0, Math.PI * 2); ctx.fill();
      // Antlers
      ctx.fillRect(cx - 17, cy - 18, 2, 10); ctx.fillRect(cx - 12, cy - 18, 2, 10);
      ctx.fillRect(cx - 19, cy - 16, 4, 1); ctx.fillRect(cx - 14, cy - 16, 4, 1);
      // Long legs
      ctx.fillRect(cx - 5, cy + 4, 2, 14 + walk); ctx.fillRect(cx + 2, cy + 4, 2, 14 - walk);
      break;

    case 'rabbit':
      // Small round body, very long ears
      ctx.beginPath(); ctx.ellipse(cx, cy + 2, 7, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx - 5, cy - 12, 3, 12); ctx.fillRect(cx + 1, cy - 12, 3, 12);
      ctx.fillRect(cx - 3, cy + 7, 2, 4); ctx.fillRect(cx + 1, cy + 7, 2, 4);
      break;

    case 'wolf':
      // Lean body, long snout, pointed ears, bushy tail
      ctx.beginPath(); ctx.ellipse(cx, cy + 1, 13, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx - 14, cy - 3, 6, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx - 18, cy - 10, 2, 5); ctx.fillRect(cx - 11, cy - 10, 2, 5);
      // Tail
      ctx.beginPath(); ctx.moveTo(cx + 12, cy); ctx.lineTo(cx + 20, cy - 6); ctx.lineTo(cx + 18, cy + 2); ctx.fill();
      ctx.fillRect(cx - 5, cy + 5, 3, 9 + walk); ctx.fillRect(cx + 2, cy + 5, 3, 9 - walk);
      break;

    case 'fish':
      // Horizontal oval, forked tail, small fins
      ctx.beginPath(); ctx.ellipse(cx, cy, 12, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx + 12, cy); ctx.lineTo(cx + 18, cy - 6); ctx.lineTo(cx + 18, cy + 6); ctx.fill();
      ctx.fillRect(cx - 2, cy - 6, 4, 2); ctx.fillRect(cx - 2, cy + 4, 4, 2);
      break;

    case 'shark':
      // Streamlined, triangular dorsal, pointed snout
      ctx.beginPath(); ctx.ellipse(cx, cy, 16, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx - 2, cy - 5); ctx.lineTo(cx + 2, cy - 14); ctx.lineTo(cx + 8, cy - 5); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx + 16, cy); ctx.lineTo(cx + 22, cy - 5); ctx.lineTo(cx + 22, cy + 5); ctx.fill();
      ctx.fillRect(cx - 14, cy - 2, 3, 1);
      break;

    case 'whale':
      // Large rounded body, small flipper, spout hint
      ctx.beginPath(); ctx.ellipse(cx, cy, 20, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx - 6, cy + 6, 5, 4);
      ctx.beginPath(); ctx.moveTo(cx + 18, cy); ctx.lineTo(cx + 24, cy - 4); ctx.lineTo(cx + 24, cy + 4); ctx.fill();
      break;

    case 'orca':
      // Black body, white belly, tall dorsal
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath(); ctx.ellipse(cx, cy, 16, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f0f0f0';
      ctx.beginPath(); ctx.ellipse(cx - 2, cy + 2, 8, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath(); ctx.moveTo(cx - 2, cy - 6); ctx.lineTo(cx + 1, cy - 18); ctx.lineTo(cx + 4, cy - 6); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx + 14, cy); ctx.lineTo(cx + 20, cy - 4); ctx.lineTo(cx + 20, cy + 4); ctx.fill();
      break;

    case 'grazer':
    case 'hadrosaur':
      // Duck-billed, four legs, long tail
      ctx.beginPath(); ctx.ellipse(cx, cy, 12, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx - 14, cy - 4, 6, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx + 10, cy, 10, 3);
      ctx.fillRect(cx - 4, cy + 5, 3, 10 + walk); ctx.fillRect(cx + 2, cy + 5, 3, 10 - walk);
      break;

    case 'raptor':
      // Bipedal, small arms, large head, long tail
      ctx.beginPath(); ctx.ellipse(cx, cy + 2, 6, 10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx - 10, cy - 8, 5, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx + 4, cy + 4, 12, 2);
      ctx.fillRect(cx - 2, cy + 10, 3, 10 + walk); ctx.fillRect(cx + 2, cy + 10, 3, 10 - walk);
      ctx.fillRect(cx - 12, cy - 2, 3, 4);
      break;

    case 'tyrant':
      // Large bipedal, huge head, tiny arms, thick legs
      ctx.beginPath(); ctx.ellipse(cx, cy + 2, 8, 12, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx - 12, cy - 10, 8, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx + 6, cy + 2, 14, 3);
      ctx.fillRect(cx - 3, cy + 12, 5, 12 + walk); ctx.fillRect(cx + 3, cy + 12, 5, 12 - walk);
      ctx.fillRect(cx - 14, cy - 4, 2, 3);
      break;

    default:
      // Generic quadruped
      ctx.beginPath(); ctx.ellipse(cx, cy + 2, 10, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx - 10, cy - 2, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx - 4, cy + 6, 3, 8); ctx.fillRect(cx + 2, cy + 6, 3, 8);
  }
}

export const ANIMAL_KEYS = ['bear', 'deer', 'rabbit', 'wolf', 'fish', 'shark', 'whale', 'orca', 'grazer', 'raptor', 'hadrosaur', 'tyrant'];
