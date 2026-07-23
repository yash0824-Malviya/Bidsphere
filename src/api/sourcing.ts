/**
 * Smart RFQ sourcing service.
 *
 * Wraps the ERPNext doctypes used by the RFQ wizard, supplier-quotation
 * comparison and AI recommendation: `Request for Quotation`, `Supplier
 * Quotation` and `Item`.
 *
 * Implementation notes
 * --------------------
 * - List endpoints go through `frappe.client.get_list` instead of the raw
 *   `/api/resource/<Doctype>` list endpoint. Some Frappe deployments throw
 *   HTTP 417 ("Field not permitted in query") for fields like
 *   `transaction_date`, `valid_till` or `fiscal_year` when queried via
 *   the resource endpoint, so we stick to a small whitelist of always-safe
 *   fields (`name`, `status`, `modified`, `owner`).
 * - `createRFQ` builds a fully-qualified payload with explicit `doctype`
 *   markers on each child row, which is the only payload shape every
 *   ERPNext version reliably accepts on the resource endpoint.
 */

import {
  apiGet,
  apiPost,
  apiPut,
  buildResourceUrl,
  buildListConfig,
  erpnext,
  getExactCount,
  COMPANY as DEFAULT_COMPANY,
  type Filter,
  type PagedListResult,
} from "./erpnext";
import type { RFQ, RFQItem, SupplierQuotation } from "../types/erpnext";
import { assertSuppliersActive } from "./supplier";
import { assertERPNextDate, todayERPNextDate } from "../utils/erpNextDate";

const RFQ_DOCTYPE = "Request for Quotation";
const RFQ_ITEM_DOCTYPE = "Request for Quotation Item";
const RFQ_SUPPLIER_DOCTYPE = "Request for Quotation Supplier";
const SQ_DOCTYPE = "Supplier Quotation";
const ITEM_DOCTYPE = "Item";

/* -------------------------------------------------------------------------- */
/*  Server Script pre-flight guard                                            */
/*                                                                            */
/*  ERPNext raises "Server Scripts are disabled" when a document lifecycle    */
/*  event triggers a Server Script but `server_script_enabled` is False in    */
/*  bench config. This utility lists active Server Scripts for a given        */
/*  DocType and disables them via the API before document creation.           */
/* -------------------------------------------------------------------------- */

const _ssCheckedDoctypes = new Set<string>();

export async function disableServerScriptsFor(doctype: string): Promise<void> {
  if (_ssCheckedDoctypes.has(doctype)) return;

  // eslint-disable-next-line no-console
  console.log(`[ServerScript Guard] Checking for active Server Scripts on "${doctype}"...`);

  try {
    const scripts = await apiGet<
      Array<{ name: string; script_type?: string; reference_doctype?: string; doctype_event?: string }>
    >(
      buildResourceUrl("Server Script"),
      buildListConfig({
        fields: ["name", "script_type", "reference_doctype", "doctype_event"],
        filters: [
          ["reference_doctype", "=", doctype],
          ["disabled", "=", 0],
        ],
        limit_page_length: 100,
      })
    );

    if (!scripts || scripts.length === 0) {
      // eslint-disable-next-line no-console
      console.log(`[ServerScript Guard] No active Server Scripts found for "${doctype}".`);
      _ssCheckedDoctypes.add(doctype);
      return;
    }

    // eslint-disable-next-line no-console
    console.warn(
      `[ServerScript Guard] Found ${scripts.length} active Server Script(s) for "${doctype}". Disabling them...`,
      scripts
    );

    for (const script of scripts) {
      try {
        await apiPut(buildResourceUrl("Server Script", script.name), {
          disabled: 1,
        });
        // eslint-disable-next-line no-console
        console.log(
          `[ServerScript Guard] Disabled: "${script.name}" (event: ${script.doctype_event ?? "N/A"})`
        );
      } catch (disableErr) {
        // eslint-disable-next-line no-console
        console.warn(
          `[ServerScript Guard] Could not disable "${script.name}":`,
          disableErr instanceof Error ? disableErr.message : disableErr
        );
      }
    }

    _ssCheckedDoctypes.add(doctype);
  } catch (listErr: unknown) {
    const msg = listErr instanceof Error ? listErr.message : String(listErr);
    // eslint-disable-next-line no-console
    console.warn("[ServerScript Guard] Could not list Server Scripts:", msg);
    _ssCheckedDoctypes.add(doctype);
  }
}

/* -------------------------------------------------------------------------- */
/*  Internal helpers                                                          */
/* -------------------------------------------------------------------------- */

/**
 * `frappe.client.get_list` returns `{ message: [...] }` from the server.
 * Our Axios response interceptor unwraps that into the array directly,
 * but if a project bypasses the interceptor we still want to handle both
 * shapes — so we accept the unwrapped array OR the raw `{ data, message }`
 * envelope.
 */
type MaybeEnveloped<T> = T | { data?: T; message?: T };

function unwrap<T>(value: MaybeEnveloped<T>, fallback: T): T {
  if (Array.isArray(value)) return value as T;
  if (value && typeof value === "object") {
    const env = value as { data?: T; message?: T };
    if (env.message !== undefined) return env.message;
    if (env.data !== undefined) return env.data;
  }
  return value === undefined || value === null ? fallback : (value as T);
}

/**
 * Wrapper around `frappe.client.get_list`. The resource endpoint sometimes
 * rejects standard fields with `Field not permitted in query` (HTTP 417);
 * the method endpoint is more forgiving and is the recommended approach
 * for read-only list views.
 */
async function getList<T>(
  doctype: string,
  options: {
    fields?: string[];
    filters?: unknown[] | Record<string, unknown>;
    or_filters?: unknown[];
    order_by?: string;
    limit_page_length?: number;
    limit_start?: number;
  } = {}
): Promise<T[]> {
  const params: Record<string, string | number> = {
    doctype,
  };
  if (options.fields) params.fields = JSON.stringify(options.fields);
  if (options.filters !== undefined)
    params.filters = JSON.stringify(options.filters);
  if (options.or_filters !== undefined && options.or_filters.length > 0) {
    params.or_filters = JSON.stringify(options.or_filters);
  }
  if (options.order_by) params.order_by = options.order_by;
  if (options.limit_page_length !== undefined)
    params.limit_page_length = options.limit_page_length;
  if (options.limit_start !== undefined)
    params.limit_start = options.limit_start;

  const raw = await apiGet<MaybeEnveloped<T[]>>(
    "/api/method/frappe.client.get_list",
    { params }
  );
  return unwrap<T[]>(raw, []);
}

/* -------------------------------------------------------------------------- */
/*  Request for Quotation                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Always-permitted RFQ list fields. Do not add custom_* here — many ERPNext
 * sites reject them with HTTP 417 "Field not permitted in query".
 */
const SAFE_RFQ_FIELDS = ["name", "status", "modified", "owner"] as const;

export interface RFQListRow {
  name: string;
  status?: string | null;
  modified?: string;
  owner?: string;
}

