import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { Navigate } from "react-router-dom";

import { useAuthStore } from "../../store/authStore";
import AdminDashboard from "../../components/dashboard/AdminDashboard";
import DepartmentUserDashboard from "../../components/dashboard/DepartmentUserDashboard";
import type { AppRole } from "../../config/roles";

const FinanceDashboard = lazy(() => import("../../components/dashboard/FinanceDashboard"));
const LegalDashboard = lazy(() => import("../../components/dashboard/LegalDashboard"));
const ProcurementDashboard = lazy(() => import("../../components/dashboard/ProcurementDashboard"));
const ProcurementTeamDashboard = lazy(
  () => import("../../components/dashboard/ProcurementTeamDashboard"),
);

function DashFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-primary-600" />
    </div>
  );
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const role: AppRole = user?.role ?? "admin";
  const greetingName =
    user?.full_name?.split(" ")[0] ?? user?.email?.split("@")[0] ?? "there";

  if (role === "warehouse") {
    return <Navigate to="/warehouse/dashboard" replace />;
  }

  if (role === "manufacturing") {
    return <Navigate to="/manufacturing/boms" replace />;
  }

  if (role === "finance_executive") {
    return <Navigate to="/budget" replace />;
  }

  if (role === "department") {
    return <DepartmentUserDashboard greetingName={greetingName} />;
  }

  if (role === "procurement_team") {
    return (
      <Suspense fallback={<DashFallback />}>
        <ProcurementTeamDashboard />
      </Suspense>
    );
  }

  if (role === "procurement") {
    return (
      <Suspense fallback={<DashFallback />}>
        <ProcurementDashboard greetingName={greetingName} />
      </Suspense>
    );
  }

  if (role === "finance") {
    return (
      <Suspense fallback={<DashFallback />}>
        <FinanceDashboard greetingName={greetingName} />
      </Suspense>
    );
  }

  if (role === "legal") {
    return (
      <Suspense fallback={<DashFallback />}>
        <LegalDashboard greetingName={greetingName} />
      </Suspense>
    );
  }

  return <AdminDashboard role={role} greetingName={greetingName} />;
}
