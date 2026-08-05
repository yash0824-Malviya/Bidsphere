/** Item Master UOM helpers — shared by RFQ creation and item lookups. */

export const ITEM_MASTER_UOM_MISSING_MESSAGE =
  "This item has no UOM mapping configured.";

/** Normalize ERPNext `stock_uom` — never substitute a hardcoded default. */
export function resolveStockUomFromItem(
  stockUom?: string | null,
): string {
  return String(stockUom ?? "").trim();
}

export function hasItemMasterUom(uom?: string | null): boolean {
  return resolveStockUomFromItem(uom).length > 0;
}
