import { afterEach, describe, expect, it, vi } from "vitest";
import { ClmError, parseClmData, type ClmDeps } from "./clmCore";
import { canEditRfqRequestDraft, projectRfqRequestDraft, rfqRequestDraftValues, saveRfqRequestDraft } from "./rfqRequestDraft";
import { validateContractRequestPersistence } from "./clmRequestValidation";
import { createClmDependencies } from "./clmErp";
import { resolveAvailableRfqAward } from "./rfqClmCore";
import handler from "./clm";
import { issueInternalAccessToken } from "./rbacAuth";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { AccessPrincipal, AppRole } from "./rbacAuth";
import type { ClmRecord } from "../src/types/clm";

const principal = (role: AppRole = "procurement_team"): AccessPrincipal => ({ typ: "internal", sub: "team@example.test", email: "team@example.test", role, iat: 1, exp: 9999999999 });
const team = principal();
async function endpoint(body: unknown, role: AppRole = "procurement_team", query: Record<string, string> = { view: "rfq_request_draft" }) {
  vi.stubEnv("BIDSPHERE_SESSION_SECRET", "fixture-draft-only-session");
  const token = issueInternalAccessToken({ sub: "team@example.test", email: "team@example.test", role });
  const response = { status: vi.fn(), json: vi.fn(), setHeader: vi.fn(), end: vi.fn() }; response.status.mockReturnValue(response);
  await handler({ method: body === undefined ? "GET" : "POST", query, body, headers: { "x-bidsphere-access-token": token } } as unknown as VercelRequest, response as unknown as VercelResponse);
  return { status: response.status.mock.calls[0]?.[0], json: response.json.mock.calls[0]?.[0] };
}
function fixture() {
  const data = parseClmData(null);
  data.rfq_source = { stage: "rfq_awarded", rfq: "RFQ-1", contract_required: true, company: "Netlink", award: "LDC-1", quotation: "SQ-1", supplier: "SUP-1", amount: 30, currency: "USD" };
  data.rfq_request_workflow = { version: 1, phase: "procurement_team", assigned_role: "procurement_team", status: "Pending", current_stage: "Procurement" };
  data.approvals = [{ id: "team", role: "procurement_team", stage: 0, rule: "prepare", status: "Pending" }];
  data.audit = [{ id: "created", action: "create", by: "Administrator", role: "admin", at: "2026-09-24 10:00:00", previous_status: "", new_status: "Pending", comment: "created" }, { id: "assigned", action: "procurement_team_assigned", by: "Administrator", role: "admin", at: "2026-09-24 10:00:00", previous_status: "Draft", new_status: "Pending", comment: "assigned" }];
  data.source_documents = [{ file_id: "FILE-1", source_doctype: "Request for Quotation", source_name: "RFQ-1" }];
  const docs = new Map<string, ClmRecord>();
  const put = (dt: string, row: ClmRecord) => { docs.set(`${dt}/${row.name}`, structuredClone(row)); return row; };
  const get = (dt: string, name: string) => structuredClone(docs.get(`${dt}/${name}`)!);
  put("Contract Request", { name: "REQ-1", modified: "v1", docstatus: 0, owner: "Administrator", requester: "Administrator", request_date: "2026-09-24", department: "Production", company: "Netlink", custom_rfq: "RFQ-1", supplier: "SUP-1", custom_supplier_quotation: "SQ-1", contract_value: 30, currency: "USD", contract_purpose: "Source RFQ purpose", description: "Source RFQ description", request_status: "Pending Review", approval_status: "Pending", custom_clm_data: JSON.stringify(data) });
  put("Request for Quotation", { name: "RFQ-1", modified: "r1", docstatus: 1, status: "Open", company: "Netlink", department: "Production", contract_required: "Yes", custom_approval_data: JSON.stringify({ clm_initial_request: { version: 1, phase: "complete", request: "REQ-1", trigger: "award_confirmation", award: "LDC-1", quotation: "SQ-1", supplier: "SUP-1" }, clm_award_intent: { version: 1, phase: "complete", decision: "Yes", award: "LDC-1", quotation: "SQ-1", supplier: "SUP-1", by: "manager@example.test", at: "2026-09-24 10:00:00" } }) });
  put("Supplier", { name: "SUP-1", disabled: 0 });
  put("Supplier Quotation", { name: "SQ-1", docstatus: 1, supplier: "SUP-1", company: "Netlink", currency: "USD", grand_total: 40, items: [{ request_for_quotation: "RFQ-1" }] });
  put("Legal Document Review", { name: "LDC-1", rfq_name: "RFQ-1", sq_name: "SQ-1", supplier: "SUP-1", company: "Netlink", grand_total: 30 });
  put("Department", { name: "Production", company: "Netlink", disabled: 0 });
  put("Currency", { name: "USD", enabled: 1 });
  const deps: ClmDeps = {
    load: vi.fn(async (dt, name) => { const row = get(dt, name); if (!row) throw new ClmError("Not found", 404); return row; }),
    list: vi.fn(async (dt, filters = []) => [...docs.entries()].filter(([key, row]) => key.startsWith(`${dt}/`) && filters.every(filter => { const [field, , value] = filter as [string, string, unknown]; return row[field] === value; })).map(([, row]) => structuredClone(row))),
    create: vi.fn(async () => { throw new Error("No records may be created by Save Draft"); }),
    save: vi.fn(async (dt, row) => {
      if (dt !== "Contract Request") throw new Error("Save Draft must not mutate other records");
      if (get(dt, String(row.name)).modified !== row.modified) throw new ClmError("Document changed", 409);
      const rfq = get("Request for Quotation", "RFQ-1");
      validateContractRequestPersistence(row, rfq, "save", await resolveAvailableRfqAward(rfq, deps));
      return put(dt, { ...row, modified: `${row.modified}+1`, modified_by: "Administrator" });
    }),
    now: () => "2026-09-24 11:00:00", notify: vi.fn(),
  };
  const save = (payload: ClmRecord, expected_modified = String(get("Contract Request", "REQ-1").modified), who = team) => saveRfqRequestDraft(who, { name: "REQ-1", expected_modified, payload }, deps);
  return { docs, get, put, deps, save };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("Procurement partial awarded RFQ Request draft", () => {
  it("rejects editing an old active-looking request whose authoritative RFQ is still Draft", async () => {
    const m = fixture();
    m.put("Request for Quotation", { ...m.get("Request for Quotation", "RFQ-1"), docstatus: 0, status: "Draft" });
    await expect(m.save({ description: "Must not advance a Draft RFQ request" })).rejects.toMatchObject({ status: 409 });
    expect(m.deps.save).not.toHaveBeenCalled(); expect(m.deps.create).not.toHaveBeenCalled();
  });
  it.each(["procurement", "procurement_team"] as AppRole[])("does not expose or save an old pre-award Request for %s", async role => {
    const m = fixture(), request = m.get("Contract Request", "REQ-1"), data = parseClmData(request.custom_clm_data);
    data.rfq_source = { stage: "rfq_created", rfq: "RFQ-1", contract_required: true, company: "Netlink" };
    delete request.supplier; delete request.custom_supplier_quotation;
    const preaward = m.put("Contract Request", { ...request, custom_clm_data: JSON.stringify(data) });
    m.docs.delete("Legal Document Review/LDC-1");
    expect(canEditRfqRequestDraft(principal(role), preaward)).toBe(false);
    await expect(m.save({ description: "Must wait for award" }, "v1", principal(role))).rejects.toMatchObject({ status: 403 });
    expect(m.deps.save).not.toHaveBeenCalled(); expect(m.deps.create).not.toHaveBeenCalled();
  });
  it("lets Procurement Manager save awarded Request terms with the actual actor in its audit", async () => {
    const m = fixture(), manager = { ...principal("procurement"), sub: "manager@example.test", email: "manager@example.test" } as AccessPrincipal;
    const saved = await m.save({ description: "Manager reviewed award scope" }, "v1", manager);
    expect(canEditRfqRequestDraft(manager, saved)).toBe(true);
    expect(saved).toMatchObject({ name: "REQ-1", supplier: "SUP-1", custom_supplier_quotation: "SQ-1", contract_value: 30, currency: "USD" });
    expect(parseClmData(saved.custom_clm_data).audit.at(-1)).toMatchObject({ action: "save_rfq_request_draft", by: "manager@example.test", role: "procurement", new_status: "Pending" });
    expect(m.deps.create).not.toHaveBeenCalled();
  });
  it.each(["", 0, 40])("cannot replace the final negotiated award value with %j while saving draft terms", async contract_value => {
    const m = fixture(), before = m.get("Contract Request", "REQ-1");
    await expect(m.save({ contract_value })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("final award value") });
    expect(m.get("Contract Request", "REQ-1")).toEqual(before);
    expect(m.deps.save).not.toHaveBeenCalled();
    expect(m.deps.create).not.toHaveBeenCalled();
  });
  it("ignores legacy draft value/currency overrides while preserving the separate estimate and entered terms", async () => {
    const m = fixture(), request = m.get("Contract Request", "REQ-1"), data = parseClmData(request.custom_clm_data);
    data.rfq_request_draft = { version: 1, by: team.sub, at: "2026-09-24 10:00:00", values: { contract_value: 999, currency: "EUR", estimated_contract_value: 50000, description: "Entered scope" } };
    m.put("Contract Request", { ...request, custom_clm_data: JSON.stringify(data) });
    expect(projectRfqRequestDraft(m.get("Contract Request", "REQ-1"))).toMatchObject({ contract_value: 30, currency: "USD", estimated_contract_value: 50000, description: "Entered scope" });
    const saved = await m.save({ contract_purpose: "Updated purpose" });
    expect(saved).toMatchObject({ contract_value: 30, currency: "USD", estimated_contract_value: 50000 });
    const values = (parseClmData(saved.custom_clm_data).rfq_request_draft as ClmRecord).values;
    expect(values).not.toHaveProperty("contract_value"); expect(values).not.toHaveProperty("currency");
    expect(values).toMatchObject({ estimated_contract_value: 50000, description: "Entered scope" });
  });
  it("rejects a crafted currency change before saving any Request data", async () => {
    const m = fixture(); await expect(m.save({ currency: "EUR" })).rejects.toMatchObject({ status: 409 });
    expect(m.deps.save).not.toHaveBeenCalled();
  });
  it.each([
    ["finance", { name: "REQ-1", expected_modified: "v1", payload: {} }, 403],
    ["procurement_team", { name: "REQ-1", expected_modified: "v1", payload: {}, assigned_role: "procurement" }, 400],
    ["procurement_team", { name: "REQ-1", expected_modified: "v1", payload: { supplier: "OTHER" } }, 403],
    ["procurement_team", { name: "REQ-1", payload: {} }, 400],
  ] as const)("validates the new HTTP operation for role %s before ERP access", async (role, body, status) => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const result = await endpoint(body, role); expect(result.status).toBe(status); expect(result.json.success).toBe(false); expect(fetch).not.toHaveBeenCalled();
  });
  it("persists only the same awarded Request, preserves routing/source/history, and never creates Contract", async () => {
    const m = fixture(), rfq = m.get("Request for Quotation", "RFQ-1"), before = m.get("Contract Request", "REQ-1");
    const result = await m.save({ contract_type: "Service Agreement", contract_purpose: "Changed purpose", contract_value: "30", currency: "USD", contract_start_date: "2026-10-01" });
    expect(result).toMatchObject({ name: "REQ-1", custom_rfq: "RFQ-1", department: "Production", requester: "Administrator", request_status: "Pending Review", contract_type: "Service Agreement", contract_purpose: "Changed purpose", contract_value: 30, currency: "USD", contract_start_date: "2026-10-01" });
    expect(m.get("Request for Quotation", "RFQ-1")).toEqual(rfq);
    const original = parseClmData(before.custom_clm_data), saved = parseClmData(result.custom_clm_data);
    for (const key of ["rfq_source", "rfq_request_workflow", "source_documents", "approvals", "versions", "signatures"]) expect(saved[key]).toEqual(original[key]);
    expect(saved.audit.slice(0, -1)).toEqual(original.audit);
    expect(saved.audit.at(-1)).toMatchObject({ action: "save_rfq_request_draft", role: "procurement_team", previous_status: "Pending", new_status: "Pending", reference_id: "REQ-1" });
    expect(canEditRfqRequestDraft(team, result)).toBe(true);
    expect(m.deps.create).not.toHaveBeenCalled(); expect(m.deps.notify).not.toHaveBeenCalled();
    expect(m.deps.save).toHaveBeenCalledOnce(); expect([...m.docs.keys()].filter(key => key.startsWith("Contract/"))).toEqual([]);
  });

  it("honestly persists intentionally blank purpose and description as draft without weakening native mandatory fields", async () => {
    const m = fixture(), saved = await m.save({ contract_purpose: "", description: "", contract_end_date: "", estimated_contract_value: "" });
    expect(saved).toMatchObject({ contract_purpose: "Source RFQ purpose", description: "Source RFQ description", contract_end_date: null, contract_value: 30, estimated_contract_value: 0 });
    expect(projectRfqRequestDraft(await m.deps.load("Contract Request", "REQ-1"))).toMatchObject({ contract_purpose: "", description: "", contract_end_date: "", contract_value: 30, estimated_contract_value: "" });
    expect(rfqRequestDraftValues(saved)).toMatchObject({ contract_purpose: "", description: "" });
    expect(() => validateContractRequestPersistence({ ...saved, contract_purpose: "" }, m.get("Request for Quotation", "RFQ-1"))).toThrow(/contract_purpose/);
    expect(() => validateContractRequestPersistence({ ...saved, custom_rfq: "" })).toThrow(/requires/);
  });

  it("preserves previously entered draft values across partial saves and re-fetch", async () => {
    const m = fixture(); await m.save({ contract_purpose: "", contract_type: "Other", estimated_contract_value: "125.75" });
    const second = await m.save({ description: "Scope updated" });
    expect(projectRfqRequestDraft(second)).toMatchObject({ contract_purpose: "", contract_type: "Other", estimated_contract_value: 125.75, description: "Scope updated" });
    expect(m.deps.create).not.toHaveBeenCalled(); expect(m.docs.size).toBe(7);
  });

  it.each(["admin", "finance", "legal", "engineer"] as AppRole[])("rejects %s before ERP access", async role => {
    const m = fixture(); await expect(m.save({}, "v1", principal(role))).rejects.toMatchObject({ status: 403 }); expect(m.deps.load).not.toHaveBeenCalled(); expect(m.deps.save).not.toHaveBeenCalled();
  });
  it("rejects suppliers before ERP access", async () => {
    const m = fixture(); await expect(m.save({}, "v1", { typ: "supplier", sub: "S", supplier: "S" } as AccessPrincipal)).rejects.toMatchObject({ status: 403 }); expect(m.deps.load).not.toHaveBeenCalled();
  });
  it.each(["custom_rfq", "supplier", "award", "owner", "requester", "department", "company", "custom_clm_data", "request_status", "approval_status", "supporting_document", "additional_documents", "assigned_role", "current_stage"])("rejects protected %s without mutation", async field => {
    const m = fixture(); await expect(m.save({ [field]: "forged" })).rejects.toMatchObject({ status: 403 }); expect(m.deps.save).not.toHaveBeenCalled(); expect(m.deps.load).not.toHaveBeenCalled();
  });
  it.each([
    { contract_start_date: "2026-02-30" }, { contract_end_date: "tomorrow" }, { contract_start_date: "2026-11-01", contract_end_date: "2026-10-01" },
    { contract_value: -1 }, { contract_value: "NaN" }, { contract_value: true }, { contract_value: {} }, { estimated_contract_value: "1e3" },
    { contract_type: "Unsupported" }, { description: [] },
  ])("rejects malformed provided details %j", async payload => {
    const m = fixture(); await expect(m.save(payload)).rejects.toMatchObject({ status: 422 }); expect(m.deps.save).not.toHaveBeenCalled();
  });
  it("validates the combined dates across partial saves", async () => {
    const m = fixture(); await m.save({ contract_start_date: "2026-10-01" }); vi.mocked(m.deps.save).mockClear();
    await expect(m.save({ contract_end_date: "2026-10-01" })).rejects.toMatchObject({ status: 422 }); expect(m.deps.save).not.toHaveBeenCalled();
  });
  it("requires a valid enabled saved Currency when supplied", async () => {
    const m = fixture(); m.put("Currency", { name: "USD", enabled: 0 });
    await expect(m.save({ currency: "USD" })).rejects.toMatchObject({ status: 422 }); expect(m.deps.save).not.toHaveBeenCalled();
  });
  it.each([{ contract_required: "No" }, { company: "OTHER" }, { docstatus: 2 }, { status: "Closed" }, { workflow_state: "Rejected" }, { custom_workflow_step: "Finance Rejected" }, { custom_approval_data: "null" }, { custom_approval_data: JSON.stringify({ clm_initial_request: { version: 1, phase: "complete", request: "OTHER" } }) }])("rejects mismatched or invalid saved RFQ %j", async patch => {
    const m = fixture(); m.put("Request for Quotation", { ...m.get("Request for Quotation", "RFQ-1"), ...patch });
    await expect(m.save({})).rejects.toMatchObject({ status: 409 }); expect(m.deps.save).not.toHaveBeenCalled();
  });
  it.each(["contract", "duplicate", "prepared", "assignment"])("rejects %s state without changing records", async variant => {
    const m = fixture(), request = m.get("Contract Request", "REQ-1"), data = parseClmData(request.custom_clm_data);
    if (variant === "contract") m.put("Contract", { name: "CON-1", custom_rfq: "RFQ-1" });
    if (variant === "duplicate") m.put("Contract Request", { ...request, name: "REQ-2" });
    if (variant === "prepared") data.rfq_source = { ...data.rfq_source as ClmRecord, prepared: true };
    if (variant === "assignment") data.approvals[0].user = "other@example.test";
    m.put("Contract Request", { ...request, custom_clm_data: JSON.stringify(data) });
    await expect(m.save({})).rejects.toBeInstanceOf(ClmError); expect(m.deps.save).not.toHaveBeenCalled();
  });
  it("rejects stale form revisions before save", async () => {
    const m = fixture(); await expect(m.save({}, "old-revision")).rejects.toMatchObject({ status: 409 }); expect(m.deps.save).not.toHaveBeenCalled();
  });
  it("relies on ERP atomic modified check if a concurrent change occurs after validation", async () => {
    const m = fixture(), original = m.deps.save;
    m.deps.save = vi.fn(async (dt, record) => { m.put(dt, { ...m.get(dt, "REQ-1"), modified: "concurrent", description: "Other editor" }); return original(dt, record); });
    await expect(m.save({ description: "Attempt" })).rejects.toMatchObject({ status: 409 });
    expect(m.get("Contract Request", "REQ-1").description).toBe("Other editor"); expect(m.deps.create).not.toHaveBeenCalled();
  });
  it("returns the real ERP save error and leaves the request pending", async () => {
    const m = fixture(), before = m.get("Contract Request", "REQ-1");
    m.deps.save = vi.fn(async () => { throw new ClmError("ERPNext database temporarily unavailable", 503); });
    await expect(m.save({ description: "Draft" })).rejects.toMatchObject({ status: 503, message: "ERPNext database temporarily unavailable" }); expect(m.get("Contract Request", "REQ-1")).toEqual(before);
  });
  it.each(["custom_clm_data", "description", "department"])("verifies re-fetched %s, rejecting a success-shaped but incomplete persistence response", async field => {
    const m = fixture(), original = m.deps.save;
    m.deps.save = vi.fn(async (dt, record) => { const saved = await original(dt, record); m.put(dt, { ...saved, [field]: field === "custom_clm_data" ? m.get(dt, "REQ-1").custom_clm_data + " " : "not-persisted" }); return saved; });
    await expect(m.save({ description: "New description" })).rejects.toMatchObject({ status: 409 }); expect(m.deps.create).not.toHaveBeenCalled();
  });

  it("uses native frappe.client.save with the original revision and verifies the persisted draft through a fresh ERP GET", async () => {
    const m = fixture(); vi.stubEnv("ERPNEXT_URL", "https://request-draft-erp.test"); vi.stubEnv("ERP_API_KEY", "fixture-key"); vi.stubEnv("ERP_API_SECRET", "fixture-secret");
    const calls: Array<{ method: string; route: string; body?: ClmRecord }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(String(input)); if (url.origin !== "https://request-draft-erp.test") throw new Error("Fixture-only network");
      const route = decodeURIComponent(url.pathname).replace("/api/", ""), body = init?.body ? JSON.parse(String(init.body)) as ClmRecord : undefined;
      calls.push({ method: String(init?.method), route, body }); let result: unknown;
      if (route === "method/frappe.client.save") {
        expect((body!.doc as ClmRecord).modified).toBe("v1"); expect((body!.doc as ClmRecord).doctype).toBe("Contract Request");
        result = await m.deps.save("Contract Request", body!.doc as ClmRecord);
      } else {
        const [, dt, name] = route.split("/"); result = name ? await m.deps.load(dt, name) : await m.deps.list(dt, JSON.parse(url.searchParams.get("filters") || "[]"));
      }
      return new Response(JSON.stringify({ data: result }), { headers: { "Content-Type": "application/json" } });
    });
    const saved = await saveRfqRequestDraft(team, { name: "REQ-1", expected_modified: "v1", payload: { description: "", contract_value: "30" } }, createClmDependencies());
    expect(projectRfqRequestDraft(saved)).toMatchObject({ name: "REQ-1", description: "", contract_value: 30 });
    expect(calls.filter(call => call.method === "POST")).toHaveLength(1);
    expect(calls.at(-1)?.route).toBe("resource/Contract Request/REQ-1");
  });

  it.each(["procurement", "procurement_team"] as AppRole[])("returns %s projected draft details and capability from the real HTTP handler and canonical detail re-fetch", async role => {
    const m = fixture(); vi.stubEnv("ERPNEXT_URL", "https://request-draft-erp.test"); vi.stubEnv("ERP_API_KEY", "fixture-key"); vi.stubEnv("ERP_API_SECRET", "fixture-secret");
    const mutations: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(String(input)); if (url.origin !== "https://request-draft-erp.test") throw new Error("Fixture-only network");
      const route = decodeURIComponent(url.pathname).replace("/api/", ""); let result: unknown;
      if (route === "method/frappe.client.save") {
        mutations.push(route); const body = JSON.parse(String(init!.body)); result = await m.deps.save("Contract Request", body.doc);
      } else if (route.startsWith("resource/DocType/")) result = { fields: [] };
      else if (["resource/Custom Field", "resource/Property Setter"].includes(route)) result = [];
      else { const [, dt, name] = route.split("/"); result = name ? await m.deps.load(dt, name) : await m.deps.list(dt, JSON.parse(url.searchParams.get("filters") || "[]")); }
      return new Response(JSON.stringify({ data: result }), { headers: { "Content-Type": "application/json" } });
    });
    const response = await endpoint({ name: "REQ-1", expected_modified: "v1", payload: { description: "", contract_value: "30" } }, role);
    expect(response.status).toBe(200);
    expect(response.json.data).toMatchObject({ doctype: "Contract Request", rfq_request_draft_editable: true, record: { name: "REQ-1", description: "", contract_value: 30, request_status: "Pending Review" } });
    const refreshed = await endpoint(undefined, role, { view: "detail", doctype: "Contract Request", name: "REQ-1" });
    expect(refreshed.json.data).toMatchObject({ rfq_request_draft_editable: true, record: { description: "", contract_value: 30 } });
    expect(mutations).toEqual(["method/frappe.client.save"]);
    expect(m.deps.create).not.toHaveBeenCalled();
  });
});
