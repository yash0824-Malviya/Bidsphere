import { describe, expect, it } from "vitest";

import {
  collectSupplierCategorySignals,
  filterItemGroupsForMrPicker,
  itemGroupMatchesCategory,
  scoreSupplierMatch,
  supplierMatchesProcurementCategory,
} from "./procurementCategoryMatch";

describe("procurementCategoryMatch", () => {
  it("matches item groups to typed categories (not treating group as category)", () => {
    expect(itemGroupMatchesCategory("Raw Materials", "Raw Material")).toBe(true);
    expect(itemGroupMatchesCategory("Auto Parts", "Production")).toBe(true);
    expect(itemGroupMatchesCategory("IT Equipment", "Production")).toBe(false);
    expect(itemGroupMatchesCategory("Stationery", "Office Supplies")).toBe(true);
  });

  it("matches supplier signals to procurement category", () => {
    const signals = collectSupplierCategorySignals({
      custom_procurement_categories: '["Production","MRO"]',
      supplier_group: "Raw Materials",
    });
    expect(supplierMatchesProcurementCategory(signals, "Production")).toBe(
      true,
    );
    expect(supplierMatchesProcurementCategory(signals, "OPEX")).toBe(false);
  });

  it("scores category match higher than non-match", () => {
    const matched = scoreSupplierMatch({
      category: "Engineering",
      item_groups: ["Electrical Materials"],
      signals: ["Electrical Materials"],
      preferred: true,
      past_po_count: 3,
    });
    const weak = scoreSupplierMatch({
      category: "Engineering",
      item_groups: ["Office Supplies"],
      signals: ["Office & IT Supplies"],
    });
    expect(matched.score).toBeGreaterThan(weak.score);
    expect(matched.reasons.some((r) => r.includes("Preferred"))).toBe(true);
  });

  it("filters item groups by procurement type and category", () => {
    const groups = [
      { name: "Raw Material", item_group_name: "Raw Material" },
      { name: "IT Equipment", item_group_name: "IT Equipment" },
      { name: "Stationery", item_group_name: "Stationery" },
    ];
    expect(
      filterItemGroupsForMrPicker(groups, {
        procurementType: "Indirect",
        procurementCategory: "CAPEX",
      }).map((g) => g.name),
    ).toEqual(["IT Equipment"]);
    expect(
      filterItemGroupsForMrPicker(groups, {
        procurementType: "Direct",
        procurementCategory: "Raw Material",
      }).map((g) => g.name),
    ).toEqual(["Raw Material"]);
    expect(
      filterItemGroupsForMrPicker(groups, {
        procurementType: "Indirect",
        procurementCategory: "Office Supplies",
      }).map((g) => g.name),
    ).toEqual(["Stationery"]);
  });
});
