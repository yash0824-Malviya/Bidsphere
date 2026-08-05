/**
 * Infer / correct Procurement Type + Category for ERP Items.
 *
 * Procurement Category is typed: Direct categories vs Indirect categories.
 * Never treat ERP Item Group names as Procurement Categories.
 */

import {
  ALL_PROCUREMENT_CATEGORIES,
  isLegacyItemGroupAsCategory,
  isProcurementCategory,
  normalizeProcurementCategoryValue,
  procurementCategoryBelongsToType,
  procurementTypeForCategory,
  type ProcurementCategory,
} from "../config/procurementCategory";
import type { MaterialRequestProcurementType } from "../types/materialRequestWorkflow";
import { itemGroupMatchesCategory } from "./procurementCategoryMatch";

const DIRECT_ITEM_GROUP_ALIASES = [
  "electrical materials",
  "transmission assembly",
  "suspension system",
  "ignition components",
  "auto part",
  "automotive",
  "raw materials",
  "raw material",
  "brake assembly",
  "engine parts",
  "manufacturing",
  "production",
] as const;

const INDIRECT_ITEM_GROUP_ALIASES = [
  "stationery",
  "stationary",
  "housekeeping",
  "consumable",
  "consumables",
  "facility",
  "janitorial",
  "cleaning",
  "lubricant",
  "office supplies",
  "logistics",
  "maintenance",
  "inspection",
  "it equipment",
] as const;

const ITEM_GROUP_TO_CATEGORY: Array<{
  match: string;
  category: ProcurementCategory;
}> = [
  { match: "stationery", category: "Office Supplies" },
  { match: "office", category: "Office Supplies" },
  { match: "housekeeping", category: "Housekeeping" },
  { match: "facility", category: "Facility" },
  { match: "safety", category: "Facility" },
  { match: "it equipment", category: "IT" },
  { match: "laptop", category: "IT" },
  { match: "lubricant", category: "MRO" },
  { match: "consumable", category: "MRO" },
  { match: "fluid", category: "MRO" },
  { match: "mro", category: "MRO" },
  { match: "service", category: "Services" },
  { match: "logistic", category: "Services" },
  { match: "inspection", category: "Services" },
  { match: "packaging", category: "Packaging" },
  { match: "tooling", category: "Tooling" },
  { match: "electrical", category: "Engineering" },
  { match: "ignition", category: "Engineering" },
  { match: "raw material", category: "Raw Material" },
  { match: "auto part", category: "Production" },
  { match: "brake", category: "Production" },
  { match: "engine", category: "Production" },
  { match: "transmission", category: "Production" },
  { match: "suspension", category: "Production" },
  { match: "product", category: "Production" },
];

