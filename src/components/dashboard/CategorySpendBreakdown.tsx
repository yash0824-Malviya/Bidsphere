import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
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
import {
  BarChart3,
  FilePlus2,
  Layers,
  PieChart as PieIcon,
  Receipt,
  Trophy,
} from "lucide-react";

import {
  fetchCategorySpendFiltered,
  fetchCompanyOptions,
  fetchCostCenterOptions,
  fetchProcurementSummary,
  type CategorySpendBreakdownFilters,
  type ProcurementSummary,
} from "../../api/dashboard";
import { Skeleton } from "../Skeleton";
import { formatCurrencyCompactIn, formatCurrencyIn } from "../../utils/format";

/**
 * The fixed reporting categories (task 7) with a stable colour each so the
 * donut and legend always agree. Live ERPNext Item Groups are normalised into
 * these buckets by `bucketForItemGroup`.
 */
const CATEGORY_META: Array<{ name: string; color: string }> = [
  { name: "Raw Materials", color: "#0098EA" },
  { name: "Electrical", color: "#f59e0b" },
  { name: "Mechanical", color: "#6366f1" },
  { name: "Packaging", color: "#10b981" },
  { name: "Consumables", color: "#ec4899" },
  { name: "Services", color: "#8b5cf6" },
  { name: "Others", color: "#94a3b8" },
];

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
  /** Number of distinct source transactions (POs/PIs) in this category. */
  count: number;
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

  // Each distinct filter set is its own cache entry, so switching filters is
  // instant on repeat and never re-fetches the same combination (task 12).
  // Auto-refreshes on new PO/PI: purchasing.ts + accounts.ts invalidate the
  // ["dashboard-category-spend"] key prefix on submit, which matches this key.
  const spendQuery = useQuery({
    queryKey: ["dashboard-category-spend", filters],
    queryFn: () => fetchCategorySpendFiltered(filters),
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
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

  const { slices, total, txnTotal } = useMemo(() => {
    const lines = spendQuery.data?.lines ?? [];
    const totals = new Map<string, number>();
    const txnByBucket = new Map<string, Set<string>>();
    const allTxns = new Set<string>();
    for (const l of lines) {
      const amt = l.base_amount ?? l.amount ?? 0;
      if (!amt) continue;
      const bucket = bucketForItemGroup(l.item_group);
      totals.set(bucket, (totals.get(bucket) ?? 0) + amt);
      // Count each distinct source document once per category (task 4).
      const txnId = l.parent?.trim();
      if (txnId) {
        allTxns.add(txnId);
        const set = txnByBucket.get(bucket) ?? new Set<string>();
        set.add(txnId);
        txnByBucket.set(bucket, set);
      }
    }
    const grand = Array.from(totals.values()).reduce((a, b) => a + b, 0);
    const built: Slice[] = CATEGORY_META.map((meta) => {
      const value = totals.get(meta.name) ?? 0;
      return {
        name: meta.name,
        value,
        pct: grand > 0 ? (value / grand) * 100 : 0,
        color: meta.color,
        count: txnByBucket.get(meta.name)?.size ?? 0,
      };
    });
    return { slices: built, total: grand, txnTotal: allTxns.size };
  }, [spendQuery.data]);

  const donutData = slices.filter((s) => s.value > 0);
  const categoryCount = donutData.length;
  const largest = donutData.reduce<Slice | null>(
    (max, s) => (!max || s.value > max.value ? s : max),
    null
  );

  const hasData = total > 0 && spendQuery.data?.basis !== "none";
  const filtersActive = !!company || !!fromDate || !!toDate || !!costCenter;

  // Fallback: only fetched once the spend query has resolved with no chartable
  // data, so a populated dashboard never pays for the extra round-trip.
  const showFallback = !spendQuery.isLoading && !spendQuery.isError && !hasData;
  const summaryQuery = useQuery({
    queryKey: ["dashboard-procurement-summary"],
    queryFn: fetchProcurementSummary,
    enabled: showFallback,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });

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
        ) : spendQuery.isError ? (
          <div className="flex h-[240px] flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm font-medium text-red-600">
              Couldn’t load category spend.
            </p>
            <button
              type="button"
              onClick={() => spendQuery.refetch()}
              className="rounded-md border border-neutral-200 bg-white px-3 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              Retry
            </button>
          </div>
        ) : !hasData ? (
          <SpendFallback
            loading={summaryQuery.isLoading}
            summary={summaryQuery.data}
            filtersActive={filtersActive}
          />
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
                        <span
                          className="shrink-0 tabular-nums text-neutral-400"
                          title={`${s.count} transaction${s.count === 1 ? "" : "s"}`}
                        >
                          {s.count > 0 ? `${s.count}×` : ""}
                        </span>
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

            {/* Totals (task 4, 9) */}
            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-neutral-100 pt-3 sm:grid-cols-4">
              <Total
                icon={PieIcon}
                label="Total Spend"
                value={formatCurrencyCompactIn(total, currency)}
              />
              <Total
                icon={Receipt}
                label="Transactions"
                value={String(txnTotal)}
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

/**
 * Shown when Category Spend has no submitted PO/PI data. Degrades in two steps:
 *   1. Live Procurement Summary (KPIs + RFQ funnel bar chart), then
 *   2. a professional empty state with a Create RFQ call-to-action.
 * Keeps the widget the same height so the dashboard never shows blank space.
 */
function SpendFallback({
  loading,
  summary,
  filtersActive,
}: {
  loading: boolean;
  summary?: ProcurementSummary;
  filtersActive: boolean;
}) {
  if (loading || !summary) {
    return <Skeleton className="h-[240px] w-full rounded-lg" />;
  }

  if (!summary.hasActivity) {
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 px-4 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-50 text-primary-600">
          <BarChart3 className="h-5 w-5" />
        </span>
        <p className="text-sm font-semibold text-neutral-800">Procurement Analytics</p>
        <p className="max-w-xs text-xs text-neutral-500">
          No purchasing transactions have been completed yet. Analytics will
          automatically appear after RFQs, Purchase Orders or Purchase Invoices
          are processed.
        </p>
        <Link
          to="/sourcing/rfq/new"
          className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white no-underline shadow-sm hover:bg-primary-700"
        >
          <FilePlus2 className="h-3.5 w-3.5" />
          Create RFQ
        </Link>
      </div>
    );
  }

  const c = summary.currency;
  const funnelData = [
    { name: "Open", value: summary.funnel.open, color: "#0098EA" },
    { name: "Under Review", value: summary.funnel.underReview, color: "#f59e0b" },
    { name: "Approved", value: summary.funnel.approved, color: "#6366f1" },
    { name: "Completed", value: summary.funnel.completed, color: "#10b981" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        <BarChart3 className="h-3.5 w-3.5 text-primary-600" />
        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          Procurement Summary
        </p>
        {filtersActive && (
          <span className="ml-auto text-[10px] text-neutral-400">Account-wide</span>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-1.5">
        <SummaryKpi label="Total RFQs" value={String(summary.totalRfqs)} />
        <SummaryKpi label="Quotations" value={String(summary.totalQuotations)} />
        <SummaryKpi label="Active Suppliers" value={String(summary.activeSuppliers)} />
        <SummaryKpi label="Purchase Orders" value={String(summary.totalPos)} />
        <SummaryKpi label="Pending RFQs" value={String(summary.pendingRfqs)} />
        <SummaryKpi label="Completed RFQs" value={String(summary.completedRfqs)} />
        <SummaryKpi
          label="Avg RFQ Value"
          value={formatCurrencyCompactIn(summary.avgRfqValue, c)}
        />
        <SummaryKpi
          label="Highest RFQ"
          value={formatCurrencyCompactIn(summary.maxRfqValue, c)}
        />
        <SummaryKpi
          label="Lowest RFQ"
          value={formatCurrencyCompactIn(summary.minRfqValue, c)}
        />
      </div>

      {/* RFQ funnel bar chart */}
      <div className="h-[130px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={funnelData} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 10, fill: "#64748b" }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              tickLine={false}
              axisLine={false}
              width={28}
            />
            <Tooltip
              cursor={{ fill: "#f8fafc" }}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
            <Bar dataKey="value" name="RFQs" radius={[4, 4, 0, 0]} maxBarSize={44}>
              {funnelData.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function SummaryKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-neutral-50 px-2 py-1.5">
      <p className="truncate text-[9px] font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <p className="mt-0.5 truncate text-sm font-bold tabular-nums text-neutral-900" title={value}>
        {value}
      </p>
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
