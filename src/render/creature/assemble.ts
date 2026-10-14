/**
 * Single assembly point for creature sprites.
 * Composes parts from parts.ts using race configs and a deterministic genome.
 */
import { getRaceVisual } from './races';
import { bodyPart, headPart, earPart, beardPart, tuskPart } from './parts';

export interface Genome {
  paletteIndex: number;
  bodyScale: number;
  headScale: number;
}

/** Deterministic genome from a seed (creature ID). */
export function genomeFromSeed(seed: number): Genome {
  const h = (seed * 2654435761) >>> 0;
  return {
    paletteIndex: h % 3,
    bodyScale: 0.9 + ((h >> 4) % 21) / 100,
    headScale: 0.95 + ((h >> 8) % 11) / 100,
  };
}

export function assembleCreature(
  raceKey: string,
  genome: Genome,
  frame: number,
): HTMLCanvasElement {
  const race = getRaceVisual(raceKey);
  const c = document.createElement('canvas');
  c.width = 72;
  c.height = 72;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;

  const color = race.palette[genome.paletteIndex % race.palette.length] || '#c9a078';
  const cx = 36;
  const cy = 42;
  const walk = frame ? 3 : -2;
  const bs = genome.bodyScale;
  const hs = genome.headScale;

  const bw = race.bodyWidth * bs;
  const bh = race.bodyHeight * bs;
  const headY = cy - bh * 0.55;
  const torsoY = cy - bh * 0.15;
  // Neck
  ctx.fillStyle = color;
  ctx.fillRect(cx + 1, headY + 5, 4, 3);
  // Torso (clothing color)
  const cloth = genome.paletteIndex === 1 ? '#4a3a2a' : genome.paletteIndex === 2 ? '#3a4a3a' : '#5a4a3a';
  bodyPart(bw * 0.8, bh * 0.55, 2).draw(ctx, cx, torsoY, 1, cloth);
  // Head
  headPart(8 * hs, 7 * hs).draw(ctx, cx, headY, 1, color);
  // Face details
  ctx.fillStyle = '#2a1a10';
  ctx.fillRect(cx + 2, headY + 2, 1, 1); // eye
  ctx.fillRect(cx + 5, headY + 2, 1, 1); // eye
  // Arms
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(cx - bw * 0.45, torsoY, 3, 7, 1);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(cx + bw * 0.3, torsoY, 3, 7, 1);
  ctx.fill();
  // Hands
  ctx.fillRect(cx - bw * 0.45, torsoY + 6, 3, 2);
  ctx.fillRect(cx + bw * 0.3, torsoY + 6, 3, 2);
  // Ears
  if (race.hasEars) {
    earPart(race.earLength, true).draw(ctx, cx - 3, headY, 1, color);
    earPart(race.earLength, true).draw(ctx, cx + 10, headY, 1, color);
  }
  // Beard
  if (race.hasBeard) beardPart(10).draw(ctx, cx, headY + 4, 1, color);
  // Tusks
  if (race.hasTusks) {
    tuskPart().draw(ctx, cx + 8, headY + 3, 1, color);
    tuskPart().draw(ctx, cx + 6, headY + 4, 1, color);
  }
  // Legs
  ctx.fillStyle = '#3a2818'; // boots
  ctx.beginPath();
  ctx.roundRect(cx - 2, torsoY + bh * 0.4, 4, 9 + walk, 1);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(cx + 2, torsoY + bh * 0.4, 4, 9 - walk, 1);
  ctx.fill();
  // Shoes
  ctx.fillStyle = '#2a1a10';
  ctx.fillRect(cx - 3, torsoY + bh * 0.4 + 8 + walk, 5, 2);
  ctx.fillRect(cx + 1, torsoY + bh * 0.4 + 8 - walk, 5, 2);

  return c;
}
