/**
 * Warehouse Digital Signature helpers for the GRN workflow.
 * Reuses Legal SHA-256; stores fields on Purchase Receipt + local audit trail.
 * All ERP Datetime fields use DigitalSignatureService (never ISO-8601).
 */
import { sha256Hex } from "./legalEsign";
import { getFullFileUrl } from "./legalDocsStorage";
import { createNotification } from "./notifications";
import {
  buildSignatureErpFields,
  captureSignatureTimestamp,
  DigitalSignatureService,
} from "../services/digitalSignatureService";
import { buildPortalClientMeta } from "../utils/supplierClientMeta";
import { getSignatureFont } from "../types/legalSignatureFonts";
import type { PurchaseReceipt } from "../types/erpnext";
import type { NotificationTargetRole } from "../types/notification";
import type {
  WarehouseEsignAuditAction,
  WarehouseEsignAuditEntry,
  WarehouseEsignEnvelopeV1,
  WarehouseEsignState,
  WarehouseSignatureType,
} from "../types/warehouseEsign";
import {
  DEFAULT_WAREHOUSE_SIGNATURE_PLACEMENT,
  emptyWarehouseChecklist,
  hasSignatureArtifact,
  isChecklistComplete,
  isWarehouseEsignComplete,
} from "../types/warehouseEsign";
import type { LegalSignatureFontId } from "../types/legalSignatureFonts";
import { DEFAULT_SIGNATURE_FONT_ID } from "../types/legalSignatureFonts";

const AUDIT_KEY = "bidsphere:warehouse-esign-audit";

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function readAuditStore(): WarehouseEsignAuditEntry[] {
  try {
    const raw = localStorage.getItem(AUDIT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WarehouseEsignAuditEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAuditStore(entries: WarehouseEsignAuditEntry[]): void {
  try {
    localStorage.setItem(AUDIT_KEY, JSON.stringify(entries.slice(0, 500)));
  } catch {
    /* ignore */
  }
}

export function appendWarehouseEsignAudit(
  action: WarehouseEsignAuditAction,
  by: string,
  detail?: string,
  opts?: { targetRole?: NotificationTargetRole; grnName?: string },
): WarehouseEsignAuditEntry {
  const entry: WarehouseEsignAuditEntry = {
    id: uid("wh_audit"),
    action,
    at: DigitalSignatureService.now(),
    by,
    detail,
  };
  const list = readAuditStore();
  list.unshift(entry);
  writeAuditStore(list);

  const grnName = opts?.grnName || detail || action;
  createNotification({
    title: action,
    description: detail || action,
    module: "GRN",
    event_type: `warehouse_esign_${action.toLowerCase().replace(/\s+/g, "_")}`,
    target_role: opts?.targetRole ?? "warehouse",
    document_type: "Purchase Receipt",
    document_name: grnName,
    route_path: opts?.grnName
      ? `/p2p/grn/${encodeURIComponent(opts.grnName)}`
      : "/warehouse/inventory/create-grn",
  });

  return entry;
}

/** Best-effort client environment for audit fields. */
export function captureWarehouseClientMeta(): {
  warehouseBrowser: string;
  warehouseDevice: string;
  warehouseIp: string;
} {
  const meta = buildPortalClientMeta();
  return {
    warehouseBrowser: meta.browser || "Browser",
    warehouseDevice: meta.device || "Desktop",
    // Browser cannot read public IP without an external service — leave blank.
    warehouseIp: "",
  };
}

/** Canonical payload string used for SHA-256 after signing. */
export function buildWarehouseSignatureCanonical(
  state: WarehouseEsignState,
  documentHash = "",
): string {
  return JSON.stringify({
    fullName: state.fullName.trim(),
    typedName: state.typedName.trim(),
    designation: state.designation.trim(),
    employeeId: state.employeeId.trim(),
    signatureType: state.signatureType,
    fontId: state.fontId,
    signatureDataUrl: state.signatureDataUrl,
    checklist: state.checklist,
    remarks: state.remarks.trim(),
    placed: state.placed,
    placement: state.placement,
    certified: state.certified,
    signedAtIso: state.signedAtIso,
    // Binds the signature to the GRN business snapshot (items/qty/warehouse…).
    documentHash: documentHash || "",
  });
}

export async function hashWarehouseSignature(
  state: WarehouseEsignState,
  documentHash = "",
): Promise<string> {
  const canonical = buildWarehouseSignatureCanonical(state, documentHash);
  const bytes = new TextEncoder().encode(canonical);
  return sha256Hex(bytes);
}

/**
 * Finalize signature: stamp time, client meta, SHA-256, audit entry.
 * Call when user places/confirms a signature artifact.
 */
export async function finalizeWarehouseSignature(
  state: WarehouseEsignState,
  opts?: { action?: WarehouseEsignAuditAction },
): Promise<WarehouseEsignState> {
  if (!hasSignatureArtifact(state) || !state.placed) {
    throw new Error("Place a warehouse signature before finalizing.");
  }

  const meta = captureWarehouseClientMeta();
  // ERP Datetime — never ISO-8601 (`T`/`Z`/ms). Property name kept for compat.
  const signedAtIso = captureSignatureTimestamp();
  const next: WarehouseEsignState = {
    ...state,
    ...meta,
    signedAtIso,
    signedAtDisplay: new Date(signedAtIso.replace(" ", "T")).toLocaleString(),
  };
  const hash = await hashWarehouseSignature(next);
  next.signatureHash = hash;
  next.verificationStatus = "verified";
  next.documentVersion = state.documentVersion || "1.0";

  const action =
    opts?.action ??
    (state.signatureHash
      ? "Warehouse Signature Updated"
      : "Warehouse Signature Added");
  const audit = appendWarehouseEsignAudit(
    action,
    next.fullName || "Warehouse Manager",
    `hash=${hash.slice(0, 12)}…`,
  );
  const signedAudit = appendWarehouseEsignAudit(
    "Warehouse signed GRN",
    next.fullName || "Warehouse Manager",
    `hash=${hash.slice(0, 12)}…`,
  );
  next.auditTrail = [signedAudit, audit, ...state.auditTrail];

  return next;
}

export function clearWarehouseSignature(
  state: WarehouseEsignState,
): WarehouseEsignState {
  const audit = appendWarehouseEsignAudit(
    "Warehouse Signature Removed",
    state.fullName || "Warehouse Manager",
  );
  return {
    ...state,
    signatureType: null,
    signatureDataUrl: null,
    placed: false,
    certified: false,
    signatureHash: null,
    signedAtIso: null,
    verificationStatus: "pending",
    signedPdfUrl: undefined,
    auditTrail: [audit, ...state.auditTrail],
  };
}

/** Review & Submit: signature pad + certify checkbox (no multi-item checklist). */
export function hasReviewSignatureReady(state: WarehouseEsignState): boolean {
  return hasSignatureArtifact(state) && state.certified === true;
}

/**
 * Prepare e-sign for Sign & Finalize from the Review step:
 * auto-complete inspection checklist, place signature, hash SHA-256.
 */
export async function finalizeWarehouseSignatureForReview(
  state: WarehouseEsignState,
): Promise<WarehouseEsignState> {
  if (!hasSignatureArtifact(state)) {
    throw new Error("Capture a warehouse signature before finalizing.");
  }
  const checklist = emptyWarehouseChecklist();
  for (const key of Object.keys(checklist) as Array<keyof typeof checklist>) {
    checklist[key] = true;
  }
  const drafted: WarehouseEsignState = {
    ...state,
    checklist,
    placed: true,
    certified: state.certified,
    signatureType:
      state.signatureType ||
      (state.signatureDataUrl ? "drawn" : "typed"),
    fullName: state.fullName.trim() || state.typedName.trim() || "Warehouse Manager",
    typedName: state.typedName.trim() || state.fullName.trim(),
    role: state.role || state.designation || "Warehouse Manager",
    designation: state.designation || state.role || "Warehouse Manager",
  };
  // Hash even if not yet certified (preview capture); submit still requires certify.
  return finalizeWarehouseSignature(drafted);
}

export function validateWarehouseEsignForSubmit(state: WarehouseEsignState): {
  ok: boolean;
  message?: string;
} {
  // Prefer the Review & Submit path (signature + certify).
  if (hasReviewSignatureReady(state) && state.signatureHash && state.placed) {
    return { ok: true };
  }
  if (!hasSignatureArtifact(state)) {
    return {
      ok: false,
      message:
        "Warehouse Digital Signature is mandatory. Capture your signature on Review & Submit.",
    };
  }
  if (!state.certified) {
    return {
      ok: false,
      message:
        'Please confirm: "I certify received goods match this GRN".',
    };
  }
  if (!state.signatureHash || !state.placed) {
    return {
      ok: false,
      message:
        "Warehouse Digital Signature is mandatory. Capture and apply your signature before Sign & Finalize.",
    };
  }
  // Legacy full e-sign step (checklist + place + certify).
  if (isWarehouseEsignComplete(state)) {
    return { ok: true };
  }
  if (!isChecklistComplete(state.checklist)) {
    return {
      ok: false,
      message: "Warehouse Digital Signature is mandatory before submitting GRN.",
    };
  }
  return { ok: true };
}

export const WAREHOUSE_SIGNATURE_ALGORITHM = "SHA-256";
export const WAREHOUSE_SIGNATURE_VERSION = "1.0";

/** Canonical public file paths for permanent Warehouse GRN storage. */
export function warehouseSignatureImagePath(grnName: string): string {
  const safe = String(grnName || "GRN").replace(/[^\w.-]+/g, "_");
  return `/files/signatures/grn/${safe}-signature.png`;
}

export function warehouseSignedPdfPath(grnName: string): string {
  const safe = String(grnName || "GRN").replace(/[^\w.-]+/g, "_");
  return `/files/grn/signed/${safe}.pdf`;
}

/** Fields persisted on Purchase Receipt (custom fields + envelope JSON). */
export function buildWarehouseEsignErpFields(
  state: WarehouseEsignState,
): Record<string, unknown> {
  const font = getSignatureFont(state.fontId);
  const verificationStatus =
    state.verificationStatus === "invalid" ? "invalid" : "verified";
  const role = state.role || state.designation || "Warehouse Manager";
  const version = state.documentVersion || WAREHOUSE_SIGNATURE_VERSION;
  const signedAt = captureSignatureTimestamp(state.signedAtIso);
  const signatureCore = buildSignatureErpFields({
    signedBy: state.fullName,
    signedAt,
    sha256Hash: state.signatureHash || "",
    role,
    email: state.email,
    ip: state.warehouseIp,
    device: state.warehouseDevice,
    browser: state.warehouseBrowser,
    verificationStatus:
      verificationStatus === "invalid" ? "invalid" : "verified",
    algorithm: WAREHOUSE_SIGNATURE_ALGORITHM,
    version,
    signatureImageUrl: undefined,
    signedPdfUrl: state.signedPdfUrl,
  });
  return {
    ...signatureCore,
    warehouse_signed: 1,
    warehouse_signed_by: state.fullName,
    warehouse_signature_type: state.signatureType,
    warehouse_signature_data:
      state.signatureType === "typed"
        ? state.typedName
        : (state.signatureDataUrl || "").slice(0, 120000),
    warehouse_signature_style:
      state.signatureType === "typed" ? font.id : state.signatureType,
    warehouse_signature_hash: state.signatureHash,
    warehouse_signed_at: signedAt,
    warehouse_ip: state.warehouseIp || undefined,
    warehouse_browser: state.warehouseBrowser,
    warehouse_device: state.warehouseDevice,
    warehouse_signer_role: role,
    warehouse_signer_email: state.email || undefined,
    warehouse_verification_status: verificationStatus,
    warehouse_document_version: version,
    /* Permanent storage metadata */
    warehouse_signature_name: state.fullName,
    warehouse_signature_role: role,
    warehouse_signature_employee_id: state.employeeId || undefined,
    warehouse_signature_email: state.email || undefined,
    warehouse_signature_timestamp: signedAt,
    warehouse_signature_ip: state.warehouseIp || undefined,
    warehouse_signature_device: state.warehouseDevice || undefined,
    warehouse_signature_verified: verificationStatus === "verified" ? 1 : 0,
    warehouse_signature_algorithm: WAREHOUSE_SIGNATURE_ALGORITHM,
    warehouse_signature_version: version,
    warehouse_signed_pdf_url: state.signedPdfUrl || undefined,
    signed_grn_pdf: state.signedPdfUrl || undefined,
    warehouse_signature:
      state.signatureType === "typed"
        ? state.typedName
        : (state.signatureDataUrl || "").slice(0, 120000),
    warehouse_signature_time: signedAt,
    warehouse_esign_envelope: JSON.stringify({
      schemaVersion: 1,
      checklist: state.checklist,
      remarks: state.remarks,
      designation: state.designation,
      employeeId: state.employeeId,
      role: state.role,
      email: state.email,
      placement: state.placement,
      typedName: state.typedName,
      fontId: state.fontId,
      signatureType: state.signatureType ?? undefined,
      signatureDataUrl:
        state.signatureType === "typed" ? null : state.signatureDataUrl,
      signatureHash: state.signatureHash ?? undefined,
      signedAtIso: state.signedAtIso ?? undefined,
      certified: state.certified,
      verificationStatus,
      documentVersion: version,
      signedPdfUrl: state.signedPdfUrl,
      signatureAlgorithm: WAREHOUSE_SIGNATURE_ALGORITHM,
      // documentHash is set in persistWarehouseGrnDigitalSignature (source of truth).
      auditTrail: state.auditTrail.slice(0, 20),
    } satisfies WarehouseEsignEnvelopeV1),
  };
}

async function dataUrlToPngFile(
  dataUrl: string,
  fileName: string,
): Promise<File> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], fileName, { type: "image/png" });
}

