/**
 * Item Master procurement filtering — shared by list API and transactional pickers.
 */

import type { ProcurementCategory } from "../config/procurementCategory";
import type { MaterialRequestProcurementType } from "../types/materialRequestWorkflow";
import {
  isItemActiveForTransactions,
  normalizeItemLifecycleStatus,
  type ItemLifecycleStatus,
} from "../types/itemMaster";
import { resolveItemProcurement } from "./itemProcurementInfer";
import { itemGroupMatchesCategory } from "./procurementCategoryMatch";

export interface ItemProcurementFilterInput {
  procurement_type?: string | null;
  procurement_category?: string | null;
  item_group?: string | null;
  lifecycle_status?: string | null;
  disabled?: 0 | 1 | boolean | null;
}

export function itemMatchesProcurementType(
  item: ItemProcurementFilterInput,
  type: MaterialRequestProcurementType,
  category?: ProcurementCategory | "",
): boolean {
  // Resolve from the item's own fields only (never inject the filter category).
  // Corrects Stationery+Direct → Indirect; never defaults missing type to Direct.
  const resolved = resolveItemProcurement({
    procurement_type: item.procurement_type,
    procurement_category: item.procurement_category,
    item_group: item.item_group,
  });
  if (resolved.procurement_type) {
    return resolved.procurement_type === type;
  }

  // Legacy items without resolvable type: match via item group + category only.
  if (category && item.item_group) {
    return itemGroupMatchesCategory(item.item_group, category);
  }

  return false;
}

export function itemMatchesProcurementCategory(
  item: ItemProcurementFilterInput,
  category: ProcurementCategory,
): boolean {
  const resolved = resolveItemProcurement({
    procurement_type: item.procurement_type,
    procurement_category: item.procurement_category,
    item_group: item.item_group,
  });
  const stored = resolved.procurement_category.trim();
  if (stored) {
    return stored.toLowerCase() === category.trim().toLowerCase();
  }

  if (item.item_group) {
    return itemGroupMatchesCategory(item.item_group, category);
  }

  return false;
}

export function itemMatchesTransactionalFilters(
  item: ItemProcurementFilterInput,
  filters: {
    procurementType?: MaterialRequestProcurementType;
    procurementCategory?: ProcurementCategory | "";
    activeOnly?: boolean;
  },
): boolean {
  if (filters.activeOnly !== false && !isItemActiveForTransactions(item)) {
    return false;
  }
  if (
    filters.procurementType &&
    !itemMatchesProcurementType(
      item,
      filters.procurementType,
      filters.procurementCategory,
    )
  ) {
    return false;
  }
  if (
    filters.procurementCategory &&
    !itemMatchesProcurementCategory(item, filters.procurementCategory)
  ) {
    return false;
  }
  return true;
}

export function lifecycleStatusLabel(
  status: string | null | undefined,
): ItemLifecycleStatus {
  return normalizeItemLifecycleStatus(status);
}
