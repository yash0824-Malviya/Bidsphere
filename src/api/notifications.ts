/**
 * Enterprise role-based notification system.
 *
 * Single localStorage store with role/module filtering, deduplication,
 * and navigation targets on every notification.
 */

import { APP_NAME } from "../config/branding";
import type {
  CreateNotificationInput,
  EnterpriseNotification,
  NotificationModule,
  NotificationTargetRole,
  NotificationViewerContext,
} from "../types/notification";
import {
  dedupeNotifications,
  filterNotificationsForViewer,
  notificationDedupeKey,
  countUnread as countUnreadVisible,
} from "../utils/notificationAccess";
import { useVoucherSyncStore } from "../store/voucherSyncStore";

export type NotificationType =
  | "rfq_created"
  | "quotation_submitted"
  | "legal_review_required"
  | "finance_review_required"
  | "po_created"
  | "payment_released"
  | "grn_created"
  | "invoice_created"
  | "budget_exceeded"
  | "system";

/** @deprecated Use EnterpriseNotification */
export type AppNotification = EnterpriseNotification;

export interface EmailTemplate {
  id: NotificationType;
  name: string;
  subject: string;
  body: string;
  triggerEvent: string;
  recipients: string;
  enabled: boolean;
}

export interface EmailConfig {
  smtpHost: string;
  smtpPort: number;
  emailAddress: string;
  password: string;
  senderName: string;
  enableNotifications: boolean;
  enableEmailDigest: boolean;
}

const NOTIF_KEY = "bidsphere-enterprise-notifications";
const LEGACY_NOTIF_KEY = "bidsphere-notifications";
const LEGACY_VOUCHER_NOTIF_KEY = "netlink_notifications";
const EMAIL_CFG_KEY = "bidsphere-email-config";
const MIGRATION_KEY = "bidsphere-notifications-v2-migrated";

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function persist(list: EnterpriseNotification[]) {
  localStorage.setItem(
    NOTIF_KEY,
    JSON.stringify(dedupeNotifications(list).slice(0, 300))
  );
  try {
    useVoucherSyncStore.getState().bump();
  } catch {
    /* store not ready */
  }
}

