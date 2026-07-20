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
  signatures: LegalEsignSignature[];
  auditTrail: LegalEsignAuditEntry[];
  status: LegalEsignEnvelopeStatus;
  locked: boolean;
  approvalStatus?: "Pending" | "Approved" | "Rejected";
  approvalTimestamp?: string;
  reviewStartedAt?: string;
}

/** Multi-document store persisted on Legal Document Review.esign_envelope */
export interface LegalEsignBundle {
  schemaVersion: 2;
  documents: Partial<Record<LegalDocKey, LegalEsignEnvelope>>;
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
    signatures,
    auditTrail: Array.isArray(e.auditTrail) ? e.auditTrail : [],
    status: (e.status as LegalEsignEnvelopeStatus) || "unsigned",
    locked: Boolean(e.locked),
    approvalStatus: e.approvalStatus,
    approvalTimestamp: e.approvalTimestamp,
    reviewStartedAt: e.reviewStartedAt,
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
      return { schemaVersion: 2, documents };
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
