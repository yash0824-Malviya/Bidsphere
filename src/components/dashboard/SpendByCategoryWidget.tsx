/**
 * Spend by Category — live ERP procurement analytics (donut + legend).
 * Uses fetchCategorySpendFiltered; no hardcoded spend values.
 */

import { memo, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { FilePlus2, PieChart as PieChartIcon, RefreshCw } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { fetchCategorySpendFiltered } from "../../api/dashboard";
import { DASHBOARD_QUERY_OPTIONS } from "../../api/queryPresets";
import {
  buildBucketedCategorySpend,
  PROCUREMENT_SPEND_CATEGORIES,
  PROCUREMENT_SPEND_CATEGORY_COLORS,
  spendPeriodDateRange,
  type CategoryDonutPoint,
  type SpendCategoryPeriod,
} from "../../utils/procurementExecutiveMetrics";
import { formatCurrencyCompact } from "../../utils/format";
import { Skeleton } from "../Skeleton";

const CARD =
  "flex h-full min-h-[360px] flex-col overflow-hidden rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.06)]";

const PERIOD_OPTIONS: Array<{ id: SpendCategoryPeriod; label: string }> = [
  { id: "month", label: "This Month" },
  { id: "3m", label: "Last 3 Months" },
  { id: "6m", label: "Last 6 Months" },
  { id: "ytd", label: "This Year" },
];

function CategoryEmptyState() {
  return (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center px-6 text-center">
      <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#EEF3FA] text-[#1F3A6D]">
        <PieChartIcon className="h-7 w-7" strokeWidth={1.75} />
      </span>
      <p className="text-[14px] font-semibold text-[#1E293B]">
        No procurement spend available.
      </p>
      <p className="mt-1.5 max-w-[300px] text-[13px] leading-relaxed text-[#64748B]">
        Create a Purchase Order to generate spend analytics.
      </p>
      <Link
        to="/p2p/purchase-orders/create"
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#1F3A6D] px-3.5 py-2 text-[13px] font-semibold text-white no-underline hover:bg-[#17315D]"
      >
        <FilePlus2 className="h-4 w-4" />
        Create Purchase Order
      </Link>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex h-full min-h-[280px] flex-col gap-4 sm:flex-row">
      <Skeleton className="mx-auto h-[220px] w-[220px] shrink-0 rounded-full sm:mx-0" />
      <div className="min-w-0 flex-1 space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full rounded-md" />
        ))}
      </div>
    </div>
  );
}

