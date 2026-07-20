import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Award,
  Bell,
  BarChart3,
  Boxes,
  Building2,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Cpu,
  Database,
  DollarSign,
  FilePlus2,
  FileText,
  Gauge,
  Gavel,
  Landmark,
  Mail,
  Package,
  PackageCheck,
  Scale,
  Server,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Star,
  Timer,
  Truck,
  UserPlus,
  Users,
  Wallet,
  Warehouse,
  Workflow,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { getAdminKpis } from "../../api/admin";
import { fetchDashboardAnalytics, fetchDashboardCounts } from "../../api/dashboard";
import { getAuditTrail } from "../../api/auditTrail";
import { fetchMaterialRequestDashboardCounts } from "../../api/materialRequestWorkflow";
import { computeSla, fetchSlaReport, listAllTimers } from "../../api/sla";
import { formatSlaDuration } from "../../components/sla/SlaBadge";
import {
  currentLowestBid,
  deriveAuctionStatus,
  listReverseBiddings,
  summarizeBidHistory,
} from "../../api/reverseBidding";
import { getBudgetKpis, getFinanceManagerDashboard } from "../../api/budget";
import { fetchWarehouseStockSummary } from "../../api/warehouseStock";
import { getPendingMaterialRequests } from "../../services/warehouseService";
import { getLegalReviews } from "../../api/legalReviews";
import { getFinanceReviews } from "../../api/financeReviews";
import { getApprovedRFQsAwaitingPO } from "../../api/purchasing";
import { getSupplierPerformance } from "../../api/supplierPerformance";
import { listPendingIndirectApprovals } from "../../api/adminApprovals";
import { getAllNotifications } from "../../api/notifications";
import { getCount } from "../../api/erpnext";
import { buildTopSuppliersWithTrend, computeMonthlySpendTrend } from "../../utils/dashboardUtils";
import { Skeleton } from "../../components/Skeleton";
import { useOptionalLayout } from "../../contexts/LayoutContext";
import { formatCurrencyCompact, formatDateTime } from "../../utils/format";

const AdminSpendCharts = lazy(() => import("../../components/dashboard/AdminSpendCharts"));

/* ─── Shared style tokens ─────────────────────────────────────────────────── */

type Tone =
  | "blue"
  | "violet"
  | "cyan"
  | "amber"
  | "rose"
  | "emerald"
  | "indigo"
  | "orange"
  | "teal"
  | "slate";

const TONE: Record<Tone, { iconBg: string; icon: string }> = {
  blue: { iconBg: "bg-blue-100", icon: "text-blue-600" },
  violet: { iconBg: "bg-violet-100", icon: "text-violet-600" },
  cyan: { iconBg: "bg-cyan-100", icon: "text-cyan-600" },
  amber: { iconBg: "bg-amber-100", icon: "text-amber-600" },
  rose: { iconBg: "bg-rose-100", icon: "text-rose-600" },
  emerald: { iconBg: "bg-emerald-100", icon: "text-emerald-600" },
  indigo: { iconBg: "bg-indigo-100", icon: "text-indigo-600" },
  orange: { iconBg: "bg-orange-100", icon: "text-orange-600" },
  teal: { iconBg: "bg-teal-100", icon: "text-teal-600" },
  slate: { iconBg: "bg-neutral-100", icon: "text-neutral-500" },
};

type StatusKind = "healthy" | "warning" | "offline" | "neutral";

const STATUS_STYLE: Record<StatusKind, { dot: string; text: string; chip: string }> = {
  healthy: { dot: "bg-emerald-500", text: "text-emerald-700", chip: "bg-emerald-50 text-emerald-700" },
  warning: { dot: "bg-amber-500", text: "text-amber-700", chip: "bg-amber-50 text-amber-700" },
  offline: { dot: "bg-rose-500", text: "text-rose-700", chip: "bg-rose-50 text-rose-700" },
  neutral: { dot: "bg-neutral-300", text: "text-neutral-500", chip: "bg-neutral-100 text-neutral-500" },
};

