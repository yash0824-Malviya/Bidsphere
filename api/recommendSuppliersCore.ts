/**
 * AI supplier recommendation — backend filtering and ranking.
 *
 * Filters active suppliers by Procurement Category (hard filter by default).
 * Ranks by category, commodity, item group, performance, and preferred status.
 * Designed for future filter dimensions (certifications, ESG, etc.).
 */

import {
  CATEGORY_SUPPLIER_GROUP_KEYWORDS,
  isProcurementCategory,
  procurementCategoryBelongsToType,
  type ProcurementCategory,
} from "../src/config/procurementCategory.js";
import {
  collectSupplierCategorySignals,
  labelMatchesKeywords,
  scoreSupplierMatch,
  supplierMatchesProcurementCategory,
} from "../src/utils/procurementCategoryMatch.js";

export class RecommendSuppliersError extends Error {
  status: number;
  code: "validation" | "permission" | "erp" | "config";

  constructor(
    message: string,
    status = 400,
    code: RecommendSuppliersError["code"] = "validation",
  ) {
    super(message);
    this.name = "RecommendSuppliersError";
    this.status = status;
    this.code = code;
  }
}

export type ErpAdminConfig = { baseUrl: string; key: string; secret: string };

export type RecommendSuppliersRequest = {
  procurement_type?: string;
  procurement_category?: string;
  commodity?: string;
  item_groups?: string[];
  search?: string;
  show_all?: boolean;
  limit?: number;
};

export type RecommendedSupplierRow = {
  name: string;
  supplier_name: string;
  supplier_group?: string;
  country?: string;
  email_id?: string;
  score: number;
  ai_match_pct: number;
  reasons: string[];
  preferred: boolean;
  past_po_count: number;
  tier: "recommended" | "other";
};

export type RecommendSuppliersResult = {
  success: true;
  procurement_category: string;
  recommended: RecommendedSupplierRow[];
  other_matching: RecommendedSupplierRow[];
  total_matching: number;
  show_all_applied: boolean;
  meta: {
    procurement_type?: string;
    commodity?: string;
    item_groups: string[];
    matched_supplier_groups: string[];
    query_notes: string[];
  };
};

type SupplierRow = {
  name: string;
  supplier_name?: string;
  supplier_group?: string;
  custom_supplier_category?: string;
  custom_procurement_categories?: string;
  custom_sourcing_type?: string;
  country?: string;
  email_id?: string;
  disabled?: number;
};

function readErpConfig(): ErpAdminConfig {
  const baseUrl = (
    process.env.ERPNEXT_URL ??
    process.env.VITE_ERPNEXT_URL ??
    process.env.VITE_PROXY_TARGET ??
    ""
  ).replace(/\/$/, "");
  const key = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
  const secret = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";
  if (!baseUrl || !key || !secret) {
    throw new RecommendSuppliersError(
      "ERPNext credentials are not configured.",
      500,
      "config",
    );
  }
  return { baseUrl, key, secret };
}

async function erpFetch<T>(
  cfg: ErpAdminConfig,
  path: string,
): Promise<T> {
  const url = `${cfg.baseUrl}/api/${path.replace(/^\//, "")}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${cfg.key}:${cfg.secret}`,
      Accept: "application/json",
    },
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: T;
    message?: string;
    exception?: string;
  };
  if (!res.ok) {
    throw new RecommendSuppliersError(
      json.exception || json.message || `ERP request failed (${res.status})`,
      res.status >= 500 ? 502 : 400,
      "erp",
    );
  }
  return (json.data ?? json) as T;
}

function asRecordArray<T extends Record<string, unknown>>(
  value: unknown,
): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") {
    const nested = (value as { data?: unknown }).data;
    if (Array.isArray(nested)) return nested as T[];
  }
  return [];
}

async function listSupplierGroups(cfg: ErpAdminConfig): Promise<string[]> {
  try {
    const raw = await erpFetch<unknown>(
      cfg,
      `resource/Supplier%20Group?${new URLSearchParams({
        fields: JSON.stringify(["name", "is_group"]),
        limit_page_length: "200",
      }).toString()}`,
    );
    const rows = asRecordArray<{ name: string; is_group?: number }>(raw);
    const leaves = rows.filter((g) => g.is_group !== 1 && g.name);
    const source = leaves.length > 0 ? leaves : rows;
    return source.map((g) => g.name).filter(Boolean);
  } catch {
    return [];
  }
}

function matchedSupplierGroupsForCategory(
  category: ProcurementCategory,
  erpGroups: string[],
): string[] {
  const keywords = CATEGORY_SUPPLIER_GROUP_KEYWORDS[category] ?? [category];
  return erpGroups.filter((name) => labelMatchesKeywords(name, keywords));
}

