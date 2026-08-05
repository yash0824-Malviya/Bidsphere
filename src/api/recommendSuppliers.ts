/**
 * Client for `/api/recommend-suppliers` — backend-filtered AI supplier ranking.
 */

export type RecommendedSupplier = {
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

export type RecommendSuppliersResponse = {
  success: true;
  procurement_category: string;
  recommended: RecommendedSupplier[];
  other_matching: RecommendedSupplier[];
  total_matching: number;
  show_all_applied: boolean;
  meta: {
    commodity?: string;
    item_groups: string[];
    matched_supplier_groups: string[];
    query_notes: string[];
  };
};

export class RecommendSuppliersApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.name = "RecommendSuppliersApiError";
    this.status = status;
    this.code = code;
  }
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  try {
    const token =
      sessionStorage.getItem("bidsphere-access-token") ||
      localStorage.getItem("bidsphere-access-token-remember");
    if (token) headers["X-Bidsphere-Access-Token"] = token;
  } catch {
    /* ignore */
  }
  return headers;
}

export async function fetchRecommendedSuppliers(input: {
  procurement_type?: string;
  procurement_category?: string;
  commodity?: string;
  item_groups?: string[];
  search?: string;
  show_all?: boolean;
  limit?: number;
}): Promise<RecommendSuppliersResponse> {
  const res = await fetch("/api/recommend-suppliers", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });

  let json: Record<string, unknown>;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new RecommendSuppliersApiError(
      `Supplier recommendation failed (${res.status}).`,
      res.status,
    );
  }

  if (!res.ok || json.success === false) {
    throw new RecommendSuppliersApiError(
      String(json.message ?? `Supplier recommendation failed (${res.status}).`),
      res.status,
      json.code != null ? String(json.code) : undefined,
    );
  }

  return json as RecommendSuppliersResponse;
}

/** Admin / Procurement Manager may bypass category filter. */
export function canBypassSupplierCategoryFilter(role?: string | null): boolean {
  const r = String(role ?? "").trim().toLowerCase();
  return r === "admin" || r === "procurement";
}
