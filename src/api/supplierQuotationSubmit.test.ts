import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createSupplierQuotation,
  saveDraftSupplierQuotation,
  submitSupplierQuotation,
} from "./sourcing";
import * as erpnext from "./erpnext";

vi.mock("./erpnext", async () => {
  const actual = await vi.importActual<typeof import("./erpnext")>("./erpnext");
  return {
    ...actual,
    apiGet: vi.fn(),
    apiPost: vi.fn(),
    apiPut: vi.fn(),
    buildResourceUrl: (doctype: string, name?: string) =>
      name ? `/api/resource/${doctype}/${name}` : `/api/resource/${doctype}`,
    buildListConfig: vi.fn((cfg) => cfg),
    todayERPNextDate: () => "2026-08-31",
  };
});

describe("Supplier Quotation Submission & Draft Safeguards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("createSupplierQuotation creates a draft (docstatus: 0) by default without auto-submitting", async () => {
    const apiPostMock = vi.mocked(erpnext.apiPost);
    const apiPutMock = vi.mocked(erpnext.apiPut);
    const apiGetMock = vi.mocked(erpnext.apiGet);

    apiGetMock.mockImplementation(async (url: string) => {
      if (url.includes("Server Script")) return [];
      if (url.includes("Request for Quotation")) return { docstatus: 1, name: "PUR-RFQ-2026-0001" };
      if (url.includes("Warehouse")) return [{ name: "Stores - N" }];
      return {};
    });

    apiPostMock.mockResolvedValueOnce({
      name: "PUR-SQTN-2026-00100",
      supplier: "Supplier A",
      docstatus: 0,
      status: "Draft",
    });

    const result = await createSupplierQuotation({
      supplier: "Supplier A",
      rfq_no: "PUR-RFQ-2026-0001",
      company: "Netlink",
      items: [
        {
          item_code: "ITEM-001",
          item_name: "Item 1",
          qty: 10,
          uom: "Nos",
          rate: 50,
        },
      ],
    });

    expect(result.name).toBe("PUR-SQTN-2026-00100");
    expect(result.status).toBe("Draft");
    expect(result.docstatus).toBe(0);
    expect(apiPutMock).not.toHaveBeenCalled();
  });

  it("createSupplierQuotation submits (docstatus: 1) when submitOnCreate is true", async () => {
    const apiPostMock = vi.mocked(erpnext.apiPost);
    const apiPutMock = vi.mocked(erpnext.apiPut);
    const apiGetMock = vi.mocked(erpnext.apiGet);

    apiGetMock.mockImplementation(async (url: string) => {
      if (url.includes("Server Script")) return [];
      if (url.includes("Request for Quotation")) return { docstatus: 1, name: "PUR-RFQ-2026-0001" };
      if (url.includes("Warehouse")) return [{ name: "Stores - N" }];
      if (url.includes("Supplier Quotation")) return { modified: "2026-08-31 10:00:00" };
      return {};
    });

    apiPostMock.mockResolvedValueOnce({
      name: "PUR-SQTN-2026-00101",
      supplier: "Supplier A",
      docstatus: 0,
    });
    apiPutMock.mockResolvedValueOnce({
      name: "PUR-SQTN-2026-00101",
      supplier: "Supplier A",
      docstatus: 1,
      status: "Submitted",
    });

    const result = await createSupplierQuotation(
      {
        supplier: "Supplier A",
        rfq_no: "PUR-RFQ-2026-0001",
        company: "Netlink",
        items: [
          {
            item_code: "ITEM-001",
            item_name: "Item 1",
            qty: 10,
            uom: "Nos",
            rate: 50,
            expected_delivery_date: "2026-09-15",
            delivery_days: 15,
          },
        ],
      },
      { submitOnCreate: true }
    );

    expect(result.name).toBe("PUR-SQTN-2026-00101");
    expect(result.status).toBe("Submitted");
    expect(result.docstatus).toBe(1);
    expect(apiPutMock).toHaveBeenCalledWith(
      "/api/resource/Supplier Quotation/PUR-SQTN-2026-00101",
      expect.objectContaining({ docstatus: 1 })
    );
  });

  it("blocks submission if expected delivery date is missing upon submission", async () => {
    const apiGetMock = vi.mocked(erpnext.apiGet);
    apiGetMock.mockImplementation(async (url: string) => {
      if (url.includes("Server Script")) return [];
      if (url.includes("Request for Quotation")) return { docstatus: 1, name: "PUR-RFQ-2026-0001" };
      if (url.includes("Warehouse")) return [{ name: "Stores - N" }];
      return {};
    });

    await expect(
      createSupplierQuotation(
        {
          supplier: "Supplier A",
          rfq_no: "PUR-RFQ-2026-0001",
          company: "Netlink",
          items: [
            {
              item_code: "ITEM-001",
              item_name: "Item 1",
              qty: 10,
              uom: "Nos",
              rate: 50,
              // delivery date omitted
            },
          ],
        },
        { submitOnCreate: true }
      )
    ).rejects.toThrow(
      "Please provide the expected delivery date before submitting your quotation."
    );
  });

  it("allows saving a draft without expected delivery date", async () => {
    const apiPostMock = vi.mocked(erpnext.apiPost);
    const apiGetMock = vi.mocked(erpnext.apiGet);

    apiGetMock.mockImplementation(async (url: string) => {
      if (url.includes("Server Script")) return [];
      if (url.includes("Request for Quotation")) return { docstatus: 1, name: "PUR-RFQ-2026-0001" };
      if (url.includes("Warehouse")) return [{ name: "Stores - N" }];
      return {};
    });

    apiPostMock.mockResolvedValueOnce({
      name: "PUR-SQTN-2026-00102",
      supplier: "Supplier A",
      docstatus: 0,
      status: "Draft",
    });

    const result = await createSupplierQuotation(
      {
        supplier: "Supplier A",
        rfq_no: "PUR-RFQ-2026-0001",
        company: "Netlink",
        items: [
          {
            item_code: "ITEM-001",
            item_name: "Item 1",
            qty: 10,
            uom: "Nos",
            rate: 50,
          },
        ],
      },
      { submitOnCreate: false }
    );

    expect(result.name).toBe("PUR-SQTN-2026-00102");
    expect(result.status).toBe("Draft");
    expect(result.docstatus).toBe(0);
  });

  it("maps expected_delivery_date, schedule_date, and lead_time_days to ERPNext payload", async () => {
    const apiPostMock = vi.mocked(erpnext.apiPost);
    const apiGetMock = vi.mocked(erpnext.apiGet);

    apiGetMock.mockImplementation(async (url: string) => {
      if (url.includes("Server Script")) return [];
      if (url.includes("Request for Quotation")) return { docstatus: 1, name: "PUR-RFQ-2026-0001" };
      if (url.includes("Warehouse")) return [{ name: "Stores - N" }];
      return {};
    });

    apiPostMock.mockResolvedValueOnce({
      name: "PUR-SQTN-2026-00103",
      supplier: "Supplier A",
      docstatus: 0,
      status: "Draft",
    });

    await createSupplierQuotation({
      supplier: "Supplier A",
      rfq_no: "PUR-RFQ-2026-0001",
      company: "Netlink",
      items: [
        {
          item_code: "ITEM-001",
          item_name: "Item 1",
          qty: 10,
          uom: "Nos",
          rate: 50,
          expected_delivery_date: "2026-10-25",
          delivery_days: 12,
        },
      ],
    });

    expect(apiPostMock).toHaveBeenCalledWith(
      "/api/resource/Supplier Quotation",
      expect.objectContaining({
        expected_delivery_date: "2026-10-25",
        schedule_date: "2026-10-25",
        items: [
          expect.objectContaining({
            item_code: "ITEM-001",
            expected_delivery_date: "2026-10-25",
            schedule_date: "2026-10-25",
            lead_time_days: 12,
          }),
        ],
      })
    );
  });

  it("submitSupplierQuotation is idempotent and returns cleanly if quotation is already submitted", async () => {
    const apiGetMock = vi.mocked(erpnext.apiGet);
    const apiPutMock = vi.mocked(erpnext.apiPut);

    apiGetMock.mockImplementation(async (url: string) => {
      if (url.includes("Server Script")) return [];
      if (url.includes("Supplier Quotation")) {
        return {
          name: "PUR-SQTN-2026-00239",
          docstatus: 1,
          status: "Submitted",
        };
      }
      return {};
    });

    const result = await submitSupplierQuotation("PUR-SQTN-2026-00239");

    expect(result.name).toBe("PUR-SQTN-2026-00239");
    expect(result.status).toBe("Submitted");
    expect(result.docstatus).toBe(1);
    expect(apiPutMock).not.toHaveBeenCalled();
  });

  it("saveDraftSupplierQuotation safely skips updating an already submitted quotation", async () => {
    const apiGetMock = vi.mocked(erpnext.apiGet);
    const apiPutMock = vi.mocked(erpnext.apiPut);

    apiGetMock.mockImplementation(async (url: string) => {
      if (url.includes("Supplier Quotation")) {
        return {
          name: "PUR-SQTN-2026-00239",
          docstatus: 1,
          status: "Submitted",
        };
      }
      return {};
    });

    const result = await saveDraftSupplierQuotation(
      {
        supplier: "Supplier A",
        rfq_no: "PUR-RFQ-2026-0001",
        company: "Netlink",
        items: [
          {
            item_code: "ITEM-001",
            item_name: "Item 1",
            qty: 10,
            uom: "Nos",
            rate: 50,
          },
        ],
      },
      "PUR-SQTN-2026-00239"
    );

    expect(result.name).toBe("PUR-SQTN-2026-00239");
    expect(result.status).toBe("Submitted");
    expect(result.docstatus).toBe(1);
    expect(apiPutMock).not.toHaveBeenCalled();
  });
});
