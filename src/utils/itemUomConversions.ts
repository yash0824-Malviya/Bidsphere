/**
 * Compatible UOM groups and conversion factors for RFQ line items.
 * Factors follow ERPNext semantics: qty_in_uom × conversion_factor = qty_in_stock_uom.
 */

import { resolveStockUomFromItem } from "./itemMasterUom";

export type UomCategory = "volume" | "weight" | "length" | "unit" | "unknown";

export interface CompatibleUomOption {
  uom: string;
  label: string;
  /** qty in this UOM × factor = qty in primary (stock) UOM */
  conversion_factor: number;
  is_primary?: boolean;
}

export interface ItemUomProfile {
  primary_uom: string;
  /** Item Master stock UOM (same as primary_uom). */
  default_uom?: string;
  options: CompatibleUomOption[];
  compatible_uoms?: CompatibleUomOption[];
}

/** Map synonyms / legacy ERP labels → BidSphere enterprise UOM master. */
const UOM_ALIASES: Record<string, string> = {
  l: "Ltr",
  ltr: "Ltr",
  litre: "Ltr",
  litres: "Ltr",
  liter: "Ltr",
  liters: "Ltr",
  gal: "Gal",
  gallon: "Gal",
  gallons: "Gal",
  ml: "Ml",
  milliliter: "Ml",
  millilitre: "Ml",
  milliliters: "Ml",
  millilitres: "Ml",
  "m3": "Cu Mtr",
  "m³": "Cu Mtr",
  "cubic meter": "Cu Mtr",
  "cubic metre": "Cu Mtr",
  "cu mtr": "Cu Mtr",
  "cu ft": "Cu Ft",
  "cubic feet": "Cu Ft",
  kg: "Kg",
  kilogram: "Kg",
  kilograms: "Kg",
  g: "G",
  gram: "G",
  grams: "G",
  t: "Ton",
  ton: "Ton",
  tonne: "Ton",
  "metric ton": "Ton",
  "metric tonne": "Ton",
  lb: "Lb",
  lbs: "Lb",
  pound: "Lb",
  m: "Mtr",
  mtr: "Mtr",
  meter: "Mtr",
  metre: "Mtr",
  meters: "Mtr",
  metres: "Mtr",
  cm: "Cm",
  centimeter: "Cm",
  mm: "Mm",
  millimeter: "Mm",
  ft: "Ft",
  foot: "Ft",
  feet: "Ft",
  in: "In",
  inch: "In",
  "sq ft": "Sq Ft",
  "sq mtr": "Sq Mtr",
  "square meter": "Sq Mtr",
  nos: "Nos",
  no: "Nos",
  unit: "Nos",
  units: "Nos",
  ea: "Nos",
  each: "Nos",
  pc: "Pcs",
  pcs: "Pcs",
};

const UOM_ABBREV: Record<string, string> = {
  Ltr: "Ltr",
  Gal: "Gal",
  Ml: "Ml",
  "Cu Mtr": "m³",
  "Cu Ft": "ft³",
  Ton: "t",
  Kg: "Kg",
  G: "g",
  Lb: "lb",
  Mtr: "m",
  Cm: "cm",
  Mm: "mm",
  Ft: "ft",
  In: "in",
  "Sq Ft": "ft²",
  "Sq Mtr": "m²",
  Nos: "Nos",
  Pcs: "Pcs",
  Box: "Box",
  Pack: "Pack",
  Carton: "Carton",
  Bag: "Bag",
  Pallet: "Pallet",
  Drum: "Drum",
};

interface CategoryUomRow {
  uom: string;
  conversion_factor?: number;
}

function categoryBaseFactor(rows: CategoryUomRow[]): number {
  const explicit = rows.find(
    (r) =>
      r.conversion_factor != null &&
      Number.isFinite(Number(r.conversion_factor)) &&
      Number(r.conversion_factor) === 1,
  );
  if (explicit) return 1;
  const first = rows.find(
    (r) =>
      r.conversion_factor != null &&
      Number.isFinite(Number(r.conversion_factor)) &&
      Number(r.conversion_factor) > 0,
  );
  return first ? Number(first.conversion_factor) : 1;
}

function factorFromCategoryRow(
  defaultUom: string,
  row: CategoryUomRow,
  categoryRows: CategoryUomRow[],
): number | null {
  const primary = defaultUom.trim();
  const target = row.uom.trim();
  if (!primary || !target) return null;
  if (primary.toLowerCase() === target.toLowerCase()) return 1;

  const rowFactor = Number(row.conversion_factor);
  if (!Number.isFinite(rowFactor) || rowFactor <= 0) return null;

  const primaryRow = categoryRows.find(
    (r) => r.uom.trim().toLowerCase() === primary.toLowerCase(),
  );
  const primaryFactor =
    primaryRow?.conversion_factor != null &&
    Number.isFinite(Number(primaryRow.conversion_factor)) &&
    Number(primaryRow.conversion_factor) > 0
      ? Number(primaryRow.conversion_factor)
      : categoryBaseFactor(categoryRows);

  if (primaryFactor <= 0) return null;
  return rowFactor / primaryFactor;
}

