import { getECRCurrentStage, isPendingApprovalForRole, type ECRQueueUser } from "../../config/ecrQueues";
import { getECRStageConfig, isEcrOwnedBy, normalizeECRRoleAlias } from "../../config/ecrRoles";
import type { EngineeringChangeRequest } from "../../types/erpnext";

/** Select existing assignments for this view without granting workflow actions. */
export function isEngineerTechnicalReviewAssignment(
  ecr: EngineeringChangeRequest,
  user?: ECRQueueUser | null,
): boolean {
  const stage = getECRCurrentStage(ecr.select_pxfp, ecr);
  if (user?.role !== "engineer" || !isEcrOwnedBy(ecr, user) || stage !== "Engineering Review") return false;
  if (isPendingApprovalForRole("engineer", ecr)) return true;

  const identities = new Set([user.id, user.name, user.email, user.username]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean));
  const approvalRole = getECRStageConfig(stage, ecr)?.responsibleTitle;
  if (!approvalRole) return false;
  return Boolean(ecr.approval_requirements?.some((task) =>
    task.status === "Pending" && Number(task.required) === 1 &&
    normalizeECRRoleAlias(task.approval_role) === normalizeECRRoleAlias(approvalRole) &&
    identities.has(String(task.approver ?? "").trim().toLowerCase()),
  ));
}
