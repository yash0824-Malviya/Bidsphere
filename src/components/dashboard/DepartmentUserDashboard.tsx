import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  FileText,
  Plus,
  TrendingUp,
} from "lucide-react";

import {
  getMaterialRequestMode,
  getMaterialRequestProcurementType,
  getMaterialRequestWorkflowStatus,
  listMaterialRequestsWorkflow,
} from "../../api/materialRequestWorkflow";
import { getDashboardConfig } from "../../config/dashboardRoles";
import { formatDate } from "../../utils/format";
import StatusBadge from "../StatusBadge";
import ProcurementTypeBadge from "../ProcurementTypeBadge";
import RequestModeBadge from "../RequestModeBadge";
import { Skeleton } from "../Skeleton";
import DashboardHeader from "./DashboardHeader";
import SlaCountdownWidget from "../sla/SlaCountdownWidget";

interface Props {
  greetingName: string;
}

const EMPTY_ROWS: Awaited<ReturnType<typeof listMaterialRequestsWorkflow>> = [];

function KpiCard({
  label,
  value,
  to,
  accent,
  icon,
}: {
  label: string;
  value: number;
  to: string;
  accent?: string;
  icon: React.ReactNode;
}) {
  return (
    <Link to={to} className="no-underline">
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm transition hover:border-primary-200 hover:shadow-md">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              {label}
            </p>
            <p
              className={`mt-2 text-3xl font-bold tabular-nums ${accent ?? "text-neutral-900"}`}
            >
              {value}
            </p>
          </div>
          <div className="rounded-lg bg-neutral-50 p-2 text-neutral-500">
            {icon}
          </div>
        </div>
      </div>
    </Link>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const classes =
    priority === "Urgent"
      ? "border-red-200 bg-red-50 text-red-700"
      : priority === "High"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-neutral-200 bg-neutral-50 text-neutral-600";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${classes}`}
    >
      {priority}
    </span>
  );
}

function isDraftRequest(status: string, workflow: string, docstatus: number) {
  return docstatus === 0 || workflow === "Draft" || status === "Draft";
}

function isCompletedRequest(status: string, workflow: string) {
  return (
    workflow === "Completed" ||
    workflow === "Material Issued" ||
    status === "Issued" ||
    status === "Completed"
  );
}

function isSubmittedRequest(
  status: string,
  workflow: string,
  docstatus: number,
) {
  if (isDraftRequest(status, workflow, docstatus)) return false;
  if (
    workflow === "Cancelled" ||
    status === "Cancelled" ||
    status === "Stopped"
  ) {
    return false;
  }

  return (
    docstatus === 1 ||
    status === "Pending" ||
    status === "Submitted" ||
    workflow === "Submitted" ||
    workflow === "Under Warehouse Review" ||
    workflow === "Stock Available" ||
    workflow === "Procurement Required" ||
    workflow === "Forwarded to Procurement" ||
    workflow === "RFQ Created"
  );
}

