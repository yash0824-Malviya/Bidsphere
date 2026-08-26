import { describe, expect, it } from "vitest";

import type { EngineeringChangeRequest } from "../types/erpnext";
import {
  ECR_STAGE_WORKFLOW_MAP,
  ECR_WORKFLOW_STAGES,
  canApproveECR,
  canCreateECR,
  canCreatePR,
  canCreateRFQ,
  canEditECR,
  canEvaluateSupplier,
  canRejectECR,
  canReviewECR,
  canSendBackECR,
  canonicalECRStage,
  ecrStageIndex,
  formatECRNumber,
  getApplicableECRWorkflowStages,
  getECRNextStatus,
  getECRReviewStage,
  getECRStatusCardInfo,
  getECRWorkflowActions,
  getNextApplicableECRStage,
  isECRQueueItem,
  isEcrOwnedBy,
  isTerminalECRStatus,
} from "./ecrRoles";

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

function pending(role: string): NonNullable<EngineeringChangeRequest["approval_requirements"]>[number] {
  return {
    name: `TASK-${role}`,
    approval_role: role,
    status: "Pending" as const,
    required: 1,
  };
}

describe("five-stage sequential ECR role and workflow config", () => {
  it("exposes exactly the required workflow stages", () => {
    const expected = [
      "Draft",
      "Engineering Review",
      "Procurement Review",
      "RFQ Pending",
      "RFQ",
    ];
    expect(ECR_WORKFLOW_STAGES.map(({ id }) => id)).toEqual(expected);
    expect(getApplicableECRWorkflowStages().map(({ id }) => id)).toEqual(expected);
    expect(Object.keys(ECR_STAGE_WORKFLOW_MAP)).toEqual(expected);
    expect(ECR_STAGE_WORKFLOW_MAP["Engineering Review"]?.nextStage).toBe("Procurement Review");
    expect(ECR_STAGE_WORKFLOW_MAP["Procurement Review"]?.nextStage).toBe("RFQ Pending");
    expect(ECR_STAGE_WORKFLOW_MAP["RFQ Pending"]?.nextStage).toBe("RFQ");
    expect(ecrStageIndex("Procurement Review")).toBe(2);
    expect(ecrStageIndex("RFQ Pending")).toBe(3);
  });

  it("canonicalizes legacy active records through Procurement Team review", () => {
    expect(canonicalECRStage("Engineering Manager Approval")).toBe("Engineering Review");
    expect(canonicalECRStage("Under Review")).toBe("Engineering Review");
    expect(canonicalECRStage("Procurement Team Approval")).toBe("Procurement Review");
    expect(canonicalECRStage("Procurement Manager")).toBe("RFQ Pending");
    expect(canonicalECRStage("Approved")).toBe("Procurement Review");
    expect(canonicalECRStage("Operations Review")).toBe("Procurement Review");
    expect(canonicalECRStage("Implementation")).toBe("Procurement Review");
    expect(canonicalECRStage("RFQ Created")).toBe("RFQ");
    expect(canonicalECRStage("Sent Back")).toBe("Sent Back");
    expect(canonicalECRStage("Rejected")).toBe("Rejected");
  });

  it("normalizes punctuation in known stages and fails closed for unknown stages", () => {
    expect(canonicalECRStage("Procurement.team Review")).toBe("Procurement Review");
    expect(canonicalECRStage("Procurement-manager Approval")).toBe("RFQ Pending");
    expect(canonicalECRStage("unrecognized future gate")).toBe("Unknown");
    expect(ecrStageIndex("unrecognized future gate")).toBe(-1);
    expect(getECRWorkflowActions("procurement_team", "unrecognized future gate")).toEqual([]);
    expect(getECRWorkflowActions("procurement", "unrecognized future gate")).toEqual([]);
    expect(isECRQueueItem("procurement_team", ecr("unrecognized future gate"))).toBe(false);
    expect(isECRQueueItem("procurement", ecr("unrecognized future gate"))).toBe(false);
    expect(getECRStatusCardInfo("unrecognized future gate")).toMatchObject({
      status: "Unknown",
      nextStatus: "None",
      assignedToValue: "Unassigned",
      actionValue: "No workflow action available",
    });
  });

  it("allows only the required sequential state changes", () => {
    expect(getNextApplicableECRStage("Draft", "Submit ECR")).toBe("Engineering Review");
    expect(getNextApplicableECRStage("Engineering Review", "Approve")).toBe("Procurement Review");
    expect(getNextApplicableECRStage("Procurement Review", "Approve")).toBe("RFQ Pending");
    expect(getNextApplicableECRStage("RFQ Pending", "Create RFQ")).toBe("RFQ");
    expect(getNextApplicableECRStage("Engineering Review", "Send Back")).toBe("Draft");
    expect(getNextApplicableECRStage("Procurement Review", "Send Back")).toBe("Draft");
    expect(getNextApplicableECRStage("Engineering Review", "Reject")).toBe("Rejected");
    expect(getNextApplicableECRStage("Procurement Review", "Reject")).toBe("Rejected");
    expect(getECRNextStatus("Draft")).toBe("Engineering Review");
    expect(getECRNextStatus("Engineering Review")).toBe("Procurement Review");
    expect(getECRNextStatus("Procurement Review")).toBe("RFQ Pending");
    expect(getECRNextStatus("RFQ Pending")).toBe("RFQ");
  });

  it("exposes review decisions only to the active review owner", () => {
    const decisions = [
      { label: "Send Back", action: "Send Back", tone: "secondary" },
      { label: "Reject", action: "Reject", tone: "danger" },
      { label: "Approve", action: "Approve", tone: "primary" },
    ];
    expect(getECRWorkflowActions("engineering", "Engineering Review")).toEqual(decisions);
    expect(getECRWorkflowActions("procurement_team", "Procurement Review")).toEqual(decisions);
    expect(canReviewECR("engineering", "Engineering Review")).toBe(true);
    expect(canReviewECR("procurement_team", "Procurement Review")).toBe(true);
    expect(canApproveECR("engineering", "Engineering Review")).toBe(true);
    expect(canSendBackECR("procurement_team", "Procurement Review")).toBe(true);
    expect(canRejectECR("procurement_team", "Procurement Review")).toBe(true);
    expect(getECRWorkflowActions("engineer", "Engineering Review")).toEqual([]);
    expect(getECRWorkflowActions("procurement_team", "RFQ Pending")).toEqual([]);
    expect(getECRWorkflowActions("procurement", "Procurement Review")).toEqual([]);
    expect(getECRWorkflowActions("admin", "Engineering Review")).toEqual([]);
  });

  it("reserves Create RFQ for Procurement Manager at RFQ Pending", () => {
    expect(getECRWorkflowActions("procurement", "RFQ Pending"))
      .toEqual([{ label: "Create RFQ", action: "Create RFQ", tone: "primary" }]);
    for (const role of ["engineer", "engineering", "procurement_team", "admin"] as const) {
      expect(getECRWorkflowActions(role, "RFQ Pending")).toEqual([]);
    }
    expect(canCreateRFQ("procurement")).toBe(true);
    expect(canCreateRFQ("procurement_team")).toBe(false);
    expect(canCreateRFQ("admin")).toBe(false);
    expect(canCreatePR("procurement_team")).toBe(false);
    expect(canEvaluateSupplier("procurement")).toBe(false);
  });

  it("keeps create/edit ownership strict", () => {
    const draft = ecr("Draft");
    const user = { email: "engineer@netlink.com", role: "engineer" };
    expect(canCreateECR("engineer")).toBe(true);
    expect(canEditECR("engineer", "Draft", draft, user)).toBe(true);
    expect(canEditECR("engineer", "Draft", draft, { email: "other@netlink.com" })).toBe(false);
    expect(canEditECR("engineer", "Engineering Review", ecr("Engineering Review"), user)).toBe(false);
    expect(isEcrOwnedBy(draft, user)).toBe(true);
  });

  it("routes each active queue to exactly its current owner", () => {
    expect(isECRQueueItem("engineering", ecr("Engineering Review"))).toBe(true);
    expect(isECRQueueItem("procurement_team", ecr("Procurement Review"))).toBe(true);
    expect(isECRQueueItem("procurement", ecr("RFQ Pending"))).toBe(true);
    expect(isECRQueueItem("procurement_team", ecr("RFQ Pending"))).toBe(false);
    expect(isECRQueueItem("procurement", ecr("Procurement Review"))).toBe(false);
    expect(isECRQueueItem("procurement", ecr("RFQ Pending", { rfq: "RFQ-00001" }))).toBe(false);
  });

  it("keeps status, action, and verified assignee synchronized", () => {
    const engineering = ecr("Engineering Review", {
      approval_requirements: [pending("Engineering Manager")],
    });
    const team = ecr("Procurement Review", {
      approval_requirements: [pending("Procurement Team")],
    });
    const manager = ecr("RFQ Pending", {
      approval_requirements: [pending("Procurement Manager")],
    });
    expect(getECRStatusCardInfo("Engineering Review", engineering)).toMatchObject({
      status: "Engineering Review",
      assignedToValue: "Engineering Manager",
      actionValue: "Review and approve",
    });
    expect(getECRStatusCardInfo("Procurement Review", team)).toMatchObject({
      status: "Procurement Review",
      assignedToValue: "Procurement Team",
      actionValue: "Review and approve",
    });
    expect(getECRStatusCardInfo("Procurement Review", ecr("Procurement Review", {
      approval_requirements: [pending("Procurement-Team.")],
    }))).toMatchObject({
      status: "Procurement Review",
      assignedToValue: "Procurement Team",
      actionValue: "Review and approve",
    });
    expect(getECRStatusCardInfo("RFQ Pending", manager)).toMatchObject({
      status: "RFQ Pending",
      assignedToValue: "Procurement Manager",
      actionValue: "Create RFQ",
    });
    expect(getECRStatusCardInfo("RFQ", ecr("RFQ", { rfq: "RFQ-00001" }))).toMatchObject({
      status: "RFQ",
      assignedToValue: "Procurement Team / RFQ process",
      actionValue: "RFQ created",
    });
    expect(getECRStatusCardInfo("Procurement Review", ecr("Procurement Review")))
      .toMatchObject({ assignedToValue: "Unassigned" });
  });

  it("uses RFQ evidence as terminal workflow state", () => {
    expect(getECRStatusCardInfo("RFQ Pending", ecr("RFQ Pending", { rfq: "RFQ-00001" })))
      .toMatchObject({ status: "RFQ", nextStatus: "Completed", actionValue: "RFQ created" });
    expect(isTerminalECRStatus("RFQ")).toBe(true);
    expect(getECRReviewStage("Engineering Review")).toBe("Engineering Review");
    expect(getECRReviewStage("Procurement Review")).toBe("Procurement Review");
    expect(getECRReviewStage("RFQ Pending")).toBeNull();
  });

  it("preserves the critical ECR business number", () => {
    expect(formatECRNumber({ name: "1j3b9i4moj", ecr_number: "ECR-2026-85517" }))
      .toBe("ECR-2026-85517");
    expect(formatECRNumber("1j3b9i4moj")).toBe("ECR-2026-85517");
  });
});
