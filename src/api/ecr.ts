/**
 * BidSphere Engineering Change Request API
 *
 * All data operations use the Frappe REST API via the shared `apiGet`, `apiPost`,
 * `apiPut` helpers from `./erpnext`. No separate auth client.
 *
 * Key fieldname quirks (confirmed from live ERPNext inspection):
 *   - Status field: `select_pxfp` (auto-generated Frappe name, no label)
 *   - ECR Owner field: `ecr_owner` (Link → User)
 *   - `amended_from` remains a legacy read fallback for older ECR records
 *   - Change Description field: `chnage_description` (typo in ERPNext)
 *   - Plant on child tables: Link → Plant Floor DocType
 *
 * Workflow: "ECR Approval Workflow" on Engineering Change Request.
 * Workflow state field: `select_pxfp`
 */

import {
  apiGet,
  apiPost,
  apiPut,
  buildResourceUrl,
  extractErpNextErrorMessage,
  withSilent,
  withoutNetworkRetry,
} from "./erpnext";
import type {
  EngineeringChangeRequest,
  ECRStatus,
  ECRAffectedPart,
} from "../types/erpnext";
import { canonicalECRStage, formatECRNumber } from "../config/ecrRoles";

const ECR_DOCTYPE = "Engineering Change Request";

// ── Field list for list queries (avoids fetching Text Editor fields in list) ──
const ECR_LIST_FIELDS = [
  "name",
  "ecr_number",
  "ecr_title",
  "ecr_type",
  "priority",
  "ecr_owner",      // ECR Owner (Link → User)
  "amended_from",   // Legacy owner fallback / Frappe amendment link
  "requesting_department",
  "plant",
  "program",
  "project",
  "target_implementation_date",
  "implementation_date",
  "manufacturing_impact",
  "tooling_impact",
  "quality_impact",
  "delivery_impact",
  "customer_impact",
  "supplier_response_required",
  "select_pxfp",    // Status
  "purchase_requisition",
  "rfq",
  "selected_supplier",
  "supplier_quotation",
  "purchase_order",
  "validation_status",
  "docstatus",
  "owner",
  "creation",
  "modified",
];

// ── Field list for single document fetch ──
const ECR_DETAIL_FIELDS = [
  ...ECR_LIST_FIELDS,
  "ecr_number",
  "chnage_description",   // note: typo is real
  "reason_for_change",
  "business_justification",
  "current_state",
  "proposed_state",
  "product_impact",
  "material_impact",
  "cost_impact",
  "supplier_impact",
  "contract_impact",
  "supplier_response_type",
  "suggested_supplier",
  "procurement_reference_type",
  "existing_rfq_reference",
  "existing_purchase_order_reference",
  "required_quantity",
  "quantity_uom",
  "engineering_drawing",
  "3d_cad_file",
  "specification",
  "supporting_documents",
  "engineering_notes",
  "implementation_notes",
  "validation_notes",
  "validation_documents",
  // Child tables
  "affected_parts",
  "supplier_response_requirements",
  "approval_requirements",
];

const ACTIONABLE_ECR_LIST_STAGES = new Set([
  "Engineering Review",
  "Procurement Review",
  "RFQ Pending",
]);
const ECR_LIST_DETAIL_CONCURRENCY = 6;

// ── Error helper ──
export function extractECRErrorMessage(err: unknown): string {
  if (!err) return "Unknown error";
  const e = err as {
    response?: { data?: unknown };
    message?: string;
    fieldErrors?: Record<string, string>;
  };
  if (e.fieldErrors && Object.keys(e.fieldErrors).length > 0) {
    return Object.values(e.fieldErrors).join(" ");
  }
  const extracted = extractErpNextErrorMessage(e?.response?.data);
  if (extracted) return extracted;
  const d = e?.response?.data as { message?: string; error?: string; _server_messages?: string } | undefined;
  if (d?._server_messages) {
    try {
      const msgs = JSON.parse(d._server_messages);
      const first = typeof msgs[0] === "string" ? JSON.parse(msgs[0]) : msgs[0];
      if (first?.message) return String(first.message);
    } catch {
      return String(d._server_messages);
    }
  }
  if (d?.message) return String(d.message);
  if (d?.error) return String(d.error);
  return e?.message ?? "Unknown error";
}

