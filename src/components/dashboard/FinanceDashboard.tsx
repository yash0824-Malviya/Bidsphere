import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import {
  FINANCE_DASHBOARD_METRICS_KEY,
  getFinanceDashboardMetrics,
} from "../../api/financeWorkflow";
import { useVoucherSyncStore } from "../../store/voucherSyncStore";
import {
  getDashboardConfig,
  getExecutiveDashboardLayout,
} from "../../config/dashboardRoles";
import DashboardHeader from "./DashboardHeader";
import FinanceDashboardGrid from "./FinanceDashboardGrid";
import FinanceKpiRow from "./FinanceKpiRow";

interface Props {
  greetingName: string;
}

/**
 * Finance Manager dashboard — AP command center with RFQ financial review KPIs,
 * compact quick actions, and a dense enterprise analytics grid.
 */
export default function FinanceDashboard({ greetingName }: Props) {
  const config = getDashboardConfig("finance");
  const layout = getExecutiveDashboardLayout("finance");

  const syncVersion = useVoucherSyncStore((s) => s.version);

  const metricsQuery = useQuery({
    queryKey: [FINANCE_DASHBOARD_METRICS_KEY, syncVersion],
    queryFn: getFinanceDashboardMetrics,
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });

  return (
    <div className="dashboard-stack finance-dashboard">
      <DashboardHeader config={config} greetingName={greetingName} />

      <FinanceKpiRow
        kpis={metricsQuery.data ?? null}
        loading={metricsQuery.isLoading}
      />

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

      <FinanceDashboardGrid />
    </div>
  );
}
