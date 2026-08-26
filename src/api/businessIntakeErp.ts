/**
 * ERPNext-backed Business Intake API Layer.
 *
 * All data operations go through the existing Frappe/ERPNext REST API using
 * the same `apiGet`, `apiPost`, `buildResourceUrl` helpers used across the
 * rest of BidSphere. No second Axios client, no second auth system.
 *
 * DocType mapping:
 *   Business Need  → ERPNext DocType "Business Need"
 *   Business Case  → ERPNext DocType "Business Case"
 *
 * Approval history entries are stored as child table rows in
 * "Business Case Approval History" (linked to Business Case).
 *
 * CRITICAL: NO Department Head role exists in this flow.
 * Flow: Department User → Need → Case → Finance → Legal → Procurement → RFQ
 */

import {
  apiGet,
  apiPost,
  apiPut,
  buildResourceUrl,
  COMPANY,
} from "./erpnext";
import { uploadFileToERPNextDetailed, getFullFileUrl } from "./legalDocsStorage";

import type {
  BusinessNeed,
  BusinessCase,
  CreateBusinessNeedInput,
  BusinessCaseApprovalHistory,
  IntakeAttachment,
  FinanceGateBlocker,
  FinanceGateValidationResult,
  FinanceChecklistState,
  FinancialCalculationStatus,
  TechnicalRequirementItem,
} from "../types/businessIntake";
import {
  calculateBusinessCaseFinancials,
  type FinancialAssumptionsInput,
} from "../utils/financialCalculations";

// ── DocType names (must match ERPNext exactly) ──────────────────────────────

export const BN_DOCTYPE = "Business Need";
export const BC_DOCTYPE = "Business Case";
export const BC_APPROVAL_DOCTYPE = "Business Case Approval";

// ── Error types (mirrors businessIntake.ts for compatibility) ────────────────

export class ErpIntakeError extends Error {
  readonly statusCode: number;
  constructor(
    statusCode: number,
    message: string,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.name = "ErpIntakeError";
  }
}

export class ErpIntakeNotFoundError extends ErpIntakeError {
  constructor(doctype: string, id: string) {
    super(404, `${doctype} "${id}" not found.`);
    this.name = "ErpIntakeNotFoundError";
  }
}

export class ErpIntakePermissionError extends ErpIntakeError {
  constructor(action: string) {
    super(403, `You do not have permission to ${action}.`);
    this.name = "ErpIntakePermissionError";
  }
}

/** Extract a readable error message from a Frappe API error response. */
function extractErpMessage(err: unknown): string {
  const e = err as {
    response?: { data?: { message?: string; exc?: string; _server_messages?: string }; status?: number };
    message?: string;
  };
  const data = e?.response?.data;
  if (data?.message && typeof data.message === "string") {
    if (/has been modified after you have opened it|TimestampMismatchError/i.test(data.message)) {
      return "The Business Need was updated by another process. The latest version is being loaded. Please try again.";
    }
    return data.message;
  }
  if (data?._server_messages && typeof data._server_messages === "string") {
    try {
      const parsed = JSON.parse(data._server_messages);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const msgObj = typeof parsed[0] === "string" ? JSON.parse(parsed[0]) : parsed[0];
        const msg = msgObj?.message || "";
        if (/has been modified after you have opened it|TimestampMismatchError/i.test(msg)) {
          return "The Business Need was updated by another process. The latest version is being loaded. Please try again.";
        }
        if (msg) return msg;
      }
    } catch {}
  }
  if (data?.exc && typeof data.exc === "string") {
    if (/has been modified after you have opened it|TimestampMismatchError/i.test(data.exc)) {
      return "The Business Need was updated by another process. The latest version is being loaded. Please try again.";
    }
    // Extract first line or clean last line of Python traceback
    const lines = data.exc.split("\n").filter(Boolean);
    const lastLine = lines[lines.length - 1] || "";
    if (lastLine && !lastLine.startsWith("Traceback")) {
      return lastLine.replace(/^frappe\.exceptions\.\w+:\s*/, "");
    }
  }
  return e?.message || "An unexpected error occurred.";
}

/** Rethrow Frappe errors as typed ErpIntakeError. */
function rethrowErpError(err: unknown, fallback: string): never {
  const e = err as { response?: { status?: number } };
  const status = e?.response?.status ?? 0;
  const message = extractErpMessage(err);

  if (status === 403) throw new ErpIntakePermissionError(fallback);
  if (status === 404) throw new ErpIntakeError(404, message || fallback);
  throw new ErpIntakeError(status || 500, message || fallback);
}

// ── Frappe list-API response envelope ──────────────────────────────────────

interface FrappeListResponse<T> {
  data?: T[];
  message?: T[];
}

/** Normalise GET /api/resource/<DocType> response (data or message). */
function extractList<T>(raw: unknown): T[] {
  const r = raw as FrappeListResponse<T>;
  if (Array.isArray(r)) return r as T[];
  if (r?.data && Array.isArray(r.data)) return r.data;
  if (r?.message && Array.isArray(r.message)) return r.message;
  return [];
}

/**
 * Normalise a raw ERPNext Business Need document to the frontend
 * BusinessNeed type. ERPNext uses `name` as the primary key and `status`
 * for the workflow status field — the frontend type additionally expects
 * `business_need_id` and `workflow_status` aliases.
 */
export function formatTechnicalRequirementsSummary(list?: TechnicalRequirementItem[]): string {
  if (!list || list.length === 0) return "";
  return list
    .map((item, i) => {
      let text = `${i + 1}. [${item.requirement_type || "Requirement"}] ${item.specification || item.description || "—"} (Qty: ${item.quantity || 1} ${item.uom || "Nos."}, Priority: ${item.priority || "High"}, Mandatory: ${item.is_mandatory !== false ? "Yes" : "No"})`;
      if (item.performance_requirements) text += `\n   • Performance: ${item.performance_requirements}`;
      if (item.quality_requirements) text += `\n   • Quality: ${item.quality_requirements}`;
      if (item.delivery_installation_requirements) text += `\n   • Delivery/Installation: ${item.delivery_installation_requirements}`;
      if (item.integration_requirements) text += `\n   • Integration: ${item.integration_requirements}`;
      if (item.safety_compliance_requirements) text += `\n   • Safety & Compliance: ${item.safety_compliance_requirements}`;
      if (item.required_supplier_documents && item.required_supplier_documents.length > 0) {
        text += `\n   • Required Supplier Deliverables: ${item.required_supplier_documents.join(", ")}`;
      }
      return text;
    })
    .join("\n\n");
}

function normalizeNeed(raw: Record<string, unknown>): BusinessNeed {
  const doc = raw as BusinessNeed & Record<string, unknown>;
  const needName = (doc.name as string) || (doc.business_need_id as string) || "";
  const techList = (doc.technical_requirements_list as BusinessNeed["technical_requirements_list"]) || [];
  const techSummary = (doc.technical_requirements as string) || formatTechnicalRequirementsSummary(techList);

  return {
    ...doc,
    name: needName,
    business_need_id: (doc.business_need_id as string) || needName,
    title: (doc.data_acff as string) || (doc.title as string) || (doc.description as string) || needName,
    description: (doc.description as string) || (doc.problem_statement as string) || "",
    need_type: (doc.need_type as BusinessNeed["need_type"]) || "Direct",
    priority: (doc.priority as BusinessNeed["priority"]) || "Medium",
    status: (doc.status as BusinessNeed["status"]) || "Draft",
    department: (doc.department as string) || "General",
    requester: (doc.requester as string) || (doc.owner as string) || "",
    estimated_budget: Number(doc.estimated_budget) || 0,
    workflow_status: (doc.workflow_status as BusinessNeed["workflow_status"]) ||
      (doc.status as BusinessNeed["workflow_status"]) || "Draft",
    technical_requirements: techSummary,
    technical_requirements_list: techList,
    business_case: (doc.business_case as string) || "",
    requester_email: (doc.requester_email as string) || (doc.owner as string) || "",
    created_by: (doc.created_by as string) || (doc.owner as string) || "",
    created_date: (doc.created_date as string) || (doc.creation as string) || "",
    last_modified: (doc.last_modified as string) || (doc.modified as string) || "",
    business_need_documents: (doc.business_need_documents as BusinessNeed["business_need_documents"]) || [],
    attachments: (doc.attachments as BusinessNeed["attachments"]) || [],
  } as BusinessNeed;
}

export function formatFrappeDatetime(d: Date = new Date()): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Normalise a raw ERPNext Business Case document to the frontend
 * BusinessCase type.
 *
 * Reads authoritative workflow_state, finance_status, legal_status,
 * approval_history, and applies deterministic financial calculations.
 */
