/**
 * Supplier Portal — all list/detail queries scoped to the logged-in supplier.
 */

import { getPaymentEntries, getPurchaseInvoice, getPurchaseInvoices } from "./accounts";
import {
  apiGet,
  apiPost,
  buildListConfig,
  buildResourceUrl,
  type Filter,
} from "./erpnext";
import { getPurchaseOrders, getPurchaseReceipt, getPurchaseReceipts } from "./purchasing";
import { getRFQSchema } from "./rfqSchema";
import { getSupplierQuotationsBySupplier } from "./sourcing";
import type {
  PaymentEntry,
  PurchaseReceipt,
} from "../types/erpnext";
import {
  grnDisplayStatus,
  isActivePOStatus,
  primaryPOFromInvoice,
  primaryPOFromReceipt,
  primaryWarehouseFromReceipt,
} from "../utils/supplierPortalUtils";

export interface RFQRow {
  name: string;
  status?: string;
  modified?: string;
  /** 0 = Draft (not yet published to suppliers), 1 = Submitted/published. */
  docstatus?: number;
  company?: string;
  transaction_date?: string;
  /**
   * Normalized due-date value for the UI.
   * Sourced from whichever due-date field exists on the RFQ DocType
   * (never hard-require `valid_till` in the list query).
   */
  valid_till?: string | null;
  /** Optional buyer message / short description shown as the RFQ title line. */
  message_for_supplier?: string | null;
}

export interface PORow {
  name: string;
  supplier?: string;
  supplier_name?: string;
  transaction_date?: string;
  schedule_date?: string;
  grand_total?: number;
  status?: string;
  docstatus?: number;
  modified?: string;
}

export interface SQRow {
  name: string;
  supplier?: string;
  transaction_date?: string;
  grand_total?: number;
  status?: string;
  modified?: string;
}

export interface GRNSummary {
  name: string;
  poNumber?: string;
  posting_date?: string;
  warehouse?: string;
  itemCount: number;
  status: "Pending" | "Partial" | "Completed";
  modified?: string;
}

export interface InvoiceSummary {
  name: string;
  poReference?: string;
  posting_date?: string;
  grand_total?: number;
  status?: string;
  modified?: string;
}

export interface PaymentSummary {
  name: string;
  invoiceReference?: string;
  posting_date?: string;
  mode_of_payment?: string;
  paid_amount?: number;
  received_amount?: number;
  status?: string;
  modified?: string;
}

/**
 * Supplier Portal PO list filters.
 *
 * - Match ERPNext Link field `supplier` (Supplier.name), never display name.
 * - Include Draft (0) + Submitted (1): Procurement issues POs as Draft with
 *   delivery status "Pending Acceptance"; suppliers must see them to Accept.
 * - Exclude Cancelled / Closed only.
 */
export function buildSupplierPOFilters(erpSupplierId: string): Filter[] {
  return [
    ["supplier", "=", erpSupplierId],
    ["docstatus", "in", [0, 1]],
    ["status", "not in", ["Cancelled", "Closed"]],
  ];
}

const LOG = "[SupplierPortal]";

/** Always-safe RFQ list fields (standard ERPNext Request for Quotation). */
const CORE_SUPPLIER_RFQ_FIELDS = [
  "name",
  "status",
  "modified",
  "docstatus",
  "company",
  "transaction_date",
] as const;

/**
 * Candidate due-date fields — first match present on the DocType metadata wins.
 * Never hardcode a single custom/optional name into list queries.
 */
const RFQ_DUE_DATE_CANDIDATES = [
  "valid_till",
  "custom_valid_till",
  "custom_quote_valid_till",
  "quote_valid_till",
  "closing_date",
  "custom_closing_date",
  "custom_due_date",
  "due_date",
] as const;

/** Optional title / description fields. */
const RFQ_TITLE_CANDIDATES = ["message_for_supplier"] as const;

