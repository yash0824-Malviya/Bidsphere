import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { EngineeringChangeRequest, ECRApprovalRequirement } from "../types/erpnext";
import {
  canonicalECRStage, getApplicableECRWorkflowStages, getECRWorkflowActions,
  getNextApplicableECRStage, getECRStatusCardInfo, canApproveECR,
} from "./ecrRoles";
import { getNavGroupsForRole, canAccessPath } from "./roles";
import { getECRCurrentStage, isPendingApprovalForRole, getECRListActionRoute, matchesECRQueueFilter } from "./ecrQueues";
import { canCreateECRRFQ, getECRApprovalTimeline, getECRDecisionHistory, getECRProcurementStatus } from "../components/ecr/ecrDetailModel";
import { getECRWorkflowActiveIndex } from "../components/ecr/ecrWorkflowPresentation";
import ECRApprovalPanel from "../components/ecr/ECRApprovalPanel";
import ECRApprovalHistory from "../components/ecr/ECRApprovalHistory";
import { extendedReviewDashboardCards, getRoleDashboardQueue } from "../components/ecr/dashboards/RoleECRDashboard";

const owner = { role: "engineer", email: "engineer@example.com" };
function task(role: string, status: ECRApprovalRequirement["status"] = "Pending", stage?: string): ECRApprovalRequirement {
  return { name: `TASK-${role}-${stage}`, approval_role: role, required: 1, status, comments: stage ? `[Stage: ${stage}]\nReviewed` : "" };
}
function record(stage: EngineeringChangeRequest["select_pxfp"], role?: string, extra: Partial<EngineeringChangeRequest> = {}): EngineeringChangeRequest {
  return {
    name: "ECR-2026-12345", ecr_number: "ECR-2026-12345", ecr_title: "Bracket change", ecr_type: "Part Change",
    priority: "High", ecr_owner: owner.email, requesting_department: "Engineering", plant: "Main",
    target_implementation_date: "2026-10-01", chnage_description: "Change bracket", reason_for_change: "Durability",
    select_pxfp: stage, ecr_workflow_version: "extended_v1", cost_impact: 1, quality_impact: 1,
    approval_requirements: role ? [task(role)] : [], ...extra,
  };
}

