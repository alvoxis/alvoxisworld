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
  // Torso
  bodyPart(bw, bh * 0.7, 3).draw(ctx, cx, cy - 2, 1, color);
  // Head
  headPart(7 * hs, 6 * hs).draw(ctx, cx + 2, cy - bh * 0.5, 1, color);
  // Arms
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(cx - bw * 0.4, cy - bh * 0.2, 3, 8, 1);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(cx + bw * 0.25, cy - bh * 0.2, 3, 8, 1);
  ctx.fill();
  // Ears
  if (race.hasEars) {
    earPart(race.earLength, true).draw(ctx, cx - 1, cy - bh * 0.55, 1, color);
    earPart(race.earLength, true).draw(ctx, cx + 12, cy - bh * 0.55, 1, color);
  }
  // Beard
  if (race.hasBeard) beardPart(12).draw(ctx, cx + 1, cy - 4, 1, color);
  // Tusks
  if (race.hasTusks) {
    tuskPart().draw(ctx, cx + 9, cy - 6, 1, color);
    tuskPart().draw(ctx, cx + 7, cy - 4, 1, color);
  }
  // Legs
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(cx - 3, cy + bh * 0.2, 3.5, 10 + walk, 1);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(cx + 1, cy + bh * 0.2, 3.5, 10 - walk, 1);
  ctx.fill();
  // Simple clothing accent
  ctx.fillStyle = '#3a2818';
  ctx.fillRect(cx - 2, cy + 2, 6, 2);

  return c;
}
