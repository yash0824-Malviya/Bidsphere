import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ClipboardList,
  Clock3,
  FileSearch,
  Plus,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { fetchECRList } from "../../../api/ecr";
import {
  ECR_WORKSPACES,
  formatECRNumber,
  isEcrOwnedBy,
  type ECRRole,
} from "../../../config/ecrRoles";
import {
  getECRAssignedTo,
  getECRCurrentStage,
  getECRListActionLabel,
  getECRListActionRoute,
  getECRQueueSummary,
  isECRActionableForRole,
} from "../../../config/ecrQueues";
import { useAuthStore } from "../../../store/authStore";
import type { EngineeringChangeRequest } from "../../../types/erpnext";
import ECREmptyState from "../ECREmptyState";
import ECRKpiCard from "../ECRKpiCard";
import ECRPriorityBadge from "../ECRPriorityBadge";
import ECRStatusBadge from "../ECRStatusBadge";

interface DashboardCard {
  label: string;
  value: number;
  hint: string;
  icon: LucideIcon;
  to: string;
}

type DashboardUser = ReturnType<typeof useAuthStore.getState>["user"];

function reviewDashboardCards(
  role: ECRRole,
  ecrs: EngineeringChangeRequest[],
  user: DashboardUser,
): DashboardCard[] {
  const summary = getECRQueueSummary(role, ecrs, user);
  return [
    {
      label: "My ECRs",
      value: summary.mine,
      hint: "ECRs created by me",
      icon: ClipboardList,
      to: "/ecr?filter=mine",
    },
    {
      label: "Pending Approval",
      value: summary.pending,
      hint: "Only your current review stage",
      icon: Clock3,
      to: "/ecr?filter=pending-approval",
    },
    {
      label: "Sent Back",
      value: summary.sentBack,
      hint: "Returned to me for revision",
      icon: RotateCcw,
      to: "/ecr?filter=sent-back",
    },
    {
      label: "Approved",
      value: summary.approved,
      hint: "Ready for downstream work",
      icon: CheckCircle2,
      to: "/ecr?filter=approved",
    },
    {
      label: "Closed",
      value: summary.closed,
      hint: "Completed ECR records",
      icon: Archive,
      to: "/ecr?filter=closed",
    },
  ];
}

export function procurementDashboardCards(
  role: Extract<ECRRole, "procurement" | "procurement_team">,
  ecrs: EngineeringChangeRequest[],
): DashboardCard[] {
  const atProcurementReview = ecrs.filter(
    (ecr) => isECRActionableForRole("procurement_team", ecr),
  ).length;
  const atRFQPending = ecrs.filter(
    (ecr) =>
      getECRCurrentStage(ecr.select_pxfp, ecr) === "RFQ Pending" &&
      isECRActionableForRole("procurement", ecr) &&
      !String(ecr.rfq ?? "").trim(),
  ).length;
  const atRFQ = ecrs.filter(
    (ecr) => Boolean(ecr.rfq) || getECRCurrentStage(ecr.select_pxfp) === "RFQ",
  ).length;
  if (role === "procurement_team") {
    return [
      {
        label: "Procurement Review",
        value: atProcurementReview,
        hint: "ECRs awaiting procurement review",
        icon: ClipboardList,
        to: "/ecr?filter=procurement-review",
      },
      {
        label: "All ECRs",
        value: ecrs.length,
        hint: "All engineering change requests",
        icon: FileSearch,
        to: "/ecr",
      },
    ];
  }

  return [
    {
      label: "RFQ Pending",
      value: atRFQPending,
      hint: "Create RFQ for approved ECRs",
      icon: FileSearch,
      to: "/ecr?filter=rfq-pending",
    },
    {
      label: "RFQ",
      value: atRFQ,
      hint: "RFQs created from ECRs",
      icon: CheckCircle2,
      to: "/ecr?filter=rfq-created",
    },
    {
      label: "All ECRs",
      value: ecrs.length,
      hint: "All engineering change requests",
      icon: ClipboardList,
      to: "/ecr",
    },
  ];
}

function readOnlyDashboardCards(ecrs: EngineeringChangeRequest[]): DashboardCard[] {
  return [
    {
      label: "All ECRs",
      value: ecrs.length,
      hint: "Read-only engineering changes",
      icon: ClipboardList,
      to: "/ecr",
    },
    {
      label: "Engineering Review",
      value: ecrs.filter((ecr) => getECRCurrentStage(ecr.select_pxfp, ecr) === "Engineering Review").length,
      hint: "Current engineering decisions",
      icon: Clock3,
      to: "/ecr",
    },
    {
      label: "Procurement",
      value: ecrs.filter((ecr) => getECRCurrentStage(ecr.select_pxfp, ecr) === "Procurement").length,
      hint: "RFQ action with Procurement",
      icon: FileSearch,
      to: "/ecr",
    },
    {
      label: "RFQ",
      value: ecrs.filter((ecr) => getECRCurrentStage(ecr.select_pxfp, ecr) === "RFQ").length,
      hint: "RFQ created",
      icon: CheckCircle2,
      to: "/ecr",
    },
  ];
}

