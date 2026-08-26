import type { AppRole } from "./roles";
import type { CanonicalECRStage, ECRRole } from "./ecrRoles";
import {
  canonicalECRStage,
  formatECRNumber,
  isEcrOwnedBy,
  normalizeECRRoleAlias,
} from "./ecrRoles";
import type { EngineeringChangeRequest } from "../types/erpnext";

export type ECRQueueFilter =
  | "all"
  | "mine"
  | "pending"
  | "sent-back"
  | "approved"
  | "closed";

export interface ECRQueueUser {
  id?: string | null;
  name?: string | null;
  email?: string | null;
  username?: string | null;
  role?: string | null;
}

export interface ECRQueueSummary {
  mine: number;
  pending: number;
  sentBack: number;
  approved: number;
  closed: number;
}

const REVIEW_STAGE_BY_ROLE: Partial<Record<ECRRole, CanonicalECRStage>> = {
  engineering: "Engineering Review",
  procurement_team: "Procurement Review",
  procurement: "RFQ Pending",
};

const APPROVAL_ROLE_BY_REVIEW_STAGE: Partial<Record<CanonicalECRStage, string>> = {
  "Engineering Review": "Engineering Manager",
  "Procurement Review": "Procurement Team",
  "RFQ Pending": "Procurement Manager",
};

function hasSingleRequiredTask(
  ecr: EngineeringChangeRequest,
  approvalRole: string,
): boolean {
  const pending = (ecr.approval_requirements ?? []).filter(
    (task) => task.status === "Pending",
  );
  return Boolean(
    pending.length === 1 &&
    Number(pending[0]?.required || 0) === 1 &&
    normalizeECRRoleAlias(pending[0]?.approval_role) ===
      normalizeECRRoleAlias(approvalRole),
  );
}

const REVIEW_STAGES = new Set<CanonicalECRStage>([
  "Engineering Review",
  "Procurement Review",
]);

const PROCUREMENT_STAGES = new Set<CanonicalECRStage>([
  "Procurement Review",
  "RFQ Pending",
  "RFQ",
]);

const PROCUREMENT_REACHED_STAGES = new Set<CanonicalECRStage>([
  ...PROCUREMENT_STAGES,
]);

function normalizedFilter(value?: string | null): string {
  return (value || "all").trim().toLowerCase().replaceAll("_", "-");
}

/**
 * Resolve the current business stage while remaining compatible with an
 * optional raw Procurement state that may exist on migrated records.
 */
export function getECRCurrentStage(
  status?: EngineeringChangeRequest["select_pxfp"] | string | null,
  ecr?: Pick<EngineeringChangeRequest, "rfq"> | null,
): CanonicalECRStage {
  if (String(ecr?.rfq ?? "").trim()) return "RFQ";
  return canonicalECRStage(status);
}

export function getRolePendingApprovalStage(
  role?: AppRole | string | null,
): CanonicalECRStage | null {
  return REVIEW_STAGE_BY_ROLE[role as ECRRole] ?? null;
}

/** Pending Approval is deliberately exact: only the current gate owner sees it. */
export function isPendingApprovalForRole(
  role: AppRole | string | null | undefined,
  ecr: EngineeringChangeRequest,
): boolean {
  const currentStage = getECRCurrentStage(ecr.select_pxfp, ecr);
  const expectedStage = getRolePendingApprovalStage(role);
  if (!expectedStage || currentStage !== expectedStage) {
    return false;
  }
  const expectedApprovalRole = APPROVAL_ROLE_BY_REVIEW_STAGE[expectedStage];
  return Boolean(
    expectedApprovalRole && hasSingleRequiredTask(ecr, expectedApprovalRole),
  );
}

export function hasECRReachedProcurement(ecr: EngineeringChangeRequest): boolean {
  const stage = getECRCurrentStage(ecr.select_pxfp, ecr);
  return PROCUREMENT_REACHED_STAGES.has(stage);
}

export interface ECRProcurementQueueSummary {
  approved: number;
  requisitionReady: number;
  rfqReady: number;
  supplierResponses: number;
  evaluations: number;
  selections: number;
  pendingSelectionApproval: number;
  completed: number;
}

/** Stage-exact procurement workload counts used by dashboard cards. */
export function getECRProcurementQueueSummary(
  ecrs: EngineeringChangeRequest[],
): ECRProcurementQueueSummary {
  const stageOf = (ecr: EngineeringChangeRequest) =>
    getECRCurrentStage(ecr.select_pxfp, ecr);

  return {
    approved: ecrs.filter((ecr) => stageOf(ecr) === "Procurement Review").length,
    requisitionReady: 0,
    rfqReady: ecrs.filter((ecr) =>
      stageOf(ecr) === "RFQ Pending" && !ecr.rfq,
    ).length,
    supplierResponses: 0,
    evaluations: 0,
    selections: 0,
    pendingSelectionApproval: 0,
    completed: ecrs.filter((ecr) => stageOf(ecr) === "RFQ").length,
  };
}

export function getECRAssignedTo(ecr: EngineeringChangeRequest): string {
  const stage = getECRCurrentStage(ecr.select_pxfp, ecr);
  const owner = ecr.ecr_owner || ecr.owner || "Engineer";

  switch (stage) {
    case "Draft":
      return owner;
    case "Engineering Review":
      return hasSingleRequiredTask(ecr, "Engineering Manager")
        ? "Engineering Manager"
        : "Unassigned";
    case "Procurement Review":
      return hasSingleRequiredTask(ecr, "Procurement Team")
        ? "Procurement Team"
        : "Unassigned";
    case "RFQ Pending":
      return hasSingleRequiredTask(ecr, "Procurement Manager")
        ? "Procurement Manager"
        : "Unassigned";
    case "Approved":
    case "RFQ":
      return "Procurement Team / RFQ process";
    default:
      return "Unassigned";
  }
}

