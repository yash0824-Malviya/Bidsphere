/** Enterprise material categories — mapped to ERPNext Item Group names when present. */
export const MATERIAL_REQUEST_CATEGORIES = [
  "Raw Materials",
  "Components",
  "Consumables",
  "MRO",
  "Office Supplies",
  "IT Equipment",
  "Packaging",
  "Safety Equipment",
] as const;

export type MaterialRequestCategory =
  (typeof MATERIAL_REQUEST_CATEGORIES)[number];

export interface ItemGroupLike {
  name: string;
  item_group_name?: string;
}

/** Resolve a UI category label to the ERPNext Item Group `name` used in filters. */
export function resolveCategoryToItemGroup(
  category: string,
  groups: ItemGroupLike[]
): string {
  if (!category) return "";
  const direct = groups.find(
    (g) => g.name === category || g.item_group_name === category
  );
  if (direct) return direct.name;

  const lower = category.toLowerCase();
  const fuzzy = groups.find(
    (g) =>
      g.name.toLowerCase() === lower ||
      (g.item_group_name?.toLowerCase() ?? "") === lower
  );
  return fuzzy?.name ?? category;
}

/* ─── Procurement-type–aware Item Group classification ───────────────────── */

/**
 * Broad classification of an ERPNext Item Group so the Material Request form can
 * show only the relevant categories for the selected Procurement Type:
 *   • "manufacturing" → Direct procurement (raw materials, spares, components…)
 *   • "office"        → Indirect procurement (stationery, IT, housekeeping…)
 *   • null            → couldn't be determined; shown under BOTH types so a
 *                       legitimate custom group is never accidentally hidden.
 *
 * Classification is keyword-based on the live group name (never a hardcoded
 * whitelist), so it works with whatever Item Groups exist in the connected
 * ERPNext instance.
 */
export type ItemGroupCategoryKind = "manufacturing" | "office";

const MANUFACTURING_KEYWORDS = [
  "raw material",
  "raw",
  "packing",
  "packaging",
  "consumable",
  "spare",
  "component",
  "part", // "Auto Parts", "Spare Parts", "Engine Parts"
  "auto",
  "electrical",
  "assembly",
  "sub assembly",
  "sub-assembly",
  "subassembly",
  "mechanical",
  "machine",
  "machining",
  "wiring",
  "pipe",
  "valve",
  "gear",
  "semi finished",
  "semi-finished",
  "finished good",
  "bearing",
  "steel",
  "metal",
  "motor",
  "engine",
  "hardware",
  "chemical",
  "fabrication",
  "tooling",
  "casting",
  "fastener",
  "lubricant",
  "production",
];

// Office / admin (indirect) indicators. Deliberately excludes ambiguous terms
// like "maintenance", "supplies" and "safety" — in this taxonomy groups such as
// "Maintenance Supplies" / "Maintenance Services" belong to Direct procurement,
// so they must NOT be pulled into the Indirect office list.
const OFFICE_KEYWORDS = [
  "stationery",
  "stationary",
  "office",
  "it equipment",
  "computer",
  "laptop",
  "desktop",
  "keyboard",
  "mouse",
  "printer",
  "peripheral",
  "housekeeping",
  "furniture",
  "pantry",
  "cleaning",
  "software",
  "license",
  "licence",
  "toner",
  "cartridge",
  "admin",
];

function matchesAny(haystack: string, keywords: string[]): boolean {
  return keywords.some((kw) => haystack.includes(kw));
}

export function classifyItemGroup(
  groupLabel: string
): ItemGroupCategoryKind | null {
  const label = groupLabel.trim().toLowerCase();
  if (!label) return null;
  // Office is checked first: a few terms (e.g. "maintenance") belong to the
  // support side even though they can sound operational.
  if (matchesAny(label, OFFICE_KEYWORDS)) return "office";
  if (matchesAny(label, MANUFACTURING_KEYWORDS)) return "manufacturing";
  return null;
}

/**
 * Filter Item Groups for the given Procurement Type.
 *
 * • Direct   → every ERPNext Item Group, exactly like the Procurement RFQ
 *              module (no category filtering, nothing hidden).
 * • Indirect → only office/admin groups (Housekeeping, IT Equipment,
 *              Stationery, …), resolved by keyword classification of the live
 *              group names — never a hardcoded list.
 */
export function filterItemGroupsByProcurementType<T extends ItemGroupLike>(
  groups: T[],
  procurementType: "Direct" | "Indirect"
): T[] {
  if (procurementType === "Direct") return groups;
  return groups.filter(
    (g) => classifyItemGroup(g.item_group_name || g.name) === "office"
  );
}
