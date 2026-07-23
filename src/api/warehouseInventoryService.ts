/**
 * Shared Warehouse Inventory Service — single ERPNext stock source.
 *
 * All Warehouse screens (Stock Overview, Dashboard, MR Review, Issue Items)
 * MUST read stock through this module so quantities stay identical.
 *
 * Primary source: ERPNext Bin (actual_qty / reserved_qty)
 * Fallback:     erpnext.stock.utils.get_stock_balance (SLE)
 * Optional:     Stock Balance report
 *
 * Does NOT touch Procurement / RFQ / PO / Finance workflows.
 */

import {
  apiGet,
  apiPost,
  buildListConfig,
  buildResourceUrl,
  withSilent,
  COMPANY,
} from "./erpnext";
import type { Filter } from "./erpnext";
import {
  computeBinAvailability,
  nonNegativeQty,
  resolveInventoryStockStatus,
} from "../utils/inventoryStock";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_BINS = 5000;

export type InventoryStockStatus = "In Stock" | "Low Stock" | "Out of Stock";

export interface InventoryStockRow {
  item_code: string;
  item_name: string;
  description: string;
  category: string;
  uom: string;
  warehouse: string;
  /** Bin.actual_qty (clamped ≥ 0 for display). */
  actual_qty: number;
  reserved_qty: number;
  /** Available = max(0, actual) — ERPNext on-hand, never stock − MR qty. */
  available_qty: number;
  reorder_level: number;
  status: InventoryStockStatus;
  raw_actual_qty: number;
  source: "bin" | "get_stock_balance" | "stock_balance_report";
}

export interface InventorySnapshot {
  rows: InventoryStockRow[];
  total: number;
  kpis: {
    totalAvailableQty: number;
    lowStockCount: number;
    outOfStockCount: number;
  };
  diagnostics: {
    company: string;
    warehouseCount: number;
    binCount: number;
    source: string;
  };
}

export interface ItemWarehouseStock {
  item_code: string;
  warehouse: string;
  actual_qty: number;
  reserved_qty: number;
  available_qty: number;
  source: InventoryStockRow["source"];
}

function logInv(stage: string, payload?: unknown): void {
  // Always log — required to diagnose zero-stock mapping.
  // eslint-disable-next-line no-console
  console.log(`[WarehouseInventory] ${stage}`, payload ?? "");
}

function logInvWarn(stage: string, payload?: unknown): void {
  // eslint-disable-next-line no-console
  console.warn(`[WarehouseInventory] ${stage}`, payload ?? "");
}

/**
 * Resolve leaf warehouses for Warehouse inventory — COMPANY (Netlink) only.
 * Never falls back to Company Bidsphere (or any other company) warehouses.
 */
export async function resolveInventoryWarehouses(): Promise<string[]> {
  try {
    const list = await apiGet<Array<{ name?: string; company?: string }>>(
      buildResourceUrl("Warehouse"),
      {
        ...buildListConfig({
          fields: ["name", "company"],
          filters: [
            ["company", "=", COMPANY],
            ["is_group", "=", 0],
            ["disabled", "=", 0],
          ],
          limit_page_length: 500,
          order_by: "name asc",
        }),
        ...withSilent(),
        timeout: REQUEST_TIMEOUT_MS,
      },
    );
    const names = (Array.isArray(list) ? list : [])
      .map((w) => w.name)
      .filter((n): n is string => Boolean(n));
    logInv(`Warehouses (company=${COMPANY})`, {
      companyFilter: COMPANY,
      count: names.length,
      sample: names.slice(0, 10),
    });
    if (names.length === 0) {
      logInvWarn(
        "No Netlink warehouses found — inventory will be empty (Bidsphere warehouses are never used)",
        { COMPANY },
      );
    }
    return names;
  } catch (err) {
    logInvWarn(`Warehouses (company=${COMPANY}) failed`, err);
    return [];
  }
}

type RawBin = {
  item_code?: string;
  warehouse?: string;
  actual_qty?: number;
  reserved_qty?: number;
  stock_uom?: string;
};

/**
 * Fetch Bin rows — primary ERPNext inventory source.
 * Always scoped to Netlink warehouses when no explicit list is provided.
 * Never queries unfiltered Bins (that would include Company Bidsphere).
 */
