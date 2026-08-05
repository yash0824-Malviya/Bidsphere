import { describe, expect, it } from "vitest";

import {
  formatReorderLevelDisplay,
  isEligibleForAutoMaterialRequest,
  listItemsEligibleForAutoReorderMr,
  resolveReorderStockStatus,
  shouldHighlightReorderLevel,
} from "./reorderPlanning";

describe("reorderPlanning", () => {
  it("marks zero stock as Out of Stock", () => {
    expect(resolveReorderStockStatus(0, 10)).toBe("Out of Stock");
  });

  it("marks stock at/below reorder as Reorder Required", () => {
    expect(resolveReorderStockStatus(5, 10)).toBe("Reorder Required");
    expect(resolveReorderStockStatus(10, 10)).toBe("Reorder Required");
  });

  it("marks stock above reorder as In Stock", () => {
    expect(resolveReorderStockStatus(11, 10)).toBe("In Stock");
  });

  it("treats missing reorder as In Stock when qty > 0", () => {
    expect(resolveReorderStockStatus(3, 0)).toBe("In Stock");
    expect(formatReorderLevelDisplay(0)).toBe("Not Configured");
  });

  it("highlights reorder column only when configured and breached", () => {
    expect(shouldHighlightReorderLevel(5, 10)).toBe(true);
    expect(shouldHighlightReorderLevel(20, 10)).toBe(false);
    expect(shouldHighlightReorderLevel(0, 0)).toBe(false);
  });

  it("selects auto-MR candidates when below reorder", () => {
    const eligible = listItemsEligibleForAutoReorderMr([
      {
        item_code: "ST-001",
        current_stock: 2,
        reorder_level: 10,
        warehouse: "Stores",
      },
      {
        item_code: "OK-001",
        current_stock: 50,
        reorder_level: 10,
      },
      {
        item_code: "NC-001",
        current_stock: 0,
        reorder_level: 0,
      },
    ]);
    expect(eligible.map((r) => r.item_code)).toEqual(["ST-001"]);
    expect(
      isEligibleForAutoMaterialRequest({
        current_stock: 0,
        reorder_level: 5,
      }),
    ).toBe(true);
  });
});
