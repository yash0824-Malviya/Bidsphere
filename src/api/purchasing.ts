/**
 * ERPNext Purchasing service — Material Requests, Requests for Quotation,
 * Purchase Orders, Purchase Receipts, and Cost Centers.
 *
 * Note on naming: the original Inteva spec called this doctype "Purchase
 * Requisition", but standard ERPNext exposes the equivalent first-class
 * doctype as **Material Request** (with `material_request_type =
 * "Purchase"`). A bare Frappe install without the ERPNext app does not
 * have any "Purchase Requisition" doctype at all, which surfaces as a
 * `404 NOT FOUND` on the resource endpoint.
 *
 * The exported `getPurchaseRequisitions`, `createPurchaseRequisition`,
 * etc. names are kept as deprecated aliases that delegate to the new
 * Material Request helpers, so existing call-sites continue to compile
 * while the codebase migrates over.
 */

import {
  apiGet,
  apiPost,
  apiPut,
  buildListConfig,
  buildResourceUrl,
  erpnext,
  withSilent,
} from "./erpnext";
import type { Filter, ListParams, SilentRequestConfig } from "./erpnext";
import type {
  CostCenter,
  MaterialRequest,
  MaterialRequestItem,
  PurchaseOrder,
  PurchaseReceipt,
  RequestForQuotation,
} from "../types/erpnext";
import {
  assertERPNextDate,
  buildGrnPayload,
  buildPurchaseOrderPayload,
  resolvePoHeaderScheduleDate,
  resolvePoItemScheduleDate,
  resolvePoTransactionDate,
  todayERPNextDate,
} from "../utils/erpNextDate";
import type { IncomingPORow } from "../utils/upcomingDeliveries";
import { canCreateGRN } from "../config/roles";
import { assertSuppliersActive, resolveSupplierERPNextId } from "./supplier";
import { useAuthStore } from "../store/authStore";
import { getApprovalState, isApprovedForPO } from "./rfqApprovalWorkflow";
import { getSupplierQuotations, lookupDefaultWarehouse } from "./sourcing";
import { COMPANY } from "./erpnext";

/**
 * App-level GRN ownership guard. GRN (Purchase Receipt) creation and submission
 * belong exclusively to the Warehouse team (and Admin). This blocks the action
 * even if it is reached programmatically / via a direct call, complementing the
 * route + UI guards. Note: authoritative enforcement should also live in
 * ERPNext role permissions on the Purchase Receipt doctype.
 */
function assertCanManageGRN(): void {
  const role = useAuthStore.getState().user?.role;
  if (!canCreateGRN(role)) {
    throw new Error(
      "Only the Warehouse team can create or submit Goods Receipts (GRNs)."
    );
  }
}

const MR_DOCTYPE = "Material Request";
const MR_ITEM_DOCTYPE = "Material Request Item";
const RFQ_DOCTYPE = "Request for Quotation";
const PO_DOCTYPE = "Purchase Order";
const PRECEIPT_DOCTYPE = "Purchase Receipt";

/* -------------------------------------------------------------------------- */
/*  Module availability probe                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Cheap smoke check — pings the buying doctypes and reports which are
 * present. Useful when the connected ERPNext only has the base Frappe
 * framework and is missing the buying / accounting modules.
 */
export async function checkAvailableModules(): Promise<{
  buying: boolean;
  selling: boolean;
}> {
  async function probe(doctype: string): Promise<boolean> {
    try {
      await erpnext.get(buildResourceUrl(doctype), {
        params: { limit_page_length: 1 },
        _silent: true,
      } as Parameters<typeof erpnext.get>[1] & SilentRequestConfig);
      return true;
    } catch {
      return false;
    }
  }
  const [po, sales] = await Promise.all([
    probe(PO_DOCTYPE),
    probe("Sales Order"),
  ]);
  return { buying: po, selling: sales };
}

/* -------------------------------------------------------------------------- */
/*  Material Request                                                          */
/* -------------------------------------------------------------------------- */

export interface MaterialRequestPayload {
  /** Optional human-friendly title (Inteva-custom field). */
  title?: string;
  /** Defaults to `"Purchase"` when omitted. */
  material_request_type?: MaterialRequest["material_request_type"];
  transaction_date?: string;
  /** Header-level required-by date. */
  schedule_date?: string;
  company?: string;
  cost_center?: string;
  remarks?: string;
  items: Array<
    Partial<MaterialRequestItem> & {
      item_code: string;
      qty: number | string;
    }
  >;
}

/**
 * List Material Requests filtered by `material_request_type = "Purchase"`
 * by default (i.e. the buying-side requisitions). Pass `filters` to
 * narrow further; the type filter is always applied unless you override
 * it explicitly via `filters`.
 */
export async function getMaterialRequests(
  filters?: ListParams
): Promise<MaterialRequest[]> {
  const rawFilters = filters?.filters;
  const baseFilters: Filter[] = Array.isArray(rawFilters) ? rawFilters : [];
  const hasTypeFilter = baseFilters.some(
    (f) => Array.isArray(f) && f[0] === "material_request_type"
  );
  const mergedFilters: Filter[] = hasTypeFilter
    ? baseFilters
    : [
        ...baseFilters,
        ["material_request_type", "=", "Purchase"] as Filter,
      ];

  return apiGet<MaterialRequest[]>(
    buildResourceUrl(MR_DOCTYPE),
    buildListConfig({
      ...filters,
      filters: mergedFilters,
      fields: filters?.fields ?? [
        "name",
        "status",
        "transaction_date",
        "modified",
        "owner",
      ],
      order_by: filters?.order_by ?? "modified desc",
      limit_page_length: filters?.limit_page_length ?? 50,
    })
  );
}

