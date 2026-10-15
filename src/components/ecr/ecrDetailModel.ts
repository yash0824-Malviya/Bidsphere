import {
  canonicalECRStage,
  normalizeECRRoleAlias,
  resolveApprovalTask,
  isExtendedECRWorkflow,
  getApplicableECRWorkflowStages,
  type CanonicalECRStage,
  type ResolvedApprovalTask,
} from "../../config/ecrRoles";
import type { AppRole } from "../../config/roles";
import { parseECRBusinessCase } from "../../types/ecrBusinessCase";
import type {
  ECRApprovalRequirement,
  ECRStatus,
  EngineeringChangeRequest,
} from "../../types/erpnext";
export { resolveApprovalTask, type ResolvedApprovalTask };

export type ECRReviewStage =
  | "Engineering Review"
  | "Procurement Review"
  | "RFQ Pending"
  | "Technical Approved"
  | "Finance Review" | "Procurement BC Review" | "Quality Review"
  | "Business Case Approved" | "Final ECR Approval" | "ECR Approved" | "Procurement Decision";

export type ApprovalTimelineState =
  | "completed"
  | "current"
  | "upcoming"
  | "unassigned"
  | "sent-back"
  | "rejected"
  | "skipped";

export interface ApprovalTimelineItem {
  stage: ECRReviewStage;
  role: string;
  state: ApprovalTimelineState;
  decision?: ECRApprovalRequirement;
  /** Persisted workflow action evidence, separate from reviewer decisions. */
  action?: { label: string; actor?: string; timestamp?: string; comment?: string };
  inferred: boolean;
}

export type ECRProcurementTraceLabel =
  | "ECR Approval"
  | "Procurement"
  | "RFQ";

export interface ECRProcurementTraceItem {
  label: ECRProcurementTraceLabel;
  status: string;
  reference?: string;
}

export const ECR_REVIEW_GATES: ReadonlyArray<{
  stage: ECRReviewStage;
  role: string;
  appRole: string;
  roleAliases: readonly string[];
}> = [
  {
    stage: "Engineering Review",
    role: "Engineering Manager",
    appRole: "engineering",
    roleAliases: ["engineering manager", "engineering"],
  },
  {
    stage: "Procurement Review",
    role: "Procurement Team",
    appRole: "procurement_team",
    roleAliases: ["procurement team", "procurement user", "purchase user"],
  },
  {
    stage: "RFQ Pending",
    role: "Procurement Manager",
    appRole: "procurement",
    roleAliases: ["procurement manager", "purchase manager", "procurement"],
  },
] as const;

export const ECR_EXTENDED_REVIEW_GATES: typeof ECR_REVIEW_GATES = [
  ECR_REVIEW_GATES[0],
  { stage: "Technical Approved", role: "Engineer", appRole: "engineer", roleAliases: ["engineer"] },
  { stage: "Finance Review", role: "Finance Manager", appRole: "finance", roleAliases: ["finance manager", "finance"] },
  { stage: "Procurement BC Review", role: "Procurement Manager", appRole: "procurement", roleAliases: ["procurement manager", "purchase manager", "procurement"] },
  { stage: "Quality Review", role: "Quality Manager", appRole: "quality", roleAliases: ["quality manager", "quality"] },
  { stage: "Business Case Approved", role: "Program Manager", appRole: "program_manager", roleAliases: ["program manager", "final ecr approver"] },
  { stage: "Final ECR Approval", role: "Program Manager", appRole: "program_manager", roleAliases: ["program manager", "final ecr approver"] },
  { stage: "ECR Approved", role: "Procurement Manager", appRole: "procurement", roleAliases: ["procurement manager", "purchase manager", "procurement"] },
  { stage: "Procurement Decision", role: "Procurement Manager", appRole: "procurement", roleAliases: ["procurement manager", "purchase manager", "procurement"] },
];

