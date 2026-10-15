import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_REQUEST_REQUIRED_FIELDS, isInitialRfqRequestPersistence, validateContractRequestPersistence } from "./clmRequestValidation";
import { parseClmData } from "./clmCore";
import { createClmDependencies } from "./clmErp";
import type { ClmRecord } from "../src/types/clm";

const intent = { version: 1, phase: "saving", decision: "Yes", award: "AWARD-95", quotation: "SQ-95", supplier: "SUP-1", by: "manager@test.invalid", at: "2026-09-25 10:00:00" };
const rfq = { name: "RFQ-95", contract_required: "Yes", company: "Netlink", department: "Procurement", docstatus: 1, custom_approval_data: JSON.stringify({ clm_award_intent: intent }) };
const full: ClmRecord = { requester: "manager@test.invalid", request_date: "2026-09-25", company: "Netlink", department: "Procurement", contract_type: "Supply / Procurement Contract", contract_purpose: "Supply parts", description: "Supply the required parts", supplier: "SUP-1", contract_start_date: "2026-09-25", contract_end_date: "2026-11-25", contract_value: 48500, currency: "USD", estimated_contract_value: 50000 };
const source = { stage: "rfq_awarded", prepared: false, rfq: "RFQ-95", contract_required: true, company: "Netlink", award: "AWARD-95", quotation: "SQ-95", supplier: "SUP-1", amount: 48500, currency: "USD" };
const award = { source, prefill: { supplier: "SUP-1", custom_supplier_quotation: "SQ-95", contract_value: 48500, currency: "USD" }, review: { name: "AWARD-95" } };
function initial(): ClmRecord {
  const record: ClmRecord = { ...full, custom_rfq: "RFQ-95", custom_supplier_quotation: "SQ-95", request_status: "Draft" };
  for (const field of ["contract_type", "contract_start_date", "contract_end_date", "estimated_contract_value"]) delete record[field];
  const data = parseClmData(null);
  data.rfq_source = { ...source };
  data.rfq_request_workflow = { version: 1, phase: "procurement_team", assigned_role: "procurement_team", status: "Pending", current_stage: "Procurement" };
  data.approvals = [{ id: "approval-1", role: "procurement_team", stage: 0, rule: "RFQ preparation", status: "Pending" }];
  data.audit = ["create", "procurement_team_assigned"].map(action => ({ id: action, action, by: String(full.requester), role: "procurement", at: "2026-09-25 10:00:00", previous_status: "", new_status: "Pending", reference_id: "RFQ-95" }));
  return { ...record, custom_clm_data: JSON.stringify(data) };
}
function change(record: ClmRecord, edit: (data: ReturnType<typeof parseClmData>) => void) {
  const data = parseClmData(record.custom_clm_data); edit(data); record.custom_clm_data = JSON.stringify(data);
}
function held(): ClmRecord {
  const record = { ...initial(), name: "CTRQ-2", docstatus: 0, request_status: "Draft", supplier: "", currency: "" };
  delete (record as ClmRecord).custom_supplier_quotation;
  change(record, data => {
    data.rfq_source = { stage: "rfq_created", rfq: "RFQ-95", company: "Netlink", contract_required: true };
    data.rfq_request_workflow = { version: 1, phase: "awaiting_supplier_award", assigned_role: "procurement_team", status: "Invalidated", current_stage: "Awaiting Supplier Award" };
    data.audit.push({ id: "cancelled", action: "invalidate_preaward_request", by: "manager@test.invalid", role: "procurement", at: "2026-09-25 10:00:00", previous_status: "Pending", new_status: "Invalidated", reference_id: "RFQ-95" });
  });
  return record;
}

