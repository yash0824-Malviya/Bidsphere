/**
 * Legal Review e-sign — per-document envelopes in a v2 bundle so Terms /
 * Warranty / Insurance each keep their own overlay signature + audit trail.
 */

import { formatERPNextDatetime } from "../utils/erpNextDate";
import {
  DEFAULT_SIGNATURE_FONT_ID,
  type LegalSignatureFontId,
} from "./legalSignatureFonts";

export type LegalEsignRole =
  | "legal"
  | "procurement"
  | "finance"
  | "supplier"
  | "ceo";

export type LegalDocKey = "terms" | "warranty" | "insurance";

export const LEGAL_DOC_KEYS: LegalDocKey[] = ["terms", "warranty", "insurance"];
export const LEGAL_CHECKPOINT_IDS = ["rfq_terms", "sq_terms", "supplier_docs", "nda_confidentiality", "compliance_declarations", "regulatory_requirements", "commercial_exceptions", "contractual_requirements"];

export function isFinanceApproved(review: {
  finance_status?: string; custom_finance_status?: string;
} | null | undefined): boolean {
  const fs = String(review?.finance_status || "").trim();
  if (fs === "Approved" || fs === "Budget Approved") return true;
  const cfs = String(review?.custom_finance_status || "").trim();
  return cfs === "Approved" || cfs === "Budget Approved";
}

export function isLegalApproved(review: {
  review_status?: string; custom_legal_status?: string;
} | null | undefined): boolean {
  const rs = String(review?.review_status || "").trim();
  if (rs === "Approved") return true;
  const cls = String(review?.custom_legal_status || "").trim();
  return cls === "Approved";
}

/** Server-enriched RFQ review; supports existing ERP rows without a requirement field. */
export interface RfqLegalSignatureReview {
  required_document_keys?: LegalDocKey[];
  review_status?: string;
  finance_status?: string;
  custom_finance_status?: string;
  custom_legal_status?: string;
  workflow_state?: string;
  current_owner?: string;
  status?: string;
  docstatus?: number;
  terms_file_url?: string;
  warranty_file_url?: string;
  insurance_file_url?: string;
  terms_approved?: number | boolean;
  warranty_approved?: number | boolean;
  insurance_approved?: number | boolean;
  esign_envelope?: string;
}

export type LegalDocumentIntegrityStatus = "Verified" | "Failed" | "Unavailable";
export interface LegalDocumentIntegrityResult {
  documentKey: LegalDocKey;
  status: LegalDocumentIntegrityStatus;
  documentHash?: string;
  signedFileHash?: string;
  message?: string;
}

export function getRequiredLegalDocumentKeys(review: RfqLegalSignatureReview | null | undefined): LegalDocKey[] {
  const keys = review?.required_document_keys;
  // The deployed ERP schema has no separate mandatory-document configuration.
  // Its existing policy is the review's populated legal attachment slots. An
  // explicit server list, including an empty list, always overrides this legacy policy.
  if (keys === undefined) return LEGAL_DOC_KEYS.filter(key => {
    const fileUrl = review?.[`${key}_file_url`];
    return typeof fileUrl === "string" && fileUrl.trim().length > 0;
  });
  if (!Array.isArray(keys) || keys.some(key => !LEGAL_DOC_KEYS.includes(key))) return [];
  return [...new Set(keys)];
}

export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

/** A checkbox alone is not a verified current PDF. The receipt comes from ERP. */
export function isLegalDocumentVerified(review: RfqLegalSignatureReview | null | undefined, key: LegalDocKey): boolean {
  if (!review || !(review[`${key}_approved`] === 1 || review[`${key}_approved`] === true)) return false;
  const bundle = parseEsignBundle(review.esign_envelope);
  const env = bundle.documents[key];
  return Boolean(review[`${key}_file_url`] && env?.viewedAt && env.viewedBy && env.sourceFileId &&
    env.sourceFileUrl === review[`${key}_file_url`] && isSha256Hex(env.documentHash) &&
    (!env.approvedHash || env.approvedHash === env.documentHash));
}

export function areRequiredDocumentsVerified(review: RfqLegalSignatureReview | null | undefined): boolean {
  const keys = getRequiredLegalDocumentKeys(review);
  return keys.length > 0 && keys.every(key => isLegalDocumentVerified(review, key));
}

