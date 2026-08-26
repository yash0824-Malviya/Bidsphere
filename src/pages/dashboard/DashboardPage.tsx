import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";

import { useAuthStore } from "../../store/authStore";
import AdminDashboard from "../../components/dashboard/AdminDashboard";
import DepartmentUserDashboard from "../../components/dashboard/DepartmentUserDashboard";
import type { AppRole } from "../../config/roles";
import { getProcurementDashboardContent } from "./dashboardSelection";

const WarehouseDashboard = lazy(
  () => import("../warehouse/WarehouseDashboardPage"),
);
const ManufacturingDashboard = lazy(
  () => import("../manufacturing/BomManagementPage"),
);
const FinanceExecutiveDashboard = lazy(
  () => import("../budget/BudgetDashboardPage"),
);
const FinanceDashboard = lazy(() => import("../../components/dashboard/FinanceDashboard"));
const LegalDashboard = lazy(() => import("../../components/dashboard/LegalDashboard"));
const EngineerDashboard = lazy(
  () => import("../../components/ecr/dashboards/EngineerDashboard"),
);
const EngineeringManagerDashboard = lazy(
  () => import("../../components/ecr/dashboards/EngineeringManagerDashboard"),
);
const OperationsManagerDashboard = lazy(
  () => import("../../components/ecr/dashboards/OperationsManagerDashboard"),
);
const QualityManagerDashboard = lazy(
  () => import("../../components/ecr/dashboards/QualityManagerDashboard"),
);
const ProgramManagerDashboard = lazy(
  () => import("../../components/ecr/dashboards/ProgramManagerDashboard"),
);
const ProcurementECRDashboard = lazy(
  () => import("../../components/ecr/dashboards/ProcurementECRDashboard"),
);
const ProcurementDashboard = lazy(
  () => import("../../components/dashboard/ProcurementDashboard"),
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
  const procurementDashboardContent = getProcurementDashboardContent(role);

  if (role === "warehouse") {
    return (
      <Suspense fallback={<DashFallback />}>
        <WarehouseDashboard />
      </Suspense>
    );
  }

  if (role === "manufacturing") {
    return (
      <Suspense fallback={<DashFallback />}>
        <ManufacturingDashboard />
      </Suspense>
    );
  }

  if (role === "finance_executive") {
    return (
      <Suspense fallback={<DashFallback />}>
        <FinanceExecutiveDashboard />
      </Suspense>
    );
  }

  if (role === "department") {
    return <DepartmentUserDashboard greetingName={greetingName} />;
  }

  const ecrDashboard =
    role === "engineer" ? <EngineerDashboard />
    : role === "engineering" ? <EngineeringManagerDashboard />
    : role === "operations" ? <OperationsManagerDashboard />
    : role === "quality" ? <QualityManagerDashboard />
    : role === "program_manager" ? <ProgramManagerDashboard />
    : null;

  if (ecrDashboard) {
    return <Suspense fallback={<DashFallback />}>{ecrDashboard}</Suspense>;
  }

  if (procurementDashboardContent === "team-ecr-queue") {
    return (
      <Suspense fallback={<DashFallback />}>
        <ProcurementECRDashboard />
      </Suspense>
    );
  }

  if (procurementDashboardContent === "manager-overview") {
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
