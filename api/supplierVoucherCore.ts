/**
 * Supplier portal voucher list/detail — shared ownership rules.
 *
 * Used by:
 *   - api/supplier-voucher.ts (Vercel)
 *   - vite.config.ts middleware (local dev)
 *
 * Ownership matches Supplier Master ID to voucher.supplier and display name
 * to voucher.supplier_name — never cross-compares name vs ID.
 */
import { sanitizeErpPayloadDates } from "./erpDateSanitize.js";

export const VOUCHER_DOCTYPE = "Voucher";

export interface ErpAdminConfig {
  baseUrl: string;
  key: string;
  secret: string;
}

export class SupplierVoucherError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "SupplierVoucherError";
    this.status = status;
  }
}

/** Session / JWT identity used for list + detail (identical rules). */
export interface SupplierVoucherIdentity {
  /** ERPNext Supplier.name (Supplier Master link value). */
  erpSupplierId: string;
  /** Company / display label — matched only to voucher.supplier_name. */
  displayName?: string;
}

export interface SupplierVoucherView {
  id: string;
  po_reference: string;
  grn_reference: string;
  supplier: string;
  supplier_name: string;
  created_by: string;
  created_at: string;
  amount: number;
  currency: string;
  items: unknown[];
  status: string;
  payment_terms?: string;
  due_date?: string;
  notes?: string;
  invoice?: unknown;
  payment?: unknown;
  erp_status?: string;
}

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

export function normalizeSupplierKey(value: string | null | undefined): string {
  // Strip accidental wrapping quotes from ERP Link values / JWT claims
  // (e.g. `"Atlantic Precision Manufacturing."`).
  let s = String(value ?? "").trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s.toLowerCase();
}

/**
 * Same permission predicate for list and detail.
 * - ID ↔ ID: erpSupplierId vs voucher.supplier
 * - Name ↔ Name: displayName vs voucher.supplier_name
 * Never compares a display name to a Supplier ID (or vice versa).
 */
export function voucherBelongsToSupplierIdentity(
  voucher: { supplier?: string; supplier_name?: string },
  identity: SupplierVoucherIdentity,
): boolean {
  const erpId = normalizeSupplierKey(identity.erpSupplierId);
  const display = normalizeSupplierKey(identity.displayName);
  const voucherId = normalizeSupplierKey(voucher.supplier);
  const voucherName = normalizeSupplierKey(voucher.supplier_name);

  // Supplier Master ID ↔ voucher.supplier (Link field)
  if (erpId && voucherId && erpId === voucherId) return true;
  // Display name ↔ voucher.supplier_name only (never cross-compare to ID)
  if (display && voucherName && display === voucherName) return true;

  return false;
}

export function readErpAdminConfig(): ErpAdminConfig {
  const baseUrl = (
    process.env.ERPNEXT_URL ??
    process.env.VITE_PROXY_TARGET ??
    process.env.VITE_ERPNEXT_URL ??
    ""
  )
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api$/, "");

  const key = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
  const secret = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";

  if (!baseUrl || !key || !secret) {
    throw new SupplierVoucherError(
      "Supplier voucher backend misconfigured: missing ERPNEXT_URL / ERP_API_KEY / ERP_API_SECRET.",
      500,
    );
  }
  return { baseUrl, key, secret };
}

async function erpFetch<T = unknown>(
  cfg: ErpAdminConfig,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; data: T | null; raw: unknown }> {
  const res = await fetch(`${cfg.baseUrl}/api/${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `token ${cfg.key}:${cfg.secret}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body:
      init?.body !== undefined
        ? JSON.stringify(sanitizeErpPayloadDates(init.body))
        : undefined,
  });

  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }

  if (!res.ok) {
    return { status: res.status, data: null, raw: json };
  }

  const data = (json as { data?: T })?.data ?? (json as T);
  return { status: res.status, data: data ?? null, raw: json };
}

function parseItemsMeta(raw?: string): {
  items: unknown[];
  supplier_name?: string;
  payment_terms?: string;
  due_date?: string;
  notes?: string;
} {
  if (!raw?.trim()) return { items: [] };
  try {
    const parsed = JSON.parse(raw) as
      | { items?: unknown[]; meta?: Record<string, string> }
      | unknown[];
    if (Array.isArray(parsed)) return { items: parsed };
    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
      supplier_name: parsed.meta?.supplier_name,
      payment_terms: parsed.meta?.payment_terms,
      due_date: parsed.meta?.due_date,
      notes: parsed.meta?.notes,
    };
  } catch {
    return { items: [] };
  }
}

