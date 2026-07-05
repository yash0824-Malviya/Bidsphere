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
