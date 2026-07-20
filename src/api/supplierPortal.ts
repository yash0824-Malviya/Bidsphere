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
  valid_till?: string;
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

/** Invited + active RFQs: Draft/Submitted, not Cancelled. No MR/BidSphere/company/valid_till filters. */
function buildSupplierRfqFilters(erpSupplierId: string): Filter[] {
  return [
    ["Request for Quotation Supplier", "supplier", "=", erpSupplierId],
    ["docstatus", "in", [0, 1]],
    ["status", "not in", ["Cancelled"]],
  ];
}

/** Probe which filter zeroes the list when invited RFQs unexpectedly return 0. */
async function diagnoseEmptySupplierRfqs(erpSupplierId: string): Promise<void> {
  const probes: Array<{ label: string; filters: Filter[] }> = [
    { label: "no filters (sample)", filters: [] },
    {
      label: "docstatus+status only (no supplier)",
      filters: [
        ["docstatus", "in", [0, 1]],
        ["status", "not in", ["Cancelled"]],
      ],
    },
    {
      label: "supplier child only",
      filters: [["Request for Quotation Supplier", "supplier", "=", erpSupplierId]],
    },
    {
      label: "supplier + docstatus",
      filters: [
        ["Request for Quotation Supplier", "supplier", "=", erpSupplierId],
        ["docstatus", "in", [0, 1]],
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

  // eslint-disable-next-line no-console
  console.log(LOG, "My RFQs query", {
    logged_in_supplier_id: erpSupplierId,
    doctype: "Request for Quotation",
    filters,
    not_filtered: [
      "BidSphere status",
      "Material Request status",
      "company",
      "valid_till",
    ],
  });

  if (!erpSupplierId) {
    // eslint-disable-next-line no-console
    console.warn(LOG, "My RFQs aborted — empty ERP supplier id");
    return [];
  }

  // Strategy 1 — Standard resource API with child-table filter.
  // Include both Draft (docstatus 0) and Submitted (docstatus 1) so
  // invited suppliers see the RFQ immediately after invitation.
  const first = await tryResourceApi(filters);

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
    const second = await tryGetListPost(filters);

    if (second.rows.length === 0) {
      await diagnoseEmptySupplierRfqs(erpSupplierId);
    }

    // Both strategies came back empty. If BOTH failed with a real error
    // (network/permission/500), this is NOT a genuine "no RFQs" state —
    // surface the error so the UI shows an error/retry state instead of a
    // false "you have no RFQs" empty screen.
    if (second.rows.length === 0 && first.error && second.error) {
      // eslint-disable-next-line no-console
      console.error(LOG, "Both RFQ fetch strategies failed:", first.error, second.error);
      throw first.error;
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
): Promise<{ rows: RFQRow[]; error?: unknown }> {
  try {
    // eslint-disable-next-line no-console
    console.log(LOG, "GET /api/resource/Request for Quotation", { filters });
    const raw = await apiGet<RFQRow[]>(
      buildResourceUrl("Request for Quotation"),
      buildListConfig({
        fields: [
          "name",
          "status",
          "modified",
          "docstatus",
          "company",
          "transaction_date",
        ],
        filters,
        order_by: "modified desc",
        limit_page_length: 100,
      }),
    );
    const result = Array.isArray(raw) ? raw : [];
    // eslint-disable-next-line no-console
    console.log(LOG, "Resource API result:", result.length, "rows", result);
    return { rows: result };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(LOG, "Resource API failed:", err);
    return { rows: [], error: err };
  }
}

async function tryGetListPost(
  filters: Filter[],
): Promise<{ rows: RFQRow[]; error?: unknown }> {
  try {
    const body = {
      doctype: "Request for Quotation",
      fields: [
        "name",
        "status",
        "modified",
        "docstatus",
        "company",
        "transaction_date",
      ],
      filters,
      order_by: "modified desc",
      limit_page_length: 100,
    };
    // eslint-disable-next-line no-console
    console.log(LOG, "POST /api/method/frappe.client.get_list", body);
    const raw = await apiPost<RFQRow[] | { message?: RFQRow[] }>(
      "/api/method/frappe.client.get_list",
      body,
    );
    if (Array.isArray(raw)) {
      // eslint-disable-next-line no-console
      console.log(LOG, "get_list POST result:", raw.length, "rows");
      return { rows: raw };
    }
    const msg = (raw as { message?: RFQRow[] })?.message;
    if (Array.isArray(msg)) {
      // eslint-disable-next-line no-console
      console.log(LOG, "get_list POST result (message):", msg.length, "rows");
      return { rows: msg };
    }
    // eslint-disable-next-line no-console
    console.warn(LOG, "get_list POST returned unexpected shape:", raw);
    return { rows: [] };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(LOG, "get_list POST fallback failed:", err);
    return { rows: [], error: err };
  }
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
