import { describe, expect, it } from "vitest";

import type { EngineeringChangeRequest } from "../types/erpnext";
import { deriveProcurementDashboardEcrMetrics } from "./procurementDashboardEcrMetrics";

function ecr(
  name: string,
  status: EngineeringChangeRequest["select_pxfp"],
  extra: Partial<EngineeringChangeRequest> = {},
): EngineeringChangeRequest {
  return {
    name,
    ecr_title: "Supplier bracket change",
    priority: "High",
    requesting_department: "Engineering",
    plant: "Main Plant",
    target_implementation_date: "2026-09-01",
    chnage_description: "Change bracket.",
    reason_for_change: "Durability",
    select_pxfp: status,
    ...extra,
  };
}

function pendingTask(role: string) {
  return {
    name: `TASK-${role}`,
    approval_role: role,
    status: "Pending" as const,
    required: 1 as const,
  };
}

describe("deriveProcurementDashboardEcrMetrics", () => {
  it("counts the exact Procurement Manager RFQ queue and the wider approved workload", () => {
    const metrics = deriveProcurementDashboardEcrMetrics([
      ecr("ECR-TEAM", "Procurement Review", {
        approval_requirements: [pendingTask("Procurement Team")],
      }),
      ecr("ECR-MANAGER", "RFQ Pending", {
        approval_requirements: [pendingTask("Procurement Manager")],
      }),
      ecr("ECR-OTHER-TASK", "RFQ Pending", {
        approval_requirements: [pendingTask("Procurement Team")],
      }),
    ]);

    expect(metrics).toEqual({
      rfqsPendingCreation: 1,
      approvedEcrsAwaitingAction: 3,
      ecrRfqsCreated: 0,
    });
  });

  it("counts linked and canonical RFQ-stage ECRs once and excludes earlier stages", () => {
    const metrics = deriveProcurementDashboardEcrMetrics([
      ecr("ECR-LINKED", "RFQ Pending", { rfq: "RFQ-0001" }),
      ecr("ECR-STAGE", "RFQ"),
      ecr("ECR-ENGINEERING", "Engineering Review"),
      ecr("ECR-DRAFT", "Draft"),
    ]);

    expect(metrics).toEqual({
      rfqsPendingCreation: 0,
      approvedEcrsAwaitingAction: 0,
      ecrRfqsCreated: 2,
    });
  });

  it("requires one active Procurement Manager task before showing RFQ creation work", () => {
    const metrics = deriveProcurementDashboardEcrMetrics([
      ecr("ECR-NO-TASK", "RFQ Pending"),
      ecr("ECR-DUPLICATE", "RFQ Pending", {
        approval_requirements: [
          pendingTask("Procurement Manager"),
          pendingTask("Procurement Manager"),
        ],
      }),
      ecr("ECR-COMPLETED-TASK", "RFQ Pending", {
        approval_requirements: [
          {
            ...pendingTask("Procurement Manager"),
            status: "Completed",
          },
        ],
      }),
    ]);

    expect(metrics.rfqsPendingCreation).toBe(0);
    expect(metrics.approvedEcrsAwaitingAction).toBe(3);
  });
});
