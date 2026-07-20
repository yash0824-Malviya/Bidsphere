import { describe, expect, it } from "vitest";
import {
  buildRfqListFilters,
  EMPTY_RFQ_FILTERS,
  getActiveRfqFilterChips,
  hasActiveRfqFilters,
} from "./rfqListFilters";

describe("buildRfqListFilters", () => {
  it("builds status and owner filters", () => {
    const built = buildRfqListFilters({
      ...EMPTY_RFQ_FILTERS,
      status: "Submitted",
      owner: "procurement@example.com",
    });
    expect(built.filters).toContainEqual([
      "status",
      "in",
      ["Submitted", "Open", "Replied"],
    ]);
    expect(built.filters).toContainEqual([
      "owner",
      "like",
      "%procurement@example.com%",
    ]);
  });

  it("searches RFQ number, Material Request, and Supplier", () => {
    const built = buildRfqListFilters({
      ...EMPTY_RFQ_FILTERS,
      search: "MAT-MR",
    });
    expect(built.or_filters).toEqual(
      expect.arrayContaining([
        ["name", "like", "%MAT-MR%"],
        [
          "Request for Quotation Item",
          "material_request",
          "like",
          "%MAT-MR%",
        ],
        [
          "Request for Quotation Supplier",
          "supplier_name",
          "like",
          "%MAT-MR%",
        ],
      ]),
    );
    expect(
      built.or_filters.some(
        (f) => Array.isArray(f) && f[0] === "Request for Quotation Item" && f[1] === "item_code",
      ),
    ).toBe(false);
  });

  it("does not emit unavailable custom fields", () => {
    const built = buildRfqListFilters({
      ...EMPTY_RFQ_FILTERS,
      status: "Draft",
    });
    expect(
      built.filters.some(
        (f) =>
          Array.isArray(f) &&
          typeof f[0] === "string" &&
          f[0].startsWith("custom_"),
      ),
    ).toBe(false);
  });
});

describe("rfq filter chips", () => {
  it("tracks active chips for the minimal filter set", () => {
    const state = {
      ...EMPTY_RFQ_FILTERS,
      status: "Completed" as const,
      owner: "alice@example.com",
    };
    expect(hasActiveRfqFilters(state)).toBe(true);
    expect(getActiveRfqFilterChips(state).map((c) => `${c.label}: ${c.value}`)).toEqual([
      "Status: Completed",
      "Owner: alice@example.com",
    ]);
  });
});
