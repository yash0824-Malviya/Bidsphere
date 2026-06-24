import type { PaymentEntry } from "../types/erpnext";
import { todayIso } from "./format";

/** ERPNext Mode of Payment name — exact match required in API payloads. */
export type PaymentModeName = string;

/**
 * Payment modes that are not permitted in US B2B procurement / Accounts
 * Payable workflows. These are filtered out everywhere modes are listed,
 * even if they still exist as ERPNext Modes of Payment.
 */
export const EXCLUDED_PAYMENT_MODES: readonly string[] = ["Cash", "Credit Card"];

/** Fallback when Mode of Payment API is unavailable. */
export const FALLBACK_PAYMENT_MODES: readonly string[] = [
  "ACH Transfer",
  "Wire Transfer",
  "Debit Card",
  "Bank Draft",
  "Check",
];

/** Preferred display order; unknown ERPNext modes sort alphabetically after these. */
export const PREFERRED_PAYMENT_MODE_ORDER: readonly string[] = [
  "ACH Transfer",
  "Wire Transfer",
  "Debit Card",
  "Bank Draft",
  "Check",
];

/** User-friendly subtitles keyed by exact ERPNext mode name. */
export const PAYMENT_MODE_DESCRIPTIONS: Record<string, string> = {
  "ACH Transfer": "US Domestic Bank Transfer",
  "Wire Transfer": "International Bank Transfer",
  "Debit Card": "Business Debit Card",
  "Bank Draft": "Certified Bank Draft",
  Check: "Business Cheque Payment",
};

/**
 * Display labels for ERPNext mode names. The ERPNext Mode of Payment value
 * ("Check") is preserved in all API payloads; only the visible label differs
 * (US AP teams refer to it as "Cheque").
 */
export const PAYMENT_MODE_LABELS: Record<string, string> = {
  Check: "Cheque",
};

/** UI label for a payment mode (falls back to the raw ERPNext name). */
export function getPaymentModeLabel(mode?: string | null): string {
  if (!mode) return "";
  return PAYMENT_MODE_LABELS[mode] ?? mode;
}

export type UsPaymentUiStatus =
  | "Pending"
  | "Scheduled"
  | "Processing"
  | "Paid"
  | "Partial"
  | "Failed"
  | "Voided";

export const US_PAYMENT_STATUS_OPTIONS: Array<"" | UsPaymentUiStatus> = [
  "",
  "Pending",
  "Scheduled",
  "Processing",
  "Paid",
  "Partial",
  "Failed",
  "Voided",
];

export type PaymentMethodFieldType = "text" | "select" | "date" | "textarea";

export interface PaymentMethodFieldDef {
  key: string;
  label: string;
  type: PaymentMethodFieldType;
  placeholder?: string;
  required?: boolean;
  options?: string[];
  maxLength?: number;
  inputMode?: "text" | "numeric";
}

export type PaymentMethodDetails = Record<string, string>;

export interface StoredPaymentMeta {
  v: 1;
  /** Exact ERPNext Mode of Payment name. */
  method: PaymentModeName;
  details: PaymentMethodDetails;
  attachments?: string[];
  uiStatus?: UsPaymentUiStatus;
}

const REMARKS_PREFIX = "INTEVA_PAY:";

const REFERENCE_PREFIX: Record<string, string> = {
  "ACH Transfer": "PAY-ACH",
  "Wire Transfer": "PAY-WIRE",
  Check: "PAY-CHK",
  "Debit Card": "PAY-DC",
  "Bank Draft": "PAY-BD",
};

const CARD_TYPES = ["Visa", "Mastercard", "Amex"] as const;

const CARD_FIELDS: PaymentMethodFieldDef[] = [
  {
    key: "cardHolderName",
    label: "Card Holder Name",
    type: "text",
    required: true,
  },
  {
    key: "cardType",
    label: "Card Type",
    type: "select",
    required: true,
    options: [...CARD_TYPES],
  },
  {
    key: "last4Digits",
    label: "Last 4 Digits",
    type: "text",
    required: true,
    maxLength: 4,
    inputMode: "numeric",
  },
  {
    key: "authorizationCode",
    label: "Authorization Code",
    type: "text",
    placeholder: "Auth code from processor",
  },
];

const DEFAULT_PAYMENT_METHOD_FIELDS: PaymentMethodFieldDef[] = [
  {
    key: "referenceNumber",
    label: "Reference Number",
    type: "text",
    placeholder: "External reference",
  },
  { key: "notes", label: "Notes", type: "textarea" },
];