type SupplierRfqFieldPlan = {
  fields: string[];
  dueDateField: string | null;
  titleField: string | null;
};

let _supplierRfqFieldPlan: SupplierRfqFieldPlan | null = null;
let _supplierRfqFieldPlanPromise: Promise<SupplierRfqFieldPlan> | null = null;

function isDev(): boolean {
  return Boolean(import.meta.env.DEV);
}

function errorMessage(err: unknown): string {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  const axiosData = (err as { response?: { data?: unknown } })?.response?.data;
  if (typeof axiosData === "string") return axiosData;
  if (axiosData && typeof axiosData === "object") {
    const d = axiosData as {
      message?: unknown;
      exc?: unknown;
      _server_messages?: unknown;
    };
    if (typeof d.message === "string") return d.message;
    if (typeof d.exc === "string") return d.exc;
    if (typeof d._server_messages === "string") return d._server_messages;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function extractForbiddenField(err: unknown): string | null {
  const msg = errorMessage(err);
  const match = /Field not permitted in query:\s*([A-Za-z0-9_]+)/i.exec(msg);
  return match?.[1] ?? null;
}

function isFieldPermissionError(err: unknown): boolean {
  return /Field not permitted in query/i.test(errorMessage(err));
}

/**
 * Resolve list fields from RFQ DocType metadata.
 * Optional fields are included only when they actually exist.
 */
async function resolveSupplierRfqFieldPlan(): Promise<SupplierRfqFieldPlan> {
  if (_supplierRfqFieldPlan) return _supplierRfqFieldPlan;
  if (_supplierRfqFieldPlanPromise) return _supplierRfqFieldPlanPromise;

  _supplierRfqFieldPlanPromise = (async () => {
    let fieldSet = new Set<string>();
    try {
      const schema = await getRFQSchema();
      fieldSet = new Set(schema.allFields);
      if (isDev()) {
        // eslint-disable-next-line no-console
        console.log(LOG, "RFQ DocType field names:", schema.allFields);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        LOG,
        "RFQ schema unavailable — using core list fields only",
        err,
      );
    }

    const dueDateField =
      RFQ_DUE_DATE_CANDIDATES.find((f) => fieldSet.has(f)) ?? null;
    const titleField =
      RFQ_TITLE_CANDIDATES.find((f) => fieldSet.has(f)) ?? null;

    const fields = [...CORE_SUPPLIER_RFQ_FIELDS];
    if (titleField) fields.push(titleField);
    if (dueDateField) fields.push(dueDateField);

    const plan: SupplierRfqFieldPlan = { fields, dueDateField, titleField };
    if (isDev()) {
      // eslint-disable-next-line no-console
      console.log(LOG, "Supplier RFQ list field plan:", plan);
    }
    _supplierRfqFieldPlan = plan;
    return plan;
  })();

  return _supplierRfqFieldPlanPromise;
}

function normalizeSupplierRfqRow(
  row: Record<string, unknown>,
  plan: SupplierRfqFieldPlan,
): RFQRow {
  const dueRaw = plan.dueDateField
    ? row[plan.dueDateField]
    : undefined;
  const titleRaw = plan.titleField
    ? row[plan.titleField]
    : row.message_for_supplier;

  return {
    name: String(row.name ?? ""),
    status: (row.status as string | undefined) ?? undefined,
    modified: (row.modified as string | undefined) ?? undefined,
    docstatus:
      typeof row.docstatus === "number" ? row.docstatus : undefined,
    company: (row.company as string | undefined) ?? undefined,
    transaction_date:
      (row.transaction_date as string | undefined) ?? undefined,
    valid_till:
      dueRaw == null || dueRaw === ""
        ? null
        : String(dueRaw),
    message_for_supplier:
      titleRaw == null || titleRaw === ""
        ? null
        : String(titleRaw),
  };
}

/**
 * Fetch RFQ rows, dropping any field ERPNext rejects (HTTP 417) and retrying.
 * Never fails the whole list for a single optional field.
 */
async function fetchSupplierRfqsWithFieldFallback(
  fields: string[],
  plan: SupplierRfqFieldPlan,
  fetchOnce: (fields: string[]) => Promise<Record<string, unknown>[]>,
): Promise<{ rows: RFQRow[]; error?: unknown }> {
  let current = [...fields];
  let lastError: unknown;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const raw = await fetchOnce(current);
      return {
        rows: raw
          .filter((r) => r && r.name)
          .map((r) => normalizeSupplierRfqRow(r, plan)),
      };
    } catch (err) {
      lastError = err;
      const forbidden = extractForbiddenField(err);
      if (forbidden && current.includes(forbidden)) {
        current = current.filter((f) => f !== forbidden);
        plan.fields = current;
        if (plan.dueDateField === forbidden) plan.dueDateField = null;
        if (plan.titleField === forbidden) plan.titleField = null;
        if (isDev()) {
          // eslint-disable-next-line no-console
          console.warn(
            LOG,
            `Dropped non-permitted RFQ field "${forbidden}" and retrying`,
            { fields: current },
          );
        }
        continue;
      }
      if (
        isFieldPermissionError(err) &&
        current.length > CORE_SUPPLIER_RFQ_FIELDS.length
      ) {
        current = [...CORE_SUPPLIER_RFQ_FIELDS];
        plan.fields = current;
        plan.dueDateField = null;
        plan.titleField = null;
        continue;
      }
      break;
    }
  }

  return { rows: [], error: lastError };
}

