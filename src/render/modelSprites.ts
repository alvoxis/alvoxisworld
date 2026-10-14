/**
 * Renders 3D models to canvas sprites for use in 2D renderer.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const SPRITE_SIZE = 64;
const cache = new Map<string, HTMLCanvasElement>();
const loader = new GLTFLoader();

export async function renderModelToSprite(url: string): Promise<HTMLCanvasElement> {
  if (cache.has(url)) return cache.get(url)!;

  const canvas = document.createElement('canvas');
  canvas.width = SPRITE_SIZE;
  canvas.height = SPRITE_SIZE;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
  renderer.setSize(SPRITE_SIZE, SPRITE_SIZE);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(3, 2, 3);
  camera.lookAt(0, 0.5, 0);

  scene.add(new THREE.AmbientLight(0x808080));
  const light = new THREE.DirectionalLight(0xffffff, 1.2);
  light.position.set(2, 3, 2);
  scene.add(light);

  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => {
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 1.5 / maxDim;
      model.scale.setScalar(scale);
      model.position.sub(box.getCenter(new THREE.Vector3()).multiplyScalar(scale));
      scene.add(model);
      renderer.render(scene, camera);
      cache.set(url, canvas);
      renderer.dispose();
      resolve(canvas);
    }, undefined, reject);
  });
}

export const MODEL_URLS: Record<string, string> = {
  wolf: 'assets/creatures/wolf.glb',
  shark: 'assets/creatures/shark.glb',
  tyrant: 'assets/creatures/trex.glb',
};

export const MODEL_KEYS = Object.keys(MODEL_URLS);
