import { describe, expect, it } from "vitest";

import type { EngineeringChangeRequest } from "../../types/erpnext";
import {
  activeQueueValue,
  getRoleECRStageLabel,
  getVisibleECRListActionLabel,
  matchesVisibleQueueFilter,
  queueFiltersForRole,
} from "./ECRListPage";

function ecr(
  status: EngineeringChangeRequest["select_pxfp"],
  extra: Partial<EngineeringChangeRequest> = {},
): EngineeringChangeRequest {
  return {
    name: "ECR-2026-100001",
    ecr_number: "ECR-2026-100001",
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

describe("ECR list procurement role presentation", () => {
  it("gives Procurement Team Procurement Review and All ECRs only", () => {
    expect(queueFiltersForRole("procurement_team")).toEqual([
      { label: "Procurement Review", value: "procurement-review" },
      { label: "All ECRs", value: "all" },
    ]);
    expect(queueFiltersForRole("procurement_team").map(({ label }) => label))
      .not.toContain("Create RFQ");
  });

  it("gives Procurement Manager the separate RFQ Creation queues", () => {
    expect(queueFiltersForRole("procurement")).toEqual([
      { label: "RFQ Pending", value: "rfq-pending" },
      { label: "RFQ", value: "rfq-created" },
      { label: "All ECRs", value: "all" },
    ]);
    const pending = ecr("RFQ Pending", {
      approval_requirements: [pendingTask("Procurement Manager")],
    });
    expect(matchesVisibleQueueFilter("rfq-pending", "procurement", pending, null))
      .toBe(true);
    expect(getVisibleECRListActionLabel("procurement", pending, null))
      .toBe("Create RFQ");

    const created = ecr("RFQ", { rfq: "RFQ-00001" });
    expect(matchesVisibleQueueFilter("rfq-created", "procurement", created, null))
      .toBe(true);
  });

  it("keeps Procurement Team review-only at its exact persisted stage", () => {
    const pending = ecr("Procurement Review", {
      approval_requirements: [pendingTask("Procurement Team")],
    });
    expect(matchesVisibleQueueFilter(
      "procurement-review",
      "procurement_team",
      pending,
      null,
    )).toBe(true);
    expect(matchesVisibleQueueFilter("create-rfq", "procurement_team", pending, null))
      .toBe(false);
    expect(getVisibleECRListActionLabel("procurement_team", pending, null))
      .toBe("Review");
    expect(matchesVisibleQueueFilter(
      "procurement-review",
      "procurement_team",
      ecr("Procurement Review"),
      null,
    )).toBe(false);
  });

  it("uses the exact role-specific stage labels and excludes linked RFQs", () => {
    const review = ecr("Procurement Review");
    const pending = ecr("RFQ Pending");
    const completed = ecr("RFQ Pending", { rfq: "RFQ-00001" });
    expect(getRoleECRStageLabel("procurement_team", review)).toBe("Procurement Review");
    expect(getRoleECRStageLabel("procurement", pending)).toBe("RFQ Pending");
    expect(getRoleECRStageLabel("procurement", completed)).toBe("RFQ");
    expect(matchesVisibleQueueFilter("rfq-pending", "procurement", completed, null))
      .toBe(false);
  });

  it("normalizes legacy queue URLs to the correct active role queue", () => {
    expect(activeQueueValue("procurement", "procurement_team"))
      .toBe("procurement-review");
    expect(activeQueueValue("create-rfq", "procurement"))
      .toBe("rfq-pending");
    expect(activeQueueValue("rfq-required", "procurement"))
      .toBe("rfq-pending");
  });
});
