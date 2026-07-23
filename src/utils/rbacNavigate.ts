/**
 * Shared helpers for RBAC route redirects (no UI chrome changes).
 */

import { canAccessPath, getRoleHome, type AppRole } from "../config/roles";

export const ACCESS_DENIED_MESSAGE =
  "Access denied. You don't have permission to view this page.";

/**
 * Log a route-level RBAC denial. Never toast — redirects already move the
 * user to a safe home; a toast on every blocked URL is noisy in production.
 */
export function notifyAccessDenied(path?: string): void {
  // eslint-disable-next-line no-console
  console.warn("Permission denied:", path || ACCESS_DENIED_MESSAGE);
}

/**
 * Pick a safe post-login destination: prefer `requested` only when the role
 * may access it; otherwise fall back to the role home dashboard.
 */
export function safeInternalDestination(
  role: AppRole,
  requested: string | null | undefined,
): string {
  const raw = requested || "";
  const path = raw.split("?")[0];
  const search = raw.includes("?") ? raw.slice(raw.indexOf("?")) : "";
  if (path && canAccessPath(role, path, search)) {
    return search ? `${path}${search}` : path;
  }
  return getRoleHome(role);
}
