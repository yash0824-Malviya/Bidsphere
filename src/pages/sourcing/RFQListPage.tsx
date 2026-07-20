import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Calendar, FileSearch, Plus, RotateCcw, X } from "lucide-react";

import { getRFQNamesWithPO } from "../../api/purchasing";
import {
  getQuoteCountsForRFQs,
  getRFQsPaged,
  type RFQListRow,
} from "../../api/sourcing";
import ConnectionError from "../../components/ConnectionError";
import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import PaginationBar from "../../components/PaginationBar";
import { TableSkeleton } from "../../components/Skeleton";
import StatusBadge from "../../components/StatusBadge";
import ExportButton from "../../components/export/ExportButton";
import { ownerTitleFromEmail } from "../../config/roles";
import {
  FilterBar,
  FilterField,
  SearchInput,
  SortableTableHeader,
} from "../../components/ui";
import { useDebounce } from "../../hooks/useDebounce";
import { usePagination } from "../../hooks/usePagination";
import {
  RFQ_DEFAULT_SORT,
  rfqComparators,
  sortNewestFirst,
  sortRows,
} from "../../utils/listSort";
import { formatDate } from "../../utils/format";
import {
  buildRfqListFilters,
  clearRfqFilterKey,
  EMPTY_RFQ_FILTERS,
  getActiveRfqFilterChips,
  hasActiveRfqFilters,
  RFQ_DATE_PRESET_OPTIONS,
  RFQ_STATUS_OPTIONS,
  type RfqListFilterState,
  type RfqStatusFilter,
} from "../../utils/rfqListFilters";

interface RFQRow extends RFQListRow {
  quote_count: number;
  /** UI status — "Completed" when a linked PO exists. */
  display_status: string;
}

const RFQ_COMPARATORS = rfqComparators<RFQRow>();

/** Sort keys that map directly to a real `Request for Quotation` field. */
const RFQ_ORDER_BY_FIELD: Record<string, string> = {
  name: "name",
  modified: "modified",
  owner: "owner",
};

