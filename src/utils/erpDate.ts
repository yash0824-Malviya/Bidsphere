/**
 * Canonical ERPNext date/datetime helpers for BidSphere.
 *
 * MariaDB / Frappe reject ISO-8601 (`2026-07-16T18:18:42.331Z`) on Date/Datetime
 * columns (OperationalError 1292). Always convert before any ERP write.
 *
 *   Date     → YYYY-MM-DD
 *   Datetime → YYYY-MM-DD HH:mm:ss
 */
export {
  ERP_NEXT_DATE_FORMAT,
  ERP_NEXT_DATETIME_FORMAT,
  ERP_NEXT_DATETIME_RE,
  ERP_NEXT_ISO_DATE_RE,
  assertERPNextDate,
  assertERPNextDatetime,
  formatERPNextDate,
  formatERPNextDatetime,
  nowERPNextDatetime,
  sanitizePoShipmentDates,
  todayERPNextDate,
  buildGrnPayload,
  buildPurchaseOrderPayload,
  buildPaymentEntryPayload,
  buildPurchaseInvoicePayload,
} from "./erpNextDate";

import {
  assertERPNextDate,
  assertERPNextDatetime,
  formatERPNextDate,
  formatERPNextDatetime,
  nowERPNextDatetime,
} from "./erpNextDate";

/** Date field → `YYYY-MM-DD`. Throws if the value cannot be normalized. */
export function toERPDate(
  value: string | Date | null | undefined,
  fieldName = "date",
): string {
  return assertERPNextDate(value, fieldName);
}

/** Datetime field → `YYYY-MM-DD HH:mm:ss`. Throws if invalid. */
export function toERPDateTime(
  value: string | Date | null | undefined,
  fieldName = "datetime",
): string {
  return assertERPNextDatetime(value, fieldName);
}

/** Best-effort Date (null if unparseable). */
export function tryERPDate(
  value: string | Date | null | undefined,
): string | null {
  return formatERPNextDate(value);
}

/** Best-effort Datetime (null if unparseable). */
export function tryERPDateTime(
  value: string | Date | null | undefined,
): string | null {
  return formatERPNextDatetime(value);
}

/** Current server/browser time in ERP Datetime format (never ISO-8601). */
export function nowERPDateTime(): string {
  return nowERPNextDatetime();
}

const ISO_LIKE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/i;
const ERP_DATETIME_SAFE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const ERP_DATE_SAFE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Known ERPNext Date fieldnames — force `YYYY-MM-DD`.
 * Anything else that looks like ISO datetime becomes Datetime.
 */
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
  "warehouse_signed_on",
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
  // NOTE: never list `modified` / `creation` here — see PASSTHROUGH below.
  "timestamp",
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

/**
 * Frappe optimistic-lock stamps. Must be echoed byte-for-byte on PUT.
 * Rewriting fractional seconds (e.g. `.331567` → stripped) causes
 * TimestampMismatchError: "Document has been modified after you opened it."
 */
const PASSTHROUGH_LOCK_FIELDS = new Set(["modified", "creation"]);

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

/**
 * Deep-sanitize a JSON-serializable payload for ERPNext.
 * Converts ISO-8601 strings on known date/datetime keys (and any ISO-looking
 * string values) before they reach MariaDB.
 */
export function sanitizeErpPayloadDates<T>(input: T, keyHint = ""): T {
  if (input == null) return input;

  if (typeof input === "string") {
    // Never rewrite Frappe lock stamps even when passed as a bare string.
    if (PASSTHROUGH_LOCK_FIELDS.has(keyHint)) return input;
    if (!looksLikeIsoDatetime(input)) return input;
    const asDateOnly =
      DATE_ONLY_FIELDS.has(keyHint) ||
      (keyHint.endsWith("_date") &&
        !DATETIME_FIELDS.has(keyHint) &&
        !keyHint.includes("time") &&
        !keyHint.includes("signed") &&
        !keyHint.includes("accepted") &&
        !keyHint.includes("confirmed"));
    if (asDateOnly) {
      return (tryERPDate(input) ??
        tryERPDateTime(input)?.slice(0, 10) ??
        input) as T;
    }
    return (tryERPDateTime(input) ?? input) as T;
  }

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeErpPayloadDates(item, keyHint)) as T;
  }

  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      // Optimistic-lock / audit stamps — never rewrite (including fractional seconds).
      if (PASSTHROUGH_LOCK_FIELDS.has(k)) {
        out[k] = v;
        continue;
      }
      if (typeof v === "string" && looksLikeIsoDatetime(v)) {
        if (DATE_ONLY_FIELDS.has(k)) {
          // ISO datetimes are common for Date fields — take calendar day.
          out[k] =
            tryERPDate(v) ?? tryERPDateTime(v)?.slice(0, 10) ?? v;
        } else if (
          DATETIME_FIELDS.has(k) ||
          k.endsWith("_at") ||
          k.endsWith("_on") ||
          k.includes("timestamp") ||
          k.includes("signed")
        ) {
          out[k] = tryERPDateTime(v) ?? v;
        } else if (k.endsWith("_date") && !k.includes("time")) {
          // Prefer Date for *_date unless known Datetime field.
          out[k] =
            tryERPDate(v) ?? tryERPDateTime(v)?.slice(0, 10) ?? v;
        } else {
          out[k] = tryERPDateTime(v) ?? v;
        }
      } else {
        out[k] = sanitizeErpPayloadDates(v, k);
      }
    }
    return out as T;
  }

  return input;
}
