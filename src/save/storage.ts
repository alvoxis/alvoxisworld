import type { SaveData } from './serialize';

const DB_NAME = 'alvoxis-world-evolution';
const STORE = 'saves';
export const SLOTS = ['slot1', 'slot2', 'slot3'] as const;
export type SlotId = (typeof SLOTS)[number];

/**
 * IndexedDB save slots. IndexedDB stores typed arrays natively and has far more
 * room than localStorage (needed for large worlds), and works in mobile Safari.
 */
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser has no IndexedDB (private mode?)'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open save database'));
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? new Error('Save database error'));
      tx.onabort = () => reject(tx.error ?? new Error('Save cancelled (storage full?)'));
    });
  } finally {
    db.close();
  }
}

export function saveToSlot(slot: SlotId, data: SaveData): Promise<IDBValidKey> {
  return run('readwrite', (s) => s.put(data, slot));
}

export function loadFromSlot(slot: SlotId): Promise<SaveData | undefined> {
  return run<SaveData | undefined>('readonly', (s) => s.get(slot) as IDBRequest<SaveData | undefined>);
}

export function deleteSlot(slot: SlotId): Promise<undefined> {
  return run('readwrite', (s) => s.delete(slot));
}

export interface SlotSummary {
  slot: SlotId;
  savedAt: string;
  width: number;
  height: number;
  seed: number;
  tick: number;
}

export async function listSlots(): Promise<Array<SlotSummary | null>> {
  const out: Array<SlotSummary | null> = [];
  for (const slot of SLOTS) {
    const d = await loadFromSlot(slot);
    out.push(d ? { slot, savedAt: d.savedAt, width: d.width, height: d.height, seed: d.seed, tick: d.tick } : null);
  }
  return out;
}
