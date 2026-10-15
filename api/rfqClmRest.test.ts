import { describe, expect, it, vi } from "vitest";
import { applyClmAction, canReadClm, ClmError, parseClmData, toClmAggregate } from "./clmCore";
import { createRfqContractRequest, decideRfqContractRequirement, getRfqClmSummary, guardRfqContractRequestSave, recordRfqContractRequest, type RfqClmDeps } from "./rfqClmCore";
import { persistRfqClmDecision } from "./rfqClmRest";
import { syncRfqClmRestContract } from "./rfqClmRestSync";
import { ensureInitialRfqContractRequest } from "./rfqInitialClmRequest";
import type { AccessPrincipal } from "./rbacAuth";
import type { ClmRecord } from "../src/types/clm";
import { rfqClmRequestWorkflowView } from "../src/utils/rfqClmWorkflow";
import { saveRfqRequestDraft } from "./rfqRequestDraft";
import { recordRfqAwardClmDecision, type RfqAwardClmDecisionInput } from "./rfqAwardClmDecision";

const team = { typ: "internal", sub: "buyer@example.test", email: "buyer@example.test", role: "procurement_team" } as AccessPrincipal;
const manager = { ...team, role: "procurement" } as AccessPrincipal;
const legal = { ...team, sub: "legal@example.test", email: "legal@example.test", role: "legal" } as AccessPrincipal;
const RFQ = "PUR-RFQ-2026-00095", AWARD = "LDC2026-00026", SQ = "PUR-SQTN-2026-00270";
const terms = { estimated_contract_value: 30, department: "BUY", contract_type: "Supply / Procurement Contract", contract_start_date: "2026-10-01", contract_end_date: "2027-09-30" };
const review = { custom_risk_level: "Low", custom_inteva_signatory: legal.email };
function fixture(contractRequired: "Yes" | "No" = "Yes") {
  const docs = new Map<string, ClmRecord>(); let revision = 0;
  const put = (dt: string, doc: ClmRecord) => { const row = { docstatus: 0, ...doc }; docs.set(`${dt}/${row.name}`, structuredClone(row)); return structuredClone(row); };
  const get = (dt: string, name: string) => structuredClone(docs.get(`${dt}/${name}`)!);
  put("Request for Quotation", { name: RFQ, modified: "r1", docstatus: 1, status: "Submitted", company: "Netlink", department: "BUY", contract_required: contractRequired });
  put("Department", { name: "BUY", department_name: "Procurement", company: "Netlink" });
  put("Supplier", { name: "Blue Ridge", disabled: 0 });
  put("Supplier Quotation", { name: SQ, modified: "q1", docstatus: 1, supplier: "Blue Ridge", company: "Netlink", currency: "USD", grand_total: 30, items: [{ request_for_quotation: RFQ }] });
  put("Legal Document Review", { name: AWARD, modified: "a1", rfq_name: RFQ, sq_name: SQ, supplier: "Blue Ridge", grand_total: 30, workflow_state: "Pending Review", current_owner: "Legal Reviewer" });
  put("User", { name: legal.email, email: legal.email, enabled: 1, roles: [{ role: "Legal Manager" }] });
  const deps: RfqClmDeps = {
    load: vi.fn(async (dt, name) => { const row = get(dt, name); if (!row) throw new ClmError("Not found", 404); return row; }),
    list: vi.fn(async (dt, filters = []) => [...docs.entries()].filter(([key, row]) => key.startsWith(`${dt}/`) && filters.every(filter => { const parts = filter as string[]; const [field, , value] = parts.length === 4 ? parts.slice(1) : parts; return parts.length === 4 ? Array.isArray(row.items) && (row.items as ClmRecord[]).some(item => item[field] === value) : row[field] === value; })).map(([, doc]) => structuredClone(doc))),
    create: vi.fn(async (dt, doc) => {
      const unique = dt === "Contract Request" ? "custom_rfq" : dt === "Contract" ? "custom_contract_request" : "";
      if (unique && [...docs.entries()].some(([key, row]) => key.startsWith(`${dt}/`) && row[unique] === doc[unique])) throw new ClmError("Duplicate source", 409);
      return put(dt, { ...doc, name: `${dt === "Contract" ? "CON" : "REQ"}-${++revision}`, modified: String(revision) });
    }),
    save: vi.fn(async (dt, doc) => {
      if (get(dt, String(doc.name))?.modified !== doc.modified) throw new ClmError("This record changed. Refresh before saving.", 409);
      return put(dt, { ...doc, modified: String(++revision) });
    }),
    fields: vi.fn(async dt => dt === "Contract" ? [{ fieldname: "custom_contract_request", unique: 1 }] : [{ fieldname: "custom_rfq", unique: 1 }]),
    now: () => "2026-09-23 12:00:00", notify: vi.fn(async () => undefined),
  };
  deps.decide = input => persistRfqClmDecision(input, deps);
  const summary = () => getRfqClmSummary(team, RFQ, deps);
  const confirm = (who = manager, overrides: Partial<RfqAwardClmDecisionInput> = {}) => recordRfqAwardClmDecision(who, { rfq: RFQ, award_id: AWARD, quotation_id: SQ, supplier_id: "Blue Ridge", ...overrides }, deps);
  const request = async (payload: ClmRecord = terms, who = team) => {
    if (!(await deps.list("Contract Request")).length || JSON.parse(String(get("Request for Quotation", RFQ).custom_approval_data || "{}")).clm_award_intent?.phase === "saving") await confirm(who);
    return recordRfqContractRequest(who, { rfq: RFQ, expected_modified: String(get("Request for Quotation", RFQ).modified), payload }, deps);
  };
  const create = async () => createRfqContractRequest(team, { rfq: RFQ, expected_modified: String(get("Request for Quotation", RFQ).modified), payload: {}, contract_fields: review }, deps);
  return { deps, get, put, docs, summary, request, create, confirm };
}

