/**
 * Material Issue Receipt — Warehouse ↔ Department digital receipt.
 * Isolated from GRN / Procurement / Supplier flows. No DocType changes.
 */

export type MaterialIssueReceiptStatus =
  | "Waiting Warehouse Signature"
  | "Pending Department Acceptance"
  | "Confirmed"
  | "Acceptance Rejected";

/** Legacy status strings that may exist in localStorage. */
export type LegacyMaterialIssueReceiptStatus =
  | "Waiting Department Signature"
  | "Material Receipt Confirmed"
  | "Waiting for Department Acceptance";

export type MaterialIssueReceiptSignerRole =
  | "Warehouse Manager"
  | "Department User";

export interface MaterialIssueReceiptLine {
  item_code: string;
  item_name: string;
  uom: string;
  requested_qty: number;
  issued_qty: number;
  remaining_qty: number;
  remarks?: string;
}

export interface MaterialIssueAcceptanceChecklist {
  quantity_verified: boolean;
  material_good_condition: boolean;
  packaging_verified: boolean;
  no_visible_damage: boolean;
}

export const EMPTY_ACCEPTANCE_CHECKLIST: MaterialIssueAcceptanceChecklist = {
  quantity_verified: false,
  material_good_condition: false,
  packaging_verified: false,
  no_visible_damage: false,
};

export const ACCEPTANCE_CHECKLIST_LABELS: Record<
  keyof MaterialIssueAcceptanceChecklist,
  string
> = {
  quantity_verified: "Quantity Verified",
  material_good_condition: "Material Received in Good Condition",
  packaging_verified: "Packaging Verified",
  no_visible_damage: "No Visible Damage",
};

export function isAcceptanceChecklistComplete(
  checklist?: MaterialIssueAcceptanceChecklist | null,
): boolean {
  if (!checklist) return false;
  return (
    checklist.quantity_verified &&
    checklist.material_good_condition &&
    checklist.packaging_verified &&
    checklist.no_visible_damage
  );
}

export interface MaterialIssueReceiptSignature {
  signer_name: string;
  role: MaterialIssueReceiptSignerRole;
  signature_type: "drawn" | "typed";
  signature_data_url?: string | null;
  typed_name?: string;
  signed_at: string;
  sha256_hash: string;
  document_hash: string;
  verification_status: "verified" | "invalid" | "pending";
  ip_address?: string;
  browser?: string;
  device?: string;
  document_version: string;
}

export interface MaterialIssueReceiptAuditEntry {
  id: string;
  action: string;
  at: string;
  by: string;
  role?: string;
  detail?: string;
  hash?: string;
  ip_address?: string;
  browser?: string;
  device?: string;
  document_version?: string;
}

export interface MaterialIssueReceiptTimelineStep {
  key: string;
  label: string;
  at?: string;
  done: boolean;
  current: boolean;
}

export interface MaterialIssueReceipt {
  id: string;
  /** Unique Material Issue Receipt number (MIR-…). */
  issue_number: string;
  /** Linked ERPNext Stock Entry (Material Issue). */
  stock_entry: string;
  mr_name: string;
  department: string;
  /** Issuing company (from Material Request / Stock Entry). */
  company?: string;
  warehouse: string;
  issue_date: string;
  issued_by: string;
  received_by: string;
  issue_type: string;
  remarks?: string;
  status: MaterialIssueReceiptStatus;
  items: MaterialIssueReceiptLine[];
  warehouse_signature?: MaterialIssueReceiptSignature;
  department_signature?: MaterialIssueReceiptSignature;
  acceptance_checklist?: MaterialIssueAcceptanceChecklist;
  department_remarks?: string;
  rejection_reason?: string;
  rejected_at?: string;
  rejected_by?: string;
  /**
   * Frozen immutable business payload at Warehouse Signature time.
   * Department acceptance must never alter this snapshot.
   */
  business_snapshot?: {
    issue_number: string;
    mr_name: string;
    company: string;
    warehouse: string;
    received_by: string;
    issue_type: string;
    issue_date: string;
    items: Array<{
      item_code: string;
      requested_qty: number;
      issued_qty: number;
      remaining_qty: number;
    }>;
  };
  /** Canonical warehouse business hash — immutable after warehouse sign. */
  document_hash: string;
  document_version: string;
  verification_token: string;
  created_at: string;
  modified: string;
  confirmed_at?: string;
  warehouse_signed_at?: string;
  department_signed_at?: string;
  audit_trail: MaterialIssueReceiptAuditEntry[];
}