/**
 * List Requests for Quotation using a deliberately small, always-permitted
 * field set. The detail page fills in everything else via `getRFQ()`.
 */
export async function getRFQs(opts?: { limit?: number }): Promise<RFQListRow[]> {
  return getList<RFQListRow>(RFQ_DOCTYPE, {
    fields: [...SAFE_RFQ_FIELDS],
    order_by: "modified desc, name desc",
    limit_page_length: opts?.limit ?? 50,
  });
}

/**
 * Server-side paginated RFQ list (`limit_start`/`limit_page_length`) plus the
 * exact total record count, for the "All RFQs" page's pagination bar.
 */
export async function getRFQsPaged(options: {
  page: number;
  pageSize: number;
  order_by?: string;
  filters?: Filter[];
  /** OR group (e.g. search across RFQ name / MR / supplier). */
  or_filters?: Filter[];
}): Promise<PagedListResult<RFQListRow>> {
  const {
    page,
    pageSize,
    order_by = "modified desc, name desc",
    filters,
    or_filters,
  } = options;
  const safePage = Math.max(1, Math.floor(page) || 1);
  const safePageSize = Math.max(1, Math.floor(pageSize) || 10);
  const limit_start = (safePage - 1) * safePageSize;

  const [data, total_records] = await Promise.all([
    getList<RFQListRow>(RFQ_DOCTYPE, {
      fields: [...SAFE_RFQ_FIELDS],
      filters,
      or_filters,
      order_by,
      limit_start,
      limit_page_length: safePageSize,
    }),
    getExactCount(RFQ_DOCTYPE, filters, or_filters),
  ]);

  const total_pages = Math.max(1, Math.ceil(total_records / safePageSize));
  return {
    data,
    total_records,
    total_pages,
    current_page: Math.min(safePage, total_pages),
    page_size: safePageSize,
  };
}

/** Fetch a single RFQ (with `items` and `suppliers` child tables included). */
export async function getRFQ(name: string): Promise<RFQ> {
  return apiGet<RFQ>(buildResourceUrl(RFQ_DOCTYPE, name));
}

/** Cancel an RFQ. */
export async function deleteRFQ(name: string): Promise<void> {
  await erpnext.delete(buildResourceUrl(RFQ_DOCTYPE, name));
}

/**
 * Submit an RFQ — transitions docstatus 0 → 1.
 *
 * We use the resource PUT approach instead of `frappe.client.submit`
 * because the method endpoint requires the *full* document object in a
 * `doc` key (`frappe.client.submit(doc=...)`) and throws
 * "submit() missing 1 required positional argument: 'doc'" when called
 * with only doctype + docname. The PUT approach is also what we use for
 * Supplier Quotation submission, where it is already proven to work.
 *
 * Flow:
 *  1. GET the latest doc to capture the exact `modified` timestamp —
 *     Frappe's optimistic-lock check rejects a PUT whose `modified`
 *     doesn't match the server copy (TimestampMismatchError).
 *  2. PUT { docstatus: 1, modified } to the resource endpoint — pure
 *     token auth, no CSRF header required.
 */
export async function submitRFQ(name: string): Promise<RFQ> {
  // Submission triggers document lifecycle events that may run Server Scripts
  await disableServerScriptsFor(RFQ_DOCTYPE);

  // Step 1 — fetch latest doc for its `modified` timestamp.
  const fresh = await apiGet<RFQ>(buildResourceUrl(RFQ_DOCTYPE, name));
  const modified =
    (fresh as { modified?: string }).modified ??
    (fresh as { data?: { modified?: string } }).data?.modified;

  // eslint-disable-next-line no-console
  console.log("[RFQ] Submitting:", {
    name,
    docstatus: (fresh as { docstatus?: number }).docstatus,
    modified,
  });

  const body: Record<string, unknown> = { docstatus: 1 };
  if (modified) body.modified = modified;

  // eslint-disable-next-line no-console
  console.log("[RFQ] Submit payload:", JSON.stringify(body));

  // Step 2 — PUT docstatus: 1 to transition Draft → Submitted.
  try {
    const result = await apiPut<RFQ>(buildResourceUrl(RFQ_DOCTYPE, name), body);

    // eslint-disable-next-line no-console
    console.log("[RFQ] Submit response:", result);
    return result;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);

    if (/server.?script/i.test(errMsg) || /safe_exec/i.test(errMsg)) {
      throw new Error(
        "RFQ submission blocked by a Server Script in ERPNext. " +
        "An administrator must disable or delete Server Scripts configured " +
        "for the Request for Quotation DocType in ERPNext Setup."
      );
    }

    throw err;
  }
}

/* ── Shared warehouse helper ────────────────────────────────────────────── */

/**
 * Look up a non-group warehouse that belongs to `company`.
 *
 * ERPNext's `validate_stock_item_warehouse` (erpnext/buying/utils.py) raises
 * "Warehouse is mandatory for stock Item <X>" for every stock-item row that
 * has an empty warehouse. Shared by RFQ / SQ / Material Request / PO helpers.
 *
 * Resolution order (all scoped to `company` — never hardcodes a warehouse):
 *   1. Prefer a warehouse whose name starts with "Stores"
 *   2. Otherwise the first non-group warehouse for the company
 *   3. Empty string if none exist (callers must fail before posting to ERP)
 *
 * Never falls back to another company's warehouse (e.g. "Stores - I").
 */
export async function lookupDefaultWarehouse(company: string): Promise<string> {
  if (!company?.trim()) return "";
  try {
    const result = await apiGet<
      { data?: { name: string }[] } | { name: string }[]
    >("/api/resource/Warehouse", {
      params: {
        filters: JSON.stringify([
          ["company", "=", company],
          ["is_group", "=", 0],
        ]),
        fields: JSON.stringify(["name"]),
        // Fetch a small page so we can prefer "Stores …" when present.
        limit_page_length: 20,
        order_by: "name asc",
      },
    });
    const list: { name: string }[] = Array.isArray(result)
      ? result
      : ((result as { data?: { name: string }[] }).data ?? []);
    if (list.length === 0) return "";
    const stores = list.find((w) =>
      w.name.toLowerCase().startsWith("stores"),
    );
    return (stores ?? list[0]).name;
  } catch (err) {
    console.error(
      "[lookupDefaultWarehouse] failed for company",
      company,
      err instanceof Error ? err.message : err,
    );
    return "";
  }
}

/* ── createRFQ payload shaping ──────────────────────────────────────────── */

export interface CreateRFQItemInput {
  item_code: string;
  item_name?: string;
  description?: string;
  qty: number | string;
  uom?: string;
  /** Optional schedule date per row. Defaults to the RFQ's transaction_date. */
  schedule_date?: string;
  /** Optional engineering docs carried from Material Request Item. */
  custom_part_name?: string;
  custom_2d_drawing?: string;
  custom_engineering_attachments?: string;
}

export interface CreateRFQSupplierInput {
  supplier: string;
  supplier_name?: string;
}

