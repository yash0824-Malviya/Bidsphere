import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileSearch, Plus } from "lucide-react";

import { getRFQNamesWithPO } from "../../api/purchasing";
import {
  getQuoteCountsForRFQs,
  getRFQsPaged,
  type RFQListRow,
} from "../../api/sourcing";
import type { Filter } from "../../api/erpnext";
import ConnectionError from "../../components/ConnectionError";
import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import PaginationBar from "../../components/PaginationBar";
import { TableSkeleton } from "../../components/Skeleton";
import StatusBadge from "../../components/StatusBadge";
import { ownerTitleFromEmail } from "../../config/roles";
import { SortableTableHeader } from "../../components/ui";
import { usePagination } from "../../hooks/usePagination";
import {
  RFQ_DEFAULT_SORT,
  rfqComparators,
  sortNewestFirst,
  sortRows,
} from "../../utils/listSort";
import { formatDate } from "../../utils/format";

interface RFQRow extends RFQListRow {
  quote_count: number;
  /** UI status — "Completed" when a linked PO exists. */
  display_status: string;
}

const RFQ_COMPARATORS = rfqComparators<RFQRow>();

/** Sort keys that map directly to a real `Request for Quotation` field, so
 * the server can order the whole dataset (not just the current page). The
 * `quotes`/`status` columns are computed client-side from joined data, so
 * they fall back to the default order and are only reordered within the
 * currently-loaded page. */
const RFQ_ORDER_BY_FIELD: Record<string, string> = {
  name: "name",
  modified: "modified",
  owner: "owner",
};

