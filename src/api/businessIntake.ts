/**
 * API & Workflow Engine for Enterprise Business Intake Module.
 *
 * This file is the public interface consumed by all pages/components.
 * It delegates to `businessIntakeErp.ts` which calls the real ERPNext REST API.
 *
 * The exported function signatures are unchanged so all existing call-sites
 * continue to compile without modification.
 *
 * Lifecycle:
 *   Business Need  →  Business Case  →  Finance  →  Legal  →  Procurement  →  RFQ
 *
 * CRITICAL RULE: NO Department Head role or approval step exists.
 */

import type {
  BusinessNeed,
  BusinessCase,
  CreateBusinessNeedInput,
  CreateBusinessCaseInput,
  NeedStatus,
  FinanceChecklistState,
} from "../types/businessIntake";

import type { AppRole } from "../config/roles";

import {
  fetchBusinessNeedsFromErp,
  fetchBusinessNeedByIdFromErp,
  createBusinessNeedInErp,
  submitBusinessNeedInErp,
  updateBusinessNeedStatusInErp,
  updateBusinessNeedLatest,
  createBusinessCaseInErp,
  fetchBusinessCasesFromErp,
  fetchBusinessCaseByIdFromErp,
  fetchPendingBusinessCasesFromErp,
  fetchAttachedFilesFromErp,
  propagateBusinessNeedFilesToBusinessCase,
  validateFinanceGateInErp,
  saveBusinessCaseFinancialsInErp,
  approveFinanceInErp,
  rejectFinanceInErp,
  requestFinanceRevisionInErp,
  approveLegalInErp,
  rejectLegalInErp,
  requestLegalRevisionInErp,
  markProcurementReadyInErp,
  resubmitBusinessCaseRevisionInErp,
  linkRfqToBusinessCaseInErp,
  ErpIntakeError,
  validateIntakeDocTypeFields,
} from "./businessIntakeErp";

import { createNotification } from "./notifications";
import { uploadFileToERPNextDetailed } from "./legalDocsStorage";

export const saveBusinessCaseFinancials = saveBusinessCaseFinancialsInErp;

// ── Re-export ERP functions & error types ─────────────────────────────────────

export {
  ErpIntakeError,
  submitBusinessNeedInErp,
  updateBusinessNeedStatusInErp,
  updateBusinessNeedLatest,
  fetchAttachedFilesFromErp,
  propagateBusinessNeedFilesToBusinessCase,
  validateFinanceGateInErp,
  validateFinanceGateInErp as validateFinanceGate,
  markProcurementReadyInErp,
  resubmitBusinessCaseRevisionInErp,
};

// ── Error types (kept for compatibility) ─────────────────────────────────────

