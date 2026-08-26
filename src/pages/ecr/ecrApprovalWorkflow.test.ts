import { describe, expect, it } from "vitest";

import {
  ECR_STAGE_WORKFLOW_MAP,
  canApproveECR,
  canReviewECR,
  getECRStatusCardInfo,
  getECRWorkflowActions,
  getNextApplicableECRStage,
  resolveApprovalTask,
} from "../../config/ecrRoles";

describe("ECR approval assignment and sequential workflow", () => {
  describe("task resolver", () => {
    it("maps every action stage to one role", () => {
      expect(resolveApprovalTask("Engineering Review", "engineering")).toMatchObject({
        canAct: true,
        assignedTo: "Engineering Manager",
        requiredRole: "engineering",
        action: "Review and approve",
        isReviewStage: true,
      });
      expect(resolveApprovalTask("Procurement Review", "procurement_team")).toMatchObject({
        canAct: true,
        assignedTo: "Procurement Team",
        requiredRole: "procurement_team",
        action: "Review and approve",
        isReviewStage: true,
      });
      expect(resolveApprovalTask("RFQ Pending", "procurement")).toMatchObject({
        canAct: true,
        assignedTo: "Procurement Manager",
        requiredRole: "procurement",
        action: "Create RFQ",
        isReviewStage: false,
      });
      expect(resolveApprovalTask("Engineering Review", "engineer")?.canAct).toBe(false);
      expect(resolveApprovalTask("Procurement Review", "procurement")?.canAct).toBe(false);
      expect(resolveApprovalTask("RFQ Pending", "procurement_team")?.canAct).toBe(false);
    });
  });

  describe("status, action, and assignment", () => {
    it("uses the exact text for all active stages", () => {
      expect(getECRStatusCardInfo("Engineering Review")).toMatchObject({
        status: "Engineering Review",
        actionValue: "Review and approve",
        assignedToValue: "Engineering Manager",
      });
      expect(getECRStatusCardInfo("Procurement Review")).toMatchObject({
        status: "Procurement Review",
        actionValue: "Review and approve",
        assignedToValue: "Procurement Team",
      });
      expect(getECRStatusCardInfo("RFQ Pending")).toMatchObject({
        status: "RFQ Pending",
        actionValue: "Create RFQ",
        assignedToValue: "Procurement Manager",
      });
      expect(getECRStatusCardInfo("RFQ")).toMatchObject({
        status: "RFQ",
        actionValue: "RFQ created",
        assignedToValue: "Procurement Team / RFQ process",
      });
    });
  });

  describe("role-based actions", () => {
    const reviewActions = ["Send Back", "Reject", "Approve"];

    it("keeps Engineer view-only after submission", () => {
      expect(getECRWorkflowActions("engineer", "Engineering Review")).toEqual([]);
      expect(canReviewECR("engineer", "Engineering Review")).toBe(false);
      expect(canApproveECR("engineer", "Engineering Review")).toBe(false);
    });

    it("shows Engineering Review Decision only to Engineering Manager", () => {
      expect(getECRWorkflowActions("engineering", "Engineering Review").map((item) => item.label))
        .toEqual(reviewActions);
      expect(canReviewECR("engineering", "Engineering Review")).toBe(true);
      expect(canApproveECR("engineering", "Engineering Review")).toBe(true);
      expect(getECRWorkflowActions("procurement_team", "Engineering Review")).toEqual([]);
    });

    it("shows Procurement Review Decision only to Procurement Team", () => {
      expect(getECRWorkflowActions("procurement_team", "Procurement Review").map((item) => item.label))
        .toEqual(reviewActions);
      expect(canReviewECR("procurement_team", "Procurement Review")).toBe(true);
      expect(canApproveECR("procurement_team", "Procurement Review")).toBe(true);
      expect(getECRWorkflowActions("procurement", "Procurement Review")).toEqual([]);
    });

    it("shows Create RFQ only to Procurement Manager", () => {
      expect(getECRWorkflowActions("procurement", "RFQ Pending").map((item) => item.label))
        .toEqual(["Create RFQ"]);
      expect(getECRWorkflowActions("procurement_team", "RFQ Pending")).toEqual([]);
      expect(getECRWorkflowActions("engineering", "RFQ Pending")).toEqual([]);
      expect(getECRWorkflowActions("engineer", "RFQ Pending")).toEqual([]);
    });
  });

  describe("sequential stage transitions", () => {
    it("persists Draft -> Engineering Review -> Procurement Review -> RFQ Pending -> RFQ", () => {
      expect(getNextApplicableECRStage("Draft", "Submit ECR")).toBe("Engineering Review");
      expect(getNextApplicableECRStage("Engineering Review", "Approve"))
        .toBe("Procurement Review");
      expect(getNextApplicableECRStage("Procurement Review", "Approve"))
        .toBe("RFQ Pending");
      expect(getNextApplicableECRStage("RFQ Pending", "Create RFQ")).toBe("RFQ");
    });

    it("sends either review stage back to Draft and rejects terminally", () => {
      expect(getNextApplicableECRStage("Engineering Review", "Send Back")).toBe("Draft");
      expect(getNextApplicableECRStage("Procurement Review", "Send Back")).toBe("Draft");
      expect(getNextApplicableECRStage("Engineering Review", "Reject")).toBe("Rejected");
      expect(getNextApplicableECRStage("Procurement Review", "Reject")).toBe("Rejected");
    });
  });

  describe("review form configuration", () => {
    it("keeps Engineering Manager assessment fields", () => {
      const config = ECR_STAGE_WORKFLOW_MAP["Engineering Review"];
      expect(config?.decisionTitle).toBe("Engineering Review Decision");
      expect(config?.assessmentFields).toEqual([
        "Technical Feasibility",
        "Engineering Impact",
        "Technical Requirements",
      ]);
    });

    it("uses the exact Procurement Team assessment fields", () => {
      const config = ECR_STAGE_WORKFLOW_MAP["Procurement Review"];
      expect(config?.decisionTitle).toBe("Procurement Review Decision");
      expect(config?.assessmentFields).toEqual([
        "Procurement Assessment",
        "Supplier Requirement",
        "RFQ Requirement",
      ]);
      expect(config?.requiredAssessmentFields).toEqual([
        "Procurement Assessment",
        "Supplier Requirement",
        "RFQ Requirement",
      ]);
      expect(config?.commentsLabel).toBe("Review Comments");
    });
  });

  describe("workflow API parameter handling", () => {
    it("requires an ECR identifier", async () => {
      const { applyECRWorkflowAction } = await import("../../api/ecr");
      const result = await applyECRWorkflowAction("", "Approve");
      expect(result).toEqual({
        success: false,
        message: "Engineering Change Request is required.",
      });
    });
  });
});
