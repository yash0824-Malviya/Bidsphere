import { useLayoutEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CheckCircle2,
  Download,
  Layers,
  LineChart,
  Search,
  Truck,
  Wallet,
} from "lucide-react";

import { fetchCompanies, fetchFiscalYears } from "../../api/budget";
import {
  getBudgetMonitoringData,
  type BudgetMonitorRow,
} from "../../api/budgetDashboard";
import type { SpendBucket } from "../../api/budgetLedger";
import PageHeader from "../../components/PageHeader";
import { Skeleton } from "../../components/Skeleton";
import DashboardKpiCard, {
  DashboardKpiGrid,
} from "../../components/dashboard/DashboardKpiCard";
import { useOptionalLayout } from "../../contexts/LayoutContext";
import { formatCurrencyCompactIn, formatCurrencyIn } from "../../utils/format";

export default function BudgetMonitoringPage() {
  const layout = useOptionalLayout();
  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const { data, isLoading } = useQuery({
    queryKey: ["budget-monitoring-data"],
    queryFn: getBudgetMonitoringData,
    staleTime: 30_000,
  });

  const { data: companies = [] } = useQuery({
    queryKey: ["budget-companies"],
    queryFn: fetchCompanies,
  });

  const { data: fiscalYears = [] } = useQuery({
    queryKey: ["fiscal-years"],
    queryFn: fetchFiscalYears,
  });

  const currency = data?.currency ?? "USD";
  const rows = useMemo(() => data?.rows ?? [], [data]);

  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [fiscalYearFilter, setFiscalYearFilter] = useState("");
  const [deptFilter, setDeptFilter] = useState("");

  const departments = useMemo(() => {
    const set = new Set(rows.map((r) => r.department));
    return [...set].filter(Boolean).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.budgetId.toLowerCase().includes(q) ||
          r.department.toLowerCase().includes(q) ||
          r.costCenter.toLowerCase().includes(q),
      );
    }
    if (companyFilter) list = list.filter((r) => r.company === companyFilter);
    if (fiscalYearFilter)
      list = list.filter((r) => r.fiscalYear === fiscalYearFilter);
    if (deptFilter) list = list.filter((r) => r.department === deptFilter);
    return list;
  }, [rows, search, companyFilter, fiscalYearFilter, deptFilter]);

  const kpis = data?.kpis;

  const deptSpend = data?.spendByDepartment ?? [];
  const ccSpend = data?.spendByCostCenter ?? [];
  const supplierSpend = data?.spendBySupplier ?? [];

  function exportCSV() {
    const header =
      "Budget ID,Company,Fiscal Year,Department,Cost Center,Allocated,Reserved,Consumed,Remaining,Utilization %,Status";
    const csvRows = filtered.map((r) =>
      [
        r.budgetId,
        r.company,
        r.fiscalYear,
        r.department,
        r.costCenter,
        r.allocated,
        r.reserved,
        r.consumed,
        r.remaining,
        r.utilizationPct,
        r.status,
      ].join(","),
    );
    const blob = new Blob([[header, ...csvRows].join("\n")], {
      type: "text/csv",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `budget-monitoring-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const compact = (n: number) => formatCurrencyCompactIn(n, currency);
  const noData = !isLoading && (!data || !data.hasBudgets);

  return (
    <div className="budget-monitoring-page">
      <PageHeader
        title="Budget Monitoring"
        description="Live utilization, reservations, and spend analytics for all active budgets"
        actions={
          <button
            type="button"
            onClick={exportCSV}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 shadow-sm hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" /> Export
          </button>
        }
      />

      {/* Row 1 — KPIs */}
      {isLoading ? (
        <Skeleton className="mb-6 h-[126px] rounded-xl" />
      ) : (
        <DashboardKpiGrid columns={5} className="budget-monitor-kpis mb-6">
          <DashboardKpiCard
            label="Total Budget"
            value={compact(kpis?.totalBudget ?? 0)}
            icon={Wallet}
            iconClassName="bg-primary-50 text-primary-600"
          />
          <DashboardKpiCard
            label="Reserved"
            value={compact(kpis?.reservedBudget ?? 0)}
            subtitle="Open Purchase Orders"
            icon={Layers}
            iconClassName="bg-amber-50 text-amber-600"
          />
          <DashboardKpiCard
            label="Consumed"
            value={compact(kpis?.consumedBudget ?? 0)}
            subtitle="Purchase Invoices"
            icon={BarChart3}
            iconClassName="bg-rose-50 text-rose-600"
          />
          <DashboardKpiCard
            label="Available"
            value={compact(kpis?.availableBudget ?? 0)}
            icon={CheckCircle2}
            iconClassName="bg-emerald-50 text-emerald-600"
          />
          <DashboardKpiCard
            label="Utilization"
            value={`${kpis?.utilizationPct ?? 0}%`}
            subtitle={`${kpis?.activeBudgets ?? 0} active budgets`}
            icon={LineChart}
            iconClassName="bg-indigo-50 text-indigo-600"
          />
        </DashboardKpiGrid>
      )}

      {noData ? (
        <div className="budget-monitor-card py-16 text-center">
          <BarChart3 className="mx-auto mb-2 h-8 w-8 text-neutral-300" />
          <p className="text-sm font-medium text-neutral-700">
            No active budgets found
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            Approved budgets and their spend will appear here.
          </p>
        </div>
      ) : (
        <>
          {/* Row 2 — Monthly Trend (70%) + Supplier Spend (30%) */}
          {isLoading ? (
            <Skeleton className="mb-6 h-80 rounded-xl" />
          ) : (
            <div className="budget-monitor-row-2 mb-6">
              <MonthlyTrend
                data={data?.monthlySpend ?? []}
                currency={currency}
              />
              <SpendPanel
                title="Supplier Spend"
                icon={<Truck className="h-4 w-4 text-primary-600" />}
                buckets={supplierSpend}
                currency={currency}
                limit={8}
                accentClass="bg-primary-500"
              />
            </div>
          )}

          {/* Row 3 — Department (50%) + Cost Center (50%) */}
          {isLoading ? (
            <Skeleton className="mb-6 h-72 rounded-xl" />
          ) : (
            <div className="budget-monitor-row-3 mb-6">
              <SpendPanel
                title="Department Spend"
                icon={<Building2 className="h-4 w-4 text-primary-600" />}
                buckets={deptSpend}
                currency={currency}
                limit={5}
                accentClass="bg-[#1F3A6D]"
              />
              <SpendPanel
                title="Cost Center Spend"
                icon={<Layers className="h-4 w-4 text-primary-600" />}
                buckets={ccSpend}
                currency={currency}
                limit={5}
                accentClass="bg-[#0E7C6E]"
              />
            </div>
          )}

          {/* Filters + per-budget cards */}
          <div className="mb-4 flex flex-wrap gap-2">
            <div className="relative min-w-[180px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <input
                type="text"
                placeholder="Search budgets or departments…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-neutral-200 py-2 pl-9 pr-3 text-sm"
              />
            </div>
            <select
              value={companyFilter}
              onChange={(e) => setCompanyFilter(e.target.value)}
              className="rounded-lg border border-neutral-200 px-3 py-2 text-sm"
            >
              <option value="">All Companies</option>
              {companies.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.company_name ?? c.name}
                </option>
              ))}
            </select>
            <select
              value={fiscalYearFilter}
              onChange={(e) => setFiscalYearFilter(e.target.value)}
              className="rounded-lg border border-neutral-200 px-3 py-2 text-sm"
            >
              <option value="">All Fiscal Years</option>
              {fiscalYears.map((fy) => (
                <option key={fy} value={fy}>
                  {fy}
                </option>
              ))}
            </select>
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="rounded-lg border border-neutral-200 px-3 py-2 text-sm"
            >
              <option value="">All Departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div id="budget-cards">
            {isLoading ? (
              <Skeleton className="h-64 rounded-xl" />
            ) : filtered.length === 0 ? (
              <div className="budget-monitor-card py-12 text-center">
                <p className="text-sm font-medium text-neutral-700">
                  No budgets match the current filters
                </p>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {filtered.map((row) => (
                  <MonitorCard
                    key={row.budgetId}
                    row={row}
                    currency={currency}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SpendPanel({
  title,
  icon,
  buckets,
  currency,
  limit,
  accentClass,
}: {
  title: string;
  icon: React.ReactNode;
  buckets: SpendBucket[];
  currency: string;
  limit: number;
  accentClass: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const sorted = useMemo(
    () => [...buckets].sort((a, b) => b.amount - a.amount),
    [buckets],
  );
  const visible = showAll ? sorted : sorted.slice(0, limit);
  const max = sorted.reduce((m, b) => Math.max(m, b.amount), 0);
  const hasMore = sorted.length > limit;

  return (
    <div className="budget-monitor-card budget-monitor-card--fill flex h-full flex-col">
      <div className="budget-monitor-card__header">
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <h3 className="truncate text-[15px] font-semibold text-[#1E293B]">
            {title}
          </h3>
          {sorted.length > 0 ? (
            <span className="rounded-full bg-[#EEF3FA] px-2 py-0.5 text-[10px] font-bold text-[#1F3A6D]">
              Top {Math.min(limit, sorted.length)}
            </span>
          ) : null}
        </div>
        {hasMore ? (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="shrink-0 text-[12px] font-semibold text-[#1F3A6D] hover:underline"
          >
            {showAll ? "Show less" : "View All →"}
          </button>
        ) : sorted.length > 0 ? (
          <a
            href="#budget-cards"
            className="shrink-0 text-[12px] font-semibold text-[#1F3A6D] no-underline hover:underline"
          >
            View All →
          </a>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <p className="flex flex-1 items-center justify-center py-8 text-center text-xs text-neutral-400">
          No spend recorded
        </p>
      ) : (
        <ul className="budget-spend-list">
          {visible.map((b) => (
            <li key={b.label} className="budget-spend-row">
              <div className="budget-spend-row__meta">
                <span className="budget-spend-row__name" title={b.label}>
                  {b.label}
                </span>
                <span
                  className="budget-spend-row__amount"
                  title={formatCurrencyIn(b.amount, currency)}
                >
                  {formatCurrencyCompactIn(b.amount, currency)}
                </span>
              </div>
              <div className="budget-spend-row__track">
                <div
                  className={`budget-spend-row__bar ${accentClass}`}
                  style={{
                    width: `${max > 0 ? (b.amount / max) * 100 : 0}%`,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MonthlyTrend({
  data,
  currency,
}: {
  data: Array<{ month: string; amount: number }>;
  currency: string;
}) {
  const chartData = useMemo(
    () =>
      data.map((d) => {
        let label = d.month;
        try {
          label = format(parseISO(`${d.month}-01`), "MMM yy");
        } catch {
          /* keep raw */
        }
        return { ...d, label };
      }),
    [data],
  );

  return (
    <div className="budget-monitor-card budget-monitor-card--fill flex h-full flex-col">
      <div className="budget-monitor-card__header">
        <div className="flex items-center gap-2">
          <LineChart className="h-4 w-4 text-primary-600" />
          <h3 className="text-[15px] font-semibold text-[#1E293B]">
            Monthly Spend Trend
          </h3>
        </div>
        <span className="text-[12px] text-[#64748B]">Last 12 months</span>
      </div>

      {chartData.length === 0 ? (
        <p className="flex flex-1 items-center justify-center py-12 text-center text-xs text-neutral-400">
          No invoice spend recorded yet
        </p>
      ) : (
        <div className="min-h-0 flex-1 px-1 pb-1 pt-2">
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart
              data={chartData}
              margin={{ top: 12, right: 12, left: 0, bottom: 4 }}
            >
              <defs>
                <linearGradient id="budgetMonitorFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1F3A6D" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#1F3A6D" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#EEF2F7" vertical={false} strokeDasharray="3 6" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "#98A2B3" }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                width={52}
                tick={{ fontSize: 10, fill: "#98A2B3" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) =>
                  formatCurrencyCompactIn(v, currency)
                }
              />
              <Tooltip
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 12,
                  border: "1px solid #E3E6EB",
                  boxShadow: "0 1px 2px rgba(16,24,40,0.04)",
                }}
                formatter={(v: number) => [
                  formatCurrencyIn(v, currency),
                  "Spend",
                ]}
                labelFormatter={(label) => `Month: ${label}`}
              />
              <Area
                type="monotone"
                dataKey="amount"
                stroke="#1F3A6D"
                strokeWidth={2.25}
                fill="url(#budgetMonitorFill)"
                isAnimationActive
                animationDuration={800}
                dot={{ r: 3, fill: "#1F3A6D", strokeWidth: 0 }}
                activeDot={{ r: 5, fill: "#1F3A6D", stroke: "#fff", strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function MonitorCard({
  row,
  currency,
}: {
  row: BudgetMonitorRow;
  currency: string;
}) {
  const barColor =
    row.status === "Exceeded"
      ? "bg-red-500"
      : row.status === "Warning"
        ? "bg-amber-500"
        : "bg-emerald-500";
  const compact = (n: number) => formatCurrencyCompactIn(n, currency);

  return (
    <div className="budget-monitor-card p-5">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <Link
            to={`/budget/detail/${encodeURIComponent(row.budgetId)}`}
            className="text-sm font-bold text-primary-700 no-underline hover:underline"
          >
            {row.budgetId}
          </Link>
          <p className="text-xs text-neutral-500">{row.department}</p>
          <p className="text-[10px] text-neutral-400">
            {row.company} · {row.fiscalYear}
          </p>
        </div>
        <StatusPill status={row.status} />
      </div>
      <div className="mb-2 grid grid-cols-4 gap-1.5 text-center">
        <MiniStat label="Allocated" value={compact(row.allocated)} />
        <MiniStat label="Reserved" value={compact(row.reserved)} />
        <MiniStat label="Consumed" value={compact(row.consumed)} />
        <MiniStat label="Available" value={compact(row.remaining)} />
      </div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-semibold text-neutral-600">Utilization</span>
        <span className="font-bold tabular-nums">{row.utilizationPct}%</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-neutral-100">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${Math.min(row.utilizationPct, 100)}%` }}
        />
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-neutral-50 px-1.5 py-1.5">
      <p className="text-[9px] font-semibold uppercase text-neutral-400">
        {label}
      </p>
      <p
        className="truncate text-[11px] font-bold tabular-nums text-neutral-900"
        title={value}
      >
        {value}
      </p>
    </div>
  );
}

function StatusPill({ status }: { status: BudgetMonitorRow["status"] }) {
  const cls =
    status === "Exceeded"
      ? "bg-red-50 text-red-700"
      : status === "Warning"
        ? "bg-amber-50 text-amber-700"
        : "bg-emerald-50 text-emerald-700";
  const Icon = status === "On Track" ? CheckCircle2 : AlertTriangle;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}
    >
      <Icon className="h-3 w-3" /> {status}
    </span>
  );
}
