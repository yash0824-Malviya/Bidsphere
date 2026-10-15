import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { assertRfqClmReadyForProcurement, canInitiateRfqClm, canReadRfqClm, createRfqContractRequest, recordRfqContractRequest, decideRfqContractRequirement, getRfqClmSummary, guardRfqContractRequestSave, resolveDesignatedLegalSignatory, type RfqClmDeps } from "./rfqClmCore";
import { applyClmAction, canReadClm, clmSnapshotHash, ClmError, parseClmData, toClmAggregate } from "./clmCore";
import { resolveServerRole, type AccessPrincipal, type AppRole } from "./rbacAuth";
import type { ClmActionName, ClmField, ClmRecord } from "../src/types/clm";
import { ROLE_LABELS } from "../src/config/roles";
import { rfqClmRequestWorkflowView } from "../src/utils/rfqClmWorkflow";

const principal = (role: AppRole = "procurement_team"): AccessPrincipal => ({ typ: "internal", role, email: `${role}@test.example`, sub: `${role}@test.example`, iat: 1, exp: 9999999999 });
const team = principal();
const required = ["department", "company", "contract_type", "contract_purpose", "description", "supplier", "contract_start_date", "contract_end_date", "contract_value", "estimated_contract_value", "currency"];
const details = { estimated_contract_value: 300, department: "BUY", contract_type: "Supply / Procurement Contract", contract_start_date: "2026-10-01", contract_end_date: "2027-09-30" };
const contractReview = { custom_risk_level: "Low", custom_inteva_signatory: "legal@test.example" };
const rfq: ClmRecord = { name: "RFQ-1", modified: "r1", contract_required: "Yes", company: "Inteva", title: "Machined parts", message_for_supplier: "Supply parts per specification", docstatus: 1, status: "Submitted" };

describe("Draft RFQ CLM timing", () => {
  it.each(["Yes", "No"])("keeps a saved %s decision inactive before submission even if award data exists", async contract_required => {
    const m = fixture();
    m.put("Request for Quotation", { ...rfq, docstatus: 0, status: "Draft", contract_required });
    const result = await m.summary();
    expect(result).toMatchObject({ status: "Awaiting Supplier Award", can_create: false, can_request: false, can_decide: false });
    expect(result.initial_request_required).toBeUndefined();
    expect(result.rfq.docstatus).toBe(0);
    await expect(recordRfqContractRequest(team, { rfq: "RFQ-1", expected_modified: "r1", payload: details }, m.deps)).rejects.toMatchObject({ status: 409 });
    expect(m.deps.create).not.toHaveBeenCalled();
  });
});
function fixture() {
  const docs = new Map<string, ClmRecord>(); let sequence = 0;
  const put = (dt: string, doc: ClmRecord) => { docs.set(`${dt}/${doc.name}`, structuredClone(doc)); return doc; };
  put("Request for Quotation", rfq);
  put("Supplier", { name: "SUP-1", disabled: 0 });
  put("User", { name: "legal@test.example", email: "legal@test.example", enabled: 1, roles: [{ role: "Legal Manager" }] });
  put("Supplier Quotation", { name: "SQ-1", modified: "q1", supplier: "SUP-1", company: "Inteva", currency: "USD", grand_total: 300, items: [{ request_for_quotation: "RFQ-1" }], docstatus: 1 });
  put("Legal Document Review", { name: "LDR-1", rfq_name: "RFQ-1", sq_name: "SQ-1", supplier: '"SUP-1"', company: "Inteva", grand_total: 250, workflow_state: "Pending Review", review_status: "Pending", finance_status: "Pending" });
  const fields: ClmField[] = required.map(fieldname => ({ fieldname, fieldtype: "Data", reqd: 1 }));
  fields.push({ fieldname: "custom_rfq", fieldtype: "Link", unique: 1 });
  fields.find(f => f.fieldname === "currency")!.fieldtype = "Select"; fields.find(f => f.fieldname === "currency")!.options = "USD\nINR";
  const filter = (doc: ClmRecord, filters: unknown[]) => filters.every(raw => {
    const tuple = raw as unknown[];
    const [field, op, value] = tuple.length === 4 ? tuple.slice(1) : tuple;
    const values = tuple.length === 4 ? (doc.items as ClmRecord[] || []).map(row => row[String(field)]) : [doc[String(field)]];
    return op === "=" ? values.includes(value) : op === "!=" ? !values.includes(value) : true;
  });
  const deps: RfqClmDeps = {
    load: vi.fn(async (dt, name) => { const row = docs.get(`${dt}/${name}`); if (!row) throw new ClmError(`Missing ${dt}/${name}`, 404); return structuredClone(row); }),
    list: vi.fn(async (dt, filters = []) => [...docs.entries()].filter(([key, row]) => key.startsWith(`${dt}/`) && filter(row, filters)).map(([, row]) => structuredClone(row))),
    create: vi.fn(async (dt, doc) => {
      if (dt === "Contract Request" && doc.custom_rfq && [...docs.entries()].some(([key, row]) => key.startsWith("Contract Request/") && row.custom_rfq === doc.custom_rfq)) throw new ClmError("Duplicate custom_rfq", 409);
      return put(dt, { ...doc, name: `CR-${++sequence}`, modified: String(sequence) });
    }),
    save: vi.fn(async (dt, doc) => put(dt, { ...doc, modified: String(++sequence) })),
    fields: vi.fn(async () => structuredClone(fields)), now: () => "2026-09-17 12:00:00",
  };
  // Model one ERP transaction, including rollback and serialized row locking.
  let queue = Promise.resolve();
  deps.decide = vi.fn(input => {
    const operation = queue.then(async () => {
      const parent = structuredClone(docs.get(`Request for Quotation/${input.rfq}`)!);
      const approval = JSON.parse(String(parent.custom_approval_data || "{}"));
      if (approval.contract_decision) {
        if (approval.contract_decision.decision !== input.decision) throw new ClmError("Decision already recorded", 409);
        const existing = docs.get(`Contract Request/${approval.contract_decision.request}`);
        const routingLegacy = !input.create_contract && !!input.request_document && existing && !parseClmData(existing.custom_clm_data).rfq_request_workflow;
        if ((!input.create_contract && !routingLegacy) || approval.contract_decision.contract) return { created: false, request: existing, contract: docs.get(`Contract/${approval.contract_decision.contract}`) };
      }
      if (!approval.contract_decision && parent.modified !== input.expected_modified) throw new ClmError("RFQ changed", 409);
      const before = structuredClone(docs);
      try {
        let request = approval.contract_decision?.request ? structuredClone(docs.get(`Contract Request/${approval.contract_decision.request}`)) : input.request_document ? await deps.create("Contract Request", input.request_document) : undefined;
        if (request && input.request_document && approval.contract_decision?.request && !input.create_contract) request = put("Contract Request", { ...input.request_document, name: request.name, modified: request.modified });
        let contract: ClmRecord | undefined;
        if (request && input.create_contract) {
          const data = parseClmData(request.custom_clm_data);
          const context = { rfq_id: input.rfq, award_id: input.award.award, supplier_id: request.supplier, quotation_id: request.custom_supplier_quotation, contract_type: request.contract_type, contract_status: "Draft", contract_required: "Yes" };
          contract = await deps.create("Contract", {
            party_type: "Supplier", party_name: request.supplier, custom_supplier: request.supplier,
            custom_rfq: input.rfq, custom_contract_request: request.name, custom_supplier_quotation: request.custom_supplier_quotation,
            custom_contract_title: request.contract_purpose, contract_terms: request.description, custom_contract_type: request.contract_type,
            start_date: request.contract_start_date, end_date: request.contract_end_date, custom_contract_value: request.contract_value,
            custom_currency: request.currency, custom_contract_status: "Draft", custom_approval_status: "Pending", custom_esign_status: "Not Started", custom_legal_review_required: 1,
            ...Object.fromEntries(["custom_project", "custom_business_unit", "custom_purchase_order"].filter(key => request![key]).map(key => [key, request![key]])),
            custom_clm_data: JSON.stringify({ ...parseClmData(null), rfq_source: data.rfq_source, rfq_context: context, source_documents: data.source_documents }),
          });
          data.contract = contract.name;
          data.rfq_request_workflow = { version: 1, phase: "contract_created", assigned_role: "procurement_team" };
          for (const row of data.approvals) if (row.role === "procurement_team" && row.stage === 0 && row.status === "Pending") Object.assign(row, { status: "Approved", by: input.actor.id, at: deps.now(), comment: "Procurement Team reviewed and created the Contract." });
          data.audit.push({ id: `TEAM-CREATE-${sequence}`, action: "procurement_team_processed", by: input.actor.id, role: "procurement_team", at: deps.now(), previous_status: "Pending Procurement Team", new_status: "Completed", comment: "Contract created", reference_id: String(contract.name) });
          request = put("Contract Request", { ...request, request_status: "Completed", custom_clm_data: JSON.stringify(data) });
          contract = (await applyClmAction({ doctype: "Contract", name: String(contract.name), action: "save", expected_modified: String(contract.modified), payload: input.contract_fields }, team, { ...deps, notify: undefined })).record;
          contract = (await applyClmAction({ doctype: "Contract", name: String(contract.name), action: "submit_review", expected_modified: String(contract.modified) }, team, { ...deps, notify: undefined })).record;
        }
        put("Request for Quotation", { ...parent, modified: "r2", contract_required: input.decision,
          custom_approval_data: JSON.stringify({ ...approval, contract_decision: { decision: input.decision, quotation: input.award.quotation, supplier: input.award.supplier, award: input.award.award, legal_review: input.award.legal_review, by: input.actor.id, at: deps.now(), ...approval.contract_decision, request: request?.name, contract: contract?.name } }) });
        return { created: !!request, request, contract };
      } catch (error) { docs.clear(); for (const [key, value] of before) docs.set(key, value); throw error; }
    });
    queue = operation.then(() => undefined, () => undefined);
    return operation;
  });
  const get = (dt: string, name: string) => structuredClone(docs.get(`${dt}/${name}`)!);
  const request = (payload: ClmRecord = details, expected_modified = "r1", who = team) => recordRfqContractRequest(who, { rfq: "RFQ-1", expected_modified, payload }, deps);
  // Existing lifecycle tests explicitly exercise two separate backend operations.
  const create = async (payload: ClmRecord = details, expected_modified = "r1", who = team) => {
    const existing = [...docs.entries()].some(([key, row]) => key.startsWith("Contract Request/") && row.custom_rfq === "RFQ-1");
    if (!existing) expected_modified = (await request(payload, expected_modified, who)).summary.rfq.modified;
    return createRfqContractRequest(who, { rfq: "RFQ-1", expected_modified, payload, contract_fields: contractReview }, deps);
  };
  return { docs, put, get, deps, fields, request, create, summary: (who = team) => getRfqClmSummary(who, "RFQ-1", deps) };
}

