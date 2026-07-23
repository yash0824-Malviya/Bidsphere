import { lazy, Suspense, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Clock,
  PieChart,
  RefreshCw,
  TrendingDown,
  Truck,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  fetchProcurementAnalyticsPrimary,
  fetchProcurementAnalyticsTurnaround,
  type AnalyticsKpi,
  type ProcurementAnalytics,
} from "../../api/procurementAnalytics";
import { dashTime, dashTimeEnd, timedDashApi } from "../../api/dashboardPerf";
import { DASHBOARD_QUERY_OPTIONS } from "../../api/queryPresets";
import type { RfqPipelineStage } from "../../utils/dashboardUtils";
import AnalyticsKpiCard from "./analytics/AnalyticsKpiCard";
import DashboardWidgetError from "./DashboardWidgetError";
import { Skeleton } from "../Skeleton";
import type { AnalyticsChartKey } from "./analytics/ProcurementAnalyticsCharts";

const ProcurementAnalyticsCharts = lazy(() => {
  dashTime("Chart rendering (chunk load)");
  return import("./analytics/ProcurementAnalyticsCharts").then((m) => {
    dashTimeEnd("Chart rendering (chunk load)");
    return m;
  });
});

export type AnalyticsKpiKey =
  | "costSavings"
  | "budgetUtilisation"
  | "rfqTurnaround"
  | "supplierResponse"
  | "cycleTime"
  | "onTimeDelivery";

interface KpiMeta {
  icon: LucideIcon;
  title: string;
  description: string;
}

type Accent = "blue" | "green" | "orange" | "red" | "gray";

const KPI_META: Record<AnalyticsKpiKey, KpiMeta & { accent: Accent }> = {
  costSavings: {
    icon: TrendingDown,
    title: "Cost Savings",
    description: "Highest quote − lowest quote",
    accent: "green",
  },
  budgetUtilisation: {
    icon: PieChart,
    title: "Budget Utilisation",
    description: "Allocated · Spent · Remaining",
    accent: "blue",
  },
  rfqTurnaround: {
    icon: Clock,
    title: "RFQ Turnaround",
    description: "Average RFQ closed − created",
    accent: "green",
  },
  supplierResponse: {
    icon: Users,
    title: "Supplier Response",
    description: "Responded / Invited",
    accent: "blue",
  },
  cycleTime: {
    icon: RefreshCw,
    title: "Procurement Cycle",
    description: "PO submitted − Material Request",
    accent: "orange",
  },
  onTimeDelivery: {
    icon: Truck,
    title: "On-Time Delivery",
    description: "Receipts by required date",
    accent: "green",
  },
};

/** Six analytics cards on the Procurement Dashboard (above charts). */
export const PRIMARY_DASHBOARD_ANALYTICS: AnalyticsKpiKey[] = [
  "costSavings",
  "budgetUtilisation",
  "rfqTurnaround",
  "supplierResponse",
  "cycleTime",
  "onTimeDelivery",
];

/** Charts on the main Procurement Dashboard (2-column grid). */
export const PRIMARY_DASHBOARD_CHARTS: AnalyticsChartKey[] = [
  "monthlySpend",
  "rfqPipeline",
  "budgetVsActual",
  "supplierResponse",
  "rfqTurnaround",
  "costSavings",
];

const ALL_KEYS: AnalyticsKpiKey[] = [
  "costSavings",
  "budgetUtilisation",
  "rfqTurnaround",
  "supplierResponse",
  "cycleTime",
  "onTimeDelivery",
];

const HEAVY_KPI_KEYS = new Set<AnalyticsKpiKey>(["rfqTurnaround", "cycleTime"]);

interface Props {
  kpis?: AnalyticsKpiKey[];
  showCharts?: boolean;
  charts?: AnalyticsChartKey[];
  title?: string;
  subtitle?: string;
  headerAction?: ReactNode;
  enabled?: boolean;
  /** Compact KPI cards for enterprise dashboard density. */
  compact?: boolean;
  /** Procurement dashboard analytics card layout. */
  cardVariant?: "default" | "enterprise";
  /** Optional RFQ pipeline stages for the RFQ Pipeline chart. */
  rfqPipeline?: RfqPipelineStage[];
  pipelineLoading?: boolean;
}

