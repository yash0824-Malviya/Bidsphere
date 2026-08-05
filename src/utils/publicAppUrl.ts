/**
 * Public absolute origin for QR codes / shareable verification links.
 *
 * Resolution order (no hardcoded IPs):
 *   1. Active non-loopback `window.location.origin` (current deployment host)
 *   2. Env: VITE_PUBLIC_URL | VITE_APP_BASE_URL | VITE_SITE_URL | VITE_APP_URL
 *   3. Loopback `window.location.origin` (dev-only fallback — phones will fail)
 *
 * Prefer the browser's active host so QRs track the deployment you are using,
 * while still allowing env to supply a LAN/public URL when the UI is opened
 * via localhost.
 */

function normalizeOrigin(raw: string | undefined | null): string | null {
  const value = String(raw || "").trim().replace(/\/+$/, "");
  if (!value) return null;
  try {
    const url = new URL(value.includes("://") ? value : `http://${value}`);
    return url.origin;
  } catch {
    return null;
  }
}

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "0.0.0.0" ||
    h.endsWith(".localhost")
  );
}

function hostnameOf(origin: string): string | null {
  try {
    return new URL(origin).hostname;
  } catch {
    return null;
  }
}

/** Configured public site origin from env (no trailing slash). */
export function getConfiguredPublicOrigin(): string | null {
  const env = import.meta.env as Record<string, string | undefined>;
  return (
    normalizeOrigin(env.VITE_PUBLIC_URL) ||
    normalizeOrigin(env.VITE_APP_BASE_URL) ||
    normalizeOrigin(env.VITE_SITE_URL) ||
    normalizeOrigin(env.VITE_APP_URL) ||
    null
  );
}

/**
 * Absolute origin for QR / external verification links.
 * Never hardcodes a server IP — uses env + active browser origin only.
 */
export function getPublicAppOrigin(): string {
  const runtime =
    typeof window !== "undefined"
      ? normalizeOrigin(window.location.origin)
      : null;
  const runtimeHost = runtime ? hostnameOf(runtime) : null;
  const runtimeIsPublic = Boolean(
    runtime && runtimeHost && !isLoopbackHost(runtimeHost),
  );

  // Active deployment the user is currently browsing (reachable LAN/public host).
  if (runtimeIsPublic && runtime) {
    return runtime;
  }

  // Dev on localhost: use configured base URL so phones can reach the host.
  const configured = getConfiguredPublicOrigin();
  if (configured) return configured;

  return runtime || "";
}

/** Join public origin + path (path must start with `/`). */
export function buildPublicAppUrl(path: string): string {
  const origin = getPublicAppOrigin();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (!origin) return normalizedPath;
  return `${origin}${normalizedPath}`;
}

/** True when the QR base URL is still a loopback host (phones will fail). */
export function isPublicAppOriginLoopback(): boolean {
  const origin = getPublicAppOrigin();
  if (!origin) return true;
  const host = hostnameOf(origin);
  return !host || isLoopbackHost(host);
}

/**
 * Lightweight reachability check for the verification SPA route.
 * Used before relying on QR codes — does not change verification business logic.
 */
export async function probeVerificationServiceAvailable(
  timeoutMs = 4_000,
): Promise<boolean> {
  const origin = getPublicAppOrigin();
  if (!origin || isPublicAppOriginLoopback()) return false;

  const url = `${origin}/verify/material-issue`;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    // no-cors: success means the host answered (opaque response). CORS would
    // falsely fail when probing a LAN origin from a localhost browser session.
    await fetch(url, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
      credentials: "omit",
      mode: "no-cors",
    });
    return true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}
