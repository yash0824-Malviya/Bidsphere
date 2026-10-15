import { getECRCurrentStage, getECRListActionLabel, isECRActionableForRole, isPendingFilter, isPendingApprovalForRole, matchesECRQueueFilter, type ECRQueueUser } from "../../config/ecrQueues";
import type { ECRRole } from "../../config/ecrRoles";
import type { useAuthStore } from "../../store/authStore";
import type { EngineeringChangeRequest, ECRType } from "../../types/erpnext";

export const ECR_TYPES: ECRType[] = [
  "Part Change",
  "Design Change",
  "Material Change",
  "Process Change",
  "Tooling Change",
  "Supplier Change",
  "Quality Change",
  "Packaging Change",
  "Cost Change",
  "Other",
];

interface QueueFilterDefinition {
  label: string;
  value: string;
}

const REVIEW_QUEUE_FILTERS: QueueFilterDefinition[] = [
  { label: "All", value: "all" },
  { label: "My ECRs", value: "mine" },
  { label: "Pending Approval", value: "pending-approval" },
  { label: "Sent Back", value: "sent-back" },
  { label: "Approved", value: "approved" },
  { label: "Closed", value: "closed" },
];

const PROCUREMENT_TEAM_FILTERS: QueueFilterDefinition[] = [
  { label: "Procurement Review", value: "procurement-review" },
  { label: "All ECRs", value: "all" },
];

export function queueFiltersForRole(role?: ECRRole | null): QueueFilterDefinition[] {
  if (role === "procurement_team") return PROCUREMENT_TEAM_FILTERS;
  if (role === "procurement") return []; // ECR Reference is a reference list, no RFQ queue tabs
  return REVIEW_QUEUE_FILTERS;
}

export function matchesVisibleQueueFilter(
  filter: string,
  role: ECRRole | null,
  ecr: EngineeringChangeRequest,
  user: ECRQueueUser | null | undefined,
): boolean {
  const normalized = filter.toLowerCase().trim().replaceAll("_", "-");
  if (normalized === "procurement-review") {
    return (
      role === "procurement_team" &&
      getECRCurrentStage(ecr.select_pxfp, ecr) === "Procurement Review" &&
      isPendingApprovalForRole(role, ecr)
    );
  }
  if (["rfq-pending", "create-rfq", "rfq-required", "ecrs-ready-for-rfq"].includes(normalized)) {
    const stage = getECRCurrentStage(ecr.select_pxfp, ecr);
    return (
      (stage === "RFQ Pending" || ecr.select_pxfp === "Approved" || ecr.select_pxfp === "RFQ Pending") &&
      !String(ecr.rfq ?? "").trim()
    );
  }
  if (normalized === "approved") {
    const stage = getECRCurrentStage(ecr.select_pxfp, ecr);
    return ["Procurement Review", "RFQ Pending", "RFQ", "Approved"].includes(stage) || ecr.select_pxfp === "Approved";
  }
  if (normalized === "rfq-created") {
    return Boolean(ecr.rfq) || getECRCurrentStage(ecr.select_pxfp, ecr) === "RFQ";
  }
  return matchesECRQueueFilter(filter, role, ecr, user);
}

export function activeQueueValue(filter: string, role?: ECRRole | null): string {
  const normalized = filter.toLowerCase().trim().replaceAll("_", "-");
  if (isPendingFilter(normalized)) return "pending-approval";
  if (normalized === "needs-revision") return "sent-back";
  if (normalized === "completed") return "completed";
  if (role === "procurement_team" && normalized === "procurement") {
    return "procurement-review";
  }
  if (
    role === "procurement" &&
    ["create-rfq", "rfq-required"].includes(normalized)
  ) {
    return "rfq-pending";
  }
  return normalized || "all";
}

export function getRoleECRStageLabel(
  _role: ECRRole | null | undefined,
  ecr: EngineeringChangeRequest,
): string {
  return getECRCurrentStage(ecr.select_pxfp, ecr);
}

export function getVisibleECRListActionLabel(
  role: ECRRole | null | undefined,
  ecr: EngineeringChangeRequest,
  user: ReturnType<typeof useAuthStore.getState>["user"],
): ReturnType<typeof getECRListActionLabel> {
  const stage = getECRCurrentStage(ecr.select_pxfp, ecr);
  if (
    role === "procurement_team" &&
    stage === "Procurement Review" &&
    isECRActionableForRole(role, ecr, user)
  ) {
    return "Review";
  }
  if (role === "procurement") {
    return "View";
  }
  return getECRListActionLabel(role, ecr, user);
}

