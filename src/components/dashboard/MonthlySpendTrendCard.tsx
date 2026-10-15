import { useState } from "react";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  Tooltip,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";

export interface MonthlyPoint {
  month: string;
  amount: number;
}

const compact = (v: number) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(v);

export default function MonthlySpendTrendCard({
  data = [],
}: {
  data?: MonthlyPoint[];
}) {
  const [currency, setCurrency] = useState<"USD" | "EUR" | "INR">("USD");

  const currencySymbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : "₹";
  const multiplier = currency === "USD" ? 1 : currency === "EUR" ? 0.92 : 83.5;

  const chartData = data.map((d) => ({
    month: d.month,
    amount: Math.round((d.amount || 0) * multiplier),
  }));

  const total = chartData.reduce((acc, curr) => acc + curr.amount, 0);
  const hasData = chartData.length > 0 && total > 0;

  return (
    <div className="flex h-full min-h-[340px] flex-col justify-between rounded-[10px] border border-[#E2E8F0] bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3">
        <div>
          <h3 className="text-[14.5px] font-bold text-[#12213F]">
            Monthly Spend Trend
          </h3>
          <p className="text-[12px] text-[#64748B]">
            {hasData
              ? `Purchase Orders · Last 12 months (${currencySymbol}${compact(total)} total)`
              : "Purchase Orders · Last 12 months"}
          </p>
        </div>

        {/* Currency Selector */}
        {hasData ? (
          <div className="flex items-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-0.5">
            {(["USD", "EUR", "INR"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCurrency(c)}
                className={`rounded-md px-2 py-0.5 text-[11px] font-semibold transition-all ${
                  currency === c
                    ? "bg-white text-[#1554D1] shadow-xs"
                    : "text-[#64748B] hover:text-[#12213F]"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {hasData ? (
        <>
          <div className="my-2 h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData}
                margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1554D1" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#1554D1" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#F1F5F9" vertical={false} />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: "#64748B" }}
                  axisLine={{ stroke: "#E2E8F0" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#64748B" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `${currencySymbol}${compact(v)}`}
                />
                <Tooltip
                  formatter={(value) => [
                    `${currencySymbol}${Number(value ?? 0).toLocaleString()}`,
                    "PO Spend",
                  ]}
                  contentStyle={{
                    backgroundColor: "#FFFFFF",
                    border: "1px solid #E2E8F0",
                    borderRadius: "8px",
                    fontSize: "12px",
                    boxShadow: "0 4px 12px rgba(15, 27, 54, 0.08)",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="amount"
                  stroke="#1554D1"
                  strokeWidth={2}
                  fill="url(#spendGradient)"
                  activeDot={{ r: 4, stroke: "#1554D1", strokeWidth: 2, fill: "#FFFFFF" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="flex items-center justify-between border-t border-[#F1F5F9] pt-2.5 text-[11.5px] text-[#64748B]">
            <span>Average: {currencySymbol}{compact(Math.round(total / (chartData.length || 12)))}/month</span>
            <span className="font-semibold text-[#059669]">Spend efficiency tracked</span>
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
          <p className="text-[13px] font-semibold text-[#64748B]">
            No spend data available
          </p>
          <p className="mt-1 text-[11.5px] text-[#94A3B8]">
            Historical spend data will appear once purchase orders are processed.
          </p>
        </div>
      )}

      {!hasData ? (
        <div className="border-t border-[#F1F5F9] pt-2.5 text-right">
          <span className="text-[11.5px] text-[#64748B]">
            Live ERPNext purchase order data
          </span>
        </div>
      ) : null}
    </div>
  );
}
