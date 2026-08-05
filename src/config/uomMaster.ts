/**
 * Enterprise Unit of Measure master for BidSphere.
 *
 * ERPNext UOM DocType is synchronized from this list via
 * `scripts/setup-uom-master.mjs`. Dropdowns and import validation use these
 * values. Existing ERP UOMs outside the list remain valid for stored items
 * (no data loss) but new selections / imports must use the master.
 */

export const ENTERPRISE_UOM_MASTER = [
  "Nos",
  "Pcs",
  "Kg",
  "Lb",
  "G",
  "Ton",
  "Ltr",
  "Ml",
  "Gal",
  "Mtr",
  "Cm",
  "Mm",
  "Ft",
  "In",
  "Sq Ft",
  "Sq Mtr",
  "Cu Ft",
  "Cu Mtr",
  "Box",
  "Carton",
  "Pallet",
  "Roll",
  "Sheet",
  "Coil",
  "Set",
  "Pair",
  "Bag",
  "Drum",
  "Tube",
  "Bottle",
  "Can",
  "Pack",
  "Bundle",
  "Reel",
  "Dozen",
  "Kit",
] as const;

export type EnterpriseUom = (typeof ENTERPRISE_UOM_MASTER)[number];

/** Logical groups for dropdown optgroups (sorted within each group). */
export const ENTERPRISE_UOM_GROUPS: ReadonlyArray<{
  label: string;
  uoms: readonly EnterpriseUom[];
}> = [
  {
    label: "Count",
    uoms: ["Nos", "Pcs", "Dozen", "Pair", "Set", "Kit"],
  },
  {
    label: "Weight",
    uoms: ["G", "Kg", "Lb", "Ton"],
  },
  {
    label: "Volume",
    uoms: ["Ml", "Ltr", "Gal", "Cu Ft", "Cu Mtr"],
  },
  {
    label: "Length",
    uoms: ["Mm", "Cm", "Mtr", "In", "Ft"],
  },
  {
    label: "Area",
    uoms: ["Sq Ft", "Sq Mtr"],
  },
  {
    label: "Packaging",
    uoms: [
      "Bag",
      "Bottle",
      "Box",
      "Bundle",
      "Can",
      "Carton",
      "Coil",
      "Drum",
      "Pack",
      "Pallet",
      "Reel",
      "Roll",
      "Sheet",
      "Tube",
    ],
  },
];

/** Flat list sorted alphabetically (case-insensitive). */
export const ENTERPRISE_UOMS_ALPHA: readonly EnterpriseUom[] = [
  ...ENTERPRISE_UOM_MASTER,
].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

const MASTER_SET = new Set(
  ENTERPRISE_UOM_MASTER.map((u) => u.toLowerCase()),
);

/**
 * Map common synonyms / ERP defaults → enterprise canonical UOM.
 * Used for import normalization and dropdown matching.
 */