export const PAYMENT_METHOD_FIELDS: Record<string, PaymentMethodFieldDef[]> = {
  "ACH Transfer": [
    { key: "bankName", label: "Bank Name", type: "text", required: true },
    {
      key: "accountHolderName",
      label: "Account Holder Name",
      type: "text",
      required: true,
    },
    {
      key: "accountNumber",
      label: "Account Number",
      type: "text",
      required: true,
      inputMode: "numeric",
    },
    {
      key: "routingNumber",
      label: "Routing Number (ABA)",
      type: "text",
      required: true,
      placeholder: "9 digits",
      maxLength: 9,
      inputMode: "numeric",
    },
    {
      key: "achTraceNumber",
      label: "ACH Trace Number",
      type: "text",
      placeholder: "Optional trace ID",
    },
  ],
  "Wire Transfer": [
    { key: "bankName", label: "Bank Name", type: "text", required: true },
    {
      key: "accountHolderName",
      label: "Account Holder Name",
      type: "text",
      required: true,
    },
    {
      key: "accountNumber",
      label: "Account Number",
      type: "text",
      required: true,
      inputMode: "numeric",
    },
    {
      key: "routingNumber",
      label: "Routing Number",
      type: "text",
      placeholder: "ABA routing number",
      maxLength: 9,
      inputMode: "numeric",
    },
    {
      key: "swiftBic",
      label: "SWIFT/BIC Code",
      type: "text",
      required: true,
      placeholder: "e.g. CHASUS33",
    },
    {
      key: "wireReferenceNumber",
      label: "Wire Reference Number",
      type: "text",
      required: true,
    },
  ],
  Check: [
    {
      key: "checkNumber",
      label: "Cheque Number",
      type: "text",
      required: true,
      inputMode: "numeric",
    },
    { key: "checkDate", label: "Cheque Date", type: "date", required: true },
    { key: "issuingBank", label: "Issuing Bank", type: "text", required: true },
  ],
  "Debit Card": CARD_FIELDS,
  "Bank Draft": [
    { key: "bankName", label: "Bank Name", type: "text", required: true },
    {
      key: "draftNumber",
      label: "Draft Number",
      type: "text",
      required: true,
    },
    { key: "notes", label: "Notes", type: "textarea" },
  ],
};