/** RFQ signing precedes both Finance approval and completion of the Legal stage. */
export function canStartLegalSignature(review: RfqLegalSignatureReview | null | undefined, key?: LegalDocKey): boolean {
  if (!review) return false;
  const terminal = /^(rejected|cancelled|canceled|closed|completed|po created)$/i;
  if ([review.review_status, review.workflow_state, review.status].some(value => terminal.test(String(value || "").trim())) || review.docstatus === 2) return false;
  if (review.review_status !== "Pending" || review.current_owner === "Procurement") return false;
  if (!["Pending Review", "Legal Review", "Pending Signature", "Ready for Signature"].includes(String(review.workflow_state || "").trim())) return false;
  if (!areRequiredDocumentsVerified(review)) return false;
  const bundle = parseEsignBundle(review.esign_envelope);
  const keys = getRequiredLegalDocumentKeys(review);
  const unsigned = (documentKey: LegalDocKey) => {
    const env = bundle.documents[documentKey];
    return !hasLegalSignature(env) && !env?.locked && !env?.signatureRequest?.completedAt;
  };
  return key ? keys.includes(key) && unsigned(key) : keys.some(unsigned);
}

/** Every required PDF needs persisted source-bound execution, independently of Finance. */
export function isLegalReviewExecuted(review: RfqLegalSignatureReview | null | undefined): boolean {
  if (!review || !areRequiredDocumentsVerified(review)) return false;
  const bundle = parseEsignBundle(review.esign_envelope);
  const keys = getRequiredLegalDocumentKeys(review);
  return keys.length > 0 && keys.every(key => {
    const env = bundle.documents[key];
    return !!env?.signatureRequest?.completedAt && !!env.signedFileUrl && isSha256Hex(env.signedFileHash) &&
      env.signatureRequest.sourceHash === env.documentHash && env.signatureRequest.sourceFileId === env.sourceFileId &&
      hasLegalSignature(env);
  });
}

/** Compatibility action only; successful final signature normally sends RFQ to Finance. */
export function canFinalLegalApprove(review: RfqLegalSignatureReview | null | undefined): boolean {
  return Boolean(review && review.review_status === "Pending" && isLegalReviewExecuted(review));
}

export type LegalEsignSignatureStatus = "pending" | "signed" | "locked";

export type LegalEsignEnvelopeStatus =
  | "unsigned"
  | "signed"
  | "locked"
  | "rejected";

export interface LegalEsignPlacement {
  /** 1-based page index */
  page: number;
  /** Normalized X (0–1) of box center — top-left origin for Y */
  xNorm: number;
  /** Normalized Y (0–1) of box center — top origin */
  yNorm: number;
  /** Normalized box width (0–1 of page width) */
  widthNorm: number;
  /** Normalized box height (0–1 of page height) */
  heightNorm: number;
}

export interface LegalEsignSignature {
  id: string;
  sequence: number;
  role: LegalEsignRole;
  reviewerName: string;
  reviewerId: string;
  typedName: string;
  fontId: LegalSignatureFontId;
  signedAt: string;
  placement: LegalEsignPlacement;
  status: LegalEsignSignatureStatus;
}

export type LegalEsignAuditAction =
  | "document_opened"
  | "review_started"
  | "signature_created"
  | "signature_added"
  | "signature_deleted"
  | "signature_replaced"
  | "approval_completed"
  | "document_rejected"
  | "changes_requested"
  | "version_changed"
  | "signature_initiated"
  | "finance_decision"
  | "integrity_failed";

export interface LegalEsignAuditEntry {
  id: string;
  action: LegalEsignAuditAction;
  user: string;
  userId?: string;
  at: string;
  detail?: string;
}

/** Per-document e-sign state (overlay signatures live here). */
export interface LegalEsignEnvelope {
  schemaVersion: 1;
  documentKey: LegalDocKey;
  documentName: string;
  documentNumber: string;
  documentVersion: string;
  documentHash: string;
  signedFileHash?: string;
  signedFileUrl?: string;
  signedFileId?: string;
  /** Typed PDF electronic signature, not a certificate/private-key digital signature. */
  signatureMethod?: "typed_pdf";
  signatures: LegalEsignSignature[];
  auditTrail: LegalEsignAuditEntry[];
  status: LegalEsignEnvelopeStatus;
  locked: boolean;
  approvalStatus?: "Pending" | "Approved" | "Rejected";
  approvalTimestamp?: string;
  reviewStartedAt?: string;
  /** Server-verified source and review receipt; legacy flags are not evidence. */
  sourceFileId?: string;
  sourceFileUrl?: string;
  viewedBy?: string;
  viewedAt?: string;
  approvedHash?: string;
  approvedFileId?: string;
  approvedBy?: string;
  signatureRequest?: {
    id: string;
    sourceHash: string;
    sourceFileId: string;
    signerId: string;
    startedAt: string;
    completedAt?: string;
    /** Persisted reservation prevents concurrent workers creating duplicate artifacts. */
    saveAttempt?: { id: string; startedAt: string; failedAt?: string };
  };
}

