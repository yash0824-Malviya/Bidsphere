/**
 * Item Master API — list, create, update, and detail for Warehouse Item Master.
 */
import type { AxiosError } from "axios";

import {
  apiGet,
  apiPost,
  apiPut,
  buildListConfig,
  buildResourceUrl,
  withSilent,
  type Filter,
} from "./erpnext";
import { getItemHsnFieldConfig, createInventoryItem } from "./inventory";
import type { Item, Bin } from "../types/erpnext";
import type { MaterialRequestProcurementType } from "../types/materialRequestWorkflow";
import {
  ITEM_LIFECYCLE_STATUS_FIELD,
  ITEM_MAX_STOCK_FIELD,
  ITEM_PROCUREMENT_CATEGORY_FIELD,
  ITEM_PROCUREMENT_TYPE_FIELD,
  normalizeItemLifecycleStatus,
  type ItemLifecycleStatus,
} from "../types/itemMaster";
import {
  assertProcurementTypeCategory,
  normalizeProcurementCategoryValue,
} from "../config/procurementCategory";
import { resolveStockUomFromItem } from "../utils/itemMasterUom";
import {
  normalizeProcurementTypeValue,
  resolveItemProcurement,
} from "../utils/itemProcurementInfer";

const ITEM_DOCTYPE = "Item";
const LOG_TAG = "[ItemMaster]";

/** Fields proven safe on /api/resource/Item list across BidSphere ERP sites. */
const ITEM_CORE_LIST_FIELDS = [
  "name",
  "item_code",
  "item_name",
  "description",
  "item_group",
  "stock_uom",
  "disabled",
  "owner",
  "creation",
  "modified",
  "modified_by",
] as const;

/**
 * Optional fields — may be missing or blocked from list queries (HTTP 417).
 * Stripped and retried when ERP rejects them.
 */
/** Usually present on Item; strip individually if ERP rejects. */
const ITEM_EXTENDED_LIST_FIELDS = [
  "is_stock_item",
  "safety_stock",
  "min_order_qty",
  "standard_rate",
  "brand",
  "image",
] as const;

/**
 * Schema-risky list fields (often child-table-only / not permitted on Item list).
 * Dropped first on 417 so Procurement Type custom fields can still be requested.
 * Note: `default_warehouse` is NOT requested — ERP returns 417; warehouse comes from Bin.
 */
const ITEM_SCHEMA_RISKY_LIST_FIELDS = ["manufacturer"] as const;

/** BidSphere procurement custom fields — preferred on Item Master list. */
const ITEM_PROCUREMENT_LIST_FIELDS = [
  ITEM_PROCUREMENT_TYPE_FIELD,
  ITEM_PROCUREMENT_CATEGORY_FIELD,
  ITEM_LIFECYCLE_STATUS_FIELD,
  ITEM_MAX_STOCK_FIELD,
] as const;

const ITEM_OPTIONAL_LIST_FIELDS = [
  ...ITEM_EXTENDED_LIST_FIELDS,
  ...ITEM_SCHEMA_RISKY_LIST_FIELDS,
  ...ITEM_PROCUREMENT_LIST_FIELDS,
] as const;

function normalizeProcurementType(
  value: string | null | undefined,
): MaterialRequestProcurementType | "" {
  return normalizeProcurementTypeValue(value);
}

/** Apply inference so UI shows Direct/Indirect when ERP category/group implies it. */
function withResolvedProcurement(row: ItemMasterRecord): ItemMasterRecord {
  const resolved = resolveItemProcurement({
    procurement_type: row.procurement_type,
    procurement_category: row.procurement_category,
    item_group: row.item_group,
  });
  return {
    ...row,
    procurement_type: resolved.procurement_type,
    procurement_category:
      resolved.procurement_category || row.procurement_category,
  };
}

/**
 * Persist Procurement Type + Category on an ERP Item (single source of truth).
 * Throws if ERP rejects the write (e.g. custom fields not provisioned).
 */
