import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateRFQInput } from "./sourcing";
import type { CreateRFQFromMaterialRequestInput } from "./createRFQFromMaterialRequest";
const mock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), activeSuppliers: vi.fn(), audit: vi.fn(), markMr: vi.fn(), mr: vi.fn(), findActive: vi.fn(), saved: {} as Record<string, unknown> }));
vi.mock("./erpnext", () => ({ apiGet: mock.get, apiPost: mock.post, apiPut: mock.put, erpnext: {}, COMPANY: "Test Company", withSilent: (value: unknown) => value, getExactCount: vi.fn(), buildResourceUrl: (doctype: string, name?: string) => `/api/resource/${encodeURIComponent(doctype)}${name ? `/${encodeURIComponent(name)}` : ""}`, buildListConfig: (value: unknown) => value }));
vi.mock("./supplier", () => ({ assertSuppliersActive: mock.activeSuppliers }));
vi.mock("./rfqSupplierInviteAudit", () => ({ appendRfqInviteAudit: mock.audit }));
vi.mock("./itemUomConfiguration", () => ({ resolveItemUomConfiguration: vi.fn() }));
vi.mock("./materialRequestWorkflow", () => ({ fetchMaterialRequestWorkflow: mock.mr, extractSourceDepartmentMrName: () => "", getLinkedRfqName: () => "", getMaterialRequestWorkflowStatus: () => "Forwarded to Procurement", markMaterialRequestRfqCreated: mock.markMr, parseForwardedItemsFromMr: () => [] }));
vi.mock("./mrRfqAction", () => ({ findActiveRfqForMaterialRequest: mock.findActive }));
vi.mock("../utils/materialRequestItemFiles", () => ({ engineeringCustomFieldsForErp: () => ({}), hydrateEngineeringDocsFromChild: async () => ({ attachments: [] }) }));
import { createRFQ } from "./sourcing";
import { createRFQFromMaterialRequest } from "./createRFQFromMaterialRequest";

const direct: CreateRFQInput = { transaction_date: "2026-09-17", company: "Test Company", message_for_supplier: "Original supplier terms", items: [{ item_code: "DIR-STE-020", item_name: "Cold Rolled Steel 10", qty: 20, uom: "Kg", custom_target_price: 15, custom_show_target_price_to_supplier: 1 }], suppliers: [{ supplier: "SUP-1", supplier_name: "Supplier One" }, { supplier: "SUP-2" }] };
const material: CreateRFQFromMaterialRequestInput = { material_request: "MAT-MR-2026-00079", transaction_date: "2026-09-17", message_for_supplier: direct.message_for_supplier, suppliers: direct.suppliers };
const decisions = [[undefined, "No"], ["Yes", "Yes"], ["No", "No"], [true, "Yes"], [false, "No"]] as const;

