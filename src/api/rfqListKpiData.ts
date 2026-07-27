/**
 * Fetches All-RFQs KPI counts using the same status resolution as the list table.
 */

import { getRFQNamesWithPO } from "./purchasing";
import {
  getQuoteCountsForRFQs,
  getRFQsPaged,
  uniqueByDocName,
  type RFQListRow,
} from "./sourcing";
import {
  computeRfqListKpis,
  warnIfRfqKpisInconsistent,
  type RfqListKpiCounts,
} from "../utils/rfqListKpis";

const PAGE_SIZE = 200;

/** ERP statuses that resolve without quote/PO enrichment. */
function needsEnrichment(status?: string | null): boolean {
  const erp = (status ?? "Draft").trim();
  if (
    erp === "Draft" ||
    erp === "Closed" ||
    erp === "Cancelled" ||
    erp === "Ordered" ||
    erp === "Partially Ordered"
  ) {
    return false;
  }
  return true;
}

async function fetchAllRfqStatusRows(): Promise<RFQListRow[]> {
  const first = await getRFQsPaged({
    page: 1,
    pageSize: PAGE_SIZE,
    order_by: "modified desc, name desc",
  });
  const rows = [...first.data];
  const totalPages = first.total_pages;

  if (totalPages <= 1) return rows;

  const rest = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, i) =>
      getRFQsPaged({
        page: i + 2,
        pageSize: PAGE_SIZE,
        order_by: "modified desc, name desc",
      }),
    ),
  );

  for (const page of rest) {
    rows.push(...page.data);
  }
  return uniqueByDocName(rows);
}

/**
 * Load mutually exclusive KPI buckets for the All RFQs page.
 * PO Created uses the same hasPO / Ordered signals as the table status column.
 */
export async function fetchRfqListKpis(): Promise<RfqListKpiCounts> {
  const rows = await fetchAllRfqStatusRows();
  const enrichNames = rows.filter((r) => needsEnrichment(r.status)).map((r) => r.name);

  const [quoteCounts, poSet] = await Promise.all([
    getQuoteCountsForRFQs(enrichNames),
    getRFQNamesWithPO(enrichNames),
  ]);

  const kpis = computeRfqListKpis(rows, quoteCounts, poSet);
  warnIfRfqKpisInconsistent(kpis);
  return kpis;
}
