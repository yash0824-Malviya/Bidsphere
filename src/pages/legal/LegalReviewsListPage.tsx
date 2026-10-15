import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  RefreshCw,
  Scale,
} from "lucide-react";

import {
  APPROVAL_WORKFLOW_QUERY_KEY,
  computeApprovalWorkflowCounters,
  filterByWorkflowStage,
  getApprovalWorkflowRecords,
  type ApprovalWorkflowRecord,
  type ApprovalWorkflowStage,
} from "../../api/approvalWorkflow";
import ConnectionError from "../../components/ConnectionError";
import PaginationBar from "../../components/PaginationBar";
import { TableSkeleton } from "../../components/Skeleton";
import {
  FilterBar,
  FilterField,
  SearchInput,
  SortableTableHeader,
} from "../../components/ui";
import { useDebounce } from "../../hooks/useDebounce";
import { usePagination } from "../../hooks/usePagination";
import { formatDate } from "../../utils/format";
import {
  sortNewestFirst,
  sortRows,
  type SortDirection,
  type SortState,
} from "../../utils/listSort";

type StatusTab = "Pending" | "Approved" | "Rejected";

const STAGE_FOR_TAB: Record<StatusTab, ApprovalWorkflowStage[]> = {
  Pending: ["Legal Review"],
  Approved: ["Completed", "Procurement"],
  Rejected: ["Rejected"],
};

const DEFAULT_SORT: SortState = { key: "submissionDate", direction: "desc" };

const COMPARATORS: Record<
  string,
  (a: ApprovalWorkflowRecord, b: ApprovalWorkflowRecord, d: SortDirection) => number
> = {
  supplier: (a, b, d) => cmpStr(a.supplier, b.supplier, d),
  rfq: (a, b, d) => cmpStr(a.rfqNumber, b.rfqNumber, d),
  submissionDate: (a, b, d) => cmpDate(a.createdDate, b.createdDate, d),
  company: (a, b, d) => cmpStr(a.company ?? "", b.company ?? "", d),
};

function cmpStr(a: string, b: string, direction: SortDirection): number {
  const result = a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: "base",
  });
  return direction === "desc" ? -result : result;
}

function cmpDate(
  a: string | undefined,
  b: string | undefined,
  direction: SortDirection,
): number {
  const ta = a ? Date.parse(a.length === 10 ? `${a}T00:00:00` : a) : 0;
  const tb = b ? Date.parse(b.length === 10 ? `${b}T00:00:00` : b) : 0;
  const safeA = Number.isNaN(ta) ? 0 : ta;
  const safeB = Number.isNaN(tb) ? 0 : tb;
  return direction === "desc" ? safeB - safeA : safeA - safeB;
}

