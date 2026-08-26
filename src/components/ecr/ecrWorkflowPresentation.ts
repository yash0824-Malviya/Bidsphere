import {
  ECR_WORKFLOW_STAGES,
  canonicalECRStage,
} from "../../config/ecrRoles";
import type { ECRStatus } from "../../types/erpnext";

export function getECRWorkflowActiveIndex(
  status?: ECRStatus | string | null,
  rfqReference?: string | null,
): number {
  const current = String(rfqReference ?? "").trim()
    ? "RFQ"
    : canonicalECRStage(status);
  return ECR_WORKFLOW_STAGES.findIndex((stage) => stage.id === current);
}
