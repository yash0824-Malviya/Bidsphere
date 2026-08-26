import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Plus,
  Search,
  Eye,
  Edit,
  ArrowUpRight,
  Filter,
  FileText,
} from "lucide-react";

import { fetchBusinessNeeds } from "../../api/businessIntake";
import { IntakeApprovalBadge } from "../../components/intake/IntakeApprovalBadge";
import PageHeader from "../../components/PageHeader";
import { formatCurrency } from "../../utils/format";
import { useAuthStore } from "../../store/authStore";

export default function BusinessNeedsListPage() {
  const user = useAuthStore((s) => s.user);

  const [search, setSearch] = useState("");
  const [selectedDept, setSelectedDept] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [selectedPriority, setSelectedPriority] = useState("all");
  const [selectedType, setSelectedType] = useState("all");

  const { data: needs = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["business-needs"],
    queryFn: () => fetchBusinessNeeds(),
  });

  const filteredNeeds = needs.filter((n) => {
    if (selectedDept !== "all" && n.department !== selectedDept) return false;
    if (selectedStatus !== "all" && n.status !== selectedStatus) return false;
    if (selectedPriority !== "all" && n.priority !== selectedPriority) return false;
    if (selectedType !== "all" && n.need_type !== selectedType) return false;
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      return (
        n.business_need_id.toLowerCase().includes(q) ||
        n.title.toLowerCase().includes(q) ||
        n.description.toLowerCase().includes(q) ||
        n.department.toLowerCase().includes(q) ||
        (n.project && n.project.toLowerCase().includes(q)) ||
        (n.plant && n.plant.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const canCreate = user?.role === "department" || user?.role === "admin";

  return (
    <div className="space-y-6 p-6">
      {/* Page Header */}
      <PageHeader
        title="Business Needs Intake"
        description="Initial business requirement intake raised by business departments."
      />

      {/* ERPNext Error State */}
      {isError && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-8 text-center">
          <span className="text-base font-semibold text-red-700">Unable to load Business Needs</span>
          <p className="text-sm text-red-500">
            {error instanceof Error ? error.message : "ERPNext connection error. Check your session or network."}
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      )}

      {!isError && (
        <>
      {/* Stats Summary Bar */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <span className="text-xs font-semibold uppercase text-neutral-500">Total Business Needs</span>
          <p className="mt-1 text-2xl font-bold text-neutral-900">{needs.length}</p>
          <p className="mt-1 text-[11px] text-neutral-500">Raised by departments</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <span className="text-xs font-semibold uppercase text-neutral-500">Submitted</span>
          <p className="mt-1 text-2xl font-bold text-amber-600">
            {needs.filter((n) => n.status === "Submitted").length}
          </p>
          <p className="mt-1 text-[11px] text-neutral-500">Processing intake</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <span className="text-xs font-semibold uppercase text-neutral-500">Approved & Cases Created</span>
          <p className="mt-1 text-2xl font-bold text-emerald-600">
            {needs.filter((n) => n.status === "Approved").length}
          </p>
          <p className="mt-1 text-[11px] text-neutral-500">Auto-linked to Business Cases</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <span className="text-xs font-semibold uppercase text-neutral-500">Total Estimated Budget</span>
          <p className="mt-1 text-2xl font-bold text-primary-900">
            {formatCurrency(needs.reduce((sum, n) => sum + n.estimated_budget, 0))}
          </p>
          <p className="mt-1 text-[11px] text-neutral-500">Combined estimated budget</p>
        </div>
      </div>

      {/* Action Controls & Multi-Filters */}
      <div className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by ID, Title, Department, Project, Plant..."
              className="w-full rounded-lg border border-neutral-300 pl-9 pr-4 py-2 text-sm focus:border-primary-500 focus:outline-none"
            />
          </div>

          {canCreate && (
            <Link
              to="/intake/business-needs/new"
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Create Business Need
            </Link>
          )}
        </div>

        {/* Filter Dropdowns */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-neutral-100 text-xs">
          <div className="flex items-center gap-1 text-neutral-500 font-semibold uppercase">
            <Filter className="h-3.5 w-3.5" />
            Filters:
          </div>

          <select
            value={selectedDept}
            onChange={(e) => setSelectedDept(e.target.value)}
            className="rounded-lg border border-neutral-300 px-2.5 py-1.5 focus:outline-none"
          >
            <option value="all">All Departments</option>
            <option value="IT & Digital Transformation">IT & Digital Transformation</option>
            <option value="Manufacturing Engineering">Manufacturing Engineering</option>
            <option value="Supply Chain & Logistics">Supply Chain & Logistics</option>
            <option value="Facilities & EHS">Facilities & EHS</option>
            <option value="Operations & Production">Operations & Production</option>
          </select>

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="rounded-lg border border-neutral-300 px-2.5 py-1.5 focus:outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="Draft">Draft</option>
            <option value="Submitted">Submitted</option>
            <option value="Approved">Approved</option>
            <option value="Rejected">Rejected</option>
            <option value="Revision Required">Revision Required</option>
          </select>

          <select
            value={selectedPriority}
            onChange={(e) => setSelectedPriority(e.target.value)}
            className="rounded-lg border border-neutral-300 px-2.5 py-1.5 focus:outline-none"
          >
            <option value="all">All Priorities</option>
            <option value="Low">Low Priority</option>
            <option value="Medium">Medium Priority</option>
            <option value="High">High Priority</option>
            <option value="Critical">Critical Priority</option>
          </select>

          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="rounded-lg border border-neutral-300 px-2.5 py-1.5 focus:outline-none"
          >
            <option value="all">All Types</option>
            <option value="Direct">Direct Procurement</option>
            <option value="Indirect">Indirect Procurement</option>
          </select>
        </div>
      </div>

      {/* Business Needs Data Table */}
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-neutral-700">
            <thead className="border-b border-neutral-200 bg-neutral-50 font-semibold uppercase text-neutral-600">
              <tr>
                <th className="px-4 py-3.5">Need ID</th>
                <th className="px-4 py-3.5">Title</th>
                <th className="px-4 py-3.5">Department</th>
                <th className="px-4 py-3.5">Requester</th>
                <th className="px-4 py-3.5">Estimated Budget</th>
                <th className="px-4 py-3.5">Priority</th>
                <th className="px-4 py-3.5">Type</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5">Linked Case</th>
                <th className="px-4 py-3.5 text-right">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-neutral-200">
              {isLoading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-neutral-500">
                    Loading Business Needs...
                  </td>
                </tr>
              ) : filteredNeeds.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
                        <FileText className="h-6 w-6" />
                      </div>
                      <div>
                        <h4 className="text-base font-semibold text-neutral-900">No Business Needs found</h4>
                        <p className="mt-1 text-xs text-neutral-500 max-w-md">
                          Create your first Business Need to begin the Finance &rarr; Legal &rarr; Procurement intake workflow.
                        </p>
                      </div>
                      {canCreate && (
                        <Link
                          to="/intake/business-needs/new"
                          className="mt-2 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-primary-700 transition-colors"
                        >
                          <Plus className="h-4 w-4" />
                          Create Business Need
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredNeeds.map((n) => (
                  <tr key={n.name} className="hover:bg-neutral-50/80 transition-colors">
                    <td className="px-4 py-3.5 font-mono font-bold text-primary-700">
                      <Link to={`/intake/business-needs/${n.business_need_id}`} className="hover:underline flex items-center gap-1">
                        {n.business_need_id}
                        <ArrowUpRight className="h-3 w-3 text-neutral-400" />
                      </Link>
                    </td>

                    <td className="px-4 py-3.5 max-w-xs">
                      <span className="font-semibold text-neutral-900 line-clamp-1">{n.title}</span>
                      <span className="text-[11px] text-neutral-500 block line-clamp-1">{n.problem_statement || n.description}</span>
                    </td>

                    <td className="px-4 py-3.5 font-medium text-neutral-800">{n.department}</td>
                    <td className="px-4 py-3.5 text-neutral-700">{n.requester}</td>

                    <td className="px-4 py-3.5 font-bold text-neutral-900">
                      {formatCurrency(n.estimated_budget)}
                    </td>

                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          n.priority === "Critical"
                            ? "bg-red-100 text-red-800"
                            : n.priority === "High"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-blue-100 text-blue-800"
                        }`}
                      >
                        {n.priority}
                      </span>
                    </td>

                    <td className="px-4 py-3.5 text-neutral-600">{n.need_type}</td>

                    <td className="px-4 py-3.5">
                      <IntakeApprovalBadge status={n.status} size="sm" />
                    </td>

                    <td className="px-4 py-3.5 font-mono text-xs">
                      {n.business_case ? (
                        <Link
                          to={`/intake/business-cases/${n.business_case}`}
                          className="font-bold text-emerald-700 hover:underline flex items-center gap-1"
                        >
                          {n.business_case}
                          <ArrowUpRight className="h-3 w-3" />
                        </Link>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>

                    <td className="px-4 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {n.status === "Draft" && canCreate && (
                          <Link
                            to={`/intake/business-needs/${n.business_need_id}/edit`}
                            className="inline-flex items-center gap-1 rounded-lg border border-primary-200 bg-primary-50 px-2.5 py-1.5 text-xs font-semibold text-primary-700 hover:bg-primary-100 transition-colors"
                          >
                            <Edit className="h-3.5 w-3.5 text-primary-600" />
                            Edit Draft
                          </Link>
                        )}
                        <Link
                          to={`/intake/business-needs/${n.business_need_id}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
                        >
                          <Eye className="h-3.5 w-3.5 text-neutral-500" />
                          View
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
        </>
      )}
    </div>
  );
}
