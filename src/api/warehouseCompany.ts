/**
 * Warehouse module company mapping — Netlink only.
 *
 * Stock Entry / Material Issue MUST never use Company Bidsphere warehouses
 * (e.g. "Finished Goods - B"). Warehouses are resolved dynamically from
 * ERPNext for the Netlink company — never hardcoded names.
 */

import { apiGet, buildListConfig, buildResourceUrl, COMPANY } from "./erpnext";
import {
  assertWarehouseBelongsToCompany,
  getWarehouseCompany,
  warehouseCompanyMismatchMessage,
} from "../utils/warehouseValidation";
import {
  fetchInventoryBins,
  getItemStockAcrossWarehouses,
} from "./warehouseInventoryService";
import { nonNegativeQty } from "../utils/inventoryStock";

/** Canonical Warehouse-module company (branding / VITE_COMPANY → Netlink). */
export const WAREHOUSE_MODULE_COMPANY = COMPANY;

/** Companies whose warehouses must never be used in Warehouse workflows. */
const BLOCKED_WAREHOUSE_COMPANIES = new Set(
  ["bidsphere"].map((s) => s.toLowerCase()),
);

function isBlockedCompany(company: string | null | undefined): boolean {
  return BLOCKED_WAREHOUSE_COMPANIES.has((company || "").trim().toLowerCase());
}

function looksLike(name: string, needle: string): boolean {
  return name.toLowerCase().includes(needle.toLowerCase());
}

export type WarehouseStockCompanyContext = {
  /** ERP Material Request.company (may be Bidsphere). */
  mrCompany: string;
  /** Company used for Bin / Warehouse / Stock Entry (never Bidsphere). */
  stockCompany: string;
  /** True when MR.company differs from stockCompany. */
  companyDiffer: boolean;
  /** Soft business notice — not a hard failure. */
  notice?: string;
};

/**
 * Resolve which company to use for Warehouse stock / issue.
 *
 * Regression fix: many Material Requests still have ERP company "Bidsphere"
 * (site default). Warehouse Review previously worked by reading stock from
 * Netlink warehouses anyway. Hard-blocking those MRs broke Review.
 *
 * Rules:
 * - Never use Bidsphere *warehouses* for stock/issue.
 * - If MR.company is Bidsphere (or empty), use WAREHOUSE_MODULE_COMPANY (Netlink).
 * - If MR.company is another non-blocked ERP company, use that for stock filters.
 */
export function resolveWarehouseStockCompany(
  mrCompany: string | null | undefined,
): WarehouseStockCompanyContext {
  const rawMr = String(mrCompany || "").trim();
  const mr = rawMr || WAREHOUSE_MODULE_COMPANY;

  if (isBlockedCompany(mr)) {
    const notice =
      `Material Request company is "${mr}", but Warehouse stock is read from ` +
      `Company ${WAREHOUSE_MODULE_COMPANY} warehouses (Bidsphere warehouses are never used).`;
    // eslint-disable-next-line no-console
    console.warn("[WarehouseCompany] " + notice, {
      mrCompany: mr,
      stockCompany: WAREHOUSE_MODULE_COMPANY,
    });
    return {
      mrCompany: mr,
      stockCompany: WAREHOUSE_MODULE_COMPANY,
      companyDiffer: true,
      notice,
    };
  }

  if (mr !== WAREHOUSE_MODULE_COMPANY) {
    // eslint-disable-next-line no-console
    console.warn(
      "[WarehouseCompany] MR company differs from VITE_COMPANY — using MR company for stock",
      { mrCompany: mr, configured: WAREHOUSE_MODULE_COMPANY },
    );
  }

  return {
    mrCompany: mr,
    stockCompany: mr,
    companyDiffer: mr !== WAREHOUSE_MODULE_COMPANY,
    notice:
      mr !== WAREHOUSE_MODULE_COMPANY
        ? `Using Material Request company "${mr}" for stock (app default is ${WAREHOUSE_MODULE_COMPANY}).`
        : undefined,
  };
}

/**
 * Company used for Warehouse Issue / Stock Entry remaps.
 * Same remap rules as {@link resolveWarehouseStockCompany} — does not throw
 * when MR.company is Bidsphere (maps to Netlink).
 */
export function assertMaterialRequestIsWarehouseCompany(
  mrCompany: string | null | undefined,
): string {
  return resolveWarehouseStockCompany(mrCompany).stockCompany;
}

