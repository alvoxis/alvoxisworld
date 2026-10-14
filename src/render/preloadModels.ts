/**
 * Preloads animated 3D models at startup.
 */
import { loadAnimatedModel } from './animatedModels';
import { MODEL_URLS } from './modelSprites';

export async function preloadModels(): Promise<void> {
  for (const [key, url] of Object.entries(MODEL_URLS)) {
    try {
      await loadAnimatedModel(url);
      console.log(`Loaded animated model: ${key}`);
    } catch (e) {
      console.warn(`Failed to load ${key}:`, e);
    }
  }
}
