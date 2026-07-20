/**
 * Server-side ERPNext date/datetime sanitizer (Vercel + Vite middleware).
 * Mirrors `src/utils/erpDate.ts` so every mutating proxy body is MariaDB-safe.
 */

import {
  formatERPNextDate,
  formatERPNextDatetime,
  sanitizePoShipmentDates,
} from "../src/utils/erpNextDate.js";

const ISO_LIKE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/i;
const ERP_DATETIME_SAFE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const ERP_DATE_SAFE = /^\d{4}-\d{2}-\d{2}$/;

const DATE_ONLY_FIELDS = new Set([
  "posting_date",
  "transaction_date",
  "schedule_date",
  "due_date",
  "bill_date",
  "reference_date",
  "expected_delivery_date",
  "required_by",
  "delivery_date",
  "payment_date",
  "valid_till",
  "from_date",
  "to_date",
  "start_date",
  "end_date",
  "date",
]);

const DATETIME_FIELDS = new Set([
  "supplier_acceptance_date",
  "rejected_date",
  "dispatch_date",
  "warehouse_signed_at",
  "warehouse_signature_timestamp",
  "warehouse_signature_time",
  "signed_at",
  "legal_signed_at",
  "esign_signed_on",
  "invoice_signed_at",
  "voucher_created_at",
  "payment_confirmed_at",
  "approved_on",
  "finance_approved_on",
  "submission_date",
  "submitted_at",
  "custom_submitted_at",
  "custom_legal_review_date",
  "custom_finance_review_date",
  "custom_forwarded_on",
  "custom_rfq_created_at",
  "scored_at",
  "response_date",
  "signed_on",
  "approved_date",
  "completed_date",
  "received_at",
  "accepted_date",
  "comment_date",
  "reviewed_at",
  "raised_at",
  "paid_at",
  "confirmed_at",
  "created_at",
  "updated_at",
]);

function looksLikeIsoDatetime(value: string): boolean {
  const v = value.trim();
  if (ERP_DATETIME_SAFE.test(v) || ERP_DATE_SAFE.test(v)) return false;
  return (
    ISO_LIKE.test(v) ||
    (v.includes("T") && /\d{4}-\d{2}-\d{2}T/.test(v)) ||
    /Z$/i.test(v) ||
    /\.\d{3}/.test(v)
  );
}

/** Deep-convert ISO-8601 strings in a request body before ERP insert/update. */
export function sanitizeErpPayloadDates<T>(input: T, keyHint = ""): T {
  if (input == null) return input;

  if (typeof input === "string") {
    if (!looksLikeIsoDatetime(input)) return input;
    if (DATE_ONLY_FIELDS.has(keyHint)) {
      return (formatERPNextDate(input) ??
        formatERPNextDatetime(input)?.slice(0, 10) ??
        input) as T;
    }
    return (formatERPNextDatetime(input) ?? input) as T;
  }

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeErpPayloadDates(item, keyHint)) as T;
  }

  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      // Already calendar YYYY-MM-DD — never run through Date/UTC (GRN posting_date).
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) {
        out[k] = v.trim();
        continue;
      }
      if (typeof v === "string" && looksLikeIsoDatetime(v)) {
        if (DATE_ONLY_FIELDS.has(k)) {
          out[k] =
            formatERPNextDate(v) ??
            formatERPNextDatetime(v)?.slice(0, 10) ??
            v;
        } else if (
          DATETIME_FIELDS.has(k) ||
          k.endsWith("_at") ||
          k.endsWith("_on") ||
          k.includes("timestamp") ||
          k.includes("signed")
        ) {
          out[k] = formatERPNextDatetime(v) ?? v;
        } else if (k.endsWith("_date") && !k.includes("time")) {
          out[k] =
            formatERPNextDate(v) ??
            formatERPNextDatetime(v)?.slice(0, 10) ??
            v;
        } else {
          out[k] = formatERPNextDatetime(v) ?? v;
        }
      } else {
        out[k] = sanitizeErpPayloadDates(v, k);
      }
    }
    return out as T;
  }

  return input;
}

export { sanitizePoShipmentDates, formatERPNextDate, formatERPNextDatetime };
