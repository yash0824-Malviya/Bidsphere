/**
 * Supplier "No Quote / Decline to Quote" workflow.
 *
 * A supplier may explicitly decline an RFQ instead of ignoring it. The decline
 * is persisted in ERPNext as a first-class "Supplier RFQ Response" record (the
 * single source of truth) — RFQs are never deleted and never marked "ignored".
 * A declined supplier is counted as **Responded**, not Pending.
 *
 * Provision the DocType once with:
 *   node scripts/setup-supplier-rfq-response-doctype.mjs
 */
import { apiGet, apiPost, buildResourceUrl } from "./erpnext";

export const RESPONSE_DOCTYPE = "Supplier RFQ Response";

/** Mandatory decline-reason options (order preserved for the dropdown). */
export const DECLINE_REASONS = [
  "Out of Capacity",
  "Product Not Manufactured",
  "Delivery Timeline Not Possible",
  "Commercial Reasons",
  "Pricing Not Competitive",
  "Material Not Available",
  "Technical Constraints",
  "Existing Production Commitments",
  "Not Interested",
  "Other",
] as const;

export type DeclineReason = (typeof DECLINE_REASONS)[number];

export interface SupplierRfqResponse {
  name: string;
  rfq: string;
  supplier: string;
  supplier_name?: string;
  rfq_supplier_row?: string;
  response_status: "No Quote";
  decline_reason: DeclineReason | string;
  reason_details?: string;
  comment?: string;
  response_date?: string;
  responded_by?: string;
}

export interface DeclineRfqInput {
  rfq: string;
  supplier: string;
  supplierDisplayName?: string;
  rfqSupplierRow?: string;
  reason: DeclineReason | string;
  reasonDetails?: string;
  comment?: string;
  /** Identity of the user submitting the decline (supplier portal user). */
  respondedBy?: string;
}

const RESPONSE_FIELDS = [
  "name",
  "rfq",
  "supplier",
  "supplier_name",
  "rfq_supplier_row",
  "response_status",
  "decline_reason",
  "reason_details",
  "comment",
  "response_date",
  "responded_by",
];

function isMissingDoctypeError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    /DoesNotExist/i.test(msg) ||
    /not found/i.test(msg) ||
    /404/.test(msg) ||
    /Supplier RFQ Response/i.test(msg)
  );
}

/**
 * Persist a supplier's decision to decline an RFQ. Creates a
 * "Supplier RFQ Response" doc via the whitelisted frappe.client.save method,
 * then best-effort flips the RFQ supplier row's `quote_status` to "No Quote"
 * so the buyer's existing badge lights up even without reading this doctype.
 */
export async function declineRfq(
  input: DeclineRfqInput
): Promise<SupplierRfqResponse> {
  const doc: Record<string, unknown> = {
    doctype: RESPONSE_DOCTYPE,
    rfq: input.rfq,
    supplier: input.supplier,
    supplier_name: input.supplierDisplayName || input.supplier,
    rfq_supplier_row: input.rfqSupplierRow,
    response_status: "No Quote",
    decline_reason: input.reason,
    reason_details: input.reasonDetails,
    comment: input.comment,
    response_date: new Date()
      .toISOString()
      .slice(0, 19)
      .replace("T", " "),
    responded_by: input.respondedBy || input.supplier,
  };

  let created: SupplierRfqResponse;
  try {
    created = await apiPost<SupplierRfqResponse>(
      "/api/method/frappe.client.save",
      { doc }
    );
  } catch (err) {
    if (isMissingDoctypeError(err)) {
      throw new Error(
        `The "${RESPONSE_DOCTYPE}" DocType is not set up in ERPNext yet. ` +
          `An administrator must run: node scripts/setup-supplier-rfq-response-doctype.mjs`
      );
    }
    throw err;
  }

  // Best-effort: mark the RFQ supplier child row as "No Quote" so the buyer's
  // existing quote_status badge reflects the decline. Non-fatal on failure —
  // the response doc above is the authoritative record either way.
  try {
    await apiPost("/api/method/frappe.client.set_value", {
      doctype: "Request for Quotation Supplier",
      name: input.rfqSupplierRow,
      fieldname: "quote_status",
      value: "No Quote",
    });
  } catch {
    /* supplier likely lacks RFQ write permission — ignore */
  }

  return created;
}

