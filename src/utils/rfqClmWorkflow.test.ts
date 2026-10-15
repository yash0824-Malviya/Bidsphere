import { describe, expect, it } from "vitest";
import { rfqClmRequestValue, rfqClmRequestWorkflowView, rfqClmWorkflowView } from "./rfqClmWorkflow";

const record = (phase: string) => ({ name: "CON-93", custom_rfq: "RFQ-93", custom_contract_status: "Active", owner: "gateway@example.test", custom_clm_data: JSON.stringify({
  rfq_workflow: { version: 1, phase }, rfq_source: { legal_review: "AWARD-93" },
  audit: [{ action: "create", by: "team@example.test", at: "2026-09-22 09:00:00" }], procurement_completion: { purchase_order: "PO-93" },
}) });
describe("Persisted RFQ Contract workflow presentation", () => {
  const legalSigned = () => ({ ...record("signature"), custom_contract_status: "Pending Signature", custom_current_version: "1.0", custom_inteva_signatory: "legal@example.test", custom_clm_data: JSON.stringify({
    rfq_workflow: { version: 1, phase: "signature" }, approvals: [{ role: "legal", stage: 0, status: "Approved", by: "legal@example.test", at: "2026-09-22 09:00:00" }],
    signatures: [{ party: "inteva", role: "legal", by: "legal@example.test", at: "2026-09-22 10:00:00", version: "1.0", file_id: "LEGAL-PDF", file_url: "/private/files/legal-signed.pdf", hash: "a".repeat(64) }],
  }) });
  it("never assigns supplier ownership or invents a Finance phase from receipt data alone", () => {
    const saved = legalSigned(), before = structuredClone(saved);
    expect(rfqClmWorkflowView(saved)).toMatchObject({ phase: "signature", status: "Pending Signatures", stage: "E-Signature", owner: "Legal Manager", ownerRole: "legal" });
    expect(rfqClmWorkflowView(saved)?.instruction).not.toContain("Await the supplier");
    expect(saved).toEqual(before); expect(saved.custom_contract_status).toBe("Pending Signature");
  });
  it.each(["version", "signer", "role", "hash", "file", "timestamp", "approval"])("does not change the persisted stage from invalid Legal %s evidence", invalid => {
    const saved = legalSigned(), data = JSON.parse(saved.custom_clm_data), receipt = data.signatures[0];
    if (invalid === "version") receipt.version = "0.9";
    if (invalid === "signer") receipt.by = "someone-else@example.test";
    if (invalid === "role") receipt.role = "procurement_team";
    if (invalid === "hash") receipt.hash = "";
    if (invalid === "file") receipt.file_id = "";
    if (invalid === "timestamp") receipt.at = "2026-09-22 08:00:00";
    if (invalid === "approval") data.approvals[0].status = "Pending";
    saved.custom_clm_data = JSON.stringify(data);
    expect(rfqClmWorkflowView(saved)).toMatchObject({ phase: "signature", status: "Pending Signatures", owner: "Legal Manager" });
  });
  it("shows the persisted Finance handoff with only a Legal receipt and supplier still pending", () => {
    const saved = legalSigned(), data = JSON.parse(saved.custom_clm_data);
    expect(rfqClmWorkflowView(saved)?.phase).toBe("signature");
    data.rfq_workflow.phase = "finance_review"; saved.custom_contract_status = "Pending Finance"; saved.custom_clm_data = JSON.stringify(data);
    expect(rfqClmWorkflowView(saved)).toMatchObject({ phase: "finance_review", status: "Pending Finance Approval", stage: "Finance Approval", owner: "Finance Manager" });
    expect(data.signatures).toHaveLength(1);
  });
  it.each([
    ["legal_review", "Pending Legal Review", "Legal Review", "Legal Manager"],
    ["signature", "Pending Signatures", "E-Signature", "Legal Manager"],
    ["finance_review", "Pending Finance Approval", "Finance Approval", "Finance Manager"],
    ["procurement", "Finance Approved", "Procurement Finalization", "Procurement Team"],
    ["completed", "Completed", "Completed", "—"],
  ])("presents persisted %s without mutating native lifecycle", (phase, status, stage, owner) => {
    const saved = record(phase); const before = structuredClone(saved);
    expect(rfqClmWorkflowView(saved)).toMatchObject({ phase, status, stage, owner, rfq: "RFQ-93", award: "AWARD-93", createdBy: "team@example.test", createdAt: "2026-09-22 09:00:00" });
    expect(saved).toEqual(before); expect(saved.custom_contract_status).toBe("Active");
  });
  it("does not infer a completed procurement stage from a native Active or Executed status", () => {
    for (const custom_contract_status of ["Active", "Executed"]) expect(rfqClmWorkflowView({ name: "LEGACY", custom_rfq: "RFQ-OLD", custom_contract_status })).toBeUndefined();
  });
  it("uses the creation audit actor rather than the ERP gateway owner for atomic award Contracts", () => {
    const saved = record("legal_review"); const data = JSON.parse(saved.custom_clm_data);
    data.audit[0].action = "create_from_rfq_award"; saved.custom_clm_data = JSON.stringify(data);
    expect(rfqClmWorkflowView(saved)?.createdBy).toBe("team@example.test");
  });
  it("does not create RFQ workflow labels for standalone, malformed or unsupported evidence", () => {
    expect(rfqClmWorkflowView({ ...record("completed"), custom_rfq: "" })).toBeUndefined();
    expect(rfqClmWorkflowView({ ...record("completed"), custom_clm_data: "{" })).toBeUndefined();
    expect(rfqClmWorkflowView(record("invented"))).toBeUndefined();
  });
});

