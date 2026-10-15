import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bell,
  Briefcase,
  CheckCircle2,
  Clock,
  FileText,
  Layers,
  Lightbulb,
  PackageCheck,
  Plus,
  PlusCircle,
  RefreshCw,
  Send,
  Truck,
  UploadCloud,
  Warehouse,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
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
import {
  countDepartmentPendingAcceptance,
  listDepartmentPendingAcceptanceLocal,
} from "../../api/departmentIssuedItems";
import { fetchBusinessCases } from "../../api/businessIntake";
import { getAllNotifications } from "../../api/notifications";
import type { MaterialRequestWorkflowStatus } from "../../types/materialRequestWorkflow";
import { formatDate } from "../../utils/format";
import { toEnterpriseUserMessage } from "../../utils/enterpriseUserMessage";
import StatusBadge from "../StatusBadge";
import ProcurementTypeBadge from "../ProcurementTypeBadge";
import { Skeleton } from "../Skeleton";

interface Props {
  greetingName?: string;
}

const EMPTY_ROWS: MaterialRequestWorkflowRecord[] = [];

type StageKey = "draft" | "submitted" | "warehouse" | "procurement" | "completed";

interface StageMeta {
  key: StageKey;
  label: string;
  color: string;
  bgTone: string;
  textColor: string;
}

const STAGE_CONFIG: StageMeta[] = [
  {
    key: "draft",
    label: "Draft",
    color: "#94A3B8",
    bgTone: "bg-slate-100",
    textColor: "text-slate-700",
  },
  {
    key: "submitted",
    label: "Submitted",
    color: "#F59E0B",
    bgTone: "bg-amber-50",
    textColor: "text-amber-700",
  },
  {
    key: "warehouse",
    label: "Warehouse",
    color: "#0EA5E9",
    bgTone: "bg-sky-50",
    textColor: "text-sky-700",
  },
  {
    key: "procurement",
    label: "Procurement",
    color: "#3B82F6",
    bgTone: "bg-blue-50",
    textColor: "text-blue-700",
  },
  {
    key: "completed",
    label: "Completed",
    color: "#10B981",
    bgTone: "bg-emerald-50",
    textColor: "text-emerald-700",
  },
];

/* ────────────────────────────────────────────────────────────────────────── */
/*  Centralized Workflow Classification & Progress Calculation                */
/* ────────────────────────────────────────────────────────────────────────── */

function isDraftRequest(status: string, workflow: string, docstatus: number) {
  return docstatus === 0 || workflow === "Draft" || status === "Draft";
}

function isCompletedRequest(status: string, workflow: string) {
  return workflow === "Completed" || status === "Completed";
}

function isWarehouseStage(workflow: string) {
  return (
    workflow === "Under Warehouse Review" ||
    workflow === "Stock Available" ||
    workflow === "Admin Review" ||
    workflow === "Material Issued" ||
    workflow === "Pending Department Acceptance" ||
    workflow === "Partially Issued"
  );
}

function isProcurementStage(workflow: string) {
  return (
    workflow === "Procurement Required" ||
    workflow === "Forwarded to Procurement" ||
    workflow === "RFQ Created"
  );
}

function isRejectedOrCancelled(status: string, workflow: string) {
  return (
    workflow === "Cancelled" ||
    status === "Cancelled" ||
    status === "Stopped" ||
    status === "Rejected"
  );
}

/**
 * Single source of truth for workflow classification.
 * Every request belongs to exactly one category.
 */
function classifyWorkflowStage(
  status: string,
  workflow: MaterialRequestWorkflowStatus,
  docstatus: number,
): StageKey | "cancelled" {
  if (isDraftRequest(status, workflow, docstatus)) return "draft";
  if (isCompletedRequest(status, workflow)) return "completed";
  if (isProcurementStage(workflow)) return "procurement";
  if (isWarehouseStage(workflow)) return "warehouse";
  if (isRejectedOrCancelled(status, workflow)) return "cancelled";
  return "submitted";
}

