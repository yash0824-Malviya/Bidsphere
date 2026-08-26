import { describe, expect, it } from "vitest";

import type { EngineeringChangeRequest } from "../../../types/erpnext";
import {
  getDashboardECRActionLabel,
  getDashboardECRStageLabel,
  getRoleDashboardQueue,
  procurementDashboardCards,
  roleQueueRoute,
} from "./RoleECRDashboard";

function ecr(
  name: string,
  status: EngineeringChangeRequest["select_pxfp"],
  extra: Partial<EngineeringChangeRequest> = {},
): EngineeringChangeRequest {
  return {
    name,
    ecr_number: name,
    ecr_title: "Supplier bracket change",
    ecr_type: "Part Change",
    priority: "High",
    ecr_owner: "engineer@netlink.com",
    requesting_department: "Engineering",
    plant: "Main Plant",
    target_implementation_date: "2026-09-01",
    chnage_description: "Change bracket.",
    reason_for_change: "Durability",
    select_pxfp: status,
    docstatus: 1,
    approval_requirements: [],
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

const rows = [
  ecr("ECR-1", "Procurement Review", {
    approval_requirements: [pendingTask("Procurement Team")],
  }),
  ecr("ECR-2", "RFQ Pending", {
    approval_requirements: [pendingTask("Procurement Manager")],
  }),
  ecr("ECR-3", "RFQ", { rfq: "RFQ-1" }),
  ecr("ECR-4", "Engineering Review"),
];

describe("role ECR dashboard procurement presentation", () => {
  it("shows Procurement Team review and all-record cards without Create RFQ", () => {
    const cards = procurementDashboardCards("procurement_team", rows);
    expect(cards.map(({ label }) => label)).toEqual([
      "Procurement Review",
      "All ECRs",
    ]);
    expect(cards.map(({ to }) => to)).toEqual([
      "/ecr?filter=procurement-review",
      "/ecr",
    ]);
    expect(JSON.stringify(cards)).not.toContain("Create RFQ");
  });

  it("shows Procurement Manager RFQ Pending with Create RFQ guidance", () => {
    const cards = procurementDashboardCards("procurement", rows);
    expect(cards.map(({ label }) => label)).toEqual([
      "RFQ Pending",
      "RFQ",
      "All ECRs",
    ]);
    expect(cards[0]).toMatchObject({
      value: 1,
      hint: "Create RFQ for approved ECRs",
      to: "/ecr?filter=rfq-pending",
    });
  });

  it("uses exact queue routes for each procurement role", () => {
    expect(roleQueueRoute("procurement_team"))
      .toBe("/ecr?filter=procurement-review");
    expect(roleQueueRoute("procurement"))
      .toBe("/ecr?filter=rfq-pending");
  });

  it("keeps the Team queue review-only and the Manager queue actionable", () => {
    const teamQueue = getRoleDashboardQueue("procurement_team", rows, null);
    const managerQueue = getRoleDashboardQueue("procurement", rows, null);
    expect(teamQueue.map(({ name }) => name)).toEqual(["ECR-1"]);
    expect(managerQueue.map(({ name }) => name)).toEqual(["ECR-2"]);
    expect(getDashboardECRStageLabel("procurement_team", teamQueue[0]))
      .toBe("Procurement Review");
    expect(getDashboardECRStageLabel("procurement", managerQueue[0]))
      .toBe("RFQ Pending");
    expect(getDashboardECRActionLabel("procurement_team", teamQueue[0], null))
      .toBe("Review");
    expect(getDashboardECRActionLabel("procurement", managerQueue[0], null))
      .toBe("Create RFQ");
  });
});
