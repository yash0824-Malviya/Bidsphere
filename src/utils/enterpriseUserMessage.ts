/**
 * Convert any thrown value into safe, enterprise-facing copy for BidSphere UI.
 * Never surfaces ERPNext, DocType, SQL, stack traces, endpoints, or internal IDs
 * — except ERPNext *validation* messages, which must reach the user unchanged.
 */

const TECHNICAL_PATTERNS: RegExp[] = [
  /ERPNext/i,
  /\bDocType\b/i,
  /\bFrappe\b/i,
  /\bTraceback\b/i,
  /\bpymysql\b/i,
  /\bOperationalError\b/i,
  /\bDataError\b/i,
  /\bDoesNotExistError\b/i,
  /\bPermissionError\b/i,
  /\bValidationError\b/i,
  /\bUpdateAfterSubmitError\b/i,
  /\bServerScript\b/i,
  /\bRequest for Quotation\b/i,
  /\bMaterial Request\b/i,
  /\bPurchase Order\b/i,
  /\bPurchase Invoice\b/i,
  /\bPayment Entry\b/i,
  /Field not permitted/i,
  /\/api\//i,
  /\bSQL\b/i,
  /\bexception\b/i,
  /\bstack\s*trace\b/i,
  /\bAxiosError\b/i,
  /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNABORTED/i,
  /status code\s*\d+/i,
  /HTTP\s*\d{3}/i,
  /\bnull\b|\bundefined\b/i,
];

const NETWORK_PATTERNS: RegExp[] = [
  /network/i,
  /offline/i,
  /failed to fetch/i,
  /Network Error/i,
  /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNABORTED/i,
  /timeout/i,
  /ERR_NETWORK/i,
];

const NOT_FOUND_PATTERNS: RegExp[] = [
  /does not exist/i,
  /not found/i,
  /DoesNotExistError/i,
  /404/,
];

const PERMISSION_PATTERNS: RegExp[] = [
  /PermissionError/i,
  /insufficient permission/i,
  /do not have permission/i,
  /forbidden/i,
  /\b403\b/,
  /\b401\b/,
  /unauthorized/i,
  /AuthenticationError/i,
];

/** Schema / list-query field errors — not user permission failures. */
const FIELD_QUERY_PATTERN =
  /Field not permitted in query:\s*([A-Za-z0-9_]+)/i;

/** ERPNext business validation — must never become "Something went wrong". */
const ERP_VALIDATION_PATTERNS: RegExp[] = [
  /does not belong to company/i,
  /Selected warehouse belongs to another company/i,
  /Selected Cost Center belongs to another company/i,
  /Warehouse Company Mismatch/i,
  /Mandatory field/i,
  /is missing/i,
  /is required/i,
  /cannot be/i,
  /not allowed/i,
  /ValidationError/i,
  /MandatoryError/i,
  /LinkValidationError/i,
  /NegativeStockError/i,
  /Insufficient stock|Not enough stock/i,
  /Stock Entry/i,
  /Warehouse .+/i,
  /Item .+ does not exist/i,
  /Company mismatch/i,
  /Partial success/i,
  /Process (Selected|failed)/i,
  /Purchase MR/i,
  /Material Issue/i,
  /forward(ed)? to Procurement/i,
  /Unable to fetch stock availability/i,
  /Permission Error while reading stock/i,
];

export type EnterpriseErrorKind =
  | "document"
  | "network"
  | "timeout"
  | "empty"
  | "permission"
  | "generic";

export function extractRawErrorMessage(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error.trim();
  if (error instanceof Error) return error.message.trim();
  if (typeof error === "object" && "message" in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === "string") return m.trim();
  }
  return "";
}

