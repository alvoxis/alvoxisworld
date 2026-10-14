/**
 * Single assembly point for creature sprites.
 * Composes parts from parts.ts using race configs and a deterministic genome.
 */
import { getRaceVisual } from './races';

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
  const headY = cy - bh * 0.6;
  const torsoY = cy - bh * 0.1;
  const skin = color;
  const cloth = genome.paletteIndex === 1 ? '#5a4a3a' : genome.paletteIndex === 2 ? '#4a5a4a' : '#6a5a4a';
  const boot = '#2a1a10';

  // Legs (behind)
  ctx.fillStyle = boot;
  ctx.fillRect(cx - 3, torsoY + bh * 0.35, 4, 10 + walk);
  ctx.fillRect(cx + 1, torsoY + bh * 0.35, 4, 10 - walk);
  // Feet
  ctx.fillRect(cx - 4, torsoY + bh * 0.35 + 9 + walk, 6, 2);
  ctx.fillRect(cx, torsoY + bh * 0.35 + 9 - walk, 6, 2);

  // Torso
  ctx.fillStyle = cloth;
  ctx.fillRect(cx - bw * 0.35, torsoY, bw * 0.7, bh * 0.45);
  // Belt
  ctx.fillStyle = '#3a2818';
  ctx.fillRect(cx - bw * 0.3, torsoY + bh * 0.35, bw * 0.6, 2);

  // Neck
  ctx.fillStyle = skin;
  ctx.fillRect(cx - 2, headY + 6, 6, 4);

  // Head
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(cx + 1, headY + 2, 6 * hs, 5.5 * hs, 0, 0, Math.PI * 2);
  ctx.fill();

  // Hair
  ctx.fillStyle = genome.paletteIndex === 0 ? '#3a2010' : genome.paletteIndex === 1 ? '#1a1008' : '#5a4030';
  ctx.fillRect(cx - 4, headY - 4, 10, 4);
  // Eyes
  ctx.fillStyle = '#1a1008';
  ctx.fillRect(cx - 1, headY + 1, 2, 2);
  ctx.fillRect(cx + 3, headY + 1, 2, 2);
  // Mouth
  ctx.fillRect(cx + 1, headY + 4, 2, 1);

  // Arms
  ctx.fillStyle = skin;
  ctx.fillRect(cx - bw * 0.5, torsoY + 2, 4, 8);
  ctx.fillRect(cx + bw * 0.35, torsoY + 2, 4, 8);
  // Hands
  ctx.fillRect(cx - bw * 0.5, torsoY + 9, 4, 2);
  ctx.fillRect(cx + bw * 0.35, torsoY + 9, 4, 2);

  // Ears (pointed for elves/orcs)
  if (race.hasEars) {
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.moveTo(cx - 5, headY);
    ctx.lineTo(cx - 5 - race.earLength * 0.3, headY - race.earLength * 0.6);
    ctx.lineTo(cx - 3, headY + 1);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 7, headY);
    ctx.lineTo(cx + 7 + race.earLength * 0.3, headY - race.earLength * 0.6);
    ctx.lineTo(cx + 5, headY + 1);
    ctx.fill();
  }

  // Beard (dwarves)
  if (race.hasBeard) {
    ctx.fillStyle = '#4a3020';
    ctx.beginPath();
    ctx.moveTo(cx - 4, headY + 4);
    ctx.lineTo(cx + 6, headY + 4);
    ctx.lineTo(cx + 2, headY + 14);
    ctx.fill();
  }

  // Tusks (orcs)
  if (race.hasTusks) {
    ctx.fillStyle = '#f0f0e0';
    ctx.fillRect(cx + 4, headY + 3, 2, 5);
    ctx.fillRect(cx + 1, headY + 4, 2, 4);
  }

  // Merfolk tail accent
  if (raceKey === 'merfolk') {
    ctx.fillStyle = '#4a8aaa';
    ctx.beginPath();
    ctx.ellipse(cx + 1, torsoY + bh * 0.5, 5, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  return c;
}
