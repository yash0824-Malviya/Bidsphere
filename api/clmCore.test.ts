import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { applyClmAction, canReadClm, clmSnapshotHash, generateClmApprovals, parseClmData, rfqClmFinanceApproved, toClmAggregate, type ClmDeps } from "./clmCore";
import type { AccessPrincipal, AppRole } from "./rbacAuth";
import type { ClmActionName, ClmDoctype, ClmRecord, ClmSignature } from "../src/types/clm";

const internal = (role: AppRole, email = `${role}@example.com`): AccessPrincipal => ({ typ: "internal", role, email, sub: email, iat: 1, exp: Number.MAX_SAFE_INTEGER });
const supplier: AccessPrincipal = { typ: "supplier", supplier: "SUP-1", sub: "supplier-user", iat: 1, exp: Number.MAX_SAFE_INTEGER };
const manager = internal("procurement");
const team = internal("procurement_team");
const finance = internal("finance");
const legal = internal("legal");
const signatory = internal("program_manager");
const legalSignature = (name = "Legal") => ({ full_legal_name: "Legal Reviewer", signature: { method: "typed", value: name, adopted: true }, consent: true });
const contract: ClmRecord = { name: "CON-1", modified: "1", party_type: "Supplier", party_name: "SUP-1", custom_supplier: "SUP-1", custom_contract_title: "Supply agreement", custom_contract_type: "Supply", custom_contract_value: 250, custom_currency: "USD", custom_risk_level: "Low", contract_terms: "Deliver conforming parts", start_date: "2026-01-01", end_date: "2026-12-31", custom_inteva_signatory: "program_manager@example.com", custom_contract_status: "Draft", custom_approval_status: "Pending" };
const rule = (overrides: ClmRecord = {}): ClmRecord => ({ name: "RULE-1", active: 1, contract_type: "All", risk_level: "Any", minimum_contract_value: 0, maximum_contract_value: 0, approval_sequence: "Sequential", custom_approval_stages: JSON.stringify([{ role: "finance", stage: 0 }, { role: "legal", stage: 1 }]), ...overrides });
function memory(rules = [rule()]) {
  const docs = new Map<string, ClmRecord>();
  const put = (dt: string, doc: ClmRecord) => { const saved = structuredClone(doc); docs.set(`${dt}/${doc.name}`, saved); return saved; };
  put("Contract", contract); put("Supplier", { name: "SUP-1", disabled: 0 });
  put("Supplier", { name: "SUP-2", disabled: 0 });
  for (const item of rules) put("Contract Approval Matrix", item);
  let sequence = 1; let now = "2026-09-17 10:00:00";
  const deps: ClmDeps = {
    load: vi.fn(async (dt, name) => { const found = docs.get(`${dt}/${name}`); if (!found) throw new Error(`Missing ${dt}/${name}`); return structuredClone(found); }),
    list: vi.fn(async (dt: string, filters: unknown[] = []) => [...docs.entries()].filter(([key]) => key.startsWith(`${dt}/`)).map(([, doc]) => structuredClone(doc)).filter(doc => filters.every(filter => { const [field, op, value] = filter as unknown[]; return op !== "=" || doc[String(field)] === value; }))),
    create: vi.fn(async (dt, doc) => put(dt, { ...doc, name: `${dt}-${++sequence}`, modified: String(sequence) })),
    save: vi.fn(async (dt, doc) => { const current = docs.get(`${dt}/${doc.name}`); if (current?.modified !== doc.modified) throw new Error("Concurrent save"); return put(dt, { ...doc, modified: String(++sequence) }); }),
    now: () => now,
    lock: vi.fn(async () => ({ file_id: "LOCKED", file_url: "/private/files/locked.pdf", hash: "a".repeat(64) })),
    sign: vi.fn(async (doc: ClmRecord, actor: AccessPrincipal, payload: ClmRecord): Promise<ClmSignature> => ({ party: actor.typ === "supplier" ? "supplier" : "inteva", by: actor.typ === "supplier" ? actor.sub : actor.email, at: now, version: String(doc.custom_current_version), hash: "b".repeat(64), file_id: `SIGNED-${actor.typ}`, file_url: `/private/files/${actor.typ}.pdf`, typed_name: String((payload.signature as ClmRecord | undefined)?.value || payload.typed_name), ...(payload.signature ? { full_legal_name: String(payload.full_legal_name), signature_method: "typed" as const, signature_adopted: true as const } : {}) })),
    notify: vi.fn(async () => undefined), closureBlockers: vi.fn(async () => []),
  };
  const get = (dt = "Contract", name = "CON-1") => structuredClone(docs.get(`${dt}/${name}`)!);
  const act = async (action: ClmActionName, who = manager, payload: ClmRecord = {}, comment = "Review rationale", dt: ClmDoctype = "Contract", name = "CON-1") => applyClmAction({ doctype: dt, name, expected_modified: get(dt, name).modified, action, payload, comment }, who, deps);
  return { docs, deps, put, get, act, setNow: (value: string) => { now = value; } };
}
async function approve(m: ReturnType<typeof memory>) { await m.act("submit_review"); await m.act("approve", finance); await m.act("approve", legal); }
async function execute(m: ReturnType<typeof memory>) { await approve(m); await m.act("begin_signature"); await m.act("sign", supplier, { typed_name: "Supplier signer", consent: true }); await m.act("sign", signatory, { typed_name: "Inteva signer", consent: true }); }

