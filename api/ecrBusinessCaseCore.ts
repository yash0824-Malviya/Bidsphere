import {
  buildSequentialApprovalRequirements,
  createDefaultEcrWorkflowDependencies,
  EcrWorkflowError,
  isOwnedBy,
  readEcrBusinessCase,
  requireCurrentApprovalTask,
  sameApprovalRows,
  type EcrWorkflowDependencies,
  type EcrWorkflowDocument,
  type InternalEcrPrincipal,
} from "./ecrWorkflowCore.js";
import { canonicalWorkflowStatus, isExtendedEcr, type EcrWorkflowTransition } from "./ecrWorkflowPolicy.js";

export type EcrBusinessCaseDependencies = EcrWorkflowDependencies;
export interface EcrBusinessCaseInput {
  ecr_name: unknown;
  action?: unknown;
  payload?: unknown;
  comment?: unknown;
  role?: unknown;
  expected_modified?: unknown;
  rfq_required?: unknown;
  rfq_decision_reason?: unknown;
  principal: InternalEcrPrincipal;
}
export interface EcrBusinessCaseResult {
  ecr: EcrWorkflowDocument;
  businessCase: Record<string, unknown> | null;
}

const TEXT_FIELDS = [
  "why_required", "problem_statement", "expected_benefits", "revenue_impact", "budget_impact",
  "customer_impact", "program_impact", "plant_impact", "production_impact", "supplier_impact",
  "quality_impact", "timeline_impact", "business_risk", "financial_risk", "supplier_risk", "quality_risk",
] as const;
const NUMBER_FIELDS = ["current_cost", "proposed_cost", "implementation_cost", "one_time_cost", "recurring_cost", "annual_volume"] as const;
const REQUIRED_FIELDS = ["why_required", "problem_statement", "expected_benefits", "budget_impact", "business_risk", "financial_risk", "supplier_risk", "quality_risk"];
const EDITABLE_FIELDS = new Set<string>([...TEXT_FIELDS, ...NUMBER_FIELDS, "overall_risk", "recommendation", "supporting_documents"]);
const REVIEW_ROLE: Record<string, "finance" | "procurement" | "quality"> = {
  "Finance Review": "finance", "Procurement BC Review": "procurement", "Quality Review": "quality",
};
const clean = (value: unknown) => String(value ?? "").trim();
function textValue(value: unknown, label: string, max = 4000): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.trim().length > max) throw new EcrWorkflowError(`${label} must be text with at most ${max} characters.`, 422);
  return value.trim();
}

function assertReader(principal: InternalEcrPrincipal, ecr?: EcrWorkflowDocument): void {
  if (!principal || principal.typ !== "internal" || !["admin", "engineer", "engineering", "finance", "quality", "program_manager", "procurement", "procurement_team", "operations"].includes(principal.role)) {
    throw new EcrWorkflowError("Internal Engineering Change access is required.", 403);
  }
  if (ecr && principal.role === "engineer" && !isOwnedBy(ecr, principal)) {
    throw new EcrWorkflowError("Engineers can access only their own ECR Business Cases.", 403);
  }
}