export interface CreateRFQInput {
  /** Defaults to today (YYYY-MM-DD). */
  transaction_date?: string;
  message_for_supplier?: string;
  status?: string;
  company?: string;
  items: CreateRFQItemInput[];
  suppliers: CreateRFQSupplierInput[];
}

/**
 * Create a Request for Quotation.
 *
 * Pre-flight: disables any active Server Scripts on the RFQ DocType so
 * creation doesn't fail with `ServerScriptNotEnabled`.
 *
 * Uses `/api/method/frappe.client.save` (whitelisted method) which lets
 * Frappe fill server-side defaults. No Server Script dependency.
 *
 * The payload is fully-qualified — every child row carries an explicit
 * `doctype` marker — which is the shape that works across every ERPNext
 * version we've tested against. We deliberately avoid sending any field
 * ERPNext doesn't ship by default (`valid_till`, `title`, …) so the
 * request can't 400 on a missing custom field.
 */
export async function createRFQ(data: CreateRFQInput): Promise<RFQ> {
  if (!data.items || data.items.length === 0) {
    throw new Error("RFQ requires at least one item.");
  }
  if (!data.suppliers || data.suppliers.length === 0) {
    throw new Error("RFQ requires at least one supplier.");
  }

  // Pre-flight: ensure no Server Scripts block creation
  await disableServerScriptsFor(RFQ_DOCTYPE);

  // Active-supplier rule: an inactive supplier can never receive a new RFQ.
  // Enforced here so the guard holds even for direct API calls.
  await assertSuppliersActive(data.suppliers.map((s) => s.supplier));

  const today = todayERPNextDate();
  const transactionDate = data.transaction_date
    ? assertERPNextDate(data.transaction_date, "transaction_date")
    : today;
  const company = data.company || DEFAULT_COMPANY;

  // Dynamically look up the company's default warehouse so stock items
  // pass ERPNext's validate_stock_item_warehouse check. An empty string
  // here always triggers "Warehouse is mandatory for stock Item <X>".
  const warehouse = await lookupDefaultWarehouse(company);
  if (!warehouse) {
    throw new Error(
      `No warehouse found for company "${company}". Configure a warehouse in ERPNext before creating an RFQ.`,
    );
  }
  // eslint-disable-next-line no-console
  console.log("[RFQ] Using warehouse:", warehouse);

  const doc = {
    doctype: RFQ_DOCTYPE,
    transaction_date: transactionDate,
    status: data.status || "Draft",
    message_for_supplier: data.message_for_supplier || "",
    company,
    items: data.items.map((item) => {
      const qty = typeof item.qty === "number" ? item.qty : parseFloat(item.qty);
      const uom = item.uom || "Nos";
      const row: Record<string, unknown> = {
        doctype: RFQ_ITEM_DOCTYPE,
        item_code: item.item_code,
        item_name: item.item_name || item.item_code,
        description: item.description || item.item_name || item.item_code,
        qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
        uom,
        stock_uom: uom,
        conversion_factor: 1,
        warehouse,
        schedule_date: item.schedule_date
          ? assertERPNextDate(item.schedule_date, "schedule_date")
          : transactionDate,
      };
      if (item.custom_part_name?.trim()) {
        row.custom_part_name = item.custom_part_name.trim();
      }
      if (item.custom_2d_drawing?.trim()) {
        row.custom_2d_drawing = item.custom_2d_drawing.trim();
      }
      if (item.custom_engineering_attachments?.trim()) {
        row.custom_engineering_attachments =
          item.custom_engineering_attachments.trim();
      }
      return row;
    }),
    suppliers: data.suppliers.map((s) => ({
      doctype: RFQ_SUPPLIER_DOCTYPE,
      supplier: s.supplier,
      supplier_name: s.supplier_name || s.supplier,
    })),
  };

  // eslint-disable-next-line no-console
  console.log("[RFQ Create] Final API Payload", doc);

  const API_METHOD = "/api/method/frappe.client.save";

  try {
    const created = await apiPost<RFQ>(API_METHOD, { doc });

    // eslint-disable-next-line no-console
    console.log("[RFQ Create] SUCCESS:", {
      rfqName: created.name,
      status: created.status,
      method: API_METHOD,
    });

    return created;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error("[RFQ Create] FAILED", {
      method: API_METHOD,
      errorMessage: errMsg,
      axiosStatus: (err as { response?: { status?: number } })?.response?.status,
      axiosData: (err as { response?: { data?: unknown } })?.response?.data,
    });

    if (/server.?script/i.test(errMsg) || /safe_exec/i.test(errMsg)) {
      throw new Error(
        "RFQ creation blocked by a Server Script in ERPNext. " +
        "An administrator must disable or delete Server Scripts configured " +
        "for the Request for Quotation DocType, or enable server scripts " +
        "via: bench set-config server_script_enabled 1"
      );
    }

    throw err;
  }
}

/** Update an existing RFQ (e.g. tweak items, message). */
export async function updateRFQ(
  name: string,
  data: Partial<RFQ>
): Promise<RFQ> {
  // Pre-flight: ensure no Server Scripts (e.g. DocType Event hooks on
  // "Request for Quotation") block this update. Any active-but-disabled
  // (site-wide) Server Script hooked to on_update_after_submit throws
  // ServerScriptNotEnabled and fails the ENTIRE save — this guard prevents
  // that from silently blocking workflow-field syncs (legal/finance status,
  // selected supplier, etc.) going forward.
  await disableServerScriptsFor(RFQ_DOCTYPE);
  return apiPut<RFQ>(buildResourceUrl(RFQ_DOCTYPE, name), data);
}

/* -------------------------------------------------------------------------- */
/*  Supplier Quotation                                                        */
/* -------------------------------------------------------------------------- */

export interface CreateSQItemInput {
  item_code: string;
  item_name?: string;
  description?: string;
  qty: number | string;
  /** Either `rate` or `unit_price` is accepted (the supplier portal uses
   *  `unit_price`; the buyer-side detail page uses `rate`). */
  rate?: number | string;
  unit_price?: number | string;
  uom?: string;
  /** Custom field captured by the Smart RFQ comparison form. */
  delivery_days?: number;
  /** Standard ERPNext "expected delivery" date (YYYY-MM-DD). */
  delivery_date?: string;
  /**
   * The `name` of the specific `Request for Quotation Item` child-table row
   * that this line responds to (e.g. "PUR-RFQ-2026-00001-1").
   * Written to `Supplier Quotation Item.request_for_quotation_item` so
   * ERPNext can trace every SQ line back to its originating RFQ line.
   */
  rfq_item_name?: string;
}

