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
  type ECRRole,
} from "../../config/ecrRoles";
import {
  getECRAssignedTo,
  getECRCurrentStage,
  getECRListActionLabel,
  getECRListActionRoute,
  isECRActionableForRole,
  isPendingFilter,
  isPendingApprovalForRole,
  matchesECRQueueFilter,
} from "../../config/ecrQueues";
import { useAuthStore } from "../../store/authStore";
import type { EngineeringChangeRequest, ECRType } from "../../types/erpnext";

const ECR_TYPES: ECRType[] = [
  "Part Change",
  "Design Change",
  "Material Change",
  "Process Change",
  "Tooling Change",
  "Supplier Change",
  "Quality Change",
  "Packaging Change",
  "Cost Change",
  "Other",
];

interface QueueFilterDefinition {
  label: string;
  value: string;
}

const REVIEW_QUEUE_FILTERS: QueueFilterDefinition[] = [
  { label: "All", value: "all" },
  { label: "My ECRs", value: "mine" },
  { label: "Pending Approval", value: "pending-approval" },
  { label: "Sent Back", value: "sent-back" },
  { label: "Approved", value: "approved" },
  { label: "Closed", value: "closed" },
];

const PROCUREMENT_TEAM_FILTERS: QueueFilterDefinition[] = [
  { label: "Procurement Review", value: "procurement-review" },
  { label: "All ECRs", value: "all" },
];

const PROCUREMENT_MANAGER_FILTERS: QueueFilterDefinition[] = [
  { label: "RFQ Pending", value: "rfq-pending" },
  { label: "RFQ", value: "rfq-created" },
  { label: "All ECRs", value: "all" },
];

export function queueFiltersForRole(role?: ECRRole | null): QueueFilterDefinition[] {
  if (role === "procurement_team") return PROCUREMENT_TEAM_FILTERS;
  if (role === "procurement") return PROCUREMENT_MANAGER_FILTERS;
  return REVIEW_QUEUE_FILTERS;
}

export function matchesVisibleQueueFilter(
  filter: string,
  role: ECRRole | null,
  ecr: EngineeringChangeRequest,
  user: ReturnType<typeof useAuthStore.getState>["user"],
): boolean {
  const normalized = filter.toLowerCase().trim().replaceAll("_", "-");
  if (normalized === "procurement-review") {
    return (
      role === "procurement_team" &&
      getECRCurrentStage(ecr.select_pxfp, ecr) === "Procurement Review" &&
      isPendingApprovalForRole(role, ecr)
    );
  }
  if (["rfq-pending", "create-rfq", "rfq-required"].includes(normalized)) {
    return (
      role === "procurement" &&
      getECRCurrentStage(ecr.select_pxfp, ecr) === "RFQ Pending" &&
      isPendingApprovalForRole(role, ecr) &&
      !String(ecr.rfq ?? "").trim()
    );
  }
  if (normalized === "rfq-created") {
    return Boolean(ecr.rfq) || getECRCurrentStage(ecr.select_pxfp, ecr) === "RFQ";
  }
  return matchesECRQueueFilter(filter, role, ecr, user);
}

export function activeQueueValue(filter: string, role?: ECRRole | null): string {
  const normalized = filter.toLowerCase().trim().replaceAll("_", "-");
  if (isPendingFilter(normalized)) return "pending-approval";
  if (normalized === "needs-revision") return "sent-back";
  if (normalized === "completed") return "completed";
  if (role === "procurement_team" && normalized === "procurement") {
    return "procurement-review";
  }
  if (
    role === "procurement" &&
    ["create-rfq", "rfq-required"].includes(normalized)
  ) {
    return "rfq-pending";
  }
  return normalized || "all";
}

function isProcurementQueueFilter(filter: string): boolean {
  return [
    "approved",
    "procurement-review",
    "rfq-pending",
    "create-rfq",
    "rfq-created",
    "closed",
  ].includes(filter.toLowerCase().trim().replaceAll("_", "-"));
}

export function getRoleECRStageLabel(
  _role: ECRRole | null | undefined,
  ecr: EngineeringChangeRequest,
): string {
  return getECRCurrentStage(ecr.select_pxfp, ecr);
}

export function getVisibleECRListActionLabel(
  role: ECRRole | null | undefined,
  ecr: EngineeringChangeRequest,
  user: ReturnType<typeof useAuthStore.getState>["user"],
): ReturnType<typeof getECRListActionLabel> {
  const stage = getECRCurrentStage(ecr.select_pxfp, ecr);
  if (
    role === "procurement_team" &&
    stage === "Procurement Review" &&
    isECRActionableForRole(role, ecr, user)
  ) {
    return "Review";
  }
  if (
    role === "procurement" &&
    stage === "RFQ Pending" &&
    isECRActionableForRole(role, ecr, user) &&
    !String(ecr.rfq ?? "").trim()
  ) {
    return "Create RFQ";
  }
  return getECRListActionLabel(role, ecr, user);
}

