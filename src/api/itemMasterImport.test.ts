import { describe, expect, it } from "vitest";

import {
  validateItemImportRow,
  type ItemImportParsedRow,
} from "./itemMasterImport";

function row(
  overrides: Partial<ItemImportParsedRow> = {},
): ItemImportParsedRow {
  return {
    rowNumber: 2,
    item_code: "AB001",
    item_name: "Bumper",
    description: "Front bumper",
    procurement_type: "Direct",
    procurement_category: "Production",
    item_group: "Auto Parts",
    stock_uom: "Nos",
    item_type: "Stock",
    reorder_level: "10",
    default_warehouse: "",
    stock_item: "Yes",
    brand: "OEM",
    manufacturer: "ACME",
    status: "Active",
    raw: {},
    ...overrides,
  };
}

const erpCtx = {
  codesInFile: new Set<string>(),
  existingCodes: new Set<string>(),
  procurementTypes: ["Direct", "Indirect"],
  procurementCategories: [
    "Production",
    "Engineering",
    "Packaging",
    "Tooling",
    "Raw Material",
    "MRO",
    "CAPEX",
    "OPEX",
    "Services",
    "Facility",
    "Office Supplies",
    "IT",
    "Housekeeping",
  ],
  itemGroups: ["Products", "Consumables", "Auto Parts", "Stationery"],
  warehouses: [] as string[],
  uoms: ["Nos", "Kg", "Ltr"],
  brands: ["ExistingBrand"],
  manufacturers: ["ExistingMfr"],
  existingMode: "skip" as const,
  autoCreateMasters: true,
  autoCreateUom: true,
};

describe("validateItemImportRow (auto-create masters)", () => {
  it("accepts a new item for create with extended fields", () => {
    const result = validateItemImportRow(row(), erpCtx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.action).toBe("create");
      expect(result.input.procurement_category).toBe("Production");
      expect(result.input.item_group).toBe("Auto Parts");
      expect(result.input.brand).toBe("OEM");
      expect(result.input.ensure_brand).toBe(true);
      expect(result.input.manufacturer).toBe("ACME");
      expect(result.input.ensure_manufacturer).toBe(true);
    }
  });

  it("flags missing Procurement Category for auto-create (does not fail)", () => {
    const result = validateItemImportRow(
      row({ procurement_category: "Custom Direct Cat" }),
      {
        ...erpCtx,
        // Custom category not in typed master — still auto-create under Direct.
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.input.ensure_procurement_category).toBe(true);
      expect(result.input.procurement_category).toBe("Custom Direct Cat");
    }
  });

  it("flags missing typed category for auto-create when absent from ERP options", () => {
    const result = validateItemImportRow(
      row({ procurement_category: "Raw Material" }),
      {
        ...erpCtx,
        procurementCategories: ["Production", "MRO"],
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.input.ensure_procurement_category).toBe(true);
      expect(result.input.procurement_category).toBe("Raw Material");
    }
  });

  it("flags unknown Item Group for auto-create (does not fail)", () => {
    const result = validateItemImportRow(
      row({ item_group: "New Custom Group" }),
      erpCtx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.input.ensure_item_group).toBe(true);
      expect(result.input.item_group).toBe("New Custom Group");
    }
  });

  it("rejects UOMs outside the enterprise master", () => {
    const result = validateItemImportRow(row({ stock_uom: "Barrels" }), {
      ...erpCtx,
      autoCreateUom: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.outcome).toBe("failed");
      expect(result.error).toMatch(/not a valid enterprise UOM/);
    }
  });

  it("normalizes UOM aliases to enterprise values", () => {
    const result = validateItemImportRow(row({ stock_uom: "Litre" }), erpCtx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.input.stock_uom).toBe("Ltr");
    }
  });

  it("flags missing enterprise UOM for auto-create when not in ERP yet", () => {
    const result = validateItemImportRow(row({ stock_uom: "Pallet" }), {
      ...erpCtx,
      uoms: ["Nos", "Kg", "Ltr"],
      autoCreateUom: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.input.stock_uom).toBe("Pallet");
      expect(result.input.ensure_uom).toBe(true);
    }
  });

  it("rejects Indirect category on Direct type for typed masters", () => {
    const result = validateItemImportRow(
      row({
        procurement_type: "Direct",
        procurement_category: "MRO",
      }),
      erpCtx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.outcome).toBe("failed");
      expect(result.error).toMatch(/not valid for Direct/);
    }
  });

  it("skips existing codes when mode is skip", () => {
    const result = validateItemImportRow(row(), {
      ...erpCtx,
      existingCodes: new Set(["ab001"]),
      existingMode: "skip",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.outcome).toBe("skipped");
  });

  it("marks existing codes for update when mode is update", () => {
    const result = validateItemImportRow(row(), {
      ...erpCtx,
      existingCodes: new Set(["ab001"]),
      existingMode: "update",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.action).toBe("update");
  });

  it("fails missing Item Code / Item Name", () => {
    expect(validateItemImportRow(row({ item_code: "" }), erpCtx).ok).toBe(
      false,
    );
    expect(validateItemImportRow(row({ item_name: "" }), erpCtx).ok).toBe(
      false,
    );
  });

  it("reuses existing Brand / Manufacturer without ensure flags", () => {
    const result = validateItemImportRow(
      row({ brand: "ExistingBrand", manufacturer: "ExistingMfr" }),
      erpCtx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.input.ensure_brand).toBe(false);
      expect(result.input.ensure_manufacturer).toBe(false);
      expect(result.input.brand).toBe("ExistingBrand");
      expect(result.input.manufacturer).toBe("ExistingMfr");
    }
  });
});
