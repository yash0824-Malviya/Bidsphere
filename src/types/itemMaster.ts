/**
 * Item Master procurement fields — provisioned by scripts/setup-item-master-procurement.mjs
 */

import type { MaterialRequestProcurementType } from "./materialRequestWorkflow";

/** ERPNext custom field — Direct / Indirect procurement classification. */
export const ITEM_PROCUREMENT_TYPE_FIELD = "custom_procurement_type";

/** ERPNext custom field — procurement category (linked to type). */
export const ITEM_PROCUREMENT_CATEGORY_FIELD = "custom_procurement_category";

/** ERPNext custom field — Active / Inactive / Obsolete lifecycle. */
export const ITEM_LIFECYCLE_STATUS_FIELD = "custom_bidsphere_item_status";

/** ERPNext custom field — maximum stock threshold. */
export const ITEM_MAX_STOCK_FIELD = "custom_max_stock";

export type ItemLifecycleStatus = "Active" | "Inactive" | "Obsolete";

export const ITEM_LIFECYCLE_STATUSES: ItemLifecycleStatus[] = [
  "Active",
  "Inactive",
  "Obsolete",
];

export function normalizeItemLifecycleStatus(
  value: string | null | undefined,
): ItemLifecycleStatus {
  const v = String(value ?? "").trim();
  if (v === "Inactive" || v === "Obsolete") return v;
  return "Active";
}

/** Items available for MR / RFQ transactional pickers. */
export function isItemActiveForTransactions(input: {
  lifecycle_status?: string | null;
  disabled?: 0 | 1 | boolean | null;
}): boolean {
  const status = normalizeItemLifecycleStatus(input.lifecycle_status);
  if (status !== "Active") return false;
  if (input.disabled === 1 || input.disabled === true) return false;
  return true;
}

export interface ItemMasterProcurementFields {
  procurement_type: MaterialRequestProcurementType | "";
  procurement_category: string;
  lifecycle_status: ItemLifecycleStatus;
}
