/**
 * Shared procurement category matching for items and suppliers.
 * Used by MR item pickers (client) and recommend-suppliers API (server import).
 */

import {
  CATEGORY_ITEM_GROUP_KEYWORDS,
  CATEGORY_SUPPLIER_GROUP_KEYWORDS,
  procurementCategoriesForType,
  isProcurementCategory,
  type ProcurementCategory,
} from "../config/procurementCategory";
import type { MaterialRequestProcurementType } from "../types/materialRequestWorkflow";

function norm(value: string): string {
  return value.trim().toLowerCase();
}

/** Case-insensitive fuzzy match between a label and keyword hints. */
export function labelMatchesKeywords(
  label: string,
  keywords: readonly string[],
): boolean {
  const n = norm(label);
  if (!n) return false;
  for (const kw of keywords) {
    const k = norm(kw);
    if (!k) continue;
    if (n === k || n.includes(k) || k.includes(n)) return true;
  }
  return false;
}

export function itemGroupMatchesCategory(
  itemGroup: string,
  category: ProcurementCategory,
): boolean {
  const keywords = CATEGORY_ITEM_GROUP_KEYWORDS[category] ?? [];
  return labelMatchesKeywords(itemGroup, keywords);
}

export function supplierSignalMatchesCategory(
  signal: string,
  category: ProcurementCategory,
): boolean {
  const direct = norm(signal) === norm(category);
  if (direct) return true;
  const keywords = CATEGORY_SUPPLIER_GROUP_KEYWORDS[category] ?? [];
  return labelMatchesKeywords(signal, keywords);
}

/** Parse Supplier.custom_procurement_categories JSON array (best-effort). */
export function parseSupplierProcurementCategories(
  raw: string | null | undefined,
): string[] {
  const text = String(raw ?? "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .map((v) => String(v ?? "").trim())
        .filter(Boolean);
    }
  } catch {
    /* fall through — treat as comma/newline separated */
  }
  return text
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function collectSupplierCategorySignals(input: {
  custom_procurement_categories?: string | null;
  custom_supplier_category?: string | null;
  supplier_group?: string | null;
}): string[] {
  const set = new Set<string>();
  for (const c of parseSupplierProcurementCategories(
    input.custom_procurement_categories,
  )) {
    set.add(c);
  }
  for (const legacy of [
    input.custom_supplier_category,
    input.supplier_group,
  ]) {
    const v = String(legacy ?? "").trim();
    if (v) set.add(v);
  }
  return [...set];
}

export function supplierMatchesProcurementCategory(
  signals: readonly string[],
  category: ProcurementCategory,
): boolean {
  if (!category) return false;
  return signals.some((s) => supplierSignalMatchesCategory(s, category));
}

export function commodityMatchesSignals(
  commodity: string,
  signals: readonly string[],
): boolean {
  const c = norm(commodity);
  if (!c) return false;
  return signals.some((s) => {
    const n = norm(s);
    return n === c || n.includes(c) || c.includes(n);
  });
}

export function itemGroupMatchesSignals(
  itemGroup: string,
  signals: readonly string[],
): boolean {
  const g = norm(itemGroup);
  if (!g) return false;
  return signals.some((s) => {
    const n = norm(s);
    return n === g || n.includes(g) || g.includes(n);
  });
}

export type SupplierMatchScoreInput = {
  category: ProcurementCategory;
  commodity?: string;
  item_groups?: string[];
  signals: readonly string[];
  preferred?: boolean;
  past_po_count?: number;
  past_rfq_count?: number;
  quality_rating?: number | null;
  delivery_rating?: number | null;
};

/** Rank suppliers 0–100 for AI recommendation display. */
export function scoreSupplierMatch(input: SupplierMatchScoreInput): {
  score: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  let score = 20;

  if (supplierMatchesProcurementCategory(input.signals, input.category)) {
    score += 40;
    reasons.push(`Procurement Category: ${input.category}`);
  }

  const commodity = String(input.commodity ?? "").trim();
  if (commodity && commodityMatchesSignals(commodity, input.signals)) {
    score += 20;
    reasons.push(`Commodity: ${commodity}`);
  }

  const groups = (input.item_groups ?? []).filter(Boolean);
  const groupHit = groups.find((g) => itemGroupMatchesSignals(g, input.signals));
  if (groupHit) {
    score += 15;
    reasons.push(`Item Group: ${groupHit}`);
  }

  if (input.preferred) {
    score += 10;
    reasons.push("Preferred supplier");
  }

  const po = Math.max(0, Number(input.past_po_count) || 0);
  if (po > 0) {
    score += Math.min(8, po * 2);
    reasons.push(`${po} past PO${po === 1 ? "" : "s"}`);
  }

  const rfq = Math.max(0, Number(input.past_rfq_count) || 0);
  if (rfq > 0) {
    score += Math.min(5, rfq * 2);
    reasons.push(`${rfq} recent RFQ${rfq === 1 ? "" : "s"}`);
  }

  const quality = input.quality_rating;
  if (quality != null && Number.isFinite(quality) && quality > 0) {
    score += Math.min(5, quality / 20);
    reasons.push(`Quality ${Math.round(quality)}%`);
  }

  const delivery = input.delivery_rating;
  if (delivery != null && Number.isFinite(delivery) && delivery > 0) {
    score += Math.min(5, delivery / 20);
    reasons.push(`Delivery ${Math.round(delivery)}%`);
  }

  if (reasons.length === 0) reasons.push("Active supplier");

  return { score: Math.min(100, Math.round(score)), reasons };
}

export function filterItemGroupsForCategory<T extends { name: string; item_group_name?: string }>(
  groups: T[],
  category: ProcurementCategory | "",
): T[] {
  if (!category) return groups;
  return groups.filter((g) => {
    const label = g.item_group_name || g.name;
    return itemGroupMatchesCategory(label, category as ProcurementCategory);
  });
}

/** True when an ERP Item Group belongs to the current Request Type's categories. */
export function itemGroupAllowedForProcurementType(
  itemGroup: string,
  procurementType: MaterialRequestProcurementType,
): boolean {
  const label = itemGroup.trim();
  if (!label) return false;
  const categories = procurementCategoriesForType(procurementType);
  return categories.some((cat) =>
    itemGroupMatchesCategory(label, cat as ProcurementCategory),
  );
}

/**
 * Filter ERP Item Groups for MR item pickers.
 * When a Procurement Category is selected, only matching groups are shown.
 * Otherwise, restrict to groups that belong to the Request Type (Direct vs Indirect).
 */
export function filterItemGroupsForMrPicker<
  T extends { name: string; item_group_name?: string },
>(
  groups: T[],
  options: {
    procurementType: MaterialRequestProcurementType;
    procurementCategory?: ProcurementCategory | "";
  },
): T[] {
  const { procurementType, procurementCategory = "" } = options;
  if (
    procurementCategory &&
    isProcurementCategory(procurementCategory)
  ) {
    return filterItemGroupsForCategory(groups, procurementCategory);
  }
  return groups.filter((g) =>
    itemGroupAllowedForProcurementType(
      g.item_group_name || g.name,
      procurementType,
    ),
  );
}

/** Resolve ERP item group names matching the active procurement category. */
export function itemGroupNamesForCategory<
  T extends { name: string; item_group_name?: string },
>(groups: T[], category: ProcurementCategory | ""): string[] {
  return filterItemGroupsForCategory(groups, category).map((g) => g.name);
}
