/**
 * Warehouse stock overview — thin adapter over shared warehouseInventoryService.
 * Available Qty comes from ERPNext Bin via the shared service (never hard-coded 0).
 */
import type { QueryClient } from "@tanstack/react-query";

import { getCount, COMPANY } from "./erpnext";
import {
  fetchInventorySnapshot,
  fetchErpStockBalanceQty,
  resolveInventoryWarehouses,
  type InventoryStockRow,
  type InventoryStockStatus,
} from "./warehouseInventoryService";

const DEFAULT_PAGE_SIZE = 100;

export type WarehouseStockStatus = InventoryStockStatus;

export interface WarehouseStockRow {
  item_code: string;
  item_name: string;
  description: string;
  category: string;
  uom: string;
  warehouse: string;
  current_stock: number;
  available_qty: number;
  reserved_qty: number;
  reorder_level: number;
  status: WarehouseStockStatus;
  raw_erp_qty?: number;
  source?: InventoryStockRow["source"];
}

export interface WarehouseStockSummary {
  rows: WarehouseStockRow[];
  total: number;
  kpis: {
    totalAvailableQty: number;
    lowStockCount: number;
    reorderRequiredCount: number;
    outOfStockCount: number;
    grnsLast30Days: number;
  };
}

function thirtyDaysAgoIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

/** @deprecated Prefer fetchErpStockBalanceQty from warehouseInventoryService */
export async function fetchErpStockBalance(
  itemCode: string,
  warehouse: string,
): Promise<number | null> {
  return fetchErpStockBalanceQty(itemCode, warehouse);
}

async function fetchGrnsLast30DaysCount(): Promise<number> {
  try {
    return await getCount("Purchase Receipt", [
      ["docstatus", "=", 1],
      ["posting_date", ">=", thirtyDaysAgoIso()],
    ]);
  } catch {
    return 0;
  }
}

export interface FetchWarehouseStockParams {
  search?: string;
  warehouse?: string;
  status?: WarehouseStockStatus | "";
}

function toWarehouseRow(row: InventoryStockRow): WarehouseStockRow {
  return {
    item_code: row.item_code,
    item_name: row.item_name,
    description: row.description,
    category: row.category,
    uom: row.uom,
    warehouse: row.warehouse,
    current_stock: row.actual_qty,
    available_qty: row.available_qty,
    reserved_qty: row.reserved_qty,
    reorder_level: row.reorder_level,
    status: row.status,
    raw_erp_qty: row.raw_actual_qty,
    source: row.source,
  };
}

/**
 * Loads warehouse stock from the shared inventory service (ERPNext Bin).
 */
export async function fetchWarehouseStockSummary(
  params: FetchWarehouseStockParams = {},
): Promise<WarehouseStockSummary> {
  const { search = "", warehouse = "", status = "" } = params;

  // eslint-disable-next-line no-console
  console.log("[WarehouseStock] fetchWarehouseStockSummary via shared service", {
    company: COMPANY,
    warehouse: warehouse || "(all)",
    search,
    status,
  });

  const [snapshot, grnsLast30Days] = await Promise.all([
    fetchInventorySnapshot({
      warehouse: warehouse || undefined,
      search,
      status: status || undefined,
    }),
    fetchGrnsLast30DaysCount(),
  ]);

  const rows = snapshot.rows.map(toWarehouseRow);

  // eslint-disable-next-line no-console
  console.log("[WarehouseStock] summary mapped for UI", {
    rowCount: rows.length,
    totalAvailableQty: snapshot.kpis.totalAvailableQty,
    diagnostics: snapshot.diagnostics,
    sample: rows.slice(0, 5).map((r) => ({
      item_code: r.item_code,
      warehouse: r.warehouse,
      available_qty: r.available_qty,
      actual: r.current_stock,
      reserved: r.reserved_qty,
      source: r.source,
    })),
  });

  return {
    rows,
    total: rows.length,
    kpis: {
      totalAvailableQty: snapshot.kpis.totalAvailableQty,
      lowStockCount: snapshot.kpis.lowStockCount,
      reorderRequiredCount:
        snapshot.kpis.reorderRequiredCount ?? snapshot.kpis.lowStockCount,
      outOfStockCount: snapshot.kpis.outOfStockCount,
      grnsLast30Days,
    },
  };
}

/** Distinct warehouse names for filter dropdown. */
export async function fetchWarehouseNames(): Promise<string[]> {
  const names = await resolveInventoryWarehouses();
  return [...names].sort();
}

/** Bump cache when inventory mapping changes. */
export const WAREHOUSE_STOCK_QUERY_KEY = [
  "warehouse",
  "stock-summary",
  "v4-reorder-required",
] as const;
export const WAREHOUSE_NAMES_QUERY_KEY = [
  "warehouse",
  "warehouse-names",
  "v3-shared-inv",
] as const;
export const WAREHOUSE_STOCK_STALE_MS = 2 * 60_000;
export const WAREHOUSE_STOCK_PAGE_SIZE = DEFAULT_PAGE_SIZE;

const WAREHOUSE_STOCK_INVALIDATION_KEYS: readonly (readonly unknown[])[] = [
  ["warehouse"],
  ["bins"],
  ["items"],
  ["item-bins"],
  ["item-movements"],
  ["purchase-receipts"],
  ["purchase-receipt"],
  ["incoming-purchase-orders"],
  ["open-purchase-orders"],
  ["po-grns"],
  ["warehouse-grn-list"],
  ["mr-procurement-queue"],
] as const;

export function invalidateWarehouseStock(queryClient: QueryClient): void {
  for (const queryKey of WAREHOUSE_STOCK_INVALIDATION_KEYS) {
    void queryClient.invalidateQueries({ queryKey: queryKey as unknown[] });
  }
}
