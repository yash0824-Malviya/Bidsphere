import { Navigate } from "react-router-dom";

import { useAuthStore } from "../../store/authStore";
import type { AppRole } from "../../config/roles";

/** Legacy /material-requests index — route users to the correct home. */
export default function MaterialRequestDashboardPage() {
  const role = useAuthStore((s) => s.user?.role) as AppRole | undefined;

  if (role === "warehouse") {
    return <Navigate to="/dashboard" replace />;
  }
  if (role === "procurement") {
    return <Navigate to="/material-requests/procurement" replace />;
  }
  if (role === "department") {
    return <Navigate to="/dashboard" replace />;
  }
  return <Navigate to="/dashboard" replace />;
}
