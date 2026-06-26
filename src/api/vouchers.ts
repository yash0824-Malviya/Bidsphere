/**
 * Voucher workflow + notification API.
 *
 * Persists vouchers and notifications in localStorage. This is a deliberate
 * self-contained workflow layer (the "Voucher" replacement for the Finance
 * invoice flow) and does not call ERPNext. UI conventions are honored:
 * USD currency, the app's auth store for the current actor, etc.
 */

import { useAuthStore } from "../store/authStore";
import { useVoucherSyncStore } from "../store/voucherSyncStore";
import { canManageVouchers } from "../config/roles";
import { scheduleVoucherPush } from "./voucherSync";
import { notifyVoucherEvent } from "./notifications";
import type {
  InvoiceRecord,
  InvoiceStatus,
  PaymentConfirmation,
  PaymentRecord,
  SupplierInvoice,
  Voucher,
  VoucherActorRole,
  VoucherStatus,
} from "../types/voucher";

function voucherNotify(
  voucher: Pick<Voucher, "id" | "supplier">,
  forRole: VoucherActorRole,
  message: string
): void {
  notifyVoucherEvent(forRole, message, voucher.id, {
    supplier_id: voucher.supplier,
  });
  notifyVoucherStoreChanged();
}

const VOUCHERS_KEY = "netlink_vouchers";
const MIGRATION_KEY = "voucher_store_v2_purged";

/**
 * Signal that the local voucher cache changed: re-render subscribed views and
 * push the updated store to the shared ERPNext backend so every environment
 * (localhost / ngrok / other devices) converges on the same workflow state.
 */
function notifyVoucherStoreChanged(): void {
  try {
    useVoucherSyncStore.getState().bump();
  } catch {
    /* store not ready (non-React context) — ignore */
  }
  scheduleVoucherPush();
}

/* -------------------------------------------------------------------------- */
/*  Status presentation                                                       */
/* -------------------------------------------------------------------------- */

export const VOUCHER_STATUS_LABEL: Record<VoucherStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  viewed: "Viewed",
  invoice_raised: "Invoice Raised",
  under_review: "Under Review",
  invoice_approved: "Invoice Approved",
  invoice_rejected: "Invoice Rejected",
  payment_confirmed: "Payment Released",
  payment_received: "Payment Received",
};

/** Tailwind classes for each status badge. */
export const VOUCHER_STATUS_TONE: Record<VoucherStatus, string> = {
  draft: "bg-neutral-100 text-neutral-600 ring-neutral-200",
  sent: "bg-blue-50 text-blue-700 ring-blue-200",
  viewed: "bg-violet-50 text-violet-700 ring-violet-200",
  invoice_raised: "bg-orange-50 text-orange-700 ring-orange-200",
  under_review: "bg-amber-50 text-amber-700 ring-amber-200",
  invoice_approved: "bg-teal-50 text-teal-700 ring-teal-200",
  invoice_rejected: "bg-red-50 text-red-700 ring-red-200",
  payment_confirmed: "bg-teal-50 text-teal-700 ring-teal-200",
  payment_received: "bg-success-100 text-success-700 ring-success-200",
};

/**
 * Supplier-facing status labels. From the supplier's perspective a "sent"
 * voucher is something they need to review and act on, so the wording differs
 * from the Finance-internal labels above.
 */
export const SUPPLIER_VOUCHER_STATUS_LABEL: Record<VoucherStatus, string> = {
  draft: "Draft",
  sent: "Awaiting Supplier Review",
  viewed: "Reviewed — Invoice Pending",
  invoice_raised: "Invoice Submitted",
  under_review: "Invoice Under Review",
  invoice_approved: "Invoice Approved — Awaiting Payment",
  invoice_rejected: "Invoice Rejected — Action Needed",
  payment_confirmed: "Payment Sent",
  payment_received: "Completed",
};

export function supplierVoucherStatusLabel(status: VoucherStatus): string {
  return SUPPLIER_VOUCHER_STATUS_LABEL[status] ?? VOUCHER_STATUS_LABEL[status];
}

/* ----- Invoice status presentation ----- */

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
  paid: "Paid",
};