/**
 * Supplier-visible RFQs only:
 * - Invited to the logged-in supplier (child table)
 * - Published / submitted (docstatus = 1) — never Draft / unpublished
 * - Not cancelled
 */
function buildSupplierRfqFilters(erpSupplierId: string): Filter[] {
  return [
    ["Request for Quotation Supplier", "supplier", "=", erpSupplierId],
    ["docstatus", "=", 1],
    ["status", "not in", ["Cancelled"]],
  ];
}

/** Probe which filter zeroes the list when invited RFQs unexpectedly return 0. */
async function diagnoseEmptySupplierRfqs(erpSupplierId: string): Promise<void> {
  const probes: Array<{ label: string; filters: Filter[] }> = [
    { label: "no filters (sample)", filters: [] },
    {
      label: "published+status only (no supplier)",
      filters: [
        ["docstatus", "=", 1],
        ["status", "not in", ["Cancelled"]],
      ],
    },
    {
      label: "supplier child only",
      filters: [["Request for Quotation Supplier", "supplier", "=", erpSupplierId]],
    },
    {
      label: "supplier + published",
      filters: [
        ["Request for Quotation Supplier", "supplier", "=", erpSupplierId],
        ["docstatus", "=", 1],
      ],
    },
    { label: "full filters", filters: buildSupplierRfqFilters(erpSupplierId) },
  ];

  for (const probe of probes) {
    try {
      const raw = await apiGet<RFQRow[]>(
        buildResourceUrl("Request for Quotation"),
        buildListConfig({
          fields: ["name", "status", "docstatus", "company", "transaction_date"],
          filters: probe.filters,
          order_by: "modified desc",
          limit_page_length: 5,
        }),
      );
      const rows = Array.isArray(raw) ? raw : [];
      // eslint-disable-next-line no-console
      console.log(LOG, "RFQ diagnose", {
        erp_supplier_id: erpSupplierId,
        probe: probe.label,
        filters: probe.filters,
        count: rows.length,
        sample: rows.map((r) => r.name),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(LOG, "RFQ diagnose failed", { probe: probe.label, err });
    }
  }
}

export async function getSupplierRFQs(supplierName: string): Promise<RFQRow[]> {
  const erpSupplierId = String(supplierName || "").trim();
  const filters = buildSupplierRfqFilters(erpSupplierId);
  const plan = await resolveSupplierRfqFieldPlan();

  // eslint-disable-next-line no-console
  console.log(LOG, "My RFQs query", {
    logged_in_supplier_id: erpSupplierId,
    doctype: "Request for Quotation",
    filters,
    fields: plan.fields,
    due_date_field: plan.dueDateField,
    title_field: plan.titleField,
  });

  if (!erpSupplierId) {
    // eslint-disable-next-line no-console
    console.warn(LOG, "My RFQs aborted — empty ERP supplier id");
    return [];
  }

  // Strategy 1 — Standard resource API with child-table filter.
  // Published RFQs only (docstatus = 1); Draft / unpublished never appear.
  const first = await tryResourceApi(filters, plan);

  // Strategy 2 — If the resource API returned nothing (child-table
  // filters can be unreliable in some Frappe builds), retry with
  // frappe.client.get_list via POST (body data is parsed more reliably).
  if (first.rows.length === 0) {
    // eslint-disable-next-line no-console
    console.warn(
      LOG,
      "Resource API returned 0 rows — trying frappe.client.get_list POST fallback",
      { filters },
    );
    const second = await tryGetListPost(filters, plan);

    if (second.rows.length === 0) {
      await diagnoseEmptySupplierRfqs(erpSupplierId);
    }

    // Both strategies came back empty. If BOTH failed with a real error
    // (network/permission/500), this is NOT a genuine "no RFQs" state —
    // surface the error so the UI shows an error/retry state instead of a
    // false "you have no RFQs" empty screen.
    // Field-permission errors are never fatal — optional fields are stripped.
    const firstFatal =
      first.error && !isFieldPermissionError(first.error) ? first.error : null;
    const secondFatal =
      second.error && !isFieldPermissionError(second.error)
        ? second.error
        : null;
    if (second.rows.length === 0 && firstFatal && secondFatal) {
      // eslint-disable-next-line no-console
      console.error(LOG, "Both RFQ fetch strategies failed:", firstFatal, secondFatal);
      throw firstFatal;
    }

    // eslint-disable-next-line no-console
    console.log(LOG, "Final RFQ count", {
      erp_supplier_id: erpSupplierId,
      count: second.rows.length,
      names: second.rows.map((r) => r.name),
    });
    return second.rows;
  }

  // eslint-disable-next-line no-console
  console.log(LOG, "Final RFQ count", {
    erp_supplier_id: erpSupplierId,
    count: first.rows.length,
    names: first.rows.map((r) => r.name),
  });
  return first.rows;
}

async function tryResourceApi(
  filters: Filter[],
  plan: SupplierRfqFieldPlan,
): Promise<{ rows: RFQRow[]; error?: unknown }> {
  // eslint-disable-next-line no-console
  console.log(LOG, "GET /api/resource/Request for Quotation", {
    filters,
    fields: plan.fields,
  });
  return fetchSupplierRfqsWithFieldFallback(
    plan.fields,
    plan,
    async (fields) => {
      const raw = await apiGet<Record<string, unknown>[]>(
        buildResourceUrl("Request for Quotation"),
        buildListConfig({
          fields,
          filters,
          order_by: "modified desc",
          limit_page_length: 100,
        }),
      );
      const result = Array.isArray(raw) ? raw : [];
      // eslint-disable-next-line no-console
      console.log(LOG, "Resource API result:", result.length, "rows");
      return result;
    },
  );
}

async function tryGetListPost(
  filters: Filter[],
  plan: SupplierRfqFieldPlan,
): Promise<{ rows: RFQRow[]; error?: unknown }> {
  // eslint-disable-next-line no-console
  console.log(LOG, "POST /api/method/frappe.client.get_list", {
    filters,
    fields: plan.fields,
  });
  return fetchSupplierRfqsWithFieldFallback(
    plan.fields,
    plan,
    async (fields) => {
      const body = {
        doctype: "Request for Quotation",
        fields,
        filters,
        order_by: "modified desc",
        limit_page_length: 100,
      };
      const raw = await apiPost<
        Record<string, unknown>[] | { message?: Record<string, unknown>[] }
      >("/api/method/frappe.client.get_list", body);
      if (Array.isArray(raw)) {
        // eslint-disable-next-line no-console
        console.log(LOG, "get_list POST result:", raw.length, "rows");
        return raw;
      }
      const msg = (raw as { message?: Record<string, unknown>[] })?.message;
      if (Array.isArray(msg)) {
        // eslint-disable-next-line no-console
        console.log(LOG, "get_list POST result (message):", msg.length, "rows");
        return msg;
      }
      // eslint-disable-next-line no-console
      console.warn(LOG, "get_list POST returned unexpected shape:", raw);
      return [];
    },
  );
}

export async function getSupplierQuotations(
  supplierName: string
): Promise<SQRow[]> {
  return getSupplierQuotationsBySupplier(supplierName);
}

const DASHBOARD_LIMIT = 20;
const LIST_LIMIT = 50;

/**
 * Live Purchase Orders for a supplier portal session.
 * @param erpSupplierId ERPNext Supplier.name (Link id) — not company display name.
 */
export async function getSupplierPurchaseOrders(
  erpSupplierId: string,
  limit = LIST_LIMIT
): Promise<PORow[]> {
  const supplier = String(erpSupplierId || "").trim();
  if (!supplier) {
    // eslint-disable-next-line no-console
    console.warn(LOG, "getSupplierPurchaseOrders: empty erpSupplierId — returning []");
    return [];
  }

  const filters = buildSupplierPOFilters(supplier);
  // eslint-disable-next-line no-console
  console.log(LOG, "getSupplierPurchaseOrders request", {
    erp_supplier_id: supplier,
    filters,
    limit,
  });

  const rows = (await getPurchaseOrders({
    fields: [
      "name",
      "supplier",
      "supplier_name",
      "transaction_date",
      "grand_total",
      "status",
      "docstatus",
      "modified",
    ],
    filters,
    order_by: "modified desc",
    limit_page_length: limit,
  })) as PORow[];

  // eslint-disable-next-line no-console
  console.log(LOG, "getSupplierPurchaseOrders response", {
    erp_supplier_id: supplier,
    count: rows.length,
    records: rows.map((r) => ({
      poNumber: r.name,
      supplierId: r.supplier,
      supplierName: r.supplier_name,
      status: r.status,
      docstatus: (r as { docstatus?: number }).docstatus,
    })),
  });

  return rows;
}

export async function getSupplierGRNSummaries(
  supplierName: string,
  limit = DASHBOARD_LIMIT
): Promise<GRNSummary[]> {
  const list = await getPurchaseReceipts({
    filters: [
      ["supplier", "=", supplierName],
      ["docstatus", "=", 1],
    ],
    order_by: "modified desc",
    limit_page_length: limit,
  });

  const results = await Promise.allSettled(
    list.map((row) => getPurchaseReceipt(row.name))
  );

  return results
    .filter(
      (r): r is PromiseFulfilledResult<PurchaseReceipt> =>
        r.status === "fulfilled"
    )
    .map((r) => {
      const receipt = r.value;
      return {
        name: receipt.name,
        poNumber: primaryPOFromReceipt(receipt),
        posting_date: receipt.posting_date,
        warehouse: primaryWarehouseFromReceipt(receipt),
        itemCount: receipt.items?.length ?? 0,
        status: grnDisplayStatus(receipt),
        modified: receipt.modified,
      };
    });
}

export async function getSupplierInvoiceSummaries(
  supplierName: string,
  limit = DASHBOARD_LIMIT
): Promise<InvoiceSummary[]> {
  const list = await getPurchaseInvoices({
    filters: [
      ["supplier", "=", supplierName],
      ["docstatus", "=", 1],
    ],
    fields: [
      "name",
      "status",
      "posting_date",
      "grand_total",
      "modified",
    ],
    order_by: "modified desc",
    limit_page_length: limit,
  });

  const enriched = await Promise.allSettled(
    list.map((inv) => getPurchaseInvoice(inv.name))
  );

  return list.map((inv, idx) => {
    const full =
      enriched[idx].status === "fulfilled" ? enriched[idx].value : null;
    return {
      name: inv.name,
      poReference: full ? primaryPOFromInvoice(full) : undefined,
      posting_date: inv.posting_date,
      grand_total: inv.grand_total,
      status: inv.status,
      modified: inv.modified,
    };
  });
}

export async function getSupplierPaymentSummaries(
  supplierName: string,
  limit = DASHBOARD_LIMIT
): Promise<PaymentSummary[]> {
  const payments = (await getPaymentEntries({
    filters: [
      ["party", "=", supplierName],
      ["payment_type", "=", "Pay"],
      ["docstatus", "=", 1],
    ],
    fields: [
      "name",
      "party",
      "posting_date",
      "mode_of_payment",
      "paid_amount",
      "received_amount",
      "status",
      "modified",
    ],
    order_by: "modified desc",
    limit_page_length: limit,
  })) as PaymentEntry[];

  return payments.map((p) => {
    const invRef = p.references?.find(
      (r) => r.reference_doctype === "Purchase Invoice"
    );
    return {
      name: p.name,
      invoiceReference: invRef?.reference_name,
      posting_date: p.posting_date,
      mode_of_payment: p.mode_of_payment,
      paid_amount: p.paid_amount,
      received_amount: p.received_amount,
      status: p.status,
      modified: p.modified,
    };
  });
}

export async function getSupplierPendingPaymentCount(
  supplierName: string
): Promise<number> {
  const raw = await apiGet<{ data: unknown[] } | unknown[]>(
    "/api/resource/Purchase Invoice",
    {
      params: {
        filters: JSON.stringify([
          ["supplier", "=", supplierName],
          ["outstanding_amount", ">", 0],
          ["docstatus", "=", 1],
        ]),
        fields: JSON.stringify(["name"]),
        limit_page_length: 200,
      },
    }
  );
  if (Array.isArray(raw)) return raw.length;
  return Array.isArray((raw as { data: unknown[] }).data)
    ? (raw as { data: unknown[] }).data.length
    : 0;
}

/* ─── Dashboard batch fetch ────────────────────────────────────────────────── */

export interface SupplierDashboardData {
  rfqs: RFQRow[];
  quotations: SQRow[];
  pos: PORow[];
  grns: GRNSummary[];
  invoices: InvoiceSummary[];
  payments: PaymentSummary[];
  pendingPayments: number;
}

/**
 * Fetch all supplier dashboard data in a single Promise.all — eliminates
 * the sequential waterfall of 8 independent useQuery hooks.
 */
export async function getSupplierDashboardData(
  supplierName: string
): Promise<SupplierDashboardData> {
  const [rfqs, quotations, pos, grns, invoices, payments, pendingPayments] =
    await Promise.all([
      getSupplierRFQs(supplierName),
      getSupplierQuotations(supplierName),
      getSupplierPurchaseOrders(supplierName, DASHBOARD_LIMIT),
      getSupplierGRNSummaries(supplierName, DASHBOARD_LIMIT),
      getSupplierInvoiceSummaries(supplierName, DASHBOARD_LIMIT),
      getSupplierPaymentSummaries(supplierName, DASHBOARD_LIMIT),
      getSupplierPendingPaymentCount(supplierName),
    ]);
  return { rfqs, quotations, pos, grns, invoices, payments, pendingPayments };
}

export function countActivePOs(pos: PORow[]): number {
  return pos.filter((p) => isActivePOStatus(p.status)).length;
}