/** Fetch a single Material Request (with child items) by `name`. */
export async function getMaterialRequest(
  name: string
): Promise<MaterialRequest> {
  return apiGet<MaterialRequest>(buildResourceUrl(MR_DOCTYPE, name));
}

/**
 * Create a Material Request via `frappe.client.save`, which is the most
 * reliable POST path on Frappe (it lets the server fill in defaults from
 * Buying Settings / Stock Settings instead of demanding a complete
 * payload).
 */
export async function createMaterialRequest(
  data: MaterialRequestPayload
): Promise<MaterialRequest> {
  if (!data.items || data.items.length === 0) {
    throw new Error("Material Request requires at least one item.");
  }

  const today = todayERPNextDate();
  const transactionDate = data.transaction_date
    ? assertERPNextDate(data.transaction_date, "transaction_date")
    : today;
  const scheduleDate = data.schedule_date
    ? assertERPNextDate(data.schedule_date, "schedule_date")
    : transactionDate;

  const items = data.items.map((item, idx) => {
    const qty =
      typeof item.qty === "string" ? parseFloat(item.qty) || 1 : item.qty || 1;
    const uom = item.uom || "Nos";
    const row: Record<string, unknown> = {
      doctype: MR_ITEM_DOCTYPE,
      idx: idx + 1,
      item_code: item.item_code,
      item_name: item.item_name || item.item_code,
      description: item.description || item.item_name || item.item_code,
      qty,
      stock_qty: qty,
      uom,
      stock_uom: uom,
      conversion_factor: 1,
      schedule_date: item.schedule_date
        ? assertERPNextDate(item.schedule_date, "schedule_date")
        : scheduleDate,
    };
    if (item.warehouse) row.warehouse = item.warehouse;
    if (item.rate !== undefined) row.rate = item.rate;
    if (item.amount !== undefined) row.amount = item.amount;
    if (item.cost_center) row.cost_center = item.cost_center;
    return row;
  });

  const doc: Record<string, unknown> = {
    doctype: MR_DOCTYPE,
    material_request_type: data.material_request_type || "Purchase",
    transaction_date: transactionDate,
    schedule_date: scheduleDate,
    items,
  };
  if (data.title) doc.title = data.title;
  if (data.company) doc.company = data.company;
  if (data.cost_center) doc.cost_center = data.cost_center;
  if (data.remarks) doc.remarks = data.remarks;

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log("Final API Payload", doc);
  }

  return apiPost<MaterialRequest>("/api/method/frappe.client.save", { doc });
}

/** Update an existing Material Request. */
export async function updateMaterialRequest(
  name: string,
  data: Partial<MaterialRequest>
): Promise<MaterialRequest> {
  return apiPut<MaterialRequest>(buildResourceUrl(MR_DOCTYPE, name), data);
}

/** Submit a Material Request (`docstatus` 0 → 1). */
export async function submitMaterialRequest(
  name: string
): Promise<MaterialRequest> {
  return apiPost<MaterialRequest>("/api/method/frappe.client.submit", {
    doctype: MR_DOCTYPE,
    docname: name,
  });
}

/* -------------------------------------------------------------------------- */
/*  Deprecated aliases                                                        */
/*                                                                            */
/*  Older parts of the codebase still reference "Purchase Requisition"        */
/*  helpers. They now delegate to the Material Request helpers above so       */
/*  every caller hits the right ERPNext doctype.                              */
/* -------------------------------------------------------------------------- */

/** @deprecated Use `getMaterialRequests`. */
export const getPurchaseRequisitions = getMaterialRequests;
/** @deprecated Use `getMaterialRequest`. */
export const getPurchaseRequisition = getMaterialRequest;
/** @deprecated Use `createMaterialRequest`. */
export async function createPurchaseRequisition(
  data: Partial<MaterialRequest>
): Promise<MaterialRequest> {
  const items = (data.items ?? []).map((it) => ({
    item_code: it.item_code,
    item_name: it.item_name,
    description: it.description,
    qty: it.qty,
    uom: it.uom,
    rate: it.rate,
    amount: it.amount,
    warehouse: it.warehouse,
    cost_center: it.cost_center,
    schedule_date: it.schedule_date,
  }));
  return createMaterialRequest({
    title: data.title,
    transaction_date: data.transaction_date,
    schedule_date: data.schedule_date,
    company: data.company,
    cost_center: data.cost_center,
    remarks: data.remarks,
    items,
  });
}
/** @deprecated Use `updateMaterialRequest`. */
export const updatePurchaseRequisition = updateMaterialRequest;
/** @deprecated Use `submitMaterialRequest`. */
export const submitPurchaseRequisition = submitMaterialRequest;

/* -------------------------------------------------------------------------- */
/*  Request for Quotation                                                     */
/* -------------------------------------------------------------------------- */

/** List Requests for Quotation. */
export async function getRFQs(
  filters?: ListParams
): Promise<RequestForQuotation[]> {
  return apiGet<RequestForQuotation[]>(
    buildResourceUrl(RFQ_DOCTYPE),
    buildListConfig({
      fields: ["name", "status", "modified", "owner"],
      order_by: "modified desc",
      limit_page_length: 50,
      ...filters,
    })
  );
}

/** Fetch a single Request for Quotation by `name`. */
export async function getRFQ(name: string): Promise<RequestForQuotation> {
  return apiGet<RequestForQuotation>(buildResourceUrl(RFQ_DOCTYPE, name));
}

/** Create a Request for Quotation. */
export async function createRFQ(
  data: Partial<RequestForQuotation>
): Promise<RequestForQuotation> {
  return apiPost<RequestForQuotation>(buildResourceUrl(RFQ_DOCTYPE), data);
}