function rfqMemory() {
  const m = memory();
  m.put("Request for Quotation", { name: "RFQ-1", company: "Netlink", contract_required: "Yes", custom_selected_supplier: "SUP-1", custom_approval_data: JSON.stringify({ contract_decision: { decision: "Yes", contract: "CON-1", supplier: "SUP-1", quotation: "SQ-1", award: "AWARD-1" } }) });
  m.put("Supplier Quotation", { name: "SQ-1", docstatus: 1, company: "Netlink", supplier: "SUP-1", request_for_quotation: "RFQ-1" });
  m.put("User", { name: "legal@example.com", enabled: 1, roles: [{ role: "Legal Manager" }] });
  const data = parseClmData(null);
  data.rfq_source = { rfq: "RFQ-1", supplier: "SUP-1", quotation: "SQ-1", award: "AWARD-1", contract_required: true };
  data.rfq_workflow = { version: 1, phase: "draft" };
  m.put("Contract", { ...contract, custom_rfq: "RFQ-1", custom_supplier_quotation: "SQ-1", custom_inteva_signatory: "legal@example.com", custom_clm_data: JSON.stringify(data) });
  return m;
}
async function rfqSign(m: ReturnType<typeof memory>) {
  await m.act("submit_review", team);
  await m.act("approve", legal);
  await m.act("begin_signature", legal);
  await m.act("sign", legal, legalSignature("Legal signer"));
}
describe("RFQ Contract sequential ownership", () => {
  it.each([
    ["legacy name-only payload", { typed_name: "Legal Reviewer", consent: true }],
    ["full name only", { full_legal_name: "Legal Reviewer", consent: true }],
    ["missing full name", { signature: { method: "typed", value: "L. Reviewer", adopted: true }, consent: true }],
    ["unadopted signature", { ...legalSignature(), signature: { method: "typed", value: "L. Reviewer", adopted: false } }],
    ["unsupported method", { ...legalSignature(), signature: { method: "draw", value: "L. Reviewer", adopted: true } }],
    ["blank signature", { ...legalSignature(), signature: { method: "typed", value: "  ", adopted: true } }],
    ["non-text signature", { ...legalSignature(), signature: { method: "typed", value: 123, adopted: true } }],
    ["missing consent", { ...legalSignature(), consent: false }],
  ])("rejects RFQ Legal %s before creating any signature or changing the Contract", async (_label, payload) => {
    const m = rfqMemory(); await m.act("submit_review", team); await m.act("approve", legal); await m.act("begin_signature", legal);
    const before = m.get(), saveCount = vi.mocked(m.deps.save).mock.calls.length;
    await expect(m.act("sign", legal, payload as ClmRecord)).rejects.toMatchObject({ status: 422 });
    expect(m.deps.sign).not.toHaveBeenCalled(); expect(m.get()).toEqual(before);
    expect(m.deps.save).toHaveBeenCalledTimes(saveCount);
  });
  it("rejects a PDF signer receipt that did not retain the separately adopted signature", async () => {
    const m = rfqMemory(); await m.act("submit_review", team); await m.act("approve", legal); await m.act("begin_signature", legal);
    const sign = m.deps.sign!, before = m.get();
    m.deps.sign = async (...args) => { const result = await sign(...args); delete result.signature_adopted; return result; };
    await expect(m.act("sign", legal, legalSignature())).rejects.toMatchObject({ status: 502, message: expect.stringContaining("captured signature evidence") });
    expect(m.get()).toEqual(before);
  });
  it("keeps already-persisted historical Legal signatures valid for supplier completion", async () => {
    const m = rfqMemory(); await m.act("submit_review", team); await m.act("approve", legal); await m.act("begin_signature", legal);
    await m.act("sign", legal, legalSignature());
    const data = parseClmData(m.get().custom_clm_data);
    delete data.signatures[0].full_legal_name; delete data.signatures[0].signature_method; delete data.signatures[0].signature_adopted;
    m.put("Contract", { ...m.get(), custom_clm_data: JSON.stringify(data) });
    expect(toClmAggregate(legal, "Contract", m.get()).signature_workflow).toMatchObject({ legal_status: "Signed", can_sign: false });
    await expect(m.act("sign", supplier, { typed_name: "Supplier", consent: true })).rejects.toMatchObject({ status: 403 });
    expect(m.get().custom_contract_status).toBe("Pending Finance");
  });
  it("allows the assigned Legal Manager to sign while the supplier is still pending", async () => {
    const m = rfqMemory();
    await m.act("submit_review", team); await m.act("approve", legal);
    const beforeRequest = toClmAggregate(legal, "Contract", m.get());
    expect(beforeRequest.signature_workflow).toMatchObject({ supplier_status: "Pending", legal_status: "Pending", is_legal_signatory: true, can_review: true, can_request_signatures: true, can_sign: false, document_file_id: "LOCKED" });
    await m.act("begin_signature", legal);
    const waiting = toClmAggregate(legal, "Contract", m.get());
    expect(waiting.signature_workflow).toMatchObject({ supplier_status: "Pending", legal_status: "Pending", is_legal_signatory: true, can_review: true, can_request_signatures: false, can_sign: true });
    expect(waiting.signature_workflow?.blocked_reason).toBeUndefined();
    expect(waiting.actions.map(row => row.action)).toEqual(["sign"]);
    for (const who of [manager, team, finance, internal("admin"), internal("legal", "other-legal@example.com"), internal("finance", "legal@example.com")]) {
      expect(toClmAggregate(who, "Contract", m.get()).signature_workflow).toMatchObject({ is_legal_signatory: false, can_review: false, can_request_signatures: false, can_sign: false });
    }
    expect(toClmAggregate(supplier, "Contract", m.get()).signature_workflow).toBeUndefined();
    await expect(m.act("sign", supplier, { typed_name: "Supplier", consent: true })).rejects.toMatchObject({ status: 403 });
    const ready = toClmAggregate(legal, "Contract", m.get());
    expect(ready.signature_workflow).toMatchObject({ supplier_status: "Pending", legal_status: "Pending", is_legal_signatory: true, can_review: true, can_sign: true, document_file_id: "LOCKED" });
    expect(ready.signature_workflow?.blocked_reason).toBeUndefined();
    expect(ready.actions.map(row => row.action)).toEqual(["sign"]);
  });
  it("limits signature requests to the assigned Legal Manager", async () => {
    const m = rfqMemory(); await m.act("submit_review", team); await m.act("approve", legal);
    const other = internal("legal", "other-legal@example.com");
    expect(toClmAggregate(other, "Contract", m.get()).actions).toEqual([]);
    await expect(m.act("begin_signature", other)).rejects.toMatchObject({ status: 403 });
  });
  it.each(["draft", "legal_review", "finance_review", "procurement", "completed", "rejected"] as const)("does not sign a stale signature status during %s", async phase => {
    const m = rfqMemory(); await m.act("submit_review", team); await m.act("approve", legal); await m.act("begin_signature", legal);
    const data = parseClmData(m.get().custom_clm_data); data.rfq_workflow = { version: 1, phase };
    m.put("Contract", { ...m.get(), custom_clm_data: JSON.stringify(data) });
    expect(toClmAggregate(legal, "Contract", m.get()).signature_workflow).toBeUndefined();
    expect(toClmAggregate(supplier, "Contract", m.get()).actions).toEqual([]);
    await expect(m.act("sign", supplier, { typed_name: "Supplier", consent: true })).rejects.toMatchObject({ status: 403 });
    expect(m.deps.sign).not.toHaveBeenCalled();
  });
  it("keeps unversioned RFQ signature records signable and persists their existing signature phase", async () => {
    const m = rfqMemory(); await m.act("submit_review", team); await m.act("approve", legal); await m.act("begin_signature", legal);
    const data = parseClmData(m.get().custom_clm_data); delete data.rfq_workflow;
    m.put("Contract", { ...m.get(), custom_clm_data: JSON.stringify(data) });
    expect(toClmAggregate(legal, "Contract", m.get()).signature_workflow?.can_review).toBe(true);
    await expect(m.act("sign", supplier, { typed_name: "Supplier", consent: true })).rejects.toMatchObject({ status: 403 });
    await m.act("sign", legal, legalSignature());
    expect(parseClmData(m.get().custom_clm_data).rfq_workflow).toEqual({ version: 1, phase: "finance_review" });
    expect(m.get().custom_contract_status).toBe("Pending Finance");
  });
  it("persists the Legal signature receipt and append-only audit before the Finance handoff", async () => {
    const m = rfqMemory(); await m.act("submit_review", team); await m.act("approve", legal); await m.act("begin_signature", legal);
    await expect(m.act("sign", supplier, { typed_name: "Supplier", consent: true })).rejects.toMatchObject({ status: 403 });
    const prior = parseClmData(m.get().custom_clm_data); vi.mocked(m.deps.notify!).mockClear();
    await m.act("sign", legal, legalSignature(), "  Approved contract reviewed for electronic execution.  ");
    const saved = m.get(), data = parseClmData(saved.custom_clm_data), receipt = data.signatures.at(-1)!;
    expect(receipt).toMatchObject({ full_legal_name: "Legal Reviewer", typed_name: "Legal", by: "legal@example.com", role: "legal", version: "1.0", signature_comment: "Approved contract reviewed for electronic execution." });
    expect(data.audit.slice(0, prior.audit.length)).toEqual(prior.audit);
    expect(data.audit.find(row => row.action === "e_signed" && row.role === "legal")).toMatchObject({ by: "legal@example.com", at: receipt.at, contract_id: "CON-1", reference_id: "CON-1", signature_status: "Signed", signature_party: "inteva", signature_file_id: receipt.file_id, signature_hash: receipt.hash, comment: receipt.signature_comment });
    expect(saved).toMatchObject({ custom_contract_status: "Pending Finance", custom_esign_status: "Completed", custom_executed_contract: receipt.file_url, is_signed: 1, signed_by_company: "legal@example.com" });
    expect(data.rfq_workflow?.phase).toBe("finance_review");
    expect(toClmAggregate(legal, "Contract", saved).signature_workflow).toMatchObject({ supplier_status: "Pending", legal_status: "Signed", can_sign: false, can_review: true });
    expect(m.deps.notify).toHaveBeenCalledWith("Contract", saved, "sign", [expect.objectContaining({ role: "finance", status: "Pending" })]);
  });
  it("advances after Legal signing but reserves supplier acceptance/signing for the created PO", async () => {
    const m = rfqMemory(); await rfqSign(m);
    const saved = m.get(), before = parseClmData(saved.custom_clm_data);
    expect(saved.custom_contract_status).toBe("Pending Finance");
    expect(toClmAggregate(supplier, "Contract", saved).actions).toEqual([]);
    await expect(m.act("sign", supplier, { typed_name: "Supplier", consent: true })).rejects.toMatchObject({ status: 403 });
    expect(m.get()).toEqual(saved);
    await m.act("approve", finance);
    expect(rfqClmFinanceApproved(m.get())).toBe(true);
    expect(toClmAggregate(supplier, "Contract", m.get()).actions).toEqual([]);
    await expect(m.act("supplier_accept", supplier, { consent: true })).rejects.toMatchObject({ status: 403 });
    const data = parseClmData(m.get().custom_clm_data);
    expect(data.signatures).toEqual(before.signatures);
    expect(data.audit.filter(row => row.action === "finance_review_started")).toHaveLength(1);
    expect(toClmAggregate(team, "Contract", m.get()).actions.map(row => row.action)).toEqual(["activate", "finalize_procurement"]);
  });
  it.each(["signer", "persistence"])("keeps the supplier and Finance pending if Legal-first %s fails", async failure => {
    const m = rfqMemory(); await m.act("submit_review", team); await m.act("approve", legal); await m.act("begin_signature", legal);
    const before = m.get(); vi.mocked(m.deps.notify!).mockClear();
    if (failure === "signer") m.deps.sign = vi.fn(async () => { throw new Error("Signature PDF storage failed"); });
    else m.deps.save = vi.fn(async () => { throw new Error("Contract evidence persistence failed"); });
    await expect(m.act("sign", legal, legalSignature())).rejects.toThrow(/failed/);
    expect(m.get()).toEqual(before); expect(m.deps.notify).not.toHaveBeenCalled();
  });
  it("does not report a signed Contract or notify Finance when Contract persistence fails", async () => {
    const m = rfqMemory(); await m.act("submit_review", team); await m.act("approve", legal); await m.act("begin_signature", legal);
    await expect(m.act("sign", supplier, { typed_name: "Supplier", consent: true })).rejects.toMatchObject({ status: 403 });
    const before = m.get(); vi.mocked(m.deps.notify!).mockClear();
    m.deps.save = vi.fn(async () => { throw new Error("ERP Contract save failed"); });
    await expect(m.act("sign", legal, legalSignature())).rejects.toThrow("ERP Contract save failed");
    expect(m.get()).toEqual(before); expect(m.deps.notify).not.toHaveBeenCalled();
  });
  it("gates related-record edits and visible actions until the Team owns the Contract stage", async () => {
    const m = rfqMemory();
    const payload = { contract: "CON-1", risk_title: "Delivery", risk_description: "Delivery evidence", risk_status: "Open" };
    const saved = await applyClmAction({ doctype: "Contract Risk", action: "save", payload }, team, m.deps);
    const child = saved.record;
    expect(toClmAggregate(team, "Contract Risk", child, undefined, m.get()).actions.map(row => row.action)).toContain("save");
    expect(toClmAggregate(manager, "Contract Risk", child, undefined, m.get()).actions.map(row => row.action)).toContain("save");
    await applyClmAction({ doctype: "Contract Risk", action: "save", payload }, manager, m.deps);
    for (const who of [internal("admin")]) {
      expect(toClmAggregate(who, "Contract Risk", child, undefined, m.get()).actions).toEqual([]);
      await expect(applyClmAction({ doctype: "Contract Risk", action: "save", payload }, who, m.deps)).rejects.toMatchObject({ status: 403 });
    }
    await m.act("submit_review", team);
    expect(toClmAggregate(team, "Contract Risk", child, undefined, m.get()).actions).toEqual([]);
    await expect(m.act("save", team, {}, "", "Contract Risk", String(child.name))).rejects.toMatchObject({ status: 403 });
    await m.act("approve", legal); await m.act("begin_signature", legal);
    await expect(m.act("sign", supplier, { typed_name: "Supplier", consent: true })).rejects.toMatchObject({ status: 403 });
    await m.act("sign", legal, legalSignature());
    expect(toClmAggregate(team, "Contract Risk", child, undefined, m.get()).actions).toEqual([]);
    await expect(m.act("save", team, {}, "", "Contract Risk", String(child.name))).rejects.toMatchObject({ status: 403 });
    await m.act("approve", finance);
    expect(toClmAggregate(team, "Contract Risk", child, undefined, m.get()).actions.map(row => row.action)).toContain("save");
    expect(toClmAggregate(manager, "Contract Risk", child, undefined, m.get()).actions).toEqual([]);
    await expect(applyClmAction({ doctype: "Contract Risk", action: "save", payload }, manager, m.deps)).rejects.toMatchObject({ status: 403 });
    await m.act("save", team, { risk_description: "Reviewed delivery evidence" }, "", "Contract Risk", String(child.name));
    const standalone = { ...m.get(), custom_rfq: "" };
    expect(toClmAggregate(manager, "Contract Risk", child, undefined, standalone).actions.map(row => row.action)).toContain("save");
  });
  it.each([internal("admin"), finance, legal, signatory])("denies Draft creation/authoring to $role", async who => {
    const m = rfqMemory();
    expect(toClmAggregate(who, "Contract", m.get()).actions).toEqual([]);
    await expect(m.act("save", who, { contract_terms: "Changed" })).rejects.toMatchObject({ status: 403 });
    await expect(m.act("submit_review", who)).rejects.toMatchObject({ status: 403 });
    expect(m.deps.save).not.toHaveBeenCalled();
  });
  it("lets Procurement Manager author the RFQ Contract draft and hand it to the unchanged Legal stage", async () => {
    const m = rfqMemory();
    expect(toClmAggregate(manager, "Contract", m.get()).actions.map(row => row.action)).toContain("save");
    await m.act("save", manager, { contract_terms: "Manager prepared awarded supply terms" });
    await m.act("submit_review", manager);
    expect(m.get().custom_contract_status).toBe("Pending Legal");
    expect(parseClmData(m.get().custom_clm_data).approvals.map(row => row.role)).toEqual(["legal"]);
    expect(toClmAggregate(manager, "Contract", m.get()).actions).toEqual([]);
    await expect(m.act("approve", manager)).rejects.toMatchObject({ status: 403 });
  });
  it("requires an enabled Legal Manager as company signatory", async () => {
    const m = rfqMemory(); m.put("User", { name: "legal@example.com", enabled: 1, roles: [{ role: "Finance Manager" }] });
    await expect(m.act("submit_review", team)).rejects.toThrow("Legal Manager");
    expect(m.deps.save).not.toHaveBeenCalled();
  });
  it("enforces Team → Legal → signatures → Finance → Team with no parallel action", async () => {
    const m = rfqMemory();
    await m.act("submit_review", team);
    expect(m.get().custom_contract_status).toBe("Pending Legal");
    expect(parseClmData(m.get().custom_clm_data).approvals.map(row => row.role)).toEqual(["legal"]);
    expect(canReadClm(finance, "Contract", m.get())).toBe(true);
    for (const who of [manager, team, finance]) expect(toClmAggregate(who, "Contract", m.get()).actions).toEqual([]);
    await expect(m.act("approve", finance)).rejects.toMatchObject({ status: 403 });
    await m.act("approve", legal);
    await expect(m.act("begin_signature", team)).rejects.toMatchObject({ status: 403 });
    await m.act("begin_signature", legal);
    expect(toClmAggregate(legal, "Contract", m.get()).actions.map(row => row.action)).toEqual(["sign"]);
    await expect(m.act("sign", supplier, { consent: true, typed_name: "Supplier" })).rejects.toMatchObject({ status: 403 });
    await expect(m.act("sign", internal("finance", "legal@example.com"), { consent: true, typed_name: "Legal" })).rejects.toMatchObject({ status: 403 });
    await m.act("sign", legal, legalSignature());
    expect(m.get()).toMatchObject({ custom_contract_status: "Pending Finance", custom_esign_status: "Completed" });
    expect(rfqClmFinanceApproved(m.get())).toBe(false);
    for (const who of [manager, team, legal, supplier]) expect(toClmAggregate(who, "Contract", m.get()).actions).toEqual([]);
    expect(toClmAggregate(finance, "Contract", m.get()).actions.map(row => row.action)).toEqual(["approve", "reject", "send_back"]);
    await m.act("approve", finance, {}, "Financial review complete");
    expect(m.get().custom_contract_status).toBe("Executed");
    expect(rfqClmFinanceApproved(m.get())).toBe(true);
    expect(toClmAggregate(team, "Contract", m.get()).actions.map(row => row.action)).toEqual(["activate", "finalize_procurement"]);
    expect(toClmAggregate(manager, "Contract", m.get()).actions).toEqual([]);
    expect(m.deps.lock).toHaveBeenCalledTimes(1);
    const data = parseClmData(m.get().custom_clm_data);
    expect(data.audit.at(-1)).toMatchObject({ by: "finance@example.com", role: "finance", reference_id: "CON-1", action: "finance_approved", previous_status: "Pending Finance", new_status: "Finance Approved" });
    expect(data.approvals.map(row => [row.role, row.status])).toEqual([["legal", "Approved"], ["finance", "Approved"]]);
  });
  it.each(["reject", "send_back"] as const)("Finance %s preserves terms, signature files and audit", async decision => {
    const m = rfqMemory(); await rfqSign(m);
    const before = parseClmData(m.get().custom_clm_data);
    await m.act(decision, finance, {}, "Correct financial terms");
    const saved = m.get(); const data = parseClmData(saved.custom_clm_data);
    expect(saved.contract_terms).toBe(contract.contract_terms);
    expect(saved.custom_contract_status).toBe(decision === "reject" ? "Rejected" : "Draft");
    expect(rfqClmFinanceApproved(saved)).toBe(false);
    expect(data.audit.slice(0, before.audit.length)).toEqual(before.audit);
    if (decision === "send_back") {
      expect(data.signatures).toEqual([]);
      expect(data.review_history).toEqual([expect.objectContaining({ signatures: before.signatures, approvals: expect.arrayContaining([expect.objectContaining({ role: "finance", status: "Sent Back" })]) })]);
      await m.act("submit_review", team);
      expect(m.get().custom_contract_status).toBe("Pending Legal");
    } else {
      expect(data.signatures).toEqual(before.signatures);
      expect(toClmAggregate(team, "Contract", saved).actions).toEqual([]);
    }
  });
  it("rejects Finance review if the signed content or signature chronology changed", async () => {
    const m = rfqMemory(); await rfqSign(m);
    const good = m.get();
    m.put("Contract", { ...good, contract_terms: "Edited after signing" });
    await expect(m.act("approve", finance)).rejects.toMatchObject({ status: 403 });
    const data = parseClmData(good.custom_clm_data); data.signatures[0].at = "2026-01-01 00:00:00";
    m.put("Contract", { ...good, custom_clm_data: JSON.stringify(data) });
    await expect(m.act("approve", finance)).rejects.toMatchObject({ status: 403 });
  });
  it.each(["approve", "reject", "send_back"] as const)("preserves executed evidence when Legal handles a later termination: %s", async decision => {
    const m = rfqMemory(); await rfqSign(m); await m.act("approve", finance); await m.act("activate", team);
    const executed = parseClmData(m.get().custom_clm_data);
    await m.act("request_termination", team, {}, "Contract termination request");
    expect(toClmAggregate(finance, "Contract", m.get()).actions).toEqual([]);
    await m.act(decision, legal, {}, "Legal termination decision");
    const data = parseClmData(m.get().custom_clm_data);
    expect(m.get().custom_contract_status).toBe(decision === "approve" ? "Terminated" : "Active");
    expect(data.approvals).toEqual(executed.approvals);
    expect(data.signatures).toEqual(executed.signatures);
    expect(data.termination_decision).toMatchObject({ approval: { role: "legal", by: "legal@example.com" } });
  });
});

