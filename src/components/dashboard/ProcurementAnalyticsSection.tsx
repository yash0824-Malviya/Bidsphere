import { lazy, Suspense, type ReactNode } from "react";
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
  fetchProcurementAnalytics,
  type AnalyticsKpi,
  type ProcurementAnalytics,
} from "../../api/procurementAnalytics";
import { timedDashApi } from "../../api/dashboardPerf";
import { DASHBOARD_QUERY_OPTIONS } from "../../api/queryPresets";
import AnalyticsKpiCard from "./analytics/AnalyticsKpiCard";
import DashboardWidgetError from "./DashboardWidgetError";
import { Skeleton } from "../Skeleton";
import type { AnalyticsChartKey } from "./analytics/ProcurementAnalyticsCharts";

// Recharts is heavy — split it into its own chunk so the KPI cards paint
// without waiting on the charting library to download/parse.
const ProcurementAnalyticsCharts = lazy(
  () => import("./analytics/ProcurementAnalyticsCharts"),
);

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

const KPI_META: Record<AnalyticsKpiKey, KpiMeta> = {
  costSavings: {
    icon: TrendingDown,
    title: "Cost Savings",
    description: "Highest quote − lowest quote",
  },
  budgetUtilisation: {
    icon: PieChart,
    title: "Budget Utilisation",
    description: "Allocated · Spent · Remaining · Forecast",
  },
  rfqTurnaround: {
    icon: Clock,
    title: "RFQ Turnaround",
    description: "Average RFQ closed − created (completed only)",
  },
  supplierResponse: {
    icon: Users,
    title: "Supplier Response Rate",
    description: "Responded / Invited",
  },
  cycleTime: {
    icon: RefreshCw,
    title: "Procurement Cycle Time",
    description: "PO submitted − Material Request submitted",
  },
  onTimeDelivery: {
    icon: Truck,
    title: "On-Time Delivery",
    description: "Receipts delivered by required date",
  },
};

/** Primary dashboard analytics row (clean enterprise layout). */
export const PRIMARY_DASHBOARD_ANALYTICS: AnalyticsKpiKey[] = [
  "costSavings",
  "budgetUtilisation",
  "supplierResponse",
  "onTimeDelivery",
];

/** Charts shown on the main Procurement Dashboard. */
export const PRIMARY_DASHBOARD_CHARTS: AnalyticsChartKey[] = [
  "monthlySpend",
  "budgetVsActual",
  "supplierResponse",
  "rfqTurnaround",
];

const ALL_KEYS: AnalyticsKpiKey[] = [
  "costSavings",
  "budgetUtilisation",
  "rfqTurnaround",
  "supplierResponse",
  "cycleTime",
  "onTimeDelivery",
];

interface Props {
  /** Which KPI cards to render. Defaults to all six. */
  kpis?: AnalyticsKpiKey[];
  /** Render the trend charts below the cards. Defaults to true. */
  showCharts?: boolean;
  /** Restrict which charts render (in order). Defaults to all five. */
  charts?: AnalyticsChartKey[];
  /** Optional section heading; hidden when omitted. */
  title?: string;
  subtitle?: string;
  /** Right-side header action (e.g. View More Analytics). */
  headerAction?: ReactNode;
  /** Defer the (heavy) analytics fetch until the host is ready. Defaults true. */
  enabled?: boolean;
}

export default function ProcurementAnalyticsSection({
  kpis = ALL_KEYS,
  showCharts = true,
  charts,
  title = "Procurement Analytics",
  subtitle = "Procurement Performance Dashboard",
  headerAction,
  enabled = true,
}: Props) {
  const query = useQuery<ProcurementAnalytics>({
    queryKey: ["procurement-analytics"],
    queryFn: () =>
      timedDashApi("Supplier Analytics (full)", () =>
        fetchProcurementAnalytics(),
      ),
    enabled,
    ...DASHBOARD_QUERY_OPTIONS,
  });

  // Pending only while actively fetching — never after error (avoids eternal skeletons).
  const loading = query.isPending && !query.isError;
  const data = query.data;

  const cols =
    kpis.length >= 6
      ? "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6"
      : kpis.length === 4
        ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4"
        : kpis.length >= 3
          ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
          : "grid-cols-1 sm:grid-cols-2";

  if (query.isError) {
    return (
      <section className="flex flex-col gap-4">
        {title ? (
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-neutral-900">{title}</h2>
              {subtitle ? (
                <p className="text-xs text-neutral-500">{subtitle}</p>
              ) : null}
            </div>
            {headerAction}
          </div>
        ) : null}
        <DashboardWidgetError
          title="Unable to load dashboard data"
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      {title ? (
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-neutral-900">{title}</h2>
            {subtitle ? (
              <p className="text-xs text-neutral-500">{subtitle}</p>
            ) : null}
          </div>
          {headerAction}
        </div>
      ) : null}

      <div className={`grid gap-3 ${cols}`}>
        {kpis.map((key) => {
          const meta = KPI_META[key];
          const kpi: AnalyticsKpi | null = data ? data[key] : null;
          return (
            <AnalyticsKpiCard
              key={key}
              icon={meta.icon}
              title={meta.title}
              description={meta.description}
              kpi={kpi}
              loading={loading}
            />
          );
        })}
      </div>

      {showCharts ? (
        <Suspense
          fallback={
            <div className="dashboard-grid-2">
              <Skeleton className="h-[280px] rounded-xl" />
              <Skeleton className="h-[280px] rounded-xl" />
            </div>
          }
        >
          <ProcurementAnalyticsCharts data={data} loading={loading} only={charts} />
        </Suspense>
      ) : null}
    </section>
  );
}
