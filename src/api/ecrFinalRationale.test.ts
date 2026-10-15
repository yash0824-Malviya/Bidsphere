import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineeringChangeRequest } from "../types/erpnext";

const mock = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock("./erpnext", () => ({
  apiPost: mock.post, apiGet: mock.get, apiPut: vi.fn(), buildResourceUrl: vi.fn(), withSilent: () => ({}),
  extractErpNextErrorMessage: () => "",
  withoutNetworkRetry: () => ({ _disableNetworkRetry: true }),
}));
import { applyECRWorkflowAction } from "./ecr";

const ecr: EngineeringChangeRequest = {
  name: "internal-ecr-100010", ecr_number: "ECR-2026-100010", ecr_title: "Latch improvement",
  priority: "High", requesting_department: "Engineering", plant: "Plant 1", target_implementation_date: "2026-10-01",
  chnage_description: "Strengthen latch", reason_for_change: "Durability", ecr_workflow_version: "extended_v1",
  select_pxfp: "Final ECR Approval", docstatus: 0, modified: "2026-09-15 18:00:00",
  approval_requirements: [{ name: "final-task", approval_role: "Program Manager", required: 1, status: "Pending" }],
};

describe("Final ECR rationale transport", () => {
  beforeEach(() => { vi.clearAllMocks(); mock.post.mockResolvedValue({ success: true, newStatus: "ECR Approved" }); });

  it.each(["Approve ECR", "Reject"])("sends %s with the existing rationale field, separate comment and saved revision", async (action) => {
    await applyECRWorkflowAction(ecr.name, action, "  General review note  ", ecr, { "Final Decision Rationale": "Approved case and technical evidence support the decision." });
    expect(mock.post).toHaveBeenCalledExactlyOnceWith("/api/ecr-workflow-action", {
      name: ecr.name, ecr_name: ecr.name, ecrId: ecr.name, ecr_number: ecr.ecr_number, expected_modified: ecr.modified,
      action, comment: "General review note", reviewFields: { "Final Decision Rationale": "Approved case and technical evidence support the decision." },
    }, { _disableNetworkRetry: true });
    expect(mock.post.mock.calls[0][1]).not.toHaveProperty("final_decision_rationale");
    expect(mock.get).not.toHaveBeenCalled();
  });

  it("sends Send Back correction comments without requiring a rationale in the request", async () => {
    await applyECRWorkflowAction(ecr.name, "Send Back", "Revise volume assumptions.", ecr, { "Final Decision Rationale": "" });
    expect(mock.post.mock.calls[0][1]).toMatchObject({ action: "Send Back", comment: "Revise volume assumptions.", reviewFields: { "Final Decision Rationale": "" } });
  });

  it("returns server errors without rewriting the caller's rationale or comments", async () => {
    const reviewFields = { "Final Decision Rationale": "Evidence supports approval." };
    mock.post.mockRejectedValueOnce(new Error("Final Decision Rationale is required."));
    const result = await applyECRWorkflowAction(ecr.name, "Approve ECR", "Timing note", ecr, reviewFields);
    expect(result).toEqual({ success: false, message: "Final Decision Rationale is required." });
    expect(reviewFields).toEqual({ "Final Decision Rationale": "Evidence supports approval." });
    expect(mock.post).toHaveBeenCalledTimes(1);
  });

  it("keeps the legacy review request free of extended rationale fields and version locking", async () => {
    const legacy = { ...ecr, ecr_workflow_version: undefined, select_pxfp: "Engineering Review" };
    await applyECRWorkflowAction(legacy.name, "Approve", "Legacy note", legacy, { "Technical Feasibility": "Feasible", "Engineering Impact": "No interface change" });
    expect(mock.post.mock.calls[0][1]).not.toHaveProperty("expected_modified");
    expect(mock.post.mock.calls[0][1].reviewFields).toEqual({ "Technical Feasibility": "Feasible", "Engineering Impact": "No interface change" });
  });
});
