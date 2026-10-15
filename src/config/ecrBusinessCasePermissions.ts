import { getCurrentECRApprovalTask } from "../components/ecr/ecrDetailModel";
import type { ECRBusinessCase, ECRBusinessCaseReviewRole } from "../types/ecrBusinessCase";
import type { EngineeringChangeRequest } from "../types/erpnext";
import { canonicalECRStage, isExtendedECRWorkflow } from "./ecrRoles";

const REVIEW_ROLES: Readonly<Record<string, ECRBusinessCaseReviewRole>> = {
  "Finance Review": "finance",
  "Procurement BC Review": "procurement",
  "Quality Review": "quality",
};

/** Mirror the dedicated Business Case endpoint's persisted review requirements. */
export function getECRBusinessCaseReviewRole(
  role: string | null | undefined,
  ecr: EngineeringChangeRequest,
  businessCase: ECRBusinessCase | null,
): ECRBusinessCaseReviewRole | null {
  if (!isExtendedECRWorkflow(ecr) || Number(ecr.docstatus) !== 0 || !businessCase || businessCase.ecr_reference !== ecr.name) return null;
  const stage = canonicalECRStage(ecr.select_pxfp, ecr);
  const reviewRole = REVIEW_ROLES[stage];
  if (!reviewRole || role !== reviewRole || businessCase.status !== stage || businessCase[`${reviewRole}_status`] !== "Pending") return null;
  const financeRequired = "finance_required" in businessCase && Boolean(businessCase.finance_required);
  if ((stage !== "Finance Review" && financeRequired && businessCase.finance_status !== "Approved") ||
      (stage === "Quality Review" && businessCase.procurement_status !== "Approved")) return null;
  return getCurrentECRApprovalTask(ecr.select_pxfp, role, ecr.approval_requirements ?? [], ecr) ? reviewRole : null;
}