export async function persistItemProcurementFields(
  itemCode: string,
  fields: {
    procurement_type: MaterialRequestProcurementType;
    procurement_category: string;
    lifecycle_status?: ItemLifecycleStatus;
  },
): Promise<void> {
  const code = itemCode.trim();
  if (!code) throw new Error("Item Code is required.");
  // Persist whatever ERP Select options accept — do not re-validate against
  // static frontend category lists (import uses ERP as the source of truth).
  if (
    fields.procurement_type !== "Direct" &&
    fields.procurement_type !== "Indirect"
  ) {
    throw new Error("Procurement Type must be Direct or Indirect.");
  }
  if (!fields.procurement_category.trim()) {
    throw new Error("Procurement Category is required.");
  }

  const payload: Record<string, unknown> = {
    [ITEM_PROCUREMENT_TYPE_FIELD]: fields.procurement_type,
    [ITEM_PROCUREMENT_CATEGORY_FIELD]: fields.procurement_category.trim(),
  };
  if (fields.lifecycle_status) {
    payload[ITEM_LIFECYCLE_STATUS_FIELD] = fields.lifecycle_status;
    payload.disabled = lifecycleToDisabled(fields.lifecycle_status);
  }

  try {
    await apiPut(buildResourceUrl(ITEM_DOCTYPE, code), payload, withSilent());
  } catch (err) {
    const message =
      err instanceof Error ? err.message : String(err ?? "Unknown error");
    // eslint-disable-next-line no-console
    console.error(`${LOG_TAG} persist procurement fields failed`, {
      itemCode: code,
      fields,
      message,
      err,
    });
    throw new Error(
      `Could not save Procurement Type/Category on Item "${code}". ` +
        `Run: node scripts/setup-item-master-procurement.mjs — ${message}`,
    );
  }
}

export interface ItemMasterRecord {
  item_code: string;
  item_name: string;
  description: string;
  item_group: string;
  procurement_type: MaterialRequestProcurementType | "";
  procurement_category: string;
  stock_uom: string;
  is_stock_item: boolean;
  reorder_level: number;
  min_stock: number;
  max_stock: number;
  default_warehouse: string;
  standard_rate: number;
  manufacturer: string;
  brand: string;
  lifecycle_status: ItemLifecycleStatus;
  disabled: boolean;
  owner: string;
  creation: string;
  modified: string;
  modified_by: string;
  image: string;
  warehouse: string;
  /** Bin on-hand (actual_qty), summed/preferred warehouse. */
  current_stock: number;
  /** Free qty (actual − reserved) for planning display. */
  available_qty: number;
}

export interface ItemMasterListFilters {
  search?: string;
  procurementType?: MaterialRequestProcurementType | "";
  procurementCategory?: string;
  itemGroup?: string;
  status?: ItemLifecycleStatus | "";
  warehouse?: string;
  limit?: number;
}

export interface CreateItemMasterInput {
  item_code: string;
  item_name: string;
  procurement_type: MaterialRequestProcurementType;
  procurement_category: string;
  description?: string;
  item_group?: string;
  stock_uom?: string;
  is_stock_item?: boolean;
  reorder_level?: number;
  min_stock?: number;
  max_stock?: number;
  default_warehouse?: string;
  standard_rate?: number;
  manufacturer?: string;
  brand?: string;
  lifecycle_status?: ItemLifecycleStatus;
  gst_hsn_code?: string;
  image?: string;
}

export interface UpdateItemMasterInput {
  item_name?: string;
  description?: string;
  procurement_type?: MaterialRequestProcurementType;
  procurement_category?: string;
  item_group?: string;
  stock_uom?: string;
  reorder_level?: number;
  min_stock?: number;
  max_stock?: number;
  default_warehouse?: string;
  standard_rate?: number;
  manufacturer?: string;
  brand?: string;
  lifecycle_status?: ItemLifecycleStatus;
  is_stock_item?: boolean;
  image?: string;
}

interface RawItemRow {
  name: string;
  item_code?: string;
  item_name?: string;
  description?: string;
  item_group?: string;
  stock_uom?: string;
  is_stock_item?: 0 | 1;
  safety_stock?: number;
  min_order_qty?: number;
  default_warehouse?: string;
  standard_rate?: number;
  manufacturer?: string;
  brand?: string;
  disabled?: 0 | 1;
  owner?: string;
  creation?: string;
  modified?: string;
  modified_by?: string;
  image?: string;
  custom_procurement_type?: string;
  custom_procurement_category?: string;
  custom_bidsphere_item_status?: string;
  custom_max_stock?: number;
}

function uniqueFields(fields: string[]): string[] {
  return Array.from(new Set(fields.filter(Boolean)));
}

function nonNegativeQty(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  const axiosErr = err as AxiosError<{ message?: string; exc?: string }>;
  if (axiosErr?.response?.data) {
    try {
      return JSON.stringify(axiosErr.response.data);
    } catch {
      /* fall through */
    }
  }
  return String(err ?? "Unknown error");
}

function httpStatus(err: unknown): number | undefined {
  return (err as AxiosError)?.response?.status;
}

function extractForbiddenField(err: unknown): string | null {
  const msg = errorMessage(err);
  const match = /Field not permitted in query:\s*([A-Za-z0-9_]+)/i.exec(msg);
  return match?.[1] ?? null;
}

function isFieldPermissionError(err: unknown): boolean {
  return /Field not permitted in query|DataError|Unknown column|No field named|Could not find .* in/i.test(
    errorMessage(err),
  );
}

