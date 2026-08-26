import {
  canonicalECRStage,
  normalizeECRRoleAlias,
  resolveApprovalTask,
  type CanonicalECRStage,
  type ResolvedApprovalTask,
} from "../../config/ecrRoles";
import type { AppRole } from "../../config/roles";
import type {
  ECRApprovalRequirement,
  ECRStatus,
  EngineeringChangeRequest,
} from "../../types/erpnext";
export { resolveApprovalTask, type ResolvedApprovalTask };

export type ECRReviewStage =
  | "Engineering Review"
  | "Procurement Review"
  | "RFQ Pending";

export type ApprovalTimelineState =
  | "completed"
  | "current"
  | "upcoming"
  | "unassigned"
  | "sent-back"
  | "rejected";

export interface ApprovalTimelineItem {
  stage: ECRReviewStage;
  role: string;
  state: ApprovalTimelineState;
  decision?: ECRApprovalRequirement;
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
): boolean {
  return POST_APPROVAL_STAGES.has(canonicalECRStage(status));
}

function matchesGate(
  requirement: ECRApprovalRequirement,
  gate: (typeof ECR_REVIEW_GATES)[number],
): boolean {
  const role = normalizeECRRoleAlias(requirement.approval_role);
  return gate.roleAliases.some((alias) => normalizeECRRoleAlias(alias) === role);
}

function latestDecision(
  rows: ECRApprovalRequirement[],
  gate: (typeof ECR_REVIEW_GATES)[number],
): ECRApprovalRequirement | undefined {
  const matches = rows.filter((row) => matchesGate(row, gate));
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
): ECRApprovalRequirement | null {
  const resolved = resolveApprovalTask(status, role);
  if (!resolved || !resolved.canAct) return null;
  return getCurrentECRStageApprovalTask(status, approvalRequirements);
}

/** Resolve the active review task for the current review stage, independent of viewer role. */
export function getCurrentECRStageApprovalTask(
  status: ECRStatus | string | null | undefined,
  approvalRequirements: ECRApprovalRequirement[] = [],
): ECRApprovalRequirement | null {
  const current = canonicalECRStage(status);
  const gate = ECR_REVIEW_GATES.find((item) => item.stage === current);
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
): ECRApprovalRequirement[] {
  return approvalRequirements.filter(
    (row) =>
      Boolean(row.status) &&
      row.status !== "Pending" &&
      ECR_REVIEW_GATES.some((gate) => matchesGate(row, gate)),
  );
}

/**
 * Build the sequential review/action gates. Persisted approval rows take
 * precedence; stage inference is retained only for pre-migration ECRs.
 */
export function getECRApprovalTimeline(
  status?: ECRStatus | string | null,
  approvalRequirements: ECRApprovalRequirement[] = [],
): ApprovalTimelineItem[] {
  const current = canonicalECRStage(status);
  const effectiveCurrent = current === "Sent Back" ? "Engineering Review" : current;
  const currentIndex = WORKFLOW_ORDER.indexOf(effectiveCurrent);
  const currentTask = getCurrentECRStageApprovalTask(status, approvalRequirements) ?? undefined;

  return ECR_REVIEW_GATES.map((gate) => {
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

    if (decisionStatus === "Approved") {
      return { ...gate, state: "completed", decision, inferred: false };
    }
    if (decisionStatus === "Rejected") {
      return { ...gate, state: "rejected", decision, inferred: false };
    }
    if (decisionStatus === "Sent Back") {
      return { ...gate, state: "sent-back", decision, inferred: false };
    }
    const gateIndex = WORKFLOW_ORDER.indexOf(gate.stage);
    if (currentIndex > gateIndex && !["Rejected", "Cancelled"].includes(current)) {
      return { ...gate, state: "completed", decision, inferred: true };
    }
    return { ...gate, state: "upcoming", decision, inferred: !decision };
  });
}

export function getECRProcurementStatus(
  ecr?: Partial<EngineeringChangeRequest> | null,
): "Not Started" | "In Progress" | "Complete" {
  if (!hasReachedECRApproval(ecr?.select_pxfp)) return "Not Started";
  if (getECRRFQReference(ecr) || canonicalECRStage(ecr?.select_pxfp) === "RFQ") {
    return "Complete";
  }
  return "In Progress";
}

export function isECRSupplierSourcingRequired(
  ecr?: Partial<EngineeringChangeRequest> | null,
): boolean {
  if (!ecr) return false;
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
  );
  return Boolean(
    role === "procurement" &&
    canonicalECRStage(status) === "RFQ Pending" &&
    managerTask &&
    !getECRRFQReference(ecr),
  );
}

/** Present only the sourcing milestones that belong to the simplified ECR demo. */
export function getECRProcurementTraceability(
  ecr?: Partial<EngineeringChangeRequest> | null,
): ECRProcurementTraceItem[] {
  const record = ecr ?? {};
  const approvalsComplete = hasReachedECRApproval(record.select_pxfp);
  const supplierRequired = isECRSupplierSourcingRequired(record);
  const rfqReference = getECRRFQReference(record);
  const stage = rfqReference ? "RFQ" : canonicalECRStage(record.select_pxfp);
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
        stage === "RFQ"
          ? "Completed"
          : stage === "Procurement Review" || stage === "RFQ Pending"
            ? "Current"
            : "Pending",
    },
    {
      label: "RFQ",
      status: rfqCreated ? "Created" : supplierRequired ? "Required" : "Not Required",
      reference: rfqReference || undefined,
    },
  ];
}
