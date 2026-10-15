import { afterEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ persist: vi.fn() }));
vi.mock("./rfqClmRest", () => ({ persistRfqClmDecision: mock.persist }));
import { commitRfqClmDecision } from "./rfqClmErp";
import { clmErpRequest, createClmDependencies } from "./clmErp";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); mock.persist.mockReset(); });
function setup(response: Response) {
  vi.stubEnv("ERPNEXT_URL", "https://erp.test"); vi.stubEnv("ERP_API_KEY", "fixture-key"); vi.stubEnv("ERP_API_SECRET", "fixture-secret");
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
}
describe("RFQ CLM standard ERPNext transport", () => {
  it("routes Request and separate Contract operations to persistent REST without probing an extension", async () => {
    const fetch = setup(new Response("{}"));
    const input = { rfq: "RFQ-1", expected_modified: "2026-09-23 12:00:00.123456", decision: "Yes" as const, actor: { id: "buyer@test.example", role: "procurement_team" }, award: { quotation: "SQ-1", quotation_modified: "2026-09-23 11:59:00.987654" } };
    mock.persist.mockResolvedValue({ created: true, request: { name: "REQ-1" } });
    await expect(commitRfqClmDecision(input)).resolves.toMatchObject({ created: true, request: { name: "REQ-1" } });
    expect(mock.persist).toHaveBeenCalledWith(input, expect.objectContaining({ create: expect.any(Function), save: expect.any(Function), fields: expect.any(Function) }));
    await commitRfqClmDecision({ ...input, create_contract: true });
    expect(mock.persist.mock.calls[1][0].create_contract).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("inserts into the standard Contract resource with the Request/RFQ links", async () => {
    const record = { name: "CON-1", custom_rfq: "RFQ-1", custom_contract_request: "REQ-1" };
    const fetch = setup(new Response(JSON.stringify({ data: record })));
    expect(await createClmDependencies().create("Contract", record)).toMatchObject(record);
    expect(fetch.mock.calls[0][0]).toBe("https://erp.test/api/resource/Contract");
  });
  it("uses frappe.client.save and keeps microsecond modified revisions", async () => {
    const record = { name: "REQ-1", modified: "2026-09-23 12:00:00.123456", requester: "buyer@test.example", request_date: "2026-09-23", department: "Procurement", company: "Netlink", contract_type: "Supply / Procurement Contract", contract_purpose: "Supply parts", description: "Supply the required parts", supplier: "SUP-1", contract_start_date: "2026-09-23", contract_end_date: "2026-11-23", contract_value: 2500, currency: "USD", estimated_contract_value: 2500, custom_clm_data: '{"source":"RFQ-1"}' };
    const fetch = setup(new Response(JSON.stringify({ message: record })));
    await createClmDependencies().save("Contract Request", record);
    expect(fetch.mock.calls[0][0]).toBe("https://erp.test/api/method/frappe.client.save");
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).doc.modified).toBe(record.modified);
  });
  it.each([[409, "The RFQ changed. Refresh before retrying."], [417, "Contract End Date must follow Contract Start Date."], [403, "The service account cannot create this Contract."], [404, "Document not found."]])("preserves real ERP validation (%s)", async (status, message) => {
    setup(new Response(JSON.stringify({ message }), { status: Number(status) }));
    await expect(clmErpRequest("POST", "resource/Contract Request", {})).rejects.toMatchObject({ status, message });
  });
  it("filters exception diagnostics without inventing an installation requirement", async () => {
    setup(new Response(JSON.stringify({ exception: "Traceback internal password=secret" }), { status: 417 }));
    await expect(clmErpRequest("POST", "resource/Contract Request", {})).rejects.toMatchObject({ status: 417, message: expect.stringContaining("Check the required fields") });
  });
  it("reports connection loss without pretending the write rolled back", async () => {
    const fetch = setup(new Response("{}")); fetch.mockRejectedValue(new Error("fetch failed Authorization: token fixture-key:fixture-secret"));
    await expect(clmErpRequest("POST", "resource/Contract Request", {})).rejects.toMatchObject({ status: 503, message: expect.stringContaining("refresh") });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("reports uncertain timeout without automatic insert retry", async () => {
    const fetch = setup(new Response("{}")); fetch.mockRejectedValue(new DOMException("timeout", "TimeoutError"));
    await expect(clmErpRequest("POST", "resource/Contract Request", {})).rejects.toMatchObject({ status: 504, message: expect.stringContaining("check whether the action was saved") });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it.each(["<html>login</html>", "null", "[]"])("rejects invalid successful HTTP content: %s", response => {
    setup(new Response(response));
    return expect(clmErpRequest("POST", "resource/Contract Request", {})).rejects.toMatchObject({ status: 502 });
  });
});