/** Submit a Request for Quotation. */
export async function submitRFQ(name: string): Promise<RequestForQuotation> {
  return apiPost<RequestForQuotation>("/api/method/frappe.client.submit", {
    doctype: RFQ_DOCTYPE,
    docname: name,
  });
}

/* -------------------------------------------------------------------------- */
/*  Purchase Order                                                            */
/* -------------------------------------------------------------------------- */

/** List Purchase Orders, optionally filtered. */
export async function getPurchaseOrders(
  filters?: ListParams
): Promise<PurchaseOrder[]> {
  try {
    return await apiGet<PurchaseOrder[]>(
      buildResourceUrl(PO_DOCTYPE),
      buildListConfig({
        fields: [
          "name",
          "supplier",
          "status",
          "transaction_date",
          "schedule_date",
          "grand_total",
          "currency",
          "per_received",
          "per_billed",
          "modified",
        ],
        order_by: "modified desc",
        limit_page_length: 50,
        ...filters,
      })
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[Purchase Orders] 403/Error:", message);
    return [];
  }
}

/** Fetch a single Purchase Order by `name`. */
export async function getPurchaseOrder(name: string): Promise<PurchaseOrder> {
  return apiGet<PurchaseOrder>(buildResourceUrl(PO_DOCTYPE, name));
}

/**
 * Approved Purchase Orders that are still awaiting receipt — i.e. submitted
 * (docstatus 1), not fully received, and with no completed GRN yet
 * (status "To Receive" / "To Receive and Bill"). Powers the warehouse
 * "Upcoming Deliveries" view, receiving KPIs and notifications.
 */
/**
 * Names of POs that already have a Goods Receipt — including **draft** GRNs.
 *
 * ERPNext only updates a PO's `per_received` / status when a Purchase Receipt
 * is *submitted*, so a draft GRN would otherwise leave the PO sitting in
 * "Upcoming Deliveries". We read the Purchase Receipt Item child table (which
 * carries `purchase_order`) for any non-cancelled receipt (docstatus < 2) so a
 * PO drops out of the inbound queue the moment a draft GRN is created.
 */
export async function getPurchaseOrderNamesWithReceipt(): Promise<Set<string>> {
  try {
    const rows = await apiGet<Array<{ purchase_order?: string }>>(
      buildResourceUrl("Purchase Receipt Item"),
      buildListConfig({
        fields: ["purchase_order"],
        filters: [
          ["parenttype", "=", "Purchase Receipt"],
          ["docstatus", "<", 2],
          ["purchase_order", "!=", ""],
        ],
        limit_page_length: 2000,
      })
    );
    const set = new Set<string>();
    for (const r of rows) {
      if (r.purchase_order) set.add(r.purchase_order);
    }
    return set;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[POs with receipt] error:", message);
    return new Set();
  }
}

export async function getIncomingPurchaseOrders(): Promise<IncomingPORow[]> {
  try {
    const [rows, receiptedPOs] = await Promise.all([
      apiGet<IncomingPORow[]>(
        buildResourceUrl(PO_DOCTYPE),
        buildListConfig({
          fields: [
            "name",
            "supplier",
            "supplier_name",
            "schedule_date",
            "grand_total",
            "currency",
            "status",
            "per_received",
            "transaction_date",
          ],
          filters: [
            ["docstatus", "=", 1],
            ["status", "in", ["To Receive", "To Receive and Bill"]],
          ],
          order_by: "schedule_date asc",
          limit_page_length: 100,
        })
      ),
      getPurchaseOrderNamesWithReceipt(),
    ]);
    // Exclude anything already fully received OR that already has a GRN
    // (draft or submitted) so a PO never shows in both Upcoming Deliveries and
    // the GRN list at the same time.
    return rows.filter(
      (r) => (r.per_received ?? 0) < 100 && !receiptedPOs.has(r.name)
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[Incoming POs] error:", message);
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/*  Server Script pre-flight: disable active scripts for Purchase Order       */
/*                                                                            */
/*  ERPNext may have Server Script records configured for the Purchase Order  */
/*  DocType. If `server_script_enabled` is False in site_config, ANY PO       */
/*  creation (resource POST, frappe.client.save, frappe.client.insert) will   */
/*  fail with "ServerScriptNotEnabled" because Frappe checks for script       */
/*  records during document lifecycle events.                                 */
/*                                                                            */
/*  This utility lists active Server Scripts for a given DocType and          */
/*  disables them via the API. It runs once per browser session.              */
/* -------------------------------------------------------------------------- */

let _serverScriptCheckDone = false;

async function disableServerScriptsFor(doctype: string): Promise<void> {
  if (_serverScriptCheckDone) return;

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
      _serverScriptCheckDone = true;
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

    _serverScriptCheckDone = true;
  } catch (listErr: unknown) {
    const msg = listErr instanceof Error ? listErr.message : String(listErr);
    // If the Server Script DocType itself doesn't exist or we lack
    // permission to read it, just continue — the PO creation will either
    // work (no scripts) or fail with a clear message.
    // eslint-disable-next-line no-console
    console.warn("[ServerScript Guard] Could not list Server Scripts:", msg);
    _serverScriptCheckDone = true;
  }
}

/* -------------------------------------------------------------------------- */
/*  Create Purchase Order                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Create a Purchase Order via `frappe.client.save`.
 *
 * Pre-flight: disables any active Server Scripts on the Purchase Order
 * DocType so the creation doesn't fail with `ServerScriptNotEnabled`.
 *
 * Uses `/api/method/frappe.client.save` (whitelisted method) which lets
 * Frappe fill server-side defaults. No Server Script dependency.
 */
export async function createPurchaseOrder(
  data: Partial<PurchaseOrder>
): Promise<PurchaseOrder> {
  // Pre-flight: ensure no Server Scripts block creation
  await disableServerScriptsFor(PO_DOCTYPE);

  if (data.supplier) {
    await assertSuppliersActive([data.supplier]);
  }

  const normalized = buildPurchaseOrderPayload({ ...data });

  const PO_ITEM_DOCTYPE = "Purchase Order Item";
  const items = (normalized.items ?? []).map(
    (item, idx) => ({
      doctype: PO_ITEM_DOCTYPE,
      idx: idx + 1,
      item_code: item.item_code,
      item_name: item.item_name ?? item.item_code,
      description: item.description ?? item.item_name ?? item.item_code,
      qty: item.qty,
      stock_qty: item.qty,
      uom: item.uom ?? "Nos",
      stock_uom: item.uom ?? "Nos",
      conversion_factor: 1,
      rate: item.rate,
      amount: item.amount,
      schedule_date: item.schedule_date,
      ...(item.warehouse ? { warehouse: item.warehouse } : {}),
      ...(item.supplier_quotation
        ? { supplier_quotation: item.supplier_quotation }
        : {}),
    })
  );

  const doc: Record<string, unknown> = {
    doctype: PO_DOCTYPE,
    supplier: normalized.supplier,
    transaction_date: normalized.transaction_date,
    schedule_date: normalized.schedule_date,
    items,
  };
  if (normalized.company) doc.company = normalized.company;
  if (normalized.remarks) doc.remarks = normalized.remarks;

  const API_METHOD = "/api/method/frappe.client.save";

  // eslint-disable-next-line no-console
  console.log("[PO Create] Backend method:", API_METHOD);
  // eslint-disable-next-line no-console
  console.log("[PO Create] Supplier:", doc.supplier);
  // eslint-disable-next-line no-console
  console.log("[PO Create] Items:", items.length);
  // eslint-disable-next-line no-console
  console.log("[PO Create] Full doc payload:", JSON.stringify(doc, null, 2));

  try {
    const created = await apiPost<PurchaseOrder>(API_METHOD, { doc });

    // eslint-disable-next-line no-console
    console.log("[PO Create] SUCCESS:", {
      poName: created.name,
      status: created.status,
      supplier: created.supplier,
      grandTotal: created.grand_total,
      method: API_METHOD,
    });

    return created;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error("[PO Create] FAILED", {
      method: API_METHOD,
      supplier: doc.supplier,
      itemCount: items.length,
      errorMessage: errMsg,
      axiosStatus: (err as { response?: { status?: number } })?.response?.status,
      axiosData: (err as { response?: { data?: unknown } })?.response?.data,
    });

    if (/server.?script/i.test(errMsg) || /safe_exec/i.test(errMsg)) {
      // eslint-disable-next-line no-console
      console.error(
        "[PO Create] Server Script error detected after pre-flight guard. " +
        "There may be scripts the API user cannot see/disable. " +
        "Check ERPNext → Setup → Server Script for Purchase Order records."
      );
      throw new Error(
        "Purchase Order creation blocked by a Server Script in ERPNext. " +
        "An administrator must disable or delete Server Scripts configured " +
        "for the Purchase Order DocType in ERPNext Setup."
      );
    }

    throw err;
  }
}

/* -------------------------------------------------------------------------- */
/*  Consolidated RFQ → PO creation endpoint                                   */
/* -------------------------------------------------------------------------- */

export interface CreatePOFromRFQResult {
  po: PurchaseOrder;
  poName: string;
  supplier: string;
  grandTotal: number;
}

/**
 * `create_purchase_order_from_rfq(rfq_id)` — all-in-one endpoint.
 *
 * 1. Disables any active Server Scripts on Purchase Order (pre-flight).
 * 2. Loads the approved RFQ from ERPNext.
 * 3. Reads the selected supplier from the approval workflow (localStorage).
 * 4. Fetches the winning Supplier Quotation for rates.
 * 5. Builds the PO payload with proper dates, warehouse, and SQ link.
 * 6. Creates a Draft PO via `frappe.client.save` (no Server Script dependency).
 * 7. Links the PO to the RFQ via the `remarks` field.
 * 8. Returns the PO document with its generated name.
 */
export async function createPurchaseOrderFromRFQ(
  rfqId: string
): Promise<CreatePOFromRFQResult> {
  // eslint-disable-next-line no-console
  console.log("[createPOFromRFQ] ===== Starting PO creation from RFQ =====");
  // eslint-disable-next-line no-console
  console.log("[createPOFromRFQ] RFQ ID:", rfqId);

  // 1. Load approval state & validate
  const approvalState = getApprovalState(rfqId);
  if (!isApprovedForPO(approvalState)) {
    throw new Error(
      "This RFQ has not completed both Legal and Finance approvals. " +
      `Legal: ${approvalState?.legal_status ?? "N/A"}, ` +
      `Finance: ${approvalState?.finance_status ?? "N/A"}`
    );
  }

  const selectedSupplier = approvalState!.selected_supplier;
  if (!selectedSupplier) {
    throw new Error("No supplier has been selected for this RFQ.");
  }

  // eslint-disable-next-line no-console
  console.log("[createPOFromRFQ] Selected supplier (from approval):", selectedSupplier);

  // 2. Check for existing PO
  // eslint-disable-next-line no-console
  console.log("[createPOFromRFQ] Checking for existing PO...");
  await assertNoPOForRFQ(rfqId);

  // 3. Load the RFQ from ERPNext
  // eslint-disable-next-line no-console
  console.log("[createPOFromRFQ] Fetching RFQ from ERPNext...");
  const rfq = await getRFQ(rfqId);
  if (!rfq || !rfq.name) {
    throw new Error(`RFQ "${rfqId}" not found in ERPNext.`);
  }
  // eslint-disable-next-line no-console
  console.log("[createPOFromRFQ] RFQ loaded:", rfq.name, "| items:", (rfq.items ?? []).length);

  // 4. Load supplier quotations to get rates
  // eslint-disable-next-line no-console
  console.log("[createPOFromRFQ] Fetching supplier quotations...");
  const allQuotations = await getSupplierQuotations(rfqId);
  const winningSq = allQuotations.find(
    (sq) => sq.supplier === selectedSupplier || sq.supplier_name === selectedSupplier
  );
  // eslint-disable-next-line no-console
  console.log("[createPOFromRFQ] Winning SQ:", winningSq?.name ?? "(no match)", "| total SQs:", allQuotations.length);

  // Resolve the actual ERPNext supplier ID from the quotation record.
  // `selected_supplier` may be a display name (from AI recommendation) which
  // differs from the ERPNext Supplier document `name` (link ID). The quotation
  // record's `supplier` field is always the authoritative ERPNext link ID.
  let resolvedSupplierId = winningSq?.supplier ?? selectedSupplier;

  // If no winning quotation was found, try resolving the supplier via ERPNext
  // lookup by both document name and display name (supplier_name).
  if (!winningSq) {
    // eslint-disable-next-line no-console
    console.log("[createPOFromRFQ] No winning SQ found — resolving supplier from ERPNext...");
    const erpNextId = await resolveSupplierERPNextId(selectedSupplier);
    if (erpNextId) {
      resolvedSupplierId = erpNextId;
      // eslint-disable-next-line no-console
      console.log("[createPOFromRFQ] Resolved via ERPNext lookup:", erpNextId);
    }
  }

  // eslint-disable-next-line no-console
  console.log("[createPOFromRFQ] Selected supplier (approval state):", selectedSupplier);
  // eslint-disable-next-line no-console
  console.log("[createPOFromRFQ] Resolved ERPNext supplier ID:", resolvedSupplierId);
  // eslint-disable-next-line no-console
  console.log("[createPOFromRFQ] Supplier name (display):", winningSq?.supplier_name ?? selectedSupplier);

  // Validate supplier exists in ERPNext before attempting PO creation
  try {
    await assertSuppliersActive([resolvedSupplierId]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error("[createPOFromRFQ] Supplier validation failed:", {
      selectedSupplier,
      resolvedSupplierId,
      error: msg,
    });
    throw new Error(
      `Supplier "${selectedSupplier}" not found in ERPNext Supplier Master. ` +
      `Please verify the supplier record exists and is active.`
    );
  }

  // 5. Resolve dates and warehouse
  const poTransactionDate = resolvePoTransactionDate();
  const warehouse = await lookupDefaultWarehouse(COMPANY);
  const winnerItems = winningSq?.items ?? [];

  // 6. Build PO items
  const poItems = (rfq.items ?? []).map((it) => {
    const sqItem = winnerItems.find((si) => si.item_code === it.item_code);
    const rate = sqItem?.rate ?? 0;
    const scheduleDate = resolvePoItemScheduleDate(it.schedule_date, poTransactionDate);
    return {
      item_code: it.item_code,
      item_name: it.item_name ?? it.item_code,
      description: it.description ?? it.item_name ?? it.item_code,
      qty: it.qty,
      uom: it.uom ?? "Nos",
      rate,
      amount: rate * it.qty,
      schedule_date: scheduleDate,
      warehouse,
      ...(winningSq?.name ? { supplier_quotation: winningSq.name } : {}),
    };
  });

  const poScheduleDate = resolvePoHeaderScheduleDate(
    poItems.map((item) => item.schedule_date),
    poTransactionDate
  );

  // eslint-disable-next-line no-console
  console.log("[createPOFromRFQ] Payload ready — calling createPurchaseOrder...");

  // 7. Create PO via frappe.client.save (with Server Script pre-flight)
  const po = await createPurchaseOrder({
    supplier: resolvedSupplierId,
    company: COMPANY,
    transaction_date: poTransactionDate,
    schedule_date: poScheduleDate,
    remarks: rfq.name,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    items: poItems as any,
  });

  // eslint-disable-next-line no-console
  console.log("[createPOFromRFQ] ===== PO CREATED SUCCESSFULLY =====");
  // eslint-disable-next-line no-console
  console.log("[createPOFromRFQ] PO Name:", po.name);
  // eslint-disable-next-line no-console
  console.log("[createPOFromRFQ] Grand Total:", po.grand_total);

  return {
    po,
    poName: po.name,
    supplier: resolvedSupplierId,
    grandTotal: po.grand_total ?? 0,
  };
}

const SQ_DOCTYPE = "Supplier Quotation";

export interface LinkedPORow {
  name: string;
  supplier: string;
  supplier_name: string;
  grand_total: number;
  transaction_date: string;
  remarks?: string;
  rfq_name?: string;
  docstatus?: number;
  status?: string;
}

const LINKED_PO_LIST_FIELDS = [
  "name",
  "supplier",
  "supplier_name",
  "grand_total",
  "transaction_date",
  "docstatus",
  "status",
] as const;

async function listPOsByFilter(
  filters: Filter[],
  limit_page_length = 20
): Promise<LinkedPORow[]> {
  try {
    return await apiGet<LinkedPORow[]>(
      buildResourceUrl(PO_DOCTYPE),
      buildListConfig({
        fields: [...LINKED_PO_LIST_FIELDS],
        filters,
        order_by: "creation desc",
        limit_page_length,
      })
    );
  } catch (err) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn(
        "[getPOsForRFQ] listPOsByFilter failed:",
        filters,
        err instanceof Error ? err.message : err
      );
    }
    return [];
  }
}

/** Supplier Quotation names linked to an RFQ (via child-table filter). */
async function getSupplierQuotationNamesForRFQ(
  rfqName: string
): Promise<string[]> {
  try {
    const rows = await apiGet<Array<{ name: string }>>(
      buildResourceUrl(SQ_DOCTYPE),
      buildListConfig({
        fields: ["name"],
        filters: [["items.request_for_quotation", "=", rfqName]],
        limit_page_length: 50,
      })
    );
    return [...new Set(rows.map((r) => r.name))];
  } catch {
    return [];
  }
}

function mergeLinkedPOs(...groups: LinkedPORow[][]): LinkedPORow[] {
  const seen = new Set<string>();
  const merged: LinkedPORow[] = [];
  for (const group of groups) {
    for (const row of group) {
      if (!row?.name || seen.has(row.name)) continue;
      seen.add(row.name);
      merged.push(row);
    }
  }
  return merged;
}

/**
 * Match POs explicitly linked to this RFQ via header fields or supplier quotation items.
 */
async function getPOsByItemSignature(
  rfqName: string,
  sqNames: string[] = []
): Promise<LinkedPORow[]> {
  let rfq: RequestForQuotation;
  try {
    rfq = await getRFQ(rfqName);
  } catch {
    return [];
  }

  const suppliers = [
    ...new Set(
      (rfq.suppliers ?? [])
        .map((s) => s.supplier)
        .filter((s): s is string => !!s)
    ),
  ];

  if (suppliers.length === 0) return [];

  const sqSet = new Set(sqNames);
  const candidates = mergeLinkedPOs(
    await listPOsByFilter([["supplier", "in", suppliers]], 50)
  );

  const matched: LinkedPORow[] = [];
  for (const candidate of candidates) {
    try {
      const full = await getPurchaseOrder(candidate.name);
      const headerRemarks = (full as { remarks?: string }).remarks;
      const headerRfqName = (full as { rfq_name?: string }).rfq_name;
      const explicitlyLinked =
        headerRemarks === rfqName || headerRfqName === rfqName;
      const linkedViaSq = (full.items ?? []).some((it) => {
        const sq = (it as { supplier_quotation?: string }).supplier_quotation;
        return !!sq && sqSet.has(sq);
      });

      // Require an explicit RFQ link — item signature alone matches unrelated POs
      // that share the same supplier and line items as another RFQ.
      if (explicitlyLinked || linkedViaSq) {
        matched.push({
          name: full.name,
          supplier: full.supplier,
          supplier_name: full.supplier_name ?? full.supplier,
          grand_total: full.grand_total ?? 0,
          transaction_date: full.transaction_date,
          remarks: headerRemarks,
          rfq_name: headerRfqName,
        });
      }
    } catch {
      /* skip unreadable PO */
    }
  }

  if (import.meta.env.DEV && matched.length > 0) {
    // eslint-disable-next-line no-console
    console.log("[getPOsForRFQ] explicit RFQ link match:", matched);
  }

  return matched;
}

/**
 * Find Purchase Orders created from a given RFQ.
 *
 * Strategies (merged, deduplicated):
 *   1. Child `Purchase Order Item.supplier_quotation` for each SQ on this RFQ
 *   2. POs from RFQ suppliers with explicit RFQ link (remarks, rfq_name, or SQ on items)
 *   3. Header `remarks` / `rfq_name` on fetched PO documents (when set)
 *
 * Note: this ERPNext install rejects list filters on `rfq_name`, `remarks`, and
 * `request_for_quotation` on Purchase Order — those are checked via full-doc
 * fetch inside the item-signature pass instead.
 */
export async function getPOsForRFQ(rfqName: string): Promise<LinkedPORow[]> {
  const sqNames = await getSupplierQuotationNamesForRFQ(rfqName);

  const bySqGroups = await Promise.all(
    sqNames.map((sq) =>
      listPOsByFilter([
        ["Purchase Order Item", "supplier_quotation", "=", sq],
      ])
    )
  );

  const bySupplierQuotation = mergeLinkedPOs(...bySqGroups);
  const byItemSignature = await getPOsByItemSignature(rfqName, sqNames);

  const merged = mergeLinkedPOs(bySupplierQuotation, byItemSignature);

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log("[getPOsForRFQ] RFQ:", rfqName);
    // eslint-disable-next-line no-console
    console.log("[getPOsForRFQ] SQ names:", sqNames);
    // eslint-disable-next-line no-console
    console.log("[getPOsForRFQ] by supplier_quotation:", bySupplierQuotation);
    // eslint-disable-next-line no-console
    console.log("[getPOsForRFQ] by item signature:", byItemSignature);
    // eslint-disable-next-line no-console
    console.log("[getPOsForRFQ] merged:", merged);
  }

  return merged;
}

/**
 * Bulk "which of these RFQs already have a linked Purchase Order?" lookup,
 * for the RFQ LIST view.
 *
 * Performance: replaces the previous N+1 that ran the heavy `getPOsForRFQ()`
 * (multiple list calls + full-document fetches per candidate) once PER RFQ
 * row. For each RFQ we resolve its Supplier Quotations and check, with a
 * single light query, whether any Purchase Order item references them.
 *
 * NOTE: We deliberately do NOT read the Purchase Order `remarks` field here.
 * This ERPNext install rejects `remarks` in `get_list` field selections
 * (`DataError: Field not permitted in query: remarks`), so the link is
 * resolved through the queryable `Supplier Quotation` →
 * `Purchase Order Item.supplier_quotation` chain instead.
 *
 * This is intentionally a lighter heuristic than the detail page's
 * authoritative `getPOsForRFQ()`. The list only needs a fast "Completed"
 * badge; the RFQ detail page still performs the full, exact PO validation.
 * Tolerant: any failure yields an empty set (rows fall back to RFQ status).
 */
export async function getRFQNamesWithPO(
  rfqNames: string[]
): Promise<Set<string>> {
  const matched = new Set<string>();
  if (rfqNames.length === 0) return matched;

  await Promise.all(
    rfqNames.map(async (rfqName) => {
      try {
        const sqNames = await getSupplierQuotationNamesForRFQ(rfqName);
        if (sqNames.length === 0) return;
        const pos = await listPOsByFilter(
          [["Purchase Order Item", "supplier_quotation", "in", sqNames]],
          1
        );
        if (pos.length > 0) matched.add(rfqName);
      } catch (err) {
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.warn(
            "[getRFQNamesWithPO] PO lookup failed for",
            rfqName,
            err instanceof Error ? err.message : err
          );
        }
      }
    })
  );

  return matched;
}

