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
  // eslint-disable-next-line no-console
  console.info("[DashboardLoad] fetchRfqListKpis pages START");
  const first = await getRFQsPaged({
    page: 1,
    pageSize: PAGE_SIZE,
    order_by: "modified desc, name desc",
  });
  const rows = [...first.data];
  const totalPages = first.total_pages;

  if (totalPages <= 1) {
    // eslint-disable-next-line no-console
    console.info("[DashboardLoad] fetchRfqListKpis pages DONE", {
      pages: 1,
      rows: rows.length,
    });
    return rows;
  }

  // Cap concurrent page fan-out — unbounded Promise.all floods ERP and sticks skeletons.
  const MAX_PAGES = 8;
  const pagesToFetch = Math.min(totalPages - 1, MAX_PAGES - 1);
  const rest = await Promise.all(
    Array.from({ length: pagesToFetch }, (_, i) =>
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
  // eslint-disable-next-line no-console
  console.info("[DashboardLoad] fetchRfqListKpis pages DONE", {
    totalPages,
    fetchedPages: pagesToFetch + 1,
    rows: rows.length,
    truncated: totalPages > MAX_PAGES,
  });
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
