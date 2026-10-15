import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("./erpnext", () => ({ apiGet: mocks.get, apiPost: mocks.post, withoutNetworkRetry: () => ({ _disableNetworkRetry: true }) }));
vi.mock("../utils/accessToken", () => ({ readErpProxyAccessToken: () => "test-token", readSupplierAccessToken: () => null }));
import { getClmPurchaseOrderContext, saveClmPurchaseOrder } from "./clm";

beforeEach(() => vi.clearAllMocks());
const context = { contract: "CON-1", expected_modified: "revision-1", rfq: "RFQ-1", award: "AWARD-1", quotation: "SQ-1", payload: { items: [] } };
const input = { name: "CON-1", expected_modified: "revision-1", operation: "submit" as const, payload: { supplier: "SUP-1" } };
describe("Contract PO transaction client", () => {
  it("gets server-authorized persisted source context without mutations", async () => {
    mocks.get.mockResolvedValue({ data: context });
    expect(await getClmPurchaseOrderContext("CON-1")).toEqual(context);
    expect(mocks.get).toHaveBeenCalledWith("/api/clm", { params: { view: "purchase_order", name: "CON-1" } });
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it.each([{ ...context, contract: "OTHER" }, { ...context, award: "" }, { ...context, quotation: "" }, { ...context, expected_modified: "" }])("rejects incomplete or wrong Contract prefill", async data => {
    mocks.get.mockResolvedValue({ data });
    await expect(getClmPurchaseOrderContext("CON-1")).rejects.toThrow("saved Contract and award");
  });
  it("uses the versioned backend transaction without automatic network retries", async () => {
    const result = { contract: "CON-1", purchase_order: { name: "PO-1", docstatus: 1 }, completed: true, reused: false };
    mocks.post.mockResolvedValue({ data: result });
    expect(await saveClmPurchaseOrder(input)).toEqual(result);
    expect(mocks.post).toHaveBeenCalledWith("/api/clm?view=purchase_order", input, { _disableNetworkRetry: true, _preserveResponse: true });
  });
  it("accepts a saved Draft without claiming Contract completion", async () => {
    const result = { contract: "CON-1", purchase_order: { name: "PO-1", docstatus: 0 }, completed: false, reused: true };
    mocks.post.mockResolvedValue({ data: result });
    expect(await saveClmPurchaseOrder({ ...input, operation: "save_draft" })).toEqual(result);
  });
  it("does not accept a Draft that claims Contract completion", async () => {
    mocks.post.mockResolvedValue({ data: { contract: "CON-1", purchase_order: { name: "PO-1", docstatus: 0 }, completed: true, reused: false } });
    await expect(saveClmPurchaseOrder({ ...input, operation: "save_draft" })).rejects.toThrow("did not confirm");
  });
  it.each([
    { contract: "OTHER", purchase_order: { name: "PO-1", docstatus: 1 }, completed: true },
    { contract: "CON-1", purchase_order: { name: "PO-1", docstatus: 0 }, completed: true },
    { contract: "CON-1", purchase_order: { name: "PO-1", docstatus: 1 }, completed: false },
    { contract: "CON-1", purchase_order: {}, completed: true },
  ])("rejects partial success instead of showing completed", async data => {
    mocks.post.mockResolvedValue({ data });
    await expect(saveClmPurchaseOrder(input)).rejects.toThrow("did not confirm");
  });
  it("preserves actionable backend errors even when an unsuccessful envelope includes a PO", async () => {
    mocks.post.mockResolvedValue({ success: false, message: "ERPNext rejected PO submission; draft PO-1 remains pending.", data: { contract: "CON-1", purchase_order: { name: "PO-1" } } });
    await expect(saveClmPurchaseOrder(input)).rejects.toThrow("ERPNext rejected PO submission");
  });
  it("requires the Contract revision before writing", async () => {
    await expect(saveClmPurchaseOrder({ ...input, expected_modified: "" })).rejects.toThrow("Refresh");
    expect(mocks.post).not.toHaveBeenCalled();
  });
});