describe("RFQ Contract procurement completion", () => {
  const order = { name: "PO-1", docstatus: 1, status: "To Receive and Bill", supplier: "SUP-1", company: "Netlink", currency: "USD", grand_total:250, custom_clm_contract:"CON-1",custom_clm_rfq:"RFQ-1",custom_clm_award:"AWARD-1",custom_clm_creation_key:createHash("sha256").update("CON-1|AWARD-1|SQ-1").digest("hex"), items: [{ supplier_quotation: "SQ-1", qty: 20 }] };
  async function ready() { const m = rfqMemory(); await rfqSign(m); await m.act("approve", finance); m.put("Purchase Order", order); const record=m.get(),data=parseClmData(record.custom_clm_data); data.procurement_order={id:"OP-1",state:"submitted",by:team.sub,role:"procurement_team",contract:"CON-1",rfq:"RFQ-1",award:"AWARD-1",quotation:"SQ-1",supplier:"SUP-1",purchase_order:"PO-1"};m.put("Contract",{...record,custom_clm_data:JSON.stringify(data)});return m; }
  it("records completion against a real submitted awarded PO and retains the signed contract lifecycle", async () => {
    const m = await ready(); const before = m.get(); const original = parseClmData(before.custom_clm_data);
    const saved = await m.act("finalize_procurement", team, { purchase_order: "PO-1" }, "PO submitted through existing procurement flow");
    const data = parseClmData(saved.record.custom_clm_data);
    expect(saved.record.custom_contract_status).toBe("Executed"); expect(data.rfq_workflow?.phase).toBe("completed");
    expect(data.procurement_completion).toMatchObject({ purchase_order: "PO-1", by: "procurement_team@example.com", role: "procurement_team", rfq: "RFQ-1", award: "AWARD-1", supplier: "SUP-1", quotation: "SQ-1" });
    expect(data.audit.slice(0, original.audit.length)).toEqual(original.audit);
    expect(data.audit.slice(-2).map(row => row.action)).toEqual(["procurement_finalized", "completed"]);
    expect(data.audit.slice(-2).every(row => row.role === "procurement_team" && row.reference_id === "CON-1")).toBe(true);
    expect(data.signatures).toEqual(original.signatures); expect(data.locked_hash).toBe(original.locked_hash);
    expect(saved.record.custom_purchase_order).toBe(before.custom_purchase_order); expect(rfqClmFinanceApproved(saved.record)).toBe(true);
    expect(saved.actions.some(row => row.action === "finalize_procurement")).toBe(false); expect(m.get("Purchase Order", "PO-1")).toEqual(order);
    await expect(m.act("finalize_procurement", team, { purchase_order: "PO-1" })).rejects.toMatchObject({ status: 403 });
    await m.act("activate", team); await m.act("request_termination", team, {}, "End supply"); await m.act("send_back", legal, {}, "Continue supply");
    expect(parseClmData(m.get().custom_clm_data).rfq_workflow?.phase).toBe("completed");
  });
  it.each([manager, legal, finance, internal("admin")])("denies completion to $role", async principal => {
    const m = await ready(); await expect(m.act("finalize_procurement", principal, { purchase_order: "PO-1" })).rejects.toMatchObject({ status: 403 });
  });
  it("does not permit finalization before Finance or with no real PO", async () => {
    const m = rfqMemory(); await rfqSign(m);
    await expect(m.act("finalize_procurement", team, { purchase_order: "PO-1" })).rejects.toMatchObject({ status: 403 });
    await m.act("approve", finance);
    await expect(m.act("finalize_procurement", team, {})).rejects.toThrow("Create and submit");
    await expect(m.act("finalize_procurement", team, { purchase_order: "MISSING" })).rejects.toThrow("Missing Purchase Order");
    expect(parseClmData(m.get().custom_clm_data).rfq_workflow?.phase).toBe("procurement");
  });
  it.each([{ docstatus: 0 }, { docstatus: 2 }, { status: "Cancelled" }, { supplier: "SUP-2" }, { company: "Other" }, { currency: "EUR" }, { items: [] }, { items: [{ supplier_quotation: "SQ-OTHER" }] }, { items: [{ supplier_quotation: "SQ-1" }, { supplier_quotation: "SQ-OTHER" }] }, { custom_rfq: "RFQ-OTHER" }])("rejects incompatible PO %j without changing Contract or PO", async change => {
    const m = await ready(); const candidate = { ...order, ...change }; m.put("Purchase Order", candidate); const before = m.get();
    await expect(m.act("finalize_procurement", team, { purchase_order: "PO-1" })).rejects.toMatchObject({ status: 409 });
    expect(m.get()).toEqual(before); expect(m.get("Purchase Order", "PO-1")).toEqual(candidate);
  });
  it("accepts a normally closed submitted PO", async () => {
    const m = await ready(); m.put("Purchase Order", { ...order, status: "Closed" });
    await m.act("finalize_procurement", team, { purchase_order: "PO-1" });
    expect(parseClmData(m.get().custom_clm_data).rfq_workflow?.phase).toBe("completed");
  });
  it.each([undefined, {state:"draft"}, {contract:"OTHER"}, {purchase_order:"OTHER"}, {role:"procurement"}])("rejects finalization without the Contract PO creation receipt: %j",async patch=>{
    const m=await ready(),record=m.get(),data=parseClmData(record.custom_clm_data);
    data.procurement_order=patch?{...data.procurement_order as ClmRecord,...patch}:undefined;
    m.put("Contract",{...record,custom_clm_data:JSON.stringify(data)});
    await expect(m.act("finalize_procurement",team,{purchase_order:"PO-1"})).rejects.toMatchObject({status:409});
    expect(parseClmData(m.get().custom_clm_data).rfq_workflow?.phase).toBe("procurement");
  });
  it.each([{custom_clm_contract:"OTHER"},{custom_clm_rfq:"OTHER"},{custom_clm_award:"OTHER"},{custom_clm_creation_key:"forged"},{grand_total:249}])("rejects unlinked or different-value submitted PO: %j",async patch=>{
    const m=await ready();m.put("Purchase Order",{...order,...patch});
    await expect(m.act("finalize_procurement",team,{purchase_order:"PO-1"})).rejects.toMatchObject({status:409});
  });
});