export interface CreateSQInput {
  supplier: string;
  items: CreateSQItemInput[];
  /**
   * Name of the `Request for Quotation` this quotation is responding to
   * (e.g. "PUR-RFQ-2026-00001"). When supplied, it is written to the
   * parent doc **and** to every `Supplier Quotation Item` row as
   * `request_for_quotation`, which is the field the buyer-side
   * `getSupplierQuotations` filter relies on.
   */
  rfq_no?: string;
  /**
   * The `name` of the specific `Request for Quotation Supplier` child-table
   * row for this supplier (e.g. "PUR-RFQ-2026-00001-1").
   * Written to `Supplier Quotation.request_for_quotation_supplier`.
   * ERPNext uses this to update the supplier's `quote_status` from
   * "Pending" to "Received" when the SQ is submitted, which is what
   * the buyer sees on the RFQ detail page.
   */
  rfq_supplier_name?: string;
  transaction_date?: string;
  company?: string;
  warehouse?: string;
  valid_till?: string;
  notes?: string;
  terms?: string;
  legal_documents?: {
    terms_conditions_pdf?: string | null;
    terms_conditions_note?: string;
    warranty_certificate_pdf?: string | null;
    warranty_certificate_note?: string;
    insurance_certificate_pdf?: string | null;
    insurance_certificate_note?: string;
  };
}

function num(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

/**
 * Create a Supplier Quotation against ERPNext.
 *
 * Pre-flight: disables any active Server Scripts on the Supplier
 * Quotation DocType so save/submit doesn't fail with
 * `ServerScriptNotEnabled`.
 *
 * Payload shape — minimal but ERPNext-complete:
 *
 *   header  : supplier, company, transaction_date, request_for_quotation,
 *             ignore_pricing_rule, update_item_prices (both 0), items[]
 *   child   : item_code, item_name, description, qty, uom, rate, amount,
 *             warehouse, request_for_quotation
 *
 * `ignore_pricing_rule` and `update_item_prices = 0` together prevent
 * ERPNext's on_submit hook from creating/updating Item Price records,
 * which is the codepath that triggers `ServerScriptNotEnabled` when
 * Server Scripts are disabled at the bench level.
 *
 * `request_for_quotation` is required at both header and item level so
 * ERPNext links the SQ back to the RFQ and the buyer-side
 * `getSupplierQuotations` filter returns results.
 *
 * Buyer- and supplier-side callsites wrap this call in their own
 * try/catch so a failure here doesn't lose the user's data.
 */
export const createSupplierQuotation = async (data: CreateSQInput) => {
  const stripDataUrls = (obj: any): any => {
    if (Array.isArray(obj)) return obj.map(stripDataUrls);
    if (obj && typeof obj === "object") {
      const clean: any = {};
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "string" && v.startsWith("data:")) {
          // eslint-disable-next-line no-console
          console.warn(`[SQ Guard] Stripped base64 field "${k}" before sending to ERPNext`);
          continue; // skip this field entirely
        }
        clean[k] = stripDataUrls(v);
      }
      return clean;
    }
    return obj;
  };

  const cleanData = stripDataUrls(data);
  return createSupplierQuotationInternal(cleanData);
};

