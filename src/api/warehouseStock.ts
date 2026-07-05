/**
 * Warehouse stock overview — live ERPNext Bin + Item data (no mock fallbacks).
 */
import { apiGet, buildListConfig, buildResourceUrl, getCount, withSilent, COMPANY } from "./erpnext";
import type { Filter } from "./erpnext";
import type { Bin, Item } from "../types/erpnext";

const REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_PAGE_SIZE = 100;
const MAX_BINS = 500;

/** True when the ERPNext response indicates the caller lacks permission. */
function isForbidden(err: unknown): boolean {
  const status = (err as { response?: { status?: number } } | undefined)
    ?.response?.status;
  return status === 403;
}

function logDoctypeFailure(doctype: string, err: unknown): void {
  const status = (err as { response?: { status?: number } } | undefined)
    ?.response?.status;
  if (isForbidden(err)) {
    // eslint-disable-next-line no-console
    console.error(
      `[Warehouse] 403 Forbidden fetching "${doctype}" — continuing with an empty widget instead of blocking the dashboard.`,
      err
    );
  } else {
    // eslint-disable-next-line no-console
    console.error(`[Warehouse] Failed to fetch "${doctype}" (status: ${status ?? "n/a"}):`, err);
  }
}

export type WarehouseStockStatus = "In Stock" | "Low Stock" | "Out of Stock";

export interface WarehouseStockRow {
  item_code: string;
  item_name: string;
  description: string;
  category: string;
  uom: string;
  warehouse: string;
  available_qty: number;
  reserved_qty: number;
  reorder_level: number;
  status: WarehouseStockStatus;
}

export interface WarehouseStockSummary {
  rows: WarehouseStockRow[];
  total: number;
  kpis: {
    totalAvailableQty: number;
    lowStockCount: number;
    outOfStockCount: number;
    grnsLast30Days: number;
  };
}

function deriveStatus(available: number, reorder: number): WarehouseStockStatus {
  if (available <= 0) return "Out of Stock";
  if (reorder > 0 && available <= reorder) return "Low Stock";
  return "In Stock";
}

function thirtyDaysAgoIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

/** Never throws — a 403 or any other failure resolves to an empty list so the
 *  dashboard can render an empty widget instead of blocking on this call. */
async function fetchBins(warehouse?: string): Promise<Bin[]> {
  // Fetch Netlink warehouses first to exclude cross-company stock data
  let netlinkWhNames: string[] = [];
  try {
    const list = await apiGet<any[]>("/api/resource/Warehouse", {
      params: {
        filters: JSON.stringify([
          ["company", "=", COMPANY],
          ["is_group", "=", 0],
          ["disabled", "=", 0],
        ]),
        fields: JSON.stringify(["name"]),
        limit_page_length: 500,
      },
      timeout: REQUEST_TIMEOUT_MS,
    });
    netlinkWhNames = Array.isArray(list) ? list.map((w) => w.name) : [];
  } catch (err) {
    logDoctypeFailure("Warehouse", err);
    return [];
  }

  if (netlinkWhNames.length === 0) return [];

  const filters: Filter[] = [];
  if (warehouse) {
    if (!netlinkWhNames.includes(warehouse)) return [];
    filters.push(["warehouse", "=", warehouse]);
  } else {
    filters.push(["warehouse", "in", netlinkWhNames]);
  }

  try {
    return await apiGet<Bin[]>(
      buildResourceUrl("Bin"),
      {
        ...buildListConfig({
          fields: [
            "item_code",
            "warehouse",
            "actual_qty",
            "reserved_qty",
            "stock_uom",
          ],
          filters,
          order_by: "warehouse asc, item_code asc",
          limit_page_length: MAX_BINS,
        }),
        ...withSilent(),
        timeout: REQUEST_TIMEOUT_MS,
      }
    );
  } catch (err) {
    logDoctypeFailure("Bin", err);
    return [];
  }
}

/** Never throws — falls back to an empty map on failure (incl. 403). */
async function fetchItemsByCode(codes: string[]): Promise<Map<string, Item>> {
  if (codes.length === 0) return new Map();

  try {
    const items = await apiGet<Item[]>(
      buildResourceUrl("Item"),
      {
        ...buildListConfig({
          fields: [
            "item_code",
            "item_name",
            "description",
            "item_group",
            "stock_uom",
            "disabled",
          ],
          filters: [
            ["disabled", "=", 0],
            ["item_code", "in", codes],
          ],
          limit_page_length: codes.length,
        }),
        ...withSilent(),
        timeout: REQUEST_TIMEOUT_MS,
      }
    );

    return new Map((items ?? []).map((item) => [item.item_code, item]));
  } catch (err) {
    logDoctypeFailure("Item", err);
    return new Map();
  }
}