export class UnauthorizedError extends Error {
  constructor(action: string, role: string) {
    super(`Role "${role}" is not authorized to perform action "${action}".`);
    this.name = "UnauthorizedError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

// ── Permission helper ────────────────────────────────────────────────────────

function checkPermission(
  userRole: AppRole | string,
  allowedRoles: Array<AppRole | string>,
  action: string,
): void {
  const normRole = (userRole || "").toLowerCase().trim();
  const normalizedAllowed = allowedRoles.map((r) => r.toLowerCase().trim());
  if (normRole === "admin") return;
  if (!normalizedAllowed.includes(normRole)) {
    throw new UnauthorizedError(action, userRole);
  }
}

// ── Notification helper ──────────────────────────────────────────────────────

async function createEnterpriseNotification(input: {
  title: string;
  message: string;
  module: string;
  target_roles: string[];
  target_route: string;
  document_id: string;
}) {
  try {
    for (const r of input.target_roles) {
      createNotification({
        title: input.title,
        description: input.message,
        module: "Finance Approval" as any,
        event_type: "finance_review_required",
        target_role: r as any,
        document_type: "Business Case",
        document_name: input.document_id,
        route_path: input.target_route,
      });
    }
  } catch (err) {
    console.warn("[BusinessIntake] Notification trigger failed:", err);
  }
}

// ── One-time field validation (DEV only) ─────────────────────────────────────

let _fieldsValidated = false;
async function runFieldValidation() {
  if (_fieldsValidated || !import.meta.env.DEV) return;
  _fieldsValidated = true;
  await validateIntakeDocTypeFields();
}

// ── BUSINESS NEED OPERATIONS ─────────────────────────────────────────────────

export async function fetchBusinessNeeds(filters?: {
  department?: string;
  status?: string;
  requester?: string;
  priority?: string;
  need_type?: string;
  project?: string;
  plant?: string;
  search?: string;
}): Promise<BusinessNeed[]> {
  void runFieldValidation();
  const list = await fetchBusinessNeedsFromErp(filters);

  // Client-side search (ERPNext list API does not support LIKE filtering
  // without frappe.client.get_list, so we filter here for simplicity)
  if (filters?.search?.trim()) {
    const q = filters.search.toLowerCase().trim();
    return list.filter(
      (n) =>
        (n.name ?? "").toLowerCase().includes(q) ||
        (n.title ?? "").toLowerCase().includes(q) ||
        (n.department ?? "").toLowerCase().includes(q) ||
        (n.project && n.project.toLowerCase().includes(q)),
    );
  }

  if (filters?.requester?.trim()) {
    const r = filters.requester.toLowerCase().trim();
    return list.filter(
      (n) =>
        (n.requester ?? "").toLowerCase() === r ||
        (n.requester_email ?? "").toLowerCase() === r,
    );
  }

  return list;
}

/** Alias for getBusinessNeeds required by requirement #4 */
export const getBusinessNeeds = fetchBusinessNeeds;

export async function fetchBusinessNeedById(
  id: string,
): Promise<BusinessNeed | null> {
  return fetchBusinessNeedByIdFromErp(id);
}

/**
 * Create and submit a Business Need in ERPNext.
 *
 * Safe Architecture:
 * 1. Create Business Need in ERPNext + upload attachments.
 * 2. ERPNext confirms creation & returns the freshly fetched latest document.
 * 3. Idempotently check/create the Business Case linked to this Business Need.
 * 4. Atomically update Business Need with status="Submitted" & linked Business Case ID.
 * 5. Fetch and return the final persisted ERPNext document.
 */
export async function createBusinessNeed(
  input: CreateBusinessNeedInput,
  userEmail: string,
  userRole: AppRole | string,
  submitImmediately = true,
): Promise<BusinessNeed> {
  console.log("[BusinessNeedSubmit] started", {
    title: input.title,
    submitImmediately,
    userEmail,
    userRole,
  });

  checkPermission(
    userRole,
    ["department", "department_user", "procurement", "admin"],
    "Create Business Need",
  );

  console.log("[BusinessNeedSubmit] validating payload", {
    title: !!input.title,
    department: !!input.department,
    need_type: !!input.need_type,
    priority: !!input.priority,
    problem_statement: !!input.problem_statement,
    business_owner: !!input.business_owner,
    estimated_budget: input.estimated_budget,
  });

  // Mandatory field validation
  if (!input.title?.trim()) throw new ValidationError("Title is mandatory.");
  if (!input.department?.trim())
    throw new ValidationError("Department is mandatory.");
  if (!input.need_type) throw new ValidationError("Need Type is mandatory.");
  if (!input.priority) throw new ValidationError("Priority is mandatory.");
  if (!input.problem_statement?.trim())
    throw new ValidationError("Problem Statement is mandatory.");
  if (!input.business_owner?.trim())
    throw new ValidationError("Business Owner is mandatory.");
  if (!input.estimated_budget || input.estimated_budget <= 0) {
    throw new ValidationError(
      "Estimated Budget must be a positive amount.",
    );
  }

  // STEP 1 & 2: Create Business Need document + re-link attachments
  // (createBusinessNeedInErp automatically fetches and returns the fresh latest doc)
  console.log("[BusinessNeedSubmit] creating Business Need document");
  let created: BusinessNeed;
  try {
    created = await createBusinessNeedInErp(input, userEmail);
    console.log("[BusinessNeedSubmit] ERP response", {
      businessNeedName: created.name,
      status: created.status,
    });
  } catch (err: any) {
    console.error("[BusinessNeedSubmit] Failure creating Business Need:", {
      status: err?.statusCode || err?.response?.status || 500,
      message: err?.message,
      operation: "createBusinessNeedInErp",
    });
    throw err;
  }

  if (!submitImmediately) return created;

  // STEP 3: Idempotency check before creating Business Case
  console.log(`[BusinessNeedSubmit] Checking for existing Business Case for ${created.name}...`);
  let existingCaseName = created.business_case || "";

  if (!existingCaseName) {
    try {
      const existingCases = await fetchBusinessCasesFromErp();
      const match = existingCases.find(
        (c) =>
          c.business_need_id === created.name ||
          (c as any).business_need === created.name,
      );
      if (match) {
        existingCaseName = match.name || match.business_case_id;
        console.log(`[BusinessNeedSubmit] Reusing existing Business Case: ${existingCaseName}`);
      }
    } catch (err) {
      console.warn("[BusinessNeedSubmit] Could not check existing business cases:", err);
    }
  }

  let businessCase: BusinessCase | null = null;
  if (existingCaseName) {
    businessCase = await fetchBusinessCaseByIdFromErp(existingCaseName);
  }

  if (!businessCase) {
    console.log(`[BusinessNeedSubmit] creating Business Case for ${created.name}`);
    try {
      businessCase = await createBusinessCaseInErp(created);
      console.log("[BusinessNeedSubmit] ERP response", {
        businessCaseName: businessCase.name,
        workflowState: businessCase.workflow_status,
        status: businessCase.workflow_status,
      });
    } catch (err: any) {
      console.error("[BusinessNeedSubmit] Business Case auto-creation failed:", {
        status: err?.statusCode || err?.response?.status || 500,
        message: err?.message,
        operation: "createBusinessCaseInErp",
        businessNeedName: created.name,
      });
      throw new ErpIntakeError(
        500,
        `Business Need "${created.name}" created, but failed to create linked Business Case: ${err?.message || "ERPNext validation error"}.`,
      );
    }
  }

  // STEP 3.5: Propagate uploaded supporting documents to the Business Case
  if (businessCase) {
    try {
      await propagateBusinessNeedFilesToBusinessCase(created.name, businessCase.name);
    } catch (err) {
      console.warn(`[BusinessNeedSubmit] Attachment propagation to ${businessCase.name} non-blocking warning:`, err);
    }
  }

  // Notify Finance of the new Business Case
  if (businessCase) {
    void createEnterpriseNotification({
      title: `Finance Review Required: ${businessCase.name}`,
      message: `Business Case ${businessCase.name} (${businessCase.title}) is waiting for Finance approval.`,
      module: "intake",
      target_roles: ["finance", "finance_executive", "admin"],
      target_route: `/intake/business-cases/${businessCase.name}`,
      document_id: businessCase.name,
    });
  }

  // STEP 4 & 5: Atomically update Business Need with status and linkage, fetching final doc
  console.log(`[BusinessNeedSubmit] updating Business Need ${created.name} status to Submitted and linking ${businessCase.name}`);
  const finalPersistedNeed = await updateBusinessNeedLatest(created.name, {
    status: "Submitted",
    workflow_state: "Submitted",
    business_case: businessCase.name,
    linked_business_case_id: businessCase.name,
  });

  console.log("[BusinessNeedSubmit] completed", {
    businessNeed: finalPersistedNeed.name,
    status: finalPersistedNeed.status,
    businessCase: finalPersistedNeed.business_case,
  });

  return finalPersistedNeed;
}

/**
 * Save or update a Business Need Draft without creating a Business Case or triggering approval workflow.
 */
export async function saveBusinessNeedDraft(
  input: Partial<CreateBusinessNeedInput> & { title: string },
  userEmail: string,
  userRole: AppRole | string,
  existingId?: string,
): Promise<BusinessNeed> {
  checkPermission(
    userRole,
    ["department", "department_user", "procurement", "admin"],
    "Save Business Need Draft",
  );

  if (!input.title?.trim()) {
    throw new ValidationError("A title is required to save a draft.");
  }

  if (existingId) {
    const updates: Record<string, unknown> = {
      title: input.title,
      description: input.description || "",
      need_type: input.need_type || "Direct",
      priority: input.priority || "Medium",
      requirement_category: input.requirement_category || "",
      requirement_type: input.requirement_type || "",
      company: input.company,
      department: input.department,
      business_unit: input.business_unit,
      plant: input.plant || input.plant_location,
      cost_center: input.cost_center,
      project: input.project || input.project_name,
      project_code: input.project_code,
      program: input.program || input.program_name,
      business_area: input.business_area,
      business_owner: input.business_owner,
      business_owner_email: input.business_owner_email,
      required_by_date: input.required_by_date || null,
      expected_completion_date: input.expected_completion_date || null,
      problem_statement: input.problem_statement || input.description || "",
      business_problem: input.business_problem || input.problem_statement || input.description || "",
      business_justification: input.business_justification || "",
      estimated_budget: input.estimated_budget || 0,
      estimated_quantity: input.estimated_quantity || 1,
      currency: input.currency || "USD",
      budget_type: input.budget_type || "CAPEX",
      funding_source: input.funding_source || "",
    };

    const cleanUpdates: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined) cleanUpdates[k] = v;
    }

    const updated = await updateBusinessNeedLatest(existingId, cleanUpdates);

    // Upload pending attachments
    if (input.attachments && input.attachments.length > 0) {
      for (const att of input.attachments) {
        if (att.rawFile) {
          try {
            await uploadFileToERPNextDetailed(att.rawFile, "Business Need", existingId, { isPrivate: true });
          } catch (e) {
            console.warn(`[BusinessNeed] Could not upload attachment "${att.name}" for draft:`, e);
          }
        }
      }
    }

    return (await fetchBusinessNeedByIdFromErp(existingId)) || updated;
  }