async function requestOnlyFixture() {
  const m = fixture();
  await m.request();
  vi.mocked(m.deps.decide!).mockClear();
  vi.mocked(m.deps.create).mockClear();
  return m;
}

describe("RFQ to existing Contract Request", () => {
  it.each(["procurement.team", "procurement_team", "Procurement Team", "procurement team"])("persists a Procurement request accessible to Team and Manager after resolving ERP role %s", async role => {
    const resolvedRole = resolveServerRole({ name: "assigned-buyer@test.example", email: "assigned-buyer@test.example", erpnext_roles: [role] });
    expect(resolvedRole).toBe("procurement_team");
    const who = principal(resolvedRole!);
    const m = fixture();
    const result = await m.request(details, "r1", who);
    const saved = await m.deps.load("Contract Request", String(result.request.record.name));
    expect(parseClmData(saved.custom_clm_data)).toMatchObject({ rfq_request_workflow: { phase: "procurement_team", assigned_role: "procurement_team" }, approvals: [{ role: "procurement_team", status: "Pending" }] });
    expect(result.summary).toMatchObject({ contract_required: "Yes", status: "Pending Procurement Team" });
    const rows = await m.deps.list("Contract Request");
    expect(rows.filter(record => canReadClm(who, "Contract Request", record) && rfqClmRequestWorkflowView(record)).map(record => record.name)).toEqual([saved.name]);
    expect(rows.filter(record => canReadClm(principal("procurement"), "Contract Request", record) && rfqClmRequestWorkflowView(record)).map(record => record.name)).toEqual([saved.name]);
    expect(await m.deps.list("Contract")).toEqual([]);
  });
  it.each([
    ["PUR-RFQ-2026-00093", "LDC2026-00024", "Apex Fasteners Ltd", "PUR-SQTN-2026-00263", 2500],
    ["PUR-RFQ-2026-00094", "LDC2026-00025", "FEMSA", "PUR-SQTN-2026-00267", 2600],
    ["PUR-RFQ-2026-00095", "LDC2026-00026", '"Blue Ridge Manufacturing Inc"', "PUR-SQTN-2026-00270", 30],
  ] as const)("routes the %s award fixture to Team before creating its single Legal Contract", async (rfqName, awardName, supplier, quotation, amount) => {
    // Local ERP fixture only: these identities do not establish live production state.
    const m = fixture(); m.docs.clear();
    m.put("Request for Quotation", { ...rfq, name: rfqName, company: "Netlink" });
    m.put("Supplier", { name: supplier, disabled: 0 });
    m.put("User", { name: "legal@test.example", email: "legal@test.example", enabled: 1, roles: [{ role: "Legal Manager" }] });
    m.put("Supplier Quotation", { name: quotation, modified: "q1", supplier, company: "Netlink", currency: "USD", grand_total: amount, items: [{ request_for_quotation: rfqName }], docstatus: 1 });
    m.put("Legal Document Review", { name: awardName, rfq_name: rfqName, sq_name: quotation, supplier, company: "Netlink", grand_total: amount, workflow_state: "Pending Review", review_status: "Pending", finance_status: "Pending" });
    const requested = await recordRfqContractRequest(team, { rfq: rfqName, expected_modified: "r1", payload: details }, m.deps);
    const requestName = String(requested.request.record.name);
    const stored = await m.deps.load("Contract Request", requestName);
    expect(parseClmData(stored.custom_clm_data).rfq_source).toMatchObject({ rfq: rfqName, award: awardName, supplier, quotation, amount, contract_required: true });
    expect(rfqClmRequestWorkflowView(stored)).toMatchObject({ rfq: rfqName, award: awardName, assignedRole: "procurement_team", status: "Pending Procurement Team" });
    expect(canReadClm(team, "Contract Request", stored)).toBe(true);
    expect(canReadClm(principal("procurement"), "Contract Request", stored)).toBe(true);
    expect(await m.deps.list("Contract")).toEqual([]);
    const input = { rfq: rfqName, expected_modified: requested.summary.rfq.modified, payload: {}, contract_fields: contractReview };
    const created = await createRfqContractRequest(principal("procurement"), input, m.deps);
    expect(created.contract!.record).toMatchObject({ custom_rfq: rfqName, custom_contract_request: requestName, custom_supplier: supplier, custom_supplier_quotation: quotation, custom_contract_status: "Pending Legal" });
    expect(parseClmData(created.contract!.record.custom_clm_data)).toMatchObject({ rfq_context: { rfq_id: rfqName, award_id: awardName, supplier_id: supplier, quotation_id: quotation }, rfq_workflow: { phase: "legal_review" }, approvals: [{ role: "legal", stage: 0, status: "Pending" }] });
    const listed = (await m.deps.list("Contract")).filter(record => canReadClm(team, "Contract", record));
    expect(listed.map(record => record.name)).toEqual([created.contract!.record.name]);
    expect((await getRfqClmSummary(team, rfqName, m.deps)).contract?.name).toBe(listed[0].name);
    expect(toClmAggregate(principal("legal"), "Contract", listed[0]).actions.map(action => action.action)).toEqual(["approve", "reject", "send_back"]);
    expect(toClmAggregate(principal("finance"), "Contract", listed[0]).actions).toEqual([]);
    await expect(assertRfqClmReadyForProcurement(rfqName, m.deps)).rejects.toMatchObject({ status: 409 });
    expect((await createRfqContractRequest(team, input, m.deps)).contract!.record.name).toBe(created.contract!.record.name);
    expect(await m.deps.list("Contract")).toHaveLength(1);
  });
  it("requires the persisted Team request before any Contract creation", async () => {
    const m = fixture();
    await expect(createRfqContractRequest(team, { rfq: "RFQ-1", expected_modified: "r1", payload: details, contract_fields: contractReview }, m.deps)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Submit the CLM request") });
    expect(m.deps.decide).not.toHaveBeenCalled(); expect(m.deps.create).not.toHaveBeenCalled();
  });
  it("records Yes as one persistent Team request without creating or notifying a Legal Contract", async () => {
    const m = fixture(); m.deps.notify = vi.fn(async () => undefined);
    const result = await decideRfqContractRequirement(team, { rfq: "RFQ-1", expected_modified: "r1", decision: "Yes", payload: details }, m.deps);
    expect(result.contract).toBeUndefined(); expect(result.created).toBe(true);
    expect(result.summary).toMatchObject({ decision: "Yes", contract_required: "Yes", can_request: false, can_create: true, status: "Pending Procurement Team", blocks_procurement: true, request: { name: result.request!.record.name, assigned_role: "procurement_team", current_stage: "Pending Procurement Team" } });
    const persisted = m.get("Contract Request", String(result.request!.record.name));
    expect(persisted).toEqual(result.request!.record);
    expect(parseClmData(persisted.custom_clm_data)).toMatchObject({ rfq_request_workflow: { version: 1, phase: "procurement_team", assigned_role: "procurement_team" }, rfq_source: { rfq: "RFQ-1", award: "LDR-1", supplier: "SUP-1", quotation: "SQ-1", amount: 250, contract_required: true }, approvals: [{ role: "procurement_team", stage: 0, status: "Pending" }], audit: expect.arrayContaining([expect.objectContaining({ action: "procurement_team_assigned", role: "procurement_team", new_status: "Pending Procurement Team" })]) });
    expect([...m.docs.keys()].filter(key => key.startsWith("Contract/"))).toEqual([]);
    expect(m.deps.notify).toHaveBeenCalledExactlyOnceWith("Contract Request", persisted, "procurement_team_assigned", expect.arrayContaining([expect.objectContaining({ role: "procurement_team" })]));
    expect((await m.request({}, "stale")).request.record.name).toBe(persisted.name);
    expect(m.deps.decide).toHaveBeenCalledTimes(1); expect(m.deps.notify).toHaveBeenCalledTimes(1);
    await expect(assertRfqClmReadyForProcurement("RFQ-1", m.deps)).rejects.toMatchObject({ status: 409 });
  });
  it("rejects a request transaction that omits its persisted Team assignment", async () => {
    const m = fixture(), insert = m.deps.create;
    m.deps.create = vi.fn(async (dt, doc) => {
      const data = parseClmData(doc.custom_clm_data); delete data.rfq_request_workflow;
      return insert(dt, { ...doc, custom_clm_data: JSON.stringify(data) });
    });
    await expect(m.request()).rejects.toThrow("Procurement Team request assignment");
    expect([...m.docs.keys()].filter(key => key.startsWith("Contract/"))).toEqual([]);
  });
  it("routes an existing unassigned legacy Yes request before allowing Team conversion without replacing its terms", async () => {
    const m = await requestOnlyFixture(), summary = await m.summary();
    const saved = m.get("Contract Request", summary.request!.name), data = parseClmData(saved.custom_clm_data);
    delete data.rfq_request_workflow; data.approvals = []; data.audit = data.audit.filter(row => row.action !== "procurement_team_assigned");
    const legacy = { ...saved, custom_clm_data: JSON.stringify(data) }; m.put("Contract Request", legacy);
    expect(await m.summary()).toMatchObject({ can_request: true, can_create: false, decision: "Yes" });
    await expect(createRfqContractRequest(team, { rfq: "RFQ-1", expected_modified: "r2", payload: {}, contract_fields: contractReview }, m.deps)).rejects.toMatchObject({ status: 409 });
    const routed = await m.request({}, "r2");
    expect(routed.request.record).toMatchObject({ ...legacy, custom_clm_data: expect.any(String) });
    expect(parseClmData(routed.request.record.custom_clm_data).audit.slice(0, data.audit.length)).toEqual(data.audit);
    expect(rfqClmRequestWorkflowView(routed.request.record)?.assignedRole).toBe("procurement_team");
    expect(m.deps.create).not.toHaveBeenCalled();
    expect((await m.create({}, routed.summary.rfq.modified)).contract?.record.custom_contract_status).toBe("Pending Legal");
    expect(m.deps.create).toHaveBeenCalledExactlyOnceWith("Contract", expect.any(Object));
  });
  it.each([false, true])("notifies Legal only after the verified transaction, including lost-response=%s", async lostResponse => {
    const m = fixture(); const commit = m.deps.decide!;
    if (lostResponse) m.deps.decide = vi.fn(async input => { await commit(input); throw new Error("Response lost after commit"); });
    m.deps.notify = vi.fn(async (doctype, contract, event, approvals) => {
      if (doctype === "Contract Request") {
        expect(event).toBe("procurement_team_assigned");
        expect(m.get("Contract Request", String(contract.name))).toEqual(contract);
        expect([...m.docs.keys()].filter(key => key.startsWith("Contract/"))).toEqual([]);
        expect(approvals).toEqual([expect.objectContaining({ role: "procurement_team", stage: 0, status: "Pending" })]);
        return;
      }
      expect(doctype).toBe("Contract"); expect(event).toBe("legal_review_started");
      expect(m.get("Contract", String(contract.name))).toEqual(contract);
      expect(JSON.parse(String(m.get("Request for Quotation", "RFQ-1").custom_approval_data)).contract_decision.contract).toBe(contract.name);
      expect(approvals).toEqual([expect.objectContaining({ role: "legal", stage: 0, status: "Pending" })]);
    });
    const result = await m.create(); expect(result.created).toBe(!lostResponse);
    expect(m.deps.notify).toHaveBeenCalledTimes(2);
    expect((await m.create({}, "stale")).contract?.record.name).toBe(result.contract!.record.name);
    expect(m.deps.notify).toHaveBeenCalledTimes(2);
  });
  it("returns a notification warning while retaining the successful Contract and Legal assignment", async () => {
    const m = fixture(); m.deps.notify = vi.fn(async () => { throw new Error("Notification service unavailable"); });
    const result = await m.create();
    expect(result.created).toBe(true); expect(result.contract!.record.custom_contract_status).toBe("Pending Legal");
    expect(result.contract!.warnings).toEqual([expect.stringContaining("notification could not be delivered")]);
    expect(result.summary.warnings).toContain(result.contract!.warnings![0]);
    expect((await m.create({}, "stale")).contract?.record.name).toBe(result.contract!.record.name);
    expect(m.deps.notify).toHaveBeenCalledTimes(2); expect(m.deps.create).toHaveBeenCalledTimes(2);
  });
  it.each([undefined, {}, { custom_risk_level: "" }, { ...contractReview, custom_risk_level: "Unknown" }, { ...contractReview, custom_inteva_signatory: "" }, { ...contractReview, custom_contract_status: "Executed" }])("requires real Legal review authoring fields before the transaction: %j", async contract_fields => {
    const m = await requestOnlyFixture(); const before = structuredClone(m.docs);
    await expect(createRfqContractRequest(team, { rfq: "RFQ-1", expected_modified: "r2", payload: details, contract_fields }, m.deps)).rejects.toMatchObject({ status: 422 });
    expect(m.deps.decide).not.toHaveBeenCalled(); expect(m.deps.create).not.toHaveBeenCalled();
    expect(m.docs).toEqual(before);
  });
  it("creates the Contract without requiring custom_risk_level and defaults risk level to Low", async () => {
    const m = await requestOnlyFixture();
    const result = await createRfqContractRequest(team, { rfq: "RFQ-1", expected_modified: "r2", payload: details, contract_fields: { custom_inteva_signatory: "legal@test.example" } }, m.deps);
    expect(result.created).toBe(true);
    expect(result.contract!.record.custom_contract_status).toBe("Pending Legal");
    expect(result.contract!.record.custom_risk_level).toBe("Low");
    expect(result.contract!.record.custom_inteva_signatory).toBe("legal@test.example");
  });
  it.each([{ enabled: 0, roles: [{ role: "Legal Manager" }] }, { enabled: 1, roles: [{ role: "Finance Manager" }] }])("rejects an unavailable or non-Legal signatory without saving: %j", async patch => {
    const m = await requestOnlyFixture(); m.put("User", { ...m.get("User", "legal@test.example"), ...patch });
    await expect(m.create(details, "r2")).rejects.toThrow("enabled Legal Manager");
    expect(m.deps.decide).not.toHaveBeenCalled(); expect(m.deps.create).not.toHaveBeenCalled();
  });
  it.each([false, true])("rejects a stale extension Draft without Legal assignment with lost response=%s", async lostResponse => {
    const m = fixture(); const commit = m.deps.decide!;
    m.deps.decide = vi.fn(async input => {
      const result = await commit(input); if (!input.create_contract) return result;
      const contract = result.contract!;
      const data = parseClmData(contract.custom_clm_data);
      data.approvals = []; data.rfq_workflow = { version: 1, phase: "draft" };
      data.audit = data.audit.filter(row => row.action !== "legal_review_started");
      data.rfq_context = { ...data.rfq_context as ClmRecord, contract_status: "Draft" };
      const persisted = { ...contract, custom_contract_status: "Draft", custom_clm_data: JSON.stringify(data) };
      m.put("Contract", persisted);
      if (lostResponse) throw new Error("Response lost after commit");
      return { ...result, contract: persisted };
    });
    await expect(m.create()).rejects.toThrow("required Legal review assignment");
  });
  it("generates editable wording for this exact award and never defaults the contract type", async () => {
    const m = fixture(); m.put("Request for Quotation", { ...rfq, contract_type: "NDA" });
    m.put("Supplier", { name: "SUP-1", supplier_name: "Apex Fasteners Ltd", disabled: 0 });
    const summary = await m.summary();
    expect(summary.prefill.contract_type).toBeUndefined();
    expect(summary.prefill.contract_purpose).toBe("Procurement of goods/services from Apex Fasteners Ltd under RFQ RFQ-1.");
    expect(summary.prefill.description).toContain("Award: LDR-1\nWinning Quotation: SQ-1\nAward Value: USD 250\nCompany: Inteva");
    expect(summary.prefill.description).toContain("Supply parts per specification");
    const saved = await m.create({ ...details, contract_purpose: "Edited purpose", description: "Agreed scope" });
    expect(saved.request.record).toMatchObject({ contract_purpose: "Edited purpose", description: "Agreed scope", legal_review_required: 1 });
    expect(parseClmData(saved.request.record.custom_clm_data).rfq_source).toMatchObject({ award: "LDR-1", company: "Inteva", department: "BUY", amount: 250, currency: "USD" });
  });
  it("resolves the Material Request department within the awarded company and locks it", async () => {
    const m = fixture(); m.put("Request for Quotation", { ...rfq, items: [{ material_request: "MR-1" }] });
    m.put("Material Request", { name: "MR-1", company: "Inteva", custom_department: "Production", docstatus: 1 });
    m.put("Department", { name: "Production - I", department_name: "Production", company: "Inteva" });
    m.put("Department", { name: "Production - O", department_name: "Production", company: "Other" });
    const summary = await m.summary();
    expect(summary.prefill.department).toBe("Production - I"); expect(summary.locked_fields).toContain("department");
    await expect(m.create()).rejects.toMatchObject({ status: 403 });
    const saved = await m.create({ ...details, department: "Production - I" });
    expect(saved.request.record.department).toBe("Production - I");
    m.put("Department", { name: "Production - I2", department_name: "Production", company: "Inteva" });
    const fresh = fixture(); fresh.put("Request for Quotation", { ...rfq, items: [{ material_request: "MR-1" }] });
    for (const [key, value] of m.docs) if (key.startsWith("Department/") || key.startsWith("Material Request/")) fresh.docs.set(key, value);
    expect((await fresh.summary()).prefill.department).toBeUndefined();
  });
  it("does not block a legacy No-contract decision because optional MR department lineage is missing", async () => {
    const m = fixture(); m.put("Request for Quotation", { ...rfq, contract_required: "No", items: [{ material_request: "MR-ARCHIVED" }] });
    expect((await m.summary()).prefill.department).toBeUndefined();
    await decideRfqContractRequirement(team, { rfq: "RFQ-1", expected_modified: "r1", decision: "No" }, m.deps);
    await assertRfqClmReadyForProcurement("RFQ-1", m.deps);
  });
  it.each([
    { contract_type: "" }, { contract_type: "Supplier Agreement" }, { contract_purpose: "   " },
    { description: "   " }, { contract_start_date: "2026-02-30" },
    { contract_end_date: "2026-09-01" }, { contract_end_date: "" },
  ])("rejects invalid award details at the API without any writes: %j", async patch => {
    const m = fixture(); await expect(m.create({ ...details, ...patch })).rejects.toMatchObject({ status: 422 });
    expect(m.deps.decide).not.toHaveBeenCalled(); expect(m.deps.create).not.toHaveBeenCalled();
  });
  it.each([undefined, null, "", "No"])("never creates a Request from saved requirement %s without Yes", async value => {
    const m = fixture(); m.put("Request for Quotation", { ...rfq, contract_required: value });
    expect(await m.summary()).toMatchObject({ contract_required: "No", decision: "Pending", can_decide: value === "No", can_request: false, can_create: false, eligible: true, status: value === "No" ? "Award Handoff Pending" : "Contract Requirement Missing", blocks_procurement: true });
    expect(m.deps.create).not.toHaveBeenCalled();
  });
  it("does not revive an old submission reservation without a real saved award", async () => {
    const m = fixture(); m.docs.delete("Legal Document Review/LDR-1");
    m.put("Request for Quotation", { ...rfq, custom_approval_data: JSON.stringify({ clm_initial_request: { version: 1, phase: "saving", pending_document: { custom_rfq: rfq.name } } }) });
    expect(await m.summary()).toMatchObject({ can_create: false, can_request: false, status: "Awaiting Supplier Award", request: undefined });
  });
  it("uses the real LDR selection even when optional RFQ selection fields were never saved", async () => {
    const m = fixture(); const summary = await m.summary();
    expect(summary).toMatchObject({ eligible: true, can_request: true, can_create: false, rfq: { name: "RFQ-1", modified: "r1" }, prefill: { supplier: "SUP-1", custom_supplier_quotation: "SQ-1", contract_value: 250, currency: "USD" } });
    expect(summary.prefill.estimated_contract_value).toBeUndefined();
    expect(summary.required_fields).toEqual(["department", "contract_type", "contract_start_date", "contract_end_date", "estimated_contract_value"]);
  });
  it("accepts quote-wrapped persisted supplier identities and zero negotiated amounts", async () => {
    const m = fixture(); m.put("Request for Quotation", { ...rfq, custom_selected_supplier: '"SUP-1"' });
    m.put("Legal Document Review", { ...m.get("Legal Document Review", "LDR-1"), grand_total: 0 });
    const result = await m.create(); expect(result.request.record.contract_value).toBe(0);
  });
  it.each([undefined, null, "", -1, "invalid", true])("never substitutes an original quotation or estimate for invalid final award value %j", async grand_total => {
    const m = fixture();
    m.put("Legal Document Review", { ...m.get("Legal Document Review", "LDR-1"), grand_total });
    m.put("Request for Quotation", { ...rfq, custom_selected_supplier_total: 50000 });
    await expect(m.create()).rejects.toMatchObject({ status: 409, message: expect.stringContaining("final award") });
    expect(await m.deps.list("Contract Request")).toEqual([]);
  });
  it("rejects conflicting persisted award and winning quotation currencies", async () => {
    const m = fixture(); m.put("Legal Document Review", { ...m.get("Legal Document Review", "LDR-1"), currency: "EUR" });
    await expect(m.create()).rejects.toMatchObject({ status: 409, message: expect.stringContaining("currency differs") });
    expect(await m.deps.list("Contract Request")).toEqual([]);
  });
  it.each(["Pending", "Rejected", "Approved"])("keeps the %s Business Case estimate separate from the final award", async approval_status => {
    const m = fixture();
    m.put("Business Case", { name: "BC-ESTIMATE", rfq_id: "RFQ-1", approval_status, estimated_budget: 50000, currency: "USD" });
    const summary = await m.summary();
    expect(summary.prefill.contract_value).toBe(250);
    expect(summary.source).toMatchObject({ amount: 250, currency: "USD" });
    expect(summary.prefill.estimated_contract_value).toBe(approval_status === "Approved" ? 50000 : undefined);
  });
  it("requires a saved award even when supplier selection identifies a single quotation", async () => {
    const m = fixture(); m.docs.delete("Legal Document Review/LDR-1"); m.put("Request for Quotation", { ...rfq, custom_approval_data: JSON.stringify({ rfq: "RFQ-1", selected_supplier: "SUP-1", workflow_step: "Supplier Selected", selected_supplier_total: 125 }) });
    expect(await m.summary()).toMatchObject({ can_request: false, can_decide: false, request: undefined, status: "Awaiting Supplier Award" });
    m.put("Supplier Quotation", { ...m.get("Supplier Quotation", "SQ-1"), name: "SQ-2" });
    expect(await m.summary()).toMatchObject({ can_create: false, reason: expect.stringMatching(/single winning/) });
  });
  it.each([
    ["Request for Quotation", "RFQ-1", { custom_selected_supplier: "SUP-OTHER" }],
    ["Supplier Quotation", "SQ-1", { supplier: "SUP-OTHER" }],
    ["Supplier Quotation", "SQ-1", { company: "Other" }],
    ["Supplier Quotation", "SQ-1", { items: [{ request_for_quotation: "OTHER-RFQ" }] }],
    ["Supplier Quotation", "SQ-1", { docstatus: 2 }],
    ["Request for Quotation", "RFQ-1", { status: "Cancelled" }],
    ["Legal Document Review", "LDR-1", { finance_status: "Rejected" }],
    ["Supplier", "SUP-1", { disabled: 1 }],
  ] as const)("rejects conflicting/unavailable source %s %s", async (dt, name, patch) => {
    const m = fixture(); m.put(dt, { ...m.get(dt, name), ...patch });
    expect((await m.summary()).can_create).toBe(false); await expect(m.create()).rejects.toMatchObject({ status: 409 }); expect(m.deps.create).not.toHaveBeenCalled();
  });
  it("saves source mapping and audit across the request and Team conversion transactions", async () => {
    const m = fixture(); const result = await m.create();
    expect(result.created).toBe(true); expect(result.request.record).toMatchObject({ ...details, custom_rfq: "RFQ-1", custom_supplier_quotation: "SQ-1", requester: "procurement_team@test.example", request_status: "Completed", approval_status: "Pending", request_date: "2026-09-17" });
    expect(result.contract?.record).toMatchObject({ custom_contract_status: "Pending Legal", ...contractReview, custom_contract_request: result.request.record.name, custom_rfq: "RFQ-1", custom_supplier_quotation: "SQ-1", custom_supplier: "SUP-1", custom_contract_type: details.contract_type });
    expect(result.summary).toMatchObject({ can_create: false, status: "Pending Legal Review", request: { name: result.request.record.name, status: "Completed" }, contract: { name: result.contract!.record.name, status: "Pending Legal" } });
    expect(result.request.audit[0].comment).toContain("RFQ-1"); expect(parseClmData(result.request.record.custom_clm_data).rfq_source).toMatchObject({ rfq: "RFQ-1", quotation: "SQ-1", legal_review: "LDR-1" });
    expect(vi.mocked(m.deps.save).mock.calls.every(([dt]) => dt === "Contract")).toBe(true); expect(vi.mocked(m.deps.create).mock.calls.map(([dt]) => dt)).toEqual(["Contract Request", "Contract"]);
    expect(m.deps.decide).toHaveBeenCalledTimes(2);
    expect(vi.mocked(m.deps.decide!).mock.calls.map(([input]) => input.create_contract)).toEqual([false, true]);
    expect(m.deps.decide).toHaveBeenCalledWith(expect.objectContaining({ contract_fields: contractReview }));
    expect(JSON.parse(String(m.get("Request for Quotation", "RFQ-1").custom_approval_data)).contract_decision).toMatchObject({ decision: "Yes", request: result.request.record.name, quotation: "SQ-1" });
  });
  it("maps a verified PO, project and source documents without copying files or assigning arbitrary URLs", async () => {
    const m = fixture(); m.put("Purchase Order", { name: "PO-1", supplier: "SUP-1", company: "Inteva", project: "PROJECT-1", items: [{ supplier_quotation: "SQ-1" }] }); m.put("Project", { name: "PROJECT-1" });
    m.put("Request for Quotation", { ...rfq, custom_2d_drawing: "/private/files/drawing.pdf" });
    m.put("File", { name: "FILE-1", file_name: "RFQ drawing.pdf", file_url: "/private/files/drawing.pdf", attached_to_doctype: "Request for Quotation", attached_to_name: "RFQ-1", is_folder: 0, is_private: 1 });
    const result = await m.create(); expect(result.request.record).toMatchObject({ custom_purchase_order: "PO-1", custom_project: "PROJECT-1" });
    expect(result.summary.source_documents[0]).toMatchObject({ file_id: "FILE-1", source_path: "/sourcing/rfq/RFQ-1" });
    expect(result.request.record.supporting_document).toBeUndefined();
  });
  it.each(["supplier", "custom_supplier_quotation", "contract_value", "currency", "custom_rfq", "custom_clm_data", "request_status", "supporting_document"])("rejects forged %s input", async field => {
    const m = fixture(); await expect(m.create({ ...details, [field]: "FORGED" })).rejects.toMatchObject({ status: 403 }); expect(m.deps.create).not.toHaveBeenCalled();
  });
  it("requires schema uniqueness, required form values, supported currency and current RFQ revision", async () => {
    const m = fixture(); await expect(m.create({}, "r1")).rejects.toThrow("department");
    await expect(m.create(details, "stale")).rejects.toMatchObject({ status: 409 });
    m.put("Supplier Quotation", { ...m.get("Supplier Quotation", "SQ-1"), currency: "JPY" }); await expect(m.create()).rejects.toThrow("supported currency");
    m.fields.find(f => f.fieldname === "custom_rfq")!.unique = 0; await expect(m.create()).rejects.toMatchObject({ status: 503 });
  });
  it("returns an existing Request unchanged on retry, even with stale metadata or different user-entered values", async () => {
    const m = fixture(); const first = await m.create(); const before = m.get("Contract Request", String(first.request.record.name));
    const second = await m.create({ department: "REPLACEMENT" }, "stale");
    expect(second.created).toBe(false); expect(second.request.record).toEqual(before); expect(second.contract?.record).toEqual(first.contract?.record); expect(m.deps.create).toHaveBeenCalledTimes(2);
  });
  it.each(["context", "request_contract", "decision_contract", "contract_request", "contract_rfq"])("rejects an idempotent result with a missing permanent %s link", async missing => {
    const m = fixture(); const first = await m.create();
    const request = m.get("Contract Request", String(first.request.record.name));
    const contract = m.get("Contract", String(first.contract!.record.name));
    const parent = m.get("Request for Quotation", "RFQ-1");
    if (missing === "context") { const data = parseClmData(contract.custom_clm_data); delete data.rfq_context; contract.custom_clm_data = JSON.stringify(data); }
    if (missing === "request_contract") { const data = parseClmData(request.custom_clm_data); delete data.contract; request.custom_clm_data = JSON.stringify(data); }
    if (missing === "decision_contract") { const data = JSON.parse(String(parent.custom_approval_data)); delete data.contract_decision.contract; parent.custom_approval_data = JSON.stringify(data); }
    if (missing === "contract_request") delete contract.custom_contract_request;
    if (missing === "contract_rfq") delete contract.custom_rfq;
    m.put("Contract Request", request); m.put("Contract", contract); m.put("Request for Quotation", parent);
    const before = structuredClone(m.docs); vi.mocked(m.deps.decide!).mockClear();
    await expect(m.create({}, "stale")).rejects.toThrow("permanent RFQ Award links are incomplete");
    expect(m.docs).toEqual(before); expect(m.deps.decide).not.toHaveBeenCalled();
  });
  it("converts a saved request-only Yes once into the real Contract without replacing its terms or decision", async () => {
    const m = await requestOnlyFixture(); const prior = await m.summary();
    const oldRequest = m.get("Contract Request", prior.request!.name);
    const oldDecision = JSON.parse(String(m.get("Request for Quotation", "RFQ-1").custom_approval_data)).contract_decision;
    expect(prior).toMatchObject({ decision: "Yes", can_decide: false, can_create: true, blocks_procurement: true, contract: undefined });
    expect(prior.prefill).toMatchObject({ ...details, contract_purpose: oldRequest.contract_purpose, description: oldRequest.description });
    expect(prior.locked_fields).toEqual(expect.arrayContaining(["contract_type", "contract_purpose", "description", "contract_start_date", "contract_end_date"]));
    expect(await m.summary(principal("procurement"))).toMatchObject({ can_create: true, can_decide: false });
    const result = await m.create({}, prior.rfq.modified);
    expect(result.created).toBe(true);
    expect(result.request.record).toMatchObject({ ...oldRequest, request_status: "Completed", custom_clm_data: expect.any(String) });
    expect(result.contract?.record).toMatchObject({ custom_contract_request: oldRequest.name, custom_rfq: "RFQ-1", custom_contract_status: "Pending Legal" });
    expect(m.deps.decide).toHaveBeenCalledWith(expect.objectContaining({ decision: "Yes", create_contract: true, contract_fields: contractReview }));
    expect(vi.mocked(m.deps.decide!).mock.calls[0][0].request_document).toBeUndefined();
    expect(m.deps.create).toHaveBeenCalledTimes(1); expect(m.deps.create).toHaveBeenCalledWith("Contract", expect.any(Object));
    expect(JSON.parse(String(m.get("Request for Quotation", "RFQ-1").custom_approval_data)).contract_decision).toMatchObject(oldDecision);
    expect((await m.create({}, "stale")).contract?.record.name).toBe(result.contract?.record.name);
    expect(m.deps.create).toHaveBeenCalledTimes(1);
  });
  it("does not return request-only success or overwrite its saved terms when recovery cannot commit", async () => {
    const m = await requestOnlyFixture(); const summary = await m.summary(); const before = structuredClone(m.docs);
    await expect(m.create({ contract_purpose: "Replacement terms" }, summary.rfq.modified)).rejects.toThrow("saved Contract Request details");
    expect(m.deps.decide).not.toHaveBeenCalled();
    m.deps.decide = vi.fn(async () => ({ created: false, request: m.get("Contract Request", summary.request!.name) }));
    await expect(m.create({}, summary.rfq.modified)).rejects.toThrow("did not persist the requested CLM handoff");
    expect(m.docs).toEqual(before); expect(m.deps.create).not.toHaveBeenCalled();
  });
  it("serializes concurrent recovery of the same request-only award without duplicate Contracts", async () => {
    const m = await requestOnlyFixture(); const summary = await m.summary();
    const [left, right] = await Promise.all([m.create({}, summary.rfq.modified), m.create({}, summary.rfq.modified)]);
    expect(left.contract?.record.name).toBe(right.contract?.record.name);
    expect([left.created, right.created].filter(Boolean)).toHaveLength(1);
    expect([...m.docs.keys()].filter(key => key.startsWith("Contract/"))).toHaveLength(1);
    expect([...m.docs.keys()].filter(key => key.startsWith("Contract Request/"))).toHaveLength(1);
    expect(m.deps.create).toHaveBeenCalledTimes(1);
  });
  it.each(["Rejected", "Under Legal Review", "Completed"])("does not convert an existing request in %s", async request_status => {
    const m = await requestOnlyFixture(); const summary = await m.summary();
    m.put("Contract Request", { ...m.get("Contract Request", summary.request!.name), request_status });
    expect(await m.summary()).toMatchObject({ can_create: false, continuation_ready: false });
    await expect(m.create({}, summary.rfq.modified)).rejects.toMatchObject({ status: 409 });
    expect(m.deps.decide).not.toHaveBeenCalled(); expect(m.deps.create).not.toHaveBeenCalled();
  });
  it("uses the database unique source to resolve concurrent requests across server instances", async () => {
    const m = fixture(); const [left, right] = await Promise.all([m.create(), m.create()]);
    expect(left.request.record.name).toBe(right.request.record.name); expect([left.created, right.created].filter(Boolean)).toHaveLength(1);
    expect([...m.docs.keys()].filter(key => key.startsWith("Contract Request/"))).toHaveLength(1);
  });
  it("recovers a response lost after commit without retrying the insert", async () => {
    const m = fixture(); const commit = m.deps.decide!; m.deps.decide = vi.fn(async input => { await commit(input); throw new Error("Lost response"); });
    const result = await m.create(); expect(result.created).toBe(false); expect(result.request.record.name).toBeTruthy(); expect(result.contract?.record.name).toBeTruthy(); expect(m.deps.create).toHaveBeenCalledTimes(2);
  });
  it("propagates insert failure when no committed request exists", async () => {
    const m = fixture(); m.deps.create = vi.fn(async () => { throw new Error("ERP unavailable"); }); await expect(m.create()).rejects.toThrow("ERP unavailable");
  });
  it("rolls back Contract conversion while preserving the previously submitted Team request and RFQ decision", async () => {
    const m = await requestOnlyFixture(); const create = m.deps.create; const before = structuredClone(m.docs);
    m.deps.create = vi.fn(async (dt, doc) => { if (dt === "Contract") throw new Error("Contract insert failed"); return create(dt, doc); });
    await expect(m.create({}, "r2")).rejects.toThrow("Contract insert failed");
    expect([...m.docs.keys()].filter(key => key.startsWith("Contract/"))).toEqual([]);
    expect(m.docs).toEqual(before);
    expect(await m.summary()).toMatchObject({ status: "Pending Procurement Team", can_create: true, blocks_procurement: true });
  });
  it.each((Object.keys(ROLE_LABELS) as AppRole[]).filter(role => !["procurement_team", "procurement"].includes(role)))("does not grant %s RFQ initiation rights", async role => {
    const m = fixture();
    expect(canInitiateRfqClm(principal(role))).toBe(false);
    await expect(m.create(details, "r1", principal(role))).rejects.toMatchObject({ status: 403 });
    await expect(decideRfqContractRequirement(principal(role), { rfq: "RFQ-1", expected_modified: "r1", decision: "No" }, m.deps)).rejects.toMatchObject({ status: 403 });
    expect(m.deps.load).not.toHaveBeenCalled(); expect(m.deps.decide).not.toHaveBeenCalled();
  });
  it("gives Team and Manager creation controls and keeps Administrator read-only at the award", async () => {
    const m = fixture(); expect(canInitiateRfqClm(team)).toBe(true);
    expect(await m.summary(team)).toMatchObject({ can_request: true, can_create: false, can_decide: true });
    expect(await m.summary(principal("procurement"))).toMatchObject({ can_request: true, can_decide: true });
    for (const role of ["admin"] as AppRole[]) {
      expect(await m.summary(principal(role))).toMatchObject({ can_create: false, can_decide: false, prefill: {}, source_documents: [] });
    }
  });
  it.each(["Yes", "No"] as const)("enforces Team ownership before returning an idempotent %s result", async decision => {
    const m = fixture(); m.put("Request for Quotation", { ...rfq, contract_required: decision });
    await decideRfqContractRequirement(team, { rfq: "RFQ-1", expected_modified: "r1", decision, payload: decision === "Yes" ? details : undefined }, m.deps);
    const writes = vi.mocked(m.deps.decide!).mock.calls.length;
    for (const role of (Object.keys(ROLE_LABELS) as AppRole[]).filter(role => !["procurement_team", "procurement"].includes(role))) {
      await expect(decideRfqContractRequirement(principal(role), { rfq: "RFQ-1", expected_modified: "r1", decision }, m.deps)).rejects.toMatchObject({ status: 403 });
    }
    expect((await decideRfqContractRequirement(team, { rfq: "RFQ-1", expected_modified: "r1", decision }, m.deps)).created).toBe(false);
    expect(m.deps.decide).toHaveBeenCalledTimes(writes);
  });
  it("rejects suppliers before reading ERP and limits internal observers to status and authorized links", async () => {
    const m = fixture(); await expect(m.summary({ typ: "supplier", supplier: "SUP-1", sub: "s", iat: 1, exp: 9999999999 })).rejects.toMatchObject({ status: 403 }); expect(m.deps.load).not.toHaveBeenCalled();
    await m.create(); const summary = await m.summary(principal("legal")); expect(summary).toMatchObject({ can_create: false, can_open_request: false, can_open_contract: true, prefill: {}, source_documents: [], status: "Pending Legal Review" });
  });
  it("derives status from existing CLM, including restricted Contract links", async () => {
    const m = fixture(); const result = await m.create();
    const data = parseClmData(result.contract!.record.custom_clm_data);
    data.rfq_context = { ...data.rfq_context as ClmRecord, contract_status: "Pending Signature" };
    data.rfq_workflow = { version: 1, phase: "signature" };
    m.put("Contract", { ...result.contract!.record, custom_contract_status: "Pending Signature", custom_clm_data: JSON.stringify(data) });
    expect(await m.summary()).toMatchObject({ status: "Pending Signatures", can_open_contract: true, contract: { name: result.contract!.record.name, status: "Pending Signature" } });
    expect((await m.summary(principal("legal"))).can_open_contract).toBe(true);
  });
  it("does not choose arbitrarily among pre-existing duplicate requests", async () => {
    const m = fixture(); m.put("Contract Request", { name: "CR-A", custom_rfq: "RFQ-1" }); m.put("Contract Request", { name: "CR-B", custom_rfq: "RFQ-1" }); await expect(m.summary()).rejects.toMatchObject({ status: 409 });
  });
  it("guards generic RFQ-linked request creation and detachment while preserving standalone CLM authoring", async () => {
    const m = fixture(); await expect(guardRfqContractRequestSave({ doctype: "Contract Request", action: "save", payload: { custom_rfq: "RFQ-1" } }, team, m.deps)).rejects.toMatchObject({ status: 403 });
    const created = await m.create();
    for (const payload of [{ custom_rfq: "" }, { supplier: "OTHER" }, { contract_value: 200 }]) await expect(guardRfqContractRequestSave({ doctype: "Contract Request", action: "save", name: created.request.record.name, payload }, team, m.deps)).rejects.toMatchObject({ status: 403 });
    await guardRfqContractRequestSave({ doctype: "Contract Request", action: "save", name: created.request.record.name, payload: { description: "Revised authoring" } }, team, m.deps);
    const standalone = { doctype: "Contract Request" as const, action: "save" as const, payload: { ...details, supplier: "SUP-1", company: "Inteva", contract_value: 250, estimated_contract_value: 250, currency: "USD", contract_purpose: "Standalone", description: "Standalone request" } };
    await guardRfqContractRequestSave(standalone, principal("procurement_team"), m.deps);
    expect((await applyClmAction(standalone, principal("procurement_team"), m.deps)).record.custom_rfq).toBeUndefined();
  });
  it("prevents generic Contract creation, source overrides during conversion, and stale award submission", async () => {
    const m = fixture(); const created = await m.create();
    for (const payload of [{ custom_rfq: "RFQ-1" }, { custom_contract_request: created.request.record.name }]) await expect(guardRfqContractRequestSave({ doctype: "Contract", action: "save", payload }, team, m.deps)).rejects.toMatchObject({ status: 403 });
    for (const role of ["admin", "legal", "finance"] as AppRole[]) await expect(guardRfqContractRequestSave({ doctype: "Contract Request", name: created.request.record.name, action: "create_contract" }, principal(role), m.deps)).rejects.toMatchObject({ status: 403, message: expect.stringContaining("Only Procurement Manager or Procurement Team") });
    for (const payload of [{ custom_rfq: "" }, { custom_supplier_quotation: "SQ-OTHER" }, { custom_contract_value: 999 }, { party_name: "SUP-OTHER" }, { custom_contract_request: "OTHER" }, { custom_legal_review_required: 0 }]) await expect(guardRfqContractRequestSave({ doctype: "Contract Request", name: created.request.record.name, action: "create_contract", payload }, team, m.deps)).rejects.toMatchObject({ status: 403 });
    m.put("Legal Document Review", { ...m.get("Legal Document Review", "LDR-1"), grand_total: 999 });
    await expect(guardRfqContractRequestSave({ doctype: "Contract Request", name: created.request.record.name, action: "submit" }, team, m.deps)).rejects.toMatchObject({ status: 409 });
  });
  it("limits RFQ summary reads to coordinators, the PO team and Legal", () => {
    for (const role of Object.keys(ROLE_LABELS) as AppRole[]) expect(canReadRfqClm(principal(role)), role).toBe(["admin", "procurement", "procurement_team", "legal"].includes(role));
  });
  it("keeps exact quoted Supplier DocNames and rejects ambiguous legacy display identities", async () => {
    const m = fixture(); m.put("Supplier", { name: '"SUP-1"', disabled: 0 });
    expect((await m.summary()).can_create).toBe(false);
    m.put("Supplier Quotation", { ...m.get("Supplier Quotation", "SQ-1"), supplier: '"SUP-1"' });
    const result = await m.create(); expect(result.request.record.supplier).toBe('"SUP-1"');
    expect(m.deps.load).toHaveBeenCalledWith("Supplier", '"SUP-1"');
  });
  it("filters superseded quotation rounds and never accepts an old LDR award for the active round", async () => {
    const m = fixture(); m.put("Request for Quotation", { ...rfq, custom_active_rfq_round: "ROUND-2", custom_selected_supplier: "SUP-1", custom_workflow_step: "Supplier Selected" });
    m.put("RFQ Round", { name: "ROUND-2", rfq: "RFQ-1", status: "Closed" });
    m.put("Supplier Quotation", { ...m.get("Supplier Quotation", "SQ-1"), custom_rfq_round: "ROUND-1" });
    expect((await m.summary()).can_create).toBe(false);
    m.docs.delete("Legal Document Review/LDR-1");
    m.put("Supplier Quotation", { ...m.get("Supplier Quotation", "SQ-1"), name: "SQ-2", custom_rfq_round: "ROUND-2" });
    expect((await m.summary()).can_request).toBe(false);
    m.put("Legal Document Review", { name: "LDR-2", rfq_name: "RFQ-1", sq_name: "SQ-2", supplier: "SUP-1", company: "Inteva", grand_total: 250, workflow_state: "Pending Review" });
    expect((await m.summary()).prefill.custom_supplier_quotation).toBe("SQ-2");
    m.put("RFQ Round", { name: "ROUND-2", rfq: "OTHER-RFQ", status: "Active" });
    expect((await m.summary()).can_create).toBe(false);
  });
  it.each(["supplier", "custom_clm_data"])("does not swallow failed persistence of %s as duplicate success", async field => {
    const m = fixture(); const insert = m.deps.create;
    m.deps.create = vi.fn(async (dt, doc) => { const corrupted = { ...doc }; delete corrupted[field]; return insert(dt, corrupted); });
    await expect(m.create()).rejects.toThrow("did not persist");
  });
  it("lets missing optional project/business-unit metadata be completed without overriding mapped source fields", async () => {
    const m = fixture(); m.put("Project", { name: "PROJECT-NEW" });
    const summary = await m.summary(); expect(summary.locked_fields).not.toContain("custom_project");
    expect((await m.create({ ...details, custom_project: "PROJECT-NEW", custom_business_unit: "Powertrain" })).request.record.custom_project).toBe("PROJECT-NEW");
  });
  it("keeps manually authored project and business unit editable on a legacy linked Request draft", async () => {
    const m = fixture(); m.put("Project", { name: "PROJECT-NEW" }); m.put("Project", { name: "PROJECT-REVISED" });
    const result = await m.create({ ...details, custom_project: "PROJECT-NEW", custom_business_unit: "Powertrain" });
    // A pre-integration request had no Contract yet and keeps its original flow.
    m.docs.delete(`Contract/${result.contract!.record.name}`);
    const legacyData = parseClmData(result.request.record.custom_clm_data); delete legacyData.contract; delete legacyData.rfq_request_workflow; legacyData.approvals = [];
    m.put("Contract Request", { ...result.request.record, request_status: "Draft", custom_clm_data: JSON.stringify(legacyData) });
    const legacyRfq = m.get("Request for Quotation", "RFQ-1"); const legacyApproval = JSON.parse(String(legacyRfq.custom_approval_data)); delete legacyApproval.contract_decision.contract;
    m.put("Request for Quotation", { ...legacyRfq, custom_approval_data: JSON.stringify(legacyApproval) });
    const source = parseClmData(result.request.record.custom_clm_data).rfq_source as ClmRecord;
    expect(source.locked_fields).not.toContain("custom_project"); expect(source.locked_fields).not.toContain("custom_business_unit");
    const edit = { doctype: "Contract Request" as const, name: result.request.record.name, expected_modified: result.request.record.modified, action: "save" as const, payload: { custom_project: "PROJECT-REVISED", custom_business_unit: "Interiors", department: "USER-SELECTED" } };
    await guardRfqContractRequestSave(edit, team, m.deps);
    const updated = await applyClmAction(edit, team, m.deps);
    expect(updated.record).toMatchObject({ custom_project: "PROJECT-REVISED", custom_business_unit: "Interiors", custom_rfq: "RFQ-1", supplier: "SUP-1", contract_value: 250 });
    expect(parseClmData(updated.record.custom_clm_data).rfq_source).toMatchObject({ company: "Inteva", department: "USER-SELECTED" });
  });
  it("freezes project and business unit mapped from the RFQ while retaining legacy source protection", async () => {
    const m = fixture(); m.put("Project", { name: "PROJECT-MAPPED" }); m.put("Request for Quotation", { ...rfq, project: "PROJECT-MAPPED", custom_business_unit: "Source Unit" });
    const result = await m.create();
    for (const payload of [{ custom_project: "PROJECT-OTHER" }, { custom_business_unit: "Other Unit" }]) await expect(guardRfqContractRequestSave({ doctype: "Contract Request", name: result.request.record.name, action: "save", payload }, team, m.deps)).rejects.toMatchObject({ status: 403 });
    m.put("Contract Request", { name: "LEGACY", custom_rfq: "RFQ-LEGACY", custom_project: "PROJECT-MAPPED", custom_business_unit: "Legacy Unit" });
    await expect(guardRfqContractRequestSave({ doctype: "Contract Request", name: "LEGACY", action: "save", payload: { custom_project: "" } }, team, m.deps)).rejects.toMatchObject({ status: 403 });
  });
});

describe("RFQ post-award conditional CLM branch", () => {
  it("keeps RFQ Finance after signatures even when a generic matrix requests Finance first", async () => {
    const m = fixture();
    m.put("Contract Approval Matrix", { name: "FINAL-POLICY", active: 1, contract_type: "All", risk_level: "Any", minimum_contract_value: 0, maximum_contract_value: 0, approval_sequence: "Sequential", final_approval_required: 1, final_approver: "finance@test.example", custom_approval_stages: JSON.stringify([{ role: "finance", user: "finance@test.example", stage: 0 }]) });
    m.put("User", { name: "finance@test.example", email: "finance@test.example", enabled: 1, roles: [{ role: "Finance Manager" }] });
    m.put("User", { name: "legal@test.example", enabled: 1, roles: [{ role: "Legal Manager" }] });
    const created = await m.create();
    const reviewed = created.contract!;
    expect(reviewed.approvals.map(row => [row.role, row.stage])).toEqual([["legal", 0]]);
    expect(reviewed.record.custom_contract_status).toBe("Pending Legal");
  });
  const no = (m: ReturnType<typeof fixture>) => decideRfqContractRequirement(team, { rfq: "RFQ-1", expected_modified: "r1", decision: "No" }, m.deps);
  it("records No once, creates no CLM and releases only the additional CLM hold", async () => {
    const m = fixture(); m.put("Request for Quotation", { ...rfq, contract_required: "No" });
    await expect(assertRfqClmReadyForProcurement("RFQ-1", m.deps)).rejects.toMatchObject({ status: 409 });
    const before = m.get("Legal Document Review", "LDR-1");
    expect((await no(m)).summary).toMatchObject({ decision: "No", contract_required: "No", can_decide: false, can_create: false, continuation_ready: true, blocks_procurement: false });
    await no(m); expect(m.deps.decide).toHaveBeenCalledTimes(1); expect(m.deps.create).not.toHaveBeenCalled();
    await assertRfqClmReadyForProcurement("RFQ-1", m.deps);
    expect(m.get("Legal Document Review", "LDR-1")).toEqual(before);
    await expect(m.create()).rejects.toMatchObject({ status: 409 });
  });
  it("preserves the saved Yes choice when Request insertion fails", async () => {
    const m = fixture();
    m.deps.create = vi.fn(async () => { throw new Error("Required ERP field rejected"); });
    await expect(m.create()).rejects.toThrow("Required ERP field");
    expect(m.get("Request for Quotation", "RFQ-1")).toMatchObject({ contract_required: "Yes", modified: "r1" });
    expect((await m.summary()).decision).toBe("Pending"); expect([...m.docs.keys()].filter(key => key.startsWith("Contract Request/"))).toEqual([]);
  });
  it("never uses separate document writes when the transaction endpoint is unavailable", async () => {
    const m = fixture(); delete m.deps.decide;
    await expect(m.create()).rejects.toMatchObject({ status: 503 }); m.put("Request for Quotation", { ...rfq, contract_required: "No" }); await expect(no(m)).rejects.toMatchObject({ status: 503 });
    expect(m.deps.save).not.toHaveBeenCalled(); expect(m.deps.create).not.toHaveBeenCalled();
  });
  it("serializes conflicting Yes/No decisions and prevents duplicate or detached requests", async () => {
    const m = fixture(); const results = await Promise.allSettled([m.create(), no(m)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const summary = await m.summary();
    expect(summary.decision).not.toBe("Pending");
    expect([...m.docs.keys()].filter(key => key.startsWith("Contract Request/"))).toHaveLength(summary.decision === "Yes" ? 1 : 0);
  });
  it.each([
    { configured: true, supplierSigns: true }, { configured: false, supplierSigns: true },
    { configured: true, supplierSigns: false }, { configured: false, supplierSigns: false },
  ])("preserves RFQ context through Legal signature and Finance with configured matrix=$configured, optional supplier signature=$supplierSigns", async ({ configured, supplierSigns }) => {
    const m = fixture(); m.put("Business Case", { name: "BC-1", rfq_id: "RFQ-1" });
    m.put("User", { name: "legal@test.example", enabled: 1, roles: [{ role: "Legal Manager" }] });
    if (configured) m.put("Contract Approval Matrix", { name: "POLICY", active: 1, contract_type: "All", risk_level: "Any", minimum_contract_value: 0, maximum_contract_value: 0, approval_sequence: "Sequential", custom_approval_stages: JSON.stringify([{ role: "legal", stage: 0 }]) });
    m.deps.lock = vi.fn(async () => ({ file_id: "LOCKED", file_url: "/private/files/locked.pdf", hash: "a".repeat(64) }));
    m.deps.sign = vi.fn(async (doc, actor, payload) => ({ party: actor.typ === "supplier" ? "supplier" : "inteva", by: actor.typ === "supplier" ? actor.sub : actor.email, at: m.deps.now(), version: String(doc.custom_current_version), hash: "b".repeat(64), file_id: `SIGNED-${actor.typ}`, file_url: `/private/files/${actor.typ}.pdf`, typed_name: String((payload.signature as ClmRecord | undefined)?.value || payload.typed_name), ...(payload.signature ? { full_legal_name: String(payload.full_legal_name), signature_method: "typed" as const, signature_adopted: true as const } : {}) }));
    const created = await m.create(); const requestName = String(created.request.record.name);
    expect(parseClmData(created.request.record.custom_clm_data).rfq_source).toMatchObject({ rfq: "RFQ-1", business_case: "BC-1", award: "LDR-1", supplier: "SUP-1", quotation: "SQ-1", contract_required: true });
    expect(created.request.record.request_status).toBe("Completed");
    expect(created.request.record.approval_status).toBe("Pending");
    expect(created.contract!.record.custom_contract_request).toBe(requestName);
    const contract = created.contract!;
    const contractName = String(contract.record.name);
    const act = (action: "submit_review" | "approve" | "begin_signature" | "sign", who: AccessPrincipal = team, payload: ClmRecord = {}) => applyClmAction({ doctype: "Contract", name: contractName, action, expected_modified: m.get("Contract", contractName).modified, payload }, who, m.deps);
    expect(parseClmData(contract.record.custom_clm_data).rfq_source).toMatchObject({ business_case: "BC-1", award: "LDR-1", company: "Inteva", department: "BUY", amount: 250, currency: "USD" });
    for (const payload of [{ custom_rfq: "" }, { custom_supplier: "OTHER" }, { custom_contract_request: "" }, { custom_legal_review_required: 0 }]) await expect(guardRfqContractRequestSave({ doctype: "Contract", name: contractName, action: "save", payload }, team, m.deps)).rejects.toMatchObject({ status: 403 });
    await expect(assertRfqClmReadyForProcurement("RFQ-1", m.deps)).rejects.toThrow("Finance");
    await expect(act("submit_review")).rejects.toMatchObject({ status: 403 });
    await act("approve", principal("legal")); await act("begin_signature", principal("legal"));
    if (supplierSigns) await act("sign", { typ: "supplier", supplier: "SUP-1", sub: "supplier-1", iat: 1, exp: 9999999999 }, { consent: true, typed_name: "Fixture Supplier" });
    await expect(assertRfqClmReadyForProcurement("RFQ-1", m.deps)).rejects.toMatchObject({ status: 409 });
    await act("sign", principal("legal"), { consent: true, full_legal_name: "Fixture Legal Reviewer", signature: { method: "typed", value: "Fixture Signer", adopted: true } });
    expect(m.get("Contract", contractName).custom_contract_status).toBe("Pending Finance");
    expect(parseClmData(m.get("Contract", contractName).custom_clm_data).signatures.map(row => row.party)).toEqual(supplierSigns ? ["supplier", "inteva"] : ["inteva"]);
    await expect(assertRfqClmReadyForProcurement("RFQ-1", m.deps)).rejects.toMatchObject({ status: 409 });
    await act("approve", principal("finance"));
    expect(parseClmData(m.get("Contract", contractName).custom_clm_data).rfq_context).toEqual({ rfq_id: "RFQ-1", award_id: "LDR-1", supplier_id: "SUP-1", quotation_id: "SQ-1", contract_type: details.contract_type, contract_status: "Executed", contract_required: "Yes" });
    expect((await m.summary())).toMatchObject({ decision: "Yes", continuation_ready: true, blocks_procurement: false, contract: { name: contractName, status: "Executed" } });
    await assertRfqClmReadyForProcurement("RFQ-1", m.deps);
    const saved = m.get("Contract", contractName); expect(parseClmData(saved.custom_clm_data).locked_hash).toBe(clmSnapshotHash("Contract", saved));
    for (const missing of ["legal_signature", "legal_approval", "finance_approval"] as const) {
      const invalid = parseClmData(saved.custom_clm_data);
      if (missing === "legal_signature") invalid.signatures = invalid.signatures.filter(row => row.party !== "inteva");
      else invalid.approvals = invalid.approvals.filter(row => row.role !== (missing === "legal_approval" ? "legal" : "finance"));
      m.put("Contract", { ...saved, custom_clm_data: JSON.stringify(invalid) });
      expect(await m.summary()).toMatchObject({ continuation_ready: false, blocks_procurement: true });
      await expect(assertRfqClmReadyForProcurement("RFQ-1", m.deps)).rejects.toMatchObject({ status: 409 });
    }
    m.put("Contract", { ...saved, contract_terms: "Tampered after signature" });
    await expect(assertRfqClmReadyForProcurement("RFQ-1", m.deps)).rejects.toMatchObject({ status: 409 });
  });
  it("routes the persisted Team request, then keeps one Contract through Legal, signatures, Finance and procurement completion", async () => {
    const m = fixture(); let tick = 0;
    m.deps.now = () => `2026-09-17 12:00:${String(tick++).padStart(2, "0")}`;
    m.deps.lock = vi.fn(async () => ({ file_id: "LOCKED", file_url: "/private/files/locked.pdf", hash: "a".repeat(64) }));
    m.deps.sign = vi.fn(async (doc, actor, payload) => ({ party: actor.typ === "supplier" ? "supplier" : "inteva", by: actor.typ === "supplier" ? actor.sub : actor.email, at: m.deps.now(), version: String(doc.custom_current_version), hash: "b".repeat(64), file_id: `SIGNED-${actor.typ}`, file_url: `/private/files/${actor.typ}.pdf`, typed_name: String((payload.signature as ClmRecord | undefined)?.value || payload.typed_name), ...(payload.signature ? { full_legal_name: String(payload.full_legal_name), signature_method: "typed" as const, signature_adopted: true as const } : {}) }));
    const requested = await m.request();
    const storedRequest = m.get("Contract Request", String(requested.request.record.name));
    const requestRows = await m.deps.list("Contract Request");
    const teamQueue = requestRows.filter(row => canReadClm(team, "Contract Request", row) && rfqClmRequestWorkflowView(row));
    const managerQueue = requestRows.filter(row => canReadClm(principal("procurement"), "Contract Request", row) && rfqClmRequestWorkflowView(row));
    expect(teamQueue.map(row => row.name)).toEqual([storedRequest.name]); expect(managerQueue.map(row => row.name)).toEqual([storedRequest.name]);
    expect(rfqClmRequestWorkflowView(storedRequest)).toMatchObject({ status: "Pending Procurement Team", owner: "Procurement Team", rfq: "RFQ-1", award: "LDR-1" });
    expect(toClmAggregate(team, "Contract Request", storedRequest).actions.map(row => row.action)).toEqual(["create_contract"]);
    expect(canReadClm(principal("legal"), "Contract Request", storedRequest)).toBe(false);
    expect(await m.deps.list("Contract")).toEqual([]);
    const created = await createRfqContractRequest(team, { rfq: "RFQ-1", expected_modified: requested.summary.rfq.modified, payload: {}, contract_fields: contractReview }, m.deps);
    const contractName = String(created.contract!.record.name);
    expect(created.request.record.name).toBe(storedRequest.name);
    expect(parseClmData(created.request.record.custom_clm_data)).toMatchObject({ contract: contractName, rfq_request_workflow: { phase: "contract_created" }, approvals: [{ role: "procurement_team", status: "Approved", by: "procurement_team@test.example" }] });
    expect(rfqClmRequestWorkflowView(created.request.record)).toBeUndefined();
    const act = (action: ClmActionName, who: AccessPrincipal, payload: ClmRecord = {}) => applyClmAction({ doctype: "Contract", name: contractName, action, expected_modified: m.get("Contract", contractName).modified, payload, comment: "Verified RFQ lifecycle action" }, who, m.deps);
    expect(created.contract!.record.custom_contract_status).toBe("Pending Legal");
    expect(created.summary).toMatchObject({ status: "Pending Legal Review", continuation_ready: false, contract: { name: contractName } });
    const listed = await m.deps.list("Contract", [["custom_rfq", "=", "RFQ-1"]]);
    expect(listed.map(row => toClmAggregate(team, "Contract", row).record.name)).toEqual([contractName]);
    expect(toClmAggregate(principal("finance"), "Contract", listed[0]).actions).toEqual([]);
    await expect(act("approve", principal("finance"))).rejects.toMatchObject({ status: 403 });
    await expect(act("finalize_procurement", team, { purchase_order: "PO-1" })).rejects.toMatchObject({ status: 403 });
    await act("approve", principal("legal")); await act("begin_signature", principal("legal"));
    await act("sign", { typ: "supplier", supplier: "SUP-1", sub: "supplier-1", iat: 1, exp: 9999999999 }, { consent: true, typed_name: "Supplier Signer" });
    await act("sign", principal("legal"), { consent: true, full_legal_name: "Legal Reviewer", signature: { method: "typed", value: "Legal Signer", adopted: true } });
    expect(await m.summary()).toMatchObject({ status: "Pending Finance Approval", continuation_ready: false, contract: { name: contractName } });
    await expect(assertRfqClmReadyForProcurement("RFQ-1", m.deps)).rejects.toMatchObject({ status: 409 });
    await expect(act("finalize_procurement", team, { purchase_order: "PO-1" })).rejects.toMatchObject({ status: 403 });
    await act("approve", principal("finance"));
    expect(await m.summary()).toMatchObject({ status: "Finance Approved", continuation_ready: true, contract: { name: contractName } });
    await assertRfqClmReadyForProcurement("RFQ-1", m.deps);
    const existingOrder = { name: "PO-1", docstatus: 1, status: "To Receive and Bill", supplier: "SUP-1", company: "Inteva", currency: "USD",grand_total:250,custom_clm_contract:contractName,custom_clm_rfq:"RFQ-1",custom_clm_award:"LDR-1",custom_clm_creation_key:createHash("sha256").update([contractName,"LDR-1","SQ-1"].join("|")).digest("hex"), items: [{ supplier_quotation: "SQ-1", qty: 20 }] };
    m.put("Purchase Order", existingOrder);
    const savedContract=m.get("Contract",contractName),createdPoData=parseClmData(savedContract.custom_clm_data);
    createdPoData.procurement_order={id:"OP-1",state:"submitted",by:team.sub,role:"procurement_team",contract:contractName,rfq:"RFQ-1",award:"LDR-1",quotation:"SQ-1",supplier:"SUP-1",purchase_order:"PO-1"};
    m.put("Contract",{...savedContract,custom_clm_data:JSON.stringify(createdPoData)});
    const finalized = await act("finalize_procurement", team, { purchase_order: "PO-1" });
    const data = parseClmData(finalized.record.custom_clm_data);
    expect(finalized.record.custom_contract_status).toBe("Executed");
    expect(data.rfq_workflow).toEqual({ version: 1, phase: "completed" });
    expect(data.procurement_completion).toMatchObject({ purchase_order: "PO-1", by: "procurement_team@test.example", role: "procurement_team", rfq: "RFQ-1", award: "LDR-1", supplier: "SUP-1", quotation: "SQ-1" });
    expect(data.audit.slice(-2).map(row => row.action)).toEqual(["procurement_finalized", "completed"]);
    expect(data.audit.slice(-2).every(row => row.role === "procurement_team" && row.reference_id === contractName)).toBe(true);
    expect(await m.summary()).toMatchObject({ status: "Completed", continuation_ready: true, blocks_procurement: false, contract: { name: contractName, status: "Executed" } });
    await assertRfqClmReadyForProcurement("RFQ-1", m.deps);
    expect((await m.create({}, "stale")).contract?.record.name).toBe(contractName);
    expect((await m.deps.list("Contract")).map(row => row.name)).toEqual([contractName]);
    expect(m.get("Purchase Order", "PO-1")).toEqual(existingOrder);
    expect(vi.mocked(m.deps.create).mock.calls.map(([dt]) => dt)).toEqual(["Contract Request", "Contract"]);
    expect(vi.mocked(m.deps.save).mock.calls.every(([dt]) => dt === "Contract")).toBe(true);
  });
  it("keeps an ECR-linked Business Case identity without creating duplicate fields", async () => {
    const m = fixture(); m.put("Request for Quotation", { ...rfq, custom_ecr_reference: "ECR-1" });
    m.put("Business Case", { name: "BC-ECR-1", approval_status: "Approved", currency: "USD", estimated_budget: 500 });
    m.put("Engineering Change Request", { name: "ECR-1", ecr_business_case: JSON.stringify({ ecr_reference: "ECR-1", business_case_id: "BC-ECR-1" }) });
    const result = await m.create({ ...details, estimated_contract_value: 500 }); expect(result.request.record).toMatchObject({ contract_value: 250, estimated_contract_value: 500 }); expect(parseClmData(result.request.record.custom_clm_data).rfq_source).toMatchObject({ ecr: "ECR-1", business_case: "BC-ECR-1" });
  });
  it("rejects changed award amount after a decision and verifies historical PO exceptions", async () => {
    const m = fixture(); await m.create();
    m.put("Legal Document Review", { ...m.get("Legal Document Review", "LDR-1"), grand_total: 300 });
    await expect(assertRfqClmReadyForProcurement("RFQ-1", m.deps)).rejects.toMatchObject({ status: 409 });
    const old = fixture(); old.put("Request for Quotation", { ...rfq, contract_required: "No" });
    old.put("Purchase Order", { name: "PO-OLD", supplier: "SUP-1", company: "Inteva", docstatus: 1, items: [{ supplier_quotation: "SQ-1" }] });
    await assertRfqClmReadyForProcurement("RFQ-1", old.deps, { allowHistoricalOrder: true });
    await expect(assertRfqClmReadyForProcurement("RFQ-1", old.deps)).rejects.toThrow("Record the RFQ contract decision");
    old.put("Contract Request", { name: "CR-CONFLICT", custom_rfq: "RFQ-1" });
    await expect(assertRfqClmReadyForProcurement("RFQ-1", old.deps, { allowHistoricalOrder: true })).rejects.toThrow("conflicts");
  });
});

describe("Automatic Legal Manager Signatory Resolution", () => {
  it("resolves the unique enabled Legal Manager from active user directory", async () => {
    const m = fixture();
    const resolution = await resolveDesignatedLegalSignatory(m.deps);
    expect(resolution).toMatchObject({
      source: "unique_role",
      signatory: {
        name: "legal@test.example",
        email: "legal@test.example",
      },
    });
    expect(resolution.eligible_signatories).toHaveLength(1);
  });

  it("prioritizes the designated Legal Manager from active Contract Approval Matrix rules", async () => {
    const m = fixture();
    m.put("User", { name: "legal2@test.example", email: "legal2@test.example", full_name: "Sarah Jenkins", enabled: 1, roles: [{ role: "Legal Manager" }] });
    m.put("Contract Approval Matrix", {
      name: "RULE-1",
      active: 1,
      custom_approval_stages: JSON.stringify([
        { role: "legal", user: "legal2@test.example", stage: 0 },
      ]),
    });
    const resolution = await resolveDesignatedLegalSignatory(m.deps);
    expect(resolution).toMatchObject({
      source: "workflow_matrix",
      signatory: {
        name: "legal2@test.example",
        email: "legal2@test.example",
        full_name: "Sarah Jenkins",
      },
    });
  });

  it("returns unresolved validation status when multiple Legal Managers exist without a matrix rule", async () => {
    const m = fixture();
    m.put("User", { name: "legal2@test.example", email: "legal2@test.example", full_name: "Sarah Jenkins", enabled: 1, roles: [{ role: "Legal Manager" }] });
    const resolution = await resolveDesignatedLegalSignatory(m.deps);
    expect(resolution.source).toBe("unresolved");
    expect(resolution.signatory).toBeUndefined();
    expect(resolution.error).toContain("Multiple eligible Legal Managers");
    expect(resolution.eligible_signatories).toHaveLength(2);
  });

  it("returns none when no enabled Legal Manager is found", async () => {
    const m = fixture();
    m.put("User", { name: "legal@test.example", email: "legal@test.example", enabled: 0, roles: [{ role: "Legal Manager" }] });
    const resolution = await resolveDesignatedLegalSignatory(m.deps);
    expect(resolution.source).toBe("none");
    expect(resolution.signatory).toBeUndefined();
    expect(resolution.error).toContain("No active Legal Manager is configured");
  });
});

