/**
 * Frappe/ERPNext error sanitizer.
 *
 * ERPNext surfaces failures as raw Python exceptions — e.g.
 * `frappe.exceptions.ValidationError: BidSphere Status cannot be "…"` — often
 * with a full traceback. Those must NEVER reach the user. This helper logs the
 * complete exception (so it's captured in the browser/server console) and
 * returns a clean, human-readable `Error` for the toast.
 */

/** True when the error looks like a raw Frappe/Python backend exception. */
export function isFrappeBackendError(err: unknown): boolean {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return /ValidationError|frappe\.exceptions|PermissionError|LinkValidationError|Traceback \(most recent call last\)|pymysql|MandatoryError/i.test(
    raw,
  );
}

/**
 * Log the full exception and return a user-safe Error.
 *
 * - Raw Frappe/Python exceptions → replaced with `userMessage`.
 * - Anything else (network errors, already-clean messages) → passed through.
 */
export function sanitizeFrappeError(
  err: unknown,
  userMessage = "Something went wrong. Please try again.",
  context?: string,
): Error {
  console.error(`[Frappe error]${context ? ` ${context}` : ""}`, err);

  if (isFrappeBackendError(err)) {
    return new Error(userMessage);
  }
  if (err instanceof Error) return err;
  return new Error(userMessage);
}