  // Create new draft
  const fullInput: CreateBusinessNeedInput = {
    title: input.title,
    description: input.description || "",
    need_type: input.need_type || "Direct",
    priority: input.priority || "Medium",
    requirement_category: input.requirement_category || "",
    requirement_type: input.requirement_type || "",
    company: input.company || "Netlink",
    department: input.department || "IT & Digital Transformation",
    business_unit: input.business_unit || "",
    plant: input.plant || input.plant_location || "",
    cost_center: input.cost_center || "",
    project: input.project || input.project_name || "",
    project_code: input.project_code || "",
    program: input.program || input.program_name || "",
    business_area: input.business_area || "",
    requester: input.requester || userEmail,
    requester_email: input.requester_email || userEmail,
    business_owner: input.business_owner || userEmail,
    business_owner_email: input.business_owner_email || userEmail,
    required_by_date: input.required_by_date,
    expected_completion_date: input.expected_completion_date,
    problem_statement: input.problem_statement || input.description || "",
    business_problem: input.business_problem || input.problem_statement || input.description || "",
    business_justification: input.business_justification || "",
    estimated_budget: input.estimated_budget || 0,
    estimated_quantity: input.estimated_quantity || 1,
    currency: input.currency || "USD",
    budget_type: input.budget_type || "CAPEX",
    funding_source: input.funding_source || "",
    attachments: input.attachments || [],
  };