describe("RFQ creation persists the saved Contract Requirement without creating CLM", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mock.saved = {};
    mock.findActive.mockResolvedValue(null); mock.activeSuppliers.mockResolvedValue(undefined); mock.markMr.mockResolvedValue(undefined);
    mock.mr.mockResolvedValue({ name: material.material_request, company: "Test Company", schedule_date: "2026-10-01", items: [{ name: "MR-ROW-1", item_code: "DIR-STE-020", item_name: "Cold Rolled Steel 10", qty: 20, uom: "Kg" }] });
    mock.get.mockImplementation(async (url: string) => {
      if (url.endsWith("/Server%20Script")) return [];
      if (url.endsWith("/Warehouse")) return [{ name: "Stores - TC" }];
      if (url.endsWith("/Item")) return [{ name: "DIR-STE-020", item_code: "DIR-STE-020", item_group: "Steel", stock_uom: "Kg" }];
      if (url.endsWith("/Request%20for%20Quotation/RFQ-CREATED")) return { ...mock.saved };
      throw new Error(`Unexpected query ${url}`);
    });
    mock.post.mockImplementation(async (_url: string, body: { doc: Record<string, unknown> }) => { mock.saved = { ...body.doc, name: "RFQ-CREATED" }; return { ...mock.saved }; });
  });

  it.each(decisions)("saves direct RFQ input %s as ERP Select %s and verifies it", async (required, expected) => {
    const result = await createRFQ({ ...direct, ...(required === undefined ? {} : { contract_required: required }) });
    expect(result.contract_required).toBe(expected);
    expect(mock.post).toHaveBeenCalledTimes(1);
    expect(mock.post.mock.calls[0]).toEqual(["/api/method/frappe.client.save", { doc: expect.objectContaining({ doctype: "Request for Quotation", contract_required: expected, status: "Draft", message_for_supplier: direct.message_for_supplier, suppliers: expect.arrayContaining([expect.objectContaining({ supplier: "SUP-1" })]), items: expect.arrayContaining([expect.objectContaining({ item_code: "DIR-STE-020", qty: 20, uom: "Kg", custom_target_price: 15, custom_show_target_price_to_supplier: 1 })]) }) }]);
    expect(mock.get).toHaveBeenLastCalledWith("/api/resource/Request%20for%20Quotation/RFQ-CREATED");
    expect(mock.activeSuppliers).toHaveBeenCalledWith(["SUP-1", "SUP-2"]);
  });

  it.each(decisions)("saves MR RFQ input %s as ERP Select %s and retains source linkage", async (required, expected) => {
    const result = await createRFQFromMaterialRequest({ ...material, ...(required === undefined ? {} : { contract_required: required }) });
    expect(result.contract_required).toBe(expected);
    expect(mock.post).toHaveBeenCalledTimes(1);
    expect(mock.post.mock.calls[0][1].doc).toMatchObject({ contract_required: expected, status: "Draft", message_for_supplier: direct.message_for_supplier, items: [expect.objectContaining({ item_code: "DIR-STE-020", qty: 20, uom: "Kg", material_request: material.material_request, material_request_item: "MR-ROW-1" })] });
    expect(mock.markMr).toHaveBeenCalledWith(material.material_request, "RFQ-CREATED", undefined);
    expect(mock.get).toHaveBeenLastCalledWith("/api/resource/Request%20for%20Quotation/RFQ-CREATED");
  });

  it.each(["direct", "material"])("saves Draft Yes through the %s path with zero CLM calls",async path=>{
    const saved = await (path === "direct" ? createRFQ({...direct,contract_required:"Yes"}) : createRFQFromMaterialRequest({...material,contract_required:"Yes"}));
    expect(saved).toMatchObject({name:"RFQ-CREATED",status:"Draft",contract_required:"Yes"});
    expect(saved.contractRequirementWarning).toBeUndefined();
    expect(mock.post).toHaveBeenCalledExactlyOnceWith("/api/method/frappe.client.save",{doc:expect.objectContaining({doctype:"Request for Quotation",contract_required:"Yes",status:"Draft"})});
    expect([...mock.post.mock.calls,...mock.get.mock.calls,...mock.put.mock.calls].every(([url])=>!String(url).includes("/api/clm")&&!String(url).includes("Contract%20Request")&&!String(url).includes("bidsphere_workflows"))).toBe(true);
  });
  it("rejects invalid metadata before either creation path performs network writes", async () => {
    await expect(createRFQ({ ...direct, contract_required: "Invalid" as "Yes" })).rejects.toThrow("must be Yes or No");
    await expect(createRFQFromMaterialRequest({ ...material, contract_required: "true" as "Yes" })).rejects.toThrow("must be Yes or No");
    expect(mock.post).not.toHaveBeenCalled(); expect(mock.get).not.toHaveBeenCalled(); expect(mock.mr).not.toHaveBeenCalled();
  });
  it("persists the selected real Department with a manual RFQ's initial save", async () => {
    await createRFQ({ ...direct, contract_required: "No", custom_department: "Production - TC" });
    expect(mock.post.mock.calls[0][1].doc).toMatchObject({ contract_required: "No", custom_department: "Production - TC" });
  });
  it("uses the chosen Department only when the MR has no Department", async () => {
    await createRFQFromMaterialRequest({ ...material, contract_required: "No", custom_department: "Production - TC" });
    expect(mock.post.mock.calls[0][1].doc).toMatchObject({ contract_required: "No", custom_department: "Production - TC" });
    const mr = await mock.mr(); mock.mr.mockResolvedValue({ ...mr, custom_department: "Engineering - TC" });
    await createRFQFromMaterialRequest({ ...material, contract_required: "No", custom_department: "Production - TC" });
    expect(mock.post.mock.calls[1][1].doc).toMatchObject({ custom_department: "Engineering - TC" });
  });
  it.each(["direct", "material"])("returns the created %s RFQ after a read-back failure so existing follow-up writes can finish", async path => {
    const normalRead = mock.get.getMockImplementation()!;
    mock.get.mockImplementation(async (url: string) => { if (url.endsWith("/Request%20for%20Quotation/RFQ-CREATED")) throw new Error("Verification network unavailable"); return normalRead(url); });
    const result = path === "direct" ? await createRFQ(direct) : await createRFQFromMaterialRequest(material);
    expect(result).toMatchObject({ name: "RFQ-CREATED", contract_required: "No", contractRequirementWarning: expect.stringContaining("could not be verified") });
    expect(result.items[0]).toMatchObject({ item_code: "DIR-STE-020", qty: 20, uom: "Kg" });
    expect(mock.post).toHaveBeenCalledOnce();
    expect(mock.post.mock.calls[0][1].doc).not.toHaveProperty("contractRequirementWarning");
    if (path === "material") expect(mock.markMr).toHaveBeenCalledWith(material.material_request, "RFQ-CREATED", undefined);
  });
});