function migrateLegacyStores(): EnterpriseNotification[] {
  const migrated: EnterpriseNotification[] = [];

  try {
    const raw = localStorage.getItem(LEGACY_NOTIF_KEY);
    if (raw) {
      const old = JSON.parse(raw) as Array<Record<string, unknown>>;
      if (Array.isArray(old)) {
        for (const n of old) {
          const converted = legacyWorkflowToEnterprise(n);
          if (converted) migrated.push(converted);
        }
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const raw = localStorage.getItem(LEGACY_VOUCHER_NOTIF_KEY);
    if (raw) {
      const old = JSON.parse(raw) as Array<Record<string, unknown>>;
      if (Array.isArray(old)) {
        for (const n of old) {
          const converted = legacyVoucherToEnterprise(n);
          if (converted) migrated.push(converted);
        }
      }
    }
  } catch {
    /* ignore */
  }

  localStorage.setItem(MIGRATION_KEY, new Date().toISOString());
  return migrated;
}

function legacyWorkflowToEnterprise(
  n: Record<string, unknown>
): EnterpriseNotification | null {
  const type = String(n.type ?? "system");
  const role = String(n.recipientRole ?? "procurement") as NotificationTargetRole;
  const docId = String(n.documentId ?? "");
  const mapping = WORKFLOW_TYPE_MAP[type];
  if (!mapping) return null;
  return {
    id: String(n.id ?? uid()),
    title: String(n.title ?? mapping.title),
    description: String(n.message ?? ""),
    module: mapping.module,
    event_type: type,
    target_role: role,
    document_type: String(n.documentType ?? mapping.document_type),
    document_name: docId,
    route_path: String(n.to ?? mapping.route(docId)),
    created_at: String(n.timestamp ?? new Date().toISOString()),
    read_status: Boolean(n.read),
    email_sent: Boolean(n.emailSent),
  };
}

function legacyVoucherToEnterprise(
  n: Record<string, unknown>
): EnterpriseNotification | null {
  const forRole = String(n.for ?? "finance") as NotificationTargetRole;
  const voucherId = String(n.voucher_id ?? "");
  const message = String(n.message ?? "");
  const module = voucherModuleForRole(forRole, message);
  return {
    id: String(n.id ?? uid()),
    title: module === "Voucher" ? `Voucher ${voucherId}` : `Voucher update`,
    description: message,
    module,
    event_type: "voucher_workflow",
    target_role: forRole,
    document_type: "Voucher",
    document_name: voucherId,
    route_path: voucherRoute(forRole, voucherId),
    created_at: String(n.timestamp ?? new Date().toISOString()),
    read_status: Boolean(n.read),
  };
}

function voucherModuleForRole(
  role: NotificationTargetRole,
  message: string
): NotificationModule {
  if (role === "finance") {
    if (/payment/i.test(message)) return "Payment";
    if (/invoice/i.test(message)) return "Invoice";
    return "Voucher";
  }
  if (role === "supplier") {
    if (/payment/i.test(message)) return "Payment Status";
    return "Invoice Status";
  }
  return "Purchase Order";
}

function voucherRoute(role: NotificationTargetRole, voucherId: string): string {
  const enc = encodeURIComponent(voucherId);
  if (role === "supplier") return `/supplier/vouchers/${enc}`;
  if (role === "procurement") return `/p2p/vouchers/${enc}`;
  return `/p2p/vouchers/${enc}`;
}

const WORKFLOW_TYPE_MAP: Record<
  string,
  {
    module: NotificationModule;
    title: string;
    document_type: string;
    route: (id: string) => string;
  }
> = {
  rfq_created: {
    module: "RFQ",
    title: "RFQ Created",
    document_type: "Request for Quotation",
    route: (id) => `/sourcing/rfq/${encodeURIComponent(id)}`,
  },
  quotation_submitted: {
    module: "Supplier Quotation",
    title: "Quotation Submitted",
    document_type: "Supplier Quotation",
    route: (id) => `/sourcing/rfq/${encodeURIComponent(id)}`,
  },
  legal_review_required: {
    module: "Legal Review",
    title: "Legal Review Required",
    document_type: "Request for Quotation",
    route: (id) => `/legal/reviews/${encodeURIComponent(id)}`,
  },
  finance_review_required: {
    module: "Finance Approval",
    title: "Finance Review Required",
    document_type: "Request for Quotation",
    route: (id) => `/finance/reviews/${encodeURIComponent(id)}`,
  },
  po_created: {
    module: "Purchase Order",
    title: "Purchase Order Created",
    document_type: "Purchase Order",
    route: (id) => `/p2p/purchase-orders/${encodeURIComponent(id)}`,
  },
  payment_released: {
    module: "Payment",
    title: "Payment Released",
    document_type: "Payment Entry",
    route: () => `/p2p/payments`,
  },
  system: {
    module: "System",
    title: "System",
    document_type: "System",
    route: () => `/notifications`,
  },
};

/* ─── Email Templates ─────────────────────────────────────────────────────── */

export const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: "rfq_created",
    name: "RFQ Created",
    subject: "New RFQ Created: {{rfq_id}}",
    body: `Dear Team,\n\nA new Request for Quotation ({{rfq_id}}) has been created.\n\nItems: {{item_count}}\nCreated by: {{created_by}}\nDeadline: {{deadline}}\n\nPlease review and submit your quotation at your earliest convenience.\n\nRegards,\n${APP_NAME}`,
    triggerEvent: "Request for Quotation → Submitted",
    recipients: "Suppliers, Procurement Team",
    enabled: true,
  },
  {
    id: "quotation_submitted",
    name: "Supplier Quotation Submitted",
    subject: "Quotation Received for {{rfq_id}} from {{supplier}}",
    body: `Dear Procurement Team,\n\nA supplier quotation has been submitted:\n\nRFQ: {{rfq_id}}\nSupplier: {{supplier}}\nTotal Amount: {{amount}}\nItems: {{item_count}}\n\nPlease review the quotation in ${APP_NAME}.\n\nRegards,\n${APP_NAME}`,
    triggerEvent: "Supplier Quotation → Submitted",
    recipients: "Procurement Manager",
    enabled: true,
  },
  {
    id: "legal_review_required",
    name: "Legal Review Required",
    subject: "Legal Review Required: {{rfq_id}}",
    body: `Dear Legal Team,\n\nAn RFQ requires legal review before proceeding:\n\nRFQ: {{rfq_id}}\nTotal Value: {{amount}}\nSupplier: {{supplier}}\n\nPlease complete your legal review in ${APP_NAME}.\n\nRegards,\n${APP_NAME}`,
    triggerEvent: "RFQ Approval → Legal Stage",
    recipients: "Legal Reviewer",
    enabled: true,
  },
  {
    id: "finance_review_required",
    name: "Finance Review Required",
    subject: "Finance Review Required: {{rfq_id}}",
    body: `Dear Finance Team,\n\nAn RFQ has passed legal review and requires finance approval:\n\nRFQ: {{rfq_id}}\nTotal Value: {{amount}}\nBudget Impact: {{budget_status}}\n\nPlease complete the finance review in ${APP_NAME}.\n\nRegards,\n${APP_NAME}`,
    triggerEvent: "RFQ Approval → Finance Stage",
    recipients: "Finance Manager",
    enabled: true,
  },
  {
    id: "po_created",
    name: "Purchase Order Created",
    subject: "Purchase Order Created: {{po_id}}",
    body: `Dear Team,\n\nA new Purchase Order has been created:\n\nPO Number: {{po_id}}\nSupplier: {{supplier}}\nTotal Amount: {{amount}}\nDelivery Date: {{delivery_date}}\n\nThe supplier has been notified.\n\nRegards,\n${APP_NAME}`,
    triggerEvent: "Purchase Order → Created",
    recipients: "Supplier, Warehouse, Finance",
    enabled: true,
  },
  {
    id: "payment_released",
    name: "Payment Released",
    subject: "Payment Released: {{payment_id}} to {{supplier}}",
    body: `Dear {{supplier}},\n\nPayment has been released for your invoice:\n\nPayment Reference: {{payment_id}}\nAmount: {{amount}}\nInvoice: {{invoice_id}}\n\nPlease allow 2-3 business days for the funds to reflect in your account.\n\nRegards,\n${APP_NAME}`,
    triggerEvent: "Payment Entry → Submitted",
    recipients: "Supplier, Finance Team",
    enabled: true,
  },
];