/** Return the first Purchase Order linked to an RFQ, or null. */
export async function getPurchaseOrderByRFQ(
  rfqName: string
): Promise<LinkedPORow | null> {
  const rows = await getPOsForRFQ(rfqName);
  return rows[0] ?? null;
}

/** Throws when a Purchase Order already exists for the RFQ. */
export async function assertNoPOForRFQ(rfqName: string): Promise<void> {
  const existing = await getPOsForRFQ(rfqName);
  if (existing.length > 0) {
    throw new Error(
      `Purchase Order already exists for this RFQ (${existing[0].name})`
    );
  }
}

/** Update an existing Purchase Order. */
export async function updatePurchaseOrder(
  name: string,
  data: Partial<PurchaseOrder>
): Promise<PurchaseOrder> {
  return apiPut<PurchaseOrder>(buildResourceUrl(PO_DOCTYPE, name), data);
}

/**
 * Submit a Purchase Order — transitions docstatus 0 → 1.
 *
 * Uses the resource PUT approach:
 *  1. GET the latest doc to capture its exact `modified` timestamp.
 *  2. PUT { docstatus: 1, modified } to advance the document to Submitted.
 */
export async function submitPurchaseOrder(
  name: string
): Promise<PurchaseOrder> {
  // Submission also triggers document lifecycle events that run Server Scripts
  await disableServerScriptsFor(PO_DOCTYPE);

  const endpoint = buildResourceUrl(PO_DOCTYPE, name);

  // eslint-disable-next-line no-console
  console.log("[PO Submit] Backend method: PUT", endpoint);

  const fresh = await apiGet<PurchaseOrder>(endpoint);
  const modified =
    (fresh as { modified?: string }).modified ??
    (fresh as { data?: { modified?: string } }).data?.modified;

  // eslint-disable-next-line no-console
  console.log("[PO Submit] Document:", { name, modified, status: fresh.status });

  const payload: Record<string, unknown> = { docstatus: 1 };
  if (modified) payload.modified = modified;

  try {
    const response = await apiPut<PurchaseOrder>(endpoint, payload);
    // eslint-disable-next-line no-console
    console.log("[PO Submit] SUCCESS:", { name, status: response.status });
    return response;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error("[PO Submit] FAILED", {
      endpoint,
      poName: name,
      payload,
      errorMessage: errMsg,
      axiosStatus: (err as { response?: { status?: number } })?.response?.status,
      axiosData: (err as { response?: { data?: unknown } })?.response?.data,
    });

    if (/server.?script/i.test(errMsg) || /safe_exec/i.test(errMsg)) {
      throw new Error(
        "PO submission blocked by a Server Script in ERPNext. " +
        "An administrator must disable or delete Server Scripts configured " +
        "for the Purchase Order DocType in ERPNext Setup."
      );
    }

    throw err;
  }
}

