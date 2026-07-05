import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Layers, PieChart as PieIcon, Trophy } from "lucide-react";

import {
  fetchCategorySpendFiltered,
  fetchCompanyOptions,
  fetchCostCenterOptions,
  type CategorySpendBreakdownFilters,
} from "../../api/dashboard";
import { Skeleton } from "../Skeleton";
import { formatCurrencyCompactIn, formatCurrencyIn } from "../../utils/format";

/**
 * The fixed reporting categories (task 7) with a stable colour each so the
 * donut and legend always agree. Live ERPNext Item Groups are normalised into
 * these buckets by `bucketForItemGroup`.
 */
const CATEGORY_META: Array<{ name: string; color: string }> = [
  { name: "Raw Materials", color: "#0ea5e9" },
  { name: "Electrical", color: "#f59e0b" },
  { name: "Mechanical", color: "#6366f1" },
  { name: "Packaging", color: "#10b981" },
  { name: "Consumables", color: "#ec4899" },
  { name: "Services", color: "#8b5cf6" },
  { name: "Others", color: "#94a3b8" },
];
const COLOR_BY_CATEGORY = new Map(CATEGORY_META.map((c) => [c.name, c.color]));

/** Map a live ERPNext Item Group onto one of the fixed reporting buckets. */
function bucketForItemGroup(itemGroup?: string): string {
  const g = (itemGroup ?? "").toLowerCase();
  if (!g) return "Others";
  if (/raw|material|steel|plastic|resin|metal|fabric|chemical|sheet|alloy/.test(g))
    return "Raw Materials";
  if (/electr|wiring|cable|circuit|motor|battery|electronic|sensor|switch/.test(g))
    return "Electrical";
  if (
    /mechanic|bearing|gear|valve|pump|fastener|hardware|machin|spare|component|assembly|\bpart/.test(
      g
    )
  )
    return "Mechanical";
  if (/pack|carton|box|crate|pallet|wrap|label|packaging/.test(g))
    return "Packaging";
  if (/consumable|mro|maintenance|lubricant|cleaning|stationery|\btool|adhesive/.test(g))
    return "Consumables";
  if (
    /service|consult|labor|labour|software|license|support|logistic|freight|transport|shipping/.test(
      g
    )
  )
    return "Services";
  return "Others";
}

interface Slice {
  name: string;
  value: number;
  pct: number;
  color: string;
}

