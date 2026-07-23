/**
 * Warehouse Digital Signature integrity helpers.
 *
 * Keeps document-fingerprint + immutability logic in one place so
 * `warehouseEsign.ts` / `purchasing.ts` stay backward compatible.
 */
import type { PurchaseReceipt } from "../types/erpnext";
import { sha256Hex } from "./legalEsign";

/** Custom / e-sign fields that may still be written after a GRN is signed. */
export const WAREHOUSE_ESIGN_FIELD_ALLOWLIST = new Set([
  "signed",
  "signed_by",
  "signed_at",
  "sha256_hash",
  "certificate_status",
  "verification_status",
  "document_integrity",
  "signature_image",
  "signed_pdf_url",
  "signed_pdf_file",
  "signed_pdf_path",
  "signed_grn_pdf",
  "warehouse_signed",
  "warehouse_signed_by",
  "warehouse_signed_at",
  "warehouse_signature_type",
  "warehouse_signature_data",
  "warehouse_signature_style",
  "warehouse_signature_hash",
  "warehouse_signature_name",
  "warehouse_signature_role",
  "warehouse_signature_employee_id",
  "warehouse_signature_email",
  "warehouse_signature_timestamp",
  "warehouse_signature_time",
  "warehouse_signature_ip",
  "warehouse_signature_device",
  "warehouse_signature_verified",
  "warehouse_signature_algorithm",
  "warehouse_signature_version",
  "warehouse_signature_image",
  "warehouse_signature",
  "warehouse_signed_pdf_url",
  "warehouse_signed_pdf_hash",
  // Allowed in the client mutation guard so draft re-saves can include the
  // envelope. ERP writes still strip this field when docstatus = 1.
  "warehouse_esign_envelope",
  "warehouse_ip",
  "warehouse_browser",
  "warehouse_device",
  "warehouse_signer_role",
  "warehouse_signer_email",
  "warehouse_verification_status",
  "warehouse_document_version",
  "modified",
  // Note: `docstatus` is intentionally excluded — cancel/submit use dedicated guards.
]);

/** Stable business snapshot used to bind a signature to GRN content. */
export function buildGrnDocumentSnapshot(
  grn: PurchaseReceipt,
): Record<string, unknown> {
  const items = (grn.items ?? []).map((it) => ({
    item_code: it.item_code ?? "",
    qty: Number(it.qty) || 0,
    received_qty: Number(it.received_qty) || 0,
    rejected_qty: Number(it.rejected_qty) || 0,
    warehouse: it.warehouse ?? "",
    rate: Number(it.rate) || 0,
    purchase_order: it.purchase_order ?? "",
    purchase_order_item: it.purchase_order_item ?? "",
  }));
  return {
    name: grn.name ?? "",
    supplier: grn.supplier ?? "",
    company: grn.company ?? "",
    posting_date: grn.posting_date ?? "",
    set_warehouse: grn.set_warehouse ?? "",
    currency: grn.currency ?? "",
    items,
  };
}

export async function hashGrnDocument(grn: PurchaseReceipt): Promise<string> {
  const canonical = JSON.stringify(buildGrnDocumentSnapshot(grn));
  return sha256Hex(new TextEncoder().encode(canonical));
}

export function isSignatureOnlyUpdate(
  data: Record<string, unknown> | Partial<PurchaseReceipt>,
): boolean {
  const keys = Object.keys(data).filter(
    (k) => (data as Record<string, unknown>)[k] !== undefined,
  );
  if (keys.length === 0) return true;
  return keys.every((k) => WAREHOUSE_ESIGN_FIELD_ALLOWLIST.has(k));
}

export function hasSignedMarkers(
  grn: PurchaseReceipt | null | undefined,
): boolean {
  if (!grn) return false;
  return Boolean(
    grn.signed ||
      grn.warehouse_signed ||
      grn.warehouse_signature_hash ||
      grn.sha256_hash ||
      (grn.signed_by && String(grn.signed_by).trim()) ||
      (grn.warehouse_signed_by && String(grn.warehouse_signed_by).trim()),
  );
}

export const SIGNED_GRN_IMMUTABLE_MESSAGE =
  "This GRN is digitally signed and cannot be edited or cancelled. If the receipt data must change, the Warehouse signature will be invalidated and a new signature is required.";

export const SIGNED_GRN_SUBMIT_REQUIRED_MESSAGE =
  "Warehouse Digital Signature is mandatory before submitting GRN. Complete Warehouse E-Sign first.";

/**
 * Guard for Purchase Receipt mutations after a Warehouse signature exists.
 * Allowlisted e-sign / PDF fields may still be written (re-sign, PDF store, invalidate).
 */
export function assertSignedGrnMutationAllowed(
  grn: PurchaseReceipt | null | undefined,
  data: Record<string, unknown> | Partial<PurchaseReceipt>,
): void {
  if (!hasSignedMarkers(grn)) return;
  if (isSignatureOnlyUpdate(data)) return;
  throw new Error(SIGNED_GRN_IMMUTABLE_MESSAGE);
}
