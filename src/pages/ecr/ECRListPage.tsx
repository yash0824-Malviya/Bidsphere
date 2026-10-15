import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowUpRight,
  Factory,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
} from "lucide-react";

import { fetchECRList } from "../../api/ecr";
import ECRPriorityBadge from "../../components/ecr/ECRPriorityBadge";
import ECRStatusBadge from "../../components/ecr/ECRStatusBadge";
import {
  ECR_WORKSPACES,
  formatECRNumber,
  isECRRole,
  isEcrOwnedBy,
} from "../../config/ecrRoles";
import {
  getECRAssignedTo,
  getECRCurrentStage,
} from "../../config/ecrQueues";
import { useAuthStore } from "../../store/authStore";

import { useDebounce } from "../../hooks/useDebounce";

import EngineerMyECRsPage from "./EngineerMyECRsPage";
import EngineerBusinessCasesPage from "./EngineerBusinessCasesPage";
import EngineerTechnicalReviewPage from "./EngineerTechnicalReviewPage";
import { getEngineerEcrPage } from "./engineerEcrNavigation";
import EngineeringReviewPage from "./EngineeringReviewPage";
import EngineeringECRListPage from "./EngineeringECRListPage";
import { getEngineeringManagerEcrPage } from "./engineeringManagerEcrNavigation";
import { ECR_TYPES, activeQueueValue, getRoleECRStageLabel, matchesVisibleQueueFilter, queueFiltersForRole } from "./ecrListPresentation";
export { activeQueueValue, getRoleECRStageLabel, getVisibleECRListActionLabel, matchesVisibleQueueFilter, queueFiltersForRole } from "./ecrListPresentation";

export default function ECRListPage() {
  const role = useAuthStore((state) => state.user?.role);
  if (role === "engineer") return <EngineerECRPages />;
  if (role === "engineering") return <EngineeringManagerECRPages />;
  return <RoleECRListPage />;
}

function EngineeringManagerECRPages() {
  const [searchParams] = useSearchParams();
  const page = getEngineeringManagerEcrPage(searchParams.get("filter"));
  if (page === "engineering-review") return <EngineeringReviewPage />;
  if (page === "business-cases") return <EngineerBusinessCasesPage role="engineering" />;
  return <EngineeringECRListPage />;
}

function EngineerECRPages() {
  const [searchParams] = useSearchParams();
  const page = getEngineerEcrPage(searchParams.get("filter"));
  if (page === "technical-review") return <EngineerTechnicalReviewPage />;
  if (page === "business-cases") return <EngineerBusinessCasesPage />;
  return <EngineerMyECRsPage />;
}