function sanitizePayload(payload: unknown, previous: Record<string, unknown> | null, ecr: EcrWorkflowDocument): Record<string, unknown> {
  if (payload !== undefined && (!payload || typeof payload !== "object" || Array.isArray(payload))) throw new EcrWorkflowError("Business Case payload must be an object.", 422);
  const source = (payload ?? {}) as Record<string, unknown>;
  const unknownFields = Object.keys(source).filter((field) => !EDITABLE_FIELDS.has(field));
  if (unknownFields.length) throw new EcrWorkflowError(`Business Case fields are server-managed or unsupported: ${unknownFields.join(", ")}.`, 422);
  const fields: Record<string, unknown> = {};
  for (const field of TEXT_FIELDS) fields[field] = textValue(source[field] ?? previous?.[field], field);
  for (const field of NUMBER_FIELDS) {
    const value = source[field] ?? previous?.[field] ?? 0;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1e12) throw new EcrWorkflowError(`${field} must be a finite number from 0 to 1,000,000,000,000.`, 422);
    fields[field] = value;
  }
  fields.overall_risk = source.overall_risk ?? previous?.overall_risk ?? "Low";
  fields.recommendation = source.recommendation ?? previous?.recommendation ?? "Need More Information";
  if (!["Low", "Medium", "High"].includes(String(fields.overall_risk))) throw new EcrWorkflowError("Overall risk must be Low, Medium, or High.", 422);
  if (!["Approve", "Reject", "Need More Information"].includes(String(fields.recommendation))) throw new EcrWorkflowError("A valid recommendation is required.", 422);
  const attachments = source.supporting_documents ?? previous?.supporting_documents ?? [];
  if (!Array.isArray(attachments) || attachments.length > 25) throw new EcrWorkflowError("At most 25 supporting documents are allowed.", 422);
  const linkedUrls = new Set(clean(ecr.supporting_documents).split(/[\n,]+/).map((url) => url.trim()).filter(Boolean));
  fields.supporting_documents = attachments.map((attachment: unknown) => {
    if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) throw new EcrWorkflowError("Invalid supporting document.", 422);
    const source = attachment as Record<string, unknown>;
    const file_name = textValue(source.file_name, "File name", 255);
    const file_url = textValue(source.file_url, "File URL", 1000);
    if (!file_name || !/^\/(?:private\/)?files\/[^?#]+$/i.test(file_url) || file_url.includes("..") || !linkedUrls.has(file_url)) {
      throw new EcrWorkflowError("Supporting documents must be uploaded and linked to this ECR before saving the Business Case.", 422);
    }
    return { file_name, file_url };
  });
  const annualSavings = (Number(fields.current_cost) - Number(fields.proposed_cost)) * Number(fields.annual_volume);
  const implementation = Number(fields.implementation_cost);
  fields.expected_annual_savings = annualSavings;
  fields.roi = implementation > 0 ? (annualSavings - implementation) / implementation * 100 : null;
  fields.payback_period = annualSavings > 0 ? implementation / annualSavings * 12 : null;
  if ([fields.expected_annual_savings, fields.roi, fields.payback_period].some((value) => value !== null && !Number.isFinite(value))) throw new EcrWorkflowError("Financial calculations exceed supported numeric limits.", 422);
  return fields;
}

async function load(input: EcrBusinessCaseInput, dependencies: EcrBusinessCaseDependencies): Promise<EcrWorkflowDocument> {
  assertReader(input.principal);
  const name = textValue(input.ecr_name, "Engineering Change Request", 140);
  if (!name) throw new EcrWorkflowError("Engineering Change Request is required.", 422);
  const ecr = await dependencies.loadEcr(name);
  assertReader(input.principal, ecr);
  if (!isExtendedEcr(ecr)) throw new EcrWorkflowError("This ECR follows the legacy workflow and does not use a linked Business Case.", 409, "conflict");
  return ecr;
}

export async function fetchEcrBusinessCaseCore(input: EcrBusinessCaseInput, dependencies?: EcrBusinessCaseDependencies): Promise<EcrBusinessCaseResult> {
  const ecr = await load(input, dependencies ?? createDefaultEcrWorkflowDependencies());
  return { ecr, businessCase: readEcrBusinessCase(ecr) };
}