export default function ProcurementAnalyticsSection({
  kpis = ALL_KEYS,
  showCharts = true,
  charts,
  title,
  subtitle,
  headerAction,
  enabled = true,
  compact = false,
  cardVariant = "default",
  rfqPipeline,
  pipelineLoading,
}: Props) {
  const chartKeys = charts ?? PRIMARY_DASHBOARD_CHARTS;
  const needsTurnaround =
    kpis.some((k) => HEAVY_KPI_KEYS.has(k)) ||
    (showCharts && chartKeys.includes("rfqTurnaround"));

  const primaryQuery = useQuery<ProcurementAnalytics>({
    queryKey: ["procurement-analytics", "primary"],
    queryFn: () =>
      timedDashApi("Analytics API (primary KPIs)", () =>
        fetchProcurementAnalyticsPrimary(),
      ),
    enabled,
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const turnaroundQuery = useQuery({
    queryKey: ["procurement-analytics", "turnaround"],
    queryFn: () =>
      timedDashApi("Analytics API (turnaround joins)", () =>
        fetchProcurementAnalyticsTurnaround(),
      ),
    enabled: enabled && needsTurnaround && primaryQuery.isSuccess,
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const data = useMemo((): ProcurementAnalytics | undefined => {
    const primary = primaryQuery.data;
    if (!primary) return undefined;
    const t = turnaroundQuery.data;
    if (!t) return primary;
    return {
      ...primary,
      rfqTurnaround: t.rfqTurnaround,
      cycleTime: t.cycleTime,
      charts: {
        ...primary.charts,
        rfqTurnaround: t.rfqTurnaroundChart,
      },
    };
  }, [primaryQuery.data, turnaroundQuery.data]);

  const primaryLoading = primaryQuery.isPending && !primaryQuery.isError;
  const turnaroundLoading =
    needsTurnaround &&
    turnaroundQuery.isPending &&
    !turnaroundQuery.isError &&
    primaryQuery.isSuccess;

  const cols =
    kpis.length >= 6
      ? "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6"
      : kpis.length === 4
        ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4"
        : kpis.length >= 3
          ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
          : "grid-cols-1 sm:grid-cols-2";

  if (primaryQuery.isError) {
    return (
      <section className="flex flex-col gap-4">
        {title ? (
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-[18px] font-semibold leading-tight text-[#111827]">
                {title}
              </h2>
              {subtitle ? (
                <p className="mt-0.5 text-[13px] font-normal text-[#64748B]">
                  {subtitle}
                </p>
              ) : null}
            </div>
            {headerAction}
          </div>
        ) : null}
        <DashboardWidgetError
          title="Unable to load dashboard data"
          error={primaryQuery.error}
          onRetry={() => void primaryQuery.refetch()}
        />
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      {title ? (
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-[18px] font-semibold leading-tight text-[#111827]">
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-0.5 text-[13px] font-normal text-[#64748B]">
                {subtitle}
              </p>
            ) : null}
          </div>
          {headerAction}
        </div>
      ) : null}

      <div className={`grid gap-4 ${cols}`}>
        {kpis.map((key) => {
          const meta = KPI_META[key];
          const heavy = HEAVY_KPI_KEYS.has(key);
          const kpi: AnalyticsKpi | null = data ? data[key] : null;
          const loading = heavy
            ? primaryLoading || turnaroundLoading
            : primaryLoading;
          return (
            <AnalyticsKpiCard
              key={key}
              icon={meta.icon}
              title={meta.title}
              description={meta.description}
              kpi={kpi}
              loading={loading}
              compact={compact}
              variant={cardVariant}
              accent={meta.accent}
            />
          );
        })}
      </div>

      {showCharts ? (
        <div className="mt-1">
          <Suspense
            fallback={
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch">
                {chartKeys.map((k) => (
                  <Skeleton key={k} className="h-[300px] rounded-2xl" />
                ))}
              </div>
            }
          >
            <ProcurementAnalyticsCharts
              data={data}
              loading={primaryLoading}
              turnaroundLoading={turnaroundLoading}
              only={chartKeys}
              rfqPipeline={rfqPipeline}
              pipelineLoading={pipelineLoading}
            />
          </Suspense>
        </div>
      ) : null}
    </section>
  );
}