describe("saved-award routing reads the existing RFQ Contract Required choice", () => {
  it.each(["Yes", "No"] as const)("rejects a contradictory client decision instead of overriding RFQ %s", async saved => {
    const m = fixture(saved), before = structuredClone(m.docs);
    await expect(m.confirm(manager, { decision: saved === "Yes" ? "No" : "Yes" })).rejects.toMatchObject({ status: 409 });
    expect(m.docs).toEqual(before);
    expect(m.deps.create).not.toHaveBeenCalled(); expect(m.deps.save).not.toHaveBeenCalled();
    expect(m.get("Request for Quotation", RFQ).contract_required).toBe(saved);
  });
  it.each(["Yes", "No"] as const)("accepts optional matching legacy input while retaining RFQ %s", async saved => {
    const m = fixture(saved);
    const result = await m.confirm(manager, { decision: saved });
    expect(result.summary.decision).toBe(saved);
    expect(m.get("Request for Quotation", RFQ).contract_required).toBe(saved);
    expect(await m.deps.list("Contract Request")).toHaveLength(saved === "Yes" ? 1 : 0);
  });
  it("does not assume Yes or No when the saved RFQ choice is missing", async () => {
    const m = fixture(); m.put("Request for Quotation", { ...m.get("Request for Quotation", RFQ), contract_required: "" });
    await expect(m.confirm()).rejects.toMatchObject({ status: 409 });
    expect(m.deps.create).not.toHaveBeenCalled(); expect(m.deps.save).not.toHaveBeenCalled();
  });
  it("uses the verified award Department when the RFQ itself has no Department", async () => {
    const m = fixture();
    m.put("Request for Quotation", { ...m.get("Request for Quotation", RFQ), department: "" });
    m.put("Legal Document Review", { ...m.get("Legal Document Review", AWARD), department: "BUY" });
    expect((await m.confirm()).request?.record.department).toBe("BUY");
  });
  it("keeps a historical invalidated Request inactive when the RFQ has stored No before award", async () => {
    const m = fixture(), awarded = await m.confirm();
    const request = awarded.request!.record, data = parseClmData(request.custom_clm_data), award = m.get("Legal Document Review", AWARD);
    data.rfq_source = { stage: "rfq_created", rfq: RFQ, company: "Netlink", contract_required: true };
    m.put("Contract Request", { ...request, supplier: "", custom_supplier_quotation: "", custom_clm_data: JSON.stringify(data) });
    m.put("Request for Quotation", { ...m.get("Request for Quotation", RFQ), contract_required: "No", custom_approval_data: JSON.stringify({ clm_initial_request: { version: 1, phase: "complete", request: request.name } }) });
    m.docs.delete(`Legal Document Review/${AWARD}`);
    await ensureInitialRfqContractRequest(manager, RFQ, m.deps);
    m.put("Legal Document Review", award);
    const result = await m.confirm();
    expect(result.summary).toMatchObject({ decision: "No", continuation_ready: true, request: undefined });
    expect(await m.deps.list("Contract Request")).toHaveLength(1);
    expect(parseClmData(m.get("Contract Request", String(request.name)).custom_clm_data).rfq_request_workflow).toMatchObject({ status: "Invalidated" });
    expect(await m.deps.list("Contract")).toEqual([]);
  });
  it.each([0, 1])("does not create a Request for docstatus %s without an actual saved award", async docstatus => {
    const m = fixture(); m.docs.delete(`Legal Document Review/${AWARD}`);
    m.put("Request for Quotation", { ...m.get("Request for Quotation", RFQ), docstatus });
    await expect(m.confirm()).rejects.toMatchObject({ status: 409 });
    expect(m.deps.create).not.toHaveBeenCalled(); expect(m.deps.save).not.toHaveBeenCalled();
  });
  it("creates only one Request with the actual supplier, winning quotation and negotiated final award", async () => {
    const m = fixture();
    m.put("Supplier Quotation", { ...m.get("Supplier Quotation", SQ), grand_total: 50000 });
    m.put("Legal Document Review", { ...m.get("Legal Document Review", AWARD), grand_total: 48500 });
    const confirmed = await m.confirm();
    expect(confirmed.created).toBe(true);
    expect(confirmed.request?.record).toMatchObject({ custom_rfq: RFQ, supplier: "Blue Ridge", custom_supplier_quotation: SQ, contract_value: 48500, currency: "USD", request_status: "Pending Review" });
    expect(parseClmData(confirmed.request!.record.custom_clm_data).rfq_source).toMatchObject({ stage: "rfq_awarded", award: AWARD, supplier: "Blue Ridge", amount: 48500 });
    expect(confirmed.summary.request).toMatchObject({ name: confirmed.request!.record.name, current_stage: "Pending Procurement Team", status: "Pending" });
    const again = await m.confirm(team);
    expect(again.created).toBe(false); expect(again.request!.record.name).toBe(confirmed.request!.record.name);
    expect(await m.deps.list("Contract Request")).toHaveLength(1); expect(await m.deps.list("Contract")).toEqual([]);
    expect(JSON.parse(String(m.get("Request for Quotation", RFQ).custom_approval_data)).clm_award_intent).toMatchObject({ phase: "complete", request: confirmed.request!.record.name });
    expect(JSON.parse(String(m.get("Legal Document Review", AWARD).custom_clm_state)).request).toBe(confirmed.request!.record.name);
    expect(m.get("Request for Quotation", RFQ).contract_required).toBe("Yes");
    expect(m.get("Legal Document Review", AWARD).grand_total).toBe(48500);
    expect(m.get("Supplier Quotation", SQ).grand_total).toBe(50000);
  });
  it("uses the RFQ saved No with no Request or Contract and retains existing sourcing states", async () => {
    const m = fixture("No"), before = m.get("Legal Document Review", AWARD);
    const result = await m.confirm();
    expect(result.summary).toMatchObject({ decision: "No", continuation_ready: true });
    expect(await m.deps.list("Contract Request")).toEqual([]); expect(await m.deps.list("Contract")).toEqual([]);
    expect(m.get("Legal Document Review", AWARD)).toMatchObject({ workflow_state: before.workflow_state, current_owner: before.current_owner, sq_name: SQ });
    expect(m.get("Request for Quotation", RFQ)).toMatchObject({ docstatus: 1, status: "Submitted" });
    expect((await m.confirm()).summary.decision).toBe("No");
    expect(m.get("Request for Quotation", RFQ).contract_required).toBe("No");
  });
  it("routes a double award callback to one Request using the saved Yes", async () => {
    const m = fixture();
    const attempts = await Promise.allSettled([m.confirm(), m.confirm(team)]);
    expect(attempts.some(row => row.status === "fulfilled")).toBe(true);
    const result = await m.confirm();
    const requests = await m.deps.list("Contract Request");
    expect(requests).toHaveLength(1); expect(result.request!.record.name).toBe(requests[0].name);
    expect(m.get("Request for Quotation", RFQ).contract_required).toBe("Yes");
    expect(await m.deps.list("Contract")).toEqual([]);
  });
  it.each([
    ["contract_value", 29],
    ["currency", "EUR"],
  ] as const)("rejects an award decision retry when the native Request %s no longer matches the award", async (field, value) => {
    const m = fixture(), first = await m.confirm();
    const name = String(first.request!.record.name), request = m.get("Contract Request", name);
    // Model an incorrect ERP persistence result; its source JSON still has the
    // correct 30 USD award and cannot substitute for checking native fields.
    m.put("Contract Request", { ...request, [field]: value });
    vi.mocked(m.deps.create).mockClear();
    await expect(m.confirm()).rejects.toMatchObject({ status: 409 });
    expect(await m.summary()).toMatchObject({ eligible: false, blocks_procurement: true, continuation_ready: false });
    expect(m.get("Contract Request", name)[field]).toBe(value);
    expect(m.deps.create).not.toHaveBeenCalled();
    expect(await m.deps.list("Contract Request")).toHaveLength(1);
    expect(await m.deps.list("Contract")).toEqual([]);
  });
  it.each(["Yes", "No"] as const)("does not report a successful %s retry when the persisted decision amount disagrees with the award", async decision => {
    const m = fixture(decision); await m.confirm();
    const rfq = m.get("Request for Quotation", RFQ), data = JSON.parse(String(rfq.custom_approval_data));
    data.contract_decision.amount = 31;
    m.put("Request for Quotation", { ...rfq, custom_approval_data: JSON.stringify(data) });
    vi.mocked(m.deps.create).mockClear();
    await expect(m.confirm()).rejects.toMatchObject({ status: 409 });
    expect(await m.summary()).toMatchObject({ decision, eligible: false, continuation_ready: false, blocks_procurement: true });
    expect(m.deps.create).not.toHaveBeenCalled();
    expect(await m.deps.list("Contract Request")).toHaveLength(decision === "Yes" ? 1 : 0);
    expect(await m.deps.list("Contract")).toEqual([]);
  });
  it("reuses the existing Contract on award decision replay without remirroring or resubmitting Legal review", async () => {
    const m = fixture(); await m.request();
    const created = await m.create(), requestName = String(created.request.record.name), contractName = String(created.contract!.record.name);
    const before = structuredClone(m.docs);
    vi.mocked(m.deps.create).mockClear(); vi.mocked(m.deps.save).mockClear(); vi.mocked(m.deps.notify!).mockClear();
    const replay = await m.confirm(manager);
    expect(replay).toMatchObject({ created: false, request: { record: { name: requestName } }, summary: { eligible: true, decision: "Yes", contract: { name: contractName, status: "Pending Legal" } } });
    expect(replay.summary.recovery_required).toBeUndefined();
    expect(m.docs).toEqual(before);
    expect(m.deps.create).not.toHaveBeenCalled(); expect(m.deps.save).not.toHaveBeenCalled(); expect(m.deps.notify).not.toHaveBeenCalled();
    expect(await m.deps.list("Contract Request")).toHaveLength(1); expect(await m.deps.list("Contract")).toHaveLength(1);
  });
  it.each([{ award_id: "OTHER" }, { quotation_id: "OTHER" }, { supplier_id: "OTHER" }])("rejects mismatched award input %# without writes", async overrides => {
    const m = fixture(); await expect(m.confirm(manager, overrides)).rejects.toMatchObject({ status: 409 });
    expect(m.deps.create).not.toHaveBeenCalled(); expect(m.deps.save).not.toHaveBeenCalled();
  });
  it("exposes a native insert error, keeps the gate closed and retries the same award without duplicates", async () => {
    const m = fixture(), create = m.deps.create;
    m.deps.create = vi.fn(async () => { throw new ClmError("ERP Contract Request insert denied", 403); });
    await expect(m.confirm()).rejects.toThrow("ERP Contract Request insert denied");
    expect(await m.deps.list("Contract Request")).toEqual([]); expect(await m.deps.list("Contract")).toEqual([]);
    expect(m.get("Request for Quotation", RFQ)).toMatchObject({ docstatus: 1, status: "Submitted" });
    expect(JSON.parse(String(m.get("Request for Quotation", RFQ).custom_approval_data)).clm_award_intent.phase).toBe("saving");
    expect((await m.summary()).blocks_procurement).toBe(true);
    m.deps.create = create;
    const result = await m.confirm(); expect(result.created).toBe(true);
    expect((await m.confirm()).request!.record.name).toBe(result.request!.record.name);
    expect(await m.deps.list("Contract Request")).toHaveLength(1);
  });
  it("does not allow a Finance or Legal user to confirm the procurement award decision", async () => {
    const m = fixture();
    for (const role of ["finance", "legal"]) await expect(m.confirm({ ...manager, role } as AccessPrincipal)).rejects.toMatchObject({ status: 403 });
    expect(m.deps.create).not.toHaveBeenCalled(); expect(m.deps.save).not.toHaveBeenCalled();
  });
});

