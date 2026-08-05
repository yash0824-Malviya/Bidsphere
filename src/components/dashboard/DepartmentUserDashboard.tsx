import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ClipboardList,
  Eye,
  FileText,
  PackageCheck,
  Plus,
  RefreshCw,
  Send,
  TrendingUp,
  Truck,
  Warehouse,
} from "lucide-react";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  getMaterialRequestProcurementType,
  getMaterialRequestWorkflowStatus,
  listMaterialRequestsWorkflow,
  type MaterialRequestWorkflowRecord,
} from "../../api/materialRequestWorkflow";
import { getUploadedBomHistory } from "../../api/uploadedBom";
import {
  countDepartmentPendingAcceptance,
  listDepartmentPendingAcceptanceLocal,
} from "../../api/departmentIssuedItems";
import { getDashboardConfig } from "../../config/dashboardRoles";
import type { MaterialRequestWorkflowStatus } from "../../types/materialRequestWorkflow";
import { formatDate, formatDateTime } from "../../utils/format";
import { toEnterpriseUserMessage } from "../../utils/enterpriseUserMessage";
import StatusBadge from "../StatusBadge";
import ProcurementTypeBadge from "../ProcurementTypeBadge";
import { Skeleton } from "../Skeleton";
import DashboardHeader from "./DashboardHeader";
import DashboardKpiCard, {
  DashboardKpiGrid,
  DashboardKpiSkeleton,
} from "./DashboardKpiCard";
import DepartmentPerformanceKpis from "./DepartmentPerformanceKpis";

interface Props {
  greetingName: string;
}

const EMPTY_ROWS: MaterialRequestWorkflowRecord[] = [];

const CHART_TOOLTIP = {
  backgroundColor: "#fff",
  border: "1px solid #E2E8F0",
  borderRadius: 8,
  fontSize: 12,
};

const CHART_AXIS = {
  tick: { fill: "#64748B", fontSize: 11 },
  axisLine: false as const,
  tickLine: false as const,
};

const PIE_COLORS = {
  Direct: "#1993FF",
  Indirect: "#64748B",
};

type StageKey =
  | "draft"
  | "submitted"
  | "warehouse"
  | "procurement"
  | "completed";

const STAGE_META: {
  key: StageKey;
  label: string;
  color: string;
}[] = [
  { key: "draft", label: "Draft", color: "#94A3B8" },
  { key: "submitted", label: "Submitted", color: "#F59E0B" },
  { key: "warehouse", label: "Warehouse", color: "#0EA5E9" },
  { key: "procurement", label: "Procurement", color: "#3B82F6" },
  { key: "completed", label: "Completed", color: "#10B981" },
];

function PriorityBadge({ priority }: { priority: string }) {
  const classes =
    priority === "Urgent" || priority === "High"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : priority === "Medium"
        ? "border-sky-200 bg-sky-50 text-sky-700"
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
  return workflow === "Completed" || status === "Completed";
}

/** KPI: actively under warehouse review (not yet issued / procurement). */
function isUnderWarehouseReview(workflow: string) {
  return (
    workflow === "Under Warehouse Review" ||
    workflow === "Stock Available" ||
    workflow === "Admin Review"
  );
}

/** Status overview bucket: warehouse-owned fulfillment path. */
function isWarehouseStage(workflow: string) {
  return (
    isUnderWarehouseReview(workflow) ||
    workflow === "Admin Review" ||
    workflow === "Material Issued" ||
    workflow === "Pending Department Acceptance" ||
    workflow === "Partially Issued"
  );
}

function isSentToProcurement(workflow: string) {
  return (
    workflow === "Procurement Required" ||
    workflow === "Forwarded to Procurement" ||
    workflow === "RFQ Created"
  );
}

function isSubmittedBucket(
  status: string,
  workflow: string,
  docstatus: number,
) {
  if (isDraftRequest(status, workflow, docstatus)) return false;
  if (isCompletedRequest(status, workflow)) return false;
  if (isWarehouseStage(workflow) || isSentToProcurement(workflow)) return false;
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
    workflow === "Submitted"
  );
}

