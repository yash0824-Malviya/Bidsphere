/**
 * Warehouse Stock Decision — privileged ERP stock lookup.
 *
 * Validates Item / Warehouse / Company, then reads stock via:
 *   1) Bin (actual_qty / reserved_qty)
 *   2) erpnext.stock.utils.get_stock_balance (SLE fallback)
 */

import { sanitizeErpPayloadDates } from "./erpDateSanitize.js";

export class StockCheckError extends Error {
  status: number;
  code:
    | "item_not_found"
    | "warehouse_not_found"
    | "company_mismatch"
    | "permission"
    | "field_not_permitted"
    | "erp"
    | "config"
    | "validation";

  constructor(
    message: string,
    status = 400,
    code: StockCheckError["code"] = "validation",
  ) {
    super(message);
    this.name = "StockCheckError";
    this.status = status;
    this.code = code;
  }
}

type ErpAdminConfig = { baseUrl: string; key: string; secret: string };

export type StockCheckItemInput = {
  item_code: string;
  requested_qty: number;
  /** Warehouse from Material Request item row (if any). */
  mr_warehouse?: string;
};

export type StockCheckRequest = {
  mr_number: string;
  /** Company used for stock filters (Warehouse module / Netlink). */
  company: string;
  /** ERP Material Request.company (may differ; used for diagnostics only). */
  mr_company?: string;
  /** Preferred / Stores warehouse (local issue target). */
  warehouse: string;
  /** Optional explicit warehouse list — otherwise discovered for company. */
  warehouses?: string[];
  items: StockCheckItemInput[];
  user?: string;
};

export type StockCheckWarehouseQty = {
  warehouse: string;
  available_qty: number;
  reserved_qty: number;
  source: "bin" | "get_stock_balance";
};

export type StockCheckRecommendation =
  | "Issue Material"
  | "Stock available in another warehouse"
  | "Forward to Procurement";

export type StockCheckLineResult = {
  item_code: string;
  requested_qty: number;
  /** Total available across all valid company warehouses (matches Inventory). */
  available_qty: number;
  /** Available at preferred/Stores warehouse only. */
  local_available_qty: number;
  reserved_qty: number;
  shortage_qty: number;
  recommendation: StockCheckRecommendation;
  /** Preferred warehouse used for local issue. */
  warehouse: string;
  /** Best warehouse by available qty. */
  best_warehouse: string;
  best_warehouse_qty: number;
  item_default_warehouse?: string;
  mr_warehouse?: string;
  by_warehouse: StockCheckWarehouseQty[];
  source: "bin" | "get_stock_balance" | "bin+aggregated";
};

export type StockCheckSuccess = {
  success: true;
  mr_number: string;
  company: string;
  warehouse: string;
  mr_company?: string;
  notice?: string;
  lines: StockCheckLineResult[];
};

export type StockCheckFailure = {
  success: false;
  message: string;
  code?: StockCheckError["code"];
};

function readErpAdminConfig(): ErpAdminConfig {
  const baseUrl = (
    process.env.ERPNEXT_URL ??
    process.env.VITE_PROXY_TARGET ??
    process.env.VITE_ERPNEXT_URL ??
    ""
  )
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api$/, "");

  const key = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
  const secret = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";

  if (!baseUrl || !key || !secret) {
    throw new StockCheckError(
      "Stock check backend misconfigured: missing ERPNEXT_URL / ERP_API_KEY / ERP_API_SECRET.",
      500,
      "config",
    );
  }
  return { baseUrl, key, secret };
}

function extractErpErrorMessage(json: unknown, fallback: string): string {
  const data = (json ?? {}) as {
    exception?: string;
    exc_type?: string;
    message?: string | { message?: string };
    _server_messages?: string;
    exc?: string;
  };
  if (data._server_messages) {
    try {
      const parsed = JSON.parse(data._server_messages) as string[];
      const first = parsed[0] ? JSON.parse(parsed[0]) : null;
      if (first?.message) return String(first.message);
    } catch {
      /* keep */
    }
  }
  if (typeof data.exception === "string" && data.exception.trim()) {
    return data.exception.replace(/^[^:]+:\s*/, "").trim();
  }
  if (typeof data.message === "string" && data.message.trim()) {
    return data.message.trim();
  }
  if (
    data.message &&
    typeof data.message === "object" &&
    typeof data.message.message === "string"
  ) {
    return data.message.message.trim();
  }
  if (typeof data.exc_type === "string" && data.exc_type.trim()) {
    return data.exc_type;
  }
  return fallback;
}