/* -------------------------------------------------------------------------- */
/*  Purchase Receipt (GRN)                                                    */
/* -------------------------------------------------------------------------- */

/** List Purchase Receipts (Goods Receipt Notes). */
export async function getPurchaseReceipts(
  filters?: ListParams
): Promise<PurchaseReceipt[]> {
  return apiGet<PurchaseReceipt[]>(
    buildResourceUrl(PRECEIPT_DOCTYPE),
    buildListConfig({
      fields: [
        "name",
        "supplier",
        "supplier_name",
        "status",
        "posting_date",
        "grand_total",
        "modified",
      ],
      order_by: "modified desc",
      limit_page_length: 50,
      ...filters,
    })
  );
}

/**
 * Fetch all Purchase Receipts (GRNs) linked to a specific Purchase Order.
 *
 * Uses a child-table 4-tuple filter `["Purchase Receipt Item",
 * "purchase_order", "=", poName]` which is the standard ERPNext way to
 * query a parent doctype by a field that lives in its child table.
 *
 * Returns an empty array on error so callers never have to guard against null.
 */
export async function getGRNsForPO(
  poName: string
): Promise<
  Array<{
    name: string;
    supplier?: string;
    supplier_name?: string;
    posting_date?: string;
    status?: string;
    grand_total?: number;
    /** 0 = Draft, 1 = Submitted, 2 = Cancelled */
    docstatus?: number;
    modified?: string;
  }>
