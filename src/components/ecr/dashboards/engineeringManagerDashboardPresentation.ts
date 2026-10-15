import { getECRCurrentStage, isPendingApprovalForRole, type ECRQueueUser } from "../../../config/ecrQueues";
import { isEcrOwnedBy, isExtendedECRWorkflow, normalizeECRRoleAlias } from "../../../config/ecrRoles";
import type { EngineeringChangeRequest } from "../../../types/erpnext";
import { selectECRActivityRecords } from "./engineerEcrActivity";
import { getEngineeringECRMetrics } from "../../../pages/ecr/engineeringEcrMetrics";

/** Read-only dashboard presentation. Existing queue and action rules remain authoritative. */
export function engineeringManagerDashboardData(ecrs: EngineeringChangeRequest[], user: ECRQueueUser | null | undefined) {
  const summary = getEngineeringECRMetrics(ecrs, user);
  // This is downstream visibility, not permission for the manager to prepare a case.
  const businessCasesToPrepare = ecrs.filter((ecr) => isExtendedECRWorkflow(ecr) &&
    ["Technical Approved", "Business Case Preparation"].includes(getECRCurrentStage(ecr.select_pxfp, ecr)),
  ).length;
  const identities = new Set([user?.id, user?.name, user?.email, user?.username]
    .map((value) => String(value ?? "").trim().toLowerCase()).filter(Boolean));
  const relevant = ecrs.filter((ecr) => isEcrOwnedBy(ecr, user) || isPendingApprovalForRole("engineering", ecr) ||
    ecr.approval_requirements?.some((task) =>
      normalizeECRRoleAlias(task.approval_role) === normalizeECRRoleAlias("Engineering Manager") &&
      ["Approved", "Rejected", "Sent Back"].includes(task.status ?? "") &&
      identities.has(String(task.approver ?? "").trim().toLowerCase()),
    ),
  );
  return { summary, businessCasesToPrepare, recent: selectECRActivityRecords(relevant), relevantCount: relevant.length };
}
