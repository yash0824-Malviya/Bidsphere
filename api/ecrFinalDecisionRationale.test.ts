import { describe, expect, it, vi } from "vitest";
import {
  applyEcrWorkflowActionCore,
  EcrWorkflowError,
  type ApplyEcrWorkflowInput,
  type EcrWorkflowDependencies,
  type EcrWorkflowDocument,
  type InternalEcrPrincipal,
} from "./ecrWorkflowCore";

const TIMESTAMP = "2026-09-15 18:00:00";
const RATIONALE = "The reviewed technical and business benefits justify this decision.";
const COMMENT = "The reviewer recorded a separate follow-up observation.";
function principal(role: InternalEcrPrincipal["role"] = "program_manager"): InternalEcrPrincipal {
  return { typ: "internal", role, email: `${role}@test.com`, sub: `${role}@test.com`, iat: 1, exp: 9999999999 };
}

function finalReview(extra: Partial<EcrWorkflowDocument> = {}) {
  let stored: EcrWorkflowDocument = {
    name: "ECR-FINAL-1", modified: "1", docstatus: 0,
    ecr_workflow_version: "extended_v1", ecr_owner: "engineer@test.com", owner: "engineer@test.com",
    select_pxfp: "Final ECR Approval", status: "Final ECR Approval", cost_impact: 1, quality_impact: 1,
    supplier_response_required: "No", procurement_reference_type: "None",
    ecr_business_case: JSON.stringify({
      name: "BC-ECR-FINAL-1", ecr_reference: "ECR-FINAL-1", status: "Approved",
      finance_status: "Approved", procurement_status: "Approved", quality_status: "Approved",
      problem_statement: "A durable improvement is needed", history: [{ action: "approve", role: "quality", comment: "Quality accepted" }],
    }),
    approval_requirements: [
      { name: "TECH-APPROVED", approval_role: "Engineering Manager", status: "Approved", required: 1, comments: "Technical assessment accepted" },
      { name: "FINAL-PENDING", approval_role: "Program Manager", status: "Pending", required: 1 },
    ],
    ...extra,
  };
  const dependencies: EcrWorkflowDependencies = {
    loadEcr: vi.fn(async () => structuredClone(stored)),
    loadProcurementDocument: vi.fn(),
    commitWorkflowDocument: vi.fn(async (document) => {
      if (document.modified !== stored.modified) throw new EcrWorkflowError("Concurrent update", 409, "conflict");
      for (const row of document.approval_requirements ?? []) {
        if (!["Pending", "Approved", "Rejected", "Sent Back"].includes(String(row.status))) throw new Error("Unsupported approval status");
      }
      stored = { ...structuredClone(document), modified: String(Number(stored.modified) + 1) };
      return structuredClone(stored);
    }),
    addTimelineComment: vi.fn(async () => undefined), now: () => TIMESTAMP,
  };
  return {
    dependencies, read: () => structuredClone(stored),
    act: (action: string, input: Partial<ApplyEcrWorkflowInput> = {}) => applyEcrWorkflowActionCore({
      name: stored.name, action, principal: principal(), expected_modified: stored.modified, ...input,
    }, dependencies),
  };
}

