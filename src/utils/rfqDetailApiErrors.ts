/**
 * RFQ Detail page — isolated error handling for background widgets.
 * Logs structured failures to the console; never triggers global toasts.
 */
import { useEffect, useRef } from "react";

import { extractErpNextErrorMessage } from "../api/erpnext";
import {
  classifyApiError,
  logFailedApiRequest,
  userMessageForApiCategory,
} from "./apiReliability";
import {
  extractRawErrorMessage,
  toEnterpriseUserMessage,
} from "./enterpriseUserMessage";

export type RfqDetailWidget =
  | "rfq-core"
  | "quote-rounds"
  | "supplier-quotes"
  | "supplier-declines"
  | "legal-review"
  | "linked-pos"
  | "ai-recommendation"
  | "budget-check"
  | "procurement-status"
  | "reverse-bidding";

export interface RfqDetailRequestMeta {
  url?: string;
  method?: string;
  payload?: unknown;
  responseStatus?: number | null;
  responseBody?: unknown;
}

const loggedFailureKeys = new Set<string>();

function extractAttachedResponse(error: unknown): {
  status: number | null;
  body: unknown;
} {
  if (!error || typeof error !== "object") {
    return { status: null, body: null };
  }
  const e = error as {
    response?: { status?: number; data?: unknown };
    status?: number;
    responseBody?: unknown;
  };
  return {
    status: e.response?.status ?? e.status ?? null,
    body: e.response?.data ?? e.responseBody ?? null,
  };
}

/** Resolve a user-facing message while preserving backend validation text. */
export function resolveApiErrorMessage(
  error: unknown,
  fallback?: string,
): string {
  const attached = extractAttachedResponse(error);
  if (attached.body) {
    const erp = extractErpNextErrorMessage(attached.body);
    if (erp?.trim()) {
      return toEnterpriseUserMessage(erp, fallback);
    }
    if (typeof attached.body === "object" && attached.body !== null) {
      const record = attached.body as { message?: string; error?: string };
      const apiMsg = record.message?.trim() || record.error?.trim();
      if (apiMsg) {
        return toEnterpriseUserMessage(apiMsg, fallback);
      }
    }
  }

  const raw = extractRawErrorMessage(error);
  const requestFailed = raw.match(/^Request failed \((\d{3})\)$/i);
  if (requestFailed) {
    const code = requestFailed[1];
    if (code === "401" || code === "403") {
      return "You may not have permission to access this information.";
    }
    if (code === "404") {
      return "This document hasn't been created yet or is not available.";
    }
    return `The server returned an error (${code}). Please try again in a moment.`;
  }

  return toEnterpriseUserMessage(
    error,
    fallback ?? userMessageForApiCategory(classifyApiError(error)),
  );
}

/** Log a background widget failure once per unique error signature. */
export function logRfqDetailApiFailure(
  widget: RfqDetailWidget,
  error: unknown,
  meta: RfqDetailRequestMeta = {},
): void {
  const attached = extractAttachedResponse(error);
  const signature = [
    widget,
    meta.method ?? "",
    meta.url ?? "",
    extractRawErrorMessage(error),
    attached.status ?? "",
  ].join("|");

  if (loggedFailureKeys.has(signature)) return;
  loggedFailureKeys.add(signature);

  const entry = logFailedApiRequest(error, { context: `RFQDetail:${widget}` });

  // eslint-disable-next-line no-console
  console.error(`[RFQ Detail · ${widget}]`, {
    requestUrl: meta.url ?? entry.url,
    httpMethod: meta.method ?? entry.method,
    requestPayload: meta.payload ?? null,
    responseStatus: meta.responseStatus ?? attached.status ?? entry.httpStatus,
    responseBody: meta.responseBody ?? attached.body ?? entry.responseBody,
    message: resolveApiErrorMessage(error),
    stackTrace: error instanceof Error ? error.stack ?? null : entry.stackTrace,
  });
}

export function rfqWidgetErrorMessage(
  widget: RfqDetailWidget,
  error: unknown,
): string {
  void widget;
  return resolveApiErrorMessage(error);
}

/** Log background query failures without showing a global toast. */
export function useRfqBackgroundQueryError(
  widget: RfqDetailWidget,
  isError: boolean,
  error: unknown,
  meta?: RfqDetailRequestMeta,
): string | null {
  const lastSignature = useRef<string | null>(null);

  useEffect(() => {
    if (!isError || !error) return;
    const signature = `${widget}:${extractRawErrorMessage(error)}`;
    if (lastSignature.current === signature) return;
    lastSignature.current = signature;
    logRfqDetailApiFailure(widget, error, meta);
  }, [widget, isError, error, meta]);

  if (!isError || !error) return null;
  return rfqWidgetErrorMessage(widget, error);
}

/** Clear dedupe keys — for tests only. */
export function resetRfqDetailErrorDedupeForTests(): void {
  loggedFailureKeys.clear();
}
