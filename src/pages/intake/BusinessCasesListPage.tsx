import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Search,
  Eye,
  ArrowUpRight,
  AlertCircle,
  RefreshCw,
} from "lucide-react";

import { fetchBusinessCases } from "../../api/businessIntake";
import { IntakeApprovalBadge } from "../../components/intake/IntakeApprovalBadge";
import PageHeader from "../../components/PageHeader";
import { formatCurrency } from "../../utils/format";

export default function BusinessCasesListPage() {
  const [search, setSearch] = useState("");
  const [selectedDept, setSelectedDept] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");

  const { data: cases = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["business-cases"],
    queryFn: () => fetchBusinessCases(),
    retry: 1,
  });

  const filteredCases = cases.filter((c) => {
    if (selectedDept !== "all" && c.department !== selectedDept) return false;
    if (selectedStatus !== "all" && c.workflow_status !== selectedStatus && c.approval_status !== selectedStatus) return false;
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      return (
        c.business_case_id.toLowerCase().includes(q) ||
        c.title.toLowerCase().includes(q) ||
        c.department.toLowerCase().includes(q) ||
        c.business_owner.toLowerCase().includes(q) ||
        (c.project && c.project.toLowerCase().includes(q))
      );
    }
    return true;
  });

  // KPIs — computed from workflow_status (the single ERPNext status field).
  const totalCases = cases.length;
  const pendingFinanceCount = cases.filter((c) =>
    c.workflow_status === "Pending Finance Review" ||
    c.workflow_status === "Revision Required - Finance"
  ).length;
  const pendingLegalCount = cases.filter((c) =>
    c.workflow_status === "Pending Legal Review" ||
    c.workflow_status === "Revision Required - Legal"
  ).length;
  const pendingProcurementCount = cases.filter((c) =>
    c.workflow_status === "Pending Procurement"
  ).length;
  const procurementReadyCount = cases.filter((c) =>
    c.workflow_status === "Procurement Ready" ||
    c.workflow_status === "Approved - Ready for RFQ"
  ).length;
  const rfqCreatedCount = cases.filter((c) =>
    c.workflow_status === "RFQ Created"
  ).length;

  // Show a clean error state instead of empty list on ERPNext query failure
  if (isError) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    const isFrappeFieldError = errMsg.includes("Field not permitted");
    console.error("[BusinessCases] Load error:", errMsg);
    return (
      <div className="space-y-6 p-6">
        <PageHeader
          title="Business Cases Repository"
          description="Detailed business justification & procurement planning repository with Finance & Legal approval gates."
        />
        <div className="flex flex-col items-center justify-center rounded-xl border border-red-200 bg-red-50 p-10 text-center">
          <AlertCircle className="mb-3 h-10 w-10 text-red-500" />
          <h3 className="mb-1 text-base font-semibold text-red-800">
            Unable to Load Business Cases
          </h3>
          <p className="mb-4 text-sm text-red-600 max-w-md">
            {isFrappeFieldError
              ? "A field mapping error occurred. Please contact your administrator to verify the Business Case DocType configuration."
              : "Could not connect to ERPNext. Please check your connection and try again."}
          </p>
          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Page Header */}
      <PageHeader
        title="Business Cases Repository"
        description="Authoritative repository for Business Cases across the enterprise with end-to-end Finance, Legal, and Procurement lifecycle synchronization."
      />

      {/* KPI Metrics */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm">
          <span className="text-[11px] font-semibold uppercase text-neutral-500">Total Cases</span>
          <p className="mt-1 text-xl font-bold text-neutral-900">{totalCases}</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm">
          <span className="text-[11px] font-semibold uppercase text-neutral-500">Pending Finance</span>
          <p className="mt-1 text-xl font-bold text-blue-600">{pendingFinanceCount}</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm">
          <span className="text-[11px] font-semibold uppercase text-neutral-500">Pending Legal</span>
          <p className="mt-1 text-xl font-bold text-purple-600">{pendingLegalCount}</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm">
          <span className="text-[11px] font-semibold uppercase text-neutral-500">Pending Proc.</span>
          <p className="mt-1 text-xl font-bold text-amber-600">{pendingProcurementCount}</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm">
          <span className="text-[11px] font-semibold uppercase text-neutral-500">Proc. Ready</span>
          <p className="mt-1 text-xl font-bold text-emerald-700">{procurementReadyCount}</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm">
          <span className="text-[11px] font-semibold uppercase text-neutral-500">RFQ Created</span>
          <p className="mt-1 text-xl font-bold text-indigo-600">{rfqCreatedCount}</p>
        </div>
      </div>

      {/* Filter Controls */}
      <div className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search Business Cases by ID, Title, Owner, Project..."
              className="w-full rounded-lg border border-neutral-300 pl-9 pr-4 py-2 text-sm focus:border-primary-500 focus:outline-none"
            />
          </div>

          <select
            value={selectedDept}
            onChange={(e) => setSelectedDept(e.target.value)}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none"
          >
            <option value="all">All Departments</option>
            <option value="IT & Digital Transformation">IT & Digital Transformation</option>
            <option value="Manufacturing Engineering">Manufacturing Engineering</option>
            <option value="Supply Chain & Logistics">Supply Chain & Logistics</option>
            <option value="Facilities & EHS">Facilities & EHS</option>
          </select>

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none"
          >
            <option value="all">All Workflow States</option>
            <option value="Pending Finance Review">Pending Finance Review</option>
            <option value="Revision Required - Finance">Revision Required - Finance</option>
            <option value="Pending Legal Review">Pending Legal Review</option>
            <option value="Revision Required - Legal">Revision Required - Legal</option>
            <option value="Pending Procurement">Pending Procurement</option>
            <option value="Procurement Ready">Procurement Ready</option>
            <option value="RFQ Created">RFQ Created</option>
            <option value="Rejected">Rejected</option>
          </select>
        </div>
      </div>

      {/* Business Cases List Table */}
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-neutral-700">
            <thead className="border-b border-neutral-200 bg-neutral-50 font-semibold uppercase text-neutral-600">
              <tr>
                <th className="px-4 py-3.5">Case ID</th>
                <th className="px-4 py-3.5">Title</th>
                <th className="px-4 py-3.5">Department</th>
                <th className="px-4 py-3.5">Business Owner</th>
                <th className="px-4 py-3.5">Total Budget</th>
                <th className="px-4 py-3.5">CAPEX / OPEX</th>
                <th className="px-4 py-3.5">ROI %</th>
                <th className="px-4 py-3.5">Finance</th>
                <th className="px-4 py-3.5">Legal</th>
                <th className="px-4 py-3.5">Workflow Status</th>
                <th className="px-4 py-3.5 text-right">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-neutral-200">
              {isLoading ? (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-neutral-500">
                    Loading Business Cases...
                  </td>
                </tr>
              ) : filteredCases.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <p className="text-sm font-semibold text-neutral-800">No Business Cases found</p>
                      <p className="text-xs text-neutral-500 max-w-sm">
                        Business Cases are automatically created when a Business Need is submitted by a department user.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredCases.map((c) => (
                  <tr key={c.name} className="hover:bg-neutral-50/80 transition-colors">
                    <td className="px-4 py-3.5 font-mono font-bold text-primary-700">
                      <Link to={`/intake/business-cases/${c.business_case_id}`} className="hover:underline flex items-center gap-1">
                        {c.business_case_id}
                        <ArrowUpRight className="h-3 w-3 text-neutral-400" />
                      </Link>
                    </td>

                    <td className="px-4 py-3.5 max-w-xs">
                      <span className="font-semibold text-neutral-900 line-clamp-1">{c.title}</span>
                      <span className="text-[11px] text-neutral-500 block">Need ID: {c.business_need_id}</span>
                    </td>

                    <td className="px-4 py-3.5 font-medium text-neutral-800">{c.department}</td>
                    <td className="px-4 py-3.5 text-neutral-700">{c.business_owner}</td>

                    <td className="px-4 py-3.5 font-bold text-neutral-900">
                      {formatCurrency(c.budget)}
                    </td>

                    <td className="px-4 py-3.5 text-neutral-600">
                      {formatCurrency(c.capex)} / {formatCurrency(c.opex)}
                    </td>

                    <td className="px-4 py-3.5 font-bold text-emerald-700">
                      {c.roi}% ({c.payback_period})
                    </td>

                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          c.finance_status === "Approved"
                            ? "bg-emerald-100 text-emerald-800"
                            : c.finance_status === "Rejected"
                            ? "bg-red-100 text-red-800"
                            : "bg-blue-100 text-blue-800"
                        }`}
                      >
                        {c.finance_status}
                      </span>
                    </td>

                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          c.legal_status === "Approved"
                            ? "bg-emerald-100 text-emerald-800"
                            : c.legal_status === "Rejected"
                            ? "bg-red-100 text-red-800"
                            : "bg-purple-100 text-purple-800"
                        }`}
                      >
                        {c.legal_status}
                      </span>
                    </td>

                    <td className="px-4 py-3.5">
                      <IntakeApprovalBadge status={c.workflow_status} size="sm" />
                    </td>

                    <td className="px-4 py-3.5 text-right">
                      <Link
                        to={`/intake/business-cases/${c.business_case_id}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                      >
                        <Eye className="h-3.5 w-3.5 text-neutral-500" />
                        View Detail
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