// ── List ──
export interface ECRListFilters {
  status?: ECRStatus | "all";
  ecr_type?: string;
  priority?: string;
  department?: string;
  supplier_response_required?: "Yes" | "No" | "all";
  owner?: string;
  search?: string;
  limit?: number;
  start?: number;
}

async function fetchECRListRows(
  filters: ECRListFilters,
  hydrateActionableDetails: boolean,
): Promise<EngineeringChangeRequest[]> {
  const params = new URLSearchParams();
  params.set("fields", JSON.stringify(ECR_LIST_FIELDS));
  params.set("limit", String(filters.limit ?? 100));
  params.set("start", String(filters.start ?? 0));
  params.set("order_by", "modified desc");

  const fList: [string, string, string][] = [];
  if (filters.status && filters.status !== "all") {
    fList.push(["select_pxfp", "=", filters.status]);
  }
  if (filters.ecr_type) fList.push(["ecr_type", "=", filters.ecr_type]);
  if (filters.priority) fList.push(["priority", "=", filters.priority]);
  if (filters.department) fList.push(["requesting_department", "=", filters.department]);
  if (filters.owner) fList.push(["ecr_owner", "=", filters.owner]);
  if (filters.supplier_response_required && filters.supplier_response_required !== "all") {
    fList.push(["supplier_response_required", "=", filters.supplier_response_required]);
  }
  if (filters.search) {
    fList.push(["ecr_title", "like", `%${filters.search}%`]);
  }
  if (fList.length > 0) {
    params.set("filters", JSON.stringify(fList));
  }

  const url = `/api/resource/${encodeURIComponent(ECR_DOCTYPE)}?${params.toString()}`;
  const res = await apiGet<{ data: EngineeringChangeRequest[] }>(url);
  const rows = res?.data ?? (res as unknown as EngineeringChangeRequest[]) ?? [];
  const normalizedRows = rows.map((row) => ({
    ...row,
    ecr_number: row.ecr_number || formatECRNumber(row),
  }));
  return hydrateActionableDetails
    ? hydrateActionableECRDetails(normalizedRows)
    : normalizedRows;
}

export async function fetchECRList(filters: ECRListFilters = {}): Promise<EngineeringChangeRequest[]> {
  return fetchECRListRows(filters, true);
}

// ── Single fetch ──
export function isBusinessECRNumber(value: string): boolean {
  return /^ECR-\d{4}-\d+$/i.test(value.trim());
}

/** Resolve a public business number to the private Frappe document name. */
export async function resolveECRName(identifier: string): Promise<string> {
  const value = identifier.trim();
  if (!isBusinessECRNumber(value)) return value;

  const params = new URLSearchParams({
    fields: JSON.stringify(["name", "ecr_number"]),
    filters: JSON.stringify([["ecr_number", "=", value.toUpperCase()]]),
    limit_page_length: "1",
  });
  const url = `/api/resource/${encodeURIComponent(ECR_DOCTYPE)}?${params.toString()}`;
  const response = await apiGet<
    { data?: Array<Pick<EngineeringChangeRequest, "name" | "ecr_number">> } |
    Array<Pick<EngineeringChangeRequest, "name" | "ecr_number">>
  >(url);
  const exactRows = Array.isArray(response) ? response : response?.data ?? [];
  if (exactRows[0]?.name) return exactRows[0].name;

  // New ECRs use ERPNext's atomic ECR-.YYYY.-1.##### autoname as their
  // canonical business identifier. Older records may instead have the public
  // value only in ecr_number, so retain the lookup above and legacy fallback
  // below while trying the exact persisted resource name in between.
  try {
    const directResponse = await apiGet<
      { data?: Pick<EngineeringChangeRequest, "name"> } |
      Pick<EngineeringChangeRequest, "name">
    >(
      buildResourceUrl(ECR_DOCTYPE, value.toUpperCase()),
      withSilent({ params: { fields: JSON.stringify(["name"]) } }),
    );
    const direct: Pick<EngineeringChangeRequest, "name"> | undefined =
      (directResponse as { data?: Pick<EngineeringChangeRequest, "name"> }).data ??
      (directResponse as Pick<EngineeringChangeRequest, "name">);
    if (direct?.name) return direct.name;
  } catch {
    // Continue to the compatibility scan for pre-autoname records.
  }

  // Compatibility for records awaiting the one-time ecr_number backfill.
  // Use the raw list path here. Calling the public hydrated list from this
  // compatibility scan could turn identifier resolution into a detail/list
  // cycle when old records use a business-looking Frappe name.
  const legacyRows = await fetchECRListRows({ limit: 500 }, false);
  const legacy = legacyRows.find(
    (row) => formatECRNumber(row).toUpperCase() === value.toUpperCase(),
  );
  if (legacy?.name) return legacy.name;
  throw new Error(`Engineering Change Request ${value.toUpperCase()} was not found.`);
}

