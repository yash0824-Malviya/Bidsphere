import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isRfqDocumentMutation, normalizeRfqContractRequirementRequest as normalize } from "./rfqContractRequirementGuard";
const routing = vi.hoisted(() => ({ ensure: vi.fn() }));
vi.mock("./rfqClmErp", () => ({ ensureInitialRfqContractRequestErp: routing.ensure }));
import proxy from "./proxy";
import { issueInternalAccessToken } from "./rbacAuth";

const rfq = { doctype: "Request for Quotation", items: [{ item_code: "ITEM-1", qty: 20, uom: "Kg" }], suppliers: [{ supplier: "SUP-1" }] };
describe("RFQ mutation security inspection without CLM side effects", () => {
  it.each(["save", "insert", "submit", "set_value"])("keeps encoded GET %s RFQ mutations inside the authenticated gateway", method => {
    expect(isRfqDocumentMutation({ apiPath: `method/frappe.client.${method}`, method: "GET", query: method === "set_value" ? { doctype: rfq.doctype, name: "RFQ-1" } : { doc: JSON.stringify({ ...rfq, name: "RFQ-1", docstatus: 1 }) } })).toBe(true);
  });
  it("does not treat reads or other DocTypes as RFQ mutations", () => {
    expect(isRfqDocumentMutation({ apiPath: "resource/Request for Quotation/RFQ-1", method: "GET" })).toBe(false);
    expect(isRfqDocumentMutation({ apiPath: "method/frappe.client.get", method: "GET", query: { doctype: rfq.doctype } })).toBe(false);
    expect(isRfqDocumentMutation({ apiPath: "method/frappe.client.submit", method: "POST", body: { doc: { doctype: "Supplier Quotation", name: "SQ-1" } } })).toBe(false);
  });
});
describe("RFQ Contract Requirement gateway metadata", () => {
  it.each(["Yes", "No"])("preserves %s on new resource and generic RFQ creation", value => {
    for (const input of [{ apiPath: "resource/Request%20for%20Quotation", method: "POST", body: { ...rfq, contract_required: value } }, { apiPath: "method/frappe.client.save", method: "POST", body: { doc: { ...rfq, contract_required: value } } }]) expect(normalize(input).body).toEqual(input.body);
  });
  it("defaults a new resource RFQ to No without changing items or suppliers", () => {
    const result = normalize({ apiPath: "resource/Request for Quotation", method: "POST", body: rfq });
    expect(result.body).toEqual({ ...rfq, contract_required: "No" }); expect(rfq).not.toHaveProperty("contract_required");
  });
  it.each(["frappe.client.save", "frappe.client.insert"])("defaults new RFQ JSON document through %s", rpc => {
    const result = normalize({ apiPath: `method/${rpc}`, method: "POST", body: { doc: JSON.stringify(rfq) } });
    expect(JSON.parse((result.body as { doc: string }).doc)).toEqual({ ...rfq, contract_required: "No" });
  });
  it("recognizes an explicitly local named document but never defaults an existing save", () => {
    const local = normalize({ apiPath: "method/frappe.client.save", method: "POST", body: { doc: { ...rfq, name: "new-rfq-1", __islocal: 1 } } });
    expect((local.body as { doc: object }).doc).toHaveProperty("contract_required", "No");
    const body = { doc: { ...rfq, name: "RFQ-1", custom_workflow_step: "Pending Legal Review" } };
    expect(normalize({ apiPath: "method/frappe.client.save", method: "POST", body }).body).toBe(body);
  });
  it.each(["PUT", "PATCH"])("leaves existing %s partial updates unchanged", method => {
    const body = { custom_selected_supplier: "SUP-1" };
    expect(normalize({ apiPath: "resource/Request for Quotation/RFQ-1", method, body }).body).toBe(body);
  });
  it.each([null, "", "yes", "YES", true, 1, "Maybe", {}, []])("rejects explicitly invalid metadata %j", value => {
    expect(() => normalize({ apiPath: "resource/Request for Quotation/RFQ-1", method: "PUT", body: { contract_required: value } })).toThrow("Contract Requirement must be Yes or No.");
    expect(() => normalize({ apiPath: "method/frappe.client.save", method: "POST", body: { doc: JSON.stringify({ ...rfq, contract_required: value }) } })).toThrow("Contract Requirement must be Yes or No.");
  });
  it.each(["Yes", "No"])("supports set_value scalar, object and encoded map (%s)", value => {
    for (const selector of ["contract_required", { contract_required: value, custom_legal_status: "Pending" }, JSON.stringify({ contract_required: value })]) {
      const body = { doctype: "Request for Quotation", name: "RFQ-1", fieldname: selector, value };
      expect(normalize({ apiPath: "method/frappe.client.set_value", method: "POST", body }).body).toBe(body);
    }
  });
  it("rejects malformed set_value metadata in maps and field arrays", () => {
    for (const selector of ["contract_required", { contract_required: "bad" }, JSON.stringify({ contract_required: "bad" }), ["contract_required"], JSON.stringify(["contract_required"])]) expect(() => normalize({ apiPath: "method/frappe.client.set_value", method: "POST", body: { doctype: "Request for Quotation", name: "RFQ-1", fieldname: selector, value: "bad" } })).toThrow(/Yes or No/);
  });
  it("keeps unrelated set_value and non-RFQ documents unchanged", () => {
    const body = { doctype: "Request for Quotation", name: "RFQ-1", fieldname: "custom_selected_supplier", value: "SUP-1" };
    expect(normalize({ apiPath: "method/frappe.client.set_value", method: "POST", body }).body).toBe(body);
    const unrelated = { doc: { doctype: "Supplier Quotation", contract_required: "not an RFQ field" } };
    expect(normalize({ apiPath: "method/frappe.client.save", method: "POST", body: unrelated }).body).toBe(unrelated);
  });
  it("validates/defaults mutation RPC GET documents without changing routing parameters", () => {
    const query = { path: "method/frappe.client.save", doc: JSON.stringify(rfq) };
    const result = normalize({ apiPath: query.path, method: "GET", query });
    expect(result.query?.path).toBe(query.path); expect(JSON.parse(String(result.query?.doc))).toHaveProperty("contract_required", "No");
    expect(() => normalize({ apiPath: "method/frappe.client.set_value", method: "GET", query: { doctype: "Request for Quotation", name: "RFQ-1", fieldname: "contract_required", value: "bad" } })).toThrow(/Yes or No/);
  });
  it("preserves supported nested resource envelopes and encoded whole bodies", () => {
    const result = normalize({ apiPath: "resource/Request for Quotation", method: "POST", body: JSON.stringify({ data: rfq }) });
    expect(JSON.parse(String(result.body))).toEqual({ data: { ...rfq, contract_required: "No" } });
  });
  it("does not inject fields into reads, list queries, cancellation, or delete calls", () => {
    for (const input of [{ apiPath: "resource/Request for Quotation", method: "GET", query: { fields: '["name","status"]' } }, { apiPath: "method/frappe.client.get_list", method: "POST", body: { doctype: "Request for Quotation", fields: ["name"] } }, { apiPath: "method/frappe.client.cancel", method: "POST", body: { doc: rfq } }, { apiPath: "resource/Request for Quotation/RFQ-1", method: "DELETE", body: rfq }]) expect(normalize(input)).toEqual({ body: input.body, query: input.query });
  });
});

