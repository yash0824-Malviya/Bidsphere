/**
 * Single source of truth for Procurement Dashboard executive counts.
 *
 * Every top KPI card and every analytics card that displays the same metric
 * MUST read from these filters via `fetchProcurementTruthCounts()`. Do not
 * re-derive Open RFQs / Pending Quotations / etc. from limited list samples.
 *
 * ERPNext REST equivalent of:
 *   frappe.client.get_count(doctype, filters)
 */
import { getExactCount, type Filter } from "./erpnext";
import { dashPerfLog } from "./dashboardPerf";
import { listOnboardings } from "./supplierOnboarding";

/** Canonical filters — keep in sync with RFQ list `preset=open` and PO pending. */
export const PROCUREMENT_TRUTH_FILTERS = {
  /** Matches `/sourcing/rfq?preset=open` */
  openRfqs: [["status", "in", ["Submitted", "Open"]]] as Filter[],
  pendingQuotations: [
    ["status", "not in", ["Ordered", "Expired", "Lost", "Cancelled"]],
  ] as Filter[],
  /** Draft POs awaiting submit/approval */
  pendingPurchaseOrders: [["docstatus", "=", 0]] as Filter[],
  activeSuppliers: [["disabled", "=", 0]] as Filter[],
  /** Submitted material requests (cycle-time context) */
  submittedMaterialRequests: [["docstatus", "=", 1]] as Filter[],
  /** Submitted purchase orders (cycle-time context) */
  submittedPurchaseOrders: [["docstatus", "=", 1]] as Filter[],
} as const;

export interface ProcurementTruthCounts {
  openRfqs: number;
  pendingQuotations: number;
  pendingPurchaseOrders: number;
  activeSuppliers: number;
  submittedMaterialRequests: number;
  submittedPurchaseOrders: number;
  /** ISO timestamp when this snapshot was fetched */
  fetchedAt: string;
  source: "frappe.client.get_count";
}

const TTL_MS = 30_000;
let cache: { at: number; data: ProcurementTruthCounts } | null = null;
let inflight: Promise<ProcurementTruthCounts> | null = null;

/** Dev log for every dashboard widget result (page-load audit). */
export function logDashboardWidget(
  widget: string,
  payload: Record<string, unknown>,
): void {
  if (!import.meta.env.DEV) return;
  console.log(`[Dashboard Truth] ${widget}`, {
    t: Math.round(performance.now()),
    ...payload,
  });
}

/**
 * Exact ERPNext counts shared by executive KPIs + analytics cards.
 * Deduped for 30s so KPI snapshot and analytics don't double-hit ERP.
 */
