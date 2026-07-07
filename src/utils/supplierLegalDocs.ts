import type { SupplierQuotation } from "../types/erpnext";
import type { LegalDocumentSet } from "../api/legalDocs";

/**
 * Single source of truth for the supplier legal-document workflow.
 *
 * Suppliers upload their legal documents at quote time — the URLs are stored
 * on the **Supplier Quotation** custom fields (ERPNext). When Procurement
 * later selects that quotation as the RFQ winner, a **Legal Document Review**
 * record is created and the URLs are copied onto it for the legal team.
 *
 * Because of that, the presence of legal documents (and therefore the button
 * label / detail section) must be derived from BOTH stores — the SQ custom
 * fields (always available) and the Legal Document Review record (only after
 * winner selection). This module centralises that resolution so the Supplier
 * Portal and Procurement Portal never drift out of sync.
 */

export type LegalDocKey =
  | "terms"
  | "warranty"
  | "insurance"
  | "compliance"
  | "other";

export interface LegalDocTypeConfig {
  key: LegalDocKey;
  label: string;
  icon: string;
  /** Possible Supplier Quotation custom fieldnames holding the file URL. */
  sqUrlFields: string[];
  /** Supplier Quotation custom fieldname holding the note. */
  sqNoteField?: string;
  /** Legal Document Review URL field (post-winner copy). */
  ldrUrlField?: keyof LegalDocumentSet;
  /** Legal Document Review note field. */
  ldrNoteField?: keyof LegalDocumentSet;
  /**
   * Core documents always render an upload slot in the supplier UI even when
   * empty; non-core (compliance / other) only render when a file exists.
   */
  core: boolean;
}

/**
 * NOTE: the ERPNext fieldnames below are exact — `custom_terms__condition`
 * has a double underscore and `custom_warenty_certificate` preserves the
 * upstream "warenty" typo. Do not "fix" them or the writes silently no-op.
 */
export const LEGAL_DOC_TYPES: LegalDocTypeConfig[] = [
  {
    key: "terms",
    label: "Terms & Conditions",
    icon: "📄",
    sqUrlFields: ["custom_terms__condition", "custom_terms_condition"],
    sqNoteField: "custom_terms_note",
    ldrUrlField: "terms_file_url",
    ldrNoteField: "terms_note",
    core: true,
  },
  {
    key: "warranty",
    label: "Warranty Certificate",
    icon: "🛡️",
    sqUrlFields: ["custom_warenty_certificate", "custom_warranty_certificate"],
    sqNoteField: "custom_warranty_note",
    ldrUrlField: "warranty_file_url",
    ldrNoteField: "warranty_note",
    core: true,
  },
  {
    key: "insurance",
    label: "Insurance Certificate",
    icon: "🏥",
    sqUrlFields: ["custom_insurance_certificate"],
    sqNoteField: "custom_insurance_note",
    ldrUrlField: "insurance_file_url",
    ldrNoteField: "insurance_note",
    core: true,
  },
  {
    key: "compliance",
    label: "Compliance Certificate",
    icon: "✅",
    sqUrlFields: ["custom_compliance_certificate", "custom_compliance"],
    sqNoteField: "custom_compliance_note",
    core: false,
  },
  {
    key: "other",
    label: "Other Legal Document",
    icon: "📑",
    sqUrlFields: ["custom_other_document", "custom_other_legal_document"],
    sqNoteField: "custom_other_note",
    core: false,
  },
];

export interface ResolvedLegalDoc {
  key: LegalDocKey;
  label: string;
  icon: string;
  /** Relative ERPNext file URL (e.g. `/private/files/x.pdf`) or "". */
  url: string;
  note: string;
  fileName: string;
  /** Best-effort upload date (ISO string) or null. */
  uploadDate: string | null;
  hasFile: boolean;
  /** The primary Supplier Quotation fieldname to write updates back to. */
  sqUrlField: string;
  sqNoteField?: string;
  core: boolean;
}

function readString(
  source: Record<string, unknown> | null | undefined,
  field: string | undefined
): string {
  if (!source || !field) return "";
  const value = source[field];
  return typeof value === "string" ? value.trim() : "";
}

