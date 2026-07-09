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
  ADMIN_REVIEW_STATUSES,
  MR_PROCUREMENT_TYPE_FIELD,
  MR_WORKFLOW_FIELD,
  PROCUREMENT_QUEUE_STATUSES,
  normalizeWorkflowStatus,
  resolveProcurementType,
  toErpBidsphereStatus,
  type MaterialRequestPriority,
  type MaterialRequestProcurementType,
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
  "Admin Review",
  "Under Warehouse Review",
  "Stock Available",
  "Material Issued",
  "Procurement Required",
  "Forwarded to Procurement",
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
  procurement_type?: MaterialRequestProcurementType;
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
  "modified_by",
  "owner",
  "company",
  "material_request_type",
  "docstatus",
] as const;

/** Custom workflow fields — require scripts/setup-material-request-workflow.mjs */
const MR_CUSTOM_QUERY_FIELDS = [
  MR_WORKFLOW_FIELD,
  MR_PROCUREMENT_TYPE_FIELD,
  "custom_department",
  "custom_priority",
  "custom_purpose",
  "custom_warehouse_remarks",
  "custom_procurement_remarks",
  "custom_admin_remarks",
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

  // NOTE: this fallback only runs when `custom_bidsphere_status` is entirely
  // unavailable/unset (see `workflowStatus` below), so it has no visibility
  // into whether Warehouse has actually reviewed the request. A submitted MR
  // (any material_request_type) must therefore default to "Under Warehouse
  // Review" — the real, persisted "Procurement Required" transition is only
  // ever written by the warehouse "no stock" / "Send to Procurement" actions
  // (see `buildWarehouseDecisions` / `forwardMaterialRequestToProcurement`).
  // Previously this branch jumped a freshly-submitted "Purchase" type MR
  // straight to "Procurement Required", skipping warehouse review entirely.
  if (doc.material_request_type === "Purchase") {
    if (linkedRfqFromDoc(doc)) return "RFQ Created";
    if (docstatus === 1) return "Under Warehouse Review";
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

/**
 * Resolve the procurement type (Direct / Indirect) of a Material Request.
 * Records created before this feature have no `custom_procurement_type` and are
 * treated as Direct so the legacy warehouse-first flow keeps working.
 */
export function getMaterialRequestProcurementType(
  doc: MaterialRequestWorkflowRecord,
): MaterialRequestProcurementType {
  return resolveProcurementType(doc[MR_PROCUREMENT_TYPE_FIELD]);
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

/**
 * Warehouse review queue — submitted Material Requests pending warehouse action.
 * Only DIRECT procurement requests reach the warehouse; Indirect requests are
 * gated by Admin approval and never appear here.
 *
 * IMPORTANT: do NOT hard-filter by `material_request_type`. Legacy/ERP-created
 * requests may be `"Purchase"` while still legitimately entering the warehouse
 * stage ("Under Warehouse Review"). Filtering to `"Material Issue"` causes
 * Department dashboards to show the request while Warehouse queues return none.
 */
export async function listWarehouseMaterialRequestQueue(
  limit = 100,
): Promise<MaterialRequestWorkflowRecord[]> {
  const rows = await listMaterialRequestsWorkflow({
    docstatus: 1,
    workflowStatus: WAREHOUSE_PENDING_STATUSES,
    limit,
  });
  return rows.filter(
    (mr) => getMaterialRequestProcurementType(mr) === "Direct",
  );
}

/**
 * Admin approval queue — submitted INDIRECT Material Requests awaiting admin
 * review. This is the gate that must pass before an Indirect MR reaches
 * Procurement. Live ERPNext data, no mock records.
 */
export async function listAdminReviewQueue(
  limit = 200,
): Promise<MaterialRequestWorkflowRecord[]> {
  const rows = await listMaterialRequestsWorkflow({
    docstatus: 1,
    workflowStatus: ADMIN_REVIEW_STATUSES,
    limit,
  });
  return rows.filter(
    (mr) => getMaterialRequestProcurementType(mr) === "Indirect",
  );
}

/**
 * Admin approves an Indirect Material Request. Indirect requests have no
 * warehouse-owned "Procurement Required" stage (there's no stock review) —
 * approval itself IS the forward action, so this writes "Forwarded to
 * Procurement" directly (plus the same forwarded_by/forwarded_on audit fields
 * `forwardMaterialRequestToProcurement` writes for the Direct path), which is
 * where the RFQ flow begins — identical to the direct path once a request is
 * with Procurement.
 */
export async function approveIndirectMaterialRequest(
  name: string,
  adminRemarks?: string,
): Promise<MaterialRequestWorkflowRecord> {
  const result = await updateMaterialRequestWorkflowStatus(
    name,
    "Forwarded to Procurement",
    { custom_admin_remarks: adminRemarks },
  );
  await writeForwardMetadata(
    name,
    result.modified_by || result.owner || "Admin",
    new Date().toISOString(),
  );
  return result;
}

/**
 * Admin rejects an Indirect Material Request. It returns to the requester as a
 * cancelled request with the admin's reason recorded.
 */
export async function rejectIndirectMaterialRequest(
  name: string,
  adminRemarks?: string,
): Promise<MaterialRequestWorkflowRecord> {
  return updateMaterialRequestWorkflowStatus(name, "Cancelled", {
    custom_admin_remarks: adminRemarks,
  });
}

/**
 * In-flight create dedupe. If the same create payload is requested while a
 * previous create is still pending (double-click / double mutate), reuse the
 * same Promise instead of POSTing a second Material Request to ERPNext.
 */
const inflightCreates = new Map<string, Promise<MaterialRequestWorkflowRecord>>();

function buildCreateDedupeKey(input: CreateMaterialRequestWorkflowInput): string {
  const itemsKey = (input.items ?? [])
    .map((row) =>
      [
        row.item_code,
        String(row.qty),
        row.uom ?? "",
        row.warehouse ?? "",
        row.schedule_date ?? "",
      ].join(":"),
    )
    .sort()
    .join("|");
  return [
    input.company ?? COMPANY,
    input.transaction_date ?? "",
    input.schedule_date ?? "",
    input.department ?? "",
    input.procurement_type ?? "Direct",
    input.priority ?? "",
    input.purpose ?? "",
    input.requested_by ?? "",
    input.remarks ?? "",
    itemsKey,
  ].join("::");
}

export async function createMaterialRequestWorkflow(
  input: CreateMaterialRequestWorkflowInput,
): Promise<MaterialRequestWorkflowRecord> {
  const dedupeKey = buildCreateDedupeKey(input);
  const existing = inflightCreates.get(dedupeKey);
  if (existing) {
    logMrApi("request", {
      action: "create",
      deduped: true,
      message: "Reusing in-flight create — blocked duplicate POST",
    });
    return existing;
  }

  const createPromise = (async () => {
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

    logMrApi("request", {
      action: "create",
      deduped: false,
      itemCount: payload.items.length,
      department: input.department,
      procurement_type: input.procurement_type ?? "Direct",
    });

    const created = await createMaterialRequest(payload);
    const updates: Record<string, unknown> = {
      [MR_WORKFLOW_FIELD]: toErpBidsphereStatus("Draft"),
      // Every MR is classified at creation. Defaults to Direct when the caller
      // doesn't supply a type, preserving the legacy warehouse-first behaviour.
      [MR_PROCUREMENT_TYPE_FIELD]: input.procurement_type ?? "Direct",
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

    const result = await fetchMaterialRequestWorkflow(created.name);
    logMrApi("processed", {
      action: "create",
      name: result.name,
      workflowStatus: getMaterialRequestWorkflowStatus(result),
    });
    return result;
  })();

  inflightCreates.set(dedupeKey, createPromise);
  try {
    return await createPromise;
  } finally {
    inflightCreates.delete(dedupeKey);
  }
}

/**
 * Department submits the Material Request. This submits the ERPNext document
 * (docstatus 0 → 1, so it leaves the Draft state permanently) and routes it by
 * procurement type — the status is the assignment mechanism that queues and
 * dashboards filter on, so the request appears for the right team on any device:
 *   • Direct   → "Under Warehouse Review" (warehouse stock check first).
 *   • Indirect → "Admin Review" (admin approval gate, bypasses warehouse).
 * Persisted entirely in ERPNext, so it survives refresh and logout.
 */
export async function submitMaterialRequestWorkflow(
  name: string,
): Promise<MaterialRequestWorkflowRecord> {
  const endpoint = buildResourceUrl(MR_DOCTYPE, name);
  const fresh = await apiGet<MaterialRequestWorkflowRecord>(endpoint);
  const modified =
    (fresh as { modified?: string }).modified ??
    (fresh as { data?: { modified?: string } }).data?.modified;

  const procurementType = getMaterialRequestProcurementType(fresh);
  const targetStatus: MaterialRequestWorkflowStatus =
    procurementType === "Indirect" ? "Admin Review" : "Under Warehouse Review";

  const payload: Record<string, unknown> = {
    docstatus: 1,
    [MR_WORKFLOW_FIELD]: toErpBidsphereStatus(targetStatus),
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

  const saved = await apiPost<{ name?: string } & Record<string, unknown>>(
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

export interface ForwardToProcurementOptions {
  /** Human/email of the warehouse user performing the forward (audit). */
  forwardedBy?: string;
  /**
   * Skip the stock-shortage validation. Used by the full warehouse-review flow
   * (`processWarehouseDecisions`), which has already computed the shortage.
   */
  skipStockCheck?: boolean;
}

/** ERPNext datetime (`YYYY-MM-DD HH:MM:SS`) from an ISO timestamp. */
function toErpDateTime(iso: string): string {
  return iso.replace("T", " ").slice(0, 19);
}

/**
 * Best-effort structured forward metadata. Persists the who/when flags on the
 * MR only if those custom fields exist in ERPNext; a missing-field failure is
 * swallowed because the canonical audit lives in the `[BidSphere:Forwarded:…]`
 * remarks tag + the Warehouse Review record.
 */
async function writeForwardMetadata(
  name: string,
  forwardedBy: string,
  forwardedOn: string,
): Promise<void> {
  try {
    await apiPost(
      "/api/method/frappe.client.set_value",
      {
        doctype: MR_DOCTYPE,
        name,
        fieldname: {
          custom_forwarded_to_procurement: 1,
          custom_forwarded_by: forwardedBy,
          custom_forwarded_on: toErpDateTime(forwardedOn),
        },
      },
      withSilent(),
    );
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn(
        "[MR forward] optional forward-metadata fields not persisted:",
        err,
      );
    }
  }
}

/** Immutable Activity Log entry recording a forward-to-procurement action. */
async function recordForwardAudit(audit: {
  mr_name: string;
  forwarded_by: string;
  forwarded_on: string;
}): Promise<void> {
  try {
    await apiPost(
      "/api/method/frappe.client.insert",
      {
        doc: {
          doctype: "Activity Log",
          subject: `Material Request ${audit.mr_name} forwarded to Procurement by ${audit.forwarded_by}`,
          content: [
            `MR Number: ${audit.mr_name}`,
            `Status: Procurement Required`,
            `Forwarded By: ${audit.forwarded_by}`,
            `Forwarded On: ${audit.forwarded_on}`,
          ].join("\n"),
          operation: "Update",
          status: "Success",
          reference_doctype: MR_DOCTYPE,
          reference_name: audit.mr_name,
          user: audit.forwarded_by,
        },
      },
      withSilent(),
    );
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn("[MR forward] Activity Log audit insert skipped:", err);
    }
  }
}

/**
 * Forward a reviewed Material Request with insufficient stock to Procurement.
 *
 * Backend validation (enforced regardless of the UI):
 *   • the MR must be submitted (`docstatus = 1`);
 *   • it must NOT already be forwarded (status Forwarded to Procurement / RFQ
 *     Created / Completed) — prevents double-forwarding. Forwarding is valid
 *     from "Procurement Required" (warehouse already reviewed and recorded the
 *     shortage) OR directly from "Under Warehouse Review" (the dashboard
 *     quick-action path, which re-verifies the shortage via a live stock
 *     check below);
 *   • stock review must show a genuine shortage (unless `skipStockCheck`).
 *
 * On success it moves the MR to "Forwarded to Procurement" (which removes it
 * from the warehouse queue and surfaces it in the Procurement queue), sets
 * `custom_forwarded_to_procurement = 1` + `custom_forwarded_by` +
 * `custom_forwarded_on`, records the Warehouse Review + Activity Log audit,
 * and returns the refreshed record.
 */
export async function forwardMaterialRequestToProcurement(
  name: string,
  warehouseRemarks?: string,
  options?: ForwardToProcurementOptions,
): Promise<MaterialRequestWorkflowRecord> {
  const current = await fetchMaterialRequestWorkflow(name);

  // 1 — must be submitted.
  if ((current.docstatus ?? 0) !== 1) {
    throw new Error(
      "This Material Request must be submitted before it can be sent to Procurement.",
    );
  }

  // 2 — prevent double-forwarding. "Procurement Required" is the expected
  // PRE-forward state (warehouse reviewed, shortage recorded, not yet sent) —
  // it must NOT be treated as already-forwarded, or every genuine "Send to
  // Procurement" click would fail with a false "already forwarded" error.
  const currentStatus = getMaterialRequestWorkflowStatus(current);
  if (
    currentStatus === "Forwarded to Procurement" ||
    currentStatus === "RFQ Created" ||
    currentStatus === "Completed"
  ) {
    throw new Error(
      `Material Request ${name} has already been forwarded to Procurement.`,
    );
  }

  // 3 — stock review must show a real shortage.
  if (!options?.skipStockCheck) {
    const stock = await checkMaterialRequestStock(name);
    if (stock.lines.length === 0) {
      throw new Error(
        "Stock review is incomplete. Complete the warehouse review before forwarding.",
      );
    }
    if (stock.all_sufficient) {
      throw new Error(
        "All items are in stock — issue the material instead of forwarding to Procurement.",
      );
    }
  }

  const forwardedBy =
    options?.forwardedBy?.trim() || current.owner || "Warehouse";
  const forwardedOn = new Date().toISOString();

   
  console.log("[Warehouse] Forwarded MR:", {
    mr: name,
    forwardedBy,
    forwardedOn,
    warehouseRemarks,
  });

  // Embed a machine-readable forward audit tag so who/when survives even when
  // the dedicated custom fields aren't provisioned in ERPNext. IMPORTANT: when
  // the caller doesn't pass fresh remarks (e.g. the dashboard/queue "Send to
  // Procurement" quick action), fall back to the MR's EXISTING
  // custom_warehouse_remarks rather than blanking it — that field carries the
  // `[BidSphere:ForwardedItems:...]` shortage snapshot the warehouse recorded
  // during review, which `parseForwardedItemsFromMr` (and the RFQ prefill)
  // depend on. Overwriting it here previously wiped that snapshot, causing the
  // RFQ to silently fall back to the MR's full original item quantities.
  const baseRemarks =
    warehouseRemarks ?? current.custom_warehouse_remarks ?? current.remarks ?? "";
  const remarkParts: string[] = [];
  if (baseRemarks) remarkParts.push(baseRemarks);
  if (!/\[BidSphere:Forwarded:/.test(baseRemarks)) {
    remarkParts.push(`[BidSphere:Forwarded:${forwardedBy}|${forwardedOn}]`);
  }
  const remarksBlock = remarkParts.join("\n");

  const saved = await updateMaterialRequestWorkflowStatus(
    name,
    "Forwarded to Procurement",
    { custom_warehouse_remarks: remarksBlock || undefined },
  );

   
  console.log("[Warehouse] Status saved:", {
    mr: name,
    storedStatus: saved[MR_WORKFLOW_FIELD] ?? null,
    resolvedStatus: getMaterialRequestWorkflowStatus(saved),
    forwarded_to_procurement: 1,
    forwarded_at: forwardedOn,
    forwarded_by: forwardedBy,
  });

  // Best-effort structured metadata (optional fields) — never blocks the move.
  await writeForwardMetadata(name, forwardedBy, forwardedOn);

  // `decision` is the Warehouse Review audit DocType's own Select field — its
  // options are independent of the MR workflow status, so it keeps its legacy
  // label to avoid a DocType schema change.
  await createWarehouseReview({
    material_request: name,
    warehouse_remarks: remarksBlock,
    decision: "Forwarded to Procurement",
    warehouse_user: forwardedBy,
  });
  await recordForwardAudit({
    mr_name: name,
    forwarded_by: forwardedBy,
    forwarded_on: forwardedOn,
  });

  const result = await fetchMaterialRequestWorkflow(name);
   
  console.log("[Warehouse] Response:", {
    mr: result.name,
    resolvedStatus: getMaterialRequestWorkflowStatus(result),
    success: true,
  });
  return result;
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
  const result = await updateMaterialRequestWorkflowStatus(name, "RFQ Created", {
    custom_linked_rfq: rfqName,
    custom_procurement_remarks: procurementRemarks,
  });
  // Best-effort optional field — never blocks RFQ creation if unprovisioned.
  try {
    await apiPost(
      "/api/method/frappe.client.set_value",
      {
        doctype: MR_DOCTYPE,
        name,
        fieldname: { custom_rfq_created_at: toErpDateTime(new Date().toISOString()) },
      },
      withSilent(),
    );
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn("[MR RFQ] optional custom_rfq_created_at not persisted:", err);
    }
  }
  return result;
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
  /**
   * Qty already issued from stock, as persisted in the forwarded-items JSON
   * (`[BidSphere:ForwardedItems:...]`). Present on parsed forwarded items.
   */
  issued_qty?: number;
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
    "Material Issued" | "Partially Issued" | "Procurement Required";
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

    const saved = await apiPost<{ name?: string } & Record<string, unknown>>(
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

  // Case 3: No stock at all. Record the shortage as "Procurement Required"
  // ONLY — this does NOT forward the MR to Procurement. The warehouse must
  // still take the separate, explicit "Send to Procurement" action
  // (`forwardMaterialRequestToProcurement`) before Procurement can see it.
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

  await updateMaterialRequestWorkflowStatus(mrName, "Procurement Required", {
    custom_warehouse_remarks: remarksBlock,
  });
  await createWarehouseReview({
    material_request: mrName,
    warehouse_remarks: remarksBlock,
    decision: "Forwarded to Procurement",
    forwarded_qty: forwarded_items.reduce((acc, d) => acc + d.requested_qty, 0),
  });

  const freshMr = await fetchMaterialRequestWorkflow(mrName);
  return {
    stock_entry: undefined,
    forwarded_items,
    mr: freshMr,
    overall_status: "Procurement Required",
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
 * ERPNext STORED values of `custom_bidsphere_status` that mean "this MR has been
 * forwarded to Procurement" (through RFQ creation, up to but excluding
 * Completed). Includes the canonical write value ("Forwarded to Procurement" —
 * see UI_TO_ERP_STATUS) plus every legacy alias, so a targeted server-side
 * query catches historical records too. This is the reliable forwarded marker
 * and is queried directly (not via the generic list path, whose custom-field
 * inclusion is gated by a session-global fallback flag).
 *
 * "Procurement Required" is intentionally EXCLUDED — it is the pre-forward
 * state (warehouse reviewed, shortage recorded, "Send to Procurement" not yet
 * clicked) and must never be treated as forwarded.
 */
const FORWARDED_ERP_STATUS_VALUES = [
  "Forwarded to Procurement",
  "Procurement Review",
  "Procurement Pending",
  "RFQ Pending",
  "RFQ Requested",
  "RFQ Created",
] as const;

/**
 * Server-side query for forwarded MRs, filtered on a specific custom field.
 * Returns [] (never throws) when the field isn't queryable so the caller can
 * fall back to the client-side status scan. Requests full fields so downstream
 * status resolution always has `custom_bidsphere_status` + remarks available.
 */
async function fetchForwardedMrsByField(
  filter: Filter,
): Promise<MaterialRequestWorkflowRecord[]> {
  try {
    const rows = await apiGet<MaterialRequestWorkflowRecord[]>(
      buildResourceUrl(MR_DOCTYPE),
      withSilent(
        buildListConfig({
          fields: MR_LIST_FIELDS_FULL,
          filters: [["docstatus", "=", 1], filter],
          order_by: "modified desc",
          limit_page_length: 500,
        }),
      ),
    );
    return rows ?? [];
  } catch (err) {
    if (isQueryFieldError(err)) return [];
    // A non-field error (permission/network) also degrades to the scan fallback.
    if (import.meta.env.DEV) {
      console.warn("[Procurement Queue] targeted forwarded query failed:", err);
    }
    return [];
  }
}

/**
 * Fetches Procurement Queue records from live ERPNext data — every Material
 * Request that has been forwarded to Procurement (status "Procurement Required"
 * through "RFQ Created", up to but excluding Completed/Cancelled).
 *
 * Eligibility is resolved from the UNION of three reliable sources so a
 * forwarded MR can never be silently dropped:
 *   1. Server-side query on the stored `custom_bidsphere_status` forwarded
 *      values (the canonical marker written by the forward action).
 *   2. Server-side query on `custom_forwarded_to_procurement = 1` (best-effort
 *      structured flag).
 *   3. Client-side scan of all submitted MRs whose resolved workflow status is
 *      in PROCUREMENT_QUEUE_STATUSES (covers Purchase-type / standard-field
 *      resolution and any legacy value).
 *
 * Results are de-duped by name, hydrated with full detail, item-filtered, and
 * sorted newest-forwarded-first. Includes dev diagnostics for the query, the
 * applied filters, and the final displayed list.
 */
export async function fetchProcurementQueue(): Promise<MaterialRequestWorkflowRecord[]> {
  console.log("[Procurement] Loading forwarded requests...", {
    filters: {
      storedStatusValues: FORWARDED_ERP_STATUS_VALUES,
      forwardedFlag: "custom_forwarded_to_procurement = 1",
      resolvedStatuses: PROCUREMENT_QUEUE_STATUSES,
    },
  });

  // Run all three eligibility sources concurrently. Each degrades to [] on
  // failure so one weak source never blocks the queue.
  const [byStoredStatus, byForwardFlag, allSubmitted] = await Promise.all([
    fetchForwardedMrsByField([
      MR_WORKFLOW_FIELD,
      "in",
      [...FORWARDED_ERP_STATUS_VALUES],
    ]),
    fetchForwardedMrsByField(["custom_forwarded_to_procurement", "=", 1]),
    listMaterialRequestsWorkflow({ limit: 500, docstatus: 1 }).catch(
      () => [] as MaterialRequestWorkflowRecord[],
    ),
  ]);

  const byResolvedStatus = allSubmitted.filter((doc) =>
    PROCUREMENT_QUEUE_STATUSES.includes(getMaterialRequestWorkflowStatus(doc)),
  );

  // Union + de-dupe by MR name (keep the richest record for each name).
  const eligibleByName = new Map<string, MaterialRequestWorkflowRecord>();
  for (const doc of [...byStoredStatus, ...byForwardFlag, ...byResolvedStatus]) {
    if (doc?.name) eligibleByName.set(doc.name, doc);
  }
  const forwardedDocs = [...eligibleByName.values()];

  if (forwardedDocs.length === 0) {
    const statusesFound = Array.from(
      new Set(allSubmitted.map((d) => getMaterialRequestWorkflowStatus(d))),
    );
    console.warn(
      "[Procurement] Received 0 records. No MRs match any forwarded marker.",
      {
        forwardedStatusValues: FORWARDED_ERP_STATUS_VALUES,
        resolvedStatuses: PROCUREMENT_QUEUE_STATUSES,
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

  // A forwarded MR is ALWAYS returned. The only records dropped are truly
  // degenerate ones with no line items AND no forwarded-items snapshot — a real
  // MR can't hit this. NOTE: we deliberately do NOT filter on qty/shortage
  // being > 0 here — that hardcoded filter previously hid legitimately
  // forwarded MRs (req 4 & 8). Eligibility is decided solely by the forwarded
  // markers above.
  const queue = detailedDocs.filter((mr) => {
    const hasForwardedItems = parseForwardedItemsFromMr(mr).length > 0;
    const hasLineItems = (mr.items ?? []).length > 0;
    const keep = hasForwardedItems || hasLineItems;
    if (!keep) {
      console.warn(
        `[Procurement] Skipping ${mr.name} — no line items or forwarded-items snapshot.`,
      );
    }
    return keep;
  });

  // Newest forwarded first. `custom_forwarded_on` when the optional field is
  // provisioned; otherwise `modified` (the forward is the last write) is a
  // reliable proxy for forwarded_at.
  queue.sort((a, b) => {
    const at = a.custom_forwarded_on || a.modified || "";
    const bt = b.custom_forwarded_on || b.modified || "";
    return bt.localeCompare(at);
  });

  console.log(`[Procurement] Received ${queue.length} records`, {
    fromStoredStatus: byStoredStatus.length,
    fromForwardFlag: byForwardFlag.length,
    fromResolvedScan: byResolvedStatus.length,
    totalSubmittedScanned: allSubmitted.length,
    unionEligible: forwardedDocs.length,
    records: queue.map((mr) => ({
      name: mr.name,
      status: getMaterialRequestWorkflowStatus(mr),
      forwardedOn: mr.custom_forwarded_on ?? mr.modified ?? null,
      linkedRfq: mr.custom_linked_rfq ?? null,
    })),
  });

  return queue;
}

/* ─── Procurement → Ready to Issue reconciliation ────────────────────────── */

/**
 * Sum live on-hand stock (`Bin.actual_qty`) per item across the company's
 * warehouses in a single batched query. Cross-company bins are excluded so a
 * receipt into another company never counts. Never throws — an empty map means
 * "no stock found" so reconciliation simply won't advance any MR.
 */
async function fetchCompanyStockByItem(
  itemCodes: string[],
): Promise<Map<string, number>> {
  const stock = new Map<string, number>();
  const codes = [...new Set(itemCodes.filter(Boolean))];
  if (codes.length === 0) return stock;

  let warehouseNames: string[] = [];
  try {
    const list = await apiGet<Array<{ name?: string }>>(
      buildResourceUrl("Warehouse"),
      withSilent(
        buildListConfig({
          fields: ["name"],
          filters: [
            ["company", "=", COMPANY],
            ["is_group", "=", 0],
            ["disabled", "=", 0],
          ],
          limit_page_length: 500,
        }),
      ),
    );
    warehouseNames = (list ?? [])
      .map((w) => w.name)
      .filter((n): n is string => Boolean(n));
  } catch {
    // Fall through with no warehouse filter — better to over-count than to
    // wrongly leave an MR stuck in Procurement Required.
  }

  const filters: Filter[] = [["item_code", "in", codes]];
  if (warehouseNames.length > 0) filters.push(["warehouse", "in", warehouseNames]);

  let bins: Array<{ item_code?: string; actual_qty?: number }>;
  try {
    bins = await apiGet<Array<{ item_code?: string; actual_qty?: number }>>(
      buildResourceUrl("Bin"),
      withSilent(
        buildListConfig({
          fields: ["item_code", "actual_qty"],
          filters,
          limit_page_length: 2000,
        }),
      ),
    );
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn("[MR reconcile] Bin stock fetch failed:", err);
    }
    return stock;
  }

  for (const bin of bins ?? []) {
    if (!bin.item_code) continue;
    stock.set(
      bin.item_code,
      (stock.get(bin.item_code) ?? 0) + (Number(bin.actual_qty) || 0),
    );
  }
  return stock;
}

/**
 * Move procurement-path Material Requests to "Ready to Issue" once the goods
 * they forwarded have been received into the warehouse.
 *
 * Called after every Goods Receipt (Purchase Receipt) submission. For each
 * Material Issue MR still sitting in the procurement queue ("Procurement
 * Required" / "RFQ Created"), it compares the forwarded shortage quantities
 * against live ERPNext `Bin` stock. When on-hand stock now covers every
 * forwarded line, the MR is advanced to "Stock Available" — the status that
 * removes it from Procurement Required and lists it under Ready to Issue for
 * the warehouse team. No hardcoded quantities; stock is read live from `Bin`.
 *
 * Best-effort and non-fatal: any failure is logged and the receipt still
 * succeeds. Returns the names of the MRs that were advanced.
 */
export async function reconcileProcurementReadyToIssue(): Promise<string[]> {
  let queue: MaterialRequestWorkflowRecord[];
  try {
    queue = await fetchProcurementQueue();
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn("[MR reconcile] procurement queue fetch failed:", err);
    }
    return [];
  }
  if (queue.length === 0) return [];

  interface ForwardedNeed {
    item_code: string;
    qty: number;
  }

  // Build the "received quantity required" per MR from the forwarded-items
  // snapshot (falling back to the raw MR items when no snapshot exists). Only
  // Material Issue requests can return to the warehouse issue queue.
  const mrNeeds = new Map<string, ForwardedNeed[]>();
  const allItemCodes: string[] = [];

  for (const mr of queue) {
    if (mr.material_request_type !== "Material Issue") continue;

    const forwarded = parseForwardedItemsFromMr(mr);
    const shortage = forwarded.filter((fi) => (Number(fi.forward_qty) || 0) > 0);
    const needs: ForwardedNeed[] =
      shortage.length > 0
        ? shortage.map((fi) => ({
            item_code: fi.item_code,
            qty: Number(fi.forward_qty) || 0,
          }))
        : (mr.items ?? [])
            .map((i) => ({ item_code: i.item_code, qty: Number(i.qty) || 0 }))
            .filter((n) => n.item_code && n.qty > 0);

    if (needs.length === 0) continue;
    mrNeeds.set(mr.name, needs);
    for (const need of needs) allItemCodes.push(need.item_code);
  }

  if (mrNeeds.size === 0) return [];

  const stockByItem = await fetchCompanyStockByItem(allItemCodes);

  const advanced: string[] = [];
  for (const mr of queue) {
    const needs = mrNeeds.get(mr.name);
    if (!needs) continue;

    const fullyReceived = needs.every(
      (need) => (stockByItem.get(need.item_code) ?? 0) >= need.qty,
    );
    if (!fullyReceived) continue;

    try {
      // Advance to "Stock Available" (ERPNext "Under Warehouse Review") — the
      // warehouse pending status that surfaces the request under Ready to
      // Issue. Existing custom_warehouse_remarks (forwarded-items history) is
      // preserved by not overwriting it.
      await updateMaterialRequestWorkflowStatus(mr.name, "Stock Available");
      advanced.push(mr.name);
       
      console.log(
        "[MR reconcile] Forwarded quantity received in full — moved to Ready to Issue",
        {
          mr: mr.name,
          needs,
          onHand: needs.map((n) => ({
            item_code: n.item_code,
            available: stockByItem.get(n.item_code) ?? 0,
          })),
        },
      );
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn(`[MR reconcile] failed to advance ${mr.name}:`, err);
      }
    }
  }

  return advanced;
}

/* ─── Live procurement progress (PO → GRN → Stock Entry) ─────────────────── */

/**
 * The furthest procurement milestone a Material Request has reached, derived
 * purely from linked ERPNext documents (never from `custom_bidsphere_status`,
 * which stops advancing at "RFQ Created"). Drives the Track Request timeline
 * so the progress bar moves the moment a PO / GRN / Stock Entry is submitted.
 */
export interface MaterialRequestProcurementProgress {
  rfqName: string | null;
  supplierQuotations: string[];
  /** Submitted Purchase Orders that fulfil this MR. */
  purchaseOrders: string[];
  /** Submitted Purchase Receipts (GRNs) against those POs. */
  goodsReceipts: string[];
  /** Submitted Stock Entries (Material Issue) for this MR. */
  stockEntries: string[];
  /** Qty ordered on submitted POs. */
  orderedQty: number;
  /** Qty received via submitted GRNs. */
  receivedQty: number;
  /** Qty issued via submitted Stock Entries. */
  issuedQty: number;
  /** Furthest milestone reached from live documents, or null when none. */
  stage:
    | "Purchase Ordered"
    | "Goods Received"
    | "Material Issued"
    | null;
}

async function safeChildQuery<T>(
  promise: Promise<T[]>,
): Promise<T[]> {
  try {
    return (await promise) ?? [];
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn("[MR progress] linked-document query failed:", err);
    }
    return [];
  }
}

/**
 * Resolve the live procurement progress for a Material Request from its linked
 * ERPNext documents. Every step is a `docstatus = 1` (submitted) check:
 *   • Purchase Order Item.material_request === MR  → Purchase Ordered
 *   • Purchase Receipt Item.purchase_order ∈ POs   → Goods Received
 *   • Stock Entry Detail.material_request === MR   → Material Issued
 *
 * Never throws — each sub-query degrades to empty so a permission/field quirk
 * on one doctype can't blank the whole timeline. No hardcoded quantities.
 */
export async function getMaterialRequestProcurementProgress(
  mrName: string,
  linkedRfq?: string | null,
): Promise<MaterialRequestProcurementProgress> {
  // 1. Submitted Purchase Order lines that fulfil this MR.
  const poItems = await safeChildQuery(
    apiGet<Array<{ parent?: string; qty?: number; received_qty?: number }>>(
      buildResourceUrl("Purchase Order Item"),
      withSilent(
        buildListConfig({
          fields: ["parent", "qty", "received_qty"],
          filters: [
            ["material_request", "=", mrName],
            ["docstatus", "=", 1],
          ],
          limit_page_length: 200,
        }),
      ),
    ),
  );
  const purchaseOrders = [
    ...new Set(poItems.map((r) => r.parent).filter((p): p is string => Boolean(p))),
  ];
  const orderedQty = poItems.reduce((sum, r) => sum + (Number(r.qty) || 0), 0);
  let receivedQty = poItems.reduce(
    (sum, r) => sum + (Number(r.received_qty) || 0),
    0,
  );

  // 2. Submitted Purchase Receipt (GRN) lines against those POs.
  let goodsReceipts: string[] = [];
  if (purchaseOrders.length > 0) {
    const prItems = await safeChildQuery(
      apiGet<Array<{ parent?: string; qty?: number; received_qty?: number }>>(
        buildResourceUrl("Purchase Receipt Item"),
        withSilent(
          buildListConfig({
            fields: ["parent", "qty", "received_qty"],
            filters: [
              ["purchase_order", "in", purchaseOrders],
              ["docstatus", "=", 1],
            ],
            limit_page_length: 500,
          }),
        ),
      ),
    );
    goodsReceipts = [
      ...new Set(
        prItems.map((r) => r.parent).filter((p): p is string => Boolean(p)),
      ),
    ];
    const prReceived = prItems.reduce(
      (sum, r) => sum + (Number(r.received_qty ?? r.qty) || 0),
      0,
    );
    if (prReceived > 0) receivedQty = prReceived;
  }

  // 3. Submitted Stock Entry (Material Issue) lines for this MR.
  const seItems = await safeChildQuery(
    apiGet<Array<{ parent?: string; qty?: number }>>(
      buildResourceUrl("Stock Entry Detail"),
      withSilent(
        buildListConfig({
          fields: ["parent", "qty"],
          filters: [
            ["material_request", "=", mrName],
            ["docstatus", "=", 1],
          ],
          limit_page_length: 200,
        }),
      ),
    ),
  );
  const stockEntries = [
    ...new Set(seItems.map((r) => r.parent).filter((p): p is string => Boolean(p))),
  ];
  const issuedQty = seItems.reduce((sum, r) => sum + (Number(r.qty) || 0), 0);

  // 4. Supplier Quotations that quoted this MR (display only, best-effort).
  const sqItems = await safeChildQuery(
    apiGet<Array<{ parent?: string }>>(
      buildResourceUrl("Supplier Quotation Item"),
      withSilent(
        buildListConfig({
          fields: ["parent"],
          filters: [["material_request", "=", mrName]],
          limit_page_length: 100,
        }),
      ),
    ),
  );
  const supplierQuotations = [
    ...new Set(sqItems.map((r) => r.parent).filter((p): p is string => Boolean(p))),
  ];

  let stage: MaterialRequestProcurementProgress["stage"] = null;
  if (purchaseOrders.length > 0) stage = "Purchase Ordered";
  if (goodsReceipts.length > 0) stage = "Goods Received";
  if (stockEntries.length > 0) stage = "Material Issued";

  return {
    rfqName: linkedRfq ?? null,
    supplierQuotations,
    purchaseOrders,
    goodsReceipts,
    stockEntries,
    orderedQty,
    receivedQty,
    issuedQty,
    stage,
  };
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
    forwardedToProcurement: byStatus("Forwarded to Procurement").length,
    forwardedToday: all.filter((m) => {
      const st = statusOf(m);
      return (
        st === "Forwarded to Procurement" &&
        (m.modified ?? "").startsWith(today)
      );
    }).length,
    pendingProcurement: byStatus("Forwarded to Procurement").length,
    readyForRfq: byStatus("Forwarded to Procurement").length,
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

/* ─── Direct vs Indirect procurement KPIs (Reports) ──────────────────────── */

export interface ProcurementTypeKpis {
  directCount: number;
  indirectCount: number;
  directSpend: number;
  indirectSpend: number;
  directPurchaseOrders: number;
  indirectPurchaseOrders: number;
}

/**
 * Aggregate Direct vs Indirect KPIs entirely from live ERPNext data:
 *   • Counts   — submitted Material Requests grouped by `custom_procurement_type`.
 *   • Spend/POs — submitted Purchase Order lines joined to their originating MR
 *                 (`Purchase Order Item.material_request`) and resolved to the
 *                 MR's procurement type. No mock/hardcoded figures.
 */
export async function fetchProcurementTypeKpis(): Promise<ProcurementTypeKpis> {
  const mrs = await listMaterialRequestsWorkflow({ docstatus: 1, limit: 1000 });

  const typeByMr = new Map<string, MaterialRequestProcurementType>();
  let directCount = 0;
  let indirectCount = 0;
  for (const mr of mrs) {
    const type = getMaterialRequestProcurementType(mr);
    typeByMr.set(mr.name, type);
    if (type === "Indirect") indirectCount += 1;
    else directCount += 1;
  }

  const poItems = await safeChildQuery(
    apiGet<
      Array<{
        parent?: string;
        material_request?: string;
        amount?: number;
        base_amount?: number;
      }>
    >(
      buildResourceUrl("Purchase Order Item"),
      withSilent(
        buildListConfig({
          fields: ["parent", "material_request", "amount", "base_amount"],
          filters: [
            ["docstatus", "=", 1],
            ["material_request", "is", "set"],
          ],
          limit_page_length: 2000,
        }),
      ),
    ),
  );

  let directSpend = 0;
  let indirectSpend = 0;
  const directPOs = new Set<string>();
  const indirectPOs = new Set<string>();

  for (const item of poItems) {
    const mrName = item.material_request;
    if (!mrName) continue;
    const type = typeByMr.get(mrName) ?? "Direct";
    const amount = Number(item.base_amount ?? item.amount) || 0;
    if (type === "Indirect") {
      indirectSpend += amount;
      if (item.parent) indirectPOs.add(item.parent);
    } else {
      directSpend += amount;
      if (item.parent) directPOs.add(item.parent);
    }
  }

  return {
    directCount,
    indirectCount,
    directSpend,
    indirectSpend,
    directPurchaseOrders: directPOs.size,
    indirectPurchaseOrders: indirectPOs.size,
  };
}
