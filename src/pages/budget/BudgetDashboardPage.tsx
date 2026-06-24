import { useLayoutEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  DollarSign,
  PieChart,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { getBudgetKpis, getDeptMonitoring } from "../../api/budget";
import type { BudgetKpis, DeptMonitorRow } from "../../api/budget";
import { Skeleton } from "../../components/Skeleton";
import { useOptionalLayout } from "../../contexts/LayoutContext";
import { useAuthStore } from "../../store/authStore";
import { formatCurrency } from "../../utils/format";

const fmt = (n: number) => formatCurrency(n);

export default function BudgetDashboardPage() {
  const layout = useOptionalLayout();
  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const role = useAuthStore((s) => s.user?.role);
  const isFinance = role === "finance" || role === "admin";

  const { data: kpis, isLoading } = useQuery<BudgetKpis>({
    queryKey: ["budget-kpis"],
    queryFn: async () => {
      const response = await getBudgetKpis();
      // eslint-disable-next-line no-console
      console.log("Budget Dashboard Response", response);
      return response;
    },
    staleTime: 30_000,
  });

  const { data: monitoring = [] } = useQuery<DeptMonitorRow[]>({
    queryKey: ["budget-monitoring-summary"],
    queryFn: getDeptMonitoring,
    staleTime: 30_000,
  });

  const exceeded = monitoring.filter((r) => r.status === "Exceeded");
  const warnings = monitoring.filter((r) => r.status === "Warning");

  return (
    <div className="-mt-1">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50">
            <Wallet className="h-4 w-4 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-neutral-900">Budget Dashboard</h1>
            <p className="text-[10px] text-neutral-500">Financial oversight &middot; Budget utilization &middot; Department tracking</p>
          </div>
        </div>
        {isFinance && (
          <Link to="/budget/plans" className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-primary-700 no-underline">
            <ClipboardList className="h-3 w-3" /> Manage Plans
          </Link>
        )}
      </div>

      {/* KPI row */}
      {isLoading ? (
        <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
        </div>
      ) : kpis ? (
        <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <KpiCard icon={DollarSign} iconBg="bg-emerald-50" iconColor="text-emerald-600" label="Total Budget" value={fmt(kpis.totalBudget)} />
          <KpiCard icon={TrendingUp} iconBg="bg-blue-50" iconColor="text-blue-600" label="Consumed Budget" value={fmt(kpis.consumedBudget)} sub={`${kpis.utilizationPct}% used`} />
          <KpiCard icon={PieChart} iconBg="bg-amber-50" iconColor="text-amber-600" label="Remaining Budget" value={fmt(kpis.remainingBudget)} />
          <KpiCard icon={BarChart3} iconBg="bg-violet-50" iconColor="text-violet-600" label="Utilization" value={`${kpis.utilizationPct}%`} sub={`${kpis.activePlans} active plans`} />
        </div>
      ) : null}

      {/* Consumption breakdown */}
      {kpis && (
        <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-3">
          <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-sm">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-neutral-400">Approved RFQ Commitments</p>
            <p className="text-sm font-bold tabular-nums text-neutral-900">{fmt(kpis.approvedRfqValue)}</p>
          </div>
          <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-sm">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-neutral-400">Submitted PO Value</p>
            <p className="text-sm font-bold tabular-nums text-neutral-900">{fmt(kpis.approvedPoValue)}</p>
          </div>
          <div className="col-span-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 shadow-sm lg:col-span-1">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-neutral-400">Formula</p>
            <p className="text-[10px] text-neutral-600">Remaining = Total − RFQ − PO</p>
          </div>
        </div>
      )}

      {/* Utilization bar */}
      {kpis && (
        <div className="mb-3 rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="font-semibold text-neutral-700">Overall Budget Utilization</span>
            <span className="font-bold text-neutral-900">{kpis.utilizationPct}%</span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-neutral-100">
            <div
              className={`h-full rounded-full transition-all ${
                kpis.utilizationPct >= 100 ? "bg-red-500" : kpis.utilizationPct >= 80 ? "bg-amber-500" : "bg-emerald-500"
              }`}
              style={{ width: `${Math.min(kpis.utilizationPct, 100)}%` }}
            />
          </div>
        </div>
      )}

      <div className="grid gap-2 lg:grid-cols-2">
        {/* Alerts */}
        <div className="rounded-lg border border-neutral-200 bg-white shadow-sm">
          <div className="border-b border-neutral-100 px-3 py-2">
            <h3 className="text-xs font-bold text-neutral-900">Budget Alerts</h3>
          </div>
          <div className="divide-y divide-neutral-100 px-3">
            {exceeded.length === 0 && warnings.length === 0 ? (
              <div className="py-6 text-center">
                <CheckCircle2 className="mx-auto mb-1 h-6 w-6 text-emerald-400" />
                <p className="text-xs font-medium text-neutral-600">All budgets on track</p>
              </div>
            ) : (
              <>
                {exceeded.map((d) => (
                  <div key={d.department} className="flex items-center gap-2 py-2">
                    <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-red-500" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-red-700">{d.department} — Budget Exceeded</p>
                      <p className="text-[10px] text-neutral-500">Over by {fmt(d.consumed - d.allocated)}</p>
                    </div>
                    <span className="rounded bg-red-50 px-1.5 py-px text-[10px] font-bold text-red-700">{d.utilizationPct}%</span>
                  </div>
                ))}
                {warnings.map((d) => (
                  <div key={d.department} className="flex items-center gap-2 py-2">
                    <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-amber-700">{d.department} — High Utilization</p>
                      <p className="text-[10px] text-neutral-500">{fmt(d.remaining)} remaining</p>
                    </div>
                    <span className="rounded bg-amber-50 px-1.5 py-px text-[10px] font-bold text-amber-700">{d.utilizationPct}%</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        {/* Quick links */}
        <div className="rounded-lg border border-neutral-200 bg-white shadow-sm">
          <div className="border-b border-neutral-100 px-3 py-2">
            <h3 className="text-xs font-bold text-neutral-900">Quick Actions</h3>
          </div>
          <div className="divide-y divide-neutral-100">
            <QuickLink to="/budget/monitoring" label="Budget Monitoring" desc="Department-level utilization tracking" />
            {isFinance && <QuickLink to="/budget/plans" label="Budget Plans" desc="Create and manage budget allocations" />}
            {isFinance && <QuickLink to="/budget/approvals" label="Budget Approvals" desc={`${kpis?.pendingApprovals ?? 0} pending override requests`} />}
            <QuickLink to="/budget/pending-reviews" label="RFQ Financial Review" desc="RFQ financial reviews and approvals" />
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ icon: Icon, iconBg, iconColor, label, value, sub }: {
  icon: typeof DollarSign; iconBg: string; iconColor: string; label: string; value: string; sub?: string;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2.5 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <div className={`flex h-6 w-6 items-center justify-center rounded-md ${iconBg}`}>
          <Icon className={`h-3 w-3 ${iconColor}`} />
        </div>
        <span className="text-[9px] font-semibold uppercase tracking-wider text-neutral-500">{label}</span>
      </div>
      <p className="text-base font-bold text-neutral-900 tabular-nums">{value}</p>
      {sub && <p className="text-[10px] text-neutral-500">{sub}</p>}
    </div>
  );
}

function QuickLink({ to, label, desc }: { to: string; label: string; desc: string }) {
  return (
    <Link to={to} className="flex items-center justify-between px-3 py-2.5 transition-colors hover:bg-neutral-50 no-underline">
      <div>
        <p className="text-xs font-semibold text-neutral-900">{label}</p>
        <p className="text-[10px] text-neutral-500">{desc}</p>
      </div>
      <ArrowRight className="h-3.5 w-3.5 text-neutral-400" />
    </Link>
  );
}
