import { describe, expect, it } from "vitest";
import { buildSupplierPOFilters } from "./supplierPortal";

describe("buildSupplierPOFilters", () => {
  it("filters by ERP Supplier Link id, not display name", () => {
    const filters = buildSupplierPOFilters("SUP-ATLANTIC");
    expect(filters).toContainEqual(["supplier", "=", "SUP-ATLANTIC"]);
  });

  it("includes Draft and Submitted so Pending Acceptance POs are visible", () => {
    const filters = buildSupplierPOFilters("SUP-001");
    expect(filters).toContainEqual(["docstatus", "in", [0, 1]]);
    expect(filters).not.toContainEqual(["docstatus", "=", 1]);
  });

  it("excludes Cancelled and Closed only", () => {
    const filters = buildSupplierPOFilters("SUP-001");
    expect(filters).toContainEqual(["status", "not in", ["Cancelled", "Closed"]]);
  });
});
