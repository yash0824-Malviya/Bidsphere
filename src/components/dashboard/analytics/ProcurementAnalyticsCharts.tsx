import { Fragment, memo } from "react";
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
    <div className={`dashboard-panel h-full${className ? ` ${className}` : ""}`}>
      <div className="dashboard-panel-header flex-col items-start gap-0.5 border-b border-neutral-100">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          {title}
        </h3>
        {subtitle ? <p className="text-xs text-neutral-400">{subtitle}</p> : null}
      </div>
      <div className="dashboard-panel-body flex-1 p-4">
        {hasData ? (
          children
        ) : (
          <div className="grid h-[220px] place-items-center text-sm text-neutral-400">
            No data available
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

const compact = (v: number) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(v);

export type AnalyticsChartKey =
  | "monthlySpend"
  | "budgetVsActual"
  | "supplierResponse"
  | "rfqTurnaround"
  | "costSavings";

interface Props {
  data?: ProcurementAnalytics;
  loading?: boolean;
  /** Which charts to render, in order. Defaults to all five. */
  only?: AnalyticsChartKey[];
}

const ALL_CHART_KEYS: AnalyticsChartKey[] = [
  "monthlySpend",
  "budgetVsActual",
  "supplierResponse",
  "rfqTurnaround",
  "costSavings",
];

function ProcurementAnalyticsCharts({ data, loading, only }: Props) {
  const keys: AnalyticsChartKey[] = only ?? ALL_CHART_KEYS;

  // When an odd number of charts is shown, the final chart spans both columns
  // so the last row is completely filled — no empty cell / blank whitespace.
  const spanClass = (index: number) =>
    keys.length % 2 === 1 && index === keys.length - 1 ? "lg:col-span-2" : "";

  if (loading || !data) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {keys.map((k, i) => (
          <Skeleton key={k} className={`h-[300px] rounded-xl ${spanClass(i)}`} />
        ))}
      </div>
    );
  }

  const c = data.charts;
  const spendHas = c.monthlySpend.some((p) => p.amount > 0);
  const budgetHas = c.budgetVsActual.length > 0;
  const respHas = c.supplierResponse.some((p) => p.invited > 0);
  const turnHas = c.rfqTurnaround.some((p) => p.days > 0);
  const savHas = c.costSavings.some((p) => p.savings > 0);

  const CHARTS: Record<AnalyticsChartKey, (cls: string) => React.ReactNode> = {
    monthlySpend: (cls) => (
      <ChartCard title="Monthly Spend Trend" subtitle="Last 12 months · USD" hasData={spendHas} className={cls}>
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={c.monthlySpend} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="month" {...AXIS} interval="preserveStartEnd" />
              <YAxis {...AXIS} width={44} tickFormatter={compact} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
                formatter={(v) => `$${compact(typeof v === "number" ? v : 0)}`}
              />
              <Line type="monotone" dataKey="amount" name="Spend" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
    ),
    budgetVsActual: (cls) => (
      <ChartCard title="Budget vs Actual Spend" subtitle="Top budgets · USD" hasData={budgetHas} className={cls}>
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={c.budgetVsActual} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="name" {...AXIS} interval={0} height={40} angle={-15} textAnchor="end" />
              <YAxis {...AXIS} width={44} tickFormatter={compact} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
                formatter={(v) => `$${compact(typeof v === "number" ? v : 0)}`}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="allocated" name="Allocated" fill="#c7d2fe" radius={[3, 3, 0, 0]} />
              <Bar dataKey="actual" name="Actual" fill="#6366f1" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
    ),
    supplierResponse: (cls) => (
      <ChartCard title="Supplier Response Trend" subtitle="Invited vs responded" hasData={respHas} className={cls}>
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={c.supplierResponse} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="month" {...AXIS} interval="preserveStartEnd" />
              <YAxis {...AXIS} width={30} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="invited" name="Invited" fill="#cbd5e1" radius={[3, 3, 0, 0]} />
              <Bar dataKey="responded" name="Responded" fill="#10b981" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
    ),
    rfqTurnaround: (cls) => (
      <ChartCard title="RFQ Turnaround Trend" subtitle="Average days to close" hasData={turnHas} className={cls}>
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={c.rfqTurnaround} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="month" {...AXIS} interval="preserveStartEnd" />
              <YAxis {...AXIS} width={30} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
                formatter={(v) => `${typeof v === "number" ? v : 0} days`}
              />
              <Line type="monotone" dataKey="days" name="Days" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
    ),
    costSavings: (cls) => (
      <ChartCard title="Cost Savings Trend" subtitle="Negotiated savings · USD" hasData={savHas} className={cls}>
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={c.costSavings} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="month" {...AXIS} interval="preserveStartEnd" />
              <YAxis {...AXIS} width={44} tickFormatter={compact} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
                formatter={(v) => `$${compact(typeof v === "number" ? v : 0)}`}
              />
              <Bar dataKey="savings" name="Savings" fill="#10b981" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
    ),
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {keys.map((key, i) => (
        <Fragment key={key}>{CHARTS[key](spanClass(i))}</Fragment>
      ))}
    </div>
  );
}

export default memo(ProcurementAnalyticsCharts);
