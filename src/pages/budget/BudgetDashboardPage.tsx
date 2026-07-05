import FinanceExecutiveDashboard from "../../components/dashboard/FinanceExecutiveDashboard";
import BudgetOverviewDashboard from "../../components/dashboard/BudgetOverviewDashboard";
import { useAuthStore } from "../../store/authStore";

export default function BudgetDashboardPage() {
  const user = useAuthStore((s) => s.user);
  const role = user?.role;

  // Finance Executives own budget creation — keep their creation-focused home.
  if (role === "finance_executive") {
    const greetingName =
      user?.full_name?.split(" ")[0] ?? user?.email?.split("@")[0];
    return <FinanceExecutiveDashboard greetingName={greetingName} />;
  }

  // Finance Managers, Admins and Procurement see the enterprise budget command
  // center (live ERPNext KPIs + budget list).
  return <BudgetOverviewDashboard />;
}