export async function fetchInventoryBins(opts?: {
  warehouse?: string;
  itemCode?: string;
  warehouses?: string[];
}): Promise<RawBin[]> {
  const filters: Filter[] = [];

  if (opts?.warehouse) {
    filters.push(["warehouse", "=", opts.warehouse]);
  } else if (opts?.warehouses && opts.warehouses.length > 0) {
    filters.push(["warehouse", "in", opts.warehouses]);
  } else {
    const warehouseNames = await resolveInventoryWarehouses();
    if (warehouseNames.length > 0) {
      filters.push(["warehouse", "in", warehouseNames]);
    } else {
      logInvWarn(
        "fetchInventoryBins: no Netlink warehouses — returning empty (refusing Bidsphere fallback)",
      );
      return [];
    }
  }

  if (opts?.itemCode) {
    filters.push(["item_code", "=", opts.itemCode]);
  }

  const request = {
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
  };

  logInv("Bin REQUEST", {
    url: buildResourceUrl("Bin"),
    ...request,
    company: COMPANY,
  });

  try {
    const bins = await apiGet<RawBin[]>(buildResourceUrl("Bin"), {
      ...buildListConfig(request),
      ...withSilent(),
      timeout: REQUEST_TIMEOUT_MS,
    });
    const list = Array.isArray(bins) ? bins : [];
    logInv("Bin RESPONSE", {
      count: list.length,
      sample: list.slice(0, 8).map((b) => ({
        item_code: b.item_code,
        warehouse: b.warehouse,
        actual_qty: b.actual_qty,
        reserved_qty: b.reserved_qty,
      })),
      zeroActual: list.filter((b) => Number(b.actual_qty) === 0).length,
      positiveActual: list.filter((b) => Number(b.actual_qty) > 0).length,
    });
    return list;
  } catch (err) {
    logInvWarn("Bin REQUEST failed", err);
    return [];
  }
}

/** SLE-backed balance for one item/warehouse. */
export async function fetchErpStockBalanceQty(
  itemCode: string,
  warehouse: string,
): Promise<number | null> {
  if (!itemCode || !warehouse) return null;
  logInv("get_stock_balance REQUEST", { itemCode, warehouse });
  try {
    const result = await apiPost<unknown>(
      "/api/method/erpnext.stock.utils.get_stock_balance",
      { item_code: itemCode, warehouse },
      { timeout: REQUEST_TIMEOUT_MS, ...withSilent() },
    );
    const n = typeof result === "number" ? result : Number(result);
    logInv("get_stock_balance RESPONSE", { itemCode, warehouse, result: n });
    if (!Number.isFinite(n)) return null;
    return n;
  } catch (err) {
    logInvWarn("get_stock_balance failed", { itemCode, warehouse, err });
    return null;
  }
}

/**
 * Available qty for one item in one warehouse.
 * available = max(0, Bin.actual_qty). Never stock − requested.
 */
export async function getItemWarehouseStock(
  itemCode: string,
  warehouse: string,
): Promise<ItemWarehouseStock> {
  const bins = await fetchInventoryBins({ itemCode, warehouse });
  const bin = bins[0];
  if (bin) {
    const { currentStock, reservedQty, availableQty, rawActualQty } =
      computeBinAvailability(bin.actual_qty, bin.reserved_qty);
    logInv("getItemWarehouseStock Bin", {
      itemCode,
      warehouse,
      raw_actual_qty: bin.actual_qty,
      ui_available: availableQty,
      rawActualQty,
    });
    return {
      item_code: itemCode,
      warehouse,
      actual_qty: currentStock,
      reserved_qty: reservedQty,
      available_qty: availableQty,
      source: "bin",
    };
  }

  const sle = await fetchErpStockBalanceQty(itemCode, warehouse);
  const available = nonNegativeQty(sle ?? 0);
  logInv("getItemWarehouseStock SLE fallback", {
    itemCode,
    warehouse,
    sle,
    ui_available: available,
  });
  return {
    item_code: itemCode,
    warehouse,
    actual_qty: available,
    reserved_qty: 0,
    available_qty: available,
    source: "get_stock_balance",
  };
}

/**
 * Sum available qty for an item across warehouses.
 *
 * @param company When set, ONLY warehouses for that company are used
 *   (Stock Entry / Issue Material). No cross-company Bin fallback.
 *   When omitted, uses inventory resolver (may broaden for display).
 */
const warehouseListCache = new Map<
  string,
  { names: string[]; at: number }
>();
const WAREHOUSE_LIST_CACHE_MS = 60_000;

