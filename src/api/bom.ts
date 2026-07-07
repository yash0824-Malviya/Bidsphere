/**
 * ERPNext BOM (Bill of Materials) service.
 *
 * Powers the Material Request "Manufacturing Details" section: resolving the
 * active/default BOM for a finished product and exploding it into component
 * lines whose required quantities scale with the production quantity.
 *
 * Every figure comes from live ERPNext data — the `BOM` DocType and its
 * `BOM Item` child rows. No mock data.
 */

import { apiGet, buildListConfig, buildResourceUrl, withSilent } from "./erpnext";

const BOM_DOCTYPE = "BOM";

export interface BomSummary {
  /** BOM document name (e.g. "BOM-ITEM-0001"). */
  name: string;
  /** Finished-product item code the BOM produces. */
  item: string;
  item_name?: string;
  is_active: number;
  is_default: number;
  /** Output quantity the BOM's component quantities are expressed against. */
  quantity: number;
  uom?: string;
}

export interface BomFinishedItem {
  item_code: string;
  item_name: string;
}

export interface BomComponent {
  item_code: string;
  item_name: string;
  description?: string;
  uom: string;
  item_group?: string;
  /** Component stock quantity required to produce `bomQuantity` output units. */
  qtyForBomOutput: number;
  /** Output quantity `qtyForBomOutput` is expressed against (BOM header qty). */
  bomQuantity: number;
}

interface RawBomRow {
  name: string;
  item?: string;
  item_name?: string;
  is_active?: number;
  is_default?: number;
  quantity?: number;
  uom?: string;
}

interface RawBomItemRow {
  item_code?: string;
  item_name?: string;
  description?: string;
  qty?: number;
  stock_qty?: number;
  uom?: string;
  stock_uom?: string;
  item_group?: string;
}

interface RawBomDoc extends RawBomRow {
  items?: RawBomItemRow[];
}

const BOM_LIST_FIELDS = [
  "name",
  "item",
  "item_name",
  "is_active",
  "is_default",
  "quantity",
  "uom",
];

function normalizeBom(row: RawBomRow): BomSummary {
  return {
    name: row.name,
    item: row.item ?? "",
    item_name: row.item_name || row.item || row.name,
    is_active: Number(row.is_active ?? 0),
    is_default: Number(row.is_default ?? 0),
    quantity: Number(row.quantity) || 1,
    uom: row.uom,
  };
}

/** All active, submitted BOMs (used to derive selectable finished products). */
export async function getActiveBoms(limit = 500): Promise<BomSummary[]> {
  const rows = await apiGet<RawBomRow[]>(
    buildResourceUrl(BOM_DOCTYPE),
    buildListConfig({
      fields: BOM_LIST_FIELDS,
      filters: [
        ["is_active", "=", 1],
        ["docstatus", "=", 1],
      ],
      limit_page_length: limit,
      order_by: "item asc",
    })
  );
  return (rows ?? []).map(normalizeBom);
}

/** Active, submitted BOMs for one finished product (default first). */
export async function getBomsForItem(itemCode: string): Promise<BomSummary[]> {
  const code = (itemCode ?? "").trim();
  if (!code) return [];
  const rows = await apiGet<RawBomRow[]>(
    buildResourceUrl(BOM_DOCTYPE),
    buildListConfig({
      fields: BOM_LIST_FIELDS,
      filters: [
        ["item", "=", code],
        ["is_active", "=", 1],
        ["docstatus", "=", 1],
      ],
      limit_page_length: 100,
      order_by: "is_default desc, modified desc",
    })
  );
  return (rows ?? []).map(normalizeBom);
}

/** The default active BOM for an item, or the first active one, or null. */
export async function getDefaultBomForItem(
  itemCode: string
): Promise<BomSummary | null> {
  const boms = await getBomsForItem(itemCode);
  if (boms.length === 0) return null;
  return boms.find((b) => b.is_default === 1) ?? boms[0];
}

/**
 * Distinct finished products that have at least one active BOM — the natural
 * selectable set for the "Finished Product" dropdown (every option is
 * guaranteed to explode into components).
 */
export async function getFinishedProducts(
  limit = 500
): Promise<BomFinishedItem[]> {
  const boms = await getActiveBoms(limit);
  const byCode = new Map<string, string>();
  for (const b of boms) {
    if (b.item && !byCode.has(b.item)) {
      byCode.set(b.item, b.item_name || b.item);
    }
  }
  return [...byCode.entries()]
    .map(([item_code, item_name]) => ({ item_code, item_name }))
    .sort((a, b) => a.item_name.localeCompare(b.item_name));
}

/** Fetch a BOM document and normalize its component (BOM Item) child rows. */
export async function getBomComponents(bomName: string): Promise<{
  header: BomSummary;
  components: BomComponent[];
}> {
  const doc = await apiGet<RawBomDoc>(
    buildResourceUrl(BOM_DOCTYPE, bomName),
    withSilent()
  );
  const header = normalizeBom(doc);
  const bomQuantity = header.quantity > 0 ? header.quantity : 1;

  const components = (doc.items ?? [])
    .filter((row) => !!(row.item_code && row.item_code.trim()))
    .map<BomComponent>((row) => ({
      item_code: row.item_code as string,
      item_name: row.item_name || (row.item_code as string),
      description: row.description,
      uom: row.stock_uom || row.uom || "Nos",
      item_group: row.item_group,
      qtyForBomOutput: Number(row.stock_qty ?? row.qty) || 0,
      bomQuantity,
    }));

  return { header, components };
}

/** Component required quantity for a given production quantity. */
export function requiredQtyForProduction(
  component: Pick<BomComponent, "qtyForBomOutput" | "bomQuantity">,
  productionQty: number
): number {
  const perOutput =
    component.bomQuantity > 0
      ? component.qtyForBomOutput / component.bomQuantity
      : component.qtyForBomOutput;
  const required = perOutput * (productionQty > 0 ? productionQty : 0);
  // Trim floating-point noise (e.g. 0.30000000000000004) to 4 decimals.
  return Math.round(required * 10000) / 10000;
}
