/**
 * Frappe/ERPNext error sanitizer.
 *
 * ERPNext surfaces failures as raw Python exceptions — e.g.
 * `frappe.exceptions.ValidationError: Warehouse Stores - B does not belong to company Netlink`.
 * We strip the exception class / traceback noise and keep the real validation
 * text for toasts. Never replace ERPNext validation with a generic message.
 */

import {
  extractRawErrorMessage,
  isErpValidationUserMessage,
  stripFrappeExceptionNoise,
  toEnterpriseUserMessage,
} from "./enterpriseUserMessage";

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
 * - ERPNext validation → cleaned validation text (never generic)
 * - Raw traceback with no extractable message → `userMessage`
 * - Already-clean errors → passed through
 */
export function sanitizeFrappeError(
  err: unknown,
  userMessage?: string,
  context?: string,
): Error {
  console.error(`[Frappe error]${context ? ` ${context}` : ""}`, err);

  const raw = extractRawErrorMessage(err);
  if (raw && isErpValidationUserMessage(raw)) {
    const cleaned = stripFrappeExceptionNoise(raw);
    if (cleaned) return new Error(cleaned);
  }

  if (isFrappeBackendError(err)) {
    const cleaned = stripFrappeExceptionNoise(raw);
    if (
      cleaned &&
      cleaned.length <= 320 &&
      !/^Traceback/i.test(cleaned) &&
      !/pymysql|stack\s*trace/i.test(cleaned)
    ) {
      return new Error(cleaned);
    }
    return new Error(toEnterpriseUserMessage(err, userMessage));
  }
  if (err instanceof Error) return err;
  return new Error(toEnterpriseUserMessage(err, userMessage));
}
