import { describe, expect, it } from "vitest";

import {
  inferProcurementTypeFromCategory,
  isProcurementNotAssigned,
  resolveItemProcurement,
} from "./itemProcurementInfer";

describe("itemProcurementInfer (typed categories)", () => {
  it("maps Direct categories to Direct", () => {
    expect(inferProcurementTypeFromCategory("Production")).toBe("Direct");
    expect(inferProcurementTypeFromCategory("Engineering")).toBe("Direct");
    expect(inferProcurementTypeFromCategory("Packaging")).toBe("Direct");
    expect(inferProcurementTypeFromCategory("Tooling")).toBe("Direct");
    expect(inferProcurementTypeFromCategory("Raw Material")).toBe("Direct");
  });

  it("maps Indirect categories to Indirect", () => {
    expect(inferProcurementTypeFromCategory("MRO")).toBe("Indirect");
    expect(inferProcurementTypeFromCategory("CAPEX")).toBe("Indirect");
    expect(inferProcurementTypeFromCategory("OPEX")).toBe("Indirect");
    expect(inferProcurementTypeFromCategory("Services")).toBe("Indirect");
    expect(inferProcurementTypeFromCategory("Facility")).toBe("Indirect");
    expect(inferProcurementTypeFromCategory("Office Supplies")).toBe("Indirect");
    expect(inferProcurementTypeFromCategory("IT")).toBe("Indirect");
    expect(inferProcurementTypeFromCategory("Housekeeping")).toBe("Indirect");
  });

  it("migrates legacy Stationery to Office Supplies / Indirect", () => {
    const resolved = resolveItemProcurement({
      procurement_type: "Direct",
      procurement_category: "Stationery",
      item_group: "Stationery",
    });
    expect(resolved.procurement_category).toBe("Office Supplies");
    expect(resolved.procurement_type).toBe("Indirect");
  });

  it("corrects Direct + OPEX invalid combination to Indirect", () => {
    const resolved = resolveItemProcurement({
      procurement_type: "Direct",
      procurement_category: "OPEX",
    });
    expect(resolved.procurement_type).toBe("Indirect");
    expect(resolved.procurement_category).toBe("OPEX");
  });

  it("infers Raw Material category from raw material item group", () => {
    const resolved = resolveItemProcurement({
      item_group: "Raw Materials",
    });
    expect(resolved.procurement_type).toBe("Direct");
    expect(resolved.procurement_category).toBe("Raw Material");
  });

  it("refines Production → Raw Material when item group is Raw Material", () => {
    const resolved = resolveItemProcurement({
      procurement_type: "Direct",
      procurement_category: "Production",
      item_group: "Raw Material",
    });
    expect(resolved.procurement_category).toBe("Raw Material");
    expect(resolved.procurement_type).toBe("Direct");
  });

  it("Not Assigned only when both type and category are missing", () => {
    expect(
      isProcurementNotAssigned({
        procurement_type: "",
        procurement_category: "",
        item_group: "",
      }),
    ).toBe(true);
  });
});
