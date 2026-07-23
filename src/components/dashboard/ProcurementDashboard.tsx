import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  ClipboardCheck,
  DollarSign,
  FileSearch,
  FileText,
  ShoppingCart,
  Users,
} from "lucide-react";

import {
  fetchProcurementDashboardKpis,
  fetchProcurementSecondaryAnalytics,
} from "../../api/dashboard";
import { dashPerfLog, timedDashApi } from "../../api/dashboardPerf";
import { logDashboardWidget } from "../../api/procurementDashboardTruth";
import { DASHBOARD_QUERY_OPTIONS } from "../../api/queryPresets";
import {
  getFinancePendingReviews,
  getLegalDocsByStatus,
} from "../../api/legalDocs";
import {
  buildActivityFeed,
  buildTopSuppliersWithTrend,
  computeRfqPipeline,
} from "../../utils/dashboardUtils";
import { formatCurrencyCompact } from "../../utils/format";
import DashboardWidgetError from "./DashboardWidgetError";
import ProcurementAnalyticsSection, {
  PRIMARY_DASHBOARD_ANALYTICS,
  PRIMARY_DASHBOARD_CHARTS,
} from "./ProcurementAnalyticsSection";
import TopSuppliersPanel from "./TopSuppliersPanel";
import CompactActivityFeed from "./CompactActivityFeed";

interface Props {
  greetingName: string;
}

const ICON_TONE: Record<string, { bg: string; fg: string }> = {
  spend: { bg: "bg-[#E8F4FF]", fg: "text-[#1993FF]" },
  rfqs: { bg: "bg-[#E8F4FF]", fg: "text-[#1993FF]" },
  quotes: { bg: "bg-[#FEF3C7]", fg: "text-[#F59E0B]" },
  pos: { bg: "bg-[#E8F4FF]", fg: "text-[#1993FF]" },
  suppliers: { bg: "bg-[#DCFCE7]", fg: "text-[#22C55E]" },
  approvals: { bg: "bg-[#FEE2E2]", fg: "text-[#EF4444]" },
};

const CARD_SHELL =
  "rounded-2xl border border-[#E8EDF5] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)] transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(15,23,42,0.07)]";

export default function ProcurementDashboard({
  greetingName: _greetingName,
}: Props) {
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

  useEffect(() => {
    if (kpisQuery.isSuccess && kpisQuery.data) {
      dashPerfLog("KPI cards ready (interactive)", {
        fromCache: kpisQuery.isFetched && !kpisQuery.isFetching,
      });
      logDashboardWidget("Action Center · Pending Quotations", {
        value: kpisQuery.data.pendingQuotations,
        source: "procurement-dashboard-kpis (truth)",
      });
      logDashboardWidget("Action Center · Pending Purchase Orders", {
        value: kpisQuery.data.pendingPurchaseOrders,
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

  const kpis = kpisQuery.data;
  const analytics = analyticsQuery.data;
  const legalPending = approvalCountsQuery.data?.legalPending ?? 0;
  const financePending = approvalCountsQuery.data?.financePending ?? 0;
  const pendingApprovals = legalPending + financePending;

  const activityFeed = useMemo(() => {
    if (!analytics) return [];
    return buildActivityFeed(
      analytics.recentRfqs,
      analytics.recentPos,
      analytics.recentInvoices,
      analytics.recentPayments ?? [],
    ).slice(0, 10);
  }, [analytics]);

  const topSuppliers = useMemo(
    () =>
      buildTopSuppliersWithTrend(
        analytics?.invoices ?? [],
        analytics?.poSamples ?? [],
        5,
      ),
    [analytics?.invoices, analytics?.poSamples],
  );

  const rfqPipeline = useMemo(
    () =>
      computeRfqPipeline(analytics?.recentRfqs ?? [], kpis?.openRfqs ?? 0).filter(
        (s) => s.count > 0,
      ),
    [analytics?.recentRfqs, kpis?.openRfqs],
  );

  const kpiCards: Array<{
    key: string;
    label: string;
    value: string;
    context: string;
    icon: LucideIcon;
    to: string;
  }> = [
    {
      key: "spend",
      label: "Total Spend",
      value: kpis ? formatCurrencyCompact(kpis.ytdSpend) : "—",
      context: "Year to Date",
      icon: DollarSign,
      to: "/p2p/total-spend",
    },
    {
      key: "rfqs",
      label: "Open RFQs",
      value: kpis ? kpis.openRfqs.toLocaleString() : "—",
      context: "This Week",
      icon: FileSearch,
      to: "/sourcing/rfq?preset=open",
    },
    {
      key: "quotes",
      label: "Pending Quotations",
      value: kpis ? kpis.pendingQuotations.toLocaleString() : "—",
      context: "Awaiting Review",
      icon: FileText,
      to: "/sourcing/rfq?preset=open",
    },
    {
      key: "pos",
      label: "Pending Purchase Orders",
      value: kpis ? kpis.pendingPurchaseOrders.toLocaleString() : "—",
      context:
        (kpis?.pendingPurchaseOrders ?? 0) > 0 ? "In Review" : "No Pending PO",
      icon: ShoppingCart,
      to: "/p2p/purchase-orders?preset=pending",
    },
    {
      key: "suppliers",
      label: "Active Suppliers",
      value: kpis ? kpis.activeSuppliers.toLocaleString() : "—",
      context: "Supplier Master",
      icon: Users,
      to: "/suppliers?status=active",
    },
    {
      key: "approvals",
      label: "Pending Approvals",
      value: approvalCountsQuery.isPending
        ? "—"
        : pendingApprovals.toLocaleString(),
      context: pendingApprovals > 0 ? "Finance Review" : "Up to Date",
      icon: ClipboardCheck,
      to: "/legal/reviews",
    },
  ];

  return (
    <div className="flex w-full flex-col gap-6">
      {kpisQuery.isError ? (
        <DashboardWidgetError
          title="Unable to load KPI snapshot"
          error={kpisQuery.error}
          onRetry={() => void kpisQuery.refetch()}
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          {kpiCards.map((c) => {
            const Icon = c.icon;
            const tone = ICON_TONE[c.key] ?? ICON_TONE.spend;
            return (
              <Link
                key={c.key}
                to={c.to}
                className={`${CARD_SHELL} group flex h-[128px] flex-col p-4 no-underline outline-none`}
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${tone.bg}`}
                  >
                    <Icon className={`h-4 w-4 ${tone.fg}`} />
                  </span>
                  <p className="text-[13px] font-semibold leading-snug text-[#111827]">
                    {c.label}
                  </p>
                </div>
                <div className="mt-auto">
                  <p className="text-[28px] font-bold leading-none tracking-tight tabular-nums text-[#0F172A]">
                    {kpisQuery.isLoading && !kpis ? "—" : c.value}
                  </p>
                  <p className="mt-1.5 text-[12px] font-medium text-[#64748B]">
                    {c.context}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <ProcurementAnalyticsSection
        title="Performance"
        subtitle="Live procurement metrics"
        kpis={PRIMARY_DASHBOARD_ANALYTICS}
        charts={PRIMARY_DASHBOARD_CHARTS}
        showCharts
        cardVariant="enterprise"
        rfqPipeline={rfqPipeline}
        pipelineLoading={analyticsQuery.isPending && !analytics}
      />

      <section className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-2">
        <TopSuppliersPanel
          rows={topSuppliers}
          loading={analyticsQuery.isPending && !analytics}
        />
        <CompactActivityFeed
          items={activityFeed}
          loading={analyticsQuery.isPending && !analytics}
          title="Recent Procurement Activity"
        />
      </section>
    </div>
  );
}
