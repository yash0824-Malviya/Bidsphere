/**
 * Dev-only timing helpers for Procurement Dashboard performance audits.
 * Logs: start → finish → duration for every labeled API.
 * Also emits console.time / console.timeEnd for Chrome Performance tooling.
 */

const PREFIX = "[Dashboard Perf]";

export function dashPerfEnabled(): boolean {
  return import.meta.env.DEV;
}

export function dashPerfLog(message: string, extra?: Record<string, unknown>): void {
  if (!dashPerfEnabled()) return;
  if (extra) {
    console.log(`${PREFIX} ${message}`, { t: Math.round(performance.now()), ...extra });
  } else {
    console.log(`${PREFIX} ${message}`, { t: Math.round(performance.now()) });
  }
}

/** console.time wrapper — no-op outside DEV. */
export function dashTime(label: string): void {
  if (!dashPerfEnabled()) return;
  console.time(`${PREFIX} ${label}`);
}

export function dashTimeEnd(label: string): void {
  if (!dashPerfEnabled()) return;
  console.timeEnd(`${PREFIX} ${label}`);
}

/** Time an async API and print start / finish / duration. */
export async function timedDashApi<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!dashPerfEnabled()) return fn();
  const start = performance.now();
  console.log(`${PREFIX} API started: ${label}`, { t: Math.round(start) });
  console.time(`${PREFIX} ${label}`);
  try {
    const result = await fn();
    const ms = Math.round(performance.now() - start);
    console.timeEnd(`${PREFIX} ${label}`);
    console.log(`${PREFIX} API finished: ${label}`, {
      t: Math.round(performance.now()),
      durationMs: ms,
    });
    return result;
  } catch (err) {
    const ms = Math.round(performance.now() - start);
    console.timeEnd(`${PREFIX} ${label}`);
    console.warn(`${PREFIX} API failed: ${label}`, {
      t: Math.round(performance.now()),
      durationMs: ms,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