/** Structured company diagnostics for Stock Decision logging. */
export async function logWarehouseCompanyDiagnostics(input: {
  mrNumber?: string;
  mrCompany?: string | null;
  warehouse?: string | null;
  user?: string | null;
}): Promise<WarehouseStockCompanyContext> {
  const ctx = resolveWarehouseStockCompany(input.mrCompany);
  let warehouseCompany: string | null = null;
  if (input.warehouse) {
    try {
      warehouseCompany = await getWarehouseCompany(input.warehouse);
    } catch {
      warehouseCompany = null;
    }
  }
  // eslint-disable-next-line no-console
  console.log("[WarehouseCompany] diagnostics", {
    mrNumber: input.mrNumber || null,
    materialRequestCompany: ctx.mrCompany,
    warehouseCompany,
    userDefaultCompany: WAREHOUSE_MODULE_COMPANY,
    erpSessionCompany: WAREHOUSE_MODULE_COMPANY,
    stockCompany: ctx.stockCompany,
    user: input.user || null,
    notice: ctx.notice || null,
  });
  return ctx;
}

let warehouseCache: { company: string; names: string[]; at: number } | null =
  null;
const WAREHOUSE_CACHE_MS = 60_000;

async function fetchLeafWarehousesForCompany(
  company: string,
): Promise<string[]> {
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
      timeout: 15_000,
    },
  );
  return (Array.isArray(list) ? list : [])
    .map((w) => w.name)
    .filter((n): n is string => Boolean(n));
}

/**
 * Discover company from Stores warehouses when exact company filter is empty.
 * Prefers "Stores - NSGAI". Never returns Bidsphere companies.
 */
async function discoverCompanyFromStoresWarehouse(): Promise<string | null> {
  const storesLike = await apiGet<Array<{ name?: string; company?: string }>>(
    buildResourceUrl("Warehouse"),
    {
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
      timeout: 15_000,
    },
  );
  const usable = (Array.isArray(storesLike) ? storesLike : []).filter(
    (w) => w.name && w.company && !isBlockedCompany(w.company),
  );
  const preferred =
    usable.find((w) => looksLike(String(w.name), "NSGAI")) ||
    usable.find((w) => looksLike(String(w.name), "stores")) ||
    usable[0];
  // eslint-disable-next-line no-console
  console.log("[WarehouseCompany] Stores discovery", {
    preferred: preferred?.name,
    discoveredCompany: preferred?.company,
    candidates: usable.slice(0, 8).map((w) => ({
      name: w.name,
      company: w.company,
    })),
  });
  return (preferred?.company || "").trim() || null;
}

/**
 * Leaf warehouses for stock / issue. Never returns Bidsphere.
 *
 * @param forCompany Optional MR/ERP company. Defaults to VITE_COMPANY.
 * Recovery: if empty, discover company via Stores* (e.g. Stores - NSGAI).
 */
export async function resolveNetlinkWarehouses(
  forCompany?: string,
): Promise<string[]> {
  const requested =
    (forCompany || "").trim() || WAREHOUSE_MODULE_COMPANY;
  if (isBlockedCompany(requested)) {
    throw new Error(
      `Warehouses for Company ${requested} cannot be used in Warehouse workflows.`,
    );
  }

  if (
    warehouseCache &&
    warehouseCache.company === requested &&
    Date.now() - warehouseCache.at < WAREHOUSE_CACHE_MS
  ) {
    return warehouseCache.names;
  }

  try {
    let company = requested;
    let names = await fetchLeafWarehousesForCompany(company);

    // eslint-disable-next-line no-console
    console.log("[WarehouseCompany] resolveNetlinkWarehouses", {
      company,
      count: names.length,
      sample: names.slice(0, 12),
    });

    if (names.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        "[WarehouseCompany] No warehouses for exact company — discovering via Stores*",
        { company },
      );
      const discovered = await discoverCompanyFromStoresWarehouse();
      if (discovered && discovered !== company) {
        company = discovered;
        names = await fetchLeafWarehousesForCompany(company);
        // eslint-disable-next-line no-console
        console.log("[WarehouseCompany] recovered warehouses", {
          discoveredCompany: company,
          requestedCompany: requested,
          count: names.length,
          sample: names.slice(0, 12),
        });
      }
    }

    if (names.length === 0) {
      throw new Error(
        `No warehouses found for Company ${requested}. ` +
          `Configure a Stores warehouse (e.g. Stores - NSGAI) under the Warehouse company.`,
      );
    }
    warehouseCache = { company: requested, names, at: Date.now() };
    return names;
  } catch (err) {
    if (err instanceof Error && err.message.includes("No warehouses found")) {
      throw err;
    }
    console.error("[WarehouseCompany] resolveNetlinkWarehouses failed", err);
    throw new Error(
      `Unable to load warehouses for stock check. Please try again.`,
    );
  }
}