async function listSuppliers(
  cfg: ErpAdminConfig,
  filters: Array<[string, string, string | number | string[]]>,
  limit: number,
): Promise<SupplierRow[]> {
  const richFields = [
    "name",
    "supplier_name",
    "supplier_group",
    "custom_supplier_category",
    "custom_procurement_categories",
    "custom_sourcing_type",
    "country",
    "email_id",
    "disabled",
  ];
  const qs = new URLSearchParams({
    fields: JSON.stringify(richFields),
    filters: JSON.stringify(filters),
    limit_page_length: String(limit),
    order_by: "supplier_name asc",
  });
  let raw: unknown;
  try {
    raw = await erpFetch<unknown>(cfg, `resource/Supplier?${qs.toString()}`);
  } catch {
    const safeQs = new URLSearchParams({
      fields: JSON.stringify([
        "name",
        "supplier_name",
        "supplier_group",
        "country",
        "email_id",
        "disabled",
      ]),
      filters: JSON.stringify(filters),
      limit_page_length: String(limit),
      order_by: "supplier_name asc",
    });
    raw = await erpFetch<unknown>(cfg, `resource/Supplier?${safeQs.toString()}`);
  }
  return asRecordArray<SupplierRow>(raw).filter((s) => s && s.disabled !== 1);
}

async function loadPoCounts(
  cfg: ErpAdminConfig,
  supplierNames: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (supplierNames.length === 0) return counts;
  try {
    const raw = await erpFetch<unknown>(
      cfg,
      `resource/Purchase%20Order?${new URLSearchParams({
        fields: JSON.stringify(["name", "supplier"]),
        filters: JSON.stringify([["supplier", "in", supplierNames]]),
        limit_page_length: "500",
      }).toString()}`,
    );
    for (const row of asRecordArray<{ supplier?: string }>(raw)) {
      if (!row.supplier) continue;
      counts.set(row.supplier, (counts.get(row.supplier) ?? 0) + 1);
    }
  } catch {
    /* optional boost */
  }
  return counts;
}

async function loadRfqCounts(
  cfg: ErpAdminConfig,
  supplierNames: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (supplierNames.length === 0) return counts;
  try {
    const raw = await erpFetch<unknown>(
      cfg,
      `resource/Request%20for%20Quotation%20Supplier?${new URLSearchParams({
        fields: JSON.stringify(["name", "supplier", "parent"]),
        filters: JSON.stringify([["supplier", "in", supplierNames]]),
        limit_page_length: "500",
        order_by: "modified desc",
      }).toString()}`,
    );
    for (const row of asRecordArray<{ supplier?: string }>(raw)) {
      if (!row.supplier) continue;
      counts.set(row.supplier, (counts.get(row.supplier) ?? 0) + 1);
    }
  } catch {
    /* optional boost */
  }
  return counts;
}

function isPreferredSupplier(row: SupplierRow): boolean {
  return String(row.custom_sourcing_type ?? "")
    .trim()
    .toLowerCase() === "direct";
}

function passesProcurementType(row: SupplierRow, procurementType: string): boolean {
  const want = procurementType.trim().toLowerCase();
  if (!want || (want !== "direct" && want !== "indirect")) return true;
  const sourcing = String(row.custom_sourcing_type ?? "").trim().toLowerCase();
  if (!sourcing) return true;
  return sourcing === want;
}

function passesSearch(row: SupplierRow, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return (
    row.name.toLowerCase().includes(q) ||
    String(row.supplier_name ?? "").toLowerCase().includes(q) ||
    String(row.email_id ?? "").toLowerCase().includes(q) ||
    String(row.supplier_group ?? "").toLowerCase().includes(q)
  );
}

