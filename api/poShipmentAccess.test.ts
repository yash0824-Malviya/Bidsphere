import { describe, expect, it, vi } from "vitest";
import { handlePoShipmentAction, type PoShipmentAccessDeps } from "./poShipmentAccess";
import { ClmError } from "./clmCore";
import type { AccessPrincipal } from "./rbacAuth";
import type { PoShipmentRecord } from "./poShipmentCore";

const supplier: AccessPrincipal = { typ: "supplier", sub: "supplier@example.test", supplier: "SUP-1", iat: 1, exp: 9999999999999 };
const warehouse: AccessPrincipal = { typ: "internal", role: "warehouse", sub: "warehouse@example.test", email: "warehouse@example.test", iat: 1, exp: 9999999999999 };
const now = "2026-09-29 13:00:00";
function fixture(linked = true) {
  let stored: PoShipmentRecord | null = null;
  const order = { name: "PO-1", supplier: "SUP-1", docstatus: 1, status: "To Receive and Bill", ...(linked ? { custom_clm_contract: "CON-1" } : {}) };
  const events: string[] = [];
  const deps: PoShipmentAccessDeps = {
    loadOrder: vi.fn(async () => order), assertClmReady: vi.fn(async () => { events.push("verified contract"); }),
    get: vi.fn(async () => { events.push("read shipment"); return structuredClone(stored); }),
    list: vi.fn(async () => stored ? [stored] : []), listReady: vi.fn(async () => []), now: () => now,
    upsert: vi.fn(async input => { events.push("write shipment"); stored = { ...input, name: "SHIP-1", supplier_accepted: input.supplier_accepted ? 1 : 0 }; return structuredClone(stored); }),
  };
  const body = { po_name: "PO-1", shipment_status: "Accepted", supplier_accepted: true, updated_by: "forged actor", supplier_acceptance_date: "2000-01-01 00:00:00" };
  return { order, deps, body, events, set: (value: PoShipmentRecord | null) => { stored = value; }, run: (principal = supplier, patch = {}) => handlePoShipmentAction(principal, "upsert", { ...body, ...patch }, deps) };
}

