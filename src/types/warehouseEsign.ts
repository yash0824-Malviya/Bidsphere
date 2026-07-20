/** Warehouse Digital Signature (GRN E-Sign) types. */

import type { LegalSignatureFontId } from "./legalSignatureFonts";

export const WAREHOUSE_CHECKLIST_KEYS = [
  "goods_physically_received",
  "quantity_verified",
  "packaging_inspected",
  "no_visible_damage",
  "delivery_challan_verified",
  "vehicle_number_verified",
  "material_accepted_for_grn",
] as const;

export type WarehouseChecklistKey = (typeof WAREHOUSE_CHECKLIST_KEYS)[number];

export const WAREHOUSE_CHECKLIST_LABELS: Record<WarehouseChecklistKey, string> = {
  goods_physically_received: "Goods physically received",
  quantity_verified: "Quantity verified",
  packaging_inspected: "Packaging inspected",
  no_visible_damage: "No visible damage",
  delivery_challan_verified: "Delivery Challan Verified",
  vehicle_number_verified: "Vehicle Number Verified",
  material_accepted_for_grn: "Material accepted for GRN",
};

export type WarehouseSignatureType = "typed" | "drawn" | "uploaded";

export type WarehouseEsignAuditAction =
  | "Warehouse Signature Added"
  | "Warehouse Signature Removed"
  | "Warehouse Signature Updated"
  | "Warehouse signed GRN"
  | "Signed GRN generated"
  | "Signed PDF generated"
  | "Signed PDF stored"
  | "Signature image stored"
  | "Signed PDF missing"
  | "Signed PDF corrupted"
  | "Signature invalidated"
  | "GRN Submitted"
  | "Finance viewed signed GRN"
  | "Finance verified warehouse signature"
  | "Finance verified signature"
  | "Voucher created after signature verification"
  | "Voucher created"
  | "Voucher created using Admin Override"
  | "Voucher created using Demo Override";

/** Parsed envelope stored on Purchase Receipt.warehouse_esign_envelope */
export interface WarehouseEsignEnvelopeV1 {
  schemaVersion?: number;
  checklist?: Record<string, boolean>;
  remarks?: string;
  designation?: string;
  employeeId?: string;
  role?: string;
  email?: string;
  placement?: WarehouseSignaturePlacement;
  typedName?: string;
  fontId?: LegalSignatureFontId | string;
  signatureType?: WarehouseSignatureType | string;
  signatureDataUrl?: string | null;
  signatureHash?: string;
  signedAtIso?: string;
  certified?: boolean;
  verificationStatus?: string;
  documentVersion?: string;
  signedPdfUrl?: string;
  signedPdfHash?: string;
  signatureImageUrl?: string;
  signatureAlgorithm?: string;
  /**
   * SHA-256 of the GRN business snapshot at sign time. When the live GRN
   * fingerprint no longer matches, the signature is treated as invalid.
   */
  documentHash?: string;
  /** Optional truncated audit copy stored with the envelope (best-effort). */
  auditTrail?: WarehouseEsignAuditEntry[];
}

export interface WarehouseSignaturePlacement {
  /** Normalized 0–1 relative to preview page box. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WarehouseEsignAuditEntry {
  id: string;
  action: WarehouseEsignAuditAction;
  at: string;
  by: string;
  detail?: string;
}

export interface WarehouseEsignState {
  checklist: Record<WarehouseChecklistKey, boolean>;
  remarks: string;
  fullName: string;
  designation: string;
  employeeId: string;
  role: string;
  email: string;
  signedAtDisplay: string;
  signatureType: WarehouseSignatureType | null;
  /** Typed name (may differ from fullName). */
  typedName: string;
  fontId: LegalSignatureFontId;
  /** data URL for drawn or uploaded signature image. */
  signatureDataUrl: string | null;
  placed: boolean;
  placement: WarehouseSignaturePlacement;
  certified: boolean;
  /** SHA-256 hex after finalize. */
  signatureHash: string | null;
  signedAtIso: string | null;
  warehouseIp: string;
  warehouseBrowser: string;
  warehouseDevice: string;
  verificationStatus: "pending" | "verified" | "invalid";
  documentVersion: string;
  signedPdfUrl?: string;
  locked: boolean;
  auditTrail: WarehouseEsignAuditEntry[];
}

export const DEFAULT_WAREHOUSE_SIGNATURE_PLACEMENT: WarehouseSignaturePlacement = {
  x: 0.08,
  y: 0.72,
  w: 0.42,
  h: 0.16,
};

export function emptyWarehouseChecklist(): Record<WarehouseChecklistKey, boolean> {
  return {
    goods_physically_received: false,
    quantity_verified: false,
    packaging_inspected: false,
    no_visible_damage: false,
    delivery_challan_verified: false,
    vehicle_number_verified: false,
    material_accepted_for_grn: false,
  };
}

export function isChecklistComplete(
  checklist: Record<WarehouseChecklistKey, boolean>,
): boolean {
  return WAREHOUSE_CHECKLIST_KEYS.every((k) => checklist[k]);
}

export function hasSignatureArtifact(state: WarehouseEsignState): boolean {
  if (state.signatureType === "typed") {
    return state.typedName.trim().length >= 2;
  }
  if (state.signatureType === "drawn" || state.signatureType === "uploaded") {
    return Boolean(state.signatureDataUrl);
  }
  return false;
}

export function isWarehouseEsignComplete(state: WarehouseEsignState): boolean {
  return (
    isChecklistComplete(state.checklist) &&
    hasSignatureArtifact(state) &&
    state.placed &&
    state.certified &&
    Boolean(state.signatureHash)
  );
}

export function createInitialWarehouseEsignState(input: {
  fullName: string;
  designation?: string;
  employeeId?: string;
  role?: string;
  email?: string;
}): WarehouseEsignState {
  const now = new Date();
  return {
    checklist: emptyWarehouseChecklist(),
    remarks: "",
    fullName: input.fullName,
    designation: input.designation || "Warehouse Manager",
    employeeId: input.employeeId || "",
    role: input.role || "Warehouse Manager",
    email: input.email || "",
    signedAtDisplay: now.toLocaleString(),
    signatureType: null,
    typedName: input.fullName,
    fontId: "great-vibes",
    signatureDataUrl: null,
    placed: false,
    placement: { ...DEFAULT_WAREHOUSE_SIGNATURE_PLACEMENT },
    certified: false,
    signatureHash: null,
    signedAtIso: null,
    warehouseIp: "",
    warehouseBrowser: "",
    warehouseDevice: "",
    verificationStatus: "pending",
    documentVersion: "1.0",
    locked: false,
    auditTrail: [],
  };
}
