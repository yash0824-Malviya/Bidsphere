import { afterEach, describe, expect, it, vi } from "vitest";
import { canReadClm, ClmError, parseClmData, type ClmDeps } from "./clmCore";
import { ensureInitialRfqContractRequest, isInitialRfqRequest } from "./rfqInitialClmRequest";
import { rfqClmRequestWorkflowView } from "../src/utils/rfqClmWorkflow";
import type { AccessPrincipal } from "./rbacAuth";
import type { ClmField, ClmRecord } from "../src/types/clm";

const RFQ = "PUR-RFQ-2026-00095", RFQ_TYPE = "Request for Quotation", REQUEST = "Contract Request";
const manager = { typ: "internal", sub: "manager@example.test", email: "manager@example.test", role: "procurement" } as AccessPrincipal;
const team = { ...manager, sub: "team@example.test", email: "team@example.test", role: "procurement_team" } as AccessPrincipal;
function fixture() {
  const docs = new Map<string, ClmRecord>(); let revision = 1;
  const put = (dt: string, record: ClmRecord) => { const value = { docstatus: 0, ...record }; docs.set(`${dt}/${value.name}`, structuredClone(value)); return structuredClone(value); };
  const get = (dt: string, name: string) => structuredClone(docs.get(`${dt}/${name}`));
  put(RFQ_TYPE, { name: RFQ, modified: "r1", docstatus: 1, status: "Submitted", workflow_state: "Supplier Selection", contract_required: "Yes", company: "Netlink", department: "Procurement", description: "Production steel supply", custom_approval_data: JSON.stringify({ clm_award_intent: { version: 1, phase: "saving", decision: "Yes", award: "AWARD-95", quotation: "SQ-95", supplier: "SUP-1", by: manager.sub, at: "2026-09-25 10:00:00" } }) });
  put("Department", { name: "Procurement", department_name: "Procurement", company: "Netlink" });
  put("Supplier", { name: "SUP-1", disabled: 0 });
  put("Supplier Quotation", { name: "SQ-95", docstatus: 1, supplier: "SUP-1", company: "Netlink", currency: "USD", grand_total: 50000, items: [{ request_for_quotation: RFQ }] });
  put("Legal Document Review", { name: "AWARD-95", rfq_name: RFQ, sq_name: "SQ-95", supplier: "SUP-1", company: "Netlink", grand_total: 48500, workflow_state: "Pending Review" });
  const schema: ClmField[] = [
    { fieldname: "custom_rfq", fieldtype: "Link", unique: 1 },
    ...["requester", "request_date", "company", "contract_purpose", "description"].map(fieldname => ({ fieldname, fieldtype: "Data", reqd: 1 })),
    ...["supplier", "contract_type", "contract_start_date", "contract_end_date"].map(fieldname => ({ fieldname, fieldtype: "Data", reqd: 0 })),
  ];
  const deps: ClmDeps & { fields(doctype: string): Promise<ClmField[]> } = {
    load: vi.fn(async (dt, name) => { const record = get(dt, name); if (!record) throw new ClmError("Not found", 404); return record; }),
    list: vi.fn(async (dt, filters = []) => [...docs.entries()].filter(([key, record]) => key.startsWith(`${dt}/`) && filters.every(filter => { const [field, , value] = filter as [string, string, unknown]; return record[field] === value; })).map(([, record]) => structuredClone(record))),
    create: vi.fn(async (dt, record) => {
      if (dt !== REQUEST) throw new Error(`Unexpected creation of ${dt}`);
      if ([...docs.entries()].some(([key, value]) => key.startsWith(`${REQUEST}/`) && value.custom_rfq === record.custom_rfq)) throw new ClmError("Duplicate RFQ request", 409);
      return put(dt, { ...record, name: `REQ-${++revision}`, modified: String(revision) });
    }),
    save: vi.fn(async (dt, record) => {
      if (get(dt, String(record.name))?.modified !== record.modified) throw new ClmError("The document changed", 409);
      const prior = get(dt, String(record.name));
      // Actual deployed Request workflow has no transition into Cancelled.
      if (dt === REQUEST && prior?.request_status !== record.request_status && ![
        "Draft->Pending Review", "Pending Review->Draft", "Pending Review->Approved", "Pending Review->Rejected", "Approved->Completed",
      ].includes(`${prior?.request_status}->${record.request_status}`)) throw new ClmError("Workflow State transition not allowed", 417);
      return put(dt, { ...record, modified: String(++revision) });
    }),
    fields: vi.fn(async () => schema), now: () => "2026-09-24 12:00:00", notify: vi.fn(),
  };
  const call = (who = manager) => ensureInitialRfqContractRequest(who, RFQ, deps, { allowCreate: true, trigger: "award_confirmation" });
  const state = () => JSON.parse(String(get(RFQ_TYPE, RFQ)?.custom_approval_data || "{}"));
  return { deps, docs, get, put, schema, call, state };
}