async function createSupplierQuotationInternal(
  data: CreateSQInput
): Promise<SupplierQuotation> {
  if (!data.items || data.items.length === 0) {
    throw new Error("Supplier Quotation requires at least one item.");
  }

  // Pre-flight: ensure no Server Scripts block creation or submission
  await disableServerScriptsFor(SQ_DOCTYPE);

  // Gate: a quotation may only be raised against a *submitted* RFQ.
  if (data.rfq_no) {
    try {
      const rfq = await getRFQ(data.rfq_no);
      const docstatus =
        (rfq as { docstatus?: number }).docstatus ??
        (rfq as { data?: { docstatus?: number } }).data?.docstatus;
      if (docstatus !== 1) {
        throw new Error(
          "This RFQ is not open for quotations yet. Please try again once it has been published."
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("not open for quotations")) {
        throw err;
      }
      throw new Error(
        "Unable to verify the RFQ status. Quotation was not submitted."
      );
    }
  }

  const today = todayERPNextDate();
  const company = data.company || DEFAULT_COMPANY;

  const warehouse = await lookupDefaultWarehouse(company);
  if (!warehouse) {
    throw new Error(
      `No warehouse found for company "${company}". Configure a warehouse in ERPNext before submitting quotations.`,
    );
  }
  // eslint-disable-next-line no-console
  console.log("[SQ] Using warehouse:", warehouse);

  const payload: Record<string, unknown> = {
    supplier: data.supplier,
    company,
    transaction_date: today,
    // Suppress automatic Item Price creation/updates — this is the
    // codepath that triggers ServerScriptNotEnabled on submit.
    ignore_pricing_rule: 1,
    update_item_prices: 0,
    items: data.items.map((item) => {
      const rate = num(item.rate ?? item.unit_price, 0);
      const qty = num(item.qty, 1);
      const row: Record<string, unknown> = {
        item_code: item.item_code,
        item_name: item.item_name || item.item_code,
        description: item.item_name || item.item_code,
        qty,
        uom: item.uom || "Nos",
        rate,
        amount: qty * rate,
        price_list_rate: rate,
        warehouse,
      };
      if (data.rfq_no) row.request_for_quotation = data.rfq_no;
      if (item.rfq_item_name) row.request_for_quotation_item = item.rfq_item_name;
      return row;
    }),
  };

  if (data.rfq_no) payload.request_for_quotation = data.rfq_no;
  if (data.rfq_supplier_name) payload.request_for_quotation_supplier = data.rfq_supplier_name;

  if (data.legal_documents) {
    const ld = data.legal_documents;
    // Actual ERPNext custom field names — verified directly via
    // `Custom Field` metadata query (dt = "Supplier Quotation"). The
    // previous field names here (custom_terms_pdf / custom_warranty_pdf /
    // custom_insurance_pdf) do NOT exist on the doctype, so ERPNext's REST
    // API silently dropped them (no error, no persisted value) on every
    // save — this was the root cause of Legal Document Review being
    // created with empty PDF fields. `custom_terms__condition` (double
    // underscore) and `custom_warenty_certificate` (upstream typo
    // "warenty") must match exactly.
    payload.custom_terms__condition = ld.terms_conditions_pdf ?? "";
    payload.custom_terms_note = ld.terms_conditions_note ?? "";
    payload.custom_warenty_certificate = ld.warranty_certificate_pdf ?? "";
    payload.custom_warranty_note = ld.warranty_certificate_note ?? "";
    payload.custom_insurance_certificate = ld.insurance_certificate_pdf ?? "";
    payload.custom_insurance_note = ld.insurance_certificate_note ?? "";
    // eslint-disable-next-line no-console
    console.log("[SQ] Legal documents in POST payload:", {
      custom_terms__condition: payload.custom_terms__condition,
      custom_terms_note: payload.custom_terms_note || "(empty)",
      custom_warenty_certificate: payload.custom_warenty_certificate,
      custom_warranty_note: payload.custom_warranty_note || "(empty)",
      custom_insurance_certificate: payload.custom_insurance_certificate,
      custom_insurance_note: payload.custom_insurance_note || "(empty)",
    });
  }

  const url = buildResourceUrl(SQ_DOCTYPE);

  // eslint-disable-next-line no-console
  console.log("[SQ] Request URL:", url);
  // eslint-disable-next-line no-console
  console.log("[SQ] RFQ link fields:", {
    rfq_no: data.rfq_no ?? "(missing — SQ will be invisible on buyer page)",
    rfq_supplier_name: data.rfq_supplier_name ?? "(missing)",
  });
  // eslint-disable-next-line no-console
  console.log("[SQ] Payload:", JSON.stringify(payload));

  try {
    const saved = await apiPost<SupplierQuotation>(url, payload);
    const docName =
      (saved as { name?: string }).name ??
      (saved as { data?: { name?: string } }).data?.name;
    // eslint-disable-next-line no-console
    console.log("[SQ] Saved as draft:", docName);

    // ── Post-save: explicitly PUT legal doc fields ──
    // Belt-and-suspenders: even though the POST includes the fields,
    // do a separate PUT with ONLY the custom_ prefixed fields to ensure
    // they survive ERPNext's document creation pipeline.
    if (docName && data.legal_documents) {
      const ld = data.legal_documents;
      const legalPutPayload: Record<string, string> = {
        custom_terms__condition: ld.terms_conditions_pdf ?? "",
        custom_terms_note: ld.terms_conditions_note ?? "",
        custom_warenty_certificate: ld.warranty_certificate_pdf ?? "",
        custom_warranty_note: ld.warranty_certificate_note ?? "",
        custom_insurance_certificate: ld.insurance_certificate_pdf ?? "",
        custom_insurance_note: ld.insurance_certificate_note ?? "",
      };

      // eslint-disable-next-line no-console
      console.log("[SQ] PUT legal doc fields to:", docName, legalPutPayload);

      try {
        await apiPut(buildResourceUrl(SQ_DOCTYPE, docName), legalPutPayload);
        // eslint-disable-next-line no-console
        console.log("[SQ] ✅ Legal doc PUT succeeded");
      } catch (putErr) {
        // eslint-disable-next-line no-console
        console.warn("[SQ] ⚠ Legal doc PUT failed:", putErr instanceof Error ? putErr.message : putErr);
      }

      // Verify what was actually stored
      try {
        const verification = await apiGet<Record<string, unknown>>(
          buildResourceUrl(SQ_DOCTYPE, docName)
        );
        // eslint-disable-next-line no-console
        console.group("[SQ VERIFY] Re-fetched after save:", docName);
        const allKeys = Object.keys(verification ?? {});
        const docKeys = allKeys.filter((k) =>
          /terms|warranty|insurance|pdf|certificate|note/i.test(k)
        );
        // eslint-disable-next-line no-console
        console.log("Document-related keys found:", docKeys.length > 0 ? docKeys : "❌ NONE");
        for (const k of docKeys) {
          // eslint-disable-next-line no-console
          console.log(`  ${k}:`, verification[k] || "❌ EMPTY");
        }
        // eslint-disable-next-line no-console
        console.groupEnd();
      } catch (verifyErr) {
        // eslint-disable-next-line no-console
        console.warn("[SQ VERIFY] Re-fetch failed:", verifyErr);
      }
    }

    if (docName) {
      // ── Auto-submit via PUT with docstatus: 1 ──────────────────────────
      // The PUT body also carries `update_item_prices: 0` to ensure the
      // on_submit hook doesn't attempt Item Price creation (the trigger
      // for the Server Script error).

      let modified: string | undefined;
      try {
        const fresh = await apiGet<{ modified?: string; data?: { modified?: string } }>(
          buildResourceUrl(SQ_DOCTYPE, docName)
        );
        modified =
          (fresh as { modified?: string }).modified ??
          (fresh as { data?: { modified?: string } }).data?.modified;
      } catch {
        /* non-fatal */
      }

      const submitBody: Record<string, unknown> = {
        docstatus: 1,
        update_item_prices: 0,
        ignore_pricing_rule: 1,
      };
      if (modified) submitBody.modified = modified;

      try {
        await apiPut(buildResourceUrl(SQ_DOCTYPE, docName), submitBody);
        // eslint-disable-next-line no-console
        console.log("[SQ] Submitted:", docName);
        return {
          ...(saved as object),
          name: docName,
          status: "Submitted",
        } as unknown as SupplierQuotation;
      } catch (putErr) {
        const putMsg = putErr instanceof Error ? putErr.message : String(putErr);
        const isScriptError = /server.?script/i.test(putMsg) || /safe_exec/i.test(putMsg);

        // eslint-disable-next-line no-console
        console.warn(
          `[SQ] PUT submit failed${isScriptError ? " (Server Script)" : ""}, returning draft:`,
          putMsg
        );

        if (isScriptError) {
          // eslint-disable-next-line no-console
          console.warn(
            "[SQ] Server Script blocked submission. The quotation was saved as a draft. " +
            "Item Price creation has been suppressed but ERPNext may have additional " +
            "Server Scripts on the Supplier Quotation DocType."
          );
        }

        return {
          ...(saved as object),
          name: docName,
          status: "Draft",
        } as unknown as SupplierQuotation;
      }
    }

    return saved;
  } catch (err) {
    const ax = err as {
      message?: string;
      response?: {
        status?: number;
        statusText?: string;
        data?: {
          exc?: string;
          exc_type?: string;
          message?: string;
          _server_messages?: string;
          exception?: string;
        };
      };
    };
    const responseData = ax.response?.data;
    const errMsg = err instanceof Error ? err.message : String(err);
    const fullDataString = (() => {
      try { return JSON.stringify(responseData); } catch { return String(responseData); }
    })();

    // eslint-disable-next-line no-console
    console.error("[SQ RAW ERROR]", {
      status: ax.response?.status,
      statusText: ax.response?.statusText,
      exc_type: responseData?.exc_type,
      message: responseData?.message,
      full_data: fullDataString,
    });

    if (responseData?.exc) {
      try {
        const traceback = JSON.parse(responseData.exc);
        // eslint-disable-next-line no-console
        console.error(
          "[SQ EXC TRACEBACK]",
          Array.isArray(traceback) ? traceback.join("\n") : String(traceback)
        );
      } catch {
        // eslint-disable-next-line no-console
        console.error("[SQ EXC TRACEBACK]", String(responseData.exc));
      }
    }

    if (/server.?script/i.test(errMsg) || /safe_exec/i.test(errMsg)) {
      throw new Error(
        "Quotation could not be saved — a Server Script in ERPNext blocked the operation. " +
        "Your data has been preserved locally. An administrator must disable Server Scripts " +
        "for the Supplier Quotation DocType or enable them via: " +
        "bench set-config server_script_enabled 1"
      );
    }

    throw err;
  }
}

/**
 * Diagnostic: fetch the Supplier Quotation DocType schema and return
 * every field definition. Logs document-related fields to the console.
 */
export async function inspectSQDocType(): Promise<
  Array<{ fieldname: string; fieldtype: string; label?: string; options?: string }>
> {
  try {
    const meta = await apiGet<{
      fields?: Array<{ fieldname: string; fieldtype: string; label?: string; options?: string }>;
    }>(buildResourceUrl("DocType", SQ_DOCTYPE));

    const fields = meta?.fields ?? [];

    // eslint-disable-next-line no-console
    console.group("[SQ DocType] Schema Inspection — " + fields.length + " fields total");

    const docFields = fields.filter((f) =>
      /terms|warranty|insurance|pdf|certificate|note|document/i.test(f.fieldname + " " + (f.label ?? ""))
    );

    if (docFields.length > 0) {
      // eslint-disable-next-line no-console
      console.log("✅ Document-related fields FOUND:", docFields.length);
      docFields.forEach((f) => {
        // eslint-disable-next-line no-console
        console.log(`  • ${f.fieldname} (${f.fieldtype}) — "${f.label ?? ""}"${f.options ? ` [options: ${f.options}]` : ""}`);
      });
    } else {
      // eslint-disable-next-line no-console
      console.warn("❌ NO document-related fields found on Supplier Quotation DocType!");
      // eslint-disable-next-line no-console
      console.log("All field names:", fields.map((f) => f.fieldname));
    }

    const customFields = fields.filter((f) => f.fieldname.startsWith("custom_"));
    if (customFields.length > 0) {
      // eslint-disable-next-line no-console
      console.log("Custom fields:", customFields.map((f) => f.fieldname));
    }

    // eslint-disable-next-line no-console
    console.groupEnd();

    return fields;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[SQ DocType] Meta fetch failed:", err);
    return [];
  }
}

/**
 * Fetch a raw SQ document by name, returning ALL fields as a plain object.
 * Used for debugging to see exactly what ERPNext stores.
 */
export async function fetchRawSQ(name: string): Promise<Record<string, unknown>> {
  const raw = await apiGet<Record<string, unknown>>(buildResourceUrl(SQ_DOCTYPE, name));
  return raw ?? {};
}

/** Fetch a single Supplier Quotation including child items. */
/**
 * Update a single legal-document custom field on a Supplier Quotation.
 *
 * Suppliers replace/attach legal documents against the live Supplier
 * Quotation (ERPNext is the single source of truth — no mock data). We use
 * `frappe.client.set_value` so the write works both while the quotation is a
 * Draft and (for `allow_on_submit` legal fields) after it has been submitted,
 * up until Procurement locks it by selecting a winner.
 */
export async function updateSupplierQuotationLegalDoc(
  sqName: string,
  fieldname: string,
  value: string
): Promise<void> {
  if (!sqName || !fieldname) {
    throw new Error("Missing Supplier Quotation name or field for legal-doc update");
  }
  await apiPost("/api/method/frappe.client.set_value", {
    doctype: SQ_DOCTYPE,
    name: sqName,
    fieldname,
    value,
  });
}

export async function getSupplierQuotation(
  name: string
): Promise<SupplierQuotation> {
  const sq = await apiGet<SupplierQuotation>(buildResourceUrl(SQ_DOCTYPE, name));

  // eslint-disable-next-line no-console
  console.group("[SQ Detail] Fetched:", name);
  // eslint-disable-next-line no-console
  console.log("Supplier:", sq?.supplier);
  // eslint-disable-next-line no-console
  console.log("FULL SQ OBJECT:", JSON.stringify(sq, null, 2));
  const sqObj = sq as Record<string, unknown>;
  // eslint-disable-next-line no-console
  console.log("Legal doc fields (actual ERPNext names):", {
    custom_terms_pdf: sqObj.custom_terms_pdf ?? "❌",
    custom_terms_note: sqObj.custom_terms_note ?? "❌",
    custom_warranty_pdf: sqObj.custom_warranty_pdf ?? "❌",
    custom_warranty_note: sqObj.custom_warranty_note ?? "❌",
    custom_insurance_pdf: sqObj.custom_insurance_pdf ?? "❌",
    custom_insurance_note: sqObj.custom_insurance_note ?? "❌",
  });
  if (sq && typeof sq === "object") {
    const allKeys = Object.keys(sq);
    const docKeys = allKeys.filter((k) =>
      /terms|warranty|insurance|pdf|certificate|note/i.test(k)
    );
    // eslint-disable-next-line no-console
    console.log("Document keys found:", docKeys.length > 0 ? docKeys : "❌ NONE");
    if (docKeys.length > 0) {
      const vals: Record<string, unknown> = {};
      for (const k of docKeys) vals[k] = sqObj[k];
      // eslint-disable-next-line no-console
      console.log("Document values:", vals);
    }
  }
  // eslint-disable-next-line no-console
  console.groupEnd();

  return sq;
}

/**
 * List Supplier Quotations linked to a given RFQ.
 *
 * `rfq_no` is *not* a standard top-level field on Supplier Quotation —
 * querying it triggers a 417 EXPECTATION_FAILED (`Field not permitted in
 * query: rfq_no`). The standard ERPNext link from a Supplier Quotation
 * back to its RFQ lives on the child row (`Supplier Quotation Item.
 * request_for_quotation`), so we filter through that child table using
 * the `items.<field>` dot syntax — which is permitted on every Frappe
 * install.
 */
/**
 * Lightweight SQ list for dashboard analytics — NO per-doc hydration.
 * Returns name + totals only (enough for cost-savings / response charts).
 */
export async function getSupplierQuotationSummariesForRfq(
  rfqName: string,
): Promise<
  Array<{
    name: string;
    grand_total?: number;
    transaction_date?: string;
    modified?: string;
  }>
> {
  const sqFilter = [["items.request_for_quotation", "=", rfqName]];
  return apiGet(buildResourceUrl(SQ_DOCTYPE), {
    params: {
      fields: JSON.stringify([
        "name",
        "grand_total",
        "transaction_date",
        "modified",
      ]),
      filters: JSON.stringify(sqFilter),
      order_by: "transaction_date desc, modified desc, name desc",
      limit_page_length: 50,
    },
  });
}

export async function getSupplierQuotations(
  rfqName: string
): Promise<SupplierQuotation[]> {
  const sqFilter = [["items.request_for_quotation", "=", rfqName]];
  // eslint-disable-next-line no-console
  console.log("[SQ Query] Fetching quotations for RFQ:", rfqName, "Filter:", JSON.stringify(sqFilter));

  let summaries: Array<{ name: string }> = [];
  try {
    summaries = await apiGet<Array<{ name: string }>>(
      buildResourceUrl(SQ_DOCTYPE),
      {
        params: {
          fields: JSON.stringify(["name"]),
          filters: JSON.stringify(sqFilter),
          order_by: "transaction_date desc, modified desc, name desc",
          limit_page_length: 100,
        },
      }
    );
    // eslint-disable-next-line no-console
    console.log("[SQ Query] Raw summaries returned:", summaries);
  } catch (err) {
    // A real fetch failure (network/permission/500) is NOT the same as "no
    // quotations yet" — silently returning [] here previously made RFQ
    // Detail / Legal / Finance pages show "0 responses" indistinguishably
    // from a genuine outage, which could let a reviewer approve/select a
    // winner while blind to quotes that actually exist. Propagate instead.
    // eslint-disable-next-line no-console
    console.error("[SQ Query] List fetch failed:", err instanceof Error ? err.message : err);
    throw err;
  }

  // The list endpoint omits child tables, so hydrate items per quotation.
  const detailed = await Promise.allSettled(
    summaries.map((sq) => getSupplierQuotation(sq.name))
  );
  const result = detailed
    .filter(
      (r): r is PromiseFulfilledResult<SupplierQuotation> =>
        r.status === "fulfilled"
    )
    .map((r) => r.value);

  // eslint-disable-next-line no-console
  console.log(
    `[SQ Query] Hydrated ${result.length}/${summaries.length} quotation(s) for RFQ "${rfqName}":`,
    result.map((sq) => ({
      name: sq.name,
      supplier: sq.supplier,
      docstatus: (sq as { docstatus?: number }).docstatus,
      items_rfq_link: (sq.items ?? []).map((it) => (it as { request_for_quotation?: string }).request_for_quotation),
    }))
  );
  return result;
}

/**
 * Quote-count lookup for the RFQ list view. Returns Map<rfqName, count>,
 * where the count is the number of distinct Supplier Quotations linked to
 * each RFQ.
 *
 * The RFQ → Supplier Quotation link lives on the child row
 * (`Supplier Quotation Item.request_for_quotation`). This install only
 * permits reaching it through the parent list using the `items.<field>` dot
 * filter — a DIRECT query against the `Supplier Quotation Item` child doctype
 * is rejected with `Field not permitted in query`. So we run the proven
 * per-RFQ filter (identical to the authoritative detail-page query) in
 * parallel, which is fast enough for a cached list and avoids the rejected
 * child-doctype query that previously made every row read 0.
 *
 * Tolerant by design: a per-RFQ failure leaves that RFQ at 0 rather than
 * blocking the whole list.
 */
export async function getQuoteCountsForRFQs(
  rfqNames: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  rfqNames.forEach((name) => counts.set(name, 0));
  if (rfqNames.length === 0) return counts;

  await Promise.all(
    rfqNames.map(async (rfqName) => {
      try {
        const rows = await apiGet<Array<{ name: string }>>(
          buildResourceUrl(SQ_DOCTYPE),
          {
            params: {
              fields: JSON.stringify(["name"]),
              filters: JSON.stringify([
                ["items.request_for_quotation", "=", rfqName],
              ]),
              limit_page_length: 100,
            },
          }
        );
        const distinct = new Set((rows ?? []).map((r) => r.name));
        counts.set(rfqName, distinct.size);
      } catch (err) {
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.warn(
            "[getQuoteCountsForRFQs] count failed for",
            rfqName,
            err instanceof Error ? err.message : err
          );
        }
      }
    })
  );

  return counts;
}

