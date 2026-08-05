import { describe, expect, it } from "vitest";

import {
  matchesItemMasterFilters,
  type ItemMasterRecord,
} from "./itemMaster";

function item(overrides: Partial<ItemMasterRecord> = {}): ItemMasterRecord {
  return {
    item_code: "RM-1",
    item_name: "Steel",
    description: "",
    item_group: "Raw Material",
    procurement_type: "Direct",
    procurement_category: "Raw Material",
    stock_uom: "Kg",
    is_stock_item: true,
    reorder_level: 0,
    min_stock: 0,
    max_stock: 0,
    default_warehouse: "",
    standard_rate: 0,
    manufacturer: "",
    brand: "",
    lifecycle_status: "Active",
    disabled: false,
    owner: "",
    creation: "",
    modified: "",
    modified_by: "",
    image: "",
    warehouse: "Stores - BS",
    current_stock: 0,
    available_qty: 0,
    ...overrides,
  };
}

describe("matchesItemMasterFilters", () => {
  it("ignores empty All filters", () => {
    expect(matchesItemMasterFilters(item(), {})).toBe(true);
    expect(
      matchesItemMasterFilters(item(), {
        procurementType: "",
        procurementCategory: "",
        itemGroup: "",
        warehouse: "",
      }),
    ).toBe(true);
  });

  it("filters by Procurement Type only", () => {
    expect(
      matchesItemMasterFilters(item(), { procurementType: "Direct" }),
    ).toBe(true);
    expect(
      matchesItemMasterFilters(item(), { procurementType: "Indirect" }),
    ).toBe(false);
  });

  it("filters by Procurement Category only (not item_group)", () => {
    expect(
      matchesItemMasterFilters(item({ procurement_category: "Production" }), {
        procurementCategory: "Raw Material",
      }),
    ).toBe(false);
    expect(
      matchesItemMasterFilters(item(), { procurementCategory: "Raw Material" }),
    ).toBe(true);
  });

  it("filters by Item Group only", () => {
    expect(
      matchesItemMasterFilters(item(), { itemGroup: "Raw Material" }),
    ).toBe(true);
    expect(
      matchesItemMasterFilters(item(), { itemGroup: "Auto Parts" }),
    ).toBe(false);
  });

  it("applies Type + Category + Item Group together", () => {
    expect(
      matchesItemMasterFilters(item(), {
        procurementType: "Direct",
        procurementCategory: "Raw Material",
        itemGroup: "Raw Material",
      }),
    ).toBe(true);
    expect(
      matchesItemMasterFilters(item(), {
        procurementType: "Direct",
        procurementCategory: "Production",
        itemGroup: "Raw Material",
      }),
    ).toBe(false);
  });

  it("filters by warehouse independently", () => {
    expect(
      matchesItemMasterFilters(item(), { warehouse: "Stores - BS" }),
    ).toBe(true);
    expect(
      matchesItemMasterFilters(item(), { warehouse: "Other - BS" }),
    ).toBe(false);
  });
});
