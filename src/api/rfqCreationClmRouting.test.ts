import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), invite: vi.fn(), markMr: vi.fn() }));
vi.mock("./erpnext", () => ({ apiGet: mocks.get, apiPost: mocks.post, apiPut: mocks.put, COMPANY: "Netlink", erpnext: {}, getExactCount: vi.fn(), withSilent: (input: unknown) => input, buildResourceUrl: (type: string, name?: string) => `/api/resource/${type}${name ? `/${name}` : ""}`, buildListConfig: (input: unknown) => input }));
vi.mock("./supplier", () => ({ assertSuppliersActive: vi.fn() }));
vi.mock("./rfqSupplierInviteAudit", () => ({ appendRfqInviteAudit: mocks.invite }));
vi.mock("./materialRequestWorkflow", () => ({
  extractSourceDepartmentMrName: () => "", getLinkedRfqName: () => "", getMaterialRequestWorkflowStatus: () => "Forwarded to Procurement", parseForwardedItemsFromMr: () => [], markMaterialRequestRfqCreated: mocks.markMr,
  fetchMaterialRequestWorkflow: async () => ({ name: "MR-95", company: "Netlink", custom_department: "Production - N", items: [{ name: "MR-ITEM-1", item_code: "DIR-STE-020", item_name: "Cold Rolled Steel 10", qty: 20, uom: "Kg" }] }),
}));
vi.mock("./mrRfqAction", () => ({ findActiveRfqForMaterialRequest: async () => null }));
vi.mock("../utils/materialRequestItemFiles", () => ({ engineeringCustomFieldsForErp: () => ({}), hydrateEngineeringDocsFromChild: async () => ({ attachments: [] }) }));
import { createRFQ } from "./sourcing";
import { createRFQFromMaterialRequest } from "./createRFQFromMaterialRequest";

const input = { contract_required: "No" as const, company: "Netlink", items: [{ item_code: "DIR-STE-020", item_name: "Cold Rolled Steel 10", qty: 20, uom: "Kg" }], suppliers: [{ supplier: "SUP-1" }] };
const saved = { name: "RFQ-95", ...input, transaction_date: "2026-09-24" };
const partialError = { response: { data: { code: "RFQ_CLM_REQUEST_NOT_ROUTED", saved_rfq: saved, message: "RFQ RFQ-95 was saved, but its Contract Request could not be routed. Permission denied." } } };

