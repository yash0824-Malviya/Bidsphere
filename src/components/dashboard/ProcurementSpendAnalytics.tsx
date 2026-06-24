import { memo } from "react";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { Skeleton } from "../Skeleton";
import type {
  CategorySpendPoint,
  MonthlySpendPoint,
  SupplierConcentration,
  TopSupplierRow,
} from "../../utils/dashboardUtils";
import { CATEGORY_COLORS } from "../../utils/dashboardUtils";
import { formatCurrency } from "../../utils/format";
import { formatCurrencyCompact } from "../../utils/paymentUtils";

interface Props {
  monthlySpend: MonthlySpendPoint[];
  categorySpend: CategorySpendPoint[];
  topSuppliers: TopSupplierRow[];
  concentration: SupplierConcentration;
  loading?: boolean;
}

function ChartCard({
  title,
  subtitle,
  children,
  className = "h-[188px]",
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col rounded-lg border border-neutral-200/80 bg-white shadow-sm ${className}`}
    >
      <div className="shrink-0 border-b border-neutral-100 px-3 py-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          {title}
        </h3>
        {subtitle ? (
          <p className="mt-0.5 text-[9px] text-neutral-400">{subtitle}</p>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 p-2">{children}</div>
    </div>
  );
}

function ProcurementSpendAnalytics({
  monthlySpend,
  categorySpend,
  topSuppliers,
  concentration,
  loading,
}: Props) {
  if (loading) {
    return (
      <div className="grid gap-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[188px] rounded-lg" />
        ))}
      </div>
    );
  }

  const lastMonth = monthlySpend[monthlySpend.length - 1];
  const momPct = lastMonth?.momChangePct;
  const categoryPie = categorySpend.map((c) => ({
    name: c.category,
    value: c.spend,
    pct: c.pct,
    estimated: c.estimated,
  }));
  const supplierPie = topSuppliers.slice(0, 5).map((s) => ({
    name: s.supplier.length > 14 ? `${s.supplier.slice(0, 12)}…` : s.supplier,
    fullName: s.supplier,
    value: Math.max(s.spend, 1),
    pct: s.pct,
  }));
  const hasEstimatedCategories = categorySpend.some((c) => c.estimated);

  return (
    <div className="grid gap-2 lg:grid-cols-3">
      <ChartCard
        title="Monthly Spend Trend"
        subtitle="Last 12 months · invoiced spend"
      >
        <div className="flex h-full flex-col">
          {momPct != null && (
            <div className="mb-1 flex items-center gap-1 px-1">
              <span className="text-[9px] text-neutral-400">MoM</span>
              <span
                className={`inline-flex items-center gap-0.5 text-[10px] font-semibold tabular-nums ${
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
          <div className="min-h-0 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={monthlySpend}
                margin={{ top: 4, right: 8, left: -12, bottom: 0 }}
              >
                <CartesianGrid stroke="#f1f5f9" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 8, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  interval={1}
                />
                <YAxis
                  tick={{ fontSize: 8, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  width={32}
                  tickFormatter={(v: number) =>
                    new Intl.NumberFormat("en-US", {
                      notation: "compact",
                      maximumFractionDigits: 0,
                    }).format(v)
                  }
                />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 6 }}
                  formatter={(v, _n, item) => {
                    const mom = (item.payload as MonthlySpendPoint).momChangePct;
                    const spend = formatCurrency(typeof v === "number" ? v : 0);
                    return [
                      mom != null ? `${spend} (${mom > 0 ? "+" : ""}${mom}%)` : spend,
                      "Spend",
                    ];
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="spend"
                  stroke="#0ea5e9"
                  strokeWidth={2}
                  dot={{ r: 2, fill: "#0ea5e9" }}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </ChartCard>

      <ChartCard
        title="Category Spend Breakdown"
        subtitle={
          hasEstimatedCategories
            ? "Estimated from PO & invoice totals"
            : "By procurement category"
        }
      >
        <div className="flex h-full items-center gap-1">
          <div className="h-full w-[52%]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categoryPie}
                  dataKey="value"
                  innerRadius="48%"
                  outerRadius="82%"
                  paddingAngle={2}
                  stroke="white"
                  strokeWidth={2}
                >
                  {categoryPie.map((_, idx) => (
                    <Cell
                      key={idx}
                      fill={CATEGORY_COLORS[idx % CATEGORY_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 6 }}
                  formatter={(v, _n, item) => {
                    const pct = (item.payload as { pct: number }).pct ?? 0;
                    return [
                      `${formatCurrencyCompact(typeof v === "number" ? v : 0)} (${pct.toFixed(1)}%)`,
                      (item.payload as { name: string }).name,
                    ];
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="min-w-0 flex-1 space-y-1 overflow-hidden">
            {categoryPie.map((c, idx) => (
              <li
                key={c.name}
                className="flex items-start gap-1 text-[9px] text-neutral-600"
              >
                <span
                  className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor:
                      CATEGORY_COLORS[idx % CATEGORY_COLORS.length],
                  }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-neutral-800">
                    {c.name}
                  </p>
                  <p className="tabular-nums text-neutral-500">
                    {formatCurrencyCompact(c.value)} · {c.pct.toFixed(0)}%
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </ChartCard>

      <ChartCard
        title="Supplier Distribution"
        subtitle={`Top ${Math.min(5, supplierPie.length)} · concentration risk`}
      >
        <div className="flex h-full flex-col">
          <div className="mb-1 flex items-center justify-between px-1">
            <span
              className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                concentration.riskLevel === "high"
                  ? "bg-red-50 text-red-700"
                  : concentration.riskLevel === "medium"
                    ? "bg-amber-50 text-amber-800"
                    : "bg-emerald-50 text-emerald-700"
              }`}
            >
              {concentration.riskLevel} risk
            </span>
            {concentration.topSupplierShare > 0 && (
              <span className="text-[9px] tabular-nums text-neutral-500">
                Top: {concentration.topSupplierShare.toFixed(0)}%
              </span>
            )}
          </div>
          <div className="flex min-h-0 flex-1 items-center gap-1">
            <div className="h-full w-[52%]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={supplierPie}
                    dataKey="value"
                    innerRadius="48%"
                    outerRadius="82%"
                    paddingAngle={2}
                    stroke="white"
                    strokeWidth={2}
                  >
                    {supplierPie.map((_, idx) => (
                      <Cell
                        key={idx}
                        fill={CATEGORY_COLORS[idx % CATEGORY_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ fontSize: 11, borderRadius: 6 }}
                    formatter={(v, _n, item) => [
                      `${formatCurrencyCompact(typeof v === "number" ? v : 0)} (${(item.payload as { pct: number }).pct.toFixed(1)}%)`,
                      (item.payload as { fullName: string }).fullName,
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="min-w-0 flex-1 space-y-0.5 overflow-hidden">
              {supplierPie.map((s, idx) => (
                <li
                  key={s.fullName}
                  className="flex items-center gap-1 text-[9px] text-neutral-600"
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        CATEGORY_COLORS[idx % CATEGORY_COLORS.length],
                    }}
                  />
                  <span className="truncate">{s.name}</span>
                  <span className="ml-auto font-medium tabular-nums text-neutral-800">
                    {s.pct.toFixed(0)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </ChartCard>
    </div>
  );
}

export default memo(ProcurementSpendAnalytics);