/* ─── CRUD ────────────────────────────────────────────────────────────────── */

export function getAllNotifications(): EnterpriseNotification[] {
  try {
    if (!localStorage.getItem(MIGRATION_KEY)) {
      const migrated = migrateLegacyStores();
      if (migrated.length > 0) {
        persist(migrated);
        return dedupeNotifications(migrated);
      }
    }
    const raw = localStorage.getItem(NOTIF_KEY);
    if (!raw) return seedNotifications();
    const parsed = JSON.parse(raw) as EnterpriseNotification[];
    return Array.isArray(parsed) ? dedupeNotifications(parsed) : seedNotifications();
  } catch {
    return seedNotifications();
  }
}

/** @deprecated Use getAllNotifications */
export function getNotifications(): EnterpriseNotification[] {
  return getAllNotifications();
}

export function getNotificationsForViewer(
  viewer: NotificationViewerContext
): EnterpriseNotification[] {
  return filterNotificationsForViewer(getAllNotifications(), viewer);
}

export function createNotification(
  input: CreateNotificationInput
): EnterpriseNotification {
  const list = getAllNotifications();
  const notif: EnterpriseNotification = {
    ...input,
    id: input.id ?? uid(),
    created_at: input.created_at ?? new Date().toISOString(),
    read_status: input.read_status ?? false,
    email_sent: input.email_sent ?? false,
  };

  const key = notificationDedupeKey(notif);
  const idx = list.findIndex((n) => notificationDedupeKey(n) === key);
  if (idx >= 0) {
    list[idx] = {
      ...notif,
      id: list[idx].id,
      read_status: list[idx].read_status && notif.read_status,
    };
  } else {
    list.unshift(notif);
  }
  persist(list);
  return notif;
}

/** Upsert without changing read state if the notification already exists. */
export function upsertNotification(
  input: CreateNotificationInput
): EnterpriseNotification {
  const list = getAllNotifications();
  const draft: EnterpriseNotification = {
    ...input,
    id: input.id ?? uid(),
    created_at: input.created_at ?? new Date().toISOString(),
    read_status: input.read_status ?? false,
    email_sent: input.email_sent ?? false,
  };
  const key = notificationDedupeKey(draft);
  const idx = list.findIndex((n) => notificationDedupeKey(n) === key);
  if (idx >= 0) {
    list[idx] = {
      ...draft,
      id: list[idx].id,
      read_status: list[idx].read_status,
      created_at: list[idx].created_at,
    };
    persist(list);
    return list[idx];
  }
  return createNotification(input);
}

