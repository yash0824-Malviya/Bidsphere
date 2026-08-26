import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ECRApprovalRequirement } from "../../types/erpnext";
import ECRApprovalPanel from "./ECRApprovalPanel";

function pendingTask(role: string): ECRApprovalRequirement {
  return {
    name: `TASK-${role}`,
    approval_role: role,
    status: "Pending",
    required: 1,
  };
}

function renderPanel(
  role: "engineer" | "engineering" | "procurement_team" | "procurement",
  status: string,
  approvalRequirements: ECRApprovalRequirement[],
) {
  return renderToStaticMarkup(
    <ECRApprovalPanel
      role={role}
      status={status}
      approvalRequirements={approvalRequirements}
      onAction={() => undefined}
    />,
  );
}

describe("ECRApprovalPanel", () => {
  it("renders the Engineering Manager decision without RFQ creation", () => {
    const markup = renderPanel(
      "engineering",
      "Engineering Review",
      [pendingTask("Engineering Manager")],
    );
    expect(markup).toContain("ENGINEERING REVIEW — ACTION REQUIRED");
    expect(markup).toContain("Engineering Review Decision");
    expect(markup).toContain("Send Back");
    expect(markup).toContain("Reject");
    expect(markup).toContain("Approve");
    expect(markup).not.toContain("Create RFQ");
  });

  it("renders the exact Procurement Team review form and never Create RFQ", () => {
    const markup = renderPanel(
      "procurement_team",
      "Procurement Review",
      [pendingTask("Procurement Team")],
    );
    expect(markup).toContain("PROCUREMENT REVIEW — ACTION REQUIRED");
    expect(markup).toContain("Procurement Review Decision");
    expect(markup).toContain("Procurement Assessment *");
    expect(markup).toContain("Supplier Requirement *");
    expect(markup).toContain("RFQ Requirement *");
    expect(markup).toContain("Review Comments");
    expect(markup).toContain('id="ecr-review-procurement-assessment"');
    expect(markup).toContain('id="ecr-review-supplier-requirement"');
    expect(markup).toContain('<option value="Yes">Yes</option>');
    expect(markup).toContain('<option value="No">No</option>');
    expect(markup).toContain('id="ecr-review-rfq-requirement"');
    expect(markup).toContain('<option value="Required">Required</option>');
    expect(markup).toContain('<option value="Not Required">Not Required</option>');
    expect(markup).toContain('id="ecr-review-comments"');
    expect(markup).toContain("Send Back");
    expect(markup).toContain("Reject");
    expect(markup).toContain("Approve");
    expect(markup).not.toContain("Create RFQ");
    expect(markup).not.toContain("Procurement Comments");
  });

  it("accepts punctuation-normalized Procurement Team tasks without broadening role access", () => {
    const markup = renderPanel(
      "procurement_team",
      "Procurement Review",
      [pendingTask("Procurement-Team.")],
    );
    expect(markup).toContain("PROCUREMENT REVIEW — ACTION REQUIRED");
    expect(markup).not.toContain("Create RFQ");
    expect(renderPanel(
      "procurement",
      "Procurement Review",
      [pendingTask("Procurement-Team.")],
    )).toBe("");
  });

  it("renders no decision form for Engineer or Procurement Manager", () => {
    expect(renderPanel(
      "engineer",
      "Engineering Review",
      [pendingTask("Engineering Manager")],
    )).toBe("");
    expect(renderPanel(
      "procurement",
      "RFQ Pending",
      [pendingTask("Procurement Manager")],
    )).toBe("");
  });

  it("fails closed when the active task is missing, duplicated, or belongs to another role", () => {
    expect(renderPanel("procurement_team", "Procurement Review", [])).toBe("");
    expect(renderPanel(
      "procurement_team",
      "Procurement Review",
      [pendingTask("Procurement Manager")],
    )).toBe("");
    expect(renderPanel(
      "procurement_team",
      "Procurement Review",
      [pendingTask("Procurement Team"), pendingTask("Procurement Team")],
    )).toBe("");
  });
});
