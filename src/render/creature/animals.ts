/**
 * Animal sprite drawing. Each animal has a distinct silhouette.
 */
export function drawAnimal(ctx: CanvasRenderingContext2D, key: string, cx: number, cy: number, color: string, frame: number): void {
  const walk = frame === 1 ? 2 : 0;
  ctx.fillStyle = color;
  switch (key) {
    case 'bear':
      // Large body, small head, rounded ears
      ctx.beginPath(); ctx.ellipse(cx, cy + 4, 14, 10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx - 10, cy - 4, 6, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx - 14, cy - 10, 3, 4); ctx.fillRect(cx - 8, cy - 10, 3, 4);
      ctx.fillRect(cx - 6, cy + 12, 4, 6 + walk); ctx.fillRect(cx + 2, cy + 12, 4, 6 - walk);
      break;
    case 'deer':
      // Slender body, long legs, antlers
      ctx.beginPath(); ctx.ellipse(cx, cy + 2, 10, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx - 12, cy - 6, 4, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx - 16, cy - 14, 1, 8); ctx.fillRect(cx - 12, cy - 14, 1, 8);
      ctx.fillRect(cx - 4, cy + 6, 2, 12 + walk); ctx.fillRect(cx + 2, cy + 6, 2, 12 - walk);
      break;
    case 'rabbit':
      // Small round body, long ears
      ctx.beginPath(); ctx.ellipse(cx, cy + 4, 6, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx - 4, cy - 8, 2, 8); ctx.fillRect(cx + 1, cy - 8, 2, 8);
      ctx.fillRect(cx - 2, cy + 8, 2, 3); ctx.fillRect(cx + 1, cy + 8, 2, 3);
      break;
    case 'wolf':
      // Lean body, pointed ears, snout
      ctx.beginPath(); ctx.ellipse(cx, cy + 2, 12, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx - 12, cy - 2, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx - 16, cy - 8, 2, 4); ctx.fillRect(cx - 10, cy - 8, 2, 4);
      ctx.fillRect(cx - 4, cy + 6, 3, 8 + walk); ctx.fillRect(cx + 3, cy + 6, 3, 8 - walk);
      break;
    case 'fish':
      // Oval body, tail fin
      ctx.beginPath(); ctx.ellipse(cx, cy, 10, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx + 10, cy); ctx.lineTo(cx + 16, cy - 5); ctx.lineTo(cx + 16, cy + 5); ctx.fill();
      break;
    case 'shark':
      // Streamlined, dorsal fin
      ctx.beginPath(); ctx.ellipse(cx, cy, 14, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx, cy - 5); ctx.lineTo(cx + 2, cy - 12); ctx.lineTo(cx + 6, cy - 5); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx + 14, cy); ctx.lineTo(cx + 20, cy - 4); ctx.lineTo(cx + 20, cy + 4); ctx.fill();
      break;
    case 'whale':
      // Large oval, small fin
      ctx.beginPath(); ctx.ellipse(cx, cy, 18, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx - 4, cy + 6, 4, 3);
      ctx.beginPath(); ctx.moveTo(cx + 16, cy); ctx.lineTo(cx + 22, cy - 3); ctx.lineTo(cx + 22, cy + 3); ctx.fill();
      break;
    case 'orca':
      // Black/white, tall dorsal
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath(); ctx.ellipse(cx, cy, 14, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f0f0f0';
      ctx.beginPath(); ctx.ellipse(cx - 2, cy + 2, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath(); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx + 2, cy - 16); ctx.lineTo(cx + 4, cy - 6); ctx.fill();
      break;
    case 'grazer':
    case 'hadrosaur':
      // Duck-bill dinosaur
      ctx.beginPath(); ctx.ellipse(cx, cy + 2, 12, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx - 14, cy - 2, 6, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx - 4, cy + 8, 3, 10 + walk); ctx.fillRect(cx + 3, cy + 8, 3, 10 - walk);
      ctx.fillRect(cx - 6, cy + 16, 6, 2);
      break;
    case 'raptor':
    case 'tyrant':
      // Bipedal, small arms, large head
      ctx.beginPath(); ctx.ellipse(cx, cy + 4, 8, 10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx - 8, cy - 8, 6, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx - 2, cy + 12, 4, 10 + walk); ctx.fillRect(cx + 2, cy + 12, 4, 10 - walk);
      ctx.fillRect(cx - 10, cy, 3, 4);
      break;
    default:
      // Generic quadruped
      ctx.beginPath(); ctx.ellipse(cx, cy + 2, 10, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx - 10, cy - 2, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx - 4, cy + 6, 3, 8); ctx.fillRect(cx + 2, cy + 6, 3, 8);
  }
}
