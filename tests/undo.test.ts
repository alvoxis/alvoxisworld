import { describe, expect, it } from 'vitest';
import { MAX_UNDO_ACTIONS, UndoHistory } from '../src/game/undo';
import { Camera, minimapToWorld, viewportOnMinimap } from '../src/render/camera';
import { GRAZER } from '../src/sim/creatures';
import { Simulation } from '../src/sim/simulation';
import { applyHeightBrush, applyPaintBrush, applySmoothBrush } from '../src/world/brush';
import { generateWorld } from '../src/world/generator';
import { T } from '../src/world/terrain';
import { World } from '../src/world/world';

function snapshot(w: World) {
  return [w.heights, w.terrain, w.temperature, w.moisture, w.baseTemperature, w.baseMoisture, w.waterFlags, w.under].map(
    (a) => a.slice(),
  );
}

describe('undo', () => {
  it('starts empty and reports nothing to undo', () => {
    const u = new UndoHistory();
    const w = generateWorld(64, 64, 1);
    expect(u.canUndo).toBe(false);
    expect(u.undo(w)).toBeNull();
  });

  it('restores every layer exactly after a multi-application brush stroke', () => {
    const w = generateWorld(128, 96, 3);
    const before = snapshot(w);
    const u = new UndoHistory();
    u.begin(w, 'Raise');
    for (let k = 0; k < 30; k++) u.record(w, 'Raise', () => applyHeightBrush(w, { x: 60 + k, y: 40, radius: 4 }, 1));
    u.end();
    expect(u.size).toBe(1); // one stroke = one action
    expect(snapshot(w)).not.toEqual(before);
    expect(u.undo(w)).toBe('Raise');
    expect(snapshot(w)).toEqual(before);
    expect(u.canUndo).toBe(false);
  });

  it('undoes painting (terrain, climate and water memory) in reverse order', () => {
    const w = generateWorld(128, 96, 5);
    const s0 = snapshot(w);
    const u = new UndoHistory();
    u.record(w, 'Lake', () => applyPaintBrush(w, { x: 40, y: 40, radius: 5 }, T.LAKE));
    const s1 = snapshot(w);
    u.record(w, 'Desert', () => applyPaintBrush(w, { x: 42, y: 40, radius: 6 }, T.DESERT));
    u.record(w, 'Smooth', () => applySmoothBrush(w, { x: 42, y: 40, radius: 6 }));
    expect(u.size).toBe(3);
    u.undo(w);
    u.undo(w);
    expect(snapshot(w)).toEqual(s1);
    u.undo(w);
    expect(snapshot(w)).toEqual(s0);
  });

  it('does not record simulation changes made between brush applications', () => {
    const w = generateWorld(96, 96, 6);
    const sim = new Simulation(w);
    sim.weather.config.auto = false;
    sim.spawnInCircle(GRAZER, 48, 48, 20, 60); // grazing turns grass to soil over time
    const u = new UndoHistory();
    u.begin(w, 'Raise');
    u.record(w, 'Raise', () => applyHeightBrush(w, { x: 10, y: 10, radius: 2 }, 1));
    for (let t = 0; t < 200; t++) sim.step(); // stroke still open while the world runs
    u.end();
    // Only the brushed tiles are in the action: grazing elsewhere is untouched by undo.
    const grazed = w.terrain.slice();
    u.undo(w);
    let differ = 0;
    for (let i = 0; i < grazed.length; i++) if (grazed[i] !== w.terrain[i]) differ++;
    expect(differ).toBeLessThanOrEqual(13); // at most the brushed tiles (radius 2 circle)
  });

  it('undoes meteor terrain changes and puts out fires on restored tiles', () => {
    const w = generateWorld(128, 96, 7);
    const sim = new Simulation(w);
    sim.weather.config.auto = false;
    const before = snapshot(w);
    const u = new UndoHistory();
    u.record(w, 'Meteor', () => sim.meteor(64, 48, 6, 2));
    expect(snapshot(w)).not.toEqual(before);
    u.undo(w);
    expect(snapshot(w)).toEqual(before);
    for (let i = 0; i < w.fire.length; i++) {
      // any fire left must be on a tile the meteor did not change (it was outside the action)
      if (w.fire[i]) expect(before[1][i]).toBe(w.terrain[i]);
    }
  });

  it('bumps the passability version so navigation rebuilds after undo', () => {
    const w = generateWorld(96, 64, 8);
    // Paint on land (sea → lake would not change where animals can walk).
    let land = -1;
    for (let i = 0; i < w.terrain.length && land < 0; i++) if (w.terrain[i] === T.GRASS || w.terrain[i] === T.FOREST) land = i;
    expect(land).toBeGreaterThanOrEqual(0);
    const u = new UndoHistory();
    u.record(w, 'Lake', () => applyPaintBrush(w, { x: (land % 96) + 0.5, y: Math.floor(land / 96) + 0.5, radius: 1 }, T.LAKE));
    const v = w.passVersion;
    u.undo(w);
    expect(w.passVersion).toBeGreaterThan(v);
  });

  it('keeps a bounded history and drops empty actions', () => {
    const w = generateWorld(96, 64, 9);
    const u = new UndoHistory();
    u.record(w, 'Nothing', () => {});
    expect(u.canUndo).toBe(false);
    for (let k = 0; k < MAX_UNDO_ACTIONS + 10; k++) {
      u.record(w, `Raise ${k}`, () => applyHeightBrush(w, { x: 10 + (k % 70), y: 30, radius: 1 }, 1));
    }
    expect(u.size).toBe(MAX_UNDO_ACTIONS);
    expect(u.nextLabel).toBe(`Raise ${MAX_UNDO_ACTIONS + 9}`);
    u.clear();
    expect(u.canUndo).toBe(false);
  });
});

describe('minimap navigation', () => {
  it('maps minimap pixels to world tiles (clamped)', () => {
    expect(minimapToWorld(60, 45, 120, 90, 512, 320)).toEqual({ x: 256, y: 160 });
    expect(minimapToWorld(0, 0, 120, 90, 512, 320)).toEqual({ x: 0, y: 0 });
    expect(minimapToWorld(500, -20, 120, 90, 512, 320)).toEqual({ x: 512, y: 0 });
  });

  it('a tap centres the camera there and the viewport box follows', () => {
    const cam = new Camera();
    cam.setWorldSize(512, 320);
    cam.setViewport(400, 800);
    cam.zoom = 8;
    const p = minimapToWorld(30, 20, 120, 75, 512, 320);
    cam.centerOn(p.x, p.y);
    const centre = cam.screenToWorld(200, 400);
    expect(centre.x).toBeCloseTo(p.x, 5);
    expect(centre.y).toBeCloseTo(p.y, 5);
    const v = viewportOnMinimap(cam, 120, 75);
    expect(v.x + v.w / 2).toBeCloseTo(30, 5);
    expect(v.y + v.h / 2).toBeCloseTo(20, 5);
    expect(v.w).toBeCloseTo((400 / 8) * (120 / 512), 5);
  });
});
