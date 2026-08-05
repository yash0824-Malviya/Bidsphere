/**
 * Target Pricing helpers for RFQ line items.
 *
 * - Internal roles always see Target Price in the UI.
 * - Suppliers only see a line's Target Price when that line's show flag is ON
 *   (falls back to legacy RFQ-header flag for older documents).
 */

import type { RFQ, RFQItem, RequestForQuotation } from "../types/erpnext";
import { sanitizeItemAttachmentsForSupplier } from "./materialRequestItemFiles";
import { sanitizeItemQtyForSupplier } from "./rfqProcurementQty";

export function isTruthyFlag(value: unknown): boolean {
  if (value === true || value === 1 || value === "1") return true;
  if (typeof value === "string" && value.toLowerCase() === "true") return true;
  return false;
}

/** Legacy RFQ-header visibility (pre per-item flag). */
export function isTargetPriceVisibleToSupplier(
  rfq:
    | Pick<RequestForQuotation, "custom_show_target_price_to_supplier">
    | { show_target_price?: unknown }
    | null
    | undefined,
): boolean {
  if (!rfq) return false;
  if ("show_target_price" in rfq && rfq.show_target_price != null) {
    return isTruthyFlag(rfq.show_target_price);
  }
  return isTruthyFlag(
    (rfq as RequestForQuotation).custom_show_target_price_to_supplier,
  );
}

/** Per-line visibility with header fallback for backward compatibility. */
export function isItemTargetPriceVisibleToSupplier(
  item:
    | Pick<RFQItem, "custom_show_target_price_to_supplier">
    | { show_target_price?: unknown }
    | null
    | undefined,
  rfq?:
    | Pick<RequestForQuotation, "custom_show_target_price_to_supplier">
    | { show_target_price?: unknown }
    | null,
): boolean {
  if (!item) return false;
  if (
    "custom_show_target_price_to_supplier" in item &&
    item.custom_show_target_price_to_supplier != null
  ) {
    return isTruthyFlag(item.custom_show_target_price_to_supplier);
  }
  if ("show_target_price" in item && item.show_target_price != null) {
    return isTruthyFlag(item.show_target_price);
  }
  /* Older RFQs only have the header flag. */
  return isTargetPriceVisibleToSupplier(rfq);
}

export function getItemTargetPrice(
  item: Pick<RFQItem, "custom_target_price"> | { target_price?: number | null },
): number | null {
  const raw =
    "custom_target_price" in item && item.custom_target_price != null
      ? item.custom_target_price
      : "target_price" in item
        ? item.target_price
        : null;
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  /* ERPNext Currency empty values serialize as 0 — treat as "not set". */
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function isItemShowTargetPrice(item: {
  custom_show_target_price_to_supplier?: unknown;
  show_to_supplier?: unknown;
}): boolean {
  if (item.show_to_supplier != null) return isTruthyFlag(item.show_to_supplier);
  return isTruthyFlag(item.custom_show_target_price_to_supplier);
}

/** Supplier-facing RFQ shape with stable aliases for the portal. */
export type SupplierRfqView = RFQ & {
  show_target_price: boolean;
  items: Array<
    RFQItem & {
      target_price?: number | null;
      show_target_price?: boolean;
    }
  >;
};

/**
 * Prepare RFQ for supplier clients:
 * - Per-item: keep Target Price only when that line's show flag is ON
 * - When OFF: strip Target Price completely from that line
 * - Header show_target_price is true if any line is visible (portal convenience)
 * - Strip Internal Only engineering attachments (supplier-visible by default)
 */
export function sanitizeRfqForSupplier(rfq: RFQ): SupplierRfqView {
  const items = (rfq.items ?? []).map((it) => {
    const withDocs = sanitizeItemQtyForSupplier(
      sanitizeItemAttachmentsForSupplier(it),
    );
    const show = isItemTargetPriceVisibleToSupplier(withDocs, rfq);
    if (!show) {
      const {
        custom_target_price: _a,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        target_price: _b,
        ...rest
      } = withDocs as RFQItem & { target_price?: number | null };
      return {
        ...rest,
        custom_show_target_price_to_supplier: 0,
        show_target_price: false,
      } as RFQItem & { show_target_price: boolean };
    }
    const target = getItemTargetPrice(withDocs);
    return {
      ...withDocs,
      custom_target_price: target,
      target_price: target,
      custom_show_target_price_to_supplier: 1,
      show_target_price: true,
    };
  });

  const anyVisible = items.some((i) => i.show_target_price);

  return {
    ...rfq,
    show_target_price: anyVisible,
    custom_show_target_price_to_supplier: anyVisible ? 1 : 0,
    items,
  };
}

export interface TargetPriceVariance {
  item_code: string;
  qty: number;
  target_price: number | null;
  quoted_price: number;
  unit_variance: number | null;
  line_variance: number | null;
  potential_savings: number | null;
  variance_pct: number | null;
}

export function computeTargetPriceVariance(input: {
  items: Array<{ item_code: string; qty: number; custom_target_price?: number | null }>;
  quotedByItem: Map<string, { unit_price: number }>;
}): {
  lines: TargetPriceVariance[];
  totalTargetValue: number;
  totalQuotedValue: number;
  totalPotentialSavings: number;
  totalOverTarget: number;
} {
  const lines: TargetPriceVariance[] = [];
  let totalTargetValue = 0;
  let totalQuotedValue = 0;
  let totalPotentialSavings = 0;
  let totalOverTarget = 0;

  for (const it of input.items) {
    const qty = Number(it.qty) || 0;
    const target = getItemTargetPrice(it);
    const quoted = Number(input.quotedByItem.get(it.item_code)?.unit_price ?? 0) || 0;
    totalQuotedValue += quoted * qty;
    if (target != null) totalTargetValue += target * qty;

    const unit_variance =
      target != null && quoted > 0 ? quoted - target : null;
    const line_variance =
      unit_variance != null ? unit_variance * qty : null;
    const potential_savings =
      target != null && quoted > 0 && quoted < target
        ? (target - quoted) * qty
        : null;
    const variance_pct =
      target != null && target > 0 && quoted > 0
        ? ((quoted - target) / target) * 100
        : null;

    if (line_variance != null && line_variance > 0) totalOverTarget += line_variance;
    if (potential_savings != null) totalPotentialSavings += potential_savings;

    lines.push({
      item_code: it.item_code,
      qty,
      target_price: target,
      quoted_price: quoted,
      unit_variance,
      line_variance,
      potential_savings,
      variance_pct,
    });
  }

  return {
    lines,
    totalTargetValue,
    totalQuotedValue,
    totalPotentialSavings,
    totalOverTarget,
  };
}
