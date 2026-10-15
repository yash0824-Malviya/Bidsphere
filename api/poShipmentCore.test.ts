import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PoShipmentRecord } from "./poShipmentCore";

const supplierId = '"Atlantic Precision Manufacturing."';
const environment = { ...process.env };
let core: typeof import("./poShipmentCore");
beforeEach(async () => {
  vi.resetModules();
  process.env.ERPNEXT_URL = "https://erp.test"; process.env.ERP_API_KEY = "test-key"; process.env.ERP_API_SECRET = "test-secret";
  core = await import("./poShipmentCore");
});
afterEach(() => { vi.restoreAllMocks(); process.env = { ...environment }; });
function fixture() {
  const rows: PoShipmentRecord[] = [], writes: Array<{ method: string; path: string; body: Record<string, unknown> }> = [], supplierReads: string[] = [];
  const config = { poSupplier: supplierId, supplierName: supplierId, lookupFails: false, writeFails: false };
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(status === 200 ? { data } : data), { status, headers: { "Content-Type": "application/json" } });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const target = new URL(String(url)), path = decodeURIComponent(target.pathname), method = init?.method || "GET";
    if (method === "GET" && path === "/api/resource/DocType/PO Shipment") return json({ name: "PO Shipment", fields: [
      { fieldname: "supplier_status" }, { fieldname: "ready_for_grn" }, { fieldname: "warehouse_visible" },
      { fieldname: "shipment_status", options: Object.values(core.SHIPMENT_STATUS).join("\n") },
    ] });
    if (method === "GET" && path === "/api/resource/Purchase Order/PO-1") return json({ name: "PO-1", supplier: config.poSupplier });
    if (method === "GET" && path.startsWith("/api/resource/Supplier/")) {
      supplierReads.push(path.slice("/api/resource/Supplier/".length));
      return config.lookupFails ? json({ exception: "Supplier lookup unavailable" }, 503) : json({ name: config.supplierName });
    }
    if (method === "GET" && path === "/api/resource/PO Shipment") {
      expect(target.searchParams.get("limit_page_length")).toBe("2");
      return json(structuredClone(rows));
    }
    if (["POST", "PUT"].includes(method) && path.startsWith("/api/resource/PO Shipment")) {
      const body = JSON.parse(String(init?.body || "{}")); writes.push({ method, path, body });
      if (config.writeFails) return json({ exception: "Could not find Supplier: saved supplier" }, 417);
      const saved = { ...rows[0], ...body, name: rows[0]?.name || "SHIP-1" } as PoShipmentRecord;
      rows.splice(0, rows.length, saved); return json(saved);
    }
    throw new Error(`Unexpected ERP request: ${method} ${path}`);
  });
  const input = { po_name: "PO-1", shipment_status: "Accepted" as const, supplier_accepted: true, supplier_acceptance_date: "2026-09-29 13:16:52", updated_by: "Atlantic Precision Manufacturing.", supplier: "Untrusted display hint" };
  return { rows, writes, supplierReads, config, save: () => core.upsertPoShipment(input) };
}

describe("PO Shipment exact Supplier Link persistence", () => {
  it("preserves literal quotes in the canonical Supplier ID, verifies the exact Supplier record, and reuses the same Shipment", async () => {
    const f = fixture();
    expect((await f.save()).supplier).toBe(supplierId);
    expect((await core.getPoShipment("PO-1"))?.supplier).toBe(supplierId);
    expect((await f.save()).name).toBe("SHIP-1");
    expect(f.supplierReads).toEqual([supplierId, supplierId]);
    expect(f.writes.map(row => row.method)).toEqual(["POST", "PUT"]);
    expect(f.writes[1].path).toBe("/api/resource/PO Shipment/SHIP-1");
    expect(f.writes.every(row => row.body.supplier === supplierId)).toBe(true);
    expect(f.rows).toHaveLength(1);
  });
  it("continues to preserve ordinary Supplier IDs unchanged", async () => {
    const f = fixture(); f.config.poSupplier = "SUP-1"; f.config.supplierName = "SUP-1";
    expect((await f.save()).supplier).toBe("SUP-1"); expect(f.writes[0].body.supplier).toBe("SUP-1");
  });
  it("never retries an ERP Link validation error by removing Supplier", async () => {
    const f = fixture(); f.config.writeFails = true;
    await expect(f.save()).rejects.toMatchObject({ status: 417, message: expect.stringContaining("Could not find Supplier") });
    expect(f.writes).toHaveLength(1); expect(f.writes[0].body.supplier).toBe(supplierId); expect(f.rows).toHaveLength(0);
  });
  it("does not fall back to a supplied hint when the exact ERP Supplier cannot be verified", async () => {
    const f = fixture(); f.config.lookupFails = true;
    await expect(f.save()).rejects.toMatchObject({ status: 503 }); expect(f.writes).toHaveLength(0);
  });
  it("rejects a normalized display-name result instead of persisting a different Supplier Link", async () => {
    const f = fixture(); f.config.supplierName = "Atlantic Precision Manufacturing.";
    await expect(f.save()).rejects.toMatchObject({ status: 409 }); expect(f.writes).toHaveLength(0);
  });
  it("does not create a shipment without the PO's persisted Supplier", async () => {
    const f = fixture(); f.config.poSupplier = "";
    await expect(f.save()).rejects.toMatchObject({ status: 409 }); expect(f.supplierReads).toHaveLength(0); expect(f.writes).toHaveLength(0);
  });
  it("refuses duplicate Shipment rows instead of arbitrarily updating the first one", async () => {
    const f = fixture(); f.rows.push(...["SHIP-1", "SHIP-2"].map(name => ({ name, po_name: "PO-1", supplier: supplierId, shipment_status: "Accepted" as const, supplier_accepted: 1 as const })));
    await expect(core.getPoShipment("PO-1")).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Multiple shipment records") });
    await expect(f.save()).rejects.toMatchObject({ status: 409 }); expect(f.writes).toHaveLength(0);
  });
});
