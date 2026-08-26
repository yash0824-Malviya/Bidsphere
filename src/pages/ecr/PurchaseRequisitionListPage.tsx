import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Search,
  RefreshCw,
  ArrowUpRight,
  ChevronRight,
  AlertCircle,
} from "lucide-react";

import { fetchPRList } from "../../api/purchaseRequisition";
import { formatECRNumber } from "../../config/ecrRoles";

const STATUS_BADGE: Record<string, { bg: string; text: string; border: string }> = {
  Draft: { bg: "bg-neutral-100", text: "text-neutral-700", border: "border-neutral-200" },
  Submitted: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
  "Needs Revision": { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
  "Under Review": { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
  Approved: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  "RFQ Created": { bg: "bg-teal-50", text: "text-teal-700", border: "border-teal-200" },
  Closed: { bg: "bg-slate-100", text: "text-slate-700", border: "border-slate-300" },
  Rejected: { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200" },
  Cancelled: { bg: "bg-neutral-100", text: "text-neutral-500", border: "border-neutral-200" },
};

export default function PurchaseRequisitionListPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");

  const {
    data: prs = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["custom-pr-list"],
    queryFn: () => fetchPRList({ limit: 200 }),
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    return prs.filter((pr) => {
      if (statusFilter !== "all" && pr.status !== statusFilter) return false;
      if (priorityFilter !== "all" && pr.priority !== priorityFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        return (
          pr.name.toLowerCase().includes(q) ||
          pr.requisition_title.toLowerCase().includes(q) ||
          (pr.ecr_reference && pr.ecr_reference.toLowerCase().includes(q)) ||
          (pr.requesting_department && pr.requesting_department.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [prs, statusFilter, priorityFilter, search]);

  const kpis = useMemo(() => {
    return {
      total: prs.length,
      pending: prs.filter((p) => ["Submitted", "Under Review", "Needs Revision"].includes(p.status)).length,
      approved: prs.filter((p) => ["Approved", "RFQ Created"].includes(p.status)).length,
      rfqCreated: prs.filter((p) => p.status === "RFQ Created").length,
    };
  }, [prs]);

  return (
    <div className="space-y-4 p-6">
      {/* ── Breadcrumb & Title ── */}
      <div className="flex items-center gap-1.5 text-xs text-neutral-500">
        <Link to="/ecr" className="hover:text-primary-700 font-medium">
          Engineering Changes
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-neutral-400" />
        <span className="text-neutral-800 font-semibold">Purchase Requisitions</span>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Purchase Requisitions (ECR-Driven)</h1>
          <p className="text-xs text-neutral-500 mt-0.5">
            Manage purchase requisitions generated from approved Engineering Change Requests.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/ecr"
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 transition-colors"
          >
            All ECRs
          </Link>
        </div>
      </div>

      {/* ── Compact KPIs ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 block">Total PRs</span>
          <p className="mt-1 text-2xl font-bold text-neutral-900">{kpis.total}</p>
          <span className="text-[11px] text-neutral-500">ECR Requisitions</span>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 block">Pending Review</span>
          <p className="mt-1 text-2xl font-bold text-amber-600">{kpis.pending}</p>
          <span className="text-[11px] text-neutral-500">Under approval</span>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 block">Approved</span>
          <p className="mt-1 text-2xl font-bold text-emerald-600">{kpis.approved}</p>
          <span className="text-[11px] text-neutral-500">Ready for RFQ</span>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 block">RFQ Created</span>
          <p className="mt-1 text-2xl font-bold text-teal-600">{kpis.rfqCreated}</p>
          <span className="text-[11px] text-neutral-500">In supplier bidding</span>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search PR number, title, ECR ref, department…"
              className="w-full rounded-lg border border-neutral-300 bg-neutral-50/50 pl-9 pr-3 py-1.5 text-xs text-neutral-800 focus:bg-white focus:border-primary-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-700 focus:border-primary-500 focus:outline-none"
            >
              <option value="all">All Statuses</option>
              <option value="Draft">Draft</option>
              <option value="Submitted">Submitted</option>
              <option value="Under Review">Under Review</option>
              <option value="Approved">Approved</option>
              <option value="RFQ Created">RFQ Created</option>
              <option value="Closed">Closed</option>
            </select>

            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-700 focus:border-primary-500 focus:outline-none"
            >
              <option value="all">All Priorities</option>
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
              <option value="Critical">Critical</option>
            </select>

            <button
              type="button"
              onClick={() => void refetch()}
              className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin text-primary-600" : "text-neutral-400"}`} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {isError && (
        <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">
          <AlertCircle className="h-4 w-4 flex-shrink-0 text-rose-600" />
          <span>{error instanceof Error ? error.message : "Failed to load Purchase Requisitions."}</span>
        </div>
      )}

      {/* ── Data Table ── */}
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-neutral-700">
            <thead className="border-b border-neutral-200 bg-neutral-50 font-semibold uppercase tracking-wider text-neutral-600">
              <tr>
                <th className="px-3.5 py-3">PR #</th>
                <th className="px-3.5 py-3">Title</th>
                <th className="px-3 py-3">ECR Reference</th>
                <th className="px-3 py-3">Requester</th>
                <th className="px-3 py-3">Department</th>
                <th className="px-3 py-3">Priority</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Required Date</th>
                <th className="px-3 py-3">RFQ</th>
                <th className="px-3.5 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array.from({ length: 10 }).map((_, j) => (
                      <td key={j} className="px-3.5 py-3">
                        <div className="h-3.5 rounded bg-neutral-200" style={{ width: `${40 + ((j * 17) % 50)}%` }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-10 text-center text-neutral-400">
                    No Purchase Requisitions found.
                  </td>
                </tr>
              ) : (
                filtered.map((pr) => {
                  const statusStyle = STATUS_BADGE[pr.status] || STATUS_BADGE.Draft;
                  return (
                    <tr key={pr.name} className="border-b border-neutral-100 hover:bg-neutral-50/80 transition-colors">
                      <td className="px-3.5 py-2.5 font-mono text-xs font-semibold text-primary-700">
                        <Link to={`/ecr/purchase-requisitions/${encodeURIComponent(pr.name)}`} className="hover:underline">
                          {pr.name}
                        </Link>
                      </td>
                      <td className="px-3.5 py-2.5 font-medium text-neutral-900 max-w-[200px] truncate">
                        {pr.requisition_title}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-primary-600">
                        {pr.ecr_reference ? (
                          <Link to={`/ecr/${encodeURIComponent(formatECRNumber(pr.ecr_reference))}`} className="hover:underline">
                            {formatECRNumber(pr.ecr_reference)}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-neutral-600">{pr.requester || "—"}</td>
                      <td className="px-3 py-2.5 text-neutral-700">{pr.requesting_department || "—"}</td>
                      <td className="px-3 py-2.5">{pr.priority || "Medium"}</td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}
                        >
                          {pr.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-neutral-600">{pr.required_date || "—"}</td>
                      <td className="px-3 py-2.5">
                        {pr.rfq ? (
                          <Link
                            to={`/sourcing/rfq/${encodeURIComponent(pr.rfq)}`}
                            className="inline-flex items-center gap-0.5 text-[11px] font-medium text-teal-700 hover:underline"
                          >
                            <span>{pr.rfq}</span>
                            <ArrowUpRight className="h-3 w-3" />
                          </Link>
                        ) : (
                          <span className="text-neutral-300 text-[11px]">—</span>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5 text-right">
                        <Link
                          to={`/ecr/purchase-requisitions/${encodeURIComponent(pr.name)}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                        >
                          Workspace
                          <ArrowUpRight className="h-3.5 w-3.5 text-neutral-500" />
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