function uniqueSorted(values: Array<string | undefined | null>): string[] {
  return Array.from(
    new Set(values.map((v) => (v ?? "").trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function matchesSearch(doc: ApprovalWorkflowRecord, q: string): boolean {
  if (!q) return true;
  const hay = [
    doc.rfqNumber,
    doc.sqName,
    doc.supplier,
    doc.company,
    doc.currentOwner,
    doc.procurementManager,
    doc.workflowStage,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

/**
 * Legal Reviews list — filters the shared approval workflow dataset.
 * Pending = Legal Review stage; Approved = Completed/Procurement; Rejected = Rejected.
 * UI-only enhancements: filters, sort, pagination, empty/loading states.
 */
export default function LegalReviewsListPage() {
  const navigate = useNavigate();
  const [statusTab, setStatusTab] = useState<StatusTab>("Pending");
  const tabAutoResolved = useRef(false);

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 250);
  const [supplierFilter, setSupplierFilter] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [managerFilter, setManagerFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);

  const workflowQuery = useQuery({
    queryKey: [APPROVAL_WORKFLOW_QUERY_KEY],
    queryFn: getApprovalWorkflowRecords,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const records = workflowQuery.data ?? [];
  const counters = useMemo(
    () => computeApprovalWorkflowCounters(records),
    [records],
  );

  const counts = {
    Pending: counters.pendingLegal,
    Approved: counters.approved,
    Rejected: counters.rejected,
  };

  // Default tab = Pending always as the primary actionable queue
  useEffect(() => {
    if (!workflowQuery.isSuccess || tabAutoResolved.current) return;
    tabAutoResolved.current = true;
  }, [workflowQuery.isSuccess]);

  const tabRows = useMemo(() => {
    const stages = STAGE_FOR_TAB[statusTab];
    const rows = stages.flatMap((stage) => filterByWorkflowStage(records, stage));
    // For Legal Manager actionable queue, ensure records are targeted to Legal Review
    if (statusTab === "Pending") {
      return rows.filter((r) => {
        const stageMatch = r.workflowStage === "Legal Review";
        const owner = (r.currentOwner ?? "").toLowerCase();
        const roleMatch = owner.includes("legal") || owner.includes("legal manager") || owner === "legal@netlink.com";
        return stageMatch && (roleMatch || !owner);
      });
    }
    return rows;
  }, [records, statusTab]);

  const filterOptions = useMemo(() => {
    return {
      suppliers: uniqueSorted(tabRows.map((r) => r.supplier)),
      companies: uniqueSorted(tabRows.map((r) => r.company)),
      managers: uniqueSorted(tabRows.map((r) => r.procurementManager)),
      stages: uniqueSorted(tabRows.map((r) => r.workflowStage)),
    };
  }, [tabRows]);

  const filteredRows = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return tabRows.filter((doc) => {
      if (!matchesSearch(doc, q)) return false;
      if (supplierFilter && doc.supplier !== supplierFilter) return false;
      if (companyFilter && (doc.company ?? "") !== companyFilter) return false;
      if (
        managerFilter &&
        (doc.procurementManager ?? "") !== managerFilter
      ) {
        return false;
      }
      if (stageFilter && doc.workflowStage !== stageFilter) return false;
      if (dateFilter) {
        const created = (doc.createdDate ?? "").slice(0, 10);
        if (created !== dateFilter) return false;
      }
      return true;
    });
  }, [
    tabRows,
    debouncedSearch,
    supplierFilter,
    companyFilter,
    managerFilter,
    stageFilter,
    dateFilter,
  ]);

  const sortedRows = useMemo(() => {
    const normalized = sortNewestFirst(filteredRows, {
      date: (r) => r.createdDate ?? r.updatedDate,
      name: (r) => r.rfqNumber || r.id,
    });
    return sortRows(normalized, sort, COMPARATORS);
  }, [filteredRows, sort]);

  const filterResetKey = useMemo(
    () =>
      JSON.stringify({
        statusTab,
        debouncedSearch,
        supplierFilter,
        companyFilter,
        managerFilter,
        dateFilter,
        stageFilter,
        sort,
      }),
    [
      statusTab,
      debouncedSearch,
      supplierFilter,
      companyFilter,
      managerFilter,
      dateFilter,
      stageFilter,
      sort,
    ],
  );

  const { page, pageSize, setPage, setPageSize } = usePagination({
    resetKey: filterResetKey,
  });

  const totalRecords = sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize) || 1);
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, safePage, pageSize]);

  const isLoading = workflowQuery.isLoading;
  const isError = workflowQuery.isError;
  const isEmpty = !isLoading && !isError && filteredRows.length === 0;

  function handleTabChange(next: StatusTab) {
    setStatusTab(next);
    setSupplierFilter("");
    setCompanyFilter("");
    setManagerFilter("");
    setDateFilter("");
    setStageFilter("");
    setSearch("");
  }

  function clearFilters() {
    setSearch("");
    setSupplierFilter("");
    setCompanyFilter("");
    setManagerFilter("");
    setDateFilter("");
    setStageFilter("");
  }

  const hasActiveFilters =
    !!search ||
    !!supplierFilter ||
    !!companyFilter ||
    !!managerFilter ||
    !!dateFilter ||
    !!stageFilter;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
      {/* Page Heading */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-700 ring-1 ring-blue-200">
              <Scale className="h-5 w-5" />
            </span>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              RFQ Legal Review
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Review RFQs that have reached the Legal Review stage before commercial progression.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void workflowQuery.refetch()}
          disabled={workflowQuery.isFetching}
          className="inline-flex items-center gap-1.5 self-start rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50 disabled:opacity-50 sm:self-auto"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${workflowQuery.isFetching ? "animate-spin" : ""}`}
          />
          Refresh
        </button>
      </div>

      {/* Tabs — always visible */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          className="inline-flex gap-1 rounded-xl border border-slate-200 bg-slate-50/80 p-1"
          role="tablist"
          aria-label="Legal review status"
        >
          {(["Pending", "Approved", "Rejected"] as StatusTab[]).map((tab) => {
            const active = statusTab === tab;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => handleTabChange(tab)}
                className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${
                  active
                    ? "bg-white text-blue-700 shadow-xs ring-1 ring-slate-200"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {tab}
                <span
                  className={`ml-1.5 tabular-nums ${
                    active ? "text-blue-600 font-bold" : "text-slate-400"
                  }`}
                >
                  ({isLoading ? "…" : counts[tab]})
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Filters — always visible; search scoped to selected tab */}
      <FilterBar className="!mb-0">
        <FilterField label="Search" className="sm:min-w-[220px] sm:flex-1">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search in this tab…"
          />
        </FilterField>
        <FilterField label="Supplier">
          <select
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
            className="select-field"
          >
            <option value="">All suppliers</option>
            {filterOptions.suppliers.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Company">
          <select
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            className="select-field"
          >
            <option value="">All companies</option>
            {filterOptions.companies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Procurement Manager">
          <select
            value={managerFilter}
            onChange={(e) => setManagerFilter(e.target.value)}
            className="select-field"
          >
            <option value="">All managers</option>
            {filterOptions.managers.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Date">
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="input-field"
          />
        </FilterField>
        <FilterField label="Status">
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="select-field"
          >
            <option value="">All stages</option>
            {filterOptions.stages.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
        </FilterField>
        {hasActiveFilters && (
          <div className="flex items-end">
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-2xs hover:bg-slate-50"
            >
              Clear
            </button>
          </div>
        )}
      </FilterBar>

      {/* Data surface — never a blank page */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
        {isError ? (
          <div className="px-4 py-8">
            <ConnectionError
              error={workflowQuery.error}
              onRetry={() => void workflowQuery.refetch()}
              compact
            />
          </div>
        ) : isLoading ? (
          <TableSkeleton rows={8} columns={9} />
        ) : isEmpty ? (
          <div className="flex justify-center px-4 py-10 sm:py-14">
            <EmptyReviewsCard
              tab={statusTab}
              filtered={hasActiveFilters}
              onRefresh={() => void workflowQuery.refetch()}
              onClearFilters={hasActiveFilters ? clearFilters : undefined}
              refreshing={workflowQuery.isFetching}
            />
          </div>
        ) : (
          <>
            <div className="w-full max-w-full overflow-hidden">
              <table className="w-full table-fixed border-collapse text-left text-sm">
                <colgroup>
                  <col className="w-[18%]" />
                  <col className="w-[14%]" />
                  <col className="w-[14%]" />
                  <col className="w-[12%]" />
                  <col className="w-[12%]" />
                  <col className="w-[12%]" />
                  <col className="w-[10%]" />
                  <col className="w-[8%]" />
                </colgroup>
                <thead className="border-b border-slate-100 bg-slate-50/75 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <tr>
                    <SortableTableHeader
                      label="Supplier"
                      sortKey="supplier"
                      sort={sort}
                      onSort={setSort}
                    />
                    <th className="px-3 py-3">Supplier Quotation</th>
                    <SortableTableHeader
                      label="RFQ"
                      sortKey="rfq"
                      sort={sort}
                      onSort={setSort}
                    />
                    <SortableTableHeader
                      label="Submission Date"
                      sortKey="submissionDate"
                      sort={sort}
                      onSort={setSort}
                    />
                    <th className="px-3 py-3">Status</th>
                    <SortableTableHeader
                      label="Company"
                      sortKey="company"
                      sort={sort}
                      onSort={setSort}
                    />
                    <th className="px-3 py-3">Procurement Manager</th>
                    <th className="px-3 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageRows.map((doc) => (
                    <WorkflowRow
                      key={doc.id}
                      doc={doc}
                      onOpen={() =>
                        navigate(
                          `/legal/review/${encodeURIComponent(doc.sqName)}`,
                        )
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <PaginationBar
              currentPage={safePage}
              totalPages={totalPages}
              totalRecords={totalRecords}
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

function EmptyReviewsCard({
  tab,
  filtered,
  onRefresh,
  onClearFilters,
  refreshing,
}: {
  tab: StatusTab;
  filtered: boolean;
  onRefresh: () => void;
  onClearFilters?: () => void;
  refreshing: boolean;
}) {
  const title = filtered
    ? "No matching reviews"
    : `No ${tab.toLowerCase()} reviews`;
  const description = filtered
    ? "No legal reviews match your current search or filters in this tab."
    : tab === "Pending"
      ? "When suppliers submit legal documents with their quotations, they appear here for review."
      : `There are no ${tab.toLowerCase()} legal reviews to show right now.`;

  return (
    <div className="w-full max-w-md rounded-2xl border border-neutral-100 bg-neutral-50/80 px-6 py-8 text-center shadow-sm">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-50 text-primary-600 ring-1 ring-inset ring-primary-100">
        <Scale className="h-8 w-8" strokeWidth={1.5} />
      </div>
      <h3 className="text-base font-semibold text-neutral-900">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-neutral-500">
        {description}
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {onClearFilters && (
          <button
            type="button"
            onClick={onClearFilters}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3.5 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
          >
            Clear filters
          </button>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-primary-700 disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
          />
          Refresh
        </button>
      </div>
    </div>
  );
}

function WorkflowRow({
  doc,
  onOpen,
}: {
  doc: ApprovalWorkflowRecord;
  onOpen: () => void;
}) {
  const isPending = doc.workflowStage === "Legal Review";
  const isRejected = doc.workflowStage === "Rejected";
  const legalStatus = isPending ? "Pending Legal Review" : isRejected ? "Rejected" : "Approved";

  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer transition-colors hover:bg-slate-50/80"
    >
      <td className="truncate px-3 py-3 font-semibold text-slate-900 text-xs" title={doc.supplier || "—"}>
        {doc.supplier || "—"}
      </td>
      <td className="truncate px-3 py-3 font-mono text-xs text-slate-600" title={doc.sqName || "—"}>
        {doc.sqName || "—"}
      </td>
      <td className="truncate px-3 py-3 font-semibold text-slate-900 font-mono text-xs" title={doc.rfqNumber}>
        {doc.rfqNumber}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-slate-600 text-xs">
        {doc.createdDate ? formatDate(doc.createdDate) : "—"}
      </td>
      <td className="px-3 py-3">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
            legalStatus === "Approved"
              ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
              : legalStatus === "Rejected"
                ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
                : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
          }`}
        >
          {legalStatus}
        </span>
      </td>
      <td className="truncate px-3 py-3 text-slate-600 text-xs" title={doc.company || "Bidsphere"}>
        {doc.company || "Bidsphere"}
      </td>
      <td className="truncate px-3 py-3 text-slate-700 text-xs" title={doc.procurementManager || doc.currentOwner || "Procurement Manager"}>
        {doc.procurementManager || doc.currentOwner || "Procurement Manager"}
      </td>
      <td className="px-3 py-3 text-right">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
        >
          Review
          <ArrowRight className="h-3 w-3" />
        </button>
      </td>
    </tr>
  );
}
