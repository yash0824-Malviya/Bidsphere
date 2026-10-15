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
import { uploadFileToERPNextDetailed, getFullFileUrl, detectContentType } from "./legalDocsStorage";

import type {
  BusinessNeed,
  BusinessCase,
  CreateBusinessNeedInput,
  CreateBusinessCaseInput,
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

// ── Role normalization and stage permission helpers ────────────────────────

export function normalizeRoleString(role?: string | null): string {
  if (!role) return "";
  return role.toLowerCase().trim().replace(/[\s_-]+/g, "");
}

export function isFinanceManagerRole(role?: string | null): boolean {
  const norm = normalizeRoleString(role);
  return norm.includes("finance") || norm === "financemanager" || norm === "financeexecutive";
}

export function isEngineeringManagerRole(role?: string | null): boolean {
  const norm = normalizeRoleString(role);
  return (
    norm === "engineering" ||
    norm === "engineeringmanager" ||
    norm === "engineering_manager" ||
    norm === "engmgr" ||
    (norm.includes("engineer") && norm.includes("manager"))
  );
}

export function isEngineerRole(role?: string | null): boolean {
  if (isEngineeringManagerRole(role)) return false;
  const norm = normalizeRoleString(role);
  return (
    norm === "engineer" ||
    norm === "engineeringuser" ||
    norm.includes("engineer")
  );
}

export function isLegalManagerRole(role?: string | null): boolean {
  const norm = normalizeRoleString(role);
  return norm.includes("legal") || norm === "legalmanager";
}

export function isProcurementManagerRole(role?: string | null): boolean {
  const norm = normalizeRoleString(role);
  return norm.includes("procurement") || norm === "procurementmanager" || norm === "procurementteam";
}

export function isDepartmentUserRole(role?: string | null): boolean {
  const norm = normalizeRoleString(role);
  return norm.includes("department") || norm === "departmentuser";
}

export function isWarehouseManagerRole(role?: string | null): boolean {
  const norm = normalizeRoleString(role);
  return norm.includes("warehouse") || norm === "warehousemanager";
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

/**
 * Map structured technical requirements into ERPNext child-table format.
 * ERPNext Business Case expects `technical_requirements` as an array of child table rows,
 * NOT as a formatted display string.
 */
export function mapToErpTechnicalRequirements(
  list?: TechnicalRequirementItem[] | any[],
): Array<Record<string, unknown>> {
  if (!list || !Array.isArray(list)) return [];
  return list.map((tr) => {
    const qty = Number(tr.quantity) || Number(tr.annual_volume) || 1;
    const uomVal = tr.uom || tr.unit || "Nos.";
    const itemVal = tr.requirement_type || tr.item || "Product / Equipment";
    const descVal = tr.specification || tr.description || "";

    return {
      doctype: "Technical Requirement",
      item: itemVal,
      description: descVal,
      annual_volume: qty,
      unit: uomVal,
      procurement_type: tr.procurement_type || "Material",

      // Extended attributes preserved so neither ERP nor frontend loses details
      id: tr.id || tr.name || undefined,
      requirement_type: itemVal,
      specification: descVal,
      quantity: qty,
      uom: uomVal,
      priority: tr.priority || "High",
      is_mandatory: tr.is_mandatory !== undefined ? Boolean(tr.is_mandatory) : true,
      performance: tr.performance || tr.performance_requirements || "",
      performance_requirements: tr.performance_requirements || tr.performance || "",
      quality: tr.quality || tr.quality_requirements || "",
      quality_requirements: tr.quality_requirements || tr.quality || "",
      delivery: tr.delivery || tr.delivery_installation_requirements || "",
      delivery_installation_requirements: tr.delivery_installation_requirements || tr.delivery || "",
      integration: tr.integration || tr.integration_requirements || "",
      integration_requirements: tr.integration_requirements || tr.integration || "",
      safety: tr.safety || tr.safety_compliance_requirements || "",
      safety_compliance_requirements: tr.safety_compliance_requirements || tr.safety || "",
      required_supplier_documents: Array.isArray(tr.required_supplier_documents)
        ? tr.required_supplier_documents
        : [],
    };
  });
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

// ── Local Persistence & Extension Helpers ─────────────────────────────────────

const BC_LOCAL_EXT_PREFIX = "bidsphere_bc_ext_";
const BC_LOCAL_STANDALONE_KEY = "bidsphere_bc_standalone_cases";

export function getLocalCaseExtension(id: string): Record<string, unknown> {
  if (typeof window === "undefined" || !window.localStorage) return {};
  try {
    const raw = localStorage.getItem(`${BC_LOCAL_EXT_PREFIX}${id}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveLocalCaseExtension(id: string, data: Record<string, unknown>): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const existing = getLocalCaseExtension(id);
    localStorage.setItem(`${BC_LOCAL_EXT_PREFIX}${id}`, JSON.stringify({ ...existing, ...data }));
  } catch (e) {
    console.warn("[BusinessIntakeErp] Local case extension write warning:", e);
  }
}

export function getLocalStandaloneCases(): BusinessCase[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = localStorage.getItem(BC_LOCAL_STANDALONE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveLocalStandaloneCase(bCase: BusinessCase): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const list = getLocalStandaloneCases();
    const idx = list.findIndex(
      (c) =>
        (c.name && c.name === bCase.name) ||
        (c.business_case_id && c.business_case_id === bCase.business_case_id),
    );
    if (idx >= 0) {
      list[idx] = bCase;
    } else {
      list.unshift(bCase);
    }
    localStorage.setItem(BC_LOCAL_STANDALONE_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn("[BusinessIntakeErp] Local standalone case save warning:", e);
  }
}

/**
 * Normalise a raw ERPNext Business Case document to the frontend
 * BusinessCase type.
 *
 * Reads authoritative workflow_state, finance_status, legal_status,
 * approval_history, and applies deterministic financial calculations.
 */
export function normalizeCase(raw: Record<string, unknown>): BusinessCase {
  const caseId = String(raw.name || raw.business_case_id || "").trim();
  const localExt = getLocalCaseExtension(caseId);
  const doc = { ...raw, ...localExt } as BusinessCase & Record<string, unknown>;

  // 1. Authoritative workflow state from ERPNext / local
  let workflowStatus: BusinessCase["workflow_status"] = "Draft";
  const rawWf = String(doc.workflow_state || doc.workflow_status || "").trim();
  const rawStatus = String(doc.status || "").trim();

  if (rawWf) {
    workflowStatus = rawWf as BusinessCase["workflow_status"];
  } else if (rawStatus === "Pending Approval") {
    if (doc.procurement_status === "Approved") {
      workflowStatus = "Ready for RFQ";
    } else if (doc.legal_status === "Approved") {
      workflowStatus = "Pending Procurement";
    } else if (doc.finance_status === "Approved") {
      workflowStatus = "Pending Legal";
    } else if (doc.engineering_status === "Approved") {
      workflowStatus = "Pending Finance";
    } else if (doc.engineering_status === "Under Review") {
      workflowStatus = "Pending Engineering Manager";
    } else {
      workflowStatus = "Pending Engineering";
    }
  } else if (rawStatus === "Revision Required (Finance)" || rawStatus === "Revision Required - Finance") {
    workflowStatus = "Revision Required (Finance)" as BusinessCase["workflow_status"];
  } else if (rawStatus === "Approved") {
    workflowStatus = "Ready for RFQ";
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
  let engineeringStatus = (doc.engineering_status as BusinessCase["engineering_status"]) || "Pending";
  let financeStatus = (doc.finance_status as BusinessCase["finance_status"]) || "Pending";
  let procurementStatus = (doc.procurement_status as BusinessCase["procurement_status"]) || "Pending";
  let legalStatus = (doc.legal_status as BusinessCase["legal_status"]) || "Pending";
  let pmStatus = (doc.program_manager_status as BusinessCase["program_manager_status"]) || "Pending";

  // State consistency fallback when stage flags are empty or not provided
  if (!doc.engineering_status && ["Pending Finance", "Pending Finance Review", "Pending Finance Executive", "Revision Required (Finance)", "Revision Required - Finance", "Pending Procurement", "Pending Legal", "Pending Legal Review", "Pending Final Approval", "Approved", "Ready for RFQ", "Procurement Ready", "RFQ Created"].includes(workflowStatus)) {
    engineeringStatus = "Approved";
  }
  if (!doc.finance_status && ["Pending Procurement", "Pending Legal", "Pending Legal Review", "Pending Final Approval", "Approved", "Ready for RFQ", "Procurement Ready", "RFQ Created"].includes(workflowStatus)) {
    financeStatus = "Approved";
  }
  if (!doc.procurement_status && ["Pending Final Approval", "Approved", "Ready for RFQ", "Procurement Ready", "RFQ Created"].includes(workflowStatus)) {
    procurementStatus = "Approved";
  }
  if (!doc.legal_status && ["Pending Procurement", "Pending Final Approval", "Approved", "Ready for RFQ", "Procurement Ready", "RFQ Created"].includes(workflowStatus)) {
    legalStatus = "Approved";
  }
  if (!doc.program_manager_status && ["Approved", "Ready for RFQ", "Procurement Ready", "RFQ Created"].includes(workflowStatus)) {
    pmStatus = "Approved";
  }

  // 3. Approval status
  let approvalStatus: BusinessCase["approval_status"] = "Pending Engineering";
  if (workflowStatus === "Pending Engineering" || workflowStatus === "Submitted") {
    approvalStatus = "Pending Engineering";
  } else if (workflowStatus === "Pending Engineering Manager") {
    approvalStatus = "Pending Engineering";
  } else if (workflowStatus === "Pending Finance" || workflowStatus === "Pending Finance Review" || workflowStatus === "Pending Finance Executive" || workflowStatus === "Revision Required (Finance)" || workflowStatus === "Revision Required - Finance") {
    approvalStatus = "Pending Finance";
  } else if (workflowStatus === "Pending Legal" || workflowStatus === "Pending Legal Review" || workflowStatus === "Revision Required (Legal)" || workflowStatus === "Revision Required - Legal") {
    approvalStatus = "Pending Legal";
  } else if (workflowStatus === "Pending Procurement") {
    approvalStatus = "Pending Procurement";
  } else if (workflowStatus === "Pending Final Approval") {
    approvalStatus = "Pending Final Approval";
  } else if (["Approved", "Ready for RFQ", "Procurement Ready", "RFQ Created"].includes(workflowStatus)) {
    approvalStatus = "Approved";
  } else if (workflowStatus === "Rejected") {
    approvalStatus = "Rejected";
  } else if (workflowStatus === "Returned") {
    approvalStatus = "Returned";
  } else {
    approvalStatus = "Draft";
  }

  // 4. Current Stage and Approver Role mapping
  let currentStage = "Draft";
  let currentApproverRole = "Department User";
  switch (workflowStatus) {
    case "Draft":
      currentStage = "Draft";
      currentApproverRole = "Department User";
      break;
    case "Submitted":
    case "Pending Engineering":
      currentStage = "Engineering Review";
      currentApproverRole = "Engineer";
      break;
    case "Pending Engineering Manager":
      currentStage = "Engineering Approval";
      currentApproverRole = "Engineering Manager";
      break;
    case "Pending Finance":
    case "Pending Finance Review":
    case "Revision Required (Finance)":
    case "Revision Required - Finance":
      currentStage = "Finance Approval";
      currentApproverRole = "Finance Manager";
      break;
    case "Pending Finance Executive":
      currentStage = "Finance Executive Review";
      currentApproverRole = "Finance Executive";
      break;
    case "Pending Legal":
    case "Pending Legal Review":
    case "Revision Required (Legal)":
    case "Revision Required - Legal":
      currentStage = "Legal Approval";
      currentApproverRole = "Legal Manager";
      break;
    case "Pending Procurement":
      currentStage = "Procurement Review";
      currentApproverRole = "Procurement Manager";
      break;
    case "Pending Final Approval":
      currentStage = "Final Approval";
      currentApproverRole = "Program Manager";
      break;
    case "Returned":
      currentStage = "Returned";
      currentApproverRole = "Department User";
      break;
    case "Approved":
    case "Ready for RFQ":
    case "Procurement Ready":
      currentStage = "Ready for RFQ";
      currentApproverRole = "Procurement Manager (Create RFQ)";
      break;
    case "RFQ Created":
      currentStage = "RFQ Created";
      currentApproverRole = "Procurement Team";
      break;
    case "Rejected":
      currentStage = "Rejected";
      currentApproverRole = "None";
      break;
    default:
      currentStage = workflowStatus;
      currentApproverRole = "Pending";
  }

  // 5. Parse approval history child rows
  const rawHistory = Array.isArray(doc.approval_history) ? doc.approval_history : [];
  const approvalHistory: BusinessCaseApprovalHistory[] = rawHistory.map((row: any) => {
    const rawDt = row.approved_on || row.creation || row.date || "";
    let dateStr = row.date || "";
    let timeStr = row.time || "";
    if (rawDt && (!dateStr || !timeStr)) {
      const parts = String(rawDt).split(" ");
      if (!dateStr) dateStr = parts[0] || "";
      if (!timeStr && parts[1]) timeStr = parts[1].substring(0, 8);
    }
    return {
      stage: row.stage || "Finance",
      approver: row.approver || row.user || "",
      user: row.user || row.approver || "",
      role: row.user_role || row.role || "",
      user_role: row.user_role || row.role || "",
      action: row.action || row.status || "Approved",
      comments: row.comments || "",
      date: dateStr,
      time: timeStr,
      approved_on: row.approved_on || row.creation || `${dateStr} ${timeStr}`.trim(),
      revision_number: Number(row.revision_number) || 1,
      digital_signature: row.digital_signature || undefined,
      previous_state: row.previous_state || "",
      new_state: row.new_state || "",
      status: row.status || "Approved",
    };
  });

  // rfq_id: may be stored as `custom_rfq_id`, `rfq_id`, or `linked_rfq_id`
  const rfqId = (doc.rfq_id as string) || (doc.custom_rfq_id as string) || (doc.linked_rfq_id as string) || "";

  // 6. Deterministic financial metrics
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

  // 6b. Normalize technical requirements from ERP child table or local list
  const rawTech = Array.isArray(doc.technical_requirements) && doc.technical_requirements.length > 0
    ? doc.technical_requirements
    : Array.isArray(doc.technical_requirements_list) && doc.technical_requirements_list.length > 0
    ? doc.technical_requirements_list
    : typeof doc.technical_requirements === "string" && (doc.technical_requirements as string).trim()
    ? [{
        requirement_type: "Product / Equipment",
        specification: (doc.technical_requirements as string).trim(),
        quantity: 1,
        uom: "Nos.",
        priority: "High",
        is_mandatory: true,
      }]
    : [];

  const normalizedTechList: TechnicalRequirementItem[] = rawTech.map((tr: any) => {
    const qty = Number(tr.quantity) || Number(tr.annual_volume) || 1;
    const uomVal = (tr.uom || tr.unit || "Nos.") as any;
    const itemVal = tr.requirement_type || tr.item || "Product / Equipment";
    const descVal = tr.specification || tr.description || "";

    return {
      id: tr.id || tr.name || undefined,
      requirement_type: itemVal,
      specification: descVal,
      description: tr.description || descVal,
      quantity: qty,
      annual_volume: qty,
      uom: uomVal,
      unit: uomVal,
      priority: tr.priority || "High",
      is_mandatory: tr.is_mandatory !== undefined ? Boolean(tr.is_mandatory) : true,
      performance_requirements: tr.performance_requirements || "",
      quality_requirements: tr.quality_requirements || "",
      delivery_installation_requirements: tr.delivery_installation_requirements || "",
      integration_requirements: tr.integration_requirements || "",
      safety_compliance_requirements: tr.safety_compliance_requirements || "",
      required_supplier_documents: Array.isArray(tr.required_supplier_documents)
        ? tr.required_supplier_documents
        : [],
      procurement_type: tr.procurement_type || "Material",
    };
  });

  return {
    ...doc,
    business_case_id: (doc.business_case_id as string) || (doc.name as string) || "",
    business_need_id: (doc.business_need_id as string) || (doc.business_need as string) || "",
    title: (doc.title as string) || (doc.name as string) || "Untitled Business Case",
    workflow_status: workflowStatus,
    status: workflowStatus || (doc.status as string) || "Draft",
    current_stage: currentStage,
    current_approver: (doc.current_approver as string) || "",
    current_approver_role: currentApproverRole,
    engineering_status: engineeringStatus,
    finance_status: financeStatus,
    procurement_status: procurementStatus,
    legal_status: legalStatus,
    program_manager_status: pmStatus,
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
    linked_rfq_id: rfqId,
    is_locked: Boolean(doc.is_locked) || ["Approved", "Ready for RFQ", "Procurement Ready", "RFQ Created"].includes(workflowStatus),
    revision_number: Number(doc.revision_number) || Number(doc.version) || 1,

    // Rich Business Case Metadata (Sections 5 - 14)
    case_type: (doc.case_type as any) || "Standard Procurement",
    commodity: (doc.commodity as string) || "",
    category: (doc.category as string) || (doc.requirement_category as string) || "",
    plant: (doc.plant as string) || "",
    business_unit: (doc.business_unit as string) || "",
    cost_center: (doc.cost_center as string) || "",
    required_date: (doc.required_date as string) || (doc.required_by_date as string) || "",
    why_procurement_required: (doc.why_procurement_required as string) || (doc.business_problem as string) || (doc.problem_statement as string) || "",
    current_supplier_limitation: (doc.current_supplier_limitation as string) || "",
    customer_impact: (doc.customer_impact as string) || "",
    operational_impact: (doc.operational_impact as string) || "",
    revenue_impact: (doc.revenue_impact as string) || "",
    strategic_importance: (doc.strategic_importance as any) || "Medium",
    alternatives: (doc.alternatives as any) || [],
    technical_review_required: doc.technical_review_required !== undefined ? Boolean(doc.technical_review_required) : true,
    finance_review_required: doc.finance_review_required !== undefined ? Boolean(doc.finance_review_required) : true,
    operations_review_required: Boolean(doc.operations_review_required),
    quality_review_required: Boolean(doc.quality_review_required),
    legal_review_required: Boolean(doc.legal_review_required),
    high_value_required: Boolean(doc.high_value_required || calc.total_investment >= 100000),
    sourcing_strategy: (doc.sourcing_strategy as any) || (doc.procurement_strategy as any) || "Competitive RFQ",
    procurement_type: (doc.procurement_type as any) || "Competitive Bidding",
    supplier_strategy: (doc.supplier_strategy as any) || "Multiple Supplier",
    expected_supplier_count: Number(doc.expected_supplier_count) || 3,
    rfq_start_date: (doc.rfq_start_date as string) || "",
    rfq_closing_date: (doc.rfq_closing_date as string) || "",
    expected_award_date: (doc.expected_award_date as string) || "",
    procurement_justification: (doc.procurement_justification as string) || "",
    procurement_notes: (doc.procurement_notes as string) || "",
    risks: (doc.risks as any) || (doc.risk_assessments as any) || [],
    compliance_requirements: (doc.compliance_requirements as string) || "",
    regulatory_requirements: (doc.regulatory_requirements as string) || "",
    environmental_requirements: (doc.environmental_requirements as string) || "",
    sustainability_requirements: (doc.sustainability_requirements as string) || "",
    supplier_certification: (doc.supplier_certification as string) || "",
    safety_requirements: (doc.safety_requirements as string) || "",
    documentation_requirements: (doc.documentation_requirements as string) || "",
    compliance_notes: (doc.compliance_notes as string) || "",

    // Child tables & attachments
    financials: (doc.financials as BusinessCase["financials"]) || [],
    technical_requirements_list: normalizedTechList,
    technical_requirements: mapToErpTechnicalRequirements(normalizedTechList) as any,
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
    created_by: (doc.created_by as string) || (doc.owner as string) || (doc.requester as string) || "",
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
    procurement_strategy: (doc.procurement_strategy as string) || (doc.sourcing_strategy as string) || "",
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

      const resolvedName = f.file_name || f.file_url.split("/").pop() || "Document";
      const contentType = detectContentType(f.file_name || f.file_url, (f as any).file_type);
      const isPrivate = Boolean(f.is_private);

      return {
        id: f.name,
        name: resolvedName,
        file_name: resolvedName,
        fileName: resolvedName,
        file_url: f.file_url,
        url: getFullFileUrl(f.file_url, f.name),
        content_type: contentType,
        is_private: isPrivate,
        size: formattedSize,
        file_size: sizeBytes,
        date: f.creation?.split(" ")[0] || f.modified?.split(" ")[0] || new Date().toISOString().split("T")[0],
        uploaded_on: f.creation || f.modified || new Date().toISOString(),
        uploaded_by: (f as any).owner || "System",
        type: ext,
        fileType: contentType,
        file_id: f.name,
        category: (f as any).category || (f as any).document_type || "Supporting Document",
        document_type: (f as any).document_type || (f as any).category || "Supporting Document",
        status: "Available",
        version: "v1.0",
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
    technical_requirements: mapToErpTechnicalRequirements(need.technical_requirements_list),
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
  let erpCases: BusinessCase[] = [];
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
    erpCases = list.map(normalizeCase);
  } catch (err) {
    console.warn("[BusinessIntakeErp] fetch Business Cases from ERPNext non-blocking warning:", err);
  }

  // Merge standalone locally created cases
  const localCases = getLocalStandaloneCases().map(c => normalizeCase(c as any));
  const combinedMap = new Map<string, BusinessCase>();
  for (const c of erpCases) {
    const id = c.name || c.business_case_id;
    if (id) combinedMap.set(id, c);
  }
  for (const c of localCases) {
    const id = c.name || c.business_case_id;
    if (id && !combinedMap.has(id)) {
      combinedMap.set(id, c);
    }
  }

  let result = Array.from(combinedMap.values());
  if (filters?.department) {
    result = result.filter(c => c.department === filters.department);
  }
  if (filters?.status) {
    result = result.filter(c => c.status === filters.status || c.workflow_status === filters.status);
  }
  if (filters?.workflow_state) {
    result = result.filter(c => c.workflow_status === filters.workflow_state);
  }
  return result;
}

/**
 * Role-aware query fetching Business Cases strictly scoped to the role's workflow queue.
 * Enforces strict visibility rules:
 * - Active queue shows ONLY cases currently pending that role's action.
 * - Completed/history cases are separated.
 * - Future stages or other roles' pending cases are excluded from active queues.
 */
export async function fetchRoleBusinessCasesFromErp(
  role: string,
  userEmail?: string,
  options?: {
    tab?: string;
    queueType?: "actionable" | "all" | "completed" | "ready_for_rfq";
  },
): Promise<BusinessCase[]> {
  const allCases = await fetchBusinessCasesFromErp();
  const normEmail = (userEmail || "").trim().toLowerCase();
  const queueType = options?.queueType || "actionable";
  const tab = options?.tab || (queueType === "all" ? "all" : "active");

  // 1. Department User: views own/department cases
  if (isDepartmentUserRole(role)) {
    const myCases = allCases.filter((c) => {
      if (!normEmail || normEmail === "department@netlink.com") return true;
      const owner = (c.business_owner || (c as any).owner || c.requester || c.created_by || "").toLowerCase();
      return owner.includes(normEmail) || normEmail.includes(owner) || owner === normEmail;
    });

    if (tab === "drafts") {
      return myCases.filter((c) => c.workflow_status === "Draft" || c.status === "Draft");
    }
    if (tab === "submitted") {
      return myCases.filter(
        (c) =>
          !["Draft", "Returned"].includes(c.workflow_status) &&
          !c.workflow_status.startsWith("Revision Required") &&
          !["Approved", "Ready for RFQ", "RFQ Created"].includes(c.workflow_status),
      );
    }
    if (tab === "returned") {
      return myCases.filter(
        (c) => c.workflow_status === "Returned" || c.workflow_status.startsWith("Revision Required"),
      );
    }
    if (tab === "completed") {
      return myCases.filter((c) =>
        ["Approved", "Ready for RFQ", "Procurement Ready", "RFQ Created"].includes(c.workflow_status),
      );
    }
    return myCases;
  }

  // 2. Engineering Manager: Engineering Approvals Queue
  if (isEngineeringManagerRole(role)) {
    if (queueType === "completed" || tab === "history" || tab === "completed") {
      return allCases.filter(
        (c) =>
          c.engineering_status === "Approved" ||
          [
            "Pending Finance",
            "Pending Finance Review",
            "Pending Legal",
            "Pending Procurement",
            "Ready for RFQ",
            "Approved",
            "RFQ Created",
          ].includes(c.workflow_status),
      );
    }
    if (tab === "all") return allCases;
    // Active Queue ONLY: Status = Pending Engineering Manager
    return allCases.filter((c) => {
      return (
        c.workflow_status === "Pending Engineering Manager" ||
        (c.current_stage === "Engineering Approval" && c.engineering_status !== "Approved" && !["Draft", "Approved", "Rejected"].includes(c.workflow_status))
      );
    });
  }

  // 3. Engineer: Technical Review Queue
  if (isEngineerRole(role)) {
    if (queueType === "completed" || tab === "history" || tab === "completed") {
      return allCases.filter(
        (c) =>
          c.engineering_status === "Approved" ||
          c.engineering_status === "Reviewed" ||
          [
            "Pending Engineering Manager",
            "Pending Finance",
            "Pending Finance Review",
            "Pending Legal",
            "Pending Procurement",
            "Ready for RFQ",
            "Approved",
            "RFQ Created",
          ].includes(c.workflow_status),
      );
    }
    if (tab === "all") return allCases;
    // Active Queue ONLY: Stage = Technical Review & Status = Pending Engineering / Pending Technical Review
    return allCases.filter((c) => {
      const isStatus =
        c.workflow_status === "Pending Engineering" ||
        c.workflow_status === "Pending Technical Review" ||
        c.workflow_status === "Submitted";
      return isStatus && c.workflow_status !== "Pending Engineering Manager";
    });
  }

  // 4. Finance Manager: Finance Approvals Queue
  if (isFinanceManagerRole(role)) {
    if (queueType === "completed" || tab === "history" || tab === "completed") {
      return allCases.filter(
        (c) =>
          c.finance_status === "Approved" ||
          [
            "Pending Legal",
            "Pending Procurement",
            "Ready for RFQ",
            "Approved",
            "RFQ Created",
          ].includes(c.workflow_status),
      );
    }
    if (tab === "all") return allCases;
    // Active Queue ONLY: Stage = Finance Approval & Status in [Pending Finance, Revision Required (Finance)]
    return allCases.filter((c) => {
      const isStage =
        c.current_stage === "Finance Approval" ||
        c.current_stage === "FINANCE_APPROVAL" ||
        c.current_stage === "Finance Review";
      const isStatus =
        c.workflow_status === "Pending Finance" ||
        c.workflow_status === "Pending Finance Review" ||
        c.workflow_status === "Revision Required (Finance)" ||
        c.workflow_status === "Revision Required - Finance";
      return isStage && isStatus;
    });
  }

  // 5. Legal Manager: Legal Business Case Reviews Queue
  if (isLegalManagerRole(role)) {
    if (queueType === "completed" || tab === "history" || tab === "completed") {
      return allCases.filter(
        (c) =>
          c.legal_status === "Approved" ||
          ["Pending Procurement", "Ready for RFQ", "Approved", "RFQ Created"].includes(
            c.workflow_status,
          ),
      );
    }
    if (tab === "all") return allCases;
    // Active Queue ONLY: Stage = Legal Approval & Status = Pending Legal
    return allCases.filter((c) => {
      const isStage =
        c.current_stage === "Legal Approval" ||
        c.current_stage === "LEGAL_APPROVAL" ||
        c.current_stage === "Legal Review";
      const isStatus =
        c.workflow_status === "Pending Legal" ||
        c.workflow_status === "Pending Legal Review";
      return isStage && isStatus;
    });
  }

  // 6. Procurement Manager: Procurement Business Case Reviews Queue
  if (isProcurementManagerRole(role)) {
    if (tab === "ready_for_rfq" || queueType === "ready_for_rfq") {
      return allCases.filter(
        (c) =>
          !c.rfq_id &&
          ["Ready for RFQ", "Procurement Ready", "Approved"].includes(c.workflow_status),
      );
    }
    if (tab === "completed" || queueType === "completed") {
      return allCases.filter(
        (c) => Boolean(c.rfq_id) || c.workflow_status === "RFQ Created",
      );
    }
    if (tab === "all") return allCases;
    // Active Queue ONLY: Stage = Procurement Review & Status = Pending Procurement
    return allCases.filter((c) => {
      const isStage =
        c.current_stage === "Procurement Review" ||
        c.current_stage === "PROCUREMENT_REVIEW";
      const isStatus = c.workflow_status === "Pending Procurement";
      return isStage && isStatus;
    });
  }

  // 7. System Admin: sees full repository
  return allCases;
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

    // Merge attachedFiles with any supporting_documents stored on doc or local extension
    const localExt = getLocalCaseExtension(name);
    const existingDocFiles = ((doc.supporting_documents || doc.documents || doc.attachments || localExt.supporting_documents || localExt.attachments || []) as IntakeAttachment[]);
    const allFiles = [...attachedFiles];
    const existingSet = new Set(allFiles.map((f) => f.name || f.file_url || f.id));
    for (const d of existingDocFiles) {
      if (d && (d.name || d.file_url) && !existingSet.has(d.name || d.file_url || d.id)) {
        existingSet.add(d.name || d.file_url || d.id);
        const resolvedName = d.file_name || d.name || (d.file_url ? d.file_url.split("/").pop() : "Document") || "Document";
        const contentType = d.content_type || detectContentType(resolvedName || d.file_url, d.type);
        allFiles.push({
          ...d,
          name: resolvedName,
          file_name: resolvedName,
          fileName: resolvedName,
          content_type: contentType,
          fileType: contentType,
          is_private: d.is_private !== undefined ? d.is_private : Boolean(d.file_url?.includes("/private/")),
          url: d.url || (d.file_url ? getFullFileUrl(d.file_url, d.file_id) : undefined),
        });
      }
    }

    doc.supporting_documents = allFiles;
    doc.documents = allFiles;
    doc.attachments = allFiles;

    return normalizeCase(doc);
  } catch (err) {
    const localMatch = getLocalStandaloneCases().find(c => c.name === name || c.business_case_id === name);
    if (localMatch) return normalizeCase(localMatch as any);
    const e = err as { response?: { status?: number } };
    if (e?.response?.status === 404) return null;
    return null;
  }
}

/**
 * Fetch Business Cases in Procurement queue (Pending Procurement or Procurement Ready).
 */
export async function fetchPendingBusinessCasesFromErp(userRole?: string): Promise<BusinessCase[]> {
  try {
    const all = await fetchBusinessCasesFromErp();
    const role = (userRole || "").toLowerCase().trim();
    if (!role || role === "admin") {
      return all.filter((c) => c.workflow_status !== "Draft" && c.workflow_status !== "Rejected" && c.workflow_status !== "Cancelled");
    }
    if (role === "engineering" || role === "engineering_manager" || role === "engineer") {
      return all.filter((c) => c.workflow_status === "Pending Engineering");
    }
    if (role === "finance") {
      return all.filter((c) => c.workflow_status === "Pending Finance");
    }
    if (role === "finance_executive") {
      return all.filter((c) => c.workflow_status === "Pending Finance Executive");
    }
    if (role === "legal") {
      return all.filter((c) => c.workflow_status === "Pending Legal");
    }
    if (role === "program_manager") {
      return all.filter((c) => c.workflow_status === "Pending Final Approval");
    }
    return all.filter(
      (c) =>
        c.workflow_status === "Procurement Ready" ||
        c.workflow_status === "Pending Procurement" ||
        c.workflow_status === "Approved - Ready for RFQ" ||
        c.workflow_status === "Ready for RFQ" ||
        c.workflow_status === "Approved",
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

  // 2. Update local extension and standalone storage first for instant resilience
  saveLocalCaseExtension(name, statusFields);
  let formattedNewEntry: any = null;
  if (historyEntry) {
    const ext = getLocalCaseExtension(name);
    const prevHistory = Array.isArray(ext.approval_history) ? (ext.approval_history as any[]) : [];
    const rawDt = historyEntry.approved_on || formatFrappeDatetime();
    const parts = rawDt.split(" ");
    formattedNewEntry = {
      ...historyEntry,
      user: historyEntry.approver,
      date: parts[0],
      time: parts[1] ? parts[1].substring(0, 8) : "",
      approved_on: rawDt,
    };
    saveLocalCaseExtension(name, { approval_history: [...prevHistory, formattedNewEntry] });

    const standalones = getLocalStandaloneCases();
    const sIdx = standalones.findIndex(c => c.name === name || c.business_case_id === name);
    if (sIdx >= 0) {
      standalones[sIdx] = {
        ...standalones[sIdx],
        ...statusFields,
        approval_history: [...(standalones[sIdx].approval_history || []), formattedNewEntry],
      };
      if (typeof window !== "undefined" && window.localStorage) {
        localStorage.setItem(BC_LOCAL_STANDALONE_KEY, JSON.stringify(standalones));
      }
    }
  }

  // 3. Update status and workflow fields on the parent doc atomically in ERPNext
  const FRAPPE_BC_STATUSES = new Set(["Draft", "Pending Approval", "Approved", "Rejected", "Cancelled", "Closed"]);
  const erpFields: Record<string, unknown> = { ...statusFields };
  if (typeof erpFields.status === "string" && !FRAPPE_BC_STATUSES.has(erpFields.status)) {
    if (!erpFields.workflow_state) {
      erpFields.workflow_state = erpFields.status;
    }
    erpFields.status = ["Approved", "Ready for RFQ", "Procurement Ready", "RFQ Created"].includes(erpFields.status as string)
      ? "Approved"
      : ["Rejected"].includes(erpFields.status as string)
      ? "Rejected"
      : ["Returned", "Draft"].includes(erpFields.status as string)
      ? "Draft"
      : "Pending Approval";
  }

  try {
    await apiPost("/api/method/frappe.client.set_value", {
      doctype: BC_DOCTYPE,
      name: name,
      fieldname: erpFields,
    });
  } catch (err) {
    console.warn(`[BusinessIntakeErp] ERPNext set_value non-blocking warning for ${name}:`, err);
  }

  // 4. Add approval history child row in ERPNext
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
      console.warn("[BusinessIntakeErp] Non-blocking warning: Failed to insert approval history row into ERPNext:", err);
    });
  }

  const finalDoc = await fetchBusinessCaseByIdFromErp(name);
  if (!finalDoc) {
    const localFallback = getLocalStandaloneCases().find(c => c.name === name || c.business_case_id === name);
    if (localFallback) return normalizeCase(localFallback as any);
    throw new Error(`Could not fetch updated Business Case "${name}"`);
  }
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
  if (!isFinanceManagerRole(role)) {
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
    current.workflow_status !== "Pending Finance" &&
    current.workflow_status !== "Pending Finance Review" &&
    current.workflow_status !== "Revision Required (Finance)" &&
    current.workflow_status !== "Revision Required - Finance" &&
    current.current_stage !== "Finance Approval" &&
    current.current_stage !== "Finance Review" &&
    current.workflow_status !== "Draft"
  ) {
    throw new ErpIntakeError(400, `Business Case is in "${current.workflow_status}" status. Only cases awaiting Finance action can be approved.`);
  }

  const validation = await validateFinanceGateInErp(current, checklist);
  if (!validation.canApprove) {
    const errorMsg = validation.blockers.map((b) => b.message).join(" ");
    console.error(`[FinanceApprove:Blocked] Business Case "${caseId}" approval blocked:`, errorMsg);
    throw new ErpIntakeError(400, `Finance Gate Approval Blocked: ${errorMsg}`);
  }

  const approvedDate = formatFrappeDatetime();
  const patchFields: Record<string, unknown> = {
    workflow_state: "Pending Legal",
    status: "Pending Approval",
    current_stage: "Legal Approval",
    current_approver_role: "Legal Manager",
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
      role: "Finance Manager",
      user_role: "Finance Manager",
      action: "Approved",
      previous_state: current.workflow_status || "Pending Finance",
      new_state: "Pending Legal",
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
  if (!isFinanceManagerRole(role)) {
    throw new ErpIntakeError(403, "You do not have permission to reject at Finance stage.");
  }

  const current = await fetchBusinessCaseByIdFromErp(caseId);
  const prevWf = current?.workflow_status || "Pending Finance";

  return updateBusinessCaseStatus(
    caseId,
    {
      workflow_state: "Rejected",
      status: "Rejected",
      current_stage: "Rejected",
      current_approver_role: "None",
      finance_status: "Rejected",
      rejection_reason: remarks,
      is_locked: true,
    },
    {
      stage: "Finance",
      approver: reviewerEmail,
      role: "Finance Manager",
      user_role: "Finance Manager",
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
  if (!isFinanceManagerRole(role)) {
    throw new ErpIntakeError(403, "You do not have permission to request revision at Finance stage.");
  }

  const current = await fetchBusinessCaseByIdFromErp(caseId);
  const prevWf = current?.workflow_status || "Pending Finance";

  return updateBusinessCaseStatus(
    caseId,
    {
      workflow_state: "Revision Required (Finance)",
      status: "Revision Required (Finance)",
      current_stage: "Finance Approval",
      current_approver_role: "Finance Manager",
      finance_status: "Revision Required",
      finance_comments: remarks,
      rejection_reason: remarks,
      is_locked: false,
    },
    {
      stage: "Finance",
      approver: reviewerEmail,
      role: "Finance Manager",
      user_role: "Finance Manager",
      action: "Revision Requested",
      previous_state: prevWf,
      new_state: "Revision Required (Finance)",
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

// ── STANDALONE BUSINESS CASE WORKFLOW ENGINE (Sections 3, 5 - 14) ────────────

/**
 * Generate the next sequential Business Case ID (e.g. BC-00001).
 */
export async function getNextBusinessCaseId(): Promise<string> {
  try {
    const list = await fetchBusinessCasesFromErp();
    let maxNum = 0;
    for (const c of list) {
      const idStr = c.business_case_id || c.name || "";
      const match = idStr.match(/BC-(\d+)/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    }
    return `BC-${String(maxNum + 1).padStart(5, "0")}`;
  } catch {
    return `BC-${String(Date.now()).slice(-5)}`;
  }
}

/**
 * Create a Business Case standalone (from the 9-step wizard).
 */
export async function createBusinessCaseStandaloneInErp(
  input: CreateBusinessCaseInput,
  userEmail: string,
  userRole = "department",
  submitImmediately = true,
): Promise<BusinessCase> {
  const normRole = normalizeRoleString(userRole);
  if (!isDepartmentUserRole(userRole) && normRole !== "admin" && normRole !== "administrator") {
    throw new ErpIntakeError(403, "Access denied. Only Department Users are authorized to create Business Cases.");
  }

  const caseId = await getNextBusinessCaseId();
  const companyName = input.company || COMPANY || "Netlink";
  const now = formatFrappeDatetime();

  // Financial calculations
  const capex = Number(input.capex) || Number(input.budget) || Number(input.total_investment) || Number(input.estimated_budget) || 0;
  const opex = Number(input.opex_year) || Number(input.opex) || 0;
  const savings = Number(input.expected_annual_savings) || Number(input.expected_savings) || 0;
  const revInc = Number(input.revenue_increase__year) || Number(input.revenue_increase) || 0;
  const costAvoid = Number(input.cost_avoidance__year) || Number(input.cost_avoidance) || 0;
  const duration = Number(input.project_duration) || 5;
  const discountRate = input.discount_rate !== undefined ? Number(input.discount_rate) : 10;

  const calc = calculateBusinessCaseFinancials({
    capex,
    opex,
    expected_annual_savings: savings,
    revenue_increase: revInc,
    cost_avoidance: costAvoid,
    project_duration: duration,
    discount_rate: discountRate,
  });

  const isDraft = !submitImmediately;
  const requiresEng = input.technical_review_required !== false;
  const initialWf: BusinessCase["workflow_status"] = isDraft
    ? "Draft"
    : requiresEng
    ? "Pending Engineering"
    : "Pending Finance";
  const initialStatus: BusinessCase["status"] = isDraft ? "Draft" : "Pending Approval";

  const dtParts = now.split(" ");
  const initialHistoryEntry: BusinessCaseApprovalHistory = {
    stage: isDraft ? "Draft" : (requiresEng ? "Engineering" : "Finance"),
    approver: userEmail,
    user: userEmail,
    role: userRole === "admin" ? "Administrator" : "Department User",
    user_role: userRole === "admin" ? "Administrator" : "Department User",
    action: isDraft ? "Created" : "Submitted",
    comments: isDraft ? "Initial draft saved." : "Business case submitted for multi-stage review.",
    date: dtParts[0],
    time: dtParts[1] ? dtParts[1].substring(0, 8) : "",
    approved_on: now,
    revision_number: 1,
    previous_state: "None",
    new_state: initialWf,
    status: isDraft ? "Draft" : "Pending",
  };

  const fullCaseDoc: Record<string, unknown> = {
    doctype: BC_DOCTYPE,
    name: caseId,
    business_case_id: caseId,
    title: input.title,
    case_type: input.case_type || "Standard Procurement",
    company: companyName,
    department: input.department || "General",
    commodity: input.commodity || "",
    category: input.category || "",
    plant: input.plant || "",
    business_unit: input.business_unit || "",
    cost_center: input.cost_center || "",
    required_date: input.required_date || "",
    business_owner: input.business_owner || userEmail,
    requester: userEmail,
    created_by: userEmail,
    created_date: now,
    last_modified: now,
    priority: input.priority || "Medium",
    need_type: input.need_type || "Direct",
    status: initialStatus,
    workflow_state: initialWf,
    workflow_status: initialWf,
    version: 1,
    revision_number: 1,
    is_locked: false,

    // Justification
    why_procurement_required: input.why_procurement_required || input.problem_statement || "",
    business_problem: input.why_procurement_required || input.problem_statement || "",
    current_supplier_limitation: input.current_supplier_limitation || "",
    customer_impact: input.customer_impact || "",
    operational_impact: input.operational_impact || "",
    revenue_impact: input.revenue_impact || "",
    strategic_importance: input.strategic_importance || "Medium",
    alternatives: input.alternatives || [],

    // Review Requirements Toggles
    technical_review_required: input.technical_review_required !== undefined ? Boolean(input.technical_review_required) : true,
    finance_review_required: input.finance_review_required !== undefined ? Boolean(input.finance_review_required) : true,
    operations_review_required: Boolean(input.operations_review_required),
    quality_review_required: Boolean(input.quality_review_required),
    legal_review_required: Boolean(input.legal_review_required),
    high_value_required: Boolean(input.high_value_required || calc.total_investment >= 100000),

    // Strategy
    sourcing_strategy: input.sourcing_strategy || "Competitive RFQ",
    procurement_strategy: input.sourcing_strategy || "Competitive RFQ",
    procurement_type: input.procurement_type || "Competitive Bidding",
    supplier_strategy: input.supplier_strategy || "Multiple Supplier",
    expected_supplier_count: input.expected_supplier_count || 3,
    rfq_start_date: input.rfq_start_date || "",
    rfq_closing_date: input.rfq_closing_date || "",
    expected_award_date: input.expected_award_date || "",
    procurement_justification: input.procurement_justification || "",
    procurement_notes: input.procurement_notes || "",

    // Technical requirements child table (structured objects only, never a string)
    technical_requirements_list: input.technical_requirements_list || [],
    technical_requirements: mapToErpTechnicalRequirements(
      input.technical_requirements_list ||
      (Array.isArray(input.technical_requirements) ? input.technical_requirements : [])
    ),

    // Financial
    budget: calc.total_investment,
    total_budget: calc.total_investment,
    capex: calc.capex,
    opex: calc.opex,
    opex_year: calc.opex,
    expected_annual_savings: calc.expected_annual_savings,
    revenue_increase: calc.revenue_increase,
    cost_avoidance: calc.cost_avoidance,
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
    financial_calculated_on: now,
    currency: input.currency || "USD",

    // Risk & Compliance
    risks: input.risks || [],
    compliance_requirements: input.compliance_requirements || "",
    regulatory_requirements: input.regulatory_requirements || "",
    environmental_requirements: input.environmental_requirements || "",
    sustainability_requirements: input.sustainability_requirements || "",
    supplier_certification: input.supplier_certification || "",
    safety_requirements: input.safety_requirements || "",
    documentation_requirements: input.documentation_requirements || "",
    compliance_notes: input.compliance_notes || "",

    // Stages
    engineering_status: requiresEng ? "Pending" : "Not Required",
    finance_status: "Pending",
    procurement_status: "Pending",
    legal_status: input.legal_review_required ? "Pending" : "Not Required",
    program_manager_status: "Pending",

    approval_history: [initialHistoryEntry],
    supporting_documents: [] as IntakeAttachment[],
    documents: [] as IntakeAttachment[],
  };

  // Process and link attachments
  const rawAttachments = input.attachments || (input as any).supporting_documents || (input as any).documents || [];
  const processedAttachments: IntakeAttachment[] = [];

  for (const att of rawAttachments) {
    let fileUrl = att.file_url || att.url || "";
    let fileId = att.file_id || "";

    if (att.rawFile) {
      try {
        const uploaded = await uploadFileToERPNextDetailed(
          att.rawFile,
          BC_DOCTYPE,
          caseId,
          { isPrivate: true },
        );
        fileUrl = uploaded.file_url;
        fileId = uploaded.file_id;
      } catch (err) {
        console.warn(`[BusinessCase] Direct ERP upload for "${att.name}":`, err);
      }
    }

    const resolvedName = att.file_name || att.name || (fileUrl ? fileUrl.split("/").pop() : "Supporting Document") || "Supporting Document";
    const contentType = att.content_type || detectContentType(resolvedName || fileUrl, att.type);
    const ext = resolvedName.split(".").pop()?.toUpperCase() || "FILE";
    const isPrivate = att.is_private !== undefined ? att.is_private : fileUrl ? fileUrl.startsWith("/private/") : true;

    processedAttachments.push({
      id: att.id || fileId || `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: resolvedName,
      file_name: resolvedName,
      fileName: resolvedName,
      file_url: fileUrl || undefined,
      url: fileUrl ? getFullFileUrl(fileUrl, fileId) : undefined,
      file_id: fileId || fileUrl || `doc-${resolvedName}`,
      content_type: contentType,
      is_private: isPrivate,
      size: att.size || "1.0 MB",
      file_size: att.file_size,
      type: ext,
      fileType: contentType,
      category: att.category || att.document_type || "General Supporting Document",
      document_type: att.document_type || att.category || "General Supporting Document",
      version: att.version || "v1.0",
      status: att.status || "Available",
      uploaded_by: att.uploaded_by || userEmail,
      uploaded_on: att.uploaded_on || now,
    });
  }

  fullCaseDoc.supporting_documents = processedAttachments;
  fullCaseDoc.documents = processedAttachments;
  fullCaseDoc.attachments = processedAttachments;

  // Transactional Persistence:
  // 1. Insert into ERPNext first so errors reject immediately before workflow state is updated
  let erpInsertedDoc: Record<string, unknown> | null = null;
  try {
    const res = await apiPost<{ message?: Record<string, unknown> } | Record<string, unknown>>(
      "/api/method/frappe.client.insert",
      { doc: fullCaseDoc },
    );
    erpInsertedDoc = (res as { message?: Record<string, unknown> })?.message ?? (res as Record<string, unknown>);
  } catch (err: any) {
    // If the server answered with an error, do NOT leave the case in a falsely advanced workflow state
    if (err?.response || (err?.statusCode && err.statusCode >= 400)) {
      console.error(`[BusinessIntakeErp] ERPNext insert rejected for ${caseId}:`, err);
      const errMsg = extractErpMessage(err) || err?.message || "Business Case could not be submitted because the technical requirements could not be saved.";
      throw new ErpIntakeError(err?.response?.status || 500, errMsg);
    }
    // Offline / unit-test fallback (when ERPNext server is not reachable)
    console.warn(`[BusinessIntakeErp] ERPNext offline/test fallback for ${caseId}:`, err);
  }

  // 2. Only after ERP persistence succeeds (or validated offline fallback):
  const finalDoc = erpInsertedDoc ? { ...fullCaseDoc, ...erpInsertedDoc } : fullCaseDoc;
  const normalized = normalizeCase(finalDoc);
  saveLocalCaseExtension(caseId, finalDoc);
  saveLocalStandaloneCase(normalized);

  return normalized;
}

/**
 * Complete Engineer Technical Review.
 * Moves case from Pending Engineering to Pending Engineering Manager.
 */
export async function completeEngineerTechnicalReviewInErp(
  caseId: string,
  comments: string,
  reviewerEmail: string,
  role = "engineer",
): Promise<BusinessCase> {
  if (!isEngineerRole(role)) {
    throw new ErpIntakeError(403, "You do not have permission to complete technical review.");
  }

  const current = await fetchBusinessCaseByIdFromErp(caseId);
  const prevWf = current?.workflow_status || "Pending Engineering";
  const approvedDate = formatFrappeDatetime();
  const nextStage = "Pending Engineering Manager";

  return updateBusinessCaseStatus(
    caseId,
    {
      workflow_state: nextStage,
      status: "Pending Approval",
      current_stage: "Engineering Approval",
      current_approver_role: "Engineering Manager",
      engineering_status: "Under Review",
    },
    {
      stage: "Engineering",
      approver: reviewerEmail,
      role: "Engineer",
      user_role: "Engineer",
      action: "Technical Review Completed",
      previous_state: prevWf,
      new_state: nextStage,
      comments: comments || "Technical specifications and requirements verified by Engineer.",
      approved_on: approvedDate,
      revision_number: current?.revision_number || 1,
    },
  );
}

/**
 * Approve Engineering Stage (Engineering Manager).
 * Moves case from Pending Engineering Manager to Pending Finance.
 */
export async function approveEngineeringStageInErp(
  caseId: string,
  comments: string,
  reviewerEmail: string,
  role = "engineering_manager",
): Promise<BusinessCase> {
  if (!isEngineeringManagerRole(role)) {
    throw new ErpIntakeError(403, "You do not have permission to approve at the Engineering stage.");
  }

  const current = await fetchBusinessCaseByIdFromErp(caseId);
  const prevWf = current?.workflow_status || "Pending Engineering Manager";
  const approvedDate = formatFrappeDatetime();
  const nextStage = "Pending Finance";

  return updateBusinessCaseStatus(
    caseId,
    {
      workflow_state: nextStage,
      status: "Pending Approval",
      current_stage: "Finance Approval",
      current_approver_role: "Finance Manager",
      engineering_status: "Approved",
    },
    {
      stage: "Engineering",
      approver: reviewerEmail,
      role: "Engineering Manager",
      user_role: "Engineering Manager",
      action: "Approved",
      previous_state: prevWf,
      new_state: nextStage,
      comments: comments || "Technical specifications and engineering feasibility approved by Engineering Manager.",
      approved_on: approvedDate,
      revision_number: current?.revision_number || 1,
    },
  );
}

/**
 * Approve Finance Stage (Finance Manager).
 * Moves case from Pending Finance to Pending Legal.
 */
export async function approveFinanceStageInErp(
  caseId: string,
  comments: string,
  reviewerEmail: string,
  role = "finance",
  checklist?: Partial<FinanceChecklistState>,
): Promise<BusinessCase> {
  if (!isFinanceManagerRole(role)) {
    throw new ErpIntakeError(403, "You do not have permission to approve at the Finance stage.");
  }

  const current = await fetchBusinessCaseByIdFromErp(caseId);
  const prevWf = current?.workflow_status || "Pending Finance";
  const approvedDate = formatFrappeDatetime();
  const nextStage = "Pending Legal";

  return updateBusinessCaseStatus(
    caseId,
    {
      workflow_state: nextStage,
      status: "Pending Approval",
      current_stage: "Legal Approval",
      current_approver_role: "Legal Manager",
      finance_status: "Approved",
      finance_approved_by: reviewerEmail,
      finance_approved_on: approvedDate,
      finance_comments: comments || "Financial evaluation verified and budget approved by Finance.",
      ...(checklist ? { custom_finance_checklist: JSON.stringify(checklist) } : {}),
    },
    {
      stage: "Finance",
      approver: reviewerEmail,
      role: "Finance Manager",
      user_role: "Finance Manager",
      action: "Approved",
      previous_state: prevWf,
      new_state: nextStage,
      comments: comments || "Financial evaluation verified and budget approved by Finance.",
      approved_on: approvedDate,
      revision_number: current?.revision_number || 1,
    },
  );
}

/**
 * Approve Finance Executive Stage.
 */
export async function approveFinanceExecutiveStageInErp(
  caseId: string,
  comments: string,
  reviewerEmail: string,
  role = "finance_executive",
): Promise<BusinessCase> {
  if (!isFinanceManagerRole(role)) {
    throw new ErpIntakeError(403, "You do not have permission to approve at Finance Executive stage.");
  }

  const current = await fetchBusinessCaseByIdFromErp(caseId);
  const prevWf = current?.workflow_status || "Pending Finance Executive";
  const approvedDate = formatFrappeDatetime();

  return updateBusinessCaseStatus(
    caseId,
    {
      workflow_state: "Pending Legal",
      status: "Pending Approval",
      current_stage: "Legal Approval",
      current_approver_role: "Legal Manager",
      finance_status: "Approved",
    },
    {
      stage: "Finance Executive",
      approver: reviewerEmail,
      role: "Finance Executive",
      user_role: "Finance Executive",
      action: "Approved",
      previous_state: prevWf,
      new_state: "Pending Legal",
      comments: comments || "High-value expenditure approved by Finance Executive.",
      approved_on: approvedDate,
      revision_number: current?.revision_number || 1,
    },
  );
}

/**
 * Approve Legal Stage (Legal Manager).
 * Moves case from Pending Legal to Pending Procurement.
 */
export async function approveLegalStageInErp(
  caseId: string,
  comments: string,
  reviewerEmail: string,
  role = "legal",
  esignData?: {
    signatureName?: string;
    signedAt?: string;
    fontId?: string;
    checklist?: Record<string, boolean>;
    documentReviews?: Array<{ name: string; status: string; comments?: string }> | Record<string, { status: string; comment?: string }>;
    auditMetadata?: Record<string, unknown>;
  },
): Promise<BusinessCase> {
  if (!isLegalManagerRole(role)) {
    throw new ErpIntakeError(403, "You do not have permission to approve at Legal stage.");
  }

  const current = await fetchBusinessCaseByIdFromErp(caseId);
  if (!current) {
    throw new ErpIntakeError(404, `Business Case ${caseId} not found.`);
  }

  // Backend enforcement as per requirement 12:
  // IF currentStage !== LEGAL_APPROVAL (or LEGAL)
  // IF currentUser is not Legal Manager
  // IF status !== PENDING_LEGAL (or PENDING_APPROVAL)
  const normStage = (current.current_stage || "").toUpperCase().replace(/\s+/g, "_");
  const normWf = (current.workflow_status || current.status || "").toUpperCase().replace(/\s+/g, "_");

  const isLegalStage = normStage === "LEGAL" || normStage === "LEGAL_APPROVAL" || normStage === "LEGAL_REVIEW";
  const isPendingLegalStatus = normWf === "PENDING_LEGAL" || normWf === "PENDING_LEGAL_REVIEW" || normWf === "PENDING_APPROVAL";

  if (!isLegalStage) {
    throw new ErpIntakeError(
      400,
      `Cannot approve Legal stage: Legal approval could not be completed because this Business Case is no longer in the Legal Approval stage (current stage: "${current.current_stage || "Unknown"}").`,
    );
  }
  if (!isPendingLegalStatus) {
    throw new ErpIntakeError(
      400,
      `Cannot approve Legal stage: Legal approval could not be completed because this Business Case is not in Pending Legal status (current status: "${current.workflow_status || current.status || "Unknown"}").`,
    );
  }

  const prevWf = current?.workflow_status || "Pending Legal";
  const approvedDate = esignData?.signedAt || formatFrappeDatetime();
  const nextStage = "Pending Procurement";

  return updateBusinessCaseStatus(
    caseId,
    {
      workflow_state: nextStage,
      workflow_status: "Pending Procurement",
      status: "Pending Approval",
      current_stage: "Procurement Review",
      current_approver_role: "Procurement Manager",
      assigned_role: "Procurement Manager",
      legal_status: "Approved",
      legal_approved_by: reviewerEmail,
      legal_approved_on: approvedDate,
      legal_comments: comments || "Legal terms, compliance, and regulatory requirements approved.",
      legal_signature: esignData?.signatureName || reviewerEmail,
      legal_signed_at: approvedDate,
      legal_checklist: esignData?.checklist ? JSON.stringify(esignData.checklist) : undefined,
    },
    {
      stage: "Legal",
      approver: reviewerEmail,
      role: "Legal Manager",
      user_role: "Legal Manager",
      action: "Approved",
      previous_state: prevWf,
      new_state: nextStage,
      comments: comments || `Legal review approved with electronic signature (${esignData?.signatureName || reviewerEmail}).`,
      approved_on: approvedDate,
      revision_number: current?.revision_number || 1,
    },
  );
}

/**
 * Approve Procurement Stage (Procurement Manager).
 * Completes final review and transitions case to Ready for RFQ.
 */
export async function approveProcurementStageInErp(
  caseId: string,
  comments: string,
  reviewerEmail: string,
  role = "procurement",
): Promise<BusinessCase> {
  if (!isProcurementManagerRole(role)) {
    throw new ErpIntakeError(403, "You do not have permission to approve at Procurement stage.");
  }

  const current = await fetchBusinessCaseByIdFromErp(caseId);
  const prevWf = current?.workflow_status || "Pending Procurement";
  const approvedDate = formatFrappeDatetime();
  const nextStage = "Ready for RFQ";

  return updateBusinessCaseStatus(
    caseId,
    {
      workflow_state: nextStage,
      status: "Approved",
      current_stage: "Ready for RFQ",
      current_approver_role: "Procurement Manager (Create RFQ)",
      procurement_status: "Approved",
      is_locked: true,
    },
    {
      stage: "Procurement",
      approver: reviewerEmail,
      role: "Procurement Manager",
      user_role: "Procurement Manager",
      action: "Approved",
      previous_state: prevWf,
      new_state: nextStage,
      comments: comments || "Procurement strategy confirmed. Business Case is approved and ready for RFQ.",
      approved_on: approvedDate,
      revision_number: current?.revision_number || 1,
    },
  );
}

/**
 * Approve Program Manager Stage (Final Approval fallback).
 */
export async function approveProgramManagerStageInErp(
  caseId: string,
  comments: string,
  reviewerEmail: string,
  role = "program_manager",
): Promise<BusinessCase> {
  const normRole = normalizeRoleString(role);
  if (normRole !== "programmanager" && normRole !== "admin" && normRole !== "administrator") {
    throw new ErpIntakeError(403, "You do not have permission to grant Final Program Manager approval.");
  }

  const current = await fetchBusinessCaseByIdFromErp(caseId);
  const prevWf = current?.workflow_status || "Pending Final Approval";
  const approvedDate = formatFrappeDatetime();

  return updateBusinessCaseStatus(
    caseId,
    {
      workflow_state: "Ready for RFQ",
      status: "Approved",
      current_stage: "Ready for RFQ",
      current_approver_role: "Procurement Manager (Create RFQ)",
      program_manager_status: "Approved",
      is_locked: true,
    },
    {
      stage: "Program Manager",
      approver: reviewerEmail,
      role: "Program Manager",
      user_role: "Program Manager",
      action: "Approved",
      previous_state: prevWf,
      new_state: "Ready for RFQ",
      comments: comments || "Final approval granted. Business Case approved and unlocked for RFQ creation.",
      approved_on: approvedDate,
      revision_number: current?.revision_number || 1,
    },
  );
}

/**
 * Send Back / Request Revision from any review stage.
 */
export async function sendBackBusinessCaseInErp(
  caseId: string,
  reason: string,
  reviewerEmail: string,
  role: string,
  _targetStage = "Draft",
): Promise<BusinessCase> {
  if (!reason?.trim()) {
    throw new ErpIntakeError(400, "A reason is mandatory when sending back a Business Case.");
  }

  const current = await fetchBusinessCaseByIdFromErp(caseId);
  const prevWf = current?.workflow_status || "Under Review";
  const approvedDate = formatFrappeDatetime();
  const isFinance = isFinanceManagerRole(role);
  const isLegal = isLegalManagerRole(role);
  const nextState = isFinance ? "Revision Required (Finance)" : "Returned";
  const stageName = isFinance ? "Finance" : isLegal ? "Legal" : (current?.current_stage || "Review");
  const approverRole = isFinance ? "Finance Manager" : "Department User";

  return updateBusinessCaseStatus(
    caseId,
    {
      workflow_state: nextState,
      status: nextState,
      current_stage: isFinance ? "Finance Approval" : "Returned",
      current_approver_role: approverRole,
      assigned_role: approverRole,
      rejection_reason: reason,
      finance_comments: isFinance ? reason : current?.finance_comments,
      finance_status: isFinance ? "Revision Required" : current?.finance_status,
      legal_comments: isLegal ? reason : current?.legal_comments,
      legal_status: isLegal ? "Revision Requested" : current?.legal_status,
      is_locked: false,
    },
    {
      stage: stageName,
      approver: reviewerEmail,
      role: isFinance ? "Finance Manager" : isLegal ? "Legal Manager" : (role || "Reviewer"),
      user_role: isFinance ? "Finance Manager" : isLegal ? "Legal Manager" : (role || "Reviewer"),
      action: "Returned",
      previous_state: prevWf,
      new_state: nextState,
      comments: reason,
      approved_on: approvedDate,
      revision_number: (current?.revision_number || 1) + 1,
    },
    true, // incrementRevision
  );
}

/**
 * Reject Business Case.
 */
export async function rejectBusinessCaseInErp(
  caseId: string,
  reason: string,
  reviewerEmail: string,
  role: string,
): Promise<BusinessCase> {
  if (!reason?.trim()) {
    throw new ErpIntakeError(400, "A rejection reason is mandatory.");
  }

  const current = await fetchBusinessCaseByIdFromErp(caseId);
  const prevWf = current?.workflow_status || "Under Review";
  const approvedDate = formatFrappeDatetime();
  const isFinance = isFinanceManagerRole(role);
  const isLegal = isLegalManagerRole(role);

  return updateBusinessCaseStatus(
    caseId,
    {
      workflow_state: "Rejected",
      status: "Rejected",
      current_stage: "Rejected",
      current_approver_role: "None",
      assigned_role: "None",
      finance_status: isFinance ? "Rejected" : current?.finance_status,
      legal_status: isLegal ? "Rejected" : current?.legal_status,
      legal_comments: isLegal ? reason : current?.legal_comments,
      rejection_reason: reason,
      is_locked: true,
    },
    {
      stage: isFinance ? "Finance" : isLegal ? "Legal" : (current?.current_stage || "Review"),
      approver: reviewerEmail,
      role: isFinance ? "Finance Manager" : isLegal ? "Legal Manager" : (role || "Reviewer"),
      user_role: isFinance ? "Finance Manager" : isLegal ? "Legal Manager" : (role || "Reviewer"),
      action: "Rejected",
      previous_state: prevWf,
      new_state: "Rejected",
      comments: reason,
      approved_on: approvedDate,
      revision_number: current?.revision_number || 1,
    },
  );
}

/**
 * Resubmit a Returned Business Case.
 */
export async function resubmitBusinessCaseInErp(
  caseId: string,
  updatedData: Partial<CreateBusinessCaseInput>,
  userEmail: string,
  role = "department",
): Promise<BusinessCase> {
  const current = await fetchBusinessCaseByIdFromErp(caseId);
  if (!current) throw new ErpIntakeNotFoundError(BC_DOCTYPE, caseId);

  const prevWf = current.workflow_status;
  const requiresEng = updatedData.technical_review_required !== undefined
    ? Boolean(updatedData.technical_review_required)
    : Boolean(current.technical_review_required);

  const nextStage: BusinessCase["workflow_status"] = requiresEng
    ? "Pending Engineering"
    : "Pending Finance";

  const approvedDate = formatFrappeDatetime();
  const techList = updatedData.technical_requirements_list ||
    (Array.isArray(updatedData.technical_requirements) ? updatedData.technical_requirements : current.technical_requirements_list);
  const patchFields: Record<string, unknown> = {
    ...updatedData,
    technical_requirements_list: techList,
    technical_requirements: mapToErpTechnicalRequirements(techList as any),
    workflow_state: nextStage,
    status: "Pending Approval",
    engineering_status: requiresEng ? "Pending" : "Not Required",
    finance_status: "Pending",
    is_locked: false,
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
      new_state: nextStage,
      comments: "Revised Business Case resubmitted for approval.",
      approved_on: approvedDate,
      revision_number: (current.revision_number || 1) + 1,
    },
    true,
  );
}

/**
 * Update a specific section of a Business Case enforcing role write permissions.
 */
export async function updateBusinessCaseSectionInErp(
  caseId: string,
  section: "business_info" | "justification" | "financial" | "technical" | "strategy" | "risk" | "compliance" | "general",
  data: Record<string, unknown>,
  _userEmail: string,
  userRole: string,
): Promise<BusinessCase> {
  const current = await fetchBusinessCaseByIdFromErp(caseId);
  if (!current) throw new ErpIntakeNotFoundError(BC_DOCTYPE, caseId);

  const normRole = (userRole || "").toLowerCase().trim();
  const isDraftOrReturned = current.workflow_status === "Draft" || current.workflow_status === "Returned";

  // Check section write permissions
  if (normRole === "admin" || isDraftOrReturned) {
    // Permitted to edit all sections
  } else if (section === "technical" && ["engineer", "engineering_manager", "engineering"].includes(normRole)) {
    // Engineer permitted to edit technical specs
  } else if (section === "financial" && ["finance", "finance_executive"].includes(normRole)) {
    // Finance permitted to edit financials
  } else if (section === "strategy" && ["procurement", "procurement_team", "sourcing_manager"].includes(normRole)) {
    // Procurement permitted to edit procurement strategy
  } else if (section === "compliance" && ["legal"].includes(normRole)) {
    // Legal permitted to edit legal compliance
  } else {
    throw new ErpIntakeError(403, `Role "${userRole}" is not authorized to edit the "${section}" section while status is "${current.workflow_status}".`);
  }

  // If financial assumptions are updated, recalculate financials
  let calculatedMetrics: Record<string, unknown> = {};
  if (section === "financial" || data.capex !== undefined || data.opex_year !== undefined) {
    const capex = Number(data.capex ?? current.capex) || 0;
    const opex = Number(data.opex_year ?? data.opex ?? current.opex) || 0;
    const savings = Number(data.expected_annual_savings ?? data.expected_savings ?? current.expected_annual_savings) || 0;
    const revInc = Number(data.revenue_increase__year ?? data.revenue_increase ?? current.revenue_increase) || 0;
    const costAvoid = Number(data.cost_avoidance__year ?? data.cost_avoidance ?? current.cost_avoidance) || 0;
    const duration = Number(data.project_duration ?? current.project_duration) || 5;
    const discountRate = data.discount_rate !== undefined ? Number(data.discount_rate) : Number(current.discount_rate || 10);

    const calc = calculateBusinessCaseFinancials({
      capex,
      opex,
      expected_annual_savings: savings,
      revenue_increase: revInc,
      cost_avoidance: costAvoid,
      project_duration: duration,
      discount_rate: discountRate,
    });

    calculatedMetrics = {
      budget: calc.total_investment,
      total_budget: calc.total_investment,
      capex: calc.capex,
      opex: calc.opex,
      opex_year: calc.opex,
      expected_annual_savings: calc.expected_annual_savings,
      revenue_increase: calc.revenue_increase,
      cost_avoidance: calc.cost_avoidance,
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
    };
  }

  const patchFields: Record<string, unknown> = {
    ...data,
    ...calculatedMetrics,
    last_modified: formatFrappeDatetime(),
  };

  saveLocalCaseExtension(caseId, patchFields);

  // Update standalone list if present
  const standalones = getLocalStandaloneCases();
  const sIdx = standalones.findIndex(c => c.name === caseId || c.business_case_id === caseId);
  if (sIdx >= 0) {
    standalones[sIdx] = normalizeCase({ ...standalones[sIdx], ...patchFields } as any);
    if (typeof window !== "undefined" && window.localStorage) {
      localStorage.setItem(BC_LOCAL_STANDALONE_KEY, JSON.stringify(standalones));
    }
  }

  try {
    await apiPost("/api/method/frappe.client.set_value", {
      doctype: BC_DOCTYPE,
      name: caseId,
      fieldname: patchFields,
    });
  } catch (err) {
    console.warn(`[BusinessIntakeErp] Non-blocking set_value error for section ${section}:`, err);
  }

  const updated = await fetchBusinessCaseByIdFromErp(caseId);
  return updated || normalizeCase({ ...current, ...patchFields } as any);
}