export const ENTERPRISE_UOM_ALIASES: Record<string, EnterpriseUom> = {
  nos: "Nos",
  no: "Nos",
  unit: "Nos",
  units: "Nos",
  ea: "Nos",
  each: "Nos",
  pc: "Pcs",
  pcs: "Pcs",
  piece: "Pcs",
  pieces: "Pcs",
  kg: "Kg",
  kilogram: "Kg",
  kilograms: "Kg",
  kgs: "Kg",
  lb: "Lb",
  lbs: "Lb",
  pound: "Lb",
  pounds: "Lb",
  g: "G",
  gram: "G",
  grams: "G",
  gm: "G",
  ton: "Ton",
  tonne: "Ton",
  tons: "Ton",
  "metric ton": "Ton",
  "metric tonne": "Ton",
  ltr: "Ltr",
  l: "Ltr",
  liter: "Ltr",
  litre: "Ltr",
  liters: "Ltr",
  litres: "Ltr",
  ml: "Ml",
  milliliter: "Ml",
  millilitre: "Ml",
  milliliters: "Ml",
  millilitres: "Ml",
  gal: "Gal",
  gallon: "Gal",
  gallons: "Gal",
  mtr: "Mtr",
  m: "Mtr",
  meter: "Mtr",
  metre: "Mtr",
  meters: "Mtr",
  metres: "Mtr",
  cm: "Cm",
  centimeter: "Cm",
  centimetre: "Cm",
  mm: "Mm",
  millimeter: "Mm",
  millimetre: "Mm",
  ft: "Ft",
  foot: "Ft",
  feet: "Ft",
  in: "In",
  inch: "In",
  inches: "In",
  "sq ft": "Sq Ft",
  "sq. ft": "Sq Ft",
  "sq.ft": "Sq Ft",
  "square feet": "Sq Ft",
  "square foot": "Sq Ft",
  "sq mtr": "Sq Mtr",
  "sq m": "Sq Mtr",
  "sq.m": "Sq Mtr",
  "square meter": "Sq Mtr",
  "square metre": "Sq Mtr",
  "cu ft": "Cu Ft",
  "cu. ft": "Cu Ft",
  "cubic feet": "Cu Ft",
  "cubic foot": "Cu Ft",
  "cu mtr": "Cu Mtr",
  "cu m": "Cu Mtr",
  "m3": "Cu Mtr",
  "m³": "Cu Mtr",
  "cubic meter": "Cu Mtr",
  "cubic metre": "Cu Mtr",
  box: "Box",
  carton: "Carton",
  pallet: "Pallet",
  roll: "Roll",
  sheet: "Sheet",
  coil: "Coil",
  set: "Set",
  pair: "Pair",
  bag: "Bag",
  drum: "Drum",
  tube: "Tube",
  bottle: "Bottle",
  can: "Can",
  pack: "Pack",
  bundle: "Bundle",
  reel: "Reel",
  dozen: "Dozen",
  doz: "Dozen",
  kit: "Kit",
};

function normKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** True if value is an exact enterprise master UOM (case-insensitive). */
export function isEnterpriseUom(value: string | null | undefined): boolean {
  const key = normKey(String(value ?? ""));
  return key.length > 0 && MASTER_SET.has(key);
}

/**
 * Normalize a free-text / ERP UOM to the enterprise canonical form.
 * Returns "" when the value cannot be mapped to the master.
 */
export function normalizeToEnterpriseUom(
  value: string | null | undefined,
): EnterpriseUom | "" {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const key = normKey(raw);
  if (MASTER_SET.has(key)) {
    return (
      ENTERPRISE_UOM_MASTER.find((u) => u.toLowerCase() === key) ?? ""
    );
  }
  return ENTERPRISE_UOM_ALIASES[key] ?? "";
}

/** Import / form validation: accept master values and known aliases. */
export function isValidImportUom(value: string | null | undefined): boolean {
  return normalizeToEnterpriseUom(value) !== "";
}

/** Options for a flat select (alphabetical). */
export function enterpriseUomOptionsAlpha(): readonly EnterpriseUom[] {
  return ENTERPRISE_UOMS_ALPHA;
}

/** Options for grouped select (logical groups). */
export function enterpriseUomGroups(): typeof ENTERPRISE_UOM_GROUPS {
  return ENTERPRISE_UOM_GROUPS;
}

/**
 * Merge ERP UOM names with the enterprise master for dropdowns.
 * Enterprise values come first (grouped); any extra ERP UOMs already in use
 * are appended under "Other (ERP)" so existing items keep a selectable value.
 */
export function mergeUomDropdownOptions(
  erpUoms: readonly string[] = [],
): {
  groups: Array<{ label: string; uoms: string[] }>;
  all: string[];
} {
  const groups = ENTERPRISE_UOM_GROUPS.map((g) => ({
    label: g.label,
    uoms: [...g.uoms],
  }));
  const masterLower = new Set(
    ENTERPRISE_UOM_MASTER.map((u) => u.toLowerCase()),
  );
  const extras = erpUoms
    .map((u) => u.trim())
    .filter(Boolean)
    .filter((u) => !masterLower.has(u.toLowerCase()))
    .filter(
      (u, i, arr) =>
        arr.findIndex((x) => x.toLowerCase() === u.toLowerCase()) === i,
    )
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  if (extras.length > 0) {
    groups.push({ label: "Other (ERP)", uoms: extras });
  }

  const all = groups.flatMap((g) => g.uoms);
  return { groups, all };
}
