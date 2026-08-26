import type { AppRole } from "../config/roles";

/** Enterprise notification modules aligned to role workspaces. */
export type NotificationModule =
  | "System"
  | "Audit"
  | "Users"
  | "Workflow"
  | "RFQ"
  | "Supplier Quotation"
  | "AI Analysis"
  | "Legal Review"
  | "Finance Approval"
  | "Purchase Order"
  | "Supplier Documents"
  | "Compliance"
  | "Voucher"
  | "Invoice"
  | "Payment"
  | "Budget"
  | "Outstanding Payables"
  | "PO Ready for GRN"
  | "GRN"
  | "Inventory"
  | "RFQ Invitation"
  | "RFI"
  | "RFI Invitation"
  | "RFP"
  | "RFP Invitation"
  | "Quotation Status"
  | "Invoice Status"
  | "Payment Status"
  | "Live Auction"
  | "SLA"
  | "Material Issue Receipt";

export type NotificationTargetRole = AppRole | "supplier";

export interface EnterpriseNotification {
  id: string;
  title: string;
  description: string;
  module: NotificationModule;
  event_type: string;
  target_role: NotificationTargetRole;
  target_user?: string;
  supplier_id?: string;
  document_type: string;
  document_name: string;
  /** In-app navigation target — never the generic dashboard. */
  route_path: string;
  created_at: string;
  read_status: boolean;
  email_sent?: boolean;
}

export interface NotificationViewerContext {
  role: NotificationTargetRole;
  userEmail?: string;
  userId?: string;
  supplierId?: string;
}

export type CreateNotificationInput = Omit<
  EnterpriseNotification,
  "id" | "created_at" | "read_status"
> & {
  id?: string;
  created_at?: string;
  read_status?: boolean;
};

/** Modules each internal role may see (admin is system-only). */
export const ROLE_ALLOWED_MODULES: Record<
  Exclude<NotificationTargetRole, "supplier">,
  ReadonlySet<NotificationModule>
> = {
  // SLA is temporarily Admin-only. SLA notifications stay in the admin allow-list
  // and are removed from every non-admin role below (UI/role-based hide only —
  // no notification data is deleted).
  admin: new Set(["System", "Audit", "Users", "Workflow", "SLA"]),
  procurement: new Set([
    "RFQ",
    "RFI",
    "RFP",
    "Supplier Quotation",
    "AI Analysis",
    "Legal Review",
    "Finance Approval",
    "Purchase Order",
    "Budget",
  ]),
  /**
   * Procurement Team — PO operations + GRN monitoring only.
   * No Invoice / Voucher / RFQ / Budget / Legal / AI modules.
   */
  procurement_team: new Set(["Purchase Order", "PO Ready for GRN", "GRN"]),
  legal: new Set(["Legal Review", "Supplier Documents", "Compliance"]),
  finance: new Set([
    "Voucher",
    "Invoice",
    "Payment",
    "Budget",
    "Outstanding Payables",
  ]),
  finance_executive: new Set(["Budget"]),
  warehouse: new Set([
    "PO Ready for GRN",
    "GRN",
    "Inventory",
    "Material Issue Receipt",
  ]),
  department: new Set(["Purchase Order", "Material Issue Receipt"]),
  executive: new Set(["System", "Audit", "Workflow", "Budget"]),
  manufacturing: new Set(["Inventory"]),
  engineer: new Set(["Workflow", "System"]),
  engineering: new Set(["Workflow", "System"]),
  operations: new Set(["Workflow", "System"]),
  quality: new Set(["Workflow", "System"]),
  program_manager: new Set(["Workflow", "System"]),
};

export const SUPPLIER_ALLOWED_MODULES = new Set<NotificationModule>([
  "RFQ Invitation",
  "RFI Invitation",
  "RFP Invitation",
  "Quotation Status",
  "Purchase Order",
  "Invoice Status",
  "Payment Status",
  "Live Auction",
]);

export const FINANCE_MODULES = new Set<NotificationModule>([
  "Voucher",
  "Invoice",
  "Payment",
  "Budget",
  "Outstanding Payables",
]);

export const WAREHOUSE_MODULES = new Set<NotificationModule>([
  "PO Ready for GRN",
  "GRN",
  "Inventory",
  "Material Issue Receipt",
]);

export const PROCUREMENT_MODULES = new Set<NotificationModule>([
  "RFQ",
  "RFI",
  "RFP",
  "Supplier Quotation",
  "AI Analysis",
  "Legal Review",
  "Finance Approval",
  "Purchase Order",
]);