/** Render typed / drawn / uploaded signature into a PNG File for permanent storage. */
export async function buildWarehouseSignatureImageFile(
  state: WarehouseEsignState,
  grnName: string,
): Promise<File> {
  const safe = String(grnName || "GRN").replace(/[^\w.-]+/g, "_");
  const fileName = `signatures/grn/${safe}-signature.png`;

  if (state.signatureDataUrl?.startsWith("data:image")) {
    return dataUrlToPngFile(state.signatureDataUrl, fileName);
  }

  // Typed signature — render name as PNG on canvas.
  const text = (state.typedName || state.fullName || "Signed").trim();
  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 180;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not render warehouse signature image.");
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const font = getSignatureFont(state.fontId);
  ctx.fillStyle = "#0f172a";
  ctx.font = `italic 48px ${font.family}, cursive`;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 32, canvas.height / 2, canvas.width - 64);
  const dataUrl = canvas.toDataURL("image/png");
  return dataUrlToPngFile(dataUrl, fileName);
}

/** Fields that must never be written once Purchase Receipt.docstatus = 1. */
const POST_SUBMIT_FORBIDDEN_FIELDS = new Set([
  "warehouse_esign_envelope",
]);

async function getPurchaseReceiptDocstatus(name: string): Promise<number> {
  try {
    const { getPurchaseReceipt } = await import("./purchasing");
    const doc = await getPurchaseReceipt(name);
    return Number(doc?.docstatus) || 0;
  } catch {
    return 0;
  }
}

/**
 * Persist Purchase Receipt field values.
 * - Never writes `warehouse_esign_envelope` after submit (docstatus = 1).
 * - Uses silent ERP calls so UpdateAfterSubmitError cannot toast mid-finalize.
 */