describe("CLM conditional approval rules", () => {
  it("uses configured value, currency, type, risk and business unit without hard-coded thresholds", () => {
    const rules = [rule({ minimum_contract_value: 200, maximum_contract_value: 300, contract_type: "Supply", risk_level: "Low", custom_conditions: JSON.stringify({ currency: "USD", business_unit: "Auto" }) })];
    expect(generateClmApprovals({ ...contract, custom_business_unit: "Auto" }, rules)).toHaveLength(2);
    expect(() => generateClmApprovals({ ...contract, custom_contract_value: 301, custom_business_unit: "Auto" }, rules)).toThrow("No active");
    expect(() => generateClmApprovals({ ...contract, custom_currency: "EUR", custom_business_unit: "Auto" }, rules)).toThrow("No active");
    expect(() => generateClmApprovals(contract, [rule({ minimum_contract_value: 1 })])).toThrow("currency");
  });
  it.each(["not json", "{}", '[{"role":"CCB","stage":0}]'])("fails closed on malformed stages %s", stages => {
    expect(() => generateClmApprovals(contract, [rule({ custom_approval_stages: stages })])).toThrow();
  });
  it("rejects no rules, unsupported conditions, empty human approval, and missing configured final approver", () => {
    expect(() => generateClmApprovals(contract, [])).toThrow("No active");
    expect(() => generateClmApprovals(contract, [rule({ custom_conditions: '{"arbitrary":true}' })])).toThrow("unsupported");
    expect(() => generateClmApprovals(contract, [rule({ custom_approval_stages: "", approval_sequence: "Parallel" })])).toThrow("at least one");
    expect(() => generateClmApprovals(contract, [rule({ final_approval_required: 1, final_approver: "boss@example.com" })])).toThrow("final approver");
  });
  it("does not invent an ordering for legacy sequential flags", () => {
    expect(() => generateClmApprovals(contract, [rule({ custom_approval_stages: "", finance_manager_required: 1, legal_manager_required: 1 })])).toThrow("explicit approval stages");
  });
  it("requires selected legacy role flags to remain present in configured stages", () => {
    expect(() => generateClmApprovals(contract, [rule({ quality_manager_required: 1 })])).toThrow("omit");
  });
  it("fails closed when a relevant condition has no verified source information", () => {
    expect(() => generateClmApprovals(contract, [rule({ custom_conditions: '{"new_supplier":true}' })])).toThrow("verified new supplier");
  });
  it("routes supplier status using its actual onboarding record", async () => {
    const m = memory([rule({ custom_conditions: '{"supplier_status":"Approved"}' })]);
    await expect(m.act("submit_review")).rejects.toThrow("verified supplier status");
    m.put("Supplier Onboarding", { name: "ONBOARD-1", linked_supplier: "SUP-1", status: "Approved", creation: "2026-09-16" });
    await m.act("submit_review"); expect(parseClmData(m.get().custom_clm_data).approvals).toHaveLength(2);
    expect(m.deps.list).toHaveBeenCalledWith("Supplier Onboarding", [["linked_supplier", "=", "SUP-1"]]);
  });
  it("defines a new supplier from actual executed Contract history", async () => {
    const m = memory([rule({ custom_conditions: '{"new_supplier":true}' })]);
    await m.act("submit_review");
    const established = memory([rule({ custom_conditions: '{"new_supplier":true}' })]);
    established.put("Contract", { ...contract, name: "PRIOR", custom_contract_status: "Executed" });
    await expect(established.act("submit_review")).rejects.toThrow("No active");
  });
  it("loads actual selected clauses and routes non-standard text for review", async () => {
    const m = memory([rule({ custom_conditions: '{"non_standard_clause":true}' })]);
    m.put("Contract Clause", { name: "CLAUSE-1", clause_status: "Active", standard__fallback: "Standard", clause_text: "Payment is due in thirty days." });
    await m.act("save", manager, { clause_ids: ["CLAUSE-1"], contract_terms: "Payment is due in sixty days." });
    await m.act("submit_review"); expect(parseClmData(m.get().custom_clm_data).approvals).toHaveLength(2);
    expect(toClmAggregate(manager, "Contract", m.get()).record.clause_ids).toEqual(["CLAUSE-1"]);
  });
  it("does not allow Prohibited clauses or fabricated policy metadata", async () => {
    const m = memory(); m.put("Contract Clause", { name: "BAD", clause_status: "Active", standard__fallback: "Prohibited" });
    await expect(m.act("save", manager, { clause_ids: ["BAD"] })).rejects.toThrow("permitted clauses");
    await expect(m.act("save", manager, { non_standard_clause: "false" })).rejects.toThrow("boolean");
    await expect(m.act("save", manager, { custom_clm_data: '{}' })).rejects.toMatchObject({ status: 403 });
  });
});