> {
  try {
    return await apiGet(
      buildResourceUrl(PRECEIPT_DOCTYPE),
      buildListConfig({
        fields: [
          "name",
          "supplier",
          "supplier_name",
          "posting_date",
          "status",
          "grand_total",
          "docstatus",
          "modified",
        ],
        filters: [
          ["Purchase Receipt Item", "purchase_order", "=", poName],
        ],
        order_by: "modified desc",
        limit_page_length: 20,
      })
    ) as Array<{
      name: string;
      supplier?: string;
      supplier_name?: string;
      posting_date?: string;
      status?: string;
      grand_total?: number;
      docstatus?: number;
      modified?: string;
    }>;
  } catch {
    return [];
  }
}

/** Fetch a single Purchase Receipt by `name`. */
export async function getPurchaseReceipt(
  name: string
): Promise<PurchaseReceipt> {
  return apiGet<PurchaseReceipt>(buildResourceUrl(PRECEIPT_DOCTYPE, name));
}

/**
 * Create a Purchase Receipt (GRN). Dates are normalized to YYYY-MM-DD.
 *
 * Future-date policy is enforced server-side by a Before Validate Server
 * Script that checks Stock Settings > allow_future_grn_dates.  The
 * frontend does NOT need to send any special flags or use alternate API
 * endpoints — the standard resource API is used for all environments.
 *
 * Setup: `node scripts/setup-future-grn.mjs`
 */