function erpStatusToApp(erpStatus: string | undefined, hasInvoice: boolean): string {
  if (hasInvoice) {
    /* invoice status refined on client if needed */
  }
  const map: Record<string, string> = {
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

export function toSupplierVoucherView(doc: ErpVoucherRecord): SupplierVoucherView {
  const meta = parseItemsMeta(doc.items_json);
  let invoice: unknown;
  let payment: unknown;
  if (doc.invoice_json?.trim()) {
    try {
      invoice = JSON.parse(doc.invoice_json);
    } catch {
      /* ignore */
    }
  }
  if (doc.payment_json?.trim()) {
    try {
      payment = JSON.parse(doc.payment_json);
    } catch {
      /* ignore */
    }
  }
  const supplier = String(doc.supplier ?? "").trim();
  const supplierName = String(meta.supplier_name || supplier).trim();
  return {
    id: doc.name,
    po_reference: doc.po_reference ?? "",
    grn_reference: doc.grn_reference ?? "",
    supplier,
    supplier_name: supplierName,
    created_by: doc.created_by ?? "Finance Team",
    created_at: doc.creation ?? new Date().toISOString(),
    amount: Number(doc.amount) || 0,
    currency: doc.currency ?? "USD",
    items: meta.items,
    status: erpStatusToApp(doc.status, Boolean(invoice)),
    payment_terms: meta.payment_terms,
    due_date: meta.due_date,
    notes: meta.notes,
    invoice,
    payment,
    erp_status: doc.status,
  };
}

function logDecision(input: {
  requestedVoucherId: string;
  loggedInSupplier: string;
  mappedSupplier: SupplierVoucherIdentity;
  voucherSupplier: string;
  voucherSupplierName: string;
  decision: "allow" | "deny_forbidden" | "deny_not_found" | "deny_draft";
}): void {
  // eslint-disable-next-line no-console
  console.info("[supplier-voucher]", {
    requested_voucher_id: input.requestedVoucherId,
    logged_in_supplier: input.loggedInSupplier,
    supplier_mapped_from_session: {
      erp_supplier_id: input.mappedSupplier.erpSupplierId,
      display_name: input.mappedSupplier.displayName ?? "",
    },
    voucher_supplier: input.voucherSupplier,
    voucher_supplier_name: input.voucherSupplierName,
    permission_decision: input.decision,
  });
}

export function resolveIdentity(input: {
  jwtSupplier: string;
  erpSupplierId?: string;
  displayName?: string;
}): SupplierVoucherIdentity {
  const jwt = String(input.jwtSupplier || "").trim();
  const clientErp = String(input.erpSupplierId || "").trim();
  const display = String(input.displayName || "").trim();
  // JWT supplier is authoritative. Accept a client erp id only when it
  // matches the token (helps session hydration); never trust a different ID.
  const erp =
    jwt ||
    clientErp;
  const clientMatchesJwt =
    !clientErp ||
    !jwt ||
    normalizeSupplierKey(clientErp) === normalizeSupplierKey(jwt);
  return {
    erpSupplierId: erp,
    displayName: clientMatchesJwt ? display || undefined : undefined,
  };
}

/** Ownership for portal mutations — must align with JWT supplier claim. */
export function assertVoucherOwnedByLoggedInSupplier(
  voucher: { supplier?: string; supplier_name?: string },
  loggedInSupplier: string,
  identity: SupplierVoucherIdentity,
): void {
  const jwt = normalizeSupplierKey(loggedInSupplier);
  if (!jwt) {
    throw new SupplierVoucherError("Not authenticated.", 401);
  }

  const voucherId = normalizeSupplierKey(voucher.supplier);
  const voucherName = normalizeSupplierKey(voucher.supplier_name);
  if ((voucherId && jwt === voucherId) || (voucherName && jwt === voucherName)) {
    return;
  }

  // Session display name may match supplier_name only when session erp id
  // is the same supplier as the JWT (blocks spoofed company labels).
  const sessionErp = normalizeSupplierKey(identity.erpSupplierId);
  if (sessionErp && sessionErp !== jwt) {
    throw new SupplierVoucherError(
      "You do not have access to this voucher.",
      403,
    );
  }

  if (
    voucherBelongsToSupplierIdentity(voucher, {
      erpSupplierId: loggedInSupplier,
      displayName: identity.displayName,
    })
  ) {
    return;
  }

  throw new SupplierVoucherError(
    "You do not have access to this voucher.",
    403,
  );
}

/** List vouchers visible to this supplier (non-draft + ownership). */
export async function listSupplierVouchers(input: {
  loggedInSupplier: string;
  identity: SupplierVoucherIdentity;
}): Promise<SupplierVoucherView[]> {
  const cfg = readErpAdminConfig();
  const result = await erpFetch<ErpVoucherRecord[]>(
    cfg,
    `resource/${encodeURIComponent(VOUCHER_DOCTYPE)}?${new URLSearchParams({
      fields: JSON.stringify(["*"]),
      limit_page_length: "200",
      order_by: "modified desc",
    }).toString()}`,
  );

  if (result.status >= 400 || !Array.isArray(result.data)) {
    throw new SupplierVoucherError(
      "Unable to load vouchers.",
      result.status >= 400 ? result.status : 502,
    );
  }

  const out: SupplierVoucherView[] = [];
  for (const row of result.data) {
    const view = toSupplierVoucherView(row);
    if (view.status === "draft" || view.erp_status === "Draft") continue;
    const allowed = voucherBelongsToSupplierIdentity(view, input.identity);
    if (allowed) out.push(view);
  }

  // eslint-disable-next-line no-console
  console.info("[supplier-voucher] list", {
    logged_in_supplier: input.loggedInSupplier,
    supplier_mapped_from_session: input.identity,
    visible_count: out.length,
    permission_decision: "allow",
  });

  return out;
}

/**
 * Detail fetch with the same ownership rules as list.
 * - 404 only when the voucher document does not exist (or is draft for portal)
 * - 403 when it exists but belongs to another supplier
 */
export async function getSupplierVoucher(input: {
  voucherId: string;
  loggedInSupplier: string;
  identity: SupplierVoucherIdentity;
}): Promise<SupplierVoucherView> {
  const voucherId = String(input.voucherId || "").trim();
  if (!voucherId) {
    throw new SupplierVoucherError("Voucher id is required.", 400);
  }

  const cfg = readErpAdminConfig();
  const result = await erpFetch<ErpVoucherRecord>(
    cfg,
    `resource/${encodeURIComponent(VOUCHER_DOCTYPE)}/${encodeURIComponent(voucherId)}`,
  );

  if (result.status === 404) {
    logDecision({
      requestedVoucherId: voucherId,
      loggedInSupplier: input.loggedInSupplier,
      mappedSupplier: input.identity,
      voucherSupplier: "",
      voucherSupplierName: "",
      decision: "deny_not_found",
    });
    throw new SupplierVoucherError("Voucher not found.", 404);
  }

  if (result.status >= 400 || !result.data?.name) {
    // List-fallback: same source the list endpoint uses, so a voucher that
    // appears in the supplier list is never lost to a flaky get-by-name.
    const listed = await listSupplierVouchers({
      loggedInSupplier: input.loggedInSupplier,
      identity: input.identity,
    });
    const fromList = listed.find((v) => v.id === voucherId);
    if (fromList) {
      logDecision({
        requestedVoucherId: voucherId,
        loggedInSupplier: input.loggedInSupplier,
        mappedSupplier: input.identity,
        voucherSupplier: fromList.supplier,
        voucherSupplierName: fromList.supplier_name,
        decision: "allow",
      });
      return fromList;
    }
    throw new SupplierVoucherError(
      "Unable to load voucher.",
      result.status >= 400 ? result.status : 502,
    );
  }

  const view = toSupplierVoucherView(result.data);

  if (view.status === "draft" || view.erp_status === "Draft") {
    logDecision({
      requestedVoucherId: voucherId,
      loggedInSupplier: input.loggedInSupplier,
      mappedSupplier: input.identity,
      voucherSupplier: view.supplier,
      voucherSupplierName: view.supplier_name,
      decision: "deny_draft",
    });
    // Draft vouchers are not exposed on the supplier portal (same as list).
    throw new SupplierVoucherError("Voucher not found.", 404);
  }

  try {
    assertVoucherOwnedByLoggedInSupplier(
      view,
      input.loggedInSupplier,
      input.identity,
    );
  } catch (err) {
    logDecision({
      requestedVoucherId: voucherId,
      loggedInSupplier: input.loggedInSupplier,
      mappedSupplier: input.identity,
      voucherSupplier: view.supplier,
      voucherSupplierName: view.supplier_name,
      decision: "deny_forbidden",
    });
    throw err;
  }

  logDecision({
    requestedVoucherId: voucherId,
    loggedInSupplier: input.loggedInSupplier,
    mappedSupplier: input.identity,
    voucherSupplier: view.supplier,
    voucherSupplierName: view.supplier_name,
    decision: "allow",
  });

  return view;
}

/** Supplier-submitted invoice payload (portal create only — not Finance). */
export interface SupplierInvoiceInput {
  invoice_number: string;
  raised_at: string;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  payment_terms: string;
  due_date: string;
  notes?: string;
}

/**
 * Supplier Portal invoice creation.
 * Verifies ownership, persists invoice_json, sets status to Invoice Raised.
 * Uses ERP service credentials after supplier JWT auth (caller enforces auth).
 */
export async function raiseSupplierInvoice(input: {
  voucherId: string;
  loggedInSupplier: string;
  identity: SupplierVoucherIdentity;
  invoice: SupplierInvoiceInput;
}): Promise<SupplierVoucherView> {
  const voucherId = String(input.voucherId || "").trim();
  const invoiceNumber = String(input.invoice?.invoice_number || "").trim();
  if (!voucherId) {
    throw new SupplierVoucherError("Voucher id is required.", 400);
  }
  if (!invoiceNumber) {
    throw new SupplierVoucherError("Invoice number is required.", 400);
  }
  if (!String(input.invoice?.due_date || "").trim()) {
    throw new SupplierVoucherError("Due date is required.", 400);
  }
  if (!(Number(input.invoice?.total) > 0)) {
    throw new SupplierVoucherError("Invoice total must be greater than zero.", 400);
  }

  const current = await getSupplierVoucher({
    voucherId,
    loggedInSupplier: input.loggedInSupplier,
    identity: input.identity,
  });

  const openForInvoice =
    current.status === "sent" ||
    current.status === "viewed" ||
    current.status === "invoice_rejected" ||
    current.erp_status === "Sent" ||
    current.erp_status === "Viewed";

  if (!openForInvoice) {
    throw new SupplierVoucherError(
      "This voucher is not open for invoice creation.",
      400,
    );
  }

  const existingInvoice = current.invoice as
    | { invoice_number?: string; status?: string }
    | undefined;
  if (
    existingInvoice &&
    current.status !== "invoice_rejected" &&
    (current.status === "invoice_raised" ||
      current.status === "under_review" ||
      current.status === "invoice_approved" ||
      existingInvoice.status === "submitted" ||
      existingInvoice.status === "approved")
  ) {
    throw new SupplierVoucherError(
      `An invoice (${existingInvoice.invoice_number || "existing"}) already exists for this voucher.`,
      409,
    );
  }

  const invoicePayload = {
    invoice_number: invoiceNumber,
    raised_at: String(input.invoice.raised_at || "").trim(),
    subtotal: Number(input.invoice.subtotal) || 0,
    tax_rate: Number(input.invoice.tax_rate) || 0,
    tax_amount: Number(input.invoice.tax_amount) || 0,
    total: Number(input.invoice.total) || 0,
    payment_terms: String(input.invoice.payment_terms || "").trim(),
    due_date: String(input.invoice.due_date || "").trim(),
    notes: String(input.invoice.notes || ""),
    status: "submitted",
  };

  // eslint-disable-next-line no-console
  console.info("[supplier-voucher] raise-invoice", {
    requested_voucher_id: voucherId,
    logged_in_supplier: input.loggedInSupplier,
    supplier_mapped_from_session: input.identity,
    voucher_supplier: current.supplier,
    voucher_supplier_name: current.supplier_name,
    invoice_number: invoiceNumber,
    permission_decision: "allow",
  });

  const cfg = readErpAdminConfig();
  const put = await erpFetch<ErpVoucherRecord>(
    cfg,
    `resource/${encodeURIComponent(VOUCHER_DOCTYPE)}/${encodeURIComponent(voucherId)}`,
    {
      method: "PUT",
      body: {
        status: "Invoice Raised",
        invoice_json: JSON.stringify(invoicePayload),
      },
    },
  );

  if (put.status >= 400 || !put.data) {
    // eslint-disable-next-line no-console
    console.error("[supplier-voucher] raise-invoice ERP write failed", {
      status: put.status,
      raw: put.raw,
    });
    throw new SupplierVoucherError(
      put.status === 403
        ? "You do not have permission to create an invoice for this voucher."
        : put.status === 404
          ? "Voucher not found."
          : "Unable to save the supplier invoice. Please try again.",
      put.status >= 400 && put.status < 600 ? put.status : 502,
    );
  }

  // Best-effort audit comment (must not block invoice creation).
  try {
    await erpFetch(cfg, "resource/Comment", {
      method: "POST",
      body: {
        doctype: "Comment",
        comment_type: "Comment",
        reference_doctype: VOUCHER_DOCTYPE,
        reference_name: voucherId,
        content: `Supplier submitted invoice ${invoiceNumber} for $${invoicePayload.total.toFixed(2)}`,
      },
    });
  } catch {
    /* ignore */
  }

  return getSupplierVoucher({
    voucherId,
    loggedInSupplier: input.loggedInSupplier,
    identity: input.identity,
  });
}