async function listWarehousesForCompany(company: string): Promise<string[]> {
  const cached = warehouseListCache.get(company);
  if (cached && Date.now() - cached.at < WAREHOUSE_LIST_CACHE_MS) {
    return cached.names;
  }
  const list = await apiGet<Array<{ name?: string; company?: string }>>(
    buildResourceUrl("Warehouse"),
    {
      ...buildListConfig({
        fields: ["name", "company"],
        filters: [
          ["company", "=", company],
          ["is_group", "=", 0],
          ["disabled", "=", 0],
        ],
        limit_page_length: 500,
        order_by: "name asc",
      }),
      ...withSilent(),
      timeout: REQUEST_TIMEOUT_MS,
    },
  );
  let names = (Array.isArray(list) ? list : [])
    .map((w) => w.name)
    .filter((n): n is string => Boolean(n));

  // Recovery when VITE_COMPANY ≠ ERP Company name: discover via Stores*.
  if (names.length === 0) {
    logInvWarn("listWarehousesForCompany empty — Stores* discovery", {
      company,
    });
    const storesLike = await apiGet<
      Array<{ name?: string; company?: string }>
    >(buildResourceUrl("Warehouse"), {
      ...buildListConfig({
        fields: ["name", "company"],
        filters: [
          ["is_group", "=", 0],
          ["disabled", "=", 0],
          ["name", "like", "%Stores%"],
        ],
        limit_page_length: 50,
        order_by: "name asc",
      }),
      ...withSilent(),
      timeout: REQUEST_TIMEOUT_MS,
    });
    const usable = (Array.isArray(storesLike) ? storesLike : []).filter(
      (w) =>
        w.name &&
        w.company &&
        String(w.company).trim().toLowerCase() !== "bidsphere",
    );
    const preferred =
      usable.find((w) => /NSGAI/i.test(String(w.name))) || usable[0];
    const discovered = (preferred?.company || "").trim();
    logInv("Stores* discovery for stock", {
      preferred: preferred?.name,
      discoveredCompany: discovered,
    });
    if (discovered) {
      const recovered = await apiGet<Array<{ name?: string }>>(
        buildResourceUrl("Warehouse"),
        {
          ...buildListConfig({
            fields: ["name"],
            filters: [
              ["company", "=", discovered],
              ["is_group", "=", 0],
              ["disabled", "=", 0],
            ],
            limit_page_length: 500,
            order_by: "name asc",
          }),
          ...withSilent(),
          timeout: REQUEST_TIMEOUT_MS,
        },
      );
      names = (Array.isArray(recovered) ? recovered : [])
        .map((w) => w.name)
        .filter((n): n is string => Boolean(n));
    }
  }

  warehouseListCache.set(company, { names, at: Date.now() });
  return names;
}

export async function getItemStockAcrossWarehouses(
  itemCode: string,
  opts?: {
    company?: string;
    forIssue?: boolean;
    /** Pre-resolved warehouse names — skips repeated Warehouse list queries. */
    warehouses?: string[];
    preferredWarehouse?: string;
  },
): Promise<{
  total_available: number;
  total_actual: number;
  total_reserved: number;
  by_warehouse: ItemWarehouseStock[];
  company: string;
}> {
  // Warehouse module scopes to Netlink / MR company. Never Bidsphere.
  const company = (opts?.company?.trim() || COMPANY).trim() || COMPANY;
  const forIssue = Boolean(opts?.forIssue);

  logInv("getItemStockAcrossWarehouses REQUEST", {
    itemCode,
    company,
    forIssue,
    preferredWarehouse: opts?.preferredWarehouse || null,
    preResolvedWarehouses: opts?.warehouses?.length ?? 0,
  });

  let warehouses =
    opts?.warehouses && opts.warehouses.length > 0
      ? opts.warehouses
      : await listWarehousesForCompany(company);

  logInv("getItemStockAcrossWarehouses warehouses", {
    itemCode,
    company,
    count: warehouses.length,
    sample: warehouses.slice(0, 10),
  });

  let bins: RawBin[] = [];
  if (warehouses.length === 0) {
    logInvWarn(
      "getItemStockAcrossWarehouses: no warehouses for company — stock = 0 (no Bidsphere fallback)",
      { itemCode, company },
    );
  } else {
    bins = await fetchInventoryBins({ itemCode, warehouses });
  }

  let by_warehouse: ItemWarehouseStock[] = bins.map((b) => {
    const { currentStock, reservedQty, availableQty } = computeBinAvailability(
      b.actual_qty,
      b.reserved_qty,
    );
    return {
      item_code: itemCode,
      warehouse: String(b.warehouse || ""),
      actual_qty: currentStock,
      reserved_qty: reservedQty,
      available_qty: availableQty,
      source: "bin" as const,
    };
  });

  // SLE fallback when Bin has no rows for this item (common for new items).
  if (by_warehouse.length === 0 && warehouses.length > 0) {
    const probe =
      opts?.preferredWarehouse &&
      warehouses.includes(opts.preferredWarehouse)
        ? opts.preferredWarehouse
        : warehouses.find((w) => /stores/i.test(w)) || warehouses[0]!;
    logInvWarn("Bin empty — get_stock_balance fallback", {
      itemCode,
      warehouse: probe,
    });
    const sle = await fetchErpStockBalanceQty(itemCode, probe);
    if (sle != null) {
      const available = nonNegativeQty(sle);
      by_warehouse = [
        {
          item_code: itemCode,
          warehouse: probe,
          actual_qty: available,
          reserved_qty: 0,
          available_qty: available,
          source: "get_stock_balance",
        },
      ];
    }
  }

  const total_actual = by_warehouse.reduce((s, r) => s + r.actual_qty, 0);
  const total_reserved = by_warehouse.reduce((s, r) => s + r.reserved_qty, 0);
  const total_available = by_warehouse.reduce((s, r) => s + r.available_qty, 0);

  logInv("getItemStockAcrossWarehouses RESPONSE", {
    itemCode,
    company,
    forIssue,
    warehouseCount: by_warehouse.length,
    total_actual,
    total_reserved,
    total_available,
    sample: by_warehouse.slice(0, 5),
  });

  return {
    total_available,
    total_actual,
    total_reserved,
    by_warehouse,
    company,
  };
}

