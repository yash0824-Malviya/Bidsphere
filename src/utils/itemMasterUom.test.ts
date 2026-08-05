import { describe, expect, it } from "vitest";
import {
  hasItemMasterUom,
  ITEM_MASTER_UOM_MISSING_MESSAGE,
  resolveStockUomFromItem,
} from "./itemMasterUom";

describe("itemMasterUom", () => {
  it("does not default missing UOM to Nos", () => {
    expect(resolveStockUomFromItem(null)).toBe("");
    expect(resolveStockUomFromItem("  ")).toBe("");
    expect(resolveStockUomFromItem("Liter")).toBe("Liter");
  });

  it("detects configured UOM", () => {
    expect(hasItemMasterUom("Kg")).toBe(true);
    expect(hasItemMasterUom("")).toBe(false);
  });

  it("exposes validation message", () => {
    expect(ITEM_MASTER_UOM_MISSING_MESSAGE).toContain("UOM mapping");
  });
});