export function addNotification(
  input: Omit<
    EnterpriseNotification,
    "id" | "created_at" | "read_status" | "route_path"
  > & { route_path?: string; to?: string }
): EnterpriseNotification {
  const route =
    input.route_path ??
    input.to ??
    `/notifications`;
  const { to: _to, ...rest } = input as CreateNotificationInput & { to?: string };
  return createNotification({
    ...rest,
    route_path: route,
    description: rest.description ?? "",
  });
}

export function markNotificationRead(id: string) {
  const list = getAllNotifications();
  const idx = list.findIndex((n) => n.id === id);
  if (idx >= 0) {
    list[idx].read_status = true;
    persist(list);
  }
}

export function markAllNotificationsReadForViewer(
  viewer: NotificationViewerContext
) {
  const visibleIds = new Set(
    getNotificationsForViewer(viewer).map((n) => n.id)
  );
  const list = getAllNotifications();
  for (const n of list) {
    if (visibleIds.has(n.id)) n.read_status = true;
  }
  persist(list);
}

export function markAllNotificationsRead() {
  const list = getAllNotifications();
  for (const n of list) n.read_status = true;
  persist(list);
}

export function clearNotificationsForViewer(viewer: NotificationViewerContext) {
  const visibleKeys = new Set(
    getNotificationsForViewer(viewer).map(notificationDedupeKey)
  );
  const list = getAllNotifications().filter(
    (n) => !visibleKeys.has(notificationDedupeKey(n))
  );
  persist(list);
}

export function clearNotifications() {
  persist([]);
}

export function getUnreadCountForViewer(
  viewer: NotificationViewerContext
): number {
  return countUnreadVisible(getNotificationsForViewer(viewer));
}

export function getUnreadCount(): number {
  return getAllNotifications().filter((n) => !n.read_status).length;
}

/* ─── Voucher workflow helpers ──────────────────────────────────────────── */

export function notifyVoucherEvent(
  forRole: NotificationTargetRole,
  message: string,
  voucherId: string,
  options?: { supplier_id?: string; supplier_name?: string }
): void {
  const module = voucherModuleForRole(forRole, message);
  const title =
    module === "Voucher"
      ? `Voucher ${voucherId}`
      : module === "Payment" || module === "Payment Status"
        ? `Payment — ${voucherId}`
        : module === "Invoice" || module === "Invoice Status"
          ? `Invoice — ${voucherId}`
          : `PO workflow — ${voucherId}`;

  createNotification({
    title,
    description: message,
    module,
    event_type: "voucher_workflow",
    target_role: forRole,
    supplier_id: options?.supplier_id?.trim().toLowerCase(),
    document_type: "Voucher",
    document_name: voucherId,
    route_path: voucherRoute(forRole, voucherId),
  });
}

/* ─── Email Config ────────────────────────────────────────────────────────── */

const DEFAULT_EMAIL_CONFIG: EmailConfig = {
  smtpHost: "smtp.gmail.com",
  smtpPort: 587,
  emailAddress: "",
  password: "",
  senderName: `${APP_NAME} Notifications`,
  enableNotifications: true,
  enableEmailDigest: false,
};

export function getEmailConfig(): EmailConfig {
  try {
    const raw = localStorage.getItem(EMAIL_CFG_KEY);
    return raw ? { ...DEFAULT_EMAIL_CONFIG, ...JSON.parse(raw) } : DEFAULT_EMAIL_CONFIG;
  } catch {
    return DEFAULT_EMAIL_CONFIG;
  }
}

export function saveEmailConfig(config: Partial<EmailConfig>) {
  const current = getEmailConfig();
  const updated = { ...current, ...config };
  localStorage.setItem(EMAIL_CFG_KEY, JSON.stringify(updated));
  return updated;
}

/* ─── Workflow triggers ───────────────────────────────────────────────────── */

