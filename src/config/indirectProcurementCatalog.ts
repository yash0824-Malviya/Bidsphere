/**
 * Indirect procurement catalog.
 *
 * Indirect (office / admin) Material Requests are DELIBERATELY isolated from the
 * RFQ / manufacturing Item Group flow used by Direct procurement. Department
 * users choosing "Indirect" see ONLY the fixed office catalog below.
 *
 * The item codes here are the source of truth for the dropdowns; at runtime the
 * matching ERPNext Items are fetched by code (see `getItemsByCodes`) so the real
 * ERPNext name / description / UOM are used for auto-fill and submission. The
 * `description` / `uom` values below are only fallbacks used for display when an
 * item has not yet been created in ERPNext.
 *
 * Indirect workflow (never touches the RFQ module):
 *   Indirect Request → Admin Approval → Purchase Order → Warehouse Receipt →
 *   Department Issue.
 */

export interface IndirectCatalogItem {
  code: string;
  name: string;
  description: string;
  uom: string;
}

/** The only Item Groups shown for Indirect procurement. */
export const INDIRECT_ITEM_GROUPS = [
  "Housekeeping",
  "IT Equipment",
  "Stationery",
] as const;

export type IndirectItemGroup = (typeof INDIRECT_ITEM_GROUPS)[number];

/** Items available per Indirect Item Group. */
export const INDIRECT_CATALOG: Record<string, IndirectCatalogItem[]> = {
  Housekeeping: [
    { code: "HK-001", name: "Floor Cleaner", description: "Floor Cleaner", uom: "Litre" },
    { code: "HK-002", name: "Glass Cleaner", description: "Glass Cleaner", uom: "Litre" },
    { code: "HK-003", name: "Garbage Bags", description: "Garbage Bags", uom: "Pack" },
    { code: "HK-004", name: "Tissue Paper", description: "Tissue Paper", uom: "Pack" },
    { code: "HK-005", name: "Hand Wash", description: "Hand Wash", uom: "Litre" },
  ],
  "IT Equipment": [
    { code: "IT-001", name: "Laptop", description: "Laptop", uom: "Nos" },
    { code: "IT-002", name: "Desktop Computer", description: "Desktop Computer", uom: "Nos" },
    { code: "IT-003", name: "Monitor", description: "Monitor", uom: "Nos" },
    { code: "IT-004", name: "Keyboard", description: "Keyboard", uom: "Nos" },
    { code: "IT-005", name: "Mouse", description: "Mouse", uom: "Nos" },
  ],
  Stationery: [
    { code: "ST-001", name: "A4 Paper", description: "A4 Paper", uom: "Ream" },
    { code: "ST-002", name: "Ball Pen", description: "Ball Pen", uom: "Nos" },
    { code: "ST-003", name: "Spiral Notebook", description: "Spiral Notebook", uom: "Nos" },
    { code: "ST-004", name: "Stapler", description: "Stapler", uom: "Nos" },
    { code: "ST-005", name: "File Folder", description: "File Folder", uom: "Nos" },
  ],
};

/** All catalog item codes for a given Indirect Item Group. */
export function indirectItemCodesFor(group: string): string[] {
  return (INDIRECT_CATALOG[group] ?? []).map((i) => i.code);
}