/** Strip Frappe exception class / traceback noise; keep validation text. */
export function stripFrappeExceptionNoise(raw: string): string {
  let text = raw.replace(/<[^>]*>/g, "").trim();
  if (/Traceback \(most recent call last\)/i.test(text)) {
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const validationLine = [...lines]
      .reverse()
      .find((l) =>
        /ValidationError|MandatoryError|LinkValidationError|does not belong|Mandatory field/i.test(
          l,
        ),
      );
    text = validationLine || lines[lines.length - 1] || text;
  }
  return text
    .replace(/^frappe\.exceptions\.\w+:\s*/gi, "")
    .replace(
      /^(ValidationError|MandatoryError|LinkValidationError|PermissionError|DoesNotExistError|UniqueValidationError):\s*/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

export function isErpValidationUserMessage(raw: string): boolean {
  if (!raw) return false;
  if (/Traceback \(most recent call last\)/i.test(raw) && raw.length > 400) {
    // Only treat as validation if a clean line can be extracted.
    return Boolean(stripFrappeExceptionNoise(raw));
  }
  return ERP_VALIDATION_PATTERNS.some((re) => re.test(raw));
}

export function classifyEnterpriseError(error: unknown): EnterpriseErrorKind {
  const raw = extractRawErrorMessage(error);
  if (!raw) return "generic";
  // List-query field errors are schema issues, not RBAC permission denials.
  if (FIELD_QUERY_PATTERN.test(raw) || /Field not permitted in query/i.test(raw)) {
    return "document";
  }
  // ERP validation must not be classified as empty/permission noise.
  if (isErpValidationUserMessage(raw)) return "document";
  if (NETWORK_PATTERNS.some((re) => re.test(raw))) {
    if (/timeout|ETIMEDOUT|ECONNABORTED/i.test(raw)) return "timeout";
    return "network";
  }
  if (NOT_FOUND_PATTERNS.some((re) => re.test(raw))) return "empty";
  if (PERMISSION_PATTERNS.some((re) => re.test(raw))) return "permission";
  if (TECHNICAL_PATTERNS.some((re) => re.test(raw))) return "document";
  return "generic";
}

function looksTechnical(message: string): boolean {
  if (!message) return true;
  if (message.length > 180) return true;
  if (/\n/.test(message)) return true;
  return TECHNICAL_PATTERNS.some((re) => re.test(message));
}

/** Safe one-line message for toasts and inline copy. */
export function toEnterpriseUserMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  const kind = classifyEnterpriseError(error);
  const raw = extractRawErrorMessage(error);

  if (
    import.meta.env.DEV &&
    error != null &&
    (kind !== "generic" || looksTechnical(raw))
  ) {
    // eslint-disable-next-line no-console
    console.error("[BidSphere] Error (details for developers):", error);
  }

  // UpdateAfterSubmit — never show raw ERPNext exception text.
  if (
    /\bUpdateAfterSubmitError\b/i.test(raw) ||
    /Not allowed to change .+ after submission/i.test(raw)
  ) {
    return /warehouse\s*e-?sign|warehouse_/i.test(raw)
      ? "The GRN has already been finalized."
      : "This document has already been submitted and cannot be changed.";
  }

  // ── ERPNext validation — NEVER replace with the generic fallback ──
  if (isErpValidationUserMessage(raw)) {
    const cleaned = stripFrappeExceptionNoise(raw);
    if (cleaned && !/^Traceback/i.test(cleaned)) {
      return cleaned.length <= 320 ? cleaned : `${cleaned.slice(0, 317)}…`;
    }
  }

  if (kind === "network") {
    return "We're having trouble communicating with the server. Please try again.";
  }
  if (kind === "timeout") {
    return "This request is taking longer than expected. Please wait a moment and try again.";
  }
  if (kind === "empty") {
    // Keep actionable bid-history naming errors instead of the generic empty copy.
    if (/Reverse Bids|document name|bid history/i.test(raw)) {
      return looksTechnical(raw)
        ? "Could not save your bid. Please try again or contact your administrator."
        : raw;
    }
    // Preserve file upload / view / download failures — do not hide the real cause.
    if (
      /view failed|download failed|file upload|uploaded file|file proxy|file_url|attachment/i.test(
        raw,
      )
    ) {
      return raw.length <= 220 ? raw : raw.slice(0, 220);
    }
    // Preserve concrete ERP "X does not exist" lines (after noise strip).
    const cleanedEmpty = stripFrappeExceptionNoise(raw);
    if (
      cleanedEmpty &&
      cleanedEmpty.length <= 280 &&
      /does not exist|not found/i.test(cleanedEmpty) &&
      !/Traceback|pymysql|DocType/i.test(cleanedEmpty)
    ) {
      return cleanedEmpty;
    }
    return "This document hasn't been created yet or is not available.";
  }
  if (kind === "permission") {
    return "You may not have permission to access this information.";
  }

  // Surface the real field-query error — do not remap to a permission toast.
  const fieldMatch = raw.match(FIELD_QUERY_PATTERN);
  if (fieldMatch) {
    return `Field not permitted in query: ${fieldMatch[1]}`;
  }
  if (/Field not permitted in query/i.test(raw)) {
    const cleaned = stripFrappeExceptionNoise(raw);
    if (cleaned && cleaned.length <= 180) return cleaned;
  }

  // BOM upload column diagnostics are intentionally multi-line and user-facing.
  if (
    /^Missing required columns/i.test(raw) &&
    /Detected Columns:/i.test(raw)
  ) {
    return raw;
  }

  // Prefer cleaned Frappe text over generic when it looks like a short validation.
  const cleaned = stripFrappeExceptionNoise(raw);
  if (
    cleaned &&
    cleaned.length <= 280 &&
    !/Traceback|pymysql|stack\s*trace|ECONNREFUSED|status code/i.test(cleaned) &&
    !looksTechnical(cleaned)
  ) {
    return cleaned;
  }

  if (!raw || looksTechnical(raw)) return fallback;

  // Allow short, already-friendly validation messages (no infra leakage).
  return raw;
}

export const ENTERPRISE_COPY = {
  documentTitle: "Unable to load this document",
  documentBody:
    "The requested information is temporarily unavailable.",
  documentReasons: [
    "The document is still processing.",
    "You may not have permission to access it.",
    "The document may have been moved or archived.",
  ],
  networkTitle: "Connection Lost",
  networkBody: "We're having trouble communicating with the server.",
  timeoutTitle: "Still Working...",
  timeoutBody:
    "This request is taking longer than expected. Please wait a few moments.",
  emptyTitle: "No document available",
  emptyBody:
    "This document hasn't been created yet or is not available.",
  loadingPrimary: "Loading document...",
  loadingSecondary:
    "Please wait while we securely retrieve your information.",
} as const;
