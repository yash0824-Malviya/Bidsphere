import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileText,
  FolderOpen,
  Plus,
  Send,
  Wallet,
  XCircle,
} from "lucide-react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

import { fetchBudgets, type BudgetListItem } from "../../api/budget";
import type { BudgetWorkflowStatus } from "../../api/erpBudget";
import { Skeleton } from "../Skeleton";
import { useAuthStore } from "../../store/authStore";
import { formatCurrency, formatDate, formatDateTime } from "../../utils/format";
import DashboardKpiCard, {
  DashboardKpiGrid,
  DashboardKpiSkeleton,
} from "./DashboardKpiCard";

const fmt = (n: number) => formatCurrency(n);

const STATUS_COLORS: Record<string, string> = {
  Draft: "#94a3b8",
  Submitted: "#f59e0b",
  Approved: "#22c55e",
  Active: "#059669",
  Rejected: "#ef4444",
  Cancelled: "#cbd5e1",
};

const STATUS_TONE: Record<string, string> = {
  Draft: "bg-neutral-100 text-neutral-700",
  Submitted: "bg-amber-50 text-amber-700",
  Approved: "bg-success-50 text-success-700",
  Active: "bg-emerald-50 text-emerald-700",
  Rejected: "bg-danger-50 text-danger-700",
  Cancelled: "bg-neutral-100 text-neutral-500",
};

interface ExecutiveStats {
  draftCount: number;
  submittedCount: number;
  approvedCount: number;
  rejectedCount: number;
  totalApprovedBudget: number;
  chartData: Array<{ name: string; value: number; color: string }>;
  recentBudgets: BudgetListItem[];
  recentActivity: ActivityItem[];
  workflowCounts: Record<string, number>;
}

interface ActivityItem {
  id: string;
  budgetName: string;
  label: string;
  detail: string;
  role: string;
  date: string;
  status: BudgetWorkflowStatus;
}

/** The role that performs each workflow action (never a raw ERPNext user). */
function activityRole(status: BudgetWorkflowStatus): string {
  switch (status) {
    case "Approved":
    case "Active":
    case "Rejected":
    case "Cancelled":
      return "Finance Manager";
    default:
      return "Finance Executive";
  }
}

function computeExecutiveStats(budgets: BudgetListItem[]): ExecutiveStats {
  const draftCount = budgets.filter((b) => b.status === "Draft").length;
  const submittedCount = budgets.filter((b) => b.status === "Submitted").length;
  const approvedCount = budgets.filter(
    (b) => b.status === "Approved" || b.status === "Active"
  ).length;
  const rejectedCount = budgets.filter((b) => b.status === "Rejected").length;
  const totalApprovedBudget = budgets
    .filter((b) => b.status === "Approved" || b.status === "Active")
    .reduce((s, b) => s + b.budget_amount, 0);

  // Canonical four-state distribution for the doughnut (Approved includes
  // Active budgets, matching the KPI card). Empty buckets are dropped.
  const chartData = [
    { name: "Draft", value: draftCount, color: STATUS_COLORS.Draft },
    { name: "Submitted", value: submittedCount, color: STATUS_COLORS.Submitted },
    { name: "Approved", value: approvedCount, color: STATUS_COLORS.Approved },
    { name: "Rejected", value: rejectedCount, color: STATUS_COLORS.Rejected },
  ].filter((d) => d.value > 0);

  const recentBudgets = [...budgets]
    .sort((a, b) => (b.creation ?? "").localeCompare(a.creation ?? ""))
    .slice(0, 5);

  const recentActivity: ActivityItem[] = [...budgets]
    .sort((a, b) => b.modified.localeCompare(a.modified))
    .slice(0, 8)
    .map((b) => ({
      id: b.name,
      budgetName: b.name,
      label: activityLabel(b.status),
      detail: `${b.cost_center ?? "—"} · ${fmt(b.budget_amount)}`,
      role: activityRole(b.status),
      date: b.modified,
      status: b.status,
    }));

  return {
    draftCount,
    submittedCount,
    approvedCount,
    rejectedCount,
    totalApprovedBudget,
    chartData,
    recentBudgets,
    recentActivity,
    workflowCounts: {
      Draft: draftCount,
      Submitted: submittedCount,
      Approved: budgets.filter((b) => b.status === "Approved").length,
      Active: budgets.filter((b) => b.status === "Active").length,
      Rejected: rejectedCount,
    },
  };
}

function activityLabel(status: BudgetWorkflowStatus): string {
  switch (status) {
    case "Draft":
      return "Budget draft saved";
    case "Submitted":
      return "Submitted for approval";
    case "Approved":
      return "Budget approved";
    case "Active":
      return "Budget active for procurement";
    case "Rejected":
      return "Budget rejected";
    case "Cancelled":
      return "Budget cancelled";
    default:
      return "Budget updated";
  }
}

interface Props {
  greetingName?: string;
}

