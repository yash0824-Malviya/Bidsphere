import { Fragment, memo, useEffect, useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ProcurementAnalytics } from "../../../api/procurementAnalytics";
import { dashTime, dashTimeEnd } from "../../../api/dashboardPerf";
import type { RfqPipelineStage } from "../../../utils/dashboardUtils";
import { Skeleton } from "../../Skeleton";

interface ChartCardProps {
  title: string;
  subtitle?: string;
  hasData: boolean;
  className?: string;
  heightPx?: number;
  children: React.ReactNode;
}

function ChartCard({
  title,
  subtitle,
  hasData,
  className,
  heightPx = 300,
  children,
}: ChartCardProps) {
  return (
    <div
      style={{ height: heightPx }}
      className={`flex flex-col rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)]${className ? ` ${className}` : ""}`}
    >
      <div className="flex shrink-0 items-baseline justify-between gap-3 px-4 pb-2 pt-4">
        <h3
          className="dash-section-title text-[15px] leading-tight"
          style={{ fontFamily: '"Libre Franklin", Inter, sans-serif' }}
        >
          {title}
        </h3>
        {subtitle ? (
          <span className="shrink-0 rounded-full bg-[var(--ds-paper,#F4F5F7)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--ds-text-soft,#5B6472)]">
            {subtitle}
          </span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 px-2.5 pb-3 pt-0">
        {hasData ? (
          children
        ) : (
          <div className="grid h-full place-items-center px-4 text-center text-[13px] text-[var(--ds-text-faint,#98A2B3)]">
            Waiting for completed data
          </div>
        )}
      </div>
    </div>
  );
}

const AXIS = {
  tick: {
    fontSize: 10,
    fill: "#98A2B3",
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
  },
  axisLine: false as const,
  tickLine: false as const,
};

const TOOLTIP = {
  fontSize: 12,
  borderRadius: 8,
  border: "1px solid #E3E6EB",
  boxShadow: "0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.04)",
  fontFamily: "Inter, sans-serif",
};

/** Presentation labels for the RFQ funnel (data keys unchanged). */
const PIPELINE_FUNNEL: Array<{
  stage: string;
  label: string;
  color: string;
}> = [
  { stage: "Draft", label: "Draft", color: "#98A2B3" },
  { stage: "Open", label: "Invited", color: "#1F3A6D" },
  { stage: "Quotation Received", label: "Quoted", color: "#0E7C6E" },
  { stage: "Evaluation", label: "In Review", color: "#A66418" },
  { stage: "Awarded", label: "Awarded", color: "#12805C" },
];

function RfqPipelineFunnel({ stages }: { stages: RfqPipelineStage[] }) {
  const countByStage = new Map(stages.map((s) => [s.stage, s.count]));
  const rows = PIPELINE_FUNNEL.map((meta) => ({
    ...meta,
    count: countByStage.get(meta.stage) ?? 0,
  }));
  const total = Math.max(
    1,
    rows.reduce((sum, r) => sum + r.count, 0),
  );
  const max = Math.max(1, ...rows.map((r) => r.count));

  return (
    <div className="flex h-full flex-col justify-center gap-4 px-3 py-2">
      {rows.map((row) => {
        const pct = Math.round((row.count / total) * 100);
        const barPct = Math.round((row.count / max) * 100);
        return (
          <div key={row.stage} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] font-semibold text-[#1E293B]">
                {row.label}
              </span>
              <span className="flex items-center gap-2 text-[12px] tabular-nums">
                <span className="font-semibold text-[#1E293B]">{row.count}</span>
                <span className="rounded-md bg-[#F1F5F9] px-1.5 py-0.5 font-medium text-[#64748B]">
                  {pct}%
                </span>
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#EEF2F7]">
              <div
                className="h-full rounded-full transition-[width] duration-500 ease-out"
                style={{
                  width: `${barPct}%`,
                  backgroundColor: row.color,
                  minWidth: row.count > 0 ? 6 : 0,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

const compact = (v: number) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(v);

export type AnalyticsChartKey =
  | "monthlySpend"
  | "rfqPipeline"
  | "budgetVsActual"
  | "supplierResponse"
  | "rfqTurnaround"
  | "costSavings";

interface Props {
  data?: ProcurementAnalytics;
  loading?: boolean;
  turnaroundLoading?: boolean;
  only?: AnalyticsChartKey[];
  rfqPipeline?: RfqPipelineStage[];
  pipelineLoading?: boolean;
  /** Chart card height in px (Procurement Dashboard uses 360). */
  chartHeight?: number;
}

const ALL_CHART_KEYS: AnalyticsChartKey[] = [
  "monthlySpend",
  "rfqPipeline",
  "budgetVsActual",
  "supplierResponse",
  "rfqTurnaround",
  "costSavings",
];

function ProcurementAnalyticsCharts({
  data,
  loading,
  turnaroundLoading,
  only,
  rfqPipeline = [],
  pipelineLoading,
  chartHeight = 300,
}: Props) {
  const keys: AnalyticsChartKey[] = only ?? ALL_CHART_KEYS;

  const chartFlags = useMemo(() => {
    if (!data) {
      return {
        spendHas: false,
        budgetHas: false,
        respHas: false,
        turnHas: false,
        savHas: false,
        pipelineHas: false,
        turnaroundSeries: [] as Array<{ month: string; days: number }>,
      };
    }
    const c = data.charts;
    return {
      spendHas: c.monthlySpend.some((p) => p.amount > 0),
      budgetHas: c.budgetVsActual.length > 0,
      respHas: c.supplierResponse.some((p) => p.invited > 0),
      turnHas: c.rfqTurnaround.some((p) => p.days > 0),
      savHas: c.costSavings.some((p) => p.savings > 0),
      pipelineHas: rfqPipeline.length > 0,
      turnaroundSeries: c.rfqTurnaround.filter((p) => p.days > 0),
    };
  }, [data, rfqPipeline]);

  const keysKey = keys.join("|");
  useEffect(() => {
    if (!data || loading) return;
    dashTime("Chart rendering");
    const id = requestAnimationFrame(() => {
      dashTimeEnd("Chart rendering");
    });
    return () => cancelAnimationFrame(id);
  }, [data, loading, keysKey]);

  const peakSpend = useMemo(() => {
    const series = data?.charts.monthlySpend ?? [];
    if (!series.length) return null;
    return series.reduce((best, row) =>
      row.amount > best.amount ? row : best,
    );
  }, [data?.charts.monthlySpend]);

  const spendMeta = useMemo(() => {
    const series = data?.charts.monthlySpend ?? [];
    if (!series.length) {
      return { avg: 0, target: 0, enriched: [] as Array<{
        month: string;
        amount: number;
        prevAmount: number | null;
        momPct: number | null;
      }> };
    }
    const amounts = series.map((r) => r.amount);
    const avg =
      amounts.reduce((s, n) => s + n, 0) / Math.max(1, amounts.length);
    const target = avg * 1.1;
    const enriched = series.map((row, i) => {
      const prev = i > 0 ? series[i - 1].amount : null;
      const momPct =
        prev != null && prev > 0
          ? ((row.amount - prev) / prev) * 100
          : null;
      return {
        month: row.month,
        amount: row.amount,
        prevAmount: prev,
        momPct,
      };
    });
    return { avg, target, enriched };
  }, [data?.charts.monthlySpend]);

  if (loading || !data) {
    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-stretch">
        {keys.map((k) => (
          <div key={k} style={{ height: chartHeight }}>
            <Skeleton className="h-full w-full rounded-2xl" />
          </div>
        ))}
      </div>
    );
  }

  const c = data.charts;
  const {
    spendHas,
    budgetHas,
    respHas,
    turnHas,
    savHas,
    turnaroundSeries,
  } = chartFlags;

  const CHARTS: Record<AnalyticsChartKey, () => React.ReactNode> = {
    monthlySpend: () => (
      <ChartCard
        title="Monthly Spend Trend"
        subtitle="Last 12 Months"
        hasData={spendHas}
        heightPx={chartHeight}
      >
        <div className="h-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={spendMeta.enriched}
              margin={{ top: 12, right: 14, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="dashSpendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1F3A6D" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#1F3A6D" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#EEF2F7" vertical={false} />
              <XAxis dataKey="month" {...AXIS} interval="preserveStartEnd" />
              <YAxis {...AXIS} width={48} tickFormatter={compact} />
              <Tooltip
                contentStyle={{
                  ...TOOLTIP,
                  borderRadius: 12,
                  border: "1px solid #E5E7EB",
                  boxShadow: "0 8px 24px rgba(15,23,42,0.08)",
                  padding: "10px 12px",
                }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0]?.payload as {
                    amount: number;
                    prevAmount: number | null;
                    momPct: number | null;
                  };
                  const mom =
                    row.momPct == null
                      ? "—"
                      : `${row.momPct > 0 ? "+" : ""}${row.momPct.toFixed(1)}% vs prior month`;
                  return (
                    <div className="rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5 shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748B]">
                        {label}
                      </p>
                      <p className="mt-1 text-[15px] font-bold tabular-nums text-[#1E293B]">
                        ${compact(row.amount)}
                      </p>
                      <p className="mt-0.5 text-[12px] text-[#64748B]">
                        Prior:{" "}
                        {row.prevAmount != null
                          ? `$${compact(row.prevAmount)}`
                          : "—"}
                      </p>
                      <p
                        className={`mt-0.5 text-[12px] font-semibold ${
                          (row.momPct ?? 0) > 0
                            ? "text-emerald-600"
                            : (row.momPct ?? 0) < 0
                              ? "text-rose-600"
                              : "text-[#64748B]"
                        }`}
                      >
                        {mom}
                      </p>
                    </div>
                  );
                }}
              />
              {spendMeta.avg > 0 ? (
                <ReferenceLine
                  y={spendMeta.avg}
                  stroke="#94A3B8"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  label={{
                    value: "Avg",
                    position: "insideTopRight",
                    fill: "#94A3B8",
                    fontSize: 10,
                  }}
                />
              ) : null}
              {spendMeta.target > 0 ? (
                <ReferenceLine
                  y={spendMeta.target}
                  stroke="#1F3A6D"
                  strokeDasharray="2 4"
                  strokeWidth={1.25}
                  label={{
                    value: "Target",
                    position: "insideTopLeft",
                    fill: "#1F3A6D",
                    fontSize: 10,
                  }}
                />
              ) : null}
              <Area
                type="monotone"
                dataKey="amount"
                name="Spend"
                stroke="#1F3A6D"
                strokeWidth={2.25}
                fill="url(#dashSpendFill)"
                dot={{ r: 2.5, fill: "#1F3A6D", strokeWidth: 0 }}
                activeDot={{ r: 5, fill: "#1F3A6D", strokeWidth: 0 }}
                isAnimationActive
                animationDuration={700}
              />
              {peakSpend && peakSpend.amount > 0 ? (
                <ReferenceDot
                  x={peakSpend.month}
                  y={peakSpend.amount}
                  r={5}
                  fill="#1F3A6D"
                  stroke="#fff"
                  strokeWidth={2}
                />
              ) : null}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
    ),
    rfqPipeline: () =>
      pipelineLoading ? (
        <div style={{ height: chartHeight }}>
          <Skeleton className="h-full w-full rounded-2xl" />
        </div>
      ) : (
        <ChartCard
          title="RFQ Pipeline"
          subtitle="Open Stages"
          hasData
          heightPx={chartHeight}
        >
          <RfqPipelineFunnel stages={rfqPipeline} />
        </ChartCard>
      ),
    budgetVsActual: () => (
      <ChartCard
        title="Budget vs Actual Spend"
        subtitle="Top Budgets"
        hasData={budgetHas}
        heightPx={chartHeight}
      >
        <div className="h-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={c.budgetVsActual} margin={{ top: 6, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid stroke="#EEF2F7" vertical={false} />
              <XAxis
                dataKey="name"
                {...AXIS}
                interval={0}
                height={36}
                angle={-12}
                textAnchor="end"
              />
              <YAxis {...AXIS} width={40} tickFormatter={compact} />
              <Tooltip
                contentStyle={TOOLTIP}
                formatter={(v) => `$${compact(typeof v === "number" ? v : 0)}`}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar
                dataKey="allocated"
                name="Allocated"
                fill="#EEF3FA"
                radius={[3, 3, 0, 0]}
                isAnimationActive
                animationDuration={500}
              />
              <Bar
                dataKey="actual"
                name="Actual"
                fill="#17315D"
                radius={[3, 3, 0, 0]}
                isAnimationActive
                animationDuration={500}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
    ),
    supplierResponse: () => (
      <ChartCard
        title="Supplier Response Trend"
        subtitle="Last 12 Months"
        hasData={respHas}
        heightPx={chartHeight}
      >
        <div className="h-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={c.supplierResponse} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#EEF2F7" vertical={false} />
              <XAxis dataKey="month" {...AXIS} interval="preserveStartEnd" />
              <YAxis {...AXIS} width={28} />
              <Tooltip contentStyle={TOOLTIP} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar
                dataKey="invited"
                name="Invited"
                fill="#E2E8F0"
                radius={[3, 3, 0, 0]}
                isAnimationActive
                animationDuration={500}
              />
              <Bar
                dataKey="responded"
                name="Responded"
                fill="#1993FF"
                radius={[3, 3, 0, 0]}
                isAnimationActive
                animationDuration={500}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
    ),
    rfqTurnaround: () =>
      turnaroundLoading ? (
        <div style={{ height: chartHeight }}>
          <Skeleton className="h-full w-full rounded-2xl" />
        </div>
      ) : (
        <ChartCard
          title="RFQ Turnaround Trend"
          subtitle="Avg Days"
          hasData={turnHas}
          heightPx={chartHeight}
        >
          <div className="h-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={turnaroundSeries}
                margin={{ top: 6, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid stroke="#EEF2F7" vertical={false} />
                <XAxis dataKey="month" {...AXIS} interval="preserveStartEnd" />
                <YAxis {...AXIS} width={28} />
                <Tooltip
                  contentStyle={TOOLTIP}
                  formatter={(v) =>
                    `${typeof v === "number" && v > 0 ? v : "—"} days`
                  }
                />
                <Line
                  type="monotone"
                  dataKey="days"
                  name="Days"
                  stroke="#F59E0B"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3 }}
                  isAnimationActive
                  animationDuration={500}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      ),
    costSavings: () => (
      <ChartCard
        title="Cost Savings Trend"
        subtitle="Last 12 Months"
        hasData={savHas}
        heightPx={chartHeight}
      >
        <div className="h-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={c.costSavings} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#EEF2F7" vertical={false} />
              <XAxis dataKey="month" {...AXIS} interval="preserveStartEnd" />
              <YAxis {...AXIS} width={40} tickFormatter={compact} />
              <Tooltip
                contentStyle={TOOLTIP}
                formatter={(v) => `$${compact(typeof v === "number" ? v : 0)}`}
              />
              <Bar
                dataKey="savings"
                name="Savings"
                fill="#10B981"
                radius={[3, 3, 0, 0]}
                isAnimationActive
                animationDuration={500}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
    ),
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-1 lg:grid-cols-2 lg:items-stretch">
      {keys.map((key) => (
        <Fragment key={key}>{CHARTS[key]()}</Fragment>
      ))}
    </div>
  );
}

export default memo(ProcurementAnalyticsCharts);
