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
  | "Quotation Status"
  | "Invoice Status"
  | "Payment Status";

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
  admin: new Set(["System", "Audit", "Users", "Workflow"]),
  procurement: new Set([
    "RFQ",
    "Supplier Quotation",
    "AI Analysis",
    "Legal Review",
    "Finance Approval",
    "Purchase Order",
  ]),
  legal: new Set(["Legal Review", "Supplier Documents", "Compliance"]),
  finance: new Set([
    "Voucher",
    "Invoice",
    "Payment",
    "Budget",
    "Outstanding Payables",
  ]),
  warehouse: new Set(["PO Ready for GRN", "GRN", "Inventory"]),
};

export const SUPPLIER_ALLOWED_MODULES = new Set<NotificationModule>([
  "RFQ Invitation",
  "Quotation Status",
  "Purchase Order",
  "Invoice Status",
  "Payment Status",
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
]);

export const PROCUREMENT_MODULES = new Set<NotificationModule>([
  "RFQ",
  "Supplier Quotation",
  "AI Analysis",
  "Legal Review",
  "Finance Approval",
  "Purchase Order",
]);
