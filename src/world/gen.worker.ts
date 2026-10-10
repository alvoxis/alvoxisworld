/// <reference lib="webworker" />
import { computeWorld, genTransferables, type GenRequest } from './genjobs';

/** World-generation worker: runs the deterministic generator off the main thread. */
const ctx = self as unknown as DedicatedWorkerGlobalScope;
ctx.onmessage = (ev: MessageEvent<GenRequest>) => {
  const res = computeWorld(ev.data);
  ctx.postMessage(res, genTransferables(res));
};