export default function ECRListPage() {
  const user = useAuthStore((state) => state.user);
  const role = user?.role && isECRRole(user.role) ? user.role : null;
  const workspace = role ? ECR_WORKSPACES[role] : null;
  const [searchParams, setSearchParams] = useSearchParams();
  const routeFilter = searchParams.get("filter") || "all";
  const activeQueue = activeQueueValue(routeFilter, role);

  const [search, setSearch] = useState("");
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
      if (!matchesVisibleQueueFilter(routeFilter, role, ecr, user)) return false;
      if (priorityFilter !== "all" && ecr.priority !== priorityFilter) return false;
      if (typeFilter !== "all" && ecr.ecr_type !== typeFilter) return false;
      if (departmentFilter !== "all" && ecr.requesting_department !== departmentFilter) return false;
      if (supplierReqFilter !== "all" && ecr.supplier_response_required !== supplierReqFilter) return false;
      if (targetDateFilter && ecr.target_implementation_date !== targetDateFilter) return false;

      const query = search.trim().toLowerCase();
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
    role,
    routeFilter,
    search,
    supplierReqFilter,
    targetDateFilter,
    typeFilter,
    user,
    visibleEcrs,
  ]);

  const procurementRole = role === "procurement" || role === "procurement_team";
  const showProcurementColumn =
    procurementRole &&
    isProcurementQueueFilter(routeFilter);
  const tableColumnCount = showProcurementColumn ? 9 : 8;

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
    activeQueue !== "all" ||
    priorityFilter !== "all" ||
    typeFilter !== "all" ||
    departmentFilter !== "all" ||
    supplierReqFilter !== "all" ||
    targetDateFilter !== "";

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">{workspace?.title ?? "Engineering Changes"}</h1>
          <p className="mt-0.5 text-xs text-neutral-500">
            {workspace?.description ?? "Manage engineering change requests."}
          </p>
        </div>
        {canCreate ? (
          <Link
            to="/ecr/new"
            className="inline-flex items-center gap-1.5 self-start rounded-lg bg-primary-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-primary-700"
          >
            <Plus className="h-4 w-4" />New ECR
          </Link>
        ) : null}
      </header>

      <nav
        className="flex flex-wrap items-center gap-1.5 rounded-xl border border-neutral-200 bg-white p-2 text-xs shadow-sm"
        aria-label="ECR queues"
      >
        <span className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
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
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                isActive
                  ? "border-primary-600 bg-primary-600 text-white"
                  : "border-neutral-200 bg-neutral-50 text-neutral-700 hover:bg-neutral-100"
              }`}
            >
              <span>{filter.label}</span>
              <span className={`rounded-full px-1.5 text-[10px] font-semibold ${isActive ? "bg-primary-700" : "bg-neutral-200"}`}>
                {queueCounts[filter.value] ?? 0}
              </span>
            </button>
          );
        })}
      </nav>

      <section className="space-y-3 rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search ECR number, title, stage, or assignee…"
              className="w-full rounded-lg border border-neutral-300 bg-neutral-50/50 py-1.5 pl-9 pr-3 text-xs text-neutral-800 placeholder:text-neutral-400 focus:border-primary-500 focus:bg-white focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
              >
                <RotateCcw className="h-3.5 w-3.5 text-neutral-400" />Reset
              </button>
            ) : null}
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

        <div className="grid grid-cols-2 gap-2 border-t border-neutral-100 pt-2 text-xs sm:grid-cols-5">
          <label className="text-[10px] font-semibold uppercase text-neutral-500">
            Priority
            <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs font-normal normal-case text-neutral-700 focus:border-primary-500 focus:outline-none">
              <option value="all">All Priorities</option>
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
              <option value="Critical">Critical</option>
            </select>
          </label>
          <label className="text-[10px] font-semibold uppercase text-neutral-500">
            ECR Type
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs font-normal normal-case text-neutral-700 focus:border-primary-500 focus:outline-none">
              <option value="all">All Types</option>
              {ECR_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <label className="text-[10px] font-semibold uppercase text-neutral-500">
            Department
            <select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)} className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs font-normal normal-case text-neutral-700 focus:border-primary-500 focus:outline-none">
              <option value="all">All Departments</option>
              {departments.map((department) => <option key={department} value={department}>{department}</option>)}
            </select>
          </label>
          <label className="text-[10px] font-semibold uppercase text-neutral-500">
            Supplier Required
            <select value={supplierReqFilter} onChange={(event) => setSupplierReqFilter(event.target.value)} className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs font-normal normal-case text-neutral-700 focus:border-primary-500 focus:outline-none">
              <option value="all">All</option>
              <option value="Yes">Yes</option>
              <option value="No">No</option>
            </select>
          </label>
          <label className="text-[10px] font-semibold uppercase text-neutral-500">
            Target Date
            <input type="date" value={targetDateFilter} onChange={(event) => setTargetDateFilter(event.target.value)} className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs font-normal normal-case text-neutral-700 focus:border-primary-500 focus:outline-none" />
          </label>
        </div>
      </section>

      {isError ? (
        <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{error instanceof Error ? error.message : "Failed to load Engineering Change Requests."}</span>
          <button type="button" onClick={() => void refetch()} className="ml-auto font-semibold underline hover:no-underline">Retry</button>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-neutral-700">
            <thead className="border-b border-neutral-200 bg-neutral-50 font-semibold uppercase tracking-wider text-neutral-600">
              <tr>
                <th className="whitespace-nowrap px-3.5 py-3">ECR #</th>
                <th className="whitespace-nowrap px-3.5 py-3">Title</th>
                <th className="whitespace-nowrap px-3 py-3">Type</th>
                <th className="whitespace-nowrap px-3 py-3">Priority</th>
                <th className="whitespace-nowrap px-3 py-3">Current Stage</th>
                <th className="whitespace-nowrap px-3 py-3">Assigned To</th>
                {showProcurementColumn ? <th className="whitespace-nowrap px-3 py-3">Procurement</th> : null}
                <th className="whitespace-nowrap px-3 py-3">Target Date</th>
                <th className="whitespace-nowrap px-3.5 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {isLoading ? (
                Array.from({ length: 6 }, (_, row) => (
                  <tr key={row} className="animate-pulse">
                    {Array.from({ length: tableColumnCount }, (_, column) => (
                      <td key={column} className="px-3.5 py-3"><div className="h-3.5 rounded bg-neutral-200" /></td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={tableColumnCount} className="py-12 text-center">
                    <Factory className="mx-auto mb-2 h-8 w-8 text-neutral-300" />
                    <p className="text-sm font-semibold text-neutral-700">No ECRs in this queue</p>
                    <p className="mt-0.5 text-xs text-neutral-400">
                      Pending items appear only when the workflow reaches this role's stage.
                    </p>
                    {hasActiveFilters ? (
                      <button type="button" onClick={resetFilters} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">
                        <RotateCcw className="h-3.5 w-3.5 text-neutral-400" />Clear Filters
                      </button>
                    ) : canCreate ? (
                      <Link to="/ecr/new" className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-primary-700">
                        <Plus className="h-3.5 w-3.5" />Create First ECR
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ) : (
                filtered.map((ecr) => {
                  const actionLabel = getVisibleECRListActionLabel(role, ecr, user);
                  const actionRoute = getECRListActionRoute(role, ecr, user);
                  const actionable = actionLabel !== "View";
                  return (
                    <tr key={ecr.name} className="hover:bg-neutral-50/80">
                      <td className="whitespace-nowrap px-3.5 py-2.5 font-semibold text-primary-700">
                        <Link to={`/ecr/${encodeURIComponent(formatECRNumber(ecr))}`} className="hover:underline">{formatECRNumber(ecr)}</Link>
                      </td>
                      <td className="max-w-64 px-3.5 py-2.5">
                        <p className="truncate font-medium text-neutral-900" title={ecr.ecr_title}>{ecr.ecr_title}</p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">{ecr.ecr_type || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2.5"><ECRPriorityBadge priority={ecr.priority} /></td>
                      <td className="whitespace-nowrap px-3 py-2.5"><ECRStatusBadge status={getRoleECRStageLabel(role, ecr)} /></td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-neutral-600">{getECRAssignedTo(ecr)}</td>
                      {showProcurementColumn ? <td className="whitespace-nowrap px-3 py-2.5">{getRoleECRStageLabel(role, ecr)}</td> : null}
                      <td className="whitespace-nowrap px-3 py-2.5 text-neutral-600">{ecr.target_implementation_date || "—"}</td>
                      <td className="whitespace-nowrap px-3.5 py-2.5 text-right">
                        <Link
                          to={actionRoute}
                          className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                            actionable
                              ? "bg-primary-600 text-white hover:bg-primary-700"
                              : "border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
                          }`}
                        >
                          {actionLabel}<ArrowUpRight className="h-3.5 w-3.5" />
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {!isLoading && filtered.length > 0 ? (
          <div className="flex items-center justify-between border-t border-neutral-100 bg-neutral-50/60 px-4 py-2.5 text-xs text-neutral-500">
            <span>Showing <strong className="text-neutral-700">{filtered.length}</strong> of <strong className="text-neutral-700">{visibleEcrs.length}</strong> requests</span>
            {hasActiveFilters ? <span className="text-[11px] font-medium text-amber-600">Filtered queue</span> : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