function adminDashboardCards(ecrs: EngineeringChangeRequest[]): DashboardCard[] {
  const active = ecrs.filter((ecr) =>
    !["Closed", "Rejected", "Cancelled"].includes(getECRCurrentStage(ecr.select_pxfp)),
  ).length;
  return [
    { label: "All ECRs", value: ecrs.length, hint: "Registered requests", icon: ClipboardList, to: "/ecr" },
    { label: "Active", value: active, hint: "Open workflow items", icon: Clock3, to: "/ecr" },
    {
      label: "Approved",
      value: ecrs.filter((ecr) => getECRCurrentStage(ecr.select_pxfp) === "Approved").length,
      hint: "Ready for downstream workflow",
      icon: CheckCircle2,
      to: "/ecr?filter=approved",
    },
    {
      label: "Closed",
      value: ecrs.filter((ecr) => getECRCurrentStage(ecr.select_pxfp) === "Closed").length,
      hint: "Completed ECRs",
      icon: Archive,
      to: "/ecr?filter=closed",
    },
  ];
}

export function roleQueueRoute(role: ECRRole): string {
  switch (role) {
    case "engineer":
      return "/ecr?filter=mine";
    case "engineering":
      return "/ecr?filter=engineering";
    case "operations":
    case "quality":
    case "program_manager":
      return "/ecr";
    case "procurement_team":
      return "/ecr?filter=procurement-review";
    case "procurement":
      return "/ecr?filter=rfq-pending";
    case "admin":
      return "/ecr";
  }
}

export function getDashboardECRStageLabel(
  _role: ECRRole,
  ecr: EngineeringChangeRequest,
): string {
  return getECRCurrentStage(ecr.select_pxfp, ecr);
}