describe("RFQ creation safely handles older gateway partial errors without recreating RFQs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockImplementation(async (url: string) => {
      if (url.includes("Warehouse")) return [{ name: "Stores - N" }];
      if (url.includes("Server Script")) return [];
      if (url === "/api/resource/Item") return [{ name: "DIR-STE-020", item_code: "DIR-STE-020", item_group: "Steel", stock_uom: "Kg" }];
      if (url === "/api/resource/Request for Quotation/RFQ-95") return saved;
      throw new Error(`Unexpected read ${url}`);
    });
    mocks.post.mockRejectedValue(partialError);
  });

  it("keeps the saved direct RFQ, emits an error notice and preserves its supplier invite audit", async () => {
    const result = await createRFQ(input);
    expect(result).toMatchObject({ name: "RFQ-95", contractRequirementWarning: partialError.response.data.message });
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.invite).toHaveBeenCalledWith("RFQ-95", expect.arrayContaining([expect.objectContaining({ supplier: "SUP-1" })]));
  });

  it("keeps the saved MR RFQ and persists its original Material Request link without creating another RFQ", async () => {
    const result = await createRFQFromMaterialRequest({ contract_required: "No", material_request: "MR-95", suppliers: input.suppliers, procurement_remarks: "Keep these source notes" });
    expect(result).toMatchObject({ name: "RFQ-95", contractRequirementWarning: partialError.response.data.message });
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.markMr).toHaveBeenCalledExactlyOnceWith("MR-95", "RFQ-95", "Keep these source notes");
    const payload = mocks.post.mock.calls[0][1].doc;
    expect(payload.items[0]).toMatchObject({ material_request: "MR-95", material_request_item: "MR-ITEM-1", item_code: "DIR-STE-020", qty: 20, uom: "Kg" });
  });

  it("does not create invite or MR followups when ERPNext did not save the RFQ", async () => {
    mocks.post.mockRejectedValue(new Error("RFQ save denied"));
    await expect(createRFQ(input)).rejects.toThrow("RFQ save denied");
    await expect(createRFQFromMaterialRequest({ material_request: "MR-95", suppliers: input.suppliers })).rejects.toThrow("RFQ save denied");
    expect(mocks.invite).not.toHaveBeenCalled(); expect(mocks.markMr).not.toHaveBeenCalled();
  });

  it("includes optional direct RFQ line pricing in the initial ERP insert", async () => {
    await createRFQ({ ...input, custom_show_target_price_to_supplier: 1, items: [{ ...input.items[0], custom_target_price: 12.5, custom_show_target_price_to_supplier: 1 }] });
    expect(mocks.post.mock.calls[0][1].doc).toMatchObject({ custom_show_target_price_to_supplier: 1, items: [expect.objectContaining({ custom_target_price: 12.5, custom_show_target_price_to_supplier: 1, qty: 20, uom: "Kg" })] });
  });

  it("includes MR-derived RFQ line pricing in the initial insert before the CLM follow-up", async () => {
    await createRFQFromMaterialRequest({ contract_required: "No", material_request: "MR-95", suppliers: input.suppliers, item_target_pricing: [{ item_code: "DIR-STE-020", custom_target_price: 12.5, custom_show_target_price_to_supplier: 1 }] });
    expect(mocks.post.mock.calls[0][1].doc).toMatchObject({ custom_department: "Production - N", custom_show_target_price_to_supplier: 1, items: [expect.objectContaining({ material_request: "MR-95", material_request_item: "MR-ITEM-1", custom_target_price: 12.5, custom_show_target_price_to_supplier: 1, qty: 20, uom: "Kg" })] });
    expect(mocks.markMr).toHaveBeenCalledOnce();
  });

  it("preserves separate targets for repeated item codes on inherited and additional RFQ lines", async () => {
    await createRFQFromMaterialRequest({ contract_required: "No", material_request: "MR-95", suppliers: input.suppliers, additional_items: [{ item_code: "DIR-STE-020", item_name: "Cold Rolled Steel 10", qty: 7, uom: "Kg" }], item_target_pricing: [
      { item_code: "DIR-STE-020", custom_target_price: 12.5, custom_show_target_price_to_supplier: 1 },
      { item_code: "DIR-STE-020", custom_target_price: 18, custom_show_target_price_to_supplier: 0 },
    ] });
    expect(mocks.post.mock.calls[0][1].doc).toMatchObject({ custom_show_target_price_to_supplier: 1, items: [
      expect.objectContaining({ material_request_item: "MR-ITEM-1", item_code: "DIR-STE-020", qty: 20, uom: "Kg", custom_target_price: 12.5, custom_show_target_price_to_supplier: 1 }),
      expect.objectContaining({ item_code: "DIR-STE-020", qty: 7, uom: "Kg", custom_target_price: 18, custom_show_target_price_to_supplier: 0 }),
    ] });
  });

  it("rejects extra duplicate price rows before creating an MR-derived RFQ", async () => {
    await expect(createRFQFromMaterialRequest({ contract_required: "No", material_request: "MR-95", suppliers: input.suppliers, item_target_pricing: [
      { item_code: "DIR-STE-020", custom_target_price: 12.5 }, { item_code: "DIR-STE-020", custom_target_price: 18 },
    ] })).rejects.toThrow("Target Pricing has more DIR-STE-020 rows than the RFQ");
    expect(mocks.post).not.toHaveBeenCalled(); expect(mocks.markMr).not.toHaveBeenCalled();
  });

  it("keeps Contract Required No and MR target pricing optional without fabricating a price", async () => {
    const noContract = { ...saved, contract_required: "No" as const };
    mocks.post.mockResolvedValueOnce(noContract);
    const originalGet = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation((url: string, ...args: unknown[]) => url === "/api/resource/Request for Quotation/RFQ-95" ? Promise.resolve(noContract) : originalGet(url, ...args));
    const result = await createRFQFromMaterialRequest({ contract_required: "No", material_request: "MR-95", suppliers: input.suppliers, item_target_pricing: [{ item_code: "DIR-STE-020", custom_target_price: null, custom_show_target_price_to_supplier: 0 }] });
    expect(mocks.post.mock.calls[0][1].doc).toMatchObject({ contract_required: "No", custom_show_target_price_to_supplier: 0, items: [expect.objectContaining({ custom_target_price: null, custom_show_target_price_to_supplier: 0, qty: 20, uom: "Kg" })] });
    expect(result).toMatchObject({ name: "RFQ-95", contract_required: "No" });
    expect(result.contractRequirementWarning).toBeUndefined();
    expect(mocks.post).toHaveBeenCalledOnce();
    expect(mocks.markMr).toHaveBeenCalledExactlyOnceWith("MR-95", "RFQ-95", undefined);
  });
});
