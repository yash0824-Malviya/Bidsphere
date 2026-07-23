import { Fragment, memo, useEffect, useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
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
  children: React.ReactNode;
}

function ChartCard({ title, subtitle, hasData, className, children }: ChartCardProps) {
  return (
    <div
      className={`flex h-[300px] flex-col rounded-2xl border border-[#E8EDF5] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)] transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(15,23,42,0.07)]${className ? ` ${className}` : ""}`}
    >
      <div className="flex shrink-0 items-baseline justify-between gap-3 px-4 pb-2 pt-4">
        <h3 className="text-[14px] font-semibold leading-tight text-[#111827]">
          {title}
        </h3>
        {subtitle ? (
          <p className="shrink-0 text-[12px] font-medium text-[#64748B]">
            {subtitle}
          </p>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 px-2.5 pb-3 pt-0">
        {hasData ? (
          children
        ) : (
          <div className="grid h-full place-items-center px-4 text-center text-[13px] text-[#64748B]">
            Waiting for completed data
          </div>
        )}
      </div>
    </div>
  );
}

const AXIS = {
  tick: { fontSize: 10, fill: "#94a3b8" },
  axisLine: false as const,
  tickLine: false as const,
};

const TOOLTIP = {
  fontSize: 12,
  borderRadius: 10,
  border: "1px solid #E8EDF5",
  boxShadow: "0 4px 12px rgba(15,23,42,0.06)",
};

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

  if (loading || !data) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch">
        {keys.map((k) => (
          <Skeleton key={k} className="h-[300px] rounded-2xl" />
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
    pipelineHas,
    turnaroundSeries,
  } = chartFlags;

  const CHARTS: Record<AnalyticsChartKey, () => React.ReactNode> = {
    monthlySpend: () => (
      <ChartCard title="Monthly Spend Trend" subtitle="Last 12 Months" hasData={spendHas}>
        <div className="h-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={c.monthlySpend} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#EEF2F7" vertical={false} />
              <XAxis dataKey="month" {...AXIS} interval="preserveStartEnd" />
              <YAxis {...AXIS} width={40} tickFormatter={compact} />
              <Tooltip
                contentStyle={TOOLTIP}
                formatter={(v) => `$${compact(typeof v === "number" ? v : 0)}`}
              />
              <Line
                type="monotone"
                dataKey="amount"
                name="Spend"
                stroke="#1993FF"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3, fill: "#1993FF" }}
                isAnimationActive
                animationDuration={500}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
    ),
    rfqPipeline: () =>
      pipelineLoading ? (
        <Skeleton className="h-[300px] rounded-2xl" />
      ) : (
        <ChartCard title="RFQ Pipeline" subtitle="Open Stages" hasData={pipelineHas}>
          <div className="h-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={rfqPipeline}
                layout="vertical"
                margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
              >
                <CartesianGrid stroke="#EEF2F7" horizontal={false} />
                <XAxis type="number" allowDecimals={false} {...AXIS} />
                <YAxis
                  type="category"
                  dataKey="stage"
                  width={100}
                  tick={{ fontSize: 10, fill: "#64748B" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip contentStyle={TOOLTIP} />
                <Bar
                  dataKey="count"
                  fill="#1993FF"
                  radius={[0, 4, 4, 0]}
                  barSize={14}
                  isAnimationActive
                  animationDuration={500}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      ),
    budgetVsActual: () => (
      <ChartCard title="Budget vs Actual Spend" subtitle="Top Budgets" hasData={budgetHas}>
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
                fill="#CCECFB"
                radius={[3, 3, 0, 0]}
                isAnimationActive
                animationDuration={500}
              />
              <Bar
                dataKey="actual"
                name="Actual"
                fill="#007FC4"
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
      <ChartCard title="Supplier Response Trend" subtitle="Last 12 Months" hasData={respHas}>
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
        <Skeleton className="h-[300px] rounded-2xl" />
      ) : (
        <ChartCard title="RFQ Turnaround Trend" subtitle="Avg Days" hasData={turnHas}>
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
      <ChartCard title="Cost Savings Trend" subtitle="Last 12 Months" hasData={savHas}>
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
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch">
      {keys.map((key) => (
        <Fragment key={key}>{CHARTS[key]()}</Fragment>
      ))}
    </div>
  );
}

export default memo(ProcurementAnalyticsCharts);