function normalizeItemRows(response: unknown): RawItemRow[] {
  if (Array.isArray(response)) return response as RawItemRow[];
  if (response && typeof response === "object") {
    const obj = response as { data?: unknown; message?: unknown };
    if (Array.isArray(obj.data)) return obj.data as RawItemRow[];
    if (Array.isArray(obj.message)) return obj.message as RawItemRow[];
  }
  return [];
}

function logItemMasterError(context: string, err: unknown, extra?: object) {
  const status = httpStatus(err);
  const message = errorMessage(err);
  const axiosErr = err as AxiosError;
  // eslint-disable-next-line no-console
  console.error(`${LOG_TAG} ${context}`, {
    message,
    status,
    url: axiosErr?.config?.url,
    params: axiosErr?.config?.params,
    responseBody: axiosErr?.response?.data,
    ...extra,
  });
  if (err instanceof Error && err.stack) {
    // eslint-disable-next-line no-console
    console.error(`${LOG_TAG} stack`, err.stack);
  }
}

function mapRawItemRow(row: RawItemRow): ItemMasterRecord {
  const code = row.item_code || row.name;
  return {
    item_code: code,
    item_name: row.item_name || code,
    description: String(row.description ?? "").trim(),
    item_group: String(row.item_group ?? "").trim(),
    procurement_type: normalizeProcurementType(row.custom_procurement_type),
    procurement_category: String(row.custom_procurement_category ?? "").trim(),
    stock_uom: resolveStockUomFromItem(row.stock_uom),
    is_stock_item: row.is_stock_item !== 0,
    reorder_level: nonNegativeQty(row.safety_stock),
    min_stock: nonNegativeQty(row.min_order_qty),
    max_stock: nonNegativeQty(row.custom_max_stock),
    default_warehouse: String(row.default_warehouse ?? "").trim(),
    standard_rate: nonNegativeQty(row.standard_rate),
    manufacturer: String(row.manufacturer ?? "").trim(),
    brand: String(row.brand ?? "").trim(),
    lifecycle_status: normalizeItemLifecycleStatus(row.custom_bidsphere_item_status),
    disabled: row.disabled === 1,
    owner: String(row.owner ?? "").trim(),
    creation: String(row.creation ?? "").trim(),
    modified: String(row.modified ?? "").trim(),
    modified_by: String(row.modified_by ?? "").trim(),
    image: String(row.image ?? "").trim(),
    warehouse: String(row.default_warehouse ?? "").trim(),
    current_stock: 0,
    available_qty: 0,
  };
}

async function fetchBinsForItems(
  codes: string[],
): Promise<
  Map<string, { warehouse: string; current_stock: number; available_qty: number }>
