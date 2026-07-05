import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { BudgetDetailData } from "../../api/budgetDashboard";
import { formatCurrencyCompactIn, formatCurrencyIn } from "../../utils/format";

interface Props {
  data: BudgetDetailData;
  currency: string;
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
    <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-3">
        <h3 className="text-sm font-bold text-neutral-900">{title}</h3>
        {subtitle && <p className="text-[11px] text-neutral-500">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-[200px] items-center justify-center text-center">
      <p className="text-xs text-neutral-400">{message}</p>
    </div>
  );
}

function barColor(pct: number): string {
  if (pct >= 100) return "#ef4444";
  if (pct > 80) return "#f59e0b";
  return "#10b981";
}

export default function BudgetDetailCharts({ data, currency }: Props) {
  const bva = data.budgetVsActual[0];
  const budgetVsActualData = bva
    ? [
        { name: "Allocated", value: bva.allocated, fill: "#6366f1" },
        { name: "Consumed", value: bva.actual, fill: barColor(data.financial.utilizationPct) },
      ]
    : [];

  const monthly = data.monthlySpend.map((m) => ({
    month: m.month.slice(2), // YY-MM
    amount: m.amount,
  }));

  const dept = data.departmentUtilization.slice(0, 10);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard
        title="Budget vs Actual Spend"
        subtitle="Allocated vs consumed for this budget"
      >
        {bva && bva.allocated > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={budgetVsActualData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => formatCurrencyCompactIn(Number(v), currency)}
                width={56}
              />
              <Tooltip
                formatter={(v) => formatCurrencyIn(Number(v), currency)}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={80}>
                {budgetVsActualData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart message="No allocation data available." />
        )}
      </ChartCard>

      <ChartCard
        title="Monthly Spend Trend"
        subtitle="Submitted purchase order spend by month"
      >
        {monthly.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={monthly} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => formatCurrencyCompactIn(Number(v), currency)}
                width={56}
              />
              <Tooltip
                formatter={(v) => formatCurrencyIn(Number(v), currency)}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Line
                type="monotone"
                dataKey="amount"
                stroke="#6366f1"
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart message="No spend data available yet." />
        )}
      </ChartCard>

      <ChartCard
        title="Department-wise Budget Utilization"
        subtitle="Utilization across active ERPNext budgets"
      >
        {dept.length > 0 ? (
          <ResponsiveContainer width="100%" height={Math.max(200, dept.length * 34)}>
            <BarChart
              layout="vertical"
              data={dept}
              margin={{ top: 4, right: 40, left: 8, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
              <XAxis
                type="number"
                domain={[0, (max: number) => Math.max(100, max)]}
                tick={{ fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${v}%`}
              />
              <YAxis
                type="category"
                dataKey="department"
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={110}
              />
              <Tooltip
                formatter={(v) => `${Number(v)}%`}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Bar dataKey="utilizationPct" radius={[0, 6, 6, 0]} maxBarSize={22}>
                {dept.map((d, i) => (
                  <Cell key={i} fill={barColor(d.utilizationPct)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart message="No department utilization data available." />
        )}
      </ChartCard>
    </div>
  );
}
