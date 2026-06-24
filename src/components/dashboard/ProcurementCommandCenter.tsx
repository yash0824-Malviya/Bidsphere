import { lazy, Suspense, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  fetchDashboardAnalytics,
  fetchDashboardCounts,
} from "../../api/dashboard";
import ActionCenter from "./ActionCenter";
import AlertsRisksPanel from "./AlertsRisksPanel";
import CompactActivityFeed from "./CompactActivityFeed";
import CompactKpiRow from "./CompactKpiRow";
import ExecutiveInsightsPanel from "./ExecutiveInsightsPanel";
import ProcurementHealthScore from "./ProcurementHealthScore";
import RecentPOTable from "./RecentPOTable";
import RfqPipelinePanel from "./RfqPipelinePanel";
import SavingsOpportunitiesPanel from "./SavingsOpportunitiesPanel";
import TopSuppliersPanel from "./TopSuppliersPanel";
import { Skeleton } from "../Skeleton";
import {
  buildActivityFeed,
  buildAlertsAndRisks,
  buildExecutiveInsights,
  buildSupplierInsights,
  buildTopSuppliersWithTrend,
  computeExecutiveKpis,
  computeMonthlySpendTrend,
  computeProcurementHealthScore,
  computeRfqPipeline,
  computeSavingsOpportunities,
  computeShipmentMetrics,
  computeSupplierConcentration,
  ensureTopSuppliersBySpend,
  resolveCategorySpend,
} from "../../utils/dashboardUtils";

const ProcurementSpendAnalytics = lazy(
  () => import("./ProcurementSpendAnalytics")
);

interface Props {
  greetingName: string;
}

