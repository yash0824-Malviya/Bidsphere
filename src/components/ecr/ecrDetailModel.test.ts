import { describe, expect, it } from "vitest";

import type { ECRApprovalRequirement, EngineeringChangeRequest } from "../../types/erpnext";
import {
  canCreateECRRFQ,
  getCurrentECRApprovalTask,
  getCurrentECRStageApprovalTask,
  getECRApprovalTimeline,
  getECRDecisionHistory,
  getECRProcurementStatus,
  getECRProcurementTraceability,
  getECRRFQReference,
  hasReachedECRApproval,
  isECRSupplierSourcingRequired,
  resolveApprovalTask,
} from "./ecrDetailModel";

function approval(
  role: string,
  status: ECRApprovalRequirement["status"],
  name = `${role}-${status}`,
): ECRApprovalRequirement {
  return { name, approval_role: role, status, required: 1 };
}

function record(
  stage: EngineeringChangeRequest["select_pxfp"],
  rows: ECRApprovalRequirement[] = [],
): Partial<EngineeringChangeRequest> {
  return { select_pxfp: stage, approval_requirements: rows };
}

describe("ECR detail presentation model", () => {
  it("resolves each action owner without cross-role access", () => {
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
    expect(resolveApprovalTask("RFQ Pending", "admin")?.canAct).toBe(false);
  });

  it("requires exactly one matching active task at every action stage", () => {
    const engineering = approval("Engineering Manager", "Pending");
    const team = approval("Procurement Team", "Pending");
    const manager = approval("Procurement Manager", "Pending");

    expect(getCurrentECRApprovalTask("Engineering Review", "engineering", [engineering]))
      .toBe(engineering);
    expect(getCurrentECRApprovalTask("Procurement Review", "procurement_team", [team]))
      .toBe(team);
    const punctuatedTeam = approval("Procurement-Team.", "Pending");
    expect(getCurrentECRApprovalTask(
      "Procurement Review",
      "Procurement Team.",
      [punctuatedTeam],
    )).toBe(punctuatedTeam);
    expect(getCurrentECRApprovalTask("RFQ Pending", "procurement", [manager]))
      .toBe(manager);
    expect(getCurrentECRStageApprovalTask("RFQ Pending", [manager])).toBe(manager);
    expect(getCurrentECRApprovalTask("Procurement Review", "procurement_team", [])).toBeNull();
    expect(getCurrentECRApprovalTask("Procurement Review", "procurement_team", [manager])).toBeNull();
    expect(getCurrentECRApprovalTask("Procurement Review", "procurement_team", [team, manager]))
      .toBeNull();
    expect(getCurrentECRApprovalTask(
      "Procurement Review",
      "procurement_team",
      [team, punctuatedTeam],
    )).toBeNull();
  });

  it("shows procurement only after Engineering Manager approval", () => {
    expect(hasReachedECRApproval("Engineering Review")).toBe(false);
    expect(hasReachedECRApproval("Procurement Review")).toBe(true);
    expect(hasReachedECRApproval("RFQ Pending")).toBe(true);
    expect(hasReachedECRApproval("RFQ")).toBe(true);
    expect(getECRProcurementStatus({ select_pxfp: "Engineering Review" })).toBe("Not Started");
    expect(getECRProcurementStatus({ select_pxfp: "Procurement Review" })).toBe("In Progress");
    expect(getECRProcurementStatus({ select_pxfp: "RFQ Pending" })).toBe("In Progress");
    expect(getECRProcurementStatus({ select_pxfp: "RFQ" })).toBe("Complete");
  });

  it("shows the compact approval, procurement, and RFQ trace", () => {
    const trace = getECRProcurementTraceability({
      select_pxfp: "RFQ Pending",
      supplier_response_required: "Yes",
    });
    expect(trace.map(({ label, status }) => [label, status])).toEqual([
      ["ECR Approval", "Completed"],
      ["Procurement", "Current"],
      ["RFQ", "Required"],
    ]);
  });

  it("derives supplier and RFQ requirements from persisted sourcing configuration", () => {
    expect(isECRSupplierSourcingRequired({ supplier_response_required: "Yes" })).toBe(true);
    expect(isECRSupplierSourcingRequired({ supplier_response_required: "No", supplier_impact: 1 })).toBe(true);
    expect(isECRSupplierSourcingRequired({
      select_pxfp: "Procurement Review",
      supplier_response_required: "No",
    })).toBe(false);
    const trace = getECRProcurementTraceability({
      select_pxfp: "Draft",
      supplier_response_required: "No",
    });
    expect(trace[2]).toEqual({ label: "RFQ", status: "Not Required" });
  });

  it("shows Create RFQ only for the manager at RFQ Pending with one manager task", () => {
    const managerTask = approval("Procurement Manager", "Pending");
    const managerRecord = record("RFQ Pending", [managerTask]);
    expect(canCreateECRRFQ("procurement", "RFQ Pending", managerRecord)).toBe(true);
    expect(canCreateECRRFQ("procurement_team", "RFQ Pending", managerRecord)).toBe(false);
    expect(canCreateECRRFQ("engineering", "RFQ Pending", managerRecord)).toBe(false);
    expect(canCreateECRRFQ("admin", "RFQ Pending", managerRecord)).toBe(false);
    expect(canCreateECRRFQ("procurement", "Procurement Review", managerRecord)).toBe(false);
    expect(canCreateECRRFQ("procurement", "RFQ Pending", record("RFQ Pending"))).toBe(false);
    expect(canCreateECRRFQ("procurement", "RFQ Pending", record("RFQ Pending", [
      managerTask,
      approval("Procurement Team", "Pending"),
    ]))).toBe(false);
    expect(canCreateECRRFQ("procurement", "RFQ Pending", {
      ...managerRecord,
      rfq: "RFQ-1",
    })).toBe(false);
  });

  it("uses only the downstream RFQ link as synchronized completion evidence", () => {
    expect(getECRRFQReference({ rfq: "RFQ-NEW" })).toBe("RFQ-NEW");
    expect(getECRRFQReference({
      procurement_reference_type: "RFQ",
      existing_rfq_reference: "RFQ-EXISTING",
    })).toBeNull();
  });

  it("shows all sequential gates with exactly one current gate", () => {
    const timeline = getECRApprovalTimeline("Procurement Review", [
      approval("Engineering Manager", "Approved"),
      approval("Procurement Team", "Pending"),
    ]);
    expect(timeline.map((item) => item.stage)).toEqual([
      "Engineering Review",
      "Procurement Review",
      "RFQ Pending",
    ]);
    expect(timeline.map((item) => item.state)).toEqual([
      "completed",
      "current",
      "upcoming",
    ]);
  });

  it("preserves completed decisions from every workflow owner", () => {
    const engineering = approval("Engineering Manager", "Approved");
    const teamSentBack = approval("Procurement Team", "Sent Back");
    const teamApproved = approval("Procurement Team", "Approved", "team-approved-second-cycle");
    const managerCompleted = approval("Procurement Manager", "Completed");
    expect(getECRDecisionHistory([
      engineering,
      teamSentBack,
      teamApproved,
      managerCompleted,
      approval("Operations Manager", "Approved"),
      approval("Procurement Manager", "Pending"),
    ])).toEqual([engineering, teamSentBack, teamApproved, managerCompleted]);
  });
});
