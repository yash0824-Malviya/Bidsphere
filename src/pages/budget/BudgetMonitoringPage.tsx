import { useLayoutEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
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
    if (fiscalYearFilter) list = list.filter((r) => r.fiscalYear === fiscalYearFilter);
    if (deptFilter) list = list.filter((r) => r.department === deptFilter);
    return list;
  }, [rows, search, companyFilter, fiscalYearFilter, deptFilter]);

  const kpis = data?.kpis;

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
    const blob = new Blob([[header, ...csvRows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `budget-monitoring-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const fmt = (n: number) => formatCurrencyIn(n, currency);
  const noData = !isLoading && (!data || !data.hasBudgets);

  return (
    <div>
      <PageHeader
        title="Budget Monitoring"
        description="Live utilization, reservations, and spend analytics for all active ERPNext budgets"
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

      {/* KPI row */}
      {isLoading ? (
        <Skeleton className="mb-4 h-20 rounded-xl" />
      ) : (
        <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
          <KpiCard
            label="Total Budget"
            value={fmt(kpis?.totalBudget ?? 0)}
            icon={<Wallet className="h-4 w-4 text-primary-600" />}
          />
          <KpiCard
            label="Reserved"
            value={fmt(kpis?.reservedBudget ?? 0)}
            hint="Open Purchase Orders"
            icon={<Layers className="h-4 w-4 text-amber-600" />}
          />
          <KpiCard
            label="Consumed"
            value={fmt(kpis?.consumedBudget ?? 0)}
            hint="Purchase Invoices"
            icon={<BarChart3 className="h-4 w-4 text-rose-600" />}
          />
          <KpiCard
            label="Available"
            value={fmt(kpis?.availableBudget ?? 0)}
            icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
          />
          <KpiCard
            label="Utilization"
            value={`${kpis?.utilizationPct ?? 0}%`}
            hint={`${kpis?.activeBudgets ?? 0} active budgets`}
            icon={<LineChart className="h-4 w-4 text-indigo-600" />}
          />
        </div>
      )}

      {noData ? (
        <div className="rounded-xl border border-neutral-200 bg-white py-16 text-center shadow-sm">
          <BarChart3 className="mx-auto mb-2 h-8 w-8 text-neutral-300" />
          <p className="text-sm font-medium text-neutral-700">No active budgets found</p>
          <p className="mt-1 text-xs text-neutral-400">
            Approved ERPNext budgets and their spend will appear here.
          </p>
        </div>
      ) : (
        <>
          {/* Spend breakdowns */}
          {isLoading ? (
            <Skeleton className="mb-4 h-56 rounded-xl" />
          ) : (
            <div className="mb-4 grid gap-3 lg:grid-cols-3">
              <SpendPanel
                title="Department Spend"
                icon={<Building2 className="h-4 w-4 text-primary-600" />}
                buckets={data?.spendByDepartment ?? []}
                currency={currency}
              />
              <SpendPanel
                title="Cost Center Spend"
                icon={<Layers className="h-4 w-4 text-primary-600" />}
                buckets={data?.spendByCostCenter ?? []}
                currency={currency}
              />
              <SpendPanel
                title="Supplier Spend"
                icon={<Truck className="h-4 w-4 text-primary-600" />}
                buckets={data?.spendBySupplier ?? []}
                currency={currency}
              />
            </div>
          )}

          {/* Monthly trend */}
          {!isLoading && (
            <MonthlyTrend data={data?.monthlySpend ?? []} currency={currency} />
          )}

          {/* Filters */}
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

          {/* Per-budget cards */}
          {isLoading ? (
            <Skeleton className="h-64 rounded-xl" />
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-neutral-200 bg-white py-12 text-center shadow-sm">
              <p className="text-sm font-medium text-neutral-700">
                No budgets match the current filters
              </p>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((row) => (
                <MonitorCard key={row.budgetId} row={row} currency={currency} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3 shadow-sm">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
          {label}
        </p>
        {icon}
      </div>
      <p className="text-lg font-bold tabular-nums text-neutral-900">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-neutral-400">{hint}</p>}
    </div>
  );
}

function SpendPanel({
  title,
  icon,
  buckets,
  currency,
}: {
  title: string;
  icon: React.ReactNode;
  buckets: SpendBucket[];
  currency: string;
}) {
  const max = buckets.reduce((m, b) => Math.max(m, b.amount), 0);
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-bold text-neutral-900">{title}</h3>
      </div>
      {buckets.length === 0 ? (
        <p className="py-6 text-center text-xs text-neutral-400">No spend recorded</p>
      ) : (
        <ul className="space-y-2.5">
          {buckets.map((b) => (
            <li key={b.label}>
              <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                <span className="truncate font-medium text-neutral-700" title={b.label}>
                  {b.label}
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-neutral-900">
                  {formatCurrencyCompactIn(b.amount, currency)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
                <div
                  className="h-full rounded-full bg-primary-500"
                  style={{ width: `${max > 0 ? (b.amount / max) * 100 : 0}%` }}
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
  const max = data.reduce((m, d) => Math.max(m, d.amount), 0);
  return (
    <div className="mb-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <LineChart className="h-4 w-4 text-primary-600" />
        <h3 className="text-sm font-bold text-neutral-900">Monthly Spend Trend</h3>
      </div>
      {data.length === 0 ? (
        <p className="py-8 text-center text-xs text-neutral-400">
          No invoice spend recorded yet
        </p>
      ) : (
        <div className="flex items-end gap-2 overflow-x-auto pb-2" style={{ minHeight: 140 }}>
          {data.map((d) => {
            const heightPct = max > 0 ? Math.max((d.amount / max) * 100, 3) : 3;
            let label = d.month;
            try {
              label = format(parseISO(`${d.month}-01`), "MMM yy");
            } catch {
              /* keep raw */
            }
            return (
              <div
                key={d.month}
                className="flex min-w-[44px] flex-1 flex-col items-center gap-1"
              >
                <span className="text-[9px] font-semibold tabular-nums text-neutral-500">
                  {formatCurrencyCompactIn(d.amount, currency)}
                </span>
                <div className="flex h-24 w-full items-end">
                  <div
                    className="w-full rounded-t bg-primary-500/80 transition-all"
                    style={{ height: `${heightPct}%` }}
                    title={`${label}: ${formatCurrencyIn(d.amount, currency)}`}
                  />
                </div>
                <span className="text-[9px] font-medium text-neutral-500">{label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MonitorCard({ row, currency }: { row: BudgetMonitorRow; currency: string }) {
  const barColor =
    row.status === "Exceeded"
      ? "bg-red-500"
      : row.status === "Warning"
        ? "bg-amber-500"
        : "bg-emerald-500";
  const fmt = (n: number) => formatCurrencyIn(n, currency);

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
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
        <MiniStat label="Allocated" value={fmt(row.allocated)} />
        <MiniStat label="Reserved" value={fmt(row.reserved)} />
        <MiniStat label="Consumed" value={fmt(row.consumed)} />
        <MiniStat label="Available" value={fmt(row.remaining)} />
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
      <p className="text-[9px] font-semibold uppercase text-neutral-400">{label}</p>
      <p className="text-[11px] font-bold tabular-nums text-neutral-900">{value}</p>
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