  return createBusinessNeedInErp(fullInput, userEmail);
}

/**
 * Submit an existing Business Need draft and generate the linked Business Case.
 */
export async function submitExistingBusinessNeedDraft(
  needId: string,
  input: CreateBusinessNeedInput,
  userEmail: string,
  userRole: AppRole | string,
  ): Promise<BusinessNeed> {
  console.log("[BusinessNeedSubmit] started", {
    operation: "submitExistingBusinessNeedDraft",
    needId,
    title: input.title,
    userEmail,
    userRole,
  });

  checkPermission(
    userRole,
    ["department", "department_user", "procurement", "admin"],
    "Submit Business Need",
  );

  console.log("[BusinessNeedSubmit] validating payload", {
    title: !!input.title,
    department: !!input.department,
    need_type: !!input.need_type,
    priority: !!input.priority,
    problem_statement: !!input.problem_statement,
    business_owner: !!input.business_owner,
    estimated_budget: input.estimated_budget,
  });

  // Mandatory field validation
  if (!input.title?.trim()) throw new ValidationError("Title is mandatory.");
  if (!input.department?.trim()) throw new ValidationError("Department is mandatory.");
  if (!input.need_type) throw new ValidationError("Need Type is mandatory.");
  if (!input.priority) throw new ValidationError("Priority is mandatory.");
  if (!input.problem_statement?.trim()) throw new ValidationError("Problem Statement is mandatory.");
  if (!input.business_owner?.trim()) throw new ValidationError("Business Owner is mandatory.");
  if (!input.estimated_budget || input.estimated_budget <= 0) {
    throw new ValidationError("Estimated Budget must be a positive amount.");
  }

  // Update fields on the existing Business Need
  const updates: Record<string, unknown> = {
    title: input.title,
    description: input.description,
    need_type: input.need_type,
    priority: input.priority,
    requirement_category: input.requirement_category || "",
    requirement_type: input.requirement_type || "",
    company: input.company,
    department: input.department,
    business_unit: input.business_unit || "",
    plant: input.plant || input.plant_location || "",
    cost_center: input.cost_center || "",
    project: input.project || input.project_name || "",
    project_code: input.project_code || "",
    program: input.program || input.program_name || "",
    business_area: input.business_area || "",
    business_owner: input.business_owner,
    business_owner_email: input.business_owner_email || input.business_owner,
    required_by_date: input.required_by_date || null,
    expected_completion_date: input.expected_completion_date || null,
    problem_statement: input.problem_statement,
    business_problem: input.business_problem || input.problem_statement,
    business_justification: input.business_justification || "",
    estimated_budget: input.estimated_budget,
    estimated_quantity: input.estimated_quantity || 1,
    currency: input.currency || "USD",
    budget_type: input.budget_type || "CAPEX",
    funding_source: input.funding_source || "",
  };

  console.log(`[BusinessNeedSubmit] updating Business Need ${needId}`);
  await updateBusinessNeedLatest(needId, updates);

  // Upload any pending rawFile attachments
  if (input.attachments && input.attachments.length > 0) {
    for (const att of input.attachments) {
      if (att.rawFile) {
        try {
          await uploadFileToERPNextDetailed(att.rawFile, "Business Need", needId, { isPrivate: true });
        } catch (e) {
          console.warn(`[BusinessNeedSubmit] Could not upload attachment "${att.name}":`, e);
        }
      }
    }
  }

  const latestNeed = await fetchBusinessNeedByIdFromErp(needId);
  if (!latestNeed) throw new ValidationError(`Business Need ${needId} not found.`);

  // Auto-create Business Case
  let businessCase: BusinessCase | null = null;
  let existingCaseName = latestNeed.business_case || "";

  if (!existingCaseName) {
    try {
      const existingCases = await fetchBusinessCasesFromErp();
      const match = existingCases.find(
        (c) =>
          c.business_need_id === latestNeed.name ||
          (c as any).business_need === latestNeed.name,
      );
      if (match) {
        existingCaseName = match.name || match.business_case_id;
        console.log(`[BusinessNeedSubmit] Reusing existing Business Case: ${existingCaseName}`);
      }
    } catch (err) {
      console.warn("[BusinessNeedSubmit] Could not check existing business cases:", err);
    }
  }

  if (existingCaseName) {
    businessCase = await fetchBusinessCaseByIdFromErp(existingCaseName);
  }

  if (!businessCase) {
    console.log(`[BusinessNeedSubmit] creating Business Case for ${latestNeed.name}`);
    try {
      businessCase = await createBusinessCaseInErp(latestNeed);
      console.log("[BusinessNeedSubmit] ERP response", {
        businessCaseName: businessCase.name,
        workflowState: businessCase.workflow_status,
        status: businessCase.workflow_status,
      });
    } catch (err: any) {
      console.error("[BusinessNeedSubmit] Business Case creation failed:", {
        status: err?.statusCode || err?.response?.status || 500,
        message: err?.message,
        operation: "createBusinessCaseInErp",
        businessNeedName: latestNeed.name,
      });
      throw new ErpIntakeError(
        500,
        `Business Need "${latestNeed.name}" saved, but failed to create linked Business Case: ${err?.message || "ERPNext validation error"}.`,
      );
    }
  }

  if (businessCase) {
    try {
      await propagateBusinessNeedFilesToBusinessCase(latestNeed.name, businessCase.name);
    } catch (err) {
      console.warn(`[BusinessNeedSubmit] Attachment propagation warning:`, err);
    }

    void createEnterpriseNotification({
      title: `Finance Review Required: ${businessCase.name}`,
      message: `Business Case ${businessCase.name} (${businessCase.title}) is waiting for Finance approval.`,
      module: "intake",
      target_roles: ["finance", "finance_executive", "admin"],
      target_route: `/intake/business-cases/${businessCase.name}`,
      document_id: businessCase.name,
    });
  }

  console.log(`[BusinessNeedSubmit] updating Business Need ${latestNeed.name} status to Submitted and linking ${businessCase?.name}`);
  const finalPersisted = await updateBusinessNeedLatest(latestNeed.name, {
    status: "Submitted",
    workflow_state: "Submitted",
    business_case: businessCase ? businessCase.name : "",
    linked_business_case_id: businessCase ? businessCase.name : "",
  });

  console.log("[BusinessNeedSubmit] completed", {
    businessNeed: finalPersisted.name,
    status: finalPersisted.status,
    businessCase: finalPersisted.business_case,
  });

  return finalPersisted;
}