function reviewGates(ecr?: Partial<EngineeringChangeRequest> | null) {
  return isExtendedECRWorkflow(ecr) ? ECR_EXTENDED_REVIEW_GATES : ECR_REVIEW_GATES;
}

const WORKFLOW_ORDER: CanonicalECRStage[] = [
  "Draft",
  "Engineering Review",
  "Procurement Review",
  "RFQ Pending",
  "RFQ",
];

const POST_APPROVAL_STAGES = new Set<CanonicalECRStage>([
  "Procurement Review",
  "RFQ Pending",
  "Approved",
  "Procurement",
  "RFQ",
]);

export function hasReachedECRApproval(
  status?: ECRStatus | string | null,
  ecr?: Partial<EngineeringChangeRequest> | null,
): boolean {
  if (isExtendedECRWorkflow(ecr)) return ["ECR Approved", "Procurement Decision", "RFQ", "Closed"].includes(canonicalECRStage(status, ecr));
  return POST_APPROVAL_STAGES.has(canonicalECRStage(status));
}

function matchesGate(
  requirement: ECRApprovalRequirement,
  gate: (typeof ECR_REVIEW_GATES)[number],
): boolean {
  const role = normalizeECRRoleAlias(requirement.approval_role);
  const workflowStage = String(requirement.comments ?? "").match(/^\[Stage: ([^\]]+)\]/)?.[1];
  return (!workflowStage || normalizeECRRoleAlias(workflowStage) === normalizeECRRoleAlias(gate.stage)) &&
    gate.roleAliases.some((alias) => normalizeECRRoleAlias(alias) === role);
}

function latestDecision(
  rows: ECRApprovalRequirement[],
  gate: (typeof ECR_REVIEW_GATES)[number],
): ECRApprovalRequirement | undefined {
  const matches = rows.filter((row) => row.status !== "Pending" && matchesGate(row, gate));
  return matches[matches.length - 1];
}

/**
 * Return the active review task for the current stage when the user's role has permission to act.
 * Automatically resolves the task from the workflow stage definition.
 */
export function getCurrentECRApprovalTask(
  status: ECRStatus | string | null | undefined,
  role: string | null | undefined,
  approvalRequirements: ECRApprovalRequirement[] = [],
  ecr?: Partial<EngineeringChangeRequest> | null,
): ECRApprovalRequirement | null {
  const resolved = resolveApprovalTask(ecr ? { ...ecr, select_pxfp: status as ECRStatus } : status, role);
  if (!resolved || !resolved.canAct) return null;
  return getCurrentECRStageApprovalTask(status, approvalRequirements, ecr);
}

/** Resolve the active review task for the current review stage, independent of viewer role. */
export function getCurrentECRStageApprovalTask(
  status: ECRStatus | string | null | undefined,
  approvalRequirements: ECRApprovalRequirement[] = [],
  ecr?: Partial<EngineeringChangeRequest> | null,
): ECRApprovalRequirement | null {
  const current = canonicalECRStage(status, ecr);
  const gate = reviewGates(ecr).find((item) => item.stage === current);
  if (!gate) return null;

  // Match the server invariant: the stage is actionable only when ERP has
  // persisted exactly one required Pending row and it belongs to this gate.
  const pending = approvalRequirements.filter((row) => row.status === "Pending");
  const matches = pending.filter(
    (row) => matchesGate(row, gate) && Number(row.required || 0) === 1,
  );
  if (pending.length === 1 && matches.length === 1) return matches[0];
  return null;
}

/** Preserve every completed decision so send-back/reapproval cycles remain auditable. */
export function getECRDecisionHistory(
  approvalRequirements: ECRApprovalRequirement[] = [],
  ecr?: Partial<EngineeringChangeRequest> | null,
): ECRApprovalRequirement[] {
  return approvalRequirements.filter(
    (row) =>
      Boolean(row.status) &&
      row.status !== "Pending" &&
      (isExtendedECRWorkflow(ecr) || [...ECR_REVIEW_GATES, ...ECR_EXTENDED_REVIEW_GATES].some((gate) => matchesGate(row, gate))),
  );
}

