import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import handler from "./proxy";
import { issueInternalAccessToken } from "./rbacAuth";

const ready = vi.hoisted(() => vi.fn());
const clmReady = vi.hoisted(() => vi.fn());
vi.mock("./legalReviewCore", () => ({ assertLegalReviewReadyForPurchaseOrder: ready }));
vi.mock("./rfqClmCore", () => ({ assertRfqClmReadyForProcurement: clmReady }));
const originalEnv = { ...process.env };
const po = { doctype: "Purchase Order", supplier: "Supplier-1", items: [{ item_code: "ITEM-1", qty: 1, supplier_quotation: "SQ-1" }] };
const review = { name: "LDR-1", sq_name: "SQ-1", rfq_name: "RFQ-1", supplier: "Supplier-1" };
const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });

function response() {
  const res = { status: vi.fn(), json: vi.fn(), send: vi.fn(), end: vi.fn(), setHeader: vi.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as VercelResponse & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  process.env.BIDSPHERE_SESSION_SECRET = "isolated-po-gateway-test";
  process.env.ERPNEXT_URL = "https://erp.test";
  process.env.ERP_API_KEY = "test-key";
  process.env.ERP_API_SECRET = "test-secret";
  ready.mockReset().mockResolvedValue(review);
  clmReady.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { vi.restoreAllMocks(); process.env = { ...originalEnv }; });

describe("production proxy RFQ PO authorization wiring", () => {
  const cases = [
    { path: "method/frappe.client.save", method: "POST", body: { doc: po } },
    { path: "resource/Purchase Order", method: "POST", body: po },
    { path: "resource/Purchase Order/PO-1", method: "PUT", body: { docstatus: 1 } },
  ];
  it.each(cases)("does not forward $method $path without signature + Finance + integrity", async input => {
    ready.mockRejectedValue(new Error("Complete signature and Finance approval before PO."));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async url => {
      const path = decodeURIComponent(new URL(String(url)).pathname);
      if (path.includes("/Supplier Quotation/SQ-1")) return json({ data: { name: "SQ-1", docstatus: 1, supplier: "Supplier-1", items: [{ request_for_quotation: "RFQ-1" }] } });
      if (path.endsWith("/Legal Document Review")) return json({ data: [review] });
      if (path.endsWith("/Request for Quotation/RFQ-1")) return json({ data: { name: "RFQ-1", docstatus: 1 } });
      if (path.endsWith("/Purchase Order/PO-1")) return json({ data: { ...po, name: "PO-1" } });
      throw new Error("Unexpected upstream write");
    });
    const res = response();
    await handler({ ...input, query: { path: input.path }, headers: { "x-bidsphere-access-token": issueInternalAccessToken({ sub: "team@example.test", email: "team@example.test", role: "procurement_team" }) } } as unknown as VercelRequest, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringMatching(/signature and Finance/) });
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  });

  it("forwards a new RFQ PO only after the backend verifier succeeds", async () => {
    const events: string[] = [];
    ready.mockImplementation(async () => { events.push("verified"); return review; });
    clmReady.mockImplementation(async () => { events.push("clm verified"); });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const path = decodeURIComponent(new URL(String(url)).pathname);
      if (path.includes("/Supplier Quotation/SQ-1")) return json({ data: { name: "SQ-1", docstatus: 1, supplier: "Supplier-1", items: [{ request_for_quotation: "RFQ-1" }] } });
      if (path.endsWith("/Supplier Scoring Result")) return json({ data: [] });
      if (path.endsWith("/Legal Document Review")) return json({ data: [review] });
      if (path.endsWith("/Request for Quotation/RFQ-1")) return json({ data: { name: "RFQ-1", docstatus: 1 } });
      if (path.endsWith("/method/frappe.client.save") && init?.method === "POST") { events.push("forwarded"); return json({ message: { name: "PO-NEW" } }); }
      throw new Error(`Unexpected test request: ${path}`);
    });
    const res = response();
    await handler({ method: "POST", body: { doc: po }, query: { path: "method/frappe.client.save" }, headers: { "x-bidsphere-access-token": issueInternalAccessToken({ sub: "team@example.test", email: "team@example.test", role: "procurement_team" }) } } as unknown as VercelRequest, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(events).toEqual(["clm verified", "verified", "forwarded"]);
  });

  it("never forwards client-forged Contract PO links or trusted service context", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("No upstream call is allowed"); });
    const res = response();
    const clmContext = { contractId: "CON-1", rfqId: "RFQ-1", awardId: "LDR-1", quotationId: "SQ-1" };
    await handler({ method: "POST", body: { doc: { ...po, custom_clm_contract: "CON-1", custom_clm_rfq: "RFQ-1", custom_clm_award: "LDR-1", custom_clm_creation_key: "forged" }, clmContext },
      query: { path: "method/frappe.client.save", clmContext: JSON.stringify(clmContext) },
      headers: { "x-bidsphere-access-token": issueInternalAccessToken({ sub: "team@example.test", email: "team@example.test", role: "procurement_team" }) } } as unknown as VercelRequest, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining("generic PO API") });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not forward a second generic PO for an RFQ managed by a Contract", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (init?.method && init.method !== "GET") throw new Error("Duplicate Contract PO must not be forwarded");
      const path = decodeURIComponent(new URL(String(url)).pathname);
      if (path.endsWith("/Supplier Quotation/SQ-1")) return json({ data: { name: "SQ-1", supplier: "Supplier-1", items: [{ request_for_quotation: "RFQ-1" }] } });
      if (path.endsWith("/Request for Quotation/RFQ-1")) return json({ data: { name: "RFQ-1", contract_required: "Yes", custom_approval_data: JSON.stringify({ contract_decision: { decision: "Yes", contract: "CON-1", award: "LDR-1", quotation: "SQ-1" } }) } });
      throw new Error("Unexpected upstream call");
    });
    const res = response();
    await handler({ method: "POST", body: { doc: po }, query: { path: "method/frappe.client.save" }, headers: { "x-bidsphere-access-token": issueInternalAccessToken({ sub: "team@example.test", email: "team@example.test", role: "procurement_team" }) } } as unknown as VercelRequest, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining("prevent duplicates") });
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
    expect(ready).not.toHaveBeenCalled();
  });

  it("requires authentication before a GET mutation RPC, rather than skipping its RFQ gate", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const res = response();
    await handler({ method: "GET", headers: {}, query: { path: "method/frappe.client.submit", doc: JSON.stringify({ doctype: "Purchase Order", name: "PO-1" }) } } as unknown as VercelRequest, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not forward an AVOID PO even with completed existing workflow approvals and forged eligible flags", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const path = decodeURIComponent(new URL(String(url)).pathname);
      if (init?.method && init.method !== "GET") throw new Error("A blocked PO must never reach ERP");
      if (path.endsWith("/Supplier Quotation/SQ-1")) return json({ data: { name: "SQ-1", docstatus: 1, supplier: "Supplier-1", items: [{ request_for_quotation: "RFQ-1" }] } });
      if (path.endsWith("/Legal Document Review")) return json({ data: [review] });
      if (path.endsWith("/Request for Quotation/RFQ-1")) return json({ data: { name: "RFQ-1", docstatus: 1 } });
      if (path.endsWith("/Supplier Scoring Result")) return json({ data: [{ name: "SCORE-1" }] });
      if (path.endsWith("/Supplier Scoring Result/SCORE-1")) return json({ data: { name: "SCORE-1", rfq: "RFQ-1", analysis_snapshot: JSON.stringify({ analysis: { rfq_id: "RFQ-1", evaluation_run_id: "RUN-1", supplier_analysis: [{ supplier_id: "Supplier-1", quotation_id: "SQ-1", score: 91, ranking: 1, risk: "High", verdict: "AVOID", evaluation_run_id: "RUN-1" }] } }) } });
      throw new Error(`Unexpected test request: ${path}`);
    });
    const res = response();
    await handler({ method: "POST", body: { doc: { ...po, awardEligible: true, verdict: "GOOD OPTION" } }, query: { path: "method/frappe.client.save" }, headers: { "x-bidsphere-access-token": issueInternalAccessToken({ sub: "team@example.test", email: "team@example.test", role: "procurement_team" }) } } as unknown as VercelRequest, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringMatching(/marked AVOID/) });
    expect(ready).toHaveBeenCalled();
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  });

  it("rejects a new PO before forwarding when its contract decision is pending", async () => {
    clmReady.mockRejectedValue(new Error("Choose Contract / CLM Required before procurement."));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async url => {
      const path = decodeURIComponent(new URL(String(url)).pathname);
      if (path.endsWith("/Supplier Quotation/SQ-1")) return json({ data: { supplier: "Supplier-1", items: [{ request_for_quotation: "RFQ-1" }] } });
      if (path.endsWith("/Request for Quotation/RFQ-1")) return json({ data: { name: "RFQ-1", contract_required: "No" } });
      throw new Error("Unexpected upstream request");
    });
    const res = response();
    await handler({ method: "POST", body: { doc: po }, query: { path: "method/frappe.client.save" }, headers: { "x-bidsphere-access-token": issueInternalAccessToken({ sub: "team@example.test", email: "team@example.test", role: "procurement_team" }) } } as unknown as VercelRequest, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringMatching(/Contract \/ CLM Required/) });
    expect(ready).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  });

  it.each([
    { path: "resource/Purchase Order/PO-1", body: { docstatus: 1 }, role: "procurement_team" as const },
    { path: "resource/Request for Quotation/RFQ-1", body: { custom_workflow_step: "Completed" }, role: "procurement" as const },
  ])("forwards historical eligibility to the core and still blocks an unexecuted linked CLM through $path", async input => {
    clmReady.mockRejectedValue(new Error("The linked CLM is not executed."));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async url => {
      const path = decodeURIComponent(new URL(String(url)).pathname);
      if (path.endsWith("/Supplier Quotation/SQ-1")) return json({ data: { supplier: "Supplier-1", items: [{ request_for_quotation: "RFQ-1" }] } });
      if (path.endsWith("/Request for Quotation/RFQ-1")) return json({ data: { name: "RFQ-1", contract_required: "No", custom_workflow_step: "Completed" } });
      if (path.endsWith("/Purchase Order/PO-1")) return json({ data: { ...po, name: "PO-1" } });
      throw new Error("Unexpected upstream request");
    });
    const res = response();
    await handler({ method: "PUT", body: input.body, query: { path: input.path }, headers: { "x-bidsphere-access-token": issueInternalAccessToken({ sub: "buyer@example.test", email: "buyer@example.test", role: input.role }) } } as unknown as VercelRequest, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(clmReady).toHaveBeenCalledWith("RFQ-1", expect.any(Object), { allowHistoricalOrder: true });
    expect(ready).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  });

  it.each([
    { path: "resource/Request for Quotation/RFQ-1", method: "PUT", body: { contract_required: "No" } },
    { path: "method/frappe.client.set_value", method: "POST", body: { doctype: "Request for Quotation", name: "RFQ-1", fieldname: "contract_required", value: "No" } },
    { path: "method/frappe.client.save", method: "POST", body: { doc: { doctype: "Request for Quotation", name: "RFQ-1", custom_approval_data: JSON.stringify({ selected_supplier: "Supplier-1" }) } } },
  ])("does not forward RFQ decision tampering through $path", async input => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const path = decodeURIComponent(new URL(String(url)).pathname);
      if (path.endsWith("/Request for Quotation/RFQ-1") && (!init?.method || init.method === "GET")) return json({ data: { name: "RFQ-1", contract_required: "Yes", custom_selected_supplier: "Supplier-1", custom_approval_data: JSON.stringify({ contract_decision: { decision: "Yes", request: "CR-1" } }) } });
      throw new Error("Unexpected upstream write");
    });
    const res = response();
    await handler({ ...input, query: { path: input.path }, headers: { "x-bidsphere-access-token": issueInternalAccessToken({ sub: "buyer@example.test", email: "buyer@example.test", role: "procurement" }) } } as unknown as VercelRequest, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringMatching(/contract decision action/) });
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  });
});
