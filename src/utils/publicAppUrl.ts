/**
 * Public absolute origin for QR codes / shareable links.
 *
 * Priority (required):
 *   1. VITE_PUBLIC_URL — always wins when set (LAN IP or production domain)
 *   2. window.location.origin — fallback only
 *
 * Never hardcode localhost. Phones resolve localhost to themselves.
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

/** Configured public site origin from env (no trailing slash). */
export function getConfiguredPublicOrigin(): string | null {
  const env = import.meta.env as Record<string, string | undefined>;
  return (
    normalizeOrigin(env.VITE_PUBLIC_URL) ||
    normalizeOrigin(env.VITE_SITE_URL) ||
    normalizeOrigin(env.VITE_APP_URL) ||
    null
  );
}

/**
 * Absolute origin for QR / external verification links.
 * VITE_PUBLIC_URL is always preferred when present.
 */
export function getPublicAppOrigin(): string {
  const configured = getConfiguredPublicOrigin();
  if (configured) return configured;

  if (typeof window !== "undefined") {
    return normalizeOrigin(window.location.origin) || window.location.origin;
  }
  return "";
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
  try {
    return isLoopbackHost(new URL(origin).hostname);
  } catch {
    return true;
  }
}
