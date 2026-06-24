import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, RotateCw } from "lucide-react";
import erpnext from "../api/erpnext";

type Status = "checking" | "online" | "offline";

const PING_INTERVAL_MS = 30_000;
const PING_TIMEOUT_MS = 3_000;

/** Only developers see backend diagnostics; end users never do. */
const IS_DEV = import.meta.env.DEV;

/**
 * App-wide backend connection heartbeat.
 *
 * Pings a lightweight resource every 30 seconds. While the upstream is
 * reachable the component renders nothing.
 *
 * On failure:
 *   - **Production:** a clean, neutral notice with no infrastructure details
 *     (no "ERPNext", "bench", URLs, or stack traces).
 *   - **Development:** the original diagnostic banner with a Retry button.
 */
export default function ConnectionStatus() {
  const [status, setStatus] = useState<Status>("checking");
  const inFlightRef = useRef(false);

  async function checkConnection() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      await erpnext.get("/api/resource/Supplier", {
        params: {
          limit_page_length: 1,
          fields: JSON.stringify(["name"]),
        },
        timeout: PING_TIMEOUT_MS,
        _silent: true,
      } as Parameters<typeof erpnext.get>[1]);
      setStatus("online");
    } catch {
      setStatus("offline");
    } finally {
      inFlightRef.current = false;
    }
  }

  useEffect(() => {
    void checkConnection();
    const id = window.setInterval(() => void checkConnection(), PING_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  function handleRetry() {
    setStatus("checking");
    void checkConnection();
  }

  if (status === "online" || status === "checking") return null;

  // ── Production: clean, professional, infrastructure-free notice ──────────
  if (!IS_DEV) {
    return (
      <div className="flex items-center justify-center gap-2 border-b border-neutral-200 bg-neutral-50 px-6 py-2 text-sm text-neutral-600">
        <span className="min-w-0 truncate">
          Unable to load data at the moment. Please check your connection and try
          again.
        </span>
      </div>
    );
  }

  // ── Offline notice (same user-friendly message in all environments) ──────
  return (
    <div className="flex items-center gap-2 border-b border-warning-300 bg-warning-50 px-6 py-2 text-sm text-warning-800">
      <AlertTriangle className="h-4 w-4 flex-shrink-0 text-warning-600" />
      <span className="min-w-0 flex-1 truncate">
        Unable to load data at the moment. Please check your connection and try
        again.
      </span>
      <button
        type="button"
        onClick={handleRetry}
        disabled={inFlightRef.current}
        className="inline-flex items-center gap-1 rounded-md bg-warning-600 px-3 py-1 text-xs font-semibold text-white shadow-sm hover:bg-warning-700 disabled:opacity-60"
      >
        {inFlightRef.current ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <RotateCw className="h-3 w-3" />
        )}
        Retry
      </button>
    </div>
  );
}
