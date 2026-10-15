import { describe, expect, it, vi } from "vitest";
import { rfqInitialClmHold, withoutInitialClmHeldReviews } from "./rfqInitialClmHold";

type Row = Record<string, unknown>;
const review = { name: "AWARD-94", rfq_name: "RFQ-94", sq_name: "SQ-94", supplier: "FEMSA" };
function fixture() {
  const decision: Row = { decision: "Yes", request: "CR-94", supplier: "FEMSA", quotation: "SQ-94", award: "AWARD-94", legal_review: "AWARD-94" };
  const data: Row = { schema: 1, rfq_source: { rfq: "RFQ-94", quotation: "SQ-94", supplier: "FEMSA", award: "AWARD-94", legal_review: "AWARD-94" }, rfq_request_workflow: { version: 1, phase: "procurement_team", assigned_role: "procurement_team" }, approvals: [{ id: "TEAM", role: "procurement_team", stage: 0, status: "Pending" }], audit: [{ action: "procurement_team_assigned", role: "procurement_team", new_status: "Pending Procurement Team", by: "team@test", at: "2026-09-23 10:00:00" }] };
  const rfq: Row = { name: "RFQ-94", contract_required: "Yes", custom_approval_data: { contract_decision: decision } };
  const request: Row = { name: "CR-94", request_status: "Draft", custom_rfq: "RFQ-94", custom_supplier_quotation: "SQ-94", supplier: "FEMSA", custom_clm_data: data };
  const load = vi.fn(async (doctype: string, name: string) => {
    if (doctype === "Request for Quotation" && name === "RFQ-94") return rfq;
    if (doctype === "Contract Request" && name === "CR-94") return request;
    throw new Error("Missing saved source record");
  });
  return { decision, data, rfq, request, load };
}
describe("RFQ initial Procurement Team hold on legacy Legal/Finance actions", () => {
  it("does not block sourcing or new Legal award creation because of superseded pre-award intake", async () => {
    const m = fixture();
    m.rfq.custom_approval_data = { clm_initial_request: { version: 1, phase: "complete", request: "CR-94" } };
    m.data.rfq_source = { stage: "rfq_created", rfq: "RFQ-94", contract_required: true };
    Object.assign(m.data.rfq_request_workflow as Row, { status: "Pending", current_stage: "Procurement" });
    Object.assign((m.data.audit as Row[])[0], { role: "procurement", new_status: "Pending" });
    delete m.request.custom_supplier_quotation; delete m.request.supplier;
    expect(await rfqInitialClmHold(review, m.load)).toBeUndefined();
    expect(await withoutInitialClmHeldReviews([review], m.load)).toEqual([review]);
    m.data.contract = "CON-UNMIRRORED";
    await expect(rfqInitialClmHold(review, m.load)).rejects.toMatchObject({ status: 409 });
  });
  it.each(["awaiting_award", "awaiting_supplier_award"])("ignores a cancelled pre-award %s pointer with Contract Required No", async phase => {
    const m = fixture();
    m.rfq.contract_required = "No";
    m.rfq.custom_approval_data = { clm_initial_request: { version: 1, phase, request: "CR-94" } };
    m.request.request_status = "Cancelled";
    m.data.rfq_source = { stage: "rfq_created", rfq: "RFQ-94", contract_required: true };
    Object.assign(m.data.rfq_request_workflow as Row, { phase: "awaiting_supplier_award", status: "Invalidated", current_stage: "Awaiting Supplier Award" });
    expect(await rfqInitialClmHold(review, m.load)).toBeUndefined();
    expect(m.load).toHaveBeenCalledExactlyOnceWith("Request for Quotation", "RFQ-94");
    expect(await withoutInitialClmHeldReviews([review], m.load)).toEqual([review]);
  });
  it.each(["rfq_awarded", "rfq_created"])("holds a real saved award's active %s Request", async stage => {
    const m = fixture();
    m.rfq.custom_approval_data = { clm_initial_request: { version: 1, phase: "complete", request: "CR-94", award: "AWARD-94" } };
    m.data.rfq_source = { ...(m.data.rfq_source as Row), stage, contract_required: true };
    Object.assign(m.data.rfq_request_workflow as Row, { status: "Pending", current_stage: "Procurement" });
    Object.assign((m.data.audit as Row[])[0], { role: "procurement", new_status: "Pending" });
    expect(await rfqInitialClmHold(review, m.load)).toContain("Pending Contract Request assigned to Procurement Team");
    expect(await withoutInitialClmHeldReviews([review], m.load)).toEqual([]);
    m.data.audit = [];
    await expect(rfqInitialClmHold(review, m.load)).rejects.toMatchObject({ status: 409 });
  });
  it("does not let a historical invalidated pointer suppress another active Yes decision", async () => {
    const m = fixture();
    m.rfq.custom_approval_data = { clm_initial_request: { version: 1, phase: "awaiting_supplier_award", request: "CR-OLD" }, contract_decision: m.decision };
    m.rfq.contract_required = "No";
    expect(await rfqInitialClmHold(review, m.load)).toContain("Pending Procurement Team");
    expect(m.load.mock.calls.some(([, name]) => name === "CR-OLD")).toBe(false);
  });
  it("supports the new awarded-source audit after request preparation", async () => {
    const m = fixture();
    Object.assign(m.data.rfq_source as Row, { stage: "rfq_awarded", prepared: true });
    Object.assign((m.data.audit as Row[])[0], { role: "procurement", new_status: "Pending" });
    expect(await rfqInitialClmHold(review, m.load)).toContain("Pending Procurement Team");
  });
  it("uses persisted parent/request/source assignment and deduplicates queue reads", async () => {
    const m = fixture();
    expect(await rfqInitialClmHold(review, m.load)).toContain("Pending Procurement Team");
    m.load.mockClear();
    expect(await withoutInitialClmHeldReviews([review, { ...review }], m.load)).toEqual([]);
    expect(m.load).toHaveBeenCalledTimes(2);
  });
  it("holds a native Pending Review Request with the saved Team assignment before Legal or Finance review", async () => {
    const m = fixture(); m.request.request_status = "Pending Review";
    const before = structuredClone({ rfq: m.rfq, request: m.request });
    expect(await rfqInitialClmHold(review, m.load)).toContain("Procurement Team must create its Contract before Legal or Finance review can continue.");
    expect(await withoutInitialClmHeldReviews([review], m.load)).toEqual([]);
    expect({ rfq: m.rfq, request: m.request }).toEqual(before);
  });
  it.each(["manager", "source", "approval", "audit", "cancelled"])("keeps strict %s validation for native Pending Review Requests", async problem => {
    const m = fixture(); m.request.request_status = "Pending Review";
    if (problem === "manager") {
      (m.data.rfq_request_workflow as Row).assigned_role = "procurement";
      (m.data.approvals as Row[])[0].role = "procurement";
      (m.data.audit as Row[])[0].role = "procurement";
    }
    if (problem === "source") (m.data.rfq_source as Row).quotation = "OTHER-SQ";
    if (problem === "approval") (m.data.approvals as Row[])[0].status = "Approved";
    if (problem === "audit") m.data.audit = [];
    if (problem === "cancelled") m.request.docstatus = 2;
    await expect(rfqInitialClmHold(review, m.load)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("inconsistent") });
    await expect(withoutInitialClmHeldReviews([review], m.load)).rejects.toMatchObject({ status: 409 });
  });
  it.each(["No", "undecided", "created", "legacy"])("preserves the %s branch", async branch => {
    const m = fixture();
    if (branch === "No") m.decision.decision = "No";
    if (branch === "undecided") m.rfq.custom_approval_data = {};
    if (branch === "created") m.decision.contract = "CON-94";
    if (branch === "legacy") delete m.data.rfq_request_workflow;
    expect(await rfqInitialClmHold(review, m.load)).toBeUndefined();
    expect(await withoutInitialClmHeldReviews([review], m.load)).toEqual([review]);
  });
  it("does not change a historical LDR for another award", async () => {
    const m = fixture();
    expect(await rfqInitialClmHold({ ...review, name: "OLD-AWARD" }, m.load)).toBeUndefined();
    expect(m.load).toHaveBeenCalledTimes(1);
  });
  it.each([
    (m: ReturnType<typeof fixture>) => { m.request.custom_rfq = "OTHER"; },
    m => { (m.data.rfq_source as Row).rfq = "OTHER"; },
    m => { (m.data.rfq_source as Row).award = "OTHER"; },
    m => { m.request.supplier = "OTHER"; },
    m => { m.request.custom_supplier_quotation = "OTHER"; },
    m => { (m.data.rfq_request_workflow as Row).assigned_role = "procurement"; },
    m => { (m.data.rfq_request_workflow as Row).phase = "contract_created"; },
    m => { m.data.contract = "CON-DETACHED"; },
    m => { m.request.request_status = "Rejected"; },
    m => { (m.data.approvals as Row[])[0].status = "Approved"; },
    m => { (m.data.approvals as Row[])[0].user = "user@test"; },
    m => { m.data.audit = []; },
  ])("rejects inconsistent persisted assignment or links without inventing a task", async change => {
    const m = fixture(); change(m);
    await expect(rfqInitialClmHold(review, m.load)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("inconsistent") });
    await expect(withoutInitialClmHeldReviews([review], m.load)).rejects.toMatchObject({ status: 409 });
  });
  it("surfaces missing source and malformed saved evidence", async () => {
    const m = fixture(); m.decision.request = "CR-MISSING";
    await expect(rfqInitialClmHold(review, m.load)).rejects.toThrow("Missing saved source record");
    m.decision.request = "CR-94"; m.request.custom_clm_data = "{bad";
    await expect(rfqInitialClmHold(review, m.load)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("could not be verified") });
  });
});
