/**
 * Enterprise Procurement Dashboard chart grid (Recharts).
 * Monthly spend · RFQ pipeline · Spend by Category · Supplier Overview.
 */

import { memo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Gauge,
  PieChart as PieChartIcon,
  ShieldCheck,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";

import type { RfqPipelineStage } from "../../utils/dashboardUtils";
import type {
  CategoryDonutPoint,
  PoSpendSeriesPoint,
  SupplierOverviewMetrics,
} from "../../utils/procurementExecutiveMetrics";
import { formatCurrencyCompact } from "../../utils/format";
import { Skeleton } from "../Skeleton";

const CARD =
  "flex h-full min-h-[360px] flex-col overflow-hidden rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.06)]";

const AXIS = {
  tick: {
    fontSize: 10,
    fill: "#98A2B3",
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
  },
  axisLine: false as const,
  tickLine: false as const,
};

const DONUT_COLORS = [
  "#1F3A6D",
  "#3B6BA5",
  "#0E7C6E",
  "#A66418",
  "#64748B",
  "#B45309",
];

const PIPELINE_COLOR = "#1F3A6D";
const SUPPLIER_DETAILS_HREF = "/reports/operations/supplier-performance";

const compact = (v: number) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(v);

function ChartShell({
  title,
  subtitle,
  headerAction,
  loading,
  heightClass,
  children,
}: {
  title: string;
  subtitle?: string;
  headerAction?: ReactNode;
  loading?: boolean;
  heightClass?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`${CARD}${heightClass ? ` ${heightClass}` : ""}`}>
      <div className="mb-3 flex shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold leading-tight text-[#1E293B]">
            {title}
          </h3>
          {subtitle ? (
            <p className="mt-0.5 text-[12px] font-medium text-[#64748B]">
              {subtitle}
            </p>
          ) : null}
        </div>
        {headerAction ? (
          <div className="flex shrink-0 items-center gap-2">{headerAction}</div>
        ) : null}
      </div>
      <div className="min-h-0 flex-1">
        {loading ? <Skeleton className="h-full min-h-[280px] w-full rounded-lg" /> : children}
      </div>
    </div>
  );
}

