import { afterEach, describe, expect, it, vi } from "vitest";
import { ClmError, clmSnapshotHash, parseClmData } from "./clmCore";
import { syncRfqClmRestContract, type RfqClmRestSyncDependencies } from "./rfqClmRestSync";
import { createClmDependencies } from "./clmErp";
import type { ClmRecord } from "../src/types/clm";
import { encodeRfqClmRestContract } from "./rfqClmRestStatus";

const source = { rfq: "RFQ-95", award: "AWARD-95", legal_review: "AWARD-95", supplier: '"Blue Ridge"', quotation: "SQ-270", amount: 30, currency: "USD", company: "Netlink", contract_required: true };
function contract(status = "Pending Legal", phase = "legal_review"): ClmRecord {
  const record: ClmRecord = { name: "CON-95", modified: "2026-09-23 12:00:00.123456", docstatus: 0, custom_rfq: "RFQ-95", custom_contract_request: "CR-95", custom_supplier_quotation: "SQ-270", custom_supplier: source.supplier, party_type: "Supplier", party_name: source.supplier, custom_contract_type: "Supply / Procurement Contract", custom_contract_title: "Awarded material", contract_terms: "Supply the agreed parts", custom_contract_value: 30, custom_currency: "USD", custom_contract_status: status, custom_current_version: "1.0", custom_inteva_signatory: "legal@test.invalid" };
  const data = parseClmData(null);
  data.persistence = "erpnext_rest_v1";
  data.rfq_source = source;
  data.rfq_context = { rfq_id: "RFQ-95", award_id: "AWARD-95", supplier_id: source.supplier, quotation_id: "SQ-270", contract_type: record.custom_contract_type, contract_status: status, contract_required: "Yes" };
  data.rfq_workflow = { version: 1, phase: phase as "legal_review" };
  data.approvals = [{ id: "LEGAL-1", role: "legal", stage: 0, status: "Pending", rule: "RFQ" }];
  if (["Executed", "Active"].includes(status)) {
    Object.assign(record, { custom_esign_status: "Completed", custom_executed_contract: "/private/files/company.pdf", custom_final_version_locked: 1 });
    data.version = "VERSION-1";
    data.approvals = [
      { id: "LEGAL-1", role: "legal", stage: 0, status: "Approved", rule: "RFQ", by: "legal@test.invalid", at: "2026-09-23 12:00:01" },
      { id: "FINANCE-1", role: "finance", stage: 1, status: "Approved", rule: "RFQ", by: "finance@test.invalid", at: "2026-09-23 12:00:04" },
    ];
    data.signatures = [
      { party: "supplier", by: "supplier@test.invalid", at: "2026-09-23 12:00:02", version: "1.0", hash: "a".repeat(64), file_id: "FILE-SUPPLIER", file_url: "/private/files/supplier.pdf", typed_name: "Supplier" },
      { party: "inteva", by: "legal@test.invalid", role: "legal", at: "2026-09-23 12:00:03", version: "1.0", hash: "b".repeat(64), file_id: "FILE-COMPANY", file_url: "/private/files/company.pdf", typed_name: "Legal" },
    ];
    data.locked_hash = clmSnapshotHash("Contract", record);
  }
  record.custom_clm_data = JSON.stringify(data);
  return record;
}
function fixture(saved = contract()) {
  let sequence = 0;
  const requestData = { ...parseClmData(null), contract: saved.name, rfq_source: source };
  const decision = { decision: "Yes", request: "CR-95", contract: saved.name, award: "AWARD-95", legal_review: "AWARD-95", supplier: source.supplier, quotation: "SQ-270", amount: 30, currency: "USD", by: "team@test.invalid", at: "2026-09-23 11:00:00" };
  const docs: Record<string, ClmRecord> = {
    "Contract/CON-95": structuredClone(saved),
    "Contract Request/CR-95": { name: "CR-95", modified: "cr1", custom_rfq: "RFQ-95", custom_supplier_quotation: "SQ-270", supplier: source.supplier, company: "Netlink", contract_value: 30, currency: "USD", request_status: "Completed", custom_clm_data: JSON.stringify(requestData) },
    "Request for Quotation/RFQ-95": { name: "RFQ-95", modified: "2026-09-23 11:00:00.654321", contract_required: "Yes", company: "Netlink", status: "Submitted", workflow_state: "Supplier Selected", custom_workflow_step: "Supplier Selected", owner: "manager@test.invalid", custom_approval_data: JSON.stringify({ workflow_step: "Supplier Selected", selection_comments: "Keep these terms", contract_decision: decision }) },
    "Supplier Quotation/SQ-270": { name: "SQ-270", docstatus: 1, supplier: source.supplier, company: "Netlink", currency: "USD", grand_total: 30, items: [{ request_for_quotation: "RFQ-95" }] },
    "Legal Document Review/AWARD-95": { name: "AWARD-95", modified: "2026-09-23 11:00:00.987654", rfq_name: "RFQ-95", sq_name: "SQ-270", company: "Netlink", grand_total: 30, review_status: "Pending", workflow_state: "Pending Review", finance_status: "Pending", current_owner: "Legal Reviewer", untouched: "saved award terms" },
  };
  const deps: RfqClmRestSyncDependencies = {
    load: vi.fn(async (dt, name) => { const row = docs[`${dt}/${name}`]; if (!row) throw new ClmError("Missing fixture document", 404); return structuredClone(row); }),
    list: vi.fn(async (dt, filters) => Object.entries(docs).filter(([key, row]) => key.startsWith(`${dt}/`) && filters.every(raw => { const [field, op, value] = raw as string[]; return op === "=" && row[field] === value; })).map(([, row]) => structuredClone(row))),
    save: vi.fn(async (dt, doc) => {
      const key = `${dt}/${doc.name}`;
      if (doc.modified !== docs[key].modified) throw new ClmError("This record changed. Refresh before saving.", 409);
      docs[key] = structuredClone({ ...doc, modified: `saved-${++sequence}` });
      return structuredClone(docs[key]);
    }),
  };
  return { docs, deps, saved, rfq: () => docs["Request for Quotation/RFQ-95"], award: () => docs["Legal Document Review/AWARD-95"], state: () => JSON.parse(String(docs["Request for Quotation/RFQ-95"].custom_approval_data)).contract_decision.clm };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("REST RFQ Contract lifecycle mirrors", () => {
  it.each([["Draft", "draft"], ["Pending Legal", "legal_review"], ["Approved", "signature"], ["Pending Signature", "signature"], ["Pending Finance", "finance_review"], ["Rejected", "rejected"], ["Expired", "procurement"]])("mirrors %s without advancing existing RFQ or award workflows", async (status, phase) => {
    const m = fixture(contract(status, phase)), before = structuredClone(m.docs);
    expect(await syncRfqClmRestContract(m.saved, m.deps)).toEqual({ synced: true });
    expect(m.state()).toMatchObject({ contract: "CON-95", status, phase, contract_required: "Yes", blocked: true });
    expect(JSON.parse(String(m.award().custom_clm_state))).toMatchObject({ rfq_id: "RFQ-95", award_id: "AWARD-95", ...m.state() });
    const { modified: _rfqModified, custom_approval_data: _rfqApproval, ...rfq } = m.rfq();
    const { modified: _oldRfqModified, custom_approval_data: _oldRfqApproval, ...oldRfq } = before["Request for Quotation/RFQ-95"];
    expect(rfq).toEqual(oldRfq);
    const { modified: _awardModified, custom_clm_state: _awardState, ...award } = m.award();
    const { modified: _oldAwardModified, ...oldAward } = before["Legal Document Review/AWARD-95"];
    expect(award).toEqual(oldAward);
    expect(JSON.parse(String(m.rfq().custom_approval_data))).toMatchObject({ workflow_step: "Supplier Selected", selection_comments: "Keep these terms" });
    expect(m.docs["Contract/CON-95"]).toEqual(before["Contract/CON-95"]);
    expect(m.docs["Contract Request/CR-95"]).toEqual(before["Contract Request/CR-95"]);
  });
  it.each(["Executed", "Active"])("unblocks the %s mirror only after verified signatures and Finance", async status => {
    const m = fixture(contract(status, "procurement"));
    await syncRfqClmRestContract(m.saved, m.deps);
    expect(m.state()).toMatchObject({ status, phase: "procurement", blocked: false, executed_at: "2026-09-23 12:00:04" });
  });
  it("keeps the RFQ gate blocked when Legal has signed and the supplier is still pending", async () => {
    const saved = contract("Pending Signature", "signature"), data = parseClmData(saved.custom_clm_data);
    data.approvals[0] = { ...data.approvals[0], status: "Approved", by: "legal@test.invalid", at: "2026-09-23 12:00:01" };
    data.signatures = [{ party: "inteva", role: "legal", by: "legal@test.invalid", at: "2026-09-23 12:00:02", version: "1.0", hash: "b".repeat(64), file_id: "FILE-LEGAL-FIRST", file_url: "/private/files/legal-first.pdf", typed_name: "Legal" }];
    saved.custom_esign_status = "Pending Supplier";
    saved.custom_clm_data = JSON.stringify(data);
    const m = fixture(saved);
    await syncRfqClmRestContract(saved, m.deps);
    expect(m.state()).toMatchObject({ phase: "signature", status: "Pending Signature", blocked: true });
    expect(m.rfq()).toMatchObject({ workflow_state: "Supplier Selected", custom_workflow_step: "Supplier Selected" });
    expect(m.award()).toMatchObject({ review_status: "Pending", finance_status: "Pending" });
  });
  it.each(["2026-09-23 12:00:02", "2026-09-23 12:00:04"])("releases procurement when Finance follows Legal signature regardless of the later optional supplier signature: %s", async financeAt => {
    const saved = contract("Executed", "procurement"), data = parseClmData(saved.custom_clm_data);
    const [supplier, legal] = data.signatures;
    data.signatures = [{ ...legal, at: "2026-09-23 12:00:02" }, { ...supplier, at: "2026-09-23 12:00:03" }];
    saved.custom_executed_contract = supplier.file_url;
    data.approvals[1].at = financeAt;
    saved.custom_clm_data = JSON.stringify(data);
    const m = fixture(saved);
    await syncRfqClmRestContract(saved, m.deps);
    expect(m.state()).toMatchObject({ phase: "procurement", blocked: false, executed_at: financeAt });
  });
  it("does not release procurement when Finance approval precedes the Legal signature", async () => {
    const saved = contract("Executed", "procurement"), data = parseClmData(saved.custom_clm_data);
    const [supplier, legal] = data.signatures;
    data.signatures = [{ ...legal, at: "2026-09-23 12:00:02" }, { ...supplier, at: "2026-09-23 12:00:03" }];
    saved.custom_executed_contract = supplier.file_url;
    data.approvals[1].at = "2026-09-23 12:00:01.500";
    saved.custom_clm_data = JSON.stringify(data);
    const m = fixture(saved);
    await expect(syncRfqClmRestContract(saved, m.deps)).rejects.toThrow("verified Legal, signature and Finance");
    expect(m.deps.save).not.toHaveBeenCalled();
  });
  it("releases procurement after verified Legal signature and Finance while the supplier signature is pending", async () => {
    const saved = contract("Executed", "procurement"), data = parseClmData(saved.custom_clm_data);
    data.signatures = data.signatures.filter(signature => signature.party === "inteva");
    saved.custom_clm_data = JSON.stringify(data);
    const m = fixture(saved);
    await syncRfqClmRestContract(saved, m.deps);
    expect(m.state()).toMatchObject({ phase: "procurement", blocked: false, executed_at: "2026-09-23 12:00:04" });
  });
  it.each(["finance", "signatures", "locked_hash", "order"])("does not publish an executed/ready mirror with invalid %s evidence", async invalid => {
    const saved = contract("Executed", "procurement"), data = parseClmData(saved.custom_clm_data);
    if (invalid === "finance") data.approvals[1].status = "Pending";
    if (invalid === "signatures") data.signatures.pop();
    if (invalid === "locked_hash") data.locked_hash = "wrong";
    if (invalid === "order") data.approvals[1].at = "2026-09-23 11:00:00";
    saved.custom_clm_data = JSON.stringify(data);
    const m = fixture(saved);
    await expect(syncRfqClmRestContract(saved, m.deps)).rejects.toThrow("verified Legal, signature and Finance");
    expect(m.deps.save).not.toHaveBeenCalled();
  });
  it("carries the final procurement receipt into both mirrors without changing PO data", async () => {
    const saved = contract("Executed", "completed"), data = parseClmData(saved.custom_clm_data);
    data.procurement_completion = { purchase_order: "PO-95", by: "team@test.invalid", role: "procurement_team", at: "2026-09-23 12:00:05", rfq: "RFQ-95", award: "AWARD-95", supplier: source.supplier, quotation: "SQ-270" };
    saved.custom_clm_data = JSON.stringify(data);
    const m = fixture(saved);
    await syncRfqClmRestContract(saved, m.deps);
    expect(m.state()).toMatchObject({ procurement_status: "Completed", procurement_completion: data.procurement_completion, blocked: false });
    expect(vi.mocked(m.deps.save).mock.calls.map(([dt]) => dt)).toEqual(["Request for Quotation", "Legal Document Review"]);
  });
  it("keeps a cancelled signed Contract blocked", async () => {
    const m = fixture({ ...contract("Executed", "procurement"), docstatus: 2 });
    await syncRfqClmRestContract(m.saved, m.deps);
    expect(m.state()).toMatchObject({ status: "Cancelled", blocked: true });
    expect(m.state()).not.toHaveProperty("executed_at");
  });
  it("uses the fresh saved Contract instead of an older caller snapshot", async () => {
    const m = fixture(contract("Rejected", "rejected"));
    await syncRfqClmRestContract(contract("Executed", "procurement"), m.deps);
    expect(m.state()).toMatchObject({ status: "Rejected", blocked: true });
  });
  it("is a no-op when a prior REST retry already wrote the same mirrors", async () => {
    const m = fixture();
    await syncRfqClmRestContract(m.saved, m.deps);
    vi.mocked(m.deps.save).mockClear();
    await syncRfqClmRestContract(m.saved, m.deps);
    expect(m.deps.save).not.toHaveBeenCalled();
  });
  it("skips only an initial unlinked Draft, never a Legal review without its decision", async () => {
    const m = fixture(contract("Draft", "draft"));
    m.rfq().custom_approval_data = "{}";
    expect(await syncRfqClmRestContract(m.saved, m.deps)).toEqual({ synced: false });
    expect(m.deps.save).not.toHaveBeenCalled();
    m.docs["Contract/CON-95"] = contract();
    await expect(syncRfqClmRestContract(m.docs["Contract/CON-95"], m.deps)).rejects.toThrow("Persist the RFQ Yes decision");
  });
  it("does not contact ERP for a standalone Contract", async () => {
    const m = fixture();
    expect(await syncRfqClmRestContract({ name: "STANDALONE" }, m.deps)).toEqual({ synced: false });
    expect(m.deps.load).not.toHaveBeenCalled();
  });
  it("leaves an existing unmarked RFQ Contract's native workflow unchanged", async () => {
    const m = fixture(), data = parseClmData(m.saved.custom_clm_data); delete data.persistence;
    expect(await syncRfqClmRestContract({ ...m.saved, custom_clm_data: JSON.stringify(data) }, m.deps)).toEqual({ synced: false });
    expect(m.deps.load).not.toHaveBeenCalled();
    expect(m.deps.save).not.toHaveBeenCalled();
  });
  it.each([
    ["Contract Request/CR-95", "supplier", "OTHER"],
    ["Contract Request/CR-95", "custom_rfq", "OTHER"],
    ["Contract Request/CR-95", "contract_value", 99],
    ["Request for Quotation/RFQ-95", "contract_required", "No"],
    ["Supplier Quotation/SQ-270", "docstatus", 0],
    ["Supplier Quotation/SQ-270", "supplier", "OTHER"],
    ["Legal Document Review/AWARD-95", "sq_name", "OTHER"],
    ["Legal Document Review/AWARD-95", "grand_total", 99],
  ])("refuses changed authoritative linkage %s.%s before mirror writes", async (key, field, value) => {
    const m = fixture(); m.docs[String(key)][String(field)] = value;
    await expect(syncRfqClmRestContract(m.saved, m.deps)).rejects.toMatchObject({ status: 409 });
    expect(m.deps.save).not.toHaveBeenCalled();
  });
  it("does not arbitrarily choose a duplicate Contract", async () => {
    const m = fixture(); m.docs["Contract/CON-OTHER"] = { ...m.saved, name: "CON-OTHER" };
    await expect(syncRfqClmRestContract(m.saved, m.deps)).rejects.toThrow("Exactly one");
    expect(m.deps.save).not.toHaveBeenCalled();
  });
  it("retries a stale RFQ revision while preserving unrelated concurrent changes", async () => {
    const m = fixture(), save = m.deps.save; let conflict = true;
    m.deps.save = vi.fn(async (dt, doc) => {
      if (dt === "Request for Quotation" && conflict) {
        conflict = false;
        const data = JSON.parse(String(m.rfq().custom_approval_data)); data.concurrent_note = "Keep new note";
        Object.assign(m.rfq(), { modified: "concurrent", custom_approval_data: JSON.stringify(data) });
        throw new ClmError("This record changed. Refresh before saving.", 409);
      }
      return save(dt, doc);
    });
    await syncRfqClmRestContract(m.saved, m.deps);
    expect(JSON.parse(String(m.rfq().custom_approval_data)).concurrent_note).toBe("Keep new note");
    expect(m.state().status).toBe("Pending Legal");
  });
  it.each(["Request for Quotation", "Legal Document Review"])("recovers a committed %s mirror whose response was lost without duplicate writes", async lostType => {
    const m = fixture(), save = m.deps.save; let lost = false;
    m.deps.save = vi.fn(async (dt, doc) => {
      const saved = await save(dt, doc);
      if (dt === lostType && !lost) { lost = true; throw new ClmError("Timeout", 504); }
      return saved;
    });
    expect(await syncRfqClmRestContract(m.saved, m.deps)).toEqual({ synced: true });
    expect(vi.mocked(m.deps.save).mock.calls.filter(([dt]) => dt === lostType)).toHaveLength(1);
  });
  it("recomputes mirrors when another legitimate Contract action wins during synchronization", async () => {
    const m = fixture(), save = m.deps.save; let changed = false;
    m.deps.save = vi.fn(async (dt, doc) => {
      const result = await save(dt, doc);
      if (!changed && dt === "Request for Quotation") { changed = true; m.docs["Contract/CON-95"] = { ...contract("Rejected", "rejected"), modified: "new-contract-revision" }; }
      return result;
    });
    await syncRfqClmRestContract(m.saved, m.deps);
    expect(m.state()).toMatchObject({ status: "Rejected", blocked: true });
    expect(JSON.parse(String(m.award().custom_clm_state)).status).toBe("Rejected");
  });
  it("reports a saved Contract but unconfirmed mirrors when ERP drops a schema field", async () => {
    const m = fixture(), save = m.deps.save;
    m.deps.save = vi.fn(async (dt, doc) => { const result = await save(dt, doc); if (dt === "Legal Document Review") delete m.award().custom_clm_state; return result; });
    await expect(syncRfqClmRestContract(m.saved, m.deps)).rejects.toThrow("Contract was saved, but its RFQ/Award lifecycle synchronization could not be confirmed");
    expect(m.docs["Contract/CON-95"]).toEqual(m.saved);
    expect(m.rfq().status).toBe("Submitted");
  });
  it("integrates standard REST mirrors after the real Contract save and preserves microsecond revisions", async () => {
    const m = fixture();
    m.docs["Contract/CON-95"] = encodeRfqClmRestContract(m.saved);
    vi.stubEnv("ERPNEXT_URL", "https://rest-sync.test"); vi.stubEnv("ERP_API_KEY", "fixture"); vi.stubEnv("ERP_API_SECRET", "fixture");
    const transport = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(String(input)), path = decodeURIComponent(url.pathname).replace(/^\/api\//, "");
      if (url.origin !== "https://rest-sync.test") throw new Error("Unexpected nonfixture host");
      if (path === "method/frappe.client.save") {
        const { doc } = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ message: await m.deps.save(doc.doctype, doc) }), { headers: { "Content-Type": "application/json" } });
      }
      const [dt, name] = path.replace(/^resource\//, "").split("/");
      const data = name ? await m.deps.load(dt, name) : await m.deps.list(dt, JSON.parse(url.searchParams.get("filters") || "[]"));
      return new Response(JSON.stringify({ data }), { headers: { "Content-Type": "application/json" } });
    });
    const result = await createClmDependencies().save("Contract", m.saved);
    expect(result.name).toBe("CON-95");
    expect(result.custom_contract_status).toBe("Pending Legal");
    expect(m.docs["Contract/CON-95"].custom_contract_status).toBe("Under Review");
    expect(m.state()).toMatchObject({ status: "Pending Legal", blocked: true });
    const writes = transport.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(writes.map(([, init]) => JSON.parse(String(init?.body)).doc.doctype)).toEqual(["Contract", "Request for Quotation", "Legal Document Review"]);
    expect(writes.every(([input]) => String(input).endsWith("method/frappe.client.save"))).toBe(true);
    expect(JSON.parse(String(writes[0][1]?.body)).doc.modified).toBe("2026-09-23 12:00:00.123456");
    expect(JSON.parse(String(writes[1][1]?.body)).doc.modified).toBe("2026-09-23 11:00:00.654321");
  });
});
