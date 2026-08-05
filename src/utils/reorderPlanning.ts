/**
 * Warehouse reorder planning — inventory status + future auto-MR hooks.
 *
 * Status rules (Current Stock / on-hand):
 * - Current Stock == 0                         → Out of Stock
 * - 0 < Current Stock <= Reorder Level          → Reorder Required
 * - Current Stock > Reorder Level               → In Stock
 * - Reorder Level not configured (≤ 0)          → In Stock when qty > 0, else Out of Stock
 *
 * Future: items with status Reorder Required / Out of Stock can feed
 * automatic Warehouse Material Request generation without UI changes —
 * use `listItemsEligibleForAutoReorderMr` / `isEligibleForAutoMaterialRequest`.
 */

export type WarehouseReorderStockStatus =
  | "In Stock"
  | "Reorder Required"
  | "Out of Stock";

/** @deprecated Prefer WarehouseReorderStockStatus — kept for older "Low Stock" call sites. */
export type LegacyLowStockStatus = "Low Stock";

export interface ReorderPlanningInput {
  item_code: string;
  item_name?: string;
  /** Bin / on-hand quantity (Current Stock). */
  current_stock: number;
  /** Free-to-promise quantity when distinct from current (optional). */
  available_qty?: number;
  /** Item.safety_stock mapped as reorder_level. 0 / empty = not configured. */
  reorder_level: number;
  warehouse?: string;
  stock_uom?: string;
}

export interface ReorderPlanningSnapshot {
  item_code: string;
  item_name: string;
  current_stock: number;
  available_qty: number;
  reorder_level: number;
  reorder_configured: boolean;
  status: WarehouseReorderStockStatus;
  warehouse: string;
  stock_uom: string;
  /** True when an auto MR could be raised once that feature is enabled. */
  eligible_for_auto_mr: boolean;
}

export function nonNegativeReorderQty(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

export function isReorderLevelConfigured(reorderLevel: unknown): boolean {
  return nonNegativeReorderQty(reorderLevel) > 0;
}

/** Display helper — empty reorder shows "Not Configured". */
export function formatReorderLevelDisplay(
  reorderLevel: unknown,
  uom?: string,
): string {
  const level = nonNegativeReorderQty(reorderLevel);
  if (level <= 0) return "Not Configured";
  const unit = String(uom ?? "").trim();
  return unit ? `${level.toLocaleString()} ${unit}` : level.toLocaleString();
}

/**
 * Calculate warehouse stock status from Current Stock + Reorder Level.
 * Uses Current Stock (on-hand), not reserved-adjusted available.
 */
export function resolveReorderStockStatus(
  currentStock: unknown,
  reorderLevel: unknown = 0,
): WarehouseReorderStockStatus {
  const current = nonNegativeReorderQty(currentStock);
  const reorder = nonNegativeReorderQty(reorderLevel);
  if (current <= 0) return "Out of Stock";
  if (reorder > 0 && current <= reorder) return "Reorder Required";
  return "In Stock";
}

export function isBelowReorderLevel(
  currentStock: unknown,
  reorderLevel: unknown,
): boolean {
  const status = resolveReorderStockStatus(currentStock, reorderLevel);
  return status === "Reorder Required" || status === "Out of Stock";
}

/** Highlight Reorder Level cell when stock is at/below the threshold. */
export function shouldHighlightReorderLevel(
  currentStock: unknown,
  reorderLevel: unknown,
): boolean {
  const reorder = nonNegativeReorderQty(reorderLevel);
  if (reorder <= 0) return false;
  const current = nonNegativeReorderQty(currentStock);
  return current <= reorder;
}

export function buildReorderPlanningSnapshot(
  input: ReorderPlanningInput,
): ReorderPlanningSnapshot {
  const current = nonNegativeReorderQty(input.current_stock);
  const available =
    input.available_qty != null
      ? nonNegativeReorderQty(input.available_qty)
      : current;
  const reorder = nonNegativeReorderQty(input.reorder_level);
  const status = resolveReorderStockStatus(current, reorder);
  return {
    item_code: input.item_code,
    item_name: input.item_name ?? input.item_code,
    current_stock: current,
    available_qty: available,
    reorder_level: reorder,
    reorder_configured: reorder > 0,
    status,
    warehouse: String(input.warehouse ?? "").trim(),
    stock_uom: String(input.stock_uom ?? "").trim(),
    eligible_for_auto_mr: isEligibleForAutoMaterialRequest({
      current_stock: current,
      reorder_level: reorder,
    }),
  };
}

/**
 * Future auto Material Request gate.
 * When auto-MR generation is enabled, call this to select candidates.
 * Does not create documents today — planning structure only.
 */
export function isEligibleForAutoMaterialRequest(input: {
  current_stock: unknown;
  reorder_level: unknown;
}): boolean {
  if (!isReorderLevelConfigured(input.reorder_level)) return false;
  return isBelowReorderLevel(input.current_stock, input.reorder_level);
}

/** Filter helper for future auto-MR jobs / scheduled warehouse tasks. */
export function listItemsEligibleForAutoReorderMr(
  items: ReorderPlanningInput[],
): ReorderPlanningSnapshot[] {
  return items
    .map(buildReorderPlanningSnapshot)
    .filter((row) => row.eligible_for_auto_mr);
}