/** Clear warehouse name cache (after ERP warehouse changes). */
export function clearNetlinkWarehouseCache(): void {
  warehouseCache = null;
}

/**
 * Prefer Stores among company warehouses (target / local default).
 * Prefers "Stores - NSGAI" when present — still dynamic from ERP list.
 */
export async function resolveNetlinkStoresWarehouse(
  forCompany?: string,
): Promise<string> {
  const names = await resolveNetlinkWarehouses(forCompany);
  const nsgai = names.find((w) => looksLike(w, "NSGAI") && looksLike(w, "stores"));
  if (nsgai) return nsgai;
  const stores = names.find((w) => looksLike(w, "stores"));
  return stores ?? names[0] ?? "";
}

export type PurchaseWarehouseResolution = {
  warehouse: string;
  warehouseCompany: string;
  /** Why this warehouse was chosen (for server/browser logs). */
  reason: string;
  /** Candidate rejected due to company mismatch (if any). */
  rejectedCandidate?: string;
  rejectedCandidateCompany?: string | null;
};

/**
 * Resolve Purchase MR line warehouse for a Material Request company.
 *
 * Order (never hardcodes names):
 *  1. Candidate from MR item — only if Warehouse.company matches
 *  2. Company.default_warehouse from ERP Company master
 *  3. ERP Warehouse master — Stores* preferred, else first leaf for company
 *
 * Never returns a Bidsphere / cross-company warehouse (e.g. "Stores - B").
 */