describe("CLM request and source integrity", () => {
  it("creates, submits, validates and links one Contract without mutating RFQ", async () => {
    const m = memory();
    const request = await applyClmAction({ doctype: "Contract Request", action: "save", payload: { department: "BUY", company: "Inteva", contract_type: "Supply", contract_purpose: "Parts", description: "Deliver parts", supplier: "SUP-1", contract_start_date: "2026-01-01", contract_end_date: "2026-12-31", contract_value: 250, estimated_contract_value: 250, currency: "USD" } }, team, m.deps);
    const name = String(request.record.name);
    await m.act("submit", team, {}, "", "Contract Request", name);
    await expect(m.act("approve", finance, {}, "", "Contract Request", name)).rejects.toMatchObject({ status: 403 });
    await m.act("approve", manager, {}, "Validated supplier and budget", "Contract Request", name);
    await expect(m.act("create_contract", team, {}, "", "Contract Request", name)).rejects.toThrow("Assess and select");
    const created = await m.act("create_contract", team, { custom_risk_level: "Medium" }, "", "Contract Request", name);
    expect(created.doctype).toBe("Contract");
    expect(created.record).toMatchObject({ custom_contract_request: name, custom_supplier: "SUP-1", custom_contract_value: 250, contract_terms: "Deliver parts", custom_risk_level: "Medium" });
    expect(m.get("Contract Request", name).request_status).toBe("Completed");
    expect(vi.mocked(m.deps.save).mock.calls.every(([dt]) => !["Request for Quotation", "Supplier Quotation"].includes(dt))).toBe(true);
  });
  it.each(["reject", "send_back"] as const)("preserves request details on %s", async decision => {
    const m = memory(); m.put("Contract Request", { name: "REQ", modified: "1", request_status: "Pending Review", supplier: "SUP-1", description: "Original" });
    await m.act(decision, manager, {}, "Needs correction", "Contract Request", "REQ");
    expect(m.get("Contract Request", "REQ")).toMatchObject({ description: "Original", request_status: decision === "reject" ? "Rejected" : "Draft" });
  });
  it("rejects substituted suppliers and unrelated quotation references", async () => {
    const m = memory(); m.put("Supplier Quotation", { name: "SQ", supplier: "SUP-2", request_for_quotation: "RFQ" });
    await expect(m.act("save", manager, { custom_supplier_quotation: "SQ" })).rejects.toThrow("selected Supplier");
    await expect(m.act("save", manager, { party_name: "SUP-2" })).rejects.toThrow("matching Supplier");
  });
  it("requires fresh modification tokens and rejects client-supplied workflow state", async () => {
    const m = memory();
    await expect(applyClmAction({ doctype: "Contract", name: "CON-1", action: "save", payload: {} }, manager, m.deps)).rejects.toMatchObject({ status: 409 });
    await expect(m.act("save", manager, { custom_contract_status: "Approved" })).rejects.toMatchObject({ status: 403 });
    expect(m.deps.save).not.toHaveBeenCalled();
  });
});