export const INVOICE_STATUS_TONE: Record<InvoiceStatus, string> = {
  submitted: "bg-amber-50 text-amber-700 ring-amber-200",
  approved: "bg-teal-50 text-teal-700 ring-teal-200",
  rejected: "bg-red-50 text-red-700 ring-red-200",
  paid: "bg-success-100 text-success-700 ring-success-200",
};

/* ----- Header display status (payment-aware) ----- */

/**
 * The prominent badge shown on the Invoice Detail header. Unlike the raw
 * `InvoiceStatus`, this collapses the full voucher + invoice + payment state
 * into a single human-readable label so the invoice page is the single source
 * of truth for "is this paid?".
 */
export type InvoiceDisplayStatus =
  | "Draft"
  | "Submitted"
  | "Under Review"
  | "Approved"
  | "Payment Pending"
  | "Payment Submitted"
  | "Partially Paid"
  | "Paid"
  | "Rejected";

export const INVOICE_DISPLAY_TONE: Record<InvoiceDisplayStatus, string> = {
  Draft: "bg-neutral-100 text-neutral-600 ring-neutral-200",
  Submitted: "bg-amber-50 text-amber-700 ring-amber-200",
  "Under Review": "bg-amber-50 text-amber-700 ring-amber-200",
  Approved: "bg-teal-50 text-teal-700 ring-teal-200",
  "Payment Pending": "bg-blue-50 text-blue-700 ring-blue-200",
  "Payment Submitted": "bg-teal-50 text-teal-700 ring-teal-200",
  "Partially Paid": "bg-blue-50 text-blue-700 ring-blue-200",
  Paid: "bg-success-100 text-success-700 ring-success-200",
  Rejected: "bg-red-50 text-red-700 ring-red-200",
};

export function invoiceDisplayStatus(v: Voucher): InvoiceDisplayStatus {
  if (!v.invoice) return "Draft";
  // Supplier has confirmed receipt → fully settled.
  if (v.status === "payment_received") return "Paid";
  // Finance has released payment (ERPNext Payment Entry submitted) but the
  // supplier has not yet confirmed receipt → Payment Submitted.
  if (
    v.payment ||
    v.invoice.status === "paid" ||
    v.status === "payment_confirmed"
  ) {
    return "Payment Submitted";
  }
  if (v.invoice.status === "rejected" || v.status === "invoice_rejected") {
    return "Rejected";
  }
  if (v.invoice.status === "approved" || v.status === "invoice_approved") {
    return "Payment Pending";
  }
  if (v.status === "under_review") return "Under Review";
  return "Submitted";
}

/* ----- Payment status (for the Payment Summary card) ----- */

export type PaymentStatus =
  | "Awaiting Approval"
  | "Payment Pending"
  | "Paid"
  | "Completed";

export const PAYMENT_STATUS_TONE: Record<PaymentStatus, string> = {
  "Awaiting Approval": "bg-neutral-100 text-neutral-600 ring-neutral-200",
  "Payment Pending": "bg-amber-50 text-amber-700 ring-amber-200",
  Paid: "bg-teal-50 text-teal-700 ring-teal-200",
  Completed: "bg-success-100 text-success-700 ring-success-200",
};

