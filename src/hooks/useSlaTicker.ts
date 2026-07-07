import { useSyncExternalStore } from "react";

/**
 * A single shared clock for all SLA countdowns. One `setInterval` (30s) drives
 * every subscribed badge/widget via `useSyncExternalStore`, instead of each
 * component running its own per-second timer. SLA displays use minute
 * granularity ("02h 18m" / "1d 05h"), so a 30s tick is smooth and cheap.
 */
const TICK_MS = 30_000;

let now = Date.now();
const listeners = new Set<() => void>();
let intervalId: number | null = null;

function ensureRunning() {
  if (intervalId != null) return;
  intervalId = window.setInterval(() => {
    now = Date.now();
    for (const l of listeners) l();
  }, TICK_MS);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  ensureRunning();
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && intervalId != null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
  };
}

function getSnapshot(): number {
  return now;
}

/** Current shared clock (epoch ms), updated every 30s. */
export function useSlaNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot);
}
