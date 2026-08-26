import { describe, expect, it } from "vitest";
import type { EngineeringChangeRequest } from "../types/erpnext";
import {
  getECRAssignedTo,
  getECRCurrentStage,
  getECRListActionLabel,
  getECRListActionRoute,
  getECRProcurementQueueSummary,
  getECRQueueSummary,
  getProcurementStageLabel,
  hasECRReachedProcurement,
  isECRActionableForRole,
  isPendingApprovalForRole,
  matchesECRQueueFilter,
} from "./ecrQueues";

function ecr(
  status: EngineeringChangeRequest["select_pxfp"] | string,
  extra: Partial<EngineeringChangeRequest> = {},
): EngineeringChangeRequest {
  return {
    name: "1j3b9i4moj",
    ecr_number: "ECR-2026-85517",
    ecr_title: "Supplier-sourced bracket change",
    ecr_type: "Part Change",
    priority: "High",
    ecr_owner: "engineer@netlink.com",
    requesting_department: "Engineering",
    plant: "Main Plant",
    target_implementation_date: "2026-08-30",
    chnage_description: "Increase bracket thickness.",
    reason_for_change: "Durability",
    select_pxfp: status as EngineeringChangeRequest["select_pxfp"],
    docstatus: status === "Draft" ? 0 : 1,
    approval_requirements: [],
    ...extra,
  };
}

const engineeringTask = {
  name: "TASK-ENGINEERING",
  approval_role: "Engineering Manager",
  status: "Pending" as const,
  required: 1 as const,
};
const procurementTeamTask = {
  name: "TASK-PROCUREMENT-TEAM",
  approval_role: "Procurement Team",
  status: "Pending" as const,
  required: 1 as const,
};
const procurementManagerTask = {
  name: "TASK-PROCUREMENT-MANAGER",
  approval_role: "Procurement Manager",
  status: "Pending" as const,
  required: 1 as const,
};
const engineer = { email: "engineer@netlink.com", role: "engineer" };

