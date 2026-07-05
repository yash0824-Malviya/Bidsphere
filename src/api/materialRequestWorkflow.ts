/**
 * BidSphere Material Request workflow API.
 *
 * Uses ERPNext standard Material Request + Stock Entry for material issue.
 * Workflow status is stored in `custom_bidsphere_status` when provisioned via
 * scripts/setup-material-request-workflow.mjs. List queries never filter on
 * custom fields (client-side filter) and fall back to standard fields if a
 * custom field is not queryable.
 * RFQ integration is in createRFQFromMaterialRequest.ts — not here.
 */

import {
  apiDelete,
  apiGet,
  apiPost,
  apiPut,
  buildListConfig,
  buildResourceUrl,
  COMPANY,
  getCount,
  withSilent,
} from "./erpnext";
import type { Filter } from "./erpnext";
import {
  createMaterialRequest,
  getMaterialRequest,
  submitMaterialRequest,
  updateMaterialRequest,
  type MaterialRequestPayload,
} from "./purchasing";
import { lookupDefaultWarehouse } from "./sourcing";
import type { MaterialRequest, MaterialRequestItem } from "../types/erpnext";
import {
  MR_WORKFLOW_FIELD,
  PROCUREMENT_QUEUE_STATUSES,
  normalizeWorkflowStatus,
  toErpBidsphereStatus,
  type MaterialRequestPriority,
  type MaterialRequestStockCheck,
  type MaterialRequestStockLine,
  type MaterialRequestWorkflowFields,
  type MaterialRequestWorkflowStatus,
} from "../types/materialRequestWorkflow";
import { todayERPNextDate } from "../utils/erpNextDate";
import { sanitizeFrappeError } from "../utils/friendlyError";

const MR_DOCTYPE = "Material Request";

export const MR_WORKFLOW_STATUSES: MaterialRequestWorkflowStatus[] = [
  "Draft",
  "Submitted",
  "Under Warehouse Review",
  "Stock Available",
  "Material Issued",
  "Procurement Required",
  "RFQ Created",
  "Completed",
  "Cancelled",
];

/** MRs awaiting warehouse action (stock check, issue, or forward). */
export const WAREHOUSE_PENDING_STATUSES: MaterialRequestWorkflowStatus[] = [
  "Submitted",
  "Under Warehouse Review",
  "Stock Available",
];

/** MRs visible on the warehouse dashboard tallies. */
export const WAREHOUSE_DASHBOARD_STATUSES: MaterialRequestWorkflowStatus[] = [
  "Submitted",
  "Under Warehouse Review",
  "Stock Available",
  "Material Issued",
  "Procurement Required",
];

const LOG_PREFIX = "[Material Request API]";

function logMrApi(
  phase: "request" | "response" | "processed",
  detail: unknown,
) {
  if (!import.meta.env.DEV) return;
  console.log(`${LOG_PREFIX} ${phase}:`, detail);
}

export type MaterialRequestWorkflowRecord = MaterialRequest &
  MaterialRequestWorkflowFields;

export interface MaterialRequestUserIdentity {
  email?: string;
  name?: string;
  fullName?: string;
}

function normalizeIdentityValue(
  value: string | undefined | null,
): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

export function buildMaterialRequestIdentitySet(
  identity: MaterialRequestUserIdentity | undefined,
): Set<string> {
  const values = [identity?.email, identity?.name, identity?.fullName]
    .map((value) => normalizeIdentityValue(value))
    .filter((value): value is string => Boolean(value));
  return new Set(values);
}

export function isMaterialRequestOwnedByUser(
  mr: MaterialRequestWorkflowRecord,
  identity: MaterialRequestUserIdentity | undefined,
): boolean {
  const identities = buildMaterialRequestIdentitySet(identity);
  if (identities.size === 0) return true;

  return [mr.owner, mr.custom_requested_by, mr.requested_by]
    .map((value) => normalizeIdentityValue(value))
    .some((value) => value !== null && identities.has(value));
}

export interface CreateMaterialRequestWorkflowInput {
  company?: string;
  transaction_date?: string;
  schedule_date?: string;
  department?: string;
  priority?: MaterialRequestPriority;
  purpose?: string;
  requested_by?: string;
  remarks?: string;
  items: Array<
    Partial<MaterialRequestItem> & {
      item_code: string;
      qty: number | string;
      warehouse?: string;
      schedule_date?: string;
      description?: string;
      uom?: string;
    }
  >;
}

const MR_LIST_FIELDS_STANDARD = [
  "name",
  "creation",
  "status",
  "transaction_date",
  "schedule_date",
  "modified",
  "owner",
  "company",
  "material_request_type",
  "docstatus",
] as const;

/** Custom workflow fields — require scripts/setup-material-request-workflow.mjs */
const MR_CUSTOM_QUERY_FIELDS = [
  MR_WORKFLOW_FIELD,
  "custom_department",
  "custom_priority",
  "custom_purpose",
  "custom_warehouse_remarks",
  "custom_procurement_remarks",
  "custom_linked_rfq",
  "custom_requested_by",
] as const;

const MR_LIST_FIELDS_FULL: string[] = [
  ...MR_LIST_FIELDS_STANDARD,
  ...MR_CUSTOM_QUERY_FIELDS,
];

/** Avoid repeating failed list queries when custom fields are absent or not queryable. */
let mrListUsesCustomFields: boolean | null = null;

function isCustomFieldUnavailableError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err && "message" in err
        ? String((err as { message?: unknown }).message ?? "")
        : String(err ?? "");
  return /Field not permitted in query|DataError|Unknown column|No field named|Could not find .* in/i.test(
    msg,
  );
}

function isQueryFieldError(err: unknown): boolean {
  return isCustomFieldUnavailableError(err);
}

function linkedRfqFromRemarks(remarks?: string | null): string | undefined {
  if (!remarks) return undefined;
  const match = remarks.match(/\[BidSphere RFQ:([^\]]+)\]/);
  return match?.[1]?.trim() || undefined;
}

