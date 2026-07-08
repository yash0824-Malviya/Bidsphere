import { lazy, Suspense } from "react";
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
import { DASHBOARD_QUERY_OPTIONS } from "../../api/queryPresets";
import AnalyticsKpiCard from "./analytics/AnalyticsKpiCard";
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
    description: "Estimated RFQ cost vs final order",
  },
  budgetUtilisation: {
    icon: PieChart,
    title: "Budget Utilisation",
    description: "Actual spend of allocated budget",
  },
  rfqTurnaround: {
    icon: Clock,
    title: "RFQ Turnaround",
    description: "Avg. time from open to close",
  },
  supplierResponse: {
    icon: Users,
    title: "Supplier Response Rate",
    description: "Quotations received vs invited",
  },
  cycleTime: {
    icon: RefreshCw,
    title: "Procurement Cycle Time",
    description: "Material request to purchase order",
  },
  onTimeDelivery: {
    icon: Truck,
    title: "On-Time Delivery",
    description: "Receipts delivered by required date",
  },
};

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
  /** Defer the (heavy) analytics fetch until the host is ready. Defaults true. */
  enabled?: boolean;
}

export default function ProcurementAnalyticsSection({
  kpis = ALL_KEYS,
  showCharts = true,
  charts,
  title = "Procurement Analytics",
  subtitle = "Procurement Performance Dashboard",
  enabled = true,
}: Props) {
  const query = useQuery<ProcurementAnalytics>({
    queryKey: ["procurement-analytics"],
    queryFn: fetchProcurementAnalytics,
    enabled,
    ...DASHBOARD_QUERY_OPTIONS,
  });

  // `isPending` (not `isLoading`) stays true while the query is deferred/idle,
  // so the cards keep their skeletons instead of flashing "No data".
  const loading = query.isPending;
  const data = query.data;

  const cols =
    kpis.length >= 6
      ? "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6"
      : kpis.length >= 3
        ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
        : "grid-cols-1 sm:grid-cols-2";

  return (
    <section className="flex flex-col gap-4">
      {title ? (
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-sm font-semibold text-neutral-800">{title}</h2>
            {subtitle ? (
              <p className="text-xs text-neutral-400">{subtitle}</p>
            ) : null}
          </div>
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