/** Multi-document store persisted on Legal Document Review.esign_envelope */
export interface LegalEsignBundle {
  schemaVersion: 2;
  documents: Partial<Record<LegalDocKey, LegalEsignEnvelope>>;
  reviewChecklist?: Array<{ id: string; status: string; remarks?: string; reviewedBy?: string; reviewedAt?: string }>;
  auditTrail?: LegalEsignAuditEntry[];
}

export const DEFAULT_SIGNATURE_BOX: Pick<
  LegalEsignPlacement,
  "widthNorm" | "heightNorm"
> = {
  widthNorm: 0.32,
  heightNorm: 0.1,
};

export function createEmptyEnvelope(
  partial: Pick<
    LegalEsignEnvelope,
    "documentKey" | "documentName" | "documentNumber" | "documentHash"
  > & { documentVersion?: string },
): LegalEsignEnvelope {
  return {
    schemaVersion: 1,
    documentKey: partial.documentKey,
    documentName: partial.documentName,
    documentNumber: partial.documentNumber,
    documentVersion: partial.documentVersion ?? "V1",
    documentHash: partial.documentHash,
    signatures: [],
    auditTrail: [],
    status: "unsigned",
    locked: false,
    approvalStatus: "Pending",
  };
}

function normalizePlacement(raw: unknown): LegalEsignPlacement {
  const p = (raw ?? {}) as Partial<LegalEsignPlacement>;
  return {
    page: Math.max(1, Number(p.page) || 1),
    xNorm: clamp01(Number(p.xNorm) || 0.5),
    yNorm: clamp01(Number(p.yNorm) || 0.5),
    widthNorm: clamp01(Number(p.widthNorm) || DEFAULT_SIGNATURE_BOX.widthNorm),
    heightNorm: clamp01(
      Number(p.heightNorm) || DEFAULT_SIGNATURE_BOX.heightNorm,
    ),
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function normalizeSignature(raw: unknown): LegalEsignSignature | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<LegalEsignSignature>;
  if (!s.id || !s.typedName) return null;
  return {
    id: String(s.id),
    sequence: Number(s.sequence) || 1,
    role: (s.role as LegalEsignRole) || "legal",
    reviewerName: String(s.reviewerName ?? ""),
    reviewerId: String(s.reviewerId ?? ""),
    typedName: String(s.typedName),
    fontId: (s.fontId as LegalSignatureFontId) || DEFAULT_SIGNATURE_FONT_ID,
    signedAt:
      formatERPNextDatetime(s.signedAt) ??
      formatERPNextDatetime(new Date()) ??
      "",
    placement: normalizePlacement(s.placement),
    status: (s.status as LegalEsignSignatureStatus) || "signed",
  };
}

function normalizeEnvelope(raw: unknown): LegalEsignEnvelope | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Partial<LegalEsignEnvelope>;
  if (!e.documentKey || !Array.isArray(e.signatures)) return null;
  const signatures = e.signatures
    .map(normalizeSignature)
    .filter((s): s is LegalEsignSignature => Boolean(s));
  return {
    schemaVersion: 1,
    documentKey: e.documentKey as LegalDocKey,
    documentName: String(e.documentName ?? e.documentKey),
    documentNumber: String(e.documentNumber ?? ""),
    documentVersion: String(e.documentVersion ?? "V1"),
    documentHash: String(e.documentHash ?? ""),
    signedFileHash: e.signedFileHash,
    signedFileUrl: e.signedFileUrl,
    signedFileId: e.signedFileId,
    signatureMethod: e.signatureMethod,
    signatures,
    auditTrail: Array.isArray(e.auditTrail) ? e.auditTrail : [],
    status: (e.status as LegalEsignEnvelopeStatus) || "unsigned",
    locked: Boolean(e.locked),
    approvalStatus: e.approvalStatus,
    approvalTimestamp: e.approvalTimestamp,
    reviewStartedAt: e.reviewStartedAt,
    sourceFileId: e.sourceFileId,
    sourceFileUrl: e.sourceFileUrl,
    viewedBy: e.viewedBy,
    viewedAt: e.viewedAt,
    approvedHash: e.approvedHash,
    approvedFileId: e.approvedFileId,
    approvedBy: e.approvedBy,
    signatureRequest: e.signatureRequest,
  };
}