function linkedRfqFromDoc(
  doc: MaterialRequestWorkflowRecord,
): string | undefined {
  return doc.custom_linked_rfq || linkedRfqFromRemarks(doc.remarks);
}

function workflowStatusFromStandardFields(
  doc: MaterialRequestWorkflowRecord,
): MaterialRequestWorkflowStatus {
  const docstatus = doc.docstatus ?? 0;
  const stdStatus = (doc.status ?? "").trim();

  if (docstatus === 0) return "Draft";
  if (docstatus === 2 || stdStatus === "Cancelled" || stdStatus === "Stopped") {
    return "Cancelled";
  }
  if (stdStatus === "Issued") {
    return doc.material_request_type === "Material Issue"
      ? "Material Issued"
      : "Completed";
  }

  if (doc.material_request_type === "Purchase") {
    if (linkedRfqFromDoc(doc)) return "RFQ Created";
    return "Procurement Required";
  }

  if (docstatus === 1 && doc.material_request_type === "Material Issue") {
    return "Under Warehouse Review";
  }
  if (docstatus === 1) return "Submitted";

  return "Draft";
}

function workflowStatus(
  doc: MaterialRequestWorkflowRecord,
): MaterialRequestWorkflowStatus {
  // ERPNext (`custom_bidsphere_status`) is the single source of truth; normalize
  // legacy values (e.g. "Forwarded to Procurement", "Rejected") to the canonical
  // set so existing records keep working without a data migration.
  const custom = normalizeWorkflowStatus(doc[MR_WORKFLOW_FIELD]);
  if (custom) return custom;
  return workflowStatusFromStandardFields(doc);
}

