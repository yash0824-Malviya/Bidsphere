import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { RotateCcw, ClipboardCheck } from "lucide-react";

import {
  FINANCE_DASHBOARD_METRICS_KEY,
  getFinanceDashboardMetrics,
  getOutstandingPayables,
  invoiceOutstandingAmount,
} from "../../api/financeWorkflow";
import { fetchRoleBusinessCases } from "../../api/businessIntake";
import { APPROVAL_WORKFLOW_QUERY_KEY } from "../../api/approvalWorkflow";
import { useVoucherSyncStore } from "../../store/voucherSyncStore";
import { getExecutiveDashboardLayout } from "../../config/dashboardRoles";
import { daysUntil } from "../../utils/upcomingDeliveries";
import FinanceDashboardGrid from "./FinanceDashboardGrid";
import FinanceKpiRow from "./FinanceKpiRow";
import { DASHBOARD_QUERY_OPTIONS } from "../../api/queryPresets";
import FinanceECRDashboard from "../ecr/dashboards/FinanceECRDashboard";
import { clmViewerKey, getClmList } from "../../api/clm";
import FinanceContractQueue from "./FinanceContractQueue";

interface Props {
  greetingName: string;
}

/**
 * Finance Manager Executive Dashboard — AP, Treasury, and Financial Control Center.
 */
export default function FinanceDashboard({ greetingName: _greetingName }: Props) {
  const queryClient = useQueryClient();
  const layout = getExecutiveDashboardLayout("finance");
  const syncVersion = useVoucherSyncStore((s) => s.version);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());

  const metricsQuery = useQuery({
    queryKey: [FINANCE_DASHBOARD_METRICS_KEY, syncVersion],
    queryFn: getFinanceDashboardMetrics,
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const payablesQuery = useQuery({
    queryKey: ["finance-dashboard-payables", syncVersion],
    queryFn: getOutstandingPayables,
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const overdueAmount = useMemo(() => {
    let overdue = 0;
    for (const inv of payablesQuery.data ?? []) {
      const amount = invoiceOutstandingAmount(inv);
      if (amount <= 0) continue;
      const d = daysUntil(inv.due_date);
      if (d != null && d < 0) overdue += amount;
    }
    return overdue;
  }, [payablesQuery.data]);

  const pendingFinanceCasesQuery = useQuery({
    queryKey: ["business-cases-pending-finance", syncVersion],
    queryFn: () => fetchRoleBusinessCases("finance", undefined, { queueType: "actionable" }),
    staleTime: 30_000,
  });
  const pendingFinanceCount = pendingFinanceCasesQuery.data?.length ?? 0;
  const contractsQuery = useQuery({
    queryKey: ["clm", "list", "Contract", false, clmViewerKey()],
    queryFn: () => getClmList("Contract"),
    staleTime: 20_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [FINANCE_DASHBOARD_METRICS_KEY] }),
        queryClient.invalidateQueries({ queryKey: ["finance-dashboard-payables"] }),
        queryClient.invalidateQueries({ queryKey: ["finance-dashboard-analytics"] }),
        queryClient.invalidateQueries({ queryKey: ["finance-dashboard-pos"] }),
        queryClient.invalidateQueries({ queryKey: ["finance-dashboard-payments"] }),
        queryClient.invalidateQueries({ queryKey: ["finance-dashboard-recent-invoices"] }),
        queryClient.invalidateQueries({ queryKey: ["grns-awaiting-invoice"] }),
        queryClient.invalidateQueries({ queryKey: ["grns-awaiting-excluded"] }),
        queryClient.invalidateQueries({ queryKey: [APPROVAL_WORKFLOW_QUERY_KEY] }),
        queryClient.invalidateQueries({ queryKey: ["finance-dashboard-budgets"] }),
        queryClient.invalidateQueries({ queryKey: ["business-cases-pending-finance"] }),
        queryClient.invalidateQueries({ queryKey: ["ecr-dashboard", "finance"] }),
        queryClient.invalidateQueries({ queryKey: ["clm", "list", "Contract"] }),
      ]);
      setLastRefreshedAt(new Date());
    } finally {
      setTimeout(() => setIsRefreshing(false), 450);
    }
  };

  return (
    <div className="dashboard-stack finance-dashboard space-y-5">
      {/* Executive Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200/80 pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Finance Dashboard
            </h1>
            <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-700/10">
              Finance Control Center
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Monitor RFQ approvals, purchase orders, budgets, invoices, payments and financial exposure.
          </p>
        </div>

        <div className="flex items-center gap-3 self-start sm:self-auto">
          <span className="text-xs text-slate-400">
            Last updated:{" "}
            {lastRefreshedAt.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50"
          >
            <RotateCcw
              className={`h-3.5 w-3.5 text-slate-500 ${
                isRefreshing ? "animate-spin text-primary-600" : ""
              }`}
            />
            Refresh
          </button>
        </div>
      </div>

      {/* Actionable Finance Approvals Pending Alert */}
      {pendingFinanceCount > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-amber-200 bg-amber-50/80 p-4 shadow-xs">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
              <ClipboardCheck className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-bold text-amber-950">
                {pendingFinanceCount} Business Case{pendingFinanceCount === 1 ? "" : "s"} Pending Finance Approval
              </p>
              <p className="text-xs text-amber-800">
                Action required: review financial feasibility, ROI, Capex/Opex, and sign off for Legal stage progression.
              </p>
            </div>
          </div>
          <Link
            to="/intake/business-cases"
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-amber-700"
          >
            Review Approvals →
          </Link>
        </div>
      )}

      {/* Top 6 KPI Metric Cards */}
      <FinanceKpiRow
        kpis={metricsQuery.data ?? null}
        overdueAmount={overdueAmount}
        loading={metricsQuery.isLoading}
      />

      {/* Horizontal Quick Actions Strip */}
      {layout.quickActions.length > 0 ? (
        <section className="finance-quick-actions" aria-label="Quick Actions">
          <h2 className="finance-quick-actions__title">Quick Actions</h2>
          <div className="finance-quick-actions__grid">
            {layout.quickActions.map(({ id, label, to, icon: Icon }) => (
              <Link key={id} to={to} className="finance-quick-action">
                <span className="finance-quick-action__icon" aria-hidden>
                  <Icon className="h-5 w-5" />
                </span>
                <span className="finance-quick-action__label">{label}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* Grid of Analytical Panels, Queues, Pipelines & Summary */}
      <FinanceContractQueue records={contractsQuery.data?.records || []} loading={contractsQuery.isLoading} error={contractsQuery.isError ? contractsQuery.error : undefined} />
      <FinanceECRDashboard />
      <FinanceDashboardGrid />
    </div>
  );
}