export default function RFQListPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preset = (searchParams.get("preset") ?? "").toLowerCase();

  // List data cached for 5 minutes — re-navigating between pages no longer
  // re-fetches the same ERPNext list on every visit.
  const LIST_STALE_TIME = 5 * 60_000;

  const [sort, setSort] = useState(RFQ_DEFAULT_SORT);
  const orderByField = RFQ_ORDER_BY_FIELD[sort.key];
  const order_by = orderByField
    ? `${orderByField} ${sort.direction}, name desc`
    : "modified desc, name desc";

  const filters = useMemo<Filter[] | undefined>(() => {
    if (preset === "open") {
      return [["status", "in", ["Submitted", "Open"]]] as Filter[];
    }
    return undefined;
  }, [preset]);

  const { page, pageSize, setPage, setPageSize } = usePagination({
    resetKey: JSON.stringify(filters ?? []) + order_by,
  });

  const rfqsQuery = useQuery({
    queryKey: ["rfqs", filters, page, pageSize, order_by],
    queryFn: () => getRFQsPaged({ page, pageSize, order_by, filters }),
    staleTime: LIST_STALE_TIME,
    placeholderData: (prev) => prev,
  });

  const rfqNames = useMemo(
    () => (rfqsQuery.data?.data ?? []).map((r) => r.name),
    [rfqsQuery.data]
  );

  /**
   * Quote counts for ALL visible RFQs in a SINGLE bulk query (no per-row
   * fan-out). Returns Map<rfqName, count>.
   */
  const quotesQuery = useQuery({
    queryKey: ["rfq-list-quote-counts", rfqNames],
    enabled: rfqNames.length > 0,
    staleTime: LIST_STALE_TIME,
    retry: 0,
    queryFn: () => getQuoteCountsForRFQs(rfqNames),
  });

  /**
   * RFQs that already have a linked Purchase Order — resolved in a SINGLE
   * bulk query. Returns a Set<rfqName>. The detail page still does the
   * authoritative per-RFQ PO validation.
   */
  const linkedPOsQuery = useQuery({
    queryKey: ["rfq-list-po-set", rfqNames],
    enabled: rfqNames.length > 0,
    staleTime: LIST_STALE_TIME,
    retry: 0,
    queryFn: () => getRFQNamesWithPO(rfqNames),
  });

  const rows: RFQRow[] = useMemo(() => {
    const quoteCounts = quotesQuery.data;
    const poSet = linkedPOsQuery.data;
    return (rfqsQuery.data?.data ?? []).map<RFQRow>((rfq) => {
      const quote_count = quoteCounts?.get(rfq.name) ?? 0;
      const hasPO = poSet?.has(rfq.name) ?? false;
      const erpStatus = rfq.status ?? "Draft";
      const display_status = hasPO
        ? "Completed"
        : erpStatus === "Ordered" || erpStatus === "Closed"
        ? "Completed"
        : erpStatus;
      return {
        ...rfq,
        quote_count,
        display_status,
      };
    });
  }, [rfqsQuery.data, quotesQuery.data, linkedPOsQuery.data]);

  // `rows` is already server-ordered for real-field sort keys (name/modified/
  // owner); this client pass keeps the computed `quotes`/`status` columns
  // sortable within the current page and provides a stable tie-breaker.
  const sortedRows = useMemo(() => {
    const normalized = sortNewestFirst(rows, {
      date: (rfq) => rfq.modified,
      name: (rfq) => rfq.name,
    });
    return sortRows(normalized, sort, RFQ_COMPARATORS);
  }, [rows, sort]);

  return (
    <div>
      <PageHeader
        title="RFQ Management"
        description="Manage supplier bidding and quotation activities."
        actions={
          <Link to="/sourcing/rfq/new" className="btn-primary">
            <Plus className="h-4 w-4" />
            Create RFQ
          </Link>
        }
      />

      <div className="table-shell">
        {rfqsQuery.isError ? (
          <ConnectionError
            title="Could not load RFQs"
            error={rfqsQuery.error}
            onRetry={() => rfqsQuery.refetch()}
          />
        ) : rfqsQuery.isLoading ? (
          <TableSkeleton rows={6} columns={5} />
        ) : sortedRows.length === 0 ? (
          <EmptyState
            icon={FileSearch}
            title="No RFQs yet"
            description="Create your first RFQ to start collecting supplier quotations."
            action={
              <Link to="/sourcing/rfq/new" className="btn-primary">
                <Plus className="h-4 w-4" />
                Create New RFQ
              </Link>
            }
          />
        ) : (
          <>
            <div className="data-card-list">
              {sortedRows.map((rfq) => (
                <div
                  key={rfq.name}
                  role="button"
                  tabIndex={0}
                  className="data-card-row"
                  onClick={() =>
                    navigate(`/sourcing/rfq/${encodeURIComponent(rfq.name)}`)
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      navigate(`/sourcing/rfq/${encodeURIComponent(rfq.name)}`);
                    }
                  }}
                >
                  <div className="data-card-field">
                    <span className="data-card-label">RFQ Number</span>
                    <span className="data-card-value">{rfq.name}</span>
                  </div>
                  <div className="data-card-field">
                    <span className="data-card-label">Last Modified</span>
                    <span className="data-card-value">
                      {rfq.modified ? formatDate(rfq.modified) : "—"}
                    </span>
                  </div>
                  <div className="data-card-field">
                    <span className="data-card-label">Owner</span>
                    <span className="data-card-value">
                      {ownerTitleFromEmail(rfq.owner)}
                    </span>
                  </div>
                  <div className="data-card-field">
                    <span className="data-card-label">Quotes</span>
                    <span className="data-card-value">{rfq.quote_count}</span>
                  </div>
                  <div className="data-card-field">
                    <span className="data-card-label">Status</span>
                    <span className="data-card-value">
                      <StatusBadge status={rfq.display_status} />
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden overflow-x-auto md:block">
            <table className="data-table">
              <thead>
                <tr>
                  <SortableTableHeader label="RFQ Number" sortKey="name" sort={sort} onSort={setSort} />
                  <SortableTableHeader label="Last Modified" sortKey="modified" sort={sort} onSort={setSort} />
                  <SortableTableHeader label="Owner" sortKey="owner" sort={sort} onSort={setSort} />
                  <SortableTableHeader label="Quotes" sortKey="quotes" sort={sort} onSort={setSort} className="text-right" />
                  <SortableTableHeader label="Status" sortKey="status" sort={sort} onSort={setSort} />
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((rfq) => (
                  <tr
                    key={rfq.name}
                    onClick={() =>
                      navigate(`/sourcing/rfq/${encodeURIComponent(rfq.name)}`)
                    }
                    className="cursor-pointer"
                  >
                    <td>
                      <Link
                        to={`/sourcing/rfq/${encodeURIComponent(rfq.name)}`}
                        className="table-link"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {rfq.name}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap text-neutral-600">
                      {rfq.modified ? formatDate(rfq.modified) : "—"}
                    </td>
                    <td className="text-neutral-600">
                      {ownerTitleFromEmail(rfq.owner)}
                    </td>
                    <td className="text-right tabular-nums">
                      <span
                        className={
                          rfq.quote_count > 0
                            ? "font-medium text-primary"
                            : "text-neutral-500"
                        }
                      >
                        {rfq.quote_count}
                      </span>
                    </td>
                    <td>
                      <StatusBadge status={rfq.display_status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>

            <PaginationBar
              currentPage={rfqsQuery.data?.current_page ?? page}
              totalPages={rfqsQuery.data?.total_pages ?? 1}
              totalRecords={rfqsQuery.data?.total_records ?? 0}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </>
        )}
      </div>
    </div>
  );
}
