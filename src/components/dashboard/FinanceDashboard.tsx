import { useQuery } from "@tanstack/react-query";

import { getFinanceDashboardMetrics } from "../../api/financeWorkflow";
import {
  getDashboardConfig,
  getExecutiveDashboardLayout,
} from "../../config/dashboardRoles";
import ActionCenter from "./ActionCenter";
import DashboardHeader from "./DashboardHeader";
import FinanceKpiRow from "./FinanceKpiRow";
import FinanceReviewHistoryTable from "../finance/FinanceReviewHistoryTable";
import InvoicesAwaitingCreationTable from "../finance/InvoicesAwaitingCreationTable";

interface Props {
  greetingName: string;
}

/**
 * Finance Manager dashboard — AP command center with RFQ financial review KPIs,
 * payables metrics, GRN voucher queue, and recent review history.
 */
export default function FinanceDashboard({ greetingName }: Props) {
  const config = getDashboardConfig("finance");
  const layout = getExecutiveDashboardLayout("finance");

  const metricsQuery = useQuery({
    queryKey: ["finance-dashboard-metrics"],
    queryFn: getFinanceDashboardMetrics,
    staleTime: 60_000,
    retry: false,
  });

  return (
    <div className="dashboard-stack">
      <DashboardHeader config={config} greetingName={greetingName} />

      <ActionCenter actions={layout.quickActions} />

      <FinanceKpiRow
        kpis={metricsQuery.data ?? null}
        loading={metricsQuery.isLoading}
      />

      <FinanceReviewHistoryTable />

      <InvoicesAwaitingCreationTable limit={8} />
    </div>
  );
}
