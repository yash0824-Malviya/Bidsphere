import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Calendar,
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileSearch,
  FileText,
  Hourglass,
  Link2,
  Pencil,
  Plus,
  RotateCcw,
  Scale,
  ShoppingCart,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import toast from "react-hot-toast";

import { getRFQNamesWithPO } from "../../api/purchasing";
import { fetchRfqListKpis } from "../../api/rfqListKpiData";
import {
  deleteRFQ,
  getQuoteCountsForRFQs,
  getRFQsPaged,
  uniqueByDocName,
  type RFQListRow,
} from "../../api/sourcing";
import ConnectionError from "../../components/ConnectionError";
import EmptyState from "../../components/EmptyState";
import PaginationBar from "../../components/PaginationBar";
import { Skeleton, TableSkeleton } from "../../components/Skeleton";
import ExportButton from "../../components/export/ExportButton";
import { DashboardKpiGrid } from "../../components/dashboard/DashboardKpiCard";
import RfqListKpiCard from "../../components/sourcing/RfqListKpiCard";
import RfqListStatusBadge, {
  resolveRfqEnterpriseListStatus,
} from "../../components/sourcing/RfqListStatusBadge";
import { warnIfRfqKpisInconsistent } from "../../utils/rfqListKpis";
import { canManageRFQs, formatRfqOwnerLabel } from "../../config/roles";
import {
  FilterBar,
  FilterField,
  SearchInput,
  SortableTableHeader,
  TableRowActions,
} from "../../components/ui";
import { useDebounce } from "../../hooks/useDebounce";
import { usePagination } from "../../hooks/usePagination";
import { useAuthStore } from "../../store/authStore";
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
  display_status: string;
}

const RFQ_COMPARATORS = rfqComparators<RFQRow>();

const RFQ_ORDER_BY_FIELD: Record<string, string> = {
  name: "name",
  modified: "modified",
  owner: "owner",
};