export async function autoApproveNeedAndCreateCase(
  needInput: BusinessNeed,
  _userEmail: string,
): Promise<{ need: BusinessNeed; businessCase: BusinessCase }> {
  // Fetch fresh latest need before operating
  const latestNeed = (await fetchBusinessNeedByIdFromErp(needInput.name)) || needInput;
  const businessCase = await createBusinessCaseInErp(latestNeed);
  const updatedNeed = await updateBusinessNeedLatest(latestNeed.name, {
    status: "Approved",
    workflow_state: "Approved",
    business_case: businessCase.name,
    linked_business_case_id: businessCase.name,
  });
  return { need: updatedNeed, businessCase };
}

export async function rejectBusinessNeed(
  needId: string,
  rejectionReason: string,
  _reviewerEmail: string,
): Promise<BusinessNeed> {
  const need = await fetchBusinessNeedByIdFromErp(needId);
  if (!need) throw new ValidationError(`Business Need ${needId} not found.`);

  return updateBusinessNeedLatest(needId, {
    status: "Rejected",
    workflow_state: "Rejected",
    rejection_reason: rejectionReason,
  });
}

// ── BUSINESS CASE OPERATIONS ─────────────────────────────────────────────────

export async function fetchBusinessCases(filters?: {
  department?: string;
  approval_status?: string;
  workflow_status?: string;
  finance_status?: string;
  legal_status?: string;
  search?: string;
}): Promise<BusinessCase[]> {
  // Map legacy approval_status/workflow_status → ERPNext "status" field
  const erpFilters: Parameters<typeof fetchBusinessCasesFromErp>[0] = {};
  if (filters?.department) erpFilters.department = filters.department;
  if (filters?.finance_status)
    erpFilters.finance_status = filters.finance_status;
  if (filters?.legal_status) erpFilters.legal_status = filters.legal_status;
  if (filters?.workflow_status || filters?.approval_status) {
    erpFilters.status =
      filters.workflow_status ?? filters.approval_status;
  }

  const list = await fetchBusinessCasesFromErp(erpFilters);

  if (filters?.search?.trim()) {
    const q = filters.search.toLowerCase().trim();
    return list.filter(
      (c) =>
        (c.name ?? "").toLowerCase().includes(q) ||
        (c.title ?? "").toLowerCase().includes(q) ||
        (c.department ?? "").toLowerCase().includes(q) ||
        (c.business_owner ?? "").toLowerCase().includes(q),
    );
  }

  return list;
}

