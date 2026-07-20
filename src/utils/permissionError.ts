/**
 * Shared detectors for auth/permission failures that must not interrupt the UI.
 */

import type { AxiosError } from "axios";

/** Message shapes that must never become user-facing toasts. */
export function isPermissionDeniedMessage(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  // Keep login-specific 403 copy toastable ("Access denied. Your account…").
  if (/may not have permission to log in/i.test(text)) return false;

  return (
    /PermissionError/i.test(text) ||
    /Permission denied/i.test(text) ||
    /Insufficient Permission/i.test(text) ||
    /don't have permission to (view this page|perform this action)/i.test(
      text,
    ) ||
    /\b401 Unauthorized\b/i.test(text) ||
    /\b403 Forbidden\b/i.test(text) ||
    /^Unauthorized$/i.test(text) ||
    /^Forbidden$/i.test(text)
  );
}

/**
 * True for auth/permission failures (HTTP 401/403 or Frappe PermissionError).
 */
export function isPermissionDeniedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const ax = error as AxiosError<{
    message?: string;
    exception?: string;
    exc?: string;
    exc_type?: string;
    error?: string;
  }> & { _permissionDenied?: boolean };

  if (ax._permissionDenied === true) return true;

  const status = ax.response?.status;
  if (status === 401 || status === 403) return true;

  const data = ax.response?.data;
  const excType = String(data?.exc_type ?? "");
  if (/PermissionError/i.test(excType)) return true;

  const haystack = [
    ax.message,
    typeof data?.message === "string" ? data.message : "",
    typeof data?.exception === "string" ? data.exception : "",
    typeof data?.exc === "string" ? data.exc : "",
    typeof data?.error === "string" ? data.error : "",
  ]
    .filter(Boolean)
    .join(" ");

  return isPermissionDeniedMessage(haystack);
}