function norm(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeProcurementTypeValue(
  value: string | null | undefined,
): MaterialRequestProcurementType | "" {
  const v = String(value ?? "").trim();
  return v === "Direct" || v === "Indirect" ? v : "";
}

export function inferProcurementTypeFromItemGroup(
  itemGroup: string,
): MaterialRequestProcurementType | "" {
  const n = norm(itemGroup);
  if (!n) return "";
  for (const a of INDIRECT_ITEM_GROUP_ALIASES) {
    if (n === a || n.includes(a)) return "Indirect";
  }
  for (const a of DIRECT_ITEM_GROUP_ALIASES) {
    if (n === a || n.includes(a)) return "Direct";
  }
  return "";
}

/** Infer type from a Procurement Category (strict typed master). */
export function inferProcurementTypeFromCategory(
  category: string,
): MaterialRequestProcurementType | "" {
  const mapped = normalizeProcurementCategoryValue(category);
  if (mapped) return procurementTypeForCategory(mapped);
  if (isLegacyItemGroupAsCategory(category)) {
    return inferProcurementTypeFromItemGroup(category);
  }
  return inferProcurementTypeFromItemGroup(category);
}

export function inferProcurementCategoryFromItemGroup(
  itemGroup: string,
  preferredType?: MaterialRequestProcurementType | "",
): ProcurementCategory | "" {
  const group = itemGroup.trim();
  if (!group) return "";

  const n = norm(group);
  for (const row of ITEM_GROUP_TO_CATEGORY) {
    if (n === row.match || n.includes(row.match)) {
      if (
        preferredType &&
        !procurementCategoryBelongsToType(row.category, preferredType)
      ) {
        continue;
      }
      return row.category;
    }
  }

  const pool: ProcurementCategory[] = preferredType
    ? (preferredType === "Indirect"
        ? [...ALL_PROCUREMENT_CATEGORIES].filter((c) =>
            procurementCategoryBelongsToType(c, "Indirect"),
          )
        : [...ALL_PROCUREMENT_CATEGORIES].filter((c) =>
            procurementCategoryBelongsToType(c, "Direct"),
          ))
    : [...ALL_PROCUREMENT_CATEGORIES];

  for (const cat of pool) {
    if (itemGroupMatchesCategory(group, cat)) return cat;
  }

  if (isProcurementCategory(group)) {
    if (
      !preferredType ||
      procurementCategoryBelongsToType(group, preferredType)
    ) {
      return group;
    }
  }
  return "";
}

export interface ResolvedItemProcurement {
  procurement_type: MaterialRequestProcurementType | "";
  procurement_category: string;
  inferred: boolean;
}

/**
 * Resolve display/persistence values.
 * Enforces: category must belong to type when both are present.
 */
export function resolveItemProcurement(input: {
  procurement_type?: string | null;
  procurement_category?: string | null;
  item_group?: string | null;
}): ResolvedItemProcurement {
  let type = normalizeProcurementTypeValue(input.procurement_type);
  const rawCategory = String(input.procurement_category ?? "").trim();
  let category = normalizeProcurementCategoryValue(rawCategory);
  let inferred = false;

  if (rawCategory && !category && isLegacyItemGroupAsCategory(rawCategory)) {
    category = normalizeProcurementCategoryValue(rawCategory);
    if (category) inferred = true;
  }

  if (input.item_group) {
    const inferredCat = inferProcurementCategoryFromItemGroup(
      String(input.item_group),
      type,
    );
    if (inferredCat) {
      // Prefer group-derived category when missing, or when a broader legacy
      // category was stored (e.g. Raw Material group saved as Production).
      const replaceableByGroup: Partial<Record<ProcurementCategory, string[]>> =
        {
          "Raw Material": ["Production", ""],
          "Office Supplies": ["OPEX", ""],
          IT: ["CAPEX", ""],
          Housekeeping: ["Facility", "OPEX", ""],
        };
      const replaceable = replaceableByGroup[inferredCat];
      if (
        !category ||
        (replaceable && replaceable.includes(category))
      ) {
        if (category !== inferredCat) {
          category = inferredCat;
          inferred = true;
        }
      }
    }
  }

  if (!category && rawCategory && isProcurementCategory(rawCategory)) {
    category = rawCategory;
  }

  // Category is typed — type must match. Prefer category when they conflict.
  if (category) {
    const fromCat = procurementTypeForCategory(category);
    if (fromCat && type !== fromCat) {
      type = fromCat;
      inferred = true;
    }
  }

  if (!type && input.item_group) {
    type = inferProcurementTypeFromItemGroup(String(input.item_group));
    if (type) inferred = true;
  }

  if (rawCategory && category && norm(rawCategory) !== norm(category)) {
    inferred = true;
  }

  return { procurement_type: type, procurement_category: category, inferred };
}

export function isProcurementNotAssigned(input: {
  procurement_type?: string | null;
  procurement_category?: string | null;
  item_group?: string | null;
}): boolean {
  const resolved = resolveItemProcurement(input);
  return !resolved.procurement_type && !resolved.procurement_category;
}