/** Parse ERP JSON into a multi-doc bundle (migrates legacy v1 envelopes). */
export function parseEsignBundle(raw: unknown): LegalEsignBundle {
  if (!raw) return { schemaVersion: 2, documents: {} };
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!obj || typeof obj !== "object") {
      return { schemaVersion: 2, documents: {} };
    }
    const rec = obj as Record<string, unknown>;
    if (rec.schemaVersion === 2 && rec.documents && typeof rec.documents === "object") {
      const docs = rec.documents as Record<string, unknown>;
      const documents: LegalEsignBundle["documents"] = {};
      for (const key of ["terms", "warranty", "insurance"] as LegalDocKey[]) {
        const env = normalizeEnvelope(docs[key]);
        if (env) documents[key] = env;
      }
      return { schemaVersion: 2, documents, reviewChecklist: Array.isArray(rec.reviewChecklist) ? rec.reviewChecklist : undefined, auditTrail: Array.isArray(rec.auditTrail) ? rec.auditTrail : undefined };
    }
    // Legacy single-document envelope
    const legacy = normalizeEnvelope(obj);
    if (legacy) {
      return {
        schemaVersion: 2,
        documents: { [legacy.documentKey]: legacy },
      };
    }
  } catch {
    /* ignore */
  }
  return { schemaVersion: 2, documents: {} };
}

/** @deprecated Prefer parseEsignBundle — returns first/legacy single envelope. */
export function parseEsignEnvelope(raw: unknown): LegalEsignEnvelope | null {
  const bundle = parseEsignBundle(raw);
  const keys: LegalDocKey[] = ["terms", "warranty", "insurance"];
  for (const k of keys) {
    if (bundle.documents[k]) return bundle.documents[k]!;
  }
  return null;
}

export function getDocEnvelope(
  bundle: LegalEsignBundle | null | undefined,
  key: LegalDocKey,
): LegalEsignEnvelope | null {
  return bundle?.documents[key] ?? null;
}

export function upsertDocEnvelope(
  bundle: LegalEsignBundle | null | undefined,
  envelope: LegalEsignEnvelope,
): LegalEsignBundle {
  const base = bundle ?? { schemaVersion: 2 as const, documents: {} };
  return {
    ...base,
    schemaVersion: 2,
    documents: {
      ...base.documents,
      [envelope.documentKey]: envelope,
    },
  };
}

export function hasLegalSignature(
  envelope: LegalEsignEnvelope | null | undefined,
): boolean {
  if (!envelope) return false;
  return envelope.signatures.some(
    (s) =>
      s.role === "legal" && (s.status === "signed" || s.status === "locked"),
  );
}

export function hasDocSignature(
  bundle: LegalEsignBundle | null | undefined,
  key: LegalDocKey,
): boolean {
  return hasLegalSignature(getDocEnvelope(bundle, key));
}

export function hasAnyLegalSignature(
  bundle: LegalEsignBundle | null | undefined,
): boolean {
  if (!bundle) return false;
  return (["terms", "warranty", "insurance"] as LegalDocKey[]).some((k) =>
    hasDocSignature(bundle, k),
  );
}

export type DocSignatureUiStatus =
  | "pending_signature"
  | "signed"
  | "approved"
  | "rejected";

export function getDocSignatureUiStatus(input: {
  reviewStatus?: string | null;
  docApproved?: boolean;
  signed: boolean;
  viewed?: boolean;
}): DocSignatureUiStatus {
  const rs = String(input.reviewStatus ?? "Pending");
  if (rs === "Rejected") return "rejected";
  if (rs === "Approved" || input.docApproved) return "approved";
  if (input.signed) return "signed";
  return "pending_signature";
}

export type DocReviewProgressStep =
  | "review_started"
  | "signed"
  | "approved"
  | "completed";

export function getDocReviewProgress(input: {
  reviewStatus?: string | null;
  viewed?: boolean;
  signed: boolean;
  docApproved?: boolean;
}): DocReviewProgressStep[] {
  const steps: DocReviewProgressStep[] = [];
  if (input.viewed || input.signed || input.docApproved) {
    steps.push("review_started");
  }
  if (input.signed) steps.push("signed");
  if (input.docApproved || input.reviewStatus === "Approved") {
    steps.push("approved");
  }
  if (input.reviewStatus === "Approved" || input.reviewStatus === "Rejected") {
    steps.push("completed");
  }
  return steps;
}