describe("five-stage ECR queues", () => {
  it("shows Engineering Review only for exactly one persisted required manager task", () => {
    const valid = ecr("Engineering Review", { approval_requirements: [engineeringTask] });
    expect(isPendingApprovalForRole("engineering", valid)).toBe(true);
    expect(isPendingApprovalForRole("operations", valid)).toBe(false);
    expect(matchesECRQueueFilter("pending", "engineering", valid)).toBe(true);
    expect(getECRListActionLabel("engineering", valid)).toBe("Review");

    const invalidRows = [
      ecr("Engineering Review"),
      ecr("Engineering Review", {
        approval_requirements: [{ ...engineeringTask, required: 0 }],
      }),
      ecr("Engineering Review", {
        approval_requirements: [{ ...engineeringTask, approval_role: "Operations Manager" }],
      }),
      ecr("Engineering Review", {
        approval_requirements: [engineeringTask, { ...engineeringTask, name: "TASK-DUPLICATE" }],
      }),
    ];
    for (const row of invalidRows) {
      expect(isPendingApprovalForRole("engineering", row)).toBe(false);
      expect(isECRActionableForRole("engineering", row)).toBe(false);
      expect(getECRListActionLabel("engineering", row)).toBe("View");
      expect(getECRAssignedTo(row)).toBe("Unassigned");
    }
  });

  it("keeps only owned Draft rows editable for Engineers", () => {
    const draft = ecr("Draft");
    expect(isECRActionableForRole("engineer", draft, engineer)).toBe(true);
    expect(getECRListActionLabel("engineer", draft, engineer)).toBe("Edit");
    expect(isECRActionableForRole("engineer", draft, { email: "other@netlink.com" }))
      .toBe(false);
    expect(isECRActionableForRole("engineer", ecr("Sent Back"), engineer)).toBe(false);
  });

  it("routes legacy completed nonterminal records to Procurement Review", () => {
    for (const status of [
      "Approved",
      "Operations Review",
      "Quality Review",
      "Program Review",
      "Purchase Requisition",
      "Supplier Selection",
      "Implementation",
      "Validation",
    ]) {
      const row = ecr(status);
      expect(getECRCurrentStage(row.select_pxfp, row)).toBe("Procurement Review");
      expect(hasECRReachedProcurement(row)).toBe(true);
      expect(getProcurementStageLabel(row)).toBe("Procurement Review");
    }
  });

  it("separates Procurement Team review from Procurement Manager RFQ creation", () => {
    const teamReady = ecr("Procurement Review", {
      approval_requirements: [procurementTeamTask],
    });
    const managerReady = ecr("RFQ Pending", {
      approval_requirements: [procurementManagerTask],
    });
    expect(isECRActionableForRole("procurement_team", teamReady)).toBe(true);
    expect(getECRListActionLabel("procurement_team", teamReady)).toBe("Review");
    expect(matchesECRQueueFilter("procurement-review", "procurement_team", teamReady)).toBe(true);
    expect(isECRActionableForRole("procurement", managerReady)).toBe(true);
    expect(getECRListActionLabel("procurement", managerReady)).toBe("Create RFQ");
    expect(matchesECRQueueFilter("rfq-pending", "procurement", managerReady)).toBe(true);
    expect(isECRActionableForRole("procurement", teamReady)).toBe(false);
    expect(isECRActionableForRole("procurement_team", managerReady)).toBe(false);
    expect(isECRActionableForRole("procurement_team", ecr("Procurement Review"))).toBe(false);
    expect(isECRActionableForRole("procurement", ecr("RFQ Pending"))).toBe(false);
    expect(isECRActionableForRole("procurement_team", ecr("Procurement.team Review", {
      approval_requirements: [{ ...procurementTeamTask, approval_role: "Procurement-Team." }],
    }))).toBe(true);
  });

  it("uses linked RFQ evidence as authoritative completion", () => {
    const linked = ecr("Implementation", { rfq: "RFQ-00001" });
    expect(getECRCurrentStage(linked.select_pxfp, linked)).toBe("RFQ");
    expect(getProcurementStageLabel(linked)).toBe("RFQ Created");
    expect(getECRAssignedTo(linked)).toBe("Procurement Team / RFQ process");
    expect(isECRActionableForRole("procurement_team", linked)).toBe(false);
    expect(isECRActionableForRole("procurement", linked)).toBe(false);
    expect(matchesECRQueueFilter("rfq", "procurement_team", linked)).toBe(true);
    expect(matchesECRQueueFilter("completed", "procurement_team", linked)).toBe(true);
  });

  it("keeps removed and historical queue aliases non-actionable", () => {
    const cases = [
      ["operations-actions", "operations", ecr("Implementation")],
      ["quality-actions", "quality", ecr("Validation")],
      ["program-review", "program_manager", ecr("Program Review")],
      ["sent-back", "engineer", ecr("Sent Back")],
      ["requisition", "procurement_team", ecr("Procurement Review")],
      ["supplier-response", "procurement_team", ecr("Supplier Response")],
      ["evaluation", "procurement", ecr("Supplier Evaluation")],
      ["selection", "procurement", ecr("Supplier Selection")],
      ["rejected", "admin", ecr("Rejected")],
    ] as const;
    for (const [filter, role, row] of cases) {
      expect(matchesECRQueueFilter(filter, role, row)).toBe(false);
    }
    expect(isECRActionableForRole("engineer", ecr("Sent Back"), engineer)).toBe(false);
    expect(isECRActionableForRole("admin", ecr("Rejected"))).toBe(false);
    expect(matchesECRQueueFilter("unknown-legacy-filter", "admin", ecr("Draft")))
      .toBe(false);
  });

  it("reports only RFQ-required and RFQ-complete procurement workload", () => {
    expect(getECRProcurementQueueSummary([
      ecr("Procurement Review"),
      ecr("Approved"),
      ecr("RFQ Pending"),
      ecr("RFQ", { rfq: "RFQ-00001" }),
      ecr("Validation", { rfq: "RFQ-00002" }),
      ecr("Closed"),
    ])).toEqual({
      approved: 2,
      requisitionReady: 0,
      rfqReady: 1,
      supplierResponses: 0,
      evaluations: 0,
      selections: 0,
      pendingSelectionApproval: 0,
      completed: 2,
    });
  });

  it("summarizes exact current queues without reviving legacy states", () => {
    const rows = [
      ecr("Draft"),
      ecr("Engineering Review", { approval_requirements: [engineeringTask] }),
      ecr("Sent Back"),
      ecr("Approved"),
      ecr("Closed"),
      ecr("RFQ", { rfq: "RFQ-00001" }),
    ];
    expect(getECRQueueSummary("engineering", rows, engineer)).toEqual({
      mine: 6,
      pending: 1,
      sentBack: 0,
      approved: 2,
      closed: 1,
    });
  });

  it("uses the public ECR number in detail and edit routes", () => {
    expect(getECRListActionRoute("engineer", ecr("Draft"), engineer))
      .toBe("/ecr/ECR-2026-85517/edit");
    expect(getECRListActionRoute("engineering", ecr("Engineering Review")))
      .toBe("/ecr/ECR-2026-85517");
  });
});
