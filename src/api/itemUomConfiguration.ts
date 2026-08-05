/**
 * Item Master UOM configuration — fully data-driven from ERPNext.
 *
 * Resolves:
 * - default_uom  ← Item.stock_uom
 * - compatible_uoms ← Item.uoms child table + UOM Category members (when configured)
 */

import {
  apiGet,
  buildResourceUrl,
} from "./erpnext";
import { resolveStockUomFromItem } from "../utils/itemMasterUom";
import {
  assembleCompatibleUomOptions,
  type CompatibleUomOption,
} from "../utils/itemUomConversions";

const ITEM_DOCTYPE = "Item";
const UOM_DOCTYPE = "UOM";
const UOM_CATEGORY_DOCTYPE = "UOM Category";

export interface ItemUomConfiguration {
  item_code: string;
  item_name?: string;
  description?: string;
  item_group?: string;
  part_name?: string;
  /** Item Master stock UOM — the default selection. */
  default_uom: string;
  compatible_uoms: CompatibleUomOption[];
}

interface RawItemUomRow {
  uom?: string;
  conversion_factor?: number;
}

interface RawItemDoc {
  name: string;
  item_code?: string;
  item_name?: string;
  description?: string;
  item_group?: string;
  custom_part_name?: string;
  stock_uom?: string;
  uoms?: RawItemUomRow[];
}

interface RawUomDoc {
  name?: string;
  category?: string;
  uom_category?: string;
}

interface RawUomCategoryRow {
  uom?: string;
  conversion_factor?: number;
}

interface RawUomCategoryDoc {
  name?: string;
  uoms?: RawUomCategoryRow[];
}

function unwrapList<T>(value: T[] | { data?: T[]; message?: T[] }): T[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const env = value as { data?: T[]; message?: T[] };
    if (Array.isArray(env.message)) return env.message;
    if (Array.isArray(env.data)) return env.data;
  }
  return [];
}

/**
 * Load the full Item document (including `uoms` child rows) by business item_code.
 * ERPNext Item `name` is not always equal to `item_code`, so a list lookup comes first.
 */
export async function fetchItemDocumentByItemCode(
  itemCode: string,
): Promise<RawItemDoc | null> {
  const trimmed = itemCode.trim();
  if (!trimmed) return null;

  let docName: string | null = null;

  try {
    const listed = unwrapList<{ name: string; item_code?: string }>(
      await apiGet(buildResourceUrl(ITEM_DOCTYPE), {
        params: {
          fields: JSON.stringify(["name", "item_code"]),
          filters: JSON.stringify([
            ["item_code", "=", trimmed],
            ["disabled", "=", 0],
          ]),
          limit_page_length: 1,
        },
      }),
    );
    docName = listed[0]?.name?.trim() ?? null;
  } catch {
    docName = null;
  }

  if (!docName) {
    try {
      const direct = await apiGet<RawItemDoc>(
        buildResourceUrl(ITEM_DOCTYPE, trimmed),
      );
      if (direct?.name) return direct;
    } catch {
      return null;
    }
    return null;
  }

  try {
    return await apiGet<RawItemDoc>(buildResourceUrl(ITEM_DOCTYPE, docName));
  } catch {
    return null;
  }
}

async function fetchUomCategoryName(uomName: string): Promise<string | null> {
  const trimmed = uomName.trim();
  if (!trimmed) return null;

  try {
    const doc = await apiGet<RawUomDoc>(buildResourceUrl(UOM_DOCTYPE, trimmed));
    return (
      doc.category?.trim() ||
      doc.uom_category?.trim() ||
      null
    );
  } catch {
    return null;
  }
}

async function fetchUomsInCategoryByFilter(
  categoryName: string,
): Promise<RawUomCategoryRow[]> {
  try {
    const rows = unwrapList<{ name: string }>(
      await apiGet(buildResourceUrl(UOM_DOCTYPE), {
        params: {
          fields: JSON.stringify(["name"]),
          filters: JSON.stringify([["category", "=", categoryName]]),
          limit_page_length: 100,
          order_by: "name asc",
        },
      }),
    );
    return rows
      .map((r) => ({ uom: r.name?.trim() }))
      .filter((r): r is RawUomCategoryRow => !!r.uom);
  } catch {
    return [];
  }
}

async function fetchUomCategoryMembers(
  categoryName: string,
): Promise<RawUomCategoryRow[]> {
  const trimmed = categoryName.trim();
  if (!trimmed) return [];

  try {
    const doc = await apiGet<RawUomCategoryDoc>(
      buildResourceUrl(UOM_CATEGORY_DOCTYPE, trimmed),
    );
    const rows = (doc.uoms ?? [])
      .map((row) => ({
        uom: row.uom?.trim(),
        conversion_factor: row.conversion_factor,
      }))
      .filter((row): row is RawUomCategoryRow => !!row.uom);
    if (rows.length > 0) return rows;
  } catch {
    /* fall through to UOM list filter */
  }

  return fetchUomsInCategoryByFilter(trimmed);
}

/**
 * Resolve default + compatible UOMs for an item from ERPNext Item Master data.
 * Never substitutes a global fallback UOM.
 */
export async function resolveItemUomConfiguration(
  itemCode: string,
): Promise<ItemUomConfiguration | null> {
  const doc = await fetchItemDocumentByItemCode(itemCode);
  if (!doc) return null;

  const code = doc.item_code?.trim() || doc.name?.trim() || itemCode.trim();
  const defaultUom = resolveStockUomFromItem(doc.stock_uom);
  if (!defaultUom) {
    return {
      item_code: code,
      item_name: doc.item_name?.trim() || code,
      description: doc.description?.trim() || undefined,
      item_group: doc.item_group?.trim() || undefined,
      part_name: doc.custom_part_name?.trim() || undefined,
      default_uom: "",
      compatible_uoms: [],
    };
  }

  const categoryName = await fetchUomCategoryName(defaultUom);
  const categoryRows = categoryName
    ? await fetchUomCategoryMembers(categoryName)
    : [];

  const compatible_uoms = assembleCompatibleUomOptions(
    defaultUom,
    doc.uoms ?? [],
    categoryRows,
  );

  return {
    item_code: code,
    item_name: doc.item_name?.trim() || code,
    description: doc.description?.trim() || undefined,
    item_group: doc.item_group?.trim() || undefined,
    part_name: doc.custom_part_name?.trim() || undefined,
    default_uom: defaultUom,
    compatible_uoms,
  };
}
