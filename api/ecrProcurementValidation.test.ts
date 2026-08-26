import { describe, expect, it, vi } from "vitest";

import {
  assertEcrAllowsDownstreamPurchaseRequisition,
  assertEcrLinkedPrUsesTrustedEndpoint,
  assertEcrProcurementRelationships,
  EcrProcurementValidationError,
  purchaseRequisitionEcrReferenceForCreate,
} from "./ecrProcurementValidation";

const validRfq = {
  name: "PUR-RFQ-2026-00015",
  status: "Submitted",
  docstatus: 1,
  suppliers: [{ supplier: "SUP-001" }],
  items: [{
    name: "rfq-line-1",
    item_code: "LAT-4401",
    description: "Door Latch Reinforcement",
    qty: 100,
    uom: "Nos",
  }],
};

function ecr(overrides: Record<string, unknown> = {}) {
  return {
    supplier_response_required: "Yes",
    suggested_supplier: "SUP-001",
    procurement_reference_type: "RFQ",
    existing_rfq_reference: "PUR-RFQ-2026-00015",
    existing_purchase_order_reference: "",
    affected_parts: [{
      partitem: "LAT-4401",
      part_description: "Door Latch Reinforcement",
      quantity: 100,
      uom: "Nos",
      source_reference_type: "RFQ",
      source_document_reference: "PUR-RFQ-2026-00015",
      source_item_reference: "rfq-line-1",
    }],
    ...overrides,
  };
}

describe("trusted ECR procurement validation", () => {
  it("accepts a canonical Supplier -> RFQ -> child line -> Item chain", async () => {
    const load = vi.fn().mockResolvedValue(validRfq);
    await expect(assertEcrProcurementRelationships(ecr(), load)).resolves.toBeUndefined();
    expect(load).toHaveBeenCalledWith("Request for Quotation", "PUR-RFQ-2026-00015");
  });

  it("rejects a supplier/RFQ mismatch with field-level errors", async () => {
    const load = vi.fn().mockResolvedValue({
      ...validRfq,
      suppliers: [{ supplier: "SUP-OTHER" }],
    });
    await expect(assertEcrProcurementRelationships(ecr(), load)).rejects.toMatchObject({
      status: 422,
      fieldErrors: {
        existing_rfq_reference: expect.stringMatching(/not associated with supplier/i),
      },
    });
  });

  it("rejects a child row whose Item Link was tampered with", async () => {
    const load = vi.fn().mockResolvedValue(validRfq);
    await expect(assertEcrProcurementRelationships(ecr({
      affected_parts: [{
        partitem: "LAT-9999",
        source_reference_type: "RFQ",
        source_document_reference: "PUR-RFQ-2026-00015",
        source_item_reference: "rfq-line-1",
      }],
    }), load)).rejects.toMatchObject({
      fieldErrors: {
        "partitem.0": "Selected item 'LAT-9999' is not part of PUR-RFQ-2026-00015.",
      },
    });
  });

  it("rejects stale source metadata when Reference Type is None", async () => {
    const load = vi.fn();
    await expect(assertEcrProcurementRelationships(ecr({
      procurement_reference_type: "None",
      existing_rfq_reference: "",
    }), load)).rejects.toBeInstanceOf(EcrProcurementValidationError);
    expect(load).not.toHaveBeenCalled();
  });

  it("treats a blank legacy Reference Type as None", async () => {
    const load = vi.fn();
    await expect(assertEcrProcurementRelationships({
      supplier_response_required: "No",
      procurement_reference_type: "",
      existing_rfq_reference: "",
      existing_purchase_order_reference: "",
      affected_parts: [{ partitem: "LAT-4401" }],
    }, load)).resolves.toBeUndefined();
    expect(load).not.toHaveBeenCalled();
  });

  it("rejects tampered source quantity, UOM, or description snapshots", async () => {
    const load = vi.fn().mockResolvedValue(validRfq);
    await expect(assertEcrProcurementRelationships(ecr({
      affected_parts: [{
        partitem: "LAT-4401",
        part_description: "Changed in the request",
        quantity: 999,
        uom: "Kg",
        source_reference_type: "RFQ",
        source_document_reference: "PUR-RFQ-2026-00015",
        source_item_reference: "rfq-line-1",
      }],
    }), load)).rejects.toMatchObject({
      fieldErrors: {
        "partitem.0": expect.stringMatching(/details do not match/i),
      },
    });
  });

  it("rejects cancelled source documents", async () => {
    const load = vi.fn().mockResolvedValue({ ...validRfq, status: "Cancelled", docstatus: 2 });
    await expect(assertEcrProcurementRelationships(ecr(), load)).rejects.toMatchObject({
      fieldErrors: {
        existing_rfq_reference: expect.stringMatching(/cancelled/i),
      },
    });
  });
});

describe("source-linked ECR downstream PR guard", () => {
  it("routes every direct ECR-linked PR create through the trusted endpoint", () => {
    expect(() => assertEcrLinkedPrUsesTrustedEndpoint("ECR-0001"))
      .toThrow(/\/api\/create-pr-from-ecr/i);
    expect(() => assertEcrLinkedPrUsesTrustedEndpoint(" ")).not.toThrow();
  });

  it("extracts the ECR only from Purchase Requisition create requests", () => {
    expect(purchaseRequisitionEcrReferenceForCreate(
      "resource/Purchase Requisition",
      "POST",
      { ecr_reference: "ECR-0001" },
      {},
    )).toBe("ECR-0001");
    expect(purchaseRequisitionEcrReferenceForCreate(
      "method/frappe.client.insert",
      "POST",
      {},
      { doctype: "Purchase Requisition", ecr_reference: "ECR-0002" },
    )).toBe("ECR-0002");
    expect(purchaseRequisitionEcrReferenceForCreate(
      "resource/Purchase Requisition/PR-0001",
      "PUT",
      { ecr_reference: "ECR-0001" },
      {},
    )).toBeNull();
  });

  it.each([
    ["RFQ", "PUR-RFQ-2026-00015"],
    ["Purchase Order", "PUR-ORD-2026-00042"],
  ])("rejects downstream PR creation for an existing %s source", (referenceType, documentName) => {
    expect(() => assertEcrAllowsDownstreamPurchaseRequisition({
      name: "ECR-0001",
      procurement_reference_type: referenceType,
      existing_rfq_reference: referenceType === "RFQ" ? documentName : "",
      existing_purchase_order_reference:
        referenceType === "Purchase Order" ? documentName : "",
    })).toThrow(/No downstream Purchase Requisition was created/i);
  });

  it("allows the standard downstream path when Reference Type is None", () => {
    expect(() => assertEcrAllowsDownstreamPurchaseRequisition({
      name: "ECR-0001",
      procurement_reference_type: "None",
    })).not.toThrow();
  });
});
