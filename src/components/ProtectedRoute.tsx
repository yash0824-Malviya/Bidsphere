import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";

import { canAccessPath, getRoleHome } from "../config/roles";
import { authLog } from "../store/authStorage";
import { useAuthStore } from "../store/authStore";
import { readSupplierSession } from "../hooks/useSupplierSession";
import { hydrateAccessTokenFromRemember } from "../utils/accessToken";
import { notifyAccessDenied } from "../utils/rbacNavigate";

interface Props {
  children?: React.ReactNode;
}

/**
 * Guards internal app routes behind authentication and role-based access.
 * Never renders unauthorized pages — redirects to the role's own dashboard.
 */
export default function ProtectedRoute({ children }: Props) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isVerifying = useAuthStore((s) => s.isVerifying);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const deniedRef = useRef<string | null>(null);

  useEffect(() => {
    hydrateAccessTokenFromRemember();
  }, []);

  if (!hasHydrated || isVerifying) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-neutral-50">
        <div className="flex items-center gap-2 text-sm text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Restoring your session…</span>
        </div>
      </div>
    );
  }

  // Supplier portal session must not open internal procurement/admin URLs
  const supplierSession = readSupplierSession();
  if ((!isAuthenticated || !user) && supplierSession?.loggedIn) {
    const key = `supplier→internal:${location.pathname}`;
    if (deniedRef.current !== key) {
      deniedRef.current = key;
      notifyAccessDenied(location.pathname);
    }
    authLog("redirect decision", "ProtectedRoute → /supplier/dashboard (supplier session)");
    return <Navigate to="/supplier/dashboard" replace />;
  }

  if (!isAuthenticated || !user) {
    authLog("redirect decision", "ProtectedRoute → /login");
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  const role = user.role ?? "procurement";
  const path = location.pathname;
  const search = location.search;

  // Hard block: internal users never render supplier portal under this guard
  if (path === "/supplier" || path.startsWith("/supplier/")) {
    const key = `internal→supplier:${path}`;
    if (deniedRef.current !== key) {
      deniedRef.current = key;
      notifyAccessDenied(path);
    }
    return <Navigate to={getRoleHome(role)} replace />;
  }

  if (!canAccessPath(role, path, search)) {
    const key = `role:${role}:${path}${search}`;
    if (deniedRef.current !== key) {
      deniedRef.current = key;
      notifyAccessDenied(`${path}${search}`);
    }
    authLog("redirect decision", `ProtectedRoute → ${getRoleHome(role)} (RBAC deny)`);
    return <Navigate to={getRoleHome(role)} replace />;
  }

  return <>{children ?? <Outlet />}</>;
}
