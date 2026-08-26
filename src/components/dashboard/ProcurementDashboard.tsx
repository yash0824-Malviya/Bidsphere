import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  DollarSign,
  FileSearch,
  FileText,
  Package,
  ShoppingCart,
  Timer,
  TrendingDown,
  UserPlus,
  Users,
} from "lucide-react";

import {
  fetchOperationalHealthErpCounts,
  fetchProcurementDashboardKpis,
  fetchProcurementSecondaryAnalytics,
  type DashboardPoLite,
  type DashboardRfqLite,
} from "../../api/dashboard";
import { fetchECRList } from "../../api/ecr";
import { dashPerfLog, timedDashApi } from "../../api/dashboardPerf";
import {
  fetchProcurementActionCenterCounts,
  logDashboardWidget,
} from "../../api/procurementDashboardTruth";
import { fetchProcurementAnalytics } from "../../api/procurementAnalytics";
import { getExactCount } from "../../api/erpnext";
import { DASHBOARD_QUERY_OPTIONS } from "../../api/queryPresets";
import {
  getFinancePendingReviews,
  getLegalDocsByStatus,
} from "../../api/legalDocs";
import { getRFQNamesWithPO } from "../../api/purchasing";
import { getSupplierPerformance } from "../../api/supplierPerformance";
import { getWorkflowStages } from "../../api/admin";
import {
  getQuoteCountsForRFQs,
  getSupplierCountsForRFQs,
} from "../../api/sourcing";
import { PROCUREMENT_DASHBOARD_LINKS } from "../../config/procurementDashboardLinks";
import { formatRfqOwnerLabel } from "../../config/roles";
import {
  buildOperationalHealthCards,
  buildProcurementInsights,
  buildSupplierPerformanceBars,
  computeAverageSupplierScore,
  computeEnterpriseRfqPipeline,
  computeMonthlyPoSpend,
  computePoYtdSpend,
  topSuppliersByPoSpend,
  type OperationalHealthLevel,
  type SupplierOverviewMetrics,
} from "../../utils/procurementExecutiveMetrics";
import { formatCurrencyCompact, formatDate } from "../../utils/format";
import { deriveProcurementDashboardEcrMetrics } from "../../utils/procurementDashboardEcrMetrics";
import DashboardWidgetError from "./DashboardWidgetError";
import DashboardKpiCard, {
  DashboardKpiGrid,
  DashboardKpiSkeleton,
  type DashboardKpiTrend,
} from "./DashboardKpiCard";
import ProcurementExecutiveCharts from "./ProcurementExecutiveCharts";
import ExecutiveInsightsPanel from "./ExecutiveInsightsPanel";
import StatusBadge from "../StatusBadge";
import { Skeleton } from "../Skeleton";

interface Props {
  greetingName: string;
}

const ICON_TONE: Record<string, string> = {
  spend: "bg-[#EEF3FA] text-[#1F3A6D]",
  rfqs: "bg-[#EEF3FA] text-[#1F3A6D]",
  quotes: "bg-[#FFF7ED] text-[#C2410C]",
  approvals: "bg-[#FEF2F2] text-[#B91C1C]",
  suppliers: "bg-[#EEF3FA] text-[#1F3A6D]",
  pos: "bg-[#ECFDF5] text-[#047857]",
  cycle: "bg-[#EEF3FA] text-[#1F3A6D]",
  savings: "bg-[#ECFDF5] text-[#047857]",
};

const PANEL =
  "flex h-full min-h-[320px] flex-col overflow-hidden rounded-lg border border-[#E5E7EB] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)]";

const HEALTH_ICON: Record<string, LucideIcon> = {
  "overdue-rfqs": Clock,
  "expiring-contracts": FileText,
  "high-risk": AlertTriangle,
  onboarding: UserPlus,
  "late-deliveries": Package,
  blocked: Ban,
};