export function triggerRFQCreated(rfqId: string, itemCount: number) {
  return createNotification({
    title: "RFQ Created",
    description: `New RFQ ${rfqId} with ${itemCount} item(s) has been created and sent to suppliers.`,
    module: "RFQ",
    event_type: "rfq_created",
    target_role: "procurement",
    document_type: "Request for Quotation",
    document_name: rfqId,
    route_path: `/sourcing/rfq/${encodeURIComponent(rfqId)}`,
  });
}

export function triggerQuotationSubmitted(
  rfqId: string,
  supplier: string,
  amount: number
) {
  const fmt = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
  return createNotification({
    title: "Quotation Submitted",
    description: `${supplier} submitted a quotation of ${fmt} for RFQ ${rfqId}.`,
    module: "Supplier Quotation",
    event_type: "quotation_submitted",
    target_role: "procurement",
    document_type: "Supplier Quotation",
    document_name: rfqId,
    route_path: `/sourcing/rfq/${encodeURIComponent(rfqId)}`,
  });
}

export function triggerLegalReviewRequired(rfqId: string, amount: number) {
  const fmt = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
  return createNotification({
    title: "Legal Review Required",
    description: `RFQ ${rfqId} (${fmt}) requires legal review before approval.`,
    module: "Legal Review",
    event_type: "legal_review_required",
    target_role: "legal",
    document_type: "Request for Quotation",
    document_name: rfqId,
    route_path: `/legal/reviews/${encodeURIComponent(rfqId)}`,
  });
}

export function triggerFinanceReviewRequired(rfqId: string, amount: number) {
  const fmt = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
  createNotification({
    title: "Finance Review Required",
    description: `RFQ ${rfqId} (${fmt}) has passed legal review and requires finance approval.`,
    module: "Budget",
    event_type: "finance_review_required",
    target_role: "finance",
    document_type: "Request for Quotation",
    document_name: rfqId,
    route_path: `/finance/reviews/${encodeURIComponent(rfqId)}`,
  });
  createNotification({
    title: "Awaiting Finance Approval",
    description: `RFQ ${rfqId} (${fmt}) is pending finance sign-off.`,
    module: "Finance Approval",
    event_type: "finance_review_required",
    target_role: "procurement",
    document_type: "Request for Quotation",
    document_name: rfqId,
    route_path: `/sourcing/rfq/${encodeURIComponent(rfqId)}`,
  });
}

export function triggerPOCreated(
  poId: string,
  supplier: string,
  amount: number,
  supplierId?: string
) {
  const fmt = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
  createNotification({
    title: "Purchase Order Created",
    description: `PO ${poId} for ${supplier} (${fmt}) has been created.`,
    module: "Purchase Order",
    event_type: "po_created",
    target_role: "warehouse",
    document_type: "Purchase Order",
    document_name: poId,
    route_path: `/p2p/grn/new?po=${encodeURIComponent(poId)}`,
  });
  createNotification({
    title: "New Purchase Order",
    description: `PO ${poId} has been issued. Please review and accept.`,
    module: "Purchase Order",
    event_type: "po_created",
    target_role: "supplier",
    supplier_id: supplierId?.trim().toLowerCase() ?? supplier.trim().toLowerCase(),
    document_type: "Purchase Order",
    document_name: poId,
    route_path: `/supplier/purchase-orders/${encodeURIComponent(poId)}`,
  });
}

export function triggerPaymentReleased(
  paymentId: string,
  supplier: string,
  amount: number,
  supplierId?: string
) {
  const fmt = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
  createNotification({
    title: "Payment Released",
    description: `Payment ${paymentId} of ${fmt} released to ${supplier}.`,
    module: "Payment",
    event_type: "payment_released",
    target_role: "finance",
    document_type: "Payment Entry",
    document_name: paymentId,
    route_path: `/p2p/payments`,
  });
  createNotification({
    title: "Payment Sent",
    description: `Payment ${paymentId} of ${fmt} has been sent.`,
    module: "Payment Status",
    event_type: "payment_released",
    target_role: "supplier",
    supplier_id: supplierId?.trim().toLowerCase() ?? supplier.trim().toLowerCase(),
    document_type: "Payment Entry",
    document_name: paymentId,
    route_path: `/supplier/payments`,
  });
}