async function fetchMaterialRequestListRows(
  filters: Filter[],
  limit?: number,
): Promise<MaterialRequestWorkflowRecord[]> {
  logMrApi("request", { filters, limit: limit ?? "all", doctype: MR_DOCTYPE });

  const modes: Array<{ fields: string[]; useCustom: boolean }> =
    mrListUsesCustomFields === false
      ? [{ fields: [...MR_LIST_FIELDS_STANDARD], useCustom: false }]
      : mrListUsesCustomFields === true
        ? [{ fields: MR_LIST_FIELDS_FULL, useCustom: true }]
        : [
            { fields: MR_LIST_FIELDS_FULL, useCustom: true },
            { fields: [...MR_LIST_FIELDS_STANDARD], useCustom: false },
          ];

  let lastError: unknown;
  for (const { fields, useCustom } of modes) {
    try {
      const pageSize = limit ?? 500;
      let start = 0;
      const rows: MaterialRequestWorkflowRecord[] = [];

      while (true) {
        const page = await apiGet<MaterialRequestWorkflowRecord[]>(
          buildResourceUrl(MR_DOCTYPE),
          withSilent(
            buildListConfig({
              fields,
              filters: filters.length > 0 ? filters : undefined,
              order_by: "creation desc",
              limit_page_length: pageSize,
              limit_start: start,
            }),
          ),
        );

        const currentPage = page ?? [];
        rows.push(...currentPage);

        if (limit !== undefined || currentPage.length < pageSize) {
          break;
        }

        start += currentPage.length;
      }

      mrListUsesCustomFields = useCustom;
      logMrApi("response", {
        rowCount: rows.length,
        useCustomFields: useCustom,
        firstRecord: rows[0]
          ? {
              name: rows[0].name,
              creation: rows[0].creation,
              status: rows[0].status,
              docstatus: rows[0].docstatus,
            }
          : null,
        lastRecord: rows.at(-1)
          ? {
              name: rows.at(-1)?.name,
              creation: rows.at(-1)?.creation,
              status: rows.at(-1)?.status,
              docstatus: rows.at(-1)?.docstatus,
            }
          : null,
      });
      return rows;
    } catch (err) {
      lastError = err;
      if (!isQueryFieldError(err)) throw err;
      mrListUsesCustomFields = false;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to list Material Requests.");
}

function matchesWorkflowStatusFilter(
  doc: MaterialRequestWorkflowRecord,
  statuses: MaterialRequestWorkflowStatus[],
): boolean {
  return statuses.includes(getMaterialRequestWorkflowStatus(doc));
}

export function getMaterialRequestWorkflowStatus(
  doc: MaterialRequestWorkflowRecord,
): MaterialRequestWorkflowStatus {
  return workflowStatus(doc);
}

export async function fetchMaterialRequestWorkflow(
  name: string,
): Promise<MaterialRequestWorkflowRecord> {
  const doc = await getMaterialRequest(name);
  return doc as MaterialRequestWorkflowRecord;
}

/**
 * Resolve a requester's full name from ERPNext. Accepts either an email
 * (looked up against the User doctype) or an already-human name (returned
 * as-is). Returns null when nothing usable is found so callers can fall back
 * to a friendly default. Never throws — degrades to null on any failure.
 */
export async function getUserFullName(
  identifier: string | undefined | null,
): Promise<string | null> {
  const value = (identifier ?? "").trim();
  if (!value) return null;
  // Already a human-readable name (not an email/login id) — use directly.
  if (!value.includes("@")) return value;
  try {
    const rows = await apiGet<Array<{ full_name?: string }>>(
      buildResourceUrl("User"),
      {
        ...buildListConfig({
          fields: ["full_name"],
          filters: [["email", "=", value]],
          limit_page_length: 1,
        }),
        ...withSilent(),
      },
    );
    const fullName = rows?.[0]?.full_name?.trim();
    return fullName || null;
  } catch {
    return null;
  }
}

export async function listMaterialRequestsWorkflow(params?: {
  owner?: string;
  workflowStatus?:
    MaterialRequestWorkflowStatus | MaterialRequestWorkflowStatus[];
  docstatus?: 0 | 1 | 2;
  materialRequestType?: "Material Issue" | "Purchase";
  limit?: number;
}): Promise<MaterialRequestWorkflowRecord[]> {
  const filters: Filter[] = [];
  if (params?.owner) filters.push(["owner", "=", params.owner]);
  if (params?.docstatus !== undefined) {
    filters.push(["docstatus", "=", params.docstatus]);
  }
  if (params?.materialRequestType) {
    filters.push(["material_request_type", "=", params.materialRequestType]);
  }

  const rows = await fetchMaterialRequestListRows(filters, params?.limit);

  if (!params?.workflowStatus) {
    logMrApi("processed", {
      returned: rows.length,
      workflowFilter: null,
      firstRecord: rows[0]?.name,
      lastRecord: rows.at(-1)?.name,
    });
    return rows;
  }

  const statuses = Array.isArray(params.workflowStatus)
    ? params.workflowStatus
    : [params.workflowStatus];

  const filtered = rows.filter((row) =>
    matchesWorkflowStatusFilter(row, statuses),
  );
  logMrApi("processed", {
    fetched: rows.length,
    workflowFilter: statuses,
    returned: filtered.length,
    statuses: filtered.map((r) => ({
      name: r.name,
      workflow: getMaterialRequestWorkflowStatus(r),
    })),
  });
  return filtered;
}

/** Warehouse review queue — submitted Material Issue MRs pending warehouse action. */
export async function listWarehouseMaterialRequestQueue(
  limit = 100,
): Promise<MaterialRequestWorkflowRecord[]> {
  return listMaterialRequestsWorkflow({
    docstatus: 1,
    materialRequestType: "Material Issue",
    workflowStatus: WAREHOUSE_PENDING_STATUSES,
    limit,
  });
}

export async function createMaterialRequestWorkflow(
  input: CreateMaterialRequestWorkflowInput,
): Promise<MaterialRequestWorkflowRecord> {
  const payload: MaterialRequestPayload = {
    company: input.company ?? COMPANY,
    material_request_type: "Material Issue",
    transaction_date: input.transaction_date,
    schedule_date: input.schedule_date,
    remarks: input.remarks ?? input.purpose,
    items: input.items.map((row) => ({
      item_code: row.item_code,
      item_name: row.item_name,
      description: row.description,
      qty: row.qty,
      uom: row.uom,
      warehouse: row.warehouse,
      schedule_date: row.schedule_date ?? input.schedule_date,
    })),
  };

  const created = await createMaterialRequest(payload);
  const updates: Record<string, unknown> = {
    [MR_WORKFLOW_FIELD]: toErpBidsphereStatus("Draft"),
  };
  if (input.department) updates.custom_department = input.department;
  if (input.priority) updates.custom_priority = input.priority;
  if (input.purpose) updates.custom_purpose = input.purpose;
  if (input.requested_by) updates.custom_requested_by = input.requested_by;

  try {
    await updateMaterialRequest(created.name, updates);
  } catch (err) {
    if (!isCustomFieldUnavailableError(err)) throw err;
  }

  return fetchMaterialRequestWorkflow(created.name);
}

/**
 * Department submits the Material Request. This submits the ERPNext document
 * (docstatus 0 → 1, so it leaves the Draft state permanently) and routes it to
 * the warehouse by setting the status to "Under Warehouse Review" — the status
 * is the assignment mechanism: warehouse queues/dashboards filter on it, so the
 * request appears for the warehouse team on any device. Persisted entirely in
 * ERPNext, so it survives refresh and logout.
 */
export async function submitMaterialRequestWorkflow(
  name: string,
): Promise<MaterialRequestWorkflowRecord> {
  const endpoint = buildResourceUrl(MR_DOCTYPE, name);
  const fresh = await apiGet<MaterialRequest>(endpoint);
  const modified =
    (fresh as { modified?: string }).modified ??
    (fresh as { data?: { modified?: string } }).data?.modified;

  const payload: Record<string, unknown> = {
    docstatus: 1,
    [MR_WORKFLOW_FIELD]: toErpBidsphereStatus("Under Warehouse Review"),
  };
  if (modified) payload.modified = modified;

  logMrApi("request", { action: "submit", name, payload });

  try {
    await apiPut<MaterialRequest>(endpoint, payload);
  } catch (err) {
    if (!isCustomFieldUnavailableError(err)) throw err;
    await submitMaterialRequest(name);
  }

  const result = await fetchMaterialRequestWorkflow(name);
  logMrApi("processed", {
    action: "submit",
    name,
    workflowStatus: getMaterialRequestWorkflowStatus(result),
  });
  return result;
}

export interface MaterialRequestDeleteActor {
  email?: string;
  name?: string;
  role?: string;
}

/** Count child rows that link a downstream document to this Material Request. */
async function countLinkedChildRows(
  childDoctype: string,
  mrName: string,
): Promise<number> {
  try {
    return await getCount(childDoctype, [["material_request", "=", mrName]]);
  } catch (err) {
    // The Draft + docstatus gate is authoritative — a draft cannot be
    // referenced by a submitted downstream doc — so a failed link probe (e.g.
    // permission/field quirk) must not falsely block a legitimate delete.
    if (import.meta.env.DEV) {
      console.warn(`[MR delete] link probe failed for ${childDoctype}:`, err);
    }
    return 0;
  }
}

/**
 * Records an immutable deletion audit entry in ERPNext's "Activity Log". This
 * is a standalone DocType (not a child of the MR), so it survives the deletion
 * and shows up in the existing Audit Trail views. Best-effort/non-fatal.
 */
async function recordMaterialRequestDeletionAudit(audit: {
  mr_name: string;
  deleted_by: string;
  deleted_on: string;
  user_role: string;
  company: string;
}): Promise<void> {
  console.log("[Material Request Deleted]", audit);
  const content = [
    `MR Number: ${audit.mr_name}`,
    `Deleted By: ${audit.deleted_by}`,
    `Deleted On: ${audit.deleted_on}`,
    `User Role: ${audit.user_role}`,
    `Company: ${audit.company}`,
  ].join("\n");
  try {
    // NOTE: do NOT set reference_doctype/reference_name to the Material
    // Request here. This audit runs AFTER the MR is deleted, so ERPNext's link
    // validation on `reference_name` would fail with a LinkValidationError
    // ("Reference Name … does not exist"), which the global axios interceptor
    // surfaces as a toast even though this call is best-effort. The MR number
    // is already captured in the subject + content. `_silent` is an extra
    // guard so any other insert failure never toasts after a successful delete.
    await apiPost(
      "/api/method/frappe.client.insert",
      {
        doc: {
          doctype: "Activity Log",
          subject: `Material Request ${audit.mr_name} deleted by ${audit.deleted_by}`,
          content,
          operation: "Delete",
          status: "Success",
          user: audit.deleted_by,
        },
      },
      withSilent(),
    );
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn("[MR delete] Activity Log audit insert skipped:", err);
    }
  }
}

/**
 * Permanently delete a Draft Material Request from ERPNext.
 *
 * Enforces the full delete guard server-side (independent of the UI): the doc
 * must be an unsubmitted Draft with no procurement linkage (RFQ / Purchase
 * Order / Stock Entry). Throws a user-facing error when a guard fails; on
 * success removes the doc and writes a deletion audit entry.
 */
export async function deleteMaterialRequestWorkflow(
  name: string,
  actor?: MaterialRequestDeleteActor,
): Promise<void> {
  const mr = await fetchMaterialRequestWorkflow(name);
  const status = getMaterialRequestWorkflowStatus(mr);
  const docstatus = mr.docstatus ?? 0;

  // Gate 1 — Draft & unsubmitted only.
  if (docstatus !== 0 || status !== "Draft") {
    throw new Error("Only Draft Material Requests can be deleted.");
  }

  // Gate 2 — no RFQ has been created from this MR. NOTE: we deliberately do NOT
  // check `material_request_type === "Purchase"` here — it defaults to
  // "Purchase" for every requisition and is not evidence of a started purchase
  // flow, so checking it blocked deletion of every legitimate draft.
  if (mr.custom_linked_rfq || linkedRfqFromDoc(mr)) {
    throw new Error("Cannot delete because an RFQ has already been created.");
  }

  // Gate 3 — no downstream child documents reference this MR.
  const [rfqItems, poItems, stockEntryLines] = await Promise.all([
    countLinkedChildRows("Request for Quotation Item", name),
    countLinkedChildRows("Purchase Order Item", name),
    countLinkedChildRows("Stock Entry Detail", name),
  ]);
  if (rfqItems > 0) {
    throw new Error("Cannot delete because an RFQ has already been created.");
  }
  if (poItems + stockEntryLines > 0) {
    throw new Error(
      "This Material Request is already part of the procurement workflow and cannot be deleted.",
    );
  }

  logMrApi("request", { action: "delete", name });
  await apiDelete(buildResourceUrl(MR_DOCTYPE, name));

  await recordMaterialRequestDeletionAudit({
    mr_name: name,
    deleted_by: actor?.email || actor?.name || mr.owner || "Unknown",
    deleted_on: new Date().toISOString(),
    user_role: actor?.role || "Unknown",
    company: mr.company || COMPANY,
  });

  logMrApi("processed", { action: "delete", name, result: "deleted" });
}

export async function updateMaterialRequestWorkflowStatus(
  name: string,
  status: MaterialRequestWorkflowStatus,
  extra?: Partial<MaterialRequestWorkflowFields>,
): Promise<MaterialRequestWorkflowRecord> {
  // Translate the UI label to the value ERPNext's Select field accepts. This is
  // the single write path for every workflow transition, so mapping here fixes
  // the "BidSphere Status cannot be …" ValidationError for ALL callers
  // (warehouse forward, RFQ creation, issue, complete, cancel, etc.).
  const erpStatus = toErpBidsphereStatus(status);
  const erpExtra: Partial<MaterialRequestWorkflowFields> = { ...extra };
  if (erpExtra[MR_WORKFLOW_FIELD]) {
    erpExtra[MR_WORKFLOW_FIELD] = toErpBidsphereStatus(
      erpExtra[MR_WORKFLOW_FIELD],
    ) as MaterialRequestWorkflowStatus;
  }

  try {
    await updateMaterialRequest(name, {
      [MR_WORKFLOW_FIELD]: erpStatus,
      ...erpExtra,
    });
  } catch (err) {
    if (!isCustomFieldUnavailableError(err)) {
      // Log the full backend exception (server/console) but surface a clean,
      // user-safe message — never a raw Frappe traceback in the UI toast.
      throw sanitizeFrappeError(
        err,
        "Unable to update the Material Request. Please try again.",
        `updateMaterialRequestWorkflowStatus(${name} → ${erpStatus})`,
      );
    }
    // Standard fields (material_request_type, status, remarks) are not updated
    // on submitted documents (docstatus = 1) to avoid UpdateAfterSubmitError.
  }
  return fetchMaterialRequestWorkflow(name);
}

export async function getBinQuantity(
  itemCode: string,
  warehouse: string,
): Promise<number> {
  const rows = await apiGet<Array<{ actual_qty?: number }>>(
    buildResourceUrl("Bin"),
    buildListConfig({
      fields: ["actual_qty"],
      filters: [
        ["item_code", "=", itemCode],
        ["warehouse", "=", warehouse],
      ],
      limit_page_length: 1,
    }),
  );
  const qty = rows?.[0]?.actual_qty;
  return typeof qty === "number" && Number.isFinite(qty) ? qty : 0;
}

export type ItemStockStatusLabel = "In Stock" | "Low Stock" | "Out of Stock";

/** Sum stock levels across all warehouse bins for an item. */
export async function getItemStockSummary(itemCode: string): Promise<{
  current_stock: number;
  available_qty: number;
}> {
  const rows = await apiGet<
    Array<{ actual_qty?: number; reserved_qty?: number }>
  >(
    buildResourceUrl("Bin"),
    buildListConfig({
      fields: ["actual_qty", "reserved_qty"],
      filters: [["item_code", "=", itemCode]],
      limit_page_length: 500,
    }),
  );
  let current_stock = 0;
  let available_qty = 0;
  for (const row of rows ?? []) {
    const actual = Number(row.actual_qty) || 0;
    const reserved = Number(row.reserved_qty) || 0;
    current_stock += actual;
    available_qty += Math.max(0, actual - reserved);
  }
  return { current_stock, available_qty };
}

/** @deprecated Use getItemStockSummary */
export async function getItemTotalAvailableStock(
  itemCode: string,
): Promise<number> {
  const summary = await getItemStockSummary(itemCode);
  return summary.available_qty;
}

export function resolveStockStatusLabel(
  availableQty: number,
  requestedQty?: number,
): ItemStockStatusLabel {
  if (availableQty <= 0) return "Out of Stock";
  if (requestedQty != null && requestedQty > 0 && availableQty < requestedQty) {
    return "Low Stock";
  }
  return "In Stock";
}

export async function checkMaterialRequestStock(
  name: string,
): Promise<MaterialRequestStockCheck> {
  const mr = await fetchMaterialRequestWorkflow(name);
  const company = mr.company || COMPANY;
  const defaultWarehouse = await lookupDefaultWarehouse(company);
  const lines: MaterialRequestStockLine[] = [];

  for (const row of mr.items ?? []) {
    const warehouse = row.warehouse || defaultWarehouse;
    const required = Number(row.qty) || 0;
    const available = warehouse
      ? await getBinQuantity(row.item_code, warehouse)
      : 0;
    lines.push({
      item_code: row.item_code,
      warehouse: warehouse || "—",
      required_qty: required,
      available_qty: available,
      sufficient: available >= required,
      uom: row.uom,
    });
  }

  return {
    mr_name: name,
    all_sufficient: lines.length > 0 && lines.every((l) => l.sufficient),
    lines,
  };
}

async function extractMappedDoc(
  result: unknown,
): Promise<Record<string, unknown>> {
  if (!result || typeof result !== "object") {
    throw new Error("ERPNext did not return a Stock Entry draft.");
  }
  const obj = result as Record<string, unknown>;
  if (obj.message && typeof obj.message === "object") {
    return obj.message as Record<string, unknown>;
  }
  if (obj.data && typeof obj.data === "object") {
    return obj.data as Record<string, unknown>;
  }
  return obj;
}

/**
 * Issue material via ERPNext standard Stock Entry (Material Issue).
 * Requires submitted MR and sufficient bin quantities.
 */
export async function issueMaterialRequest(
  name: string,
  options?: { warehouse_remarks?: string; partial?: boolean },
): Promise<{ stock_entry: string; mr: MaterialRequestWorkflowRecord }> {
  const stockCheck = await checkMaterialRequestStock(name);
  if (!stockCheck.all_sufficient && !options?.partial) {
    throw new Error("Insufficient stock. Forward this request to Procurement.");
  }

  const mapped = await apiPost<unknown>(
    "/api/method/erpnext.stock.doctype.material_request.material_request.make_stock_entry",
    { material_request_id: name },
  );
  const draft = (await extractMappedDoc(mapped)) as Record<string, unknown> & {
    doctype?: string;
    items?: Array<Record<string, unknown>>;
  };
  draft.doctype = "Stock Entry";

  // For partial issues, filter/adjust the items table in the draft stock entry
  if (options?.partial && draft && Array.isArray(draft.items)) {
    const adjustedItems = [];
    for (const item of draft.items) {
      const stockLine = stockCheck.lines.find(
        (l) => l.item_code === item.item_code,
      );
      const available = stockLine ? stockLine.available_qty : 0;
      if (available > 0) {
        const requested = Number(item.qty) || 0;
        const issueQty = Math.min(requested, available);
        item.qty = issueQty;
        item.transfer_qty = issueQty;
        adjustedItems.push(item);
      }
    }
    if (adjustedItems.length === 0) {
      throw new Error("No items have available stock to issue.");
    }
    draft.items = adjustedItems;
  }

  const saved = await apiPost<any>(
    "/api/method/frappe.client.save",
    { doc: draft },
  );
  const stockEntryName = saved.name;
  if (!stockEntryName) {
    throw new Error("Stock Entry was not created.");
  }

  await apiPost("/api/method/frappe.client.submit", {
    doc: saved,
  });

  const mr = await updateMaterialRequestWorkflowStatus(
    name,
    "Material Issued",
    {
      custom_warehouse_remarks: options?.warehouse_remarks,
    },
  );

  return { stock_entry: stockEntryName, mr };
}

export interface WarehouseReviewRecord {
  doctype?: "Warehouse Review";
  name?: string;
  material_request: string;
  warehouse_remarks?: string;
  decision: "Material Issued" | "Partially Issued" | "Forwarded to Procurement" | "Rejected";
  issued_qty?: number;
  remaining_qty?: number;
  forwarded_qty?: number;
  review_date?: string;
  warehouse_user?: string;
}

export async function createWarehouseReview(
  review: WarehouseReviewRecord,
): Promise<WarehouseReviewRecord | null> {
  try {
    // eslint-disable-next-line no-console
    console.log("[Warehouse Review Saved]", {
      material_request: review.material_request,
      decision: review.decision,
      issued_qty: review.issued_qty,
      remaining_qty: review.remaining_qty,
      forwarded_qty: review.forwarded_qty,
      warehouse_remarks: review.warehouse_remarks,
      review_date: todayERPNextDate(),
    });
    const res = await apiPost<WarehouseReviewRecord>(
      "/api/method/frappe.client.save",
      {
        doc: {
          doctype: "Warehouse Review",
          review_date: todayERPNextDate(),
          ...review,
        },
      },
    );
    return res;
  } catch (err) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn("[createWarehouseReview] Note: Warehouse Review post skipped:", err);
    }
    return null;
  }
}

