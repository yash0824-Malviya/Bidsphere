import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import AccessDenied from "./AccessDenied";

import { canAccessPath, getRoleHome, normalizeAppRole } from "../config/roles";
import { authLog } from "../store/authStorage";
import { useAuthStore } from "../store/authStore";
import { hydrateAccessTokenFromRemember } from "../utils/accessToken";
import { notifyAccessDenied } from "../utils/rbacNavigate";
import {
  detectAuthSource,
  getActivePortal,
  hasActiveSupplierSession,
  logPortalAuthDecision,
  portalForRole,
  PORTAL_LOGIN_PATH,
  replacePreviousSupplierSession,
  resolvePortalLoginForPath,
  setActivePortal,
} from "../utils/portalAuth";

interface Props {
  children?: React.ReactNode;
}

function isWarehousePath(path: string): boolean {
  return path === "/warehouse" || path.startsWith("/warehouse/");
}

function isDepartmentPath(path: string): boolean {
  return path === "/department" || path.startsWith("/department/");
}

function isSupplierPath(path: string): boolean {
  return path === "/supplier" || path.startsWith("/supplier/");
}

function isDepartmentBomPath(path: string): boolean {
  return (
    path === "/department/upload-bom" ||
    path === "/department/temporary-items" ||
    path.startsWith("/department/temporary-items/")
  );
}

/**
 * Guards internal app routes behind authentication and role-based access.
 * Portal boundaries always validate role — never redirect on auth alone.
 * Wrong-portal navigation keeps the session and sends the user to their home.
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

  const path = location.pathname;
  const search = location.search;
  const loginForPath = resolvePortalLoginForPath(path);

  // Supplier session alone must not open an internal portal — replace it, then login.
  if ((!isAuthenticated || !user) && hasActiveSupplierSession()) {
    const key = `supplier→internal:${path}`;
    if (deniedRef.current !== key) {
      deniedRef.current = key;
      replacePreviousSupplierSession(
        "replace-supplier-session-on-internal-route",
      );
      logPortalAuthDecision({
        currentUrl: path,
        previousPortal: "supplier",
        newPortal: null,
        redirectTarget: loginForPath,
        reason: "supplier-session-replaced-on-internal-route",
      });
    }
    return <Navigate to={loginForPath} replace state={{ from: location }} />;
  }

  if (!isAuthenticated || !user) {
    logPortalAuthDecision({
      currentUrl: path,
      currentRole: null,
      redirectTarget: loginForPath,
      authSource: detectAuthSource(),
      reason: "unauthenticated-internal-route",
    });
    authLog("redirect decision", `ProtectedRoute → ${loginForPath}`);
    return <Navigate to={loginForPath} replace state={{ from: location }} />;
  }

  const role = normalizeAppRole(user.role);
  const active = portalForRole(role);
  if (active && getActivePortal() !== active) {
    setActivePortal(active);
  }

  // Staff must never render supplier portal under this guard.
  if (isSupplierPath(path)) {
    logPortalAuthDecision({
      username: user.name || user.email,
      currentUrl: path,
      currentRole: role,
      previousPortal: getActivePortal(),
      newPortal: "supplier",
      redirectTarget: PORTAL_LOGIN_PATH.supplier,
      reason: "staff-session-on-supplier-path",
    });
    return (
      <Navigate
        to={PORTAL_LOGIN_PATH.supplier}
        replace
        state={{ from: location.pathname }}
      />
    );
  }

  // Warehouse / department prefixes: keep session, send user to their own home.
  if (isWarehousePath(path) && role !== "warehouse" && role !== "admin") {
    const home = getRoleHome(role);
    const key = `portal:warehouse:${role}:${path}`;
    if (deniedRef.current !== key) {
      deniedRef.current = key;
      notifyAccessDenied(`${path}${search}`);
      logPortalAuthDecision({
        username: user.name || user.email,
        requestedPortal: "warehouse",
        erpRoles: user.erpnext_roles ?? null,
        previousPortal: getActivePortal(),
        newPortal: portalForRole(role),
        redirectTarget: home,
        currentUrl: path,
        currentRole: role,
        reason: "role-mismatch-warehouse-portal-keep-session",
      });
    }
    return <Navigate to={home} replace />;
  }

  if (isDepartmentPath(path) && role !== "department" && role !== "admin") {
    if (role === "manufacturing" && isDepartmentBomPath(path)) {
      // Master Data / manufacturing may review temp items and upload department BOMs.
    } else {
    const home = getRoleHome(role);
    const key = `portal:department:${role}:${path}`;
    if (deniedRef.current !== key) {
      deniedRef.current = key;
      notifyAccessDenied(`${path}${search}`);
      logPortalAuthDecision({
        username: user.name || user.email,
        requestedPortal: "department",
        erpRoles: user.erpnext_roles ?? null,
        previousPortal: getActivePortal(),
        newPortal: portalForRole(role),
        redirectTarget: home,
        currentUrl: path,
        currentRole: role,
        reason: "role-mismatch-department-portal-keep-session",
      });
    }
    return <Navigate to={home} replace />;
    }
  }

  if (import.meta.env.DEV) {
    authLog("access check", {
      role,
      path,
      search,
      allowed: canAccessPath(role, path, search),
    });
  }

  if (!canAccessPath(role, path, search)) {
    const key = `role:${role}:${path}${search}`;
    if (deniedRef.current !== key) {
      deniedRef.current = key;
      notifyAccessDenied(`${path}${search}`);
      logPortalAuthDecision({
        username: user.name || user.email,
        erpRoles: user.erpnext_roles ?? null,
        previousPortal: getActivePortal(),
        newPortal: portalForRole(role),
        redirectTarget: "(access-denied-ui)",
        currentUrl: `${path}${search}`,
        currentRole: role,
        authSource: detectAuthSource(),
        reason: "rbac-path-denied",
      });
      authLog("access denied", `ProtectedRoute → AccessDenied UI (role=${role}, path=${path})`);
    }
    return <AccessDenied />;
  }

  return <>{children ?? <Outlet />}</>;
}
