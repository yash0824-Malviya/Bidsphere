/**
 * Client-side BidSphere access token storage + helpers for RBAC.
 *
 * Internal staff tokens are issued by `/api/auth/login`.
 * Supplier portal tokens are issued by portal-login / legacy-pin-token /
 * portal-access-token.
 *
 * Supplier tokens use a dedicated key so Finance/internal logout does not
 * wipe an active Supplier Portal session (shared `bidsphere-access-token`
 * previously caused Create Invoice to fail with "Not authenticated").
 */

const ACCESS_TOKEN_KEY = "bidsphere-access-token";
const ACCESS_TOKEN_REMEMBER_KEY = "bidsphere-access-token-remember";
const SUPPLIER_ACCESS_TOKEN_KEY = "bidsphere-supplier-access-token";

export function writeAccessToken(token: string, rememberMe = false): void {
  if (typeof window === "undefined") return;
  const value = String(token || "").trim();
  if (!value) {
    clearAccessToken();
    return;
  }
  sessionStorage.setItem(ACCESS_TOKEN_KEY, value);
  if (rememberMe) {
    localStorage.setItem(ACCESS_TOKEN_REMEMBER_KEY, value);
  } else {
    localStorage.removeItem(ACCESS_TOKEN_REMEMBER_KEY);
  }
}

export function readAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return (
    sessionStorage.getItem(ACCESS_TOKEN_KEY) ||
    localStorage.getItem(ACCESS_TOKEN_REMEMBER_KEY) ||
    null
  );
}

/**
 * Token for ERP proxy / payables RBAC (`X-Bidsphere-Access-Token`).
 *
 * Prefer the shared/internal key; fall back to the supplier-dedicated JWT.
 * Finance logout clears only the shared key — without this fallback, Supplier
 * Portal mutations (e.g. mark voucher viewed) send no principal → 401 → login.
 */
export function readErpProxyAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  const shared = readAccessToken();
  if (shared) return shared;
  const dedicated = sessionStorage.getItem(SUPPLIER_ACCESS_TOKEN_KEY);
  return dedicated?.trim() || null;
}

export function clearAccessToken(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(ACCESS_TOKEN_REMEMBER_KEY);
}

/** Supplier Portal JWT — isolated from internal staff token storage. */
export function writeSupplierAccessToken(token: string): void {
  if (typeof window === "undefined") return;
  const value = String(token || "").trim();
  if (!value) {
    clearSupplierAccessToken();
    return;
  }
  sessionStorage.setItem(SUPPLIER_ACCESS_TOKEN_KEY, value);
  // Mirror into the shared key so ERP proxy mutations from the portal
  // still attach a BidSphere principal when needed.
  writeAccessToken(value, false);
}

export function readSupplierAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return (
    sessionStorage.getItem(SUPPLIER_ACCESS_TOKEN_KEY) ||
    // Backward-compatible: sessions that only wrote the shared key.
    readAccessToken()
  );
}

export function clearSupplierAccessToken(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(SUPPLIER_ACCESS_TOKEN_KEY);
}

/** Restore remembered token into the tab session on boot. */
export function hydrateAccessTokenFromRemember(): void {
  if (typeof window === "undefined") return;
  if (sessionStorage.getItem(ACCESS_TOKEN_KEY)) return;
  const remembered = localStorage.getItem(ACCESS_TOKEN_REMEMBER_KEY);
  if (remembered) sessionStorage.setItem(ACCESS_TOKEN_KEY, remembered);
}
