import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Calendar,
  Copy,
  ExternalLink,
  Eye,
  FileSearch,
  MoreHorizontal,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import toast from "react-hot-toast";

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
import ExportButton from "../../components/export/ExportButton";
import RfqListStatusBadge, {
  resolveRfqEnterpriseListStatus,
} from "../../components/sourcing/RfqListStatusBadge";
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
  has_po: boolean;
  /** UI status label for badges / export. */
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
      const has_po = poSet?.has(rfq.name) ?? false;
      const display_status = resolveRfqEnterpriseListStatus({
        erpStatus: rfq.status,
        quoteCount: quote_count,
        hasPO: has_po,
      });
      return {
        ...rfq,
        quote_count,
        has_po,
        display_status,
      };
    });
  }, [rfqsQuery.data, quotesQuery.data, linkedPOsQuery.data]);

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [actionMenu, setActionMenu] = useState<string | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSelected(new Set());
    setActionMenu(null);
  }, [filterKey, page, pageSize]);

  useEffect(() => {
    if (!actionMenu) return;
    const onDoc = (e: MouseEvent) => {
      if (
        actionMenuRef.current &&
        !actionMenuRef.current.contains(e.target as Node)
      ) {
        setActionMenu(null);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [actionMenu]);

  const sortedRows = useMemo(() => {
    const normalized = sortNewestFirst(rows, {
      date: (rfq) => rfq.modified,
      name: (rfq) => rfq.name,
    });
    return sortRows(normalized, sort, RFQ_COMPARATORS);
  }, [rows, sort]);

  const pageNames = useMemo(
    () => sortedRows.map((r) => r.name),
    [sortedRows],
  );

  const allPageSelected =
    pageNames.length > 0 && pageNames.every((n) => selected.has(n));
  const somePageSelected =
    pageNames.some((n) => selected.has(n)) && !allPageSelected;

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (pageNames.every((n) => next.has(n))) {
        for (const n of pageNames) next.delete(n);
      } else {
        for (const n of pageNames) next.add(n);
      }
      return next;
    });
  }, [pageNames]);

  const toggleSelectOne = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const serialBase = (Math.max(1, page) - 1) * pageSize;

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
            <span className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-800 ring-1 ring-inset ring-primary-100">
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
          <TableSkeleton rows={8} columns={8} />
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
            {/* Mobile cards */}
            <div className="space-y-2 md:hidden">
              {sortedRows.map((rfq, idx) => {
                const isSelected = selected.has(rfq.name);
                return (
                  <div
                    key={rfq.name}
                    className={`rounded-lg border px-3 py-3 ${
                      isSelected
                        ? "border-l-4 border-l-[#2563EB] border-y-[#E2E8F0] border-r-[#E2E8F0] bg-blue-50/70"
                        : "border-[#E2E8F0] bg-white"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectOne(rfq.name)}
                        className="mt-1 h-4 w-4 rounded border-neutral-300 text-[#2563EB] focus:ring-[#2563EB]"
                        aria-label={`Select ${rfq.name}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] tabular-nums text-neutral-400">
                            #{serialBase + idx + 1}
                          </span>
                          <Link
                            to={`/sourcing/rfq/${encodeURIComponent(rfq.name)}`}
                            className="font-mono text-[14px] font-medium text-[#2563EB] hover:underline"
                          >
                            {rfq.name}
                          </Link>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <RfqListStatusBadge status={rfq.display_status} />
                          <span className="text-[13px] text-neutral-500">
                            {rfq.quote_count} quotes ·{" "}
                            {ownerTitleFromEmail(rfq.owner)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop data grid */}
            <div className="hidden max-h-[min(70vh,720px)] overflow-auto md:block">
              <table className="w-full min-w-[960px] border-separate border-spacing-0 text-[13px]">
                <thead className="sticky top-0 z-20">
                  <tr className="bg-neutral-50 text-left text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                    <th className="sticky top-0 z-20 w-10 border-b border-[#E2E8F0] bg-neutral-50 px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={allPageSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = somePageSelected;
                        }}
                        onChange={toggleSelectAll}
                        className="h-4 w-4 rounded border-neutral-300 text-[#2563EB] focus:ring-[#2563EB]"
                        aria-label="Select all rows on this page"
                      />
                    </th>
                    <th className="sticky top-0 z-20 w-12 border-b border-[#E2E8F0] bg-neutral-50 px-2 py-2.5 text-center">
                      #
                    </th>
                    <SortableTableHeader
                      label="RFQ Number"
                      sortKey="name"
                      sort={sort}
                      onSort={setSort}
                      className="sticky top-0 z-20 border-b border-[#E2E8F0] bg-neutral-50 px-3 py-2.5"
                    />
                    <SortableTableHeader
                      label="Last Modified"
                      sortKey="modified"
                      sort={sort}
                      onSort={setSort}
                      className="sticky top-0 z-20 border-b border-[#E2E8F0] bg-neutral-50 px-3 py-2.5"
                    />
                    <SortableTableHeader
                      label="Owner"
                      sortKey="owner"
                      sort={sort}
                      onSort={setSort}
                      className="sticky top-0 z-20 border-b border-[#E2E8F0] bg-neutral-50 px-3 py-2.5"
                    />
                    <SortableTableHeader
                      label="Quotes"
                      sortKey="quotes"
                      sort={sort}
                      onSort={setSort}
                      className="sticky top-0 z-20 border-b border-[#E2E8F0] bg-neutral-50 px-3 py-2.5 text-right"
                    />
                    <SortableTableHeader
                      label="Status"
                      sortKey="status"
                      sort={sort}
                      onSort={setSort}
                      className="sticky top-0 z-20 border-b border-[#E2E8F0] bg-neutral-50 px-3 py-2.5"
                    />
                    <th className="sticky top-0 z-20 w-14 border-b border-[#E2E8F0] bg-neutral-50 px-2 py-2.5 text-center">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((rfq, idx) => {
                    const isSelected = selected.has(rfq.name);
                    const detailPath = `/sourcing/rfq/${encodeURIComponent(rfq.name)}`;
                    return (
                      <tr
                        key={rfq.name}
                        onClick={() => navigate(detailPath)}
                        className={`group h-14 cursor-pointer border-b border-[#E2E8F0] transition-colors ${
                          isSelected
                            ? "bg-blue-50/80"
                            : "bg-white hover:bg-neutral-50"
                        }`}
                      >
                        <td
                          className={`px-3 py-0 align-middle ${
                            isSelected
                              ? "border-l-4 border-l-[#2563EB]"
                              : "border-l-4 border-l-transparent"
                          }`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectOne(rfq.name)}
                            className="h-4 w-4 rounded border-neutral-300 text-[#2563EB] focus:ring-[#2563EB]"
                            aria-label={`Select ${rfq.name}`}
                          />
                        </td>
                        <td className="px-2 py-0 text-center align-middle tabular-nums text-neutral-400">
                          {serialBase + idx + 1}
                        </td>
                        <td className="px-3 py-0 align-middle">
                          <Link
                            to={detailPath}
                            className="font-mono text-[13px] font-medium text-[#2563EB] hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {rfq.name}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap px-3 py-0 align-middle text-neutral-600">
                          {rfq.modified ? formatDate(rfq.modified) : "—"}
                        </td>
                        <td className="px-3 py-0 align-middle text-neutral-600">
                          {ownerTitleFromEmail(rfq.owner)}
                        </td>
                        <td className="px-3 py-0 text-right align-middle tabular-nums">
                          <span
                            className={
                              rfq.quote_count > 0
                                ? "font-medium text-[#111827]"
                                : "text-neutral-400"
                            }
                          >
                            {rfq.quote_count}
                          </span>
                        </td>
                        <td className="px-3 py-0 align-middle">
                          <RfqListStatusBadge status={rfq.display_status} />
                        </td>
                        <td
                          className="relative px-2 py-0 text-center align-middle"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div
                            className="relative inline-block"
                            ref={
                              actionMenu === rfq.name ? actionMenuRef : undefined
                            }
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setActionMenu((cur) =>
                                  cur === rfq.name ? null : rfq.name,
                                )
                              }
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
                              aria-label={`Actions for ${rfq.name}`}
                              aria-expanded={actionMenu === rfq.name}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                            {actionMenu === rfq.name && (
                              <div className="absolute right-0 top-full z-30 mt-1 w-44 rounded-md border border-[#E2E8F0] bg-white py-1 shadow-sm">
                                <button
                                  type="button"
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[#111827] hover:bg-neutral-50"
                                  onClick={() => {
                                    setActionMenu(null);
                                    navigate(detailPath);
                                  }}
                                >
                                  <Eye className="h-3.5 w-3.5 text-neutral-500" />
                                  View RFQ
                                </button>
                                <button
                                  type="button"
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[#111827] hover:bg-neutral-50"
                                  onClick={() => {
                                    setActionMenu(null);
                                    window.open(detailPath, "_blank", "noopener");
                                  }}
                                >
                                  <ExternalLink className="h-3.5 w-3.5 text-neutral-500" />
                                  Open in new tab
                                </button>
                                <button
                                  type="button"
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[#111827] hover:bg-neutral-50"
                                  onClick={() => {
                                    void navigator.clipboard
                                      .writeText(rfq.name)
                                      .then(() =>
                                        toast.success("RFQ number copied"),
                                      )
                                      .catch(() =>
                                        toast.error("Could not copy"),
                                      );
                                    setActionMenu(null);
                                  }}
                                >
                                  <Copy className="h-3.5 w-3.5 text-neutral-500" />
                                  Copy RFQ number
                                </button>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {selected.size > 0 && (
              <div className="border-t border-[#E2E8F0] bg-blue-50/50 px-3 py-2 text-[13px] text-[#1D4ED8]">
                {selected.size} selected
              </div>
            )}

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
