/**
 * Animated model renderer with state-based frames.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const SPRITE_SIZE = 64;
const FRAMES_PER_STATE = 4;
const loader = new GLTFLoader();

interface AnimatedSprite {
  idle: HTMLCanvasElement[];
  walk: HTMLCanvasElement[];
}

const cache = new Map<string, AnimatedSprite>();

export async function loadAnimatedModel(url: string): Promise<AnimatedSprite> {
  if (cache.has(url)) return cache.get(url)!;

  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => {
      const model = gltf.scene;
      const mixer = new THREE.AnimationMixer(model);
      const clips = gltf.animations;

      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      model.scale.setScalar(1.5 / maxDim);

      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
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
      scene.add(model);

      const renderFrames = (clip: THREE.AnimationClip | null): HTMLCanvasElement[] => {
        const frames: HTMLCanvasElement[] = [];
        const action = clip ? mixer.clipAction(clip) : null;
        if (action) action.play();
        for (let i = 0; i < FRAMES_PER_STATE; i++) {
          if (action) mixer.update(clip!.duration / FRAMES_PER_STATE);
          renderer.render(scene, camera);
          const c = document.createElement('canvas');
          c.width = SPRITE_SIZE;
          c.height = SPRITE_SIZE;
          c.getContext('2d')!.drawImage(renderer.domElement, 0, 0);
          frames.push(c);
        }
        if (action) action.stop();
        return frames;
      };

      const idleClip = clips.find(c => /idle/i.test(c.name)) || clips[0] || null;
      const walkClip = clips.find(c => /walk|run/i.test(c.name)) || clips[1] || idleClip;

      const result: AnimatedSprite = {
        idle: renderFrames(idleClip),
        walk: renderFrames(walkClip),
      };

      renderer.dispose();
      cache.set(url, result);
      resolve(result);
    }, undefined, reject);
  });
}

export function getAnimatedFrame(url: string, state: 'idle' | 'walk', frame: number): HTMLCanvasElement | null {
  const sprite = cache.get(url);
  if (!sprite) return null;
  const frames = state === 'walk' ? sprite.walk : sprite.idle;
  return frames[frame % frames.length] || null;
}