function parseErpDate(value?: string | null): number | null {
  if (!value) return null;
  const iso = value.includes("T") ? value : value.replace(" ", "T");
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function backlogTone(count: number): Tone {
  if (count <= 0) return "slate";
  if (count <= 5) return "emerald";
  if (count <= 15) return "amber";
  return "rose";
}

/* ─── Page ────────────────────────────────────────────────────────────────── */

export default function AdminDashboardPage() {
  const { t } = useTranslation();
  const layout = useOptionalLayout();
  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  // Ticker for live countdowns (auctions + SLA) — 30s cadence, efficient.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  /* ── Queries (each loads independently for progressive rendering) ──────── */
  const kpisQ = useQuery({ queryKey: ["admin-kpis"], queryFn: getAdminKpis, staleTime: 60_000, retry: false });
  const countsQ = useQuery({ queryKey: ["dashboard-counts"], queryFn: fetchDashboardCounts, staleTime: 60_000, retry: false });
  const analyticsQ = useQuery({ queryKey: ["dashboard-analytics"], queryFn: fetchDashboardAnalytics, staleTime: 300_000, retry: false });
  const mrCountsQ = useQuery({ queryKey: ["admin-mr-counts"], queryFn: () => fetchMaterialRequestDashboardCounts({}), staleTime: 60_000, retry: false });
  const slaQ = useQuery({ queryKey: ["admin-sla-report"], queryFn: fetchSlaReport, staleTime: 60_000, retry: false });
  const slaTimersQ = useQuery({ queryKey: ["admin-sla-timers"], queryFn: listAllTimers, staleTime: 30_000, retry: false });
  const auctionsQ = useQuery({ queryKey: ["admin-auctions"], queryFn: listReverseBiddings, staleTime: 30_000, retry: false });
  const budgetQ = useQuery({ queryKey: ["admin-budget-kpis"], queryFn: getBudgetKpis, staleTime: 60_000, retry: false });
  const financeDashQ = useQuery({ queryKey: ["admin-finance-dashboard"], queryFn: getFinanceManagerDashboard, staleTime: 300_000, retry: false });
  const warehouseQ = useQuery({ queryKey: ["admin-warehouse-stock"], queryFn: () => fetchWarehouseStockSummary(), staleTime: 60_000, retry: false });
  const readyIssueQ = useQuery({ queryKey: ["admin-ready-issue"], queryFn: getPendingMaterialRequests, staleTime: 60_000, retry: false });
  const legalPendingQ = useQuery({ queryKey: ["admin-legal-pending"], queryFn: () => getLegalReviews({ status: "Pending Legal Review" }), staleTime: 60_000, retry: false });
  const financePendingQ = useQuery({ queryKey: ["admin-finance-pending"], queryFn: () => getFinanceReviews({ status: "Pending Finance Review" }), staleTime: 60_000, retry: false });
  const poQueueQ = useQuery({ queryKey: ["admin-po-queue"], queryFn: getApprovedRFQsAwaitingPO, staleTime: 60_000, retry: false });
  const pendingApprQ = useQuery({ queryKey: ["admin-pending-indirect"], queryFn: listPendingIndirectApprovals, staleTime: 60_000, retry: false });
  const auditQ = useQuery({ queryKey: ["admin-recent-activity"], queryFn: () => getAuditTrail({ pageSize: 5 }), staleTime: 30_000, retry: false });
  const blockedQ = useQuery({ queryKey: ["admin-suppliers-blocked"], queryFn: () => getCount("Supplier", [["disabled", "=", 1]]), staleTime: 300_000, retry: false });
  const sqCountQ = useQuery({ queryKey: ["admin-sq-count"], queryFn: () => getCount("Supplier Quotation", [["docstatus", "=", 1]]), staleTime: 60_000, retry: false });

  /* ── Derived values ─────────────────────────────────────────────────────── */
  const monthlySpend = useMemo(
    () => (analyticsQ.data ? computeMonthlySpendTrend(analyticsQ.data.invoices) : []),
    [analyticsQ.data],
  );
  const mtdSpend = monthlySpend.length ? monthlySpend[monthlySpend.length - 1].spend : 0;
  const monthTrend = useMemo(() => {
    if (monthlySpend.length < 2) return null;
    const last = monthlySpend[monthlySpend.length - 1].spend;
    const prev = monthlySpend[monthlySpend.length - 2].spend;
    if (!prev) return null;
    return ((last - prev) / prev) * 100;
  }, [monthlySpend]);

  const topSuppliers = useMemo(
    () => (analyticsQ.data ? buildTopSuppliersWithTrend(analyticsQ.data.invoices, analyticsQ.data.poSamples, 6) : []),
    [analyticsQ.data],
  );
  const supplierNames = useMemo(() => topSuppliers.map((s) => s.supplier), [topSuppliers]);
  const perfQ = useQuery({
    queryKey: ["admin-supplier-perf", supplierNames],
    queryFn: () => getSupplierPerformance(supplierNames),
    enabled: supplierNames.length > 0,
    staleTime: 300_000,
    retry: false,
  });
  const perfAgg = useMemo(() => {
    const map = perfQ.data;
    if (!map) return null;
    const arr = Object.values(map).filter((p) => p.has_sufficient_data);
    if (arr.length === 0) return null;
    const onTime = arr.reduce((s, p) => s + p.on_time_deliveries, 0);
    const late = arr.reduce((s, p) => s + p.late_deliveries, 0);
    const onTimePct = onTime + late > 0 ? (onTime / (onTime + late)) * 100 : null;
    const avgDelay = arr.reduce((s, p) => s + p.avg_delay_days, 0) / arr.length;
    return { onTimePct, avgDelay };
  }, [perfQ.data]);

  const liveAuctions = useMemo(
    () => (auctionsQ.data ?? []).filter((a) => deriveAuctionStatus(a, now) === "Live").length,
    [auctionsQ.data, now],
  );
  const monitorAuctions = useMemo(() => {
    const list = auctionsQ.data ?? [];
    return list
      .map((a) => ({ a, status: deriveAuctionStatus(a, now) }))
      .filter((x) => x.status === "Live" || x.status === "Scheduled")
      .sort((x, y) => (x.status === "Live" ? -1 : 1) - (y.status === "Live" ? -1 : 1))
      .slice(0, 6);
  }, [auctionsQ.data, now]);

  const readyToIssue = useMemo(() => {
    const list = readyIssueQ.data ?? [];
    return list.filter((mr) => {
      const items = mr.items ?? [];
      return items.length > 0 && items.every((it) => it.status === "Available");
    }).length;
  }, [readyIssueQ.data]);

  const upcomingSla = useMemo(() => {
    const timers = slaTimersQ.data ?? [];
    return timers
      .map((tm) => ({ tm, c: computeSla(tm, now) }))
      .filter((x) => (x.c.phase === "on_track" || x.c.phase === "due_soon") && x.c.dueMs !== null)
      .sort((x, y) => x.c.remainingMs - y.c.remainingMs)
      .slice(0, 5);
  }, [slaTimersQ.data, now]);

  const notifications = useMemo(
    () =>
      [...getAllNotifications()]
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
        .slice(0, 6),
    [],
  );

  const highPriorityApprovals = useMemo(
    () => (pendingApprQ.data ?? []).filter((r) => /high|urgent|critical/i.test(r.priority ?? "")).length,
    [pendingApprQ.data],
  );

  const budgetUtil = budgetQ.data?.utilizationPct;
  const slaBreaches = slaQ.data?.breached ?? 0;

  /* ── AI insights (derived from live data — never fabricated) ───────────── */
  const insights = useMemo(() => {
    const out: Array<{ id: string; level: "critical" | "warning" | "info" | "good"; text: string }> = [];
    if (typeof budgetUtil === "number" && budgetUtil >= 75) {
      out.push({
        id: "budget",
        level: budgetUtil >= 90 ? "critical" : "warning",
        text: t("adminDashboard.ai.budgetHigh", { pct: Math.round(budgetUtil) }),
      });
    }
    if (slaBreaches > 0) out.push({ id: "sla-breached", level: "critical", text: t("adminDashboard.ai.slaBreached", { count: slaBreaches }) });
    const dueSoon = slaQ.data?.dueSoon ?? 0;
    if (dueSoon > 0) out.push({ id: "sla-due", level: "warning", text: t("adminDashboard.ai.slaDueSoon", { count: dueSoon }) });
    const pend = pendingApprQ.data?.length ?? 0;
    if (pend > 0) out.push({ id: "appr", level: "info", text: t("adminDashboard.ai.rfqAttention", { count: pend }) });
    if (liveAuctions > 0) out.push({ id: "auc", level: "info", text: t("adminDashboard.ai.auctionsLive", { count: liveAuctions }) });
    const low = (warehouseQ.data?.kpis.lowStockCount ?? 0) + (warehouseQ.data?.kpis.outOfStockCount ?? 0);
    if (low > 0) out.push({ id: "stock", level: "warning", text: t("adminDashboard.ai.lowStock", { count: low }) });
    return out;
  }, [budgetUtil, slaBreaches, slaQ.data, pendingApprQ.data, liveAuctions, warehouseQ.data, t]);

  /* ── System health ──────────────────────────────────────────────────────── */
  const coreError = kpisQ.isError || countsQ.isError;
  const coreLoading = kpisQ.isLoading || countsQ.isLoading;
  const coreState: StatusKind = coreError ? "offline" : coreLoading ? "warning" : "healthy";

  /* ── Pipeline stages ────────────────────────────────────────────────────── */
  const counts = countsQ.data;
  const mrCounts = mrCountsQ.data;
  const pipeline: Array<{ label: string; count: number; to: string }> = [
    { label: t("adminDashboard.pipeline.materialRequest"), count: mrCounts?.myRequests ?? 0, to: "/material-requests/list" },
    { label: t("adminDashboard.pipeline.warehouseReview"), count: mrCounts?.pendingWarehouseReview ?? 0, to: "/warehouse/material-requests/pending" },
    { label: t("adminDashboard.pipeline.procurementReview"), count: mrCounts?.pendingProcurement ?? 0, to: "/material-requests/procurement" },
    { label: t("adminDashboard.pipeline.rfqCreated"), count: counts?.openRfqs ?? 0, to: "/admin/procurement" },
    // Standalone Supplier Quotations module removed — access quotations via RFQ workflow.
    { label: t("adminDashboard.pipeline.supplierQuotations"), count: sqCountQ.data ?? 0, to: "/sourcing/rfq?preset=open" },
    { label: t("adminDashboard.pipeline.legalReview"), count: legalPendingQ.data?.length ?? 0, to: "/legal/reviews" },
    { label: t("adminDashboard.pipeline.financeReview"), count: financePendingQ.data?.items.length ?? 0, to: "/budget/pending-reviews" },
    { label: t("adminDashboard.pipeline.purchaseOrder"), count: counts?.activePos ?? 0, to: "/p2p/purchase-orders" },
    { label: t("adminDashboard.pipeline.grn"), count: counts?.pendingGrns ?? 0, to: "/p2p/grn" },
    { label: t("adminDashboard.pipeline.invoice"), count: counts?.unpaidInvoices ?? 0, to: "/p2p/invoices" },
    { label: t("adminDashboard.pipeline.payment"), count: counts?.pendingPayments ?? 0, to: "/p2p/payments" },
  ];

  const quickActions: Array<{ label: string; to: string; icon: LucideIcon }> = [
    { label: t("adminDashboard.quickActions.createRfq"), to: "/sourcing/rfq/new", icon: FilePlus2 },
    { label: t("adminDashboard.quickActions.createSupplier"), to: "/suppliers/new", icon: Building2 },
    { label: t("adminDashboard.quickActions.createUser"), to: "/admin/users", icon: UserPlus },
    { label: t("adminDashboard.quickActions.startAuction"), to: "/sourcing/reverse-bidding", icon: Gavel },
    { label: t("adminDashboard.quickActions.viewReports"), to: "/admin/reports", icon: BarChart3 },
    { label: t("adminDashboard.quickActions.manageWorkflow"), to: "/admin/workflows", icon: Workflow },
    { label: t("adminDashboard.quickActions.manageSla"), to: "/admin/sla-configuration", icon: Timer },
  ];

  const financeDash = financeDashQ.data;

  return (
    <div className="-mt-1 space-y-3 pb-4">
      {/* ── Header + Quick Actions (Section 12) ─────────────────────────────── */}
      <header className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 shadow-sm">
            <ShieldCheck className="h-4.5 w-4.5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold leading-tight text-neutral-900">{t("adminDashboard.title")}</h1>
            <p className="text-[11px] text-neutral-500">{t("adminDashboard.subtitle")}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {quickActions.map((qa) => (
            <Link
              key={qa.to + qa.label}
              to={qa.to}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-neutral-700 no-underline shadow-sm transition hover:-translate-y-0.5 hover:border-primary-300 hover:text-primary-700 hover:shadow-md"
            >
              <qa.icon className="h-3.5 w-3.5 text-primary-500" />
              {qa.label}
            </Link>
          ))}
        </div>
      </header>

      {/* ── Section 1: Executive KPI Cards ──────────────────────────────────── */}
      <section>
        <SectionHeader icon={Gauge} title={t("adminDashboard.sections.executiveOverview")} />
        {coreLoading ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-[86px] rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <KpiCard icon={Users} tone="blue" label={t("adminDashboard.kpi.totalUsers")} value={kpisQ.data?.totalUsers ?? 0} to="/admin/users" />
            <KpiCard icon={Truck} tone="violet" label={t("adminDashboard.kpi.activeSuppliers")} value={counts?.activeSuppliers ?? kpisQ.data?.totalSuppliers ?? 0} to="/admin/suppliers" />
            <KpiCard icon={FileText} tone="cyan" label={t("adminDashboard.kpi.openRfqs")} value={counts?.openRfqs ?? kpisQ.data?.totalRFQs ?? 0} to="/admin/procurement" />
            <KpiCard icon={Gavel} tone="indigo" label={t("adminDashboard.kpi.liveAuctions")} value={liveAuctions} to="/sourcing/reverse-bidding" />
            <KpiCard icon={Clock} tone="rose" label={t("adminDashboard.kpi.pendingApprovals")} value={pendingApprQ.data?.length ?? kpisQ.data?.pendingApprovals ?? 0} to="/admin/approvals/pending" />
            <KpiCard icon={ShoppingCart} tone="amber" label={t("adminDashboard.kpi.openPos")} value={counts?.activePos ?? kpisQ.data?.totalPOs ?? 0} to="/p2p/purchase-orders" />
            <KpiCard icon={Warehouse} tone="teal" label={t("adminDashboard.kpi.warehouseRequests")} value={mrCounts?.pendingWarehouseReview ?? 0} to="/warehouse/material-requests/pending" />
            <KpiCard
              icon={DollarSign}
              tone="emerald"
              label={t("adminDashboard.kpi.monthlySpend")}
              value={formatCurrencyCompact(mtdSpend)}
              to="/admin/reports"
              trend={monthTrend != null ? { value: monthTrend } : undefined}
            />
            <KpiCard
              icon={Wallet}
              tone={typeof budgetUtil === "number" && budgetUtil >= 90 ? "rose" : typeof budgetUtil === "number" && budgetUtil >= 75 ? "amber" : "emerald"}
              label={t("adminDashboard.kpi.budgetUtilization")}
              value={typeof budgetUtil === "number" ? `${Math.round(budgetUtil)}%` : "—"}
              to="/admin/budget"
            />
            <KpiCard icon={AlertTriangle} tone={slaBreaches > 0 ? "rose" : "emerald"} label={t("adminDashboard.kpi.slaBreaches")} value={slaBreaches} to="/admin/sla-reports" />
          </div>
        )}
      </section>

      {/* ── Section 2: Procurement Pipeline ─────────────────────────────────── */}
      <Panel icon={Workflow} title={t("adminDashboard.sections.procurementPipeline")}>
        <div className="flex items-stretch gap-1 overflow-x-auto pb-1 scrollbar-hidden">
          {pipeline.map((stage, idx) => {
            const tone = STATUS_STYLE[backlogTone(stage.count) === "slate" ? "neutral" : backlogTone(stage.count) === "emerald" ? "healthy" : backlogTone(stage.count) === "amber" ? "warning" : "offline"];
            return (
              <div key={stage.label} className="flex items-center">
                <Link
                  to={stage.to}
                  className="group flex min-w-[92px] flex-col items-center rounded-lg border border-neutral-200 bg-white px-2 py-2 text-center no-underline shadow-sm transition hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md"
                >
                  <span className="text-lg font-bold leading-none tabular-nums text-neutral-900">{stage.count}</span>
                  <span className="mt-1 text-[9px] font-medium leading-tight text-neutral-500">{stage.label}</span>
                  <span className={`mt-1 h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                </Link>
                {idx < pipeline.length - 1 && <ChevronRight className="mx-0.5 h-3.5 w-3.5 shrink-0 text-neutral-300" />}
              </div>
            );
          })}
        </div>
      </Panel>

      {/* ── Section 3: Approval Center ──────────────────────────────────────── */}
      <section>
        <SectionHeader icon={ShieldCheck} title={t("adminDashboard.sections.approvalCenter")} />
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <ApprovalCard icon={Clock} tone="rose" label={t("adminDashboard.approval.pendingApprovals")} count={pendingApprQ.data?.length ?? 0} highPriority={highPriorityApprovals} to="/admin/approvals/pending" loading={pendingApprQ.isLoading} />
          <ApprovalCard icon={Wallet} tone="emerald" label={t("adminDashboard.approval.budgetApproval")} count={budgetQ.data?.pendingApprovals ?? 0} to="/admin/budget" loading={budgetQ.isLoading} />
          <ApprovalCard icon={Scale} tone="violet" label={t("adminDashboard.approval.legalReview")} count={legalPendingQ.data?.length ?? 0} to="/legal/reviews" loading={legalPendingQ.isLoading} />
          <ApprovalCard icon={Landmark} tone="cyan" label={t("adminDashboard.approval.financeReview")} count={financePendingQ.data?.items.length ?? 0} to="/budget/pending-reviews" loading={financePendingQ.isLoading} />
          <ApprovalCard icon={ShoppingCart} tone="amber" label={t("adminDashboard.approval.poApproval")} count={poQueueQ.data?.length ?? 0} to="/p2p/purchase-orders" loading={poQueueQ.isLoading} />
          <ApprovalCard icon={Warehouse} tone="teal" label={t("adminDashboard.approval.warehouseReview")} count={mrCounts?.pendingWarehouseReview ?? 0} to="/warehouse/material-requests/pending" loading={mrCountsQ.isLoading} />
        </div>
      </section>

      {/* ── Section 4: Spend Analytics ──────────────────────────────────────── */}
      <section>
        <SectionHeader icon={BarChart3} title={t("adminDashboard.sections.spendAnalytics")} />
        <Suspense fallback={<Skeleton className="h-[260px] rounded-xl" />}>
          <AdminSpendCharts monthlySpend={monthlySpend} loading={analyticsQ.isLoading} />
        </Suspense>
        <div className="mt-2.5 grid gap-2.5 lg:grid-cols-2">
          <Panel icon={Building2} title={t("adminDashboard.charts.departmentSpend")}>
            <DepartmentSpendChart
              data={(financeDash?.departmentUtilization ?? []).slice(0, 8).map((d) => ({ label: d.department, allocated: d.allocated, consumed: d.consumed }))}
              loading={financeDashQ.isLoading}
              allocatedLabel={t("adminDashboard.charts.allocated")}
              consumedLabel={t("adminDashboard.charts.consumed")}
              emptyLabel={t("adminDashboard.common.noData")}
            />
          </Panel>
          <Panel icon={Wallet} title={t("adminDashboard.charts.budgetVsActual")}>
            <BudgetVsActualChart
              data={(financeDash?.budgetVsActual ?? []).slice(0, 8)}
              loading={financeDashQ.isLoading}
              budgetLabel={t("adminDashboard.charts.budget")}
              actualLabel={t("adminDashboard.charts.actual")}
              emptyLabel={t("adminDashboard.common.noData")}
            />
          </Panel>
        </div>
      </section>

      {/* ── Two-column: monitors (left) + insights sidebar (right) ──────────── */}
      <div className="grid gap-2.5 xl:grid-cols-[1fr_330px]">
        {/* Left column */}
        <div className="space-y-2.5">
          {/* Section 5: Reverse Auction Monitor */}
          <Panel icon={Gavel} title={t("adminDashboard.sections.auctionMonitor")}>
            {auctionsQ.isLoading ? (
              <Skeleton className="h-28 rounded-lg" />
            ) : monitorAuctions.length === 0 ? (
              <EmptyRow icon={Gavel} label={t("adminDashboard.auction.none")} />
            ) : (
              <div className="-mx-1 overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-neutral-100 text-[9px] uppercase tracking-wider text-neutral-400">
                      <th className="px-1.5 py-1 font-semibold">{t("adminDashboard.auction.id")}</th>
                      <th className="px-1.5 py-1 text-right font-semibold">{t("adminDashboard.auction.lowestBid")}</th>
                      <th className="px-1.5 py-1 text-right font-semibold">{t("adminDashboard.auction.timeRemaining")}</th>
                      <th className="px-1.5 py-1 text-center font-semibold">{t("adminDashboard.auction.suppliers")}</th>
                      <th className="px-1.5 py-1 text-center font-semibold">{t("adminDashboard.auction.round")}</th>
                      <th className="px-1.5 py-1 font-semibold">{t("adminDashboard.auction.status")}</th>
                      <th className="px-1.5 py-1 font-semibold">{t("adminDashboard.auction.winner")}</th>
                      <th className="px-1.5 py-1" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-50">
                    {monitorAuctions.map(({ a, status }) => {
                      const targetMs = status === "Live" ? parseErpDate(a.end_date_time) : parseErpDate(a.start_date_time);
                      const remaining = targetMs != null ? targetMs - now : null;
                      const joined = (a.invited_suppliers ?? []).filter((s) => s.joined_auction === 1).length || (a.invited_suppliers?.length ?? 0);
                      const round = summarizeBidHistory(a).currentRound;
                      return (
                        <tr key={a.name} className="hover:bg-neutral-50/60">
                          <td className="px-1.5 py-1.5 font-mono text-[10px] text-primary-600">{a.name}</td>
                          <td className="px-1.5 py-1.5 text-right font-semibold tabular-nums text-neutral-800">{formatCurrencyCompact(currentLowestBid(a))}</td>
                          <td className="px-1.5 py-1.5 text-right tabular-nums text-neutral-600">
                            {remaining != null && remaining > 0 ? formatSlaDuration(remaining) : t("adminDashboard.auction.ended")}
                          </td>
                          <td className="px-1.5 py-1.5 text-center tabular-nums text-neutral-600">{joined}</td>
                          <td className="px-1.5 py-1.5 text-center tabular-nums text-neutral-600">{round}</td>
                          <td className="px-1.5 py-1.5">
                            <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${status === "Live" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{status}</span>
                          </td>
                          <td className="px-1.5 py-1.5 text-neutral-600">{a.winning_supplier || "—"}</td>
                          <td className="px-1.5 py-1.5 text-right">
                            <Link to={`/sourcing/reverse-bidding/${encodeURIComponent(a.name)}`} className="text-[10px] font-semibold text-primary-600 no-underline hover:text-primary-700">
                              {t("adminDashboard.auction.open")}
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

          {/* Section 6: SLA Monitor */}
          <Panel icon={Timer} title={t("adminDashboard.sections.slaMonitor")}>
            {slaQ.isLoading ? (
              <Skeleton className="h-24 rounded-lg" />
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <SlaTile label={t("adminDashboard.sla.running")} value={slaQ.data?.running ?? 0} tone="healthy" />
                  <SlaTile label={t("adminDashboard.sla.warning")} value={slaQ.data?.dueSoon ?? 0} tone="warning" />
                  <SlaTile label={t("adminDashboard.sla.breached")} value={slaQ.data?.breached ?? 0} tone="offline" />
                  <SlaTile label={t("adminDashboard.sla.completed")} value={slaQ.data?.completed ?? 0} tone="neutral" />
                </div>
                <div className="mt-2.5">
                  <div className="mb-1 flex items-center justify-between text-[10px] text-neutral-500">
                    <span>{t("adminDashboard.sla.compliance")}</span>
                    <span className="font-semibold tabular-nums text-neutral-700">{Math.round(slaQ.data?.compliancePct ?? 0)}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                    <div
                      className={`h-full rounded-full ${(slaQ.data?.compliancePct ?? 0) >= 90 ? "bg-emerald-500" : (slaQ.data?.compliancePct ?? 0) >= 70 ? "bg-amber-500" : "bg-rose-500"}`}
                      style={{ width: `${Math.min(100, Math.max(0, slaQ.data?.compliancePct ?? 0))}%` }}
                    />
                  </div>
                </div>
                <div className="mt-2.5">
                  <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-neutral-400">{t("adminDashboard.sla.upcomingBreaches")}</p>
                  {upcomingSla.length === 0 ? (
                    <p className="py-2 text-center text-[11px] text-neutral-400">{t("adminDashboard.sla.noUpcoming")}</p>
                  ) : (
                    <div className="space-y-1.5">
                      {upcomingSla.map(({ tm, c }) => (
                        <div key={tm.name} className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between">
                              <span className="truncate text-[11px] font-medium text-neutral-700">{tm.sla_name || tm.workflow}</span>
                              <span className={`ml-2 shrink-0 text-[10px] font-semibold tabular-nums ${c.phase === "due_soon" ? "text-amber-600" : "text-neutral-500"}`}>{formatSlaDuration(c.remainingMs)}</span>
                            </div>
                            <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-neutral-100">
                              <div className={`h-full rounded-full ${c.phase === "due_soon" ? "bg-amber-500" : "bg-primary-500"}`} style={{ width: `${Math.min(100, c.pctElapsed)}%` }} />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </Panel>

          {/* Section 7: Supplier Analytics */}
          <section>
            <SectionHeader icon={Truck} title={t("adminDashboard.sections.supplierAnalytics")} />
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <KpiCard icon={Star} tone="amber" label={t("adminDashboard.supplier.topSupplier")} value={topSuppliers[0]?.supplier ?? "—"} sub={topSuppliers[0] ? formatCurrencyCompact(topSuppliers[0].spend) : undefined} small />
              <KpiCard icon={Award} tone="emerald" label={t("adminDashboard.supplier.highestRated")} value={bestSupplier(topSuppliers, "high")?.supplier ?? "—"} sub={bestSupplier(topSuppliers, "high") ? `${Math.round(bestSupplier(topSuppliers, "high")!.performanceScore)}%` : undefined} small />
              <KpiCard icon={AlertTriangle} tone="rose" label={t("adminDashboard.supplier.lowestRated")} value={bestSupplier(topSuppliers, "low")?.supplier ?? "—"} sub={bestSupplier(topSuppliers, "low") ? `${Math.round(bestSupplier(topSuppliers, "low")!.performanceScore)}%` : undefined} small />
              <KpiCard icon={ShieldCheck} tone="violet" label={t("adminDashboard.supplier.performanceScore")} value={topSuppliers.length ? `${Math.round(topSuppliers.reduce((s, x) => s + x.performanceScore, 0) / topSuppliers.length)}%` : "—"} small />
              <KpiCard icon={Truck} tone="blue" label={t("adminDashboard.supplier.activeSuppliers")} value={counts?.activeSuppliers ?? 0} small />
              <KpiCard icon={XCircle} tone="slate" label={t("adminDashboard.supplier.blocked")} value={blockedQ.data ?? 0} small />
              <KpiCard icon={CheckCircle2} tone="teal" label={t("adminDashboard.supplier.onTime")} value={perfAgg?.onTimePct != null ? `${Math.round(perfAgg.onTimePct)}%` : "—"} small />
              <KpiCard icon={Clock} tone="orange" label={t("adminDashboard.supplier.avgDelivery")} value={perfAgg?.avgDelay != null ? t("adminDashboard.supplier.days", { count: Math.round(perfAgg.avgDelay) }) : "—"} small />
            </div>
          </section>

          {/* Section 8: Inventory Snapshot */}
          <section>
            <SectionHeader icon={Boxes} title={t("adminDashboard.sections.inventorySnapshot")} />
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
              <KpiCard icon={AlertTriangle} tone="amber" label={t("adminDashboard.inventory.lowStock")} value={warehouseQ.data?.kpis.lowStockCount ?? 0} to="/warehouse/inventory/stock" small />
              <KpiCard icon={XCircle} tone="rose" label={t("adminDashboard.inventory.outOfStock")} value={warehouseQ.data?.kpis.outOfStockCount ?? 0} to="/warehouse/inventory/stock" small />
              <KpiCard icon={PackageCheck} tone="emerald" label={t("adminDashboard.inventory.readyToIssue")} value={readyToIssue} to="/warehouse/material-requests/pending" small loading={readyIssueQ.isLoading} />
              <KpiCard icon={ShoppingCart} tone="cyan" label={t("adminDashboard.inventory.procurementRequired")} value={mrCounts?.pendingProcurement ?? 0} to="/material-requests/procurement" small />
              <KpiCard icon={Package} tone="violet" label={t("adminDashboard.inventory.grnPending")} value={counts?.pendingGrns ?? 0} to="/p2p/grn" small />
              <KpiCard icon={ClipboardCheck} tone="slate" label={t("adminDashboard.inventory.awaitingInspection")} value="—" small />
            </div>
          </section>
        </div>

        {/* Right column: insights sidebar */}
        <div className="space-y-2.5">
          {/* Section 9: AI Insights */}
          <Panel icon={Sparkles} title={t("adminDashboard.sections.aiInsights")}>
            {insights.length === 0 ? (
              <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-emerald-800">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <p className="text-[11px] leading-snug">{t("adminDashboard.ai.allClear")}</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {insights.map((ins) => (
                  <InsightCard key={ins.id} level={ins.level} text={ins.text} />
                ))}
              </div>
            )}
          </Panel>

          {/* Section 10: Notifications */}
          <Panel
            icon={Bell}
            title={t("adminDashboard.sections.notifications")}
            action={
              <Link to="/notifications" className="text-[10px] font-semibold text-primary-600 no-underline hover:text-primary-700">
                {t("adminDashboard.common.viewAll")}
              </Link>
            }
          >
            {notifications.length === 0 ? (
              <EmptyRow icon={Bell} label={t("adminDashboard.common.noNotifications")} />
            ) : (
              <div className="space-y-1.5">
                {notifications.map((n) => (
                  <Link key={n.id} to={n.route_path || "/notifications"} className="flex items-start gap-2 rounded-lg px-1 py-1 no-underline transition hover:bg-neutral-50">
                    <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${n.read_status ? "bg-neutral-300" : "bg-primary-500"}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-semibold text-neutral-800">{n.title}</p>
                      <p className="truncate text-[10px] text-neutral-500">{n.description}</p>
                      <p className="text-[9px] tabular-nums text-neutral-400">{formatDateTime(n.created_at)}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Panel>

          {/* Section 11: Recent Activity (compact) */}
          <Panel
            icon={Activity}
            title={t("adminDashboard.sections.recentActivity")}
            action={
              <Link to="/admin/audit-trail" className="text-[10px] font-semibold text-primary-600 no-underline hover:text-primary-700">
                {t("adminDashboard.common.viewFullAuditTrail")}
              </Link>
            }
          >
            {(auditQ.data?.entries ?? []).length === 0 ? (
              <EmptyRow icon={Activity} label={t("adminDashboard.common.noActivity")} />
            ) : (
              <div className="space-y-1">
                {(auditQ.data?.entries ?? []).slice(0, 5).map((entry) => (
                  <div key={entry.name} className="flex items-start gap-2 rounded-lg px-1 py-1">
                    <ActivityDot action={entry.action} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] leading-snug text-neutral-800">
                        <span className="font-semibold">{entry.fullName}</span> <span className="text-neutral-500">{entry.action}</span>
                      </p>
                      <p className="text-[9px] tabular-nums text-neutral-400">{formatDateTime(entry.timestamp)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* System Health */}
          <Panel icon={Server} title={t("adminDashboard.sections.systemHealth")}>
            <div className="space-y-1">
              <HealthRow icon={Server} label={t("adminDashboard.health.backend")} state={coreState} t={t} />
              <HealthRow icon={Cpu} label={t("adminDashboard.health.erpnext")} state={coreState} t={t} />
              <HealthRow icon={Database} label={t("adminDashboard.health.database")} state={coreState} t={t} />
              <HealthRow icon={Activity} label={t("adminDashboard.health.api")} state={coreState} t={t} />
              <HealthRow icon={Mail} label={t("adminDashboard.health.email")} state="neutral" t={t} />
              <HealthRow icon={Bell} label={t("adminDashboard.health.notifications")} state="healthy" t={t} />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

function bestSupplier<T extends { performanceScore: number }>(rows: T[], which: "high" | "low"): T | undefined {
  if (rows.length === 0) return undefined;
  return [...rows].sort((a, b) => (which === "high" ? b.performanceScore - a.performanceScore : a.performanceScore - b.performanceScore))[0];
}


/* ─── Sub-components ──────────────────────────────────────────────────────── */

function SectionHeader({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <h2 className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
      <Icon className="h-3 w-3" />
      {title}
    </h2>
  );
}

function Panel({ icon: Icon, title, action, children }: { icon: LucideIcon; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 text-neutral-400" />
          <h2 className="text-xs font-semibold text-neutral-700">{title}</h2>
        </div>
        {action}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  tone,
  label,
  value,
  sub,
  to,
  trend,
  small,
  loading,
}: {
  icon: LucideIcon;
  tone: Tone;
  label: string;
  value: string | number;
  sub?: string;
  to?: string;
  trend?: { value: number };
  small?: boolean;
  loading?: boolean;
}) {
  const c = TONE[tone];
  if (loading) return <Skeleton className={`${small ? "h-[70px]" : "h-[86px]"} rounded-xl`} />;
  const content = (
    <div className="group h-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-center justify-between">
        <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${c.iconBg}`}>
          <Icon className={`h-3.5 w-3.5 ${c.icon}`} />
        </div>
        {trend && <TrendPill value={trend.value} />}
      </div>
      <p className={`mt-2 truncate font-bold leading-tight text-neutral-900 ${small ? "text-sm" : "text-lg"} ${typeof value === "number" ? "tabular-nums" : ""}`} title={typeof value === "string" ? value : undefined}>
        {value}
      </p>
      <p className="mt-0.5 truncate text-[10px] font-medium text-neutral-500">{label}</p>
      {sub && <p className="mt-0.5 truncate text-[9px] text-neutral-400">{sub}</p>}
    </div>
  );
  return to ? (
    <Link to={to} className="no-underline">
      {content}
    </Link>
  ) : (
    content
  );
}

function TrendPill({ value }: { value: number }) {
  const up = value >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  const cls = up ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600";
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${cls}`}>
      <Icon className="h-2.5 w-2.5" />
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

function ApprovalCard({
  icon: Icon,
  tone,
  label,
  count,
  highPriority,
  to,
  loading,
}: {
  icon: LucideIcon;
  tone: Tone;
  label: string;
  count: number;
  highPriority?: number;
  to: string;
  loading?: boolean;
}) {
  const { t } = useTranslation();
  const c = TONE[tone];
  if (loading) return <Skeleton className="h-[92px] rounded-xl" />;
  return (
    <div className="flex h-full flex-col rounded-xl border border-neutral-200 bg-white px-3 py-2.5 shadow-sm transition hover:shadow-md">
      <div className="flex items-center gap-2">
        <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${c.iconBg}`}>
          <Icon className={`h-3.5 w-3.5 ${c.icon}`} />
        </div>
        <div className="min-w-0">
          <p className="text-lg font-bold leading-none tabular-nums text-neutral-900">{count}</p>
          <p className="text-[9px] text-neutral-400">{t("adminDashboard.approval.pending")}</p>
        </div>
      </div>
      <p className="mt-1.5 truncate text-[10px] font-semibold text-neutral-600">{label}</p>
      <div className="mt-auto flex items-center justify-between pt-1.5">
        {highPriority && highPriority > 0 ? (
          <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[9px] font-semibold text-rose-600">{t("adminDashboard.approval.highPriority", { count: highPriority })}</span>
        ) : (
          <span />
        )}
        <Link to={to} className="text-[10px] font-semibold text-primary-600 no-underline hover:text-primary-700">
          {t("adminDashboard.approval.viewAll")}
        </Link>
      </div>
    </div>
  );
}

function SlaTile({ label, value, tone }: { label: string; value: number; tone: StatusKind }) {
  const s = STATUS_STYLE[tone];
  return (
    <div className="rounded-lg border border-neutral-100 bg-neutral-50/60 px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
        <span className="text-[9px] font-semibold uppercase tracking-wider text-neutral-400">{label}</span>
      </div>
      <p className="mt-1 text-lg font-bold leading-none tabular-nums text-neutral-900">{value}</p>
    </div>
  );
}

function InsightCard({ level, text }: { level: "critical" | "warning" | "info" | "good"; text: string }) {
  const styles: Record<typeof level, { box: string; icon: LucideIcon; iconCls: string }> = {
    critical: { box: "border-rose-200 bg-rose-50 text-rose-800", icon: AlertTriangle, iconCls: "text-rose-500" },
    warning: { box: "border-amber-200 bg-amber-50 text-amber-800", icon: AlertTriangle, iconCls: "text-amber-500" },
    info: { box: "border-primary-200 bg-primary-50 text-primary-800", icon: Sparkles, iconCls: "text-primary-500" },
    good: { box: "border-emerald-200 bg-emerald-50 text-emerald-800", icon: CheckCircle2, iconCls: "text-emerald-500" },
  };
  const s = styles[level];
  const Icon = s.icon;
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 ${s.box}`}>
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${s.iconCls}`} />
      <p className="text-[11px] leading-snug">{text}</p>
    </div>
  );
}

