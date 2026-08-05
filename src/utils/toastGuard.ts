/**
 * Global toast guard — suppresses permission noise and sanitizes any
 * technical backend messages that local `toast.error(err.message)` handlers
 * would otherwise show to end users.
 */

import toast from "react-hot-toast";

import { isPermissionDeniedMessage } from "./permissionError";
import { resolveApiErrorMessage } from "./rfqDetailApiErrors";

let installed = false;

/**
 * Patch `toast.error` once at app boot. Safe to call multiple times.
 */
export function installPermissionToastGuard(): void {
  if (installed) return;
  installed = true;

  const originalError = toast.error.bind(toast);

  toast.error = ((message, ...rest) => {
    const text =
      typeof message === "string"
        ? message
        : message instanceof Error
          ? message.message
          : "";

    if (text && isPermissionDeniedMessage(text)) {
      // eslint-disable-next-line no-console
      console.warn("Permission denied:", text);
      return "";
    }

    const safe =
      typeof message === "string"
        ? resolveApiErrorMessage(message)
        : resolveApiErrorMessage(message);

    if (
      typeof message === "string" &&
      safe !== message &&
      import.meta.env.DEV
    ) {
      // eslint-disable-next-line no-console
      console.error("[toast.error] Sanitized technical message:", message);
    } else if (
      message instanceof Error &&
      safe !== message.message &&
      import.meta.env.DEV
    ) {
      // eslint-disable-next-line no-console
      console.error("[toast.error] Sanitized technical message:", message);
    }

    return originalError(safe, ...rest);
  }) as typeof toast.error;
}
