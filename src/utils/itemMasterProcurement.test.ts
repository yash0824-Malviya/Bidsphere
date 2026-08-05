import { describe, expect, it } from "vitest";

import {
  itemMatchesProcurementType,
  itemMatchesTransactionalFilters,
} from "./itemMasterProcurement";

describe("itemMasterProcurement", () => {
  it("matches items by stored procurement type", () => {
    expect(
      itemMatchesProcurementType(
        { procurement_type: "Direct", procurement_category: "Production" },
        "Direct",
        "Production",
      ),
    ).toBe(true);
    expect(
      itemMatchesProcurementType(
        { procurement_type: "Indirect", procurement_category: "OPEX" },
        "Direct",
        "Production",
      ),
    ).toBe(false);
  });

  it("falls back to item group for legacy items without procurement type", () => {
    expect(
      itemMatchesProcurementType(
        { item_group: "Raw Materials" },
        "Direct",
        "Raw Material",
      ),
    ).toBe(true);
    expect(
      itemMatchesProcurementType(
        { item_group: "IT Equipment" },
        "Direct",
        "Production",
      ),
    ).toBe(false);
  });

  it("does not treat missing procurement type as Direct", () => {
    expect(
      itemMatchesProcurementType({ procurement_type: "" }, "Direct"),
    ).toBe(false);
    expect(
      itemMatchesProcurementType({ procurement_type: "" }, "Indirect"),
    ).toBe(false);
  });

  it("treats legacy Stationery category as Indirect Office Supplies for MR filters", () => {
    expect(
      itemMatchesProcurementType(
        {
          procurement_type: "Direct",
          procurement_category: "Stationery",
          item_group: "Stationery",
        },
        "Indirect",
        "Office Supplies",
      ),
    ).toBe(true);
    expect(
      itemMatchesTransactionalFilters(
        {
          procurement_type: "Direct",
          procurement_category: "Stationery",
          item_group: "Stationery",
          lifecycle_status: "Active",
        },
        {
          procurementType: "Indirect",
          procurementCategory: "Office Supplies",
          activeOnly: true,
        },
      ),
    ).toBe(true);
  });

  it("excludes inactive items from transactional pickers", () => {
    expect(
      itemMatchesTransactionalFilters(
        {
          procurement_type: "Direct",
          lifecycle_status: "Inactive",
        },
        { procurementType: "Direct", activeOnly: true },
      ),
    ).toBe(false);
    expect(
      itemMatchesTransactionalFilters(
        {
          procurement_type: "Direct",
          lifecycle_status: "Active",
        },
        { procurementType: "Direct", activeOnly: true },
      ),
    ).toBe(true);
  });
});
