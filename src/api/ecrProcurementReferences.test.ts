import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRFQsPaged: vi.fn(),
  getRFQ: vi.fn(),
  getPurchaseOrdersStrict: vi.fn(),
  getPurchaseOrder: vi.fn(),
}));

vi.mock("./sourcing", () => ({
  getRFQsPaged: mocks.getRFQsPaged,
  getRFQ: mocks.getRFQ,
}));

vi.mock("./purchasing", () => ({
  getPurchaseOrdersStrict: mocks.getPurchaseOrdersStrict,
  getPurchaseOrder: mocks.getPurchaseOrder,
}));

import {
  fetchECRProcurementSourceItems,
  fetchECRSupplierPurchaseOrders,
  fetchECRSupplierRFQs,
  validateECRProcurementSourceItems,
  type ECRProcurementSourceItem,
} from "./ecrProcurementReferences";
import { canonicalizeECRProcurementSelectionInput } from "../utils/ecrProcurementValidation";

describe("ECR procurement references", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists only the selected supplier's non-cancelled RFQs and deduplicates them", async () => {
    mocks.getRFQsPaged.mockResolvedValue({
      data: [
        { name: "PUR-RFQ-2026-00015", status: "Submitted" },
        { name: "PUR-RFQ-2026-00015", status: "Submitted" },
      ],
      total_records: 2,
      total_pages: 1,
      current_page: 1,
      page_size: 1000,
    });

    await expect(fetchECRSupplierRFQs("SUP-001")).resolves.toEqual([
      { name: "PUR-RFQ-2026-00015", status: "Submitted" },
    ]);
    expect(mocks.getRFQsPaged).toHaveBeenCalledWith(expect.objectContaining({
      filters: expect.arrayContaining([
        ["Request for Quotation Supplier", "supplier", "=", "SUP-001"],
        ["docstatus", "!=", 2],
      ]),
    }));
  });

  it("maps the actual RFQ child-row and Item references", async () => {
    mocks.getRFQ.mockResolvedValue({
      name: "PUR-RFQ-2026-00015",
      suppliers: [{ supplier: "SUP-001" }],
      items: [{
        name: "rfq-item-row-1",
        item_code: "LAT-4401",
        item_name: "Door Latch",
        description: "Door Latch Reinforcement",
        qty: 100,
        uom: "Nos",
      }],
    });

    await expect(fetchECRProcurementSourceItems(
      "RFQ",
      "PUR-RFQ-2026-00015",
      "SUP-001",
    )).resolves.toEqual([{
      sourceItemReference: "rfq-item-row-1",
      itemId: "LAT-4401",
      itemCode: "LAT-4401",
      description: "Door Latch Reinforcement",
      quantity: 100,
      uom: "Nos",
    }]);
  });

  it("rejects an RFQ that does not belong to the selected supplier", async () => {
    mocks.getRFQ.mockResolvedValue({
      name: "PUR-RFQ-2026-00015",
      suppliers: [{ supplier: "SUP-OTHER" }],
      items: [],
    });

    await expect(fetchECRProcurementSourceItems(
      "RFQ",
      "PUR-RFQ-2026-00015",
      "SUP-001",
    )).rejects.toThrow(/not associated with supplier 'SUP-001'/i);
  });

  it("lists and maps purchase orders for the exact selected supplier", async () => {
    mocks.getPurchaseOrdersStrict.mockResolvedValue([
      { name: "PUR-ORD-2026-00042", status: "To Receive and Bill" },
    ]);
    await expect(fetchECRSupplierPurchaseOrders("SUP-001")).resolves.toEqual([
      { name: "PUR-ORD-2026-00042", status: "To Receive and Bill" },
    ]);
    expect(mocks.getPurchaseOrdersStrict).toHaveBeenCalledWith(expect.objectContaining({
      filters: expect.arrayContaining([
        ["supplier", "=", "SUP-001"],
        ["docstatus", "!=", 2],
      ]),
    }));

    mocks.getPurchaseOrder.mockResolvedValue({
      name: "PUR-ORD-2026-00042",
      supplier: "SUP-001",
      docstatus: 1,
      items: [{
        name: "po-line-1",
        item_code: "LAT-4402",
        description: "Mounting Plate",
        qty: 50,
        uom: "Nos",
      }],
    });
    await expect(fetchECRProcurementSourceItems(
      "Purchase Order",
      "PUR-ORD-2026-00042",
      "SUP-001",
    )).resolves.toEqual([expect.objectContaining({
      sourceItemReference: "po-line-1",
      itemId: "LAT-4402",
      quantity: 50,
      uom: "Nos",
    })]);
  });

  it("uses the source child-row ID to validate duplicate item codes", () => {
    const sourceItems: ECRProcurementSourceItem[] = [
      {
        sourceItemReference: "line-a",
        itemId: "AC001",
        itemCode: "AC001",
        description: "First line",
        quantity: 10,
        uom: "Nos",
      },
      {
        sourceItemReference: "line-b",
        itemId: "AC001",
        itemCode: "AC001",
        description: "Second line",
        quantity: 20,
        uom: "Nos",
      },
    ];

    const result = validateECRProcurementSourceItems({
      supplier: "SUP-001",
      referenceType: "RFQ",
      rfqId: "PUR-RFQ-2026-00018",
      parts: [{
        partitem: "AC001",
        source_reference_type: "RFQ",
        source_document_reference: "PUR-RFQ-2026-00018",
        source_item_reference: "line-b",
      }],
    }, sourceItems);

    expect(result.errors).toEqual({});
    expect(result.canonicalParts[0]).toMatchObject({
      source_item_reference: "line-b",
      quantity: 20,
      part_description: "Second line",
    });
  });

  it("returns a relationship-specific error for a stale or tampered item", () => {
    const result = validateECRProcurementSourceItems({
      supplier: "SUP-001",
      referenceType: "Purchase Order",
      purchaseOrderId: "PUR-ORD-2026-00042",
      parts: [{
        partitem: "LAT-4401",
        source_reference_type: "Purchase Order",
        source_document_reference: "PUR-ORD-2026-00042",
        source_item_reference: "another-po-line",
      }],
    }, [{
      sourceItemReference: "valid-po-line",
      itemId: "LAT-4402",
      itemCode: "LAT-4402",
      description: "Mounting Plate",
      quantity: 100,
      uom: "Nos",
    }]);

    expect(result.errors["partitem.0"]).toBe(
      "Selected item 'LAT-4401' is not part of PUR-ORD-2026-00042.",
    );
  });

  it("validates procurement relationships with canonical master IDs", () => {
    const input = canonicalizeECRProcurementSelectionInput({
      supplier: "Apex Fasteners Ltd",
      referenceType: "RFQ",
      rfqId: "PUR-RFQ-2026-00015",
      parts: [{
        partitem: "Door Latch Reinforcement",
        source_reference_type: "RFQ",
        source_document_reference: "PUR-RFQ-2026-00015",
        source_item_reference: "rfq-line-1",
      }],
    }, {
      supplier: "SUP-001",
      parts: ["LAT-4401"],
    });

    const result = validateECRProcurementSourceItems(input, [{
      sourceItemReference: "rfq-line-1",
      itemId: "LAT-4401",
      itemCode: "LAT-4401",
      description: "Door Latch Reinforcement",
      quantity: 100,
      uom: "Nos",
    }]);

    expect(input.supplier).toBe("SUP-001");
    expect(result.errors).toEqual({});
    expect(result.canonicalParts[0]).toMatchObject({
      partitem: "LAT-4401",
      source_item_reference: "rfq-line-1",
    });
  });
});
