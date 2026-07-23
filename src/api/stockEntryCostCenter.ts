/**
 * Resolve Cost Center for Material Issue Stock Entries.
 *
 * Never hardcodes "Main - B" (or any name). Always validates
 * Cost Center.company == Stock Entry.company before save.
 */

import { apiGet, buildListConfig, buildResourceUrl } from "./erpnext";
import { assertMaterialRequestIsWarehouseCompany } from "./warehouseCompany";

export const SELECTED_COST_CENTER_OTHER_COMPANY_MESSAGE =
  "Selected Cost Center belongs to another company.";

export type CostCenterResolution = {
  costCenter: string;
  costCenterCompany: string;
  reason: string;
  rejectedCandidate?: string;
  rejectedCandidateCompany?: string | null;
};

/** Fetch Cost Center.company for a Cost Center name. */
export async function getCostCenterCompany(
  costCenter: string,
): Promise<string | null> {
  const name = String(costCenter || "").trim();
  if (!name) return null;
  try {
    const doc = await apiGet<{ company?: string; name?: string }>(
      buildResourceUrl("Cost Center", name),
    );
    return String(doc?.company || "").trim() || null;
  } catch {
    return null;
  }
}

/**
 * Validate Cost Center belongs to Stock Entry company.
 * Throws the required user message on mismatch.
 */
export async function assertCostCenterBelongsToCompany(
  costCenter: string,
  company: string,
): Promise<void> {
  const cc = String(costCenter || "").trim();
  const expected = String(company || "").trim();
  if (!cc) {
    throw new Error(
      `Cost Center could not be resolved for Company ${expected}. ` +
        `Configure a default Cost Center under Company ${expected}.`,
    );
  }
  if (!expected) {
    throw new Error(
      "Stock Entry has no company. Cannot validate Cost Center.",
    );
  }
  const actual = await getCostCenterCompany(cc);
  if (!actual) {
    throw new Error(`Cost Center "${cc}" was not found in ERPNext.`);
  }
  if (actual !== expected) {
    // eslint-disable-next-line no-console
    console.warn("[StockEntryCostCenter] company mismatch", {
      costCenter: cc,
      costCenterCompany: actual,
      stockEntryCompany: expected,
    });
    throw new Error(SELECTED_COST_CENTER_OTHER_COMPANY_MESSAGE);
  }
}

async function getCompanyDefaultCostCenter(
  company: string,
): Promise<string | undefined> {
  try {
    const doc = await apiGet<{ cost_center?: string }>(
      buildResourceUrl("Company", company),
    );
    return String(doc?.cost_center || "").trim() || undefined;
  } catch {
    return undefined;
  }
}

async function getWarehouseDefaultCostCenter(
  warehouse: string | null | undefined,
): Promise<string | undefined> {
  const name = String(warehouse || "").trim();
  if (!name) return undefined;
  try {
    const doc = await apiGet<{ cost_center?: string }>(
      buildResourceUrl("Warehouse", name),
    );
    return String(doc?.cost_center || "").trim() || undefined;
  } catch {
    return undefined;
  }
}

async function getItemDefaultCostCenter(
  itemCode: string | null | undefined,
  company: string,
): Promise<string | undefined> {
  const code = String(itemCode || "").trim();
  if (!code) return undefined;
  try {
    const doc = await apiGet<{
      cost_center?: string;
      item_defaults?: Array<{
        company?: string;
        default_cost_center?: string;
        cost_center?: string;
        buying_cost_center?: string;
      }>;
    }>(buildResourceUrl("Item", code));

    const defaults = Array.isArray(doc?.item_defaults) ? doc.item_defaults : [];
    const forCompany = defaults.find(
      (d) => String(d.company || "").trim() === company,
    );
    const fromDefaults =
      forCompany?.default_cost_center ||
      forCompany?.cost_center ||
      forCompany?.buying_cost_center;
    if (fromDefaults) return String(fromDefaults).trim();

    // Any item_defaults row for this company field set, else Item.cost_center.
    return String(doc?.cost_center || "").trim() || undefined;
  } catch {
    return undefined;
  }
}