export async function fetchBusinessCaseById(
  id: string,
): Promise<BusinessCase | null> {
  return fetchBusinessCaseByIdFromErp(id);
}

// ── FINANCE REVIEW GATE ──────────────────────────────────────────────────────

export async function approveFinanceReview(
  caseId: string,
  comments: string,
  reviewerEmail: string,
  userRole: AppRole | string,
  checklist?: Partial<FinanceChecklistState>,
): Promise<BusinessCase> {
  checkPermission(
    userRole,
    ["finance", "finance_executive", "admin"],
    "Approve Finance Review",
  );
  const result = await approveFinanceInErp(
    caseId,
    comments,
    reviewerEmail,
    typeof userRole === "string" ? userRole : "finance",
    checklist,
  );

  await createEnterpriseNotification({
    title: `Legal Review Required: ${caseId}`,
    message: `Business Case ${caseId} passed Finance approval and requires Legal Review.`,
    module: "intake",
    target_roles: ["legal", "admin"],
    target_route: `/intake/business-cases/${caseId}`,
    document_id: caseId,
  });

  return result;
}

export async function rejectBusinessCaseAtFinance(
  caseId: string,
  rejectionReason: string,
  reviewerEmail: string,
  userRole: AppRole | string,
): Promise<BusinessCase> {
  checkPermission(
    userRole,
    ["finance", "finance_executive", "admin"],
    "Reject Finance Review",
  );
  return rejectFinanceInErp(caseId, rejectionReason, reviewerEmail, typeof userRole === "string" ? userRole : "finance");
}