function classifyErpFailure(message: string, status: number): StockCheckError {
  if (/Field not permitted in query/i.test(message)) {
    return new StockCheckError(message, status || 417, "field_not_permitted");
  }
  if (
    /PermissionError|not permitted|do not have permission|forbidden|401|403/i.test(
      message,
    ) ||
    status === 401 ||
    status === 403
  ) {
    return new StockCheckError(
      message || "Permission Error while reading stock from ERPNext.",
      status || 403,
      "permission",
    );
  }
  if (/DoesNotExistError|not found|does not exist/i.test(message)) {
    return new StockCheckError(message, status || 404, "erp");
  }
  return new StockCheckError(
    message || "ERPNext stock lookup failed.",
    status || 502,
    "erp",
  );
}

async function erpFetch<T = unknown>(
  cfg: ErpAdminConfig,
  path: string,
  init?: { method?: string; body?: unknown; search?: Record<string, string> },
): Promise<{ status: number; data: T; raw: unknown }> {
  const qs = init?.search
    ? `?${new URLSearchParams(init.search).toString()}`
    : "";
  const method = init?.method ?? "GET";
  const url = `${cfg.baseUrl}/api/${path}${qs}`;

  console.log("=== ERP REQUEST ===");
  console.log("Method:", method);
  console.log("URL:", url);
  console.log("Arguments:", init?.body ?? init?.search ?? null);

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `token ${cfg.key}:${cfg.secret}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body:
      init?.body !== undefined
        ? JSON.stringify(sanitizeErpPayloadDates(init.body))
        : undefined,
  });

  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = { raw: text };
  }

  console.log("=== ERP RESPONSE ===");
  console.log("Status:", res.status);
  console.log("Response:", json);

  if (!res.ok) {
    const friendly = extractErpErrorMessage(
      json,
      text || `ERPNext request failed (${res.status})`,
    );
    throw classifyErpFailure(friendly, res.status);
  }

  const wrapped = json as { data?: T; message?: T };
  const data =
    wrapped?.data !== undefined
      ? wrapped.data
      : wrapped?.message !== undefined
        ? wrapped.message
        : (json as T);

  return { status: res.status, data, raw: json };
}

function nonNeg(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return v;
}

async function assertItemExists(
  cfg: ErpAdminConfig,
  itemCode: string,
): Promise<void> {
  try {
    await erpFetch(cfg, `resource/Item/${encodeURIComponent(itemCode)}`, {
      method: "GET",
    });
  } catch (err) {
    if (err instanceof StockCheckError) {
      if (
        err.code === "erp" ||
        /not found|DoesNotExist/i.test(err.message) ||
        err.status === 404
      ) {
        throw new StockCheckError(
          `Item ${itemCode} does not exist in ERPNext.`,
          404,
          "item_not_found",
        );
      }
      throw err;
    }
    throw new StockCheckError(
      `Item ${itemCode} does not exist in ERPNext.`,
      404,
      "item_not_found",
    );
  }
}

function isBidsphereCompany(company: string | null | undefined): boolean {
  return (company || "").trim().toLowerCase() === "bidsphere";
}

async function assertWarehouse(
  cfg: ErpAdminConfig,
  warehouse: string,
  stockCompany: string,
  mrCompany?: string,
): Promise<{ name: string; company: string; notice?: string }> {
  try {
    const { data } = await erpFetch<{ name?: string; company?: string }>(
      cfg,
      `resource/Warehouse/${encodeURIComponent(warehouse)}`,
      {
        method: "GET",
      },
    );
    const name = String(data?.name || "").trim();
    const warehouseCompany = String(data?.company || "").trim();
    if (!name) {
      throw new StockCheckError(
        `Warehouse ${warehouse} not found.`,
        404,
        "warehouse_not_found",
      );
    }

    console.log("Material Request Company:", mrCompany || "(not provided)");
    console.log("Warehouse Company:", warehouseCompany || "(unknown)");
    console.log("Stock Company:", stockCompany);

    // Never read stock from Bidsphere warehouses.
    if (isBidsphereCompany(warehouseCompany)) {
      throw new StockCheckError(
        `Warehouse ${warehouse} belongs to Company Bidsphere and cannot be used for Warehouse Issue. Use a Netlink warehouse (e.g. Stores - NSGAI).`,
        400,
        "company_mismatch",
      );
    }

    let notice: string | undefined;
    if (
      mrCompany &&
      warehouseCompany &&
      mrCompany.trim() !== warehouseCompany.trim()
    ) {
      // Soft business notice — do not block stock lookup (MR may still say Bidsphere).
      notice =
        `Material Request company is "${mrCompany}" while warehouse "${warehouse}" ` +
        `belongs to "${warehouseCompany}". Stock is read from the warehouse company.`;
      console.warn("[stock-check]", notice);
    }

    if (
      stockCompany &&
      warehouseCompany &&
      stockCompany.trim() !== warehouseCompany.trim()
    ) {
      // Prefer warehouse company for Bin/SLE when app stock company string differs.
      notice =
        (notice ? `${notice} ` : "") +
        `Stock filter company "${stockCompany}" differs from warehouse company "${warehouseCompany}"; using warehouse company.`;
      console.warn("[stock-check]", notice);
    }

    return {
      name,
      company: warehouseCompany || stockCompany,
      notice,
    };
  } catch (err) {
    if (err instanceof StockCheckError) throw err;
    throw new StockCheckError(
      `Warehouse ${warehouse} not found.`,
      404,
      "warehouse_not_found",
    );
  }
}

async function listCompanyWarehouses(
  cfg: ErpAdminConfig,
  company: string,
): Promise<string[]> {
  const { data } = await erpFetch<Array<{ name?: string; company?: string }>>(
    cfg,
    "resource/Warehouse",
    {
      method: "GET",
      search: {
        fields: JSON.stringify(["name", "company"]),
        filters: JSON.stringify([
          ["company", "=", company],
          ["is_group", "=", 0],
          ["disabled", "=", 0],
        ]),
        limit_page_length: "500",
        order_by: "name asc",
      },
    },
  );
  return (Array.isArray(data) ? data : [])
    .filter((w) => w.name && !isBidsphereCompany(w.company))
    .map((w) => String(w.name).trim())
    .filter(Boolean);
}

async function fetchBinsForItem(
  cfg: ErpAdminConfig,
  itemCode: string,
  warehouses: string[],
): Promise<StockCheckWarehouseQty[]> {
  if (warehouses.length === 0) return [];
  const { data } = await erpFetch<
    Array<{
      item_code?: string;
      warehouse?: string;
      actual_qty?: number;
      reserved_qty?: number;
    }>
  >(cfg, "resource/Bin", {
    method: "GET",
    search: {
      fields: JSON.stringify([
        "item_code",
        "warehouse",
        "actual_qty",
        "reserved_qty",
      ]),
      filters: JSON.stringify([
        ["item_code", "=", itemCode],
        ["warehouse", "in", warehouses],
      ]),
      limit_page_length: "500",
    },
  });

  const allowed = new Set(warehouses);
  const rows: StockCheckWarehouseQty[] = [];
  for (const row of Array.isArray(data) ? data : []) {
    const wh = String(row.warehouse || "").trim();
    if (!wh || !allowed.has(wh)) continue;
    rows.push({
      warehouse: wh,
      available_qty: nonNeg(row.actual_qty),
      reserved_qty: nonNeg(row.reserved_qty),
      source: "bin",
    });
  }
  return rows;
}

async function fetchStockBalanceQty(
  cfg: ErpAdminConfig,
  itemCode: string,
  warehouse: string,
): Promise<number | null> {
  const { data } = await erpFetch<unknown>(
    cfg,
    "method/erpnext.stock.utils.get_stock_balance",
    {
      method: "POST",
      body: { item_code: itemCode, warehouse },
    },
  );
  const n = typeof data === "number" ? data : Number(data);
  if (!Number.isFinite(n)) return null;
  return nonNeg(n);
}

async function fetchItemDefaultWarehouse(
  cfg: ErpAdminConfig,
  itemCode: string,
): Promise<string | undefined> {
  try {
    const { data } = await erpFetch<{
      item_defaults?: Array<{ company?: string; default_warehouse?: string }>;
      default_warehouse?: string;
    }>(cfg, `resource/Item/${encodeURIComponent(itemCode)}`, {
      method: "GET",
    });
    const defaults = Array.isArray(data?.item_defaults) ? data.item_defaults : [];
    const match =
      defaults.find((d) => d.default_warehouse)?.default_warehouse ||
      data?.default_warehouse;
    return String(match || "").trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Run a full Stock Decision availability check against ERPNext.
 */
export async function runStockCheck(
  input: StockCheckRequest,
): Promise<StockCheckSuccess> {
  const mrNumber = String(input.mr_number || "").trim();
  const company = String(input.company || "").trim();
  const mrCompany = String(input.mr_company || "").trim();
  const preferredWarehouse = String(input.warehouse || "").trim();
  const user = String(input.user || "Warehouse").trim() || "Warehouse";
  const items = (input.items || [])
    .map((i) => ({
      item_code: String(i.item_code || "").trim(),
      requested_qty: nonNeg(i.requested_qty),
      mr_warehouse: String(i.mr_warehouse || "").trim() || undefined,
    }))
    .filter((i) => i.item_code);

  console.log("=== STOCK CHECK REQUEST ===");
  console.log("MR Number:", mrNumber);
  console.log("Material Request Company:", mrCompany || "(not provided)");
  console.log("Stock Company:", company);
  console.log("User Default Company / ERP Session Company:", company);
  console.log("Selected Warehouse (preferred/Stores):", preferredWarehouse);
  console.log(
    "Item Codes:",
    items.map((i) => i.item_code),
  );
  console.log("User:", user);

  if (!mrNumber) {
    throw new StockCheckError("Material Request number is required.", 400);
  }
  if (!company) {
    throw new StockCheckError("Company is required for stock check.", 400);
  }
  if (!preferredWarehouse) {
    throw new StockCheckError("Warehouse is required for stock check.", 400);
  }
  if (items.length === 0) {
    throw new StockCheckError(
      "At least one item_code is required for stock check.",
      400,
    );
  }

  const cfg = readErpAdminConfig();

  try {
    const wh = await assertWarehouse(
      cfg,
      preferredWarehouse,
      company,
      mrCompany,
    );

    // Aggregate across all valid company warehouses (same scope as Inventory).
    let warehouses =
      Array.isArray(input.warehouses) && input.warehouses.length > 0
        ? input.warehouses.map((w) => String(w || "").trim()).filter(Boolean)
        : await listCompanyWarehouses(cfg, wh.company || company);

    if (!warehouses.includes(preferredWarehouse)) {
      warehouses = [preferredWarehouse, ...warehouses];
    }

    console.log("=== WAREHOUSE SCOPE ===");
    console.log("Preferred / Stores:", preferredWarehouse);
    console.log("All warehouses for stock:", warehouses);

    for (const item of items) {
      await assertItemExists(cfg, item.item_code);
    }

    const lines: StockCheckLineResult[] = [];
    for (const item of items) {
      const itemDefaultWarehouse = await fetchItemDefaultWarehouse(
        cfg,
        item.item_code,
      );

      console.log("=== ITEM WAREHOUSE DEBUG ===");
      console.log("Item:", item.item_code);
      console.log("Selected Warehouse:", preferredWarehouse);
      console.log("Warehouse from MR:", item.mr_warehouse || "(none)");
      console.log("Warehouse from Item:", itemDefaultWarehouse || "(none)");

      let byWarehouse = await fetchBinsForItem(
        cfg,
        item.item_code,
        warehouses,
      );

      // SLE fallback for preferred warehouse when Bin has no row there.
      if (!byWarehouse.some((r) => r.warehouse === preferredWarehouse)) {
        const sle = await fetchStockBalanceQty(
          cfg,
          item.item_code,
          preferredWarehouse,
        );
        if (sle != null && sle > 0) {
          byWarehouse = [
            ...byWarehouse,
            {
              warehouse: preferredWarehouse,
              available_qty: sle,
              reserved_qty: 0,
              source: "get_stock_balance",
            },
          ];
        }
      }

      // If still empty, probe best-known alternate warehouses via SLE.
      if (byWarehouse.length === 0) {
        const probes = [
          preferredWarehouse,
          item.mr_warehouse,
          itemDefaultWarehouse,
          ...warehouses.filter((w) => /finished goods/i.test(w)),
        ].filter((w, i, arr): w is string => Boolean(w) && arr.indexOf(w) === i);

        for (const probe of probes.slice(0, 5)) {
          const sle = await fetchStockBalanceQty(cfg, item.item_code, probe);
          console.log("ERP Available Qty (SLE probe):", {
            item: item.item_code,
            warehouse: probe,
            qty: sle,
          });
          if (sle != null && sle > 0) {
            byWarehouse.push({
              warehouse: probe,
              available_qty: sle,
              reserved_qty: 0,
              source: "get_stock_balance",
            });
          }
        }
      }

      byWarehouse = [...byWarehouse].sort(
        (a, b) => b.available_qty - a.available_qty,
      );

      const totalAvailable = byWarehouse.reduce(
        (s, r) => s + r.available_qty,
        0,
      );
      const totalReserved = byWarehouse.reduce(
        (s, r) => s + r.reserved_qty,
        0,
      );
      const localRow = byWarehouse.find(
        (r) => r.warehouse === preferredWarehouse,
      );
      const localAvailable = localRow?.available_qty ?? 0;
      const best = byWarehouse[0];
      const bestWarehouse = best?.warehouse || preferredWarehouse;
      const bestWarehouseQty = best?.available_qty ?? 0;
      const shortage = Math.max(0, item.requested_qty - totalAvailable);

      // Recommendations use TOTAL company stock (Inventory-aligned), not Stores-only.
      let recommendation: StockCheckRecommendation;
      if (localAvailable + 1e-9 >= item.requested_qty) {
        recommendation = "Issue Material";
      } else if (totalAvailable + 1e-9 >= item.requested_qty) {
        // e.g. 0 in Stores, 3 in Finished Goods - NSGAI
        recommendation = "Stock available in another warehouse";
      } else {
        recommendation = "Forward to Procurement";
      }

      // Exact place Available Qty is computed (aggregated, not Stores-only).
      console.log("=== STOCK RESULT ===");
      console.log("Item:", item.item_code);
      console.log("ERP Warehouse Name(s):", byWarehouse.map((r) => r.warehouse));
      console.log("ERP Available Qty (by warehouse):", byWarehouse);
      console.log("Available Qty (aggregated / Inventory-aligned):", totalAvailable);
      console.log("Local (Stores) Available Qty:", localAvailable);
      console.log("Reserved Qty:", totalReserved);
      console.log("Shortage Qty:", shortage);
      console.log("Best warehouse:", bestWarehouse, bestWarehouseQty);
      console.log("Recommendation:", recommendation);

      lines.push({
        item_code: item.item_code,
        requested_qty: item.requested_qty,
        available_qty: totalAvailable,
        local_available_qty: localAvailable,
        reserved_qty: totalReserved,
        shortage_qty: shortage,
        recommendation,
        warehouse: preferredWarehouse,
        best_warehouse: bestWarehouse,
        best_warehouse_qty: bestWarehouseQty,
        item_default_warehouse: itemDefaultWarehouse,
        mr_warehouse: item.mr_warehouse,
        by_warehouse: byWarehouse,
        source:
          byWarehouse.length > 1
            ? "bin+aggregated"
            : byWarehouse[0]?.source || "bin",
      });
    }

    return {
      success: true,
      mr_number: mrNumber,
      company: wh.company || company,
      warehouse: preferredWarehouse,
      mr_company: mrCompany || undefined,
      notice: wh.notice,
      lines,
    };
  } catch (err) {
    console.error("=== ERROR ===");
    if (err instanceof Error) {
      console.error(err.stack || err.message);
    } else {
      console.error(err);
    }
    throw err;
  }
}