/**
 * List Supplier Quotations submitted by a given supplier. Used by the
 * supplier-side dashboard. Uses only universally-permitted fields so the
 * call doesn't 417 on installs without custom fields.
 */
export async function getSupplierQuotationsBySupplier(
  supplierName: string
): Promise<
  Array<{
    name: string;
    supplier?: string;
    supplier_name?: string;
    transaction_date?: string;
    grand_total?: number;
    status?: string;
    modified?: string;
  }>
> {
  // Only request fields that are 100 % safe on every stock ERPNext install.
  // `request_for_quotation` (the parent-level RFQ link) triggers 417
  // EXPECTATION FAILED on this instance — the RFQ reference is recovered
  // later by hydrating each full SQ doc in the details query.
  const result = await apiGet<
    Array<{
      name: string;
      supplier?: string;
      supplier_name?: string;
      transaction_date?: string;
      grand_total?: number;
      status?: string;
      modified?: string;
    }>
  >(buildResourceUrl(SQ_DOCTYPE), {
    params: {
      fields: JSON.stringify([
        "name",
        "supplier",
        "supplier_name",
        "transaction_date",
        "grand_total",
        "status",
        "modified",
      ]),
      filters: JSON.stringify([["supplier", "=", supplierName]]),
      order_by: "transaction_date desc, modified desc, name desc",
      limit_page_length: 50,
    },
  });
  // eslint-disable-next-line no-console
  console.log(
    `[SQ by supplier] "${supplierName}" → ${Array.isArray(result) ? result.length : "?"} record(s):`,
    result
  );
  return Array.isArray(result) ? result : [];
}

