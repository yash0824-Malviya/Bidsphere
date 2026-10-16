import { beforeEach, describe, expect, it, vi } from "vitest";
import * as erp from "./erpnext";
import {
  assertMaterialRequestBidsphereStatus,
  fetchMaterialRequestWorkflow,
  getMaterialRequestBusinessStatus,
  listWarehouseMaterialRequestQueue,
  submitMaterialRequestWorkflow,
  updateMaterialRequestWorkflowStatus,
  type MaterialRequestWorkflowRecord,
} from "./materialRequestWorkflow";

vi.mock("./erpnext", async () => ({
  ...await vi.importActual<typeof import("./erpnext")>("./erpnext"),
  apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(),
}));
vi.mock("../utils/materialRequestItemFiles", async () => ({
  ...await vi.importActual<typeof import("../utils/materialRequestItemFiles")>("../utils/materialRequestItemFiles"),
  hydrateMaterialRequestItemsWithAttachments: vi.fn(async (_name, items) => items),
}));

const draft = (name: string): MaterialRequestWorkflowRecord => ({
  name, docstatus: 0, status: "Draft",
  custom_bidsphere_status: "Draft", company: "Netlink", owner: "requester@example.test",
  material_request_type: "Material Issue", transaction_date: "2026-09-09",
  schedule_date: "2026-09-09", modified: "2026-09-09 10:00:00",
  items: [{ name: "test-item-row", item_code: "RMM002", item_name: "Stainless Steel Plate", qty: 150, uom: "Nos", warehouse: "Stores - NSGAI" }],
});
const submitted = (name: string): MaterialRequestWorkflowRecord => ({
  ...draft(name), docstatus: 1, status: "Pending",
  custom_bidsphere_status: "Under Warehouse Review", modified: "2026-09-09 10:01:00",
});

