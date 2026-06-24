import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Layers, Receipt, TrendingUp } from "lucide-react";

import { EmptyState } from "../ui";
import { Skeleton } from "../Skeleton";
import type {
  CategorySpendPoint,
  MonthlySpendPoint,
} from "../../utils/dashboardUtils";
import { CATEGORY_COLORS } from "../../utils/dashboardUtils";
import { formatCurrency } from "../../utils/format";
import { formatCurrencyCompact } from "../../utils/paymentUtils";

interface SpendTrendProps {
  data: MonthlySpendPoint[];
  currency: string;
  loading?: boolean;
}

export function SpendTrendChart({ data, loading }: SpendTrendProps) {
  const total = data.reduce((s, m) => s + m.spend, 0);

  if (loading) return <Skeleton className="h-80 w-full rounded-card" />;

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">
            Monthly Spend Trend
          </h3>
          <p className="text-xs text-neutral-500">
            Trailing 12 months — submitted purchase invoices
          </p>
        </div>
        <p className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
          <TrendingUp className="h-3.5 w-3.5" />
          {formatCurrencyCompact(total)} total
        </p>
      </div>

      {total === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No invoiced spend yet"
          description="Submitted purchase invoices will populate this trend."
        />
      ) : (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid
                stroke="#e2e8f0"
                strokeDasharray="3 3"
                vertical={false}
              />
              <XAxis
                dataKey="label"
                tick={{ fill: "#64748b", fontSize: 11 }}
                axisLine={{ stroke: "#e2e8f0" }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: "#64748b", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={48}
                tickFormatter={(v: number) =>
                  new Intl.NumberFormat("en-US", {
                    notation: "compact",
                    maximumFractionDigits: 1,
                  }).format(v)
                }
              />
              <Tooltip
                cursor={{ fill: "rgba(99,102,241,0.06)" }}
                contentStyle={{
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                  fontSize: 12,
                }}
                formatter={(value) =>
                  formatCurrency(typeof value === "number" ? value : 0)
                }
              />
              <Bar
                dataKey="spend"
                name="Spend"
                fill="#0ea5e9"
                radius={[4, 4, 0, 0]}
                maxBarSize={40}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

interface CategoryProps {
  data: CategorySpendPoint[];
  currency: string;
  loading?: boolean;
}

export function SpendByCategoryChart({
  data,
  loading,
}: CategoryProps) {
  if (loading) return <Skeleton className="h-80 w-full rounded-card" />;

  const chartData = data.map((d) => ({
    name: d.category.length > 18 ? `${d.category.slice(0, 16)}…` : d.category,
    fullName: d.category,
    value: d.spend,
    pct: d.pct,
  }));

  return (
    <div className="card p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-neutral-900">
          Spend by Category
        </h3>
        <p className="text-xs text-neutral-500">
          {data.some((d) => d.estimated)
            ? "Estimated from PO & invoice totals"
            : "Procurement category distribution"}
        </p>
      </div>

      {data.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="Loading category analytics"
          description="Category breakdown will appear momentarily."
        />
      ) : (
        <>
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={44}
                  outerRadius={72}
                  paddingAngle={2}
                  stroke="white"
                >
                  {chartData.map((entry, idx) => (
                    <Cell
                      key={entry.fullName}
                      fill={CATEGORY_COLORS[idx % CATEGORY_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid #e2e8f0",
                    fontSize: 12,
                  }}
                  formatter={(value, _name, item) => {
                    const pct = (item.payload as { pct?: number }).pct ?? 0;
                    return [
                      `${formatCurrency(typeof value === "number" ? value : 0)} (${pct.toFixed(1)}%)`,
                      (item.payload as { fullName?: string }).fullName,
                    ];
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-3 max-h-28 space-y-1 overflow-y-auto">
            {data.slice(0, 6).map((d, idx) => (
              <li
                key={d.category}
                className="flex items-center justify-between gap-2 text-xs"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2 w-2 flex-shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        CATEGORY_COLORS[idx % CATEGORY_COLORS.length],
                    }}
                  />
                  <span className="truncate text-neutral-600">{d.category}</span>
                </span>
                <span className="flex-shrink-0 font-medium tabular-nums text-neutral-800">
                  {d.pct.toFixed(0)}%
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