function workflowProgressPct(
  workflow: MaterialRequestWorkflowStatus,
  docstatus: number,
): number {
  if (docstatus === 0 || workflow === "Draft") return 10;
  if (workflow === "Cancelled") return 0;
  if (workflow === "Submitted") return 25;
  if (
    workflow === "Under Warehouse Review" ||
    workflow === "Stock Available" ||
    workflow === "Admin Review"
  ) {
    return 45;
  }
  if (
    workflow === "Procurement Required" ||
    workflow === "Forwarded to Procurement"
  ) {
    return 65;
  }
  if (workflow === "RFQ Created") return 75;
  if (workflow === "Partially Issued") return 80;
  if (
    workflow === "Material Issued" ||
    workflow === "Pending Department Acceptance"
  ) {
    return 90;
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

function normalizePriority(raw?: string | null): "Critical" | "High" | "Medium" | "Low" {
  const p = (raw ?? "").trim().toLowerCase();
  if (p === "urgent" || p === "critical") return "Critical";
  if (p === "high") return "High";
  if (p === "low") return "Low";
  return "Medium";
}

function PriorityBadge({ priority }: { priority: string }) {
  const norm = normalizePriority(priority);
  const styles: Record<string, string> = {
    Critical: "bg-red-50 text-red-700 border-red-200/70",
    High: "bg-amber-50 text-amber-700 border-amber-200/70",
    Medium: "bg-sky-50 text-sky-700 border-sky-200/70",
    Low: "bg-slate-50 text-slate-600 border-slate-200/70",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${styles[norm] || styles.Medium}`}
    >
      {norm}
    </span>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Main Component                                                            */
/* ────────────────────────────────────────────────────────────────────────── */

export default function DepartmentUserDashboard({ greetingName: _greetingName = "Department User" }: Props) {
  const [statusDateFilter, setStatusDateFilter] = useState<"30d" | "90d" | "year" | "all">("all");
  const [trendRange, setTrendRange] = useState<"30d" | "6m" | "12m">("6m");

  /* ─────────────── Data Fetching ─────────────── */

  const rowsQuery = useQuery({
    queryKey: ["mr-dashboard-rows", "department"],
    queryFn: async () => {
      const records = await listMaterialRequestsWorkflow();
      return [...records].sort((a, b) =>
        (b.modified ?? b.creation ?? "").localeCompare(
          a.modified ?? a.creation ?? "",
        ),
      );
    },
    retry: 1,
    staleTime: 30_000,
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
  });
  const pendingAcceptance = pendingAcceptanceQuery.data ?? 0;
  const pendingReceipts = listDepartmentPendingAcceptanceLocal();

  const businessCasesQuery = useQuery({
    queryKey: ["business-cases", "department-dashboard"],
    queryFn: () => fetchBusinessCases(),
    staleTime: 30_000,
  });
  const businessCases = businessCasesQuery.data ?? [];

  const notifications = useMemo(() => {
    return getAllNotifications().slice(0, 4);
  }, []);

  /* ─────────────── Filtered Data By Selected Date Range ─────────────── */

  const now = useMemo(() => new Date(), []);
  const nowMs = now.getTime();

  const dateFilterThresholdMs = useMemo(() => {
    if (statusDateFilter === "30d") return nowMs - 30 * 86_400_000;
    if (statusDateFilter === "90d") return nowMs - 90 * 86_400_000;
    if (statusDateFilter === "year") return new Date(now.getFullYear(), 0, 1).getTime();
    return 0;
  }, [statusDateFilter, nowMs, now]);

  const activeRows = useMemo(() => {
    if (dateFilterThresholdMs === 0) return rows;
    return rows.filter((mr) => {
      const createdMs = parseDateMs(mr.creation) ?? parseDateMs(mr.transaction_date);
      return createdMs != null && createdMs >= dateFilterThresholdMs;
    });
  }, [rows, dateFilterThresholdMs]);

  /* ─────────────── Centralized Analytics Calculations ─────────────── */

  const analytics = useMemo(() => {
    const thirtyDaysAgoMs = nowMs - 30 * 86_400_000;
    const sixtyDaysAgoMs = nowMs - 60 * 86_400_000;

    let draftCount = 0;
    let submittedCount = 0;
    let warehouseCount = 0;
    let procurementCount = 0;
    let completedCount = 0;
    let cancelledCount = 0;

    let last30DaysCreated = 0;
    let prior30DaysCreated = 0;
    let completedThisMonth = 0;

    let clarificationCount = 0;
    let returnedCount = 0;

    const warehouseProcessingDays: number[] = [];
    const procurementProcessingDays: number[] = [];
    const totalCycleDays: number[] = [];

    const currentMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    for (const mr of activeRows) {
      const workflow = getMaterialRequestWorkflowStatus(mr);
      const status = (mr.status ?? "").trim();
      const docstatus = mr.docstatus ?? 0;
      const stage = classifyWorkflowStage(status, workflow, docstatus);

      // Reconciled KPI counts
      if (stage === "draft") draftCount += 1;
      else if (stage === "submitted") submittedCount += 1;
      else if (stage === "warehouse") warehouseCount += 1;
      else if (stage === "procurement") procurementCount += 1;
      else if (stage === "completed") completedCount += 1;
      else if (stage === "cancelled") cancelledCount += 1;

      // Created time tracking
      const createdMs = parseDateMs(mr.creation) ?? parseDateMs(mr.transaction_date);
      if (createdMs != null) {
        if (createdMs >= thirtyDaysAgoMs) last30DaysCreated += 1;
        else if (createdMs >= sixtyDaysAgoMs) prior30DaysCreated += 1;
      }

      // Attention indicators for pending actions
      const remarks = `${mr.custom_warehouse_remarks ?? ""} ${mr.remarks ?? ""} ${mr.custom_purpose ?? ""}`.toLowerCase();
      if (remarks.includes("clarification") || remarks.includes("info required") || remarks.includes("details needed")) {
        clarificationCount += 1;
      }
      if (remarks.includes("returned") || status === "Returned" || workflow === "Cancelled") {
        returnedCount += 1;
      }

      // Turnaround metrics
      if (isWarehouseStage(workflow) || isProcurementStage(workflow) || isCompletedRequest(status, workflow)) {
        const d = daysBetween(mr.creation ?? mr.transaction_date, mr.modified);
        if (d != null && d >= 0) warehouseProcessingDays.push(d);
      }
      if (isProcurementStage(workflow) || isCompletedRequest(status, workflow)) {
        const d = daysBetween(mr.creation ?? mr.transaction_date, mr.modified);
        if (d != null && d >= 0) procurementProcessingDays.push(d);
      }
      if (isCompletedRequest(status, workflow)) {
        const d = daysBetween(mr.creation ?? mr.transaction_date, mr.modified);
        if (d != null && d >= 0) totalCycleDays.push(d);

        const modStr = String(mr.modified ?? mr.creation ?? "");
        if (modStr.startsWith(currentMonthPrefix)) {
          completedThisMonth += 1;
        }
      }
    }

    const total = activeRows.length;

    // Trend series generation using actual Material Request dates
    const monthsBack = trendRange === "12m" ? 12 : trendRange === "6m" ? 6 : 1;
    const trendBuckets: { label: string; count: number; date: string }[] = [];

    if (trendRange === "30d") {
      // Daily breakdown for last 30 days
      for (let i = 29; i >= 0; i -= 1) {
        const d = new Date(nowMs - i * 86_400_000);
        const dayStr = d.toISOString().slice(0, 10);
        const displayLabel = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
        trendBuckets.push({ label: displayLabel, count: 0, date: dayStr });
      }
      const dayMap = new Map(trendBuckets.map((b, idx) => [b.date, idx]));
      for (const mr of activeRows) {
        const createdMs = parseDateMs(mr.creation) ?? parseDateMs(mr.transaction_date);
        if (createdMs != null) {
          const dateStr = new Date(createdMs).toISOString().slice(0, 10);
          const idx = dayMap.get(dateStr);
          if (idx != null) trendBuckets[idx].count += 1;
        }
      }
    } else {
      // Monthly breakdown
      for (let i = monthsBack - 1; i >= 0; i -= 1) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = monthKey(d);
        trendBuckets.push({ label: monthLabel(key), count: 0, date: key });
      }
      const monthMap = new Map(trendBuckets.map((b, idx) => [b.date, idx]));
      for (const mr of activeRows) {
        const createdMs = parseDateMs(mr.creation) ?? parseDateMs(mr.transaction_date);
        if (createdMs != null) {
          const key = monthKey(new Date(createdMs));
          const idx = monthMap.get(key);
          if (idx != null) trendBuckets[idx].count += 1;
        }
      }
    }

    const hasTrendActivity = trendBuckets.some((b) => b.count > 0);

    return {
      total,
      draftCount,
      submittedCount,
      warehouseCount,
      procurementCount,
      completedCount,
      cancelledCount,
      clarificationCount,
      returnedCount,
      trendBuckets,
      hasTrendActivity,
      avgWarehouseTime: avg(warehouseProcessingDays),
      avgProcurementTime: avg(procurementProcessingDays),
      avgTotalCycleTime: avg(totalCycleDays),
      completedThisMonth,
    };
  }, [activeRows, nowMs, now, trendRange]);

  /* ─────────────── Business Cases Analytics ─────────────── */
  const businessCasesStats = useMemo(() => {
    let draft = 0;
    let inReview = 0;
    let readyForRfq = 0;
    let returned = 0;

    for (const bc of businessCases) {
      const st = bc.workflow_status || "";
      if (st === "Draft") draft += 1;
      else if (
        [
          "Submitted",
          "Pending Engineering",
          "Pending Engineering Manager",
          "Pending Finance",
          "Pending Finance Review",
          "Pending Legal",
          "Pending Legal Review",
          "Pending Procurement",
        ].includes(st)
      ) {
        inReview += 1;
      } else if (["Approved", "Ready for RFQ", "Procurement Ready"].includes(st)) {
        readyForRfq += 1;
      } else if (st === "Returned" || st.startsWith("Revision Required")) {
        returned += 1;
      } else {
        inReview += 1;
      }
    }

    return {
      total: businessCases.length,
      draft,
      inReview,
      readyForRfq,
      returned,
    };
  }, [businessCases]);

  /* ─────────────── Issued Items Analytics ─────────────── */

  const issuedItemsStats = useMemo(() => {
    const total = pendingReceipts.length + pendingAcceptance;
    let accepted = 0;
    let returned = 0;

    for (const r of pendingReceipts) {
      const st = (r.status ?? "").toLowerCase();
      if (st.includes("accept") || st.includes("complete")) accepted += 1;
      else if (st.includes("return") || st.includes("reject")) returned += 1;
    }

    return {
      total: Math.max(total, pendingAcceptance > 0 ? pendingAcceptance : 0),
      pending: pendingAcceptance,
      accepted,
      returned,
    };
  }, [pendingReceipts, pendingAcceptance]);

  /* ─────────────── Recent Requests (Top 5) ─────────────── */

  const recentRows = useMemo(() => {
    return activeRows.slice(0, 5);
  }, [activeRows]);

  /* ─────────────── Department User Pending Actions ─────────────── */

  const pendingActions = useMemo(() => {
    const actions: {
      id: string;
      title: string;
      count: number;
      description: string;
      to: string;
      icon: typeof FileText;
      tone: string;
      badgeColor: string;
    }[] = [];

    if (analytics.draftCount > 0) {
      actions.push({
        id: "drafts",
        title: "Draft Requests",
        count: analytics.draftCount,
        description: `${analytics.draftCount} request${analytics.draftCount === 1 ? "" : "s"} waiting for submission`,
        to: "/material-requests/list?status=Draft",
        icon: FileText,
        tone: "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/70",
        badgeColor: "bg-slate-100 text-slate-700",
      });
    }

    if (analytics.returnedCount > 0) {
      actions.push({
        id: "returned-requests",
        title: "Returned Requests",
        count: analytics.returnedCount,
        description: `${analytics.returnedCount} request${analytics.returnedCount === 1 ? "" : "s"} need correction`,
        to: "/material-requests/list",
        icon: AlertTriangle,
        tone: "border-red-200 bg-red-50/30 hover:border-red-300 hover:bg-red-50/60",
        badgeColor: "bg-red-100 text-red-800",
      });
    }

    if (pendingAcceptance > 0) {
      const first = pendingReceipts[0];
      actions.push({
        id: "pending-acceptance",
        title: "Pending Acceptance",
        count: pendingAcceptance,
        description: `${pendingAcceptance} issued item${pendingAcceptance === 1 ? "" : "s"} awaiting acceptance`,
        to: first
          ? `/department/issued-items/receipts/${encodeURIComponent(first.issue_number)}`
          : "/department/issued-items/pending-acceptance",
        icon: PackageCheck,
        tone: "border-amber-200 bg-amber-50/40 hover:border-amber-300 hover:bg-amber-50/70",
        badgeColor: "bg-amber-100 text-amber-800",
      });
    }

    if (businessCasesStats.draft > 0 || analytics.clarificationCount > 0) {
      const count = (businessCasesStats.draft || 0) + (analytics.clarificationCount || 0);
      actions.push({
        id: "business-cases-action",
        title: "Business Cases",
        count,
        description: `${count} business case${count === 1 ? "" : "s"} require draft review / submission`,
        to: "/intake/business-cases",
        icon: Briefcase,
        tone: "border-sky-200 bg-sky-50/40 hover:border-sky-300 hover:bg-sky-50/70",
        badgeColor: "bg-sky-100 text-sky-800",
      });
    }

    return actions;
  }, [
    analytics.draftCount,
    analytics.returnedCount,
    analytics.clarificationCount,
    pendingAcceptance,
    pendingReceipts,
    businessCasesStats.draft,
  ]);

  /* ─────────────── Status Overview Calculations ─────────────── */

  const stageCounts: Record<StageKey, number> = {
    draft: analytics.draftCount,
    submitted: analytics.submittedCount,
    warehouse: analytics.warehouseCount,
    procurement: analytics.procurementCount,
    completed: analytics.completedCount,
  };

  const totalWorkflowSum = Math.max(
    1,
    STAGE_CONFIG.reduce((sum, s) => sum + (stageCounts[s.key] || 0), 0),
  );

  return (
    <div className="department-dashboard w-full box-border p-4 sm:p-6 md:p-8 2xl:p-10 space-y-6">
      {/* ================================================================ */}
      {/* 1. Header Banner                                                 */}
      {/* ================================================================ */}
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200/80 pb-5 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[30px] leading-tight">
              Welcome back, Department User
            </h1>
            <span className="inline-flex items-center rounded-full border border-primary-200 bg-primary-50 px-2.5 py-0.5 text-xs font-semibold text-primary-700">
              Department User
            </span>
          </div>
          <p className="mt-1 text-[15px] text-slate-500 leading-normal">
            Track your material requests, approvals, warehouse processing and procurement progress.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/material-requests/list"
            className="inline-flex h-10 sm:h-11 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-xs transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          >
            <FileText className="h-4 w-4 text-slate-500" />
            View All Requests
          </Link>
          <Link
            to="/material-requests/new"
            className="inline-flex h-10 sm:h-11 items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-5 text-sm font-semibold text-white shadow-xs transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          >
            <Plus className="h-4 w-4" />
            + New Material Request
          </Link>
        </div>
      </div>

      {/* Error state if API fails */}
      {rowsQuery.isError && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50/80 p-4 text-sm text-red-900">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="h-5 w-5 text-red-600 shrink-0" />
            <span>{rowsErrorMessage || "Unable to load dashboard data."}</span>
          </div>
          <button
            type="button"
            onClick={() => void rowsQuery.refetch()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-800 shadow-xs hover:bg-red-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Try again
          </button>
        </div>
      )}

      {/* ================================================================ */}
      {/* 2. KPI Summary Cards (6-Column Grid, Equal Height)               */}
      {/* ================================================================ */}
      {rowsQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="flex min-h-[136px] h-[138px] flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-xs"
            >
              <Skeleton className="h-4 w-24" />
              <Skeleton className="my-2 h-8 w-14" />
              <Skeleton className="h-3 w-32" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          {/* 1. TOTAL REQUESTS */}
          <Link
            to="/material-requests/list"
            className="group flex min-h-[136px] h-[138px] flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs transition hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-[12px] font-bold uppercase tracking-wider text-slate-500 leading-tight max-w-[calc(100%-44px)]">
                TOTAL REQUESTS
              </span>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 transition group-hover:bg-primary-50 group-hover:text-primary-600">
                <Layers className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-2">
              <div className="text-[30px] font-bold tabular-nums text-slate-900 leading-none">
                {analytics.total}
              </div>
              <div className="mt-1.5 text-[13px] text-slate-500 truncate">
                All material requests
              </div>
            </div>
          </Link>

          {/* 2. DRAFT */}
          <Link
            to="/material-requests/list?status=Draft"
            className="group flex min-h-[136px] h-[138px] flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-[12px] font-bold uppercase tracking-wider text-slate-500 leading-tight max-w-[calc(100%-44px)]">
                DRAFT
              </span>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 transition group-hover:bg-slate-200">
                <FileText className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-2">
              <div className="text-[30px] font-bold tabular-nums text-slate-800 leading-none">
                {analytics.draftCount}
              </div>
              <div className="mt-1.5 text-[13px] text-slate-500 truncate">
                Waiting to be submitted
              </div>
            </div>
          </Link>

          {/* 3. SUBMITTED */}
          <Link
            to="/material-requests/list?status=Submitted"
            className="group flex min-h-[136px] h-[138px] flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs transition hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-[12px] font-bold uppercase tracking-wider text-slate-500 leading-tight max-w-[calc(100%-44px)]">
                SUBMITTED
              </span>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 transition group-hover:bg-amber-100">
                <Send className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-2">
              <div className="text-[30px] font-bold tabular-nums text-amber-700 leading-none">
                {analytics.submittedCount}
              </div>
              <div className="mt-1.5 text-[13px] text-slate-500 truncate">
                Awaiting warehouse processing
              </div>
            </div>
          </Link>

          {/* 4. UNDER WAREHOUSE */}
          <Link
            to="/material-requests/list?f=pending"
            className="group flex min-h-[136px] h-[138px] flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-[12px] font-bold uppercase tracking-wider text-slate-500 leading-tight max-w-[calc(100%-44px)]">
                UNDER WAREHOUSE
              </span>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600 transition group-hover:bg-sky-100">
                <Warehouse className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-2">
              <div className="text-[30px] font-bold tabular-nums text-sky-700 leading-none">
                {analytics.warehouseCount}
              </div>
              <div className="mt-1.5 text-[13px] text-slate-500 truncate">
                Currently being processed
              </div>
            </div>
          </Link>

          {/* 5. SENT TO PROCUREMENT */}
          <Link
            to="/material-requests/list?f=procurement"
            className="group flex min-h-[136px] h-[138px] flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-[12px] font-bold uppercase tracking-wider text-slate-500 leading-tight max-w-[calc(100%-44px)]">
                SENT TO PROCUREMENT
              </span>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 transition group-hover:bg-blue-100">
                <Truck className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-2">
              <div className="text-[30px] font-bold tabular-nums text-blue-700 leading-none">
                {analytics.procurementCount}
              </div>
              <div className="mt-1.5 text-[13px] text-slate-500 truncate">
                Procurement processing
              </div>
            </div>
          </Link>

          {/* 6. COMPLETED */}
          <Link
            to="/material-requests/list?status=Completed"
            className="group flex min-h-[136px] h-[138px] flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-[12px] font-bold uppercase tracking-wider text-slate-500 leading-tight max-w-[calc(100%-44px)]">
                COMPLETED
              </span>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 transition group-hover:bg-emerald-100">
                <CheckCircle2 className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-2">
              <div className="text-[30px] font-bold tabular-nums text-emerald-700 leading-none">
                {analytics.completedCount}
              </div>
              <div className="mt-1.5 text-[13px] text-slate-500 truncate">
                Successfully completed
              </div>
            </div>
          </Link>
        </div>
      )}

      {/* ================================================================ */}
      {/* 3. REQUEST STATUS OVERVIEW + REQUEST TREND (Analytical Row)      */}
      {/* ================================================================ */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-stretch">
        {/* Left: Request Status Overview Card (5 Cols) */}
        <div className="flex min-h-[350px] flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-6 shadow-xs lg:col-span-5">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  Request Status Overview
                </h2>
                <p className="text-xs text-slate-500">
                  Current distribution across procurement stages
                </p>
              </div>

              {/* Status Date Filter */}
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-medium text-slate-600">
                <button
                  type="button"
                  onClick={() => setStatusDateFilter("30d")}
                  className={`rounded-md px-2 py-1 transition ${
                    statusDateFilter === "30d"
                      ? "bg-primary-600 font-semibold text-white shadow-xs"
                      : "hover:text-slate-900"
                  }`}
                >
                  Last 30 Days
                </button>
                <button
                  type="button"
                  onClick={() => setStatusDateFilter("90d")}
                  className={`rounded-md px-2 py-1 transition ${
                    statusDateFilter === "90d"
                      ? "bg-primary-600 font-semibold text-white shadow-xs"
                      : "hover:text-slate-900"
                  }`}
                >
                  Last 90 Days
                </button>
                <button
                  type="button"
                  onClick={() => setStatusDateFilter("year")}
                  className={`rounded-md px-2 py-1 transition ${
                    statusDateFilter === "year"
                      ? "bg-primary-600 font-semibold text-white shadow-xs"
                      : "hover:text-slate-900"
                  }`}
                >
                  This Year
                </button>
                <button
                  type="button"
                  onClick={() => setStatusDateFilter("all")}
                  className={`rounded-md px-2 py-1 transition ${
                    statusDateFilter === "all"
                      ? "bg-primary-600 font-semibold text-white shadow-xs"
                      : "hover:text-slate-900"
                  }`}
                >
                  All Time
                </button>
              </div>
            </div>

            <div className="pt-4">
              {rowsQuery.isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-4 w-full rounded-full" />
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Skeleton key={i} className="h-14 w-full rounded-lg" />
                    ))}
                  </div>
                </div>
              ) : analytics.total === 0 ? (
                <div className="py-8 text-center text-sm text-slate-500">
                  No request status data available for this filter.
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Horizontal Stacked Status Bar */}
                  <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
                    {STAGE_CONFIG.map((stage) => {
                      const count = stageCounts[stage.key] || 0;
                      if (count === 0) return null;
                      const pct = (count / totalWorkflowSum) * 100;
                      return (
                        <div
                          key={stage.key}
                          className="h-full transition-all duration-300 first:rounded-l-full last:rounded-r-full hover:opacity-90"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: stage.color,
                          }}
                          title={`${stage.label}: ${count} (${Math.round(pct)}%)`}
                        />
                      );
                    })}
                  </div>

                  {/* Status breakdown mini-cards */}
                  <div className="grid grid-cols-3 gap-2.5">
                    {STAGE_CONFIG.map((stage) => {
                      const count = stageCounts[stage.key] || 0;
                      const pct = Math.round((count / totalWorkflowSum) * 100);
                      return (
                        <div
                          key={stage.key}
                          className="flex h-[74px] flex-col justify-between rounded-lg border border-slate-100 bg-slate-50/60 p-3"
                        >
                          <div className="flex items-center gap-1.5">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: stage.color }}
                            />
                            <span className="text-[13px] font-medium text-slate-600">
                              {stage.label}
                            </span>
                          </div>
                          <div className="mt-1 flex items-baseline justify-between">
                            <span className="text-[20px] font-bold tabular-nums text-slate-900">
                              {count}
                            </span>
                            <span className="text-[12px] font-semibold text-slate-500">
                              {pct}%
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Requests Trend Chart (7 Cols) */}
        <div className="flex min-h-[350px] flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-6 shadow-xs lg:col-span-7">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  Requests Trend
                </h2>
                <p className="text-xs text-slate-500">
                  Requisition volume over time
                </p>
              </div>

              <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-medium text-slate-600">
                <button
                  type="button"
                  onClick={() => setTrendRange("30d")}
                  className={`rounded-md px-2.5 py-1 transition ${
                    trendRange === "30d"
                      ? "bg-primary-600 font-semibold text-white shadow-xs"
                      : "hover:text-slate-900"
                  }`}
                >
                  Last 30 Days
                </button>
                <button
                  type="button"
                  onClick={() => setTrendRange("6m")}
                  className={`rounded-md px-2.5 py-1 transition ${
                    trendRange === "6m"
                      ? "bg-primary-600 font-semibold text-white shadow-xs"
                      : "hover:text-slate-900"
                  }`}
                >
                  Last 6 Months
                </button>
                <button
                  type="button"
                  onClick={() => setTrendRange("12m")}
                  className={`rounded-md px-2.5 py-1 transition ${
                    trendRange === "12m"
                      ? "bg-primary-600 font-semibold text-white shadow-xs"
                      : "hover:text-slate-900"
                  }`}
                >
                  Last 12 Months
                </button>
              </div>
            </div>

            <div className="mt-3 h-[230px] w-full">
              {rowsQuery.isLoading ? (
                <Skeleton className="h-full w-full rounded-lg" />
              ) : !analytics.hasTrendActivity ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-400">
                  No request activity available for this period.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={analytics.trendBuckets} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "#64748B", fontSize: 11 }}
                      axisLine={{ stroke: "#E2E8F0" }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: "#64748B", fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#FFFFFF",
                        border: "1px solid #E2E8F0",
                        borderRadius: 8,
                        boxShadow: "0 4px 12px rgba(15,23,42,0.08)",
                        fontSize: 12,
                      }}
                      formatter={(value: any) => [`${value ?? 0} requests`, "Requests"]}
                    />
                    <Line
                      type="monotone"
                      dataKey="count"
                      stroke="#1993FF"
                      strokeWidth={2.5}
                      dot={{ fill: "#1993FF", strokeWidth: 2, r: 3 }}
                      activeDot={{ r: 5, stroke: "#1554D1", strokeWidth: 2 }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ================================================================ */}
      {/* 4. RECENT MATERIAL REQUESTS + PENDING ACTIONS                    */}
      {/* ================================================================ */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Left: Recent Material Requests (8 Cols / ~65%) */}
        <div className="flex flex-col rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs xl:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                RECENT MATERIAL REQUESTS
              </h2>
              <p className="text-xs text-slate-500">
                Latest procurement requisitions from your department
              </p>
            </div>
            <Link
              to="/material-requests/list"
              className="text-xs font-semibold text-primary-600 hover:text-primary-700"
            >
              View All →
            </Link>
          </div>

          <div className="flex-1 overflow-x-auto pt-2">
            {rowsQuery.isLoading ? (
              <div className="space-y-3 p-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-10 w-full rounded" />
                ))}
              </div>
            ) : recentRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <FileText className="h-10 w-10 text-slate-300" />
                <p className="mt-2 text-sm font-semibold text-slate-700">No Recent Requests</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Create your first Material Request to get started.
                </p>
                <Link
                  to="/material-requests/new"
                  className="mt-3 inline-flex items-center gap-1 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-primary-700"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New Request
                </Link>
              </div>
            ) : (
              <table className="w-full min-w-[680px] text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    <th className="py-2.5 pr-3 pl-1">MR Number</th>
                    <th className="px-3 py-2.5">Created Date</th>
                    <th className="px-3 py-2.5">Type</th>
                    <th className="px-3 py-2.5">Priority</th>
                    <th className="px-3 py-2.5">Current Status</th>
                    <th className="px-3 py-2.5">Workflow</th>
                    <th className="py-2.5 pr-1 pl-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentRows.map((mr) => {
                    const workflow = getMaterialRequestWorkflowStatus(mr);
                    const progress = workflowProgressPct(workflow, mr.docstatus ?? 0);
                    return (
                      <tr
                        key={mr.name}
                        className="transition hover:bg-slate-50/80 h-14"
                      >
                        <td className="py-3 pr-3 pl-1">
                          <Link
                            to={`/material-requests/${encodeURIComponent(mr.name)}`}
                            className="font-bold text-primary-600 hover:text-primary-800"
                          >
                            {mr.name}
                          </Link>
                        </td>
                        <td className="px-3 py-3 text-slate-600">
                          {formatDate(mr.creation ?? mr.transaction_date)}
                        </td>
                        <td className="px-3 py-3">
                          <ProcurementTypeBadge
                            type={getMaterialRequestProcurementType(mr)}
                            withIcon={false}
                          />
                        </td>
                        <td className="px-3 py-3">
                          <PriorityBadge priority={mr.custom_priority || "Medium"} />
                        </td>
                        <td className="px-3 py-3">
                          <StatusBadge status={workflow} />
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex min-w-[90px] items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className="h-full rounded-full bg-primary-500 transition-all"
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                            <span className="w-7 text-right text-[11px] font-semibold tabular-nums text-slate-500">
                              {progress}%
                            </span>
                          </div>
                        </td>
                        <td className="py-3 pr-1 pl-3 text-right">
                          <Link
                            to={`/material-requests/${encodeURIComponent(mr.name)}`}
                            className="inline-flex items-center gap-1 rounded px-2 py-1 font-semibold text-primary-700 transition hover:bg-primary-50 hover:text-primary-900"
                          >
                            View →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right: Pending Actions (4 Cols / ~35%) */}
        <div className="flex flex-col rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs xl:col-span-4">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-900">PENDING ACTIONS</h2>
            <p className="text-xs text-slate-500">
              Department user tasks requiring action
            </p>
          </div>

          <div className="mt-3 flex-1 space-y-2.5">
            {rowsQuery.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full rounded-lg" />
                <Skeleton className="h-16 w-full rounded-lg" />
              </div>
            ) : pendingActions.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center rounded-lg border border-emerald-100 bg-emerald-50/40 p-6 text-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                <p className="mt-2 text-sm font-bold text-emerald-900">
                  You&apos;re all caught up.
                </p>
                <p className="mt-0.5 text-xs text-emerald-700">
                  No pending department actions.
                </p>
              </div>
            ) : (
              pendingActions.map((action) => {
                const Icon = action.icon;
                return (
                  <Link
                    key={action.id}
                    to={action.to}
                    className={`group flex items-center justify-between rounded-xl border p-3 transition ${action.tone}`}
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white shadow-xs">
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate text-xs font-bold text-slate-900">
                            {action.title}
                          </p>
                          <span
                            className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${action.badgeColor}`}
                          >
                            {action.count}
                          </span>
                        </div>
                        <p className="truncate text-[11px] text-slate-500">
                          {action.description}
                        </p>
                      </div>
                    </div>
                    <span className="shrink-0 text-xs font-bold text-primary-600 transition group-hover:translate-x-0.5">
                      Open →
                    </span>
                  </Link>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ================================================================ */}
      {/* 5. ISSUED ITEMS + BUSINESS NEEDS (Two-Column Section)            */}
      {/* ================================================================ */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Issued Items Summary (6 Cols) */}
        <div className="flex flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs lg:col-span-6">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
                  <PackageCheck className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Issued Items</h2>
                  <p className="text-xs text-slate-500">Material issue receipts & acceptances</p>
                </div>
              </div>
              <span className="text-sm font-bold tabular-nums text-slate-800">
                {issuedItemsStats.total} Total
              </span>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2.5">
              <div className="rounded-lg border border-amber-100 bg-amber-50/50 p-2.5 text-center">
                <div className="text-xs font-medium text-amber-800">Pending Acceptance</div>
                <div className="mt-1 text-lg font-bold tabular-nums text-amber-900">
                  {issuedItemsStats.pending}
                </div>
              </div>

              <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-2.5 text-center">
                <div className="text-xs font-medium text-emerald-800">Accepted</div>
                <div className="mt-1 text-lg font-bold tabular-nums text-emerald-900">
                  {issuedItemsStats.accepted}
                </div>
              </div>

              <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-2.5 text-center">
                <div className="text-xs font-medium text-slate-600">Returned</div>
                <div className="mt-1 text-lg font-bold tabular-nums text-slate-800">
                  {issuedItemsStats.returned}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 border-t border-slate-100 pt-3 text-right">
            <Link
              to="/department/issued-items/pending-acceptance"
              className="text-xs font-semibold text-primary-600 hover:text-primary-800"
            >
              View Issued Items →
            </Link>
          </div>
        </div>

        {/* Right: Business Cases Summary (6 Cols) */}
        <div className="flex flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs lg:col-span-6">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
                  <Briefcase className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Business Cases</h2>
                  <p className="text-xs text-slate-500">Authoritative intake justification & workflow records</p>
                </div>
              </div>
              <span className="text-sm font-bold tabular-nums text-slate-800">
                {businessCasesStats.total} Total
              </span>
            </div>

            <div className="mt-4 grid grid-cols-4 gap-2">
              <Link
                to="/intake/business-cases?tab=drafts"
                className="rounded-lg border border-slate-200/80 bg-slate-50/60 p-2 text-center transition hover:border-slate-300 hover:bg-slate-100/70"
              >
                <div className="text-[11px] font-medium text-slate-600">Draft</div>
                <div className="mt-1 text-base font-bold tabular-nums text-slate-800">
                  {businessCasesStats.draft}
                </div>
              </Link>

              <Link
                to="/intake/business-cases?tab=submitted"
                className="rounded-lg border border-amber-200/80 bg-amber-50/50 p-2 text-center transition hover:border-amber-300 hover:bg-amber-100/60"
              >
                <div className="text-[11px] font-medium text-amber-800">In Review</div>
                <div className="mt-1 text-base font-bold tabular-nums text-amber-900">
                  {businessCasesStats.inReview}
                </div>
              </Link>

              <Link
                to="/intake/business-cases?tab=completed"
                className="rounded-lg border border-emerald-200/80 bg-emerald-50/50 p-2 text-center transition hover:border-emerald-300 hover:bg-emerald-100/60"
              >
                <div className="text-[11px] font-medium text-emerald-800">Ready for RFQ</div>
                <div className="mt-1 text-base font-bold tabular-nums text-emerald-900">
                  {businessCasesStats.readyForRfq}
                </div>
              </Link>

              <Link
                to="/intake/business-cases?tab=returned"
                className="rounded-lg border border-orange-200/80 bg-orange-50/50 p-2 text-center transition hover:border-orange-300 hover:bg-orange-100/60"
              >
                <div className="text-[11px] font-medium text-orange-800">Returned</div>
                <div className="mt-1 text-base font-bold tabular-nums text-orange-900">
                  {businessCasesStats.returned}
                </div>
              </Link>
            </div>
          </div>

          <div className="mt-4 border-t border-slate-100 pt-3 text-right">
            <Link
              to="/intake/business-cases"
              className="text-xs font-semibold text-primary-600 hover:text-primary-800"
            >
              View Business Cases →
            </Link>
          </div>
        </div>
      </div>

      {/* ================================================================ */}
      {/* 6. REQUEST PROCESSING PERFORMANCE                                */}
      {/* ================================================================ */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs">
        <div className="border-b border-slate-100 pb-3">
          <h2 className="text-sm font-bold text-slate-900">
            REQUEST PROCESSING PERFORMANCE
          </h2>
          <p className="text-xs text-slate-500">
            Turnaround times and fulfillment efficiency from real Material Request lifecycle data
          </p>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* 1. Warehouse Processing Time */}
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <Warehouse className="h-3.5 w-3.5 text-sky-600" />
              <span>Warehouse Processing</span>
            </div>
            <div className="mt-2 text-xl font-bold tabular-nums text-slate-900">
              {analytics.avgWarehouseTime != null
                ? `${analytics.avgWarehouseTime.toFixed(1)} days`
                : "Not enough historical data"}
            </div>
            <p className="mt-0.5 text-xs text-slate-400">Creation to warehouse action</p>
          </div>

          {/* 2. Procurement Processing Time */}
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <Truck className="h-3.5 w-3.5 text-blue-600" />
              <span>Procurement Processing</span>
            </div>
            <div className="mt-2 text-xl font-bold tabular-nums text-slate-900">
              {analytics.avgProcurementTime != null
                ? `${analytics.avgProcurementTime.toFixed(1)} days`
                : "Not enough historical data"}
            </div>
            <p className="mt-0.5 text-xs text-slate-400">Forward to procurement action</p>
          </div>

          {/* 3. Total Request Cycle Time */}
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <Clock className="h-3.5 w-3.5 text-indigo-600" />
              <span>Total Cycle Time</span>
            </div>
            <div className="mt-2 text-xl font-bold tabular-nums text-slate-900">
              {analytics.avgTotalCycleTime != null
                ? `${analytics.avgTotalCycleTime.toFixed(1)} days`
                : "Not enough historical data"}
            </div>
            <p className="mt-0.5 text-xs text-slate-400">Requisition to completion</p>
          </div>

          {/* 4. Requests Completed This Month */}
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              <span>Completed This Month</span>
            </div>
            <div className="mt-2 text-xl font-bold tabular-nums text-emerald-700">
              {analytics.completedThisMonth}
            </div>
            <p className="mt-0.5 text-xs text-slate-400">Fulfilled requests this month</p>
          </div>
        </div>
      </div>

      {/* ================================================================ */}
      {/* 7. QUICK ACTIONS                                                 */}
      {/* ================================================================ */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs">
        <div className="mb-3.5 border-b border-slate-100 pb-2.5">
          <h2 className="text-sm font-bold text-slate-900">QUICK ACTIONS</h2>
          <p className="text-xs text-slate-500">Common department procurement shortcuts</p>
        </div>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          <Link
            to="/material-requests/new"
            className="group flex items-center gap-3.5 rounded-xl border border-slate-200/80 bg-slate-50/50 p-3.5 transition hover:border-primary-300 hover:bg-primary-50/30 hover:shadow-xs"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-700 transition group-hover:scale-105">
              <PlusCircle className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-900 group-hover:text-primary-700">
                + New Material Request
              </p>
              <p className="truncate text-xs text-slate-500">
                Create a new material requirement
              </p>
            </div>
          </Link>

          <Link
            to="/department/upload-bom"
            className="group flex items-center gap-3.5 rounded-xl border border-slate-200/80 bg-slate-50/50 p-3.5 transition hover:border-indigo-300 hover:bg-indigo-50/30 hover:shadow-xs"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 transition group-hover:scale-105">
              <UploadCloud className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-900 group-hover:text-indigo-700">
                Upload BOM
              </p>
              <p className="truncate text-xs text-slate-500">
                Upload bulk material requirements
              </p>
            </div>
          </Link>

          <Link
            to="/material-requests/list"
            className="group flex items-center gap-3.5 rounded-xl border border-slate-200/80 bg-slate-50/50 p-3.5 transition hover:border-sky-300 hover:bg-sky-50/30 hover:shadow-xs"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700 transition group-hover:scale-105">
              <FileText className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-900 group-hover:text-sky-700">
                My Requests
              </p>
              <p className="truncate text-xs text-slate-500">
                Track your submitted requests
              </p>
            </div>
          </Link>

          <Link
            to="/intake/business-needs"
            className="group flex items-center gap-3.5 rounded-xl border border-slate-200/80 bg-slate-50/50 p-3.5 transition hover:border-amber-300 hover:bg-amber-50/30 hover:shadow-xs"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 transition group-hover:scale-105">
              <Lightbulb className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-900 group-hover:text-amber-700">
                Business Needs
              </p>
              <p className="truncate text-xs text-slate-500">
                Create and track business requirements
              </p>
            </div>
          </Link>
        </div>
      </div>

      {/* ================================================================ */}
      {/* 8. RECENT NOTIFICATIONS                                          */}
      {/* ================================================================ */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <Bell className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Recent Notifications</h2>
              <p className="text-xs text-slate-500">Activity updates and alerts</p>
            </div>
          </div>
          <Link
            to="/notifications"
            className="text-xs font-semibold text-primary-600 hover:text-primary-800"
          >
            View all notifications →
          </Link>
        </div>

        <div className="mt-3 divide-y divide-slate-100">
          {notifications.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400">
              No recent notifications.
            </div>
          ) : (
            notifications.map((notif) => (
              <Link
                key={notif.id}
                to={notif.route_path || "/notifications"}
                className="flex items-center justify-between py-2.5 px-2 transition hover:bg-slate-50 rounded-lg"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`h-2 w-2 rounded-full shrink-0 ${
                      !notif.read_status ? "bg-primary-600" : "bg-transparent"
                    }`}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-slate-900">
                      {notif.title}
                    </p>
                    <p className="truncate text-[11px] text-slate-500">
                      {notif.description || notif.document_name}
                    </p>
                  </div>
                </div>
                <span className="text-[11px] text-slate-400 shrink-0 ml-3">
                  {formatDate(notif.created_at)}
                </span>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