export function triggerLegalDocumentsRequested(
  sqName: string,
  supplierId?: string
) {
  createNotification({
    title: "Legal Documents Requested",
    description: `Compliance documents (Terms, Warranty, Insurance) requested for Supplier Quotation ${sqName}.`,
    module: "Supplier Documents",
    event_type: "legal_documents_requested",
    target_role: "supplier",
    supplier_id: supplierId?.trim().toLowerCase(),
    document_type: "Supplier Quotation",
    document_name: sqName,
    route_path: `/supplier/quotations/${encodeURIComponent(sqName)}`,
  });
  createNotification({
    title: "Document Request Sent",
    description: `Requested compliance documents for Supplier Quotation ${sqName}.`,
    module: "Compliance",
    event_type: "legal_documents_requested",
    target_role: "legal",
    document_type: "Supplier Quotation",
    document_name: sqName,
    route_path: `/legal/reviews/${encodeURIComponent(sqName)}`,
  });
}

/* ─── Dynamic alert sync (ERPNext-derived) ────────────────────────────────── */

export interface WarehouseAlertInput {
  poName: string;
  supplier: string;
  urgency: "overdue" | "due-today" | "due-tomorrow" | "awaiting";
  scheduleDate?: string;
  amount?: number;
}

export interface FinanceAlertInput {
  grnName: string;
  supplier: string;
  amount?: number;
  postingDate?: string;
}

export interface OverdueInvoiceAlertInput {
  invoiceName: string;
  supplier: string;
  amount: number;
  dueDate?: string;
}

export function syncWarehouseAlerts(alerts: WarehouseAlertInput[]) {
  for (const a of alerts) {
    const poPath = `/p2p/grn/new?po=${encodeURIComponent(a.poName)}`;
    const titles: Record<WarehouseAlertInput["urgency"], string> = {
      overdue: `Overdue receipt: ${a.poName}`,
      "due-today": `Delivery due today: ${a.poName}`,
      "due-tomorrow": `Delivery due tomorrow: ${a.poName}`,
      awaiting: `New PO awaiting receipt: ${a.poName}`,
    };
    upsertNotification({
      title: titles[a.urgency],
      description: `${a.supplier}${a.urgency === "overdue" ? " • overdue delivery" : ""}`,
      module: "PO Ready for GRN",
      event_type: `po_delivery_${a.urgency}`,
      target_role: "warehouse",
      document_type: "Purchase Order",
      document_name: a.poName,
      route_path: poPath,
      created_at: a.scheduleDate
        ? new Date(a.scheduleDate).toISOString()
        : undefined,
    });
  }
}

export function syncGrnCompletedAlerts(
  grns: { name: string; supplier: string; postingDate?: string }[]
) {
  for (const g of grns) {
    upsertNotification({
      title: `GRN completed: ${g.name}`,
      description: g.supplier,
      module: "GRN",
      event_type: "grn_completed",
      target_role: "warehouse",
      document_type: "Goods Receipt Note",
      document_name: g.name,
      route_path: `/p2p/grn/${encodeURIComponent(g.name)}`,
      created_at: g.postingDate
        ? new Date(g.postingDate).toISOString()
        : undefined,
    });
  }
}

export function syncFinanceGrnQueue(alerts: FinanceAlertInput[]) {
  for (const g of alerts) {
    upsertNotification({
      title: "GRN Awaiting Voucher",
      description: `${g.supplier} • GRN ${g.grnName}`,
      module: "Voucher",
      event_type: "grn_awaiting_voucher",
      target_role: "finance",
      document_type: "Goods Receipt Note",
      document_name: g.grnName,
      route_path: `/p2p/grn/${encodeURIComponent(g.grnName)}`,
      created_at: g.postingDate
        ? new Date(g.postingDate).toISOString()
        : undefined,
    });
  }
}

export function syncOverduePayables(alerts: OverdueInvoiceAlertInput[]) {
  for (const inv of alerts) {
    upsertNotification({
      title: `Overdue: ${inv.invoiceName}`,
      description: `${inv.supplier} • outstanding balance`,
      module: "Outstanding Payables",
      event_type: "invoice_overdue",
      target_role: "finance",
      document_type: "Purchase Invoice",
      document_name: inv.invoiceName,
      route_path: `/p2p/invoices/${encodeURIComponent(inv.invoiceName)}`,
      created_at: inv.dueDate ? new Date(inv.dueDate).toISOString() : undefined,
    });
  }
}

