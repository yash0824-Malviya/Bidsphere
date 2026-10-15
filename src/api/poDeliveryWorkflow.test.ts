import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const remote = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), notify: vi.fn(), invalidate: vi.fn() }));
vi.mock("./poShipment", async importOriginal => ({ ...await importOriginal<typeof import("./poShipment")>(), fetchPoShipment: remote.read, upsertPoShipmentRemote: remote.write }));
vi.mock("./notifications", () => ({ createNotification: remote.notify }));
vi.mock("../queryClient", () => ({ queryClient: { invalidateQueries: remote.invalidate } }));
import { acceptPO, getDeliveryState, markInTransit, rejectPO, saveDeliveryState, updateDeliveryDetails, type PODeliveryState } from "./poDeliveryWorkflow";

const base: PODeliveryState = { po_name: "PO-1", status: "Pending Acceptance", supplier_accepted: false, created_at: "2026-09-29 12:00:00", updated_at: "2026-09-29 12:00:00" };
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  vi.clearAllMocks();
  remote.read.mockResolvedValue({ name: "SHIP-1", po_name: "PO-1", shipment_status: "Pending Acceptance", supplier_accepted: 0 });
  remote.write.mockRejectedValue(new Error("Accept the linked Contract and complete the Supplier E-Signature first."));
  remote.invalidate.mockResolvedValue(undefined);
  saveDeliveryState(base);
});
afterEach(() => vi.unstubAllGlobals());

describe("PO delivery updates are cached only after persisted success", () => {
  it("keeps Pending Acceptance and sends no notifications when the backend CLM gate rejects", async () => {
    await expect(acceptPO("PO-1", { expected_delivery_date: "2026-10-15" }, "Supplier")).rejects.toThrow("Supplier E-Signature");
    expect(getDeliveryState("PO-1")).toMatchObject({ status: "Pending Acceptance", supplier_accepted: false });
    expect(remote.notify).not.toHaveBeenCalled(); expect(remote.invalidate).not.toHaveBeenCalled();
  });
  it("uses the persisted server actor/date after successful acceptance", async () => {
    remote.write.mockResolvedValue({ name: "SHIP-1", po_name: "PO-1", shipment_status: "Accepted", supplier_accepted: 1, supplier_acceptance_date: "2026-09-29 13:00:00", updated_by: "supplier@example.test", expected_delivery_date: "2026-10-15" });
    const result = await acceptPO("PO-1", { expected_delivery_date: "2026-10-15" }, "Display name");
    expect(result).toMatchObject({ status: "Accepted", supplier_acceptance_date: "2026-09-29 13:00:00", updated_by: "supplier@example.test" });
    expect(getDeliveryState("PO-1")).toEqual(result); expect(remote.notify).toHaveBeenCalledTimes(2);
  });
  it("does not advance the cached shipment to In Transit when persistence fails", async () => {
    saveDeliveryState({ ...base, status: "Accepted", supplier_accepted: true });
    await expect(markInTransit("PO-1", "Supplier")).rejects.toThrow();
    expect(getDeliveryState("PO-1")?.status).toBe("Accepted"); expect(remote.notify).not.toHaveBeenCalled();
  });
  it("does not cache rejected or edited delivery data on failed saves", async () => {
    await expect(rejectPO("PO-1", { rejection_reason: "Cannot deliver" })).rejects.toThrow();
    expect(getDeliveryState("PO-1")?.status).toBe("Pending Acceptance");
    saveDeliveryState({ ...base, status: "Accepted", supplier_accepted: true, tracking_number: "OLD" });
    await expect(updateDeliveryDetails("PO-1", { tracking_number: "NEW" })).rejects.toThrow();
    expect(getDeliveryState("PO-1")?.tracking_number).toBe("OLD");
  });
  it("rejects a mismatched success response without local acceptance", async () => {
    remote.write.mockResolvedValue({ po_name: "PO-OTHER", shipment_status: "Accepted", supplier_accepted: 1 });
    await expect(acceptPO("PO-1", { expected_delivery_date: "2026-10-15" })).rejects.toThrow("could not be confirmed");
    expect(getDeliveryState("PO-1")?.status).toBe("Pending Acceptance"); expect(remote.notify).not.toHaveBeenCalled();
  });
  it("allows an explicit backend-gated reconfirmation for a stale pre-signature PO acceptance", async () => {
    remote.read.mockResolvedValue({ name: "SHIP-1", po_name: "PO-1", shipment_status: "Accepted", supplier_accepted: 1, supplier_acceptance_date: "2026-09-28 10:00:00" });
    await expect(acceptPO("PO-1", { expected_delivery_date: "2026-10-15" })).rejects.toThrow("Cannot accept");
    remote.write.mockResolvedValue({ name: "SHIP-1", po_name: "PO-1", shipment_status: "Accepted", supplier_accepted: 1, supplier_acceptance_date: "2026-09-29 13:00:00", updated_by: "SUP-1" });
    const result = await acceptPO("PO-1", { expected_delivery_date: "2026-10-15" }, "Supplier", { reconfirmContractAcceptance: true });
    expect(result.supplier_acceptance_date).toBe("2026-09-29 13:00:00");
  });
});
