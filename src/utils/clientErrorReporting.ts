/**
 * Client-side error reporting for React Error Boundaries and unexpected failures.
 * Always logs to the console; best-effort forward to a monitoring endpoint when configured.
 */

export type ClientErrorReport = {
  errorId: string;
  error: Error;
  componentStack?: string | null;
  source: string;
  url: string;
  userAgent: string;
  timestamp: string;
};

declare global {
  interface Window {
    /** Optional monitoring bridge (Sentry, Datadog RUM, custom collector, etc.). */
    __BIDS_PHERE_MONITOR__?: {
      captureException?: (error: Error, context?: Record<string, unknown>) => void;
    };
  }
}

export function createErrorId(): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `ERR-${Date.now().toString(36).toUpperCase()}-${rand.toUpperCase()}`;
}

export function reportClientError(
  error: Error,
  opts?: {
    errorId?: string;
    componentStack?: string | null;
    source?: string;
  },
): ClientErrorReport {
  const report: ClientErrorReport = {
    errorId: opts?.errorId || createErrorId(),
    error,
    componentStack: opts?.componentStack ?? null,
    source: opts?.source || "client",
    url: typeof window !== "undefined" ? window.location.href : "",
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    timestamp: new Date().toISOString(),
  };

  // eslint-disable-next-line no-console
  console.error("[client-error]", report.errorId, error, {
    componentStack: report.componentStack,
    source: report.source,
    url: report.url,
    timestamp: report.timestamp,
  });

  try {
    window.__BIDS_PHERE_MONITOR__?.captureException?.(error, {
      errorId: report.errorId,
      componentStack: report.componentStack,
      source: report.source,
      url: report.url,
      timestamp: report.timestamp,
    });
  } catch {
    /* monitoring must never break the fallback UI */
  }

  const endpoint = String(import.meta.env.VITE_ERROR_REPORTING_URL || "").trim();
  if (endpoint && typeof fetch === "function") {
    void fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        errorId: report.errorId,
        name: error.name,
        message: error.message,
        stack: error.stack,
        componentStack: report.componentStack,
        source: report.source,
        url: report.url,
        userAgent: report.userAgent,
        timestamp: report.timestamp,
      }),
      keepalive: true,
    }).catch(() => {
      /* best-effort */
    });
  }

  return report;
}
