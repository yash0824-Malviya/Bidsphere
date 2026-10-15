import { describe, expect, it } from "vitest";

import type { AIQuotation } from "./ai";
import { scoreSuppliers } from "./supplierScoringEngine";

function quote(
  supplier: string,
  total: number | null,
): AIQuotation {
  return {
    supplier_name: supplier,
    total_value: total,
    price_status: total === null ? "price_not_provided" : "submitted",
    payment_terms: "Net 30",
    notes: "Complete response",
    items: [
      {
        item: "Part A",
        requested_qty: 1,
        unit_price: total,
        total,
        delivery_days: 7,
      },
    ],
  };
}

describe("supplier price scoring", () => {
  it("retains quotation, supplier and run identity while scoring independent criteria", () => {
    const first = { ...quote("Same display name", 15), quotation_id: "Q-A", supplier_id: "ERP-A" };
    const second = { ...quote("Same display name", 30), quotation_id: "Q-B", supplier_id: "ERP-B" };
    const result = scoreSuppliers([second, first], 1, undefined, undefined, undefined, "run-current");
    expect(result.evaluation_run_id).toBe("run-current");
    expect(result.suppliers.map((supplier) => [supplier.quotation_id, supplier.supplier, supplier.evaluation_run_id])).toEqual([
      ["Q-A", "ERP-A", "run-current"], ["Q-B", "ERP-B", "run-current"],
    ]);
    expect(result.suppliers[0].dimensions).not.toBe(result.suppliers[1].dimensions);
    expect(result.suppliers[0].final_score).toBeGreaterThan(result.suppliers[1].final_score);
  });

  it("does not score a missing price as the cheapest quote", () => {
    const result = scoreSuppliers([
      quote("Priced Supplier", 12_500),
      quote("Missing Price Supplier", null),
    ], 1);

    const priced = result.suppliers.find(
      (supplier) => supplier.supplier_name === "Priced Supplier",
    );
    const missing = result.suppliers.find(
      (supplier) => supplier.supplier_name === "Missing Price Supplier",
    );

    expect(priced?.dimensions.price_score).toBe(100);
    expect(missing?.dimensions.price_score).toBe(-1);
    expect(
      missing?.score_sources.find((source) => source.dimension === "Price"),
    ).toMatchObject({
      has_data: false,
      source: "Quotation pricing was not provided",
    });
    expect(missing?.ranking).toBeGreaterThan(priced?.ranking ?? 0);
  });

  it("keeps a genuine zero quote in price comparison", () => {
    const result = scoreSuppliers([
      quote("Zero Supplier", 0),
      quote("Paid Supplier", 12_500),
    ], 1);

    const zero = result.suppliers.find(
      (supplier) => supplier.supplier_name === "Zero Supplier",
    );
    const paid = result.suppliers.find(
      (supplier) => supplier.supplier_name === "Paid Supplier",
    );

    expect(zero?.dimensions.price_score).toBe(100);
    expect(paid?.dimensions.price_score).toBe(0);
  });
});
