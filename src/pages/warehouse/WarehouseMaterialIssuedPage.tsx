import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle, Eye, Search } from "lucide-react";
import {
  getIssuedMaterials,
  type MaterialIssueStatus,
} from "../../services/warehouseService";
import EmptyState from "../../components/EmptyState";
import ErrorState from "../../components/ErrorState";
import { TableSkeleton } from "../../components/Skeleton";
import { formatDate } from "../../utils/format";

const PAGE_SIZE = 10;

const STATUS_OPTIONS: Array<"" | MaterialIssueStatus> = [
  "",
  "Fully Issued",
  "Partially Issued",
  "Cancelled",
];

function StatusPill({ status }: { status: MaterialIssueStatus }) {
  const cls =
    status === "Fully Issued"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : status === "Partially Issued"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : "bg-red-50 text-red-700 border-red-200";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}
    >
      {status}
    </span>
  );
}

export default function WarehouseMaterialIssuedPage() {
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [mrFilter, setMrFilter] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | MaterialIssueStatus>("");
  const [issuedByFilter, setIssuedByFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const issuedQuery = useQuery({
    queryKey: ["warehouse", "issued", "logs"],
    queryFn: () => getIssuedMaterials({ includeCancelled: true }),
    retry: false,
  });

  const rows = useMemo(() => issuedQuery.data ?? [], [issuedQuery.data]);

  const mrOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.mr_name).filter(Boolean))).sort(
        (a, b) => a.localeCompare(b),
      ),
    [rows],
  );
  const deptOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.department).filter(Boolean))).sort(
        (a, b) => a.localeCompare(b),
      ),
    [rows],
  );
  const warehouseOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.warehouse).filter(Boolean))).sort(
        (a, b) => a.localeCompare(b),
      ),
    [rows],
  );
  const issuedByOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.issued_by).filter(Boolean))).sort(
        (a, b) => a.localeCompare(b),
      ),
    [rows],
  );

  const filteredData = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((item) => {
      if (mrFilter && item.mr_name !== mrFilter) return false;
      if (deptFilter && item.department !== deptFilter) return false;
      if (warehouseFilter && item.warehouse !== warehouseFilter) return false;
      if (statusFilter && item.status !== statusFilter) return false;
      if (issuedByFilter && item.issued_by !== issuedByFilter) return false;
      if (dateFrom && item.issue_date && item.issue_date < dateFrom) return false;
      if (dateTo && item.issue_date && item.issue_date > dateTo) return false;
      if (q) {
        const haystack = `${item.name} ${item.mr_name} ${item.department} ${item.issued_by} ${item.warehouse}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [
    rows,
    search,
    mrFilter,
    deptFilter,
    warehouseFilter,
    statusFilter,
    issuedByFilter,
    dateFrom,
    dateTo,
  ]);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    search,
    mrFilter,
    deptFilter,
    warehouseFilter,
    statusFilter,
    issuedByFilter,
    dateFrom,
    dateTo,
  ]);

  const totalItems = filteredData.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const paginatedData = useMemo(
    () => filteredData.slice(startIndex, startIndex + PAGE_SIZE),
    [filteredData, startIndex],
  );

  const filtersActive =
    !!search ||
    !!mrFilter ||
    !!deptFilter ||
    !!warehouseFilter ||
    !!statusFilter ||
    !!issuedByFilter ||
    !!dateFrom ||
    !!dateTo;

  function clearFilters() {
    setSearch("");
    setMrFilter("");
    setDeptFilter("");
    setWarehouseFilter("");
    setStatusFilter("");
    setIssuedByFilter("");
    setDateFrom("");
    setDateTo("");
  }

  if (issuedQuery.isError) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-slate-100 bg-white p-8 shadow-sm">
          <ErrorState
            title="Unable to load Warehouse data."
            description="We couldn't retrieve the issued materials log. Please try again."
            onRetry={() => void issuedQuery.refetch()}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 duration-300 animate-in fade-in sm:px-6 lg:px-8">
      {/* Filters */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by issue number, MR, department, warehouse, or issued by…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-200 py-2 pl-10 pr-4 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <FilterSelect
            label="Material Request"
            value={mrFilter}
            onChange={setMrFilter}
            options={mrOptions}
            allLabel="All MRs"
          />
          <FilterSelect
            label="Department"
            value={deptFilter}
            onChange={setDeptFilter}
            options={deptOptions}
            allLabel="All departments"
          />
          <FilterSelect
            label="Warehouse"
            value={warehouseFilter}
            onChange={setWarehouseFilter}
            options={warehouseOptions}
            allLabel="All warehouses"
          />
          <FilterSelect
            label="Issued By"
            value={issuedByFilter}
            onChange={setIssuedByFilter}
            options={issuedByOptions}
            allLabel="All users"
          />
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-500">Status</label>
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as "" | MaterialIssueStatus)
              }
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt || "All statuses"}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-500">
              Date Range
            </label>
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-2 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
              <span className="text-xs text-slate-400">–</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-2 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
          </div>
        </div>
        {filtersActive && (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs font-semibold text-primary-600 hover:underline"
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="flex min-h-[400px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {issuedQuery.isLoading ? (
          <div className="p-6">
            <TableSkeleton rows={6} columns={7} />
          </div>
        ) : filteredData.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-12">
            <EmptyState
              icon={CheckCircle}
              title="No Issued Materials"
              description={
                filtersActive
                  ? "Adjust your search or filters to see logs."
                  : "No materials have been issued from the warehouse yet."
              }
            />
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <th className="px-6 py-4">Issue Number</th>
                    <th className="px-6 py-4">Material Request</th>
                    <th className="px-6 py-4">Department</th>
                    <th className="px-6 py-4">Issued By</th>
                    <th className="px-6 py-4">Issue Date</th>
                    <th className="px-6 py-4 text-center">Status</th>
                    <th className="w-20 px-6 py-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {paginatedData.map((row) => (
                    <tr key={row.name} className="transition-colors hover:bg-slate-50/75">
                      <td className="px-6 py-4">
                        <button
                          type="button"
                          onClick={() =>
                            navigate(
                              `/warehouse/material-requests/issued/${encodeURIComponent(row.name)}`,
                            )
                          }
                          className="font-semibold text-primary-700 hover:underline"
                        >
                          {row.name}
                        </button>
                      </td>
                      <td className="px-6 py-4">
                        {row.mr_name ? (
                          <button
                            type="button"
                            onClick={() =>
                              navigate(
                                `/material-requests/${encodeURIComponent(row.mr_name)}`,
                              )
                            }
                            className="font-medium text-primary-700 hover:underline"
                          >
                            {row.mr_name}
                          </button>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-slate-600">
                        {row.department || <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-6 py-4 text-slate-600">{row.issued_by}</td>
                      <td className="px-6 py-4 tabular-nums text-slate-600">
                        {row.issue_date ? formatDate(row.issue_date, "dd MMM yyyy") : "—"}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <StatusPill status={row.status} />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center">
                          <button
                            type="button"
                            title="View issue details"
                            onClick={() =>
                              navigate(
                                `/warehouse/material-requests/issued/${encodeURIComponent(row.name)}`,
                              )
                            }
                            className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white p-1.5 text-slate-500 hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-4">
                <span className="text-xs text-slate-500">
                  Showing{" "}
                  <span className="font-semibold text-slate-800">
                    {startIndex + 1}
                  </span>{" "}
                  to{" "}
                  <span className="font-semibold text-slate-800">
                    {Math.min(startIndex + PAGE_SIZE, totalItems)}
                  </span>{" "}
                  of{" "}
                  <span className="font-semibold text-slate-800">{totalItems}</span>{" "}
                  logs
                </span>
                <div className="flex gap-2">
                  <button
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage((p) => p - 1)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage((p) => p + 1)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  allLabel: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-slate-500">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
      >
        <option value="">{allLabel}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  );
}
