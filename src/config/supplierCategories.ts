export const SUPPLIER_CATEGORIES = [
  "Raw Materials",
  "Manufacturing Components",
  "Electrical & Electronics",
  "Industrial Equipment",
  "MRO (Maintenance, Repair & Operations)",
  "Logistics & Transportation",
  "Packaging",
  "Chemicals & Consumables",
  "Office & IT Supplies",
  "Professional Services",
  "Facility Management",
  "Capital Equipment",
] as const;

export type SupplierCategory = (typeof SUPPLIER_CATEGORIES)[number];

const CATEGORY_SET = new Set<string>(SUPPLIER_CATEGORIES);

export function isSupplierCategory(value: string | null | undefined): value is SupplierCategory {
  return Boolean(value && CATEGORY_SET.has(value));
}