/**
 * Warehouse stock-check outcome: all requested items are available. Moves the
 * MR to "Stock Available", which is what enables the Issue Material action.
 * Persisted in ERPNext so the enabled/disabled state survives refresh and is
 * consistent across devices/reviewers.
 */
export async function markMaterialRequestStockAvailable(
  name: string,
  warehouseRemarks?: string,
): Promise<MaterialRequestWorkflowRecord> {
  return updateMaterialRequestWorkflowStatus(name, "Stock Available", {
    custom_warehouse_remarks: warehouseRemarks,
  });
}

/**
 * Final closure of a fully-fulfilled request. Reached after material has been
 * issued (and, for procurement, after goods are received) — this is the
 * terminal "Completed" state on the dashboard.
 */
export async function completeMaterialRequest(
  name: string,
  remarks?: string,
): Promise<MaterialRequestWorkflowRecord> {
  return updateMaterialRequestWorkflowStatus(name, "Completed", {
    custom_warehouse_remarks: remarks,
  });
}

export async function forwardMaterialRequestToProcurement(
  name: string,
  warehouseRemarks?: string,
): Promise<MaterialRequestWorkflowRecord> {
  // eslint-disable-next-line no-console
  console.log("[Material Request Forwarded]", {
    mr: name,
    status: "Procurement Required",
    warehouseRemarks,
    timestamp: new Date().toISOString(),
  });
  await updateMaterialRequestWorkflowStatus(
    name,
    "Procurement Required",
    {
      custom_warehouse_remarks: warehouseRemarks,
    },
  );
  // `decision` is the Warehouse Review audit DocType's own Select field — its
  // options are independent of the MR workflow status, so it keeps its legacy
  // label to avoid a DocType schema change.
  await createWarehouseReview({
    material_request: name,
    warehouse_remarks: warehouseRemarks,
    decision: "Forwarded to Procurement",
  });
  return fetchMaterialRequestWorkflow(name);
}

