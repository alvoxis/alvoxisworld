/**
 * Three.js renderer for 3D models.
 * Prototype: renders GLB models to canvas for compositing.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const modelCache = new Map<string, THREE.Group>();

export async function loadModel(url: string): Promise<THREE.Group> {
  if (modelCache.has(url)) return modelCache.get(url)!.clone();
  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => {
      modelCache.set(url, gltf.scene);
      resolve(gltf.scene.clone());
    }, undefined, reject);
  });
}

export function createOffscreenRenderer(w: number, h: number): { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(w, h);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
  camera.position.set(2, 1.5, 2);
  camera.lookAt(0, 0.5, 0);
  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(2, 3, 2);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0x404040));
  return { renderer, scene, camera };
}

export const PROTOTYPE_MODELS = {
  shark: 'assets/creatures/shark.glb',
  house: 'assets/buildings/house.gltf',
};
