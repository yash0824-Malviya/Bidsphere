import { useLayoutEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ClipboardList,
  Gauge,
  Layers,
  PiggyBank,
  Plus,
  TrendingDown,
  Wallet,
  XCircle,
} from "lucide-react";

import {
  getBudgetDashboard,
  type BudgetDashboardRow,
  type BudgetHealth,
} from "../../api/budgetDashboard";
import { Skeleton } from "../Skeleton";
import { useOptionalLayout } from "../../contexts/LayoutContext";
import { useAuthStore } from "../../store/authStore";
import { formatCurrencyCompactIn, formatCurrencyIn } from "../../utils/format";

const HEALTH_STYLES: Record<BudgetHealth, string> = {
  Available: "bg-emerald-100 text-emerald-700",
  "Near Limit": "bg-amber-100 text-amber-700",
  Exceeded: "bg-red-100 text-red-700",
};

const BAR_STYLES: Record<BudgetHealth, string> = {
  Available: "bg-emerald-500",
  "Near Limit": "bg-amber-500",
  Exceeded: "bg-red-500",
};

export default function BudgetOverviewDashboard() {
  const layout = useOptionalLayout();
  const role = useAuthStore((s) => s.user?.role);
  const canCreate = role === "finance_executive";
  const canApprove = role === "finance" || role === "admin";

  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["budget-dashboard"],
    queryFn: getBudgetDashboard,
    staleTime: 30_000,
    retry: false,
  });

  const currency = data?.currency ?? "USD";
  const kpis = data?.kpis;

  const kpiCards: Array<{
    key: string;
    label: string;
    value: string;
    icon: LucideIcon;
    accent: string;
  }> = [
    {
      key: "total",
      label: "Total Budget",
      value: kpis ? formatCurrencyCompactIn(kpis.totalBudget, currency) : "—",
      icon: Wallet,
      accent: "bg-primary-50 text-primary-600",
    },
    {
      key: "reserved",
      label: "Reserved Budget",
      value: kpis ? formatCurrencyCompactIn(kpis.reservedBudget, currency) : "—",
      icon: ClipboardList,
      accent: "bg-indigo-50 text-indigo-600",
    },
    {
      key: "consumed",
      label: "Consumed Budget",
      value: kpis ? formatCurrencyCompactIn(kpis.consumedBudget, currency) : "—",
      icon: TrendingDown,
      accent: "bg-blue-50 text-blue-600",
    },
    {
      key: "available",
      label: "Available Budget",
      value: kpis ? formatCurrencyCompactIn(kpis.availableBudget, currency) : "—",
      icon: PiggyBank,
      accent: "bg-emerald-50 text-emerald-600",
    },
    {
      key: "utilization",
      label: "Budget Utilization",
      value: kpis ? `${kpis.utilizationPct}%` : "—",
      icon: Gauge,
      accent: "bg-violet-50 text-violet-600",
    },
    {
      key: "active",
      label: "Active Budgets",
      value: kpis ? String(kpis.activeBudgets) : "—",
      icon: Layers,
      accent: "bg-primary-50 text-primary-600",
    },
    {
      key: "exceeded",
      label: "Budget Exceeded",
      value: kpis ? String(kpis.exceededCount) : "—",
      icon: XCircle,
      accent: "bg-red-50 text-red-600",
    },
    {
      key: "near",
      label: "Near Limit (>80%)",
      value: kpis ? String(kpis.nearLimitCount) : "—",
      icon: AlertTriangle,
      accent: "bg-amber-50 text-amber-600",
    },
  ];

  return (
    <div className="dashboard-stack">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="page-subtitle">
            Live budget allocation, consumption and utilization
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canApprove && (
            <Link to="/budget/approvals" className="btn-secondary px-3 py-2 text-sm">
              <ClipboardList className="h-4 w-4" />
              Approvals
            </Link>
          )}
          {canApprove && (
            <Link to="/budget/monitoring" className="btn-secondary px-3 py-2 text-sm">
              <Gauge className="h-4 w-4" />
              Monitoring
            </Link>
          )}
          {canCreate && (
            <Link to="/budget/create" className="btn-primary px-3.5 py-2 text-sm">
              <Plus className="h-4 w-4" />
              New Budget
            </Link>
          )}
        </div>
      </div>

      {/* Section 1 — Executive KPI cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[78px] rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
          {kpiCards.map((c) => {
            const Icon = c.icon;
            return (
              <div
                key={c.key}
                className="rounded-xl border border-neutral-200/80 bg-white px-3.5 py-3 shadow-sm"
              >
                <div className="flex items-center justify-between gap-1">
                  <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                    {c.label}
                  </p>
                  <span
                    className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md ${c.accent}`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                </div>
                <p className="mt-1.5 text-lg font-bold leading-none tabular-nums text-neutral-900">
                  {c.value}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Section 2 — Budget list */}
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 px-4 py-3">
          <div>
            <h2 className="text-base font-bold text-neutral-900">Budgets</h2>
            <p className="text-xs text-neutral-500">
              Allocation vs consumption per budget
            </p>
          </div>
          <Link
            to="/budget/plans"
            className="text-xs font-semibold text-primary-600 no-underline hover:underline"
          >
            View all budgets
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold">Budget</th>
                <th className="px-4 py-2.5 text-left font-semibold">Company</th>
                <th className="px-4 py-2.5 text-left font-semibold">Department</th>
                <th className="px-4 py-2.5 text-left font-semibold">Cost Center</th>
                <th className="px-4 py-2.5 text-left font-semibold">Fiscal Year</th>
                <th className="px-4 py-2.5 text-right font-semibold">Allocated</th>
                <th className="px-4 py-2.5 text-right font-semibold">Reserved</th>
                <th className="px-4 py-2.5 text-right font-semibold">Consumed</th>
                <th className="px-4 py-2.5 text-right font-semibold">Available</th>
                <th className="px-4 py-2.5 text-left font-semibold">Utilization</th>
                <th className="px-4 py-2.5 text-left font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={11} className="px-4 py-2">
                      <Skeleton className="h-6 w-full rounded" />
                    </td>
                  </tr>
                ))
              ) : isError || !data?.hasBudgets ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center">
                    <Wallet className="mx-auto mb-2 h-8 w-8 text-neutral-300" />
                    <p className="text-sm font-semibold text-neutral-600">
                      No Active Budget Found
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-400">
                      Approved or active budgets will appear here.
                    </p>
                  </td>
                </tr>
              ) : (
                data.rows.map((row) => (
                  <BudgetRow key={row.name} row={row} currency={currency} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function BudgetRow({
  row,
  currency,
}: {
  row: BudgetDashboardRow;
  currency: string;
}) {
  return (
    <tr className="hover:bg-neutral-50">
      <td className="whitespace-nowrap px-4 py-2.5">
        <Link
          to={`/budget/detail/${encodeURIComponent(row.name)}`}
          className="font-semibold text-primary-600 no-underline hover:underline"
        >
          {row.name}
        </Link>
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-neutral-700">
        {row.company}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-neutral-700">
        {row.department}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-neutral-600">
        {row.costCenter}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-neutral-600">
        {row.fiscalYear}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-right font-medium tabular-nums text-neutral-900">
        {formatCurrencyIn(row.allocated, currency)}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-indigo-600">
        {formatCurrencyIn(row.reserved, currency)}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-neutral-700">
        {formatCurrencyIn(row.consumed, currency)}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-right font-medium tabular-nums text-emerald-700">
        {formatCurrencyIn(row.available, currency)}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-neutral-100">
            <div
              className={`h-full rounded-full ${BAR_STYLES[row.health]}`}
              style={{ width: `${Math.min(row.utilizationPct, 100)}%` }}
            />
          </div>
          <span className="tabular-nums text-xs font-semibold text-neutral-700">
            {row.utilizationPct}%
          </span>
        </div>
      </td>
      <td className="whitespace-nowrap px-4 py-2.5">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${HEALTH_STYLES[row.health]}`}
        >
          {row.health}
        </span>
      </td>
    </tr>
  );
}