export async function rejectMaterialRequest(
  name: string,
  warehouseRemarks?: string,
): Promise<MaterialRequestWorkflowRecord> {
  const result = await updateMaterialRequestWorkflowStatus(name, "Cancelled", {
    custom_warehouse_remarks: warehouseRemarks,
  });
  await createWarehouseReview({
    material_request: name,
    warehouse_remarks: warehouseRemarks,
    decision: "Rejected",
  });
  return result;
}

export async function markMaterialRequestRfqCreated(
  name: string,
  rfqName: string,
  procurementRemarks?: string,
): Promise<MaterialRequestWorkflowRecord> {
  return updateMaterialRequestWorkflowStatus(name, "RFQ Created", {
    custom_linked_rfq: rfqName,
    custom_procurement_remarks: procurementRemarks,
  });
}

/* ─── Warehouse decision helpers ─────────────────────────────────────────── */

export type WarehouseItemDecisionStatus =
  "Pending Review" | "Issued" | "Partially Issued" | "Forwarded to Procurement";

export interface WarehouseItemDecision {
  item_code: string;
  item_name: string;
  uom: string;
  warehouse: string;
  requested_qty: number;
  available_qty: number;
  shortage_qty: number;
  /** Qty to issue from stock. */
  issue_qty: number;
  /** Qty to forward to procurement. */
  forward_qty: number;
  status: WarehouseItemDecisionStatus;
}

