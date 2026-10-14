/**
 * Building sprite loader for 3D house models.
 */
import { renderModelToSprite } from './modelSprites';

const BUILDING_URLS: Record<string, string> = {
  house: 'assets/buildings/house3.glb',
  house4: 'assets/buildings/house4.glb',
};

const cache = new Map<string, HTMLCanvasElement>();

export async function preloadBuildings(): Promise<void> {
  for (const [key, url] of Object.entries(BUILDING_URLS)) {
    try {
      const sprite = await renderModelToSprite(url);
      cache.set(key, sprite);
      console.log(`Loaded building: ${key}`);
    } catch (e) {
      console.warn(`Failed to load building ${key}:`, e);
    }
  }
}

export function getBuildingSprite(key: string): HTMLCanvasElement | null {
  return cache.get(key) || null;
}

export const BUILDING_KEYS = Object.keys(BUILDING_URLS);
