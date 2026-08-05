/**
 * Procurement Category — business classification for MR → RFQ → supplier matching.
 *
 * Distinct from ERPNext Item Group:
 * - Procurement Category = typed Direct / Indirect lists below
 * - Item Group = Electrical Materials / Stationery / Auto Parts / … (ERPNext tree)
 *
 * A category belongs to exactly one Procurement Type. Mixed combinations are invalid.
 */

import type { MaterialRequestProcurementType } from "../types/materialRequestWorkflow";

/** Direct Procurement Categories only. */
export const DIRECT_PROCUREMENT_CATEGORIES = [
  "Production",
  "Engineering",
  "Packaging",
  "Tooling",
  "Raw Material",
] as const;

/** Indirect Procurement Categories only. */
export const INDIRECT_PROCUREMENT_CATEGORIES = [
  "MRO",
  "CAPEX",
  "OPEX",
  "Services",
  "Facility",
  "Office Supplies",
  "IT",
  "Housekeeping",
] as const;

export type DirectProcurementCategory =
  (typeof DIRECT_PROCUREMENT_CATEGORIES)[number];
export type IndirectProcurementCategory =
  (typeof INDIRECT_PROCUREMENT_CATEGORIES)[number];
export type ProcurementCategory =
  | DirectProcurementCategory
  | IndirectProcurementCategory;

/** Full master = Direct ∪ Indirect (for ERP Select options / export headers). */
export const PROCUREMENT_CATEGORY_MASTER: ProcurementCategory[] = [
  ...DIRECT_PROCUREMENT_CATEGORIES,
  ...INDIRECT_PROCUREMENT_CATEGORIES,
];

export const ALL_PROCUREMENT_CATEGORIES: ProcurementCategory[] = [
  ...PROCUREMENT_CATEGORY_MASTER,
];

/**
 * Labels that were historically stored in custom_procurement_category but are
 * Item Group names or retired category labels — used to migrate legacy data.
 */
export const LEGACY_ITEM_GROUP_AS_CATEGORY_LABELS = [
  "Auto Parts",
  "Brake Assembly",
  "Engine Parts",
  "Transmission Assembly",
  "Suspension System",
  "Electrical Materials",
  "Ignition Components",
  "Products",
  "Mechanical",
  "Electrical",
  "Electronics",
  "Stationery",
  "IT Equipment",
  "Lubricants",
  "Consumables",
  "Fluids",
  "Logistics Services",
  "Maintenance Supplies",
  "Maintenance Services",
  "Inspection Services",
  "Safety",
  "Logistics",
] as const;

/** Map legacy labels → canonical typed Procurement Category. */
export const LEGACY_CATEGORY_TO_PROCUREMENT_CATEGORY: Record<
  string,
  ProcurementCategory
> = {
  "raw material": "Raw Material",
  "auto parts": "Production",
  "brake assembly": "Production",
  "engine parts": "Production",
  "transmission assembly": "Production",
  "suspension system": "Production",
  "electrical materials": "Engineering",
  "ignition components": "Engineering",
  products: "Production",
  mechanical: "Production",
  electrical: "Engineering",
  electronics: "Engineering",
  stationery: "Office Supplies",
  housekeeping: "Housekeeping",
  "it equipment": "IT",
  it: "IT",
  "office supplies": "Office Supplies",
  lubricants: "MRO",
  consumables: "MRO",
  fluids: "MRO",
  services: "Services",
  "logistics services": "Services",
  "maintenance supplies": "MRO",
  "maintenance services": "Services",
  "inspection services": "Services",
  safety: "Facility",
  logistics: "Services",
  packaging: "Packaging",
  tooling: "Tooling",
  mro: "MRO",
  capex: "CAPEX",
  opex: "OPEX",
  production: "Production",
  engineering: "Engineering",
  facility: "Facility",
};

export function procurementCategoriesForType(
  type: MaterialRequestProcurementType,
): readonly ProcurementCategory[] {
  return type === "Indirect"
    ? INDIRECT_PROCUREMENT_CATEGORIES
    : DIRECT_PROCUREMENT_CATEGORIES;
}

/**
 * Options for Procurement Category filters / dropdowns.
 * ALWAYS from the typed master — never ERPNext Item Groups.
 * (Item Groups like "Raw Material" / "Stationery" belong only in the Item Group filter.)
 */
export function procurementCategoryFilterOptions(
  type?: MaterialRequestProcurementType | "",
): readonly ProcurementCategory[] {
  if (type === "Direct" || type === "Indirect") {
    return procurementCategoriesForType(type);
  }
  return PROCUREMENT_CATEGORY_MASTER;
}

export function isProcurementCategory(
  value: string,
): value is ProcurementCategory {
  return (PROCUREMENT_CATEGORY_MASTER as readonly string[]).includes(
    value.trim(),
  );
}

function normCategory(value: string): string {
  return value.trim().toLowerCase();
}

