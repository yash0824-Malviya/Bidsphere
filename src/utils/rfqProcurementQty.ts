/**
 * Procurement Final Quantity helpers for RFQ line items.
 *
 * - Internal users see department / warehouse / procurement qty history.
 * - Suppliers only see RFQ Item.qty (= procurement final).
 * - Existing RFQs without custom fields fall back to `qty` for all three.
 */

import type { RFQItem } from "../types/erpnext";

export const QTY_CHANGE_REASONS = [
  "Minimum Order Quantity (MOQ)",
  "Annual Demand",
  "Safety Stock",
  "Forecast Demand",
  "Cost Optimization",
  "Bulk Discount",
  "Production Planning",
  "Manual Adjustment",
] as const;

export type QtyChangeReason = (typeof QTY_CHANGE_REASONS)[number];

function asQty(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Department requested qty with backward-compatible fallback to line qty. */
export function getDepartmentRequestedQty(
  item: Pick<RFQItem, "qty" | "custom_department_requested_qty"> | null | undefined,
): number {
  if (!item) return 0;
  return (
    asQty(item.custom_department_requested_qty) ??
    asQty(item.qty) ??
    0
  );
}

/** Warehouse available qty (null when unknown / legacy RFQ). */
export function getWarehouseAvailableQty(
  item: Pick<RFQItem, "custom_warehouse_available_qty"> | null | undefined,
): number | null {
  if (!item) return null;
  return asQty(item.custom_warehouse_available_qty);
}

/**
 * Procurement final qty — source of truth for sourcing.
 * Falls back to RFQ Item.qty for legacy documents.
 */
export function getProcurementFinalQty(
  item: Pick<RFQItem, "qty" | "custom_procurement_final_qty"> | null | undefined,
): number {
  if (!item) return 0;
  return (
    asQty(item.custom_procurement_final_qty) ??
    asQty(item.qty) ??
    0
  );
}

export function qtyChangedFromDepartment(
  item: Pick<
    RFQItem,
    "qty" | "custom_department_requested_qty" | "custom_procurement_final_qty"
  >,
): boolean {
  const dept = getDepartmentRequestedQty(item);
  const final = getProcurementFinalQty(item);
  return Math.abs(dept - final) > 1e-9;
}

/**
 * Strip internal qty trail fields before returning RFQ items to suppliers.
 * Keeps `qty` (= procurement final) only.
 */
export function sanitizeItemQtyForSupplier<T extends RFQItem>(item: T): T {
  const {
    custom_department_requested_qty: _d,
    custom_warehouse_available_qty: _w,
    custom_procurement_final_qty: _p,
    custom_qty_change_reason: _r,
    ...rest
  } = item as T & {
    custom_department_requested_qty?: number | null;
    custom_warehouse_available_qty?: number | null;
    custom_procurement_final_qty?: number | null;
    custom_qty_change_reason?: string | null;
  };
  const finalQty = getProcurementFinalQty(item);
  return {
    ...(rest as T),
    qty: finalQty > 0 ? finalQty : Number(item.qty) || 0,
  };
}
