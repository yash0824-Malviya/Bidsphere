import { Navigate } from "react-router-dom";

import { useAuthStore } from "../../store/authStore";
import { normalizeAppRole } from "../../config/roles";

/** Legacy /material-requests index — route users to the correct home. */
export default function MaterialRequestDashboardPage() {
  const userRole = useAuthStore((s) => s.user?.role);
  const role = normalizeAppRole(userRole);

  if (role === "warehouse") {
    return <Navigate to="/dashboard" replace />;
  }
  if (role === "procurement" || role === "procurement_team") {
    return <Navigate to="/material-requests/procurement" replace />;
  }
  if (role === "department") {
    return <Navigate to="/dashboard" replace />;
  }
  return <Navigate to="/dashboard" replace />;
}