describe("RFQ-awarded Contract Request persisted through existing ERP documents", () => {
  it.each(["Yes", "No"])("does not create on a Draft RFQ with Contract Required = %s even with a submit-event hint", async contract_required => {
    const m = fixture(); m.put(RFQ_TYPE, { ...m.get(RFQ_TYPE, RFQ), docstatus: 0, status: "Draft", contract_required });
    expect(await m.call()).toEqual({ created: false });
    expect(m.deps.create).not.toHaveBeenCalled(); expect(m.deps.save).not.toHaveBeenCalled();
    expect(await m.deps.list(REQUEST)).toEqual([]);
  });
  it.each([undefined, "Open", "Submitted"])("requires persisted docstatus1 rather than the %s display status", async status => {
    const m = fixture(); m.put(RFQ_TYPE, { ...m.get(RFQ_TYPE, RFQ), docstatus: 0, status });
    expect(await m.call()).toEqual({ created: false });
    expect(m.deps.create).not.toHaveBeenCalled(); expect(m.deps.save).not.toHaveBeenCalled();
  });
  it("never inserts from an ordinary save or a direct call lacking submission capability", async () => {
    const m = fixture();
    expect(await ensureInitialRfqContractRequest(manager, RFQ, m.deps)).toEqual({ created: false });
    expect(await ensureInitialRfqContractRequest(manager, RFQ, m.deps, { allowCreate: false })).toEqual({ created: false });
    expect(await ensureInitialRfqContractRequest(manager, RFQ, m.deps, { allowCreate: true })).toEqual({ created: false });
    expect(m.deps.create).not.toHaveBeenCalled(); expect(m.deps.save).not.toHaveBeenCalled();
  });
  it.each(["Yes", "No"].flatMap(choice => ["Submitted", "Open", "Supplier Invitation", "Supplier Response", "AI Evaluation", "Supplier Selection"].map(status => [choice, status])))("keeps stored %s as metadata only at %s without an actual saved award", async (contract_required, status) => {
    const m = fixture(); m.docs.delete("Legal Document Review/AWARD-95");
    m.put(RFQ_TYPE, { ...m.get(RFQ_TYPE, RFQ), status, custom_workflow_step: status, contract_required, custom_approval_data: JSON.stringify({ workflow_step: status }) });
    const before = m.get(RFQ_TYPE, RFQ);
    expect(await m.call()).toEqual({ created: false });
    expect(m.deps.create).not.toHaveBeenCalled(); expect(m.deps.save).not.toHaveBeenCalled();
    expect(await m.deps.list(REQUEST)).toEqual([]);
    expect(m.get(RFQ_TYPE, RFQ)).toEqual(before);
  });
  it.each([undefined, { version: 1, phase: "saving", decision: "No" }, { version: 1, phase: "saving", decision: "Yes", award: "OTHER", quotation: "SQ-95", supplier: "SUP-1", by: manager.sub, at: "2026-09-25" }])("rejects absent/mismatched persisted award intent despite explicit creation capability %#", intent => {
    const m = fixture(); m.put(RFQ_TYPE, { ...m.get(RFQ_TYPE, RFQ), custom_approval_data: JSON.stringify({ clm_award_intent: intent }) });
    return expect(m.call()).rejects.toThrow("Confirm the saved supplier award");
  });
  it("does not resume a reserved insert from an ordinary save", async () => {
    const m = fixture(), create = m.deps.create;
    m.deps.create = vi.fn(async () => { throw new ClmError("Temporary insert failure", 503); });
    await expect(m.call()).rejects.toThrow("Temporary insert failure");
    expect(m.state().clm_initial_request.phase).toBe("saving");
    m.deps.create = create;
    expect(await ensureInitialRfqContractRequest(manager, RFQ, m.deps, { allowCreate: false })).toEqual({ created: false });
    expect(m.deps.create).not.toHaveBeenCalled();
    expect(await m.call()).toMatchObject({ created: true });
  });
  it("invalidates a premature Request without erasing terms/history, then reuses it only after explicit award confirmation", async () => {
    const m = fixture(), result = await m.call(), initial = result.request!;
    const data = parseClmData(initial.custom_clm_data);
    data.rfq_request_draft = { version: 1, values: { description: "Saved Procurement terms" } };
    m.put(REQUEST, { ...initial, description: "Saved Procurement terms", custom_clm_data: JSON.stringify(data) });
    m.put(RFQ_TYPE, { ...m.get(RFQ_TYPE, RFQ), docstatus: 0, status: "Draft" });
    expect(await ensureInitialRfqContractRequest(team, RFQ, m.deps)).toEqual({ created: false });
    const held = m.get(REQUEST, String(initial.name))!, heldData = parseClmData(held.custom_clm_data);
    expect(held).toMatchObject({ name: initial.name, request_status: "Draft", description: "Saved Procurement terms", custom_rfq: RFQ });
    expect(heldData.rfq_request_workflow).toMatchObject({ phase: "awaiting_supplier_award", assigned_role: "procurement_team", status: "Invalidated", current_stage: "Awaiting Supplier Award" });
    expect(heldData.rfq_request_draft).toEqual(data.rfq_request_draft);
    expect(heldData.rfq_source).toEqual(data.rfq_source);
    expect(heldData.approvals).toEqual(data.approvals);
    expect(heldData.audit.slice(0, data.audit.length)).toEqual(data.audit);
    expect(heldData.audit.at(-1)?.action).toBe("invalidate_preaward_request");
    expect(rfqClmRequestWorkflowView(held)).toBeUndefined();
    expect(m.state().clm_initial_request).toMatchObject({ phase: "awaiting_award", request: initial.name });
    await ensureInitialRfqContractRequest(team, RFQ, m.deps);
    expect(m.get(REQUEST, String(initial.name))?.modified).toBe(held.modified);
    m.put(RFQ_TYPE, { ...m.get(RFQ_TYPE, RFQ), docstatus: 1, status: "Open" });
    expect(await ensureInitialRfqContractRequest(team, RFQ, m.deps)).toEqual({ created: false });
    expect(m.get(REQUEST, String(initial.name))?.request_status).toBe("Draft");
    expect(await m.call(team)).toMatchObject({ created: false, request: { name: initial.name, request_status: "Pending Review", description: "Saved Procurement terms" } });
    const released = m.get(REQUEST, String(initial.name))!;
    expect(rfqClmRequestWorkflowView(released)).toMatchObject({ assignedRole: "procurement_team", status: "Pending", stage: "Procurement" });
    expect(parseClmData(released.custom_clm_data).rfq_request_draft).toMatchObject(data.rfq_request_draft!);
    expect(parseClmData(released.custom_clm_data).audit.at(-1)?.action).toBe("procurement_team_assigned");
    await m.call(team);
    expect(await m.deps.list(REQUEST)).toHaveLength(1); expect(m.deps.create).toHaveBeenCalledOnce();
    expect(await m.deps.list("Contract")).toEqual([]);
    expect(m.state().clm_initial_request.phase).toBe("complete");
  });
  it("keeps an old draft-origin Request inactive when that RFQ is later submitted with No", async () => {
    const m = fixture(), initial = (await m.call()).request!;
    m.put(RFQ_TYPE, { ...m.get(RFQ_TYPE, RFQ), docstatus: 0, status: "Draft", contract_required: "No" });
    expect(await m.call()).toEqual({ created: false });
    m.put(RFQ_TYPE, { ...m.get(RFQ_TYPE, RFQ), docstatus: 1, status: "Open" });
    expect(await m.call()).toEqual({ created: false });
    expect(m.get(REQUEST, String(initial.name))?.request_status).toBe("Draft");
    expect(rfqClmRequestWorkflowView(m.get(REQUEST, String(initial.name))!)).toBeUndefined();
    expect(m.deps.create).toHaveBeenCalledOnce();
    expect(await m.deps.list("Contract")).toEqual([]);
  });
  it("invalidates a historical rfq_created Request even when its unawarded RFQ is already submitted", async () => {
    const m = fixture(), initial = (await m.call()).request!, data = parseClmData(initial.custom_clm_data);
    data.rfq_source = { stage: "rfq_created", rfq: RFQ, company: "Netlink", contract_required: true };
    const historical = { ...initial, supplier: "", custom_supplier_quotation: "", custom_clm_data: JSON.stringify(data) };
    m.put(REQUEST, historical); m.docs.delete("Legal Document Review/AWARD-95");
    expect(await m.call()).toEqual({ created: false });
    const invalid = m.get(REQUEST, String(initial.name))!;
    expect(invalid.request_status).toBe("Draft");
    expect(parseClmData(invalid.custom_clm_data).audit.slice(0, data.audit.length)).toEqual(data.audit);
    expect(rfqClmRequestWorkflowView(invalid)).toBeUndefined();
    const revision = invalid.modified;
    expect(await m.call()).toEqual({ created: false });
    expect(m.get(REQUEST, String(initial.name))?.modified).toBe(revision);
    expect(m.deps.create).toHaveBeenCalledOnce(); expect(await m.deps.list("Contract")).toEqual([]);
  });
  it("rechecks authoritative submission immediately before inserting the Request", async () => {
    const m = fixture(), save = m.deps.save;
    m.deps.save = vi.fn(async (dt, record) => {
      const result = await save(dt, record);
      if (dt === RFQ_TYPE && m.state().clm_initial_request?.phase === "saving") m.put(RFQ_TYPE, { ...result, docstatus: 0, status: "Draft" });
      return result;
    });
    await expect(m.call()).rejects.toThrow("real saved supplier award");
    expect(m.deps.create).not.toHaveBeenCalled();
  });
  it("does not create or route a Request when the saved RFQ says No", async () => {
    const m = fixture(), saved = m.get(RFQ_TYPE, RFQ)!;
    m.put(RFQ_TYPE, { ...saved, contract_required: "No" });
    expect(await m.call()).toEqual({ created: false });
    expect(m.deps.create).not.toHaveBeenCalled(); expect(m.deps.save).not.toHaveBeenCalled();
    expect(m.get(RFQ_TYPE, RFQ)).toEqual({ ...saved, contract_required: "No" });
  });
  it("copies only verified source references and excludes another RFQ's document before award", async () => {
    const m = fixture(), ownPath = "/private/files/RFQ_PUR-RFQ-2026-00095.pdf", otherPath = "/private/files/RFQ_PUR-RFQ-2026-00091.pdf";
    m.put(RFQ_TYPE, { ...m.get(RFQ_TYPE, RFQ), custom_2d_drawing: otherPath, custom_engineering_attachments: JSON.stringify([{ file_url: ownPath }]) });
    for (const [name, path] of [["FILE-OWN", ownPath], ["FILE-OTHER", otherPath]]) m.put("File", { name, attached_to_doctype: RFQ_TYPE, attached_to_name: RFQ, is_folder: 0, file_url: path, file_name: path.split("/").pop() });
    const before = [...m.docs.entries()].filter(([key]) => key.startsWith("File/"));
    const result = await m.call(), data = parseClmData(result.request!.custom_clm_data);
    expect(data.source_documents).toEqual([expect.objectContaining({ file_id: "FILE-OWN", source_doctype: RFQ_TYPE, source_name: RFQ })]);
    expect([...m.docs.entries()].filter(([key]) => key.startsWith("File/"))).toEqual(before);
    expect(m.deps.create).toHaveBeenCalledOnce(); expect(m.deps.create).toHaveBeenCalledWith(REQUEST, expect.anything());
  });
  it.each(["procurement", "procurement_team", "admin"])("routes award-confirmed Yes by %s with actual supplier and negotiated award value", async role => {
    const m = fixture(), before = m.get(RFQ_TYPE, RFQ)!;
    const result = await m.call({ ...manager, role } as AccessPrincipal), request = result.request!;
    expect(result.created).toBe(true); expect(request.name).toBeTruthy();
    expect(request).toMatchObject({ custom_rfq: RFQ, request_status: "Pending Review", approval_status: "Pending", department: "Procurement", supplier: "SUP-1", custom_supplier_quotation: "SQ-95", contract_value: 48500, currency: "USD" });
    for (const key of ["contract_type", "contract_start_date", "contract_end_date", "custom_contract"]) expect([undefined, null, ""]).toContain(request[key]);
    expect(isInitialRfqRequest(request)).toBe(true);
    expect(rfqClmRequestWorkflowView(request)).toMatchObject({ rfq: RFQ, award: "AWARD-95", status: "Pending", stage: "Procurement", assignedRole: "procurement_team" });
    const data = parseClmData(request.custom_clm_data);
    expect(data.rfq_source).toMatchObject({ stage: "rfq_awarded", rfq: RFQ, contract_required: true, award: "AWARD-95", quotation: "SQ-95", amount: 48500 });
    expect((data.rfq_request_draft as ClmRecord).values).toMatchObject({ estimated_contract_value: "" });
    expect(data.approvals).toHaveLength(1); expect(data.approvals[0]).toMatchObject({ role: "procurement_team", stage: 0, status: "Pending" });
    expect(data.audit).toEqual(expect.arrayContaining([expect.objectContaining({ action: "create", by: manager.email }), expect.objectContaining({ action: "procurement_team_assigned", role, new_status: "Pending" })]));
    expect(canReadClm(team, REQUEST, request)).toBe(true); expect(canReadClm(manager, REQUEST, request)).toBe(true);
    expect((await m.deps.list(REQUEST)).filter(row => canReadClm(team, REQUEST, row))).toHaveLength(1);
    expect((await m.deps.list(REQUEST)).filter(row => canReadClm(manager, REQUEST, row))).toHaveLength(1);
    expect(await m.deps.list("Contract")).toEqual([]);
    expect(m.state().clm_initial_request).toMatchObject({ phase: "complete", request: request.name, assigned_role: "procurement_team", status: "Pending", current_stage: "Procurement" });
    expect(m.get(RFQ_TYPE, RFQ)).toMatchObject({ status: before.status, workflow_state: before.workflow_state, docstatus: before.docstatus });
    expect(m.deps.load).toHaveBeenCalledWith("Legal Document Review", "AWARD-95");
  });
  it.each(["finance", "legal", "department"])("rejects %s routing without mutations", async role => {
    const m = fixture(); await expect(m.call({ ...manager, role } as AccessPrincipal)).rejects.toMatchObject({ status: 403 });
    expect(m.deps.create).not.toHaveBeenCalled(); expect(m.deps.save).not.toHaveBeenCalled();
  });
  it("uses the authenticated ERP User identifier for requester rather than an email alias", async () => {
    const m = fixture();
    const result = await m.call({ ...manager, sub: "procurement-user", email: "buyer@example.test" });
    expect(result.request?.requester).toBe("procurement-user");
    expect(parseClmData(result.request!.custom_clm_data).audit).toEqual(expect.arrayContaining([expect.objectContaining({ action: "create", by: "procurement-user" })]));
  });
  it("does not create a Request merely because a supplier reference exists before award", async () => {
    const m = fixture();
    m.docs.delete("Legal Document Review/AWARD-95");
    m.put(RFQ_TYPE, { ...m.get(RFQ_TYPE, RFQ), custom_selected_supplier: "UNAWARDED", custom_workflow_step: "Supplier Invitation" });
    expect(await m.call()).toMatchObject({ created: false });
    expect(m.deps.create).not.toHaveBeenCalled();
    expect(m.deps.load).not.toHaveBeenCalledWith("Supplier", "UNAWARDED");
  });
  it("returns one existing Request on repeated submissions and refresh", async () => {
    const m = fixture(), first = await m.call();
    for (let attempt = 0; attempt < 3; attempt++) expect(await m.call()).toMatchObject({ created: false, request: { name: first.request!.name } });
    expect(await m.deps.list(REQUEST)).toHaveLength(1); expect(m.deps.create).toHaveBeenCalledOnce();
  });
  it("handles concurrent submissions using one durable insert intent and unique RFQ link", async () => {
    const m = fixture(), results = await Promise.all([m.call(), m.call()]);
    expect(results[0].request!.name).toBe(results[1].request!.name);
    expect(await m.deps.list(REQUEST)).toHaveLength(1); expect(m.state().clm_initial_request.phase).toBe("complete");
  });
  it("recovers a lost create response by returning the verified persisted Request", async () => {
    const m = fixture(), create = m.deps.create;
    m.deps.create = vi.fn(async (dt, record) => { await create(dt, record); throw new ClmError("ERP response lost", 504); });
    const result = await m.call();
    expect(result.request?.name).toBeTruthy(); expect(await m.deps.list(REQUEST)).toHaveLength(1);
    expect(m.deps.create).toHaveBeenCalledOnce(); expect(m.state().clm_initial_request.phase).toBe("complete");
  });
  it("preserves a failed native submission and resumes the same persisted Request", async () => {
    const m = fixture(), save = m.deps.save; let fail = true;
    m.deps.save = vi.fn(async (dt, record) => { if (dt === REQUEST && record.request_status === "Pending Review" && fail) throw new ClmError("Procurement Request submission denied", 403); return save(dt, record); });
    await expect(m.call()).rejects.toThrow("Procurement Request submission denied");
    const [saved] = await m.deps.list(REQUEST); expect(saved.request_status).toBe("Draft"); expect(m.state().clm_initial_request.phase).toBe("saving");
    expect(await m.deps.list("Contract")).toEqual([]); expect(m.deps.notify).not.toHaveBeenCalled();
    fail = false; expect(await m.call()).toMatchObject({ created: false, request: { name: saved.name, request_status: "Pending Review" } });
    expect(m.deps.create).toHaveBeenCalledOnce(); expect(m.state().clm_initial_request.phase).toBe("complete");
  });
  it("returns an actual ERP creation error without successful route or Contract", async () => {
    const m = fixture(); m.deps.create = vi.fn(async () => { throw new ClmError("Contract Request permission denied", 403); });
    await expect(m.call()).rejects.toThrow("Contract Request permission denied");
    expect(await m.deps.list(REQUEST)).toEqual([]); expect(m.state().clm_initial_request.phase).toBe("saving");
    expect(m.get(RFQ_TYPE, RFQ)?.workflow_state).toBe("Supplier Selection");
  });
  it("rejects missing unique-link support before any mutation", async () => {
    const m = fixture(); m.schema[0].unique = 0;
    await expect(m.call()).rejects.toThrow("Contract Request.custom_rfq must be unique");
    expect(m.deps.create).not.toHaveBeenCalled(); expect(m.deps.save).not.toHaveBeenCalled();
  });
  it("names required contract-stage fields rather than supplying fake contract terms", async () => {
    const m = fixture(); m.schema.find(field => field.fieldname === "contract_type")!.reqd = 1;
    await expect(m.call()).rejects.toThrow("schema requires contract-stage fields before an awarded RFQ request can be saved: contract_type");
    expect(m.deps.create).not.toHaveBeenCalled(); expect(m.deps.save).not.toHaveBeenCalled();
  });
  it("does not mistake a required metadata default for an explicitly empty award-stage value", async () => {
    const m = fixture(); Object.assign(m.schema.find(field => field.fieldname === "contract_type")!, { reqd: 1, default: "NDA" });
    await expect(m.call()).rejects.toThrow("schema requires contract-stage fields before an awarded RFQ request can be saved: contract_type");
    expect(m.deps.create).not.toHaveBeenCalled(); expect(m.deps.save).not.toHaveBeenCalled();
  });
  it.each([false, true])("rejects altered nonempty persisted values on initial submission and retry (lost response=%s)", async lost => {
    const m = fixture(), create = m.deps.create;
    m.deps.create = vi.fn(async (dt, record) => { const saved = await create(dt, { ...record, description: "Unrequested replacement description" }); if (lost) throw new ClmError("ERP response lost", 504); return saved; });
    await expect(m.call()).rejects.toThrow("ERPNext did not persist Contract Request.description");
    await expect(m.call()).rejects.toThrow("ERPNext did not persist Contract Request.description");
    expect(await m.deps.list(REQUEST)).toHaveLength(1); expect(m.deps.create).toHaveBeenCalledOnce();
    expect(m.state().clm_initial_request.phase).toBe("saving"); expect(m.state().clm_initial_request.pending_document.description).toContain("SUP-1");
    expect(await m.deps.list("Contract")).toEqual([]); expect(m.deps.notify).not.toHaveBeenCalled();
  });
  it("does not report No success while an earlier Yes insert remains unresolved", async () => {
    const m = fixture(), create = m.deps.create;
    m.deps.create = vi.fn((dt, record) => create(dt, { ...record, description: "Unrequested description" }));
    await expect(m.call()).rejects.toThrow("did not persist Contract Request.description");
    expect(m.state().clm_initial_request.pending_document).toBeTruthy(); expect(m.state().clm_initial_request.request).toBeUndefined();
    m.put(RFQ_TYPE, { ...m.get(RFQ_TYPE, RFQ), contract_required: "No" });
    await expect(m.call()).rejects.toMatchObject({ status: 409 });
    expect(await m.deps.list(REQUEST)).toHaveLength(1);
  });
});