export async function createPurchaseReceipt(
  data: Partial<PurchaseReceipt>
): Promise<PurchaseReceipt> {
  assertCanManageGRN();
  const payload = buildGrnPayload({ ...data });

  // eslint-disable-next-line no-console
  console.group("GRN CREATE DEBUG");
  // eslint-disable-next-line no-console
  console.log("Supplier:", payload.supplier);
  // eslint-disable-next-line no-console
  console.log("Company:", payload.company);
  // eslint-disable-next-line no-console
  console.log("Posting Date:", payload.posting_date);
  // eslint-disable-next-line no-console
  console.log("Posting Time:", payload.posting_time);
  // eslint-disable-next-line no-console
  console.log("set_posting_time:", payload.set_posting_time);
  // eslint-disable-next-line no-console
  console.log("Currency:", payload.currency);
  // eslint-disable-next-line no-console
  console.log("Items count:", payload.items?.length ?? 0);
  // eslint-disable-next-line no-console
  console.log("Items:", JSON.stringify(payload.items, null, 2));
  // eslint-disable-next-line no-console
  console.log("[GRN PAYLOAD]", JSON.parse(JSON.stringify(payload)));
  // eslint-disable-next-line no-console
  console.groupEnd();

  try {
    const response = await apiPost<PurchaseReceipt>(
      buildResourceUrl(PRECEIPT_DOCTYPE),
      payload,
      { ...withSilent() }
    );
    // eslint-disable-next-line no-console
    console.log("[GRN CREATE SUCCESS]", response);
    return response;
  } catch (err: unknown) {
    const axErr = err as { response?: { status?: number; data?: unknown }; message?: string };
    // eslint-disable-next-line no-console
    console.group("GRN CREATE FAILED");
    // eslint-disable-next-line no-console
    console.error("Error message:", axErr.message);
    // eslint-disable-next-line no-console
    console.error("HTTP Status:", axErr.response?.status);
    // eslint-disable-next-line no-console
    console.error("ERPNext Response:", axErr.response?.data);
    // eslint-disable-next-line no-console
    console.error("[GRN PAYLOAD sent]", JSON.parse(JSON.stringify(payload)));
    // eslint-disable-next-line no-console
    console.groupEnd();
    throw err;
  }
}

