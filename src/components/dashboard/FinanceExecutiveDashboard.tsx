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

const STATUS_COLORS: Record<string, string> = {
  Draft: "#94a3b8",
  Submitted: "#f59e0b",
  Approved: "#22c55e",
  Active: "#059669",
  Rejected: "#ef4444",
  Cancelled: "#cbd5e1",
};

const STATUS_TONE: Record<string, string> = {
  Draft: "bg-slate-100 text-slate-700 border-slate-200",
  Submitted: "bg-amber-50 text-amber-700 border-amber-200",
  Approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Active: "bg-emerald-50 text-emerald-800 border-emerald-300 font-semibold",
  Rejected: "bg-rose-50 text-rose-700 border-rose-200",
  Cancelled: "bg-slate-100 text-slate-500 border-slate-200",
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

function computeExecutiveStats(budgets: BudgetListItem[]): ExecutiveStats {
  const draftCount = budgets.filter((b) => b.status === "Draft").length;
  const submittedCount = budgets.filter((b) => b.status === "Submitted").length;
  const approvedCount = budgets.filter(
    (b) => b.status === "Approved" || b.status === "Active"
  ).length;
  const rejectedCount = budgets.filter((b) => b.status === "Rejected").length;
  const totalApprovedBudget = budgets
    .filter((b) => b.status === "Approved" || b.status === "Active")
    .reduce((s, b) => s + (b.budget_amount || 0), 0);

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
    .sort((a, b) => (b.modified || "").localeCompare(a.modified || ""))
    .slice(0, 6)
    .map((b) => ({
      id: b.name,
      budgetName: b.name,
      label: activityLabel(b.status),
      detail: `${b.cost_center ?? "—"} · ${formatCurrency(b.budget_amount)}`,
      role: activityRole(b.status),
      date: b.modified || b.creation || "",
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

function formatDisplayBudgetAmount(amount: number): { display: string; full: string } {
  const full = formatCurrency(amount);
  if (amount >= 1_000_000_000) {
    return { display: `$${(amount / 1_000_000_000).toFixed(2)}B`, full };
  }
  if (amount >= 10_000_000) {
    return { display: `$${(amount / 1_000_000).toFixed(2)}M`, full };
  }
  return { display: full, full };
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
    "Finance";

  const { data: budgets = [], isLoading } = useQuery<BudgetListItem[]>({
    queryKey: ["executive-all-budgets"],
    queryFn: () => fetchBudgets({ limit: 500 }),
    staleTime: 20_000,
  });

  const stats = useMemo(() => computeExecutiveStats(budgets), [budgets]);
  const totalBudgets = budgets.length;

  const formattedTotalApproved = useMemo(() => {
    return formatDisplayBudgetAmount(stats.totalApprovedBudget);
  }, [stats.totalApprovedBudget]);

  const workflowSteps = [
    { key: "Draft", label: "Draft", icon: FileText },
    { key: "Submitted", label: "Submitted", icon: Send },
    { key: "Approved", label: "Approved", icon: CheckCircle2 },
    { key: "Active", label: "Active", icon: Wallet },
  ] as const;

  return (
    <div className="w-full box-border mx-auto max-w-[1440px] px-4 sm:px-6 md:px-8 py-5 space-y-5">
      {/* ================================================================ */}
      {/* 1. DASHBOARD HEADER                                              */}
      {/* ================================================================ */}
      <div className="flex flex-col justify-between gap-3 border-b border-slate-200/80 pb-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 ring-1 ring-emerald-200/60 shadow-2xs">
            <Wallet className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl leading-tight">
              Welcome back, {displayName} · Live budgets
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Financial budget planning, department allocations and approval pipeline
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/budget/create"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 text-xs font-semibold text-white shadow-xs transition hover:bg-primary-700 no-underline"
          >
            <Plus className="h-3.5 w-3.5" />
            Create Budget
          </Link>
          <Link
            to="/budget/my-budgets"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 shadow-xs transition hover:bg-slate-50 no-underline"
          >
            <FolderOpen className="h-3.5 w-3.5 text-slate-500" />
            My Budgets
          </Link>
        </div>
      </div>

      {/* ================================================================ */}
      {/* 2. 5 EQUAL-HEIGHT KPI CARDS                                      */}
      {/* ================================================================ */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {/* 1. Draft Budgets */}
        <Link
          to="/budget/my-budgets"
          className="group flex min-h-[132px] h-[135px] flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-sm"
        >
          <div className="flex items-start justify-between gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 leading-tight">
              DRAFT BUDGETS
            </span>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 transition group-hover:bg-slate-200">
              <FileText className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-1">
            <div className="text-[28px] font-bold tabular-nums text-slate-900 leading-none">
              {isLoading ? "—" : stats.draftCount}
            </div>
            <div className="mt-1.5 text-[12px] text-slate-500 truncate">
              Waiting to be submitted
            </div>
          </div>
        </Link>

        {/* 2. Submitted */}
        <Link
          to="/budget/my-budgets"
          className="group flex min-h-[132px] h-[135px] flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs transition hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-sm"
        >
          <div className="flex items-start justify-between gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 leading-tight">
              SUBMITTED
            </span>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 transition group-hover:bg-amber-100">
              <Send className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-1">
            <div className="text-[28px] font-bold tabular-nums text-amber-700 leading-none">
              {isLoading ? "—" : stats.submittedCount}
            </div>
            <div className="mt-1.5 text-[12px] text-slate-500 truncate">
              Awaiting approval
            </div>
          </div>
        </Link>

        {/* 3. Approved */}
        <Link
          to="/budget/my-budgets"
          className="group flex min-h-[132px] h-[135px] flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-sm"
        >
          <div className="flex items-start justify-between gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 leading-tight">
              APPROVED
            </span>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 transition group-hover:bg-emerald-100">
              <CheckCircle2 className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-1">
            <div className="text-[28px] font-bold tabular-nums text-emerald-700 leading-none">
              {isLoading ? "—" : stats.approvedCount}
            </div>
            <div className="mt-1.5 text-[12px] text-slate-500 truncate">
              Approved budgets
            </div>
          </div>
        </Link>

        {/* 4. Rejected */}
        <Link
          to="/budget/my-budgets"
          className="group flex min-h-[132px] h-[135px] flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs transition hover:-translate-y-0.5 hover:border-rose-300 hover:shadow-sm"
        >
          <div className="flex items-start justify-between gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 leading-tight">
              REJECTED
            </span>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600 transition group-hover:bg-rose-100">
              <XCircle className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-1">
            <div className="text-[28px] font-bold tabular-nums text-rose-700 leading-none">
              {isLoading ? "—" : stats.rejectedCount}
            </div>
            <div className="mt-1.5 text-[12px] text-slate-500 truncate">
              Rejected budgets
            </div>
          </div>
        </Link>

        {/* 5. Total Approved Budget */}
        <Link
          to="/budget/my-budgets"
          className="group flex min-h-[132px] h-[135px] flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs transition hover:-translate-y-0.5 hover:border-emerald-400 hover:shadow-sm"
          title={formattedTotalApproved.full}
        >
          <div className="flex items-start justify-between gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 leading-tight">
              TOTAL APPROVED
            </span>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 transition group-hover:bg-emerald-100">
              <Wallet className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-1">
            <div className="text-[24px] xl:text-[26px] font-bold tabular-nums text-emerald-800 leading-none truncate">
              {isLoading ? "—" : formattedTotalApproved.display}
            </div>
            <div className="mt-1.5 text-[12px] text-slate-500 truncate">
              Total approved budget
            </div>
          </div>
        </Link>
      </div>

      {/* ================================================================ */}
      {/* 3. RECENT BUDGETS TABLE                                          */}
      {/* ================================================================ */}
      <Panel
        title="RECENT BUDGETS"
        subtitle="Latest 5 budget allocation records from ERPNext"
        action={
          <Link
            to="/budget/my-budgets"
            className="text-xs font-semibold text-primary-600 hover:text-primary-700"
          >
            View all →
          </Link>
        }
      >
        {isLoading ? (
          <div className="space-y-2 p-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-10 w-full rounded" />
            ))}
          </div>
        ) : stats.recentBudgets.length === 0 ? (
          <EmptyPanel
            message="No budgets created yet"
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
          <div className="overflow-x-auto rounded-lg border border-slate-100">
            <table className="w-full text-left text-xs min-w-[700px]">
              <thead className="bg-slate-50/70 border-b border-slate-100">
                <tr className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  <th className="py-2.5 pr-3 pl-3">Budget ID</th>
                  <th className="px-3 py-2.5">Fiscal Year</th>
                  <th className="px-3 py-2.5">Company</th>
                  <th className="px-3 py-2.5">Cost Center</th>
                  <th className="px-3 py-2.5 text-right">Budget Amount</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="py-2.5 pr-3 pl-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {stats.recentBudgets.map((b) => (
                  <tr
                    key={b.name}
                    onClick={() =>
                      navigate(`/budget/detail/${encodeURIComponent(b.name)}`)
                    }
                    className="cursor-pointer transition hover:bg-slate-50/80 h-11"
                  >
                    <td className="py-2.5 pr-3 pl-3 font-mono font-bold text-primary-700">
                      {b.name}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {b.fiscal_year || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {b.company || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 font-medium">
                      {b.cost_center ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right font-bold tabular-nums text-slate-900">
                      {formatCurrency(b.budget_amount)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                          STATUS_TONE[b.status] ?? STATUS_TONE.Draft
                        }`}
                      >
                        {b.status}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 pl-3 text-slate-500">
                      {b.creation ? formatDate(b.creation) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* ================================================================ */}
      {/* 4. BUDGET STATUS CHART & WORKFLOW PROGRESS (2 Columns)           */}
      {/* ================================================================ */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Budget Status Chart */}
        <Panel
          title="BUDGET STATUS CHART"
          subtitle="Distribution across workflow states"
        >
          {isLoading ? (
            <Skeleton className="mx-auto h-44 w-44 rounded-full" />
          ) : stats.chartData.length === 0 ? (
            <EmptyPanel message="No budget data available to chart" />
          ) : (
            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row sm:items-center py-2">
              <div className="h-[180px] w-[180px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={stats.chartData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={48}
                      outerRadius={74}
                      paddingAngle={3}
                    >
                      {stats.chartData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => [value ?? 0, "Count"]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <ul className="flex-1 space-y-2.5 w-full max-w-xs">
                {stats.chartData.map((item) => (
                  <li
                    key={item.name}
                    className="flex items-center justify-between text-xs rounded-md bg-slate-50/80 px-2.5 py-1.5 border border-slate-100"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ background: item.color }}
                      />
                      <span className="font-semibold text-slate-700">{item.name}</span>
                    </span>
                    <span className="font-bold tabular-nums text-slate-900">
                      {item.value}
                      <span className="ml-1 text-[11px] font-normal text-slate-400">
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
          title="WORKFLOW PROGRESS"
          subtitle="Draft → Submitted → Approved → Active"
        >
          {isLoading ? (
            <Skeleton className="h-44 rounded-lg" />
          ) : totalBudgets === 0 ? (
            <EmptyPanel message="Create and submit a budget to track workflow progress" />
          ) : (
            <div className="space-y-3.5 py-1">
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
                      <div className="flex flex-col items-center gap-1">
                        <div
                          className={`flex h-9 w-9 items-center justify-center rounded-full ring-2 transition ${
                            count > 0
                              ? "bg-primary-50 ring-primary-300 text-primary-700 shadow-2xs"
                              : "bg-slate-50 ring-slate-200 text-slate-400"
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                        <span className="text-[11px] font-semibold text-slate-700">
                          {step.label}
                        </span>
                        <span className="text-sm font-bold tabular-nums text-slate-900">
                          {step.key === "Approved" ? stats.approvedCount : count}
                        </span>
                      </div>
                      {!isLast && (
                        <div
                          className={`mx-1 mb-6 h-0.5 flex-1 rounded transition ${
                            count > 0 ? "bg-primary-300" : "bg-slate-200"
                          }`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Pipeline Summary Grid */}
              <div className="rounded-lg bg-slate-50/80 border border-slate-200/70 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  PIPELINE SUMMARY
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <SummaryRow label="In draft" value={stats.draftCount} />
                  <SummaryRow label="Awaiting approval" value={stats.submittedCount} />
                  <SummaryRow label="Approved / active" value={stats.approvedCount} />
                  <SummaryRow label="Rejected" value={stats.rejectedCount} />
                </div>
              </div>

              {stats.submittedCount > 0 && (
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700">
                  <ClipboardList className="h-3.5 w-3.5" />
                  {stats.submittedCount} budget
                  {stats.submittedCount === 1 ? "" : "s"} awaiting Finance Manager approval
                </p>
              )}
            </div>
          )}
        </Panel>
      </div>

      {/* ================================================================ */}
      {/* 5. RECENT ACTIVITY                                               */}
      {/* ================================================================ */}
      <Panel
        title="RECENT ACTIVITY"
        subtitle="Latest budget workflow events and state changes"
      >
        {isLoading ? (
          <Skeleton className="h-36 rounded-lg" />
        ) : stats.recentActivity.length === 0 ? (
          <EmptyPanel message="No budget activity records yet" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {stats.recentActivity.map((item) => (
              <li
                key={`${item.id}-${item.date}`}
                className="flex items-center justify-between gap-3 py-2.5 hover:bg-slate-50/60 px-2 rounded-md transition"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border shadow-2xs"
                    style={{
                      backgroundColor: `${STATUS_COLORS[item.status] ?? "#64748b"}15`,
                      borderColor: `${STATUS_COLORS[item.status] ?? "#64748b"}40`,
                    }}
                  >
                    <Clock
                      className="h-3.5 w-3.5"
                      style={{ color: STATUS_COLORS[item.status] ?? "#64748b" }}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-900 truncate">
                      {item.label}
                    </p>
                    <p className="truncate text-[11px] text-slate-500 mt-0.5">
                      <span className="font-mono font-bold text-primary-700">
                        {item.budgetName}
                      </span>
                      {" · "}
                      <span className="font-medium text-slate-700">
                        {item.role}
                      </span>
                      {" · "}
                      <span>{item.detail}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className="hidden text-[11px] text-slate-400 sm:block font-medium">
                    {formatDateTime(item.date)}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      navigate(`/budget/detail/${encodeURIComponent(item.budgetName)}`)
                    }
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-primary-50 hover:text-primary-700 hover:border-primary-200 transition"
                    title="Open budget details"
                    aria-label={`Open details for ${item.budgetName}`}
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
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
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200/90 bg-white shadow-xs p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 mb-3.5">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900">
            {title}
          </h2>
          {subtitle && (
            <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>
          )}
        </div>
        {action && <div>{action}</div>}
      </div>
      <div>{children}</div>
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
    <div className="py-8 text-center">
      <p className="text-xs text-slate-500">{message}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded bg-white px-2 py-1 border border-slate-100">
      <span className="text-slate-600">{label}</span>
      <span className="font-bold tabular-nums text-slate-900">{value}</span>
    </div>
  );
}