/** Never throws — Purchase Receipt access is optional; falls back to 0. */
async function fetchGrnsLast30DaysCount(): Promise<number> {
  try {
    return await getCount("Purchase Receipt", [
      ["docstatus", "=", 1],
      ["posting_date", ">=", thirtyDaysAgoIso()],
    ]);
  } catch (err) {
    logDoctypeFailure("Purchase Receipt", err);
    return 0;
  }
}

export interface FetchWarehouseStockParams {
  search?: string;
  warehouse?: string;
  status?: WarehouseStockStatus | "";
}

/**
 * Loads warehouse stock from ERPNext Bin records joined with Item master fields.
 * Returns an empty list when ERPNext has no bin rows — never injects mock data.
 */
export async function fetchWarehouseStockSummary(
  params: FetchWarehouseStockParams = {}
): Promise<WarehouseStockSummary> {
  const { search = "", warehouse = "", status = "" } = params;

  // Promise.allSettled — a failure on one call (e.g. Purchase Receipt 403)
  // must never block the other or leave the summary unresolved.
  const [binsResult, grnsResult] = await Promise.allSettled([
    fetchBins(warehouse || undefined),
    fetchGrnsLast30DaysCount(),
  ]);

  const bins = binsResult.status === "fulfilled" ? binsResult.value : [];
  if (binsResult.status === "rejected") {
    logDoctypeFailure("Bin", binsResult.reason);
  }
  const grnsLast30Days = grnsResult.status === "fulfilled" ? grnsResult.value : 0;
  if (grnsResult.status === "rejected") {
    logDoctypeFailure("Purchase Receipt", grnsResult.reason);
  }

  const itemCodes = [...new Set(bins.map((b) => b.item_code).filter(Boolean))];
  const itemMap = await fetchItemsByCode(itemCodes);

  const searchLower = search.trim().toLowerCase();

  let rows: WarehouseStockRow[] = bins.map((bin) => {
    const item = itemMap.get(bin.item_code);
    const available = bin.actual_qty ?? 0;
    const reserved = bin.reserved_qty ?? 0;
    const reorder = item?.safety_stock ?? 0;

    return {
      item_code: bin.item_code,
      item_name: item?.item_name ?? bin.item_code,
      description: item?.description ?? "",
      category: item?.item_group ?? "Uncategorized",
      uom: bin.stock_uom ?? item?.stock_uom ?? "Nos",
      warehouse: bin.warehouse,
      available_qty: available,
      reserved_qty: reserved,
      reorder_level: reorder,
      status: deriveStatus(available, reorder),
    };
  });

  if (searchLower) {
    rows = rows.filter(
      (row) =>
        row.item_name.toLowerCase().includes(searchLower) ||
        row.item_code.toLowerCase().includes(searchLower) ||
        row.description.toLowerCase().includes(searchLower)
    );
  }

  if (status) {
    rows = rows.filter((row) => row.status === status);
  }

  const kpis = {
    totalAvailableQty: rows.reduce((sum, row) => sum + row.available_qty, 0),
    lowStockCount: rows.filter((row) => row.status === "Low Stock").length,
    outOfStockCount: rows.filter((row) => row.status === "Out of Stock").length,
    grnsLast30Days,
  };

  return {
    rows,
    total: rows.length,
    kpis,
  };
}

/** Distinct warehouse names from Bin records (for filter dropdown). */
export async function fetchWarehouseNames(): Promise<string[]> {
  const bins = await fetchBins();
  return [...new Set(bins.map((b) => b.warehouse).filter(Boolean))].sort();
}

export const WAREHOUSE_STOCK_QUERY_KEY = ["warehouse", "stock-summary"] as const;
export const WAREHOUSE_NAMES_QUERY_KEY = ["warehouse", "warehouse-names"] as const;
export const WAREHOUSE_STOCK_STALE_MS = 5 * 60_000;
export const WAREHOUSE_STOCK_PAGE_SIZE = DEFAULT_PAGE_SIZE;