function normalizeCase(raw: Record<string, unknown>): BusinessCase {
  const doc = raw as BusinessCase & Record<string, unknown>;

  // 1. Authoritative workflow state from ERPNext
  let workflowStatus: BusinessCase["workflow_status"] = "Draft";
  const rawWf = String(doc.workflow_state || doc.workflow_status || "").trim();
  const rawStatus = String(doc.status || "").trim();

  if (rawWf) {
    workflowStatus = rawWf as BusinessCase["workflow_status"];
  } else if (rawStatus === "Pending Approval") {
    if (doc.finance_status === "Approved") {
      workflowStatus = doc.legal_status === "Approved" ? "Pending Procurement" : "Pending Legal Review";
    } else {
      workflowStatus = "Pending Finance Review";
    }
  } else if (rawStatus === "Approved") {
    workflowStatus = "Procurement Ready";
  } else if (rawStatus === "Rejected") {
    workflowStatus = "Rejected";
  } else if (rawStatus === "Cancelled") {
    workflowStatus = "Cancelled";
  } else if (rawStatus === "Closed") {
    workflowStatus = "RFQ Created";
  } else {
    workflowStatus = "Draft";
  }

  // 2. Authoritative gate statuses from ERPNext fields
  let financeStatus: BusinessCase["finance_status"] = (doc.finance_status as BusinessCase["finance_status"]) || "Pending";
  let legalStatus: BusinessCase["legal_status"] = (doc.legal_status as BusinessCase["legal_status"]) || "Pending";

  // State consistency fallback only when ERPNext field was missing
  if (!doc.finance_status) {
    if (
      workflowStatus === "Pending Legal Review" ||
      workflowStatus === "Finance Approved" ||
      workflowStatus === "Pending Procurement" ||
      workflowStatus === "Procurement Ready" ||
      workflowStatus === "Approved - Ready for RFQ" ||
      workflowStatus === "RFQ Created"
    ) {
      financeStatus = "Approved";
    } else if (workflowStatus === "Revision Required - Finance") {
      financeStatus = "Revision Requested";
    } else {
      financeStatus = "Pending";
    }
  }

  if (!doc.legal_status) {
    if (
      workflowStatus === "Pending Procurement" ||
      workflowStatus === "Legal Approved" ||
      workflowStatus === "Procurement Ready" ||
      workflowStatus === "Approved - Ready for RFQ" ||
      workflowStatus === "RFQ Created"
    ) {
      legalStatus = "Approved";
    } else if (workflowStatus === "Revision Required - Legal") {
      legalStatus = "Revision Requested";
    } else {
      legalStatus = "Pending";
    }
  }

  // 3. Approval status
  let approvalStatus: BusinessCase["approval_status"] = "Pending Finance";
  if (workflowStatus === "Pending Legal Review" || (financeStatus === "Approved" && legalStatus === "Pending")) {
    approvalStatus = "Pending Legal";
  } else if (
    workflowStatus === "Pending Procurement" ||
    workflowStatus === "Procurement Ready" ||
    workflowStatus === "Approved - Ready for RFQ" ||
    workflowStatus === "RFQ Created" ||
    (financeStatus === "Approved" && legalStatus === "Approved")
  ) {
    approvalStatus = "Approved";
  } else if (workflowStatus === "Rejected" || financeStatus === "Rejected" || legalStatus === "Rejected") {
    approvalStatus = "Rejected";
  } else if (workflowStatus.startsWith("Revision Required") || financeStatus === "Revision Requested" || legalStatus === "Revision Requested") {
    approvalStatus = "Revision Required";
  }

  // 4. Parse approval history child rows strictly from ERPNext
  const rawHistory = Array.isArray(doc.approval_history) ? doc.approval_history : [];
  const approvalHistory: BusinessCaseApprovalHistory[] = rawHistory.map((row: any) => ({
    stage: row.stage || "Finance",
    approver: row.approver || "",
    role: row.user_role || row.role || "",
    user_role: row.user_role || row.role || "",
    action: row.action || row.status || "Approved",
    comments: row.comments || "",
    approved_on: row.approved_on || row.creation || "",
    revision_number: Number(row.revision_number) || 1,
    digital_signature: row.digital_signature || undefined,
    previous_state: row.previous_state || "",
    new_state: row.new_state || "",
    status: row.status || "Approved",
  }));

  // rfq_id: may be stored as `custom_rfq_id` or `rfq_id` — use whichever is present
  const rfqId = (doc.rfq_id as string) || (doc.custom_rfq_id as string) || "";

  // 5. Deterministic financial metrics
  const capex = Number(doc.capex) || Number(doc.budget) || Number(doc.total_budget) || Number(doc.total_investment) || 0;
  const opex = Number(doc.opex_year) || Number(doc.opex) || 0;
  const savings = Number(doc.expected_annual_savings) || Number(doc.expected_savings) || 0;
  const revInc = Number(doc.revenue_increase__year) || Number(doc.revenue_increase) || 0;
  const costAvoid = Number(doc.cost_avoidance__year) || Number(doc.cost_avoidance) || 0;
  const duration = Number(doc.project_duration) || 5;
  const discountRate = doc.discount_rate !== undefined && doc.discount_rate !== null ? Number(doc.discount_rate) : 10;

  const calc = calculateBusinessCaseFinancials({
    capex,
    opex,
    expected_annual_savings: savings,
    revenue_increase: revInc,
    cost_avoidance: costAvoid,
    project_duration: duration,
    discount_rate: discountRate,
  });

  return {
    ...doc,
    business_case_id: (doc.business_case_id as string) || (doc.name as string) || "",
    business_need_id: (doc.business_need_id as string) || (doc.business_need as string) || "",
    workflow_status: workflowStatus,
    finance_status: financeStatus,
    legal_status: legalStatus,
    finance_approved_by: (doc.finance_approved_by as string) || undefined,
    finance_approved_date: (doc.finance_approved_on as string) || (doc.finance_approved_date as string) || undefined,
    finance_comments: (doc.finance_comments as string) || undefined,
    legal_approved_by: (doc.legal_approved_by as string) || undefined,
    legal_approved_date: (doc.legal_approved_on as string) || (doc.legal_approved_date as string) || undefined,
    legal_comments: (doc.legal_comments as string) || undefined,
    rejection_reason: (doc.rejection_reason as string) || undefined,
    approval_status: approvalStatus,
    approval_history: approvalHistory,
    rfq_id: rfqId,
    is_locked: Boolean(doc.is_locked) || (financeStatus === "Approved" && legalStatus === "Approved"),
    revision_number: Number(doc.revision_number) || Number(doc.version) || 1,
    // Child table defaults
    financials: (doc.financials as BusinessCase["financials"]) || [],
    technical_requirements_list: (doc.technical_requirements_list as BusinessCase["technical_requirements_list"]) || [],
    risk_assessments: (doc.risk_assessments as BusinessCase["risk_assessments"]) || [],
    stakeholders: (doc.stakeholders as BusinessCase["stakeholders"]) || [],
    documents: (doc.documents as BusinessCase["documents"]) || [],
    supporting_documents: (doc.supporting_documents as BusinessCase["supporting_documents"]) || [],
    comments: (doc.comments as BusinessCase["comments"]) || [],
    // Deterministic Financials
    budget: calc.total_investment,
    currency: (doc.currency as string) || "USD",
    need_type: (doc.need_type as string) || "Direct",
    capex: calc.capex,
    opex: calc.opex,
    expected_savings: calc.expected_annual_savings,
    expected_annual_savings: calc.expected_annual_savings,
    revenue_increase: calc.revenue_increase,
    cost_avoidance: calc.cost_avoidance,
    project_duration: calc.project_duration,
    discount_rate: calc.discount_rate,
    total_investment: calc.total_investment,
    annual_gross_benefit: calc.annual_gross_benefit,
    annual_net_benefit: calc.annual_net_benefit,
    total_net_benefit: calc.total_net_benefit,
    net_project_gain: calc.net_project_gain,
    roi: calc.roi ?? 0,
    roi_formatted: calc.roi_formatted,
    npv: calc.npv,
    npv_formatted: calc.npv_formatted,
    irr: calc.irr ?? 0,
    irr_formatted: calc.irr_formatted,
    payback_period: calc.payback_period_formatted,
    payback_period_years: calc.payback_period_years,
    financial_calculation_status: (doc.financial_calculation_status as FinancialCalculationStatus) || calc.status,
    financial_calculation_message: (doc.financial_calculation_message as string) || calc.message,
    financial_calculated_at: (doc.financial_calculated_on as string) || (doc.financial_calculated_at as string) || calc.calculated_at,
    cash_flows: calc.cash_flows,
    // String defaults
    created_by: (doc.created_by as string) || (doc.owner as string) || "",
    created_date: (doc.created_date as string) || (doc.creation as string) || "",
    last_modified: (doc.last_modified as string) || (doc.modified as string) || "",
    business_justification:
      (doc.business_justification as string) ||
      (doc.justification as string) ||
      (doc.business_impact as string) ||
      (doc.expected_benefits as string) ||
      (doc.description as string) ||
      "",
    business_problem:
      (doc.business_problem as string) ||
      (doc.problem_statement as string) ||
      (doc.problem as string) ||
      (doc.description as string) ||
      "",
    current_situation: (doc.current_situation as string) || "",
    expected_outcome: (doc.expected_outcome as string) || (doc.expected_benefits as string) || "",
    business_objective:
      (doc.business_objective as string) ||
      (doc.expected_benefits as string) ||
      (doc.problem_statement as string) ||
      (doc.title as string) ||
      "",
    executive_summary:
      (doc.executive_summary as string) ||
      (doc.description as string) ||
      "",
    alternatives_considered:
      (doc.alternatives_considered as string) ||
      "Status quo vs. commercial procurement alternatives evaluated.",
    recommendation:
      (doc.recommendation as string) ||
      `Proceed with commercial procurement per Business Case ${doc.name || ""}.`,
    financial_risk: (doc.financial_risk as BusinessCase["financial_risk"]) || "Not Assessed",
    technical_requirements: (doc.technical_requirements as string) || formatTechnicalRequirementsSummary(doc.technical_requirements_list as BusinessCase["technical_requirements_list"]),
    procurement_strategy: (doc.procurement_strategy as string) || "",
  } as BusinessCase;
}



// ── BUSINESS NEED — READ ────────────────────────────────────────────────────

const BN_LIST_FIELDS = [
  "name",
  "data_acff",
  "title",
  "status",
  "department",
  "requester",
  "business_owner",
  "priority",
  "need_type",
  "estimated_budget",
  "currency",
  "required_by_date",
  "company",
  "project",
  "plant",
  "creation",
  "modified",
  "owner",
  "business_case",
].join(",");

/** Fetch all Business Needs from ERPNext (with optional server-side filters). */
export async function fetchBusinessNeedsFromErp(filters?: {
  department?: string;
  status?: string;
  priority?: string;
  need_type?: string;
  project?: string;
  plant?: string;
}): Promise<BusinessNeed[]> {
  try {
    const params: Record<string, string | number> = {
      fields: `["${BN_LIST_FIELDS.split(",").join('","')}"]`,
      limit_page_length: 200,
      order_by: "creation desc",
    };

    const frappeFilters: [string, string, string][] = [];
    if (filters?.department)
      frappeFilters.push(["department", "=", filters.department]);
    if (filters?.status)
      frappeFilters.push(["status", "=", filters.status]);
    if (filters?.priority)
      frappeFilters.push(["priority", "=", filters.priority]);
    if (filters?.need_type)
      frappeFilters.push(["need_type", "=", filters.need_type]);
    if (filters?.project)
      frappeFilters.push(["project", "=", filters.project]);
    if (filters?.plant)
      frappeFilters.push(["plant", "=", filters.plant]);

    if (frappeFilters.length > 0) {
      params.filters = JSON.stringify(frappeFilters);
    }

    const raw = await apiGet<unknown>(buildResourceUrl(BN_DOCTYPE), { params });
    const list = extractList<Record<string, unknown>>(raw);
    return list.map(normalizeNeed);
  } catch (err) {
    rethrowErpError(err, "fetch Business Needs");
  }
}

export interface ErpFileRecord {
  name: string;
  file_name: string;
  file_url: string;
  file_size?: number;
  attached_to_doctype?: string;
  attached_to_name?: string;
  is_private?: number | boolean;
  creation?: string;
  modified?: string;
}

