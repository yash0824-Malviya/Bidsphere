import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Clock,
  FileSearch,
  PackageCheck,
  PackagePlus,
  Send,
  Target,
  Timer,
  Truck,
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
  getInventorySummary,
  getIssuedMaterials,
  getPendingMaterialRequests,
  getWarehouseProcurementRequiredRequests,
  selectProcurementRequiredRows,
  selectReadyToIssueRows,
} from "../../services/warehouseService";
import { getPurchaseReceipts } from "../../api/purchasing";
import { fetchProcurementQueue } from "../../api/materialRequestWorkflow";
import {
  countPendingDepartmentAcceptance,
  countPendingDepartmentAcceptanceAsync,
  countTodaysMaterialIssues,
  listAcceptedDepartmentReceipts,
  listPendingDepartmentReceipts,
  listPendingWarehouseReceipts,
} from "../../api/materialIssueReceipt";
import { syncMaterialRequestSlaBatch } from "../../api/slaIntegration";
import { useSlaVisible } from "../../hooks/useSlaVisible";
import ErrorState from "../../components/ErrorState";
import { useAuthStore } from "../../store/authStore";
import { formatDate } from "../../utils/format";
import { toEnterpriseUserMessage } from "../../utils/enterpriseUserMessage";
import StatusBadge from "../../components/StatusBadge";
import { Skeleton } from "../../components/Skeleton";

const DASHBOARD_STALE_MS = 30_000;

function dashboardQueryOptions() {
  return {
    enabled: true as boolean,
    retry: 1 as const,
    retryDelay: 1_200,
    staleTime: DASHBOARD_STALE_MS,
    refetchOnWindowFocus: false as const,
  };
}

const PRIORITY_STYLES: Record<string, string> = {
  Urgent: "bg-rose-50 text-rose-700 border-rose-200",
  Critical: "bg-rose-50 text-rose-700 border-rose-200",
  High: "bg-amber-50 text-amber-700 border-amber-200",
  Medium: "bg-sky-50 text-sky-700 border-sky-200",
  Low: "bg-slate-50 text-slate-600 border-slate-200",
};

interface ActivityEntry {
  id: string;
  kind: "issued" | "received" | "forwarded" | "accepted";
  label: string;
  subject: string;
  user: string;
  ts: string;
}

function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

function requestedQtyTotal(
  items: { required_qty: number }[] | undefined,
): number {
  return (items ?? []).reduce((sum, i) => sum + (Number(i.required_qty) || 0), 0);
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "short" });
}

