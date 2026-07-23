/**
 * Voucher workflow API — persisted in ERPNext "Voucher" DocType.
 *
 * History is stored via ERPNext Comment records linked to each voucher.
 * UI notifications remain localStorage-based (see notifications.ts).
 */

import erpnextClient, {
  buildResourceUrl,
  isDocNotFoundError,
  withSilent,
} from "./erpnext";
import { useAuthStore } from "../store/authStore";
import { useVoucherSyncStore } from "../store/voucherSyncStore";
import { canManageVouchers } from "../config/roles";
import { notifyVoucherEvent } from "./notifications";
import { nowERPDateTime } from "../utils/erpDate";
import { readSupplierSession } from "../hooks/useSupplierSession";
import { ensureSupplierAccessToken } from "../utils/supplierAccessAuth";
import type {
  InvoiceRecord,
  InvoiceStatus,
  PaymentConfirmation,
  PaymentRecord,
  SupplierInvoice,
  Voucher,
  VoucherActorRole,
  VoucherHistoryEntry,
  VoucherItem,
  VoucherStatus,
} from "../types/voucher";

const DOCTYPE = "Voucher";

/* -------------------------------------------------------------------------- */
/*  ERPNext record shape                                                      */
/* -------------------------------------------------------------------------- */

type ErpVoucherStatus =
  | "Draft"
  | "Sent"
  | "Viewed"
  | "Invoice Raised"
  | "Under Review"
  | "Payment Confirmed"
  | "Payment Received";

interface ErpVoucherRecord {
  name: string;
  po_reference?: string;
  grn_reference?: string;
  supplier?: string;
  created_by?: string;
  amount?: number;
  currency?: string;
  status?: string;
  items_json?: string;
  invoice_json?: string;
  payment_json?: string;
  creation?: string;
  modified?: string;
}

interface ItemsJsonPayload {
  items: VoucherItem[];
  meta?: {
    supplier_name?: string;
    payment_terms?: string;
    due_date?: string;
    notes?: string;
  };
}

interface ErpCommentRow {
  name?: string;
  content?: string;
  owner?: string;
  creation?: string;
}

function resourceBase(): string {
  return buildResourceUrl(DOCTYPE);
}

function bumpStore(): void {
  try {
    useVoucherSyncStore.getState().bump();
  } catch {
    /* non-React context */
  }
}

function voucherNotify(
  voucher: Pick<Voucher, "id" | "supplier">,
  forRole: VoucherActorRole,
  message: string
): void {
  notifyVoucherEvent(forRole, message, voucher.id, {
    supplier_id: voucher.supplier,
  });
  bumpStore();
}

function erpToAppStatus(
  erpStatus: string | undefined,
  invoice?: SupplierInvoice
): VoucherStatus {
  if (invoice?.status === "approved") return "invoice_approved";
  if (invoice?.status === "rejected") return "invoice_rejected";

  const map: Record<string, VoucherStatus> = {
    Draft: "draft",
    Sent: "sent",
    Viewed: "viewed",
    "Invoice Raised": "invoice_raised",
    "Under Review": "under_review",
    "Payment Confirmed": "payment_confirmed",
    "Payment Received": "payment_received",
  };
  return map[erpStatus ?? ""] ?? "draft";
}

function parseItemsPayload(raw?: string): ItemsJsonPayload {
  if (!raw?.trim()) return { items: [] };
  try {
    const parsed = JSON.parse(raw) as ItemsJsonPayload | VoucherItem[];
    if (Array.isArray(parsed)) return { items: parsed };
    return {
      items: parsed.items ?? [],
      meta: parsed.meta,
    };
  } catch {
    return { items: [] };
  }
}

function commentsToHistory(rows: ErpCommentRow[]): VoucherHistoryEntry[] {
  return rows.map((row, idx) => ({
    id: row.name ?? String(idx),
    timestamp: row.creation ?? new Date().toISOString(),
    action: row.content ?? "",
    actor: row.owner ?? "System",
    actor_role: "finance" as VoucherActorRole,
  }));
}