export default function CategorySpendBreakdown() {
  const [company, setCompany] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [costCenter, setCostCenter] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const filters: CategorySpendBreakdownFilters = {
    company: company || undefined,
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
    costCenter: costCenter || undefined,
  };

  // Auto-refreshes on new PO/PI: purchasing.ts + accounts.ts invalidate the
  // ["dashboard-category-spend"] key prefix on submit, which matches this key.
  const spendQuery = useQuery({
    queryKey: ["dashboard-category-spend", filters],
    queryFn: () => fetchCategorySpendFiltered(filters),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const companyQuery = useQuery({
    queryKey: ["category-spend-companies"],
    queryFn: fetchCompanyOptions,
    staleTime: 10 * 60_000,
  });
  const costCenterQuery = useQuery({
    queryKey: ["category-spend-cost-centers", company],
    queryFn: () => fetchCostCenterOptions(company || undefined),
    staleTime: 10 * 60_000,
  });

  const currency = spendQuery.data?.currency ?? "USD";

  const { slices, total } = useMemo(() => {
    const lines = spendQuery.data?.lines ?? [];
    const totals = new Map<string, number>();
    for (const l of lines) {
      const amt = l.base_amount ?? l.amount ?? 0;
      if (!amt) continue;
      const bucket = bucketForItemGroup(l.item_group);
      totals.set(bucket, (totals.get(bucket) ?? 0) + amt);
    }
    const grand = Array.from(totals.values()).reduce((a, b) => a + b, 0);
    const built: Slice[] = CATEGORY_META.map((meta) => {
      const value = totals.get(meta.name) ?? 0;
      return {
        name: meta.name,
        value,
        pct: grand > 0 ? (value / grand) * 100 : 0,
        color: meta.color,
      };
    });
    return { slices: built, total: grand };
  }, [spendQuery.data]);

  const donutData = slices.filter((s) => s.value > 0);
  const categoryCount = donutData.length;
  const largest = donutData.reduce<Slice | null>(
    (max, s) => (!max || s.value > max.value ? s : max),
    null
  );

  const hasData = total > 0 && spendQuery.data?.basis !== "none";
  const filtersActive = !!company || !!fromDate || !!toDate || !!costCenter;

  return (
    <div className="dashboard-panel">
      <div className="dashboard-panel-header flex-col items-start gap-2 border-b border-neutral-100">
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <PieIcon className="h-4 w-4 text-primary-600" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Category Spend Breakdown
            </h3>
          </div>
          {spendQuery.data?.basis === "po" && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
              From Purchase Orders
            </span>
          )}
        </div>

        {/* Filters (task 10) */}
        <div className="flex w-full flex-wrap items-center gap-2">
          <select
            value={company}
            onChange={(e) => {
              setCompany(e.target.value);
              setCostCenter("");
            }}
            className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-700"
          >
            <option value="">All Companies</option>
            {(companyQuery.data ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={costCenter}
            onChange={(e) => setCostCenter(e.target.value)}
            className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-700"
          >
            <option value="">All Cost Centers</option>
            {(costCenterQuery.data ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={fromDate}
            max={toDate || undefined}
            onChange={(e) => setFromDate(e.target.value)}
            className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-600"
            aria-label="From date"
          />
          <input
            type="date"
            value={toDate}
            min={fromDate || undefined}
            onChange={(e) => setToDate(e.target.value)}
            className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-600"
            aria-label="To date"
          />
          {filtersActive && (
            <button
              type="button"
              onClick={() => {
                setCompany("");
                setCostCenter("");
                setFromDate("");
                setToDate("");
              }}
              className="text-[11px] font-semibold text-primary-600 hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="dashboard-panel-body p-4">
        {spendQuery.isLoading ? (
          <Skeleton className="h-[240px] w-full rounded-lg" />
        ) : !hasData ? (
          <div className="flex h-[240px] flex-col items-center justify-center gap-1 text-center">
            <p className="text-sm font-medium text-neutral-500">
              No procurement transactions found.
            </p>
            <p className="text-xs text-neutral-400">
              {filtersActive
                ? "Try widening the company, date range, or cost center filters."
                : "Category spend appears once purchase invoices or orders are submitted."}
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              {/* Donut (task 5, 6) */}
              <div className="relative h-[220px] w-full sm:w-[46%]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={donutData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius="58%"
                      outerRadius="88%"
                      paddingAngle={2}
                      stroke="white"
                      strokeWidth={2}
                    >
                      {donutData.map((s) => (
                        <Cell
                          key={s.name}
                          fill={s.color}
                          opacity={
                            activeCategory && activeCategory !== s.name ? 0.25 : 1
                          }
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      formatter={(v, _n, item) => {
                        const p = item.payload as Slice;
                        return [
                          `${formatCurrencyIn(typeof v === "number" ? v : 0, currency)} (${p.pct.toFixed(1)}%)`,
                          p.name,
                        ];
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {/* Center total */}
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-[10px] uppercase tracking-wide text-neutral-400">
                    Total
                  </span>
                  <span className="text-sm font-bold tabular-nums text-neutral-900">
                    {formatCurrencyCompactIn(
                      activeCategory
                        ? slices.find((s) => s.name === activeCategory)?.value ?? 0
                        : total,
                      currency
                    )}
                  </span>
                </div>
              </div>

              {/* Legend (task 7, 8) — click to highlight the slice */}
              <ul className="min-w-0 flex-1 space-y-1">
                {slices.map((s) => {
                  const isActive = activeCategory === s.name;
                  const dimmed = !!activeCategory && !isActive;
                  return (
                    <li key={s.name}>
                      <button
                        type="button"
                        onClick={() =>
                          setActiveCategory((prev) =>
                            prev === s.name ? null : s.name
                          )
                        }
                        className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[11px] transition-colors hover:bg-neutral-50 ${
                          isActive ? "bg-neutral-50 ring-1 ring-inset ring-neutral-200" : ""
                        } ${dimmed ? "opacity-50" : ""}`}
                      >
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: s.color }}
                        />
                        <span className="truncate text-neutral-700">{s.name}</span>
                        <span className="ml-auto shrink-0 font-medium tabular-nums text-neutral-900">
                          {formatCurrencyCompactIn(s.value, currency)}
                        </span>
                        <span className="w-9 shrink-0 text-right tabular-nums text-neutral-400">
                          {s.pct.toFixed(0)}%
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Totals (task 9) */}
            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-neutral-100 pt-3">
              <Total
                icon={PieIcon}
                label="Total Spend"
                value={formatCurrencyCompactIn(total, currency)}
              />
              <Total
                icon={Layers}
                label="Categories"
                value={String(categoryCount)}
              />
              <Total
                icon={Trophy}
                label="Largest Category"
                value={largest ? largest.name : "—"}
                sub={
                  largest
                    ? `${formatCurrencyCompactIn(largest.value, currency)} · ${largest.pct.toFixed(0)}%`
                    : undefined
                }
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Total({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof PieIcon;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg bg-neutral-50 px-2.5 py-2">
      <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
        <Icon className="h-3 w-3" />
        {label}
      </p>
      <p className="mt-0.5 truncate text-sm font-bold text-neutral-900" title={value}>
        {value}
      </p>
      {sub && <p className="truncate text-[10px] text-neutral-400">{sub}</p>}
    </div>
  );
}
