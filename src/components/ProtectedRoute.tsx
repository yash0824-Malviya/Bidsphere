import { Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";

import { canAccessPath, getRoleHome } from "../config/roles";
import { useAuthStore } from "../store/authStore";

interface Props {
  children: React.ReactNode;
}

/**
 * Guards routes behind authentication and role-based access.
 */
export default function ProtectedRoute({ children }: Props) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isVerifying = useAuthStore((s) => s.isVerifying);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  if (isVerifying) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-neutral-50">
        <div className="flex items-center gap-2 text-sm text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Restoring your session…</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  const role = user.role ?? "procurement";
  if (!canAccessPath(role, location.pathname)) {
    return <Navigate to={getRoleHome(role)} replace />;
  }

  return <>{children}</>;
}