async function fetchItemsByCode(
  codes: string[],
): Promise<
  Map<
    string,
    {
      item_name?: string;
      description?: string;
      item_group?: string;
      stock_uom?: string;
      safety_stock?: number;
    }
  >
> {
  if (codes.length === 0) return new Map();
  try {
    const items = await apiGet<
      Array<{
        item_code: string;
        item_name?: string;
        description?: string;
        item_group?: string;
        stock_uom?: string;
        safety_stock?: number;
      }>
    >(buildResourceUrl("Item"), {
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
        limit_page_length: Math.max(codes.length, 1),
      }),
      ...withSilent(),
      timeout: REQUEST_TIMEOUT_MS,
    });
    return new Map((items ?? []).map((i) => [i.item_code, i]));
  } catch (err) {
    logInvWarn("Item master fetch failed", err);
    return new Map();
  }
}

/**
 * Full inventory snapshot for Stock Overview / Dashboard KPIs.
 * Available Qty comes from ERPNext Bin.actual_qty (never hard-coded 0).
 */
export async function fetchInventorySnapshot(opts?: {
  warehouse?: string;
  search?: string;
  status?: InventoryStockStatus | "";
}): Promise<InventorySnapshot> {
  const warehouses = await resolveInventoryWarehouses();
  const bins = await fetchInventoryBins({
    warehouse: opts?.warehouse,
    warehouses: opts?.warehouse ? undefined : warehouses,
  });

  const itemCodes = [
    ...new Set(bins.map((b) => b.item_code).filter(Boolean)),
  ] as string[];
  const itemMap = await fetchItemsByCode(itemCodes);

  let rows: InventoryStockRow[] = bins
    .filter((b) => b.item_code && b.warehouse)
    .map((bin) => {
      const item = itemMap.get(String(bin.item_code));
      const { currentStock, reservedQty, availableQty, rawActualQty } =
        computeBinAvailability(bin.actual_qty, bin.reserved_qty);
      const reorder = nonNegativeQty(item?.safety_stock);
      return {
        item_code: String(bin.item_code),
        item_name: item?.item_name ?? String(bin.item_code),
        description: item?.description ?? "",
        category: item?.item_group ?? "Uncategorized",
        uom: bin.stock_uom ?? item?.stock_uom ?? "Nos",
        warehouse: String(bin.warehouse),
        actual_qty: currentStock,
        reserved_qty: reservedQty,
        available_qty: availableQty,
        reorder_level: reorder,
        status: resolveInventoryStockStatus(availableQty, reorder),
        raw_actual_qty: rawActualQty,
        source: "bin" as const,
      };
    });

  // If Bin is empty, try Stock Balance report as last resort.
  if (rows.length === 0) {
    logInvWarn("Bin returned 0 rows — attempting Stock Balance report fallback");
    const reportRows = await fetchStockBalanceReportFallback(opts?.warehouse);
    rows = reportRows;
  }

  const searchLower = (opts?.search || "").trim().toLowerCase();
  if (searchLower) {
    rows = rows.filter(
      (r) =>
        r.item_code.toLowerCase().includes(searchLower) ||
        r.item_name.toLowerCase().includes(searchLower) ||
        r.description.toLowerCase().includes(searchLower),
    );
  }
  if (opts?.status) {
    rows = rows.filter((r) => r.status === opts.status);
  }

  const totalAvailableQty = rows.reduce(
    (s, r) => s + nonNegativeQty(r.available_qty),
    0,
  );

  const snapshot: InventorySnapshot = {
    rows,
    total: rows.length,
    kpis: {
      totalAvailableQty,
      lowStockCount: rows.filter((r) => r.status === "Low Stock").length,
      outOfStockCount: rows.filter((r) => r.status === "Out of Stock").length,
    },
    diagnostics: {
      company: COMPANY,
      warehouseCount: warehouses.length,
      binCount: bins.length,
      source: rows[0]?.source || "bin",
    },
  };

  logInv("fetchInventorySnapshot RESULT", {
    rowCount: snapshot.total,
    totalAvailableQty: snapshot.kpis.totalAvailableQty,
    diagnostics: snapshot.diagnostics,
    sample: snapshot.rows.slice(0, 5).map((r) => ({
      item_code: r.item_code,
      warehouse: r.warehouse,
      actual_qty: r.actual_qty,
      available_qty: r.available_qty,
      reserved_qty: r.reserved_qty,
    })),
  });

  return snapshot;
}