export async function fetchProcurementTruthCounts(opts?: {
  force?: boolean;
}): Promise<ProcurementTruthCounts> {
  const now = Date.now();
  if (!opts?.force && cache && now - cache.at < TTL_MS) {
    logDashboardWidget("Truth counts (cache hit)", {
      ...cache.data,
      ageMs: now - cache.at,
    });
    return cache.data;
  }
  if (!opts?.force && inflight) return inflight;

  inflight = (async () => {
    const t0 = performance.now();
    const [
      openRfqs,
      pendingQuotations,
      pendingPurchaseOrders,
      activeSuppliers,
      submittedMaterialRequests,
      submittedPurchaseOrders,
    ] = await Promise.all([
      getExactCount(
        "Request for Quotation",
        PROCUREMENT_TRUTH_FILTERS.openRfqs,
      ),
      getExactCount(
        "Supplier Quotation",
        PROCUREMENT_TRUTH_FILTERS.pendingQuotations,
      ),
      getExactCount(
        "Purchase Order",
        PROCUREMENT_TRUTH_FILTERS.pendingPurchaseOrders,
      ),
      getExactCount("Supplier", PROCUREMENT_TRUTH_FILTERS.activeSuppliers),
      getExactCount(
        "Material Request",
        PROCUREMENT_TRUTH_FILTERS.submittedMaterialRequests,
      ),
      getExactCount(
        "Purchase Order",
        PROCUREMENT_TRUTH_FILTERS.submittedPurchaseOrders,
      ),
    ]);

    const data: ProcurementTruthCounts = {
      openRfqs,
      pendingQuotations,
      pendingPurchaseOrders,
      activeSuppliers,
      submittedMaterialRequests,
      submittedPurchaseOrders,
      fetchedAt: new Date().toISOString(),
      source: "frappe.client.get_count",
    };

    cache = { at: Date.now(), data };
    logDashboardWidget("Truth counts (ERP)", {
      ...data,
      durationMs: Math.round(performance.now() - t0),
      filters: PROCUREMENT_TRUTH_FILTERS,
    });
    dashPerfLog("Truth counts ready", {
      durationMs: Math.round(performance.now() - t0),
    });
    return data;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

/** Invalidate shared truth cache (e.g. after creating an RFQ/PO). */
export function invalidateProcurementTruthCounts(): void {
  cache = null;
  actionCache = null;
}

export interface ProcurementActionCenterCounts {
  materialRequestsWaitingForRfq: number;
  /**
   * Kept for API stability. Always 0 — RFQ `valid_till` is not a standard
   * list-queryable field on Request for Quotation (lives on Supplier Quotation).
   * Filtering RFQs by it returns HTTP 417 Field not permitted.
   */
  rfqsClosingSoon: number;
  quotationsWaitingReview: number;
  purchaseOrdersWaitingApproval: number;
  suppliersWaitingApproval: number;
}

let actionCache: { at: number; data: ProcurementActionCenterCounts } | null =
  null;
let actionInflight: Promise<ProcurementActionCenterCounts> | null = null;

/**
 * Action Center counts — live ERP, aligned with executive truth where shared.
 * `materialRequestsWaitingForRfq` is passed in from forwarded dashboard
 * counters (Pending RFQ Creation) so Action Center stays aligned.
 */
export async function fetchProcurementActionCenterCounts(opts?: {
  materialRequestsWaitingForRfq?: number;
  force?: boolean;
}): Promise<ProcurementActionCenterCounts> {
  const now = Date.now();
  if (!opts?.force && actionCache && now - actionCache.at < TTL_MS) {
    const cached = {
      ...actionCache.data,
      materialRequestsWaitingForRfq:
        opts?.materialRequestsWaitingForRfq ??
        actionCache.data.materialRequestsWaitingForRfq,
    };
    logDashboardWidget("Action Center (cache)", cached as unknown as Record<string, unknown>);
    return cached;
  }
  if (!opts?.force && actionInflight) {
    const base = await actionInflight;
    return {
      ...base,
      materialRequestsWaitingForRfq:
        opts?.materialRequestsWaitingForRfq ??
        base.materialRequestsWaitingForRfq,
    };
  }

  actionInflight = (async () => {
    const truth = await fetchProcurementTruthCounts();

    const [onboardSubmitted, onboardReview] = await Promise.allSettled([
      listOnboardings({ status: "Submitted" }).catch(() => []),
      listOnboardings({ status: "Under Review" }).catch(() => []),
    ]);

    const suppliersWaitingApproval =
      (onboardSubmitted.status === "fulfilled"
        ? onboardSubmitted.value.length
        : 0) +
      (onboardReview.status === "fulfilled" ? onboardReview.value.length : 0);

    const data: ProcurementActionCenterCounts = {
      materialRequestsWaitingForRfq: opts?.materialRequestsWaitingForRfq ?? 0,
      // Never query RFQ.valid_till — not permitted on this DocType via get_list.
      rfqsClosingSoon: 0,
      quotationsWaitingReview: truth.pendingQuotations,
      purchaseOrdersWaitingApproval: truth.pendingPurchaseOrders,
      suppliersWaitingApproval,
    };

    actionCache = { at: Date.now(), data };
    logDashboardWidget("Action Center (ERP)", {
      ...data,
      quotationsSource: "truth.pendingQuotations",
      poSource: "truth.pendingPurchaseOrders",
    });
    return data;
  })().finally(() => {
    actionInflight = null;
  });

  return actionInflight;
}