function SpendByCategoryWidget() {
  const [period, setPeriod] = useState<SpendCategoryPeriod>("3m");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const dateRange = useMemo(() => spendPeriodDateRange(period), [period]);

  const spendQuery = useQuery({
    queryKey: ["procurement-spend-by-category", period, dateRange],
    queryFn: () =>
      fetchCategorySpendFiltered({
        fromDate: dateRange.fromDate,
        toDate: dateRange.toDate,
      }),
    ...DASHBOARD_QUERY_OPTIONS,
    placeholderData: keepPreviousData,
  });

  const chartData = useMemo(() => {
    const lines = spendQuery.data?.lines ?? [];
    return buildBucketedCategorySpend(lines);
  }, [spendQuery.data]);

  const legendRows = useMemo(() => {
    const byName = new Map(chartData.map((r) => [r.category, r]));
    return PROCUREMENT_SPEND_CATEGORIES.map((name) => {
      const row = byName.get(name);
      return (
        row ?? {
          category: name,
          spend: 0,
          pct: 0,
          orderCount: 0,
        }
      );
    });
  }, [chartData]);

  const totalSpend = chartData.reduce((s, r) => s + r.spend, 0);
  const hasData = totalSpend > 0 && spendQuery.data?.basis !== "none";
  const displayTotal = activeCategory
    ? (chartData.find((r) => r.category === activeCategory)?.spend ?? 0)
    : totalSpend;

  const filterHref = activeCategory
    ? `/p2p/purchase-orders?category=${encodeURIComponent(activeCategory)}`
    : "/p2p/purchase-orders";

  return (
    <div className={CARD}>
      <div className="mb-3 flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold leading-tight text-[#1E293B]">
            Spend by Category
          </h3>
          <p className="mt-0.5 text-[12px] font-medium text-[#64748B]">
            Spend distribution by procurement category
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                setPeriod(opt.id);
                setActiveCategory(null);
              }}
              className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                period === opt.id
                  ? "bg-[#1F3A6D] text-white"
                  : "border border-[#E2E8F0] bg-white text-[#64748B] hover:bg-[#F8FAFC]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {spendQuery.isLoading && !spendQuery.data ? (
          <LoadingSkeleton />
        ) : spendQuery.isError ? (
          <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 text-center">
            <p className="text-[14px] font-semibold text-rose-600">
              Unable to load spend analytics.
            </p>
            <button
              type="button"
              onClick={() => void spendQuery.refetch()}
              className="inline-flex items-center gap-2 rounded-lg border border-[#E2E8F0] bg-white px-3.5 py-2 text-[13px] font-semibold text-[#334155] hover:bg-[#F8FAFC]"
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </button>
          </div>
        ) : !hasData ? (
          <CategoryEmptyState />
        ) : (
          <div className="flex h-full min-h-[280px] flex-col gap-4 lg:flex-row lg:items-center">
            <div className="relative mx-auto h-[240px] w-full max-w-[280px] shrink-0 lg:mx-0 lg:flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    dataKey="spend"
                    nameKey="category"
                    cx="50%"
                    cy="50%"
                    innerRadius="58%"
                    outerRadius="82%"
                    paddingAngle={2}
                    stroke="#fff"
                    strokeWidth={2}
                    animationDuration={600}
                    animationEasing="ease-out"
                    onClick={(_, index) => {
                      const row = chartData[index];
                      if (!row) return;
                      setActiveCategory((prev) =>
                        prev === row.category ? null : row.category,
                      );
                    }}
                  >
                    {chartData.map((entry) => (
                      <Cell
                        key={entry.category}
                        fill={
                          PROCUREMENT_SPEND_CATEGORY_COLORS[
                            entry.category as keyof typeof PROCUREMENT_SPEND_CATEGORY_COLORS
                          ] ?? "#64748B"
                        }
                        opacity={
                          activeCategory && activeCategory !== entry.category
                            ? 0.28
                            : 1
                        }
                        className="cursor-pointer"
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0]?.payload as CategoryDonutPoint;
                      return (
                        <div className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2.5 text-[12px] shadow-md">
                          <p className="font-semibold text-[#1E293B]">{row.category}</p>
                          <p className="mt-1 tabular-nums text-[#475569]">
                            {formatCurrencyCompact(row.spend)}
                          </p>
                          <p className="tabular-nums text-[#64748B]">
                            {row.pct.toFixed(1)}% of total
                          </p>
                          <p className="tabular-nums text-[#64748B]">
                            {row.orderCount} PO{row.orderCount === 1 ? "" : "s"}
                          </p>
                        </div>
                      );
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[10px] font-medium uppercase tracking-wide text-[#94A3B8]">
                  {activeCategory ? activeCategory : "Total Spend"}
                </span>
                <span className="mt-0.5 max-w-[120px] truncate text-center text-[18px] font-bold tabular-nums text-[#1E293B]">
                  {formatCurrencyCompact(displayTotal)}
                </span>
              </div>
            </div>

            <div className="min-w-0 flex-1">
              <ul className="max-h-[280px] space-y-1 overflow-y-auto pr-1">
                {legendRows.map((row) => {
                  const color =
                    PROCUREMENT_SPEND_CATEGORY_COLORS[
                      row.category as keyof typeof PROCUREMENT_SPEND_CATEGORY_COLORS
                    ] ?? "#64748B";
                  const isActive = activeCategory === row.category;
                  const dimmed = !!activeCategory && !isActive;
                  const hasSpend = row.spend > 0;
                  return (
                    <li key={row.category}>
                      <button
                        type="button"
                        disabled={!hasSpend}
                        onClick={() =>
                          setActiveCategory((prev) =>
                            prev === row.category ? null : row.category,
                          )
                        }
                        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors ${
                          isActive
                            ? "bg-[#EEF3FA] ring-1 ring-inset ring-[#CBD5E1]"
                            : "hover:bg-[#F8FAFC]"
                        } ${dimmed ? "opacity-45" : ""} ${!hasSpend ? "cursor-default opacity-35" : "cursor-pointer"}`}
                      >
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: color }}
                        />
                        <span className="min-w-0 flex-1 truncate font-medium text-[#1E293B]">
                          {row.category}
                        </span>
                        <span className="shrink-0 tabular-nums text-[#475569]">
                          {formatCurrencyCompact(row.spend)}
                        </span>
                        <span className="w-10 shrink-0 text-right tabular-nums text-[#64748B]">
                          {row.pct > 0 ? `${row.pct.toFixed(0)}%` : "—"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {activeCategory ? (
                <div className="mt-3 flex justify-end border-t border-[#F1F5F9] pt-2">
                  <Link
                    to={filterHref}
                    className="text-[12px] font-semibold text-[#1F3A6D] no-underline hover:underline"
                  >
                    View {activeCategory} purchase orders →
                  </Link>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(SpendByCategoryWidget);