function HealthRow({ icon: Icon, label, state, t }: { icon: LucideIcon; label: string; state: StatusKind; t: TFunction }) {
  const s = STATUS_STYLE[state];
  const stateLabel = state === "healthy" ? t("adminDashboard.health.healthy") : state === "warning" ? t("adminDashboard.health.warning") : state === "offline" ? t("adminDashboard.health.offline") : t("adminDashboard.health.notMonitored");
  return (
    <div className="flex items-center justify-between rounded-lg px-1 py-1">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-neutral-400" />
        <span className="text-[11px] text-neutral-600">{label}</span>
      </div>
      <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${s.chip}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
        {stateLabel}
      </span>
    </div>
  );
}

function EmptyRow({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div className="py-6 text-center">
      <Icon className="mx-auto mb-1.5 h-5 w-5 text-neutral-300" />
      <p className="text-[11px] text-neutral-400">{label}</p>
    </div>
  );
}

function ActivityDot({ action }: { action: string }) {
  const lower = action.toLowerCase();
  if (lower.includes("creat") || lower.includes("submit") || lower.includes("approv"))
    return (
      <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-50">
        <CheckCircle2 className="h-2.5 w-2.5 text-emerald-600" />
      </div>
    );
  if (lower.includes("cancel") || lower.includes("delet") || lower.includes("reject"))
    return (
      <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-rose-50">
        <XCircle className="h-2.5 w-2.5 text-rose-600" />
      </div>
    );
  return (
    <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-neutral-100">
      <Activity className="h-2.5 w-2.5 text-neutral-500" />
    </div>
  );
}