export interface CreateMaterialIssueReceiptInput {
  /** ERPNext Stock Entry name produced by Material Issue. */
  stock_entry: string;
  mr_name: string;
  department: string;
  company?: string;
  warehouse: string;
  issued_by: string;
  /** Receiver role / name shown on the receipt. */
  receiver: string;
  issue_type: string;
  remarks?: string;
  issue_date?: string;
  lines: Array<{
    item_code: string;
    item_name?: string;
    uom?: string;
    required_qty?: number;
    issued_qty: number;
    remarks?: string;
  }>;
}

export function normalizeReceiptStatus(
  raw: string | null | undefined,
): MaterialIssueReceiptStatus {
  const v = (raw || "").trim();
  if (
    v === "Waiting Department Signature" ||
    v === "Waiting for Department Acceptance"
  ) {
    return "Pending Department Acceptance";
  }
  if (v === "Material Receipt Confirmed") return "Confirmed";
  if (
    v === "Waiting Warehouse Signature" ||
    v === "Pending Department Acceptance" ||
    v === "Confirmed" ||
    v === "Acceptance Rejected"
  ) {
    return v;
  }
  return "Waiting Warehouse Signature";
}

/** Human label for department UI ("Waiting for Your Acceptance"). */
export function receiptStatusDisplayLabel(
  status: MaterialIssueReceiptStatus,
  audience: "warehouse" | "department" = "warehouse",
): string {
  if (status === "Pending Department Acceptance") {
    return audience === "department"
      ? "Waiting for Your Acceptance"
      : "Waiting for Department Acceptance";
  }
  if (status === "Confirmed") return "Receipt Confirmed";
  return status;
}

export function buildReceiptTimeline(
  receipt: MaterialIssueReceipt,
): MaterialIssueReceiptTimelineStep[] {
  const status = normalizeReceiptStatus(receipt.status);
  const steps: Array<{
    key: string;
    label: string;
    at?: string;
    done: boolean;
  }> = [
    {
      key: "mr_created",
      label: "Material Request Created",
      at: receipt.created_at,
      done: Boolean(receipt.mr_name),
    },
    {
      key: "warehouse_review",
      label: "Warehouse Review",
      at: receipt.created_at,
      done: Boolean(receipt.stock_entry || receipt.created_at),
    },
    {
      key: "material_issued",
      label: "Material Issued",
      at: receipt.created_at,
      done: Boolean(receipt.stock_entry),
    },
    {
      key: "warehouse_signed",
      label: "Warehouse Signed",
      at: receipt.warehouse_signed_at,
      done: Boolean(receipt.warehouse_signature),
    },
    {
      key: "waiting_dept",
      label: "Waiting Department Acceptance",
      at: receipt.warehouse_signed_at,
      done:
        status === "Pending Department Acceptance" ||
        status === "Confirmed" ||
        status === "Acceptance Rejected",
    },
    {
      key: "department_signed",
      label:
        status === "Acceptance Rejected"
          ? "Acceptance Rejected"
          : "Department Signed",
      at: receipt.department_signed_at || receipt.rejected_at,
      done: status === "Confirmed" || status === "Acceptance Rejected",
    },
    {
      key: "completed",
      label: "Completed",
      at: receipt.confirmed_at,
      done: status === "Confirmed",
    },
  ];

  let currentIdx = steps.findIndex((s) => !s.done);
  if (currentIdx < 0) currentIdx = steps.length - 1;
  if (status === "Acceptance Rejected") {
    currentIdx = steps.findIndex((s) => s.key === "department_signed");
  }

  return steps.map((s, i) => ({
    ...s,
    current: i === currentIdx,
  }));
}