function classifyStage(
  status: string,
  workflow: MaterialRequestWorkflowStatus,
  docstatus: number,
): StageKey {
  if (isDraftRequest(status, workflow, docstatus)) return "draft";
  if (isCompletedRequest(status, workflow)) return "completed";
  if (isSentToProcurement(workflow)) return "procurement";
  if (isWarehouseStage(workflow)) return "warehouse";
  return "submitted";
}

/** Approximate workflow progress from status alone (fast, no per-row fetch). */
function workflowProgressPct(
  workflow: MaterialRequestWorkflowStatus,
  docstatus: number,
): number {
  if (docstatus === 0 || workflow === "Draft") return 8;
  if (workflow === "Cancelled") return 0;
  if (workflow === "Submitted") return 20;
  if (
    workflow === "Under Warehouse Review" ||
    workflow === "Stock Available" ||
    workflow === "Admin Review"
  ) {
    return 35;
  }
  if (
    workflow === "Procurement Required" ||
    workflow === "Forwarded to Procurement"
  ) {
    return 50;
  }
  if (workflow === "RFQ Created") return 60;
  if (workflow === "Partially Issued") return 70;
  if (
    workflow === "Material Issued" ||
    workflow === "Pending Department Acceptance"
  ) {
    return 85;
  }
  if (workflow === "Completed") return 100;
  return 25;
}

function parseDateMs(value?: string | null): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function daysBetween(from?: string | null, to?: string | null): number | null {
  const a = parseDateMs(from);
  const b = parseDateMs(to);
  if (a == null || b == null || b < a) return null;
  return (b - a) / 86_400_000;
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "short" });
}

function normalizePriority(raw?: string | null): "High" | "Medium" | "Low" {
  const p = (raw ?? "").trim().toLowerCase();
  if (p === "urgent" || p === "high") return "High";
  if (p === "low") return "Low";
  return "Medium";
}

function Panel({
  title,
  action,
  children,
  className = "",
  bodyClassName = "",
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={`dashboard-panel ${className}`.trim()}>
      <div className="dashboard-panel-header justify-between">
        <h3 className="text-sm font-bold text-neutral-900">{title}</h3>
        {action}
      </div>
      <div className={`dashboard-panel-body ${bodyClassName}`.trim()}>
        {children}
      </div>
    </div>
  );
}