/* ─── Charts ──────────────────────────────────────────────────────────────── */

function DepartmentSpendChart({
  data,
  loading,
  allocatedLabel,
  consumedLabel,
  emptyLabel,
}: {
  data: Array<{ label: string; allocated: number; consumed: number }>;
  loading?: boolean;
  allocatedLabel: string;
  consumedLabel: string;
  emptyLabel: string;
}) {
  if (loading) return <Skeleton className="h-[200px] rounded-lg" />;
  if (data.length === 0) return <EmptyRow icon={Building2} label={emptyLabel} />;
  return (
    <div className="h-[200px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={false} interval={0} angle={-20} textAnchor="end" height={40} />
          <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={false} tickFormatter={(v) => formatCurrencyCompact(Number(v))} width={48} />
          <Tooltip formatter={(v) => formatCurrencyCompact(Number(v))} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
          <Bar dataKey="allocated" name={allocatedLabel} fill="#0ea5e9" radius={[3, 3, 0, 0]} />
          <Bar dataKey="consumed" name={consumedLabel} fill="#f59e0b" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function BudgetVsActualChart({
  data,
  loading,
  budgetLabel,
  actualLabel,
  emptyLabel,
}: {
  data: Array<{ label: string; budget: number; actual: number }>;
  loading?: boolean;
  budgetLabel: string;
  actualLabel: string;
  emptyLabel: string;
}) {
  if (loading) return <Skeleton className="h-[200px] rounded-lg" />;
  if (data.length === 0) return <EmptyRow icon={Wallet} label={emptyLabel} />;
  return (
    <div className="h-[200px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={false} interval={0} angle={-20} textAnchor="end" height={40} />
          <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={false} tickFormatter={(v) => formatCurrencyCompact(Number(v))} width={48} />
          <Tooltip formatter={(v) => formatCurrencyCompact(Number(v))} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
          <Bar dataKey="budget" name={budgetLabel} fill="#6366f1" radius={[3, 3, 0, 0]} />
          <Bar dataKey="actual" name={actualLabel} radius={[3, 3, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.actual > d.budget ? "#ef4444" : "#10b981"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