function RoleECRListPage() {
  const user = useAuthStore((state) => state.user);
  const role = user?.role && isECRRole(user.role) ? user.role : null;
  const workspace = role ? ECR_WORKSPACES[role] : null;
  const [searchParams, setSearchParams] = useSearchParams();
  const routeFilter = searchParams.get("filter") || "all";
  const activeQueue = activeQueueValue(routeFilter, role);

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [supplierReqFilter, setSupplierReqFilter] = useState("all");
  const [targetDateFilter, setTargetDateFilter] = useState("");

  const canCreate = role === "engineer" || role === "admin";
  const queueFilters = queueFiltersForRole(role);

  const {
    data: ecrs = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["ecr-list", role, role === "engineer" ? user?.email || user?.name : "all"],
    queryFn: () => fetchECRList({
      limit: 300,
      owner: role === "engineer" ? user?.email || user?.name : undefined,
    }),
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });

  const visibleEcrs = useMemo(
    () => (role === "engineer" ? ecrs.filter((ecr) => isEcrOwnedBy(ecr, user)) : ecrs),
    [ecrs, role, user],
  );

  const departments = useMemo(() => {
    const values = new Set<string>();
    for (const ecr of visibleEcrs) {
      if (ecr.requesting_department) values.add(ecr.requesting_department);
    }
    return Array.from(values).sort();
  }, [visibleEcrs]);

  const queueCounts = useMemo(() => {
    return Object.fromEntries(
      queueFilters.map((filter) => [
        filter.value,
        visibleEcrs.filter((ecr) =>
          matchesVisibleQueueFilter(filter.value, role, ecr, user),
        ).length,
      ]),
    ) as Record<string, number>;
  }, [queueFilters, role, user, visibleEcrs]);

  const filtered = useMemo(() => {
    return visibleEcrs.filter((ecr) => {
      if (queueFilters.length > 0 && !matchesVisibleQueueFilter(routeFilter, role, ecr, user)) return false;
      if (priorityFilter !== "all" && ecr.priority !== priorityFilter) return false;
      if (typeFilter !== "all" && ecr.ecr_type !== typeFilter) return false;
      if (departmentFilter !== "all" && ecr.requesting_department !== departmentFilter) return false;
      if (supplierReqFilter !== "all" && ecr.supplier_response_required !== supplierReqFilter) return false;
      if (targetDateFilter && ecr.target_implementation_date !== targetDateFilter) return false;

      const query = debouncedSearch.trim().toLowerCase();
      if (!query) return true;
      return [
        ecr.name,
        ecr.ecr_number,
        formatECRNumber(ecr),
        ecr.ecr_title,
        ecr.requesting_department,
        ecr.program,
        ecr.ecr_owner,
        ecr.owner,
        getRoleECRStageLabel(role, ecr),
        getECRAssignedTo(ecr),
      ].some((value) => String(value || "").toLowerCase().includes(query));
    });
  }, [
    departmentFilter,
    priorityFilter,
    queueFilters.length,
    role,
    routeFilter,
    search,
    supplierReqFilter,
    targetDateFilter,
    typeFilter,
    user,
    visibleEcrs,
  ]);

  function resetFilters() {
    setSearch("");
    setPriorityFilter("all");
    setTypeFilter("all");
    setDepartmentFilter("all");
    setSupplierReqFilter("all");
    setTargetDateFilter("");
    setSearchParams({});
  }

  const hasActiveFilters =
    search !== "" ||
    (queueFilters.length > 0 && activeQueue !== "all") ||
    priorityFilter !== "all" ||
    typeFilter !== "all" ||
    departmentFilter !== "all" ||
    supplierReqFilter !== "all" ||
    targetDateFilter !== "";

  const isProcurementView = role === "procurement";
  const pageTitle = isProcurementView
    ? "ECR Reference"
    : (workspace?.title ?? "Engineering Changes");
  const pageSubtitle = isProcurementView
    ? "View engineering change records referenced by procurement activities."
    : (workspace?.description ?? "Manage engineering change requests.");

  return (
    <div className="space-y-5 p-4 sm:p-6 bg-[#F5F7FA] font-[Inter,-apple-system,sans-serif]">
      <header className="flex flex-col gap-3 rounded-[10px] border border-[#E2E8F0] bg-white px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[24px] font-bold text-[#12213F] tracking-tight">{pageTitle}</h1>
          <p className="mt-0.5 text-[13px] text-[#64748B]">
            {pageSubtitle}
          </p>
        </div>
        {canCreate ? (
          <Link
            to="/ecr/new"
            className="inline-flex items-center gap-1.5 self-start rounded-lg bg-[#1554D1] px-3.5 py-2 text-[13px] font-semibold text-white shadow-xs hover:bg-[#1042B0] transition-colors"
          >
            <Plus className="h-4 w-4" />New ECR
          </Link>
        ) : null}
      </header>

      {/* Queue Tabs */}
      {queueFilters.length > 0 ? (
        <nav
          className="flex flex-wrap items-center gap-1.5 rounded-[10px] border border-[#E2E8F0] bg-white p-2 text-[13px] shadow-sm"
          aria-label="ECR queues"
        >
          <span className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[#94A3B8]">
            Queues
          </span>
          {queueFilters.map((filter) => {
            const isActive = activeQueue === filter.value;
            return (
              <button
                key={filter.value}
                type="button"
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  if (filter.value === "all") next.delete("filter");
                  else next.set("filter", filter.value);
                  setSearchParams(next);
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold transition-all ${
                  isActive
                    ? "border-[#1554D1] bg-[#1554D1] text-white shadow-xs"
                    : "border-[#E2E8F0] bg-[#F8FAFC] text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#12213F]"
                }`}
              >
                <span>{filter.label}</span>
                <span className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${isActive ? "bg-[#0D338C] text-white" : "bg-[#E2E8F0] text-[#475569]"}`}>
                  {queueCounts[filter.value] ?? 0}
                </span>
              </button>
            );
          })}
        </nav>
      ) : null}

      {/* Filters Bar */}
      <section className="space-y-3 rounded-[10px] border border-[#E2E8F0] bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search ECR, title, department..."
              className="h-[38px] w-full rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] pl-9 pr-3 text-[13px] text-[#12213F] placeholder:text-[#94A3B8] focus:border-[#1554D1] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#1554D1]"
            />
          </div>
          <div className="flex items-center gap-2">
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center gap-1 rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-[12px] font-medium text-[#64748B] hover:bg-[#F8FAFC]"
              >
                <RotateCcw className="h-3.5 w-3.5 text-[#94A3B8]" />Reset
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void refetch()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#12213F] hover:bg-[#F8FAFC]"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin text-[#1554D1]" : "text-[#64748B]"}`} />
              Refresh
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-[#F1F5F9] pt-3 text-[12px] sm:grid-cols-5">
          <label className="text-[11px] font-bold uppercase text-[#64748B]">
            Priority
            <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} className="mt-1 h-[34px] w-full rounded-lg border border-[#E2E8F0] bg-white px-2.5 text-[12px] font-normal normal-case text-[#12213F] focus:border-[#1554D1] focus:outline-none">
              <option value="all">All Priorities</option>
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
              <option value="Critical">Critical</option>
            </select>
          </label>
          <label className="text-[11px] font-bold uppercase text-[#64748B]">
            Department
            <select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)} className="mt-1 h-[34px] w-full rounded-lg border border-[#E2E8F0] bg-white px-2.5 text-[12px] font-normal normal-case text-[#12213F] focus:border-[#1554D1] focus:outline-none">
              <option value="all">All Departments</option>
              {departments.map((department) => <option key={department} value={department}>{department}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-bold uppercase text-[#64748B]">
            Supplier Required
            <select value={supplierReqFilter} onChange={(event) => setSupplierReqFilter(event.target.value)} className="mt-1 h-[34px] w-full rounded-lg border border-[#E2E8F0] bg-white px-2.5 text-[12px] font-normal normal-case text-[#12213F] focus:border-[#1554D1] focus:outline-none">
              <option value="all">All</option>
              <option value="Yes">Supplier Required</option>
              <option value="No">No Supplier Required</option>
            </select>
          </label>
          <label className="text-[11px] font-bold uppercase text-[#64748B]">
            ECR Type
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="mt-1 h-[34px] w-full rounded-lg border border-[#E2E8F0] bg-white px-2.5 text-[12px] font-normal normal-case text-[#12213F] focus:border-[#1554D1] focus:outline-none">
              <option value="all">All Types</option>
              {ECR_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-bold uppercase text-[#64748B]">
            Target Date
            <input type="date" value={targetDateFilter} onChange={(event) => setTargetDateFilter(event.target.value)} className="mt-1 h-[34px] w-full rounded-lg border border-[#E2E8F0] bg-white px-2.5 text-[12px] font-normal normal-case text-[#12213F] focus:border-[#1554D1] focus:outline-none" />
          </label>
        </div>
      </section>

      {isError ? (
        <div className="flex items-center gap-3 rounded-[10px] border border-[#FECACA] bg-[#FEF2F2] p-4 text-[13px] text-[#DC2626]">
          <AlertCircle className="h-4 w-4 shrink-0 text-[#DC2626]" />
          <span>{error instanceof Error ? error.message : "Failed to load Engineering Change Requests."}</span>
          <button type="button" onClick={() => void refetch()} className="ml-auto font-semibold underline hover:no-underline">Retry</button>
        </div>
      ) : null}

      {/* Table */}
      <section className="overflow-hidden rounded-[10px] border border-[#E2E8F0] bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px] text-[#12213F]">
            <thead className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-bold uppercase tracking-[0.06em] text-[#64748B]">
              <tr>
                <th className="whitespace-nowrap px-3.5 py-3">ECR #</th>
                <th className="whitespace-nowrap px-3.5 py-3">Title</th>
                <th className="whitespace-nowrap px-3 py-3">Department</th>
                <th className="whitespace-nowrap px-3 py-3">Priority</th>
                <th className="whitespace-nowrap px-3 py-3">Supplier Required</th>
                <th className="whitespace-nowrap px-3 py-3">Target Date</th>
                <th className="whitespace-nowrap px-3 py-3">Approval Status</th>
                {isProcurementView ? (
                  <th className="whitespace-nowrap px-3 py-3">Referenced RFQ</th>
                ) : (
                  <th className="whitespace-nowrap px-3 py-3">Approved On</th>
                )}
                <th className="whitespace-nowrap px-3.5 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {isLoading ? (
                Array.from({ length: 6 }, (_, row) => (
                  <tr key={row} className="animate-pulse">
                    {Array.from({ length: 9 }, (_, column) => (
                      <td key={column} className="px-3.5 py-3"><div className="h-3.5 rounded bg-[#F1F5F9]" /></td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center">
                    <Factory className="mx-auto mb-2 h-8 w-8 text-[#94A3B8]" />
                    <p className="text-[15px] font-bold text-[#12213F]">
                      {isProcurementView ? "No ECR records found" : "No ECRs in this queue"}
                    </p>
                    <p className="mt-1 text-[13px] text-[#64748B]">
                      {isProcurementView
                        ? "There are currently no engineering change records to display."
                        : "Pending items appear only when the workflow reaches this role's stage."}
                    </p>
                    {hasActiveFilters ? (
                      <button type="button" onClick={resetFilters} className="mt-3.5 inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3.5 py-2 text-[12px] font-semibold text-[#12213F] hover:bg-[#F8FAFC]">
                        <RotateCcw className="h-3.5 w-3.5 text-[#64748B]" />Clear Filters
                      </button>
                    ) : canCreate ? (
                      <Link to="/ecr/new" className="mt-3.5 inline-flex items-center gap-1.5 rounded-lg bg-[#1554D1] px-3.5 py-2 text-[12px] font-semibold text-white hover:bg-[#1042B0]">
                        <Plus className="h-3.5 w-3.5" />Create First ECR
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ) : (
                filtered.map((ecr) => {
                  const stage = getECRCurrentStage(ecr.select_pxfp, ecr);
                  const isReadyForRfq =
                    !isProcurementView &&
                    (stage === "RFQ Pending" || ecr.select_pxfp === "Approved" || ecr.select_pxfp === "RFQ Pending") &&
                    !ecr.rfq;
                  const ecrCode = formatECRNumber(ecr);

                  return (
                    <tr key={ecr.name} className="hover:bg-[#F8FAFC] transition-colors">
                      {/* ECR # */}
                      <td className="whitespace-nowrap px-3.5 py-2.5 font-bold text-[#1554D1]">
                        <Link to={`/ecr/${encodeURIComponent(ecrCode)}`} className="hover:underline">
                          {ecrCode}
                        </Link>
                      </td>

                      {/* Title */}
                      <td className="max-w-64 px-3.5 py-2.5">
                        <p className="truncate font-medium text-[#12213F]" title={ecr.ecr_title}>{ecr.ecr_title}</p>
                      </td>

                      {/* Department */}
                      <td className="whitespace-nowrap px-3 py-2.5 text-[#64748B]">{ecr.requesting_department || "Engineering"}</td>

                      {/* Priority */}
                      <td className="whitespace-nowrap px-3 py-2.5"><ECRPriorityBadge priority={ecr.priority} /></td>

                      {/* Supplier Required */}
                      <td className="whitespace-nowrap px-3 py-2.5 text-[#64748B]">
                        {ecr.selected_supplier || (ecr.supplier_response_required ? "Yes" : "No")}
                      </td>

                      {/* Target Date */}
                      <td className="whitespace-nowrap px-3 py-2.5 text-[#64748B]">{ecr.target_implementation_date || "—"}</td>

                      {/* Approval Status */}
                      <td className="whitespace-nowrap px-3 py-2.5"><ECRStatusBadge status={getRoleECRStageLabel(role, ecr)} /></td>

                      {/* Referenced RFQ or Approved On */}
                      {isProcurementView ? (
                        <td className="whitespace-nowrap px-3 py-2.5">
                          {ecr.rfq ? (
                            <Link to={`/sourcing/rfq/${encodeURIComponent(ecr.rfq)}`} className="font-semibold text-[#1554D1] hover:underline">
                              {ecr.rfq}
                            </Link>
                          ) : (
                            <span className="text-[#94A3B8]">Not linked</span>
                          )}
                        </td>
                      ) : (
                        <td className="whitespace-nowrap px-3 py-2.5 text-[#64748B]">{ecr.creation ? ecr.creation.slice(0, 10) : "—"}</td>
                      )}

                      {/* Action */}
                      <td className="whitespace-nowrap px-3.5 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {isReadyForRfq ? (
                            <Link
                              to={`/sourcing/rfq/new?ecr=${encodeURIComponent(ecrCode)}`}
                              className="inline-flex items-center gap-1 rounded-lg bg-[#1554D1] px-3 py-1.5 text-[12px] font-semibold text-white shadow-xs hover:bg-[#1042B0] transition-colors no-underline"
                            >
                              <span>Create RFQ</span>
                              <ArrowUpRight className="h-3.5 w-3.5" />
                            </Link>
                          ) : null}
                          <Link
                            to={`/ecr/${encodeURIComponent(ecrCode)}`}
                            className="inline-flex items-center rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1.5 text-[12px] font-semibold text-[#64748B] hover:bg-[#F8FAFC] hover:text-[#12213F] transition-colors no-underline"
                          >
                            View ECR
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {!isLoading && filtered.length > 0 ? (
          <div className="flex items-center justify-between border-t border-[#E2E8F0] bg-[#F8FAFC] px-4 py-2.5 text-[12px] text-[#64748B]">
            <span>Showing <strong className="text-[#12213F]">{filtered.length}</strong> of <strong className="text-[#12213F]">{visibleEcrs.length}</strong> requests</span>
            {hasActiveFilters ? <span className="text-[11px] font-semibold text-[#D97706]">Filtered list</span> : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
