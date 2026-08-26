/**
 * BidSphere Purchase Requisition API (ECR-driven)
 *
 * Handles CRUD + Frappe Workflow for the custom "Purchase Requisition" DocType.
 * Bridges to the existing RFQ creation flow for the ECR → PR → RFQ path.
 *
 * Workflow: "Purchase Requisition Approval Workflow" (field: `status`)
 * DocType: "Purchase Requisition"
 * Child: "Purchase Requisition Item" (fieldname: requisition_items)
 */

import { apiGet, apiPost, apiPut, buildResourceUrl } from "./erpnext";
import type { CustomPurchaseRequisition, PRStatus } from "../types/erpnext";

const PR_DOCTYPE = "Purchase Requisition";

const PR_LIST_FIELDS = [
  "name",
  "requisition_title",
  "source_type",
  "ecr_reference",
  "requester",
  "requesting_department",
  "plant",
  "required_date",
  "priority",
  "status",
  "suggested_supplier",
  "rfq",
  "docstatus",
  "owner",
  "creation",
  "modified",
];

const PR_DETAIL_FIELDS = [
  ...PR_LIST_FIELDS,
  "program",
  "project",
  "purpose__requirement",
  "procurement_category",
  "procurement_notes",
  "requisition_items",
  "amended_from",
];

function extractMsg(err: unknown): string {
  const e = err as { response?: { data?: { exception?: string; _server_messages?: string; message?: string } }; message?: string };
  const d = e?.response?.data;
  if (d?.exception) return d.exception.replace(/^frappe\.exceptions\.\w+:\s*/, "");
  if (d?._server_messages) {
    try {
      const msgs = JSON.parse(d._server_messages);
      const first = JSON.parse(msgs[0]);
      return first.message ?? d._server_messages;
    } catch { return d._server_messages; }
  }
  if (d?.message) return d.message;
  return e?.message ?? "Unknown error";
}

// ── List ──
export interface PRListFilters {
  status?: PRStatus | "all";
  source_type?: string;
  ecr_reference?: string;
  department?: string;
  priority?: string;
  search?: string;
  limit?: number;
  start?: number;
}

export async function fetchPRList(filters: PRListFilters = {}): Promise<CustomPurchaseRequisition[]> {
  const params = new URLSearchParams();
  params.set("fields", JSON.stringify(PR_LIST_FIELDS));
  params.set("limit", String(filters.limit ?? 100));
  params.set("start", String(filters.start ?? 0));
  params.set("order_by", "modified desc");

  const fList: [string, string, string][] = [];
  if (filters.status && filters.status !== "all") fList.push(["status", "=", filters.status]);
  if (filters.source_type) fList.push(["source_type", "=", filters.source_type]);
  if (filters.ecr_reference) fList.push(["ecr_reference", "=", filters.ecr_reference]);
  if (filters.department) fList.push(["requesting_department", "=", filters.department]);
  if (filters.priority) fList.push(["priority", "=", filters.priority]);
  if (filters.search) fList.push(["requisition_title", "like", `%${filters.search}%`]);
  if (fList.length > 0) params.set("filters", JSON.stringify(fList));

  const url = `/api/resource/${encodeURIComponent(PR_DOCTYPE)}?${params.toString()}`;
  const res = await apiGet<{ data: CustomPurchaseRequisition[] }>(url);
  return res?.data ?? (res as unknown as CustomPurchaseRequisition[]) ?? [];
}

// ── Single fetch ──
export async function fetchPR(name: string): Promise<CustomPurchaseRequisition> {
  const params = new URLSearchParams();
  params.set("fields", JSON.stringify(PR_DETAIL_FIELDS));
  const url = `${buildResourceUrl(PR_DOCTYPE, name)}?${params.toString()}`;
  const res = await apiGet<{ data: CustomPurchaseRequisition }>(url);
  return res?.data ?? (res as unknown as CustomPurchaseRequisition);
}

// ── Update ──
export async function updatePR(
  name: string,
  payload: Partial<CustomPurchaseRequisition>,
): Promise<CustomPurchaseRequisition> {
  const url = buildResourceUrl(PR_DOCTYPE, name);
  const res = await apiPut<{ data: CustomPurchaseRequisition }>(url, payload);
  return res?.data ?? (res as unknown as CustomPurchaseRequisition);
}

// ── Workflow action ──
export interface PRWorkflowActionResult {
  success: boolean;
  message?: string;
  newStatus?: PRStatus;
}

export async function applyPRWorkflowAction(
  name: string,
  action: string,
  comment?: string,
): Promise<PRWorkflowActionResult> {
  try {
    const res = await apiPost<{ message: string }>(
      "/api/method/frappe.model.workflow.apply_workflow",
      { doc: { doctype: PR_DOCTYPE, name }, action },
    );
    if (comment) {
      await apiPost("/api/resource/Comment", {
        comment_type: "Workflow",
        reference_doctype: PR_DOCTYPE,
        reference_name: name,
        content: comment,
      });
    }
    return { success: true, message: res?.message };
  } catch (err) {
    return { success: false, message: extractMsg(err) };
  }
}

// ── Create RFQ from PR ──
// Bridges to the existing Request for Quotation DocType.
// Adds custom_ecr_reference and custom_purchase_requisition_reference fields.
export interface CreateRFQFromPROptions {
  /** ERPNext Supplier names to invite */
  suppliers: string[];
  /** Title override */
  title?: string;
  /** Schedule date */
  scheduleDate?: string;
}

export interface CreateRFQFromPRResult {
  success: boolean;
  rfqName?: string;
  created?: boolean;
  message?: string;
  warnings: string[];
  needsRepair: boolean;
}

export async function createRFQFromPR(
  prName: string,
  options: CreateRFQFromPROptions,
): Promise<CreateRFQFromPRResult> {
  try {
    const result = await apiPost<{
      success: true;
      rfqName: string;
      created: boolean;
      message: string;
      warnings: string[];
    }>("/api/create-rfq-from-pr", {
      pr_name: prName,
      suppliers: options.suppliers,
      title: options.title,
      schedule_date: options.scheduleDate,
    });
    return {
      success: true,
      rfqName: result.rfqName,
      created: result.created,
      message: result.message,
      warnings: result.warnings ?? [],
      needsRepair: (result.warnings?.length ?? 0) > 0,
    };
  } catch (err) {
    const errorData = (err as {
      response?: { data?: { code?: string; rfq_name?: string } };
    })?.response?.data;
    return {
      success: false,
      rfqName: errorData?.rfq_name,
      message: extractMsg(err),
      warnings: [],
      needsRepair: errorData?.code === "partial",
    };
  }
}

// ── Get PR comments ──
export async function getPRComments(name: string) {
  const url = `/api/resource/Comment?filters=${encodeURIComponent(JSON.stringify([
    ["reference_doctype", "=", PR_DOCTYPE],
    ["reference_name", "=", name],
  ]))}&fields=["name","comment_type","content","owner","creation"]&order_by=creation asc`;
  const res = await apiGet<{ data: unknown[] }>(url);
  return res?.data ?? [];
}