/** Derive a human file name from an ERPNext file URL. */
export function legalDocFileName(url: string, explicit?: string): string {
  if (explicit && explicit.trim()) return explicit.trim();
  if (!url) return "";
  try {
    const path = /^https?:\/\//i.test(url) ? new URL(url).pathname : url;
    const last = path.split("/").filter(Boolean).pop() ?? "";
    return decodeURIComponent(last) || "document.pdf";
  } catch {
    return url.split("/").filter(Boolean).pop() ?? "document.pdf";
  }
}

/**
 * Resolve the unified list of legal documents for a quotation. URLs from the
 * Legal Document Review record (post-winner) take precedence over the raw
 * Supplier Quotation fields; notes fall back the same way.
 */
export function resolveSupplierLegalDocs(
  sq: SupplierQuotation | null | undefined,
  review?: LegalDocumentSet | null
): ResolvedLegalDoc[] {
  const sqRec = sq as Record<string, unknown> | null | undefined;
  const ldrRec = review as unknown as Record<string, unknown> | null | undefined;

  return LEGAL_DOC_TYPES.map((cfg) => {
    const sqUrl =
      cfg.sqUrlFields.map((f) => readString(sqRec, f)).find(Boolean) ?? "";
    const ldrUrl = readString(ldrRec, cfg.ldrUrlField as string | undefined);
    const url = ldrUrl || sqUrl;

    const sqNote = readString(sqRec, cfg.sqNoteField);
    const ldrNote = readString(ldrRec, cfg.ldrNoteField as string | undefined);
    const note = ldrNote || sqNote;

    const uploadDate =
      (ldrUrl && (review?.modified ?? null)) ||
      (sqUrl && (sq?.modified ?? sq?.transaction_date ?? null)) ||
      null;

    return {
      key: cfg.key,
      label: cfg.label,
      icon: cfg.icon,
      url,
      note,
      fileName: legalDocFileName(url),
      uploadDate: uploadDate || null,
      hasFile: !!url,
      sqUrlField: cfg.sqUrlFields[0],
      sqNoteField: cfg.sqNoteField,
      core: cfg.core,
    };
  });
}

/** True when the supplier has uploaded at least one legal document. */
export function hasAnyLegalDoc(
  sq: SupplierQuotation | null | undefined,
  review?: LegalDocumentSet | null
): boolean {
  return resolveSupplierLegalDocs(sq, review).some((d) => d.hasFile);
}

/** True only when every CORE legal document has been uploaded. */
export function hasAllCoreLegalDocs(
  sq: SupplierQuotation | null | undefined,
  review?: LegalDocumentSet | null
): boolean {
  const docs = resolveSupplierLegalDocs(sq, review);
  const core = docs.filter((d) => d.core);
  return core.length > 0 && core.every((d) => d.hasFile);
}

export type LegalReviewUiStatus =
  | "Pending Review"
  | "Under Review"
  | "Approved"
  | "Rejected";

/**
 * Map the raw Legal Document Review verdict onto the four supplier-facing
 * statuses. Returns `null` when no review record exists yet (i.e. the
 * quotation has not been selected as the winning supplier).
 *
 *   - Pending + nothing viewed  → "Pending Review"
 *   - Pending + a doc viewed     → "Under Review"
 *   - Approved / Rejected        → as-is
 */
export function resolveLegalReviewUiStatus(
  review: LegalDocumentSet | null | undefined
): LegalReviewUiStatus | null {
  if (!review) return null;
  if (review.review_status === "Approved") return "Approved";
  if (review.review_status === "Rejected") return "Rejected";

  const started =
    review.terms_viewed === 1 ||
    review.warranty_viewed === 1 ||
    review.insurance_viewed === 1;
  return started ? "Under Review" : "Pending Review";
}

/**
 * A quotation is considered "selected as winner" (and therefore its legal
 * documents are locked from replacement) once a Legal Document Review record
 * exists for it — that record is only ever created on winner selection.
 */
export function isSelectedAsWinner(
  review: LegalDocumentSet | null | undefined
): boolean {
  return !!review;
}
