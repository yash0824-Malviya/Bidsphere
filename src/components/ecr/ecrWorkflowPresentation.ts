import {
  getApplicableECRWorkflowStages,
  canonicalECRStage,
} from "../../config/ecrRoles";
import type { ECRStatus, EngineeringChangeRequest } from "../../types/erpnext";

export function getECRWorkflowActiveIndex(
  status?: ECRStatus | string | null,
  rfqReference?: string | null,
  ecr?: Partial<EngineeringChangeRequest> | null,
): number {
  const current = String(rfqReference ?? "").trim()
    ? "RFQ"
    : canonicalECRStage(status, ecr);
  return getApplicableECRWorkflowStages(ecr).findIndex((stage) => stage.id === current);
}
