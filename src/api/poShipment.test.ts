import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPoShipment } from "./poShipment";
const token = (typ: string) => Buffer.from(JSON.stringify({ typ })).toString("base64url") + ".signature";
let session: Map<string, string>, local: Map<string, string>;
beforeEach(() => {
  session = new Map(); local = new Map();
  vi.stubGlobal("window", { location: { pathname: "/supplier/po/PO-1" } });
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => session.get(key) ?? null });
  vi.stubGlobal("localStorage", { getItem: (key: string) => local.get(key) ?? null });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, record: null }), { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());
describe("shipment gateway supplier principal selection", () => {
  it("uses the isolated supplier token over an active staff session", async () => {
    session.set("bidsphere-supplier-access-token", token("supplier")); session.set("bidsphere-access-token", token("internal"));
    await fetchPoShipment("PO-1");
    expect(fetch).toHaveBeenCalledWith("/api/po-shipment/get", expect.objectContaining({ headers: expect.objectContaining({ "X-Bidsphere-Access-Token": token("supplier") }) }));
  });
  it("does not borrow a staff token when the supplier session is missing", async () => {
    session.set("bidsphere-access-token", token("internal")); await fetchPoShipment("PO-1");
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).not.toHaveProperty("X-Bidsphere-Access-Token");
  });
  it("preserves staff token selection outside the supplier portal", async () => {
    window.location.pathname = "/warehouse/incoming-pos"; session.set("bidsphere-access-token", token("internal"));
    await fetchPoShipment("PO-1");
    expect(fetch).toHaveBeenCalledWith("/api/po-shipment/get", expect.objectContaining({ headers: expect.objectContaining({ "X-Bidsphere-Access-Token": token("internal") }) }));
  });
});