export default function DepartmentUserDashboard({ greetingName }: Props) {
  const config = getDashboardConfig("department");

  const rowsQuery = useQuery({
    queryKey: ["mr-dashboard-rows", "department"],
    queryFn: async () => {
      const rows = await listMaterialRequestsWorkflow();
      const sorted = [...rows].sort((a, b) =>
        (b.creation ?? b.modified ?? "").localeCompare(
          a.creation ?? a.modified ?? "",
        ),
      );

      if (import.meta.env.DEV) {
        console.log("[Department Dashboard] API response", {
          count: sorted.length,
          firstRecord: sorted[0]
            ? {
                name: sorted[0].name,
                creation: sorted[0].creation,
                status: sorted[0].status,
                docstatus: sorted[0].docstatus,
              }
            : null,
          lastRecord: sorted.at(-1)
            ? {
                name: sorted.at(-1)?.name,
                creation: sorted.at(-1)?.creation,
                status: sorted.at(-1)?.status,
                docstatus: sorted.at(-1)?.docstatus,
              }
            : null,
        });
      }

      return sorted;
    },
  });

  const rows = rowsQuery.data ?? EMPTY_ROWS;

  const counts = useMemo(() => {
    const mapped = rows.reduce(
      (acc, mr) => {
        const workflow = getMaterialRequestWorkflowStatus(mr);
        const status = (mr.status ?? "").trim();
        const docstatus = mr.docstatus ?? 0;

        acc.totalRequests += 1;
        if (isDraftRequest(status, workflow, docstatus)) {
          acc.draftCount += 1;
        }
        if (isSubmittedRequest(status, workflow, docstatus)) {
          acc.submittedCount += 1;
        }
        if (isCompletedRequest(status, workflow)) {
          acc.completedCount += 1;
        }
        return acc;
      },
      {
        totalRequests: 0,
        draftCount: 0,
        submittedCount: 0,
        completedCount: 0,
      },
    );

    if (import.meta.env.DEV) {
      console.log("[Department Dashboard] dashboard state after mapping", {
        rowCount: rows.length,
        mapped,
      });
    }

    return mapped;
  }, [rows]);

  return (
    <div className="dashboard-stack">
      <DashboardHeader config={config} greetingName={greetingName} />

      <div className="flex flex-wrap gap-3">
        <Link
          to="/material-requests/new"
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white no-underline hover:bg-primary-700"
        >
          <Plus className="h-4 w-4" />
          New Material Request
        </Link>
        <Link
          to="/material-requests/list"
          className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-800 no-underline hover:bg-neutral-50"
        >
          <ClipboardList className="h-4 w-4" />
          View All Requests
        </Link>
      </div>

      <SlaCountdownWidget role="department" title="My Request SLAs" />

      {rowsQuery.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : rowsQuery.isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load Material Requests from ERPNext.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Total Requests"
            value={counts.totalRequests}
            to="/material-requests/list"
            icon={<TrendingUp className="h-5 w-5" />}
          />
          <KpiCard
            label="Draft"
            value={counts.draftCount}
            to="/material-requests/list?status=Draft"
            accent="text-neutral-700"
            icon={<FileText className="h-5 w-5" />}
          />
          <KpiCard
            label="Submitted"
            value={counts.submittedCount}
            to="/material-requests/list?status=Submitted"
            accent="text-amber-700"
            icon={<ClipboardList className="h-5 w-5" />}
          />
          <KpiCard
            label="Completed"
            value={counts.completedCount}
            to="/material-requests/list?status=Completed"
            accent="text-emerald-700"
            icon={<CheckCircle2 className="h-5 w-5" />}
          />
        </div>
      )}

      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-3">
          <h3 className="text-sm font-bold text-neutral-900">
            Recent Requests
          </h3>
          <Link
            to="/material-requests/list"
            className="text-xs font-semibold text-primary-600 no-underline"
          >
            View all <ArrowRight className="inline h-3 w-3" />
          </Link>
        </div>

        {rowsQuery.isLoading ? (
          <div className="space-y-3 p-5">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
            <div className="rounded-full bg-neutral-100 p-3 text-neutral-500">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-neutral-900">
                No Material Requests found
              </p>
              <p className="mt-1 text-sm text-neutral-500">
                Material Requests from ERPNext will appear here automatically.
              </p>
            </div>
          </div>
        ) : (
          <div className="max-h-[560px] overflow-y-auto">
            <ul className="divide-y divide-neutral-100">
              {rows.map((mr) => {
                const purpose = mr.custom_purpose ?? mr.remarks ?? "—";

                return (
                  <li key={mr.name}>
                    <Link
                      to={`/material-requests/${encodeURIComponent(mr.name)}`}
                      className="flex items-center justify-between gap-4 px-5 py-4 no-underline transition hover:bg-neutral-50"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-neutral-900">
                            {mr.name}
                          </p>
                          <ProcurementTypeBadge
                            type={getMaterialRequestProcurementType(mr)}
                            withIcon={false}
                          />
                          <RequestModeBadge
                            mode={getMaterialRequestMode(mr)}
                          />
                          {mr.custom_priority ? (
                            <PriorityBadge priority={mr.custom_priority} />
                          ) : null}
                        </div>
                        <p className="mt-1 truncate text-xs text-neutral-500">
                          {formatDate(mr.transaction_date)} ·{" "}
                          {mr.custom_department ?? "—"} · {purpose}
                        </p>
                      </div>
                      <StatusBadge
                        status={getMaterialRequestWorkflowStatus(mr)}
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
