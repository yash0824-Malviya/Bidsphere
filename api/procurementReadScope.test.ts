import { describe, expect, it } from "vitest";
import {
  isReadOnlyGenericDocumentMethod,
  sanitizeSupplierProcurementDocument,
  supplierOwnsProcurementDocument,
  supplierSafeProcurementFields,
  supplierScopedProcurementFilters,
} from "./procurementReadScope";

describe("procurement read scoping", () => {
  it("classifies the RFQ list and count methods as reads", () => {
    expect(isReadOnlyGenericDocumentMethod("method/frappe.client.get_list")).toBe(true);
    expect(isReadOnlyGenericDocumentMethod("method/frappe.client.get_count")).toBe(true);
    expect(isReadOnlyGenericDocumentMethod("method/frappe.client.set_value")).toBe(false);
  });

  it("overrides attacker-controlled RFQ supplier and publication filters", () => {
    const filters = supplierScopedProcurementFilters(
      "Request for Quotation",
      "SUP-OWN",
      [
        ["Request for Quotation Supplier", "supplier", "=", "SUP-OTHER"],
        ["docstatus", "=", 0],
        ["company", "=", "Netlink"],
      ],
    );
    expect(filters).toContainEqual(["Request for Quotation Supplier", "supplier", "=", "SUP-OWN"]);
    expect(filters).toContainEqual(["docstatus", "=", 1]);
    expect(filters).toContainEqual(["company", "=", "Netlink"]);
    expect(JSON.stringify(filters)).not.toContain("SUP-OTHER");
  });

  it("drops supplier-requested internal RFQ fields", () => {
    expect(supplierSafeProcurementFields("Request for Quotation", [
      "name",
      "custom_purchase_requisition_reference",
      "custom_bidsphere_pr_idempotency_key",
    ])).toEqual(["name"]);
  });

  it("verifies detail ownership and tolerates legacy wrapping quotes", () => {
    expect(supplierOwnsProcurementDocument("Request for Quotation", {
      docstatus: 1,
      status: "Submitted",
      suppliers: [{ supplier: '"Atlantic Precision Manufacturing."' }],
    }, "Atlantic Precision Manufacturing.")).toBe(true);
    expect(supplierOwnsProcurementDocument("Purchase Order", {
      docstatus: 1,
      status: "To Receive and Bill",
      supplier: "SUP-OTHER",
    }, "SUP-OWN")).toBe(false);
  });

  it("removes hidden RFQ target prices and internal trace fields", () => {
    const sanitized = sanitizeSupplierProcurementDocument(
      "Request for Quotation",
      {
        name: "RFQ-001",
        custom_purchase_requisition_reference: "PR-SECRET",
        suppliers: [{ supplier: "SUP-OWN" }, { supplier: "SUP-OTHER" }],
        items: [
          { name: "row-1", custom_target_price: 99, custom_show_target_price_to_supplier: 0 },
          { name: "row-2", custom_target_price: 42, custom_show_target_price_to_supplier: 1 },
        ],
      },
      "SUP-OWN",
    );
    const items = sanitized.items as Array<Record<string, unknown>>;
    expect(items[0]).not.toHaveProperty("custom_target_price");
    expect(items[1]).toHaveProperty("custom_target_price", 42);
    expect(sanitized).not.toHaveProperty("custom_purchase_requisition_reference");
    expect(sanitized.suppliers).toEqual([{ supplier: "SUP-OWN" }]);
  });
});
