/**
 * All-RFQs KPI buckets — mutually exclusive, collectively exhaustive.
 * Uses the same enterprise status resolution as the RFQ list table.
 */

import {
  resolveRfqEnterpriseListStatus,
  type RfqEnterpriseListStatus,
} from "../components/sourcing/RfqListStatusBadge";

export type RfqKpiBucket =
  | "awaiting"
  | "draftOpen"
  | "poCreated"
  | "closed";

export interface RfqListKpiCounts {
  total: number;
  awaiting: number;
  draftOpen: number;
  poCreated: number;
  closed: number;
}

export interface RfqKpiSourceRow {
  name: string;
  status?: string | null;
}

/** Map table/enterprise status → one KPI bucket. */
export function enterpriseStatusToKpiBucket(
  status: RfqEnterpriseListStatus | string,
): RfqKpiBucket {
  switch (status) {
    case "Awaiting Supplier Response":
      return "awaiting";
    case "Purchase Order Created":
    case "Completed":
      return "poCreated";
    case "Closed":
    case "Cancelled":
      return "closed";
    case "Draft":
    case "Open":
    case "AI Analysis":
    case "Under Legal Review":
    case "Under Finance Review":
    default:
      return "draftOpen";
  }
}

/** Aggregate KPI counts from already-resolved enterprise statuses. */
export function aggregateRfqKpiBuckets(
  statuses: Array<RfqEnterpriseListStatus | string>,
): RfqListKpiCounts {
  const counts: RfqListKpiCounts = {
    total: statuses.length,
    awaiting: 0,
    draftOpen: 0,
    poCreated: 0,
    closed: 0,
  };

  for (const status of statuses) {
    const bucket = enterpriseStatusToKpiBucket(status);
    counts[bucket] += 1;
  }

  return counts;
}

/**
 * Resolve each RFQ with the same inputs as the list table, then bucket.
 */
export function computeRfqListKpis(
  rows: RfqKpiSourceRow[],
  quoteCounts: Map<string, number> | undefined,
  poSet: Set<string> | undefined,
): RfqListKpiCounts {
  const statuses = rows.map((row) =>
    resolveRfqEnterpriseListStatus({
      erpStatus: row.status,
      quoteCount: quoteCounts?.get(row.name) ?? 0,
      hasPO: poSet?.has(row.name) ?? false,
    }),
  );
  return aggregateRfqKpiBuckets(statuses);
}

export interface RfqKpiConsistencyResult {
  ok: boolean;
  total: number;
  bucketSum: number;
  delta: number;
}

/** Lightweight consistency check: bucket sum must equal total. */
export function checkRfqKpiConsistency(
  kpis: RfqListKpiCounts,
): RfqKpiConsistencyResult {
  const bucketSum =
    kpis.awaiting + kpis.draftOpen + kpis.poCreated + kpis.closed;
  const delta = bucketSum - kpis.total;
  return {
    ok: delta === 0 && kpis.total === bucketSum,
    total: kpis.total,
    bucketSum,
    delta,
  };
}

/** Log a warning when KPI buckets diverge from total (dev/regression signal). */
export function warnIfRfqKpisInconsistent(kpis: RfqListKpiCounts): boolean {
  const result = checkRfqKpiConsistency(kpis);
  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.warn(
      "[RFQ List KPIs] Bucket sum diverged from total.",
      {
        total: result.total,
        bucketSum: result.bucketSum,
        delta: result.delta,
        buckets: {
          awaiting: kpis.awaiting,
          draftOpen: kpis.draftOpen,
          poCreated: kpis.poCreated,
          closed: kpis.closed,
        },
      },
    );
  }
  return result.ok;
}