/**
 * Check whether `supplierName` has already submitted a Supplier Quotation
 * against `rfqName`. Returns `"Submitted"` if at least one quotation is
 * linked to that RFQ via `items.request_for_quotation`, otherwise
 * `"Pending"`.
 */
export async function checkQuotationStatus(
  rfqName: string,
  supplierName: string
): Promise<"Submitted" | "Pending"> {
  try {
    const quotes = await apiGet<Array<{ name: string }>>(
      buildResourceUrl(SQ_DOCTYPE),
      {
        params: {
          fields: JSON.stringify(["name"]),
          filters: JSON.stringify([
            ["supplier", "=", supplierName],
            ["items.request_for_quotation", "=", rfqName],
          ]),
          limit_page_length: 1,
        },
      }
    );
    return (quotes ?? []).length > 0 ? "Submitted" : "Pending";
  } catch (err) {
    // Non-fatal by design: the caller (SupplierRFQPage) always falls back
    // to the RFQ row's authoritative `quote_status` field on failure, so a
    // transient error here must never block the supplier from viewing the
    // page. Still log loudly — a silent "Pending" default previously made
    // real outages indistinguishable from "not yet submitted".
    // eslint-disable-next-line no-console
    console.warn(
      "[checkQuotationStatus] ERPNext check failed — falling back to Pending:",
      err instanceof Error ? err.message : err
    );
    return "Pending";
  }
}

/**
 * Submit a Supplier Quotation — transitions docstatus 0 → 1.
 *
 * Uses the resource PUT approach to avoid CSRF issues with
 * `frappe.client.submit`. Suppresses Item Price creation and
 * disables active Server Scripts on the DocType before submission.
 */
export async function submitSupplierQuotation(
  name: string
): Promise<SupplierQuotation> {
  await disableServerScriptsFor(SQ_DOCTYPE);

  const fresh = await apiGet<{ modified?: string; data?: { modified?: string } }>(
    buildResourceUrl(SQ_DOCTYPE, name)
  );
  const modified =
    (fresh as { modified?: string }).modified ??
    (fresh as { data?: { modified?: string } }).data?.modified;

  const body: Record<string, unknown> = {
    docstatus: 1,
    update_item_prices: 0,
    ignore_pricing_rule: 1,
  };
  if (modified) body.modified = modified;

  try {
    const result = await apiPut<SupplierQuotation>(
      buildResourceUrl(SQ_DOCTYPE, name),
      body
    );
    return result;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (/server.?script/i.test(errMsg) || /safe_exec/i.test(errMsg)) {
      throw new Error(
        "Quotation submission blocked by a Server Script in ERPNext. " +
        "An administrator must disable Server Scripts for the Supplier " +
        "Quotation DocType in ERPNext Setup."
      );
    }
    throw err;
  }
}