export default function RFQListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const preset = (searchParams.get("preset") ?? "").toLowerCase();
  const userRole = useAuthStore((s) => s.user?.role);
  const canManage = canManageRFQs(userRole);

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

  const kpisQuery = useQuery({
    queryKey: ["rfq-list-kpis"],
    queryFn: fetchRfqListKpis,
    staleTime: LIST_STALE_TIME,
    retry: 1,
    retryDelay: 1_200,
  });

  useEffect(() => {
    if (kpisQuery.data) warnIfRfqKpisInconsistent(kpisQuery.data);
  }, [kpisQuery.data]);

  useEffect(() => {
    if (!kpisQuery.isError || !kpisQuery.error) return;
    // TEMP debug — remove once RFQ list KPI load is stable.
    // eslint-disable-next-line no-console
    console.error("[DashboardLoad] RFQ list KPIs failed", kpisQuery.error);
  }, [kpisQuery.isError, kpisQuery.error]);

  const rfqsQuery = useQuery({
    queryKey: ["rfqs", filterKey, page, pageSize],
    queryFn: async () => {
      // TEMP debug
      // eslint-disable-next-line no-console
      console.info("[DashboardLoad] getRFQsPaged START", { page, pageSize });
      try {
        const result = await getRFQsPaged({
          page,
          pageSize,
          order_by,
          filters: built.filters.length ? built.filters : undefined,
          or_filters: built.or_filters.length ? built.or_filters : undefined,
        });
        // eslint-disable-next-line no-console
        console.info("[DashboardLoad] getRFQsPaged DONE", {
          rows: result.data?.length ?? 0,
          total: result.total_records,
        });
        return result;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[DashboardLoad] getRFQsPaged FAILED", err);
        throw err;
      }
    },
    staleTime: LIST_STALE_TIME,
    retry: 1,
    retryDelay: 1_200,
    placeholderData: (prev) => prev,
  });

  const listRows = useMemo(
    () => uniqueByDocName(rfqsQuery.data?.data ?? []),
    [rfqsQuery.data],
  );

  const rfqNames = useMemo(() => listRows.map((r) => r.name), [listRows]);

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
    // Group by RFQ document name — never render duplicate IDs.
    return listRows.map<RFQRow>((rfq) => {
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
  }, [listRows, quotesQuery.data, linkedPOsQuery.data]);

  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSelected(new Set());
  }, [filterKey, page, pageSize]);

  async function copyDocLink(path: string) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy link");
    }
  }

  const sortedRows = useMemo(() => {
    const normalized = sortNewestFirst(rows, {
      date: (rfq) => rfq.modified,
      name: (rfq) => rfq.name,
    });
    return sortRows(normalized, sort, RFQ_COMPARATORS);
  }, [rows, sort]);

  const lastUpdatedLabel = useMemo(() => {
    let latest = "";
    for (const row of sortedRows) {
      if (row.modified && row.modified > latest) latest = row.modified;
    }
    return latest ? formatDate(latest, "d MMM yyyy") : null;
  }, [sortedRows]);

  const serialBase = (Math.max(1, page) - 1) * pageSize;

  const ownerOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of listRows) {
      if (r.owner) set.add(r.owner);
    }
    return Array.from(set).sort((a, b) =>
      formatRfqOwnerLabel(a).localeCompare(formatRfqOwnerLabel(b)),
    );
  }, [listRows]);

  const showOwnerColumn = useMemo(() => {
    if (sortedRows.length === 0) return true;
    const labels = new Set(
      sortedRows.map((r) => formatRfqOwnerLabel(r.owner)),
    );
    if (labels.size === 1 && labels.has("Procurement Team")) return false;
    return true;
  }, [sortedRows]);

  const chips = useMemo(
    () => getActiveRfqFilterChips(filtersState),
    [filtersState],
  );
  const filtersActive = hasActiveRfqFilters(filtersState) || preset === "open";

  const patchFilters = useCallback((patch: Partial<RfqListFilterState>) => {
    setFiltersState((prev) => ({ ...prev, ...patch }));
  }, []);

  const resetFilters = useCallback(() => {
    setFiltersState(EMPTY_RFQ_FILTERS);
    if (preset === "open") {
      navigate("/sourcing/rfq", { replace: true });
    }
  }, [navigate, preset]);

  const removeChip = useCallback((key: keyof RfqListFilterState) => {
    setFiltersState((prev) => clearRfqFilterKey(prev, key));
  }, []);

  const allPageSelected =
    sortedRows.length > 0 && sortedRows.every((r) => selected.has(r.name));

  function toggleSelectAll() {
    if (allPageSelected) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(sortedRows.map((r) => r.name)));
  }

  function toggleSelect(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const deleteMutation = useMutation({
    mutationFn: (name: string) => deleteRFQ(name),
    onSuccess: (_data, name) => {
      toast.success(`RFQ ${name} deleted`);
      void queryClient.invalidateQueries({ queryKey: ["rfqs"] });
      void queryClient.invalidateQueries({ queryKey: ["rfq-list-kpis"] });
    },
    onError: (err: Error) => toast.error(err.message || "Delete failed"),
  });

  const emptyTitle = filtersActive
    ? "No matching RFQs found."
    : "No RFQs found.";
  const emptyDescription = filtersActive
    ? "Try adjusting or resetting filters to see more results."
    : "Create your first RFQ to start collecting supplier quotations.";

  const exportColumns = [
    { id: "name", label: "RFQ Number", accessor: (r: RFQRow) => r.name },
    {
      id: "status",
      label: "Status",
      type: "status" as const,
      accessor: (r: RFQRow) => r.display_status || r.status,
    },
    {
      id: "quote_count",
      label: "Quotations",
      type: "number" as const,
      accessor: (r: RFQRow) => r.quote_count,
    },
    {
      id: "modified",
      label: "Last Updated",
      type: "date" as const,
      accessor: (r: RFQRow) => r.modified,
    },
    {
      id: "owner",
      label: "Owner",
      accessor: (r: RFQRow) => formatRfqOwnerLabel(r.owner),
    },
  ];

  const selectedRows = sortedRows.filter((r) => selected.has(r.name));

  function bulkToast(action: string) {
    if (selected.size === 0) {
      toast.error("Select at least one RFQ");
      return;
    }
    toast.success(`${action} queued for ${selected.size} RFQ(s)`);
  }

  return (
    <div className="rfq-list-ds flex w-full flex-col gap-3">
      {/* Action toolbar — page title/subtitle omitted; breadcrumb identifies the page */}
      <div className="rfq-list-toolbar flex flex-wrap items-center justify-end gap-3">
        <ExportButton
          module="RFQ"
          filenamePrefix="RFQ_List_Filtered"
          columns={exportColumns}
          rows={selectedRows.length > 0 ? selectedRows : sortedRows}
          onPrint={() => window.print()}
        />
        {canManage ? (
          <Link to="/sourcing/rfq/new" className="btn-primary">
            <Plus className="h-[18px] w-[18px]" />
            Create RFQ
          </Link>
        ) : null}
      </div>

      {/* Mutually exclusive KPI buckets (same status rules as the table) */}
      <div className="sourcing-list-kpis">
        {kpisQuery.isLoading && !kpisQuery.data ? (
          <DashboardKpiGrid columns={5}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="kpi-card">
                <div className="kpi-card-title-slot">
                  <Skeleton className="h-4 w-28" />
                </div>
                <div className="kpi-card-value-slot">
                  <Skeleton className="h-8 w-16" />
                </div>
              </div>
            ))}
          </DashboardKpiGrid>
        ) : (
          <DashboardKpiGrid columns={5}>
            <RfqListKpiCard
              label="Total RFQs"
              value={(kpisQuery.data?.total ?? 0).toLocaleString()}
              subtitle="All requests"
              icon={FileSearch}
              tone="blue"
              to="/sourcing/rfq"
            />
            <RfqListKpiCard
              label="Awaiting Response"
              value={(kpisQuery.data?.awaiting ?? 0).toLocaleString()}
              subtitle="Pending quotations"
              icon={Hourglass}
              tone="amber"
              to="/sourcing/rfq?preset=open"
            />
            <RfqListKpiCard
              label="Draft / Open"
              value={(kpisQuery.data?.draftOpen ?? 0).toLocaleString()}
              subtitle="Not sent or still active"
              icon={FileText}
              tone="gray"
            />
            <RfqListKpiCard
              label="POs Created"
              value={(kpisQuery.data?.poCreated ?? 0).toLocaleString()}
              subtitle="PO created or awarded"
              icon={ShoppingCart}
              tone="teal"
            />
            <RfqListKpiCard
              label="Closed RFQs"
              value={(kpisQuery.data?.closed ?? 0).toLocaleString()}
              subtitle="Closed or cancelled"
              icon={CheckCircle2}
              tone="gray"
            />
          </DashboardKpiGrid>
        )}
      </div>

      {/* Sticky filter panel */}
      <div className="rfq-filter-panel sticky top-[52px] z-10 px-3 py-2.5 backdrop-blur">
        {preset === "open" && !filtersState.status ? (
          <div className="mb-1.5 flex items-center gap-2 text-[12px]">
            <span className="font-medium text-[var(--ds-text-faint)]">Preset</span>
            <span className="font-medium text-[var(--ds-text)]">Open RFQs</span>
            <span className="inline-flex items-center gap-1 font-medium text-[var(--ds-success)]">
              <Check className="h-3 w-3" />
              Active
            </span>
            <button
              type="button"
              onClick={() => navigate("/sourcing/rfq", { replace: true })}
              className="ml-0.5 rounded p-0.5 text-[var(--ds-text-faint)] transition hover:bg-[var(--ds-gray-soft)] hover:text-[var(--ds-text)]"
              aria-label="Clear open preset"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : null}

        <FilterBar className="rfq-filter-grid !static !mb-0 !border-0 !bg-transparent !p-0 !shadow-none !flex-row !flex-wrap !items-end gap-2">
          <FilterField
            label="Search RFQ"
            className="min-w-[200px] flex-1 basis-[200px] sm:min-w-[240px]"
          >
            <SearchInput
              value={filtersState.search}
              onChange={(v) => patchFilters({ search: v })}
              placeholder="RFQ, Material Request, Supplier…"
            />
          </FilterField>

          <FilterField label="Status" className="w-[148px] shrink-0">
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

          <FilterField label="Owner" className="w-[160px] shrink-0">
            <select
              value={filtersState.owner}
              onChange={(e) => patchFilters({ owner: e.target.value })}
              className="select-field"
            >
              <option value="">All owners</option>
              {ownerOptions.map((o) => (
                <option key={o} value={o}>
                  {formatRfqOwnerLabel(o)}
                </option>
              ))}
            </select>
          </FilterField>

          <FilterField label="Date Range" className="w-[148px] shrink-0">
            <select
              value={filtersState.datePreset}
              onChange={(e) =>
                patchFilters({
                  datePreset: e.target
                    .value as RfqListFilterState["datePreset"],
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
              <FilterField label="From" className="w-[148px] shrink-0">
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
              <FilterField label="To" className="w-[148px] shrink-0">
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
              disabled={!filtersActive}
              className="rfq-filter-reset inline-flex items-center gap-1.5 rounded-[10px] border border-neutral-200 bg-white px-3 text-[13px] font-semibold text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset Filters
            </button>
          </div>
        </FilterBar>

        {chips.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {chips.map((chip) => (
              <button
                key={`${chip.key}-${chip.value}`}
                type="button"
                onClick={() => removeChip(chip.key)}
                className="inline-flex items-center gap-1 rounded-md bg-neutral-50 px-2 py-0.5 text-[11px] font-medium text-neutral-700 ring-1 ring-inset ring-neutral-200 transition hover:bg-neutral-100"
              >
                <span>
                  {chip.label}:{" "}
                  {chip.key === "owner"
                    ? formatRfqOwnerLabel(chip.value)
                    : chip.value}
                </span>
                <X className="h-3 w-3 opacity-70" aria-hidden />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Compact meta row — count lives in pagination footer only */}
      <div className="rfq-table-block flex flex-col gap-1.5">
      <div className="flex min-h-[20px] flex-wrap items-center justify-end gap-3">
        {lastUpdatedLabel ? (
          <p className="text-[12px] font-medium text-[var(--ds-text-faint)]">
            Last Updated:{" "}
            <span className="rfq-mono text-[var(--ds-text-soft)]">
              {lastUpdatedLabel}
            </span>
          </p>
        ) : null}

        {selected.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-primary-100 bg-primary-50/60 px-3 py-1.5">
            <span className="text-xs font-semibold text-primary-800">
              {selected.size} selected
            </span>
            <ExportButton
              module="RFQ"
              filenamePrefix="RFQ_Selected"
              columns={exportColumns}
              rows={selectedRows}
            />
            <button
              type="button"
              className="btn-secondary"
              onClick={() => bulkToast("Reminder")}
            >
              Send Reminder
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => bulkToast("Archive")}
            >
              Archive
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => bulkToast("Close")}
            >
              Close RFQ
            </button>
            {canManage ? (
              <button
                type="button"
                className="btn-danger"
                onClick={() => {
                  if (
                    !window.confirm(
                      `Delete ${selected.size} selected RFQ(s)? This cannot be undone.`,
                    )
                  ) {
                    return;
                  }
                  for (const name of selected) {
                    deleteMutation.mutate(name);
                  }
                  setSelected(new Set());
                }}
              >
                <Trash2 />
                Delete
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Table */}
      <div className="rfq-table-shell overflow-hidden">
        {rfqsQuery.isError ? (
          <ConnectionError
            title="Could not load RFQs"
            error={rfqsQuery.error}
            onRetry={() => void rfqsQuery.refetch()}
          />
        ) : rfqsQuery.isLoading ? (
          <div className="p-2">
            <TableSkeleton rows={8} columns={showOwnerColumn ? 8 : 7} />
          </div>
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
              ) : canManage ? (
                <Link to="/sourcing/rfq/new" className="btn-primary">
                  <Plus className="h-4 w-4" />
                  Create RFQ
                </Link>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* Mobile cards */}
            <div className="space-y-2 p-3 md:hidden">
              {sortedRows.map((rfq, idx) => (
                <div
                  key={rfq.name}
                  className="rounded-lg border border-neutral-200 bg-white px-3 py-3"
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={selected.has(rfq.name)}
                      onChange={() => toggleSelect(rfq.name)}
                      className="mt-1"
                      aria-label={`Select ${rfq.name}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] tabular-nums text-neutral-400">
                          #{serialBase + idx + 1}
                        </span>
                        <Link
                          to={`/sourcing/rfq/${encodeURIComponent(rfq.name)}`}
                          className="rfq-number-link rfq-mono text-[13px] font-medium"
                        >
                          {rfq.name}
                        </Link>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <RfqListStatusBadge status={rfq.display_status} />
                        <span className="text-[13px] text-neutral-500">
                          {rfq.quote_count} quotes
                          {showOwnerColumn
                            ? ` · ${formatRfqOwnerLabel(rfq.owner)}`
                            : ""}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden max-h-[min(70vh,720px)] overflow-auto md:block">
              <table
                className={`rfq-table w-full min-w-[840px] border-separate border-spacing-0 ${
                  selected.size > 0 ? "rfq-has-selection" : ""
                }`}
              >
                <thead className="sticky top-0 z-20">
                  <tr className="text-left uppercase">
                    <th className="sticky top-0 z-20 w-8 px-2 py-2">
                      <input
                        type="checkbox"
                        checked={allPageSelected}
                        onChange={toggleSelectAll}
                        aria-label="Select all on page"
                        className="rfq-row-check h-3.5 w-3.5"
                      />
                    </th>
                    <th className="sticky top-0 z-20 w-10 px-2 py-2 text-center">
                      #
                    </th>
                    <SortableTableHeader
                      label="RFQ Number"
                      sortKey="name"
                      sort={sort}
                      onSort={setSort}
                      className="sticky top-0 z-20 px-3 py-2"
                    />
                    <SortableTableHeader
                      label="Last Modified"
                      sortKey="modified"
                      sort={sort}
                      onSort={setSort}
                      className="sticky top-0 z-20 px-3 py-2"
                    />
                    {showOwnerColumn ? (
                      <SortableTableHeader
                        label="Owner"
                        sortKey="owner"
                        sort={sort}
                        onSort={setSort}
                        className="sticky top-0 z-20 px-3 py-2"
                      />
                    ) : null}
                    <SortableTableHeader
                      label="Quotes"
                      sortKey="quotes"
                      sort={sort}
                      onSort={setSort}
                      className="sticky top-0 z-20 w-20 px-3 py-2 text-right [&>button]:ml-auto"
                    />
                    <SortableTableHeader
                      label="Status"
                      sortKey="status"
                      sort={sort}
                      onSort={setSort}
                      className="sticky top-0 z-20 px-3 py-2"
                    />
                    <th className="sticky top-0 z-20 col-actions px-3 py-2 text-center">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((rfq, idx) => {
                    const detailPath = `/sourcing/rfq/${encodeURIComponent(rfq.name)}`;
                    return (
                      <tr
                        key={rfq.name}
                        className="group border-b border-neutral-100 bg-white"
                      >
                        <td className="w-8 px-2 py-0 align-middle">
                          <input
                            type="checkbox"
                            checked={selected.has(rfq.name)}
                            onChange={() => toggleSelect(rfq.name)}
                            aria-label={`Select ${rfq.name}`}
                            className="rfq-row-check h-3.5 w-3.5"
                          />
                        </td>
                        <td className="rfq-mono w-10 px-2 py-0 text-center align-middle text-[12px] font-normal text-[var(--ds-text-faint)]">
                          {serialBase + idx + 1}
                        </td>
                        <td className="px-3 py-0 align-middle">
                          <Link
                            to={detailPath}
                            className="rfq-number-link rfq-mono text-[13px] font-medium"
                          >
                            {rfq.name}
                          </Link>
                        </td>
                        <td className="rfq-mono whitespace-nowrap px-3 py-0 align-middle text-[13px] font-normal text-[var(--ds-text-soft)]">
                          {rfq.modified
                            ? formatDate(rfq.modified, "d MMM yyyy")
                            : "—"}
                        </td>
                        {showOwnerColumn ? (
                          <td className="px-3 py-0 align-middle text-[13px] font-normal text-[var(--ds-text-soft)]">
                            {formatRfqOwnerLabel(rfq.owner)}
                          </td>
                        ) : null}
                        <td className="w-20 px-3 py-0 text-right align-middle">
                          <span
                            className={`rfq-mono inline-block text-[13px] ${
                              rfq.quote_count > 0
                                ? "font-semibold text-[var(--ds-text)]"
                                : "font-medium text-[var(--ds-text-faint)]"
                            }`}
                          >
                            {rfq.quote_count}
                          </span>
                        </td>
                        <td className="px-3 py-0 align-middle">
                          <RfqListStatusBadge status={rfq.display_status} />
                        </td>
                        <td className="col-actions px-3 py-0 align-middle">
                          <TableRowActions
                            label={rfq.name}
                            viewTo={detailPath}
                            items={[
                              ...(canManage
                                ? [
                                    {
                                      id: "edit",
                                      label: "Edit",
                                      icon: Pencil,
                                      onClick: () => navigate(detailPath),
                                    },
                                  ]
                                : []),
                              {
                                id: "duplicate",
                                label: "Duplicate",
                                icon: Copy,
                                onClick: () =>
                                  navigate(
                                    `/sourcing/rfq/new?duplicate=${encodeURIComponent(rfq.name)}`,
                                  ),
                              },
                              {
                                id: "invite",
                                label: "Invite Suppliers",
                                icon: UserPlus,
                                onClick: () => navigate(detailPath),
                              },
                              ...(rfq.quote_count > 1
                                ? [
                                    {
                                      id: "compare",
                                      label: "Compare",
                                      icon: Scale,
                                      onClick: () =>
                                        navigate(`${detailPath}?compare=1`),
                                    },
                                  ]
                                : []),
                              {
                                id: "pdf",
                                label: "Export PDF",
                                icon: FileText,
                                onClick: () =>
                                  toast("Open the RFQ to export PDF", {
                                    icon: "ℹ️",
                                  }),
                              },
                              {
                                id: "excel",
                                label: "Download Excel",
                                icon: Download,
                                onClick: () =>
                                  toast("Use Export on the toolbar for Excel", {
                                    icon: "ℹ️",
                                  }),
                              },
                              {
                                id: "copy",
                                label: "Copy Link",
                                icon: Link2,
                                onClick: () => void copyDocLink(detailPath),
                              },
                              {
                                id: "archive",
                                label: "Archive",
                                icon: Archive,
                                separatorBefore: true,
                                onClick: () =>
                                  toast.success(`Archive queued for ${rfq.name}`),
                              },
                              ...(canManage
                                ? [
                                    {
                                      id: "delete",
                                      label: "Delete",
                                      icon: Trash2,
                                      danger: true,
                                      onClick: () => {
                                        if (
                                          window.confirm(
                                            `Delete ${rfq.name}? This cannot be undone.`,
                                          )
                                        ) {
                                          deleteMutation.mutate(rfq.name);
                                        }
                                      },
                                    },
                                  ]
                                : []),
                            ]}
                          />
                        </td>
                      </tr>
                    );
                  })}
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
              recordLabel="RFQs"
            />
          </>
        )}
      </div>
      </div>
    </div>
  );
}