export default function FinanceExecutiveDashboard({ greetingName }: Props) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const displayName =
    greetingName ??
    user?.full_name?.split(" ")[0] ??
    user?.email?.split("@")[0] ??
    "there";

  // Fetch ALL Budget records visible to the logged-in user. ERPNext applies
  // its own role/permission filtering server-side, so this shows every budget
  // the Finance Executive is allowed to see — not only the ones they created.
  const { data: budgets = [], isLoading } = useQuery<BudgetListItem[]>({
    queryKey: ["executive-all-budgets"],
    queryFn: () => fetchBudgets({ limit: 500 }),
    staleTime: 20_000,
  });

  const stats = useMemo(() => computeExecutiveStats(budgets), [budgets]);
  const totalBudgets = budgets.length;
  const workflowSteps = [
    { key: "Draft", label: "Draft", icon: FileText },
    { key: "Submitted", label: "Submitted", icon: Send },
    { key: "Approved", label: "Approved", icon: CheckCircle2 },
    { key: "Active", label: "Active", icon: Wallet },
  ] as const;

  return (
    <div className="-mt-1 space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 ring-1 ring-emerald-100">
            <Wallet className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <p className="text-xs text-neutral-500">
              Welcome back, {displayName} · Live ERPNext budgets
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/budget/create"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-primary-700 no-underline"
          >
            <Plus className="h-3.5 w-3.5" />
            Create Budget
          </Link>
          <Link
            to="/budget/my-budgets"
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-4 py-2 text-xs font-semibold text-neutral-700 shadow-sm hover:bg-neutral-50 no-underline"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            My Budgets
          </Link>
        </div>
      </div>

      {/* KPI row */}
      {isLoading ? (
        <DashboardKpiSkeleton count={5} />
      ) : (
        <DashboardKpiGrid>
          <DashboardKpiCard
            icon={FileText}
            iconClassName="bg-neutral-50 text-neutral-600"
            label="Draft Budgets"
            value={String(stats.draftCount)}
          />
          <DashboardKpiCard
            icon={Send}
            iconClassName="bg-amber-50 text-amber-600"
            label="Submitted"
            value={String(stats.submittedCount)}
          />
          <DashboardKpiCard
            icon={CheckCircle2}
            iconClassName="bg-success-50 text-success-600"
            label="Approved"
            value={String(stats.approvedCount)}
          />
          <DashboardKpiCard
            icon={XCircle}
            iconClassName="bg-danger-50 text-danger-600"
            label="Rejected"
            value={String(stats.rejectedCount)}
          />
          <DashboardKpiCard
            icon={Wallet}
            iconClassName="bg-emerald-50 text-emerald-600"
            label="Total Approved Budget"
            value={fmt(stats.totalApprovedBudget)}
          />
        </DashboardKpiGrid>
      )}

      {/* Recent Budgets — full-width live ERPNext table */}
      <Panel title="Recent Budgets" subtitle="Latest 5 budget records">
        {isLoading ? (
          <Skeleton className="h-48 rounded-lg" />
        ) : stats.recentBudgets.length === 0 ? (
          <EmptyPanel
            message="No budgets yet"
            action={
              <button
                type="button"
                onClick={() => navigate("/budget/create")}
                className="text-xs font-semibold text-primary-600 hover:underline"
              >
                Create your first budget →
              </button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-neutral-100 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                  <th className="py-2 pr-3">Budget ID</th>
                  <th className="py-2 pr-3">Fiscal Year</th>
                  <th className="py-2 pr-3">Company</th>
                  <th className="py-2 pr-3">Cost Center</th>
                  <th className="py-2 pr-3 text-right">Budget Amount</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50">
                {stats.recentBudgets.map((b) => (
                  <tr
                    key={b.name}
                    onClick={() =>
                      navigate(`/budget/detail/${encodeURIComponent(b.name)}`)
                    }
                    className="cursor-pointer transition hover:bg-neutral-50"
                  >
                    <td className="py-2.5 pr-3 font-semibold text-primary-700">
                      {b.name}
                    </td>
                    <td className="py-2.5 pr-3 text-neutral-600">
                      {b.fiscal_year || "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-neutral-600">
                      {b.company || "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-neutral-600">
                      {b.cost_center ?? "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-bold tabular-nums text-neutral-800">
                      {fmt(b.budget_amount)}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_TONE[b.status] ?? STATUS_TONE.Draft}`}
                      >
                        {b.status}
                      </span>
                    </td>
                    <td className="py-2.5 text-neutral-500">
                      {b.creation ? formatDate(b.creation) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Budget Status Chart */}
        <Panel title="Budget Status Chart" subtitle="Distribution by workflow state">
          {isLoading ? (
            <Skeleton className="mx-auto h-48 w-48 rounded-full" />
          ) : stats.chartData.length === 0 ? (
            <EmptyPanel message="No data to chart yet" />
          ) : (
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
              <div className="h-[200px] w-full max-w-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={stats.chartData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={52}
                      outerRadius={78}
                      paddingAngle={2}
                    >
                      {stats.chartData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => [value ?? 0, "Count"]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="flex-1 space-y-2 pt-2">
                {stats.chartData.map((item) => (
                  <li
                    key={item.name}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: item.color }}
                      />
                      {item.name}
                    </span>
                    <span className="font-bold tabular-nums text-neutral-800">
                      {item.value}
                      <span className="ml-1 font-normal text-neutral-400">
                        ({totalBudgets > 0 ? Math.round((item.value / totalBudgets) * 100) : 0}%)
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        {/* Workflow Progress */}
        <Panel
          title="Workflow Progress"
          subtitle="Draft → Submitted → Approved → Active"
        >
          {isLoading ? (
            <Skeleton className="h-48 rounded-lg" />
          ) : totalBudgets === 0 ? (
            <EmptyPanel message="Submit a budget to track workflow progress" />
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-1">
                {workflowSteps.map((step, idx) => {
                  const count =
                    stats.workflowCounts[step.key] ??
                    (step.key === "Approved"
                      ? stats.workflowCounts.Approved + stats.workflowCounts.Active
                      : 0);
                  const Icon = step.icon;
                  const isLast = idx === workflowSteps.length - 1;
                  return (
                    <div key={step.key} className="flex flex-1 items-center">
                      <div className="flex flex-col items-center gap-1.5">
                        <div
                          className={`flex h-9 w-9 items-center justify-center rounded-full ring-2 ${
                            count > 0
                              ? "bg-primary-50 ring-primary-200 text-primary-700"
                              : "bg-neutral-50 ring-neutral-200 text-neutral-400"
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                        <span className="text-[10px] font-semibold text-neutral-700">
                          {step.label}
                        </span>
                        <span className="text-sm font-bold tabular-nums text-neutral-900">
                          {step.key === "Approved"
                            ? stats.approvedCount
                            : count}
                        </span>
                      </div>
                      {!isLast && (
                        <div
                          className={`mx-1 mb-6 h-0.5 flex-1 rounded ${
                            count > 0 ? "bg-primary-200" : "bg-neutral-200"
                          }`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="rounded-lg bg-neutral-50 px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                  Pipeline summary
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <SummaryRow label="In draft" value={stats.draftCount} />
                  <SummaryRow label="Awaiting approval" value={stats.submittedCount} />
                  <SummaryRow label="Approved / active" value={stats.approvedCount} />
                  <SummaryRow label="Rejected" value={stats.rejectedCount} />
                </div>
              </div>

              {stats.submittedCount > 0 && (
                <p className="flex items-center gap-1.5 text-[11px] text-amber-700">
                  <ClipboardList className="h-3.5 w-3.5" />
                  {stats.submittedCount} budget
                  {stats.submittedCount === 1 ? "" : "s"} pending Finance Manager review
                </p>
              )}
            </div>
          )}
        </Panel>
      </div>

      {/* Recent Activity — full-width live budget events */}
      <Panel title="Recent Activity" subtitle="Latest budget workflow events">
        {isLoading ? (
          <Skeleton className="h-48 rounded-lg" />
        ) : stats.recentActivity.length === 0 ? (
          <EmptyPanel message="No activity yet" />
        ) : (
          <ul className="space-y-0 divide-y divide-neutral-100">
            {stats.recentActivity.map((item) => (
              <li
                key={`${item.id}-${item.date}`}
                className="flex items-center gap-3 py-2.5"
              >
                <div
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                  style={{
                    background: `${STATUS_COLORS[item.status] ?? "#64748b"}20`,
                  }}
                >
                  <Clock
                    className="h-3.5 w-3.5"
                    style={{ color: STATUS_COLORS[item.status] ?? "#64748b" }}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-neutral-900">
                    {item.label}
                  </p>
                  <p className="truncate text-[10px] text-neutral-500">
                    <span className="font-semibold text-primary-700">
                      {item.budgetName}
                    </span>
                    {" · "}
                    <span className="font-medium text-neutral-600">
                      {item.role}
                    </span>
                    {" · "}
                    {item.detail}
                  </p>
                </div>
                <span className="hidden shrink-0 text-[10px] text-neutral-400 sm:block">
                  {formatDateTime(item.date)}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    navigate(`/budget/detail/${encodeURIComponent(item.budgetName)}`)
                  }
                  className="shrink-0 self-center text-neutral-400 hover:text-primary-600"
                >
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="border-b border-neutral-100 px-4 py-3">
        <h3 className="text-xs font-bold text-neutral-900">{title}</h3>
        {subtitle && (
          <p className="text-[10px] text-neutral-500">{subtitle}</p>
        )}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

function EmptyPanel({
  message,
  action,
}: {
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="py-10 text-center">
      <p className="text-xs text-neutral-500">{message}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-neutral-600">{label}</span>
      <span className="font-bold tabular-nums text-neutral-900">{value}</span>
    </div>
  );
}