export interface ProcessWarehouseDecisionResult {
  /** Set if any stock was issued. */
  stock_entry?: string;
  /** Items with forward_qty > 0. */
  forwarded_items: WarehouseItemDecision[];
  mr: MaterialRequestWorkflowRecord;
  overall_status:
    "Material Issued" | "Partially Issued" | "Forwarded to Procurement";
}

export function buildWarehouseDecisions(
  stockCheck: MaterialRequestStockCheck,
  mrItems: Array<{ item_code: string; item_name?: string; uom?: string }>,
): WarehouseItemDecision[] {
  return stockCheck.lines.map((line) => {
    const meta = mrItems.find((i) => i.item_code === line.item_code);
    const requested_qty = line.required_qty;
    const available_qty = line.available_qty;
    const issue_qty = Math.min(available_qty, requested_qty);
    const forward_qty = Math.max(0, requested_qty - available_qty);
    const shortage_qty = Math.max(0, requested_qty - available_qty);

    let status: WarehouseItemDecisionStatus;
    if (available_qty >= requested_qty) {
      status = "Issued";
    } else if (available_qty > 0) {
      status = "Partially Issued";
    } else {
      status = "Forwarded to Procurement";
    }

    return {
      item_code: line.item_code,
      item_name: meta?.item_name ?? line.item_code,
      uom: meta?.uom ?? line.uom ?? "Nos",
      warehouse: line.warehouse,
      requested_qty,
      available_qty,
      shortage_qty,
      issue_qty,
      forward_qty,
      status,
    };
  });
}

