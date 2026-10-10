import { describe, expect, it } from 'vitest';
import { FILE_FORMAT, SaveFileError, decodeSaveFile, encodeSaveFile } from '../src/save/file';
import { SAVE_VERSION, deserializeInto, serialize, type SaveData } from '../src/save/serialize';
import { EFFECT } from '../src/sim/effects';
import { GRAZER, RAPTOR } from '../src/sim/creatures';
import { Simulation } from '../src/sim/simulation';
import { generateWorld } from '../src/world/generator';
import { T } from '../src/world/terrain';

function liveSim(seed = 21): Simulation {
  const sim = new Simulation(generateWorld(128, 96, seed));
  sim.spawnInCircle(GRAZER, 64, 48, 25, 40);
  sim.spawnInCircle(RAPTOR, 64, 48, 25, 4);
  for (let t = 0; t < 60; t++) sim.step();
  sim.applyEffect(EFFECT.HASTE, 64, 48, 30, 300, 2);
  sim.fire.ignite(sim.world, 60, 40); // a burning tile must survive the round trip
  return sim;
}

function text(json: unknown): Uint8Array {
  return new TextEncoder().encode(typeof json === 'string' ? json : JSON.stringify(json));
}

async function expectRejected(bytes: Uint8Array, msg: RegExp): Promise<void> {
  const err = await decodeSaveFile(bytes).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(SaveFileError);
  expect((err as Error).message).toMatch(msg);
}

describe('save file export/import', () => {
  it('round-trips a running world through a gzip file and continues identically', async () => {
    const sim = liveSim();
    const { bytes, gzip } = await encodeSaveFile(serialize(sim));
    expect(gzip).toBe(true);
    expect(bytes[0]).toBe(0x1f);
    const report = await decodeSaveFile(bytes);
    expect(report.migrated).toBe(false);
    expect(report.version).toBe(SAVE_VERSION);
    const other = new Simulation(generateWorld(32, 32, 1));
    deserializeInto(other, report.data);
    expect(other.world.terrain).toEqual(sim.world.terrain);
    expect(other.world.waterFlags).toEqual(sim.world.waterFlags);
    expect(other.creatures.count).toBe(sim.creatures.count);
    expect(other.creatures.effMask.slice(0, other.creatures.count)).toEqual(sim.creatures.effMask.slice(0, sim.creatures.count));
    for (let t = 0; t < 100; t++) {
      sim.step();
      other.step();
    }
    expect(Array.from(other.creatures.x.slice(0, other.creatures.count))).toEqual(
      Array.from(sim.creatures.x.slice(0, sim.creatures.count)),
    );
    expect(other.tick).toBe(sim.tick);
  });

  it('accepts uncompressed JSON files too', async () => {
    const sim = liveSim(22);
    const gz = await encodeSaveFile(serialize(sim));
    const plain = new Uint8Array(await new Response(new Blob([gz.bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    expect(plain[0]).toBe('{'.charCodeAt(0));
    const report = await decodeSaveFile(plain);
    expect(report.width).toBe(128);
  });

  it('migrates an old save version inside a file and reports it', async () => {
    const sim = liveSim(23);
    const data = serialize(sim);
    const v4: SaveData = { ...data, version: 4 };
    const c = { ...(v4.creatures as object) } as Record<string, unknown>;
    delete c.effTicks;
    delete c.effPower;
    delete c.effMask;
    v4.creatures = c as unknown as SaveData['creatures'];
    const { bytes } = await encodeSaveFile(v4);
    const report = await decodeSaveFile(bytes);
    expect(report.version).toBe(4);
    expect(report.migrated).toBe(true);
    const other = new Simulation(generateWorld(32, 32, 1));
    deserializeInto(other, report.data);
    expect(Array.from(other.creatures.effMask.slice(0, other.creatures.count)).every((m) => m === 0)).toBe(true);
  });

  it('rejects malformed files with readable errors and no exceptions escaping', async () => {
    await expectRejected(new Uint8Array(0), /empty/);
    await expectRejected(text('hello world'), /not valid JSON/);
    await expectRejected(text({ format: 'other-game', save: {} }), /not an ALVOXIS save/);
    await expectRejected(text({ format: FILE_FORMAT, fileVersion: 99, save: {} }), /newer version/);
    await expectRejected(new Uint8Array([0x1f, 0x8b, 1, 2, 3, 4]), /damaged/);
    await expectRejected(text({ format: FILE_FORMAT, fileVersion: 1, save: { version: 1 } }), /map size/);
    await expectRejected(
      text({ format: FILE_FORMAT, fileVersion: 1, save: { version: 99, width: 4, height: 4 } }),
      /newer than this game supports/,
    );
    await expectRejected(
      text({ format: FILE_FORMAT, fileVersion: 1, save: { version: 5, width: 100000, height: 100000 } }),
      /larger than this game supports/,
    );
    await expectRejected(
      text({ format: FILE_FORMAT, fileVersion: 1, save: { heights: { $t: 'Float64Array', b64: '' } } }),
      /Unknown data type/,
    );
  });

  it('rejects files whose arrays do not match the map or are the wrong type', async () => {
    const sim = liveSim(24);
    const data = serialize(sim);
    // Terrain array of the wrong length.
    const shortTerrain = { ...data, terrain: data.terrain.slice(0, 100) };
    await expectRejected((await encodeSaveFile(shortTerrain)).bytes, /damaged.*map size/);
    // Creature positions stored as the wrong type.
    const c = { ...(data.creatures as object), x: new Uint8Array((data.creatures as { count: number }).count) };
    const badType = { ...data, creatures: c as unknown as SaveData['creatures'] };
    await expectRejected((await encodeSaveFile(badType)).bytes, /creature field x/);
    // Missing creature block.
    const noCreatures = { ...data, creatures: undefined as unknown as SaveData['creatures'] };
    await expectRejected((await encodeSaveFile(noCreatures)).bytes, /creature data/);
  });

  it('a rejected import leaves the running world untouched', async () => {
    const sim = liveSim(25);
    const before = sim.world.terrain.slice();
    const tick = sim.tick;
    const data = serialize(sim);
    const broken = { ...data, v4: { ...data.v4!, weather: undefined as unknown as NonNullable<SaveData['v4']>['weather'] } };
    const err = await decodeSaveFile((await encodeSaveFile(broken)).bytes).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SaveFileError);
    expect(sim.world.terrain).toEqual(before); // decode never touches a live simulation
    expect(sim.tick).toBe(tick);
    expect(sim.world.terrain.includes(T.GRASS)).toBe(true);
  });
});
