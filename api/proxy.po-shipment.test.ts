import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import handler from "./proxy";
import { issueInternalAccessToken, issueSupplierAccessToken } from "./rbacAuth";
const env = { ...process.env };
beforeEach(() => { process.env.BIDSPHERE_SESSION_SECRET = "shipment-proxy-tests"; process.env.ERPNEXT_URL = "https://erp.test"; process.env.ERP_API_KEY = "test-key"; process.env.ERP_API_SECRET = "test-secret"; });
afterEach(() => { vi.restoreAllMocks(); process.env = { ...env }; });
function response() { const res = { status: vi.fn(), json: vi.fn(), send: vi.fn(), end: vi.fn(), setHeader: vi.fn() }; res.status.mockReturnValue(res); return res; }
describe("generic ERP gateway cannot bypass supplier shipment authorization", () => {
  it.each([
    { path: "resource/PO Shipment", method: "POST", body: { po_name: "PO-1", shipment_status: "Accepted" }, query: {} },
    { path: "resource/PO Shipment/SHIP-1", method: "PUT", body: { supplier_accepted: 1 }, query: {} },
    { path: "method/frappe.client.save", method: "POST", body: { doc: { doctype: "PO Shipment", name: "SHIP-1", supplier_accepted: 1 } }, query: {} },
    { path: "method/frappe.client.set_value", method: "GET", body: {}, query: { doctype: "PO Shipment", name: "SHIP-1", fieldname: "supplier_accepted", value: "1" } },
  ])("blocks $method $path even for an administrator", async input => {
    const upstream = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No upstream request allowed")); const res = response();
    await handler({ method: input.method, query: { path: input.path, ...input.query }, body: input.body, headers: { "x-bidsphere-access-token": issueInternalAccessToken({ sub: "admin@example.test", email: "admin@example.test", role: "admin" }) } } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res.status).toHaveBeenCalledWith(403); expect(upstream).not.toHaveBeenCalled();
  });
  it.each(["resource/PO Shipment", "method/frappe.client.get_list"])("requires supplier-scoped reads for %s", async path => {
    const upstream = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No upstream request allowed")); const res = response();
    await handler({ method: "GET", query: { path, doctype: "PO Shipment" }, headers: { "x-bidsphere-access-token": issueSupplierAccessToken({ supplier: "SUP-1" }) } } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res.status).toHaveBeenCalledWith(403); expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining("supplier-scoped") }); expect(upstream).not.toHaveBeenCalled();
  });
  it("retains warehouse shipment reads", async () => {
    const upstream = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "Content-Type": "application/json" } })); const res = response();
    await handler({ method: "GET", query: { path: "resource/PO Shipment" }, headers: { "x-bidsphere-access-token": issueInternalAccessToken({ sub: "warehouse@example.test", email: "warehouse@example.test", role: "warehouse" }) } } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res.status).toHaveBeenCalledWith(200); expect(upstream).toHaveBeenCalledOnce();
  });
});