describe("CLM assigned review and version lock", () => {
  it("enforces sequential approval and locks only after all required approvers approve", async () => {
    const m = memory(); await m.act("submit_review");
    expect(toClmAggregate(legal, "Contract", m.get()).actions.some(a => a.action === "approve")).toBe(false);
    await expect(m.act("approve", legal)).rejects.toMatchObject({ status: 403 });
    await m.act("approve", finance);
    expect(m.get().custom_contract_status).toBe("Under Review"); expect(m.deps.lock).not.toHaveBeenCalled();
    await m.act("approve", legal);
    expect(m.get()).toMatchObject({ custom_contract_status: "Approved", custom_final_version_locked: 1 });
    const d = parseClmData(m.get().custom_clm_data);
    expect(d.approvals.every(a => a.status === "Approved" && a.by && a.at)).toBe(true);
    expect(d.locked_hash).toBe(clmSnapshotHash("Contract", m.get())); expect(d.locked_file).toMatchObject({ file_id: "LOCKED" });
  });
  it.each(["Parallel", "Hybrid"])("supports %s required approvals with stage boundaries", async sequence => {
    const stages = [{ role: "finance", stage: 0 }, { role: "legal", stage: 0 }, { role: "quality", stage: 1 }];
    const m = memory([rule({ approval_sequence: sequence, custom_approval_stages: JSON.stringify(stages) })]);
    await m.act("submit_review"); await m.act("approve", legal);
    if (sequence === "Hybrid") await expect(m.act("approve", internal("quality"))).rejects.toMatchObject({ status: 403 });
    await m.act("approve", finance); expect(m.get().custom_contract_status).toBe("Under Review");
    await m.act("approve", internal("quality")); expect(m.get().custom_contract_status).toBe("Approved");
  });
  it.each(["reject", "send_back"] as const)("keeps content and audit for %s", async decision => {
    const m = memory(); await m.act("submit_review"); await m.act(decision, finance, {}, "Please correct liability");
    const saved = m.get(); expect(saved.custom_contract_status).toBe("Draft"); expect(saved.contract_terms).toBe(contract.contract_terms);
    expect(parseClmData(saved.custom_clm_data).audit.at(-1)).toMatchObject({ by: "finance@example.com", action: decision, comment: "Please correct liability" });
    await expect(m.act("approve", legal)).rejects.toMatchObject({ status: 403 });
  });
  it("does not let a named user approve after losing the assigned role", async () => {
    const m = memory([rule({ custom_approval_stages: JSON.stringify([{ role: "finance", user: "reviewer@example.com", stage: 0 }]) })]);
    m.put("User", { name: "reviewer@example.com", enabled: 1, roles: [{ role: "Finance Manager" }] });
    await m.act("submit_review");
    await expect(m.act("approve", internal("department", "reviewer@example.com"))).rejects.toMatchObject({ status: 403 });
    await m.act("approve", internal("finance", "reviewer@example.com")); expect(m.get().custom_contract_status).toBe("Approved");
  });
  it("rejects a named matrix user who does not hold the configured role", async () => {
    const m = memory([rule({ custom_approval_stages: JSON.stringify([{ role: "finance", user: "buyer@example.com", stage: 0 }]) })]);
    m.put("User", { name: "buyer@example.com", enabled: 1, roles: [{ role: "Purchase User" }] });
    await expect(m.act("submit_review")).rejects.toThrow("does not hold");
  });
  it("preserves approved evidence and immutable text when suppliers redline", async () => {
    const m = memory(); await approve(m); await m.act("begin_signature");
    const before = parseClmData(m.get().custom_clm_data).versions[0];
    await m.act("supplier_redline", supplier, { contract_terms: "Proposed delivery window" }, "Supplier delivery exception");
    const saved = m.get(); const d = parseClmData(saved.custom_clm_data);
    expect(d.versions[0]).toEqual(before); expect(d.versions).toHaveLength(2);
    expect(d.approvals).toEqual([]); expect(d.review_history).toHaveLength(1);
    expect(saved).toMatchObject({ custom_contract_status: "Negotiation", custom_final_version_locked: 0 });
    const projected = toClmAggregate(supplier, "Contract", saved);
    expect(projected.record.custom_clm_data).toBeUndefined(); expect(projected.audit).toEqual([]); expect(projected.approvals).toEqual([]);
  });
  it("fails final approval if locking the persisted document fails", async () => {
    const m = memory(); await m.act("submit_review"); await m.act("approve", finance);
    m.deps.lock = vi.fn(async () => { throw new Error("Private upload unavailable"); });
    await expect(m.act("approve", legal)).rejects.toThrow("Private upload");
    expect(m.get().custom_contract_status).toBe("Under Review");
  });
  it("accepts a supplier document-only negotiation response and preserves prior documents", async () => {
    const m = memory(); await m.act("negotiate");
    const doc = { name: "SUP-DOC", is_private: 1, attached_to_doctype: "Contract", attached_to_name: "CON-1", file_url: "/private/files/supporting.pdf", file_name: "supporting.pdf" };
    m.put("File", doc);
    const data = parseClmData(m.get().custom_clm_data);
    data.supplier_uploads = [{ file_id: doc.name, file_url: doc.file_url, file_name: doc.file_name, supplier: "SUP-1", by: "supplier-user", at: "2026-09-17 10:00:00" }];
    data.supplier_documents = [{ file_id: "OLDER", file_url: "/private/files/older.pdf", file_name: "older.pdf", by: "supplier-user", at: "2026-09-16 10:00:00", version: "older-version" }];
    m.put("Contract", { ...m.get(), custom_clm_data: JSON.stringify(data) });
    const result = await m.act("supplier_redline", supplier, { supporting_documents: ["SUP-DOC"] }, "Delivery evidence attached");
    expect(result.record.contract_terms).toBe(contract.contract_terms);
    expect(result.supplier_documents).toHaveLength(2);
    expect(result.supplier_documents?.[1]).toMatchObject({ file_id: "SUP-DOC", file_url: doc.file_url, by: "supplier-user", file_name: "supporting.pdf" });
    expect(result.record.custom_clm_data).toBeUndefined(); expect(result.audit).toEqual([]);
    const saved = parseClmData(m.get().custom_clm_data);
    expect(saved.versions).toHaveLength(2); expect(saved.audit.at(-1)?.comment).toBe("Delivery evidence attached");
  });
  it("does not let a supplier publish a private internal file without its server upload receipt", async () => {
    const m = memory(); await m.act("negotiate");
    m.put("File", { name: "INTERNAL", is_private: 1, attached_to_doctype: "Contract", attached_to_name: "CON-1", file_url: "/private/files/legal-strategy.pdf" });
    const before = m.get();
    await expect(m.act("supplier_redline", supplier, { supporting_documents: ["INTERNAL"] }, "Attach file")).rejects.toMatchObject({ status: 403 });
    expect(m.get()).toEqual(before);
  });
  it.each([
    { is_private: 0 }, { is_folder: 1 }, { attached_to_name: "OTHER" }, { attached_to_doctype: "Request for Quotation" }, { file_url: "/private/files/substituted.pdf" },
  ])("rejects substituted uploaded supporting File metadata %j", async change => {
    const m = memory(); await m.act("negotiate");
    const doc = { name: "SUP-DOC", is_private: 1, attached_to_doctype: "Contract", attached_to_name: "CON-1", file_url: "/private/files/supporting.pdf", file_name: "supporting.pdf" };
    m.put("File", { ...doc, ...change });
    const data = parseClmData(m.get().custom_clm_data);
    data.supplier_uploads = [{ file_id: doc.name, file_url: doc.file_url, file_name: doc.file_name, supplier: "SUP-1", by: "supplier-user", at: "2026-09-17 10:00:00" }];
    m.put("Contract", { ...m.get(), custom_clm_data: JSON.stringify(data) });
    await expect(m.act("supplier_redline", supplier, { supporting_documents: ["SUP-DOC"] }, "Supplier evidence")).rejects.toMatchObject({ status: 403 });
  });
  it("requires the upload receipt to belong to the current supplier and authenticated user", async () => {
    const m = memory(); await m.act("negotiate");
    const data = parseClmData(m.get().custom_clm_data);
    data.supplier_uploads = [{ file_id: "FOREIGN", file_url: "/private/files/foreign.pdf", supplier: "SUP-2", by: "supplier-user" }, { file_id: "OTHER-USER", file_url: "/private/files/other.pdf", supplier: "SUP-1", by: "different-user" }];
    m.put("Contract", { ...m.get(), custom_clm_data: JSON.stringify(data) });
    for (const id of ["FOREIGN", "OTHER-USER"]) await expect(m.act("supplier_redline", supplier, { supporting_documents: [id] }, "Supplier evidence")).rejects.toMatchObject({ status: 403 });
  });
  it("rejects approving content changed outside its submitted immutable version", async () => {
    const m = memory(); await m.act("submit_review");
    m.put("Contract", { ...m.get(), contract_terms: "Substituted terms" });
    await expect(m.act("approve", finance)).rejects.toThrow("content changed");
  });
  it("preserves prior review evidence when a sent-back Contract is resubmitted", async () => {
    const m = memory(); await m.act("submit_review"); await m.act("send_back", finance, {}, "Clarify terms");
    await m.act("save", team, { contract_terms: "Clarified delivery terms" }); await m.act("submit_review");
    const data = parseClmData(m.get().custom_clm_data);
    expect(data.review_history).toHaveLength(1); expect(data.approvals.every(a => a.status === "Pending")).toBe(true);
  });
  it("returns saved state with a notification warning instead of pretending the mutation failed", async () => {
    const m = memory(); m.deps.notify = vi.fn(async () => { throw new Error("Notification service unavailable"); });
    const result = await m.act("submit_review");
    expect(result.record.custom_contract_status).toBe("Under Review"); expect(result.warnings?.join(" ")).toContain("action was saved");
  });
});