export default function RFQListPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preset = (searchParams.get("preset") ?? "").toLowerCase();

  const LIST_STALE_TIME = 5 * 60_000;

  const [filtersState, setFiltersState] =
    useState<RfqListFilterState>(EMPTY_RFQ_FILTERS);
  const debouncedSearch = useDebounce(filtersState.search, 300);

  const effectiveFilters = useMemo(
    () => ({ ...filtersState, search: debouncedSearch }),
    [filtersState, debouncedSearch],
  );

  const built = useMemo(
    () =>
      buildRfqListFilters(effectiveFilters, {
        openPreset: preset === "open",
      }),
    [effectiveFilters, preset],
  );

  const [sort, setSort] = useState(RFQ_DEFAULT_SORT);
  const orderByField = RFQ_ORDER_BY_FIELD[sort.key];
  const order_by = orderByField
    ? `${orderByField} ${sort.direction}, name desc`
    : "modified desc, name desc";

  const filterKey = useMemo(
    () =>
      JSON.stringify({
        f: built.filters,
        o: built.or_filters,
        order_by,
      }),
    [built, order_by],
  );

  const { page, pageSize, setPage, setPageSize } = usePagination({
    resetKey: filterKey,
  });

  const rfqsQuery = useQuery({
    queryKey: ["rfqs", filterKey, page, pageSize],
    queryFn: () =>
      getRFQsPaged({
        page,
        pageSize,
        order_by,
        filters: built.filters.length ? built.filters : undefined,
        or_filters: built.or_filters.length ? built.or_filters : undefined,
      }),
    staleTime: LIST_STALE_TIME,
    placeholderData: (prev) => prev,
  });

  const rfqNames = useMemo(
    () => (rfqsQuery.data?.data ?? []).map((r) => r.name),
    [rfqsQuery.data],
  );

  const quotesQuery = useQuery({
    queryKey: ["rfq-list-quote-counts", rfqNames],
    enabled: rfqNames.length > 0,
    staleTime: LIST_STALE_TIME,
    retry: 0,
    queryFn: () => getQuoteCountsForRFQs(rfqNames),
  });

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

  const sortedRows = useMemo(() => {
    const normalized = sortNewestFirst(rows, {
      date: (rfq) => rfq.modified,
      name: (rfq) => rfq.name,
    });
    return sortRows(normalized, sort, RFQ_COMPARATORS);
  }, [rows, sort]);

  const ownerOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rfqsQuery.data?.data ?? []) {
      if (r.owner) set.add(r.owner);
    }
    return Array.from(set).sort((a, b) =>
      ownerTitleFromEmail(a).localeCompare(ownerTitleFromEmail(b)),
    );
  }, [rfqsQuery.data]);

  const chips = useMemo(
    () => getActiveRfqFilterChips(filtersState),
    [filtersState],
  );
  const filtersActive = hasActiveRfqFilters(filtersState) || preset === "open";

  const totalRecords = rfqsQuery.data?.total_records ?? 0;
  const showingCount = sortedRows.length;

  const patchFilters = useCallback((patch: Partial<RfqListFilterState>) => {
    setFiltersState((prev) => ({ ...prev, ...patch }));
  }, []);

  const resetFilters = useCallback(() => {
    setFiltersState(EMPTY_RFQ_FILTERS);
  }, []);

  const removeChip = useCallback((key: keyof RfqListFilterState) => {
    setFiltersState((prev) => clearRfqFilterKey(prev, key));
  }, []);

  const emptyTitle = filtersActive
    ? "No RFQs match the selected filters."
    : "No RFQs yet";
  const emptyDescription = filtersActive
    ? "Try adjusting or resetting filters to see more results."
    : "Create your first RFQ to start collecting supplier quotations.";

  return (
    <div>
      <PageHeader
        title="RFQ Management"
        description="Manage supplier bidding and quotation activities."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ExportButton
              module="RFQ"
              filenamePrefix="RFQ_List_Filtered"
              columns={[
                { id: "name", label: "RFQ Number", accessor: (r) => r.name },
                {
                  id: "status",
                  label: "Status",
                  type: "status",
                  accessor: (r) => r.display_status || r.status,
                },
                {
                  id: "quote_count",
                  label: "Quotations",
                  type: "number",
                  accessor: (r) => r.quote_count,
                },
                {
                  id: "modified",
                  label: "Last Updated",
                  type: "date",
                  accessor: (r) => r.modified,
                },
                {
                  id: "owner",
                  label: "Owner",
                  accessor: (r) => ownerTitleFromEmail(r.owner),
                },
              ]}
              rows={sortedRows}
            />
            <Link to="/sourcing/rfq/new" className="btn-primary">
              <Plus className="h-4 w-4" />
              Create RFQ
            </Link>
          </div>
        }
      />

      <FilterBar className="!flex-row !flex-wrap !items-end gap-3">
        <FilterField
          label="Search"
          className="min-w-[220px] flex-1 basis-[220px] sm:min-w-[260px]"
        >
          <SearchInput
            value={filtersState.search}
            onChange={(v) => patchFilters({ search: v })}
            placeholder="RFQ, Material Request, Supplier…"
          />
        </FilterField>

        <FilterField label="Status" className="w-full min-w-[140px] sm:w-[150px]">
          <select
            value={filtersState.status}
            onChange={(e) =>
              patchFilters({ status: e.target.value as RfqStatusFilter })
            }
            className="select-field"
          >
            {RFQ_STATUS_OPTIONS.map((opt) => (
              <option key={opt || "all"} value={opt}>
                {opt || "All statuses"}
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField label="Owner" className="w-full min-w-[160px] sm:w-[180px]">
          <select
            value={filtersState.owner}
            onChange={(e) => patchFilters({ owner: e.target.value })}
            className="select-field"
          >
            <option value="">All owners</option>
            {ownerOptions.map((o) => (
              <option key={o} value={o}>
                {ownerTitleFromEmail(o)}
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField
          label="Date Range"
          className="w-full min-w-[150px] sm:w-[160px]"
        >
          <select
            value={filtersState.datePreset}
            onChange={(e) =>
              patchFilters({
                datePreset: e.target.value as RfqListFilterState["datePreset"],
              })
            }
            className="select-field"
          >
            {RFQ_DATE_PRESET_OPTIONS.map((opt) => (
              <option key={opt.value || "all"} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </FilterField>

        {filtersState.datePreset === "custom" && (
          <>
            <FilterField label="From" className="w-full min-w-[150px] sm:w-[150px]">
              <div className="relative">
                <input
                  type="date"
                  value={filtersState.dateFrom}
                  onChange={(e) => patchFilters({ dateFrom: e.target.value })}
                  className="input-field pr-9"
                />
                <Calendar className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              </div>
            </FilterField>
            <FilterField label="To" className="w-full min-w-[150px] sm:w-[150px]">
              <div className="relative">
                <input
                  type="date"
                  value={filtersState.dateTo}
                  onChange={(e) => patchFilters({ dateTo: e.target.value })}
                  className="input-field pr-9"
                />
                <Calendar className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              </div>
            </FilterField>
          </>
        )}

        <div className="flex shrink-0 items-end">
          <button
            type="button"
            onClick={resetFilters}
            disabled={!hasActiveRfqFilters(filtersState)}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 shadow-sm transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset Filters
          </button>
        </div>
      </FilterBar>

      {(chips.length > 0 || preset === "open") && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {preset === "open" && !filtersState.status && (
            <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-800 ring-1 ring-inset ring-sky-100">
              Preset: Open RFQs
            </span>
          )}
          {chips.map((chip) => (
            <button
              key={`${chip.key}-${chip.value}`}
              type="button"
              onClick={() => removeChip(chip.key)}
              className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-800 ring-1 ring-inset ring-primary-100 transition hover:bg-primary-100"
            >
              <span>
                {chip.label}:{" "}
                {chip.key === "owner"
                  ? ownerTitleFromEmail(chip.value)
                  : chip.value}
              </span>
              <X className="h-3 w-3 opacity-70" aria-hidden />
              <span className="sr-only">Remove {chip.label} filter</span>
            </button>
          ))}
        </div>
      )}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm text-neutral-600">
        <p className="tabular-nums">
          {rfqsQuery.isLoading ? (
            "Loading RFQs…"
          ) : (
            <>
              Showing{" "}
              <span className="font-semibold text-neutral-900">
                {showingCount}
              </span>{" "}
              of{" "}
              <span className="font-semibold text-neutral-900">
                {totalRecords}
              </span>{" "}
              RFQs
            </>
          )}
        </p>
      </div>

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
            title={emptyTitle}
            description={emptyDescription}
            action={
              filtersActive ? (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="btn-secondary"
                >
                  <RotateCcw className="h-4 w-4" />
                  Reset Filters
                </button>
              ) : (
                <Link to="/sourcing/rfq/new" className="btn-primary">
                  <Plus className="h-4 w-4" />
                  Create New RFQ
                </Link>
              )
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
                      navigate(
                        `/sourcing/rfq/${encodeURIComponent(rfq.name)}`,
                      );
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
                    <SortableTableHeader
                      label="RFQ Number"
                      sortKey="name"
                      sort={sort}
                      onSort={setSort}
                    />
                    <SortableTableHeader
                      label="Last Modified"
                      sortKey="modified"
                      sort={sort}
                      onSort={setSort}
                    />
                    <SortableTableHeader
                      label="Owner"
                      sortKey="owner"
                      sort={sort}
                      onSort={setSort}
                    />
                    <SortableTableHeader
                      label="Quotes"
                      sortKey="quotes"
                      sort={sort}
                      onSort={setSort}
                      className="text-right"
                    />
                    <SortableTableHeader
                      label="Status"
                      sortKey="status"
                      sort={sort}
                      onSort={setSort}
                    />
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((rfq) => (
                    <tr
                      key={rfq.name}
                      onClick={() =>
                        navigate(
                          `/sourcing/rfq/${encodeURIComponent(rfq.name)}`,
                        )
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