function MonthlySpendLine({
  data,
  loading,
}: {
  data: PoSpendSeriesPoint[];
  loading?: boolean;
}) {
  const hasData = data.some((d) => d.amount > 0);
  return (
    <ChartShell
      title="Monthly Spend Trend"
      subtitle="Purchase Orders · Last 12 months"
      loading={loading}
    >
      {hasData ? (
        <ResponsiveContainer width="100%" height="100%" minHeight={280}>
          <LineChart data={data} margin={{ top: 12, right: 14, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#EEF2F7" vertical={false} />
            <XAxis dataKey="month" {...AXIS} interval="preserveStartEnd" />
            <YAxis {...AXIS} width={48} tickFormatter={compact} />
            <Tooltip
              formatter={(value) => [`$${compact(Number(value ?? 0))}`, "Spend"]}
              contentStyle={{
                borderRadius: 8,
                border: "1px solid #E5E7EB",
                fontSize: 12,
              }}
            />
            <Line
              type="monotone"
              dataKey="amount"
              name="Spend"
              stroke="#1F3A6D"
              strokeWidth={2.25}
              dot={{ r: 3, fill: "#1F3A6D", strokeWidth: 0 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="grid h-full min-h-[280px] place-items-center text-[13px] text-[#98A2B3]">
          Waiting for completed purchase order data
        </div>
      )}
    </ChartShell>
  );
}

function RfqPipelineBars({
  stages,
  loading,
}: {
  stages: RfqPipelineStage[];
  loading?: boolean;
}) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <ChartShell
      title="RFQ Status Pipeline"
      subtitle="Enterprise sourcing stages"
      loading={loading}
    >
      <div className="flex h-full min-h-[280px] flex-col justify-center gap-2.5 overflow-y-auto py-1">
        {stages.map((row) => {
          const barPct = Math.round((row.count / max) * 100);
          return (
            <div key={row.stage} className="flex items-center gap-2">
              <span className="w-[120px] shrink-0 truncate text-[11px] font-medium text-[#475569]">
                {row.stage}
              </span>
              <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[#EEF2F7]">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{
                    width: `${barPct}%`,
                    backgroundColor: PIPELINE_COLOR,
                    minWidth: row.count > 0 ? 4 : 0,
                  }}
                />
              </div>
              <span className="w-8 shrink-0 text-right text-[11px] font-semibold tabular-nums text-[#1E293B]">
                {row.count}
              </span>
            </div>
          );
        })}
      </div>
    </ChartShell>
  );
}

function CategoryEmptyState() {
  return (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center px-6 text-center">
      <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#EEF3FA] text-[#1F3A6D]">
        <PieChartIcon className="h-7 w-7" strokeWidth={1.75} />
      </span>
      <p className="text-[14px] font-semibold text-[#1E293B]">
        No procurement spend available
      </p>
      <p className="mt-1.5 max-w-[280px] text-[13px] leading-relaxed text-[#64748B]">
        Complete a Purchase Order to view category analytics.
      </p>
    </div>
  );
}

function CategoryDonut({
  data,
  loading,
}: {
  data: CategoryDonutPoint[];
  loading?: boolean;
}) {
  const totalSpend = data.reduce((s, r) => s + r.spend, 0);

  return (
    <ChartShell
      title="Spend by Category"
      subtitle="Spend Distribution by Category"
      loading={loading}
    >
      {data.length === 0 ? (
        <CategoryEmptyState />
      ) : (
        <div className="flex h-full min-h-[280px] items-center gap-3">
          <div className="relative h-full min-h-[240px] min-w-0 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="spend"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  innerRadius="58%"
                  outerRadius="82%"
                  paddingAngle={2}
                  stroke="#fff"
                  strokeWidth={2}
                >
                  {data.map((entry, i) => (
                    <Cell
                      key={entry.category}
                      fill={DONUT_COLORS[i % DONUT_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload as CategoryDonutPoint;
                    return (
                      <div className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2.5 text-[12px] shadow-sm">
                        <p className="font-semibold text-[#1E293B]">
                          {row.category}
                        </p>
                        <p className="mt-1 tabular-nums text-[#475569]">
                          Total Spend: {formatCurrencyCompact(row.spend)}
                        </p>
                        <p className="tabular-nums text-[#64748B]">
                          {row.pct.toFixed(1)}% of total
                        </p>
                        <p className="tabular-nums text-[#64748B]">
                          {row.orderCount} Purchase Order
                          {row.orderCount === 1 ? "" : "s"}
                        </p>
                      </div>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[11px] font-medium uppercase tracking-wide text-[#94A3B8]">
                Total Spend
              </span>
              <span className="mt-0.5 text-[18px] font-bold tabular-nums text-[#1E293B]">
                {formatCurrencyCompact(totalSpend)}
              </span>
            </div>
          </div>
          <ul className="w-[42%] shrink-0 space-y-2 pr-1">
            {data.map((row, i) => (
              <li
                key={row.category}
                className="flex items-start gap-2 text-[12px] text-[#475569]"
              >
                <span
                  className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor: DONUT_COLORS[i % DONUT_COLORS.length],
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className="block truncate font-medium text-[#1E293B]"
                    title={row.category}
                  >
                    {row.category}
                  </span>
                  <span className="mt-0.5 block tabular-nums text-[11px] text-[#64748B]">
                    {formatCurrencyCompact(row.spend)} · {row.pct.toFixed(0)}%
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ChartShell>
  );
}

const OVERVIEW_TILES: Array<{
  key: keyof SupplierOverviewMetrics;
  label: string;
  icon: LucideIcon;
  format: (m: SupplierOverviewMetrics) => string;
  tone: string;
}> = [
  {
    key: "totalSuppliers",
    label: "Total Suppliers",
    icon: Users,
    format: (m) => m.totalSuppliers.toLocaleString(),
    tone: "bg-[#EEF3FA] text-[#1F3A6D]",
  },
  {
    key: "activeSuppliers",
    label: "Active Suppliers",
    icon: ShieldCheck,
    format: (m) => m.activeSuppliers.toLocaleString(),
    tone: "bg-[#ECFDF5] text-[#047857]",
  },
  {
    key: "newThisMonth",
    label: "New This Month",
    icon: UserPlus,
    format: (m) => m.newThisMonth.toLocaleString(),
    tone: "bg-[#EEF3FA] text-[#1F3A6D]",
  },
  {
    key: "highRiskSuppliers",
    label: "High Risk Suppliers",
    icon: AlertTriangle,
    format: (m) => m.highRiskSuppliers.toLocaleString(),
    tone: "bg-[#FEF2F2] text-[#B91C1C]",
  },
  {
    key: "averageScore",
    label: "Average Score",
    icon: Gauge,
    format: (m) =>
      m.averageScore != null ? `${m.averageScore.toFixed(0)}%` : "—",
    tone: "bg-[#EEF3FA] text-[#1F3A6D]",
  },
];

function SupplierOverviewCard({
  metrics,
  loading,
}: {
  metrics: SupplierOverviewMetrics;
  loading?: boolean;
}) {
  return (
    <ChartShell
      title="Supplier Overview"
      subtitle="Live supplier master & scorecard"
      loading={loading}
    >
      <div className="flex h-full min-h-[280px] flex-col justify-between gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {OVERVIEW_TILES.map((tile) => {
            const Icon = tile.icon;
            return (
              <div
                key={tile.key}
                className="flex items-center gap-3 rounded-lg border border-[#F1F5F9] bg-[#F8FAFC] px-3 py-3"
              >
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tile.tone}`}
                >
                  <Icon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <div className="min-w-0">
                  <p className="text-[20px] font-bold leading-none tabular-nums text-[#1E293B]">
                    {tile.format(metrics)}
                  </p>
                  <p className="mt-1 truncate text-[12px] font-medium text-[#64748B]">
                    {tile.label}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex justify-end pt-1">
          <Link
            to={SUPPLIER_DETAILS_HREF}
            className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#1F3A6D] no-underline hover:underline"
          >
            View Details
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </ChartShell>
  );
}

interface Props {
  monthlySpend: PoSpendSeriesPoint[];
  rfqPipeline: RfqPipelineStage[];
  categorySpend: CategoryDonutPoint[];
  supplierOverview: SupplierOverviewMetrics;
  loading?: boolean;
  pipelineLoading?: boolean;
  categoryLoading?: boolean;
  supplierLoading?: boolean;
}

function ProcurementExecutiveCharts({
  monthlySpend,
  rfqPipeline,
  categorySpend,
  supplierOverview,
  loading,
  pipelineLoading,
  categoryLoading,
  supplierLoading,
}: Props) {
  return (
    <section className="grid grid-cols-1 gap-5 xl:grid-cols-2 xl:items-stretch">
      <MonthlySpendLine data={monthlySpend} loading={loading} />
      <RfqPipelineBars stages={rfqPipeline} loading={pipelineLoading || loading} />
      <CategoryDonut data={categorySpend} loading={categoryLoading || loading} />
      <SupplierOverviewCard
        metrics={supplierOverview}
        loading={supplierLoading || loading}
      />
    </section>
  );
}

export default memo(ProcurementExecutiveCharts);