describe("CLM signing, operation and closure", () => {
  it("requires supplier then named Inteva signer and does not activate merely on execution", async () => {
    const m = memory(); await approve(m); await m.act("begin_signature");
    await expect(m.act("sign", signatory, { typed_name: "Signer", consent: true })).rejects.toMatchObject({ status: 403 });
    await m.act("sign", supplier, { typed_name: "Supplier signer", consent: true });
    await expect(m.act("sign", manager, { typed_name: "Wrong signer", consent: true })).rejects.toMatchObject({ status: 403 });
    await m.act("sign", signatory, { typed_name: "Inteva signer", consent: true });
    expect(m.get().custom_contract_status).toBe("Executed");
    await m.act("activate"); expect(m.get().custom_contract_status).toBe("Active");
    expect(parseClmData(m.get().custom_clm_data).signatures).toHaveLength(2);
  });
  it("rejects cross-supplier access, missing consent and direct content changes after locking", async () => {
    const m = memory(); await approve(m); await m.act("begin_signature");
    await expect(m.act("sign", { ...supplier, supplier: "SUP-2" }, { typed_name: "Attacker", consent: true })).rejects.toMatchObject({ status: 403 });
    await expect(m.act("sign", supplier, { typed_name: "Supplier" })).rejects.toThrow("confirm");
    m.put("Contract", { ...m.get(), contract_terms: "Unexpected edit" });
    await expect(m.act("sign", supplier, { typed_name: "Supplier", consent: true })).rejects.toThrow("version changed");
    expect(m.deps.sign).not.toHaveBeenCalled();
  });
  it("fails honestly on signing errors without advancing", async () => {
    const m = memory(); await approve(m); await m.act("begin_signature"); m.deps.sign = vi.fn(async () => { throw new Error("File unavailable"); });
    await expect(m.act("sign", supplier, { typed_name: "Supplier", consent: true })).rejects.toThrow("File unavailable");
    expect(m.get().custom_contract_status).toBe("Pending Signature"); expect(parseClmData(m.get().custom_clm_data).signatures).toEqual([]);
  });
  it("archives the first party's signed artifact when a pending-signature version is redlined", async () => {
    const m = memory(); await approve(m); await m.act("begin_signature"); await m.act("sign", supplier, { typed_name: "Supplier", consent: true });
    await m.act("supplier_redline", supplier, { contract_terms: "Revised terms requiring fresh review" }, "Correct the delivery date");
    const data = parseClmData(m.get().custom_clm_data);
    expect(data.signatures).toEqual([]);
    const archived = (data.review_history as Array<{ signatures: unknown[] }>)[0];
    expect(archived.signatures).toHaveLength(1); expect(archived.signatures[0]).toMatchObject({ file_id: "SIGNED-supplier" });
    expect(m.get().custom_supplier_signed_date).toBe("");
  });
  it("does not allow premature effective-period activation or closure immediately after signing", async () => {
    const m = memory(); m.put("Contract", { ...contract, start_date: "2026-10-01" }); await execute(m);
    await expect(m.act("activate")).rejects.toThrow("effective period");
    await expect(m.act("close", manager, {})).rejects.toMatchObject({ status: 403 });
  });
  it("validates period, records SLA breach, expires and closes only after obligations and financial checks", async () => {
    const m = memory(); await execute(m); await m.act("activate");
    await expect(m.act("expire")).rejects.toThrow("not been reached");
    await m.act("record_sla", manager, { metric: "On-time delivery", target: 98, actual: 94, operator: "gte", corrective_action: "Supplier recovery plan" });
    expect(parseClmData(m.get().custom_clm_data).sla[0].status).toBe("Breached");
    m.setNow("2027-01-01 10:00:00"); await m.act("expire");
    const checks = { settlement_complete: true, documents_archived: true, claims_resolved: true, disputes_resolved: true, warranty_resolved: true, outstanding_actions_resolved: true };
    m.put("Contract Obligation", { name: "OB-1", contract: "CON-1", status: "Open" });
    await expect(m.act("close", manager, checks)).rejects.toThrow("open obligations");
    m.put("Contract Obligation", { name: "OB-1", contract: "CON-1", status: "Completed" });
    m.deps.closureBlockers = vi.fn(async () => ["Invoice INV-1 is unsettled."]);
    await expect(m.act("close", manager, checks)).rejects.toThrow("INV-1");
    m.deps.closureBlockers = vi.fn(async () => []); await m.act("close", manager, checks);
    expect(m.get().custom_contract_status).toBe("Closed"); expect(toClmAggregate(manager, "Contract", m.get()).actions).toEqual([]);
  });
  it("requires legal approval for termination and preserves signed evidence", async () => {
    const m = memory(); await execute(m); await m.act("activate");
    await m.act("request_termination", manager, {}, "Supplier breach");
    await m.act("approve", finance); expect(m.get().custom_contract_status).toBe("Under Review");
    await m.act("approve", legal); expect(m.get().custom_contract_status).toBe("Terminated");
    expect(parseClmData(m.get().custom_clm_data).signatures).toHaveLength(2);
  });
  it("creates amendment revision separately and refuses execution until that revision is signed", async () => {
    const m = memory(); await execute(m); await m.act("activate");
    const original = m.get();
    const saved = await applyClmAction({ doctype: "Contract Amendment", action: "save", payload: { contract: "CON-1", amendment_title: "Price change", amendment_type: "Commercial", amendment_reason: "New volume", amendment_description: "Updated terms", effective_date: "2026-10-01", revised_terms: "Revised commercial terms" } }, team, m.deps);
    const name = String(saved.record.name);
    await m.act("submit_review", manager, {}, "", "Contract Amendment", name);
    await m.act("approve", finance, {}, "", "Contract Amendment", name); await m.act("approve", legal, {}, "", "Contract Amendment", name);
    const revision = await m.act("execute", manager, {}, "", "Contract Amendment", name);
    expect(revision.doctype).toBe("Contract"); expect(parseClmData(revision.record.custom_clm_data).source_contract).toBe("CON-1"); expect(revision.record.amended_from).toBeUndefined(); expect(revision.record.contract_terms).toBe("Revised commercial terms");
    expect(m.get()).toEqual(original);
    await expect(m.act("execute", manager, {}, "", "Contract Amendment", name)).rejects.toThrow("both signatures");
  });
  it("creates a renewed Contract while retaining the original end date and terms", async () => {
    const m = memory(); await execute(m); await m.act("activate");
    const original = m.get();
    const renewal = await applyClmAction({ doctype: "Contract Renewal", action: "save", payload: { contract: "CON-1", renewal_type: "Renewal", current_end_date: "2026-12-31", proposed_end_date: "2027-12-31", renewal_reason: "Continue supply", revised_terms: "Renewed supply terms" } }, team, m.deps);
    const name = String(renewal.record.name);
    await m.act("submit_review", manager, {}, "", "Contract Renewal", name);
    await m.act("approve", finance, {}, "", "Contract Renewal", name); await m.act("approve", legal, {}, "", "Contract Renewal", name);
    const revised = await m.act("execute", manager, {}, "", "Contract Renewal", name);
    expect(revised.record.end_date).toBe("2027-12-31"); expect(m.get()).toEqual(original);
  });
  it("leaves existing records readable without guessing they are CLM-approved", () => {
    expect(canReadClm(manager, "Contract", contract)).toBe(true);
    expect(canReadClm(finance, "Contract", contract)).toBe(false);
    expect(canReadClm(supplier, "Contract", contract)).toBe(false);
    expect(toClmAggregate(manager, "Contract", contract).warnings).toHaveLength(1);
  });

  describe("Contract activation effective period validation (Step 5)", () => {
    // Contract fixture: CON-2026-00004 effective period: 2026-10-15 to 2027-10-14
    async function setupExecuted(m: ReturnType<typeof memory>, overrides: Partial<ClmRecord> = {}) {
      m.put("Contract", {
        ...contract,
        start_date: "2026-10-15",
        end_date: "2027-10-14",
        ...overrides,
      });
      await execute(m);
    }

    // 1. Current date before effective start date
    it("1. rejects activation when current date is before effective start date and reports permitted date", async () => {
      const m = memory();
      await setupExecuted(m);
      m.setNow("2026-10-13 16:53:11"); // Actual system date for CON-2026-00004
      await expect(m.act("activate", manager)).rejects.toThrow(
        "The Contract can become Active only during its effective period. Activation will be permitted on or after 2026-10-15 (current business date: 2026-10-13)."
      );
      expect(m.get().custom_contract_status).toBe("Executed");
    });

    // 2. Current date equal to effective start date
    it("2. allows activation when current date is equal to effective start date (start boundary)", async () => {
      const m = memory();
      await setupExecuted(m);
      m.setNow("2026-10-15 00:00:00");
      await m.act("activate", manager);
      expect(m.get().custom_contract_status).toBe("Active");
    });

    // 3. Current date within effective period
    it("3. allows activation when current date is within the effective period", async () => {
      const m = memory();
      await setupExecuted(m);
      m.setNow("2026-11-20 14:30:00");
      await m.act("activate", manager);
      expect(m.get().custom_contract_status).toBe("Active");
    });

    // 4. Current date equal to effective end date
    it("4. allows activation when current date is equal to effective end date (end boundary)", async () => {
      const m = memory();
      await setupExecuted(m);
      m.setNow("2027-10-14 23:59:59");
      await m.act("activate", manager);
      expect(m.get().custom_contract_status).toBe("Active");
    });

    // 5. Current date after effective end date
    it("5. rejects activation when current date is after effective end date and explains period ended", async () => {
      const m = memory();
      await setupExecuted(m);
      m.setNow("2027-10-15 00:00:00");
      await expect(m.act("activate", manager)).rejects.toThrow(
        "The Contract can become Active only during its effective period. The effective period ended on 2027-10-14 (current business date: 2027-10-15)."
      );
      expect(m.get().custom_contract_status).toBe("Executed");
    });

    // 6. Missing and invalid effective dates
    it("6. rejects activation when effective dates are missing, malformed or inverted", async () => {
      const m = memory();
      await setupExecuted(m);
      m.setNow("2026-10-16 10:00:00");

      // Missing start date
      const original = m.get();
      m.put("Contract", { ...original, start_date: "" });
      await expect(m.act("activate", manager)).rejects.toThrow(
        "Contract Start Date is required before activation."
      );

      // Missing end date
      m.put("Contract", { ...original, start_date: "2026-10-15", end_date: "" });
      await expect(m.act("activate", manager)).rejects.toThrow(
        "Contract End Date is required before activation."
      );

      // Invalid start date (calendar rollover check)
      m.put("Contract", { ...original, start_date: "2026-02-30", end_date: "2027-10-14" });
      await expect(m.act("activate", manager)).rejects.toThrow(
        "Contract Start Date (2026-02-30) is not a valid calendar date"
      );

      // Invalid end date (month out of range)
      m.put("Contract", { ...original, start_date: "2026-10-15", end_date: "2027-13-01" });
      await expect(m.act("activate", manager)).rejects.toThrow(
        "Contract End Date (2027-13-01) is not a valid calendar date"
      );

      // End date before start date
      m.put("Contract", { ...original, start_date: "2027-10-15", end_date: "2026-10-14" });
      await expect(m.act("activate", manager)).rejects.toThrow(
        "Contract End Date (2026-10-14) cannot be before Contract Start Date (2027-10-15)."
      );
    });

    // 7. Timezone and date-boundary handling
    it("7. evaluates business dates accurately around midnight without timezone drift", async () => {
      const m = memory();
      await setupExecuted(m);

      // 1 second before start date
      m.setNow("2026-10-14 23:59:59");
      await expect(m.act("activate", manager)).rejects.toThrow(
        "Activation will be permitted on or after 2026-10-15"
      );

      // Midnight on start date
      m.setNow("2026-10-15 00:00:00");
      await m.act("activate", manager);
      expect(m.get().custom_contract_status).toBe("Active");
    });

    // 8. Unauthorized activation attempts and duplicate prevention
    it("8. denies unauthorized activation and prevents duplicate activation", async () => {
      const m = memory();
      await setupExecuted(m);
      m.setNow("2026-10-16 10:00:00");

      // Unauthorized roles
      await expect(m.act("activate", supplier)).rejects.toMatchObject({ status: 403 });
      await expect(m.act("activate", finance)).rejects.toMatchObject({ status: 403 });
      await expect(m.act("activate", legal)).rejects.toMatchObject({ status: 403 });

      // Valid activation by authorized coordinator
      await m.act("activate", manager, {}, "Authorized activation");
      expect(m.get().custom_contract_status).toBe("Active");

      // Duplicate activation attempt on already-active contract is blocked
      await expect(m.act("activate", manager, {}, "Second activation")).rejects.toMatchObject({
        status: 403,
      });
    });
  });
});
