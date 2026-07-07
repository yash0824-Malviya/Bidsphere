import { useLayoutEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Eye, Inbox, Search } from "lucide-react";

import { listApprovedIndirectRequests } from "../../api/adminApprovals";
import StatusBadge from "../../components/StatusBadge";
import ProcurementTypeBadge from "../../components/ProcurementTypeBadge";
import { Skeleton } from "../../components/Skeleton";
import { useOptionalLayout } from "../../contexts/LayoutContext";
import { formatDate } from "../../utils/format";

export default function ApprovedRequestsPage() {
  const layout = useOptionalLayout();
  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("all");
  const [status, setStatus] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const { data = [], isLoading } = useQuery({
    queryKey: ["admin-approved-requests"],
    queryFn: listApprovedIndirectRequests,
    refetchInterval: 60_000,
  });

  const departments = useMemo(
    () =>
      Array.from(new Set(data.map((r) => r.department).filter(Boolean))).sort(),
    [data],
  );
  const statuses = useMemo(
    () => Array.from(new Set(data.map((r) => r.status).filter(Boolean))).sort(),
    [data],
  );

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return data.filter((r) => {
      if (term) {
        const haystack =
          `${r.name} ${r.department} ${r.requestedBy} ${r.approvedBy ?? ""}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (department !== "all" && r.department !== department) return false;
      if (status !== "all" && r.status !== status) return false;
      const day = (r.approvalDate ?? "").slice(0, 10);
      if (fromDate && day && day < fromDate) return false;
      if (toDate && day && day > toDate) return false;
      return true;
    });
  }, [data, search, department, status, fromDate, toDate]);

  const hasFilters =
    search.trim() !== "" ||
    department !== "all" ||
    status !== "all" ||
    fromDate !== "" ||
    toDate !== "";

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-sm">
          <CheckCircle2 className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-base font-bold text-neutral-900">
            Approved Requests
          </h1>
          <p className="text-xs text-neutral-500">
            Indirect Material Requests that passed the admin approval gate.
          </p>
        </div>
        {data.length > 0 && (
          <span className="ml-auto flex h-7 min-w-7 items-center justify-center rounded-full bg-emerald-50 px-2.5 text-sm font-bold text-emerald-700">
            {data.length}
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search request, department, approver…"
            className="input-field pl-9"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="select-field"
          aria-label="Filter by status"
        >
          <option value="all">All Statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          className="select-field"
          aria-label="Filter by department"
        >
          <option value="all">All Departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="input-field"
          aria-label="Approved from date"
        />
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="input-field"
          aria-label="Approved to date"
        />
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState filtered={hasFilters && data.length > 0} />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-4 py-3">Request No.</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Requested By</th>
                  <th className="px-4 py-3">Approved By</th>
                  <th className="px-4 py-3">Approval Date</th>
                  <th className="px-4 py-3">Procurement Type</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {rows.map((row) => (
                  <tr key={row.name} className="hover:bg-neutral-50">
                    <td className="px-4 py-3">
                      <Link
                        to={`/material-requests/${encodeURIComponent(row.name)}`}
                        className="font-semibold text-primary-600 no-underline"
                      >
                        {row.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{row.department || "—"}</td>
                    <td className="px-4 py-3">{row.requestedBy || "—"}</td>
                    <td className="px-4 py-3">{row.approvedBy || "—"}</td>
                    <td className="px-4 py-3 tabular-nums text-neutral-600">
                      {formatDate(row.approvalDate)}
                    </td>
                    <td className="px-4 py-3">
                      <ProcurementTypeBadge type={row.procurementType} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end">
                        <Link
                          to={`/material-requests/${encodeURIComponent(row.name)}`}
                          className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-neutral-600 no-underline hover:bg-neutral-50"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          View Details
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100">
        <Inbox className="h-6 w-6 text-neutral-400" />
      </div>
      <p className="text-sm font-semibold text-neutral-700">
        {filtered ? "No matching requests" : "No approved requests yet"}
      </p>
      <p className="mt-1 max-w-sm text-xs text-neutral-500">
        {filtered
          ? "No approved requests match the current filters. Try clearing them."
          : "Approved indirect material requests will appear here once you approve them."}
      </p>
    </div>
  );
}