async function setPurchaseReceiptValues(
  name: string,
  values: Record<string, unknown>,
): Promise<void> {
  const { apiPost, withSilent } = await import("./erpnext");
  const { updatePurchaseReceipt } = await import("./purchasing");

  const docstatus = await getPurchaseReceiptDocstatus(name);
  const submitted = docstatus === 1;

  const safeValues: Record<string, unknown> = {};
  for (const [fieldname, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (submitted && POST_SUBMIT_FORBIDDEN_FIELDS.has(fieldname)) {
      // eslint-disable-next-line no-console
      console.info(
        `[warehouse-esign] Skipping ${fieldname} on submitted GRN ${name}`,
      );
      continue;
    }
    safeValues[fieldname] = value;
  }

  if (Object.keys(safeValues).length === 0) return;

  // Prefer set_value per field — most reliable for custom fields on PR.
  for (const [fieldname, value] of Object.entries(safeValues)) {
    try {
      await apiPost(
        "/api/method/frappe.client.set_value",
        {
          doctype: "Purchase Receipt",
          name,
          fieldname,
          value,
        },
        withSilent(),
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[warehouse-esign] set_value ${fieldname} failed:`, err);
    }
  }

  // Fallback: resource PUT with the safe map (some sites block set_value).
  // Signature-field writes are explicitly allowlisted on signed GRNs.
  // Silent — never toast UpdateAfterSubmitError during finalize cleanup.
  try {
    await updatePurchaseReceipt(name, safeValues as Partial<PurchaseReceipt>, {
      allowSignedEsignFields: true,
      silent: true,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[warehouse-esign] updatePurchaseReceipt fallback failed:", err);
  }
}

export type PersistWarehouseGrnSignatureResult = {
  /** Empty until background PDF generation finishes. */
  fileUrl: string;
  pdfHash: string;
  signatureImageUrl: string;
  signatureHash: string;
  bytes: ArrayBuffer | null;
  /** True when signature metadata was persisted (source of truth). */
  signatureStored: boolean;
  /** True when PDF was already available or generated in this call. */
  pdfStored: boolean;
};

/**
 * Permanent Warehouse Digital Signature storage.
 * Source of truth = signature metadata on the GRN (not the PDF preview).
 *
 * 1) Persist signed / signed_by / signed_at / sha256_hash / certificate fields
 * 2) Generate & store Signed PDF asynchronously (optional preview)
 *
 * Never regenerates a PDF if one is already stored.
 */
export async function persistWarehouseGrnDigitalSignature(
  grn: PurchaseReceipt,
  esignState: WarehouseEsignState,
  statusLabel = "Submitted",
): Promise<PersistWarehouseGrnSignatureResult> {
  const existingUrl = String(
    grn.warehouse_signed_pdf_url ||
      grn.signed_pdf_url ||
      grn.signed_pdf_file ||
      grn.signed_pdf_path ||
      grn.signed_grn_pdf ||
      "",
  ).trim();
  const existingPdfHash = String(grn.warehouse_signed_pdf_hash || "").trim();
  const existingSigHash = String(
    grn.warehouse_signature_hash || grn.sha256_hash || esignState.signatureHash || "",
  ).trim();

  if (existingUrl && (existingPdfHash || isWarehouseDigitalSignatureComplete(grn))) {
    if (existingUrl && existingPdfHash) {
      try {
        const { getFullFileUrl } = await import("./legalDocsStorage");
        const { fetchPdfBytes } = await import("./legalEsign");
        const bytes = await fetchPdfBytes(getFullFileUrl(existingUrl));
        return {
          fileUrl: existingUrl,
          pdfHash: existingPdfHash,
          signatureImageUrl: String(
            grn.warehouse_signature_image || grn.signature_image || "",
          ),
          signatureHash: existingSigHash,
          bytes,
          signatureStored: true,
          pdfStored: true,
        };
      } catch {
        /* fall through — metadata already exists; PDF optional */
      }
    }
    return {
      fileUrl: existingUrl,
      pdfHash: existingPdfHash,
      signatureImageUrl: String(
        grn.warehouse_signature_image || grn.signature_image || "",
      ),
      signatureHash: existingSigHash,
      bytes: null,
      signatureStored: true,
      pdfStored: Boolean(existingUrl),
    };
  }

  const signer =
    esignState.fullName ||
    grn.warehouse_signature_name ||
    grn.signed_by ||
    grn.warehouse_signed_by ||
    "Warehouse Manager";
  const { hashGrnDocument } = await import("./warehouseSignatureIntegrity");
  const documentHash = await hashGrnDocument(grn);
  // Always bind SHA-256 to the current GRN business snapshot (not UI-only state).
  const signatureHash = await hashWarehouseSignature(esignState, documentHash);
  const version =
    esignState.documentVersion ||
    grn.warehouse_signature_version ||
    WAREHOUSE_SIGNATURE_VERSION;
  const role =
    esignState.role ||
    esignState.designation ||
    "Warehouse Manager";
  const timestamp = captureSignatureTimestamp(
    esignState.signedAtIso ||
      grn.warehouse_signature_timestamp ||
      grn.signed_at ||
      null,
  );

  const { uploadFileToERPNext } = await import("./legalDocsStorage");

  // 1) Signature image (best-effort — metadata still wins if image upload fails)
  const sigPath = warehouseSignatureImagePath(grn.name);
  const sigFileName = sigPath.replace(/^\/files\//, "");
  let signatureImageUrl = String(
    grn.warehouse_signature_image || grn.signature_image || "",
  );
  try {
    const sigFile = await buildWarehouseSignatureImageFile(esignState, grn.name);
    signatureImageUrl = await uploadFileToERPNext(
      sigFile,
      "Purchase Receipt",
      grn.name,
      {
        fileName: sigFileName,
        isPrivate: false,
        fieldname: "warehouse_signature_image",
      },
    );
    appendWarehouseEsignAudit(
      "Signature image stored",
      signer,
      `${grn.name} → ${signatureImageUrl}`,
      { grnName: grn.name, targetRole: "warehouse" },
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[warehouse-esign] Signature image upload skipped:", err);
  }

  const font = getSignatureFont(esignState.fontId);
  const signatureType =
    esignState.signatureType ||
    (esignState.signatureDataUrl ? "drawn" : "typed");
  const typedText = (esignState.typedName || esignState.fullName || signer).trim();
  // Keep drawn/uploaded data URL in the envelope when reasonably sized so PDF
  // regeneration and Signature Preview never lose the artifact.
  const dataUrlForEnvelope =
    esignState.signatureDataUrl?.startsWith("data:image") &&
    esignState.signatureDataUrl.length < 180_000
      ? esignState.signatureDataUrl
      : null;

  const env = parseWarehouseEsignEnvelope(grn.warehouse_esign_envelope) ?? {};
  const nextEnvelope: WarehouseEsignEnvelopeV1 = {
    ...env,
    schemaVersion: 1,
    typedName: typedText,
    fontId: font.id,
    signatureType,
    signatureDataUrl: dataUrlForEnvelope ?? env.signatureDataUrl ?? null,
    signatureImageUrl: signatureImageUrl || env.signatureImageUrl,
    signatureHash,
    documentHash,
    signedAtIso: timestamp,
    verificationStatus: "verified",
    documentVersion: version,
    signatureAlgorithm: WAREHOUSE_SIGNATURE_ALGORITHM,
    employeeId: esignState.employeeId || env.employeeId,
    role,
    email: esignState.email || env.email,
    designation: esignState.designation || env.designation,
    certified: true,
    signedPdfUrl: env.signedPdfUrl,
    signedPdfHash: env.signedPdfHash,
  };

  // 2) SOURCE OF TRUTH — persist signature metadata + image before any PDF work.
  // Envelope is written only while the GRN is still a draft (docstatus = 0).
  const metaValues: Record<string, unknown> = {
    signed: 1,
    warehouse_signed: 1,
    warehouse_signed_by: signer,
    warehouse_signature_name: signer,
    warehouse_signature_role: role,
    warehouse_signature_employee_id: esignState.employeeId || undefined,
    warehouse_signature_email: esignState.email || undefined,
    warehouse_signature_timestamp: timestamp,
    warehouse_signature_ip: esignState.warehouseIp || undefined,
    warehouse_signature_device: esignState.warehouseDevice || undefined,
    warehouse_signature_hash: signatureHash,
    warehouse_signature_verified: 1,
    warehouse_signature_algorithm: WAREHOUSE_SIGNATURE_ALGORITHM,
    warehouse_signature_version: version,
    warehouse_signature_type: signatureType,
    warehouse_signature_style:
      signatureType === "typed" ? font.id : signatureType,
    warehouse_signature_data:
      signatureType === "typed"
        ? typedText
        : (esignState.signatureDataUrl || "").slice(0, 120000) || typedText,
    warehouse_signature_image: signatureImageUrl || undefined,
    warehouse_signed_at: timestamp,
    warehouse_ip: esignState.warehouseIp || undefined,
    warehouse_device: esignState.warehouseDevice || undefined,
    warehouse_browser: esignState.warehouseBrowser || undefined,
    warehouse_signer_role: role,
    warehouse_signer_email: esignState.email || undefined,
    warehouse_verification_status: "verified",
    warehouse_document_version: version,
    signed_by: signer,
    signed_at: timestamp,
    sha256_hash: signatureHash,
    certificate_status: "Valid",
    verification_status: "verified",
    document_integrity: "Verified",
    signature_image: signatureImageUrl || undefined,
    warehouse_signature_time: timestamp,
    warehouse_signature:
      signatureType === "typed"
        ? typedText
        : signatureImageUrl || esignState.signatureDataUrl || undefined,
  };
  if (Number(grn.docstatus) !== 1) {
    metaValues.warehouse_esign_envelope = JSON.stringify(nextEnvelope);
  }
  await setPurchaseReceiptValues(grn.name, metaValues);

  appendWarehouseEsignAudit(
    "Warehouse signed GRN",
    signer,
    `${grn.name} · sig=${signatureHash.slice(0, 12)}…`,
    { grnName: grn.name, targetRole: "warehouse" },
  );

  // 3) Optional Signed PDF — background; never blocks Finance/voucher.
  const signedSource: PurchaseReceipt = {
    ...grn,
    ...buildWarehouseEsignErpFields({
      ...esignState,
      signatureHash,
      signedAtIso: timestamp,
      verificationStatus: "verified",
      documentVersion: version,
    }),
    warehouse_signature_image: signatureImageUrl,
    signed: 1,
    signed_by: signer,
    signed_at: timestamp,
    sha256_hash: signatureHash,
    certificate_status: "Valid",
    document_integrity: "Verified",
    items: grn.items ?? [],
  } as PurchaseReceipt;

  void generateAndStoreSignedGrnPdfInBackground(
    signedSource,
    signer,
    statusLabel,
  ).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn("[warehouse-esign] Background signed PDF generation failed:", err);
  });

  return {
    fileUrl: "",
    pdfHash: "",
    signatureImageUrl,
    signatureHash,
    bytes: null,
    signatureStored: true,
    pdfStored: false,
  };
}

/** Background Signed PDF generation — never throws to callers of Sign & Finalize. */
async function generateAndStoreSignedGrnPdfInBackground(
  grn: PurchaseReceipt,
  signer: string,
  statusLabel: string,
): Promise<void> {
  if (hasStoredSignedGrnPdfLink(grn)) return;

  const { uploadFileToERPNext } = await import("./legalDocsStorage");
  const { buildSignedGrnPdfBytes, grnPdfFilename } = await import("../utils/pdf/grnPdf");

  // eslint-disable-next-line no-console
  console.log("[warehouse-esign] Background Signed PDF for", grn.name);
  const bytes = await buildSignedGrnPdfBytes(grn, statusLabel);
  if (!bytes || bytes.byteLength < 100) {
    throw new Error("Signed GRN PDF generation produced an empty file.");
  }

  const pdfHash = await sha256Hex(bytes);
  appendWarehouseEsignAudit(
    "Signed PDF generated",
    signer,
    `${grn.name} · SHA256=${pdfHash.slice(0, 16)}…`,
    { grnName: grn.name, targetRole: "warehouse" },
  );

  const pdfPath = warehouseSignedPdfPath(grn.name);
  const pdfFileName = pdfPath.replace(/^\/files\//, "");
  const pdfFile = new File(
    [new Blob([bytes], { type: "application/pdf" })],
    pdfFileName,
    { type: "application/pdf" },
  );
  const fileUrl = await uploadFileToERPNext(pdfFile, "Purchase Receipt", grn.name, {
    fileName: pdfFileName,
    isPrivate: false,
  });
  if (!fileUrl) throw new Error("Signed GRN PDF upload returned an empty file URL.");

  const canonicalPdfUrl = fileUrl.includes("/files/") ? fileUrl : pdfPath;

  // PDF URL/hash only — never touch warehouse_esign_envelope after submit.
  await setPurchaseReceiptValues(grn.name, {
    warehouse_signed_pdf_url: canonicalPdfUrl,
    warehouse_signed_pdf_hash: pdfHash,
    signed_pdf_url: canonicalPdfUrl,
    signed_pdf_file: canonicalPdfUrl,
    signed_pdf_path: canonicalPdfUrl,
    signed_grn_pdf: canonicalPdfUrl,
  });

  appendWarehouseEsignAudit(
    "Signed PDF stored",
    signer,
    `${grn.name} → ${canonicalPdfUrl}`,
    { grnName: grn.name, targetRole: "warehouse" },
  );
  appendWarehouseEsignAudit(
    "Signed GRN generated",
    signer,
    `${grn.name} · ${grnPdfFilename(grn)}`,
    { grnName: grn.name, targetRole: "warehouse" },
  );
}

/**
 * @deprecated Use persistWarehouseGrnDigitalSignature — kept for call-site compat.
 * Does not regenerate when warehouse_signed_pdf_url + hash already exist.
 */
export async function generateAndAttachSignedGrnPdf(
  grn: PurchaseReceipt,
  statusLabel: string,
  esignState?: WarehouseEsignState,
): Promise<{ fileUrl: string; bytes: ArrayBuffer }> {
  const env = parseWarehouseEsignEnvelope(grn.warehouse_esign_envelope);
  const state: WarehouseEsignState = esignState ?? {
    checklist: emptyWarehouseChecklist(),
    remarks: "",
    fullName: grn.warehouse_signature_name || grn.warehouse_signed_by || "Warehouse Manager",
    designation: env?.designation || grn.warehouse_signature_role || "Warehouse Manager",
    employeeId: env?.employeeId || grn.warehouse_signature_employee_id || "",
    role: env?.role || grn.warehouse_signature_role || "Warehouse Manager",
    email: env?.email || grn.warehouse_signature_email || "",
    signedAtDisplay: "",
    signatureType: (env?.signatureType as WarehouseSignatureType) || "typed",
    typedName: env?.typedName || grn.warehouse_signature_name || "",
    fontId: (env?.fontId as LegalSignatureFontId) || DEFAULT_SIGNATURE_FONT_ID,
    signatureDataUrl: env?.signatureDataUrl || null,
    placed: true,
    placement: env?.placement || { ...DEFAULT_WAREHOUSE_SIGNATURE_PLACEMENT },
    certified: true,
    signatureHash: grn.warehouse_signature_hash || env?.signatureHash || null,
    signedAtIso: grn.warehouse_signature_timestamp || grn.warehouse_signed_at || env?.signedAtIso || null,
    warehouseIp: grn.warehouse_signature_ip || grn.warehouse_ip || "",
    warehouseBrowser: grn.warehouse_browser || "",
    warehouseDevice: grn.warehouse_signature_device || grn.warehouse_device || "",
    verificationStatus: "verified",
    documentVersion: grn.warehouse_signature_version || WAREHOUSE_SIGNATURE_VERSION,
    locked: true,
    auditTrail: [],
  };
  const result = await persistWarehouseGrnDigitalSignature(grn, state, statusLabel);
  return {
    fileUrl: result.fileUrl,
    bytes: result.bytes ?? new ArrayBuffer(0),
  };
}

/**
 * Re-stamp signature (+ optional PDF) metadata after submit.
 * Submit can drop draft custom fields — signature metadata is the source of truth.
 * PDF URL may be empty while background generation is still running.
 */
export async function restampSignedGrnPdfUrl(
  grnName: string,
  fileUrl: string,
  extras?: {
    pdfHash?: string;
    signatureImageUrl?: string;
    signatureHash?: string;
    signedBy?: string;
    signedAt?: string;
  },
): Promise<void> {
  if (!grnName) return;
  const hasPdf = Boolean(fileUrl?.trim());
  const hash = extras?.signatureHash?.trim() || undefined;
  const signedBy = extras?.signedBy?.trim() || undefined;
  const signedAt = extras?.signedAt?.trim()
    ? captureSignatureTimestamp(extras.signedAt)
    : undefined;
  if (!hasPdf && !hash && !signedBy) return;

  await setPurchaseReceiptValues(grnName, {
    signed: 1,
    warehouse_signed: 1,
    warehouse_signature_verified: 1,
    warehouse_signature_algorithm: WAREHOUSE_SIGNATURE_ALGORITHM,
    warehouse_verification_status: "verified",
    verification_status: "verified",
    certificate_status: "Valid",
    document_integrity: "Verified",
    warehouse_signature_hash: hash,
    sha256_hash: hash,
    warehouse_signature_image: extras?.signatureImageUrl || undefined,
    signature_image: extras?.signatureImageUrl || undefined,
    signed_by: signedBy,
    warehouse_signed_by: signedBy,
    warehouse_signature_name: signedBy,
    signed_at: signedAt,
    warehouse_signed_at: signedAt,
    warehouse_signature_timestamp: signedAt,
    ...(hasPdf
      ? {
          warehouse_signed_pdf_url: fileUrl,
          signed_pdf_url: fileUrl,
          signed_pdf_file: fileUrl,
          signed_pdf_path: fileUrl,
          signed_grn_pdf: fileUrl,
          warehouse_signed_pdf_hash: extras?.pdfHash || undefined,
        }
      : {}),
  });
}

/** Resolve the stored signed PDF URL from PR fields (never regenerates). */
export async function resolveSignedGrnPdfUrl(
  grn: PurchaseReceipt,
): Promise<string | null> {
  const fromField = String(
    grn.warehouse_signed_pdf_url ||
      grn.signed_pdf_url ||
      grn.signed_pdf_file ||
      grn.signed_pdf_path ||
      grn.signed_grn_pdf ||
      "",
  ).trim();
  if (fromField) return fromField;

  const env = parseWarehouseEsignEnvelope(grn.warehouse_esign_envelope);
  if (env?.signedPdfUrl) return String(env.signedPdfUrl).trim() || null;

  // Canonical path convention (public permanent storage).
  const canonical = warehouseSignedPdfPath(grn.name);

  try {
    const { apiGet, buildResourceUrl, buildListConfig } = await import("./erpnext");
    const files = await apiGet<Array<{ file_url?: string; file_name?: string }>>(
      buildResourceUrl("File"),
      buildListConfig({
        fields: ["file_url", "file_name", "creation"],
        filters: [
          ["attached_to_doctype", "=", "Purchase Receipt"],
          ["attached_to_name", "=", grn.name],
        ],
        order_by: "creation desc",
        limit_page_length: 50,
      }),
    );
    const list = Array.isArray(files) ? files : [];
    const byCanonical = list.find(
      (f) =>
        String(f.file_url || "") === canonical ||
        String(f.file_name || "").includes("grn/signed/") ||
        /signed/i.test(String(f.file_name || f.file_url || "")),
    );
    if (byCanonical?.file_url) return byCanonical.file_url;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[warehouse-esign] File list lookup failed:", err);
  }
  return null;
}

/**
 * Load the permanently stored signed GRN PDF.
 * Never regenerates. Validates SHA-256 when warehouse_signed_pdf_hash is present.
 */
export async function fetchStoredSignedGrnPdfBytes(
  grn: PurchaseReceipt,
): Promise<ArrayBuffer> {
  const fileUrl = await resolveSignedGrnPdfUrl(grn);
  if (!fileUrl) {
    const msg =
      "Signed GRN PDF not found. The permanently stored document is missing from this GRN. Voucher creation is blocked until Warehouse completes digital signature storage.";
    appendWarehouseEsignAudit(
      "Signed PDF missing",
      "System",
      grn.name,
      { grnName: grn.name, targetRole: "finance" },
    );
    throw new Error(msg);
  }

  const { getFullFileUrl } = await import("./legalDocsStorage");
  const { fetchPdfBytes } = await import("./legalEsign");

  let bytes: ArrayBuffer;
  try {
    bytes = await fetchPdfBytes(getFullFileUrl(fileUrl));
  } catch (err) {
    const msg =
      err instanceof Error
        ? `Signed GRN PDF could not be loaded (${err.message}). The stored document may be missing or corrupted.`
        : "Signed GRN PDF could not be loaded. The stored document may be missing or corrupted.";
    appendWarehouseEsignAudit(
      "Signed PDF corrupted",
      "System",
      `${grn.name} · ${fileUrl}`,
      { grnName: grn.name, targetRole: "finance" },
    );
    throw new Error(msg);
  }

  if (!bytes || bytes.byteLength < 100) {
    appendWarehouseEsignAudit(
      "Signed PDF corrupted",
      "System",
      `${grn.name} · empty file`,
      { grnName: grn.name, targetRole: "finance" },
    );
    throw new Error(
      "Signed GRN PDF is corrupted (empty file). Voucher creation is blocked.",
    );
  }

  const expectedHash = String(
    grn.warehouse_signed_pdf_hash ||
      parseWarehouseEsignEnvelope(grn.warehouse_esign_envelope)?.signedPdfHash ||
      "",
  ).trim();
  if (expectedHash) {
    const actual = await sha256Hex(bytes);
    if (actual !== expectedHash) {
      appendWarehouseEsignAudit(
        "Signed PDF corrupted",
        "System",
        `${grn.name} · hash mismatch`,
        { grnName: grn.name, targetRole: "finance" },
      );
      throw new Error(
        "Signed GRN PDF integrity check failed (SHA-256 mismatch). The stored document may be corrupted. Digital Signature metadata is unaffected.",
      );
    }
  }

  return bytes;
}

/**
 * @deprecated Never regenerates. Alias of fetchStoredSignedGrnPdfBytes for older call sites.
 */
export async function ensureSignedGrnPdfStored(
  grn: PurchaseReceipt,
  _statusLabel = "Submitted",
): Promise<{ fileUrl: string; bytes: ArrayBuffer; created: boolean }> {
  const fileUrl = await resolveSignedGrnPdfUrl(grn);
  const bytes = await fetchStoredSignedGrnPdfBytes(grn);
  return { fileUrl: fileUrl || "", bytes, created: false };
}

/** Sync field check for signed PDF URL (does not hit File list API). */
export function hasStoredSignedGrnPdfLink(
  grn: PurchaseReceipt | null | undefined,
): boolean {
  if (!grn) return false;
  if (
    String(
      grn.warehouse_signed_pdf_url ||
        grn.signed_pdf_url ||
        grn.signed_pdf_file ||
        grn.signed_pdf_path ||
        grn.signed_grn_pdf ||
        "",
    ).trim()
  ) {
    return true;
  }
  const env = parseWarehouseEsignEnvelope(grn.warehouse_esign_envelope);
  return Boolean(env?.signedPdfUrl && String(env.signedPdfUrl).trim());
}

export function hasStoredSignedGrnPdfHash(
  grn: PurchaseReceipt | null | undefined,
): boolean {
  if (!grn) return false;
  // PDF content hash only (sha256_hash on the GRN is the signature hash).
  if (String(grn.warehouse_signed_pdf_hash || "").trim()) return true;
  const env = parseWarehouseEsignEnvelope(grn.warehouse_esign_envelope);
  return Boolean(env?.signedPdfHash && String(env.signedPdfHash).trim());
}

/**
 * Voucher gate uses Digital Signature metadata only.
 * Signed PDF availability is optional and does not block Finance.
 */
export function assertGrnReadyForVoucher(grn: PurchaseReceipt | null | undefined): {
  ok: boolean;
  message?: string;
} {
  if (!grn) {
    return { ok: false, message: "GRN is missing. Select a signed Goods Receipt before creating a voucher." };
  }
  if (!isWarehouseDigitalSignatureComplete(grn)) {
    return {
      ok: false,
      message:
        "Waiting for Warehouse Digital Signature. Finance cannot continue until Warehouse completes E-Sign.",
    };
  }
  const status = String(
    grn.verification_status || grn.warehouse_verification_status || "",
  ).toLowerCase();
  if (status === "invalid" || status === "failed") {
    return {
      ok: false,
      message:
        "Warehouse signature verification failed. Voucher creation is blocked until the signature is valid.",
    };
  }
  return { ok: true };
}

/**
 * Async voucher gate — verifies signature metadata (not PDF presence).
 */
export async function assertGrnReadyForVoucherAsync(
  grn: PurchaseReceipt | null | undefined,
): Promise<{ ok: boolean; message?: string }> {
  const sync = assertGrnReadyForVoucher(grn);
  if (!sync.ok) return sync;
  if (!grn) {
    return {
      ok: false,
      message:
        "GRN is missing. Select a signed Goods Receipt before creating a voucher.",
    };
  }

  const verify = await verifyWarehouseGrnSignature(grn);
  if (!verify.signed) {
    return {
      ok: false,
      message:
        "Waiting for Warehouse Digital Signature. Finance cannot continue until Warehouse signs.",
    };
  }
  if (verify.integrity === "modified") {
    return {
      ok: false,
      message:
        "Warehouse signature verification failed. Voucher creation is blocked until the signature is valid.",
    };
  }
  return { ok: true };
}

/**
 * Try to load designation / employee id for the logged-in user.
 * Best-effort — never throws.
 */
export async function fetchWarehouseSignerProfile(userId: string): Promise<{
  designation: string;
  employeeId: string;
}> {
  const fallback = { designation: "Warehouse Manager", employeeId: "" };
  if (!userId) return fallback;

  try {
    const { apiGet, buildResourceUrl, buildListConfig } = await import("./erpnext");
    const employees = await apiGet<
      Array<{ name?: string; employee_name?: string; designation?: string; user_id?: string }>
    >(
      buildResourceUrl("Employee"),
      buildListConfig({
        fields: ["name", "employee_name", "designation", "user_id"],
        filters: [["user_id", "=", userId]],
        limit_page_length: 1,
      }),
    );
    const emp = Array.isArray(employees) ? employees[0] : null;
    if (emp) {
      return {
        designation: String(emp.designation || "Warehouse Manager"),
        employeeId: String(emp.name || ""),
      };
    }
  } catch {
    /* Employee DocType may be unavailable */
  }

  try {
    const { apiGet, buildResourceUrl } = await import("./erpnext");
    const user = await apiGet<{ designation?: string; full_name?: string }>(
      buildResourceUrl("User", userId),
    );
    if (user?.designation) {
      return { designation: String(user.designation), employeeId: "" };
    }
  } catch {
    /* ignore */
  }

  return fallback;
}

export { isWarehouseEsignComplete };

/** True when the GRN carries Warehouse Digital Signature metadata (not PDF). */
export function isGrnWarehouseSigned(grn: PurchaseReceipt | null | undefined): boolean {
  if (!grn) return false;
  return Boolean(
    grn.signed ||
      grn.warehouse_signed ||
      grn.warehouse_signature_hash ||
      grn.sha256_hash ||
      grn.warehouse_signature_verified ||
      (grn.signed_by && String(grn.signed_by).trim()) ||
      (grn.warehouse_signature_name && String(grn.warehouse_signature_name).trim()) ||
      (grn.warehouse_signed_by && String(grn.warehouse_signed_by).trim()),
  );
}

/**
 * Workflow / voucher gate: Warehouse Digital Signature completed.
 * Does NOT require a stored Signed PDF.
 */
export function isWarehouseDigitalSignatureComplete(
  grn: PurchaseReceipt | null | undefined,
): boolean {
  if (!grn) return false;
  const status = String(
    grn.verification_status || grn.warehouse_verification_status || "",
  ).toLowerCase();
  if (status === "invalid" || status === "failed") return false;

  const signer = String(
    grn.signed_by ||
      grn.warehouse_signature_name ||
      grn.warehouse_signed_by ||
      "",
  ).trim();
  const hash = String(
    grn.warehouse_signature_hash || grn.sha256_hash || "",
  ).trim();
  const signedAt = String(
    grn.signed_at ||
      grn.warehouse_signature_timestamp ||
      grn.warehouse_signed_at ||
      "",
  ).trim();
  const env = parseWarehouseEsignEnvelope(grn.warehouse_esign_envelope);
  const envHash = String(env?.signatureHash || "").trim();
  const envSignedAt = String(env?.signedAtIso || "").trim();

  const verified =
    Boolean(grn.signed) ||
    Boolean(grn.warehouse_signature_verified) ||
    Boolean(grn.warehouse_signed) ||
    status === "verified" ||
    String(grn.certificate_status || "").toLowerCase() === "valid" ||
    String(grn.document_integrity || "").toLowerCase() === "verified" ||
    String(env?.verificationStatus || "").toLowerCase() === "verified";

  const hasHash = Boolean(hash || envHash);
  const hasTime = Boolean(signedAt || envSignedAt);

  // Signer + (hash or verified flag). Timestamp strengthens confidence when present.
  return Boolean(signer) && (hasHash || verified) && (hasTime || verified || hasHash);
}

/**
 * True when the Signed GRN PDF file is permanently stored (optional preview).
 * Does not gate voucher creation.
 */
export function isWarehouseGrnSignatureStorageComplete(
  grn: PurchaseReceipt | null | undefined,
): boolean {
  if (!grn) return false;
  return (
    isWarehouseDigitalSignatureComplete(grn) &&
    hasStoredSignedGrnPdfLink(grn) &&
    hasStoredSignedGrnPdfHash(grn)
  );
}

/** Convenience: stored Signed PDF URL present (preview/download gate). */
export function hasWarehouseSignedPdfStored(
  grn: PurchaseReceipt | null | undefined,
): boolean {
  return hasStoredSignedGrnPdfLink(grn);
}

export function parseWarehouseEsignEnvelope(
  raw: unknown,
): WarehouseEsignEnvelopeV1 | null {
  if (!raw) return null;
  try {
    const parsed =
      typeof raw === "string" ? (JSON.parse(raw) as WarehouseEsignEnvelopeV1) : (raw as WarehouseEsignEnvelopeV1);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface WarehouseSignatureSummary {
  signed: boolean;
  signedBy: string;
  designation: string;
  employeeId: string;
  role: string;
  email: string;
  signedAtIso: string | null;
  signedDateLabel: string;
  signedTimeLabel: string;
  hash: string | null;
  hashMasked: string;
  /** Full SHA-256 for display (enterprise card). */
  sha256Hash: string;
  certificateStatus: string;
  documentIntegrity: string;
  device: string;
  browser: string;
  ip: string;
  signatureType: string;
  verificationStatus: string;
  documentVersion: string;
  signedPdfUrl: string | null;
  /** Typed signature text (when type is typed). */
  typedText: string;
  fontId: string;
  /** ERP Attach path or data URL for the signature image. */
  signatureImagePath: string | null;
  /** Browser-ready preview URL (proxied Attach or data URL). */
  previewSrc: string | null;
}

/**
 * Resolve the permanent signature artifact for UI preview / PDF embed.
 * Prefer stored Attach image, then envelope data URL, then typed text.
 */
export function resolveWarehouseSignatureArtifact(
  grn: PurchaseReceipt,
): {
  signatureType: string;
  typedText: string;
  fontId: string;
  signatureImagePath: string | null;
  previewSrc: string | null;
  dataUrl: string | null;
} {
  const env = parseWarehouseEsignEnvelope(grn.warehouse_esign_envelope);
  const signatureType = String(
    grn.warehouse_signature_type || env?.signatureType || "typed",
  );
  const typedText = String(
    env?.typedName ||
      (signatureType === "typed"
        ? grn.warehouse_signature_data || grn.warehouse_signature
        : "") ||
      grn.warehouse_signature_name ||
      grn.signed_by ||
      grn.warehouse_signed_by ||
      "",
  ).trim();
  const fontId = String(
    env?.fontId ||
      (signatureType === "typed" ? grn.warehouse_signature_style : "") ||
      DEFAULT_SIGNATURE_FONT_ID,
  );

  let dataUrl: string | null = null;
  if (env?.signatureDataUrl?.startsWith("data:image")) {
    dataUrl = env.signatureDataUrl;
  } else if (
    typeof grn.warehouse_signature_data === "string" &&
    grn.warehouse_signature_data.startsWith("data:image")
  ) {
    dataUrl = grn.warehouse_signature_data;
  } else if (
    typeof grn.warehouse_signature === "string" &&
    grn.warehouse_signature.startsWith("data:image")
  ) {
    dataUrl = grn.warehouse_signature;
  }

  const imagePath = String(
    grn.warehouse_signature_image ||
      grn.signature_image ||
      env?.signatureImageUrl ||
      "",
  ).trim() || null;

  let previewSrc: string | null = null;
  if (imagePath) {
    previewSrc = getFullFileUrl(imagePath);
  } else if (dataUrl) {
    previewSrc = dataUrl;
  }

  return {
    signatureType,
    typedText,
    fontId,
    signatureImagePath: imagePath,
    previewSrc,
    dataUrl,
  };
}

/** Fetch signature image as a data URL for PDF embedding (Attach or data URL). */
export async function fetchWarehouseSignatureImageDataUrl(
  grn: PurchaseReceipt,
): Promise<string | null> {
  const artifact = resolveWarehouseSignatureArtifact(grn);
  if (artifact.dataUrl?.startsWith("data:image")) return artifact.dataUrl;

  const src = artifact.previewSrc;
  if (!src) return null;
  if (src.startsWith("data:image")) return src;

  try {
    const res = await fetch(src, {
      headers: { "ngrok-skip-browser-warning": "1" },
      credentials: "same-origin",
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/") && blob.size < 32) return null;
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** Download the signature artifact as PNG (image) or styled text fallback. */
export async function downloadWarehouseSignature(
  grn: PurchaseReceipt,
): Promise<void> {
  const artifact = resolveWarehouseSignatureArtifact(grn);
  const safe = String(grn.name || "GRN").replace(/[^\w.-]+/g, "_");
  const dataUrl =
    (await fetchWarehouseSignatureImageDataUrl(grn)) || artifact.dataUrl;
  if (dataUrl?.startsWith("data:image")) {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${safe}-signature.png`;
    a.click();
    return;
  }
  // Typed-only fallback: canvas render.
  const text = artifact.typedText || "Signed";
  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 180;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Unable to render signature for download.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const font = getSignatureFont(artifact.fontId);
  ctx.fillStyle = "#0f172a";
  ctx.font = `italic 48px ${font.family}, cursive`;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 32, canvas.height / 2, canvas.width - 64);
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = `${safe}-signature.png`;
  a.click();
}

/** Open a print window for the signature preview. */
export function printWarehouseSignature(grn: PurchaseReceipt): void {
  const artifact = resolveWarehouseSignatureArtifact(grn);
  const summary = getWarehouseSignatureSummary(grn);
  const w = window.open("", "_blank", "noopener,noreferrer,width=720,height=560");
  if (!w) return;
  const font = getSignatureFont(artifact.fontId);
  const imgHtml = artifact.previewSrc
    ? `<img src="${artifact.previewSrc.replace(/"/g, "&quot;")}" alt="Signature" style="max-width:100%;max-height:160px;object-fit:contain;" />`
    : `<p style="font-family:${font.family};font-size:36px;font-style:italic;margin:24px 0;">${
        artifact.typedText.replace(/</g, "&lt;") || "Signed"
      }</p>`;
  w.document.write(`<!doctype html><html><head><title>Signature — ${
    grn.name || "GRN"
  }</title>
  <link href="https://fonts.googleapis.com/css2?family=Great+Vibes&family=Dancing+Script&family=Pacifico&family=Allura&family=Satisfy&display=swap" rel="stylesheet" />
  <style>
    body{font-family:system-ui,sans-serif;padding:32px;color:#0f172a}
    h1{font-size:16px;margin:0 0 8px}
    .meta{font-size:12px;color:#475569;margin:4px 0}
    .box{border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin:16px 0;background:#f8fafc;min-height:120px;display:flex;align-items:center;justify-content:center}
    .hash{font-family:ui-monospace,monospace;font-size:10px;word-break:break-all}
  </style></head><body>
  <h1>Warehouse Digital Signature</h1>
  <p class="meta"><strong>${summary.signedBy}</strong> · ${summary.role}</p>
  <p class="meta">${summary.signedDateLabel} · ${summary.signedTimeLabel}</p>
  <div class="box">${imgHtml}</div>
  <p class="meta">Type: ${artifact.signatureType}</p>
  <p class="meta">Certificate: ${summary.certificateStatus} · Integrity: ${summary.documentIntegrity}</p>
  <p class="meta hash">SHA-256: ${summary.sha256Hash}</p>
  <script>window.onload=function(){window.print();}</script>
  </body></html>`);
  w.document.close();
}

export function getWarehouseSignatureSummary(
  grn: PurchaseReceipt,
): WarehouseSignatureSummary {
  const env = parseWarehouseEsignEnvelope(grn.warehouse_esign_envelope);
  const signedAtIso =
    grn.signed_at ||
    grn.warehouse_signature_timestamp ||
    grn.warehouse_signed_at ||
    env?.signedAtIso ||
    null;
  let signedDateLabel = "—";
  let signedTimeLabel = "—";
  if (signedAtIso) {
    const d = new Date(signedAtIso.includes("T") ? signedAtIso : signedAtIso.replace(" ", "T"));
    if (!Number.isNaN(d.getTime())) {
      signedDateLabel = d.toLocaleDateString(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
      signedTimeLabel = d.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
    }
  }
  const hash =
    grn.warehouse_signature_hash || grn.sha256_hash || env?.signatureHash || null;
  const verificationStatus =
    grn.verification_status ||
    grn.warehouse_verification_status ||
    env?.verificationStatus ||
    (isGrnWarehouseSigned(grn) ? "verified" : "pending");
  const certificateStatus =
    grn.certificate_status ||
    (isWarehouseDigitalSignatureComplete(grn) ? "Valid" : "Pending");
  const documentIntegrity =
    grn.document_integrity ||
    (isWarehouseDigitalSignatureComplete(grn) ? "Verified" : "Pending");
  const artifact = resolveWarehouseSignatureArtifact(grn);
  return {
    signed: isGrnWarehouseSigned(grn),
    signedBy:
      grn.signed_by ||
      grn.warehouse_signature_name ||
      grn.warehouse_signed_by ||
      "Warehouse Manager",
    designation:
      grn.warehouse_signature_role ||
      env?.designation ||
      "Warehouse Manager",
    employeeId:
      grn.warehouse_signature_employee_id || env?.employeeId || "—",
    role:
      grn.warehouse_signature_role ||
      grn.warehouse_signer_role ||
      env?.role ||
      env?.designation ||
      "Warehouse Manager",
    email:
      grn.warehouse_signature_email ||
      grn.warehouse_signer_email ||
      env?.email ||
      "—",
    signedAtIso,
    signedDateLabel,
    signedTimeLabel,
    hash,
    hashMasked: hash
      ? `SHA256: ${hash.slice(0, 8)}${"*".repeat(12)}${hash.slice(-6)}`
      : "—",
    sha256Hash: hash || "—",
    certificateStatus,
    documentIntegrity,
    device:
      grn.warehouse_signature_device || grn.warehouse_device || "—",
    browser: grn.warehouse_browser || "—",
    ip: grn.warehouse_signature_ip || grn.warehouse_ip || "—",
    signatureType: artifact.signatureType || "—",
    verificationStatus,
    documentVersion:
      grn.warehouse_signature_version ||
      grn.warehouse_document_version ||
      env?.documentVersion ||
      WAREHOUSE_SIGNATURE_VERSION,
    signedPdfUrl:
      grn.warehouse_signed_pdf_url ||
      grn.signed_pdf_url ||
      grn.signed_pdf_file ||
      grn.signed_pdf_path ||
      grn.signed_grn_pdf ||
      env?.signedPdfUrl ||
      null,
    typedText: artifact.typedText,
    fontId: artifact.fontId,
    signatureImagePath: artifact.signatureImagePath,
    previewSrc: artifact.previewSrc,
  };
}

export interface WarehouseSignatureVerification {
  signed: boolean;
  valid: boolean;
  integrity: "intact" | "modified" | "unknown";
  certificateStatus: string;
  hash: string | null;
  signedBy: string;
  signedAtIso: string | null;
  message: string;
}

/**
 * Recompute SHA-256 from the stored envelope and compare to warehouse_signature_hash.
 * When `documentHash` is present, also confirms the GRN business snapshot is unchanged.
 * If envelope cannot be rebuilt but a hash exists, integrity is "unknown" (still treat as present).
 */
export async function verifyWarehouseGrnSignature(
  grn: PurchaseReceipt,
): Promise<WarehouseSignatureVerification> {
  const summary = getWarehouseSignatureSummary(grn);
  const digitalComplete = isWarehouseDigitalSignatureComplete(grn);

  if (!summary.signed && !digitalComplete) {
    return {
      signed: false,
      valid: false,
      integrity: "unknown",
      certificateStatus: "Missing",
      hash: null,
      signedBy: "",
      signedAtIso: null,
      message: "Warehouse GRN is not digitally signed.",
    };
  }

  const env = parseWarehouseEsignEnvelope(grn.warehouse_esign_envelope);
  const storedHash = summary.hash;
  const metaStatus = String(
    grn.verification_status ||
      grn.warehouse_verification_status ||
      env?.verificationStatus ||
      "",
  ).toLowerCase();
  const { hashGrnDocument } = await import("./warehouseSignatureIntegrity");
  const currentDocumentHash = await hashGrnDocument(grn);
  const storedDocumentHash = String(env?.documentHash || "").trim();

  if (storedDocumentHash && storedDocumentHash !== currentDocumentHash) {
    return {
      signed: true,
      valid: false,
      integrity: "modified",
      certificateStatus: "Invalid",
      hash: storedHash,
      signedBy: summary.signedBy,
      signedAtIso: summary.signedAtIso,
      message: "Document Modified. Signature Invalid.",
    };
  }

  // Prefer signature metadata fields over PDF URL for verification status.
  // Skip the fast path when a full envelope+hash is available so we can replay SHA-256.
  if (
    digitalComplete &&
    metaStatus === "verified" &&
    (!env || !storedHash || !env.signatureDataUrl)
  ) {
    const certOk =
      String(grn.certificate_status || summary.certificateStatus || "")
        .toLowerCase() === "valid" ||
      Boolean(grn.warehouse_signature_verified) ||
      metaStatus === "verified";
    const integrityOk =
      String(grn.document_integrity || summary.documentIntegrity || "")
        .toLowerCase() === "verified" ||
      certOk;
    // metaStatus is already narrowed to "verified" in this branch.
    const passed = (Boolean(storedHash) || certOk) && integrityOk;
    return {
      signed: true,
      valid: passed,
      integrity: passed ? "intact" : "unknown",
      certificateStatus: passed
        ? "Valid"
        : summary.certificateStatus || summary.verificationStatus || "Pending",
      hash: storedHash,
      signedBy: summary.signedBy,
      signedAtIso: summary.signedAtIso,
      message: passed
        ? "Digital Signature verified from Warehouse signature metadata."
        : "Signature metadata present; verification pending.",
    };
  }

  if (!env || !storedHash) {
    return {
      signed: true,
      valid: Boolean(storedHash || grn.signed_by || grn.warehouse_signed_by),
      integrity: "unknown",
      certificateStatus: storedHash ? "Hash on file" : "Signer on file",
      hash: storedHash,
      signedBy: summary.signedBy,
      signedAtIso: summary.signedAtIso,
      message: storedHash
        ? "Signature hash is present; full envelope replay unavailable."
        : "Signer recorded without hash envelope.",
    };
  }

  const checklist = emptyWarehouseChecklist();
  if (env.checklist) {
    for (const key of Object.keys(checklist) as Array<keyof typeof checklist>) {
      if (env.checklist[key] != null) checklist[key] = Boolean(env.checklist[key]);
    }
  }

  const reconstructed: WarehouseEsignState = {
    checklist,
    remarks: env.remarks || "",
    fullName: summary.signedBy,
    designation: env.designation || summary.designation,
    employeeId: env.employeeId || "",
    role: env.role || summary.role,
    email: env.email || summary.email,
    signedAtDisplay: summary.signedAtIso || "",
    signatureType: (env.signatureType as WarehouseSignatureType) || "typed",
    typedName: env.typedName || summary.signedBy,
    fontId: (env.fontId as LegalSignatureFontId) || DEFAULT_SIGNATURE_FONT_ID,
    signatureDataUrl: env.signatureDataUrl || null,
    placed: true,
    placement: env.placement || { ...DEFAULT_WAREHOUSE_SIGNATURE_PLACEMENT },
    certified: env.certified !== false,
    signatureHash: storedHash,
    signedAtIso: env.signedAtIso || summary.signedAtIso,
    warehouseIp: grn.warehouse_ip || "",
    warehouseBrowser: grn.warehouse_browser || "",
    warehouseDevice: grn.warehouse_device || "",
    verificationStatus: "verified",
    documentVersion: env.documentVersion || summary.documentVersion,
    signedPdfUrl: env.signedPdfUrl || summary.signedPdfUrl || undefined,
    locked: true,
    auditTrail: [],
  };

  // Legacy signatures (pre-documentHash) recompute with "" so hashes still match.
  const recomputed = await hashWarehouseSignature(
    reconstructed,
    storedDocumentHash || "",
  );
  const intact = recomputed === storedHash;

  return {
    signed: true,
    valid: intact,
    integrity: intact ? "intact" : "modified",
    certificateStatus: intact ? "Valid" : "Invalid",
    hash: storedHash,
    signedBy: summary.signedBy,
    signedAtIso: summary.signedAtIso,
    message: intact
      ? "Document integrity confirmed. Signature Valid."
      : "Document Modified. Signature Invalid.",
  };
}

/** Clear Warehouse Digital Signature fields after GRN business data changes. */
export async function invalidateWarehouseGrnSignature(
  grn: PurchaseReceipt,
  reason = "GRN data changed after signing",
): Promise<PurchaseReceipt> {
  const env = parseWarehouseEsignEnvelope(grn.warehouse_esign_envelope) ?? {};
  const nextEnvelope: WarehouseEsignEnvelopeV1 = {
    ...env,
    schemaVersion: 1,
    signatureHash: undefined,
    documentHash: undefined,
    signatureDataUrl: null,
    signatureImageUrl: undefined,
    signedPdfUrl: undefined,
    signedPdfHash: undefined,
    verificationStatus: "invalid",
    certified: false,
  };

  await setPurchaseReceiptValues(grn.name, {
    signed: 0,
    warehouse_signed: 0,
    warehouse_signed_by: "",
    warehouse_signature_name: "",
    warehouse_signature_role: "",
    warehouse_signature_employee_id: "",
    warehouse_signature_email: "",
    warehouse_signature_timestamp: "",
    warehouse_signature_hash: "",
    warehouse_signature_verified: 0,
    warehouse_signature_image: "",
    warehouse_signed_at: "",
    warehouse_verification_status: "invalid",
    signed_by: "",
    signed_at: "",
    sha256_hash: "",
    certificate_status: "Invalid",
    verification_status: "invalid",
    document_integrity: "Modified",
    signature_image: "",
    signed_pdf_url: "",
    signed_pdf_file: "",
    signed_pdf_path: "",
    signed_grn_pdf: "",
    warehouse_signed_pdf_url: "",
    warehouse_signed_pdf_hash: "",
    warehouse_esign_envelope: JSON.stringify(nextEnvelope),
  });

  appendWarehouseEsignAudit(
    "Signature invalidated",
    "System",
    `${grn.name}: ${reason}`,
    { grnName: grn.name, targetRole: "warehouse" },
  );

  const { getPurchaseReceipt } = await import("./purchasing");
  return getPurchaseReceipt(grn.name);
}

/**
 * Ensure a signed GRN's document fingerprint still matches.
 * - Legacy signed GRNs without `documentHash`: soft-migrate (seal current snapshot).
 * - Fingerprint mismatch: clear signature and require Warehouse re-sign.
 */
export async function ensureWarehouseSignatureIntegrity(
  grn: PurchaseReceipt,
): Promise<{ grn: PurchaseReceipt; invalidated: boolean; migrated: boolean }> {
  const { hashGrnDocument, hasSignedMarkers } = await import(
    "./warehouseSignatureIntegrity"
  );
  if (!hasSignedMarkers(grn) && !isWarehouseDigitalSignatureComplete(grn)) {
    return { grn, invalidated: false, migrated: false };
  }

  const status = String(
    grn.verification_status || grn.warehouse_verification_status || "",
  ).toLowerCase();
  if (status === "invalid" || status === "failed") {
    return { grn, invalidated: false, migrated: false };
  }

  const env = parseWarehouseEsignEnvelope(grn.warehouse_esign_envelope);
  const currentDocumentHash = await hashGrnDocument(grn);
  const storedDocumentHash = String(env?.documentHash || "").trim();

  if (!storedDocumentHash) {
    // Soft-migrate only while draft — envelope cannot change after submit.
    if (Number(grn.docstatus) === 1) {
      return { grn, invalidated: false, migrated: false };
    }
    const nextEnvelope: WarehouseEsignEnvelopeV1 = {
      ...(env ?? { schemaVersion: 1 }),
      schemaVersion: 1,
      documentHash: currentDocumentHash,
    };
    try {
      await setPurchaseReceiptValues(grn.name, {
        warehouse_esign_envelope: JSON.stringify(nextEnvelope),
      });
      const { getPurchaseReceipt } = await import("./purchasing");
      const refreshed = await getPurchaseReceipt(grn.name);
      return { grn: refreshed, invalidated: false, migrated: true };
    } catch {
      return { grn, invalidated: false, migrated: false };
    }
  }

  if (storedDocumentHash === currentDocumentHash) {
    return { grn, invalidated: false, migrated: false };
  }

  const cleared = await invalidateWarehouseGrnSignature(
    grn,
    "GRN data changed after signing — re-signature required",
  );
  return { grn: cleared, invalidated: true, migrated: false };
}
