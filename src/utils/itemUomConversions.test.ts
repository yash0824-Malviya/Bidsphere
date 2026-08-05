import { describe, expect, it } from "vitest";
import {
  assembleCompatibleUomOptions,
  buildCompatibleUomOptions,
  convertQtyBetweenUoms,
  inferUomCategory,
  normalizeUomName,
} from "./itemUomConversions";

describe("itemUomConversions", () => {
  it("normalizes common UOM aliases to enterprise master", () => {
    expect(normalizeUomName("L")).toBe("Ltr");
    expect(normalizeUomName("kg")).toBe("Kg");
    expect(normalizeUomName("Nos")).toBe("Nos");
    expect(normalizeUomName("Litre")).toBe("Ltr");
  });

  it("builds options from item master rows only", () => {
    const opts = assembleCompatibleUomOptions("Ltr", [
      { uom: "Gal", conversion_factor: 3.785 },
      { uom: "Ml", conversion_factor: 0.001 },
      { uom: "Drum", conversion_factor: 200 },
    ]);
    const names = opts.map((o) => o.uom);
    expect(names).toContain("Ltr");
    expect(names).toContain("Gal");
    expect(names).toContain("Ml");
    expect(names).toContain("Drum");
    expect(opts.find((o) => o.is_primary)?.uom).toBe("Ltr");
  });

  it("merges UOM category rows from ERPNext", () => {
    const opts = assembleCompatibleUomOptions(
      "Ton",
      [],
      [
        { uom: "Ton", conversion_factor: 1 },
        { uom: "Kg", conversion_factor: 0.001 },
        { uom: "G", conversion_factor: 0.000001 },
      ],
    );
    expect(opts.map((o) => o.uom)).toEqual(
      expect.arrayContaining(["Ton", "Kg", "G"]),
    );
  });

  it("merges item-specific UOM rows from Item Master", () => {
    const opts = assembleCompatibleUomOptions("Nos", [
      { uom: "Box", conversion_factor: 12 },
      { uom: "Pack", conversion_factor: 6 },
    ]);
    expect(opts.map((o) => o.uom)).toEqual(
      expect.arrayContaining(["Nos", "Box", "Pack"]),
    );
  });

  it("does not invent UOMs when no rows are provided", () => {
    const opts = buildCompatibleUomOptions("Ltr");
    expect(opts.map((o) => o.uom)).toEqual(["Ltr"]);
  });

  it("converts qty between compatible UOMs", () => {
    const opts = assembleCompatibleUomOptions("Ton", [], [
      { uom: "Ton", conversion_factor: 1 },
      { uom: "Kg", conversion_factor: 0.001 },
    ]);
    expect(convertQtyBetweenUoms(1000, "Kg", "Ton", opts)).toBe(1);
  });

  it("infers categories for display helpers", () => {
    expect(inferUomCategory("Ltr")).toBe("volume");
    expect(inferUomCategory("Liter")).toBe("volume");
    expect(inferUomCategory("Nos")).toBe("unit");
  });
});
