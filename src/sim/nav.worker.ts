/// <reference lib="webworker" />
import { computeNav, navTransferables, type NavRequest } from './navjobs';

/** Navigation worker: computes the water field and region graph for a terrain snapshot. */
const ctx = self as unknown as DedicatedWorkerGlobalScope;
ctx.onmessage = (ev: MessageEvent<NavRequest>) => {
  const res = computeNav(ev.data);
  ctx.postMessage(res, navTransferables(res));
};