/** Strict: category must belong to the selected Procurement Type. */
export function procurementCategoryBelongsToType(
  category: string,
  type: MaterialRequestProcurementType,
): boolean {
  const normalized = normCategory(category);
  if (!normalized) return false;
  return (procurementCategoriesForType(type) as readonly string[]).some(
    (c) => normCategory(c) === normalized,
  );
}

/** Throw if category is missing or does not belong to type (save/API guard). */
export function assertProcurementTypeCategory(
  type: MaterialRequestProcurementType,
  category: string,
): void {
  const cat =
    normalizeProcurementCategoryValue(category) || category.trim();
  if (!cat) {
    throw new Error("Procurement Category is required.");
  }
  if (!procurementCategoryBelongsToType(cat, type)) {
    throw new Error(
      `Procurement Category "${cat}" is not valid for ${type} items.`,
    );
  }
}

/** Detect values that look like Item Groups wrongly stored as category. */
export function isLegacyItemGroupAsCategory(value: string): boolean {
  const n = normCategory(value);
  if (!n || isProcurementCategory(value)) return false;
  return (LEGACY_ITEM_GROUP_AS_CATEGORY_LABELS as readonly string[]).some(
    (l) => normCategory(l) === n,
  );
}

/**
 * Normalize a stored category to the canonical master.
 * Migrates legacy item-group-like labels (Stationery → Office Supplies, etc.).
 */
export function normalizeProcurementCategoryValue(
  value: string | null | undefined,
): ProcurementCategory | "" {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (isProcurementCategory(raw)) return raw;
  const mapped = LEGACY_CATEGORY_TO_PROCUREMENT_CATEGORY[normCategory(raw)];
  return mapped ?? "";
}

/** Resolve which Procurement Type a category belongs to (if any). */
export function procurementTypeForCategory(
  category: string,
): MaterialRequestProcurementType | "" {
  const normalized = normalizeProcurementCategoryValue(category) || category;
  if (procurementCategoryBelongsToType(normalized, "Direct")) return "Direct";
  if (procurementCategoryBelongsToType(normalized, "Indirect")) return "Indirect";
  return "";
}

/**
 * Item Group keywords under each Procurement Category.
 * Used to filter ERP Item Groups in MR pickers — never as the category list itself.
 */
export const CATEGORY_ITEM_GROUP_KEYWORDS: Record<ProcurementCategory, string[]> =
  {
    Production: [
      "auto part",
      "brake",
      "engine",
      "transmission",
      "suspension",
      "production",
      "products",
      "manufacturing",
    ],
    Engineering: [
      "electrical material",
      "ignition",
      "engineering",
      "electrical",
      "electronic",
    ],
    Packaging: ["packaging", "packing", "carton", "label"],
    Tooling: ["tooling", "tool", "die", "mould", "mold", "fixture"],
    "Raw Material": [
      "raw material",
      "raw materials",
      "steel",
      "metal",
      "aluminum",
      "copper",
      "alloy",
    ],
    MRO: [
      "mro",
      "lubricant",
      "consumable",
      "fluid",
      "maintenance",
      "spare",
      "repair",
    ],
    CAPEX: ["capital", "machine", "equipment", "capex"],
    OPEX: ["opex", "admin", "operating"],
    Services: [
      "service",
      "logistics",
      "inspection",
      "calibration",
      "consulting",
    ],
    Facility: ["facility", "safety", "ppe"],
    "Office Supplies": ["office supplies", "office supply", "stationery", "stationary"],
    IT: ["it equipment", "it", "computer", "laptop", "network"],
    Housekeeping: [
      "housekeeping",
      "cleaning",
      "janitorial",
      "sanitation",
      "hygiene",
    ],
  };

export const CATEGORY_SUPPLIER_GROUP_KEYWORDS: Record<
  ProcurementCategory,
  string[]
> = {
  Production: ["production", "manufacturing", "automotive", "raw material"],
  Engineering: ["electrical", "electronics", "engineering"],
  Packaging: ["packaging"],
  Tooling: ["tooling", "capital equipment", "industrial equipment"],
  "Raw Material": ["raw material", "raw materials", "metals", "steel"],
  MRO: ["mro", "maintenance", "consumable", "lubricant", "chemical"],
  CAPEX: ["capital", "equipment", "machinery"],
  OPEX: ["opex", "office", "supplies"],
  Services: ["services", "logistics", "professional service"],
  Facility: ["facility", "safety"],
  "Office Supplies": ["office", "stationery", "supplies"],
  IT: ["it equipment", "it supplies", "office & it"],
  Housekeeping: ["housekeeping", "cleaning", "janitorial"],
};

/** Indirect catalog group per procurement category (Item Groups in catalog). */
export const INDIRECT_CATEGORY_CATALOG_GROUP: Partial<
  Record<IndirectProcurementCategory, string>
> = {
  MRO: "MRO",
  CAPEX: "IT Equipment",
  OPEX: "Office Supplies",
  Facility: "Housekeeping",
  Services: "Services",
  "Office Supplies": "Stationery",
  IT: "IT Equipment",
  Housekeeping: "Housekeeping",
};
