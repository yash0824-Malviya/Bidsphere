/**
 * Shared inventory quantity math for Warehouse / Stock Overview / MR review.
 *
 * Rules:
 * - Available Qty comes from ERPNext on-hand stock (Bin.actual_qty / Stock Balance)
 * - Available Qty is never negative in UI
 * - Shortage is computed separately and never reduces inventory below zero
 * - NEVER: availableQty = currentStock - requestedQty
 */

export type InventoryStockStatus = "In Stock" | "Low Stock" | "Out of Stock";

/** Coerce to a finite non-negative quantity. */
export function nonNegativeQty(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

/**
 * Map ERPNext on-hand stock into UI quantities.
 *
 * availableQty = ERPNext actual stock (clamped ≥ 0)
 * reservedQty is displayed separately and MUST NOT reduce Available below zero
 * for inventory display (shortage is a separate MR concept).
 */
export function computeBinAvailability(
  actualQty?: unknown,
  reservedQty?: unknown,
): {
  currentStock: number;
  reservedQty: number;
  availableQty: number;
  /** Raw ERPNext actual before clamp — for diagnostics only. */
  rawActualQty: number;
} {
  const rawActual = Number(actualQty);
  const rawActualQty = Number.isFinite(rawActual) ? rawActual : 0;
  const currentStock = nonNegativeQty(actualQty);
  const reserved = nonNegativeQty(reservedQty);
  // Available = ERPNext actual stock (not actual - reserved, not stock - requested).
  const availableQty = currentStock;
  return { currentStock, reservedQty: reserved, availableQty, rawActualQty };
}

/** shortageQty = max(0, requestedQty - availableQty) */
export function computeShortageQty(
  requestedQty: unknown,
  availableQty: unknown,
): number {
  return Math.max(
    0,
    nonNegativeQty(requestedQty) - nonNegativeQty(availableQty),
  );
}

/** remainingQty = max(0, availableQty - issueQty) */
export function computeRemainingAfterIssue(
  availableQty: unknown,
  issueQty: unknown,
): number {
  return Math.max(0, nonNegativeQty(availableQty) - nonNegativeQty(issueQty));
}

/**
 * Inventory status from Available Qty (+ optional reorder level).
 * - Available == 0 → Out of Stock
 * - 0 < Available <= reorder → Low Stock
 * - Available > reorder (or no reorder) → In Stock
 */
export function resolveInventoryStockStatus(
  availableQty: unknown,
  reorderLevel: unknown = 0,
): InventoryStockStatus {
  const available = nonNegativeQty(availableQty);
  const reorder = nonNegativeQty(reorderLevel);
  if (available <= 0) return "Out of Stock";
  if (reorder > 0 && available <= reorder) return "Low Stock";
  return "In Stock";
}