describe("Contract Request requirements at the ERP persistence boundary", () => {
  it("preserves all original required fields for standalone requests", () => {
    expect(CONTRACT_REQUEST_REQUIRED_FIELDS).toHaveLength(13);
    expect(() => validateContractRequestPersistence(full)).not.toThrow();
  });
  it.each(CONTRACT_REQUEST_REQUIRED_FIELDS)("requires standalone field %s on every save", field => {
    expect(() => validateContractRequestPersistence({ ...full, [field]: " " })).toThrow(`requires: ${field}`);
  });
  it("allows zero monetary values already permitted by mandatory-field validation", () => {
    expect(() => validateContractRequestPersistence({ ...full, contract_value: 0, estimated_contract_value: 0 })).not.toThrow();
  });
  it.each(["Draft", "Pending Review"])("defers only contract-stage terms for verified %s awarded requests", request_status => {
    expect(() => validateContractRequestPersistence({ ...initial(), request_status }, rfq, "create", award)).not.toThrow();
  });
  it.each(["requester", "request_date", "department", "company", "contract_purpose", "description", "supplier", "contract_value", "currency"])("still requires awarded intake field %s", field => {
    expect(() => validateContractRequestPersistence({ ...initial(), [field]: "" }, rfq, "create", award)).toThrow(/requires:/);
  });
  it.each([undefined, { ...rfq, name: "OTHER" }, { ...rfq, company: "Other" }, { ...rfq, docstatus: 2 }])("requires independently verified persisted RFQ: %j", value => {
    expect(() => validateContractRequestPersistence(initial(), value, "create", award)).toThrow(/saved active RFQ/);
  });
  it.each([undefined, { ...award, review: undefined }])("never trusts the record's award marker without a real persisted award %#", value => {
    expect(() => validateContractRequestPersistence(initial(), rfq, "create", value)).toThrow(/real saved supplier award/);
  });
  it.each([{ ...rfq, docstatus: 0 }, { ...rfq, contract_required: "No" }])("rejects an awarded Request against invalid RFQ state %#", value => {
    expect(() => validateContractRequestPersistence(initial(), value, "create", award)).toThrow(/real saved supplier award/);
  });
  it("requires persisted award confirmation, not only a Yes field", () => {
    expect(() => validateContractRequestPersistence(initial(), { ...rfq, custom_approval_data: "{}" }, "create", award)).toThrow(/persisted award confirmation/);
  });
  it.each([
    { source: { ...source, award: "OTHER" } },
    { source: { ...source, quotation: "OTHER" } },
    { source: { ...source, amount: 49000 } },
    { prefill: { ...award.prefill, contract_value: 50000 } },
  ])("rejects changed authoritative award data %#", changed => {
    expect(() => validateContractRequestPersistence(initial(), rfq, "create", { ...award, ...changed })).toThrow(/authoritative supplier award/);
  });
  it("allows saving an auditable invalidated pre-award record, but never inserting one", () => {
    const record = held();
    expect(isInitialRfqRequestPersistence(record)).toBe(true);
    for (const docstatus of [0, 1]) expect(() => validateContractRequestPersistence(record, { ...rfq, docstatus }, "save")).not.toThrow();
    expect(() => validateContractRequestPersistence({ ...record, request_status: "Cancelled" }, rfq, "save")).not.toThrow();
    expect(() => validateContractRequestPersistence(record, rfq, "create")).toThrow(/only preserve an existing Request/);
    expect(() => validateContractRequestPersistence(record, rfq, "save", award)).toThrow(/only preserve an existing Request/);
    change(record, data => { data.audit = data.audit.filter(row => row.action !== "invalidate_preaward_request"); });
    expect(isInitialRfqRequestPersistence(record)).toBe(false);
  });
  it("rejects old pre-award active intake even for a submitted RFQ", () => {
    const record = held();
    record.request_status = "Pending Review";
    change(record, data => { data.rfq_request_workflow = { version: 1, phase: "procurement_team", assigned_role: "procurement_team", status: "Pending", current_stage: "Procurement" }; });
    expect(() => validateContractRequestPersistence(record, rfq, "save")).toThrow(/real saved supplier award/);
  });
  it.each([
    (d: ReturnType<typeof parseClmData>) => { (d.rfq_source as ClmRecord).prepared = true; },
    d => { (d.rfq_source as ClmRecord).rfq = "OTHER"; },
    d => { (d.rfq_source as ClmRecord).company = "Other"; },
    d => { (d.rfq_source as ClmRecord).contract_required = false; },
    d => { (d.rfq_source as ClmRecord).award = ""; },
    d => { (d.rfq_source as ClmRecord).quotation = "OTHER"; },
    d => { d.approvals[0].role = "procurement"; },
    d => { d.approvals[0].user = "manager@test.invalid"; },
    d => { d.approvals[0].status = "Approved"; },
    d => { d.audit = []; },
  ])("does not weaken requirements for an incomplete or prepared marker %#", edit => {
    const record = initial(); change(record, edit);
    expect(isInitialRfqRequestPersistence(record)).toBe(false);
    expect(() => validateContractRequestPersistence(record, rfq, "create", award)).toThrow(/requires:/);
  });
});

