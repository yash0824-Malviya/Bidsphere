import { describe, expect, it } from "vitest";
import {
  assertProcurementTypeCategory,
  DIRECT_PROCUREMENT_CATEGORIES,
  INDIRECT_PROCUREMENT_CATEGORIES,
  isProcurementCategory,
  normalizeProcurementCategoryValue,
  procurementCategoriesForType,
  procurementCategoryBelongsToType,
  procurementTypeForCategory,
  TEMPLATE_CATEGORY_TO_PROCUREMENT_TYPE,
} from "./procurementCategory";

describe("procurementCategory template and type mapping rules", () => {
  it("recognizes Raw Materials Procurement as Direct and rejects for Indirect", () => {
    expect(procurementCategoryBelongsToType("Raw Materials Procurement", "Direct")).toBe(true);
    expect(procurementCategoryBelongsToType("Raw Materials Procurement", "Indirect")).toBe(false);
  });

  it("assertProcurementTypeCategory passes for Raw Materials Procurement on Direct items", () => {
    expect(() => {
      assertProcurementTypeCategory("Direct", "Raw Materials Procurement");
    }).not.toThrow();
  });

  it("assertProcurementTypeCategory throws clear error for Raw Materials Procurement on Indirect items", () => {
    expect(() => {
      assertProcurementTypeCategory("Indirect", "Raw Materials Procurement");
    }).toThrow('Procurement Category "Raw Materials Procurement" is not valid for Indirect items.');
  });

  it("assertProcurementTypeCategory throws when category is missing or empty", () => {
    expect(() => {
      assertProcurementTypeCategory("Direct", "");
    }).toThrow("Procurement Category is required.");
    expect(() => {
      assertProcurementTypeCategory("Direct", "   ");
    }).toThrow("Procurement Category is required.");
  });

  it("resolves correct procurement type for template categories", () => {
    expect(procurementTypeForCategory("Raw Materials Procurement")).toBe("Direct");
    expect(procurementTypeForCategory("Spare Parts & Maintenance")).toBe("Direct");
    expect(procurementTypeForCategory("Electrical & Industrial Components")).toBe("Direct");
    expect(procurementTypeForCategory("Office Supplies")).toBe("Indirect");
    expect(procurementTypeForCategory("General Procurement")).toBe("Indirect");
    expect(procurementTypeForCategory("MRO Supplies")).toBe("Indirect");
  });

  it("maps all template categories to either Direct or Indirect", () => {
    for (const [tplCat, expectedType] of Object.entries(TEMPLATE_CATEGORY_TO_PROCUREMENT_TYPE)) {
      expect(procurementCategoryBelongsToType(tplCat, expectedType)).toBe(true);
      const oppositeType = expectedType === "Direct" ? "Indirect" : "Direct";
      expect(procurementCategoryBelongsToType(tplCat, oppositeType)).toBe(false);
    }
  });

  it("preserves canonical master lists untouched", () => {
    expect(DIRECT_PROCUREMENT_CATEGORIES).toEqual([
      "Production",
      "Engineering",
      "Packaging",
      "Tooling",
      "Raw Material",
    ]);
    expect(procurementCategoriesForType("Direct")).toEqual(DIRECT_PROCUREMENT_CATEGORIES);
    expect(procurementCategoriesForType("Indirect")).toEqual(INDIRECT_PROCUREMENT_CATEGORIES);
  });
});