describe("Material Request persisted submission", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("verification performs a fresh ERP GET after the detail page read Draft", async () => {
    const name = "MR-stale-detail";
    vi.mocked(erp.apiGet).mockResolvedValueOnce(draft(name)).mockResolvedValueOnce(submitted(name));
    await fetchMaterialRequestWorkflow(name, { skipItemAttachmentHydration: true });
    // Prime the full-document cache too, as the detail page does.
    vi.mocked(erp.apiGet).mockReset().mockResolvedValueOnce(draft(name));
    await fetchMaterialRequestWorkflow(name);
    vi.mocked(erp.apiGet).mockReset().mockResolvedValueOnce(submitted(name));
    const verified = await assertMaterialRequestBidsphereStatus(name, "Under Warehouse Review");
    expect(verified.custom_bidsphere_status).toBe("Under Warehouse Review");
    expect(erp.apiGet).toHaveBeenCalledTimes(1);
  });

  it("Save Draft reads stay Draft and do not implicitly submit", async () => {
    vi.mocked(erp.apiGet).mockResolvedValue(draft("MR-save"));
    for (let i = 0; i < 2; i++) {
      expect(getMaterialRequestBusinessStatus(await fetchMaterialRequestWorkflow("MR-save"))).toBe("Draft");
    }
    expect(erp.apiGet).toHaveBeenCalledTimes(2);
    expect(erp.apiPost).not.toHaveBeenCalled();
    expect(erp.apiPut).not.toHaveBeenCalled();
  });

  it("submits the complete existing document and verifies a new ERP GET before returning", async () => {
    const before = draft("MR-submit");
    const after = submitted(before.name);
    vi.mocked(erp.apiGet).mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    vi.mocked(erp.apiPost).mockResolvedValue(after);
    const result = await submitMaterialRequestWorkflow(before.name);
    expect(erp.apiPost).toHaveBeenNthCalledWith(1, "/api/method/frappe.client.submit", {
      doc: { ...before, doctype: "Material Request", custom_bidsphere_status: "Under Warehouse Review" },
    }, expect.objectContaining({ _disableNetworkRetry: true }));
    expect(erp.apiPut).not.toHaveBeenCalled();
    expect(result).toEqual(after);
    expect(result.items).toEqual(before.items);
    expect(erp.apiGet).toHaveBeenCalledTimes(2);
    // A normal detail-page refetch must also hit ERP, not the old Draft cache.
    vi.mocked(erp.apiGet).mockResolvedValueOnce(after);
    expect((await fetchMaterialRequestWorkflow(before.name)).custom_bidsphere_status).toBe("Under Warehouse Review");
    expect(erp.apiGet).toHaveBeenCalledTimes(3);
  });

  it.each([401, 403, 417, 500])("does not swallow HTTP %s or issue fallback mutations", async (status) => {
    vi.mocked(erp.apiGet).mockResolvedValue(draft(`MR-error-${status}`));
    const exception = `ERPNext validation or permission failure ${status}`;
    vi.mocked(erp.apiPost).mockRejectedValue({ response: { status, data: { exception } } });
    await expect(submitMaterialRequestWorkflow(`MR-error-${status}`)).rejects.toThrow(exception);
    expect(erp.apiPost).toHaveBeenCalledTimes(1);
    expect(erp.apiPut).not.toHaveBeenCalled();
  });

  it("coalesces simultaneous clicks and never inserts another Material Request", async () => {
    vi.mocked(erp.apiGet).mockResolvedValueOnce(draft("MR-double")).mockResolvedValueOnce(submitted("MR-double"));
    const first = submitMaterialRequestWorkflow("MR-double");
    const second = submitMaterialRequestWorkflow("MR-double");
    expect(first).toBe(second);
    await Promise.all([first, second]);
    const nativeSubmits = vi.mocked(erp.apiPost).mock.calls.filter(([url]) => url === "/api/method/frappe.client.submit");
    expect(nativeSubmits).toHaveLength(1);
    expect(vi.mocked(erp.apiPost).mock.calls.some(([url, payload]) =>
      url.includes("/resource/") || (payload as { doc?: { doctype?: string } })?.doc?.doctype === "Material Request" && url.includes("insert"),
    )).toBe(false);
  });

  it("recovers native-submitted/business-Draft using only the business field and modified timestamp", async () => {
    const before = { ...draft("MR-recover"), docstatus: 1 };
    vi.mocked(erp.apiGet).mockResolvedValueOnce(before).mockResolvedValueOnce(submitted(before.name));
    await submitMaterialRequestWorkflow(before.name);
    expect(erp.apiPut).toHaveBeenCalledWith(expect.stringContaining(before.name), {
      custom_bidsphere_status: "Under Warehouse Review", modified: before.modified,
    }, expect.objectContaining({ _disableNetworkRetry: true }));
    expect(vi.mocked(erp.apiPost).mock.calls.some(([url]) => url.endsWith("frappe.client.submit"))).toBe(false);
  });

  it("retry after a committed submission is read-only", async () => {
    vi.mocked(erp.apiGet).mockResolvedValue(submitted("MR-retry"));
    await submitMaterialRequestWorkflow("MR-retry");
    expect(erp.apiGet).toHaveBeenCalledTimes(2);
    expect(erp.apiPut).not.toHaveBeenCalled();
    expect(erp.apiPost).not.toHaveBeenCalled();
  });

  it.each(["Draft", undefined])("rejects an unpersisted business field (%s), even with docstatus=1", async (status) => {
    const name = `MR-missing-${status}`;
    vi.mocked(erp.apiGet).mockResolvedValue({ ...submitted(name), custom_bidsphere_status: status });
    await expect(assertMaterialRequestBidsphereStatus(name, "Under Warehouse Review")).rejects.toThrow("ERPNext did not persist");
  });

  it("rejects submission when business state changed but native submission did not persist", async () => {
    vi.mocked(erp.apiGet).mockResolvedValueOnce(draft("MR-docstatus"))
      .mockResolvedValueOnce({ ...submitted("MR-docstatus"), docstatus: 0 });
    await expect(submitMaterialRequestWorkflow("MR-docstatus")).rejects.toThrow("docstatus is 0");
  });

  it("preserves status-write permission errors instead of returning stale data", async () => {
    const error = { response: { status: 403, data: { exception: "Field not permitted in query: custom_bidsphere_status" } } };
    vi.mocked(erp.apiPut).mockRejectedValue(error);
    await expect(updateMaterialRequestWorkflowStatus("MR-denied", "Under Warehouse Review")).rejects.toBe(error);
    expect(erp.apiGet).not.toHaveBeenCalled();
  });

  it("does not join an older in-flight read when verifying a transition", async () => {
    let finishOld!: (doc: MaterialRequestWorkflowRecord) => void;
    const oldRead = new Promise<MaterialRequestWorkflowRecord>(resolve => { finishOld = resolve; });
    vi.mocked(erp.apiGet).mockReturnValueOnce(oldRead).mockResolvedValueOnce(submitted("MR-race"));
    const loading = fetchMaterialRequestWorkflow("MR-race", { skipItemAttachmentHydration: true });
    const verified = await assertMaterialRequestBidsphereStatus("MR-race", "Under Warehouse Review");
    expect(verified.custom_bidsphere_status).toBe("Under Warehouse Review");
    finishOld(draft("MR-race"));
    await loading;
    vi.mocked(erp.apiGet).mockResolvedValueOnce(submitted("MR-race"));
    expect((await fetchMaterialRequestWorkflow("MR-race")).custom_bidsphere_status).toBe("Under Warehouse Review");
  });

  it("Warehouse Pending Review includes the persisted submission and excludes a business Draft", async () => {
    vi.mocked(erp.apiGet).mockResolvedValue([
      submitted("MR-queue"), { ...draft("MR-not-submitted"), docstatus: 1 },
      { ...submitted("MR-forwarded"), custom_bidsphere_status: "Forwarded to Procurement" },
    ]);
    const queue = await listWarehouseMaterialRequestQueue(40);
    expect(queue.map(row => row.name)).toEqual(["MR-queue"]);
    expect(queue[0].items[0]).toMatchObject({ item_code: "RMM002", qty: 150, uom: "Nos" });
  });

  it("does not move cancelled or downstream requests back to warehouse review", async () => {
    for (const status of ["Cancelled", "Forwarded to Procurement", "RFQ Created", "Completed"] as const) {
      vi.mocked(erp.apiGet).mockResolvedValue({ ...submitted(`MR-${status}`), custom_bidsphere_status: status });
      await expect(submitMaterialRequestWorkflow(`MR-${status}`)).rejects.toThrow();
    }
    expect(erp.apiPost).not.toHaveBeenCalled();
    expect(erp.apiPut).not.toHaveBeenCalled();
  });

  it("resolves default company warehouse when item row lacks warehouse and submits", async () => {
    const draftWithoutWh: MaterialRequestWorkflowRecord = {
      ...draft("MR-missing-wh"),
      items: [
        { name: "row-1", item_code: "201", item_name: "Bonnet", qty: 1, uom: "Nos" },
      ],
    };
    const submittedWithWh: MaterialRequestWorkflowRecord = {
      ...submitted("MR-missing-wh"),
      items: [
        { name: "row-1", item_code: "201", item_name: "Bonnet", qty: 1, uom: "Nos", warehouse: "Stores - NSGAI" },
      ],
    };

    vi.mocked(erp.apiGet)
      .mockResolvedValueOnce(draftWithoutWh)
      .mockResolvedValueOnce([{ name: "Stores - NSGAI" }])
      .mockResolvedValueOnce(submittedWithWh);

    vi.mocked(erp.apiPost).mockResolvedValueOnce({ data: submittedWithWh });

    const result = await submitMaterialRequestWorkflow("MR-missing-wh");
    expect(result.docstatus).toBe(1);

    expect(erp.apiPost).toHaveBeenCalledWith(
      "/api/method/frappe.client.submit",
      expect.objectContaining({
        doc: expect.objectContaining({
          name: "MR-missing-wh",
          items: [
            expect.objectContaining({
              item_code: "201",
              warehouse: "Stores - NSGAI",
            }),
          ],
        }),
      }),
      expect.anything(),
    );
  });
});