export function sortPaymentModes(modes: string[]): string[] {
  const excluded = new Set(EXCLUDED_PAYMENT_MODES);
  const unique = [
    ...new Set(modes.filter((m) => Boolean(m) && !excluded.has(m))),
  ];
  return unique.sort((a, b) => {
    const ai = PREFERRED_PAYMENT_MODE_ORDER.indexOf(a);
    const bi = PREFERRED_PAYMENT_MODE_ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
}

export function getPaymentModeDescription(mode: string): string {
  return PAYMENT_MODE_DESCRIPTIONS[mode] ?? "";
}

export function getFieldsForPaymentMethod(
  method: string
): PaymentMethodFieldDef[] {
  return PAYMENT_METHOD_FIELDS[method] ?? DEFAULT_PAYMENT_METHOD_FIELDS;
}

export function getReferencePrefix(method: string): string {
  return REFERENCE_PREFIX[method] ?? "PAY-OTH";
}

/** Helper text for auto-generated payment reference format. */
export function getPaymentReferenceFormatHint(method: string): string {
  return `${getReferencePrefix(method)}-YYYYMMDD-0001`;
}

export function emptyDetailsForMethod(method: string): PaymentMethodDetails {
  const details: PaymentMethodDetails = {};
  for (const field of getFieldsForPaymentMethod(method)) {
    details[field.key] = "";
  }
  return details;
}

/** Map legacy / display names to exact ERPNext Mode of Payment names. */
export function normalizePaymentMethod(
  mode?: string | null,
  availableModes: string[] = [...FALLBACK_PAYMENT_MODES]
): string {
  const raw = (mode ?? "").trim();
  if (!raw) {
    return availableModes.includes("ACH Transfer")
      ? "ACH Transfer"
      : availableModes[0] ?? "ACH Transfer";
  }

  if (availableModes.includes(raw)) return raw;

  const lower = raw.toLowerCase();
  const legacyMap: Record<string, string> = {
    "check payment": "Check",
    cheque: "Check",
    "corporate debit card": "Debit Card",
    "bank transfer": "ACH Transfer",
    other: availableModes[0] ?? "ACH Transfer",
  };

  for (const [key, target] of Object.entries(legacyMap)) {
    if (lower === key && availableModes.includes(target)) return target;
  }

  if (lower.includes("ach") && availableModes.includes("ACH Transfer")) {
    return "ACH Transfer";
  }
  if (lower.includes("wire") && availableModes.includes("Wire Transfer")) {
    return "Wire Transfer";
  }
  if (
    (lower.includes("cheque") || lower.includes("check")) &&
    availableModes.includes("Check")
  ) {
    return "Check";
  }
  if (lower.includes("debit") && availableModes.includes("Debit Card")) {
    return "Debit Card";
  }
  if (lower.includes("draft") && availableModes.includes("Bank Draft")) {
    return "Bank Draft";
  }

  const fuzzy = availableModes.find(
    (m) => m.toLowerCase() === lower || lower.includes(m.toLowerCase())
  );
  if (fuzzy) return fuzzy;

  return availableModes.includes("ACH Transfer")
    ? "ACH Transfer"
    : availableModes[0] ?? raw;
}

export function generatePaymentReference(
  method: string,
  existingReferences: string[],
  dateIso = todayIso()
): string {
  const prefix = getReferencePrefix(method);
  const datePart = dateIso.replace(/-/g, "");
  const pattern = new RegExp(`^${prefix}-${datePart}-(\\d{4})$`);
  let maxSeq = 0;
  for (const ref of existingReferences) {
    const match = ref.match(pattern);
    if (match) maxSeq = Math.max(maxSeq, Number(match[1]));
  }
  const next = String(maxSeq + 1).padStart(4, "0");
  return `${prefix}-${datePart}-${next}`;
}

export function validatePaymentMethodDetails(
  method: string,
  details: PaymentMethodDetails
): string | null {
  const fields = getFieldsForPaymentMethod(method);

  for (const field of fields) {
    if (!field.required) continue;
    const value = (details[field.key] ?? "").trim();
    if (!value) return `${field.label} is required.`;
  }

  if (method === "ACH Transfer") {
    const routing = (details.routingNumber ?? "").replace(/\D/g, "");
    if (routing.length !== 9) {
      return "Routing Number must be 9 digits (ABA).";
    }
    if (!(details.accountNumber ?? "").trim()) {
      return "Account Number is required.";
    }
  }

  if (method === "Wire Transfer") {
    if (!(details.swiftBic ?? "").trim()) {
      return "SWIFT/BIC Code is required.";
    }
    if (!(details.wireReferenceNumber ?? "").trim()) {
      return "Wire Reference Number is required.";
    }
  }

  if (method === "Check") {
    if (!(details.checkNumber ?? "").trim()) {
      return "Cheque Number is required.";
    }
  }

  if (method === "Debit Card") {
    const last4 = (details.last4Digits ?? "").replace(/\D/g, "");
    if (last4.length !== 4) {
      return "Last 4 Digits must be exactly 4 numbers.";
    }
  }

  if (method === "Bank Draft") {
    if (!(details.draftNumber ?? "").trim()) {
      return "Draft Number is required.";
    }
  }

  return null;
}

export function serializePaymentMeta(meta: StoredPaymentMeta): string {
  return `${REMARKS_PREFIX}${JSON.stringify(meta)}`;
}

export function parsePaymentMeta(
  remarks?: string | null,
  availableModes: string[] = [...FALLBACK_PAYMENT_MODES]
): StoredPaymentMeta | null {
  if (!remarks?.includes(REMARKS_PREFIX)) return null;
  const jsonStart = remarks.indexOf(REMARKS_PREFIX) + REMARKS_PREFIX.length;
  const jsonPart = remarks.slice(jsonStart).split("\n")[0]?.trim();
  if (!jsonPart) return null;
  try {
    const parsed = JSON.parse(jsonPart) as StoredPaymentMeta;
    if (parsed?.v === 1 && parsed.method) {
      return {
        ...parsed,
        method: normalizePaymentMethod(parsed.method, availableModes),
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function buildPaymentRemarks(
  meta: StoredPaymentMeta,
  humanNote?: string
): string {
  const lines = [serializePaymentMeta(meta)];
  if (humanNote?.trim()) lines.push(humanNote.trim());
  return lines.join("\n");
}

export function mapUsPaymentUiStatus(
  payment: PaymentEntry,
  today = todayIso()
): UsPaymentUiStatus {
  const docstatus = payment.docstatus ?? 0;
  const meta = parsePaymentMeta(payment.remarks);

  if (meta?.uiStatus === "Failed") return "Failed";
  if (docstatus === 2 || payment.status === "Cancelled") return "Voided";

  const refs = payment.references ?? [];
  const isPartial = refs.some((r) => {
    const total = r.total_amount ?? 0;
    const alloc = r.allocated_amount ?? 0;
    return total > 0 && alloc + 0.01 < total;
  });

  if (docstatus === 1 || payment.status === "Submitted") {
    return isPartial ? "Partial" : "Paid";
  }

  const posting = payment.posting_date ?? "";
  if (posting > today) return "Scheduled";

  return "Pending";
}

export function collectExistingReferences(
  payments: PaymentEntry[]
): string[] {
  return payments
    .map((p) => p.reference_no)
    .filter((r): r is string => !!r);
}

/** @deprecated Use PaymentModeName — kept for gradual migration. */
export type UsPaymentMethod = PaymentModeName;