describe("RFQ Contract Request lifecycle diagnostics", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  const capture = () => {
    vi.stubEnv("RFQ_CLM_DEBUG", "1");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    return { log, events: () => log.mock.calls.map(([, details]) => details as Record<string, unknown>) };
  };
  it("is silent by default while preserving persisted routing", async () => {
    vi.stubEnv("RFQ_CLM_DEBUG", ""); const log = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await fixture().call()).toMatchObject({ created: true });
    expect(log).not.toHaveBeenCalled();
  });
  it("distinguishes persisted Yes, payload, actual create response and final Procurement assignment", async () => {
    const { events } = capture(), m = fixture();
    const result = await m.call();
    expect(events().map(row => row.event)).toEqual(["routing_attempt", "rfq_reloaded", "request_payload", "request_create_attempt", "request_create_response", "routing_result"]);
    expect(events()).toContainEqual({ event: "rfq_reloaded", rfq_id: RFQ, contract_required: "Yes" });
    expect(events().at(-1)).toMatchObject({ event: "routing_result", rfq_id: RFQ, request_id: result.request!.name, created: true, assigned_role: "procurement_team", current_stage: "Procurement", status: "Pending", request_status: "Pending Review", has_supplier: true, has_award: true });
    expect(JSON.stringify(events())).not.toMatch(/manager@example|Production steel supply|Contract request for RFQ/);
    await m.call();
    expect(events()).toEqual(expect.arrayContaining([expect.objectContaining({ event: "request_reused", request_id: result.request!.name })]));
    expect(m.deps.create).toHaveBeenCalledOnce();
  });
  it("logs a schema rejection before any ERP insert attempt and returns the real error", async () => {
    const { events } = capture(), m = fixture(); m.schema.find(field => field.fieldname === "contract_type")!.reqd = 1;
    await expect(m.call()).rejects.toThrow("schema requires contract-stage fields before an awarded RFQ request can be saved: contract_type");
    expect(events()).toContainEqual({ event: "request_schema_blocked", rfq_id: RFQ, missing_fields: ["contract_type"] });
    expect(events().at(-1)).toMatchObject({ event: "routing_failed", rfq_id: RFQ, error_name: "ClmError", error_status: 503 });
    expect(events().some(row => ["request_create_attempt", "request_create_response", "routing_result"].includes(String(row.event)))).toBe(false);
    expect(m.deps.create).not.toHaveBeenCalled(); expect(m.deps.save).not.toHaveBeenCalled();
  });
  it("logs ERP creation failure without exposing error contents or replacing the original error", async () => {
    const { events } = capture(), m = fixture(); const failure = new ClmError("ERP denied request: private token or response body", 403);
    m.deps.create = vi.fn().mockRejectedValue(failure);
    await expect(m.call()).rejects.toBe(failure);
    expect(events()).toContainEqual({ event: "request_create_failed", rfq_id: RFQ, error_name: "ClmError", error_status: 403 });
    expect(events().some(row => row.event === "routing_result" || row.event === "request_create_response")).toBe(false);
    expect(JSON.stringify(events())).not.toContain("private token");
    expect(await m.deps.list(REQUEST)).toEqual([]);
  });
  it("records a saved No decision as skipped without a payload or insert attempt", async () => {
    const { events } = capture(), m = fixture(); m.put(RFQ_TYPE, { ...m.get(RFQ_TYPE, RFQ), contract_required: "No" });
    expect(await m.call()).toEqual({ created: false });
    expect(events()).toContainEqual({ event: "routing_skipped", rfq_id: RFQ, contract_required: "No" });
    expect(events().some(row => row.event === "request_payload" || row.event === "request_create_attempt")).toBe(false);
    expect(m.deps.create).not.toHaveBeenCalled();
  });
});