describe("RFQ metadata forwarding through the production authenticated proxy", () => {
  beforeEach(() => {
    routing.ensure.mockReset().mockResolvedValue({ required: false });
    vi.stubEnv("BIDSPHERE_SESSION_SECRET", "isolated-rfq-contract-metadata-test");
    vi.stubEnv("ERPNEXT_URL", "https://erp.test");
    vi.stubEnv("ERP_API_KEY", "test-key");
    vi.stubEnv("ERP_API_SECRET", "test-secret");
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  function response() {
    const res = { status: vi.fn(), json: vi.fn(), send: vi.fn(), end: vi.fn(), setHeader: vi.fn() };
    res.status.mockReturnValue(res);
    return res as unknown as VercelResponse & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
  }
  function request(path: string, method: string, body?: unknown, role: "procurement" | "procurement_team" | "finance" = "procurement") {
    return { method, body, query: { path }, headers: { "x-bidsphere-access-token": issueInternalAccessToken({ sub: "procurement@example.test", email: "procurement@example.test", role }) } } as unknown as VercelRequest;
  }
  const upstream = () => vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { name: "RFQ-1" } }), { status: 200, headers: { "Content-Type": "application/json" } }));

  it.each(["resource/Request for Quotation", "method/frappe.client.save", "method/frappe.client.insert"])("forwards the safe No default on new RFQs through %s", async path => {
    const fetchMock = upstream(); const res = response();
    await proxy(request(path, "POST", path.startsWith("resource/") ? rfq : { doc: rfq }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(path.startsWith("resource/") ? body : body.doc).toEqual({ ...rfq, contract_required: "No" });
    expect(routing.ensure).not.toHaveBeenCalled();
  });

  it("saves a Yes Draft successfully without calling Request persistence", async () => {
    const saved = { ...rfq, name: "RFQ-95", docstatus: 0, contract_required: "Yes" };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: saved }), { status: 200, headers: { "Content-Type": "application/json" } }));
    routing.ensure.mockRejectedValue(new Error("Request persistence must not be reached for Draft creation."));
    const res = response();
    await proxy(request("resource/Request for Quotation", "POST", { ...rfq, contract_required: "Yes" }), res);
    expect(res.status).toHaveBeenCalledExactlyOnceWith(200);
    expect(res.json).toHaveBeenCalledWith({ data: saved });
    expect(routing.ensure).not.toHaveBeenCalled();
  });

  it("persists an explicit Yes and leaves subsequent partial selection updates untouched", async () => {
    const fetchMock = upstream();
    await proxy(request("resource/Request for Quotation", "POST", { ...rfq, contract_required: "Yes" }), response());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toHaveProperty("contract_required", "Yes");
    fetchMock.mockClear().mockImplementation(async (url, init) => {
      const route = decodeURIComponent(new URL(String(url)).pathname);
      const json = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
      if (route === "/api/resource/Request for Quotation/RFQ-1") return json({ ...rfq, name: "RFQ-1", contract_required: "Yes" });
      if (init?.method && init.method !== "GET") throw new Error(`Unexpected fixture mutation: ${route}`);
      if (route === "/api/resource/Supplier Quotation") return json([{ name: "SQ-1" }]);
      if (route === "/api/resource/Supplier Quotation/SQ-1") return json({ name: "SQ-1", supplier: "SUP-1", docstatus: 1, items: [{ request_for_quotation: "RFQ-1" }] });
      if (route === "/api/resource/Supplier Scoring Result") return json([{ name: "SCORE-1" }]);
      if (route === "/api/resource/Supplier Scoring Result/SCORE-1") return json({ name: "SCORE-1", rfq: "RFQ-1", analysis_snapshot: JSON.stringify({ analysis: { rfq_id: "RFQ-1", evaluation_run_id: "RUN-1", supplier_analysis: [{ supplier_id: "SUP-1", quotation_id: "SQ-1", evaluation_run_id: "RUN-1", risk: "Low", verdict: "GOOD OPTION" }] } }) });
      throw new Error(`Unexpected fixture request: ${route}`);
    });
    const update = { custom_selected_supplier: "SUP-1", custom_workflow_step: "Pending Legal Review" };
    const updateResponse = response();
    await proxy(request("resource/Request for Quotation/RFQ-1", "PUT", update), updateResponse);
    expect(updateResponse.status).toHaveBeenCalledWith(200);
    const writes = fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT");
    expect(writes).toHaveLength(1);
    expect(JSON.parse(String(writes[0][1]?.body))).toEqual(update);
    expect(fetchMock.mock.calls.some(([url]) => decodeURIComponent(String(url)).includes("Supplier Scoring Result/SCORE-1"))).toBe(true);
    expect(routing.ensure).not.toHaveBeenCalled();
  });

  it("rejects invalid contract metadata before any upstream write", async () => {
    const fetchMock = upstream(); const res = response();
    await proxy(request("method/frappe.client.set_value", "POST", { doctype: "Request for Quotation", name: "RFQ-1", fieldname: JSON.stringify({ contract_required: "Later" }) }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Contract Requirement must be Yes or No." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retains RFQ role restrictions for Contract Requirement updates", async () => {
    const fetchMock = upstream(); const res = response();
    await proxy(request("resource/Request for Quotation/RFQ-1", "PUT", { contract_required: "Yes" }, "finance"), res);
    expect(res.status).toHaveBeenCalledWith(403); expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits a Yes RFQ without any Request creation or reactivation", async () => {
    const saved = { ...rfq, name: "RFQ-95", docstatus: 1, contract_required: "Yes", modified: "2026-09-24 10:00:00.123456" };
    const envelope = { data: saved };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => new Response(JSON.stringify(init?.method === "PUT" ? envelope : { data: { ...saved, docstatus: 0 } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const res = response();
    routing.ensure.mockRejectedValue(new Error("RFQ submission must never route a Request."));
    await proxy(request("resource/Request for Quotation/RFQ-95", "PUT", { docstatus: 1, modified: "draft-revision" }), res);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
    expect(routing.ensure).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200); expect(res.json).toHaveBeenCalledWith(envelope);
  });

  it("does not run the retired CLM submission follow-up even when that service would fail", async () => {
    const saved = { ...rfq, name: "RFQ-95", docstatus: 1, contract_required: "Yes" };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => new Response(JSON.stringify({ data: { ...saved, docstatus: init?.method === "PUT" ? 1 : 0 } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    routing.ensure.mockRejectedValue(new Error("ERPNext denied Contract Request creation."));
    const res = response();
    await proxy(request("resource/Request for Quotation/RFQ-95", "PUT", { docstatus: 1 }), res);
    expect(res.status).toHaveBeenCalledExactlyOnceWith(200);
    expect(res.json).toHaveBeenCalledWith({ data: saved });
    expect(routing.ensure).not.toHaveBeenCalled();
  });

  it("preserves the RFQ submission response without inserting Request pointers", async () => {
    const saved = { ...rfq, name: "RFQ-95", docstatus: 1, contract_required: "Yes", modified: "original-revision", custom_approval_data: "{}" };
    const fresh = { ...saved, modified: "routing-revision", custom_approval_data: JSON.stringify({ clm_initial_request: { request: "CR-95", phase: "complete" } }) };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => new Response(JSON.stringify({ data: { ...saved, docstatus: init?.method === "PUT" ? 1 : 0 } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    routing.ensure.mockResolvedValue({ created: true, request: { name: "CR-95" }, rfq: fresh });
    const res = response();
    await proxy(request("resource/Request for Quotation/RFQ-95", "PUT", { docstatus: 1 }), res);
    expect(res.status).toHaveBeenCalledExactlyOnceWith(200);
    expect(res.json).toHaveBeenCalledWith({ data: saved });
    expect(routing.ensure).not.toHaveBeenCalled();
  });

  it("does not attempt routing when ERPNext rejects the RFQ save", async () => {
    const upstreamError = { message: "Item required" };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(upstreamError), { status: 417, headers: { "Content-Type": "application/json" } }));
    const res = response();
    await proxy(request("method/frappe.client.save", "POST", { doc: { ...rfq, contract_required: "Yes" } }), res);
    expect(res.status).toHaveBeenCalledWith(417); expect(res.json).toHaveBeenCalledWith(upstreamError);
    expect(routing.ensure).not.toHaveBeenCalled();
  });
});
