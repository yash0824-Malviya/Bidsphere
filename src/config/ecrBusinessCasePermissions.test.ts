import { describe, expect, it } from "vitest";
import { emptyECRBusinessCasePayload, type ECRBusinessCase } from "../types/ecrBusinessCase";
import type { ECRApprovalRequirement, EngineeringChangeRequest } from "../types/erpnext";
import { getECRBusinessCaseReviewRole } from "./ecrBusinessCasePermissions";

function fixture(stage: "Finance Review" | "Procurement BC Review" | "Quality Review" = "Finance Review") {
  const reviewer = stage === "Finance Review" ? "Finance Manager" : stage === "Quality Review" ? "Quality Manager" : "Procurement Manager";
  const ecr = {
    name: "ECR-1", docstatus: 0, modified: "current", select_pxfp: stage, ecr_workflow_version: "extended_v1",
    approval_requirements: [{ name: "current-task", approval_role: reviewer, required: 1, status: "Pending" }],
  } as EngineeringChangeRequest;
  const businessCase: ECRBusinessCase & { finance_required: boolean } = {
    ...emptyECRBusinessCasePayload(), name: "BC-1", business_case_id: "BC-1", ecr_reference: ecr.name, status: stage,
    expected_annual_savings: 0, roi: null, payback_period: null, finance_required: true,
    finance_status: stage === "Finance Review" ? "Pending" : "Approved",
    procurement_status: stage === "Quality Review" ? "Approved" : "Pending", quality_status: "Pending",
    created_by: "engineer@example.com", creation: "before", modified: "current",
  };
  return { ecr, businessCase };
}

describe("ECR Business Case reviewer permissions", () => {
  it.each([
    ["Finance Review", "finance"], ["Procurement BC Review", "procurement"], ["Quality Review", "quality"],
  ] as const)("enables only the assigned %s reviewer", (stage, role) => {
    const { ecr, businessCase } = fixture(stage);
    expect(getECRBusinessCaseReviewRole(role, ecr, businessCase)).toBe(role);
    for (const otherRole of ["admin", "engineer", "engineering", "program_manager", "procurement_team", "finance", "quality", "procurement"].filter((other) => other !== role)) {
      expect(getECRBusinessCaseReviewRole(otherRole, ecr, businessCase)).toBeNull();
    }
  });

  it("requires exactly one matching required Pending task", () => {
    const { ecr, businessCase } = fixture();
    const invalidRows: ECRApprovalRequirement[][] = [
      [],
      [{ name: "wrong-role-task", approval_role: "Quality Manager", required: 1, status: "Pending" }],
      [{ name: "optional-task", approval_role: "Finance Manager", required: 0, status: "Pending" }],
      [{ name: "approved-task", approval_role: "Finance Manager", required: 1, status: "Approved" }],
      [...ecr.approval_requirements!, { ...ecr.approval_requirements![0], name: "second-task" }],
    ];
    for (const rows of invalidRows) expect(getECRBusinessCaseReviewRole("finance", { ...ecr, approval_requirements: rows }, businessCase)).toBeNull();
  });

  it("requires a live draft and a matching pending Business Case", () => {
    const { ecr, businessCase } = fixture();
    expect(getECRBusinessCaseReviewRole("finance", { ...ecr, docstatus: 1 }, businessCase)).toBeNull();
    expect(getECRBusinessCaseReviewRole("finance", { ...ecr, docstatus: 2 }, businessCase)).toBeNull();
    expect(getECRBusinessCaseReviewRole("finance", ecr, null)).toBeNull();
    expect(getECRBusinessCaseReviewRole("finance", ecr, { ...businessCase, ecr_reference: "ECR-OTHER" })).toBeNull();
    expect(getECRBusinessCaseReviewRole("finance", ecr, { ...businessCase, status: "Draft" })).toBeNull();
    for (const finance_status of ["Approved", "Rejected", "Sent Back", "Not Required"] as const) {
      expect(getECRBusinessCaseReviewRole("finance", ecr, { ...businessCase, finance_status })).toBeNull();
    }
  });

  it("requires earlier Finance and Procurement approvals before later review", () => {
    const procurement = fixture("Procurement BC Review");
    procurement.businessCase.finance_status = "Pending";
    expect(getECRBusinessCaseReviewRole("procurement", procurement.ecr, procurement.businessCase)).toBeNull();
    procurement.businessCase.finance_required = false;
    procurement.businessCase.finance_status = "Not Required";
    expect(getECRBusinessCaseReviewRole("procurement", procurement.ecr, procurement.businessCase)).toBe("procurement");
    const quality = fixture("Quality Review");
    quality.businessCase.procurement_status = "Pending";
    expect(getECRBusinessCaseReviewRole("quality", quality.ecr, quality.businessCase)).toBeNull();
  });

  it.each([undefined, "", "legacy"])("never enables Business Case decisions for legacy version %s", (version) => {
    const { ecr, businessCase } = fixture();
    expect(getECRBusinessCaseReviewRole("finance", { ...ecr, ecr_workflow_version: version }, businessCase)).toBeNull();
  });
});