/** Fetch all File records attached to a specific document in ERPNext. */
export async function fetchAttachedFilesFromErp(
  doctype: string,
  docname: string,
): Promise<IntakeAttachment[]> {
  if (!doctype || !docname) return [];
  try {
    const rows = await apiGet<ErpFileRecord[]>(
      buildResourceUrl("File"),
      {
        params: {
          fields: JSON.stringify([
            "name",
            "file_name",
            "file_url",
            "file_size",
            "attached_to_doctype",
            "attached_to_name",
            "is_private",
            "creation",
            "modified",
          ]),
          filters: JSON.stringify([
            ["attached_to_doctype", "=", doctype],
            ["attached_to_name", "=", docname],
            ["is_folder", "=", 0],
          ]),
          limit_page_length: 100,
          order_by: "creation asc",
        },
      },
    );
    const list = extractList<ErpFileRecord>(rows);
    return list.map((f) => {
      const ext = (f.file_name || f.file_url || "").split(".").pop()?.toUpperCase() || "FILE";
      const sizeBytes = Number(f.file_size) || 0;
      let formattedSize = "0 B";
      if (sizeBytes < 1024) formattedSize = `${sizeBytes} B`;
      else if (sizeBytes < 1024 * 1024) formattedSize = `${(sizeBytes / 1024).toFixed(1)} KB`;
      else formattedSize = `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;

      return {
        name: f.file_name || f.file_url.split("/").pop() || "Document",
        url: getFullFileUrl(f.file_url),
        size: formattedSize,
        date: f.creation?.split(" ")[0] || f.modified?.split(" ")[0] || new Date().toISOString().split("T")[0],
        type: ext,
        file_id: f.name,
        signature_required: Boolean((f as any).signature_required || (f as any).custom_signature_required),
        signature_status: ((f as any).signature_status || (f as any).custom_signature_status || ((f as any).signature_required ? "Pending" : "Not Required")) as any,
        signed_by: (f as any).signed_by,
        signed_at: (f as any).signed_at,
        document_hash: (f as any).document_hash || (f as any).custom_document_hash,
      };
    });
  } catch (err) {
    console.warn(`[BusinessIntakeErp] Could not fetch attached files for ${doctype} ${docname}:`, err);
    return [];
  }
}

/**
 * Propagate/link all File attachments from a source Business Need to a target Business Case.
 * The browser sends identifiers only. The trusted server endpoint reloads the
 * source File and both parents, verifies the relationship, and idempotently
 * creates a reference without duplicating the physical binary.
 */
export async function propagateBusinessNeedFilesToBusinessCase(
  businessNeedName: string,
  businessCaseName: string,
): Promise<IntakeAttachment[]> {
  if (!businessNeedName || !businessCaseName) return [];

  console.log(
    `[BusinessIntakeErp] Propagating attachments from Business Need "${businessNeedName}" to Business Case "${businessCaseName}"...`,
  );

  // 1. Fetch File records attached to Business Need
  let needFiles: ErpFileRecord[] = [];
  try {
    const res = await apiGet<ErpFileRecord[]>(buildResourceUrl("File"), {
      params: {
        fields: JSON.stringify(["name"]),
        filters: JSON.stringify([
          ["attached_to_doctype", "=", BN_DOCTYPE],
          ["attached_to_name", "=", businessNeedName],
          ["is_folder", "=", 0],
        ]),
        limit_page_length: 100,
      },
    });
    needFiles = extractList<ErpFileRecord>(res);
  } catch (err) {
    console.warn(`[BusinessIntakeErp] Failed to query files for Business Need ${businessNeedName}:`, err);
  }

  if (needFiles.length === 0) {
    console.log(`[BusinessIntakeErp] No files found attached to Business Need ${businessNeedName}`);
    return fetchAttachedFilesFromErp(BC_DOCTYPE, businessCaseName);
  }

  // 2. The server owns metadata, authorization, and duplicate detection.
  for (const file of needFiles) {
    try {
      console.log(`[BusinessIntakeErp] Linking persisted File "${file.name}" to Business Case ${businessCaseName}...`);
      await apiPost("/api/file-link-copy", {
        source_file_name: file.name,
        target_doctype: BC_DOCTYPE,
        target_docname: businessCaseName,
      });
      console.log(`[BusinessIntakeErp] Successfully linked persisted File "${file.name}" to Business Case ${businessCaseName}`);
    } catch (err) {
      console.warn(`[BusinessIntakeErp] Could not link persisted File "${file.name}" to Business Case:`, err);
    }
  }

  // 3. Return the complete, updated list of attachments for the Business Case
  return fetchAttachedFilesFromErp(BC_DOCTYPE, businessCaseName);
}

/** Fetch a single Business Need by its ERPNext name (e.g. "BN-2026-00001") with all attached files. */
export async function fetchBusinessNeedByIdFromErp(
  name: string,
): Promise<BusinessNeed | null> {
  try {
    const raw = await apiGet<Record<string, unknown>>(buildResourceUrl(BN_DOCTYPE, name));
    // Frappe wraps single-doc GET in { data: ... } — unwrap if needed
    const doc = (raw as { data?: Record<string, unknown> })?.data ?? raw;
    if (!doc || !doc.name) return null;

    // Fetch real File records attached to this Business Need from ERPNext
    const attachedFiles = await fetchAttachedFilesFromErp(BN_DOCTYPE, name);
    doc.attachments = attachedFiles;
    doc.business_need_documents = attachedFiles.map((f) => ({
      document_type: "Specification" as any,
      file: f.url || "",
      description: f.name,
      uploaded_by: (doc.requester as string) || (doc.owner as string) || "",
      uploaded_date: f.date || "",
      version: "1.0",
    }));

    return normalizeNeed(doc);
  } catch (err) {
    const e = err as { response?: { status?: number } };
    if (e?.response?.status === 404) return null;
    rethrowErpError(err, `fetch Business Need ${name}`);
  }
}

// ── LINK FIELD RESOLUTION HELPERS ──────────────────────────────────────────

/** Helper: Verify if a Department exists in ERPNext, or resolve to a valid company department */
async function resolveDepartmentLink(deptName?: string, companyName = "Netlink"): Promise<string | null> {
  if (!deptName?.trim()) return null;
  const cleanName = deptName.trim();

  // 1. Try exact name match
  try {
    const res = await apiGet<{ name: string }[]>(buildResourceUrl("Department"), {
      params: {
        filters: JSON.stringify([["name", "=", cleanName]]),
        fields: JSON.stringify(["name"]),
        limit_page_length: 1,
      },
    });
    const list = extractList<{ name: string }>(res);
    if (list.length > 0 && list[0].name) return list[0].name;
  } catch {}

  // 2. Try department_name match
  try {
    const res = await apiGet<{ name: string }[]>(buildResourceUrl("Department"), {
      params: {
        filters: JSON.stringify([["department_name", "=", cleanName]]),
        fields: JSON.stringify(["name"]),
        limit_page_length: 1,
      },
    });
    const list = extractList<{ name: string }>(res);
    if (list.length > 0 && list[0].name) return list[0].name;
  } catch {}

  // 3. Try fuzzy/like match by core keyword (e.g. IT, Operations, Research, Accounts, etc.)
  const keywords = cleanName.split(/[\s,&-]+/).filter((w) => w.length > 2);
  for (const kw of keywords) {
    try {
      const res = await apiGet<{ name: string }[]>(buildResourceUrl("Department"), {
        params: {
          filters: JSON.stringify([["name", "like", `%${kw}%`]]),
          fields: JSON.stringify(["name"]),
          limit_page_length: 1,
        },
      });
      const list = extractList<{ name: string }>(res);
      if (list.length > 0 && list[0].name) return list[0].name;
    } catch {}
  }

  // 4. Fallback to first available department for company
  try {
    const res = await apiGet<{ name: string }[]>(buildResourceUrl("Department"), {
      params: {
        filters: JSON.stringify([["company", "=", companyName]]),
        fields: JSON.stringify(["name"]),
        limit_page_length: 1,
      },
    });
    const list = extractList<{ name: string }>(res);
    if (list.length > 0 && list[0].name) return list[0].name;
  } catch {}

  // 5. Fallback to any active department in ERPNext
  try {
    const res = await apiGet<{ name: string }[]>(buildResourceUrl("Department"), {
      params: {
        fields: JSON.stringify(["name"]),
        limit_page_length: 1,
      },
    });
    const list = extractList<{ name: string }>(res);
    if (list.length > 0 && list[0].name) return list[0].name;
  } catch {}

  return null;
}

/** Helper: Verify or fetch a valid Employee ID in ERPNext to satisfy mandatory Link fields */
async function resolveEmployeeLink(empInput?: string): Promise<string> {
  if (empInput?.trim()) {
    const clean = empInput.trim();
    // 1. Try by name (e.g. HR-EMP-00001)
    try {
      const res = await apiGet<{ name: string }[]>(buildResourceUrl("Employee"), {
        params: {
          filters: JSON.stringify([["name", "=", clean]]),
          fields: JSON.stringify(["name"]),
          limit_page_length: 1,
        },
      });
      const list = extractList<{ name: string }>(res);
      if (list.length > 0 && list[0].name) return list[0].name;
    } catch {}

    // 2. Try by user_id
    try {
      const res = await apiGet<{ name: string }[]>(buildResourceUrl("Employee"), {
        params: {
          filters: JSON.stringify([["user_id", "=", clean]]),
          fields: JSON.stringify(["name"]),
          limit_page_length: 1,
        },
      });
      const list = extractList<{ name: string }>(res);
      if (list.length > 0 && list[0].name) return list[0].name;
    } catch {}

    // 3. Try by employee_name
    try {
      const res = await apiGet<{ name: string }[]>(buildResourceUrl("Employee"), {
        params: {
          filters: JSON.stringify([["employee_name", "=", clean]]),
          fields: JSON.stringify(["name"]),
          limit_page_length: 1,
        },
      });
      const list = extractList<{ name: string }>(res);
      if (list.length > 0 && list[0].name) return list[0].name;
    } catch {}
  }

  // Fetch first active Employee
  try {
    const listRes = await apiGet<{ name: string }[]>(buildResourceUrl("Employee"), {
      params: {
        fields: JSON.stringify(["name"]),
        limit_page_length: 1,
      },
    });
    const list = extractList<{ name: string }>(listRes);
    if (list.length > 0 && list[0].name) return list[0].name;
  } catch {}

  // If no Employee exists at all, auto-create standard HR-EMP-00001
  try {
    const created = await apiPost<{ message?: { name: string }; name?: string }>(
      "/api/method/frappe.client.save",
      {
        doc: {
          doctype: "Employee",
          first_name: "Department User",
          status: "Active",
          company: COMPANY || "Netlink",
          gender: "Male",
          date_of_birth: "1990-01-01",
          date_of_joining: "2024-01-01",
        },
      },
    );
    const saved = (created as { message?: { name: string } })?.message ?? created;
    if (saved && saved.name) return saved.name;
  } catch (e) {
    console.warn("[BusinessIntake] Could not auto-create fallback Employee record:", e);
  }
  return "HR-EMP-00001";
}

export async function getERPNextCompanies(): Promise<{ name: string; company_name: string; abbr: string; default_currency: string }[]> {
  try {
    const res = await apiGet<{ name: string; company_name: string; abbr: string; default_currency: string }[]>(
      buildResourceUrl("Company"),
      {
        params: {
          fields: JSON.stringify(["name", "company_name", "abbr", "default_currency"]),
          limit_page_length: 100,
        },
      }
    );
    return extractList(res);
  } catch (err) {
    console.error("[BusinessIntake] Failed to load ERPNext companies:", err);
    throw new ErpIntakeError(500, "Unable to load companies from ERPNext. Please try again.");
  }
}

// ── BUSINESS NEED — WRITE ───────────────────────────────────────────────────

/**
 * Create a Business Need in ERPNext via frappe.client.save.
 *
 * FILE ATTACHMENT LIFECYCLE
 * ─────────────────────────
 * Files uploaded in the modal are ORPHAN uploads (attached_to_name="").
 * After the Business Need is created and receives a real ERPNext name
 * (e.g. "BN-2026-00001"), we re-link each File record here via
 * PATCH /api/resource/File/<file_id> { attached_to_doctype, attached_to_name }.
 */
export async function createBusinessNeedInErp(
  input: CreateBusinessNeedInput,
  userEmail: string,
): Promise<BusinessNeed> {
  console.log("[BusinessNeed] SUBMIT START");

  // 1. VERIFY USER & COMPANY
  const requesterEmail = input.requester || userEmail;
  const companyName = input.company || COMPANY || "Netlink";

  console.log(`[BusinessNeed] VERIFYING USER: ${requesterEmail}`);
  try {
    const userRes = await apiGet<{ name: string }[]>(buildResourceUrl("User"), {
      params: {
        filters: JSON.stringify([["name", "=", requesterEmail]]),
        fields: JSON.stringify(["name"]),
        limit_page_length: 1,
      },
    });
    const userList = extractList<{ name: string }>(userRes);
    if (userList.length === 0) {
      throw new ErpIntakeError(400, "Your ERPNext user account could not be found. Please contact the administrator.");
    }
  } catch (err: any) {
    if (err instanceof ErpIntakeError) throw err;
    console.warn("[BusinessNeed] User verification failed:", err);
  }

  console.log(`[BusinessNeed] VERIFYING COMPANY: ${companyName}`);
  try {
    const compRes = await apiGet<{ name: string }[]>(buildResourceUrl("Company"), {
      params: {
        filters: JSON.stringify([["name", "=", companyName]]),
        fields: JSON.stringify(["name"]),
        limit_page_length: 1,
      },
    });
    const compList = extractList<{ name: string }>(compRes);
    if (compList.length === 0) {
      throw new ErpIntakeError(400, `The company "${companyName}" does not exist in ERPNext.`);
    }
  } catch (err: any) {
    if (err instanceof ErpIntakeError) throw err;
    console.warn("[BusinessNeed] Company verification failed:", err);
  }

  console.log("[BusinessNeed] VALIDATION PASSED");

  const pendingAttachments = input.attachments || [];

  console.log(`[BusinessNeed] PENDING ATTACHMENTS: ${pendingAttachments.length}`);

  // Resolve Link fields safely so Frappe LinkValidationError never occurs
  const validDept = await resolveDepartmentLink(input.department, companyName);
  const validEmp = await resolveEmployeeLink(input.business_owner);

  const doc: Record<string, unknown> = {
    doctype: BN_DOCTYPE,
    data_acff: input.title || "Business Need",
    title: new Date().toISOString().split("T")[0],
    description: input.description || input.problem_statement || "",
    need_type: input.need_type,
    priority: input.priority,
    requirement_category: input.requirement_category || "",
    requirement_type: input.requirement_type || "",
    status: "Draft",
    company: companyName,
    department: validDept,
    business_unit: input.business_unit || "",
    plant: input.plant || input.plant_location || "",
    cost_center: input.cost_center || "",
    project: input.project || input.project_name || "",
    project_code: input.project_code || "",
    program: input.program || input.program_name || "",
    business_area: input.business_area || "",
    requester: requesterEmail,
    requester_email: requesterEmail,
    business_owner: validEmp,
    business_owner_email: input.business_owner_email || requesterEmail,
    required_by_date: input.required_by_date || null,
    expected_completion_date: input.expected_completion_date || null,
    current_situation: input.current_situation || "",
    problem_statement: input.problem_statement || input.description || "",
    business_problem: input.business_problem || input.problem_statement || input.description || "",
    business_impact: input.business_impact || "",
    business_justification:
      input.business_justification ||
      input.business_impact ||
      input.expected_benefits ||
      input.description ||
      "",
    customer_impact: input.customer_impact || "",
    operational_impact: input.operational_impact || "",
    expected_benefits: input.expected_benefits || "",
    expected_outcome: input.expected_outcome || input.expected_benefits || "",
    business_objective: input.business_objective || input.expected_benefits || input.problem_statement || input.title || "",
    executive_summary: input.executive_summary || input.description || `Business Need: ${input.title || "Intake"}`,
    strategic_importance: input.strategic_importance || "",
    consequences_of_not_proceeding: input.consequences_of_not_proceeding || "",
    estimated_budget: input.estimated_budget,
    estimated_quantity: input.estimated_quantity || 1,
    currency: input.currency || "USD",
    budget_type: input.budget_type || "CAPEX",
    funding_source: input.funding_source || "",
    technical_requirements_list: input.technical_requirements_list || [],
    technical_requirements: input.technical_requirements || formatTechnicalRequirementsSummary(input.technical_requirements_list),
  };

  console.log("[BusinessNeed] CREATING ERPNext BUSINESS NEED");

  let saved: Record<string, unknown>;
  try {
    const created = await apiPost<{ message?: Record<string, unknown> } | Record<string, unknown>>(
      "/api/method/frappe.client.save",
      { doc },
    );
    saved =
      (created as { message?: Record<string, unknown> })?.message ??
      (created as Record<string, unknown>);
  } catch (err) {
    rethrowErpError(err, "create Business Need");
  }

  const bnName = String(saved!.name || "").trim();
  if (!bnName) {
    console.error("[BusinessNeed] CREATE RESPONSE: Missing document name", saved);
    throw new ErpIntakeError(
      500,
      "Unable to create Business Need. Please try again.",
    );
  }

  console.log(`[BusinessNeed] CREATE RESPONSE: 200`);
  console.log(`[BusinessNeed] ERPNext BUSINESS NEED NAME: ${bnName}`);

  // ── STEP 5: VERIFY DOCUMENT EXISTS ───────────────────────────────────────
  console.log(`[BusinessNeed] VERIFYING DOCUMENT: ${bnName}`);
  const verifiedDoc = await fetchBusinessNeedByIdFromErp(bnName);
  if (!verifiedDoc) {
    console.error(`[BusinessNeed] Verification failed for document ${bnName}`);
    throw new ErpIntakeError(
      500,
      "Unable to create Business Need. Document verification failed.",
    );
  }
  console.log("[BusinessNeed] DOCUMENT VERIFIED");

  // ── STEP 6: LINK ATTACHMENTS ─────────────────────────────────────────────
  if (pendingAttachments.length > 0) {
    console.log("[BusinessNeed] LINKING ATTACHMENTS");
  }

  const attachmentErrors: string[] = [];
  for (const att of pendingAttachments) {
    if (!att.rawFile) continue;
    try {
      await uploadFileToERPNextDetailed(
        att.rawFile,
        BN_DOCTYPE,
        bnName,
        { isPrivate: true }
      );
      console.log(`[BusinessNeed] ATTACHMENT UPLOADED: ${att.name}`);
    } catch (err) {
      console.warn(
        `[BusinessNeed] Failed to upload attachment "${att.name}":`,
        err,
      );
      attachmentErrors.push(att.name);
    }
  }

  console.log("[BusinessNeed] ATTACHMENTS PROCESSED");

  // ── STEP 5: FETCH LATEST DOCUMENT AFTER ALL ATTACHMENTS/HOOKS ─────────────
  console.log(`[BusinessNeed] Fetching latest document after creation: ${bnName}`);
  const latestDoc = await fetchBusinessNeedByIdFromErp(bnName);
  if (!latestDoc) {
    console.error(`[BusinessNeed] Verification failed for document ${bnName}`);
    throw new ErpIntakeError(
      500,
      "Unable to create Business Need. Document verification failed.",
    );
  }
  console.log(`[BusinessNeed] DOCUMENT VERIFIED: ${bnName} (modified: ${latestDoc.last_modified})`);

  if (attachmentErrors.length > 0) {
    console.warn(
      `[BusinessNeed] ${attachmentErrors.length} attachment(s) could not be linked:`,
      attachmentErrors,
    );
    (latestDoc as any)._attachmentErrors = attachmentErrors;
  }

  return latestDoc;
}

/**
 * Safe helper to update a Business Need:
 * 1. Fetches the FRESH, LATEST document from ERPNext (never uses stale doc).
 * 2. Applies the requested field updates atomically using ERPNext set_value.
 * 3. Fetches the final persisted document from ERPNext.
 * 4. Includes bounded retry (max 3 attempts) with refetch on concurrency conflict.
 */
export async function updateBusinessNeedLatest(
  name: string,
  updates: Record<string, unknown>,
  maxRetries = 3,
): Promise<BusinessNeed> {
  let attempt = 0;
  while (attempt < maxRetries) {
    attempt++;
    try {
      // 1. Fetch fresh latest document from ERPNext
      const latest = await fetchBusinessNeedByIdFromErp(name);
      if (!latest) {
        throw new ErpIntakeNotFoundError(BN_DOCTYPE, name);
      }

      // Sanitize updates for Business Need schema in ERPNext
      const cleanUpdates: Record<string, unknown> = { ...updates };
      if (typeof cleanUpdates.title === "string" && cleanUpdates.title.trim()) {
        cleanUpdates.data_acff = cleanUpdates.title;
        // Do not pass non-date strings to the 'title' column in MySQL
        if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanUpdates.title.trim())) {
          delete cleanUpdates.title;
        }
      }
      if (cleanUpdates.department && typeof cleanUpdates.department === "string") {
        const resolvedDept = await resolveDepartmentLink(cleanUpdates.department as string);
        if (resolvedDept) cleanUpdates.department = resolvedDept;
      }
      if (cleanUpdates.business_owner && typeof cleanUpdates.business_owner === "string") {
        const resolvedEmp = await resolveEmployeeLink(cleanUpdates.business_owner as string);
        if (resolvedEmp) cleanUpdates.business_owner = resolvedEmp;
      }

      console.log(
        `[BusinessNeed] Updating ${name} (attempt ${attempt}/${maxRetries}, modified: ${latest.last_modified})`,
        cleanUpdates,
      );

      // 2. Perform atomic field update in ERPNext
      await apiPost<{ message?: Record<string, unknown> } | Record<string, unknown>>(
        "/api/method/frappe.client.set_value",
        {
          doctype: BN_DOCTYPE,
          name,
          fieldname: cleanUpdates,
        },
      );

      // 3. Refetch to return the final persisted ERPNext state
      const finalDoc = await fetchBusinessNeedByIdFromErp(name);
      if (finalDoc) {
        console.log(`[BusinessNeed] Updated ${name} successfully (final modified: ${finalDoc.last_modified})`);
        return finalDoc;
      }
      return latest;
    } catch (err: any) {
      const errMsg =
        err?.response?.data?.message ||
        err?.response?.data?.exc ||
        err?.message ||
        "";
      const isConcurrency =
        /has been modified after you have opened it|TimestampMismatchError/i.test(errMsg);

      if (isConcurrency && attempt < maxRetries) {
        console.warn(
          `[BusinessNeed] Concurrency conflict on ${name}, refetching latest document before retry (${attempt}/${maxRetries})...`,
        );
        await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
        continue;
      }

      rethrowErpError(err, `update Business Need ${name}`);
    }
  }

  throw new ErpIntakeError(
    500,
    `Unable to update Business Need ${name} after ${maxRetries} attempts due to concurrency conflicts. Please refresh and try again.`,
  );
}

/**
 * Submit a Business Need (docstatus 0→1 or status transition).
 * Always fetches the latest document first to prevent timestamp errors.
 */
export async function submitBusinessNeedInErp(
  name: string,
): Promise<BusinessNeed> {
  // 1. Fetch the latest document from ERPNext
  const latest = await fetchBusinessNeedByIdFromErp(name);
  if (!latest) {
    throw new ErpIntakeNotFoundError(BN_DOCTYPE, name);
  }

  try {
    const result = await apiPost<{ message?: BusinessNeed } | BusinessNeed>(
      "/api/method/frappe.client.submit",
      { doc: { doctype: BN_DOCTYPE, name, modified: latest.last_modified } },
    );
    const doc =
      (result as { message?: BusinessNeed })?.message ?? (result as BusinessNeed);
    const finalDoc = await fetchBusinessNeedByIdFromErp(name);
    return finalDoc || normalizeNeed(doc as unknown as Record<string, unknown>);
  } catch (err) {
    // If submit is not applicable (DocType is not submittable or no workflow), update status field atomically
    console.log(
      `[BusinessNeed] frappe.client.submit for ${name} fell back to atomic status update.`,
    );
    return updateBusinessNeedLatest(name, {
      status: "Submitted",
      workflow_state: "Submitted",
    });
  }
}

/** Update status field and extra fields on a Business Need via safe latest update helper. */
export async function updateBusinessNeedStatusInErp(
  name: string,
  status: string,
  extras: Record<string, unknown> = {},
): Promise<BusinessNeed> {
  return updateBusinessNeedLatest(name, {
    status,
    workflow_state: status,
    ...extras,
  });
}

// ── BUSINESS CASE — CREATE (auto-triggered from Business Need submit) ────────

/**
 * Create a Business Case in ERPNext, linked to the given Business Need.
 * Called automatically when a Department User submits a Business Need.
 */
export async function createBusinessCaseInErp(
  need: BusinessNeed,
): Promise<BusinessCase> {
  console.log("[BusinessNeed] CREATING BUSINESS CASE");

  const companyName = need.company || COMPANY || "Netlink";
  const validEmp = await resolveEmployeeLink(need.business_owner);
  const validDept = await resolveDepartmentLink(need.department, companyName);

  // Budget & Context Mapping (Business Need Estimated Budget -> CAPEX & Total Investment)
  const estBudget = Number(need.estimated_budget) || 0;
  const initialCalc = calculateBusinessCaseFinancials({
    capex: estBudget,
    opex: 0,
    expected_annual_savings: 0,
    revenue_increase: 0,
    cost_avoidance: 0,
    project_duration: 5,
    discount_rate: 10,
  });

  const needTitle = need.title || (need as any).data_acff || `Business Case for ${need.name}`;
  const needProblem = need.problem_statement || (need as any).business_problem || need.description || "";
  const needJustification =
    (need as { business_justification?: string }).business_justification ||
    need.expected_benefits ||
    need.business_impact ||
    needProblem ||
    `Fulfill requirement for ${needTitle}`;
  const needObjective =
    need.expected_benefits ||
    needProblem ||
    needTitle ||
    "Fulfill business requirement per intake specification.";
  const needExecutiveSummary =
    need.description ||
    needProblem ||
    `Business Case derived from Business Need ${need.name}: ${needTitle}`;

  const doc: Record<string, unknown> = {
    doctype: BC_DOCTYPE,
    business_need: need.name,
    title: needTitle,
    company: companyName,
    department: validDept,
    business_owner: validEmp,
    executive_summary: needExecutiveSummary,
    business_objective: needObjective,
    business_justification: needJustification,
    business_problem: needProblem,
    current_situation: need.current_situation || "",
    expected_outcome: need.expected_benefits || need.description || "",
    alternatives_considered:
      (need as { alternatives_considered?: string }).alternatives_considered ||
      "Status quo vs. commercial procurement alternatives evaluated.",
    recommendation:
      (need as { recommendation?: string }).recommendation ||
      `Proceed with commercial procurement per Business Need ${need.name}.`,
    budget: estBudget,
    total_budget: estBudget,
    estimated_budget: estBudget,
    capex: estBudget,
    total_investment: estBudget,
    opex: 0,
    opex_year: 0,
    expected_savings: 0,
    expected_annual_savings: 0,
    revenue_increase: 0,
    revenue_increase__year: 0,
    cost_avoidance: 0,
    cost_avoidance__year: 0,
    project_duration: 5,
    discount_rate: 10,
    annual_gross_benefit: initialCalc.annual_gross_benefit,
    annual_net_benefit: initialCalc.annual_net_benefit,
    total_net_benefit: initialCalc.total_net_benefit,
    net_project_gain: initialCalc.net_project_gain,
    roi: initialCalc.roi ?? 0,
    roi_formatted: initialCalc.roi_formatted,
    npv: initialCalc.npv,
    npv_formatted: initialCalc.npv_formatted,
    irr: initialCalc.irr ?? 0,
    irr_formatted: initialCalc.irr_formatted,
    payback_period: initialCalc.payback_period_years ?? 0,
    financial_calculation_status: initialCalc.status,
    financial_calculation_message: initialCalc.message,
    financial_calculated_on: formatFrappeDatetime(),
    currency: need.currency || "USD",
    priority: need.priority || "Medium",
    need_type: need.need_type || "Direct",
    technical_requirements_list: need.technical_requirements_list || [],
    technical_requirements: need.technical_requirements || formatTechnicalRequirementsSummary(need.technical_requirements_list),
    project: need.project || "",
    plant: need.plant || "",
    requester: need.requester || "",
    // Lifecycle and gates
    workflow_state: "Pending Finance Review",
    status: "Pending Approval",
    finance_status: "Pending",
    legal_status: "Pending",
    version: 1,
  };

  try {
    const created = await apiPost<{ message?: Record<string, unknown> } | Record<string, unknown>>(
      "/api/method/frappe.client.save",
      { doc },
    );
    const saved =
      (created as { message?: Record<string, unknown> })?.message ??
      (created as Record<string, unknown>);

    const bcName = String(saved.name || "").trim();
    console.log(`[BusinessNeed] BUSINESS CASE CREATED: ${bcName}`);
    console.log("[BusinessNeed] SUBMIT SUCCESS");

    // Insert initial submission approval history row
    await apiPost("/api/method/frappe.client.insert", {
      doc: {
        doctype: BC_APPROVAL_DOCTYPE,
        parenttype: BC_DOCTYPE,
        parent: bcName,
        parentfield: "approval_history",
        stage: "Department",
        action: "Submitted",
        previous_state: "Business Need Submitted",
        new_state: "Pending Finance Review",
        approver: need.requester === "department@netlink.com" ? "Administrator" : need.requester || "Administrator",
        role: "Department User",
        user_role: "Department User",
        status: "Pending",
        comments: `Business Need "${need.name}" submitted and Business Case created.`,
        approved_on: formatFrappeDatetime(),
        revision_number: 1,
      },
    }).catch((err) => {
      console.warn("[BusinessIntakeErp] Could not insert initial approval history row:", err);
    });

    return normalizeCase(saved);
  } catch (err) {
    rethrowErpError(err, "create Business Case");
  }
}

// ── BUSINESS CASE — READ ────────────────────────────────────────────────────

const BC_LIST_FIELDS = [
  "name",
  "title",
  "status",
  "workflow_state",
  "finance_status",
  "finance_approved_by",
  "finance_approved_on",
  "finance_comments",
  "legal_status",
  "legal_approved_by",
  "legal_approved_on",
  "legal_comments",
  "rfq_id",
  "custom_rfq_id",
  "department",
  "company",
  "business_need",
  "business_owner",
  "creation",
  "modified",
  "owner",
  "project",
  "plant",
  "capex",
  "total_investment",
  "roi",
  "npv",
  "irr",
  "payback_period",
  "financial_calculation_status",
  "rejection_reason",
  "version",
].join(",");

/**
 * Fetch Business Cases from ERPNext.
 */
export async function fetchBusinessCasesFromErp(filters?: {
  department?: string;
  status?: string;
  workflow_state?: string;
  finance_status?: string;
  legal_status?: string;
}): Promise<BusinessCase[]> {
  try {
    const params: Record<string, string | number> = {
      fields: `["${BC_LIST_FIELDS.split(",").join('","')}"]`,
      limit_page_length: 200,
      order_by: "creation desc",
    };

    const frappeFilters: [string, string, string][] = [];
    if (filters?.department)
      frappeFilters.push(["department", "=", filters.department]);
    if (filters?.status)
      frappeFilters.push(["status", "=", filters.status]);
    if (filters?.workflow_state)
      frappeFilters.push(["workflow_state", "=", filters.workflow_state]);
    if (filters?.finance_status)
      frappeFilters.push(["finance_status", "=", filters.finance_status]);
    if (filters?.legal_status)
      frappeFilters.push(["legal_status", "=", filters.legal_status]);

    if (frappeFilters.length > 0) {
      params.filters = JSON.stringify(frappeFilters);
    }

    const raw = await apiGet<unknown>(buildResourceUrl(BC_DOCTYPE), { params });
    const list = extractList<Record<string, unknown>>(raw);
    return list.map(normalizeCase);
  } catch (err) {
    rethrowErpError(err, "fetch Business Cases");
  }
}

/** Fetch a single Business Case with all child tables and attached files. */
export async function fetchBusinessCaseByIdFromErp(
  name: string,
): Promise<BusinessCase | null> {
  try {
    const raw = await apiGet<Record<string, unknown>>(buildResourceUrl(BC_DOCTYPE, name));
    const doc = (raw as { data?: Record<string, unknown> })?.data ?? raw;
    if (!doc || !doc.name) return null;

    // 1. Fetch File records directly attached to this Business Case in ERPNext
    const attachedFiles = await fetchAttachedFilesFromErp(BC_DOCTYPE, name);

    // 2. If this Business Case is linked to a Business Need, ensure source attachments & financial parity
    const linkedNeedId = String(doc.business_need || doc.business_need_id || "").trim();
    if (linkedNeedId) {
      try {
        const linkedNeed = await fetchBusinessNeedByIdFromErp(linkedNeedId);
        if (linkedNeed) {
          const curBudget = Number(doc.budget) || Number(doc.total_budget) || Number(doc.estimated_budget) || 0;
          if (curBudget <= 0 && linkedNeed.estimated_budget > 0) {
            doc.budget = linkedNeed.estimated_budget;
            doc.total_budget = linkedNeed.estimated_budget;
            doc.estimated_budget = linkedNeed.estimated_budget;
          }
          if (!doc.currency && linkedNeed.currency) doc.currency = linkedNeed.currency;
          if (!doc.department && linkedNeed.department) doc.department = linkedNeed.department;
          if (!doc.company && linkedNeed.company) doc.company = linkedNeed.company;
          if (!doc.project && linkedNeed.project) doc.project = linkedNeed.project;
          if (!doc.plant && linkedNeed.plant) doc.plant = linkedNeed.plant;
          if (!doc.requester && linkedNeed.requester) doc.requester = linkedNeed.requester;
          if (!doc.need_type && linkedNeed.need_type) doc.need_type = linkedNeed.need_type;
          if (!doc.priority && linkedNeed.priority) doc.priority = linkedNeed.priority;

          const needProblem = (linkedNeed.problem_statement || linkedNeed.description || "").trim();
          const needJustification = (
            (linkedNeed as { business_justification?: string }).business_justification ||
            linkedNeed.expected_benefits ||
            linkedNeed.business_impact ||
            linkedNeed.description ||
            ""
          ).trim();

          const backfillPatch: Record<string, unknown> = {};
          if (!doc.business_problem && needProblem) {
            doc.business_problem = needProblem;
            backfillPatch.business_problem = needProblem;
          }
          if (!doc.business_justification && needJustification) {
            doc.business_justification = needJustification;
            backfillPatch.business_justification = needJustification;
          }
          if (!doc.current_situation && linkedNeed.current_situation) {
            doc.current_situation = linkedNeed.current_situation;
            backfillPatch.current_situation = linkedNeed.current_situation;
          }
          if (!doc.expected_outcome && (linkedNeed.expected_benefits || linkedNeed.description)) {
            doc.expected_outcome = linkedNeed.expected_benefits || linkedNeed.description;
            backfillPatch.expected_outcome = doc.expected_outcome;
          }
          if (!doc.business_objective && (linkedNeed.expected_benefits || linkedNeed.problem_statement || linkedNeed.title)) {
            doc.business_objective = linkedNeed.expected_benefits || linkedNeed.problem_statement || linkedNeed.title;
            backfillPatch.business_objective = doc.business_objective;
          }
          if (!doc.executive_summary && (linkedNeed.description || linkedNeed.title)) {
            doc.executive_summary = linkedNeed.description || `Derived from Business Need ${linkedNeed.name}: ${linkedNeed.title}`;
            backfillPatch.executive_summary = doc.executive_summary;
          }

          if (Object.keys(backfillPatch).length > 0) {
            void apiPost("/api/method/frappe.client.set_value", {
              doctype: BC_DOCTYPE,
              name: name,
              fieldname: backfillPatch,
            }).catch(() => {});
          }
        }
      } catch (err) {
        console.warn(`[BusinessIntakeErp] Could not load linked need ${linkedNeedId}:`, err);
      }

      const needFiles = await fetchAttachedFilesFromErp(BN_DOCTYPE, linkedNeedId);
      const existingNames = new Set(attachedFiles.map((f) => f.name));
      const missingFiles = needFiles.filter((f) => !existingNames.has(f.name));

      if (missingFiles.length > 0) {
        void propagateBusinessNeedFilesToBusinessCase(linkedNeedId, name);
      }

      for (const f of needFiles) {
        if (!existingNames.has(f.name)) {
          existingNames.add(f.name);
          attachedFiles.push(f);
        }
      }
    }

    doc.supporting_documents = attachedFiles;
    doc.documents = attachedFiles;

    return normalizeCase(doc);
  } catch (err) {
    const e = err as { response?: { status?: number } };
    if (e?.response?.status === 404) return null;
    rethrowErpError(err, `fetch Business Case ${name}`);
  }
}

/**
 * Fetch Business Cases in Procurement queue (Pending Procurement or Procurement Ready).
 */
export async function fetchPendingBusinessCasesFromErp(): Promise<BusinessCase[]> {
  try {
    const params: Record<string, string | number> = {
      fields: `["${BC_LIST_FIELDS.split(",").join('","')}"]`,
      limit_page_length: 200,
      order_by: "creation desc",
    };

    const raw = await apiGet<unknown>(buildResourceUrl(BC_DOCTYPE), { params });
    const list = extractList<Record<string, unknown>>(raw).map(normalizeCase);
    return list.filter(
      (c) =>
        c.workflow_status === "Procurement Ready" ||
        c.workflow_status === "Pending Procurement" ||
        c.workflow_status === "Approved - Ready for RFQ",
    );
  } catch (err) {
    rethrowErpError(err, "fetch Pending Business Cases");
  }
}

// ── BUSINESS CASE — STATUS UPDATES ──────────────────────────────────────────

/**
 * Update a Business Case's status fields + add an Approval History child row.
 * Used by Finance, Legal, and Procurement actions.
 */
async function updateBusinessCaseStatus(
  name: string,
  statusFields: Record<string, unknown>,
  historyEntry?: Omit<BusinessCaseApprovalHistory, "id"> & { name?: string },
  incrementRevision = false,
): Promise<BusinessCase> {
  // 1. Fetch current to get version
  let currentVersion = 1;
  try {
    const raw = await apiGet<Record<string, unknown>>(buildResourceUrl(BC_DOCTYPE, name));
    const doc = (raw as { data?: Record<string, unknown> })?.data ?? raw;
    currentVersion = Number(doc.version) || Number(doc.revision_number) || 1;
  } catch {
    // Ignore fetch error
  }

  if (incrementRevision) {
    currentVersion += 1;
    statusFields.version = currentVersion;
    statusFields.revision_number = currentVersion;
  }

  // 2. Update status and workflow fields on the parent doc atomically
  await apiPost("/api/method/frappe.client.set_value", {
    doctype: BC_DOCTYPE,
    name: name,
    fieldname: statusFields,
  }).catch((err) => rethrowErpError(err, `update Business Case ${name}`));

  // 3. Add approval history child row only after successful parent update
  if (historyEntry) {
    const approverUser = historyEntry.approver || "Administrator";
    const approvedOn = historyEntry.approved_on || formatFrappeDatetime();

    await apiPost("/api/method/frappe.client.insert", {
      doc: {
        doctype: BC_APPROVAL_DOCTYPE,
        parenttype: BC_DOCTYPE,
        parent: name,
        parentfield: "approval_history",
        stage: historyEntry.stage || "Finance",
        approver: approverUser,
        role: historyEntry.role || historyEntry.user_role || "Finance Manager",
        status: historyEntry.status || (historyEntry.action === "Rejected" ? "Rejected" : "Approved"),
        comments: historyEntry.comments || "",
        approved_on: approvedOn,
      },
    }).catch((err) => {
      console.error("[BusinessIntakeErp] Failed to insert approval history row into ERPNext:", err);
      rethrowErpError(err, `insert approval history for Business Case ${name}`);
    });
  }

  const finalDoc = await fetchBusinessCaseByIdFromErp(name);
  if (!finalDoc) throw new Error(`Could not fetch updated Business Case "${name}"`);
  return finalDoc;
}

// ── FINANCE GATE VALIDATION & APPROVAL ACTIONS ───────────────────────────────

/**
 * Update and persist financial assumptions and deterministically calculated metrics to ERPNext.
 */
export async function saveBusinessCaseFinancialsInErp(
  caseId: string,
  input: FinancialAssumptionsInput,
): Promise<BusinessCase> {
  const calc = calculateBusinessCaseFinancials(input);
  if (calc.status === "Invalid") {
    throw new ErpIntakeError(400, `Invalid financial assumptions: ${calc.errors.join(", ")}`);
  }

  const latestRaw = await apiGet<Record<string, unknown>>(buildResourceUrl(BC_DOCTYPE, caseId));
  const latestDoc = (latestRaw as { data?: Record<string, unknown> })?.data ?? latestRaw;
  if (!latestDoc || !latestDoc.name) {
    throw new ErpIntakeNotFoundError(BC_DOCTYPE, caseId);
  }

  const fieldname: Record<string, unknown> = {
    capex: calc.capex,
    total_investment: calc.total_investment,
    budget: calc.total_investment,
    total_budget: calc.total_investment,
    opex_year: calc.opex,
    expected_annual_savings: calc.expected_annual_savings,
    revenue_increase__year: calc.revenue_increase,
    cost_avoidance__year: calc.cost_avoidance,
    project_duration: calc.project_duration,
    discount_rate: calc.discount_rate,
    annual_gross_benefit: calc.annual_gross_benefit,
    annual_net_benefit: calc.annual_net_benefit,
    total_net_benefit: calc.total_net_benefit,
    net_project_gain: calc.net_project_gain,
    roi: calc.roi ?? 0,
    npv: calc.npv,
    irr: calc.irr ?? 0,
    payback_period: calc.payback_period_years ?? 0,
    financial_calculation_status: calc.status,
    financial_calculation_message: calc.message,
    financial_calculated_on: formatFrappeDatetime(),
  };

  try {
    await apiPost("/api/method/frappe.client.set_value", {
      doctype: BC_DOCTYPE,
      name: caseId,
      fieldname,
    });

    const updated = await fetchBusinessCaseByIdFromErp(caseId);
    if (!updated) throw new ErpIntakeNotFoundError(BC_DOCTYPE, caseId);
    return updated;
  } catch (err) {
    rethrowErpError(err, `save financial assumptions for Business Case ${caseId}`);
  }
}

/**
 * Authoritative Finance Gate Validator.
 */
export async function validateFinanceGateInErp(
  caseOrId: string | BusinessCase,
  checklist?: Partial<FinanceChecklistState>,
): Promise<FinanceGateValidationResult> {
  const blockers: FinanceGateBlocker[] = [];

  const businessCase =
    typeof caseOrId === "string"
      ? await fetchBusinessCaseByIdFromErp(caseOrId)
      : caseOrId;

  if (!businessCase) {
    return {
      canApprove: false,
      blockers: [{ code: "NOT_FOUND", message: `Business Case "${typeof caseOrId === "string" ? caseOrId : "Unknown"}" was not found in ERPNext.` }],
    };
  }

  // 1. Workflow state check
  const allowedWorkflowStates = ["Pending Approval", "Pending Finance Review", "Draft"];
  if (!allowedWorkflowStates.includes(businessCase.workflow_status)) {
    blockers.push({
      code: "INVALID_WORKFLOW_STATE",
      message: `Business Case is in "${businessCase.workflow_status}" status. Only cases pending Finance Review can be approved.`,
    });
  }

  // 2. Financial inputs & calculation status validation
  if (businessCase.capex === undefined || businessCase.capex === null || businessCase.capex < 0) {
    blockers.push({
      code: "MISSING_CAPEX",
      message: "CAPEX (Initial Investment) has not been provided or is invalid.",
      field: "capex",
    });
  }
  if (!businessCase.budget || businessCase.budget <= 0) {
    blockers.push({
      code: "MISSING_BUDGET",
      message: "Total Budget has not been provided or must be greater than zero.",
      field: "budget",
    });
  }
  if (businessCase.project_duration === undefined || businessCase.project_duration === null || businessCase.project_duration <= 0) {
    blockers.push({
      code: "MISSING_DURATION",
      message: "Project Duration is missing or invalid (must be >= 1 year).",
      field: "project_duration",
    });
  }
  if (businessCase.discount_rate === undefined || businessCase.discount_rate === null || businessCase.discount_rate < 0 || businessCase.discount_rate > 100) {
    blockers.push({
      code: "MISSING_DISCOUNT_RATE",
      message: "Discount Rate is missing or invalid (must be between 0% and 100%).",
      field: "discount_rate",
    });
  }
  if (businessCase.financial_calculation_status === "Incomplete" || businessCase.financial_calculation_status === "Invalid") {
    blockers.push({
      code: "FINANCIAL_CALC_INCOMPLETE",
      message: `Financial calculations are ${businessCase.financial_calculation_status.toLowerCase()}: ${businessCase.financial_calculation_message || "please check financial inputs"}.`,
      field: "financial_calculation_status",
    });
  }

  // 3. Business Problem & Business Justification validation
  if ((!businessCase.business_problem?.trim() || !businessCase.business_justification?.trim()) && businessCase.business_need_id) {
    try {
      const linkedNeed = await fetchBusinessNeedByIdFromErp(businessCase.business_need_id);
      if (linkedNeed) {
        let needsSave = false;
        const syncPatch: Record<string, unknown> = {};

        const needProblem = (linkedNeed.problem_statement || linkedNeed.description || "").trim();
        const needJustification = (
          (linkedNeed as { business_justification?: string }).business_justification ||
          linkedNeed.expected_benefits ||
          linkedNeed.business_impact ||
          linkedNeed.description ||
          ""
        ).trim();

        if (!businessCase.business_problem?.trim() && needProblem) {
          businessCase.business_problem = needProblem;
          syncPatch.business_problem = needProblem;
          needsSave = true;
        }

        if (!businessCase.business_justification?.trim() && needJustification) {
          businessCase.business_justification = needJustification;
          syncPatch.business_justification = needJustification;
          needsSave = true;
        }

        if (needsSave) {
          void apiPost("/api/method/frappe.client.set_value", {
            doctype: BC_DOCTYPE,
            name: businessCase.business_case_id,
            fieldname: syncPatch,
          }).catch(() => {});
        }
      }
    } catch (err) {
      console.warn("[FinanceGate] Could not load linked Business Need for validation fallback:", err);
    }
  }

  const missingIntakeInfo: string[] = [];
  if (!businessCase.business_problem?.trim()) {
    missingIntakeInfo.push("Business Problem");
  }
  if (!businessCase.business_justification?.trim()) {
    missingIntakeInfo.push("Business Justification");
  }
  if (missingIntakeInfo.length > 0) {
    let msg = "";
    if (missingIntakeInfo.includes("Business Problem") && missingIntakeInfo.includes("Business Justification")) {
      msg = "Business Problem and Business Justification are required.";
    } else if (missingIntakeInfo.includes("Business Justification")) {
      msg = "Business Justification is required.";
    } else {
      msg = "Business Problem is required.";
    }
    blockers.push({
      code: "INCOMPLETE_JUSTIFICATION",
      message: msg,
      field: missingIntakeInfo.length === 1 ? missingIntakeInfo[0].toLowerCase().replace(" ", "_") : "business_justification",
    });
  }

  // 4. Required documents check
  const docs = businessCase.supporting_documents || [];
  for (const doc of docs) {
    if (doc.signature_required && doc.signature_status === "Pending") {
      blockers.push({
        code: "SIGNATURE_PENDING",
        message: `Digital signature is pending for "${doc.name}".`,
        field: doc.name,
      });
    }
    if (doc.signature_required && doc.signature_status === "Invalid") {
      blockers.push({
        code: "SIGNATURE_INVALID",
        message: `Digital signature verification failed for "${doc.name}".`,
        field: doc.name,
      });
    }
  }

  // 5. Checklist validation
  if (checklist) {
    if (!checklist.budgetVerified) {
      blockers.push({ code: "CHECKLIST_BUDGET", message: "Finance Checklist: Budget allocation and sufficiency not verified." });
    }
    if (!checklist.capexOpexVerified) {
      blockers.push({ code: "CHECKLIST_CAPEX_OPEX", message: "Finance Checklist: CAPEX/OPEX breakdown not verified." });
    }
    if (!checklist.financialAssumptionsReviewed) {
      blockers.push({ code: "CHECKLIST_ASSUMPTIONS", message: "Finance Checklist: Financial assumptions (ROI/NPV/IRR) not reviewed." });
    }
    if (!checklist.requiredDocumentsReviewed) {
      blockers.push({ code: "CHECKLIST_DOCUMENTS", message: "Finance Checklist: Supporting documents & specifications not reviewed." });
    }
    if (!checklist.requiredSignaturesVerified) {
      blockers.push({ code: "CHECKLIST_SIGNATURES", message: "Finance Checklist: Required digital signatures not verified." });
    }
    if (!checklist.businessJustificationReviewed) {
      blockers.push({ code: "CHECKLIST_JUSTIFICATION", message: "Finance Checklist: Business justification not validated." });
    }
    if (!checklist.financialFeasibilityConfirmed) {
      blockers.push({ code: "CHECKLIST_FEASIBILITY", message: "Finance Checklist: Financial feasibility not confirmed." });
    }
  }

  return {
    canApprove: blockers.length === 0,
    blockers,
    checklistRequired: true,
  };
}

export async function approveFinanceInErp(
  caseId: string,
  remarks: string,
  reviewerEmail: string,
  role = "finance",
  checklist?: Partial<FinanceChecklistState>,
): Promise<BusinessCase> {
  const normRole = (role || "").toLowerCase().trim();
  const isFinanceRole = ["finance", "finance_executive", "admin", "administrator"].includes(normRole);
  if (!isFinanceRole) {
    throw new ErpIntakeError(403, "You do not have permission to approve the Finance Gate.");
  }

  const current = await fetchBusinessCaseByIdFromErp(caseId);
  if (!current) {
    throw new ErpIntakeNotFoundError(BC_DOCTYPE, caseId);
  }

  if (current.finance_status === "Approved") {
    throw new ErpIntakeError(400, "Finance Gate is already approved.");
  }

  if (
    current.workflow_status !== "Pending Finance Review" &&
    current.workflow_status !== "Draft"
  ) {
    throw new ErpIntakeError(400, `Business Case is in "${current.workflow_status}" status. Only cases pending Finance Review can be approved.`);
  }

  const validation = await validateFinanceGateInErp(current, checklist);
  if (!validation.canApprove) {
    const errorMsg = validation.blockers.map((b) => b.message).join(" ");
    console.error(`[FinanceApprove:Blocked] Business Case "${caseId}" approval blocked:`, errorMsg);
    throw new ErpIntakeError(400, `Finance Gate Approval Blocked: ${errorMsg}`);
  }

  const approvedDate = formatFrappeDatetime();
  const patchFields: Record<string, unknown> = {
    workflow_state: "Pending Legal Review",
    status: "Pending Approval",
    finance_status: "Approved",
    finance_approved_by: reviewerEmail,
    finance_approved_on: approvedDate,
    finance_comments: remarks || "Financial analysis verified and budget approved by Finance.",
  };

  return updateBusinessCaseStatus(
    caseId,
    patchFields,
    {
      stage: "Finance",
      approver: reviewerEmail,
      role: role === "admin" ? "Administrator" : "Finance Manager",
      user_role: role === "admin" ? "Administrator" : "Finance Manager",
      action: "Approved",
      previous_state: "Pending Finance Review",
      new_state: "Pending Legal Review",
      comments: remarks || "Financial analysis verified and budget approved by Finance.",
      approved_on: approvedDate,
      revision_number: current.revision_number || 1,
    },
  );
}

export async function rejectFinanceInErp(
  caseId: string,
  remarks: string,
  reviewerEmail: string,
  role = "finance",
): Promise<BusinessCase> {
  const normRole = (role || "").toLowerCase().trim();
  const isFinanceRole = ["finance", "finance_executive", "admin", "administrator"].includes(normRole);
  if (!isFinanceRole) {
    throw new ErpIntakeError(403, "You do not have permission to reject at Finance stage.");
  }

  const current = await fetchBusinessCaseByIdFromErp(caseId);
  const prevWf = current?.workflow_status || "Pending Finance Review";

  return updateBusinessCaseStatus(
    caseId,
    {
      workflow_state: "Rejected",
      status: "Rejected",
      finance_status: "Rejected",
      rejection_reason: remarks,
    },
    {
      stage: "Finance",
      approver: reviewerEmail,
      role: role === "admin" ? "Administrator" : "Finance Manager",
      user_role: role === "admin" ? "Administrator" : "Finance Manager",
      action: "Rejected",
      previous_state: prevWf,
      new_state: "Rejected",
      comments: remarks,
      approved_on: formatFrappeDatetime(),
      revision_number: current?.revision_number || 1,
    },
  );
}

export async function requestFinanceRevisionInErp(
  caseId: string,
  remarks: string,
  reviewerEmail: string,
  role = "finance",
): Promise<BusinessCase> {
  const normRole = (role || "").toLowerCase().trim();
  const isFinanceRole = ["finance", "finance_executive", "admin", "administrator"].includes(normRole);
  if (!isFinanceRole) {
    throw new ErpIntakeError(403, "You do not have permission to request revision at Finance stage.");
  }

  const current = await fetchBusinessCaseByIdFromErp(caseId);
  const prevWf = current?.workflow_status || "Pending Finance Review";

  return updateBusinessCaseStatus(
    caseId,
    {
      workflow_state: "Revision Required - Finance",
      status: "Draft",
      finance_status: "Revision Requested",
      finance_comments: remarks,
    },
    {
      stage: "Finance",
      approver: reviewerEmail,
      role: role === "admin" ? "Administrator" : "Finance Manager",
      user_role: role === "admin" ? "Administrator" : "Finance Manager",
      action: "Revision Requested",
      previous_state: prevWf,
      new_state: "Revision Required - Finance",
      comments: remarks,
      approved_on: formatFrappeDatetime(),
      revision_number: (current?.revision_number || 1) + 1,
    },
    true, // incrementRevision
  );
}

// ── LEGAL APPROVAL ACTIONS ───────────────────────────────────────────────────

export async function approveLegalInErp(
  caseId: string,
  remarks: string,
  reviewerEmail: string,
  role = "legal",
): Promise<BusinessCase> {
  const normRole = (role || "").toLowerCase().trim();
  const isLegalRole = ["legal", "admin", "administrator"].includes(normRole);
  if (!isLegalRole) {
    throw new ErpIntakeError(403, "You do not have permission to approve the Legal Gate.");
  }

  const current = await fetchBusinessCaseByIdFromErp(caseId);
  if (!current) throw new ErpIntakeNotFoundError(BC_DOCTYPE, caseId);

  // 1. Validate workflow state
  if (current.workflow_status !== "Pending Legal Review") {
    throw new ErpIntakeError(
      400,
      `Business Case is not currently in Pending Legal Review (current state: "${current.workflow_status}").`,
    );
  }

  // 2. Validate standard status
  if (current.approval_status !== "Pending Legal" && (current as any).status !== "Pending Approval") {
    const rawStatus = (current as any).status || current.approval_status;
    if (rawStatus !== "Pending Approval" && rawStatus !== "Pending Legal") {
      throw new ErpIntakeError(
        400,
        `Business Case must be in "Pending Approval" status before Legal approval (current status: "${rawStatus}").`,
      );
    }
  }

  // 3. Validate Finance approval is complete
  if (current.finance_status !== "Approved") {
    throw new ErpIntakeError(
      400,
      "Legal approval is blocked because Finance approval is incomplete.",
    );
  }

  // 4. Validate Finance approver presence
  if (!current.finance_approved_by || (!current.finance_approved_date && !(current as any).finance_approved_on)) {
    throw new ErpIntakeError(
      400,
      "Legal approval is blocked: Finance approver information or approval timestamp is missing.",
    );
  }

  // 5. Validate Legal status is pending
  if (current.legal_status === "Approved") {
    throw new ErpIntakeError(400, "Legal Gate is already approved.");
  }
  if (current.legal_status !== "Pending") {
    throw new ErpIntakeError(
      400,
      `Legal Gate cannot be approved while in "${current.legal_status}" status.`,
    );
  }

  const approvedDate = formatFrappeDatetime();
  return updateBusinessCaseStatus(
    caseId,
    {
      workflow_state: "Pending Procurement",
      status: "Pending Approval",
      legal_status: "Approved",
      legal_approved_by: reviewerEmail,
      legal_approved_on: approvedDate,
      legal_comments: remarks || "Approved by Legal. Ready for Procurement review.",
    },
    {
      stage: "Legal",
      approver: reviewerEmail,
      role: role === "admin" ? "Administrator" : "Legal Reviewer",
      user_role: role === "admin" ? "Administrator" : "Legal Reviewer",
      action: "Approved",
      status: "Approved",
      previous_state: "Pending Legal Review",
      new_state: "Pending Procurement",
      comments: remarks || "Approved by Legal. Ready for Procurement review.",
      approved_on: approvedDate,
      revision_number: current.revision_number || 1,
    },
  );
}

export async function rejectLegalInErp(
  caseId: string,
  remarks: string,
  reviewerEmail: string,
  role = "legal",
): Promise<BusinessCase> {
  const normRole = (role || "").toLowerCase().trim();
  const isLegalRole = ["legal", "admin", "administrator"].includes(normRole);
  if (!isLegalRole) {
    throw new ErpIntakeError(403, "You do not have permission to reject at Legal stage.");
  }

  const current = await fetchBusinessCaseByIdFromErp(caseId);
  const prevWf = current?.workflow_status || "Pending Legal Review";

  return updateBusinessCaseStatus(
    caseId,
    {
      workflow_state: "Rejected",
      status: "Rejected",
      legal_status: "Rejected",
      rejection_reason: remarks,
    },
    {
      stage: "Legal",
      approver: reviewerEmail,
      role: role === "admin" ? "Administrator" : "Legal Reviewer",
      user_role: role === "admin" ? "Administrator" : "Legal Reviewer",
      action: "Rejected",
      previous_state: prevWf,
      new_state: "Rejected",
      comments: remarks,
      approved_on: formatFrappeDatetime(),
      revision_number: current?.revision_number || 1,
    },
  );
}

export async function requestLegalRevisionInErp(
  caseId: string,
  remarks: string,
  reviewerEmail: string,
  role = "legal",
): Promise<BusinessCase> {
  const normRole = (role || "").toLowerCase().trim();
  const isLegalRole = ["legal", "admin", "administrator"].includes(normRole);
  if (!isLegalRole) {
    throw new ErpIntakeError(403, "You do not have permission to request revision at Legal stage.");
  }

  const current = await fetchBusinessCaseByIdFromErp(caseId);
  const prevWf = current?.workflow_status || "Pending Legal Review";

  return updateBusinessCaseStatus(
    caseId,
    {
      workflow_state: "Revision Required - Legal",
      status: "Draft",
      legal_status: "Revision Requested",
      legal_comments: remarks,
    },
    {
      stage: "Legal",
      approver: reviewerEmail,
      role: role === "admin" ? "Administrator" : "Legal Reviewer",
      user_role: role === "admin" ? "Administrator" : "Legal Reviewer",
      action: "Revision Requested",
      previous_state: prevWf,
      new_state: "Revision Required - Legal",
      comments: remarks,
      approved_on: formatFrappeDatetime(),
      revision_number: (current?.revision_number || 1) + 1,
    },
    true, // incrementRevision
  );
}

// ── PROCUREMENT WORKFLOW & RFQ LINKAGE ───────────────────────────────────────

/**
 * Mark a Business Case as "Procurement Ready" after Finance and Legal approvals.
 */
export async function markProcurementReadyInErp(
  caseId: string,
  remarks: string,
  reviewerEmail: string,
  role = "procurement",
): Promise<BusinessCase> {
  const normRole = (role || "").toLowerCase().trim();
  const isProcurementRole = ["procurement", "procurement_team", "admin", "administrator"].includes(normRole);
  if (!isProcurementRole) {
    throw new ErpIntakeError(403, "You do not have permission to mark Business Case as Procurement Ready.");
  }

  const current = await fetchBusinessCaseByIdFromErp(caseId);
  if (!current) throw new ErpIntakeNotFoundError(BC_DOCTYPE, caseId);

  if (current.finance_status !== "Approved" || current.legal_status !== "Approved") {
    throw new ErpIntakeError(400, "Both Finance and Legal gates must be approved before marking Procurement Ready.");
  }

  const approvedDate = formatFrappeDatetime();
  return updateBusinessCaseStatus(
    caseId,
    {
      workflow_state: "Procurement Ready",
      status: "Approved",
    },
    {
      stage: "Procurement",
      approver: reviewerEmail,
      role: role === "admin" ? "Administrator" : "Procurement Manager",
      user_role: role === "admin" ? "Administrator" : "Procurement Manager",
      action: "Marked Procurement Ready",
      previous_state: "Pending Procurement",
      new_state: "Procurement Ready",
      comments: remarks || "Business Case reviewed and marked ready for RFQ creation.",
      approved_on: approvedDate,
      revision_number: current.revision_number || 1,
    },
  );
}

/**
 * Resubmit a revised Business Case after revision request.
 */
export async function resubmitBusinessCaseRevisionInErp(
  caseId: string,
  updatedData: Record<string, unknown>,
  userEmail: string,
  role = "department",
): Promise<BusinessCase> {
  const current = await fetchBusinessCaseByIdFromErp(caseId);
  if (!current) throw new ErpIntakeNotFoundError(BC_DOCTYPE, caseId);

  const prevWf = current.workflow_status;

  const patchFields: Record<string, unknown> = {
    ...updatedData,
    workflow_state: "Pending Finance Review",
    status: "Pending Approval",
    finance_status: "Pending",
    legal_status: "Pending",
  };

  return updateBusinessCaseStatus(
    caseId,
    patchFields,
    {
      stage: "Department",
      approver: userEmail,
      role: role === "admin" ? "Administrator" : "Department User",
      user_role: role === "admin" ? "Administrator" : "Department User",
      action: "Resubmitted",
      previous_state: prevWf,
      new_state: "Pending Finance Review",
      comments: "Revised Business Case resubmitted for Finance Review.",
      approved_on: formatFrappeDatetime(),
      revision_number: (current.revision_number || 1) + 1,
    },
    true, // incrementRevision
  );
}

/**
 * After RFQ is created, update the Business Case with the RFQ name
 * and flip status to "RFQ Created".
 */
export async function linkRfqToBusinessCaseInErp(
  caseId: string,
  rfqName: string,
  userEmail = "procurement@netlink.com",
  role = "procurement",
): Promise<BusinessCase> {
  const current = await fetchBusinessCaseByIdFromErp(caseId);
  const prevWf = current?.workflow_status || "Procurement Ready";

  const payload: Record<string, unknown> = {
    workflow_state: "RFQ Created",
    status: "Closed",
    rfq_id: rfqName,
    custom_rfq_id: rfqName,
  };

  const updated = await updateBusinessCaseStatus(
    caseId,
    payload,
    {
      stage: "Procurement",
      approver: userEmail,
      role: role === "admin" ? "Administrator" : "Procurement Manager",
      user_role: role === "admin" ? "Administrator" : "Procurement Manager",
      action: "RFQ Created",
      previous_state: prevWf,
      new_state: "RFQ Created",
      comments: `RFQ ${rfqName} created and linked to Business Case.`,
      approved_on: formatFrappeDatetime(),
      revision_number: current?.revision_number || 1,
    },
  );

  // Best-effort back-link from RFQ to Business Case
  await apiPut(buildResourceUrl("Request for Quotation", rfqName), {
    custom_business_case_id: caseId,
  }).catch(() => {});

  return updated;
}

// ── FIELD METADATA VALIDATION ────────────────────────────────────────────────

/**
 * Verify that expected fields exist on the Business Need and Business Case
 * DocTypes in ERPNext. Logs missing fields to console — does NOT throw.
 * Called once on module load in DEV; silenced in production.
 */
export async function validateIntakeDocTypeFields(): Promise<{
  missingBnFields: string[];
  missingBcFields: string[];
}> {
  const EXPECTED_BN_FIELDS = [
    "title", "description", "need_type", "priority", "status",
    "company", "department", "requester", "business_owner",
    "required_by_date", "estimated_budget", "currency",
    "problem_statement", "budget_type",
  ];

  // Only fields that are standard on the Business Case DocType.
  // finance_status, legal_status, rfq_id are NOT standard — they are derived.
  const EXPECTED_BC_FIELDS = [
    "title", "business_need", "status", "department", "company",
    "business_owner", "executive_summary", "business_objective",
  ];

  const fetchFields = async (doctype: string): Promise<string[]> => {
    try {
      const rows = await apiGet<{ fieldname: string }[]>(
        buildResourceUrl("DocField"),
        {
          params: {
            filters: JSON.stringify([["parent", "=", doctype]]),
            fields: JSON.stringify(["fieldname"]),
            limit_page_length: 300,
          },
        },
      );
      const list = extractList<{ fieldname: string }>(rows);
      return list.map((r) => r.fieldname);
    } catch {
      return [];
    }
  };

  const [bnFields, bcFields] = await Promise.all([
    fetchFields(BN_DOCTYPE),
    fetchFields(BC_DOCTYPE),
  ]);

  const bnSet = new Set(bnFields);
  const bcSet = new Set(bcFields);

  const missingBnFields = EXPECTED_BN_FIELDS.filter((f) => !bnSet.has(f));
  const missingBcFields = EXPECTED_BC_FIELDS.filter((f) => !bcSet.has(f));

  if (missingBnFields.length > 0) {
    console.warn(
      `[BusinessIntake] Missing ERPNext fields on Business Need:`,
      missingBnFields,
    );
  }
  if (missingBcFields.length > 0) {
    console.warn(
      `[BusinessIntake] Missing ERPNext fields on Business Case:`,
      missingBcFields,
    );
  }

  if (missingBnFields.length === 0 && missingBcFields.length === 0) {
    console.log("[BusinessIntake] ✅ All DocType fields validated OK");
  }

  return { missingBnFields, missingBcFields };
}
