import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Clock,
  DollarSign,
  PieChart,
  TrendingUp,
  Wallet,
  XCircle,
  Zap,
} from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart as RechartsPie,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { getFinanceManagerDashboard } from "../../api/budget";
import { formatCurrency, formatDateTime } from "../../utils/format";
import DashboardKpiCard, {
  DashboardKpiGrid,
  DashboardKpiSkeleton,
} from "./DashboardKpiCard";

const fmt = (n: number) => formatCurrency(n);

export default function FinanceManagerBudgetDashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["finance-manager-budget-dashboard"],
    queryFn: getFinanceManagerDashboard,
    staleTime: 30_000,
  });

  const kpis = data?.kpis;

  return (
    <div className="-mt-1 space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 ring-1 ring-emerald-100">
            <Wallet className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <p className="text-xs text-neutral-500">
              Budget workflow · Approvals · Utilization · Monitoring
            </p>
          </div>
        </div>
        <Link
          to="/budget/approvals"
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-primary-700 no-underline"
        >
          <ClipboardList className="h-3.5 w-3.5" />
          Budget Approval
          {kpis && kpis.pendingApprovals > 0 && (
            <span className="ml-1 rounded-full bg-white/20 px-1.5 py-px text-[10px]">
              {kpis.pendingApprovals}
            </span>
          )}
        </Link>
      </div>

      {isLoading ? (
        <DashboardKpiSkeleton count={8} />
      ) : kpis ? (
        <>
          <DashboardKpiGrid>
            <DashboardKpiCard icon={Clock} iconClassName="bg-amber-50 text-amber-600" label="Pending Approvals" value={String(kpis.pendingApprovals)} />
            <DashboardKpiCard icon={CheckCircle2} iconClassName="bg-success-50 text-success-600" label="Approved" value={String(kpis.approvedCount)} />
            <DashboardKpiCard icon={Zap} iconClassName="bg-emerald-50 text-emerald-600" label="Active" value={String(kpis.activeCount)} />
            <DashboardKpiCard icon={XCircle} iconClassName="bg-danger-50 text-danger-600" label="Rejected" value={String(kpis.rejectedCount)} />
            <DashboardKpiCard icon={DollarSign} iconClassName="bg-[var(--color-primary-light)] text-[var(--color-primary)]" label="Total Approved" value={fmt(kpis.totalApprovedBudget)} />
            <DashboardKpiCard icon={BarChart3} iconClassName="bg-[var(--color-primary-light)] text-[var(--color-primary)]" label="Utilization" value={`${kpis.utilizationPct}%`} />
            <DashboardKpiCard icon={AlertTriangle} iconClassName="bg-danger-50 text-danger-600" label="Over Budget Depts" value={String(kpis.overBudgetDepartments)} />
            <DashboardKpiCard icon={TrendingUp} iconClassName="bg-amber-50 text-amber-600" label="Expiring Budgets" value={String(kpis.expiringBudgets)} />
          </DashboardKpiGrid>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Department Budget Utilization" icon={BarChart3}>
              {(data?.departmentUtilization.length ?? 0) === 0 ? (
                <EmptyChart message="No active budget utilization data" />
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data!.departmentUtilization.slice(0, 6)} layout="vertical">
                    <XAxis type="number" tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="department" width={90} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v) => fmt(Number(v ?? 0))} />
                    <Bar dataKey="consumed" fill="#059669" name="Actual" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="allocated" fill="#cbd5e1" name="Budget" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Budget vs Actual Spend" icon={TrendingUp}>
              {(data?.budgetVsActual.length ?? 0) === 0 ? (
                <EmptyChart message="No budget vs actual data" />
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data!.budgetVsActual}>
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v) => fmt(Number(v ?? 0))} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="budget" fill="#6366f1" name="Budget" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="actual" fill="#059669" name="Actual" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Monthly Budget Consumption (PO)" icon={PieChart}>
              {(data?.monthlyConsumption.length ?? 0) === 0 ? (
                <EmptyChart message="No PO consumption data available" />
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data!.monthlyConsumption}>
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v) => fmt(Number(v ?? 0))} />
                    <Bar dataKey="amount" fill="#f59e0b" name="PO Value" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Budget Status Distribution" icon={PieChart}>
              {(data?.statusDistribution.length ?? 0) === 0 ? (
                <EmptyChart message="No budgets available" />
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <RechartsPie>
                    <Pie
                      data={data!.statusDistribution}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                    >
                      {data!.statusDistribution.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </RechartsPie>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
                <h3 className="text-sm font-bold text-neutral-900">Recent Activity</h3>
                <Link to="/budget/history" className="text-[11px] font-semibold text-primary-600 no-underline hover:underline">
                  View history
                </Link>
              </div>
              <div className="divide-y divide-neutral-100">
                {data!.recentActivity.length === 0 ? (
                  <p className="px-4 py-8 text-center text-xs text-neutral-500">No budget activity yet</p>
                ) : (
                  data!.recentActivity.map((item) => (
                    <Link
                      key={item.id}
                      to={`/budget/detail/${encodeURIComponent(item.budgetName)}`}
                      className="flex items-start gap-3 px-4 py-3 transition hover:bg-neutral-50 no-underline"
                    >
                      <ActivityIcon status={item.status} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-neutral-900">{item.event}</p>
                        <p className="truncate text-[11px] text-neutral-500">
                          {item.budgetName} · {item.detail}
                        </p>
                        <p className="text-[10px] text-neutral-400">
                          {item.user} · {formatDateTime(item.date)}
                        </p>
                      </div>
                      <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-neutral-300" />
                    </Link>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
              <div className="border-b border-neutral-100 px-4 py-3">
                <h3 className="text-sm font-bold text-neutral-900">Quick Actions</h3>
              </div>
              <div className="divide-y divide-neutral-100">
                <QuickLink to="/budget/approvals" label="Budget Approval" desc={`${kpis.pendingApprovals} pending submission(s)`} />
                <QuickLink to="/budget/monitoring" label="Budget Monitoring" desc="Active budget utilization" />
                <QuickLink to="/budget/plans" label="Budget Plans" desc="All budgets" />
                <QuickLink to="/budget/history" label="Budget History" desc="Workflow audit trail" />
                <QuickLink to="/budget/pending-reviews" label="RFQ Financial Review" desc="RFQ budget validation" />
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function ChartCard({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof BarChart3;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-3">
        <Icon className="h-4 w-4 text-neutral-500" />
        <h3 className="text-sm font-bold text-neutral-900">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-[220px] items-center justify-center text-xs text-neutral-400">{message}</div>
  );
}

function ActivityIcon({ status }: { status: string }) {
  const cls =
    status === "Rejected" || status === "Cancelled"
      ? "bg-danger-50 text-danger-600"
      : status === "Submitted"
        ? "bg-amber-50 text-amber-600"
        : status === "Active" || status === "Approved"
          ? "bg-success-50 text-success-600"
          : "bg-neutral-100 text-neutral-600";
  const Icon =
    status === "Rejected" ? XCircle : status === "Submitted" ? Clock : CheckCircle2;
  return (
    <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${cls}`}>
      <Icon className="h-3.5 w-3.5" />
    </div>
  );
}

function QuickLink({ to, label, desc }: { to: string; label: string; desc: string }) {
  return (
    <Link to={to} className="flex items-center justify-between px-4 py-3 transition hover:bg-neutral-50 no-underline">
      <div>
        <p className="text-xs font-semibold text-neutral-900">{label}</p>
        <p className="text-[10px] text-neutral-500">{desc}</p>
      </div>
      <ArrowRight className="h-3.5 w-3.5 text-neutral-400" />
    </Link>
  );
}
