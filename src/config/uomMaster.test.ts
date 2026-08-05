import { describe, expect, it } from "vitest";

import {
  ENTERPRISE_UOM_MASTER,
  isValidImportUom,
  mergeUomDropdownOptions,
  normalizeToEnterpriseUom,
} from "./uomMaster";

describe("uomMaster", () => {
  it("contains the full enterprise list", () => {
    expect(ENTERPRISE_UOM_MASTER).toContain("Nos");
    expect(ENTERPRISE_UOM_MASTER).toContain("Sq Mtr");
    expect(ENTERPRISE_UOM_MASTER).toContain("Kit");
    expect(ENTERPRISE_UOM_MASTER.length).toBe(36);
  });

  it("normalizes aliases to enterprise UOMs", () => {
    expect(normalizeToEnterpriseUom("Litre")).toBe("Ltr");
    expect(normalizeToEnterpriseUom("kilogram")).toBe("Kg");
    expect(normalizeToEnterpriseUom("pcs")).toBe("Pcs");
    expect(normalizeToEnterpriseUom("square meter")).toBe("Sq Mtr");
    expect(normalizeToEnterpriseUom("Nos")).toBe("Nos");
  });

  it("rejects unknown UOMs for import", () => {
    expect(isValidImportUom("Fathom")).toBe(false);
    expect(isValidImportUom("")).toBe(false);
    expect(isValidImportUom("Ltr")).toBe(true);
    expect(isValidImportUom("liter")).toBe(true);
  });

  it("merges ERP extras under Other without dropping master values", () => {
    const { groups, all } = mergeUomDropdownOptions(["CustomUnit", "Nos"]);
    expect(all).toContain("Nos");
    expect(all).toContain("CustomUnit");
    expect(groups.some((g) => g.label === "Other (ERP)")).toBe(true);
  });
});
