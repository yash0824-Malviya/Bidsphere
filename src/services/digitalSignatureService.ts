/**
 * Centralized Digital Signature service for BidSphere.
 *
 * Captures signature timestamps in ERPNext-safe format, hashes payloads
 * (SHA-256), and builds ERP field maps for warehouse / legal / finance flows.
 * Never emits ISO-8601 (`T` / `Z` / ms) into Datetime columns.
 */
import { sha256Hex } from "../api/legalEsign";
import { createNotification } from "../api/notifications";
import type { NotificationTargetRole } from "../types/notification";
import {
  nowERPDateTime,
  toERPDateTime,
  tryERPDateTime,
} from "../utils/erpDate";

export type SignatureAuditAction =
  | "Signature captured"
  | "Signature verified"
  | "Signed PDF stored"
  | "Signature image stored"
  | "Document signed"
  | "Audit recorded";

export interface SignatureAuditEntry {
  id: string;
  action: SignatureAuditAction | string;
  at: string;
  by: string;
  detail?: string;
  documentType?: string;
  documentName?: string;
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Current wall-clock time as `YYYY-MM-DD HH:mm:ss` (never ISO-8601). */
export function captureSignatureTimestamp(
  value?: string | Date | null,
): string {
  if (value == null || value === "") return nowERPDateTime();
  return toERPDateTime(value, "signed_at");
}

/** Normalize any timestamp for an ERP Datetime column (null if invalid). */
export function normalizeSignatureTimestamp(
  value: string | Date | null | undefined,
): string | null {
  return tryERPDateTime(value);
}

export async function hashSignaturePayload(
  payload: string | Uint8Array | ArrayBuffer,
): Promise<string> {
  return sha256Hex(payload);
}

export async function hashCanonicalJson(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return sha256Hex(bytes);
}

/**
 * Canonical ERP field map for a completed digital signature on a document.
 * All datetime fields are MariaDB-safe.
 */
export function buildSignatureErpFields(input: {
  signedBy: string;
  signedAt?: string | Date | null;
  sha256Hash: string;
  role?: string;
  email?: string;
  ip?: string;
  device?: string;
  browser?: string;
  certificateStatus?: string;
  verificationStatus?: "verified" | "invalid" | "pending";
  documentIntegrity?: string;
  signatureImageUrl?: string;
  signedPdfUrl?: string;
  algorithm?: string;
  version?: string;
}): Record<string, unknown> {
  const signedAt = captureSignatureTimestamp(input.signedAt);
  const verification =
    input.verificationStatus === "invalid"
      ? "invalid"
      : input.verificationStatus === "pending"
        ? "pending"
        : "verified";
  return {
    signed: 1,
    signed_by: input.signedBy,
    signed_at: signedAt,
    sha256_hash: input.sha256Hash,
    certificate_status: input.certificateStatus ?? "Valid",
    verification_status: verification,
    document_integrity: input.documentIntegrity ?? "Verified",
    signature_image: input.signatureImageUrl || undefined,
    signed_pdf_path: input.signedPdfUrl || undefined,
    signed_pdf_url: input.signedPdfUrl || undefined,
    warehouse_signed: 1,
    warehouse_signed_by: input.signedBy,
    warehouse_signed_at: signedAt,
    warehouse_signature_timestamp: signedAt,
    warehouse_signature_time: signedAt,
    warehouse_signature_hash: input.sha256Hash,
    warehouse_signature_verified: verification === "verified" ? 1 : 0,
    warehouse_verification_status: verification,
    warehouse_signature_algorithm: input.algorithm || "SHA-256",
    warehouse_signature_version: input.version || undefined,
    warehouse_signature_image: input.signatureImageUrl || undefined,
    warehouse_signed_pdf_url: input.signedPdfUrl || undefined,
    warehouse_ip: input.ip || undefined,
    warehouse_device: input.device || undefined,
    warehouse_browser: input.browser || undefined,
    warehouse_signer_role: input.role || undefined,
    warehouse_signer_email: input.email || undefined,
  };
}

/** Legal Document Review esign Datetime + metadata fields. */
export function buildLegalSignatureErpFields(input: {
  signedBy: string;
  signedAt?: string | Date | null;
  documentHash?: string;
  signedFileUrl?: string;
  status?: string;
  envelopeJson?: string;
}): Record<string, unknown> {
  const signedOn = captureSignatureTimestamp(input.signedAt);
  return {
    esign_signed_by: input.signedBy,
    esign_signed_on: signedOn,
    esign_document_hash: input.documentHash || undefined,
    esign_signed_file_url: input.signedFileUrl || undefined,
    esign_status: input.status || "signed",
    esign_envelope: input.envelopeJson || undefined,
  };
}

export function createSignatureAuditEntry(
  action: string,
  by: string,
  detail?: string,
  opts?: {
    documentType?: string;
    documentName?: string;
    notifyRole?: NotificationTargetRole;
    module?: string;
    routePath?: string;
  },
): SignatureAuditEntry {
  const entry: SignatureAuditEntry = {
    id: uid("sig_audit"),
    action,
    at: nowERPDateTime(),
    by,
    detail,
    documentType: opts?.documentType,
    documentName: opts?.documentName,
  };

  if (opts?.notifyRole && opts.documentName) {
    createNotification({
      title: action,
      description: detail || action,
      module: opts.module || "GRN",
      event_type: `digital_signature_${action.toLowerCase().replace(/\s+/g, "_")}`,
      target_role: opts.notifyRole,
      document_type: opts.documentType || "Purchase Receipt",
      document_name: opts.documentName,
      route_path: opts.routePath,
    });
  }

  return entry;
}

export const DigitalSignatureService = {
  captureTimestamp: captureSignatureTimestamp,
  normalizeTimestamp: normalizeSignatureTimestamp,
  now: nowERPDateTime,
  hash: hashSignaturePayload,
  hashCanonical: hashCanonicalJson,
  buildWarehouseErpFields: buildSignatureErpFields,
  buildLegalErpFields: buildLegalSignatureErpFields,
  audit: createSignatureAuditEntry,
};

export default DigitalSignatureService;