async function erpRecordToVoucher(
  doc: ErpVoucherRecord,
  history?: VoucherHistoryEntry[]
): Promise<Voucher> {
  const { items, meta } = parseItemsPayload(doc.items_json);
  let invoice: SupplierInvoice | undefined;
  let payment: PaymentConfirmation | undefined;

  if (doc.invoice_json?.trim()) {
    try {
      invoice = JSON.parse(doc.invoice_json) as SupplierInvoice;
    } catch {
      /* ignore */
    }
  }
  if (doc.payment_json?.trim()) {
    try {
      payment = JSON.parse(doc.payment_json) as PaymentConfirmation;
    } catch {
      /* ignore */
    }
  }

  const hist =
    history ?? commentsToHistory(await fetchVoucherComments(doc.name));

  return {
    id: doc.name,
    po_reference: doc.po_reference ?? "",
    grn_reference: doc.grn_reference ?? "",
    supplier: doc.supplier ?? "",
    supplier_name: meta?.supplier_name ?? doc.supplier ?? "",
    created_by: doc.created_by ?? "Finance Team",
    created_at: doc.creation ?? new Date().toISOString(),
    amount: doc.amount ?? 0,
    currency: doc.currency ?? "USD",
    items,
    status: erpToAppStatus(doc.status, invoice),
    payment_terms: meta?.payment_terms,
    due_date: meta?.due_date,
    notes: meta?.notes,
    history: hist,
    invoice,
    payment,
  };
}

/**
 * Fetches a Voucher by name. Only a genuine ERPNext 404/`DoesNotExistError`
 * is treated as "does not exist" (returns `null`) — every other failure
 * (permission, network, 5xx) is re-thrown so callers never mistake a real
 * backend error for a missing document (which previously surfaced as a
 * misleading "Invoice not found" even when the invoice existed in ERPNext).
 */
async function fetchErpVoucher(name: string): Promise<ErpVoucherRecord | null> {
  try {
    return (await erpnextClient.get(
      `${resourceBase()}/${encodeURIComponent(name)}`
    )) as ErpVoucherRecord;
  } catch (err) {
    if (isDocNotFoundError(err)) return null;
    // eslint-disable-next-line no-console
    console.error(`[Vouchers] Failed to fetch Voucher "${name}":`, err);
    throw err;
  }
}