export function getDashboardECRActionLabel(
  role: ECRRole,
  ecr: EngineeringChangeRequest,
  user: DashboardUser,
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

export function getRoleDashboardQueue(
  role: ECRRole,
  ecrs: EngineeringChangeRequest[],
  user: DashboardUser,
): EngineeringChangeRequest[] {
  if (role === "procurement_team") {
    return ecrs.filter((ecr) => isECRActionableForRole(role, ecr, user));
  }
  if (role === "procurement") {
    return ecrs.filter(
      (ecr) =>
        getECRCurrentStage(ecr.select_pxfp, ecr) === "RFQ Pending" &&
        isECRActionableForRole(role, ecr, user) &&
        !String(ecr.rfq ?? "").trim(),
    );
  }
  if (["operations", "quality", "program_manager"].includes(role)) {
    return ecrs;
  }
  return ecrs.filter((ecr) => isECRActionableForRole(role, ecr, user));
}

function QueueTable({
  role,
  ecrs,
  user,
}: {
  role: ECRRole;
  ecrs: EngineeringChangeRequest[];
  user: DashboardUser;
}) {
  const procurementView = role === "procurement" || role === "procurement_team";
  const columnCount = procurementView ? 9 : 8;

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-xs text-neutral-700">
        <thead className="border-b border-neutral-200 bg-neutral-50 font-semibold uppercase tracking-wider text-neutral-600">
          <tr>
            <th className="whitespace-nowrap px-3.5 py-3">ECR #</th>
            <th className="whitespace-nowrap px-3.5 py-3">Title</th>
            <th className="whitespace-nowrap px-3 py-3">Type</th>
            <th className="whitespace-nowrap px-3 py-3">Priority</th>
            <th className="whitespace-nowrap px-3 py-3">Current Stage</th>
            <th className="whitespace-nowrap px-3 py-3">Assigned To</th>
            {procurementView ? <th className="whitespace-nowrap px-3 py-3">Procurement</th> : null}
            <th className="whitespace-nowrap px-3 py-3">Target Date</th>
            <th className="whitespace-nowrap px-3.5 py-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {ecrs.length === 0 ? (
            <tr>
              <td colSpan={columnCount} className="px-4 py-10 text-center text-xs text-neutral-500">
                No ECRs are assigned to this role at the current workflow stage.
              </td>
            </tr>
          ) : (
            ecrs.map((ecr) => {
              const actionLabel = getDashboardECRActionLabel(role, ecr, user);
              const actionRoute = getECRListActionRoute(role, ecr, user);
              const isActionable = actionLabel !== "View";
              return (
                <tr key={ecr.name} className="hover:bg-neutral-50/70">
                  <td className="whitespace-nowrap px-3.5 py-3 font-semibold text-primary-700">
                    <Link to={`/ecr/${encodeURIComponent(formatECRNumber(ecr))}`} className="hover:underline">
                      {formatECRNumber(ecr)}
                    </Link>
                  </td>
                  <td className="max-w-64 px-3.5 py-3">
                    <span className="block truncate font-medium text-neutral-900" title={ecr.ecr_title}>
                      {ecr.ecr_title}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">{ecr.ecr_type || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-3"><ECRPriorityBadge priority={ecr.priority} /></td>
                  <td className="whitespace-nowrap px-3 py-3"><ECRStatusBadge status={getDashboardECRStageLabel(role, ecr)} /></td>
                  <td className="whitespace-nowrap px-3 py-3">{getECRAssignedTo(ecr)}</td>
                  {procurementView ? <td className="whitespace-nowrap px-3 py-3">{getDashboardECRStageLabel(role, ecr)}</td> : null}
                  <td className="whitespace-nowrap px-3 py-3">{ecr.target_implementation_date || "—"}</td>
                  <td className="whitespace-nowrap px-3.5 py-3 text-right">
                    <Link
                      to={actionRoute}
                      className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                        isActionable
                          ? "bg-primary-600 text-white hover:bg-primary-700"
                          : "border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
                      }`}
                    >
                      {actionLabel}
                    </Link>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function RoleECRDashboard({ role }: { role: ECRRole }) {
  const workspace = ECR_WORKSPACES[role];
  const user = useAuthStore((state) => state.user);
  const query = useQuery({
    queryKey: ["ecr-dashboard", role, role === "engineer" ? user?.email || user?.name : "all"],
    queryFn: () => fetchECRList({
      limit: 300,
      owner: role === "engineer" ? user?.email || user?.name : undefined,
    }),
    staleTime: 30_000,
  });

  const scopedEcrs = useMemo(() => {
    const rows = query.data ?? [];
    return role === "engineer" ? rows.filter((ecr) => isEcrOwnedBy(ecr, user)) : rows;
  }, [query.data, role, user]);

  const cards = useMemo(() => {
    if (role === "procurement" || role === "procurement_team") {
      return procurementDashboardCards(role, scopedEcrs);
    }
    if (["operations", "quality", "program_manager"].includes(role)) {
      return readOnlyDashboardCards(scopedEcrs);
    }
    if (role === "admin") return adminDashboardCards(scopedEcrs);
    return reviewDashboardCards(role, scopedEcrs, user);
  }, [role, scopedEcrs, user]);

  const queue = useMemo(
    () => getRoleDashboardQueue(role, scopedEcrs, user),
    [role, scopedEcrs, user],
  );

  if (query.isLoading) {
    return (
      <div className="space-y-4 p-4 sm:p-6">
        <div className="h-14 animate-pulse rounded-lg bg-neutral-100" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => <div key={index} className="h-24 animate-pulse rounded-xl bg-neutral-100" />)}
        </div>
        <div className="h-72 animate-pulse rounded-xl bg-neutral-100" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="p-4 sm:p-6">
        <div className="rounded-xl border border-rose-200 bg-white p-8 text-center">
          <AlertTriangle className="mx-auto h-6 w-6 text-rose-500" />
          <h1 className="mt-3 text-base font-semibold text-neutral-900">Unable to load dashboard data.</h1>
          <p className="mt-1 text-xs text-neutral-500">The ECR service did not return dashboard records.</p>
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-700"
          >
            <RefreshCw className="h-3.5 w-3.5" />Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">{workspace.title}</h1>
          <p className="mt-1 text-sm text-neutral-500">{workspace.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {role === "engineer" ? (
            <Link
              to="/ecr/new"
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-primary-700"
            >
              <Plus className="h-3.5 w-3.5" />New ECR
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 shadow-xs hover:bg-neutral-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? "animate-spin text-primary-600" : ""}`} />
            Refresh
          </button>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5" aria-label="ECR queues">
        {cards.map((card) => (
          <Link key={card.label} to={card.to} className="rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500">
            <ECRKpiCard {...card} />
          </Link>
        ))}
      </section>

      <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-bold text-neutral-900">
              {role === "procurement_team"
                ? "Procurement Review"
                : role === "procurement"
                  ? "RFQ Pending"
                  : workspace.queueTitle}
            </h2>
            <p className="mt-0.5 text-[11px] text-neutral-500">
              {queue.length} item{queue.length === 1 ? "" : "s"} assigned to this role at the current stage
            </p>
          </div>
          <Link to={roleQueueRoute(role)} className="text-xs font-semibold text-primary-700 hover:underline">
            View queue
          </Link>
        </div>
        {queue.length === 0 ? (
          <ECREmptyState
            title={workspace.emptyTitle}
            description={
              role === "engineer"
                ? "Create an ECR or wait for a reviewer to return one for revision."
                : "An item appears only when the workflow reaches this role's stage."
            }
            createAction={role === "engineer"}
          />
        ) : (
          <QueueTable role={role} ecrs={queue} user={user} />
        )}
      </section>
    </div>
  );
}