describe("Persisted RFQ Contract Request assignment presentation", () => {
  it("hides a native Currency zero before award while preserving deliberate zero values", () => {
    const record = { contract_value: 0, custom_clm_data: JSON.stringify({ rfq_source: { stage: "rfq_created", contract_required: true } }) };
    expect(rfqClmRequestValue(record)).toBeUndefined();
    expect(rfqClmRequestValue({ contract_value: 0 })).toBe(0);
    expect(rfqClmRequestValue({ ...record, custom_clm_data: JSON.stringify({ rfq_source: { stage: "rfq_created", amount: 0 } }) })).toBe(0);
    expect(rfqClmRequestValue({ ...record, custom_clm_data: JSON.stringify({ rfq_source: { stage: "rfq_created", prepared: true } }) })).toBe(0);
  });
  const pending = () => ({ name: "CR-94", request_status: "Draft", custom_rfq: "RFQ-94", requester: "requester@example.test", custom_clm_data: JSON.stringify({
    rfq_source: { rfq: "RFQ-94", award: "AWARD-94" }, rfq_request_workflow: { version: 1, phase: "procurement_team", assigned_role: "procurement_team" },
    approvals: [{ role: "procurement_team", stage: 0, status: "Pending" }],
  }) });
  it("uses the persisted Team assignment without treating the Request as a Contract", () => {
    const row = pending(), before = structuredClone(row);
    expect(rfqClmRequestWorkflowView(row)).toMatchObject({ phase: "procurement_team", status: "Pending Procurement Team", stage: "Pending Procurement Team", assignedRole: "procurement_team", owner: "Procurement Team", assignedUser: "", rfq: "RFQ-94", award: "AWARD-94", createdBy: "requester@example.test" });
    expect(row).toEqual(before); expect(rfqClmWorkflowView(row)).toBeUndefined();
    expect(rfqClmRequestWorkflowView({ ...row, request_status: "Approved" })?.phase).toBe("procurement_team");
  });
  it.each(["phase", "assigned_role", "source", "approval", "contract", "user"])("does not fabricate a pending Team item with inconsistent %s evidence", field => {
    const row = pending(), data = JSON.parse(row.custom_clm_data);
    if (field === "phase") data.rfq_request_workflow.phase = "contract_created";
    if (field === "assigned_role") data.rfq_request_workflow.assigned_role = "procurement";
    if (field === "source") data.rfq_source.rfq = "OTHER";
    if (field === "approval") data.approvals[0].status = "Approved";
    if (field === "contract") data.contract = "CON-94";
    if (field === "user") data.approvals[0].user = "unexpected-user@example.test";
    row.custom_clm_data = JSON.stringify(data);
    expect(rfqClmRequestWorkflowView(row)).toBeUndefined();
  });
  it("keeps a native Pending Review Request in the Team queue only with its persisted assignment", () => {
    const row = { ...pending(), request_status: "Pending Review" }, before = structuredClone(row);
    expect(rfqClmRequestWorkflowView(row)).toMatchObject({ status: "Pending Procurement Team", assignedRole: "procurement_team", rfq: "RFQ-94" });
    expect(rfqClmWorkflowView(row)).toBeUndefined();
    expect(rfqClmRequestWorkflowView({ ...row, custom_clm_data: "{}" })).toBeUndefined();
    expect(row).toEqual(before);
  });
  it("excludes completed Requests and unrelated generic drafts", () => {
    expect(rfqClmRequestWorkflowView({ ...pending(), request_status: "Completed" })).toBeUndefined();
    expect(rfqClmRequestWorkflowView({ ...pending(), custom_clm_data: "{}" })).toBeUndefined();
  });
  it("shows an RFQ-created request in Procurement without inventing a supplier, award or Contract", () => {
    const row = { ...pending(), request_status: "Pending Review" }, data = JSON.parse(row.custom_clm_data);
    data.rfq_source = { rfq: "RFQ-94", stage: "rfq_created", contract_required: true };
    Object.assign(data.rfq_request_workflow, { status: "Pending", current_stage: "Procurement" });
    row.custom_clm_data = JSON.stringify(data);
    const before = structuredClone(row);
    expect(rfqClmRequestWorkflowView(row)).toMatchObject({ status: "Pending", stage: "Procurement", owner: "Procurement Team", assignedRole: "procurement_team", rfq: "RFQ-94", award: "" });
    expect(rfqClmWorkflowView(row)).toBeUndefined(); expect(row).toEqual(before);
    data.rfq_source.available_award = { award: "AVAILABLE-AWARD" };
    row.custom_clm_data = JSON.stringify(data);
    expect(rfqClmRequestWorkflowView(row)).toMatchObject({ status: "Pending", stage: "Procurement", award: "AVAILABLE-AWARD" });
    data.rfq_source.award = "AWARD-94"; data.rfq_source.supplier = "FEMSA";
    row.custom_clm_data = JSON.stringify(data);
    expect(rfqClmRequestWorkflowView(row)).toMatchObject({ status: "Pending", stage: "Procurement", award: "AWARD-94" });
  });
  it.each(["decision", "status", "stage", "assignment"])("does not infer an initial queue item with invalid persisted %s", field => {
    const row = { ...pending(), request_status: "Pending Review" }, data = JSON.parse(row.custom_clm_data);
    data.rfq_source = { rfq: "RFQ-94", stage: "rfq_created", contract_required: true };
    Object.assign(data.rfq_request_workflow, { status: "Pending", current_stage: "Procurement" });
    if (field === "decision") data.rfq_source.contract_required = false;
    if (field === "status") data.rfq_request_workflow.status = "Approved";
    if (field === "stage") data.rfq_request_workflow.current_stage = "Legal Review";
    if (field === "assignment") data.rfq_request_workflow.assigned_role = "procurement";
    row.custom_clm_data = JSON.stringify(data);
    expect(rfqClmRequestWorkflowView(row)).toBeUndefined();
  });
});
