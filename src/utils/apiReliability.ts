/**
 * Shared API reliability helpers — retries, classification, and structured logging.
 * Used by axios (erpnext), fetch wrappers, and React Query defaults.
 */
import type { AxiosError } from "axios";

import { isPermissionDeniedError } from "./permissionError";

/** Default axios / fetch timeout for ERP-backed requests. */
export const API_TIMEOUT_MS = 30_000;

/** Maximum automatic retries after the initial attempt (network / timeout only). */
export const MAX_NETWORK_RETRIES = 2;

export type ApiErrorCategory =
  | "network"
  | "timeout"
  | "authentication"
  | "validation"
  | "server"
  | "not_found"
  | "unknown";

export interface FailedApiRequestLog {
  url: string;
  method: string;
  httpStatus: number | null;
  category: ApiErrorCategory;
  responseBody: unknown;
  message: string;
  stackTrace: string | null;
  retryCount?: number;
  context?: string;
}

function axiosError(error: unknown): AxiosError | null {
  if (!error || typeof error !== "object") return null;
  if ("isAxiosError" in error && (error as AxiosError).isAxiosError) {
    return error as AxiosError;
  }
  return null;
}

function isDocNotFoundErrorLocal(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const ax = error as AxiosError & { _isDocNotFound?: boolean };
  if (ax._isDocNotFound) return true;
  const status = ax.response?.status;
  const excType = (ax.response?.data as { exc_type?: string } | undefined)
    ?.exc_type;
  return status === 404 || excType === "DoesNotExistError";
}

/** True for transient network / gateway failures that may succeed on retry. */
export function isRetryableNetworkError(error: unknown): boolean {
  if (isDocNotFoundErrorLocal(error) || isPermissionDeniedError(error)) {
    return false;
  }

  const ax = axiosError(error);
  if (!ax) {
    const msg = error instanceof Error ? error.message : String(error ?? "");
    if (/timeout|ETIMEDOUT|ECONNABORTED|network|failed to fetch/i.test(msg)) {
      return true;
    }
    return false;
  }

  const status = ax.response?.status;
  const excType = (ax.response?.data as { exc_type?: string } | undefined)
    ?.exc_type;

  if (
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 409 ||
    status === 417 ||
    status === 422
  ) {
    return false;
  }
  if (excType === "ValidationError" || excType === "MandatoryError") {
    return false;
  }
  if (status && status >= 400 && status < 500) return false;

  if (status === 502 || status === 503 || status === 504) return true;
  if (status && status >= 500) return true;

  const code = ax.code ?? "";
  const msg = (ax.message ?? "").toLowerCase();
  if (code === "ECONNABORTED" || /timeout/.test(msg)) return true;
  if (code === "ERR_NETWORK" || msg === "network error") return true;
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET/i.test(code)) return true;

  return false;
}

/** Classify an API failure for user messaging and logging. */
export function classifyApiError(error: unknown): ApiErrorCategory {
  if (isDocNotFoundErrorLocal(error)) return "not_found";
  if (isPermissionDeniedError(error)) return "authentication";

  const ax = axiosError(error);
  const status = ax?.response?.status;
  const excType = (ax?.response?.data as { exc_type?: string } | undefined)
    ?.exc_type;
  const msg = error instanceof Error ? error.message : String(error ?? "");

  if (
    status === 400 ||
    status === 417 ||
    status === 422 ||
    excType === "ValidationError" ||
    excType === "MandatoryError" ||
    excType === "LinkValidationError"
  ) {
    return "validation";
  }
  if (status === 401 || status === 403) return "authentication";
  if (status === 404) return "not_found";
  if (status && status >= 500) return "server";

  if (/timeout|ETIMEDOUT|ECONNABORTED/i.test(msg) || ax?.code === "ECONNABORTED") {
    return "timeout";
  }
  if (
    /network|failed to fetch|ERR_NETWORK|ECONNREFUSED|ENOTFOUND/i.test(msg) ||
    ax?.code === "ERR_NETWORK"
  ) {
    return "network";
  }
  if (status === 502 || status === 503 || status === 504) return "network";

  return "unknown";
}

/** User-facing copy keyed by error category (never "Something went wrong"). */
export function userMessageForApiCategory(
  category: ApiErrorCategory,
): string {
  switch (category) {
    case "network":
      return "We're having trouble communicating with the server. Please check your connection and try again.";
    case "timeout":
      return "This request is taking longer than expected. Please wait a moment and try again.";
    case "authentication":
      return "You may not have permission to access this information.";
    case "validation":
      return "Please review the entered information and try again.";
    case "server":
      return "The server encountered an error. Please try again in a moment.";
    case "not_found":
      return "This document hasn't been created yet or is not available.";
    default:
      return "We couldn't complete this action. Please try again.";
  }
}

function resolveRequestUrl(error: unknown): string {
  const ax = axiosError(error);
  if (ax?.config) {
    return `${ax.config.baseURL ?? ""}${ax.config.url ?? ""}`;
  }
  return "unknown";
}

function resolveRequestMethod(error: unknown): string {
  const ax = axiosError(error);
  return (ax?.config?.method ?? "GET").toUpperCase();
}

function resolveResponseBody(error: unknown): unknown {
  const ax = axiosError(error);
  if (ax?.response?.data !== undefined) return ax.response.data;
  if (error instanceof Error) return { message: error.message };
  return error;
}

/** Structured console log for every terminal API failure. */
export function logFailedApiRequest(
  error: unknown,
  options: { context?: string; retryCount?: number } = {},
): FailedApiRequestLog {
  const category = classifyApiError(error);
  const ax = axiosError(error);
  const entry: FailedApiRequestLog = {
    url: resolveRequestUrl(error),
    method: resolveRequestMethod(error),
    httpStatus: ax?.response?.status ?? null,
    category,
    responseBody: resolveResponseBody(error),
    message: error instanceof Error ? error.message : String(error ?? ""),
    stackTrace: error instanceof Error ? error.stack ?? null : null,
    retryCount: options.retryCount,
    context: options.context,
  };

  // eslint-disable-next-line no-console
  console.error("[API Request Failed]", entry);
  return entry;
}

/** React Query retry — up to 2 retries for network / timeout only. */
export function queryRetryPolicy(failureCount: number, error: unknown): boolean {
  if (isDocNotFoundErrorLocal(error) || isPermissionDeniedError(error)) {
    return false;
  }
  if (!isRetryableNetworkError(error)) return false;
  return failureCount < MAX_NETWORK_RETRIES;
}

/** Backoff: 1s, 2s, capped at 4s. */
export function queryRetryDelay(attemptIndex: number): number {
  return Math.min(1000 * (attemptIndex + 1), 4000);
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
