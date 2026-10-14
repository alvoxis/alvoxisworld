/**
 * Loads pre-rendered pixel-art sprites for animals.
 */
const SPRITE_CACHE = new Map<string, HTMLCanvasElement>();

export function loadAnimalSprite(key: string): HTMLCanvasElement | null {
  if (SPRITE_CACHE.has(key)) return SPRITE_CACHE.get(key)!;
  
  const img = new Image();
  img.src = `sprites/${key}.png`;
  
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  
  img.onload = () => {
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0);
  };
  
  SPRITE_CACHE.set(key, c);
  return c;
}

export const PIXEL_ART_ANIMALS = ['bear', 'wolf', 'tyrant', 'fish'];
