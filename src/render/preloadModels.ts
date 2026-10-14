/**
 * Preloads 3D models and renders them to sprites at startup.
 */
import { renderModelToSprite, MODEL_URLS } from './modelSprites';

export async function preloadModels(): Promise<void> {
  const cache: Record<string, HTMLCanvasElement> = {};
  (window as any).__modelSprites = cache;

  for (const [key, url] of Object.entries(MODEL_URLS)) {
    try {
      const sprite = await renderModelToSprite(url);
      cache[url] = sprite;
      console.log(`Loaded model: ${key}`);
    } catch (e) {
      console.warn(`Failed to load ${key}:`, e);
    }
  }
}