/** All decline responses for a single RFQ. */
export async function getRfqResponses(
  rfqName: string
): Promise<SupplierRfqResponse[]> {
  try {
    const rows = await apiGet<SupplierRfqResponse[]>(
      buildResourceUrl(RESPONSE_DOCTYPE),
      {
        params: {
          fields: JSON.stringify(RESPONSE_FIELDS),
          filters: JSON.stringify([["rfq", "=", rfqName]]),
          limit_page_length: 200,
        },
      }
    );
    return rows ?? [];
  } catch {
    // DocType not provisioned yet or permission issue — degrade gracefully.
    return [];
  }
}

/** The current supplier's decline response for an RFQ, if any. */
export async function getSupplierResponse(
  rfqName: string,
  supplier: string
): Promise<SupplierRfqResponse | null> {
  try {
    const rows = await apiGet<SupplierRfqResponse[]>(
      buildResourceUrl(RESPONSE_DOCTYPE),
      {
        params: {
          fields: JSON.stringify(RESPONSE_FIELDS),
          filters: JSON.stringify([
            ["rfq", "=", rfqName],
            ["supplier", "=", supplier],
          ]),
          limit_page_length: 1,
        },
      }
    );
    return (rows ?? [])[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Decline responses across many RFQs at once. Returns a map keyed by RFQ name
 * containing the set of declined supplier ids (used by the supplier list view).
 */
export async function getDeclinedSuppliersByRfq(
  rfqNames: string[]
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  if (rfqNames.length === 0) return result;
  try {
    const rows = await apiGet<Array<{ rfq: string; supplier: string }>>(
      buildResourceUrl(RESPONSE_DOCTYPE),
      {
        params: {
          fields: JSON.stringify(["rfq", "supplier"]),
          filters: JSON.stringify([["rfq", "in", rfqNames]]),
          limit_page_length: 0,
        },
      }
    );
    for (const r of rows ?? []) {
      if (!result.has(r.rfq)) result.set(r.rfq, new Set());
      result.get(r.rfq)!.add((r.supplier ?? "").toLowerCase());
    }
  } catch {
    /* ignore */
  }
  return result;
}

/** Every decline response (for reports / analytics). */
export async function getAllDeclineResponses(filters?: {
  dateFrom?: string;
  dateTo?: string;
}): Promise<SupplierRfqResponse[]> {
  const erpFilters: Array<[string, string, string]> = [];
  if (filters?.dateFrom) erpFilters.push(["response_date", ">=", filters.dateFrom]);
  if (filters?.dateTo) erpFilters.push(["response_date", "<=", filters.dateTo]);
  try {
    const rows = await apiGet<SupplierRfqResponse[]>(
      buildResourceUrl(RESPONSE_DOCTYPE),
      {
        params: {
          fields: JSON.stringify(RESPONSE_FIELDS),
          filters: erpFilters.length ? JSON.stringify(erpFilters) : undefined,
          order_by: "response_date desc",
          limit_page_length: 0,
        },
      }
    );
    return rows ?? [];
  } catch {
    return [];
  }
}

export interface DeclineReasonStat {
  reason: string;
  count: number;
  pct: number;
}

/** Aggregate decline responses into "most common decline reasons". */
export function summarizeDeclineReasons(
  responses: SupplierRfqResponse[]
): DeclineReasonStat[] {
  const counts = new Map<string, number>();
  for (const r of responses) {
    const key = r.decline_reason || "Unspecified";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = responses.length || 1;
  return [...counts.entries()]
    .map(([reason, count]) => ({
      reason,
      count,
      pct: Math.round((count / total) * 100),
    }))
    .sort((a, b) => b.count - a.count);
}