describe("extended ECR workflow preserves version boundaries", () => {
  it("routes legacy and extended engineering approvals to their own next stages", () => {
    const ecr = record("Engineering Review", "Engineering Manager");
    expect(getNextApplicableECRStage(ecr.select_pxfp, "Approve", ecr)).toBe("Technical Approved");
    expect(getNextApplicableECRStage(ecr.select_pxfp, "Approve")).toBe("Procurement Review");
    expect(canonicalECRStage("Quality Review")).toBe("Procurement Review");
    expect(canonicalECRStage("Quality Review", ecr)).toBe("Quality Review");
    expect(getECRCurrentStage("ECR Approved", ecr)).toBe("ECR Approved");
    expect(getECRWorkflowActions("engineering", ecr.select_pxfp, ecr).at(-1)?.label).toBe("Technical Approval");
  });

  it("never exposes generic ECR approval actions for Business Case reviews", () => {
    for (const [stage, role] of [["Finance Review", "finance"], ["Procurement BC Review", "procurement"], ["Quality Review", "quality"]] as const) {
      const ecr = record(stage);
      expect(getECRWorkflowActions(role, stage, ecr)).toEqual([]);
      expect(canApproveECR(role, ecr)).toBe(false);
      expect(getNextApplicableECRStage(stage, "Approve", ecr)).toBe(stage);
      expect(renderToStaticMarkup(createElement(ECRApprovalPanel, { role, status: stage, ecr, onAction: () => {} }))).toBe("");
    }
    expect(getECRWorkflowActions("procurement_team", "Procurement Review", record("Procurement Review"))).toEqual([]);
  });

  it("limits final ECR actions to Program Manager with a persisted current task", () => {
    const ecr = record("Final ECR Approval", "Program Manager");
    expect(canApproveECR("program_manager", ecr)).toBe(true);
    expect(getECRWorkflowActions("admin", ecr.select_pxfp, ecr)).toEqual([]);
    expect(getECRWorkflowActions("engineering", ecr.select_pxfp, ecr)).toEqual([]);
    expect(isPendingApprovalForRole("program_manager", ecr)).toBe(true);
    const markup = renderToStaticMarkup(createElement(ECRApprovalPanel, { role: "program_manager", status: ecr.select_pxfp, ecr, approvalRequirements: ecr.approval_requirements, onAction: () => {} }));
    expect(markup).toContain("Approve ECR");
    expect(renderToStaticMarkup(createElement(ECRApprovalPanel, { role: "program_manager", status: ecr.select_pxfp, ecr, onAction: () => {} }))).toBe("");
    expect(getECRWorkflowActions("program_manager", "Business Case Approved", ecr)[0]?.action).toBe("Start Final Review");
  });

  it("prevents early, unassigned, duplicate-task and No-decision RFQ creation", () => {
    const ecr = record("Procurement Decision", "Procurement Manager", { rfq_required: "Yes" });
    expect(canCreateECRRFQ("procurement", ecr.select_pxfp, ecr)).toBe(true);
    for (const changed of [
      { ...ecr, select_pxfp: "ECR Approved" as const },
      { ...ecr, rfq_required: "No" as const },
      { ...ecr, approval_requirements: [] },
      { ...ecr, approval_requirements: [task("Procurement Manager"), task("Quality Manager")] },
      { ...ecr, rfq: "RFQ-1" },
    ]) expect(canCreateECRRFQ("procurement", changed.select_pxfp, changed)).toBe(false);
    expect(canCreateECRRFQ("procurement_team", ecr.select_pxfp, ecr)).toBe(false);
    expect(canCreateECRRFQ("procurement", "RFQ Pending", { ...ecr, ecr_workflow_version: undefined })).toBe(true);
  });

  it("excludes conditional reviews from progress and marks them Not Required in history", () => {
    const ecr = record("Procurement BC Review", "Procurement Manager", { cost_impact: 0, quality_impact: 0 });
    const stages = getApplicableECRWorkflowStages(ecr).map((stage) => stage.id);
    expect(stages).not.toContain("Finance Review");
    expect(stages).not.toContain("Quality Review");
    expect(stages).toContain("Procurement BC Review");
    expect(getECRWorkflowActiveIndex(ecr.select_pxfp, undefined, ecr)).toBe(stages.indexOf("Procurement BC Review"));
    const timeline = getECRApprovalTimeline(ecr.select_pxfp, ecr.approval_requirements, ecr);
    expect(timeline.find((row) => row.stage === "Finance Review")?.state).toBe("skipped");
    expect(timeline.find((row) => row.stage === "Quality Review")?.state).toBe("skipped");
    expect(timeline.find((row) => row.stage === "Procurement BC Review")?.state).toBe("current");
  });

  it("keeps individual review decisions distinct when the same role acts again", () => {
    const rows = [task("Finance Manager", "Approved", "Finance Review"), task("Procurement Manager", "Approved", "Procurement BC Review"), task("Quality Manager", "Approved", "Quality Review"), task("Program Manager")];
    const ecr = record("Final ECR Approval", undefined, { approval_requirements: rows });
    const timeline = getECRApprovalTimeline(ecr.select_pxfp, rows, ecr);
    expect(timeline.find((row) => row.stage === "Procurement BC Review")?.state).toBe("completed");
    expect(timeline.find((row) => row.stage === "ECR Approved")?.state).toBe("upcoming");
    expect(timeline.find((row) => row.stage === "Final ECR Approval")?.state).toBe("current");
    expect(timeline.find((row) => row.stage === "Business Case Approved")?.state).toBe("completed");
    expect(timeline.find((row) => row.stage === "Business Case Approved")?.decision).toBeUndefined();
    expect(getECRDecisionHistory(rows, ecr)).toHaveLength(3);
  });

  it("shows Business Case submission from its saved history without inventing an Engineer approval", () => {
    const ecr = record("Finance Review", "Finance Manager");
    ecr.ecr_business_case = JSON.stringify({
      name: "BC-ECR-2026-12345", ecr_reference: ecr.name, status: "Finance Review",
      history: [{ action: "submit", role: "engineer", actor: owner.email, timestamp: "2026-09-15 10:00:00", comment: "Ready for review" }],
    });
    const timeline = getECRApprovalTimeline(ecr.select_pxfp, ecr.approval_requirements, ecr);
    expect(timeline.find((item) => item.stage === "Technical Approved")).toMatchObject({
      state: "completed", action: { label: "Business Case Submitted", actor: owner.email }, inferred: false,
    });
    expect(timeline.find((item) => item.stage === "Technical Approved")?.decision).toBeUndefined();
    expect(getECRDecisionHistory(ecr.approval_requirements, ecr)).toEqual([]);
    const markup = renderToStaticMarkup(createElement(ECRApprovalHistory, { status: ecr.select_pxfp, ecr }));
    expect(markup).toContain("Business Case Submitted");
    expect(markup).toContain(owner.email);
    expect(markup).not.toContain("Engineer · Approved");

    const returned = { ...ecr, select_pxfp: "Technical Approved" as const, approval_requirements: [task("Engineer")] };
    expect(getECRApprovalTimeline(returned.select_pxfp, returned.approval_requirements, returned)
      .find((item) => item.stage === "Technical Approved")?.state).toBe("current");
    const mismatched = { ...ecr, name: "another-ecr" };
    expect(getECRApprovalTimeline(mismatched.select_pxfp, mismatched.approval_requirements, mismatched)
      .find((item) => item.stage === "Technical Approved")?.state).toBe("upcoming");
  });

  it("uses saved RFQ choice for procurement action history without marking a review approved", () => {
    const ecr = record("Procurement Decision", "Procurement Manager", { rfq_required: "Yes", rfq_decision_reason: "Collect supplier bids" });
    const timeline = getECRApprovalTimeline(ecr.select_pxfp, ecr.approval_requirements, ecr);
    expect(timeline.find((item) => item.stage === "ECR Approved")).toMatchObject({
      state: "completed", action: { label: "Decision Recorded", comment: expect.stringContaining("Collect supplier bids") },
    });
    expect(timeline.find((item) => item.stage === "ECR Approved")?.decision).toBeUndefined();
    expect(timeline.find((item) => item.stage === "Final ECR Approval")?.state).toBe("upcoming");
    expect(timeline.find((item) => item.stage === "Procurement Decision")?.state).toBe("current");
    expect(getECRDecisionHistory(ecr.approval_requirements, ecr)).toEqual([]);
    const missingDecision = { ...ecr, rfq_decision_reason: "" };
    expect(getECRApprovalTimeline(missingDecision.select_pxfp, missingDecision.approval_requirements, missingDecision)
      .find((item) => item.stage === "ECR Approved")?.state).toBe("upcoming");
  });

  it("assigns each review queue to the correct role and only a required single task", () => {
    for (const [stage, role, label] of [["Finance Review", "finance", "Finance Manager"], ["Quality Review", "quality", "Quality Manager"], ["Procurement BC Review", "procurement", "Procurement Manager"], ["Business Case Approved", "program_manager", "Program Manager"]] as const) {
      const ecr = record(stage, label);
      expect(isPendingApprovalForRole(role, ecr)).toBe(true);
      expect(isPendingApprovalForRole("procurement_team", ecr)).toBe(false);
      expect(isPendingApprovalForRole(role, { ...ecr, approval_requirements: [] })).toBe(false);
    }
    expect(isPendingApprovalForRole("quality", { ...record("Quality Review", "Quality Manager"), ecr_workflow_version: undefined })).toBe(false);
  });

  it("sends engineering preparation and Business Case reviews to the linked form", () => {
    const ecr = record("Technical Approved");
    expect(matchesECRQueueFilter("business-case-preparation", "engineer", ecr, owner)).toBe(true);
    expect(matchesECRQueueFilter("business-case-preparation", "engineer", ecr, { email: "another@example.com" })).toBe(false);
    expect(getECRListActionRoute("engineer", ecr, owner)).toBe("/ecr/ECR-2026-12345/business-case");
    expect(getECRListActionRoute("finance", record("Finance Review", "Finance Manager"))).toContain("/business-case");
  });

  it("shows procurement decision and final review workload while preserving finance navigation", () => {
    const decision = record("ECR Approved", "Procurement Manager");
    expect(getRoleDashboardQueue("procurement", [decision], null)).toEqual([decision]);
    expect(matchesECRQueueFilter("rfq-pending", "procurement", decision)).toBe(false);
    expect(getECRStatusCardInfo(decision.select_pxfp, decision).actionValue).toBe("Record Procurement Decision");
    const finance = record("Finance Review", "Finance Manager");
    expect(extendedReviewDashboardCards("finance", [finance])[0].value).toBe(1);
    const items = getNavGroupsForRole("finance").flatMap((group) => group.items);
    expect(items.some((item) => item.label === "Engineering Changes")).toBe(true);
    expect(items.some((item) => item.label === "Budget")).toBe(true);
    expect(canAccessPath("finance", "/ecr/ECR-1/business-case")).toBe(true);
    expect(canAccessPath("finance_executive", "/ecr/ECR-1/business-case")).toBe(false);
    expect(canAccessPath("finance", "/ecr/new")).toBe(false);
  });

  it("completes No-RFQ records without displaying sourcing as pending", () => {
    const ecr = record("Closed", undefined, { rfq_required: "No" });
    expect(getECRProcurementStatus(ecr)).toBe("Complete");
    expect(getApplicableECRWorkflowStages(ecr).at(-1)?.id).toBe("Closed");
    expect(getApplicableECRWorkflowStages(ecr).some((stage) => stage.id === "RFQ")).toBe(false);
    expect(matchesECRQueueFilter("closed", "procurement", ecr)).toBe(true);
  });
});