export async function resolvePurchaseWarehouseForCompany(input: {
  mrCompany: string | null | undefined;
  candidateWarehouse?: string | null;
  itemCode?: string;
}): Promise<PurchaseWarehouseResolution> {
  const stockCtx = resolveWarehouseStockCompany(input.mrCompany);
  const company = stockCtx.stockCompany;
  const candidate = String(input.candidateWarehouse || "").trim();

  // eslint-disable-next-line no-console
  console.log("[PurchaseWarehouse] resolve start", {
    materialRequestCompany: stockCtx.mrCompany,
    stockCompany: company,
    candidateWarehouse: candidate || null,
    itemCode: input.itemCode || null,
  });

  let rejectedCandidate: string | undefined;
  let rejectedCandidateCompany: string | null | undefined;

  if (candidate) {
    const candidateCompany = await getWarehouseCompany(candidate);
    // eslint-disable-next-line no-console
    console.log("[PurchaseWarehouse] candidate check", {
      selectedWarehouse: candidate,
      warehouseCompany: candidateCompany,
      expectedCompany: company,
    });
    if (candidateCompany === company && !isBlockedCompany(candidateCompany)) {
      const result: PurchaseWarehouseResolution = {
        warehouse: candidate,
        warehouseCompany: candidateCompany,
        reason: "Material Request item warehouse (company match)",
      };
      // eslint-disable-next-line no-console
      console.log("[PurchaseWarehouse] chosen", result);
      return result;
    }
    rejectedCandidate = candidate;
    rejectedCandidateCompany = candidateCompany;
    // eslint-disable-next-line no-console
    console.warn(
      "[PurchaseWarehouse] rejected candidate — company mismatch",
      {
        selectedWarehouse: candidate,
        warehouseCompany: candidateCompany,
        expectedCompany: company,
      },
    );
  }

  // Company master default_warehouse (ERP) — dynamic, not hardcoded.
  try {
    const companyDoc = await apiGet<{
      default_warehouse?: string;
      name?: string;
    }>(`/api/resource/Company/${encodeURIComponent(company)}`);
    const companyDefault = String(companyDoc?.default_warehouse || "").trim();
    if (companyDefault) {
      const whCompany = await getWarehouseCompany(companyDefault);
      // eslint-disable-next-line no-console
      console.log("[PurchaseWarehouse] Company.default_warehouse", {
        purchaseWarehouse: companyDefault,
        warehouseCompany: whCompany,
        expectedCompany: company,
      });
      if (whCompany === company && !isBlockedCompany(whCompany)) {
        const result: PurchaseWarehouseResolution = {
          warehouse: companyDefault,
          warehouseCompany: whCompany,
          reason: "Company default_warehouse from ERP Company master",
          rejectedCandidate,
          rejectedCandidateCompany,
        };
        // eslint-disable-next-line no-console
        console.log("[PurchaseWarehouse] chosen", result);
        return result;
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      "[PurchaseWarehouse] Company.default_warehouse lookup failed",
      err,
    );
  }

  // ERP Warehouse master — Stores preferred among company leaves.
  const fromMaster = await resolveNetlinkStoresWarehouse(company);
  if (!fromMaster) {
    throw new Error(
      `No purchase warehouse found for Company ${company}. ` +
        `Configure a non-group warehouse under Company ${company}.`,
    );
  }
  await assertWarehouseBelongsToCompany(fromMaster, company, "Warehouse");
  const masterCompany = (await getWarehouseCompany(fromMaster)) || company;
  const result: PurchaseWarehouseResolution = {
    warehouse: fromMaster,
    warehouseCompany: masterCompany,
    reason:
      "ERP Warehouse master (Stores preferred for company, else first leaf)",
    rejectedCandidate,
    rejectedCandidateCompany,
  };
  // eslint-disable-next-line no-console
  console.log("[PurchaseWarehouse] chosen", {
    materialRequestCompany: stockCtx.mrCompany,
    selectedWarehouse: result.warehouse,
    warehouseCompany: result.warehouseCompany,
    purchaseWarehouse: result.warehouse,
    why: result.reason,
    rejectedCandidate,
    rejectedCandidateCompany,
  });
  return result;
}

/**
 * Prefer Finished Goods among Netlink warehouses when present.
 * Dynamic — no hardcoded "Finished Goods - NSGAI".
 */
export async function resolveNetlinkFinishedGoodsWarehouse(): Promise<string> {
  const names = await resolveNetlinkWarehouses();
  const fg = names.find((w) => looksLike(w, "finished goods"));
  return fg ?? (await resolveNetlinkStoresWarehouse());
}

/**
 * Reject Bidsphere (or any non-Netlink) warehouse with a clear UI error.
 */
export async function assertNetlinkWarehouse(
  warehouseName: string,
  role: "Source" | "Target" | "Warehouse" = "Warehouse",
): Promise<void> {
  await assertWarehouseBelongsToCompany(
    warehouseName,
    WAREHOUSE_MODULE_COMPANY,
    role,
  );
  const actual = await getWarehouseCompany(warehouseName);
  if (isBlockedCompany(actual)) {
    throw new Error(
      warehouseCompanyMismatchMessage(
        warehouseName,
        actual,
        WAREHOUSE_MODULE_COMPANY,
      ),
    );
  }
}

/**
 * Pick the best Netlink source warehouse for an item (Stock Entry s_warehouse).
 * Preference among Netlink bins with stock:
 *   1) Finished Goods…
 *   2) Stores…
 *   3) Highest available qty
 * Never returns a Bidsphere warehouse.
 */
export async function resolveNetlinkIssueSourceWarehouse(
  itemCode: string,
  requiredQty = 0,
): Promise<string> {
  const company = WAREHOUSE_MODULE_COMPANY;
  const across = await getItemStockAcrossWarehouses(itemCode, {
    company,
    forIssue: true,
  });

  const rows = [...across.by_warehouse].sort(
    (a, b) => b.available_qty - a.available_qty,
  );
  const need = nonNegativeQty(requiredQty);

  const withStock = rows.filter((r) => r.available_qty > 0);
  const enough = need > 0
    ? withStock.filter((r) => r.available_qty + 1e-9 >= need)
    : withStock;

  const pickFrom = (list: typeof rows) => {
    const fg = list.find((r) => looksLike(r.warehouse, "finished goods"));
    if (fg) return fg.warehouse;
    const stores = list.find((r) => looksLike(r.warehouse, "stores"));
    if (stores) return stores.warehouse;
    return list[0]?.warehouse || "";
  };

  let chosen = pickFrom(enough.length ? enough : withStock);
  if (!chosen) {
    // No bin qty — still bind to a Netlink warehouse (never Bidsphere default).
    chosen =
      (await resolveNetlinkFinishedGoodsWarehouse()) ||
      (await resolveNetlinkStoresWarehouse());
  }

  if (!chosen) {
    throw new Error(
      `No Netlink warehouse available for item ${itemCode}. ` +
        `Configure warehouses under Company ${company}.`,
    );
  }

  await assertNetlinkWarehouse(chosen, "Source");

  // eslint-disable-next-line no-console
  console.log("[WarehouseCompany] resolveNetlinkIssueSourceWarehouse", {
    itemCode,
    requiredQty: need,
    chosen,
    company,
    candidates: rows.slice(0, 6).map((r) => ({
      warehouse: r.warehouse,
      available_qty: r.available_qty,
    })),
  });

  return chosen;
}

/**
 * Rewrite a Stock Entry draft so every s_warehouse / from_warehouse uses the
 * user-selected (or auto-selected) company warehouse.
 *
 * ERPNext make_stock_entry may default Item warehouses to Company Bidsphere
 * (e.g. "Finished Goods - B") — those are always overwritten.
 *
 * @param forcedWarehouse Required UI-selected From Warehouse for the MR company.
 */
export async function remapStockEntryDraftToNetlink(
  draft: Record<string, unknown> & {
    items?: Array<Record<string, unknown>>;
    from_warehouse?: string;
    to_warehouse?: string;
    company?: string;
  },
  qtyByItem?: Map<string, number>,
  forcedWarehouse?: string,
): Promise<string> {
  const company = assertMaterialRequestIsWarehouseCompany(
    String(draft.company || WAREHOUSE_MODULE_COMPANY),
  );
  draft.company = company;

  let sourceWarehouse = (forcedWarehouse || "").trim();
  if (!sourceWarehouse) {
    // Fallback only when caller did not pass a selection (should not happen from UI).
    sourceWarehouse = await resolveNetlinkStoresWarehouse();
  }
  if (!sourceWarehouse) {
    throw new Error(
      `From Warehouse is required. Select a warehouse for Company ${company}.`,
    );
  }

  await assertNetlinkWarehouse(sourceWarehouse, "Source");
  const sourceCompany = await getWarehouseCompany(sourceWarehouse);
  if (sourceCompany !== company) {
    throw new Error(
      warehouseCompanyMismatchMessage(sourceWarehouse, sourceCompany, company),
    );
  }

  if (Array.isArray(draft.items)) {
    for (const item of draft.items) {
      item.s_warehouse = sourceWarehouse;
      // Material Issue has no target; drop foreign t_warehouse from make_stock_entry.
      if (item.t_warehouse) {
        delete item.t_warehouse;
      }
      if (qtyByItem && item.item_code) {
        const q = qtyByItem.get(String(item.item_code));
        if (q != null) {
          item.qty = q;
          item.transfer_qty = q;
        }
      }
      await assertNetlinkWarehouse(String(item.s_warehouse), "Source");
    }
  }

  draft.from_warehouse = sourceWarehouse;
  if (draft.to_warehouse) {
    delete draft.to_warehouse;
  }

  // eslint-disable-next-line no-console
  console.log("[WarehouseCompany] remapStockEntryDraftToNetlink", {
    company,
    from_warehouse: draft.from_warehouse,
    forcedWarehouse: sourceWarehouse,
    items: (draft.items || []).map((i) => ({
      item_code: i.item_code,
      s_warehouse: i.s_warehouse,
      qty: i.qty,
    })),
  });

  return sourceWarehouse;
}

/**
 * Resolve warehouses for Material Issue UI for a Material Request company.
 * Auto-select when exactly one warehouse exists.
 */
export async function resolveMaterialIssueWarehouses(mrCompany?: string): Promise<{
  company: string;
  warehouses: string[];
  autoSelected: string;
}> {
  const company = assertMaterialRequestIsWarehouseCompany(
    mrCompany || WAREHOUSE_MODULE_COMPANY,
  );
  const warehouses = await resolveNetlinkWarehouses();
  const autoSelected =
    warehouses.length === 1
      ? warehouses[0]!
      : (await resolveNetlinkStoresWarehouse()) || warehouses[0] || "";
  return { company, warehouses, autoSelected };
}

/** Filter a warehouse name list to Netlink only (drop Bidsphere). */
export async function filterToNetlinkWarehouses(
  warehouseNames: string[],
): Promise<string[]> {
  const allowed = new Set(await resolveNetlinkWarehouses());
  return warehouseNames.filter((w) => allowed.has(w));
}

/** Debug helper — bins for an item limited to Netlink warehouses. */
export async function fetchNetlinkBinsForItem(itemCode: string) {
  const warehouses = await resolveNetlinkWarehouses();
  return fetchInventoryBins({ itemCode, warehouses });
}
