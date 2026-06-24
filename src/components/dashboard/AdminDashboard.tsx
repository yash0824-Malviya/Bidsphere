import { lazy, Suspense, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  fetchDashboardAnalytics,
  fetchDashboardCounts,
} from "../../api/dashboard";
import type { AppRole } from "../../config/roles";
import type { RFQApprovalState } from "../../types/erpnext";
import {
  filterActivityByRole,
  getDashboardConfig,
  getExecutiveDashboardLayout,
} from "../../config/dashboardRoles";
import ActionCenter from "./ActionCenter";
import AdminKpiRow from "./AdminKpiRow";
import AlertsRisksPanel from "./AlertsRisksPanel";
import CompactActivityFeed from "./CompactActivityFeed";
import DashboardHeader from "./DashboardHeader";
import SavingsOpportunitiesPanel from "./SavingsOpportunitiesPanel";
import TopSuppliersPanel from "./TopSuppliersPanel";
import { Skeleton } from "../Skeleton";
import {
  buildActivityFeed,
  buildAlertsAndRisks,
  buildSupplierInsights,
  buildTopSuppliersWithTrend,
  computeExecutiveKpis,
  computeMonthlySpendTrend,
  computeSavingsOpportunities,
  computeShipmentMetrics,
  computeSupplierConcentration,
  ensureTopSuppliersBySpend,
  resolveCategorySpend,
} from "../../utils/dashboardUtils";

const AdminSpendCharts = lazy(() => import("./AdminSpendCharts"));

interface Props {
  role: Exclude<AppRole, "warehouse" | "legal">;
  greetingName: string;
}

export default function AdminDashboard({ role, greetingName }: Props) {
  const dashboardConfig = getDashboardConfig(role);
  const layout = getExecutiveDashboardLayout(role);

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
  const loading = countsQuery.isLoading || analyticsQuery.isLoading;

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

  const activityFeed = useMemo(() => {
    if (!analytics) return [];
    const items = buildActivityFeed(
      analytics.recentRfqs,
      analytics.recentPos,
      analytics.recentInvoices,
      analytics.recentPayments ?? []
    );
    return filterActivityByRole(items, role);
  }, [analytics, role]);

  const savings = useMemo(
    () => computeSavingsOpportunities(kpis?.ytdSpend ?? 0),
    [kpis?.ytdSpend]
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

  const panelCount =
    Number(layout.showTopSuppliers) +
    Number(layout.showSavings) +
    Number(layout.showAlerts);

  const readyForPOCount = useMemo(() => {
    let count = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith("rfq_approval_")) continue;
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        try {
          const s = JSON.parse(raw) as RFQApprovalState;
          if (s.workflow_step === "Approved for PO") count++;
        } catch { /* skip */ }
      }
    } catch { /* ignore */ }
    return count;
  }, [counts]);

  return (
    <div className="dashboard-stack">
      <DashboardHeader config={dashboardConfig} greetingName={greetingName} />

      <ActionCenter actions={layout.quickActions} />

      <AdminKpiRow
        kpis={kpis}
        counts={counts}
        kpiKeys={layout.kpiKeys}
        loading={countsQuery.isLoading}
        readyForPOCount={readyForPOCount}
      />

      {layout.showSpendCharts ? (
        <Suspense
          fallback={
            <div className="dashboard-grid-2">
              <Skeleton className="min-h-[320px] rounded-xl" />
              <Skeleton className="min-h-[320px] rounded-xl" />
            </div>
          }
        >
          <AdminSpendCharts
            monthlySpend={monthlySpend}
            categorySpend={categorySpend}
            loading={loading}
          />
        </Suspense>
      ) : null}

      {layout.showActivity ? (
        <CompactActivityFeed
          items={activityFeed}
          loading={analyticsQuery.isLoading}
          title={layout.activityTitle}
        />
      ) : null}

      {panelCount > 0 ? (
        <div
          className={
            panelCount >= 3
              ? "dashboard-grid-3"
              : panelCount === 2
                ? "dashboard-grid-2"
                : "grid w-full grid-cols-1 gap-6"
          }
        >
          {layout.showTopSuppliers ? (
            <TopSuppliersPanel
              rows={topSuppliersTrend}
              loading={analyticsQuery.isLoading}
            />
          ) : null}
          {layout.showSavings ? (
            <SavingsOpportunitiesPanel items={savings} loading={loading} />
          ) : null}
          {layout.showAlerts ? (
            <AlertsRisksPanel items={alerts} loading={countsQuery.isLoading} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