function extendedActionEvidence(
  stage: ECRReviewStage,
  current: CanonicalECRStage,
  ecr?: Partial<EngineeringChangeRequest> | null,
): Pick<ApprovalTimelineItem, "action" | "inferred"> | undefined {
  if (!isExtendedECRWorkflow(ecr)) return undefined;
  if (stage === "Technical Approved") {
    const businessCase = parseECRBusinessCase(ecr?.ecr_business_case);
    if (businessCase?.ecr_reference !== ecr?.name) return undefined;
    const submitted = Array.isArray(businessCase?.history)
      ? [...businessCase.history].reverse().find((entry) => entry.action === "submit")
      : undefined;
    if (submitted) return {
      action: { label: "Business Case Submitted", actor: submitted.actor, timestamp: submitted.timestamp, comment: submitted.comment },
      inferred: false,
    };
  }
  if (stage === "Business Case Approved" && ["Final ECR Approval", "ECR Approved", "Procurement Decision", "RFQ", "Closed"].includes(current)) {
    return { action: { label: "Final Review Started" }, inferred: true };
  }
  if (stage === "ECR Approved" && ["Procurement Decision", "RFQ", "Closed"].includes(current) &&
      ["Yes", "No"].includes(String(ecr?.rfq_required)) && String(ecr?.rfq_decision_reason ?? "").trim()) {
    return { action: { label: "Decision Recorded", comment: `RFQ Required: ${ecr?.rfq_required}\nDecision Reason: ${ecr?.rfq_decision_reason}` }, inferred: false };
  }
  return undefined;
}

/**
 * Review gates use persisted approval decisions. Non-review actions use their
 * saved action evidence; legacy records retain their stage-based fallback.
 */
export function getECRApprovalTimeline(
  status?: ECRStatus | string | null,
  approvalRequirements: ECRApprovalRequirement[] = [],
  ecr?: Partial<EngineeringChangeRequest> | null,
): ApprovalTimelineItem[] {
  const current = canonicalECRStage(status, ecr);
  const effectiveCurrent = current === "Sent Back" ? "Engineering Review" : current;
  const order = isExtendedECRWorkflow(ecr) ? getApplicableECRWorkflowStages(ecr).map((stage) => stage.id) : WORKFLOW_ORDER;
  const currentIndex = order.indexOf(effectiveCurrent);
  const currentTask = getCurrentECRStageApprovalTask(status, approvalRequirements, ecr) ?? undefined;

  return reviewGates(ecr).map((gate) => {
    if (isExtendedECRWorkflow(ecr) && (
      (gate.stage === "Finance Review" && Number(ecr?.cost_impact) !== 1) ||
      (gate.stage === "Quality Review" && Number(ecr?.quality_impact) !== 1) ||
      (gate.stage === "Procurement Decision" && ecr?.rfq_required === "No")
    )) return { ...gate, state: "skipped", inferred: false };
    const decision = latestDecision(approvalRequirements, gate);
    const decisionStatus = decision?.status;

    if (current === gate.stage) {
      return {
        ...gate,
        state: currentTask ? "current" : "unassigned",
        decision: currentTask || decision,
        inferred: false,
      };
    }

    const actionEvidence = extendedActionEvidence(gate.stage, current, ecr);
    if (actionEvidence) return { ...gate, state: "completed", ...actionEvidence };

    if (decisionStatus === "Approved" || decisionStatus === "Completed") {
      return { ...gate, state: "completed", decision, inferred: false };
    }
    if (decisionStatus === "Rejected") {
      return { ...gate, state: "rejected", decision, inferred: false };
    }
    if (decisionStatus === "Sent Back") {
      return { ...gate, state: "sent-back", decision, inferred: false };
    }
    const gateIndex = order.indexOf(gate.stage);
    if (!isExtendedECRWorkflow(ecr) && currentIndex > gateIndex && !["Rejected", "Cancelled"].includes(current)) {
      return { ...gate, state: "completed", decision, inferred: true };
    }
    return { ...gate, state: "upcoming", decision, inferred: !decision };
  });
}