export function normalizeUomName(raw?: string | null): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const key = s.toLowerCase();
  return UOM_ALIASES[key] ?? s;
}

export function uomDisplayLabel(uom: string): string {
  const canonical = normalizeUomName(uom) || uom;
  const abbr = UOM_ABBREV[canonical];
  return abbr && abbr !== canonical ? `${canonical} (${abbr})` : canonical;
}

export function inferUomCategory(uom: string): UomCategory {
  const n = normalizeUomName(uom);
  if (["Ltr", "Gal", "Ml", "Cu Mtr", "Cu Ft", "Drum"].includes(n)) {
    return "volume";
  }
  if (["Kg", "Ton", "G", "Lb"].includes(n)) {
    return "weight";
  }
  if (["Mtr", "Cm", "Mm", "Ft", "In"].includes(n)) {
    return "length";
  }
  if (
    [
      "Nos",
      "Pcs",
      "Box",
      "Pack",
      "Carton",
      "Bag",
      "Pallet",
      "Dozen",
      "Set",
      "Pair",
      "Kit",
    ].includes(n)
  ) {
    return "unit";
  }
  return "unknown";
}

/**
 * Build compatible UOM options from ERPNext Item Master + UOM Category data.
 * No hardcoded UOM lists — callers must supply item/category rows from the API.
 */
export function assembleCompatibleUomOptions(
  defaultUom: string,
  itemUomRows: Array<{ uom?: string; conversion_factor?: number }> = [],
  categoryUomRows: CategoryUomRow[] = [],
): CompatibleUomOption[] {
  const primary = resolveStockUomFromItem(defaultUom);
  if (!primary) return [];

  const byKey = new Map<string, CompatibleUomOption>();

  function addOption(
    uom: string,
    conversion_factor: number,
    is_primary = false,
  ) {
    const name = String(uom ?? "").trim();
    if (!name) return;
    const factor = Number(conversion_factor);
    if (!Number.isFinite(factor) || factor <= 0) return;

    const key = name.toLowerCase();
    const existing = byKey.get(key);
    if (existing && !is_primary) return;

    byKey.set(key, {
      uom: name,
      label: uomDisplayLabel(name),
      conversion_factor: factor,
      is_primary,
    });
  }

  addOption(primary, 1, true);

  for (const row of itemUomRows) {
    const u = row.uom?.trim();
    if (!u || u.toLowerCase() === primary.toLowerCase()) continue;
    const cf = Number(row.conversion_factor);
    addOption(u, Number.isFinite(cf) && cf > 0 ? cf : 1);
  }

  for (const row of categoryUomRows) {
    const u = row.uom?.trim();
    if (!u || u.toLowerCase() === primary.toLowerCase()) continue;
    const cf = factorFromCategoryRow(primary, row, categoryUomRows);
    if (cf != null) addOption(u, cf);
  }

  const options = [...byKey.values()];
  options.sort((a, b) => {
    if (a.is_primary) return -1;
    if (b.is_primary) return 1;
    return a.uom.localeCompare(b.uom);
  });
  return options;
}

/** @deprecated Use assembleCompatibleUomOptions with ERPNext-sourced rows. */
export function buildCompatibleUomOptions(
  stockUom: string,
  itemUomRows: Array<{ uom?: string; conversion_factor?: number }> = [],
): CompatibleUomOption[] {
  return assembleCompatibleUomOptions(stockUom, itemUomRows);
}

export function erpConversionFactorForUom(
  selectedUom: string,
  options: CompatibleUomOption[],
): number {
  const key = normalizeUomName(selectedUom).toLowerCase();
  const hit = options.find(
    (o) => normalizeUomName(o.uom).toLowerCase() === key,
  );
  return hit?.conversion_factor ?? 1;
}

export function convertQtyBetweenUoms(
  qty: number,
  fromUom: string,
  toUom: string,
  options: CompatibleUomOption[],
): number {
  if (!Number.isFinite(qty)) return 0;
  const fromKey = normalizeUomName(fromUom).toLowerCase();
  const toKey = normalizeUomName(toUom).toLowerCase();
  if (fromKey === toKey) return qty;

  const from = options.find(
    (o) => normalizeUomName(o.uom).toLowerCase() === fromKey,
  );
  const to = options.find(
    (o) => normalizeUomName(o.uom).toLowerCase() === toKey,
  );
  if (!from || !to) return qty;

  const qtyInPrimary = qty * from.conversion_factor;
  const converted = qtyInPrimary / to.conversion_factor;
  return Math.round(converted * 1_000_000) / 1_000_000;
}

export function categoryBaseUom(category: UomCategory): string {
  switch (category) {
    case "volume":
      return "Liter";
    case "weight":
      return "Kilogram";
    case "length":
      return "Meter";
    case "unit":
      return "Nos";
    default:
      return "";
  }
}