> {
  if (codes.length === 0) return new Map();
  try {
    const bins = await apiGet<Bin[]>(buildResourceUrl("Bin"), {
      ...buildListConfig({
        fields: ["item_code", "warehouse", "actual_qty", "reserved_qty"],
        filters: [["item_code", "in", codes]],
        limit_page_length: Math.max(codes.length * 3, 100),
      }),
      ...withSilent(),
    });
    const map = new Map<
      string,
      { warehouse: string; current_stock: number; available_qty: number }
    >();
    for (const bin of bins ?? []) {
      const code = String(bin.item_code ?? "").trim();
      if (!code) continue;
      const actual = nonNegativeQty(bin.actual_qty);
      const reserved = nonNegativeQty(bin.reserved_qty);
      const available = Math.max(0, actual - reserved);
      const existing = map.get(code);
      // Prefer the bin with the highest on-hand for Item Master planning.
      if (!existing || actual > existing.current_stock) {
        map.set(code, {
          warehouse: String(bin.warehouse ?? "").trim(),
          current_stock: actual,
          available_qty: available,
        });
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * ERP-safe filters only. Custom procurement / lifecycle / warehouse filters
 * are applied client-side so missing custom fields cannot 417 the whole list.
 */
function buildItemMasterErpFilters(
  filters: ItemMasterListFilters,
): Filter[] {
  const erpFilters: Filter[] = [];
  if (filters.itemGroup) {
    erpFilters.push(["item_group", "=", filters.itemGroup]);
  }
  return erpFilters;
}

function matchesClientSearch(row: ItemMasterRecord, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return (
    row.item_code.toLowerCase().includes(q) ||
    row.item_name.toLowerCase().includes(q) ||
    row.description.toLowerCase().includes(q) ||
    row.item_group.toLowerCase().includes(q) ||
    row.procurement_category.toLowerCase().includes(q)
  );
}

function normFilterValue(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

/**
 * Client-side Item Master filters.
 * Empty / "All" values are ignored. Category is matched on procurement_category
 * only — never on item_group.
 */
export function matchesItemMasterFilters(
  row: ItemMasterRecord,
  filters: ItemMasterListFilters,
): boolean {
  const type = normFilterValue(filters.procurementType);
  const category = normFilterValue(filters.procurementCategory);
  const group = normFilterValue(filters.itemGroup);
  const warehouse = normFilterValue(filters.warehouse);
  const status = normFilterValue(filters.status);

  if (type) {
    if (row.procurement_type !== type) return false;
  }

  if (category) {
    const rowCat =
      normalizeProcurementCategoryValue(row.procurement_category) ||
      normFilterValue(row.procurement_category);
    const want =
      normalizeProcurementCategoryValue(category) || category;
    if (rowCat.toLowerCase() !== want.toLowerCase()) return false;
  }

  if (group) {
    if (normFilterValue(row.item_group) !== group) return false;
  }

  if (status) {
    if (row.lifecycle_status === status) {
      /* exact lifecycle match */
    } else if (status === "Active" && !row.disabled) {
      /* custom status field absent → treat enabled items as Active */
    } else if (
      (status === "Inactive" || status === "Obsolete") &&
      row.disabled
    ) {
      /* custom status field absent → treat disabled items as Inactive/Obsolete */
    } else {
      return false;
    }
  }

  if (warehouse) {
    const rowWh =
      normFilterValue(row.warehouse) ||
      normFilterValue(row.default_warehouse);
    if (rowWh !== warehouse) return false;
  }

  return true;
}

/**
 * List Item Master via ERPNext `/api/resource/Item`.
 *
 * Retries after stripping ERP-rejected fields (HTTP 417 "Field not permitted").
 * Empty arrays are valid (no items) — not treated as errors.
 */
async function fetchItemMasterRows(
  queryFilters: Filter[],
  limit: number,
): Promise<RawItemRow[]> {
  const url = buildResourceUrl(ITEM_DOCTYPE);
  const removedFields: string[] = [];
  let fields = uniqueFields([
    ...ITEM_CORE_LIST_FIELDS,
    ...ITEM_OPTIONAL_LIST_FIELDS,
  ]);
  let droppedSchemaRisky = false;
  let droppedProcurement = false;
  let droppedExtended = false;

  for (let attempt = 0; attempt < 16; attempt++) {
    if (fields.length === 0) {
      throw new Error("Item Master query has no remaining permitted fields.");
    }

    const listConfig = buildListConfig({
      fields,
      filters: queryFilters.length > 0 ? queryFilters : undefined,
      limit_page_length: limit,
      order_by: fields.includes("item_name") ? "item_name asc" : "name asc",
    });
    const config = withSilent(listConfig);

    // eslint-disable-next-line no-console
    console.log(`${LOG_TAG} GET`, {
      url,
      status: "(pending)",
      params: listConfig.params,
      attempt: attempt + 1,
      fields,
    });

    try {
      const response = await apiGet<unknown>(url, config);
      const rows = normalizeItemRows(response);

      // eslint-disable-next-line no-console
      console.log(`${LOG_TAG} response`, {
        url,
        status: 200,
        rowCount: rows.length,
        removedFields: [...removedFields],
        sample: rows[0]
          ? {
              item_code: rows[0].item_code,
              item_name: rows[0].item_name,
              item_group: rows[0].item_group,
              stock_uom: rows[0].stock_uom,
              custom_procurement_type: rows[0].custom_procurement_type,
              custom_procurement_category: rows[0].custom_procurement_category,
              safety_stock: rows[0].safety_stock,
            }
          : null,
      });

      return rows;
    } catch (err) {
      const status = httpStatus(err);
      const message = errorMessage(err);
      logItemMasterError("list request failed", err, {
        attempt: attempt + 1,
        requestedFields: fields,
        removedFields: [...removedFields],
        queryFilters,
      });

      // Auth / permission — do not retry field stripping.
      if (status === 401 || status === 403) {
        throw new Error(
          status === 401
            ? `Item Master unauthorized (401): ${message}`
            : `Item Master forbidden (403): ${message}`,
        );
      }
      if (status === 404) {
        throw new Error(`Item Master endpoint not found (404): ${url}`);
      }
      if (status === 500) {
        throw new Error(`Item Master server error (500): ${message}`);
      }

      if (isFieldPermissionError(err) && !droppedSchemaRisky) {
        for (const risky of ITEM_SCHEMA_RISKY_LIST_FIELDS) {
          if (fields.includes(risky) && !removedFields.includes(risky)) {
            removedFields.push(risky);
          }
        }
        fields = fields.filter(
          (f) =>
            !(ITEM_SCHEMA_RISKY_LIST_FIELDS as readonly string[]).includes(f),
        );
        droppedSchemaRisky = true;
        // eslint-disable-next-line no-console
        console.warn(
          `${LOG_TAG} HTTP ${status ?? 417} — dropped schema-risky fields, retrying (keeping Procurement Type)`,
          { removedFields: [...removedFields], detail: message },
        );
        continue;
      }

      const forbidden = extractForbiddenField(err);
      if (forbidden && fields.includes(forbidden)) {
        fields = fields.filter((f) => f !== forbidden);
        removedFields.push(forbidden);
        // eslint-disable-next-line no-console
        console.warn(
          `${LOG_TAG} removed unsupported field "${forbidden}", retrying…`,
        );
        continue;
      }

      if (isFieldPermissionError(err) && !droppedProcurement) {
        for (const pf of ITEM_PROCUREMENT_LIST_FIELDS) {
          if (fields.includes(pf) && !removedFields.includes(pf)) {
            removedFields.push(pf);
          }
        }
        fields = fields.filter(
          (f) =>
            !(ITEM_PROCUREMENT_LIST_FIELDS as readonly string[]).includes(f),
        );
        droppedProcurement = true;
        // eslint-disable-next-line no-console
        console.warn(
          `${LOG_TAG} HTTP ${status ?? 417} — dropped procurement custom fields, retrying`,
          { removedFields: [...removedFields], detail: message },
        );
        continue;
      }

      if (isFieldPermissionError(err) && !droppedExtended) {
        for (const ext of ITEM_EXTENDED_LIST_FIELDS) {
          if (fields.includes(ext) && !removedFields.includes(ext)) {
            removedFields.push(ext);
          }
        }
        fields = fields.filter(
          (f) => !(ITEM_EXTENDED_LIST_FIELDS as readonly string[]).includes(f),
        );
        droppedExtended = true;
        // eslint-disable-next-line no-console
        console.warn(
          `${LOG_TAG} HTTP ${status ?? 417} — dropped extended fields, retrying with core only`,
          { removedFields: [...removedFields], detail: message },
        );
        continue;
      }

      throw err instanceof Error
        ? err
        : new Error(`Item Master load failed: ${message}`);
    }
  }

  throw new Error("Item Master list exhausted field-retry attempts.");
}

/**
 * Best-effort enrichment of Procurement Type / Category when the main list
 * query had to drop custom fields. Never throws — blanks stay "Not Assigned".
 */
async function enrichProcurementFields(
  rows: ItemMasterRecord[],
): Promise<ItemMasterRecord[]> {
  const needsEnrichment = rows.filter(
    (r) => !r.procurement_type || !r.procurement_category,
  );
  if (needsEnrichment.length === 0) return rows;

  const codes = needsEnrichment.map((r) => r.item_code);
  const chunks: string[][] = [];
  for (let i = 0; i < codes.length; i += 200) {
    chunks.push(codes.slice(i, i + 200));
  }

  const byCode = new Map<
    string,
    {
      procurement_type: MaterialRequestProcurementType | "";
      procurement_category: string;
      lifecycle_status: ItemLifecycleStatus;
    }
  >();

  for (const chunk of chunks) {
    try {
      const enriched = await apiGet<RawItemRow[]>(
        buildResourceUrl(ITEM_DOCTYPE),
        {
          ...buildListConfig({
            fields: [
              "item_code",
              ITEM_PROCUREMENT_TYPE_FIELD,
              ITEM_PROCUREMENT_CATEGORY_FIELD,
              ITEM_LIFECYCLE_STATUS_FIELD,
            ],
            filters: [["item_code", "in", chunk]],
            limit_page_length: chunk.length,
          }),
          ...withSilent(),
        },
      );
      for (const row of enriched ?? []) {
        const code = row.item_code || row.name;
        if (!code) continue;
        byCode.set(code, {
          procurement_type: normalizeProcurementType(row.custom_procurement_type),
          procurement_category: String(
            row.custom_procurement_category ?? "",
          ).trim(),
          lifecycle_status: normalizeItemLifecycleStatus(
            row.custom_bidsphere_item_status,
          ),
        });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `${LOG_TAG} procurement enrichment skipped (custom fields may be unprovisioned)`,
        errorMessage(err),
      );
      break;
    }
  }

  if (byCode.size === 0) return rows;

  return rows.map((row) => {
    const extra = byCode.get(row.item_code);
    if (!extra) return row;
    return {
      ...row,
      procurement_type: extra.procurement_type || row.procurement_type,
      procurement_category:
        extra.procurement_category || row.procurement_category,
      lifecycle_status: extra.lifecycle_status || row.lifecycle_status,
    };
  });
}

export async function listItemMaster(
  filters: ItemMasterListFilters = {},
): Promise<ItemMasterRecord[]> {
  // Ignore "All" / empty filter values — only pass active constraints.
  const activeFilters: ItemMasterListFilters = {
    search: filters.search?.trim() || undefined,
    procurementType: filters.procurementType || undefined,
    procurementCategory: filters.procurementCategory?.trim() || undefined,
    itemGroup: filters.itemGroup?.trim() || undefined,
    status: filters.status || undefined,
    warehouse: filters.warehouse?.trim() || undefined,
    limit: filters.limit,
  };

  const erpFilters = buildItemMasterErpFilters(activeFilters);
  const search = activeFilters.search ?? "";
  const limit = activeFilters.limit ?? 500;

  let rawRows: RawItemRow[];
  try {
    if (search) {
      const [byName, byCode, byDesc] = await Promise.all([
        fetchItemMasterRows(
          [...erpFilters, ["item_name", "like", `%${search}%`]],
          limit,
        ),
        fetchItemMasterRows(
          [...erpFilters, ["item_code", "like", `%${search}%`]],
          limit,
        ),
        fetchItemMasterRows(
          [...erpFilters, ["description", "like", `%${search}%`]],
          limit,
        ),
      ]);
      const merged = new Map<string, RawItemRow>();
      for (const row of [...byName, ...byCode, ...byDesc]) {
        const code = row.item_code || row.name;
        if (code) merged.set(code, row);
      }
      rawRows = [...merged.values()];
    } else {
      rawRows = await fetchItemMasterRows(erpFilters, limit);
    }
  } catch (err) {
    logItemMasterError("listItemMaster failed", err, { filters: activeFilters });
    throw err;
  }

  let rows = await enrichProcurementFields(rawRows.map(mapRawItemRow));
  // Resolve for display + filter alignment (typed category master).
  rows = rows.map(withResolvedProcurement);

  const binMap = await fetchBinsForItems(rows.map((r) => r.item_code));
  rows = rows.map((row) => {
    const bin = binMap.get(row.item_code);
    if (!bin) return row;
    return {
      ...row,
      warehouse: row.default_warehouse || bin.warehouse,
      current_stock: bin.current_stock,
      available_qty: bin.available_qty,
    };
  });

  return rows
    .filter((row) => matchesItemMasterFilters(row, activeFilters))
    .filter((row) => matchesClientSearch(row, search));
}

export async function getItemMaster(
  itemCode: string,
): Promise<ItemMasterRecord | null> {
  const code = itemCode.trim();
  if (!code) return null;
  try {
    const row = await apiGet<RawItemRow>(
      buildResourceUrl(ITEM_DOCTYPE, code),
      withSilent(),
    );
    const record = withResolvedProcurement(mapRawItemRow(row));
    const binMap = await fetchBinsForItems([code]);
    const bin = binMap.get(code);
    if (bin) {
      record.warehouse = record.default_warehouse || bin.warehouse;
      record.current_stock = bin.current_stock;
      record.available_qty = bin.available_qty;
    }
    return record;
  } catch {
    return null;
  }
}

export async function itemCodeExists(itemCode: string): Promise<boolean> {
  const code = itemCode.trim();
  if (!code) return false;
  try {
    await apiGet(buildResourceUrl(ITEM_DOCTYPE, code), withSilent());
    return true;
  } catch {
    return false;
  }
}

function validateProcurementFields(
  type: MaterialRequestProcurementType,
  category: string,
): void {
  assertProcurementTypeCategory(type, category);
}

function lifecycleToDisabled(status: ItemLifecycleStatus): 0 | 1 {
  return status === "Active" ? 0 : 1;
}

function buildItemPayload(
  input: CreateItemMasterInput | UpdateItemMasterInput,
  isCreate: boolean,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if ("item_code" in input && isCreate) {
    payload.item_code = input.item_code.trim();
    payload.item_name = input.item_name.trim();
  } else if (input.item_name !== undefined) {
    payload.item_name = input.item_name.trim();
  }

  if (input.description !== undefined) {
    payload.description = input.description.trim();
  }
  if (input.item_group !== undefined) {
    payload.item_group = input.item_group.trim() || "All Item Groups";
  }
  if (input.stock_uom !== undefined) {
    payload.stock_uom = input.stock_uom.trim() || "Nos";
  }
  if (input.is_stock_item !== undefined) {
    payload.is_stock_item = input.is_stock_item ? 1 : 0;
  }
  if (input.reorder_level !== undefined) {
    payload.safety_stock = nonNegativeQty(input.reorder_level);
  }
  if (input.min_stock !== undefined) {
    payload.min_order_qty = nonNegativeQty(input.min_stock);
  }
  if (input.max_stock !== undefined) {
    payload[ITEM_MAX_STOCK_FIELD] = nonNegativeQty(input.max_stock);
  }
  if (input.default_warehouse !== undefined) {
    payload.default_warehouse = input.default_warehouse.trim() || undefined;
  }
  if (input.standard_rate !== undefined) {
    payload.standard_rate = nonNegativeQty(input.standard_rate) || undefined;
  }
  if (input.manufacturer !== undefined) {
    payload.manufacturer = input.manufacturer.trim() || undefined;
  }
  if (input.brand !== undefined) {
    payload.brand = input.brand.trim() || undefined;
  }
  if (input.image !== undefined) {
    payload.image = input.image.trim() || undefined;
  }

  if ("procurement_type" in input && input.procurement_type) {
    payload[ITEM_PROCUREMENT_TYPE_FIELD] = input.procurement_type;
  }
  if ("procurement_category" in input && input.procurement_category !== undefined) {
    payload[ITEM_PROCUREMENT_CATEGORY_FIELD] = input.procurement_category.trim();
  }
  if (input.lifecycle_status !== undefined) {
    payload[ITEM_LIFECYCLE_STATUS_FIELD] = input.lifecycle_status;
    payload.disabled = lifecycleToDisabled(input.lifecycle_status);
  }

  return payload;
}

export async function createItemMaster(
  input: CreateItemMasterInput,
): Promise<ItemMasterRecord> {
  const code = input.item_code.trim();
  const name = input.item_name.trim();
  if (!code) throw new Error("Item Code is required.");
  if (!name) throw new Error("Item Name is required.");
  if (!input.procurement_type) throw new Error("Procurement Type is required.");

  validateProcurementFields(input.procurement_type, input.procurement_category);
  const itemGroup = input.item_group?.trim() ?? "";
  if (!itemGroup) {
    throw new Error("Item Group is required.");
  }

  if (await itemCodeExists(code)) {
    throw new Error(`Item Code "${code}" already exists.`);
  }

  const hsnConfig = await getItemHsnFieldConfig();
  const hsnValue = input.gst_hsn_code?.trim() ?? "";

  const payload: Record<string, unknown> = {
    ...buildItemPayload(input, true),
    item_code: code,
    item_name: name,
    item_group: itemGroup,
    stock_uom: input.stock_uom?.trim() || "Nos",
    is_stock_item: input.is_stock_item !== false ? 1 : 0,
    [ITEM_PROCUREMENT_TYPE_FIELD]: input.procurement_type,
    [ITEM_PROCUREMENT_CATEGORY_FIELD]: input.procurement_category.trim(),
    [ITEM_LIFECYCLE_STATUS_FIELD]: input.lifecycle_status ?? "Active",
    disabled: lifecycleToDisabled(input.lifecycle_status ?? "Active"),
  };

  if (hsnValue) {
    payload[hsnConfig.fieldname] = hsnValue;
  }

  try {
    await apiPost<Item>(buildResourceUrl(ITEM_DOCTYPE), payload);
  } catch (err) {
    // Create core Item first, then persist procurement fields separately.
    const corePayload: Record<string, unknown> = {
      item_code: code,
      item_name: name,
      item_group: String(payload.item_group),
      stock_uom: String(payload.stock_uom),
      is_stock_item: payload.is_stock_item,
      description: input.description?.trim() || undefined,
      safety_stock: nonNegativeQty(input.reorder_level),
      disabled: lifecycleToDisabled(input.lifecycle_status ?? "Active"),
    };
    if (hsnValue) {
      await createInventoryItem({
        item_code: code,
        item_name: name,
        item_group: String(payload.item_group),
        stock_uom: String(payload.stock_uom),
        gst_hsn_code: hsnValue,
        description: input.description,
        is_stock_item: payload.is_stock_item as 0 | 1,
      });
    } else {
      try {
        await apiPost<Item>(
          buildResourceUrl(ITEM_DOCTYPE),
          corePayload,
          withSilent(),
        );
      } catch (coreErr) {
        throw err instanceof Error ? err : coreErr;
      }
    }
  }

  // Always write Procurement Type/Category to ERP (never frontend-only).
  await persistItemProcurementFields(code, {
    procurement_type: input.procurement_type,
    procurement_category: input.procurement_category.trim(),
    lifecycle_status: input.lifecycle_status ?? "Active",
  });

  if (input.reorder_level || input.min_stock || input.max_stock || input.default_warehouse) {
    try {
      await apiPut(
        buildResourceUrl(ITEM_DOCTYPE, code),
        {
          safety_stock: nonNegativeQty(input.reorder_level),
          min_order_qty: nonNegativeQty(input.min_stock),
          [ITEM_MAX_STOCK_FIELD]: nonNegativeQty(input.max_stock),
          default_warehouse: input.default_warehouse?.trim() || undefined,
          manufacturer: input.manufacturer?.trim() || undefined,
          brand: input.brand?.trim() || undefined,
          standard_rate: nonNegativeQty(input.standard_rate) || undefined,
        },
        withSilent(),
      );
    } catch {
      /* optional stock fields — procurement already saved */
    }
  }

  const record = await getItemMaster(code);
  if (!record) {
    throw new Error("Item was created but could not be loaded.");
  }
  if (!record.procurement_type) {
    throw new Error(
      `Item "${code}" was created but Procurement Type was not saved in ERPNext. ` +
        "Run: node scripts/setup-item-master-procurement.mjs",
    );
  }
  return record;
}

export async function updateItemMaster(
  itemCode: string,
  input: UpdateItemMasterInput,
): Promise<ItemMasterRecord> {
  const code = itemCode.trim();
  if (!code) throw new Error("Item Code is required.");

  if (
    input.item_group !== undefined &&
    !String(input.item_group ?? "").trim()
  ) {
    throw new Error("Item Group is required.");
  }

  if (input.procurement_type && input.procurement_category !== undefined) {
    validateProcurementFields(input.procurement_type, input.procurement_category);
  } else if (input.procurement_type || input.procurement_category) {
    const existing = await getItemMaster(code);
    if (!existing) throw new Error(`Item "${code}" not found.`);
    const category =
      input.procurement_category ?? existing.procurement_category;
    const resolved = resolveItemProcurement({
      procurement_type:
        input.procurement_type || existing.procurement_type || "",
      procurement_category: category,
      item_group: existing.item_group,
    });
    const type =
      input.procurement_type ||
      (existing.procurement_type as MaterialRequestProcurementType) ||
      resolved.procurement_type;
    if (!type) {
      throw new Error(
        "Procurement Type is required (Direct or Indirect). Set it from the Item category mapping.",
      );
    }
    validateProcurementFields(type, category);
  }

  const payload = buildItemPayload(input, false);
  if (Object.keys(payload).length === 0) {
    const existing = await getItemMaster(code);
    if (!existing) throw new Error(`Item "${code}" not found.`);
    return existing;
  }

  await apiPut(buildResourceUrl(ITEM_DOCTYPE, code), payload);

  if (input.procurement_type && input.procurement_category?.trim()) {
    await persistItemProcurementFields(code, {
      procurement_type: input.procurement_type,
      procurement_category: input.procurement_category.trim(),
      lifecycle_status: input.lifecycle_status,
    });
  }

  const updated = await getItemMaster(code);
  if (!updated) throw new Error(`Item "${code}" not found after update.`);
  return updated;
}

/**
 * One-time (idempotent) backfill: write inferred Procurement Type/Category
 * onto ERP Items that are still missing custom fields.
 */
export async function backfillItemProcurementFields(options?: {
  limit?: number;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ updated: number; skipped: number; failed: number }> {
  const limit = options?.limit ?? 2000;
  const raw = await fetchItemMasterRows([], limit);
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  // Include items with missing fields OR incorrect type for their category
  // (e.g. Stationery stored as Direct).
  const targets = raw.map(mapRawItemRow);

  options?.onProgress?.(0, targets.length);

  for (let i = 0; i < targets.length; i++) {
    const row = targets[i];
    const resolved = resolveItemProcurement({
      procurement_type: row.procurement_type,
      procurement_category: row.procurement_category,
      item_group: row.item_group,
    });

    if (!resolved.procurement_type || !resolved.procurement_category) {
      skipped += 1;
      options?.onProgress?.(i + 1, targets.length);
      continue;
    }

    // Already correct on ERP — skip write.
    if (
      row.procurement_type === resolved.procurement_type &&
      row.procurement_category === resolved.procurement_category
    ) {
      skipped += 1;
      options?.onProgress?.(i + 1, targets.length);
      continue;
    }

    try {
      await persistItemProcurementFields(row.item_code, {
        procurement_type: resolved.procurement_type,
        procurement_category: resolved.procurement_category,
        lifecycle_status: row.lifecycle_status,
      });
      updated += 1;
      // eslint-disable-next-line no-console
      console.info(
        `${LOG_TAG} backfill ${row.item_code}: ` +
          `${row.procurement_type || "(empty)"}/${row.procurement_category || "(empty)"} → ` +
          `${resolved.procurement_type}/${resolved.procurement_category}`,
      );
    } catch (err) {
      failed += 1;
      // eslint-disable-next-line no-console
      console.error(`${LOG_TAG} backfill failed for ${row.item_code}`, err);
    }
    options?.onProgress?.(i + 1, targets.length);
  }

  // eslint-disable-next-line no-console
  console.info(`${LOG_TAG} backfill complete`, { updated, skipped, failed });
  return { updated, skipped, failed };
}

export async function listItemCodes(): Promise<string[]> {
  const rows = await apiGet<Array<{ item_code: string }>>(
    buildResourceUrl(ITEM_DOCTYPE),
    {
      ...buildListConfig({
        fields: ["item_code"],
        limit_page_length: 5000,
        order_by: "item_code asc",
      }),
      ...withSilent(),
    },
  );
  return (rows ?? []).map((r) => r.item_code).filter(Boolean);
}