export async function fetchECR(identifier: string): Promise<EngineeringChangeRequest> {
  const name = await resolveECRName(identifier);
  return fetchECRDetailByResolvedName(name);
}

async function fetchECRDetailByResolvedName(
  name: string,
): Promise<EngineeringChangeRequest> {
  const params = new URLSearchParams();
  params.set("fields", JSON.stringify(ECR_DETAIL_FIELDS));
  const url = `${buildResourceUrl(ECR_DOCTYPE, name)}?${params.toString()}`;
  const res = await apiGet<{ data: EngineeringChangeRequest }>(url);
  const data = res?.data ?? (res as unknown as EngineeringChangeRequest);
  if (data) {
    data.ecr_number = data.ecr_number || formatECRNumber(data);
  }
  return data;
}

async function hydrateActionableECRDetails(
  rows: EngineeringChangeRequest[],
): Promise<EngineeringChangeRequest[]> {
  const candidates = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) =>
      Boolean(row.name) &&
      ACTIONABLE_ECR_LIST_STAGES.has(canonicalECRStage(row.select_pxfp)),
    );
  if (candidates.length === 0) return rows;

  const hydrated = [...rows];
  let nextIndex = 0;
  const workerCount = Math.min(ECR_LIST_DETAIL_CONCURRENCY, candidates.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < candidates.length) {
      const candidate = candidates[nextIndex];
      nextIndex += 1;
      try {
        // `row.name` came from Frappe's list response and is already the
        // resolved document name. Do not route it through resolveECRName.
        hydrated[candidate.index] = await fetchECRDetailByResolvedName(candidate.row.name);
      } catch (error) {
        // Keep the row visible but task-less. Queue/action helpers then fail
        // closed instead of granting an action from incomplete list data.
        if (import.meta.env.DEV) {
          console.warn("[ECR] Unable to hydrate actionable list row", {
            name: candidate.row.name,
            error,
          });
        }
      }
    }
  }));

  return hydrated;
}

// ── Create (Draft) ──
export interface CreateECRPayload {
  ecr_number?: string;
  ecr_title: string;
  ecr_type: string;
  priority: string;
  ecr_owner?: string;      // ECR Owner (canonical ERPNext User name)
  amended_from?: string;   // Legacy compatibility only; never set for new ECRs
  requesting_department: string;
  plant: string;
  program?: string;
  project?: string;
  target_implementation_date: string;
  chnage_description: string;  // typo is correct
  reason_for_change: string;
  business_justification?: string;
  current_state?: string;
  proposed_state?: string;
  affected_parts?: Partial<ECRAffectedPart>[];
  product_impact?: 0 | 1;
  material_impact?: 0 | 1;
  manufacturing_impact?: 0 | 1;
  tooling_impact?: 0 | 1;
  quality_impact?: 0 | 1;
  cost_impact?: 0 | 1;
  supplier_impact?: 0 | 1;
  delivery_impact?: 0 | 1;
  customer_impact?: 0 | 1;
  contract_impact?: 0 | 1;
  supplier_response_required?: "Yes" | "No";
  supplier_response_type?: string;
  suggested_supplier?: string;
  procurement_reference_type?: EngineeringChangeRequest["procurement_reference_type"];
  existing_rfq_reference?: string;
  existing_purchase_order_reference?: string;
  required_quantity?: number;
  quantity_uom?: string;
  supplier_response_requirements?: unknown[];
  engineering_notes?: string;
  engineering_drawing?: string;
  "3d_cad_file"?: string;
  specification?: string;
  supporting_documents?: string;
  implementation_notes?: string;
  implementation_date?: string;
  validation_status?: EngineeringChangeRequest["validation_status"];
  validation_notes?: string;
  validation_documents?: string;
}