export function getECRProcurementStatus(
  ecr?: Partial<EngineeringChangeRequest> | null,
): "Not Started" | "In Progress" | "Complete" {
  if (!hasReachedECRApproval(ecr?.select_pxfp, ecr)) return "Not Started";
  if (getECRRFQReference(ecr) || canonicalECRStage(ecr?.select_pxfp, ecr) === "RFQ" || (isExtendedECRWorkflow(ecr) && ecr?.rfq_required === "No" && ecr.select_pxfp === "Closed")) {
    return "Complete";
  }
  return "In Progress";
}

export function isECRSupplierSourcingRequired(
  ecr?: Partial<EngineeringChangeRequest> | null,
): boolean {
  if (!ecr) return false;
  if (isExtendedECRWorkflow(ecr)) return ecr.rfq_required === "Yes";
  return Boolean(
    ecr.supplier_response_required === "Yes" ||
    ecr.supplier_impact ||
    ecr.rfq ||
    ecr.existing_rfq_reference ||
    ecr.existing_purchase_order_reference ||
    (ecr.procurement_reference_type && ecr.procurement_reference_type !== "None") ||
    ecr.suggested_supplier ||
    ecr.supplier_response_requirements?.length
  );
}

export function getECRRFQReference(
  ecr?: Partial<EngineeringChangeRequest> | null,
): string | null {
  if (!ecr) return null;
  const createdRFQ = String(ecr.rfq ?? "").trim();
  if (createdRFQ) return createdRFQ;
  return null;
}

export function canCreateECRRFQ(
  role: AppRole | string | null | undefined,
  status: ECRStatus | string | null | undefined,
  ecr?: Partial<EngineeringChangeRequest> | null,
): boolean {
  const managerTask = getCurrentECRApprovalTask(
    status,
    role,
    ecr?.approval_requirements ?? [],
    ecr,
  );
  return Boolean(
    role === "procurement" &&
    (isExtendedECRWorkflow(ecr)
      ? canonicalECRStage(status, ecr) === "Procurement Decision" && ecr?.rfq_required === "Yes"
      : canonicalECRStage(status) === "RFQ Pending") &&
    managerTask &&
    !getECRRFQReference(ecr),
  );
}

/** Present only the sourcing milestones that belong to the simplified ECR demo. */
export function getECRProcurementTraceability(
  ecr?: Partial<EngineeringChangeRequest> | null,
): ECRProcurementTraceItem[] {
  const record = ecr ?? {};
  const approvalsComplete = hasReachedECRApproval(record.select_pxfp, record);
  const supplierRequired = isECRSupplierSourcingRequired(record);
  const rfqReference = getECRRFQReference(record);
  const stage = rfqReference ? "RFQ" : canonicalECRStage(record.select_pxfp, record);
  const rfqCreated = Boolean(rfqReference) || stage === "RFQ";

  const approval: ECRProcurementTraceItem = {
    label: "ECR Approval",
    status: approvalsComplete ? "Completed" : "Pending",
    reference: record.ecr_number || undefined,
  };

  return [
    approval,
    {
      label: "Procurement",
      status:
        stage === "RFQ" || (isExtendedECRWorkflow(ecr) && stage === "Closed")
          ? "Completed"
          : stage === "Procurement Review" || stage === "RFQ Pending" || stage === "ECR Approved" || stage === "Procurement Decision"
            ? "Current"
            : "Pending",
    },
    {
      label: "RFQ",
      status: rfqCreated ? "Created" : supplierRequired ? "Required" : isExtendedECRWorkflow(ecr) && !ecr?.rfq_required ? "Decision Pending" : "Not Required",
      reference: rfqReference || undefined,
    },
  ];
}