async function fetchStockBalanceReportFallback(
  warehouse?: string,
): Promise<InventoryStockRow[]> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const filters: Record<string, string> = {
      company: COMPANY,
      from_date: `${new Date().getFullYear()}-01-01`,
      to_date: today,
    };
    if (warehouse) filters.warehouse = warehouse;

    logInv("Stock Balance REPORT REQUEST", filters);
    const raw = await apiPost<Record<string, unknown>>(
      "/api/method/frappe.desk.query_report.run",
      {
        report_name: "Stock Balance",
        filters,
        ignore_prepared_report: 1,
      },
      { timeout: 25_000, ...withSilent() },
    );

    logInv("Stock Balance REPORT RESPONSE", {
      keys: raw && typeof raw === "object" ? Object.keys(raw) : [],
      resultLen: Array.isArray(raw?.result) ? raw.result.length : 0,
      sample: Array.isArray(raw?.result)
        ? (raw.result as unknown[]).slice(0, 3)
        : null,
    });

    const result = Array.isArray(raw?.result) ? (raw.result as unknown[]) : [];
    const columns = Array.isArray(raw?.columns) ? (raw.columns as unknown[]) : [];
    const colKeys = columns.map((c) => {
      if (c && typeof c === "object" && "fieldname" in c) {
        return String((c as { fieldname: string }).fieldname);
      }
      return typeof c === "string" ? c : "";
    });
    const idx = (n: string) => colKeys.indexOf(n);

    const rows: InventoryStockRow[] = [];
    for (const row of result) {
      let item_code = "";
      let wh = "";
      let bal = NaN;
      let item_name = "";
      let uom = "Nos";

      if (row && typeof row === "object" && !Array.isArray(row)) {
        const r = row as Record<string, unknown>;
        item_code = String(r.item_code ?? "");
        wh = String(r.warehouse ?? "");
        bal = Number(r.bal_qty);
        item_name = String(r.item_name ?? item_code);
        uom = String(r.stock_uom ?? "Nos");
      } else if (Array.isArray(row)) {
        const iItem = idx("item_code");
        const iWh = idx("warehouse");
        const iBal = idx("bal_qty");
        if (iItem < 0 || iWh < 0 || iBal < 0) continue;
        item_code = String(row[iItem] ?? "");
        wh = String(row[iWh] ?? "");
        bal = Number(row[iBal]);
      }

      if (!item_code || !wh || !Number.isFinite(bal)) continue;
      if (item_code === "Total" || wh === "Total") continue;
      const available = nonNegativeQty(bal);
      rows.push({
        item_code,
        item_name: item_name || item_code,
        description: "",
        category: "Uncategorized",
        uom,
        warehouse: wh,
        actual_qty: available,
        reserved_qty: 0,
        available_qty: available,
        reorder_level: 0,
        status: resolveInventoryStockStatus(available, 0),
        raw_actual_qty: bal,
        source: "stock_balance_report",
      });
    }
    return rows;
  } catch (err) {
    logInvWarn("Stock Balance report fallback failed", err);
    return [];
  }
}

/** Convenience: available qty only (for MR stock checks). */
export async function getAvailableQty(
  itemCode: string,
  warehouse?: string,
): Promise<number> {
  if (warehouse) {
    const stock = await getItemWarehouseStock(itemCode, warehouse);
    return stock.available_qty;
  }
  const across = await getItemStockAcrossWarehouses(itemCode);
  return across.total_available;
}