export async function processWarehouseDecisions(
  mrName: string,
  warehouseRemarks?: string,
): Promise<ProcessWarehouseDecisionResult> {
  const [stockCheck, mr] = await Promise.all([
    checkMaterialRequestStock(mrName),
    fetchMaterialRequestWorkflow(mrName),
  ]);

  const decisions = buildWarehouseDecisions(stockCheck, mr.items ?? []);
  const hasAnyStock = decisions.some((d) => d.issue_qty > 0);
  const hasAnyShortage = decisions.some((d) => d.forward_qty > 0);
  const forwarded_items = decisions.filter((d) => d.forward_qty > 0);

  // Case 1: All in stock (no shortages)
  if (hasAnyStock && !hasAnyShortage) {
    const result = await issueMaterialRequest(mrName, {
      warehouse_remarks: warehouseRemarks,
    });
    await createWarehouseReview({
      material_request: mrName,
      warehouse_remarks: warehouseRemarks,
      decision: "Material Issued",
      issued_qty: decisions.reduce((acc, d) => acc + d.issue_qty, 0),
    });
    return {
      stock_entry: result.stock_entry,
      forwarded_items: [],
      mr: result.mr,
      overall_status: "Material Issued",
    };
  }

  // Case 2: Partial stock (some items have stock, some don't)
  if (hasAnyStock && hasAnyShortage) {
    const mapped = await apiPost<unknown>(
      "/api/method/erpnext.stock.doctype.material_request.material_request.make_stock_entry",
      { material_request_id: mrName },
    );
    const draft = (await extractMappedDoc(mapped)) as Record<
      string,
      unknown
    > & {
      doctype?: string;
      name?: string;
      items?: Array<Record<string, unknown>>;
    };
    draft.doctype = "Stock Entry";

    if (Array.isArray(draft.items)) {
      draft.items = draft.items
        .map((item) => {
          const decision = decisions.find(
            (d) => d.item_code === (item.item_code as string),
          );
          if (!decision || decision.issue_qty <= 0) return null;
          item.qty = decision.issue_qty;
          item.transfer_qty = decision.issue_qty;
          return item;
        })
        .filter((item): item is Record<string, unknown> => item !== null);
    }

    const saved = await apiPost<any>(
      "/api/method/frappe.client.save",
      { doc: draft },
    );
    const savedName = saved.name;
    if (!savedName) {
      throw new Error("Partial Stock Entry was not created.");
    }

    await apiPost("/api/method/frappe.client.submit", {
      doc: saved,
    });

    const forwardingData = JSON.stringify(
      forwarded_items.map((d) => ({
        item_code: d.item_code,
        item_name: d.item_name,
        requested_qty: d.requested_qty,
        issued_qty: d.issue_qty,
        forward_qty: d.forward_qty,
        uom: d.uom,
        warehouse: d.warehouse,
      })),
    );
    const remarkParts: string[] = [];
    if (warehouseRemarks) remarkParts.push(warehouseRemarks);
    remarkParts.push(`[BidSphere:PartialIssue:${savedName}]`);
    remarkParts.push(`[BidSphere:ForwardedItems:${forwardingData}]`);
    const warehouseRemarksBlock = remarkParts.join("\n");

    await updateMaterialRequestWorkflowStatus(mrName, "Procurement Required", {
      custom_warehouse_remarks: warehouseRemarksBlock,
    });
    await createWarehouseReview({
      material_request: mrName,
      warehouse_remarks: warehouseRemarksBlock,
      decision: "Partially Issued",
      issued_qty: decisions.reduce((acc, d) => acc + d.issue_qty, 0),
      forwarded_qty: decisions.reduce((acc, d) => acc + d.forward_qty, 0),
    });

    const freshMr = await fetchMaterialRequestWorkflow(mrName);
    return {
      stock_entry: savedName,
      forwarded_items,
      mr: freshMr,
      overall_status: "Partially Issued",
    };
  }

  // Case 3: No stock at all
  const forwardingData = JSON.stringify(
    forwarded_items.map((d) => ({
      item_code: d.item_code,
      item_name: d.item_name,
      requested_qty: d.requested_qty,
      issued_qty: 0,
      forward_qty: d.requested_qty,
      uom: d.uom,
      warehouse: d.warehouse,
    })),
  );
  const remarkParts: string[] = [];
  if (warehouseRemarks) remarkParts.push(warehouseRemarks);
  remarkParts.push(`[BidSphere:ForwardedItems:${forwardingData}]`);
  const remarksBlock = remarkParts.join("\n");

  const forwardedMr = await forwardMaterialRequestToProcurement(
    mrName,
    remarksBlock,
  );
  return {
    stock_entry: undefined,
    forwarded_items,
    mr: forwardedMr,
    overall_status: "Forwarded to Procurement",
  };
}

export function parseForwardedItemsFromMr(
  mr: MaterialRequestWorkflowRecord,
): WarehouseItemDecision[] {
  // Look for [BidSphere:ForwardedItems:...] in custom_warehouse_remarks or remarks
  const raw = mr.custom_warehouse_remarks ?? mr.remarks ?? "";
  const match = raw.match(/\[BidSphere:ForwardedItems:(\[.*?\])\]/s);
  if (!match) return [];
  try {
    return JSON.parse(match[1]) as WarehouseItemDecision[];
  } catch {
    return [];
  }
}

/**
 * Fetches Procurement Queue records from live ERPNext data.
 * Displays ONLY Material Requests where:
 * 1. Status = "Procurement Required"
 * 2. Remaining Qty > 0
 * 3. RFQ not yet created
 *
 * Includes comprehensive debug logging for query execution, returned MR IDs,
 * and exact diagnostic reasons if 0 records are returned.
 */
