import { lazy, memo, Suspense } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { Skeleton } from "../Skeleton";
import type { MonthlySpendPoint } from "../../utils/dashboardUtils";
import { formatCurrency } from "../../utils/format";

/** Category donut + filters — load after the spend trend paints. */
const CategorySpendBreakdown = lazy(() => import("./CategorySpendBreakdown"));

interface Props {
  monthlySpend: MonthlySpendPoint[];
  loading?: boolean;
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="dashboard-panel min-h-[320px]">
      <div className="dashboard-panel-header flex-col items-start gap-0.5 border-b border-neutral-100">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          {title}
        </h3>
        {subtitle ? (
          <p className="text-xs text-neutral-400">{subtitle}</p>
        ) : null}
      </div>
      <div className="dashboard-panel-body min-h-[240px] flex-1 p-4">{children}</div>
    </div>
  );
}

function AdminSpendCharts({ monthlySpend, loading }: Props) {
  if (loading) {
    return (
      <div className="dashboard-grid-2">
        <Skeleton className="min-h-[320px] rounded-xl" />
        <Skeleton className="min-h-[320px] rounded-xl" />
      </div>
    );
  }

  const lastMonth = monthlySpend[monthlySpend.length - 1];
  const momPct = lastMonth?.momChangePct;

  return (
    <div className="dashboard-grid-2">
      <ChartCard title="Monthly Spend Trend" subtitle="Last 12 months">
        <div className="flex h-full flex-col">
          {momPct != null && (
            <div className="mb-1 flex items-center gap-1">
              <span className="text-[10px] text-neutral-400">MoM</span>
              <span
                className={`inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums ${
                  momPct >= 0 ? "text-emerald-600" : "text-red-500"
                }`}
              >
                {momPct >= 0 ? (
                  <ArrowUpRight className="h-3 w-3" />
                ) : (
                  <ArrowDownRight className="h-3 w-3" />
                )}
                {momPct > 0 ? "+" : ""}
                {momPct.toFixed(1)}%
              </span>
            </div>
          )}
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlySpend} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid stroke="#f1f5f9" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                  tickFormatter={(v: number) =>
                    new Intl.NumberFormat("en-US", {
                      notation: "compact",
                      maximumFractionDigits: 0,
                    }).format(v)
                  }
                />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  formatter={(v) => formatCurrency(typeof v === "number" ? v : 0)}
                />
                <Line
                  type="monotone"
                  dataKey="spend"
                  stroke="#0ea5e9"
                  strokeWidth={2}
                  dot={{ r: 2, fill: "#0ea5e9" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </ChartCard>

      <Suspense fallback={<Skeleton className="min-h-[320px] rounded-xl" />}>
        <CategorySpendBreakdown />
      </Suspense>
    </div>
  );
}

export default memo(AdminSpendCharts);