export function isECRActionableForRole(
  role: AppRole | string | null | undefined,
  ecr: EngineeringChangeRequest,
  user?: ECRQueueUser | null,
): boolean {
  const stage = getECRCurrentStage(ecr.select_pxfp, ecr);

  if (role === "admin") {
    return false;
  }
  if (role === "engineer") {
    return (
      stage === "Draft" &&
      isEcrOwnedBy(ecr, user)
    );
  }
  if (isPendingApprovalForRole(role, ecr)) return true;
  return false;
}

export function getECRListActionLabel(
  role: AppRole | string | null | undefined,
  ecr: EngineeringChangeRequest,
  user?: ECRQueueUser | null,
): "Edit" | "Review" | "Create RFQ" | "View" {
  if (!isECRActionableForRole(role, ecr, user)) return "View";

  const stage = getECRCurrentStage(ecr.select_pxfp);
  if (role === "engineer") return "Edit";
  if (REVIEW_STAGES.has(stage)) return "Review";
  if (role === "procurement" && stage === "RFQ Pending") {
    return "Create RFQ";
  }
  return "View";
}

export function getECRListActionRoute(
  role: AppRole | string | null | undefined,
  ecr: EngineeringChangeRequest,
  user?: ECRQueueUser | null,
): string {
  const encodedName = encodeURIComponent(formatECRNumber(ecr));
  return getECRListActionLabel(role, ecr, user) === "Edit"
    ? `/ecr/${encodedName}/edit`
    : `/ecr/${encodedName}`;
}

export function getProcurementStageLabel(ecr: EngineeringChangeRequest): string {
  if (!hasECRReachedProcurement(ecr)) return "Not Started";
  if (ecr.rfq) return "RFQ Created";
  const stage = getECRCurrentStage(ecr.select_pxfp, ecr);
  if (stage === "Procurement Review") return "Procurement Review";
  if (stage === "RFQ Pending") return "RFQ Pending";
  return stage;
}

export function matchesECRQueueFilter(
  filter: string | null | undefined,
  role: AppRole | string | null | undefined,
  ecr: EngineeringChangeRequest,
  user?: ECRQueueUser | null,
): boolean {
  const value = normalizedFilter(filter);
  const stage = getECRCurrentStage(ecr.select_pxfp, ecr);

  switch (value) {
    case "":
    case "all":
      return true;
    case "mine":
      return isEcrOwnedBy(ecr, user);
    case "pending":
    case "pending-approval":
      return isPendingApprovalForRole(role, ecr);
    case "engineering":
    case "eng-review":
      return role === "engineering" && isPendingApprovalForRole(role, ecr);
    case "procurement-review":
      return role === "procurement_team" && isPendingApprovalForRole(role, ecr);
    case "operations":
    case "ops-review":
    case "operations-actions":
    case "quality":
    case "quality-review":
    case "quality-actions":
    case "program":
    case "program-review":
      return false;
    case "in-review":
    case "review":
      return REVIEW_STAGES.has(stage);
    case "draft":
      return stage === "Draft" && (role !== "engineer" || isEcrOwnedBy(ecr, user));
    case "sent-back":
    case "needs-revision":
      return false;
    case "approved":
      return ["Procurement Review", "RFQ Pending", "RFQ"].includes(stage);
    case "requisition":
    case "requisition-queue":
      return false;
    case "validation":
      return false;
    case "procurement":
      return role === "procurement_team" && isPendingApprovalForRole(role, ecr);
    case "rfq-pending":
    case "rfq-required":
    case "create-rfq":
      return role === "procurement" &&
        isPendingApprovalForRole(role, ecr) && !ecr.rfq;
    case "rfq":
    case "rfq-created":
      return stage === "RFQ";
    case "supplier-response":
    case "evaluation":
    case "pending-selection":
    case "selection":
      return false;
    case "closed":
    case "completed":
      return stage === "RFQ";
    case "rejected":
      return false;
    case "cancelled":
      return false;
    case "rejected-cancelled":
      return false;
    default:
      return false;
  }
}

export function getECRQueueSummary(
  role: AppRole | string | null | undefined,
  ecrs: EngineeringChangeRequest[],
  user?: ECRQueueUser | null,
): ECRQueueSummary {
  return {
    mine: ecrs.filter((ecr) => isEcrOwnedBy(ecr, user)).length,
    pending: ecrs.filter((ecr) => isPendingApprovalForRole(role, ecr)).length,
    sentBack: ecrs.filter((ecr) =>
      matchesECRQueueFilter("sent-back", role, ecr, user),
    ).length,
    approved: ecrs.filter((ecr) =>
      matchesECRQueueFilter("approved", role, ecr, user),
    ).length,
    closed: ecrs.filter((ecr) => getECRCurrentStage(ecr.select_pxfp, ecr) === "RFQ").length,
  };
}

export function isPendingFilter(filter?: string | null): boolean {
  return [
    "pending",
    "pending-approval",
    "engineering",
    "eng-review",
  ].includes(normalizedFilter(filter));
}