export async function runRecommendSuppliers(
  input: RecommendSuppliersRequest,
): Promise<RecommendSuppliersResult> {
  const cfg = readErpConfig();
  const procurementTypeRaw = String(input.procurement_type ?? "").trim();
  const procurementType =
    procurementTypeRaw.toLowerCase() === "indirect" ? "Indirect" : procurementTypeRaw.toLowerCase() === "direct"
      ? "Direct"
      : "";
  const categoryRaw = String(input.procurement_category ?? "").trim();
  const category = isProcurementCategory(categoryRaw)
    ? categoryRaw
    : null;
  const commodity = String(input.commodity ?? "").trim();
  const itemGroups = (input.item_groups ?? [])
    .map((g) => String(g ?? "").trim())
    .filter(Boolean);
  const search = String(input.search ?? "").trim();
  const showAll = input.show_all === true;
  const limit = Math.min(200, Math.max(20, Number(input.limit) || 100));
  const queryNotes: string[] = [];

  if (procurementType && category && !procurementCategoryBelongsToType(category, procurementType)) {
    throw new RecommendSuppliersError(
      `Procurement Category "${category}" does not belong to ${procurementType} procurement.`,
      400,
    );
  }

  if (procurementType) {
    queryNotes.push(`Procurement Type: ${procurementType}.`);
  }

  const erpGroups = await listSupplierGroups(cfg);
  const matchedGroups = category
    ? matchedSupplierGroupsForCategory(category, erpGroups)
    : [];
  if (category) {
    queryNotes.push(
      `Category "${category}" mapped to ${matchedGroups.length} supplier group(s).`,
    );
  }

  let candidates: SupplierRow[] = [];

  if (showAll) {
    candidates = await listSuppliers(cfg, [["disabled", "=", 0]], limit);
    queryNotes.push(`Show all: loaded ${candidates.length} active supplier(s).`);
  } else if (category && matchedGroups.length > 0) {
    candidates = await listSuppliers(
      cfg,
      [
        ["disabled", "=", 0],
        ["supplier_group", "in", matchedGroups],
      ],
      limit,
    );
    queryNotes.push(
      `Group filter returned ${candidates.length} supplier(s).`,
    );
    if (candidates.length < limit) {
      const extra = await listSuppliers(cfg, [["disabled", "=", 0]], limit);
      const seen = new Set(candidates.map((s) => s.name));
      for (const row of extra) {
        if (seen.has(row.name)) continue;
        const signals = collectSupplierCategorySignals(row);
        if (supplierMatchesProcurementCategory(signals, category)) {
          candidates.push(row);
          seen.add(row.name);
        }
      }
      queryNotes.push(
        `Expanded with multi-category field scan → ${candidates.length} total.`,
      );
    }
  } else if (category) {
    const all = await listSuppliers(cfg, [["disabled", "=", 0]], limit);
    candidates = all.filter((row) => {
      const signals = collectSupplierCategorySignals(row);
      return supplierMatchesProcurementCategory(signals, category);
    });
    queryNotes.push(
      `In-memory category filter → ${candidates.length} supplier(s).`,
    );
  } else {
    candidates = await listSuppliers(cfg, [["disabled", "=", 0]], limit);
    queryNotes.push(
      "No procurement category — loaded active suppliers (legacy compat).",
    );
  }

  if (search) {
    candidates = candidates.filter((row) => passesSearch(row, search));
  }

  if (procurementType) {
    const before = candidates.length;
    candidates = candidates.filter((row) =>
      passesProcurementType(row, procurementType),
    );
    queryNotes.push(
      `Procurement Type filter → ${candidates.length} of ${before} supplier(s).`,
    );
  }

  const names = candidates.map((s) => s.name);
  const [poCounts, rfqCounts] = await Promise.all([
    loadPoCounts(cfg, names),
    loadRfqCounts(cfg, names),
  ]);

  const scored = candidates.map((row) => {
    const signals = collectSupplierCategorySignals(row);
    const preferred = isPreferredSupplier(row);
    const { score, reasons } = scoreSupplierMatch({
      category: category ?? ("Raw Material" as ProcurementCategory),
      commodity,
      item_groups: itemGroups,
      signals,
      preferred,
      past_po_count: poCounts.get(row.name) ?? 0,
      past_rfq_count: rfqCounts.get(row.name) ?? 0,
    });
    const finalReasons = [...reasons];
    if (procurementType && passesProcurementType(row, procurementType)) {
      finalReasons.unshift(`Procurement Type: ${procurementType}`);
    }
    const categoryMatched =
      !category || supplierMatchesProcurementCategory(signals, category);
    return {
      name: row.name,
      supplier_name: row.supplier_name || row.name,
      supplier_group: row.supplier_group,
      country: row.country,
      email_id: row.email_id,
      score: categoryMatched ? score : Math.max(0, score - 30),
      ai_match_pct: categoryMatched ? score : Math.max(0, score - 30),
      reasons: finalReasons,
      preferred,
      past_po_count: poCounts.get(row.name) ?? 0,
      categoryMatched,
    };
  });

  scored.sort((a, b) => b.score - a.score || a.supplier_name.localeCompare(b.supplier_name));

  const matching = category
    ? scored.filter((s) => s.categoryMatched)
    : scored;

  const recommendedCutoff = Math.max(75, matching[0]?.score ?? 75);
  const recommended = matching
    .filter((s, i) => i < 8 && s.score >= Math.min(recommendedCutoff, 85))
    .map(({ categoryMatched: _c, ...rest }) => ({
      ...rest,
      tier: "recommended" as const,
    }));

  const recommendedNames = new Set(recommended.map((s) => s.name));
  const other_matching = matching
    .filter((s) => !recommendedNames.has(s.name))
    .map(({ categoryMatched: _c, ...rest }) => ({
      ...rest,
      tier: "other" as const,
    }));

  return {
    success: true,
    procurement_category: categoryRaw,
    recommended,
    other_matching,
    total_matching: matching.length,
    show_all_applied: showAll,
    meta: {
      procurement_type: procurementType || undefined,
      commodity: commodity || undefined,
      item_groups: itemGroups,
      matched_supplier_groups: matchedGroups,
      query_notes: queryNotes,
    },
  };
}

export function canBypassSupplierCategoryFilter(role: string): boolean {
  const r = role.trim().toLowerCase();
  return r === "admin" || r === "procurement";
}