export function mergeSyncedNotifications(
  remote: EnterpriseNotification[]
): boolean {
  const local = getAllNotifications();
  const before = JSON.stringify(local);
  persist([...(remote ?? []), ...local]);
  return before !== JSON.stringify(getAllNotifications());
}

function seedNotifications(): EnterpriseNotification[] {
  const now = Date.now();
  const list: EnterpriseNotification[] = [
    {
      id: "seed-proc-1",
      title: "RFQ Created",
      description: "RFQ-2025-00042 with 5 items has been created and sent to suppliers.",
      module: "RFQ",
      event_type: "rfq_created",
      target_role: "procurement",
      document_type: "Request for Quotation",
      document_name: "RFQ-2025-00042",
      route_path: "/sourcing/rfq/RFQ-2025-00042",
      created_at: new Date(now - 30 * 60_000).toISOString(),
      read_status: false,
    },
    {
      id: "seed-proc-2",
      title: "Quotation Submitted",
      description: "TechCorp Ltd submitted a quotation of ₹4,50,000 for RFQ-2025-00041.",
      module: "Supplier Quotation",
      event_type: "quotation_submitted",
      target_role: "procurement",
      document_type: "Supplier Quotation",
      document_name: "RFQ-2025-00041",
      route_path: "/sourcing/rfq/RFQ-2025-00041",
      created_at: new Date(now - 2 * 3600_000).toISOString(),
      read_status: false,
    },
    {
      id: "seed-legal-1",
      title: "Legal Review Required",
      description: "RFQ-2025-00040 (₹12,00,000) requires legal review before approval.",
      module: "Legal Review",
      event_type: "legal_review_required",
      target_role: "legal",
      document_type: "Request for Quotation",
      document_name: "RFQ-2025-00040",
      route_path: "/legal/reviews/RFQ-2025-00040",
      created_at: new Date(now - 5 * 3600_000).toISOString(),
      read_status: false,
    },
    {
      id: "seed-wh-1",
      title: "Purchase Order Created",
      description: "PO-2025-00089 for GlobalSupply Inc (₹3,20,000) has been created.",
      module: "PO Ready for GRN",
      event_type: "po_created",
      target_role: "warehouse",
      document_type: "Purchase Order",
      document_name: "PO-2025-00089",
      route_path: "/p2p/grn/new?po=PO-2025-00089",
      created_at: new Date(now - 24 * 3600_000).toISOString(),
      read_status: true,
    },
    {
      id: "seed-fin-1",
      title: "Finance Review Required",
      description: "RFQ-2025-00039 (₹8,50,000) has passed legal review and requires finance approval.",
      module: "Budget",
      event_type: "finance_review_required",
      target_role: "finance",
      document_type: "Request for Quotation",
      document_name: "RFQ-2025-00039",
      route_path: "/finance/reviews/RFQ-2025-00039",
      created_at: new Date(now - 48 * 3600_000).toISOString(),
      read_status: true,
    },
    {
      id: "seed-fin-2",
      title: "Payment Released",
      description: "Payment PAY-2025-00034 of ₹2,75,000 released to MegaParts Co.",
      module: "Payment",
      event_type: "payment_released",
      target_role: "finance",
      document_type: "Payment Entry",
      document_name: "PAY-2025-00034",
      route_path: "/p2p/payments",
      created_at: new Date(now - 72 * 3600_000).toISOString(),
      read_status: true,
    },
    {
      id: "seed-admin-1",
      title: "Workflow engine healthy",
      description: "All approval chains are operational. Last health check passed.",
      module: "System",
      event_type: "system_health",
      target_role: "admin",
      document_type: "System",
      document_name: "health-check",
      route_path: "/admin/system-settings",
      created_at: new Date(now - 6 * 3600_000).toISOString(),
      read_status: false,
    },
    {
      id: "seed-admin-2",
      title: "Audit log export ready",
      description: "Weekly audit trail export is available for download.",
      module: "Audit",
      event_type: "audit_export",
      target_role: "admin",
      document_type: "Audit Log",
      document_name: "audit-week-24",
      route_path: "/admin/audit-logs",
      created_at: new Date(now - 12 * 3600_000).toISOString(),
      read_status: false,
    },
  ];
  persist(list);
  return list;
}
