/**
 * Shared inventory quantity math for Warehouse / Stock Overview / MR review.
 *
 * Rules:
 * - Available Qty comes from ERPNext on-hand stock (Bin.actual_qty / Stock Balance)
 * - Available Qty is never negative in UI
 * - Shortage is computed separately and never reduces inventory below zero
 * - NEVER: availableQty = currentStock - requestedQty
 * - Stock status / reorder planning: see `reorderPlanning.ts`
 */

import {
  resolveReorderStockStatus,
  type WarehouseReorderStockStatus,
} from "./reorderPlanning";

export type InventoryStockStatus = WarehouseReorderStockStatus;

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
 * Inventory status from Current Stock (+ optional reorder level).
 * - Current == 0 → Out of Stock (red)
 * - 0 < Current <= reorder → Reorder Required (orange)
 * - Current > reorder (or no reorder) → In Stock (green)
 */
export function resolveInventoryStockStatus(
  currentStock: unknown,
  reorderLevel: unknown = 0,
): InventoryStockStatus {
  return resolveReorderStockStatus(currentStock, reorderLevel);
}
