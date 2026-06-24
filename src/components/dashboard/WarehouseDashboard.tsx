import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";

import {
  buildFastSlowItems,
  buildLowStockAlerts,
  buildRecentStockMovements,
  computeInventoryMovementTrend,
  computeStockCategoryDistribution,
  computeWarehouseKpis,
  computeWarehouseReceivingKpis,
  fetchWarehouseDashboardData,
} from "../../api/warehouseDashboard";
import { getDashboardConfig } from "../../config/dashboardRoles";
import { Skeleton } from "../Skeleton";
import DashboardHeader from "./DashboardHeader";
import WarehouseInventoryCharts from "./WarehouseInventoryCharts";
import WarehouseKpiRow from "./WarehouseKpiRow";
import WarehouseQuickActions from "./WarehouseQuickActions";
import WarehouseReceivingKpis from "./WarehouseReceivingKpis";
import {
  LowStockAlertsPanel,
  RecentGrnsPanel,
  StockRankPanel,
} from "./WarehousePanels";
import { formatDate } from "../../utils/format";

interface Props {
  greetingName: string;
}

export default function WarehouseDashboard({ greetingName }: Props) {
  const dashboardConfig = getDashboardConfig("warehouse");

  const query = useQuery({
    queryKey: ["warehouse-dashboard"],
    queryFn: fetchWarehouseDashboardData,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const data = query.data;
  const loading = query.isLoading;

  const kpis = useMemo(
    () => (data ? computeWarehouseKpis(data) : null),
    [data]
  );

  const receivingKpis = useMemo(
    () => (data ? computeWarehouseReceivingKpis(data) : null),
    [data]
  );

  const movement = useMemo(
    () => computeInventoryMovementTrend(data?.recentGrns ?? []),
    [data?.recentGrns]
  );

  const categories = useMemo(
    () =>
      computeStockCategoryDistribution(data?.items ?? [], data?.bins ?? []),
    [data?.items, data?.bins]
  );

  const lowStock = useMemo(
    () =>
      buildLowStockAlerts(
        data?.items ?? [],
        data?.bins ?? [],
        data?.reorderLevels ?? []
      ),
    [data?.items, data?.bins, data?.reorderLevels]
  );

  const { fast, slow } = useMemo(
    () => buildFastSlowItems(data?.items ?? [], data?.bins ?? []),
    [data?.items, data?.bins]
  );

  const movements = useMemo(
    () => buildRecentStockMovements(data?.recentGrns ?? []),
    [data?.recentGrns]
  );

  return (
    <div className="dashboard-stack">
      <DashboardHeader config={dashboardConfig} greetingName={greetingName} />

      <WarehouseQuickActions />

      <WarehouseReceivingKpis
        pendingReceipts={receivingKpis?.pendingReceipts ?? 0}
        incomingThisWeek={receivingKpis?.incomingThisWeek ?? 0}
        overdueDeliveries={receivingKpis?.overdueDeliveries ?? 0}
        lowStockAlerts={receivingKpis?.lowStockAlerts ?? 0}
        loading={loading}
      />

      <WarehouseKpiRow kpis={kpis} loading={loading} />

      <WarehouseInventoryCharts
        movement={movement}
        categories={categories}
        loading={loading}
      />

      <div className="dashboard-panel">
        <div className="dashboard-panel-header">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Recent Stock Movements
          </h3>
        </div>
        {loading ? (
          <Skeleton className="m-4 min-h-[120px] rounded-lg" />
        ) : movements.length === 0 ? (
          <p className="dashboard-panel-body py-8 text-center text-sm text-neutral-500">
            Stock movements will appear as GRNs are posted.
          </p>
        ) : (
          <ul className="dashboard-panel-body divide-y divide-neutral-100">
            {movements.slice(0, 6).map((m) => (
              <li key={m.id}>
                <Link
                  to={`/p2p/grn/${encodeURIComponent(m.label)}`}
                  className="flex items-center gap-3 py-3 hover:bg-neutral-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-900">
                      GRN {m.label}
                    </p>
                    <p className="truncate text-xs text-neutral-500">
                      {m.subtitle}
                    </p>
                  </div>
                  <span className="text-xs text-neutral-400">
                    {m.date ? formatDate(m.date) : "—"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="dashboard-grid-2">
        <RecentGrnsPanel rows={data?.recentGrns ?? []} loading={loading} />
        <LowStockAlertsPanel rows={lowStock} loading={loading} />
      </div>

      <div className="dashboard-grid-2">
        <StockRankPanel title="Fast Moving Items" rows={fast} tone="fast" loading={loading} />
        <StockRankPanel title="Slow Moving Items" rows={slow} tone="slow" loading={loading} />
      </div>
    </div>
  );
}
