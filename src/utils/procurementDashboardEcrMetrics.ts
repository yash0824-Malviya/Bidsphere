import {
  getECRCurrentStage,
  isECRActionableForRole,
} from "../config/ecrQueues";
import type { EngineeringChangeRequest } from "../types/erpnext";

export interface ProcurementDashboardEcrMetrics {
  rfqsPendingCreation: number;
  approvedEcrsAwaitingAction: number;
  ecrRfqsCreated: number;
}

/**
 * Derive the Procurement Manager's ECR sourcing snapshot from live ECR rows.
 * The RFQ-pending count deliberately uses the same task/stage gate as the ECR
 * queue, while the wider awaiting-action count also includes Procurement Team
 * review work that has not reached RFQ creation yet.
 */
export function deriveProcurementDashboardEcrMetrics(
  ecrs: EngineeringChangeRequest[],
): ProcurementDashboardEcrMetrics {
  const metrics: ProcurementDashboardEcrMetrics = {
    rfqsPendingCreation: 0,
    approvedEcrsAwaitingAction: 0,
    ecrRfqsCreated: 0,
  };

  for (const ecr of ecrs) {
    const stage = getECRCurrentStage(ecr.select_pxfp, ecr);
    const hasRfq = Boolean(String(ecr.rfq ?? "").trim());

    if (stage === "RFQ") {
      metrics.ecrRfqsCreated += 1;
      continue;
    }

    if (
      !hasRfq &&
      (stage === "Procurement Review" || stage === "RFQ Pending")
    ) {
      metrics.approvedEcrsAwaitingAction += 1;
    }

    if (
      stage === "RFQ Pending" &&
      !hasRfq &&
      isECRActionableForRole("procurement", ecr)
    ) {
      metrics.rfqsPendingCreation += 1;
    }
  }

  return metrics;
}