describe("real ERP adapter Contract Request enforcement", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  const setup = (hasAward = true) => {
    vi.stubEnv("ERPNEXT_URL", "https://erp.test"); vi.stubEnv("ERP_API_KEY", "test-key"); vi.stubEnv("ERP_API_SECRET", "test-secret");
    const review = { name: "AWARD-95", rfq_name: "RFQ-95", sq_name: "SQ-95", supplier: "SUP-1", grand_total: 48500, workflow_state: "Pending Review" };
    const docs: Record<string, ClmRecord> = { "Request for Quotation": rfq, "Legal Document Review": review, "Supplier Quotation": { name: "SQ-95", docstatus: 1, supplier: "SUP-1", company: "Netlink", currency: "USD", grand_total: 50000, items: [{ request_for_quotation: "RFQ-95" }] }, Supplier: { name: "SUP-1", disabled: 0 } };
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const path = new URL(String(url)).pathname.split("/").map(decodeURIComponent), dt = path[3], name = path[4];
      const data = init?.method === "GET" ? name ? docs[dt] : dt === "Legal Document Review" && hasAward ? [review] : [] : body.doc || body;
      return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
  };
  it.each(["create", "save"] as const)("blocks incomplete standalone %s before any ERP write", async action => {
    const fetch = setup();
    await expect(createClmDependencies()[action]("Contract Request", { ...full, supplier: "" })).rejects.toMatchObject({ status: 422 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["create", "save"] as const)("re-fetches the RFQ and real award/quotation before allowing intake %s", async action => {
    const fetch = setup();
    await createClmDependencies()[action]("Contract Request", initial());
    const reads = fetch.mock.calls.filter(([, init]) => init?.method === "GET").map(([url]) => decodeURIComponent(String(url)));
    expect(reads.some(url => url.includes("Request for Quotation/RFQ-95"))).toBe(true);
    expect(reads.some(url => url.includes("Legal Document Review/AWARD-95"))).toBe(true);
    expect(reads.some(url => url.includes("Supplier Quotation/SQ-95"))).toBe(true);
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("fails without writing when ERPNext has no saved award", async () => {
    const fetch = setup(false);
    await expect(createClmDependencies().create("Contract Request", initial())).rejects.toThrow(/real saved supplier award/);
    expect(fetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
  it("invalidates an existing premature Request through native Draft without inventing award data", async () => {
    const fetch = setup(false), record = held();
    await createClmDependencies().save("Contract Request", record);
    const writes = fetch.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(writes).toHaveLength(1);
    expect(JSON.parse(String(writes[0][1]?.body)).doc).toMatchObject({ name: "CTRQ-2", request_status: "Draft", custom_rfq: "RFQ-95", supplier: "" });
  });
  it("keeps standard Contract persistence outside Request validation", async () => {
    const fetch = setup();
    await createClmDependencies().create("Contract", { custom_contract_title: "Existing flow" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toBe("https://erp.test/api/resource/Contract");
  });
});