export async function requestFinanceRevision(
  caseId: string,
  revisionNotes: string,
  reviewerEmail: string,
  userRole: AppRole | string,
): Promise<BusinessCase> {
  checkPermission(
    userRole,
    ["finance", "finance_executive", "admin"],
    "Request Finance Revision",
  );
  return requestFinanceRevisionInErp(caseId, revisionNotes, reviewerEmail, typeof userRole === "string" ? userRole : "finance");
}

// ── LEGAL REVIEW GATE ────────────────────────────────────────────────────────

export async function approveLegalReview(
  caseId: string,
  comments: string,
  reviewerEmail: string,
  userRole: AppRole | string,
): Promise<BusinessCase> {
  checkPermission(userRole, ["legal", "admin"], "Approve Legal Review");
  const result = await approveLegalInErp(caseId, comments, reviewerEmail, typeof userRole === "string" ? userRole : "legal");

  await createEnterpriseNotification({
    title: `Business Case Pending Procurement: ${caseId}`,
    message: `Business Case ${caseId} passed Legal approval and is ready for Procurement review.`,
    module: "intake",
    target_roles: ["procurement", "procurement_team", "admin"],
    target_route: `/intake/business-cases/${caseId}`,
    document_id: caseId,
  });

  return result;
}

export async function rejectBusinessCaseAtLegal(
  caseId: string,
  rejectionReason: string,
  reviewerEmail: string,
  userRole: AppRole | string,
): Promise<BusinessCase> {
  checkPermission(userRole, ["legal", "admin"], "Reject Legal Review");
  return rejectLegalInErp(caseId, rejectionReason, reviewerEmail, typeof userRole === "string" ? userRole : "legal");
}

export async function requestLegalRevision(
  caseId: string,
  revisionNotes: string,
  reviewerEmail: string,
  userRole: AppRole | string,
): Promise<BusinessCase> {
  checkPermission(userRole, ["legal", "admin"], "Request Legal Revision");
  return requestLegalRevisionInErp(caseId, revisionNotes, reviewerEmail, typeof userRole === "string" ? userRole : "legal");
}

// ── REVISION RESUBMISSION ────────────────────────────────────────────────────

export async function resubmitBusinessCaseRevision(
  caseId: string,
  updatedData: Partial<CreateBusinessCaseInput>,
  userEmail: string,
  userRole: AppRole | string,
): Promise<BusinessCase> {
  checkPermission(
    userRole,
    ["department", "department_user", "admin"],
    "Resubmit Business Case Revision",
  );

  return resubmitBusinessCaseRevisionInErp(
    caseId,
    updatedData as Record<string, unknown>,
    userEmail,
    typeof userRole === "string" ? userRole : "department",
  );
}

// ── PROCUREMENT QUEUE & RFQ LINKAGE ─────────────────────────────────────────

export async function markProcurementReady(
  caseId: string,
  comments: string,
  reviewerEmail: string,
  userRole: AppRole | string,
): Promise<BusinessCase> {
  checkPermission(
    userRole,
    ["procurement", "procurement_team", "admin"],
    "Mark Procurement Ready",
  );
  const result = await markProcurementReadyInErp(
    caseId,
    comments,
    reviewerEmail,
    typeof userRole === "string" ? userRole : "procurement",
  );

  await createEnterpriseNotification({
    title: `Business Case Ready for RFQ: ${caseId}`,
    message: `Business Case ${caseId} marked Procurement Ready. RFQ creation is now unlocked.`,
    module: "intake",
    target_roles: ["procurement", "procurement_team", "admin"],
    target_route: `/intake/business-cases/${caseId}`,
    document_id: caseId,
  });

  return result;
}

export async function getPendingBusinessCasesForProcurement(): Promise<
  BusinessCase[]
> {
  return fetchPendingBusinessCasesFromErp();
}

export async function linkRfqToBusinessCase(
  caseId: string,
  rfqName: string,
  procurementUserEmail = "procurement@netlink.com",
  userRole: AppRole | string = "procurement",
): Promise<BusinessCase> {
  return linkRfqToBusinessCaseInErp(
    caseId,
    rfqName,
    procurementUserEmail,
    typeof userRole === "string" ? userRole : "procurement",
  );
}

// ── LEGACY STATUS EXPORT (kept for any remaining call-sites) ─────────────────

export type { NeedStatus };