export default function ProcurementCommandCenter({ greetingName }: Props) {
  const countsQuery = useQuery({
    queryKey: ["dashboard-counts"],
    queryFn: fetchDashboardCounts,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const analyticsQuery = useQuery({
    queryKey: ["dashboard-analytics"],
    queryFn: fetchDashboardAnalytics,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const counts = countsQuery.data ?? null;
  const analytics = analyticsQuery.data;
  const countsLoading = countsQuery.isLoading;
  const analyticsLoading = analyticsQuery.isLoading;

  const kpis = useMemo(() => {
    if (!analytics || !counts) return null;
    return computeExecutiveKpis({ ...analytics, counts });
  }, [analytics, counts]);

  const monthlySpend = useMemo(
    () => computeMonthlySpendTrend(analytics?.invoices ?? []),
    [analytics?.invoices]
  );

  const categorySpend = useMemo(
    () =>
      resolveCategorySpend(
        analytics?.invoiceItems ?? [],
        analytics?.invoices ?? [],
        analytics?.poSamples ?? []
      ),
    [analytics?.invoiceItems, analytics?.invoices, analytics?.poSamples]
  );

  const topSuppliers = useMemo(
    () =>
      ensureTopSuppliersBySpend(
        analytics?.invoices ?? [],
        analytics?.poSamples ?? [],
        5
      ),
    [analytics?.invoices, analytics?.poSamples]
  );

  const concentration = useMemo(
    () => computeSupplierConcentration(topSuppliers),
    [topSuppliers]
  );

  const topSuppliersTrend = useMemo(
    () =>
      buildTopSuppliersWithTrend(
        analytics?.invoices ?? [],
        analytics?.poSamples ?? [],
        5
      ),
    [analytics?.invoices, analytics?.poSamples]
  );

  const supplierInsights = useMemo(
    () => buildSupplierInsights(topSuppliers),
    [topSuppliers]
  );

  const shipmentMetrics = useMemo(
    () =>
      computeShipmentMetrics(
        analytics?.poSamples ?? [],
        analytics?.upcomingDeliveries ?? []
      ),
    [analytics?.poSamples, analytics?.upcomingDeliveries]
  );

  const healthScore = useMemo(
    () =>
      kpis && counts
        ? computeProcurementHealthScore(kpis, counts, shipmentMetrics)
        : null,
    [kpis, counts, shipmentMetrics]
  );

  const activityFeed = useMemo(
    () =>
      analytics
        ? buildActivityFeed(
            analytics.recentRfqs,
            analytics.recentPos,
            analytics.recentInvoices,
            analytics.recentPayments ?? []
          )
        : [],
    [analytics]
  );

  const rfqPipeline = useMemo(
    () =>
      computeRfqPipeline(
        analytics?.recentRfqs ?? [],
        counts?.openRfqs ?? 0
      ),
    [analytics?.recentRfqs, counts?.openRfqs]
  );

  const savings = useMemo(
    () => computeSavingsOpportunities(kpis?.ytdSpend ?? 0),
    [kpis?.ytdSpend]
  );

  const insights = useMemo(
    () =>
      kpis && counts
        ? buildExecutiveInsights(
            kpis,
            counts,
            concentration,
            savings,
            shipmentMetrics
          )
        : [],
    [kpis, counts, concentration, savings, shipmentMetrics]
  );

  const alerts = useMemo(
    () =>
      counts
        ? buildAlertsAndRisks(
            counts,
            shipmentMetrics,
            supplierInsights,
            concentration
          )
        : [],
    [counts, shipmentMetrics, supplierInsights, concentration]
  );

  const recentPos = useMemo(() => {
    const pool = analytics?.recentPos?.length
      ? analytics.recentPos
      : analytics?.poSamples ?? [];
    return [...pool].sort((a, b) =>
      (b.transaction_date ?? b.modified ?? "").localeCompare(
        a.transaction_date ?? a.modified ?? ""
      )
    );
  }, [analytics?.recentPos, analytics?.poSamples]);

  return (
    <div className="procurement-command-center space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
            Procurement Command Center
          </h1>
          <p className="text-[11px] text-neutral-500">
            Welcome back, {greetingName} · executive procurement intelligence
          </p>
        </div>
        <span className="rounded-full border border-primary-100 bg-primary-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-primary-700">
          Live
        </span>
      </div>

      <ExecutiveInsightsPanel
        insights={insights}
        loading={countsLoading || analyticsLoading}
      />

      <ActionCenter />

      <CompactKpiRow kpis={kpis} counts={counts} loading={countsLoading} />

      <div className="grid gap-2 xl:grid-cols-12">
        <div className="xl:col-span-12 2xl:col-span-3">
          <ProcurementHealthScore data={healthScore} loading={countsLoading} />
        </div>
        <div className="xl:col-span-12 2xl:col-span-6">
          <Suspense
            fallback={
              <div className="grid gap-2 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-[188px] rounded-lg" />
                ))}
              </div>
            }
          >
            <ProcurementSpendAnalytics
              monthlySpend={monthlySpend}
              categorySpend={categorySpend}
              topSuppliers={topSuppliers}
              concentration={concentration}
              loading={analyticsLoading}
            />
          </Suspense>
        </div>
        <div className="xl:col-span-12 2xl:col-span-3">
          <CompactActivityFeed
            items={activityFeed}
            loading={analyticsLoading}
          />
        </div>
      </div>

      <div className="grid gap-2 lg:grid-cols-3">
        <TopSuppliersPanel rows={topSuppliersTrend} loading={analyticsLoading} />
        <RfqPipelinePanel stages={rfqPipeline} loading={analyticsLoading} />
        <SavingsOpportunitiesPanel items={savings} loading={analyticsLoading} />
      </div>

      <div className="grid gap-2 lg:grid-cols-10">
        <div className="lg:col-span-7">
          <RecentPOTable orders={recentPos} loading={analyticsLoading} />
        </div>
        <div className="lg:col-span-3">
          <AlertsRisksPanel items={alerts} loading={countsLoading} />
        </div>
      </div>
    </div>
  );
}