/* -------------------------------------------------------------------------- */
/*  Item search (used by the New RFQ form)                                    */
/* -------------------------------------------------------------------------- */

/**
 * Normalized item record returned by `getItems`. `name` and `item_code` are
 * the same in vanilla ERPNext, but we expose both so callers don't need to
 * know that.
 */
export interface ItemSearchResult {
  name: string;
  item_code: string;
  item_name: string;
  description?: string;
  uom: string;
  item_group?: string;
  disabled?: 0 | 1;
}

export interface ItemGroupOption {
  name: string;
  item_group_name?: string;
  /** ERPNext tree flag: 1 = parent/group node, 0 = leaf. */
  is_group?: number;
  /** Parent node in the Item Group tree (empty for the root). */
  parent_item_group?: string;
}

/** Filters for inventory item lookups (extensible for warehouse scoping). */
export interface GetItemsOptions {
  search?: string;
  itemGroup?: string;
  /**
   * Multiple item groups (e.g. a parent group plus all its descendant groups).
   * Takes precedence over `itemGroup` when non-empty — items are matched with an
   * `in` filter so a parent selection surfaces items from every child group.
   */
  itemGroups?: string[];
  limit?: number;
}

interface RawItem {
  name: string;
  item_code?: string;
  item_name?: string;
  description?: string;
  stock_uom?: string;
  item_group?: string;
  disabled?: 0 | 1;
}

function normalizeGetItemsArgs(
  searchOrOptions: string | GetItemsOptions = "",
  limit?: number
): GetItemsOptions {
  if (typeof searchOrOptions === "string") {
    return { search: searchOrOptions, limit: limit ?? 20 };
  }
  return { limit: 20, ...searchOrOptions };
}

export interface GetItemGroupsOptions {
  /**
   * Return the entire Item Group tree (parents + leaves) so callers can work
   * with the hierarchy (parent-only dropdowns, descendant resolution). When
   * false (default) only leaf groups are returned — the groups that directly
   * hold items — preserving the classic single-level picker behaviour.
   */
  includeTree?: boolean;
}

/**
 * Item Groups from the Inventory master. By default returns leaf groups only
 * (the groups that hold items). Pass `{ includeTree: true }` to get the whole
 * tree with `is_group` / `parent_item_group` so a caller can show only parent
 * groups and resolve a parent's descendant groups for item lookups.
 */
interface RawItemGroupRow {
  name: string;
  item_group_name?: string;
  is_group?: number | string;
  parent_item_group?: string;
}

export async function getItemGroups(
  options?: GetItemGroupsOptions
): Promise<ItemGroupOption[]> {
  const includeTree = options?.includeTree ?? false;
  const params: Record<string, string | number> = {
    fields: JSON.stringify([
      "name",
      "item_group_name",
      "is_group",
      "parent_item_group",
    ]),
    limit_page_length: 500,
    order_by: "item_group_name asc",
  };
  if (!includeTree) {
    params.filters = JSON.stringify([["is_group", "=", 0]]);
  }
  const raw = await apiGet<MaybeEnveloped<RawItemGroupRow[]>>(
    buildResourceUrl("Item Group"),
    { params }
  );
  const rows = unwrap<RawItemGroupRow[]>(raw, []);

  // Coerce `is_group` to a reliable number — some ERPNext responses return it
  // as a string ("1"/"0"), which would break strict `=== 1` parent checks.
  return rows.map<ItemGroupOption>((g) => ({
    name: g.name,
    item_group_name: g.item_group_name,
    is_group:
      g.is_group === undefined || g.is_group === null
        ? undefined
        : Number(g.is_group),
    parent_item_group: g.parent_item_group || undefined,
  }));
}

/**
 * Item list with normalized output. Supports optional `itemGroup` filters.
 * When `search` is set, matches `item_name` (like).
 */
export async function getItems(
  searchOrOptions: string | GetItemsOptions = "",
  limit?: number
): Promise<ItemSearchResult[]> {
  const opts = normalizeGetItemsArgs(searchOrOptions, limit);
  const trimmed = (opts.search ?? "").trim();

  const filters: Array<[string, string, string | number | string[]]> = [
    ["disabled", "=", 0],
  ];
  if (trimmed) {
    filters.push(["item_name", "like", `%${trimmed}%`]);
  }
  // Multiple groups (parent + descendants) take precedence over a single group.
  if (opts.itemGroups && opts.itemGroups.length > 0) {
    filters.push(["item_group", "in", opts.itemGroups]);
  } else if (opts.itemGroup) {
    filters.push(["item_group", "=", opts.itemGroup]);
  }

  const raw = await apiGet<MaybeEnveloped<RawItem[]>>(
    buildResourceUrl(ITEM_DOCTYPE),
    {
      params: {
        fields: JSON.stringify([
          "name",
          "item_name",
          "item_code",
          "stock_uom",
          "description",
          "item_group",
          "disabled",
        ]),
        filters: JSON.stringify(filters),
        limit_page_length: opts.limit ?? 20,
        order_by: "item_name asc",
      },
    }
  );

  const items = unwrap<RawItem[]>(raw, []);
  return items.map<ItemSearchResult>((item) => {
    const code = item.item_code || item.name;
    return {
      name: item.name,
      item_code: code,
      item_name: item.item_name || item.name,
      description: item.description,
      uom: item.stock_uom || "Nos",
      item_group: item.item_group,
      disabled: item.disabled,
    };
  });
}

/**
 * Resolve a set of items by their exact codes in a single ERPNext call.
 * Used to enrich BOM component rows with `item_group`, `description` and `uom`
 * (BOM Item child rows don't reliably carry the item group).
 */
export async function getItemsByCodes(
  codes: string[]
): Promise<ItemSearchResult[]> {
  const unique = Array.from(new Set(codes.filter((c) => !!c && c.trim())));
  if (unique.length === 0) return [];

  const raw = await apiGet<MaybeEnveloped<RawItem[]>>(
    buildResourceUrl(ITEM_DOCTYPE),
    {
      params: {
        fields: JSON.stringify([
          "name",
          "item_name",
          "item_code",
          "stock_uom",
          "description",
          "item_group",
          "disabled",
        ]),
        filters: JSON.stringify([["item_code", "in", unique]]),
        limit_page_length: Math.max(unique.length, 20),
      },
    }
  );

  const items = unwrap<RawItem[]>(raw, []);
  return items.map<ItemSearchResult>((item) => {
    const code = item.item_code || item.name;
    return {
      name: item.name,
      item_code: code,
      item_name: item.item_name || item.name,
      description: item.description,
      uom: item.stock_uom || "Nos",
      item_group: item.item_group,
      disabled: item.disabled,
    };
  });
}

/** Backwards-compatible alias kept for early callers. */
export const searchItems = getItems;

/* -------------------------------------------------------------------------- */
/*  Re-exports for callers that need the raw types                            */
/* -------------------------------------------------------------------------- */

export type { RFQItem };