export async function fetchProcurementQueue(): Promise<MaterialRequestWorkflowRecord[]> {
  console.log(
    "[Procurement Queue Query] Executing query for statuses:",
    PROCUREMENT_QUEUE_STATUSES,
  );

  const allSubmitted = await listMaterialRequestsWorkflow({
    limit: 500,
    docstatus: 1,
  });

  // Eligible = forwarded-to-procurement through RFQ-created (until Completed).
  // RFQ-created MRs are KEPT in the queue so Procurement can track them and see
  // "View RFQ"; only Completed/Cancelled/stock-path statuses drop out (they are
  // never in PROCUREMENT_QUEUE_STATUSES).
  const forwardedDocs = allSubmitted.filter((doc) =>
    PROCUREMENT_QUEUE_STATUSES.includes(getMaterialRequestWorkflowStatus(doc)),
  );

  console.log("[Procurement Queue Query] Submitted MRs retrieved:", {
    totalSubmittedInERPNext: allSubmitted.length,
    eligibleCount: forwardedDocs.length,
    eligibleMRs: forwardedDocs.map((d) => ({
      name: d.name,
      status: getMaterialRequestWorkflowStatus(d),
    })),
  });

  if (forwardedDocs.length === 0) {
    const statusesFound = Array.from(
      new Set(allSubmitted.map((d) => getMaterialRequestWorkflowStatus(d))),
    );
    console.warn(
      "[Procurement Queue Debug] 0 records returned. No MRs match the eligible statuses.",
      {
        eligibleStatuses: PROCUREMENT_QUEUE_STATUSES,
        totalSubmittedMRs: allSubmitted.length,
        statusesFoundInDB: statusesFound,
        sampleMRs: allSubmitted.slice(0, 5).map((m) => ({
          name: m.name,
          status: m.status,
          custom_bidsphere_status: m.custom_bidsphere_status,
          workflowStatus: getMaterialRequestWorkflowStatus(m),
        })),
      },
    );
    return [];
  }

  // Fetch full details (items child table + custom_warehouse_remarks) so the
  // grouped shortage view and RFQ prefill have everything they need.
  const detailedDocs = await Promise.all(
    forwardedDocs.map(async (doc) => {
      try {
        return await fetchMaterialRequestWorkflow(doc.name);
      } catch {
        return doc;
      }
    }),
  );

  // Keep every eligible MR. We no longer exclude RFQ-linked records (they show
  // "View RFQ"); we only drop the degenerate case of a forwarded MR that has
  // no line items and no forwarded shortage qty at all — there is nothing to
  // procure or display.
  const queue = detailedDocs.filter((mr) => {
    const forwardedItems = parseForwardedItemsFromMr(mr);
    if (forwardedItems.length > 0) {
      return forwardedItems.some(
        (fi) => (fi.forward_qty ?? 0) > 0 || (fi.shortage_qty ?? 0) > 0,
      );
    }
    return (mr.items ?? []).some((i) => (Number(i.qty) || 0) > 0);
  });

  console.log("[Procurement Queue Query] Query executed successfully.", {
    eligibleStatuses: PROCUREMENT_QUEUE_STATUSES,
    totalEligible: forwardedDocs.length,
    returnedCount: queue.length,
    mrIDsReturned: queue.map((mr) => ({
      name: mr.name,
      status: getMaterialRequestWorkflowStatus(mr),
      linkedRfq: mr.custom_linked_rfq ?? null,
    })),
  });

  return queue;
}

/* ─── Dashboard aggregates ───────────────────────────────────────────────── */

export async function fetchMaterialRequestDashboardCounts(role: {
  email?: string;
  name?: string;
  fullName?: string;
  isDepartmentUser?: boolean;
  isWarehouse?: boolean;
  isProcurement?: boolean;
}) {
  const today = todayERPNextDate();
  const identity = {
    email: role.email,
    name: role.name,
    fullName: role.fullName,
  };

  // Submitted docs only — drafts are not actionable on warehouse/procurement dashboards.
  const all = await listMaterialRequestsWorkflow({ limit: 500, docstatus: 1 });
  const draftRows = role.isDepartmentUser
    ? await listMaterialRequestsWorkflow({ docstatus: 0, limit: 200 })
    : [];

  const statusOf = (m: MaterialRequestWorkflowRecord) =>
    getMaterialRequestWorkflowStatus(m);

  const byStatus = (s: MaterialRequestWorkflowStatus) =>
    all.filter((m) => statusOf(m) === s);

  const isIssued = (m: MaterialRequestWorkflowRecord) => {
    const st = statusOf(m);
    return st === "Material Issued" || st === "Completed";
  };

  const isWarehousePending = (m: MaterialRequestWorkflowRecord) =>
    WAREHOUSE_PENDING_STATUSES.includes(statusOf(m));

  const mine = all.filter((m) => isMaterialRequestOwnedByUser(m, identity));
  const myDrafts = draftRows.filter(
    (m) => statusOf(m) === "Draft" && isMaterialRequestOwnedByUser(m, identity),
  );

  if (import.meta.env.DEV) {
    console.log("[MR Dashboard] ERPNext dashboard source rows", {
      identity,
      submittedCount: all.length,
      draftCount: draftRows.length,
      matchedSubmitted: mine.length,
      matchedDrafts: myDrafts.length,
      submittedSample: all.slice(0, 5).map((m) => ({
        name: m.name,
        owner: m.owner,
        custom_requested_by: m.custom_requested_by,
        requested_by: m.requested_by,
        workflowStatus: statusOf(m),
      })),
    });
  }

  const counts = {
    myRequests: mine.length,
    myDrafts: myDrafts.length,
    mySubmitted: mine.filter((m) =>
      WAREHOUSE_PENDING_STATUSES.includes(statusOf(m)),
    ).length,
    myCompleted: mine.filter(isIssued).length,
    pendingWarehouseReview: all.filter(isWarehousePending).length,
    materialIssuedToday: all.filter((m) => {
      return isIssued(m) && (m.modified ?? "").startsWith(today);
    }).length,
    forwardedToProcurement: byStatus("Procurement Required").length,
    forwardedToday: all.filter((m) => {
      const st = statusOf(m);
      return (
        st === "Procurement Required" &&
        (m.modified ?? "").startsWith(today)
      );
    }).length,
    pendingProcurement: byStatus("Procurement Required").length,
    readyForRfq: byStatus("Procurement Required").length,
    rfqCreated: byStatus("RFQ Created").length,
  };

  if (import.meta.env.DEV) {
    console.log("[MR Dashboard] mapped dashboard counts", {
      identity,
      counts,
    });
  }

  logMrApi("processed", {
    context: role.isWarehouse
      ? "warehouse-dashboard"
      : role.isProcurement
        ? "procurement-dashboard"
        : role.isDepartmentUser
          ? "department-dashboard"
          : "dashboard",
    submittedMrCount: all.length,
    counts,
    warehouseQueue: all
      .filter(isWarehousePending)
      .map((m) => ({ name: m.name, status: statusOf(m) })),
  });

  return counts;
}