/**
 * Submit a Purchase Receipt — transitions docstatus 0 → 1.
 *
 * Uses the resource PUT approach (same as submitPurchaseOrder / submitRFQ)
 * because `frappe.client.submit(doctype, docname)` raises
 * "submit() missing 1 required positional argument: 'doc'".
 */
export async function submitPurchaseReceipt(
  name: string
): Promise<PurchaseReceipt> {
  assertCanManageGRN();
  const fresh = await apiGet<PurchaseReceipt>(
    buildResourceUrl(PRECEIPT_DOCTYPE, name)
  );
  const modified =
    (fresh as { modified?: string }).modified ??
    (fresh as { data?: { modified?: string } }).data?.modified;

  // eslint-disable-next-line no-console
  console.log("[GRN] Submitting:", { name, modified });

  const payload: Record<string, unknown> = { docstatus: 1 };
  if (modified) payload.modified = modified;

  // eslint-disable-next-line no-console
  console.log("[GRN] Submit payload:", JSON.stringify(payload));

  const response = await apiPut<PurchaseReceipt>(
    buildResourceUrl(PRECEIPT_DOCTYPE, name),
    payload
  );

  // eslint-disable-next-line no-console
  console.log("[GRN] Submit response:", response);
  return response;
}

/* -------------------------------------------------------------------------- */
/*  Cost Centers                                                               */
/*  (Used in Material Request form to pick the charging cost center.)         */
/* -------------------------------------------------------------------------- */

/** List Cost Centers — used to populate hierarchy pickers. */
export async function getCostCentres(
  filters?: ListParams
): Promise<CostCenter[]> {
  return apiGet<CostCenter[]>(
    buildResourceUrl("Cost Center"),
    buildListConfig({
      fields: [
        "name",
        "cost_center_name",
        "parent_cost_center",
        "is_group",
        "company",
        "modified",
      ],
      order_by: "modified desc",
      limit_page_length: 100,
      ...filters,
    })
  );
}

/** Fetch a single Cost Center by `name`. */
export async function getCostCentre(name: string): Promise<CostCenter> {
  return apiGet<CostCenter>(buildResourceUrl("Cost Center", name));
}