async function fetchVoucherComments(voucherName: string): Promise<ErpCommentRow[]> {
  try {
    const rows = (await erpnextClient.get(buildResourceUrl("Comment"), {
      params: {
        filters: JSON.stringify([
          ["reference_doctype", "=", DOCTYPE],
          ["reference_name", "=", voucherName],
        ]),
        fields: JSON.stringify(["name", "content", "owner", "creation"]),
        order_by: "creation asc",
        limit_page_length: 100,
      },
    })) as ErpCommentRow[];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export async function addVoucherHistoryComment(
  voucherName: string,
  content: string
): Promise<void> {
  try {
    await erpnextClient.post(buildResourceUrl("Comment"), {
      doctype: "Comment",
      comment_type: "Comment",
      reference_doctype: DOCTYPE,
      reference_name: voucherName,
      content,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[Voucher History] Could not add comment:", msg);
  }
}

export async function getVoucherHistory(voucherName: string) {
  return fetchVoucherComments(voucherName);
}

/* -------------------------------------------------------------------------- */
/*  Status presentation (unchanged)                                           */
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
  if (v.status === "payment_received") return "Paid";
  if (v.payment || v.invoice.status === "paid" || v.status === "payment_confirmed") {
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

function assertCanManageVouchers(): void {
  const role = useAuthStore.getState().user?.role;
  if (!canManageVouchers(role)) {
    throw new Error(
      "Access denied. Only Finance Manager, Accounts Payable, or Finance Admin can manage vouchers, review supplier invoices, or release payments.",
    );
  }
}

function currentActor(): { name: string; role: VoucherActorRole } {
  const user = useAuthStore.getState().user;
  const role = user?.role;
  const actorRole: VoucherActorRole =
    role === "procurement" || role === "procurement_team"
      ? "procurement"
      : role === "admin"
        ? "admin"
        : "finance";
  return { name: user?.full_name || "Finance Team", role: actorRole };
}

function generatePaymentID(): string {
  const year = new Date().getFullYear();
  const seq = String(Date.now()).slice(-5);
  return `PAY-${year}-${seq}`;
}

/** Supplier portal identity for voucher list/detail (same rules both sides). */
export interface SupplierVoucherIdentity {
  /** ERPNext Supplier.name (Supplier Master link). */
  erpSupplierId: string;
  /** Company display label — matched only to voucher.supplier_name. */
  displayName?: string;
}

export function normalizeSupplierKey(value: string | null | undefined): string {
  let s = String(value ?? "").trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s.toLowerCase();
}

export function toSupplierVoucherIdentity(
  identifier: string | SupplierVoucherIdentity,
): SupplierVoucherIdentity {
  if (typeof identifier === "string") {
    const key = identifier.trim();
    return { erpSupplierId: key, displayName: key };
  }
  return {
    erpSupplierId: String(identifier.erpSupplierId || "").trim(),
    displayName: String(identifier.displayName || "").trim() || undefined,
  };
}

/**
 * Ownership check shared by list + detail.
 * - ID ↔ ID (erpSupplierId vs voucher.supplier)
 * - Name ↔ Name (displayName vs voucher.supplier_name)
 * Never compares a display name to a Supplier ID.
 */
export function voucherBelongsToSupplier(
  voucher: Pick<Voucher, "supplier" | "supplier_name">,
  identifier: string | SupplierVoucherIdentity,
): boolean {
  const identity = toSupplierVoucherIdentity(identifier);
  const erpId = normalizeSupplierKey(identity.erpSupplierId);
  const display = normalizeSupplierKey(identity.displayName);
  const voucherId = normalizeSupplierKey(voucher.supplier);
  const voucherName = normalizeSupplierKey(voucher.supplier_name);

  if (erpId && voucherId && erpId === voucherId) return true;
  if (display && voucherName && display === voucherName) return true;

  // Legacy single-string callers: allow the same key against either field
  // only when erp + display were set to the identical value.
  if (
    erpId &&
    display &&
    erpId === display &&
    (erpId === voucherId || erpId === voucherName)
  ) {
    return true;
  }

  return false;
}

export class SupplierVoucherAccessError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "SupplierVoucherAccessError";
    this.status = status;
  }
}

async function requireSupplierJwt(): Promise<string> {
  const result = await ensureSupplierAccessToken();
  if (!result.ok) {
    throw new SupplierVoucherAccessError(result.message, 401);
  }
  return result.token;
}

/**
 * Supplier voucher APIs — always attach a supplier JWT (same auth for
 * list/get/raise-invoice). Never call these endpoints anonymously.
 */
async function callSupplierVoucherApi<T>(
  action: "list" | "get" | "raise-invoice",
  body: Record<string, unknown>,
): Promise<T> {
  const token = await requireSupplierJwt();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-Bidsphere-Access-Token": token,
    Authorization: `Bearer ${token}`,
  };

  const res = await fetch(`/api/supplier-voucher/${action}`, {
    method: "POST",
    headers,
    credentials: "same-origin",
    body: JSON.stringify({
      ...body,
      access_token: token,
    }),
  });

  let json: { success?: boolean; error?: string } & Record<string, unknown> = {};
  try {
    json = (await res.json()) as typeof json;
  } catch {
    /* ignore */
  }

  if (!res.ok || json.success === false) {
    const message =
      json.error || `Supplier voucher request failed (${res.status}).`;
    throw new SupplierVoucherAccessError(message, res.status || 500);
  }
  return json as T;
}

function supplierIdentityFromSession(): SupplierVoucherIdentity {
  const session = readSupplierSession();
  const linked = String(session?.linkedSupplier || "").trim();
  const stored = String(session?.supplierName || "").trim();
  const company = String(session?.companyName || "").trim();
  return {
    erpSupplierId: linked || stored,
    displayName: company || stored || undefined,
  };
}

function mapApiVoucherToVoucher(raw: Record<string, unknown>): Voucher {
  const invoice = raw.invoice as Voucher["invoice"] | undefined;
  let status = String(raw.status || "sent") as VoucherStatus;
  if (invoice && typeof invoice === "object") {
    const invStatus = String(
      (invoice as { status?: string }).status || "",
    ).toLowerCase();
    if (invStatus === "approved") status = "invoice_approved";
    else if (invStatus === "rejected") status = "invoice_rejected";
  }
  return {
    id: String(raw.id || ""),
    po_reference: String(raw.po_reference || ""),
    grn_reference: String(raw.grn_reference || ""),
    supplier: String(raw.supplier || ""),
    supplier_name: String(raw.supplier_name || raw.supplier || ""),
    created_by: String(raw.created_by || "Finance Team"),
    created_at: String(raw.created_at || new Date().toISOString()),
    amount: Number(raw.amount) || 0,
    currency: String(raw.currency || "USD"),
    items: Array.isArray(raw.items) ? (raw.items as VoucherItem[]) : [],
    status,
    payment_terms: raw.payment_terms
      ? String(raw.payment_terms)
      : undefined,
    due_date: raw.due_date ? String(raw.due_date) : undefined,
    notes: raw.notes ? String(raw.notes) : undefined,
    invoice,
    payment: raw.payment as Voucher["payment"] | undefined,
    history: [],
  };
}

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

/* -------------------------------------------------------------------------- */
/*  CRUD — ERPNext                                                            */
/* -------------------------------------------------------------------------- */

export async function getAllVouchers(): Promise<Voucher[]> {
  try {
    const rows = (await erpnextClient.get(resourceBase(), {
      params: {
        fields: JSON.stringify(["*"]),
        limit_page_length: 100,
        order_by: "modified desc",
      },
    })) as ErpVoucherRecord[];
    if (!Array.isArray(rows)) return [];
    return Promise.all(rows.map((row) => erpRecordToVoucher(row, [])));
  } catch {
    return [];
  }
}

export async function getVoucherById(id: string): Promise<Voucher | null> {
  const doc = await fetchErpVoucher(id);
  if (!doc) return null;
  return erpRecordToVoucher(doc);
}

export async function getVoucherByGRN(grnRef: string): Promise<Voucher | null> {
  if (!grnRef) return null;
  try {
    const rows = (await erpnextClient.get(resourceBase(), {
      params: {
        filters: JSON.stringify([["grn_reference", "=", grnRef]]),
        fields: JSON.stringify(["name"]),
        limit_page_length: 1,
      },
    })) as Array<{ name: string }>;
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return getVoucherById(rows[0].name);
  } catch {
    return null;
  }
}

/**
 * Resolves a bare supplier invoice number (e.g. "INV-SUMMIT-0594") — as
 * opposed to the ERPNext Voucher name (e.g. "VCH-2026-00002") — to the
 * Voucher document that carries it in its embedded `invoice_json`.
 *
 * Supplier invoices raised through the portal are NOT their own ERPNext
 * document; they live as JSON inside the parent Voucher. So a URL/route
 * that only has the invoice number must look up the owning Voucher first
 * — it must never be treated as (and searched for) a `Purchase Invoice`
 * name, which uses a completely different naming series.
 */
export async function findVoucherByInvoiceNumber(
  invoiceNumber: string
): Promise<Voucher | null> {
  const trimmed = invoiceNumber.trim();
  if (!trimmed) return null;
  try {
    const rows = (await erpnextClient.get(resourceBase(), {
      params: {
        filters: JSON.stringify([
          ["invoice_json", "like", `%"invoice_number":"${trimmed}"%`],
        ]),
        fields: JSON.stringify(["name"]),
        limit_page_length: 5,
      },
    })) as Array<{ name: string }>;
    if (!Array.isArray(rows) || rows.length === 0) {
      console.info(
        `[Invoice Lookup] No Voucher found with invoice_number="${trimmed}".`
      );
      return null;
    }
    for (const row of rows) {
      const voucher = await getVoucherById(row.name);
      if (
        voucher?.invoice?.invoice_number?.toLowerCase() ===
        trimmed.toLowerCase()
      ) {
        console.info(
          `[Invoice Lookup] Resolved invoice_number="${trimmed}" -> Voucher "${voucher.id}".`
        );
        return voucher;
      }
    }
    console.info(
      `[Invoice Lookup] "like" filter matched candidate Voucher(s) but none had an exact invoice_number="${trimmed}" match.`
    );
    return null;
  } catch (err) {
    if (isDocNotFoundError(err)) return null;
    console.error(
      `[Invoice Lookup] ERP query failed while searching for invoice_number="${trimmed}":`,
      err
    );
    throw err;
  }
}

export async function getVoucheredGRNRefs(): Promise<Set<string>> {
  const vouchers = await getAllVouchers();
  return new Set(
    vouchers.map((v) => v.grn_reference).filter((ref): ref is string => !!ref)
  );
}

export async function excludeVoucheredGRNs<T extends { name: string }>(
  grns: T[]
): Promise<T[]> {
  const vouchered = await getVoucheredGRNRefs();
  return grns.filter((g) => !vouchered.has(g.name));
}

export async function getVouchersForSupplier(
  supplier: string | SupplierVoucherIdentity,
): Promise<Voucher[]> {
  const identity = toSupplierVoucherIdentity(supplier);
  try {
    const res = await callSupplierVoucherApi<{
      vouchers?: Record<string, unknown>[];
    }>("list", {
      erp_supplier_id: identity.erpSupplierId,
      display_name: identity.displayName || "",
    });
    return (res.vouchers ?? []).map((row) => mapApiVoucherToVoucher(row));
  } catch (err) {
    if (err instanceof SupplierVoucherAccessError && err.status === 401) {
      throw err;
    }
    // Fallback: transport/5xx only — never mask missing supplier JWT.
    // eslint-disable-next-line no-console
    console.warn("[Vouchers] supplier list API unavailable, using client filter:", err);
    const all = await getAllVouchers();
    return all.filter(
      (v) => v.status !== "draft" && voucherBelongsToSupplier(v, identity),
    );
  }
}

/**
 * Detail fetch using the same ownership rules as {@link getVouchersForSupplier}.
 * Throws {@link SupplierVoucherAccessError} with status 403/404 when denied.
 */
export async function getVoucherForSupplier(
  id: string,
  supplier: string | SupplierVoucherIdentity,
): Promise<Voucher | null> {
  const voucherId = String(id || "").trim();
  const identity = toSupplierVoucherIdentity(supplier);
  if (!voucherId) {
    throw new SupplierVoucherAccessError("Voucher id is required.", 400);
  }

  try {
    const res = await callSupplierVoucherApi<{
      voucher?: Record<string, unknown>;
    }>("get", {
      voucher_id: voucherId,
      erp_supplier_id: identity.erpSupplierId,
      display_name: identity.displayName || "",
    });
    if (!res.voucher) {
      throw new SupplierVoucherAccessError("Voucher not found.", 404);
    }
    return mapApiVoucherToVoucher(res.voucher);
  } catch (err) {
    if (err instanceof SupplierVoucherAccessError) {
      // Do not fall back on auth failures — that masked missing JWTs and made
      // voucher view succeed while Create Invoice failed.
      if (
        err.status === 401 ||
        err.status === 403 ||
        err.status === 404 ||
        err.status === 400
      ) {
        throw err;
      }
    }

    // Transport/5xx only: identical ownership rules against ERP list.
    let v: Voucher | null = null;
    try {
      v = await getVoucherById(voucherId);
    } catch {
      const all = await getAllVouchers();
      v = all.find((row) => row.id === voucherId) ?? null;
    }

    // eslint-disable-next-line no-console
    console.info("[Vouchers] detail permission check", {
      requested_voucher_id: voucherId,
      supplier_mapped_from_session: identity,
      voucher_supplier: v?.supplier ?? "",
      voucher_supplier_name: v?.supplier_name ?? "",
      permission_decision: !v
        ? "deny_not_found"
        : v.status === "draft"
          ? "deny_draft"
          : voucherBelongsToSupplier(v, identity)
            ? "allow"
            : "deny_forbidden",
    });

    if (!v || v.status === "draft") {
      throw new SupplierVoucherAccessError("Voucher not found.", 404);
    }
    if (!voucherBelongsToSupplier(v, identity)) {
      throw new SupplierVoucherAccessError(
        "You do not have access to this voucher.",
        403,
      );
    }
    return v;
  }
}

export async function getAllInvoices(): Promise<InvoiceRecord[]> {
  const vouchers = await getAllVouchers();
  return vouchers
    .map(voucherToInvoiceRecord)
    .filter((r): r is InvoiceRecord => r !== null);
}

export async function getInvoicesForSupplier(
  supplier: string | SupplierVoucherIdentity,
): Promise<InvoiceRecord[]> {
  const identity = toSupplierVoucherIdentity(supplier);
  const vouchers = await getVouchersForSupplier(identity);
  return vouchers
    .filter((v) => v.invoice && voucherBelongsToSupplier(v, identity))
    .map(voucherToInvoiceRecord)
    .filter((r): r is InvoiceRecord => r !== null);
}

export async function getAllPayments(): Promise<PaymentRecord[]> {
  const vouchers = await getAllVouchers();
  return vouchers
    .map(voucherToPaymentRecord)
    .filter((r): r is PaymentRecord => r !== null);
}

export async function getPaymentsForSupplier(
  supplier: string | SupplierVoucherIdentity,
): Promise<PaymentRecord[]> {
  const identity = toSupplierVoucherIdentity(supplier);
  const vouchers = await getVouchersForSupplier(identity);
  return vouchers
    .filter((v) => v.payment && voucherBelongsToSupplier(v, identity))
    .map(voucherToPaymentRecord)
    .filter((r): r is PaymentRecord => r !== null);
}

export async function getVouchersAwaitingPayment(): Promise<Voucher[]> {
  const vouchers = await getAllVouchers();
  return vouchers.filter(
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

export async function getPaymentKpis(): Promise<PaymentModuleKpis> {
  const vouchers = await getAllVouchers();
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

export async function createVoucher(
  data: Partial<Voucher> & { items?: VoucherItem[] }
): Promise<Voucher> {
  assertCanManageVouchers();

  if (data.grn_reference) {
    const existing = await getVoucherByGRN(data.grn_reference);
    if (existing) {
      // eslint-disable-next-line no-console
      console.log("[createVoucher] existing voucher for GRN", existing.id);
      return existing;
    }
  }

  const itemsPayload: ItemsJsonPayload = {
    items: data.items ?? [],
    meta: {
      supplier_name: data.supplier_name ?? data.supplier,
      payment_terms: data.payment_terms,
      due_date: data.due_date,
      notes: data.notes,
    },
  };

  const body = {
    doctype: DOCTYPE,
    po_reference: data.po_reference || "",
    grn_reference: data.grn_reference || "",
    supplier: data.supplier || "",
    created_by: currentActor().name,
    amount: data.amount || 0,
    currency: data.currency || "USD",
    status: "Draft",
    items_json: JSON.stringify(itemsPayload),
  };

  // eslint-disable-next-line no-console
  console.log("Calling voucher API", body);

  let created: ErpVoucherRecord;
  try {
    created = (await erpnextClient.post(
      resourceBase(),
      body,
    )) as ErpVoucherRecord;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[createVoucher] ERPNext POST failed:", err);
    throw err instanceof Error
      ? err
      : new Error("Voucher create request failed.");
  }

  // eslint-disable-next-line no-console
  console.log("Voucher API response", created);

  if (!created?.name) {
    throw new Error(
      "Voucher was created but ERPNext did not return a document name.",
    );
  }

  await addVoucherHistoryComment(created.name, "Voucher created by Finance");
  const voucher = await erpRecordToVoucher(created);
  voucherNotify(voucher, "finance", `Voucher ${voucher.id} created`);
  return voucher;
}

async function updateVoucherStatus(
  name: string,
  status: ErpVoucherStatus,
  historyNote: string,
  extra?: Record<string, unknown>,
  opts?: { silent?: boolean },
): Promise<Voucher> {
  const config = opts?.silent ? withSilent() : undefined;
  await erpnextClient.put(
    `${resourceBase()}/${encodeURIComponent(name)}`,
    {
      status,
      ...extra,
    },
    config,
  );
  await addVoucherHistoryComment(name, historyNote);
  const updated = await getVoucherById(name);
  if (!updated) throw new Error("Voucher not found after update");
  bumpStore();
  return updated;
}

export async function sendVoucherToSupplier(id: string): Promise<Voucher | null> {
  assertCanManageVouchers();
  const v = await getVoucherById(id);
  if (!v) return null;
  const updated = await updateVoucherStatus(id, "Sent", "Voucher sent to supplier");
  voucherNotify(
    updated,
    "supplier",
    `You have received Voucher ${id} from Netlink. Please review and raise an invoice.`
  );
  voucherNotify(updated, "procurement", `Voucher ${id} sent to ${updated.supplier_name}`);
  return updated;
}

export async function markVoucherViewed(id: string): Promise<Voucher | null> {
  const v = await getVoucherById(id);
  if (!v || v.status !== "sent") return v;
  try {
    // Ensure supplier JWT is present (dedicated key) before the payables PUT.
    // Finance logout clears the mirrored shared key; without a principal the
    // interceptor omits X-Bidsphere-Access-Token → 401 → /login.
    const token = await ensureSupplierAccessToken();
    if (!token.ok) {
      // eslint-disable-next-line no-console
      console.warn("[Vouchers] markVoucherViewed skipped:", token.message);
      return v;
    }
    return await updateVoucherStatus(
      id,
      "Viewed",
      "Supplier viewed the voucher",
      undefined,
      // Non-blocking UX: never treat a view-mark failure as global session expiry.
      { silent: true },
    );
  } catch (err) {
    // Viewing must remain available even if the status write is denied.
    // eslint-disable-next-line no-console
    console.warn("[Vouchers] markVoucherViewed failed (non-blocking):", err);
    return v;
  }
}

/**
 * Supplier Portal invoice creation — uses `/api/supplier-voucher/raise-invoice`
 * (supplier JWT required). Never uses Finance/Admin voucher mutation helpers.
 */
export async function supplierRaiseInvoice(
  voucherId: string,
  invoice: SupplierInvoice,
): Promise<Voucher> {
  const id = String(voucherId || "").trim();
  if (!id) {
    throw new SupplierVoucherAccessError("Voucher id is required.", 400);
  }

  const token = await requireSupplierJwt();

  const identity = supplierIdentityFromSession();

  const payload: SupplierInvoice = {
    ...invoice,
    invoice_number: String(invoice.invoice_number || "").trim(),
    due_date: String(invoice.due_date || "").trim(),
    payment_terms: String(invoice.payment_terms || "").trim(),
    notes: String(invoice.notes || ""),
    status: "submitted",
    rejection_reason: undefined,
    reviewed_by: undefined,
    reviewed_at: undefined,
  };

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.info("[supplierRaiseInvoice] portal raise-invoice request", {
      voucher_id: id,
      erp_supplier_id: identity.erpSupplierId,
      display_name: identity.displayName,
      invoice: payload,
      has_access_token: Boolean(token),
    });
  }

  try {
    const res = await callSupplierVoucherApi<{
      voucher?: Record<string, unknown>;
    }>("raise-invoice", {
      voucher_id: id,
      erp_supplier_id: identity.erpSupplierId,
      display_name: identity.displayName || "",
      invoice: payload,
    });

    if (!res.voucher) {
      throw new SupplierVoucherAccessError(
        "Invoice was not returned by the server.",
        502,
      );
    }

    const updated = mapApiVoucherToVoucher(res.voucher);
    // Ensure app status reflects Invoice Raised / submitted invoice.
    if (!updated.status || updated.status === "draft") {
      updated.status = "invoice_raised";
    }

    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.info("[supplierRaiseInvoice] portal raise-invoice response", {
        voucher_id: updated.id,
        status: updated.status,
        invoice: updated.invoice,
      });
    }

    bumpStore();
    voucherNotify(
      updated,
      "finance",
      `Supplier submitted an invoice for Voucher ${id}. Total: $${Number(payload.total).toFixed(2)}`,
    );
    voucherNotify(
      updated,
      "procurement",
      `Invoice received from ${updated.supplier_name} for Voucher ${id}`,
    );
    return updated;
  } catch (err) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error("[supplierRaiseInvoice] portal raise-invoice error", err);
    }
    if (err instanceof SupplierVoucherAccessError) throw err;
    const status =
      err && typeof err === "object" && "status" in err
        ? Number((err as { status?: number }).status) || 500
        : 500;
    throw new SupplierVoucherAccessError(
      err instanceof Error
        ? err.message
        : "Could not create the supplier invoice.",
      status,
    );
  }
}

export async function approveInvoice(voucherId: string): Promise<Voucher | null> {
  assertCanManageVouchers();
  const v = await getVoucherById(voucherId);
  if (!v?.invoice) return null;
  const actor = currentActor();
  const invoicePayload: SupplierInvoice = {
    ...v.invoice,
    status: "approved",
    reviewed_by: actor.name,
    reviewed_at: nowERPDateTime(),
    rejection_reason: undefined,
  };
  const updated = await updateVoucherStatus(
    voucherId,
    "Under Review",
    `Invoice ${v.invoice.invoice_number} approved by Finance`,
    { invoice_json: JSON.stringify(invoicePayload) }
  );
  voucherNotify(
    updated,
    "supplier",
    `Your invoice ${v.invoice.invoice_number} for Voucher ${voucherId} was approved. Payment will follow.`
  );
  voucherNotify(updated, "procurement", `Invoice approved for Voucher ${voucherId}`);
  return updated;
}

export async function rejectInvoice(
  voucherId: string,
  reason: string
): Promise<Voucher | null> {
  assertCanManageVouchers();
  const v = await getVoucherById(voucherId);
  if (!v?.invoice) return null;
  const actor = currentActor();
  const invoicePayload: SupplierInvoice = {
    ...v.invoice,
    status: "rejected",
    reviewed_by: actor.name,
    reviewed_at: nowERPDateTime(),
    rejection_reason: reason,
  };
  const updated = await updateVoucherStatus(
    voucherId,
    "Under Review",
    `Invoice ${v.invoice.invoice_number} rejected by Finance`,
    { invoice_json: JSON.stringify(invoicePayload) }
  );
  voucherNotify(
    updated,
    "supplier",
    `Your invoice ${v.invoice.invoice_number} for Voucher ${voucherId} was rejected: ${reason}. Please review and re-submit.`
  );
  voucherNotify(updated, "procurement", `Invoice rejected for Voucher ${voucherId}`);
  return updated;
}

export async function confirmPayment(
  voucherId: string,
  payment: PaymentConfirmation
): Promise<Voucher | null> {
  assertCanManageVouchers();
  const v = await getVoucherById(voucherId);
  if (!v) return null;

  const paymentPayload: PaymentConfirmation = {
    ...payment,
    payment_id: payment.payment_id ?? generatePaymentID(),
    status: "Paid",
  };

  let invoicePayload = v.invoice;
  if (invoicePayload) {
    invoicePayload = {
      ...invoicePayload,
      status: "paid",
      paid_at: payment.confirmed_at,
    };
  }

  await erpnextClient.put(`${resourceBase()}/${encodeURIComponent(voucherId)}`, {
    status: "Payment Confirmed",
    payment_json: JSON.stringify(paymentPayload),
    ...(invoicePayload ? { invoice_json: JSON.stringify(invoicePayload) } : {}),
  });
  await addVoucherHistoryComment(
    voucherId,
    `Payment released by Finance — Ref: ${payment.reference_number} · $${payment.amount.toFixed(2)}`
  );

  const updated = await getVoucherById(voucherId);
  if (!updated) return null;

  voucherNotify(
    updated,
    "supplier",
    `Payment of $${payment.amount.toFixed(2)} has been released for Voucher ${voucherId}. Ref: ${payment.reference_number}`
  );
  voucherNotify(updated, "procurement", `Payment released for Voucher ${voucherId}`);
  bumpStore();
  return updated;
}

export const releasePayment = confirmPayment;

export async function supplierConfirmPaymentReceived(
  voucherId: string
): Promise<Voucher | null> {
  const updated = await updateVoucherStatus(
    voucherId,
    "Payment Received",
    "Supplier confirmed payment received"
  );
  voucherNotify(
    updated,
    "finance",
    `Supplier confirmed payment receipt for Voucher ${voucherId}`
  );
  voucherNotify(updated, "procurement", `Voucher ${voucherId} fully settled`);
  return updated;
}

/** Legacy no-op — localStorage voucher migration removed. */
export function runVoucherStoreMigration(): boolean {
  return false;
}

export function clearAllVouchers(): void {
  console.warn("[Vouchers] clearAllVouchers is disabled — vouchers live in ERPNext.");
}