describe("authenticated Purchase Order shipment persistence", () => {
  it.each(["Accepted", "In Transit", "Delivered", "Arrived", "Partially Received", "Completed"])("blocks %s before any shipment/schema write when Contract acceptance/signature is absent", async status => {
    const f = fixture(); vi.mocked(f.deps.assertClmReady).mockRejectedValue(new ClmError("Accept and sign the current Contract first.", 409));
    await expect(f.run(supplier, { shipment_status: status })).rejects.toMatchObject({ status: 409 });
    expect(f.deps.upsert).not.toHaveBeenCalled(); expect(f.deps.get).not.toHaveBeenCalled();
  });
  it.each(["Pending Acceptance", "Rejected"])("rejects a contradictory supplier_accepted flag on a %s row", async status => {
    const f = fixture(); vi.mocked(f.deps.assertClmReady).mockRejectedValue(new ClmError("Missing Contract signature.", 409));
    await expect(f.run(supplier, { shipment_status: status, supplier_accepted: 1 })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("cannot be marked") });
    expect(f.deps.upsert).not.toHaveBeenCalled();
  });
  it("does not create or read another supplier's shipment", async () => {
    const f = fixture(), foreign = { ...supplier, supplier: "OTHER" };
    await expect(f.run(foreign)).rejects.toMatchObject({ status: 403 });
    await expect(handlePoShipmentAction(foreign, "get", { po_name: "PO-1" }, f.deps)).rejects.toMatchObject({ status: 403 });
    expect(f.deps.get).not.toHaveBeenCalled(); expect(f.deps.assertClmReady).not.toHaveBeenCalled(); expect(f.deps.upsert).not.toHaveBeenCalled();
  });
  it("persists only after verification and returns independently re-fetched fields with server attribution", async () => {
    const f = fixture();
    expect(await f.run()).toMatchObject({ success: true, record: { shipment_status: "Accepted", supplier_accepted: 1, supplier_acceptance_date: now, updated_by: supplier.sub } });
    expect(f.events).toEqual(["verified contract", "read shipment", "write shipment", "read shipment"]);
    expect(f.deps.upsert).toHaveBeenCalledWith(expect.objectContaining({ supplier: "SUP-1", updated_by: supplier.sub, supplier_acceptance_date: now }));
  });
  it("refuses projected write success when ERP still contains Pending Acceptance", async () => {
    const f = fixture(); f.set({ name: "SHIP-1", po_name: "PO-1", shipment_status: "Pending Acceptance", supplier_accepted: 0 });
    vi.mocked(f.deps.upsert).mockResolvedValue({ name: "SHIP-1", po_name: "PO-1", shipment_status: "Accepted", supplier_accepted: 1 });
    await expect(f.run()).rejects.toMatchObject({ status: 409, message: expect.stringContaining("did not confirm") });
  });
  it.each([null, "", "OTHER", "Atlantic Precision Manufacturing."])("rejects a readback whose Supplier Link is %j instead of the exact PO identity", async storedSupplier => {
    const f = fixture(); f.order.supplier = '"Atlantic Precision Manufacturing."';
    vi.mocked(f.deps.upsert).mockImplementation(async input => {
      const saved = { ...input, name: "SHIP-1", supplier: storedSupplier, supplier_accepted: 1 } as unknown as PoShipmentRecord;
      f.set(saved); return { ...saved, supplier: input.supplier };
    });
    await expect(f.run({ ...supplier, supplier: "Atlantic Precision Manufacturing." })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("did not confirm") });
  });
  it("requires exact canonical Supplier Link persistence even when the portal identity uses a display-normalized form", async () => {
    const f = fixture(); f.order.supplier = '"Atlantic Precision Manufacturing."';
    expect(await f.run({ ...supplier, supplier: "Atlantic Precision Manufacturing." })).toMatchObject({ record: { supplier: '"Atlantic Precision Manufacturing."' } });
  });
  it("propagates ERP write failure without reporting success", async () => {
    const f = fixture(); vi.mocked(f.deps.upsert).mockRejectedValue(new ClmError("ERP write unavailable", 503));
    await expect(f.run()).rejects.toMatchObject({ status: 503 });
  });
  it("never allows a staff member to supply the first CLM PO acceptance", async () => {
    const f = fixture(); await expect(f.run(warehouse)).rejects.toMatchObject({ status: 403 });
    expect(f.deps.upsert).not.toHaveBeenCalled();
  });
  it("preserves warehouse updates once the supplier's acceptance exists", async () => {
    const f = fixture(); f.set({ name: "SHIP-1", po_name: "PO-1", shipment_status: "In Transit", supplier_accepted: 1, supplier_acceptance_date: "2026-09-29 12:00:00" });
    expect(await f.run(warehouse, { shipment_status: "Partially Received" })).toMatchObject({ record: { shipment_status: "Partially Received", supplier_acceptance_date: "2026-09-29 12:00:00", updated_by: warehouse.email } });
  });
  it("requires a fresh supplier acceptance if the existing receipt predates the current Contract signature", async () => {
    const f = fixture(); f.set({ name: "SHIP-1", po_name: "PO-1", shipment_status: "Accepted", supplier_accepted: 1, supplier_acceptance_date: "2026-09-28 12:00:00" });
    vi.mocked(f.deps.assertClmReady).mockResolvedValue({ supplierSignedAt: "2026-09-29 12:00:00" });
    await expect(f.run(warehouse, { shipment_status: "In Transit" })).rejects.toMatchObject({ status: 403 });
    await expect(f.run(supplier, { shipment_status: "In Transit" })).rejects.toMatchObject({ status: 403 });
    expect(f.deps.upsert).not.toHaveBeenCalled();
    expect(await f.run()).toMatchObject({ record: { supplier_acceptance_date: now, updated_by: supplier.sub } });
    expect(await f.run(supplier, { shipment_status: "In Transit" })).toMatchObject({ record: { shipment_status: "In Transit", supplier_acceptance_date: now } });
  });
  it.each([
    { shipment_status: "Accepted", supplier_accepted: "0", supplier_acceptance_date: now },
    { shipment_status: "Rejected", supplier_accepted: 1, supplier_acceptance_date: now },
    { shipment_status: "Pending Acceptance", supplier_accepted: 1, supplier_acceptance_date: now },
    { shipment_status: "Accepted", supplier_accepted: 1, supplier_acceptance_date: "invalid" },
  ])("does not treat an inconsistent saved receipt as prior supplier acceptance: $shipment_status/$supplier_accepted/$supplier_acceptance_date", async fields => {
    const f = fixture(); f.set({ name: "SHIP-1", po_name: "PO-1", ...fields } as unknown as PoShipmentRecord);
    await expect(f.run(warehouse, { shipment_status: "In Transit" })).rejects.toMatchObject({ status: 403 });
    expect(f.deps.upsert).not.toHaveBeenCalled();
  });
  it.each(["In Transit", "Delivered", "Arrived", "Partially Received", "Completed"] as const)("does not roll %s back to Accepted on a stale retry", async shipment_status => {
    const f = fixture(); f.set({ name: "SHIP-1", po_name: "PO-1", shipment_status, supplier_accepted: 1, supplier_acceptance_date: now });
    await expect(f.run()).rejects.toMatchObject({ status: 409, message: expect.stringContaining("saved shipment progress has not been changed") });
    expect(f.deps.upsert).not.toHaveBeenCalled();
  });
  it.each(["Pending Acceptance", "Rejected"])("does not reset a valid CLM PO acceptance to %s", async shipment_status => {
    const f = fixture(); f.set({ name: "SHIP-1", po_name: "PO-1", shipment_status: "Accepted", supplier_accepted: 1, supplier_acceptance_date: now });
    await expect(f.run(supplier, { shipment_status, supplier_accepted: false })).rejects.toMatchObject({ status: 409 });
    expect(f.deps.upsert).not.toHaveBeenCalled();
  });
  it("keeps the existing ordinary PO flow without requiring CLM metadata", async () => {
    const f = fixture(false); expect(await f.run()).toMatchObject({ success: true, record: { shipment_status: "Accepted" } });
  });
  it("preserves rejection without requiring a supplier signature", async () => {
    const f = fixture(); expect(await f.run(supplier, { shipment_status: "Rejected", supplier_accepted: false, rejection_reason: "Cannot deliver" })).toMatchObject({ record: { shipment_status: "Rejected", supplier_accepted: 0, rejected_date: now } });
    expect(f.deps.assertClmReady).not.toHaveBeenCalled();
  });
  it("filters supplier lists by actual PO ownership rather than Shipment supplier hints", async () => {
    const f = fixture(); vi.mocked(f.deps.list).mockResolvedValue([
      { name: "SHIP-1", po_name: "PO-1", supplier: "WRONG", shipment_status: "Accepted", supplier_accepted: 1 },
      { name: "SHIP-2", po_name: "PO-2", supplier: "SUP-1", shipment_status: "Accepted", supplier_accepted: 1 },
    ]);
    vi.mocked(f.deps.loadOrder).mockImplementation(async name => ({ ...f.order, name, supplier: name === "PO-1" ? "SUP-1" : "OTHER" }));
    const result = await handlePoShipmentAction(supplier, "list", {}, f.deps);
    expect(result.records?.map(row => row.po_name)).toEqual(["PO-1"]);
  });
  it("rejects guessed cross-supplier filters before listing", async () => {
    const f = fixture(); await expect(handlePoShipmentAction({ ...supplier, supplier: "OTHER" }, "list", { po_names: ["PO-1"] }, f.deps)).rejects.toMatchObject({ status: 403 });
    expect(f.deps.list).not.toHaveBeenCalled();
  });
  it("keeps existing staff roles and rejects unrelated role writes", async () => {
    const f = fixture(); await expect(f.run({ ...warehouse, role: "legal" })).rejects.toMatchObject({ status: 403 });
    expect(f.deps.loadOrder).not.toHaveBeenCalled();
  });
});
