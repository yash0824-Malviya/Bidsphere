import { describe, expect, it } from "vitest";
import { rfqClmLifecycleView } from "./rfqClmWorkflow";

const record = (phase: string, extra: Record<string, unknown> = {}) => ({ name: "CON-1", custom_rfq: "RFQ-1", custom_contract_status: "Active", custom_clm_data: JSON.stringify({ rfq_workflow: { version: 1, phase }, ...extra }) });

describe("Contract Detail lifecycle from persisted phases", () => {
  it("completes E-Signature and marks Finance current after the saved Legal-only handoff", () => {
    const saved = { ...record("finance_review", {
      approvals: [{ role: "legal", stage: 0, status: "Approved", by: "legal@example.test", at: "2026-09-22 09:00:00" }],
      signatures: [{ party: "inteva", role: "legal", by: "legal@example.test", at: "2026-09-22 10:00:00", version: "1.0", file_id: "SIGNED-LEGAL", file_url: "/private/files/legal.pdf", hash: "a".repeat(64) }],
    }), custom_contract_status: "Pending Finance", custom_current_version: "1.0", custom_inteva_signatory: "legal@example.test" };
    const view = rfqClmLifecycleView(saved)!;
    expect(view.current).toMatchObject({ phase: "finance_review", status: "Pending Finance Approval", stage: "Finance Approval", owner: "Finance Manager", ownerRole: "finance" });
    expect(view.steps.find(row => row.phase === "signature")).toMatchObject({ state: "completed", owner: "Legal Manager" });
    expect(view.steps.find(row => row.state === "current")).toMatchObject({ phase: "finance_review", owner: "Finance Manager" });
    expect(view.next).toMatchObject({ phase: "procurement", owner: "Procurement Team" });
    expect(view.steps.filter(row => row.state === "completed").map(row => row.phase)).toEqual(["draft", "legal_review", "signature"]);
    expect(view.current.instruction).not.toContain("Await the supplier signature");
  });
  it("marks creation and Legal complete, signatures current, Finance next and Procurement upcoming", () => {
    const saved = record("signature"), before = structuredClone(saved);
    const view = rfqClmLifecycleView(saved)!;
    expect(view.current).toMatchObject({ phase: "signature", status: "Pending Signatures", stage: "E-Signature", owner: "Legal Manager" });
    expect(view.next).toMatchObject({ phase: "finance_review", status: "Pending Finance Approval", stage: "Finance Approval", owner: "Finance Manager" });
    expect(view.steps.map(row => [row.stage, row.state, row.owner])).toEqual([
      ["Procurement Team Creation", "completed", "Procurement Team"],
      ["Legal Review", "completed", "Legal Manager"],
      ["E-Signature", "current", "Legal Manager"],
      ["Finance Approval", "next", "Finance Manager"],
      ["Procurement Finalization", "upcoming", "Procurement Team"],
      ["Completed", "upcoming", "None / Completed"],
    ]);
    expect(saved).toEqual(before);
  });
  it.each([
    ["legal_review", "Pending Legal Review", "Legal Manager", "signature"],
    ["signature", "Pending Signatures", "Legal Manager", "finance_review"],
    ["finance_review", "Pending Finance Approval", "Finance Manager", "procurement"],
    ["procurement", "Pending Procurement Finalization", "Procurement Team", "completed"],
  ])("updates %s current/next markers only from the newly persisted phase", (phase, status, owner, next) => {
    const view = rfqClmLifecycleView(record(phase))!;
    expect(view.current).toMatchObject({ phase, status, owner });
    expect(view.steps.filter(row => row.state === "current").map(row => row.phase)).toEqual([phase]);
    expect(view.steps.filter(row => row.state === "next").map(row => row.phase)).toEqual([next]);
    expect(view.next?.phase).toBe(next);
  });
  it("shows completed with no responsibility or next stage without changing native Contract status", () => {
    const saved = record("completed"), view = rfqClmLifecycleView(saved)!;
    expect(view.current).toMatchObject({ status: "Completed", stage: "Completed", owner: "None / Completed", ownerRole: "" });
    expect(view.steps.filter(row => row.state === "completed")).toHaveLength(5);
    expect(view.steps.at(-1)).toMatchObject({ phase: "completed", state: "current" });
    expect(view.next).toBeUndefined(); expect(saved.custom_contract_status).toBe("Active");
  });
  it("resets progress on a sent-back draft without using approvals from review history", () => {
    const view = rfqClmLifecycleView(record("draft", { review_history: [{ approvals: [{ role: "legal", status: "Approved" }] }] }))!;
    expect(view.current).toMatchObject({ status: "Draft", stage: "Contract Preparation", owner: "Procurement Team" });
    expect(view.next?.phase).toBe("legal_review"); expect(view.steps.filter(row => row.state === "completed")).toEqual([]);
  });
  it("keeps rejected workflow blocked and uses only saved approval/signature evidence for completed stages", () => {
    const view = rfqClmLifecycleView({ ...record("rejected", {
      approvals: [{ role: "legal", stage: 0, status: "Approved", by: "legal@example.test", at: "2026-09-22 09:00:00" }, { role: "finance", status: "Rejected" }],
      signatures: [{ party: "inteva", role: "legal", by: "legal@example.test", at: "2026-09-22 10:00:00", version: "1.0", file_id: "SIGNED-LEGAL", file_url: "/private/files/legal.pdf", hash: "a".repeat(64) }],
    }), custom_current_version: "1.0", custom_inteva_signatory: "legal@example.test" })!;
    expect(view.current.status).toBe("Rejected"); expect(view.paused).toBe(true); expect(view.next).toBeUndefined();
    expect(view.steps.filter(row => row.state === "completed").map(row => row.phase)).toEqual(["draft", "legal_review", "signature"]);
    expect(view.steps.find(row => row.phase === "finance_review")?.state).toBe("blocked");
  });
  it("does not promise another signature/Finance sequence while Legal reviews a termination request", () => {
    const view = rfqClmLifecycleView(record("legal_review", { termination: { reason: "Close agreement" } }))!;
    expect(view.current.stage).toBe("Legal Review"); expect(view.current.instruction).toContain("termination review");
    expect(view.paused).toBe(true); expect(view.next).toBeUndefined(); expect(view.steps.some(row => row.state === "next")).toBe(false);
  });
  it.each(["Cancelled", "Terminated", "Expired", "Closed"])("does not advertise procurement actions for native %s status", custom_contract_status => {
    const view = rfqClmLifecycleView({ ...record("procurement"), custom_contract_status })!;
    expect(view.current).toMatchObject({ status: custom_contract_status, owner: "None" }); expect(view.paused).toBe(true); expect(view.next).toBeUndefined();
  });
  it("never derives completion from a native Active status or invents a route for unknown/standalone records", () => {
    expect(rfqClmLifecycleView({ custom_rfq: "RFQ-1", custom_contract_status: "Active" })).toBeUndefined();
    expect(rfqClmLifecycleView({ ...record("signature"), custom_rfq: "" })).toBeUndefined();
    expect(rfqClmLifecycleView(record("invented"))).toBeUndefined();
    expect(rfqClmLifecycleView({ ...record("signature"), custom_clm_data: "{" })).toBeUndefined();
    expect(rfqClmLifecycleView({ custom_rfq: "RFQ-OLD", custom_contract_status: "Pending Signature" })?.next?.phase).toBe("finance_review");
  });
});