/** First non-group Cost Center for company (last-resort ERP master lookup). */
async function getFirstCompanyCostCenter(
  company: string,
): Promise<string | undefined> {
  try {
    const rows = await apiGet<Array<{ name?: string }>>(
      buildResourceUrl("Cost Center"),
      buildListConfig({
        fields: ["name"],
        filters: [
          ["company", "=", company],
          ["is_group", "=", 0],
          ["disabled", "=", 0],
        ],
        limit_page_length: 1,
        order_by: "name asc",
      }),
    );
    const name = String(rows?.[0]?.name || "").trim();
    return name || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve Cost Center for a Stock Entry line / company.
 *
 * Priority:
 *  1. Candidate (MR item cost_center) — only if Cost Center.company matches
 *  2. Company Default Cost Center
 *  3. Warehouse Default Cost Center
 *  4. Item Default Cost Center
 *  5. First leaf Cost Center for company (ERP master — never hardcoded)
 */
export async function resolveStockEntryCostCenter(input: {
  company: string;
  candidateCostCenter?: string | null;
  warehouse?: string | null;
  itemCode?: string | null;
}): Promise<CostCenterResolution> {
  const company = assertMaterialRequestIsWarehouseCompany(input.company);
  const candidate = String(input.candidateCostCenter || "").trim();

  let rejectedCandidate: string | undefined;
  let rejectedCandidateCompany: string | null | undefined;

  const tryCandidate = async (
    name: string | undefined,
    reason: string,
  ): Promise<CostCenterResolution | null> => {
    const cc = String(name || "").trim();
    if (!cc) return null;
    const ccCompany = await getCostCenterCompany(cc);
    if (ccCompany === company) {
      return {
        costCenter: cc,
        costCenterCompany: ccCompany,
        reason,
        rejectedCandidate,
        rejectedCandidateCompany,
      };
    }
    if (!rejectedCandidate) {
      rejectedCandidate = cc;
      rejectedCandidateCompany = ccCompany;
    }
    // eslint-disable-next-line no-console
    console.warn("[StockEntryCostCenter] rejected candidate", {
      costCenter: cc,
      costCenterCompany: ccCompany,
      expectedCompany: company,
      reason,
    });
    return null;
  };

  if (candidate) {
    const hit = await tryCandidate(
      candidate,
      "Material Request item cost_center (company match)",
    );
    if (hit) return hit;
  }

  const companyDefault = await getCompanyDefaultCostCenter(company);
  {
    const hit = await tryCandidate(
      companyDefault,
      "Company default Cost Center",
    );
    if (hit) return hit;
  }

  const warehouseDefault = await getWarehouseDefaultCostCenter(input.warehouse);
  {
    const hit = await tryCandidate(
      warehouseDefault,
      "Warehouse default Cost Center",
    );
    if (hit) return hit;
  }

  const itemDefault = await getItemDefaultCostCenter(input.itemCode, company);
  {
    const hit = await tryCandidate(itemDefault, "Item default Cost Center");
    if (hit) return hit;
  }

  const fallback = await getFirstCompanyCostCenter(company);
  {
    const hit = await tryCandidate(
      fallback,
      "ERP Cost Center master (first leaf for company)",
    );
    if (hit) return hit;
  }

  throw new Error(
    `No Cost Center found for Company ${company}. ` +
      `Configure a default Cost Center under Company ${company}.`,
  );
}

/**
 * Set cost_center on every Stock Entry Detail (and header when present).
 * Validates Cost Center.company == Stock Entry.company before returning.
 *
 * @returns The primary cost center applied (first line / header).
 */
export async function applyCostCentersToStockEntryDoc(
  doc: {
    company?: string;
    cost_center?: string;
    from_warehouse?: string;
    items?: Array<Record<string, unknown>>;
  },
  options?: {
    /** item_code → cost_center from Material Request Item rows */
    mrItemCostCenters?: Map<string, string> | Record<string, string>;
  },
): Promise<string> {
  const company = assertMaterialRequestIsWarehouseCompany(doc.company);
  doc.company = company;

  const mrMap =
    options?.mrItemCostCenters instanceof Map
      ? options.mrItemCostCenters
      : new Map(
          Object.entries(options?.mrItemCostCenters || {}).map(([k, v]) => [
            k,
            String(v),
          ]),
        );

  const items = Array.isArray(doc.items) ? doc.items : [];
  let primary = "";

  // Resolve company default once — reuse when lines share the same warehouse.
  const cache = new Map<string, CostCenterResolution>();

  for (const item of items) {
    const itemCode = String(item.item_code || "").trim();
    const warehouse = String(
      item.s_warehouse || item.t_warehouse || doc.from_warehouse || "",
    ).trim();
    const candidate =
      mrMap.get(itemCode) ||
      String(item.cost_center || doc.cost_center || "").trim() ||
      undefined;

    const cacheKey = `${candidate || ""}|${warehouse}|${itemCode}`;
    let resolved = cache.get(cacheKey);
    if (!resolved) {
      resolved = await resolveStockEntryCostCenter({
        company,
        candidateCostCenter: candidate,
        warehouse,
        itemCode,
      });
      cache.set(cacheKey, resolved);
    }

    await assertCostCenterBelongsToCompany(resolved.costCenter, company);
    item.cost_center = resolved.costCenter;
    if (!primary) primary = resolved.costCenter;

    // eslint-disable-next-line no-console
    console.log("[Stock Entry] Cost Center mapping", {
      company,
      costCenter: resolved.costCenter,
      warehouse: warehouse || null,
      item_code: itemCode || null,
      why: resolved.reason,
      rejectedCandidate: resolved.rejectedCandidate || null,
    });
  }

  if (!primary) {
    const headerResolved = await resolveStockEntryCostCenter({
      company,
      candidateCostCenter: String(doc.cost_center || "").trim() || undefined,
      warehouse: String(doc.from_warehouse || "").trim() || undefined,
    });
    await assertCostCenterBelongsToCompany(headerResolved.costCenter, company);
    primary = headerResolved.costCenter;
  }

  doc.cost_center = primary;

  // eslint-disable-next-line no-console
  console.log("[Stock Entry] before save", {
    company,
    costCenter: primary,
    warehouse:
      String(doc.from_warehouse || items[0]?.s_warehouse || "").trim() || null,
  });

  return primary;
}

/**
 * Load Material Request Item cost_center values keyed by item_code.
 */
export async function fetchMrItemCostCenters(
  mrName: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const name = String(mrName || "").trim();
  if (!name) return map;
  try {
    const doc = await apiGet<{
      items?: Array<{ item_code?: string; cost_center?: string }>;
    }>(buildResourceUrl("Material Request", name));
    for (const row of Array.isArray(doc?.items) ? doc.items : []) {
      const code = String(row.item_code || "").trim();
      const cc = String(row.cost_center || "").trim();
      if (code && cc) map.set(code, cc);
    }
  } catch {
    /* best-effort */
  }
  return map;
}
