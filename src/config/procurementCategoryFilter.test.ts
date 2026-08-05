import { describe, expect, it } from "vitest";

import {
  DIRECT_PROCUREMENT_CATEGORIES,
  INDIRECT_PROCUREMENT_CATEGORIES,
  LEGACY_ITEM_GROUP_AS_CATEGORY_LABELS,
  PROCUREMENT_CATEGORY_MASTER,
  procurementCategoryFilterOptions,
} from "./procurementCategory";

describe("procurementCategoryFilterOptions (data source)", () => {
  it("loads only the Procurement Category master — never Item Groups", () => {
    const all = procurementCategoryFilterOptions();
    expect(all).toEqual(PROCUREMENT_CATEGORY_MASTER);
    for (const label of LEGACY_ITEM_GROUP_AS_CATEGORY_LABELS) {
      // Item Group names must not appear as filter options (except when they
      // intentionally share a name with a typed category, e.g. Raw Material).
      if (
        !(PROCUREMENT_CATEGORY_MASTER as readonly string[]).includes(label)
      ) {
        expect(all).not.toContain(label);
      }
    }
    expect(all).not.toContain("Stationery");
    expect(all).not.toContain("Auto Parts");
    expect(all).not.toContain("IT Equipment");
    expect(all).not.toContain("Electrical Materials");
  });

  it("filters Direct vs Indirect from the typed master only", () => {
    expect(procurementCategoryFilterOptions("Direct")).toEqual(
      DIRECT_PROCUREMENT_CATEGORIES,
    );
    expect(procurementCategoryFilterOptions("Indirect")).toEqual(
      INDIRECT_PROCUREMENT_CATEGORIES,
    );
  });

  it("keeps Raw Material as a Direct category (master), separate from Item Group filter", () => {
    expect(DIRECT_PROCUREMENT_CATEGORIES).toContain("Raw Material");
    expect(procurementCategoryFilterOptions("Indirect")).not.toContain(
      "Raw Material",
    );
  });
});