export function paymentStatus(v: Voucher): PaymentStatus {
  if (v.status === "payment_received") return "Completed";
  if (v.payment || v.status === "payment_confirmed") return "Paid";
  if (v.invoice?.status === "approved" || v.status === "invoice_approved") {
    return "Payment Pending";
  }
  return "Awaiting Approval";
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function generateVoucherID(): string {
  const year = new Date().getFullYear();
  const seq = String(Date.now()).slice(-5);
  return `VCH-${year}-${seq}`;
}

function generatePaymentID(): string {
  const year = new Date().getFullYear();
  const seq = String(Date.now()).slice(-5);
  return `PAY-${year}-${seq}`;
}

/**
 * API-level RBAC backstop: only Finance (or Admin) may create or mutate a
 * voucher. This guards against a Procurement/Warehouse user triggering a
 * voucher mutation by manipulating the URL or calling the API directly — the
 * UI hides the controls, and this throws if one is invoked anyway.
 */
function assertCanManageVouchers(): void {
  const role = useAuthStore.getState().user?.role;
  if (!canManageVouchers(role)) {
    throw new Error("Only the Finance team can create or manage vouchers.");
  }
}

function currentActor(): { name: string; role: VoucherActorRole } {
  const user = useAuthStore.getState().user;
  const role = user?.role;
  const actorRole: VoucherActorRole =
    role === "procurement"
      ? "procurement"
      : role === "admin"
      ? "admin"
      : "finance";
  return { name: user?.full_name || "Finance Team", role: actorRole };
}

/* -------------------------------------------------------------------------- */
/*  CRUD                                                                      */
/* -------------------------------------------------------------------------- */

export function getAllVouchers(): Voucher[] {
  try {
    const data = localStorage.getItem(VOUCHERS_KEY);
    return data ? (JSON.parse(data) as Voucher[]) : [];
  } catch {
    return [];
  }
}

export function saveVoucher(voucher: Voucher): void {
  const all = getAllVouchers();
  const idx = all.findIndex((v) => v.id === voucher.id);
  if (idx >= 0) all[idx] = voucher;
  else all.unshift(voucher);
  localStorage.setItem(VOUCHERS_KEY, JSON.stringify(all));
  notifyVoucherStoreChanged();
}

/**
 * Remove every voucher and notification from localStorage. The next
 * `scheduleVoucherPush()` will propagate the empty store to the shared
 * ERPNext Note so all devices converge on a clean state.
 */
export function clearAllVouchers(): void {
  localStorage.removeItem(VOUCHERS_KEY);
  notifyVoucherStoreChanged();
}

/**
 * One-time migration: purge stale demo/test voucher data that accumulated
 * in localStorage during development. After this runs the voucher table
 * starts clean and only displays vouchers created through the real workflow.
 *
 * Call this early (e.g. from `VoucherStoreSync` in App.tsx) so the purge
 * happens before the first render.
 *
 * @returns `true` if a purge was performed (callers may want to push).
 */
export function runVoucherStoreMigration(): boolean {
  if (localStorage.getItem(MIGRATION_KEY)) return false;
  const existing = getAllVouchers();
  if (existing.length > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[Vouchers] Migration: purging ${existing.length} stale voucher(s) from localStorage`
    );
    localStorage.removeItem(VOUCHERS_KEY);
  }
  localStorage.setItem(MIGRATION_KEY, new Date().toISOString());
  return existing.length > 0;
}

export function getVoucherById(id: string): Voucher | null {
  return getAllVouchers().find((v) => v.id === id) ?? null;
}

/** The (single) voucher issued against a given GRN, if any. */
export function getVoucherByGRN(grnRef: string): Voucher | null {
  if (!grnRef) return null;
  return getAllVouchers().find((v) => v.grn_reference === grnRef) ?? null;
}

/** Set of GRN references that already have a voucher (any status). */
export function getVoucheredGRNRefs(): Set<string> {
  return new Set(
    getAllVouchers()
      .map((v) => v.grn_reference)
      .filter((ref): ref is string => !!ref)
  );
}

/**
 * Remove GRNs that already have a voucher from an "awaiting voucher creation"
 * list. Because vouchers live in localStorage (not ERPNext billing), the
 * ERPNext "To Bill" status never clears on its own — so every consumer of the
 * awaiting queue must apply this client-side exclusion to stay consistent.
 */
export function excludeVoucheredGRNs<T extends { name: string }>(
  grns: T[]
): T[] {
  const vouchered = getVoucheredGRNRefs();
  return grns.filter((g) => !vouchered.has(g.name));
}

/**
 * Whether a voucher belongs to the given supplier identifier.
 *
 * The supplier portal session stores the ERPNext Supplier `name` (its ID),
 * while a voucher records both the supplier ID (`supplier`) and the display
 * name (`supplier_name`). To be resilient to ID-vs-name and case/whitespace
 * differences, we match the identifier against either field, normalized.
 */
export function voucherBelongsToSupplier(
  voucher: Voucher,
  identifier: string
): boolean {
  const target = identifier.trim().toLowerCase();
  if (!target) return false;
  return (
    (voucher.supplier ?? "").trim().toLowerCase() === target ||
    (voucher.supplier_name ?? "").trim().toLowerCase() === target
  );
}

/** Vouchers addressed to a particular supplier (excludes Finance-only drafts). */
export function getVouchersForSupplier(supplier: string): Voucher[] {
  return getAllVouchers().filter(
    (v) => v.status !== "draft" && voucherBelongsToSupplier(v, supplier)
  );
}

/**
 * A single voucher, but only if it is addressed to the given supplier and has
 * left draft. Used by the supplier portal so a supplier cannot open a voucher
 * that is not theirs by guessing the URL.
 */
export function getVoucherForSupplier(
  id: string,
  supplier: string
): Voucher | null {
  const v = getVoucherById(id);
  if (!v || v.status === "draft") return null;
  return voucherBelongsToSupplier(v, supplier) ? v : null;
}

/* -------------------------------------------------------------------------- */
/*  Invoice views (derived from vouchers)                                     */
/* -------------------------------------------------------------------------- */

/** Flatten a voucher that carries an invoice into a list-friendly record. */
function voucherToInvoiceRecord(v: Voucher): InvoiceRecord | null {
  if (!v.invoice) return null;
  return {
    invoice_number: v.invoice.invoice_number,
    voucher_id: v.id,
    po_reference: v.po_reference,
    grn_reference: v.grn_reference,
    supplier: v.supplier,
    supplier_name: v.supplier_name,
    amount: v.invoice.total,
    currency: v.currency,
    raised_at: v.invoice.raised_at,
    due_date: v.invoice.due_date,
    status: v.invoice.status ?? "submitted",
    voucher_status: v.status,
  };
}

/** All supplier invoices across every voucher (Finance + Procurement views). */
export function getAllInvoices(): InvoiceRecord[] {
  return getAllVouchers()
    .map(voucherToInvoiceRecord)
    .filter((r): r is InvoiceRecord => r !== null);
}

/** Invoices raised by a particular supplier (Supplier portal view). */
export function getInvoicesForSupplier(supplier: string): InvoiceRecord[] {
  return getAllVouchers()
    .filter((v) => v.invoice && voucherBelongsToSupplier(v, supplier))
    .map(voucherToInvoiceRecord)
    .filter((r): r is InvoiceRecord => r !== null);
}

/* -------------------------------------------------------------------------- */
/*  Payment views (derived from vouchers — single source of truth)            */
/* -------------------------------------------------------------------------- */

function voucherToPaymentRecord(v: Voucher): PaymentRecord | null {
  if (!v.payment) return null;
  return {
    payment_id: v.payment.payment_id ?? `PAY-${v.id}`,
    voucher_id: v.id,
    invoice_number: v.invoice?.invoice_number ?? "—",
    po_reference: v.po_reference,
    grn_reference: v.grn_reference,
    supplier: v.supplier,
    supplier_name: v.supplier_name,
    method: v.payment.payment_method,
    reference_number: v.payment.reference_number,
    amount: v.payment.amount,
    currency: v.currency,
    status: v.status === "payment_received" ? "Completed" : "Paid",
    paid_date: v.payment.confirmed_at,
  };
}

/** All released payments across vouchers — drives the Payments module. */
export function getAllPayments(): PaymentRecord[] {
  return getAllVouchers()
    .map(voucherToPaymentRecord)
    .filter((r): r is PaymentRecord => r !== null);
}

/** Payments released to a particular supplier (Supplier portal). */
export function getPaymentsForSupplier(supplier: string): PaymentRecord[] {
  return getAllVouchers()
    .filter((v) => v.payment && voucherBelongsToSupplier(v, supplier))
    .map(voucherToPaymentRecord)
    .filter((r): r is PaymentRecord => r !== null);
}

/** Vouchers whose invoice is approved but payment has not yet been released. */
export function getVouchersAwaitingPayment(): Voucher[] {
  return getAllVouchers().filter(
    (v) =>
      !v.payment &&
      (v.invoice?.status === "approved" || v.status === "invoice_approved")
  );
}

export interface PaymentModuleKpis {
  paidCount: number;
  paidTotal: number;
  paidThisMonth: number;
  pendingReleaseCount: number;
  pendingReleaseTotal: number;
  suppliersPaid: number;
}

/** Headline payment metrics derived entirely from the voucher workflow. */
export function getPaymentKpis(): PaymentModuleKpis {
  const vouchers = getAllVouchers();
  const now = new Date();
  const suppliers = new Set<string>();
  let paidCount = 0;
  let paidTotal = 0;
  let paidThisMonth = 0;
  let pendingReleaseCount = 0;
  let pendingReleaseTotal = 0;

  for (const v of vouchers) {
    if (v.payment) {
      paidCount += 1;
      paidTotal += v.payment.amount;
      suppliers.add(v.supplier_name || v.supplier);
      const d = new Date(v.payment.confirmed_at);
      if (
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth()
      ) {
        paidThisMonth += v.payment.amount;
      }
    } else if (
      v.invoice?.status === "approved" ||
      v.status === "invoice_approved"
    ) {
      pendingReleaseCount += 1;
      pendingReleaseTotal += v.invoice?.total ?? v.amount;
    }
  }

  return {
    paidCount,
    paidTotal,
    paidThisMonth,
    pendingReleaseCount,
    pendingReleaseTotal,
    suppliersPaid: suppliers.size,
  };
}

export function createVoucher(data: Partial<Voucher>): Voucher {
  assertCanManageVouchers();
  // Enforce one active voucher per GRN — if a voucher already exists for this
  // goods receipt, return it instead of creating a duplicate.
  if (data.grn_reference) {
    const existing = getVoucherByGRN(data.grn_reference);
    if (existing) return existing;
  }

  const actor = currentActor();
  const voucher: Voucher = {
    id: generateVoucherID(),
    po_reference: data.po_reference ?? "",
    grn_reference: data.grn_reference ?? "",
    supplier: data.supplier ?? "",
    supplier_name: data.supplier_name ?? data.supplier ?? "",
    created_by: actor.name,
    created_at: new Date().toISOString(),
    amount: data.amount ?? 0,
    currency: data.currency ?? "USD",
    items: data.items ?? [],
    status: "draft",
    payment_terms: data.payment_terms,
    due_date: data.due_date,
    notes: data.notes,
    history: [
      {
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        action: "Voucher created by Finance",
        actor: actor.name,
        actor_role: "finance",
      },
    ],
  };
  saveVoucher(voucher);
  voucherNotify(voucher, "finance", `Voucher ${voucher.id} created`);
  return voucher;
}

export function sendVoucherToSupplier(id: string): Voucher | null {
  assertCanManageVouchers();
  const v = getVoucherById(id);
  if (!v) return null;
  const actor = currentActor();
  v.status = "sent";
  v.history.push({
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
    action: "Voucher sent to supplier",
    actor: actor.name,
    actor_role: "finance",
  });
  saveVoucher(v);
  voucherNotify(
    v,
    "supplier",
    `You have received Voucher ${id} from Netlink. Please review and raise an invoice.`
  );
  voucherNotify(v, "procurement", `Voucher ${id} sent to ${v.supplier_name}`);
  return v;
}

/** Supplier opens the voucher — bump status to "viewed" once. */
export function markVoucherViewed(id: string): Voucher | null {
  const v = getVoucherById(id);
  if (!v) return null;
  if (v.status !== "sent") return v;
  v.status = "viewed";
  v.history.push({
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
    action: "Supplier viewed the voucher",
    actor: v.supplier_name,
    actor_role: "supplier",
  });
  saveVoucher(v);
  return v;
}

/**
 * Supplier creates/submits an invoice against a voucher. Allowed while the
 * voucher is awaiting the supplier's action (sent / viewed) or after a prior
 * invoice was rejected by Finance, in which case the supplier may re-create it.
 */
export function supplierRaiseInvoice(
  voucherId: string,
  invoice: SupplierInvoice
): Voucher | null {
  const v = getVoucherById(voucherId);
  if (!v) return null;
  v.invoice = {
    ...invoice,
    status: "submitted",
    rejection_reason: undefined,
    reviewed_by: undefined,
    reviewed_at: undefined,
  };
  v.status = "invoice_raised";
  v.history.push({
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
    action: `Supplier submitted invoice ${invoice.invoice_number} for $${invoice.total.toFixed(
      2
    )}`,
    actor: v.supplier_name,
    actor_role: "supplier",
  });
  saveVoucher(v);
  voucherNotify(
    v,
    "finance",
    `Supplier submitted an invoice for Voucher ${voucherId}. Total: $${invoice.total.toFixed(
      2
    )}`
  );
  voucherNotify(
    v,
    "procurement",
    `Invoice received from ${v.supplier_name} for Voucher ${voucherId}`
  );
  return v;
}

/** Finance approves the supplier invoice — clears it for payment. */
export function approveInvoice(voucherId: string): Voucher | null {
  assertCanManageVouchers();
  const v = getVoucherById(voucherId);
  if (!v || !v.invoice) return null;
  const actor = currentActor();
  v.invoice.status = "approved";
  v.invoice.reviewed_by = actor.name;
  v.invoice.reviewed_at = new Date().toISOString();
  v.invoice.rejection_reason = undefined;
  v.status = "invoice_approved";
  v.history.push({
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
    action: `Invoice ${v.invoice.invoice_number} approved by Finance`,
    actor: actor.name,
    actor_role: "finance",
  });
  saveVoucher(v);
  voucherNotify(
    v,
    "supplier",
    `Your invoice ${v.invoice.invoice_number} for Voucher ${voucherId} was approved. Payment will follow.`
  );
  voucherNotify(v, "procurement", `Invoice approved for Voucher ${voucherId}`);
  return v;
}

/** Finance rejects the supplier invoice — supplier may re-create it. */
export function rejectInvoice(
  voucherId: string,
  reason: string
): Voucher | null {
  assertCanManageVouchers();
  const v = getVoucherById(voucherId);
  if (!v || !v.invoice) return null;
  const actor = currentActor();
  v.invoice.status = "rejected";
  v.invoice.reviewed_by = actor.name;
  v.invoice.reviewed_at = new Date().toISOString();
  v.invoice.rejection_reason = reason;
  v.status = "invoice_rejected";
  v.history.push({
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
    action: `Invoice ${v.invoice.invoice_number} rejected by Finance`,
    actor: actor.name,
    actor_role: "finance",
    note: reason,
  });
  saveVoucher(v);
  voucherNotify(
    v,
    "supplier",
    `Your invoice ${v.invoice.invoice_number} for Voucher ${voucherId} was rejected: ${reason}. Please review and re-submit.`
  );
  voucherNotify(v, "procurement", `Invoice rejected for Voucher ${voucherId}`);
  return v;
}

/**
 * Finance releases payment against an approved invoice. Kept under the
 * `confirmPayment` name for backward compatibility with existing callers.
 */
export function confirmPayment(
  voucherId: string,
  payment: PaymentConfirmation
): Voucher | null {
  assertCanManageVouchers();
  const v = getVoucherById(voucherId);
  if (!v) return null;
  v.payment = {
    ...payment,
    payment_id: payment.payment_id ?? generatePaymentID(),
    status: "Paid",
  };
  v.status = "payment_confirmed";
  if (v.invoice) {
    v.invoice.status = "paid";
    v.invoice.paid_at = payment.confirmed_at;
  }
  v.history.push({
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
    action: "Payment released by Finance",
    actor: payment.confirmed_by,
    actor_role: "finance",
    note: `Reference: ${payment.reference_number} · Method: ${
      payment.payment_method
    } · Amount: $${payment.amount.toFixed(2)} · Status: Paid`,
  });
  saveVoucher(v);
  voucherNotify(
    v,
    "supplier",
    `Payment of $${payment.amount.toFixed(
      2
    )} has been released for Voucher ${voucherId}. Ref: ${payment.reference_number}`
  );
  voucherNotify(v, "procurement", `Payment released for Voucher ${voucherId}`);
  return v;
}

/** Alias that reads better at finance call sites. */
export const releasePayment = confirmPayment;

export function supplierConfirmPaymentReceived(
  voucherId: string
): Voucher | null {
  const v = getVoucherById(voucherId);
  if (!v) return null;
  v.status = "payment_received";
  v.history.push({
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
    action: "Supplier confirmed payment received",
    actor: v.supplier_name,
    actor_role: "supplier",
  });
  saveVoucher(v);
  voucherNotify(
    v,
    "finance",
    `Supplier confirmed payment receipt for Voucher ${voucherId}`
  );
  voucherNotify(v, "procurement", `Voucher ${voucherId} fully settled`);
  return v;
}