export interface ECRSaveResult extends EngineeringChangeRequest {
  /** True when /api/ecr-create returned a prior success for the same key. */
  create_replayed?: boolean;
}

export interface CreateECROptions {
  idempotencyKey?: string;
}

export function generateECRCreateIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `ecr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export async function createECR(
  payload: CreateECRPayload,
  options: CreateECROptions = {},
): Promise<ECRSaveResult> {
  const idempotencyKey = options.idempotencyKey || generateECRCreateIdempotencyKey();
  const res = await apiPost<{ data: ECRSaveResult }>(
    "/api/ecr-create",
    { ...payload, idempotency_key: idempotencyKey },
    withoutNetworkRetry(),
  );
  return res?.data ?? (res as unknown as ECRSaveResult);
}

export type ECRPostSaveWorkflowAction = "Submit ECR";

/**
 * Decide whether a completed save still needs a workflow submission. A create
 * replay may already be submitted when the first response was lost; in that
 * case its persisted status/docstatus/tasks are authoritative and no second
 * workflow action is sent.
 */
export function getECRPostSaveWorkflowAction(
  ecr: Pick<
    ECRSaveResult,
    "select_pxfp" | "docstatus" | "approval_requirements" | "create_replayed"
  >,
  options: { submitImmediately: boolean; isEditing: boolean },
): ECRPostSaveWorkflowAction | null {
  if (!options.submitImmediately) return null;
  const stage = canonicalECRStage(ecr.select_pxfp);
  // Returned ECRs are persisted as Draft with completed history and no active
  // task. The same Submit ECR transition safely creates a fresh manager task.
  if (stage !== "Draft" || Number(ecr.docstatus || 0) !== 0) return null;
  if (ecr.approval_requirements?.some((row) => row.status === "Pending")) return null;
  return "Submit ECR";
}

// ── Update ──
export async function updateECR(
  name: string,
  payload: Partial<CreateECRPayload>,
): Promise<EngineeringChangeRequest> {
  const url = buildResourceUrl(ECR_DOCTYPE, name);
  const res = await apiPut<{ data: EngineeringChangeRequest }>(url, payload);
  return res?.data ?? (res as unknown as EngineeringChangeRequest);
}

// ── Workflow action ──
export interface ECRWorkflowActionResult {
  success: boolean;
  message?: string;
  newStatus?: ECRStatus;
  approvalRequirements?: EngineeringChangeRequest["approval_requirements"];
}

export async function applyECRWorkflowAction(
  name: string,
  action: string,
  comment?: string,
  ecr?: Partial<EngineeringChangeRequest> | null,
  reviewFields?: Record<string, string>,
): Promise<ECRWorkflowActionResult> {
  const effectiveName = String(name || ecr?.name || ecr?.ecr_number || "").trim();
  if (!effectiveName) {
    return {
      success: false,
      message: "Engineering Change Request is required.",
    };
  }
  try {
    if (action === "Comment") {
      if (!comment?.trim()) return { success: false, message: "Comment is required." };
      await apiPost("/api/resource/Comment", {
        comment_type: "Comment",
        reference_doctype: ECR_DOCTYPE,
        reference_name: effectiveName,
        content: comment.trim(),
      });
      return { success: true, message: "Comment posted." };
    }
    const response = await apiPost<{
      data?: ECRWorkflowActionResult;
      success?: boolean;
      message?: string;
      newStatus?: ECRStatus;
      approvalRequirements?: EngineeringChangeRequest["approval_requirements"];
    }>("/api/ecr-workflow-action", {
      name: effectiveName,
      ecr_name: effectiveName,
      ecrId: effectiveName,
      ecr_number: ecr?.ecr_number || effectiveName,
      action,
      comment: comment?.trim() ?? "",
      reviewFields: reviewFields ?? {},
    }, withoutNetworkRetry());
    const result = response?.data ?? response;
    return {
      success: result.success !== false,
      message: result.message,
      newStatus: result.newStatus,
      approvalRequirements: result.approvalRequirements,
    };
  } catch (err) {
    return { success: false, message: extractECRErrorMessage(err) };
  }
}

export interface ECRComment {
  name: string;
  comment_type: string;
  content: string;
  comment_by?: string;
  owner?: string;
  creation: string;
}

// ── Submit (Doc Submit — transitions Draft → Submitted) ──
export async function submitECR(name: string): Promise<ECRWorkflowActionResult> {
  return applyECRWorkflowAction(name, "Submit ECR");
}

// ── Get workflow actions available for the current user on this ECR ──
export async function getECRAvailableActions(name: string): Promise<string[]> {
  try {
    const res = await apiGet<{ message: unknown }>(
      `/api/method/frappe.model.workflow.get_transitions?doc=${encodeURIComponent(JSON.stringify({ doctype: ECR_DOCTYPE, name }))}`,
    );
    if (Array.isArray(res)) return (res as { action: string }[]).map((t) => t.action);
    if (Array.isArray(res?.message)) return (res.message as { action: string }[]).map((t) => t.action);
    return [];
  } catch {
    return [];
  }
}

// ── Comments / Timeline ──
export async function getECRComments(name: string): Promise<ECRComment[]> {
  try {
    const resolvedName = await resolveECRName(name);
    const url = `/api/resource/Comment?filters=${encodeURIComponent(JSON.stringify([
      ["reference_doctype", "=", ECR_DOCTYPE],
      ["reference_name", "=", resolvedName],
    ]))}&fields=["name","comment_type","content","owner","comment_by","creation"]&order_by=creation asc`;
    const res = await apiGet<{ data: ECRComment[] }>(url);
    return res?.data ?? [];
  } catch {
    return [];
  }
}

// ── Create Purchase Requisition from ECR ──
// The trusted server endpoint owns the field mapping, idempotency key, backlink,
// and workflow transition. The browser sends only the ECR identifier.
export interface CreatePRFromECRResult {
  success: boolean;
  prName?: string;
  message?: string;
  created?: boolean;
  replayed?: boolean;
}

export async function createPurchaseRequisitionFromECR(
  ecrName: string,
  aiSummarize = true,
): Promise<CreatePRFromECRResult> {
  // Preserved for source compatibility with existing callers. Server-owned
  // creation intentionally performs no browser-side third-party AI request.
  void aiSummarize;
  try {
    const response = await apiPost<{
      data: {
        success: true;
        prName: string;
        created: boolean;
        replayed: boolean;
        message: string;
      };
    }>("/api/create-pr-from-ecr", { ecr_name: ecrName });
    return {
      success: true,
      prName: response.data.prName,
      created: response.data.created,
      replayed: response.data.replayed,
      message: response.data.message,
    };
  } catch (err) {
    return {
      success: false,
      message: extractECRErrorMessage(err),
    };
  }
}

// ── Create RFQ directly from an approved ECR ──
// The server owns ECR-to-RFQ field mapping, idempotency, backlinking, and the
// atomic Procurement → RFQ stage transition. The browser sends no editable RFQ
// fields so stale or forged client data cannot affect the created document.
export interface CreateRFQFromECRResult {
  success: boolean;
  rfqName?: string;
  newStatus?: "RFQ";
  message?: string;
  created?: boolean;
  replayed?: boolean;
  approvalRequirements?: EngineeringChangeRequest["approval_requirements"];
}

export async function createRFQFromECR(
  ecrName: string,
): Promise<CreateRFQFromECRResult> {
  try {
    const response = await apiPost<{
      data?: {
        success: boolean;
        rfqName?: string;
        newStatus?: "RFQ";
        created?: boolean;
        replayed?: boolean;
        message?: string;
        approvalRequirements?: EngineeringChangeRequest["approval_requirements"];
      };
      success?: boolean;
      rfqName?: string;
      newStatus?: "RFQ";
      created?: boolean;
      replayed?: boolean;
      message?: string;
      approvalRequirements?: EngineeringChangeRequest["approval_requirements"];
    }>("/api/create-rfq-from-ecr", { ecr_name: ecrName }, withoutNetworkRetry());
    const result = response.data ?? response;
    const success = result.success === true && Boolean(result.rfqName?.trim());
    return {
      success,
      rfqName: result.rfqName,
      newStatus: result.newStatus,
      created: result.created,
      replayed: result.replayed,
      approvalRequirements: result.approvalRequirements,
      message: success
        ? result.message
        : result.message || "RFQ creation returned an invalid response.",
    };
  } catch (err) {
    return {
      success: false,
      message: extractECRErrorMessage(err),
    };
  }
}