export async function applyEcrBusinessCaseActionCore(input: EcrBusinessCaseInput, dependencies?: EcrBusinessCaseDependencies): Promise<EcrBusinessCaseResult> {
  const deps = dependencies ?? createDefaultEcrWorkflowDependencies();
  const ecr = await load(input, deps);
  if (!clean(ecr.modified) || input.expected_modified !== ecr.modified) throw new EcrWorkflowError("This ECR has changed or no revision was supplied. Refresh before saving or reviewing.", 409, "conflict");
  if (Number(ecr.docstatus) !== 0) throw new EcrWorkflowError("Business Case changes require an active draft ECR.", 409, "conflict");
  const action = textValue(input.action, "Action", 50);
  if (!["save", "submit", "approve", "send_back", "reject"].includes(action)) throw new EcrWorkflowError("Invalid Business Case action.", 422);
  if (input.role !== undefined && input.role !== input.principal.role) throw new EcrWorkflowError("Review role must match your authenticated role.", 403);
  const stage = canonicalWorkflowStatus(clean(ecr.select_pxfp));
  const prior = readEcrBusinessCase(ecr);
  const timestamp = deps.now();
  const actor = clean(input.principal.sub) || clean(input.principal.email);
  const comment = textValue(input.comment, "Review comment");
  const hasSourcingRecommendation = input.rfq_required !== undefined || input.rfq_decision_reason !== undefined;
  if (hasSourcingRecommendation && (action !== "approve" || input.principal.role !== "procurement")) throw new EcrWorkflowError("Only the Procurement reviewer can recommend RFQ sourcing when approving the Business Case.", 403);
  let businessCase: Record<string, unknown>;
  let nextStage = stage;
  let decision: EcrWorkflowTransition["decision"] = "none";
  if (action === "save" || action === "submit") {
    if (input.principal.role !== "engineer" || !isOwnedBy(ecr, input.principal)) throw new EcrWorkflowError("Only the owner Engineer can prepare this Business Case.", 403);
    if (stage !== "Technical Approved" || (prior && !["Draft", "Sent Back"].includes(clean(prior.status)))) throw new EcrWorkflowError("Business Case preparation requires Technical Approved or a returned Business Case.", 409, "conflict");
    const identifier = clean(ecr.ecr_number) || ecr.name;
    businessCase = {
      ...prior, ...sanitizePayload(input.payload, prior, ecr), name: `BC-${identifier}`,
      business_case_id: `BC-${identifier}`, ecr_reference: ecr.name,
      created_by: prior?.created_by ?? actor, creation: prior?.creation ?? timestamp,
      status: prior?.status ?? "Draft", modified: timestamp,
    };
    if (action === "submit") {
      const missing = REQUIRED_FIELDS.filter((field) => !clean(businessCase[field]));
      if (missing.length) {
        const error = new EcrWorkflowError("Complete the business justification, budget impact, and risk assessment before submitting.", 422);
        error.fieldErrors = Object.fromEntries(missing.map((field) => [field, "Required before submitting."]));
        throw error;
      }
      businessCase.finance_required = Number(ecr.cost_impact) === 1;
      businessCase.quality_required = Number(ecr.quality_impact) === 1;
      for (const role of ["finance", "procurement", "quality"]) {
        businessCase[`${role}_status`] = role === "procurement" || businessCase[`${role}_required`] ? "Pending" : "Not Required";
        for (const suffix of ["comment", "approved_by", "approved_date"]) businessCase[`${role}_${suffix}`] = "";
      }
      nextStage = businessCase.finance_required ? "Finance Review" : "Procurement BC Review";
      businessCase.status = nextStage;
    } else if (!prior) {
      businessCase.finance_status = Number(ecr.cost_impact) === 1 ? "Pending" : "Not Required";
      businessCase.procurement_status = "Pending";
      businessCase.quality_status = Number(ecr.quality_impact) === 1 ? "Pending" : "Not Required";
    }
  } else {
    if (input.payload !== undefined) throw new EcrWorkflowError("Reviewers cannot edit Business Case content.", 403);
    const role = REVIEW_ROLE[stage];
    if (!role || input.principal.role !== role) throw new EcrWorkflowError("Your role cannot review the Business Case at this stage.", 403);
    if (!prior || prior.status !== stage || prior[`${role}_status`] !== "Pending") throw new EcrWorkflowError("The Business Case does not have an active review for this stage.", 409, "conflict");
    if ((stage !== "Finance Review" && prior.finance_required && prior.finance_status !== "Approved") ||
        (stage === "Quality Review" && prior.procurement_status !== "Approved")) throw new EcrWorkflowError("Earlier required Business Case approvals are incomplete.", 409, "conflict");
    if (action !== "approve" && !comment) throw new EcrWorkflowError("A reason is required when sending back or rejecting a Business Case.", 422);
    if (action === "approve" && role === "finance") {
      // Review the persisted financial inputs; Finance cannot replace owner data.
      // Invalid stored data can still be sent back for correction or rejected.
      for (const field of NUMBER_FIELDS) {
        const value = prior[field];
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1e12) {
          throw new EcrWorkflowError(`${field} must be a finite number from 0 to 1,000,000,000,000 before Finance approval. Send the Business Case back for correction.`, 422);
        }
      }
      for (const field of ["budget_impact", "financial_risk"]) {
        if (!textValue(prior[field], field)) throw new EcrWorkflowError(`${field} is required before Finance approval. Send the Business Case back for correction.`, 422);
      }
    }
    businessCase = { ...prior, modified: timestamp };
    const outcome = action === "approve" ? "Approved" : action === "send_back" ? "Sent Back" : "Rejected";
    businessCase[`${role}_status`] = outcome;
    businessCase[`${role}_comment`] = comment;
    businessCase[`${role}_approved_by`] = actor;
    businessCase[`${role}_approved_date`] = timestamp;
    if (hasSourcingRecommendation) {
      const required = textValue(input.rfq_required, "RFQ recommendation", 3);
      const reason = textValue(input.rfq_decision_reason, "RFQ recommendation reason", 2000);
      if (!["Yes", "No"].includes(required) || !reason) throw new EcrWorkflowError("An RFQ recommendation must be Yes or No with a reason.", 422);
      businessCase.rfq_required = required;
      businessCase.rfq_decision_reason = reason;
    }
    decision = action === "approve" ? "approved" : action === "send_back" ? "sent_back" : "rejected";
    nextStage = action === "send_back" ? "Technical Approved" : action === "reject" ? "Rejected" :
      stage === "Finance Review" ? "Procurement BC Review" : stage === "Procurement BC Review" && prior.quality_required ? "Quality Review" : "Business Case Approved";
    businessCase.status = action !== "approve" ? outcome : nextStage === "Business Case Approved" ? "Approved" : nextStage;
  }
  const currentRows = requireCurrentApprovalTask({ rows: ecr.approval_requirements, currentStatus: stage, principalRole: input.principal.role });
  businessCase.history = [...(Array.isArray(prior?.history) ? prior.history : []), {
    action, role: input.principal.role, actor, timestamp, comment,
    from_status: clean(prior?.status) || "Draft", to_status: businessCase.status,
  }];
  const approvalRows = action === "save" ? currentRows : buildSequentialApprovalRequirements({
    rows: currentRows,
    transition: { currentStatus: stage, nextStatus: nextStage, action: `Business Case ${action}`, roles: [input.principal.role], decision },
    actor, owner: clean(ecr.ecr_owner) || clean(ecr.owner), timestamp, auditStage: stage,
    // Submitting preparation retires the owner's task. Its audit is in history;
    // it is not a reviewer approval and must not create a Completed status.
    preserveNonDecisionCompletion: false,
    comment: [`Business Case ${action}`, comment].filter(Boolean).join("\n"),
  });
  const prepared: EcrWorkflowDocument = {
    ...ecr, ecr_business_case: JSON.stringify(businessCase), select_pxfp: nextStage,
    ...(Object.prototype.hasOwnProperty.call(ecr, "status") ? { status: nextStage } : {}),
    approval_requirements: approvalRows,
  };
  const updated = await deps.commitWorkflowDocument(prepared);
  if (updated.ecr_business_case !== prepared.ecr_business_case || updated.select_pxfp !== nextStage ||
      updated.ecr_workflow_version !== prepared.ecr_workflow_version || Number(updated.docstatus) !== 0 ||
      (Object.prototype.hasOwnProperty.call(ecr, "status") && updated.status !== nextStage) ||
      !sameApprovalRows(approvalRows, updated.approval_requirements)) throw new EcrWorkflowError("ERPNext did not persist the Business Case and ECR stage together. Verify the schema migration.", 409, "conflict");
  await deps.addTimelineComment(ecr.name, `Business Case ${action}${comment ? `\n${comment}` : ""}`).catch(() => undefined);
  return { ecr: updated, businessCase: readEcrBusinessCase(updated) };
}
