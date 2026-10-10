import { Simulation } from '../sim/simulation';
import { World } from '../world/world';
import { SAVE_VERSION, deserializeInto, type SaveData } from './serialize';

/**
 * Save files for export/import (share a world, back it up outside the browser).
 *
 * Layout: JSON `{ format, fileVersion, save }` where `save` is the same SaveData
 * the IndexedDB slots store, with every typed array written as
 * `{ "$t": "Float32Array", "b64": "…" }` (little-endian bytes, base64). The JSON
 * is gzip-compressed when the browser has CompressionStream; import accepts both
 * gzip and plain JSON. Older save versions (1–4) inside a file migrate on load
 * exactly like old slots do.
 */
export const FILE_FORMAT = 'alvoxis-world-save';
export const FILE_VERSION = 1;
/** Largest file accepted (compressed or not) and largest JSON text after decompression. */
export const MAX_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_JSON_BYTES = 256 * 1024 * 1024;
/** Same world size limit the generator enforces. */
export const MAX_SAVE_TILES = 4 * 1024 * 1024;
export const MAX_SAVE_SIDE = 4096;

const TYPED = {
  Uint8Array,
  Uint16Array,
  Uint32Array,
  Int32Array,
  Float32Array,
} as const;
type TypedName = keyof typeof TYPED;
type Typed = InstanceType<(typeof TYPED)[TypedName]>;

function typedName(v: unknown): TypedName | null {
  for (const k of Object.keys(TYPED) as TypedName[]) if (v instanceof TYPED[k]) return k;
  return null;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + STEP) as unknown as number[]);
  }
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** JSON-safe copy of a value: typed arrays become tagged base64 objects. */
function encode(v: unknown): unknown {
  const t = typedName(v);
  if (t) {
    const a = v as Typed;
    return { $t: t, b64: toBase64(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)) };
  }
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = encode(x);
    return out;
  }
  return v;
}

/** Inverse of encode(). Only the typed array kinds saves use are revived. */
function decode(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.$t === 'string') {
      const Ctor = TYPED[o.$t as TypedName];
      if (!Ctor || typeof o.b64 !== 'string') throw new SaveFileError(`Unknown data type ${String(o.$t).slice(0, 20)}`);
      const bytes = fromBase64(o.b64);
      if (bytes.length % Ctor.BYTES_PER_ELEMENT) throw new SaveFileError('Corrupt array data');
      // fromBase64 returns a fresh buffer of exactly these bytes (aligned at 0).
      return new Ctor(bytes.buffer as ArrayBuffer);
    }
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      out[k] = decode(x);
    }
    return out;
  }
  return v;
}

/** A problem with an imported file, worded for the player. */
export class SaveFileError extends Error {}

/** Serialized file contents (gzip when available) for a SaveData. */
export async function encodeSaveFile(data: SaveData): Promise<{ bytes: Uint8Array; gzip: boolean }> {
  const json = JSON.stringify({ format: FILE_FORMAT, fileVersion: FILE_VERSION, save: encode(data) });
  const raw = new TextEncoder().encode(json);
  if (typeof CompressionStream === 'undefined') return { bytes: raw, gzip: false };
  const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return { bytes: new Uint8Array(await new Response(stream).arrayBuffer()), gzip: true };
}

function isGzip(b: Uint8Array): boolean {
  return b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b;
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new SaveFileError('This browser cannot open compressed save files');
  }
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    const reader = stream.getReader();
    const parts: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_JSON_BYTES) {
        await reader.cancel();
        throw new SaveFileError('Save file is too large');
      }
      parts.push(value);
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  } catch (e) {
    if (e instanceof SaveFileError) throw e;
    throw new SaveFileError('Save file is damaged (could not decompress)');
  }
}

/** What an imported file contained, for the player. */
export interface ImportReport {
  data: SaveData;
  /** Save version inside the file (older ones are migrated on load). */
  version: number;
  migrated: boolean;
  width: number;
  height: number;
}

/**
 * Parses and validates a save file without touching the running game. Throws
 * SaveFileError with a readable message for anything malformed. A dry-run load
 * into a scratch simulation catches problems the shape checks cannot.
 */
export async function decodeSaveFile(input: Uint8Array): Promise<ImportReport> {
  if (input.length === 0) throw new SaveFileError('The file is empty');
  if (input.length > MAX_FILE_BYTES) throw new SaveFileError('Save file is too large');
  const bytes = isGzip(input) ? await gunzip(input) : input;
  if (bytes.length > MAX_JSON_BYTES) throw new SaveFileError('Save file is too large');
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new SaveFileError('This is not an ALVOXIS save file (not valid JSON)');
  }
  const root = parsed as { format?: unknown; fileVersion?: unknown; save?: unknown };
  if (!root || typeof root !== 'object' || root.format !== FILE_FORMAT) {
    throw new SaveFileError('This is not an ALVOXIS save file');
  }
  if (typeof root.fileVersion !== 'number' || root.fileVersion > FILE_VERSION) {
    throw new SaveFileError('This save file was made by a newer version of the game');
  }
  let data: SaveData;
  try {
    data = decode(root.save) as SaveData;
  } catch (e) {
    if (e instanceof SaveFileError) throw e;
    throw new SaveFileError('Save file is damaged (bad array data)');
  }
  validateShape(data);
  try {
    deserializeInto(new Simulation(new World(1, 1, 0)), data);
  } catch (e) {
    throw new SaveFileError(`Save file is damaged: ${e instanceof Error ? e.message : 'unknown error'}`);
  }
  return { data, version: data.version, migrated: data.version !== SAVE_VERSION, width: data.width, height: data.height };
}

function validateShape(d: SaveData): void {
  if (!d || typeof d !== 'object') throw new SaveFileError('Save file has no world');
  if (typeof d.version !== 'number' || !Number.isInteger(d.version) || d.version < 1) {
    throw new SaveFileError('Save file has no valid version');
  }
  if (d.version > SAVE_VERSION) throw new SaveFileError(`Save version ${d.version} is newer than this game supports (${SAVE_VERSION})`);
  const { width, height } = d;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new SaveFileError('Save file has an invalid map size');
  }
  if (width > MAX_SAVE_SIDE || height > MAX_SAVE_SIDE || width * height > MAX_SAVE_TILES) {
    throw new SaveFileError(`Map ${width}×${height} is larger than this game supports`);
  }
  for (const k of ['seed', 'tick', 'rngState'] as const) {
    if (typeof d[k] !== 'number' || !Number.isFinite(d[k])) throw new SaveFileError(`Save file is missing ${k}`);
  }
  if (d.tick < 0) throw new SaveFileError('Save file has a negative time');
  if (!Array.isArray(d.history)) throw new SaveFileError('Save file is missing its history');
  const c = d.creatures as { count?: unknown } | undefined;
  if (!c || typeof c !== 'object' || !Number.isInteger(c.count) || (c.count as number) < 0) {
    throw new SaveFileError('Save file has invalid creature data');
  }
  if (typeof d.savedAt !== 'string') d.savedAt = new Date(0).toISOString();
}

/** Suggested download name, e.g. alvoxis-y3-512x320-12345.alvoxis. */
export function saveFileName(data: SaveData, yearText: string): string {
  return `alvoxis-${yearText}-${data.width}x${data.height}-${data.seed}.alvoxis`;
}