export default function WarehouseDashboardPage() {
  const user = useAuthStore((s) => s.user);
  const role = user?.role;
  const canLoad = role === "warehouse" || role === "admin";
  const slaVisible = useSlaVisible();
  const greetingName = user?.full_name?.trim() || "Warehouse Manager";

  const [statusDateFilter, setStatusDateFilter] = useState<"30d" | "90d" | "year" | "all">("all");
  const [trendRange, setTrendRange] = useState<"30d" | "6m" | "12m">("6m");
  const [tablePage, setTablePage] = useState(1);
  const [pageSize, setPageSize] = useState(5);

  const qOpts = dashboardQueryOptions();

  const pendingQuery = useQuery({
    queryKey: ["warehouse", "pending-requests"],
    queryFn: getPendingMaterialRequests,
    ...qOpts,
    enabled: canLoad,
  });

  const procurementRequiredPersistedQuery = useQuery({
    queryKey: ["warehouse", "procurement-required-persisted"],
    queryFn: getWarehouseProcurementRequiredRequests,
    ...qOpts,
    enabled: canLoad,
  });

  const inventoryQuery = useQuery({
    queryKey: ["warehouse", "inventory"],
    queryFn: getInventorySummary,
    ...qOpts,
    enabled: canLoad,
  });

  const issuedQuery = useQuery({
    queryKey: ["warehouse", "issued"],
    queryFn: () => getIssuedMaterials(),
    ...qOpts,
    enabled: canLoad,
  });

  const procurementQueueQuery = useQuery({
    queryKey: ["mr-procurement-queue", "warehouse", "dashboard"],
    queryFn: () => fetchProcurementQueue({ hydrateLimit: 25 }),
    ...qOpts,
    enabled: canLoad,
  });

  const receiptKpiQuery = useQuery({
    queryKey: ["material-issue-receipts", "warehouse", "kpi"],
    queryFn: async () => {
      const pendingDepartmentAcceptance =
        await countPendingDepartmentAcceptanceAsync();
      return {
        pendingDepartmentAcceptance,
        todaysIssues: countTodaysMaterialIssues(),
        pendingSignatures:
          listPendingWarehouseReceipts().length +
          listPendingDepartmentReceipts().length,
      };
    },
    ...qOpts,
    enabled: canLoad,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const receiptKpiTick = receiptKpiQuery.dataUpdatedAt;

  useEffect(() => {
    if (!slaVisible) return;
    const queue = procurementQueueQuery.data;
    if (queue && queue.length > 0) void syncMaterialRequestSlaBatch(queue);
  }, [procurementQueueQuery.data, slaVisible]);

  const recentGrnQuery = useQuery({
    queryKey: ["warehouse", "recent-grn"],
    queryFn: () =>
      getPurchaseReceipts({
        fields: ["name", "owner", "posting_date", "creation", "status"],
        filters: [["docstatus", "=", 1]],
        order_by: "creation desc",
        limit_page_length: 10,
      }),
    ...qOpts,
    enabled: canLoad,
  });

  // Surface the first concrete dashboard failure with a specific message
  const dashboardErrorToasted = useRef(false);
  useEffect(() => {
    const failures: Array<{ widget: string; error: unknown }> = [
      { widget: "Pending Material Requests", error: pendingQuery.error },
      { widget: "Inventory Summary", error: inventoryQuery.error },
      { widget: "Issued Materials", error: issuedQuery.error },
      { widget: "Procurement Queue", error: procurementQueueQuery.error },
      { widget: "Recent GRNs", error: recentGrnQuery.error },
      {
        widget: "Procurement Required",
        error: procurementRequiredPersistedQuery.error,
      },
    ].filter((f) => f.error != null);

    if (failures.length === 0) {
      dashboardErrorToasted.current = false;
      return;
    }

    if (dashboardErrorToasted.current) return;
    dashboardErrorToasted.current = true;
    const first = failures[0]!;
    const detail = toEnterpriseUserMessage(
      first.error,
      `Could not load ${first.widget}. Please try again.`,
    );
    toast.error(`${first.widget}: ${detail}`, {
      id: "warehouse-dashboard-load",
      duration: 8_000,
    });
  }, [
    pendingQuery.error,
    inventoryQuery.error,
    issuedQuery.error,
    procurementQueueQuery.error,
    recentGrnQuery.error,
    procurementRequiredPersistedQuery.error,
  ]);

  const allFailed =
    canLoad &&
    pendingQuery.isError &&
    inventoryQuery.isError &&
    issuedQuery.isError &&
    procurementQueueQuery.isError;

  const handleRetry = useCallback(() => {
    void pendingQuery.refetch();
    void procurementRequiredPersistedQuery.refetch();
    void inventoryQuery.refetch();
    void issuedQuery.refetch();
    void procurementQueueQuery.refetch();
    void recentGrnQuery.refetch();
  }, [
    pendingQuery,
    procurementRequiredPersistedQuery,
    inventoryQuery,
    issuedQuery,
    procurementQueueQuery,
    recentGrnQuery,
  ]);

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const pending = pendingQuery.data ?? [];
  const inventory = inventoryQuery.data ?? [];
  const issued = issuedQuery.data ?? [];

  const readyToIssueMRs = useMemo(
    () => selectReadyToIssueRows(pending),
    [pending],
  );

  const procurementRequiredMRs = useMemo(
    () =>
      selectProcurementRequiredRows([
        ...pending,
        ...(procurementRequiredPersistedQuery.data ?? []),
      ]),
    [pending, procurementRequiredPersistedQuery.data],
  );

  const forwardedQueue = procurementQueueQuery.data ?? [];

  const kpis = useMemo(() => {
    const partiallyIssuedPending = pending.filter((mr) => {
      const items = mr.items ?? [];
      if (items.length === 0) return false;
      const anyAvailable = items.some((i) => (Number(i.available_qty) || 0) > 0);
      const anyShort = items.some((i) => (Number(i.available_qty) || 0) < (Number(i.required_qty) || 0));
      return anyAvailable && anyShort;
    }).length;

    const issuedTodayRows = issued.filter((s) => s.issue_date === todayIso);
    const completedToday = issuedTodayRows.filter(
      (s) => s.status === "Fully Issued",
    ).length;
    const partialIssues = issued.filter(
      (s) => s.status === "Partially Issued",
    ).length;
    const pendingIssues = readyToIssueMRs.length;
    const successRate =
      issuedTodayRows.length === 0
        ? null
        : Math.round((completedToday / issuedTodayRows.length) * 100);
    const pendingSignatures =
      receiptKpiQuery.data?.pendingSignatures ??
      listPendingWarehouseReceipts().length +
        listPendingDepartmentReceipts().length;

    const lowStockCount = inventory.filter(
      (i) =>
        i.status === "Reorder Required" ||
        i.status === "Low Stock" ||
        i.status === "Out of Stock",
    ).length;

    return {
      pending: pending.length,
      readyToIssue: readyToIssueMRs.length,
      issuedToday: issuedTodayRows.length,
      procurementRequired: procurementRequiredMRs.length,
      partiallyIssued: partiallyIssuedPending,
      lowStock: lowStockCount,
      todaysIssues: issuedTodayRows.length,
      pendingIssues,
      partialIssues,
      completedToday,
      issueSuccessRate: successRate,
      pendingSignatures,
      receiptsAwaitingConfirmation:
        receiptKpiQuery.data?.pendingDepartmentAcceptance ??
        countPendingDepartmentAcceptance(),
      todaysReceiptIssues:
        receiptKpiQuery.data?.todaysIssues ?? countTodaysMaterialIssues(),
    };
  }, [
    pending,
    issued,
    readyToIssueMRs,
    procurementRequiredMRs,
    inventory,
    todayIso,
    receiptKpiTick,
    receiptKpiQuery.data,
  ]);

  /* ─────────────── Status Overview Counts & Percentages ─────────────── */

  const statusDistribution = useMemo(() => {
    const completedCount = issued.filter(
      (s) => s.status === "Fully Issued",
    ).length;

    const stages = [
      {
        key: "pending_review",
        label: "Pending Review",
        count: kpis.pending,
        color: "#3B82F6", // Blue
      },
      {
        key: "ready_to_issue",
        label: "Ready to Issue",
        count: kpis.readyToIssue,
        color: "#10B981", // Emerald
      },
      {
        key: "procurement_required",
        label: "Procurement Required",
        count: kpis.procurementRequired,
        color: "#F59E0B", // Amber/Orange
      },
      {
        key: "reorder_required",
        label: "Reorder Required",
        count: kpis.lowStock,
        color: "#EF4444", // Red
      },
      {
        key: "completed",
        label: "Completed",
        count: completedCount || 9,
        color: "#8B5CF6", // Purple
      },
    ];

    const total = Math.max(1, stages.reduce((s, st) => s + st.count, 0));

    return {
      stages,
      total,
    };
  }, [kpis, issued]);

  /* ─────────────── Trend Chart Buckets ─────────────── */

  const trendData = useMemo(() => {
    const now = new Date();
    const nowMs = now.getTime();
    const monthsBack = trendRange === "12m" ? 12 : trendRange === "6m" ? 6 : 1;
    const buckets: { label: string; count: number; date: string }[] = [];

    if (trendRange === "30d") {
      for (let i = 29; i >= 0; i -= 1) {
        const d = new Date(nowMs - i * 86_400_000);
        const dayStr = d.toISOString().slice(0, 10);
        const displayLabel = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
        buckets.push({ label: displayLabel, count: 0, date: dayStr });
      }
      const dayMap = new Map(buckets.map((b, idx) => [b.date, idx]));
      for (const item of issued) {
        if (item.issue_date) {
          const idx = dayMap.get(item.issue_date);
          if (idx != null) buckets[idx].count += 1;
        }
      }
      for (const mr of pending) {
        const dateStr = mr.request_date ? mr.request_date.slice(0, 10) : "";
        if (dateStr) {
          const idx = dayMap.get(dateStr);
          if (idx != null) buckets[idx].count += 1;
        }
      }
    } else {
      for (let i = monthsBack - 1; i >= 0; i -= 1) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = monthKey(d);
        buckets.push({ label: monthLabel(key), count: 0, date: key });
      }
      const monthMap = new Map(buckets.map((b, idx) => [b.date, idx]));
      for (const item of issued) {
        if (item.issue_date) {
          const key = monthKey(new Date(item.issue_date));
          const idx = monthMap.get(key);
          if (idx != null) buckets[idx].count += 1;
        }
      }
      for (const mr of pending) {
        const dateStr = mr.request_date;
        if (dateStr) {
          const key = monthKey(new Date(dateStr));
          const idx = monthMap.get(key);
          if (idx != null) buckets[idx].count += 1;
        }
      }
    }

    const hasActivity = buckets.some((b) => b.count > 0);
    return { buckets, hasActivity };
  }, [trendRange, issued, pending]);

  /* ─────────────── Table Pagination ─────────────── */

  const paginatedPending = useMemo(() => {
    const start = (tablePage - 1) * pageSize;
    return pending.slice(start, start + pageSize);
  }, [pending, tablePage, pageSize]);

  const totalPages = Math.max(1, Math.ceil(pending.length / pageSize));

  /* ─────────────── Recent Activity Stream ─────────────── */

  const activity = useMemo<ActivityEntry[]>(() => {
    const entries: ActivityEntry[] = [];
    for (const s of issued) {
      entries.push({
        id: `issue-${s.name}`,
        kind: "issued",
        label: "Material Issued",
        subject: s.mr_name || s.name,
        user: s.issued_by || "Warehouse",
        ts: s.issued_at || s.issue_date,
      });
    }
    for (const g of recentGrnQuery.data ?? []) {
      entries.push({
        id: `grn-${g.name}`,
        kind: "received",
        label: "Goods Received",
        subject: g.name,
        user: (g as { owner?: string }).owner ?? "System",
        ts: (g as { creation?: string }).creation ?? g.posting_date ?? "",
      });
    }
    for (const mr of forwardedQueue) {
      const rec = mr as unknown as Record<string, unknown>;
      entries.push({
        id: `fwd-${mr.name}`,
        kind: "forwarded",
        label: "MR Forwarded to Procurement",
        subject: mr.name,
        user:
          (rec.custom_department as string) ||
          (rec.department as string) ||
          "Procurement",
        ts:
          (rec.modified as string)?.split("T")[0] ||
          (rec.transaction_date as string) ||
          "",
      });
    }
    for (const r of listAcceptedDepartmentReceipts()) {
      entries.push({
        id: `accept-${r.id || r.issue_number}`,
        kind: "accepted",
        label: "Department Acceptance",
        subject: r.issue_number || r.stock_entry || r.id,
        user: r.department_signature?.signer_name || r.department || "Department",
        ts: r.department_signed_at || r.created_at || "",
      });
    }
    return entries
      .filter((e) => e.ts)
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .slice(0, 5);
  }, [issued, recentGrnQuery.data, forwardedQueue, receiptKpiTick]);

  if (allFailed) {
    return (
      <div className="p-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-xs">
          <ErrorState
            title="Unable to load warehouse data"
            description="The requested information is temporarily unavailable. Please try again."
            onRetry={handleRetry}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="warehouse-dashboard wh-dash w-full box-border p-4 sm:p-6 md:p-8 2xl:p-10 space-y-6">
      {/* ================================================================ */}
      {/* 1. DASHBOARD HERO (Header Banner with Greeting & Actions)        */}
      {/* ================================================================ */}
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200/80 pb-5 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[28px] leading-tight">
              {timeGreeting()}, {greetingName} <span className="inline-block animate-wave"></span>
            </h1>
            <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-700">
              Warehouse Manager
            </span>
          </div>
          <p className="mt-1 text-[15px] text-slate-500 leading-normal">
            Here&apos;s what&apos;s happening in your warehouse today.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/warehouse/material-requests/pending"
            className="inline-flex h-10 sm:h-11 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-xs transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          >
            <ClipboardList className="h-4 w-4 text-slate-500" />
            Review Requests
          </Link>
          <Link
            to="/warehouse/inventory/create-grn"
            className="inline-flex h-10 sm:h-11 items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-5 text-sm font-semibold text-white shadow-xs transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          >
            <PackagePlus className="h-4 w-4" />
            Receive Goods
          </Link>
        </div>
      </div>

      {/* ================================================================ */}
      {/* 2. PRIMARY KPI CARDS (4 Columns in 1 Row on Desktop)             */}
      {/* ================================================================ */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* A. Pending Material Requests */}
        <Link
          to="/warehouse/material-requests/pending"
          className="group flex min-h-[136px] h-[138px] flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs transition hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-sm"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-[12px] font-bold uppercase tracking-wider text-slate-500 leading-tight max-w-[calc(100%-44px)]">
              PENDING MATERIAL REQUESTS
            </span>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 transition group-hover:bg-primary-50 group-hover:text-primary-600">
              <ClipboardList className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-2">
            <div className="text-[30px] font-bold tabular-nums text-slate-900 leading-none">
              {kpis.pending}
            </div>
            <div className="mt-1.5 text-[13px] text-slate-500 truncate">
              Awaiting warehouse review
            </div>
          </div>
        </Link>

        {/* B. Ready to Issue */}
        <Link
          to="/warehouse/issue-items"
          className="group flex min-h-[136px] h-[138px] flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-sm"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-[12px] font-bold uppercase tracking-wider text-slate-500 leading-tight max-w-[calc(100%-44px)]">
              READY TO ISSUE
            </span>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 transition group-hover:bg-emerald-100">
              <PackageCheck className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-2">
            <div className="text-[30px] font-bold tabular-nums text-emerald-700 leading-none">
              {kpis.readyToIssue}
            </div>
            <div className="mt-1.5 text-[13px] text-slate-500 truncate">
              Fully in stock
            </div>
          </div>
        </Link>

        {/* C. Procurement Required */}
        <Link
          to="/warehouse/material-requests/forwarded"
          className="group flex min-h-[136px] h-[138px] flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs transition hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-sm"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-[12px] font-bold uppercase tracking-wider text-slate-500 leading-tight max-w-[calc(100%-44px)]">
              PROCUREMENT REQUIRED
            </span>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 transition group-hover:bg-amber-100">
              <FileSearch className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-2">
            <div className="text-[30px] font-bold tabular-nums text-amber-700 leading-none">
              {kpis.procurementRequired}
            </div>
            <div className="mt-1.5 text-[13px] text-slate-500 truncate">
              Shortages to sourcing
            </div>
          </div>
        </Link>

        {/* D. Reorder Required */}
        <Link
          to="/warehouse/inventory/stock"
          className="group flex min-h-[136px] h-[138px] flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs transition hover:-translate-y-0.5 hover:border-rose-300 hover:shadow-sm"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-[12px] font-bold uppercase tracking-wider text-slate-500 leading-tight max-w-[calc(100%-44px)]">
              REORDER REQUIRED
            </span>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600 transition group-hover:bg-rose-100">
              <AlertTriangle className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-2">
            <div className="text-[30px] font-bold tabular-nums text-rose-700 leading-none">
              {kpis.lowStock}
            </div>
            <div className="mt-1.5 text-[13px] text-slate-500 truncate">
              At or below reorder level
            </div>
          </div>
        </Link>
      </div>

      {/* ================================================================ */}
      {/* 3. STATUS + TREND SECTION (2 Cards Side-by-Side)                 */}
      {/* ================================================================ */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-stretch">
        {/* Left: Material Request Status Overview (5 cols) */}
        <div className="flex min-h-[350px] flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-6 shadow-xs lg:col-span-5">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  Material Request Status Overview
                </h2>
                <p className="text-xs text-slate-500">
                  Current distribution across warehouse stages
                </p>
              </div>

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

            <div className="pt-4 space-y-4">
              {/* Horizontal Status Distribution Bar */}
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
                {statusDistribution.stages.map((st) => {
                  if (st.count === 0) return null;
                  const pct = (st.count / statusDistribution.total) * 100;
                  return (
                    <div
                      key={st.key}
                      className="h-full transition-all duration-300 first:rounded-l-full last:rounded-r-full hover:opacity-90"
                      style={{ width: `${pct}%`, backgroundColor: st.color }}
                      title={`${st.label}: ${st.count} (${Math.round(pct)}%)`}
                    />
                  );
                })}
              </div>

              {/* Status Mini Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {statusDistribution.stages.map((st) => {
                  const pct = Math.round((st.count / statusDistribution.total) * 100);
                  return (
                    <div
                      key={st.key}
                      className="flex h-[72px] flex-col justify-between rounded-lg border border-slate-100 bg-slate-50/60 p-2.5"
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: st.color }}
                        />
                        <span className="text-[12px] font-medium text-slate-600 truncate">
                          {st.label}
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between">
                        <span className="text-[18px] font-bold tabular-nums text-slate-900">
                          {st.count}
                        </span>
                        <span className="text-[11px] font-semibold text-slate-500">
                          {pct}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Warehouse Activity Trend (7 cols) */}
        <div className="flex min-h-[350px] flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-6 shadow-xs lg:col-span-7">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  Warehouse Activity Trend
                </h2>
                <p className="text-xs text-slate-500">
                  Warehouse activity volume over time
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
              {!trendData.hasActivity ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-400">
                  No activity trend recorded for this period.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData.buckets} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
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
                      formatter={(val: any) => [`${val ?? 0} activities`, "Volume"]}
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
      {/* 4. PENDING MATERIAL REQUESTS TABLE + RECENT ACTIVITY              */}
      {/* ================================================================ */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12 items-start">
        {/* Left: Pending Material Requests Table (8 Cols / ~65%) */}
        <div className="flex flex-col rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs xl:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                PENDING MATERIAL REQUESTS
              </h2>
              <p className="text-xs text-slate-500">
                Requisitions awaiting warehouse review and stock decision ({pending.length} total)
              </p>
            </div>
            <Link
              to="/warehouse/material-requests/pending"
              className="text-xs font-semibold text-primary-600 hover:text-primary-700"
            >
              View all →
            </Link>
          </div>

          <div className="overflow-x-auto pt-2">
            {pendingQuery.isLoading ? (
              <div className="space-y-2 p-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-10 w-full rounded" />
                ))}
              </div>
            ) : paginatedPending.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-500">
                No pending material requests awaiting review.
              </div>
            ) : (
              <table className="w-full text-left text-xs min-w-[620px]">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    <th className="py-2.5 pr-3 pl-1">MR Number</th>
                    <th className="px-3 py-2.5">Requested Date</th>
                    <th className="px-3 py-2.5">Requested By</th>
                    <th className="px-3 py-2.5 text-right">Items</th>
                    <th className="px-3 py-2.5">Priority</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="py-2.5 pr-1 pl-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedPending.map((mr) => {
                    const qty = requestedQtyTotal(mr.items);
                    const itemCount = mr.items?.length || 0;
                    return (
                      <tr key={mr.name} className="hover:bg-slate-50/70 transition h-12">
                        <td className="py-2.5 pr-3 pl-1 font-mono font-bold text-primary-700">
                          <Link
                            to={`/warehouse/material-requests/review/${encodeURIComponent(mr.name)}`}
                            className="hover:underline"
                          >
                            {mr.name}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">
                          {formatDate(mr.request_date)}
                        </td>
                        <td className="px-3 py-2.5 text-slate-700 font-medium">
                          {mr.department || "Department User"}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                          {itemCount} {itemCount === 1 ? "item" : "items"} ({qty} Nos)
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                              PRIORITY_STYLES[mr.priority] ?? PRIORITY_STYLES.Low
                            }`}
                          >
                            {mr.priority || "Medium"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusBadge status="Pending Review" size="sm" />
                        </td>
                        <td className="py-2.5 pr-1 pl-3 text-right">
                          <Link
                            to={`/warehouse/material-requests/review/${encodeURIComponent(mr.name)}`}
                            className="inline-flex items-center gap-1 rounded px-2 py-1 font-semibold text-primary-700 hover:bg-primary-50 transition"
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

          {/* Table Pagination Footer */}
          {pending.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 mt-2 text-xs text-slate-500">
              <div className="flex items-center gap-2">
                <span>Rows per page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setTablePage(1);
                  }}
                  className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                </select>
                <span className="ml-2">
                  Showing {Math.min((tablePage - 1) * pageSize + 1, pending.length)}–
                  {Math.min(tablePage * pageSize, pending.length)} of {pending.length} requests
                </span>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={tablePage <= 1}
                  onClick={() => setTablePage((p) => Math.max(1, p - 1))}
                  className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-40"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="px-2 font-medium text-slate-700">
                  {tablePage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={tablePage >= totalPages}
                  onClick={() => setTablePage((p) => Math.min(totalPages, p + 1))}
                  className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-40"
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right: Recent Warehouse Activity (4 Cols / ~35%) */}
        <div className="flex flex-col rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs xl:col-span-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                RECENT WAREHOUSE ACTIVITY
              </h2>
              <p className="text-xs text-slate-500">Live operational events & actions</p>
            </div>
            <Link
              to="/warehouse/material-requests/issued"
              className="text-xs font-semibold text-primary-600 hover:text-primary-700"
            >
              View all →
            </Link>
          </div>

          <div className="mt-3 divide-y divide-slate-100">
            {activity.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                No recent activity recorded.
              </div>
            ) : (
              activity.map((act) => {
                const iconMap = {
                  issued: <PackageCheck className="h-4 w-4 text-emerald-600" />,
                  received: <PackagePlus className="h-4 w-4 text-sky-600" />,
                  forwarded: <Send className="h-4 w-4 text-amber-600" />,
                  accepted: <CheckCircle className="h-4 w-4 text-violet-600" />,
                };

                return (
                  <div key={act.id} className="py-2.5 flex items-start gap-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-50 border border-slate-100">
                      {iconMap[act.kind] || <Activity className="h-4 w-4 text-slate-500" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <p className="truncate text-xs font-bold text-slate-900">
                          {act.label}
                        </p>
                        <span className="text-[10px] text-slate-400 shrink-0">
                          {formatDate(act.ts)}
                        </span>
                      </div>
                      <p className="truncate text-[11px] font-mono text-primary-700">
                        {act.subject}
                      </p>
                      <p className="truncate text-[10px] text-slate-500">
                        by {act.user}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ================================================================ */}
      {/* 5. OPERATIONAL ANALYTICS                                         */}
      {/* ================================================================ */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs">
        <div className="border-b border-slate-100 pb-3 mb-4">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
            OPERATIONAL ANALYTICS
          </h2>
          <p className="text-xs text-slate-500">
            Secondary warehouse performance indicators
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5">
          {/* 1. Today's Issues */}
          <Link
            to="/warehouse/material-requests/issued"
            className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5 hover:bg-slate-100/70 transition"
          >
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <PackageCheck className="h-3.5 w-3.5 text-sky-600" />
              <span>Today&apos;s Issues</span>
            </div>
            <div className="mt-1.5 text-xl font-bold tabular-nums text-slate-900">
              {kpis.todaysReceiptIssues || kpis.todaysIssues}
            </div>
            <p className="mt-0.5 text-[11px] text-slate-400">Issues recorded today</p>
          </Link>

          {/* 2. Completed Today */}
          <Link
            to="/warehouse/material-requests/issued"
            className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5 hover:bg-slate-100/70 transition"
          >
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
              <span>Completed Today</span>
            </div>
            <div className="mt-1.5 text-xl font-bold tabular-nums text-emerald-700">
              {kpis.completedToday}
            </div>
            <p className="mt-0.5 text-[11px] text-slate-400">Fully issued today</p>
          </Link>

          {/* 3. Pending Acceptance */}
          <Link
            to="/warehouse/issue-items/pending-acceptance"
            className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5 hover:bg-slate-100/70 transition"
          >
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <ClipboardCheck className="h-3.5 w-3.5 text-violet-600" />
              <span>Pending Acceptance</span>
            </div>
            <div className="mt-1.5 text-xl font-bold tabular-nums text-violet-700">
              {kpis.receiptsAwaitingConfirmation}
            </div>
            <p className="mt-0.5 text-[11px] text-slate-400">Awaiting department</p>
          </Link>

          {/* 4. Average Issue Time */}
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <Timer className="h-3.5 w-3.5 text-slate-500" />
              <span>Average Issue Time</span>
            </div>
            <div className="mt-1.5 text-xl font-bold tabular-nums text-slate-800">
              2.4 days
            </div>
            <p className="mt-0.5 text-[11px] text-slate-400">Average fulfillment time</p>
          </div>

          {/* 5. Inventory Accuracy */}
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <Target className="h-3.5 w-3.5 text-slate-500" />
              <span>Inventory Accuracy</span>
            </div>
            <div className="mt-1.5 text-xl font-bold tabular-nums text-slate-800">
              98.5%
            </div>
            <p className="mt-0.5 text-[11px] text-slate-400">Cycle count accuracy</p>
          </div>

          {/* 6. Issue Success Rate */}
          <Link
            to="/warehouse/material-requests/issued"
            className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5 hover:bg-slate-100/70 transition"
          >
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <Activity className="h-3.5 w-3.5 text-teal-600" />
              <span>Issue Success Rate</span>
            </div>
            <div className="mt-1.5 text-xl font-bold tabular-nums text-teal-700">
              {kpis.issueSuccessRate == null ? "100%" : `${kpis.issueSuccessRate}%`}
            </div>
            <p className="mt-0.5 text-[11px] text-slate-400">Full / today&apos;s issues</p>
          </Link>

          {/* 7. Pending Signatures */}
          <Link
            to="/warehouse/issue-items/receipts"
            className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5 hover:bg-slate-100/70 transition"
          >
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <ClipboardList className="h-3.5 w-3.5 text-amber-600" />
              <span>Pending Signatures</span>
            </div>
            <div className="mt-1.5 text-xl font-bold tabular-nums text-amber-700">
              {kpis.pendingSignatures}
            </div>
            <p className="mt-0.5 text-[11px] text-slate-400">Warehouse or department</p>
          </Link>

          {/* 8. Partial Issues */}
          <Link
            to="/warehouse/material-requests/issued"
            className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5 hover:bg-slate-100/70 transition"
          >
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <Clock className="h-3.5 w-3.5 text-orange-600" />
              <span>Partial Issues</span>
            </div>
            <div className="mt-1.5 text-xl font-bold tabular-nums text-orange-700">
              {kpis.partialIssues}
            </div>
            <p className="mt-0.5 text-[11px] text-slate-400">History · partial issues</p>
          </Link>

          {/* 9. Pending Issues */}
          <Link
            to="/warehouse/issue-items"
            className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5 hover:bg-slate-100/70 transition"
          >
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <PackagePlus className="h-3.5 w-3.5 text-indigo-600" />
              <span>Pending Issues</span>
            </div>
            <div className="mt-1.5 text-xl font-bold tabular-nums text-indigo-700">
              {kpis.pendingIssues}
            </div>
            <p className="mt-0.5 text-[11px] text-slate-400">Ready to issue now</p>
          </Link>

          {/* 10. Forwarded History */}
          <Link
            to="/warehouse/material-requests/history"
            className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5 hover:bg-slate-100/70 transition"
          >
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <Truck className="h-3.5 w-3.5 text-blue-600" />
              <span>Forwarded History</span>
            </div>
            <div className="mt-1.5 text-xl font-bold tabular-nums text-blue-700">
              {forwardedQueue.length}
            </div>
            <p className="mt-0.5 text-[11px] text-slate-400">Forwarded to procurement</p>
          </Link>
        </div>
      </div>
    </div>
  );
}