describe("RFQ CLM using existing ERPNext documents, without an installed extension", () => {
  it("retains Procurement Team's saved draft purpose and scope through verified award preparation and one standard Contract", async () => {
    const m = fixture();
    m.put("Currency", { name: "USD", enabled: 1 });
    const initial = (await m.confirm()).request!.record;
    await saveRfqRequestDraft(team, { name: String(initial.name), expected_modified: String(initial.modified), payload: { ...Object.fromEntries(Object.entries(terms).filter(([key]) => key !== "department")), contract_purpose: "Procurement Team entered purpose", description: "Team entered scope", contract_value: 30, estimated_contract_value: 30, currency: "USD" } }, m.deps);
    expect(await m.deps.list("Contract")).toEqual([]);
    await ensureInitialRfqContractRequest(manager, RFQ, m.deps);
    expect((await m.summary()).prefill).toMatchObject({ contract_purpose: "Procurement Team entered purpose", description: "Team entered scope", contract_value: 30 });
    await m.request({});
    const created = await m.create();
    expect(created.request.record.name).toBe(initial.name);
    expect(created.contract!.record).toMatchObject({ custom_contract_title: "Procurement Team entered purpose", contract_terms: "Team entered scope", custom_contract_status: "Pending Legal", custom_contract_request: initial.name });
    expect(await m.deps.list("Contract Request")).toHaveLength(1); expect(await m.deps.list("Contract")).toHaveLength(1);
  });
  it("does not use generated source defaults to bypass blank saved draft purpose at creation", async () => {
    const m = fixture(); m.put("Currency", { name: "USD", enabled: 1 });
    const initial = (await m.confirm()).request!.record;
    await saveRfqRequestDraft(team, { name: String(initial.name), expected_modified: String(initial.modified), payload: { contract_purpose: "", description: "Entered scope", contract_value: 30 } }, m.deps);
    await expect(m.request()).rejects.toMatchObject({ status: 422 });
    expect(await m.deps.list("Contract")).toEqual([]); expect(await m.deps.list("Contract Request")).toHaveLength(1);
    expect(rfqClmRequestWorkflowView(m.get("Contract Request", String(initial.name)))).toMatchObject({ stage: "Pending Procurement Team", status: "Pending Procurement Team" });
  });
  it.each([
    ["contract_value", 29, 30],
    ["currency", "", "USD"],
  ] as const)("rejects conflicting draft %s before any native save and accepts only the actual award", async (field, entered, aligned) => {
    const m = fixture(); m.put("Currency", { name: "USD", enabled: 1 });
    const initial = (await m.confirm()).request!.record;
    const before = structuredClone(m.docs);
    vi.mocked(m.deps.save).mockClear(); vi.mocked(m.deps.create).mockClear();
    await expect(saveRfqRequestDraft(team, { name: String(initial.name), expected_modified: String(initial.modified), payload: { [field]: entered } }, m.deps)).rejects.toMatchObject({ status: 409 });
    expect(m.docs).toEqual(before); expect(m.deps.save).not.toHaveBeenCalled(); expect(m.deps.create).not.toHaveBeenCalled();
    await saveRfqRequestDraft(team, { name: String(initial.name), expected_modified: String(initial.modified), payload: { [field]: aligned } }, m.deps);
    const prepared = await m.request(terms);
    expect(prepared.request.record.name).toBe(initial.name); expect(prepared.summary.can_create).toBe(true);
    expect(await m.deps.list("Contract Request")).toHaveLength(1); expect(await m.deps.list("Contract")).toEqual([]);
  });
  it("keeps final award 4500 separate from original quote and approved estimate 50000 through Contract creation", async () => {
    const m = fixture();
    m.put("Supplier Quotation", { ...m.get("Supplier Quotation", SQ), grand_total: 6000 });
    m.put("Legal Document Review", { ...m.get("Legal Document Review", AWARD), grand_total: 4500 });
    m.put("Business Case", { name: "BC-1", rfq_id: RFQ, approval_status: "Approved", estimated_budget: 50000, currency: "USD" });
    const initial = (await m.confirm()).request!.record;
    const data = parseClmData(initial.custom_clm_data);
    data.rfq_request_draft = { version: 1, by: team.sub, at: "2026-09-25 11:00:00", values: { contract_value: 50000, currency: "EUR", description: "Saved terms" } };
    m.put("Contract Request", { ...initial, custom_clm_data: JSON.stringify(data) });
    expect((await m.summary()).prefill).toMatchObject({ contract_value: 4500, currency: "USD", estimated_contract_value: 50000 });
    const prepared = await m.request({ ...terms, estimated_contract_value: 50000 });
    expect(prepared.request.record).toMatchObject({ contract_value: 4500, currency: "USD", estimated_contract_value: 50000 });
    const created = await m.create();
    expect(created.contract!.record).toMatchObject({ custom_contract_value: 4500, custom_currency: "USD" });
    expect(m.get("Supplier Quotation", SQ).grand_total).toBe(6000);
  });
  it.each([4499, 4501])("rejects crafted Contract value %s against the final award 4500", async custom_contract_value => {
    const m = fixture(); m.put("Legal Document Review", { ...m.get("Legal Document Review", AWARD), grand_total: 4500 });
    await m.request({ ...terms, estimated_contract_value: 50000 });
    const before = structuredClone(m.docs);
    await expect(createRfqContractRequest(team, { rfq: RFQ, expected_modified: String(m.get("Request for Quotation", RFQ).modified), payload: {}, contract_fields: { ...review, custom_contract_value } }, m.deps)).rejects.toMatchObject({ status: 422 });
    expect(m.docs).toEqual(before); expect(await m.deps.list("Contract")).toEqual([]);
    const created = await m.create();
    await expect(guardRfqContractRequestSave({ doctype: "Contract", name: created.contract!.record.name, action: "save", payload: { custom_contract_value } }, team, m.deps)).rejects.toMatchObject({ status: 403 });
    expect(m.get("Contract", String(created.contract!.record.name)).custom_contract_value).toBe(4500);
  });
  it.each([4499, 4501])("the ERP persistence boundary also rejects crafted Contract value %s before any writes", async custom_contract_value => {
    const m = fixture(); m.put("Legal Document Review", { ...m.get("Legal Document Review", AWARD), grand_total: 4500 });
    await m.request({ ...terms, estimated_contract_value: 50000 });
    const summary = await m.summary(), before = structuredClone(m.docs);
    await expect(persistRfqClmDecision({ rfq: RFQ, expected_modified: String(m.get("Request for Quotation", RFQ).modified), actor: { id: team.sub, role: "procurement_team" }, decision: "Yes", create_contract: true,
      award: { ...summary.source, quotation_modified: m.get("Supplier Quotation", SQ).modified, legal_review: AWARD, legal_review_modified: m.get("Legal Document Review", AWARD).modified },
      contract_fields: { ...review, custom_contract_value } }, m.deps)).rejects.toMatchObject({ status: 403, message: expect.stringContaining("final supplier award") });
    expect(m.docs).toEqual(before); expect(await m.deps.list("Contract")).toEqual([]);
  });
  it("routes a Request only after award, then completes that same request and creates its standard Contract", async () => {
    const m = fixture(), award = m.get("Legal Document Review", AWARD);
    const confirmed = await m.confirm();
    const initial = { ...confirmed, request: confirmed.request!.record };
    expect(initial.created).toBe(true); expect(await m.deps.list("Contract")).toEqual([]);
    expect(rfqClmRequestWorkflowView(initial.request!)).toMatchObject({ status: "Pending Procurement Team", stage: "Pending Procurement Team", assignedRole: "procurement_team" });
    expect(await m.summary()).toMatchObject({ status: "Pending", can_create: false, can_request: true, blocks_procurement: true });
    expect(toClmAggregate(team, "Contract Request", initial.request!).actions).toEqual([]);
    m.put("Legal Document Review", award);
    const linked = await ensureInitialRfqContractRequest(manager, RFQ, m.deps);
    expect(linked.request?.name).toBe(initial.request!.name);
    expect(linked.request).toMatchObject({ supplier: "Blue Ridge", contract_value: 30, currency: "USD" });
    expect(parseClmData(linked.request!.custom_clm_data).rfq_source).toMatchObject({ available_award: { award: AWARD, quotation: SQ } });
    const linkedRevision = linked.request?.modified;
    expect((await ensureInitialRfqContractRequest(manager, RFQ, m.deps)).request?.modified).toBe(linkedRevision);
    expect(await m.summary()).toMatchObject({ request_needs_details: true, can_request: true, can_create: false });
    const prepared = await m.request();
    expect(prepared.request.record.name).toBe(initial.request!.name);
    expect(prepared.summary).toMatchObject({ can_create: true, request: { current_stage: "Pending Procurement Team" } });
    expect(await m.deps.list("Contract")).toEqual([]);
    const created = await m.create();
    expect(created.contract!.record).toMatchObject({ custom_contract_request: initial.request!.name, custom_rfq: RFQ, custom_supplier_quotation: SQ, custom_contract_status: "Pending Legal" });
    expect(await m.deps.list("Contract Request")).toHaveLength(1);
    expect(await m.deps.list("Contract")).toHaveLength(1);
  });
  it("retains the procurement gate when saving contract terms on an awarded Request fails", async () => {
    const m = fixture();
    const confirmed = await m.confirm();
    const initial = { ...confirmed, request: confirmed.request!.record };
    expect(initial.request).toMatchObject({ supplier: "Blue Ridge", contract_value: 30, currency: "USD", contract_type: "" });
    expect(parseClmData(initial.request!.custom_clm_data).rfq_source).toMatchObject({ stage: "rfq_awarded", available_award: { award: AWARD, quotation: SQ, supplier: "Blue Ridge" } });
    const save = m.deps.save; let fail = true;
    m.deps.save = vi.fn(async (dt, doc) => { if (dt === "Contract Request" && fail) throw new ClmError("Request terms save denied", 403); return save(dt, doc); });
    await expect(m.request()).rejects.toThrow("Request terms save denied");
    expect(await m.summary()).toMatchObject({ blocks_procurement: true, request_needs_details: true });
    fail = false;
    const resumed = await m.request();
    expect(resumed.request.record.name).toBe(initial.request!.name);
    expect(resumed.summary.recovery_required).toBeUndefined();
    expect(await m.deps.list("Contract Request")).toHaveLength(1);
  });
  it("persists one Team Request, then one standard Contract with Legal actions and matching list/award/RFQ links", async () => {
    const m = fixture(), before = m.get("Legal Document Review", AWARD);
    const submitted = await m.request();
    expect(submitted.created).toBe(false);
    expect(submitted.contract).toBeUndefined(); expect(await m.deps.list("Contract")).toEqual([]);
    const request = await m.deps.load("Contract Request", String(submitted.request.record.name));
    expect(request.request_status).toBe("Pending Review");
    expect(rfqClmRequestWorkflowView(request)).toMatchObject({ assignedRole: "procurement_team", status: "Pending Procurement Team" });
    expect(canReadClm(team, "Contract Request", request)).toBe(true); expect(canReadClm(manager, "Contract Request", request)).toBe(true);
    expect((await m.request()).created).toBe(false);
    const created = await m.create(), contract = created.contract!.record;
    expect(contract).toMatchObject({ custom_rfq: RFQ, custom_contract_request: request.name, custom_supplier_quotation: SQ, custom_contract_status: "Pending Legal" });
    expect(toClmAggregate(legal, "Contract", contract).actions.map(a => a.action)).toEqual(["approve", "reject", "send_back"]);
    expect((await m.deps.list("Contract")).map(row => row.name)).toEqual([contract.name]);
    expect((await m.summary()).contract?.name).toBe(contract.name);
    expect(JSON.parse(String(m.get("Legal Document Review", AWARD).custom_clm_state)).contract).toBe(contract.name);
    expect(m.get("Legal Document Review", AWARD)).toMatchObject({ workflow_state: before.workflow_state, current_owner: before.current_owner, sq_name: SQ });
    expect((await m.create()).contract!.record.name).toBe(contract.name);
    expect(await m.deps.list("Contract")).toHaveLength(1);
  });
  it("permits Procurement Manager to complete the awarded Request and create its standard Contract", async () => {
    const m = fixture(); await m.request(terms, manager);
    const result = await createRfqContractRequest(manager, { rfq: RFQ, expected_modified: (await m.summary()).rfq.modified, contract_fields: review }, m.deps);
    expect(result.contract?.record.custom_contract_status).toBe("Pending Legal");
    expect(await m.deps.list("Contract")).toHaveLength(1);
  });
  it("never creates a Contract at the initial submission stage or skips the Team Request", async () => {
    const m = fixture(); await expect(m.create()).rejects.toThrow("Submit the CLM request");
    expect(m.deps.create).not.toHaveBeenCalled();
  });
  it.each(["contract_purpose", "description", "contract_start_date", "contract_end_date", "contract_type", "estimated_contract_value"])("rejects missing %s before preparing the awarded request or creating a Contract", async field => {
    const m = fixture(); await m.confirm(); vi.mocked(m.deps.create).mockClear(); vi.mocked(m.deps.save).mockClear();
    await expect(m.request({ ...terms, [field]: "" })).rejects.toBeInstanceOf(ClmError);
    expect(m.deps.create).not.toHaveBeenCalled(); expect(m.deps.save).not.toHaveBeenCalled();
  });
  it("keeps forged source documents and mismatched RFQ references out of persistence", async () => {
    const m = fixture(); await m.confirm(); vi.mocked(m.deps.create).mockClear();
    await expect(m.request({ ...terms, supporting_document: "/private/files/RFQ_PUR-RFQ-2026-00091.pdf" })).rejects.toMatchObject({ status: 403 });
    await expect(m.request({ ...terms, custom_rfq: "PUR-RFQ-2026-00091" })).rejects.toMatchObject({ status: 403 });
    expect(m.deps.create).not.toHaveBeenCalled();
  });
  it("returns the real persistence failure, retains recovery state, and resumes the same request after retry", async () => {
    const m = fixture(), save = m.deps.save;
    let fail = true;
    m.deps.save = vi.fn(async (dt, doc) => { if (dt === "Legal Document Review" && fail) throw new ClmError("Award CLM mirror write was denied", 403); return save(dt, doc); });
    await expect(m.request()).rejects.toThrow("Award CLM mirror write was denied");
    expect(await m.deps.list("Contract Request")).toHaveLength(1); expect(await m.deps.list("Contract")).toHaveLength(0);
    expect(await m.summary()).toMatchObject({ recovery_required: true, can_request: false, blocks_procurement: true });
    expect(m.deps.notify).not.toHaveBeenCalled();
    fail = false; const result = await m.request();
    expect(result.created).toBe(false); expect(result.summary.recovery_required).toBeUndefined();
    expect(await m.deps.list("Contract Request")).toHaveLength(1);
  });
  it("recovers a lost Request insert response without inserting twice", async () => {
    const m = fixture(), create = m.deps.create;
    m.deps.create = vi.fn(async (dt, doc) => { const result = await create(dt, doc); if (dt === "Contract Request") throw new ClmError("ERP response lost", 504); return result; });
    const result = await m.request(); expect(result.request.record.name).toBeTruthy();
    expect(await m.deps.list("Contract Request")).toHaveLength(1); expect(m.deps.create).toHaveBeenCalledOnce();
  });
  it.each([false, true])("does not accept incorrectly persisted Request terms, including retry (lost response: %s)", async lost => {
    const m = fixture(), create = m.deps.create;
    m.deps.create = vi.fn(async (dt, doc) => {
      const result = await create(dt, dt === "Contract Request" ? { ...doc, contract_type: "NDA" } : doc);
      if (lost) throw new ClmError("ERP response lost", 504);
      return result;
    });
    await expect(m.confirm()).rejects.toThrow("did not persist Contract Request.contract_type");
    // Retry must compare with the original persisted insert intent, not the bad term.
    await expect(m.confirm()).rejects.toThrow("did not persist Contract Request.contract_type");
    expect(await m.summary()).toMatchObject({ recovery_required: true, blocks_procurement: true });
    expect(await m.deps.list("Contract Request")).toHaveLength(1);
    expect(await m.deps.list("Contract")).toHaveLength(0);
    expect(m.deps.notify).not.toHaveBeenCalled();
    expect(JSON.parse(String(m.get("Request for Quotation", RFQ).custom_approval_data)).clm_initial_request.phase).toBe("saving");
  });
  it.each([false, true])("does not advance a Contract with incorrectly persisted terms (lost response: %s)", async lost => {
    const m = fixture(); await m.request(); const create = m.deps.create;
    vi.mocked(m.deps.notify!).mockClear();
    m.deps.create = vi.fn(async (dt, doc) => {
      const result = await create(dt, dt === "Contract" ? { ...doc, contract_terms: "Incorrect terms" } : doc);
      if (lost) throw new ClmError("ERP response lost", 504);
      return result;
    });
    await expect(m.create()).rejects.toThrow("did not persist the Contract contract_terms");
    await expect(m.create()).rejects.toThrow("did not persist the Contract contract_terms");
    const contracts = await m.deps.list("Contract");
    expect(contracts).toHaveLength(1); expect(contracts[0].custom_contract_status).toBe("Draft");
    expect(parseClmData(contracts[0].custom_clm_data).approvals).toHaveLength(0);
    expect(await m.summary()).toMatchObject({ recovery_required: true, blocks_procurement: true });
    expect(m.deps.notify).not.toHaveBeenCalled();
  });
  it("resumes a partially created Contract after a Legal save failure without creating another Contract", async () => {
    const m = fixture(); await m.request(); const save = m.deps.save; let fail = true;
    m.deps.save = vi.fn(async (dt, doc) => { if (dt === "Contract" && doc.custom_contract_status === "Pending Legal" && fail) throw new ClmError("Contract save denied", 403); return save(dt, doc); });
    await expect(m.create()).rejects.toThrow("Contract save denied");
    expect(await m.summary()).toMatchObject({ recovery_required: true, can_create: true, blocks_procurement: true });
    expect(await m.deps.list("Contract")).toHaveLength(1);
    fail = false; const result = await m.create();
    expect(result.contract!.record.custom_contract_status).toBe("Pending Legal");
    expect(await m.deps.list("Contract")).toHaveLength(1); expect(result.summary.recovery_required).toBeUndefined();
  });
  it("records No without a Request/Contract and without changing existing RFQ or award workflow fields", async () => {
    const m = fixture("No"); const result = await decideRfqContractRequirement(team, { rfq: RFQ, expected_modified: "r1", decision: "No" }, m.deps);
    expect(result.summary).toMatchObject({ decision: "No", continuation_ready: true });
    expect(await m.deps.list("Contract Request")).toEqual([]); expect(await m.deps.list("Contract")).toEqual([]);
    expect(m.get("Request for Quotation", RFQ)).toMatchObject({ status: "Submitted", docstatus: 1 });
    expect(m.get("Legal Document Review", AWARD)).toMatchObject({ workflow_state: "Pending Review", current_owner: "Legal Reviewer" });
  });
  it("keeps the RFQ saved Yes when a conflicting legacy No request races award routing", async () => {
    const m = fixture(); const result = await Promise.allSettled([m.request(), decideRfqContractRequirement(team, { rfq: RFQ, expected_modified: "r1", decision: "No" }, m.deps)]);
    expect(result[0].status).toBe("fulfilled"); expect(result[1].status).toBe("rejected");
    expect((await m.summary()).decision).toBe("Yes");
    expect(m.get("Request for Quotation", RFQ).contract_required).toBe("Yes");
    expect(await m.deps.list("Contract Request")).toHaveLength(1);
  });
  it("uses database uniqueness for concurrent Request and Contract submissions", async () => {
    const m = fixture(); await Promise.allSettled([m.request(), m.request()]);
    expect(await m.deps.list("Contract Request")).toHaveLength(1);
    await Promise.allSettled([m.create(), m.create()]);
    expect(await m.deps.list("Contract")).toHaveLength(1);
    const resumed = await m.create(); expect(resumed.summary.recovery_required).toBeUndefined();
  });
  it.each(["Contract Request", "Contract"])("does not reserve another %s insert after a concurrent winner has verified it", async dt => {
    const m = fixture(); if (dt === "Contract") await m.request();
    const list = m.deps.list; let emptyReads = 0, raced = false;
    m.deps.list = vi.fn(async (doctype, filters = []) => {
      const records = await list(doctype, filters);
      const operation = JSON.parse(String(m.get("Request for Quotation", RFQ).custom_approval_data || "{}"))[dt === "Contract" ? "clm_rest_operation" : "clm_initial_request"];
      const field = dt === "Contract" ? "custom_contract_request" : "custom_rfq";
      if (!raced && doctype === dt && !records.length && filters.some(row => row[0] === field) && operation?.phase === "saving" && !operation.pending_insert && ++emptyReads === (dt === "Contract" ? 2 : 1)) {
        // Delay this empty lookup until the winner has inserted and advanced.
        raced = true;
        if (dt === "Contract") await m.create(); else await m.confirm();
      }
      return records;
    });
    const result = dt === "Contract" ? await m.create() : await m.request();
    expect(raced).toBe(true); expect(result.created).toBe(false);
    const operation = JSON.parse(String(m.get("Request for Quotation", RFQ).custom_approval_data))[dt === "Contract" ? "clm_rest_operation" : "clm_initial_request"];
    expect(operation.phase).toBe("complete"); expect(operation.pending_insert).toBeUndefined();
    if (dt === "Contract") expect(operation.verified_inserts[dt]).toBeTruthy(); else expect(operation.request).toBeTruthy();
    expect((await m.summary()).recovery_required).toBeUndefined();
    // A later real handoff remains possible after the double-click.
    await m.create(); expect(await m.deps.list("Contract")).toHaveLength(1);
  });
  it("does not advance Finance or Procurement when Legal sends the Contract back", async () => {
    const m = fixture(); await m.request(); const created = await m.create();
    const sentBack = await applyClmAction({ doctype: "Contract", name: String(created.contract!.record.name), expected_modified: String(created.contract!.record.modified), action: "send_back", comment: "Correct the delivery clauses." }, legal, m.deps);
    await syncRfqClmRestContract(sentBack.record, m.deps);
    expect((await m.summary()).blocks_procurement).toBe(true);
    expect(parseClmData(sentBack.record.custom_clm_data).rfq_workflow?.phase).toBe("draft");
  });
  it("blocks an incomplete lifecycle mirror and repairs it without replaying Legal approval or creating another Contract", async () => {
    const m = fixture(); await m.request(); const created = await m.create();
    const name = String(created.contract!.record.name), before = m.get("Contract", name);
    m.put("Legal Document Review", { ...m.get("Legal Document Review", AWARD), custom_clm_state: JSON.stringify({ contract: name, status: "Draft" }) });
    expect(await m.summary()).toMatchObject({ recovery_required: true, can_create: true, continuation_ready: false, blocks_procurement: true });
    const repaired = await m.create();
    expect(repaired.created).toBe(false); expect(repaired.summary.recovery_required).toBeUndefined();
    expect(m.get("Contract", name)).toEqual(before); expect(await m.deps.list("Contract")).toHaveLength(1);
  });
});
