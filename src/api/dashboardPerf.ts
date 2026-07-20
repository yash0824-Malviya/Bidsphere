/**
 * Dev-only timing helpers for Procurement Dashboard performance audits.
 * Logs: start → finish → duration for every labeled API.
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

/** Time an async API and print start / finish / duration. */
export async function timedDashApi<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!dashPerfEnabled()) return fn();
  const start = performance.now();
  console.log(`${PREFIX} API started: ${label}`, { t: Math.round(start) });
  try {
    const result = await fn();
    const ms = Math.round(performance.now() - start);
    console.log(`${PREFIX} API finished: ${label}`, {
      t: Math.round(performance.now()),
      durationMs: ms,
    });
    return result;
  } catch (err) {
    const ms = Math.round(performance.now() - start);
    console.warn(`${PREFIX} API failed: ${label}`, {
      t: Math.round(performance.now()),
      durationMs: ms,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