const HEALTH_TONE: Record<
  OperationalHealthLevel,
  { icon: string; value: string; caption: string; border: string }
> = {
  ok: {
    icon: "bg-emerald-50 text-emerald-700",
    value: "text-[#1E293B]",
    caption: "text-emerald-700",
    border: "border-l-emerald-500",
  },
  warning: {
    icon: "bg-amber-50 text-amber-700",
    value: "text-amber-800",
    caption: "text-amber-700",
    border: "border-l-amber-500",
  },
  critical: {
    icon: "bg-rose-50 text-rose-700",
    value: "text-rose-800",
    caption: "text-rose-700",
    border: "border-l-rose-500",
  },
  unavailable: {
    icon: "bg-slate-100 text-slate-500",
    value: "text-slate-400",
    caption: "text-slate-500",
    border: "border-l-slate-300",
  },
};

function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

export default function ProcurementDashboard({ greetingName }: Props) {
  useEffect(() => {
    dashPerfLog("Dashboard mounted");
  }, []);

  const kpisQuery = useQuery({
    queryKey: ["procurement-dashboard-kpis"],
    queryFn: () =>
      timedDashApi("Dashboard API (KPI snapshot)", () =>
        fetchProcurementDashboardKpis(),
      ),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const ecrSummaryQuery = useQuery({
    queryKey: ["ecr-dashboard", "procurement", "all"],
    queryFn: () => fetchECRList({ limit: 300 }),
    staleTime: 30_000,
  });

  const ecrMetrics = useMemo(
    () =>
      ecrSummaryQuery.data
        ? deriveProcurementDashboardEcrMetrics(ecrSummaryQuery.data)
        : null,
    [ecrSummaryQuery.data],
  );

  useEffect(() => {
    if (kpisQuery.isSuccess && kpisQuery.data) {
      dashPerfLog("KPI cards ready (interactive)", {
        fromCache: kpisQuery.isFetched && !kpisQuery.isFetching,
      });
      logDashboardWidget("Action Center · Pending Quotations", {
        value: kpisQuery.data.pendingQuotations,
        source: "procurement-dashboard-kpis (truth)",
      });
    }
  }, [
    kpisQuery.isSuccess,
    kpisQuery.data,
    kpisQuery.isFetched,
    kpisQuery.isFetching,
  ]);

  const analyticsQuery = useQuery({
    queryKey: ["procurement-dashboard-charts"],
    queryFn: () =>
      timedDashApi("Dashboard API (secondary charts)", () =>
        fetchProcurementSecondaryAnalytics(),
      ),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const procAnalyticsQuery = useQuery({
    queryKey: ["procurement-dashboard-analytics-kpis"],
    queryFn: () =>
      timedDashApi("Dashboard API (analytics KPIs)", () =>
        fetchProcurementAnalytics(),
      ),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const approvalCountsQuery = useQuery({
    queryKey: ["procurement-dashboard-approval-counts"],
    queryFn: async () => {
      const [legal, finance] = await Promise.all([
        getLegalDocsByStatus({ status: "Pending", limit: 200 }),
        getFinancePendingReviews(200),
      ]);
      return {
        legalPending: legal.length,
        financePending: finance.length,
      };
    },
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const actionCenterQuery = useQuery({
    queryKey: ["procurement-dashboard-action-center"],
    queryFn: () => fetchProcurementActionCenterCounts(),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const totalSuppliersQuery = useQuery({
    queryKey: ["procurement-dashboard-total-suppliers"],
    queryFn: () => getExactCount("Supplier"),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const newSuppliersMonthQuery = useQuery({
    queryKey: ["procurement-dashboard-new-suppliers-month"],
    queryFn: () => {
      const start = new Date();
      start.setDate(1);
      const from = start.toISOString().slice(0, 10);
      return getExactCount("Supplier", [["creation", ">=", `${from} 00:00:00`]]);
    },
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const submittedPosQuery = useQuery({
    queryKey: ["procurement-dashboard-submitted-pos"],
    queryFn: () => getExactCount("Purchase Order", [["docstatus", "=", 1]]),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const healthErpQuery = useQuery({
    queryKey: ["procurement-dashboard-operational-health"],
    queryFn: () =>
      timedDashApi("Dashboard API (operational health)", () =>
        fetchOperationalHealthErpCounts(),
      ),
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const kpis = kpisQuery.data;
  const analytics = analyticsQuery.data;
  const procAnalytics = procAnalyticsQuery.data;
  const legalPending = approvalCountsQuery.data?.legalPending ?? 0;
  const financePending = approvalCountsQuery.data?.financePending ?? 0;
  const pendingApprovals = legalPending + financePending;

  const poSamples = useMemo(
    () => analytics?.poSamples ?? [],
    [analytics?.poSamples],
  );
  const recentRfqs = useMemo(
    () => analytics?.recentRfqs ?? [],
    [analytics?.recentRfqs],
  );
  const recentPos = useMemo(
    () => analytics?.recentPos ?? [],
    [analytics?.recentPos],
  );

  const poSpend = useMemo(() => computePoYtdSpend(poSamples), [poSamples]);
  const monthlySpend = useMemo(
    () => computeMonthlyPoSpend(poSamples),
    [poSamples],
  );
  const rfqNames = useMemo(
    () => recentRfqs.map((r) => r.name).filter(Boolean),
    [recentRfqs],
  );

  const quoteCountsQuery = useQuery({
    queryKey: ["procurement-dashboard-quote-counts", rfqNames],
    enabled: rfqNames.length > 0,
    ...DASHBOARD_QUERY_OPTIONS,
    queryFn: () => getQuoteCountsForRFQs(rfqNames),
  });

  const supplierCountsQuery = useQuery({
    queryKey: ["procurement-dashboard-supplier-counts", rfqNames],
    enabled: rfqNames.length > 0,
    ...DASHBOARD_QUERY_OPTIONS,
    queryFn: () => getSupplierCountsForRFQs(rfqNames),
  });

  const poLinksQuery = useQuery({
    queryKey: ["procurement-dashboard-po-links", rfqNames],
    enabled: rfqNames.length > 0,
    ...DASHBOARD_QUERY_OPTIONS,
    queryFn: () => getRFQNamesWithPO(rfqNames),
  });

  // Candidate pool by spend; chart ranks Top 5 by Overall Supplier Score.
  const topSpendSuppliers = useMemo(
    () => topSuppliersByPoSpend(poSamples, 25),
    [poSamples],
  );

  const supplierPerfQuery = useQuery({
    queryKey: [
      "procurement-dashboard-supplier-perf",
      topSpendSuppliers.map((s) => s.supplier),
    ],
    enabled: topSpendSuppliers.length > 0,
    ...DASHBOARD_QUERY_OPTIONS,
    queryFn: () =>
      getSupplierPerformance(topSpendSuppliers.map((s) => s.supplier)),
  });

  const rankedSuppliers = useMemo(
    () =>
      buildSupplierPerformanceBars(
        topSpendSuppliers,
        supplierPerfQuery.data ?? {},
        25,
      ),
    [topSpendSuppliers, supplierPerfQuery.data],
  );

  const highRiskSuppliers = useMemo(
    () => rankedSuppliers.filter((s) => s.score > 0 && s.score < 60).length,
    [rankedSuppliers],
  );

  const supplierOverview: SupplierOverviewMetrics = useMemo(
    () => ({
      totalSuppliers: totalSuppliersQuery.data ?? 0,
      activeSuppliers: kpis?.activeSuppliers ?? 0,
      newThisMonth: newSuppliersMonthQuery.data ?? 0,
      highRiskSuppliers,
      averageScore: computeAverageSupplierScore(rankedSuppliers),
    }),
    [
      totalSuppliersQuery.data,
      kpis?.activeSuppliers,
      newSuppliersMonthQuery.data,
      highRiskSuppliers,
      rankedSuppliers,
    ],
  );

  const supplierOverviewLoading =
    (totalSuppliersQuery.isPending && totalSuppliersQuery.data == null) ||
    (kpisQuery.isPending && !kpis) ||
    (supplierPerfQuery.isPending &&
      topSpendSuppliers.length > 0 &&
      !supplierPerfQuery.data);

  const workflowStages = useMemo(() => getWorkflowStages(), []);

  const rfqPipeline = useMemo(
    () =>
      computeEnterpriseRfqPipeline({
        rfqs: recentRfqs,
        openRfqsCount: kpis?.openRfqs ?? 0,
        quoteCounts: quoteCountsQuery.data,
        supplierCounts: supplierCountsQuery.data,
        rfqsWithPo: poLinksQuery.data,
        legalPending,
        financePending,
        workflowStages,
      }),
    [
      recentRfqs,
      kpis?.openRfqs,
      quoteCountsQuery.data,
      supplierCountsQuery.data,
      poLinksQuery.data,
      legalPending,
      financePending,
      workflowStages,
    ],
  );

  const overdueRfqsCount = healthErpQuery.isError
    ? null
    : (healthErpQuery.data?.overdueRfqs ?? null);
  const lateDeliveriesCount = healthErpQuery.isError
    ? null
    : (healthErpQuery.data?.lateDeliveries ?? null);
  const blockedSuppliersCount = healthErpQuery.isError
    ? null
    : (healthErpQuery.data?.blockedSuppliers ?? null);

  const highRiskCount: number | null = supplierPerfQuery.isError
    ? null
    : highRiskSuppliers;

  const pendingOnboardingCount: number | null = actionCenterQuery.isError
    ? null
    : (actionCenterQuery.data?.suppliersWaitingApproval ?? 0);

  const healthCards = useMemo(
    () =>
      buildOperationalHealthCards({
        overdueRfqs: overdueRfqsCount,
        // Contracts DocType is not connected — never fake a zero.
        expiringContracts: null,
        highRiskSuppliers: highRiskCount,
        pendingOnboarding: pendingOnboardingCount,
        lateDeliveries: lateDeliveriesCount,
        blockedSuppliers: blockedSuppliersCount,
      }),
    [
      overdueRfqsCount,
      highRiskCount,
      pendingOnboardingCount,
      lateDeliveriesCount,
      blockedSuppliersCount,
    ],
  );

  const healthLoading =
    (healthErpQuery.isPending && !healthErpQuery.data) ||
    (actionCenterQuery.isPending && actionCenterQuery.data == null) ||
    (topSpendSuppliers.length > 0 &&
      supplierPerfQuery.isPending &&
      !supplierPerfQuery.data);

  const insights = useMemo(
    () =>
      buildProcurementInsights({
        openRfqs: kpis?.openRfqs ?? 0,
        overdueRfqs: overdueRfqsCount ?? 0,
        momSpendPct: poSpend.momPct,
        lateDeliveries: lateDeliveriesCount ?? 0,
        highRiskSuppliers: highRiskCount ?? 0,
        costSavings: procAnalytics?.costSavings,
        budgetUtilisation: procAnalytics?.budgetUtilisation,
        topRiskSupplier: rankedSuppliers.find((s) => s.score > 0 && s.score < 60)
          ?.supplier,
      }),
    [
      kpis?.openRfqs,
      overdueRfqsCount,
      poSpend.momPct,
      lateDeliveriesCount,
      highRiskCount,
      procAnalytics,
      rankedSuppliers,
    ],
  );

  const spendTrend: DashboardKpiTrend | undefined =
    poSpend.momPct != null
      ? { pct: poSpend.momPct, label: "vs last month" }
      : undefined;

  const savingsValue = procAnalytics?.costSavings?.available
    ? procAnalytics.costSavings.value
    : null;
  const savingsPct =
    savingsValue != null && poSpend.ytdSpend > 0
      ? (savingsValue / poSpend.ytdSpend) * 100
      : null;

  const cycleDays = procAnalytics?.rfqTurnaround?.value;
  const cycleDisplay = procAnalytics?.rfqTurnaround?.available
    ? procAnalytics.rfqTurnaround.display
    : "—";

  const pendingOnboarding =
    actionCenterQuery.data?.suppliersWaitingApproval ?? 0;

  const executiveKpis: Array<{
    key: string;
    label: string;
    value: string;
    context: string;
    icon: LucideIcon;
    to: string;
    trend?: DashboardKpiTrend;
  }> = [
    {
      key: "spend",
      label: "Total Spend",
      value:
        analyticsQuery.isPending && !analytics
          ? "—"
          : formatCurrencyCompact(poSpend.ytdSpend),
      context: "Year-to-Date Spend",
      icon: DollarSign,
      to: PROCUREMENT_DASHBOARD_LINKS.totalSpend,
      trend: spendTrend,
    },
    {
      key: "rfqs",
      label: "Active RFQs",
      value: kpis ? kpis.openRfqs.toLocaleString() : "—",
      context:
        (overdueRfqsCount ?? 0) > 0
          ? `${overdueRfqsCount} overdue`
          : "Currently open",
      icon: FileSearch,
      to: PROCUREMENT_DASHBOARD_LINKS.activeRfqs,
    },
    {
      key: "quotes",
      label: "Pending Quotes",
      value: kpis ? kpis.pendingQuotations.toLocaleString() : "—",
      context: "Awaiting review",
      icon: FileText,
      to: PROCUREMENT_DASHBOARD_LINKS.pendingQuotes,
    },
    {
      key: "approvals",
      label: "Pending Approvals",
      value: approvalCountsQuery.isPending
        ? "—"
        : pendingApprovals.toLocaleString(),
      context: pendingApprovals > 0 ? "Legal & Finance" : "Up to date",
      icon: ClipboardCheck,
      to: PROCUREMENT_DASHBOARD_LINKS.pendingApprovals,
    },
    {
      key: "suppliers",
      label: "Suppliers",
      value: kpis ? kpis.activeSuppliers.toLocaleString() : "—",
      context:
        pendingOnboarding > 0
          ? `${pendingOnboarding} pending onboarding`
          : "Active suppliers",
      icon: Users,
      to: PROCUREMENT_DASHBOARD_LINKS.activeSuppliers,
    },
    {
      key: "pos",
      label: "Purchase Orders",
      value: submittedPosQuery.isPending
        ? "—"
        : (submittedPosQuery.data ?? 0).toLocaleString(),
      context:
        poSpend.releasedToday > 0
          ? `${poSpend.releasedToday} released today`
          : "Submitted Purchase Orders",
      icon: ShoppingCart,
      to: PROCUREMENT_DASHBOARD_LINKS.purchaseOrders,
    },
    {
      key: "cycle",
      label: "Avg RFQ Cycle",
      value:
        cycleDays != null && Number.isFinite(cycleDays)
          ? `${Number(cycleDays).toFixed(1)} Days`
          : cycleDisplay,
      context: "Target under 7 days",
      icon: Timer,
      to: PROCUREMENT_DASHBOARD_LINKS.averageRfqCycle,
    },
    {
      key: "savings",
      label: "Cost Savings",
      value:
        savingsValue != null ? formatCurrencyCompact(savingsValue) : "—",
      context:
        savingsPct != null
          ? `${savingsPct.toFixed(1)}% vs budget`
          : "vs Budget",
      icon: TrendingDown,
      to: PROCUREMENT_DASHBOARD_LINKS.costSavings,
    },
  ];

  const ecrMetricUnavailable = ecrSummaryQuery.isError && !ecrMetrics;
  const ecrMetricCards: Array<{
    key: string;
    label: string;
    value: number | string;
    subtitle: string;
    icon: LucideIcon;
    to: string;
    iconClassName: string;
  }> = [
    {
      key: "rfq-pending-creation",
      label: "RFQs Pending Creation",
      value: ecrMetrics?.rfqsPendingCreation ?? "—",
      subtitle: ecrMetricUnavailable
        ? "ECR data unavailable"
        : "Approved ECRs ready for RFQ",
      icon: FileSearch,
      to: PROCUREMENT_DASHBOARD_LINKS.rfqsPendingCreation,
      iconClassName: "bg-[#FFF7ED] text-[#C2410C]",
    },
    {
      key: "approved-ecr-actions",
      label: "Approved ECRs Awaiting Action",
      value: ecrMetrics?.approvedEcrsAwaitingAction ?? "—",
      subtitle: ecrMetricUnavailable
        ? "ECR data unavailable"
        : "In procurement review or RFQ handoff",
      icon: ClipboardCheck,
      to: PROCUREMENT_DASHBOARD_LINKS.approvedEcrsAwaitingAction,
      iconClassName: "bg-[#EEF3FA] text-[#1F3A6D]",
    },
    {
      key: "ecr-rfqs-created",
      label: "ECR RFQs Created",
      value: ecrMetrics?.ecrRfqsCreated ?? "—",
      subtitle: ecrMetricUnavailable
        ? "ECR data unavailable"
        : "RFQs created from approved ECRs",
      icon: CheckCircle2,
      to: PROCUREMENT_DASHBOARD_LINKS.ecrRfqsCreated,
      iconClassName: "bg-[#ECFDF5] text-[#047857]",
    },
  ];

  const chartsLoading = analyticsQuery.isPending && !analytics;

  return (
    <div className="proc-dash flex w-full flex-col gap-5 bg-[#F8FAFC] pb-2 font-[Inter,ui-sans-serif,system-ui,sans-serif]">
      <header className="proc-dash-hero rounded-lg border border-[#E5E7EB] bg-white px-5 py-4 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
        <h1 className="mb-1 text-2xl font-bold leading-tight tracking-tight text-[#1E293B]">
          Procurement Manager Dashboard
        </h1>
        <p className="text-sm leading-snug text-[#64748B]">
          {timeGreeting()}, {greetingName || "Procurement Manager"} · Manage approved ECRs, RFQ creation, supplier responses and pending procurement actions.
        </p>
      </header>

      <section aria-labelledby="procurement-ecr-summary-title">
        <div className="mb-2">
          <h2
            id="procurement-ecr-summary-title"
            className="text-sm font-semibold text-[#1E293B]"
          >
            ECR Sourcing Summary
          </h2>
        </div>
        <DashboardKpiGrid columns={3}>
          {ecrMetricCards.map((card) => (
            <DashboardKpiCard
              key={card.key}
              label={card.label}
              value={card.value}
              subtitle={card.subtitle}
              icon={card.icon}
              iconClassName={card.iconClassName}
              to={card.to}
              loading={ecrSummaryQuery.isPending && !ecrSummaryQuery.data}
            />
          ))}
        </DashboardKpiGrid>
      </section>

      {kpisQuery.isError ? (
        <DashboardWidgetError
          title="Unable to load KPI snapshot"
          error={kpisQuery.error}
          onRetry={() => void kpisQuery.refetch()}
        />
      ) : kpisQuery.isLoading && !kpis ? (
        <div className="proc-primary-kpis">
          <DashboardKpiSkeleton count={8} columns={4} />
        </div>
      ) : (
        <div className="proc-primary-kpis">
          <DashboardKpiGrid columns={4}>
            {executiveKpis.map((c) => (
              <DashboardKpiCard
                key={c.key}
                label={c.label}
                value={c.value}
                subtitle={c.context}
                icon={c.icon}
                iconClassName={ICON_TONE[c.key] ?? ICON_TONE.spend}
                trend={c.trend}
                to={c.to}
              />
            ))}
          </DashboardKpiGrid>
        </div>
      )}

      <ProcurementExecutiveCharts
        monthlySpend={monthlySpend}
        rfqPipeline={rfqPipeline}
        supplierOverview={supplierOverview}
        loading={chartsLoading}
        pipelineLoading={chartsLoading}
        supplierLoading={supplierOverviewLoading}
      />

      <section>
        <div className="mb-3">
          <h2 className="text-[16px] font-semibold text-[#1E293B]">
            Operational Health
          </h2>
          <p className="mt-0.5 text-[13px] text-[#64748B]">
            Live ERP signals — available cards open the related work queue
          </p>
        </div>
        {healthLoading ? (
          <div className="proc-secondary-kpis grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[104px] w-full rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="proc-secondary-kpis grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            {healthCards.map((card) => {
              const tone = HEALTH_TONE[card.level];
              const Icon =
                card.level === "ok"
                  ? CheckCircle2
                  : (HEALTH_ICON[card.id] ?? AlertTriangle);
              const displayValue =
                card.level === "unavailable"
                  ? "—"
                  : (card.value ?? 0).toLocaleString();
              const className = `kpi-card group relative flex w-full flex-col border-l-4 text-left no-underline outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] ${tone.border}`;
              const content = (
                <>
                  <span
                    className={`kpi-card-icon flex shrink-0 items-center justify-center ${tone.icon}`}
                    aria-hidden
                  >
                    <Icon className="kpi-card-icon-svg h-[18px] w-[18px]" />
                  </span>
                  <div className="kpi-card-title-slot">
                    <p className="kpi-card-label" title={card.label}>
                      {card.label}
                    </p>
                  </div>
                  <div className="kpi-card-value-slot">
                    <p
                      className={`kpi-value ${tone.value}`}
                      title={
                        card.level === "unavailable"
                          ? "Data not available"
                          : displayValue
                      }
                    >
                      {displayValue}
                    </p>
                  </div>
                  <div className="kpi-card-caption-slot">
                    <p
                      className={`kpi-card-caption truncate font-medium ${tone.caption}`}
                      title={card.caption}
                    >
                      {card.caption}
                    </p>
                  </div>
                </>
              );

              if (!card.to) {
                return (
                  <div
                    key={card.id}
                    title={card.tooltip}
                    aria-disabled="true"
                    className={`${className} cursor-default`}
                  >
                    {content}
                  </div>
                );
              }

              return (
                <Link
                  key={card.id}
                  to={card.to}
                  title={card.tooltip}
                  className={className}
                >
                  {content}
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 items-stretch gap-5 xl:grid-cols-2">
        <RecentRfqsTable
          rows={recentRfqs}
          supplierCounts={supplierCountsQuery.data}
          loading={chartsLoading}
        />
        <RecentPosTable rows={recentPos} loading={chartsLoading} />
      </section>

      <section className="overflow-hidden rounded-lg border border-[#E5E7EB] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
        <div className="border-b border-[#E5E7EB] px-5 py-4">
          <h2 className="text-[16px] font-semibold text-[#1E293B]">
            Procurement Insights
          </h2>
          <p className="mt-0.5 text-[13px] text-[#64748B]">
            Rule-based signals from live ERP metrics
          </p>
        </div>
        <div className="px-5 py-4">
          <ExecutiveInsightsPanel
            insights={insights}
            loading={
              (kpisQuery.isPending && !kpis) ||
              (analyticsQuery.isPending && !analytics)
            }
          />
        </div>
      </section>
    </div>
  );
}

function RecentRfqsTable({
  rows,
  supplierCounts,
  loading,
}: {
  rows: DashboardRfqLite[];
  supplierCounts?: Map<string, number>;
  loading?: boolean;
}) {
  if (loading) {
    return <Skeleton className={`w-full ${PANEL}`} />;
  }

  return (
    <div className={PANEL}>
      <div className="flex items-center justify-between border-b border-[#E5E7EB] px-5 py-4">
        <h3 className="text-[16px] font-semibold text-[#1E293B]">Recent RFQs</h3>
        <Link
          to="/sourcing/rfq"
          className="text-[13px] font-semibold text-[#1F3A6D] no-underline hover:underline"
        >
          View all
        </Link>
      </div>
      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-5 py-10 text-[13px] text-[#64748B]">
          No recent RFQs
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-separate border-spacing-0 text-left">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-[#64748B]">
                <th className="px-4 py-2.5 font-semibold">RFQ Number</th>
                <th className="px-3 py-2.5 font-semibold">Buyer</th>
                <th className="px-3 py-2.5 font-semibold">Suppliers</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 8).map((rfq) => (
                <tr
                  key={rfq.name}
                  className="border-t border-[#F1F5F9] hover:bg-[#F8FAFC]"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      to={`/sourcing/rfq/${encodeURIComponent(rfq.name)}`}
                      className="text-[13px] font-semibold text-[#1F3A6D] no-underline hover:underline"
                    >
                      {rfq.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-[13px] text-[#475569]">
                    {formatRfqOwnerLabel(rfq.owner) || "—"}
                  </td>
                  <td className="px-3 py-2.5 text-[13px] tabular-nums text-[#475569]">
                    {supplierCounts?.get(rfq.name) ?? "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={rfq.status || "Draft"} />
                  </td>
                  <td className="px-4 py-2.5 text-[13px] text-[#64748B]">
                    {rfq.creation
                      ? formatDate(rfq.creation)
                      : rfq.modified
                        ? formatDate(rfq.modified)
                        : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RecentPosTable({
  rows,
  loading,
}: {
  rows: DashboardPoLite[];
  loading?: boolean;
}) {
  if (loading) {
    return <Skeleton className={`w-full ${PANEL}`} />;
  }

  return (
    <div className={PANEL}>
      <div className="flex items-center justify-between border-b border-[#E5E7EB] px-5 py-4">
        <h3 className="text-[16px] font-semibold text-[#1E293B]">
          Recent Purchase Orders
        </h3>
        <Link
          to={PROCUREMENT_DASHBOARD_LINKS.recentPurchaseOrders}
          className="text-[13px] font-semibold text-[#1F3A6D] no-underline hover:underline"
        >
          View spend report
        </Link>
      </div>
      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-5 py-10 text-[13px] text-[#64748B]">
          No recent purchase orders
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-separate border-spacing-0 text-left">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-[#64748B]">
                <th className="px-4 py-2.5 font-semibold">PO Number</th>
                <th className="px-3 py-2.5 font-semibold">Supplier</th>
                <th className="px-3 py-2.5 font-semibold">Amount</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Delivery</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 8).map((po) => (
                <tr
                  key={po.name}
                  className="border-t border-[#F1F5F9] hover:bg-[#F8FAFC]"
                >
                  <td className="px-4 py-2.5">
                    <span className="text-[13px] font-semibold text-[#1F3A6D]">
                      {po.name}
                    </span>
                  </td>
                  <td className="max-w-[140px] truncate px-3 py-2.5 text-[13px] text-[#475569]">
                    {po.supplier || "—"}
                  </td>
                  <td className="px-3 py-2.5 text-[13px] tabular-nums text-[#475569]">
                    {formatCurrencyCompact(Number(po.grand_total ?? 0))}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={po.status || "Draft"} />
                  </td>
                  <td className="px-4 py-2.5 text-[13px] text-[#64748B]">
                    {po.schedule_date ? formatDate(po.schedule_date) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
