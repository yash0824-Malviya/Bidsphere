/**
 * Notification & Email Template system.
 *
 * Stores workflow-triggered notifications in localStorage and provides
 * email template definitions and SMTP configuration management.
 */

/* ─── Types ───────────────────────────────────────────────────────────────── */

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

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  documentId?: string;
  documentType?: string;
  to?: string;
  read: boolean;
  emailSent: boolean;
  timestamp: string;
  recipientRole?: string;
}

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

/* ─── Storage ─────────────────────────────────────────────────────────────── */

const NOTIF_KEY = "bidsphere-notifications";
const EMAIL_CFG_KEY = "bidsphere-email-config";

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

import { APP_NAME } from "../config/branding";

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

/* ─── Notifications CRUD ──────────────────────────────────────────────────── */

export function getNotifications(): AppNotification[] {
  try {
    const raw = localStorage.getItem(NOTIF_KEY);
    if (!raw) return seedNotifications();
    const parsed = JSON.parse(raw) as AppNotification[];
    return Array.isArray(parsed) ? parsed : seedNotifications();
  } catch {
    return seedNotifications();
  }
}

function persistNotifications(list: AppNotification[]) {
  localStorage.setItem(NOTIF_KEY, JSON.stringify(list));
}

export function addNotification(input: Omit<AppNotification, "id" | "read" | "emailSent" | "timestamp">): AppNotification {
  const list = getNotifications();
  const notif: AppNotification = {
    ...input,
    id: uid(),
    read: false,
    emailSent: false,
    timestamp: new Date().toISOString(),
  };
  list.unshift(notif);
  if (list.length > 200) list.length = 200;
  persistNotifications(list);
  return notif;
}

export function markNotificationRead(id: string) {
  const list = getNotifications();
  const idx = list.findIndex((n) => n.id === id);
  if (idx >= 0) {
    list[idx].read = true;
    persistNotifications(list);
  }
}

export function markAllNotificationsRead() {
  const list = getNotifications();
  for (const n of list) n.read = true;
  persistNotifications(list);
}

export function clearNotifications() {
  persistNotifications([]);
}

export function getUnreadCount(): number {
  return getNotifications().filter((n) => !n.read).length;
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
  return addNotification({
    type: "rfq_created",
    title: "RFQ Created",
    message: `New RFQ ${rfqId} with ${itemCount} item(s) has been created and sent to suppliers.`,
    documentId: rfqId,
    documentType: "Request for Quotation",
    to: `/sourcing/rfq/${encodeURIComponent(rfqId)}`,
    recipientRole: "procurement",
  });
}

export function triggerQuotationSubmitted(rfqId: string, supplier: string, amount: number) {
  const fmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
  return addNotification({
    type: "quotation_submitted",
    title: "Quotation Submitted",
    message: `${supplier} submitted a quotation of ${fmt} for RFQ ${rfqId}.`,
    documentId: rfqId,
    documentType: "Supplier Quotation",
    to: `/sourcing/rfq/${encodeURIComponent(rfqId)}`,
    recipientRole: "procurement",
  });
}

export function triggerLegalReviewRequired(rfqId: string, amount: number) {
  const fmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
  return addNotification({
    type: "legal_review_required",
    title: "Legal Review Required",
    message: `RFQ ${rfqId} (${fmt}) requires legal review before approval.`,
    documentId: rfqId,
    documentType: "Request for Quotation",
    to: `/legal/reviews/${encodeURIComponent(rfqId)}`,
    recipientRole: "legal",
  });
}

export function triggerFinanceReviewRequired(rfqId: string, amount: number) {
  const fmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
  return addNotification({
    type: "finance_review_required",
    title: "Finance Review Required",
    message: `RFQ ${rfqId} (${fmt}) has passed legal review and requires finance approval.`,
    documentId: rfqId,
    documentType: "Request for Quotation",
    to: `/finance/reviews/${encodeURIComponent(rfqId)}`,
    recipientRole: "finance",
  });
}

export function triggerPOCreated(poId: string, supplier: string, amount: number) {
  const fmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
  return addNotification({
    type: "po_created",
    title: "Purchase Order Created",
    message: `PO ${poId} for ${supplier} (${fmt}) has been created.`,
    documentId: poId,
    documentType: "Purchase Order",
    to: `/p2p/purchase-orders/${encodeURIComponent(poId)}`,
    recipientRole: "warehouse",
  });
}

export function triggerPaymentReleased(paymentId: string, supplier: string, amount: number) {
  const fmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
  return addNotification({
    type: "payment_released",
    title: "Payment Released",
    message: `Payment ${paymentId} of ${fmt} released to ${supplier}.`,
    documentId: paymentId,
    documentType: "Payment Entry",
    to: `/p2p/payments`,
    recipientRole: "finance",
  });
}

/* ─── Seed data ───────────────────────────────────────────────────────────── */

function seedNotifications(): AppNotification[] {
  const now = Date.now();
  const list: AppNotification[] = [
    { id: "seed-1", type: "rfq_created", title: "RFQ Created", message: "RFQ-2025-00042 with 5 items has been created and sent to suppliers.", documentId: "RFQ-2025-00042", documentType: "Request for Quotation", to: "/sourcing/rfq", read: false, emailSent: true, timestamp: new Date(now - 30 * 60_000).toISOString(), recipientRole: "procurement" },
    { id: "seed-2", type: "quotation_submitted", title: "Quotation Submitted", message: "TechCorp Ltd submitted a quotation of ₹4,50,000 for RFQ-2025-00041.", documentId: "RFQ-2025-00041", documentType: "Supplier Quotation", to: "/sourcing/rfq", read: false, emailSent: true, timestamp: new Date(now - 2 * 3600_000).toISOString(), recipientRole: "procurement" },
    { id: "seed-3", type: "legal_review_required", title: "Legal Review Required", message: "RFQ-2025-00040 (₹12,00,000) requires legal review before approval.", documentId: "RFQ-2025-00040", documentType: "Request for Quotation", to: "/sourcing/legal-reviews", read: false, emailSent: true, timestamp: new Date(now - 5 * 3600_000).toISOString(), recipientRole: "legal" },
    { id: "seed-4", type: "po_created", title: "Purchase Order Created", message: "PO-2025-00089 for GlobalSupply Inc (₹3,20,000) has been created.", documentId: "PO-2025-00089", documentType: "Purchase Order", to: "/p2p/purchase-orders", read: true, emailSent: true, timestamp: new Date(now - 24 * 3600_000).toISOString(), recipientRole: "warehouse" },
    { id: "seed-5", type: "finance_review_required", title: "Finance Review Required", message: "RFQ-2025-00039 (₹8,50,000) has passed legal review and requires finance approval.", documentId: "RFQ-2025-00039", documentType: "Request for Quotation", to: "/budget/pending-reviews", read: true, emailSent: true, timestamp: new Date(now - 48 * 3600_000).toISOString(), recipientRole: "finance" },
    { id: "seed-6", type: "payment_released", title: "Payment Released", message: "Payment PAY-2025-00034 of ₹2,75,000 released to MegaParts Co.", documentId: "PAY-2025-00034", documentType: "Payment Entry", to: "/p2p/payments", read: true, emailSent: true, timestamp: new Date(now - 72 * 3600_000).toISOString(), recipientRole: "finance" },
  ];
  persistNotifications(list);
  return list;
}