describe("Final ECR decision rationale", () => {
  it.each(["Approve ECR", "Reject ECR"])("requires a dedicated rationale for %s even when review comments are supplied", async (action) => {
    for (const value of [undefined, null, "", "  \n "]) {
      const m = finalReview();
      const before = m.read();
      await expect(m.act(action, { comment: COMMENT, reviewFields: { "Final Decision Rationale": value } })).rejects.toMatchObject({
        status: 422, fieldErrors: { "Final Decision Rationale": expect.any(String) },
      });
      expect(m.dependencies.commitWorkflowDocument).not.toHaveBeenCalled();
      expect(m.dependencies.addTimelineComment).not.toHaveBeenCalled();
      expect(m.read()).toEqual(before);
    }
  });

  it.each(["Approve ECR", "Reject ECR", "Send Back ECR"])("rejects malformed or overlong supplied rationale for %s", async (action) => {
    for (const value of [123, true, { rationale: RATIONALE }, [RATIONALE], "x".repeat(2001)]) {
      const m = finalReview();
      await expect(m.act(action, { comment: COMMENT, reviewFields: { "Final Decision Rationale": value } })).rejects.toMatchObject({ status: 422 });
      expect(m.dependencies.commitWorkflowDocument).not.toHaveBeenCalled();
      expect(m.dependencies.addTimelineComment).not.toHaveBeenCalled();
    }
  });

  it("does not substitute differently named fields or generic review comments for the established rationale key", async () => {
    const m = finalReview();
    await expect(m.act("Approve ECR", {
      comment: RATIONALE,
      reviewFields: { final_decision_rationale: RATIONALE, finalDecisionRationale: RATIONALE },
    })).rejects.toMatchObject({ status: 422, fieldErrors: { "Final Decision Rationale": expect.any(String) } });
    expect(m.dependencies.commitWorkflowDocument).not.toHaveBeenCalled();
  });

  it.each([
    { action: "Approve ECR", outcome: "Approved", nextStatus: "ECR Approved", nextRole: "Procurement Manager" },
    { action: "Reject ECR", outcome: "Rejected", nextStatus: "Rejected", nextRole: null },
    { action: "Send Back ECR", outcome: "Sent Back", nextStatus: "Technical Approved", nextRole: "Engineer" },
  ])("persists separate rationale and comments in the approval audit for $action", async ({ action, outcome, nextStatus, nextRole }) => {
    const m = finalReview();
    const before = m.read();
    const result = await m.act(action, {
      comment: ` ${COMMENT} `,
      reviewFields: { "Final Decision Rationale": `  ${RATIONALE}  ` },
    });
    expect(result).toMatchObject({ success: true, newStatus: nextStatus });
    const stored = m.read();
    expect(stored).toMatchObject({ select_pxfp: nextStatus, status: nextStatus, docstatus: 0, ecr_workflow_version: "extended_v1" });
    expect(stored.approval_requirements).toEqual(expect.arrayContaining([
      before.approval_requirements![0],
      expect.objectContaining({
        name: "FINAL-PENDING", approval_role: "Program Manager", status: outcome, required: 1,
        approver: "program_manager@test.com", approval_date: TIMESTAMP,
        comments: `[Stage: Final ECR Approval]\nFinal Decision Rationale: ${RATIONALE}\nReview Comments: ${COMMENT}`,
      }),
    ]));
    const pending = stored.approval_requirements?.filter((row) => row.status === "Pending");
    expect(pending).toEqual(nextRole ? [expect.objectContaining({ approval_role: nextRole, required: 1 })] : []);
    if (nextRole === "Engineer") expect(pending?.[0].approver).toBe("engineer@test.com");
    expect(m.dependencies.addTimelineComment).toHaveBeenCalledExactlyOnceWith(stored.name, `${action}\nFinal Decision Rationale: ${RATIONALE}\nReview Comments: ${COMMENT}`);
    expect(await m.dependencies.loadEcr(stored.name)).toEqual(stored);
    if (action === "Send Back ECR") {
      expect(JSON.parse(stored.ecr_business_case!)).toMatchObject({ status: "Sent Back", problem_statement: "A durable improvement is needed" });
      expect(JSON.parse(stored.ecr_business_case!).history).toEqual([
        ...JSON.parse(before.ecr_business_case!).history,
        expect.objectContaining({ action: "send_back", role: "program_manager", actor: "program_manager@test.com", timestamp: TIMESTAMP, comment: COMMENT, from_status: "Approved", to_status: "Sent Back" }),
      ]);
    } else {
      expect(stored.ecr_business_case).toBe(before.ecr_business_case);
    }
  });

  it("allows Send Back with only its required review comment", async () => {
    const m = finalReview();
    await expect(m.act("Send Back ECR", { comment: COMMENT })).resolves.toMatchObject({ newStatus: "Technical Approved" });
    const audit = m.read().approval_requirements?.find((row) => row.name === "FINAL-PENDING");
    expect(audit?.comments).toBe(`[Stage: Final ECR Approval]\nReview Comments: ${COMMENT}`);
    expect(audit?.comments).not.toContain("Final Decision Rationale:");
  });

  it.each(["Reject ECR", "Send Back ECR"])("retains the separate review-comment requirement for %s", async (action) => {
    const m = finalReview();
    await expect(m.act(action, { reviewFields: { "Final Decision Rationale": RATIONALE } })).rejects.toMatchObject({ status: 422, message: expect.stringContaining("Review comments are required") });
    expect(m.dependencies.commitWorkflowDocument).not.toHaveBeenCalled();
  });

  it("accepts the existing maximum rationale length without requiring optional approval comments", async () => {
    const m = finalReview();
    await expect(m.act("Approve ECR", { reviewFields: { "Final Decision Rationale": "x".repeat(2000) } })).resolves.toMatchObject({ newStatus: "ECR Approved" });
    expect(m.read().approval_requirements?.find((row) => row.name === "FINAL-PENDING")?.comments).toBe(`[Stage: Final ECR Approval]\nFinal Decision Rationale: ${"x".repeat(2000)}`);
  });

  it.each([
    { action: "Approve", nextStatus: "Procurement Review" },
    { action: "Reject", nextStatus: "Rejected" },
    { action: "Send Back", nextStatus: "Draft" },
  ])("preserves legacy Engineering Review $action without requiring final rationale", async ({ action, nextStatus }) => {
    const m = finalReview({
      ecr_workflow_version: undefined, ecr_business_case: undefined,
      select_pxfp: "Engineering Review", status: "Engineering Review",
      approval_requirements: [{ name: "LEGACY-PENDING", approval_role: "Engineering Manager", status: "Pending", required: 1 }],
    });
    await expect(m.act(action, {
      principal: principal("engineering"), comment: COMMENT,
      reviewFields: { "Technical Feasibility": "Feasible", "Engineering Impact": "Reviewed" },
    })).resolves.toMatchObject({ newStatus: nextStatus });
    expect(m.read().approval_requirements?.find((row) => row.name === "LEGACY-PENDING")?.comments).toBe(action === "Approve"
      ? `Technical Feasibility: Feasible\nEngineering Impact: Reviewed\nReview Comments: ${COMMENT}`
      : COMMENT);
  });
});