export default function DepartmentUserDashboard({ greetingName }: Props) {
  const config = getDashboardConfig("department");

  const rowsQuery = useQuery({
    queryKey: ["mr-dashboard-rows", "department"],
    queryFn: async () => {
      const rows = await listMaterialRequestsWorkflow();
      return [...rows].sort((a, b) =>
        (b.modified ?? b.creation ?? "").localeCompare(
          a.modified ?? a.creation ?? "",
        ),
      );
    },
    retry: 1,
  });

  const rows = rowsQuery.data ?? EMPTY_ROWS;
  const rowsErrorMessage = rowsQuery.isError
    ? toEnterpriseUserMessage(
        rowsQuery.error,
        "Unable to load Material Requests right now. Please try again.",
      )
    : null;

  const pendingAcceptanceQuery = useQuery({
    queryKey: ["department-issued-items", "kpi", "pending"],
    queryFn: () => countDepartmentPendingAcceptance(),
    staleTime: 30_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const pendingAcceptance = pendingAcceptanceQuery.data ?? 0;
  const pendingReceipts = listDepartmentPendingAcceptanceLocal();

  const bomHistoryQuery = useQuery({
    queryKey: ["uploaded-bom-history", "department-dashboard"],
    queryFn: getUploadedBomHistory,
    staleTime: 60_000,
  });

  const analytics = useMemo(() => {
    const now = new Date();
    const thisMonth = monthKey(now);

    const stageCounts: Record<StageKey, number> = {
      draft: 0,
      submitted: 0,
      warehouse: 0,
      procurement: 0,
      completed: 0,
    };

    let warehouseReview = 0;
    let sentToProcurement = 0;
    let draftCount = 0;
    let submittedCount = 0;
    let completedCount = 0;
    let direct = 0;
    let indirect = 0;
    let high = 0;
    let medium = 0;
    let low = 0;
    let thisMonthCount = 0;
    let todayCount = 0;
    let clarification = 0;
    let rejected = 0;

    const approvalDays: number[] = [];
    const issueDays: number[] = [];

    const monthBuckets: { key: string; label: string; count: number }[] = [];
    for (let i = 11; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = monthKey(d);
      monthBuckets.push({ key, label: monthLabel(key), count: 0 });
    }
    const monthIndex = new Map(monthBuckets.map((m, i) => [m.key, i]));

    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).getTime();

    for (const mr of rows) {
      const workflow = getMaterialRequestWorkflowStatus(mr);
      const status = (mr.status ?? "").trim();
      const docstatus = mr.docstatus ?? 0;
      const stage = classifyStage(status, workflow, docstatus);
      stageCounts[stage] += 1;

      if (isDraftRequest(status, workflow, docstatus)) draftCount += 1;
      if (isSubmittedBucket(status, workflow, docstatus)) submittedCount += 1;
      if (isUnderWarehouseReview(workflow)) {
        warehouseReview += 1;
      }
      if (isSentToProcurement(workflow)) sentToProcurement += 1;
      if (isCompletedRequest(status, workflow)) completedCount += 1;

      if (getMaterialRequestProcurementType(mr) === "Indirect") indirect += 1;
      else direct += 1;

      const pri = normalizePriority(mr.custom_priority);
      if (pri === "High") high += 1;
      else if (pri === "Low") low += 1;
      else medium += 1;

      const created =
        parseDateMs(mr.creation) ?? parseDateMs(mr.transaction_date);
      if (created != null) {
        const key = monthKey(new Date(created));
        const idx = monthIndex.get(key);
        if (idx != null) monthBuckets[idx].count += 1;
        if (key === thisMonth) thisMonthCount += 1;
        if (created >= todayStart) todayCount += 1;
      }

      const remarks = `${mr.custom_warehouse_remarks ?? ""} ${mr.remarks ?? ""} ${mr.custom_purpose ?? ""}`.toLowerCase();
      if (remarks.includes("clarification")) clarification += 1;

      if (
        workflow === "Cancelled" ||
        status === "Cancelled" ||
        status === "Stopped" ||
        status === "Rejected"
      ) {
        rejected += 1;
      }

      if (!isDraftRequest(status, workflow, docstatus)) {
        const d = daysBetween(mr.creation ?? mr.transaction_date, mr.modified);
        if (d != null) approvalDays.push(d);
      }
      if (isCompletedRequest(status, workflow)) {
        const d = daysBetween(mr.transaction_date ?? mr.creation, mr.modified);
        if (d != null) issueDays.push(d);
      }
    }

    const total = rows.length;
    const completionRate = total === 0 ? 0 : (completedCount / total) * 100;

    return {
      total,
      draftCount,
      submittedCount,
      warehouseReview,
      sentToProcurement,
      completedCount,
      stageCounts,
      direct,
      indirect,
      high,
      medium,
      low,
      thisMonthCount,
      todayCount,
      clarification,
      rejected,
      monthBuckets,
      avgApproval: avg(approvalDays),
      avgIssue: avg(issueDays),
      completionRate,
    };
  }, [rows]);

  const performanceMetrics = useMemo(() => {
    const now = new Date();
    const thisMonth = monthKey(now);
    const bomRows = bomHistoryQuery.data ?? [];
    const bomUploadedMonth = bomRows.filter((row) => {
      const d = row.upload_date?.slice(0, 7);
      return d === thisMonth;
    }).length;

    return {
      pendingRequests:
        analytics.draftCount + analytics.submittedCount + analytics.warehouseReview,
      pendingToday: analytics.todayCount,
      bomUploadedMonth,
      approvalRate: analytics.completionRate,
      materialRequestsTotal: analytics.total,
    };
  }, [analytics, bomHistoryQuery.data]);

  const recentRows = useMemo(() => rows.slice(0, 6), [rows]);

  const pendingActions = useMemo(() => {
    const actions: {
      id: string;
      label: string;
      detail: string;
      to: string;
      tone: string;
    }[] = [];

    if (analytics.draftCount > 0) {
      actions.push({
        id: "drafts",
        label: "Draft waiting to submit",
        detail: `${analytics.draftCount} request${analytics.draftCount === 1 ? "" : "s"}`,
        to: "/material-requests/list?status=Draft",
        tone: "border-neutral-200 bg-neutral-50 text-neutral-800",
      });
    }

    if (pendingAcceptance > 0) {
      const first = pendingReceipts[0];
      actions.push({
        id: "acceptance",
        label: "Pending acceptance",
        detail: `${pendingAcceptance} receipt${pendingAcceptance === 1 ? "" : "s"} awaiting signature`,
        to: first
          ? `/department/issued-items/receipts/${encodeURIComponent(first.issue_number)}`
          : "/department/issued-items/pending-acceptance",
        tone: "border-amber-200 bg-amber-50 text-amber-900",
      });
    }

    if (analytics.clarification > 0) {
      actions.push({
        id: "clarification",
        label: "Clarification requested",
        detail: `${analytics.clarification} request${analytics.clarification === 1 ? "" : "s"} need a response`,
        to: "/material-requests/list",
        tone: "border-sky-200 bg-sky-50 text-sky-900",
      });
    }

    if (analytics.rejected > 0) {
      actions.push({
        id: "rejected",
        label: "Rejected — needs updates",
        detail: `${analytics.rejected} request${analytics.rejected === 1 ? "" : "s"}`,
        to: "/material-requests/list",
        tone: "border-red-200 bg-red-50 text-red-800",
      });
    }

    return actions;
  }, [
    analytics.draftCount,
    analytics.clarification,
    analytics.rejected,
    pendingAcceptance,
    pendingReceipts,
  ]);

  const activityItems = useMemo(() => {
    return rows.slice(0, 8).map((mr) => {
      const workflow = getMaterialRequestWorkflowStatus(mr);
      return {
        id: mr.name,
        title: mr.name,
        subtitle: workflow,
        when: mr.modified ?? mr.creation ?? mr.transaction_date,
        to: `/material-requests/${encodeURIComponent(mr.name)}`,
      };
    });
  }, [rows]);

  const stageTotal = Math.max(
    1,
    STAGE_META.reduce((s, m) => s + analytics.stageCounts[m.key], 0),
  );

  const distributionData = [
    { name: "Direct", value: analytics.direct },
    { name: "Indirect", value: analytics.indirect },
  ].filter((d) => d.value > 0);

  const priorityMax = Math.max(analytics.high, analytics.medium, analytics.low, 1);

  const quickAccess = [
    {
      label: "New Request",
      to: "/material-requests/new",
      icon: Plus,
      tone: "bg-primary-50 text-primary-700",
    },
    {
      label: "My Requests",
      to: "/material-requests/list",
      icon: ClipboardList,
      tone: "bg-sky-50 text-sky-700",
    },
    {
      label: "Track Request",
      to: "/material-requests/list",
      icon: Eye,
      tone: "bg-indigo-50 text-indigo-700",
    },
    {
      label: "Issued Items",
      to: "/department/issued-items/pending-acceptance",
      icon: PackageCheck,
      tone: "bg-amber-50 text-amber-700",
    },
    {
      label: "Notifications",
      to: "/notifications",
      icon: Bell,
      tone: "bg-neutral-100 text-neutral-700",
    },
  ] as const;

  return (
    <div className="dashboard-stack gap-4 xl:gap-5">
      {/* 1. Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <DashboardHeader config={config} greetingName={greetingName} />
        <div className="flex flex-wrap gap-2">
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
      </div>

      {/* 2. KPI Cards */}
      {rowsQuery.isLoading ? (
        <DashboardKpiSkeleton count={6} columns={6} />
      ) : rowsQuery.isError ? (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-card border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="flex min-w-0 items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="min-w-0">
              <p className="font-semibold">Unable to load Material Requests</p>
              <p className="mt-0.5 text-amber-800/90">{rowsErrorMessage}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void rowsQuery.refetch()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </button>
        </div>
      ) : (
        <DashboardKpiGrid columns={6}>
          <DashboardKpiCard
            label="Total Requests"
            value={analytics.total}
            to="/material-requests/list"
            icon={TrendingUp}
            iconClassName="bg-neutral-50 text-neutral-500"
          />
          <DashboardKpiCard
            label="Draft"
            value={analytics.draftCount}
            to="/material-requests/list?status=Draft"
            icon={FileText}
            iconClassName="bg-neutral-50 text-neutral-700"
            valueClassName="text-neutral-700"
          />
          <DashboardKpiCard
            label="Submitted"
            value={analytics.submittedCount}
            to="/material-requests/list?status=Submitted"
            icon={Send}
            iconClassName="bg-amber-50 text-amber-700"
            valueClassName="text-amber-700"
          />
          <DashboardKpiCard
            label="Under Warehouse Review"
            value={analytics.warehouseReview}
            to="/material-requests/list?f=pending"
            icon={Warehouse}
            iconClassName="bg-sky-50 text-sky-700"
            valueClassName="text-sky-700"
          />
          <DashboardKpiCard
            label="Sent to Procurement"
            value={analytics.sentToProcurement}
            to="/material-requests/list?f=procurement"
            icon={Truck}
            iconClassName="bg-blue-50 text-blue-700"
            valueClassName="text-blue-700"
          />
          <DashboardKpiCard
            label="Completed"
            value={analytics.completedCount}
            to="/material-requests/list?status=Completed"
            icon={CheckCircle2}
            iconClassName="bg-emerald-50 text-emerald-700"
            valueClassName="text-emerald-700"
          />
        </DashboardKpiGrid>
      )}

      {/* 3. Request Status Overview */}
      <Panel title="Request Status Overview" bodyClassName="py-4">
        {rowsQuery.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : rowsQuery.isError ? (
          <p className="text-sm text-neutral-500">
            Charts will appear once Material Requests load successfully.
          </p>
        ) : analytics.total === 0 ? (
          <p className="text-sm text-neutral-500">No requests to visualize yet.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-neutral-100">
              {STAGE_META.map((stage) => {
                const count = analytics.stageCounts[stage.key];
                if (count === 0) return null;
                return (
                  <div
                    key={stage.key}
                    className="h-full"
                    style={{
                      width: `${(count / stageTotal) * 100}%`,
                      backgroundColor: stage.color,
                    }}
                    title={`${stage.label}: ${count}`}
                  />
                );
              })}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {STAGE_META.map((stage) => (
                <div key={stage.key} className="flex items-center gap-2 text-xs">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: stage.color }}
                  />
                  <span className="font-medium text-neutral-600">
                    {stage.label}
                  </span>
                  <span className="tabular-nums font-semibold text-neutral-900">
                    {analytics.stageCounts[stage.key]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Panel>

      {/* 4 + 5. Recent Requests + Pending Actions */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12 xl:gap-5">
        <div className="xl:col-span-8">
          <Panel
            title="Recent Requests"
            action={
              <Link
                to="/material-requests/list"
                className="text-xs font-semibold text-primary-600 no-underline"
              >
                View all
              </Link>
            }
            bodyClassName="p-0"
          >
            {rowsQuery.isLoading ? (
              <div className="space-y-2 p-4">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : rowsQuery.isError ? (
              <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
                <p className="text-sm text-neutral-600">{rowsErrorMessage}</p>
                <button
                  type="button"
                  onClick={() => void rowsQuery.refetch()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 hover:bg-neutral-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Retry
                </button>
              </div>
            ) : recentRows.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-neutral-500">
                No Material Requests found.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="bg-neutral-50 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                    <tr>
                      <th className="px-4 py-2.5">MR Number</th>
                      <th className="px-4 py-2.5">Created Date</th>
                      <th className="px-4 py-2.5">Request Type</th>
                      <th className="px-4 py-2.5">Priority</th>
                      <th className="px-4 py-2.5">Current Status</th>
                      <th className="px-4 py-2.5">Workflow Progress</th>
                      <th className="px-4 py-2.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {recentRows.map((mr) => {
                      const workflow = getMaterialRequestWorkflowStatus(mr);
                      const pct = workflowProgressPct(
                        workflow,
                        mr.docstatus ?? 0,
                      );
                      return (
                        <tr key={mr.name} className="hover:bg-neutral-50/80">
                          <td className="px-4 py-2.5">
                            <Link
                              to={`/material-requests/${encodeURIComponent(mr.name)}`}
                              className="font-semibold text-primary-600 no-underline"
                            >
                              {mr.name}
                            </Link>
                          </td>
                          <td className="px-4 py-2.5 text-neutral-600">
                            {formatDate(mr.creation ?? mr.transaction_date)}
                          </td>
                          <td className="px-4 py-2.5">
                            <ProcurementTypeBadge
                              type={getMaterialRequestProcurementType(mr)}
                              withIcon={false}
                            />
                          </td>
                          <td className="px-4 py-2.5">
                            {mr.custom_priority ? (
                              <PriorityBadge priority={mr.custom_priority} />
                            ) : (
                              <span className="text-neutral-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <StatusBadge status={workflow} />
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex min-w-[100px] items-center gap-2">
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
                                <div
                                  className="h-full rounded-full bg-primary-500"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="w-8 text-right text-[11px] tabular-nums text-neutral-500">
                                {pct}%
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <Link
                              to={`/material-requests/${encodeURIComponent(mr.name)}`}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 no-underline hover:underline"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              View
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        <div className="xl:col-span-4">
          <Panel title="Pending Actions" bodyClassName="space-y-2">
            {pendingActions.length === 0 ? (
              <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-6 text-center">
                <p className="text-sm font-semibold text-emerald-800">
                  No pending actions
                </p>
                <p className="mt-1 text-xs text-emerald-700">
                  You’re all caught up.
                </p>
              </div>
            ) : (
              pendingActions.map((action) => (
                <Link
                  key={action.id}
                  to={action.to}
                  className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5 no-underline ${action.tone}`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{action.label}</p>
                    <p className="mt-0.5 text-xs opacity-80">{action.detail}</p>
                  </div>
                  <span className="shrink-0 text-xs font-semibold">Open</span>
                </Link>
              ))
            )}
          </Panel>
        </div>
      </div>

      {/* 6 + 7 + 8. Charts row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12 xl:gap-5">
        <div className="xl:col-span-5">
          <Panel title="Monthly Request Trend" bodyClassName="pt-2">
            <div className="h-[200px] w-full">
              {rowsQuery.isLoading ? (
                <Skeleton className="h-full w-full" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={analytics.monthBuckets}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                    <XAxis dataKey="label" {...CHART_AXIS} />
                    <YAxis {...CHART_AXIS} allowDecimals={false} width={28} />
                    <Tooltip contentStyle={CHART_TOOLTIP} />
                    <Line
                      type="monotone"
                      dataKey="count"
                      name="Requests"
                      stroke="#1993FF"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </Panel>
        </div>

        <div className="xl:col-span-3">
          <Panel title="Request Distribution" bodyClassName="pt-1">
            <div className="flex h-[200px] flex-col items-center justify-center">
              {rowsQuery.isLoading ? (
                <Skeleton className="h-36 w-36 rounded-full" />
              ) : distributionData.length === 0 ? (
                <p className="text-sm text-neutral-500">No data</p>
              ) : (
                <>
                  <div className="h-[140px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={distributionData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={42}
                          outerRadius={62}
                          paddingAngle={2}
                          isAnimationActive={false}
                        >
                          {distributionData.map((entry) => (
                            <Cell
                              key={entry.name}
                              fill={
                                PIE_COLORS[entry.name as keyof typeof PIE_COLORS]
                              }
                            />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={CHART_TOOLTIP} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-1 flex gap-4 text-xs">
                    <span className="inline-flex items-center gap-1.5 text-neutral-600">
                      <span className="h-2 w-2 rounded-full bg-[#1993FF]" />
                      Direct {analytics.direct}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-neutral-600">
                      <span className="h-2 w-2 rounded-full bg-[#64748B]" />
                      Indirect {analytics.indirect}
                    </span>
                  </div>
                </>
              )}
            </div>
          </Panel>
        </div>

        <div className="xl:col-span-4">
          <Panel title="Priority Breakdown" bodyClassName="space-y-3 py-4">
            {(
              [
                {
                  label: "High",
                  value: analytics.high,
                  bar: "bg-amber-500",
                  chip: "bg-amber-50 text-amber-800",
                },
                {
                  label: "Medium",
                  value: analytics.medium,
                  bar: "bg-sky-500",
                  chip: "bg-sky-50 text-sky-800",
                },
                {
                  label: "Low",
                  value: analytics.low,
                  bar: "bg-neutral-400",
                  chip: "bg-neutral-100 text-neutral-700",
                },
              ] as const
            ).map((row) => (
              <div key={row.label} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span
                    className={`rounded-full px-2 py-0.5 font-semibold ${row.chip}`}
                  >
                    {row.label}
                  </span>
                  <span className="tabular-nums font-semibold text-neutral-900">
                    {row.value}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
                  <div
                    className={`h-full rounded-full ${row.bar}`}
                    style={{
                      width: `${(row.value / priorityMax) * 100}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </Panel>
        </div>
      </div>

      {/* Department Performance — compact executive KPIs (full width) */}
      <Panel title="Department Performance" bodyClassName="!py-5 !pb-5">
        <DepartmentPerformanceKpis
          loading={rowsQuery.isLoading || bomHistoryQuery.isLoading}
          metrics={performanceMetrics}
        />
      </Panel>

      {/* Activity + Quick Access */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:gap-5">
        <div>
          <Panel title="Activity Timeline" bodyClassName="max-h-[260px] space-y-0 overflow-y-auto p-0">
            {rowsQuery.isLoading ? (
              <div className="space-y-2 p-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : activityItems.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-neutral-500">
                No recent updates.
              </p>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {activityItems.map((item) => (
                  <li key={item.id}>
                    <Link
                      to={item.to}
                      className="flex items-start gap-3 px-4 py-3 no-underline hover:bg-neutral-50"
                    >
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary-500" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-neutral-900">
                          {item.title}
                        </p>
                        <p className="truncate text-xs text-neutral-500">
                          {item.subtitle}
                        </p>
                      </div>
                      <time className="shrink-0 text-[11px] text-neutral-400">
                        {item.when ? formatDateTime(item.when) : "—"}
                      </time>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div>
          <Panel title="Quick Access" bodyClassName="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-2">
            {quickAccess.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.label}
                  to={item.to}
                  className="flex items-center gap-2.5 rounded-lg border border-neutral-200 bg-white px-3 py-2.5 no-underline transition-colors hover:border-primary-200 hover:bg-primary-50/40"
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${item.tone}`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="text-xs font-semibold text-neutral-800">
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </Panel>
        </div>
      </div>
    </div>
  );
}
