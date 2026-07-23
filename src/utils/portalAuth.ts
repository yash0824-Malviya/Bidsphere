/**
 * Portal authentication helpers.
 *
 * Shared `/login` authenticates with ERPNext credentials only.
 * Portal access is decided from the user's ERPNext roles after login.
 * A previous portal session must never block a new login — it is replaced.
 */

import type { AppRole } from "../config/roles";
import { clearSupplierSession, readSupplierSession } from "../hooks/useSupplierSession";
import { AUTH_STORAGE_KEY } from "../store/authStorage";
import { useAuthStore } from "../store/authStore";

export type StaffLoginPortal =
  | "warehouse"
  | "procurement"
  | "department"
  | "finance"
  | "admin";

/** Login surfaces — `staff` is the shared internal login page. */
export type AppPortal = "supplier" | StaffLoginPortal | "staff";

export const PORTAL_LOGIN_PATH: Record<AppPortal, string> = {
  supplier: "/supplier/login",
  warehouse: "/warehouse/login",
  procurement: "/procurement/login",
  department: "/department/login",
  finance: "/login",
  admin: "/login",
  staff: "/login",
};

/** Roles allowed on portal-scoped login pages (shared `/login` accepts any). */
export const STAFF_PORTAL_ROLES: Record<StaffLoginPortal, readonly AppRole[]> = {
  warehouse: ["warehouse"],
  procurement: ["procurement", "procurement_team"],
  department: ["department"],
  finance: ["finance", "finance_executive"],
  admin: ["admin"],
};

const LOGIN_PORTAL_KEY = "bidsphere-login-portal";
const ACTIVE_PORTAL_KEY = "bidsphere-active-portal";

export function setLoginPortalAffinity(portal: AppPortal): void {
  try {
    sessionStorage.setItem(LOGIN_PORTAL_KEY, portal);
  } catch {
    /* ignore */
  }
}

export function getLoginPortalAffinity(): AppPortal | null {
  try {
    const raw = sessionStorage.getItem(LOGIN_PORTAL_KEY);
    if (
      raw === "supplier" ||
      raw === "warehouse" ||
      raw === "procurement" ||
      raw === "department" ||
      raw === "finance" ||
      raw === "admin" ||
      raw === "staff"
    ) {
      return raw;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function clearLoginPortalAffinity(): void {
  try {
    sessionStorage.removeItem(LOGIN_PORTAL_KEY);
  } catch {
    /* ignore */
  }
}

export function setActivePortal(portal: AppPortal): void {
  try {
    sessionStorage.setItem(ACTIVE_PORTAL_KEY, portal);
  } catch {
    /* ignore */
  }
}

export function getActivePortal(): AppPortal | null {
  try {
    const raw = sessionStorage.getItem(ACTIVE_PORTAL_KEY);
    if (
      raw === "supplier" ||
      raw === "warehouse" ||
      raw === "procurement" ||
      raw === "department" ||
      raw === "finance" ||
      raw === "admin" ||
      raw === "staff"
    ) {
      return raw;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function clearActivePortal(): void {
  try {
    sessionStorage.removeItem(ACTIVE_PORTAL_KEY);
  } catch {
    /* ignore */
  }
}

export function staffPortalLabel(portal: StaffLoginPortal | "staff"): string {
  switch (portal) {
    case "warehouse":
      return "Warehouse";
    case "procurement":
      return "Procurement";
    case "department":
      return "Department";
    case "finance":
      return "Finance";
    case "admin":
      return "Admin";
    case "staff":
      return "Internal";
  }
}

/** User-facing denial when ERP roles do not include the requested portal. */
export function portalPermissionDeniedMessage(
  portal: StaffLoginPortal | "staff",
): string {
  if (portal === "staff") {
    return "You do not have permission to access this portal.";
  }
  return `You do not have permission to access the ${staffPortalLabel(portal)} Portal.`;
}

/** Map resolved AppRole → portal name used for session / logging. */
export function portalForRole(role: AppRole | null | undefined): AppPortal | null {
  if (!role) return null;
  switch (role) {
    case "warehouse":
      return "warehouse";
    case "procurement":
    case "procurement_team":
      return "procurement";
    case "department":
      return "department";
    case "finance":
    case "finance_executive":
      return "finance";
    case "admin":
      return "admin";
    default:
      return "staff";
  }
}

export function roleMatchesStaffPortal(
  role: AppRole | null | undefined,
  portal: StaffLoginPortal | "staff",
): boolean {
  if (!role) return false;
  // Shared login accepts every internal role after ERPNext authentication.
  if (portal === "staff") return true;
  if (role === "admin") return true;
  return (STAFF_PORTAL_ROLES[portal] as readonly string[]).includes(role);
}

/** Login URL for the portal that owns a protected path prefix. */
export function resolvePortalLoginForPath(pathname: string): string {
  const path = pathname.split("?")[0] || "/";
  if (path === "/supplier" || path.startsWith("/supplier/")) {
    return PORTAL_LOGIN_PATH.supplier;
  }
  if (path === "/warehouse" || path.startsWith("/warehouse/")) {
    return PORTAL_LOGIN_PATH.warehouse;
  }
  if (path === "/department" || path.startsWith("/department/")) {
    return PORTAL_LOGIN_PATH.department;
  }
  if (path === "/procurement" || path.startsWith("/procurement/")) {
    return PORTAL_LOGIN_PATH.procurement;
  }
  return PORTAL_LOGIN_PATH.staff;
}

/** Detect active auth material for diagnostics (never logs secrets). */
export function detectAuthSource(): string {
  if (typeof window === "undefined") return "none";
  const sources: string[] = [];
  try {
    if (
      localStorage.getItem(AUTH_STORAGE_KEY) ||
      sessionStorage.getItem(AUTH_STORAGE_KEY)
    ) {
      sources.push("storage:inteva-auth");
    }
    if (
      sessionStorage.getItem("bidsphere-access-token") ||
      localStorage.getItem("bidsphere-access-token-remember")
    ) {
      sources.push("storage:bidsphere-access-token");
    }
    if (sessionStorage.getItem("bidsphere-supplier-access-token")) {
      sources.push("storage:bidsphere-supplier-access-token");
    }
    if (sessionStorage.getItem("supplier_session")) {
      sources.push("sessionStorage:supplier_session");
    }
    if (/(?:^|;\s*)sid=/.test(document.cookie || "")) {
      sources.push("cookie:sid");
    }
  } catch {
    /* ignore */
  }
  return sources.length ? sources.join(" + ") : "none";
}

export function logPortalAuthDecision(details: {
  username?: string | null;
  requestedPortal?: string | null;
  erpRoles?: string[] | null;
  previousPortal?: string | null;
  newPortal?: string | null;
  redirectTarget?: string | null;
  /** @deprecated prefer redirectTarget */
  redirectDestination?: string;
  currentUrl?: string;
  currentRole?: string | null;
  authSource?: string;
  reason: string;
}): void {
  // eslint-disable-next-line no-console
  console.info("[PortalAuth]", {
    username: details.username ?? null,
    requestedPortal: details.requestedPortal ?? null,
    erpRoles: details.erpRoles ?? null,
    previousPortal: details.previousPortal ?? getActivePortal(),
    newPortal: details.newPortal ?? null,
    redirectTarget:
      details.redirectTarget ?? details.redirectDestination ?? null,
    currentUrl: details.currentUrl ?? null,
    currentRole: details.currentRole ?? null,
    authSource: details.authSource ?? detectAuthSource(),
    reason: details.reason,
  });
}

/**
 * Replace any existing staff session so a new portal login can proceed.
 * Does not toast — previous portal must not block credential entry.
 */
export function replacePreviousStaffSession(reason: string): {
  previousPortal: AppPortal | null;
  previousRole: AppRole | null;
  previousUsername: string | null;
} {
  const state = useAuthStore.getState();
  const previousRole = (state.user?.role as AppRole | undefined) ?? null;
  const previousUsername = state.user?.name ?? state.user?.email ?? null;
  const previousPortal = getActivePortal() ?? portalForRole(previousRole);

  if (state.isAuthenticated || state.mfaPending || state.user) {
    logPortalAuthDecision({
      username: previousUsername,
      previousPortal,
      newPortal: null,
      currentRole: previousRole,
      reason,
    });
    state.clearSession();
  }

  clearLoginPortalAffinity();
  clearActivePortal();
  return { previousPortal, previousRole, previousUsername };
}

/** Clear supplier session when entering an internal portal (silent replace). */
export function replacePreviousSupplierSession(reason: string): boolean {
  if (!hasActiveSupplierSession()) return false;
  const session = readSupplierSession();
  logPortalAuthDecision({
    username:
      session?.portalUser ?? session?.companyName ?? session?.supplierName ?? null,
    previousPortal: "supplier",
    newPortal: null,
    currentRole: "supplier",
    reason,
  });
  clearSupplierSession();
  return true;
}

/** @deprecated Use replacePreviousStaffSession — kept for call-site compatibility. */
export function clearStaffSessionForPortalMismatch(details: {
  currentUrl: string;
  redirectDestination: string;
  reason: string;
}): void {
  replacePreviousStaffSession(details.reason);
  logPortalAuthDecision({
    currentUrl: details.currentUrl,
    redirectTarget: details.redirectDestination,
    reason: details.reason,
  });
}

/** @deprecated Use replacePreviousSupplierSession. */
export function clearSupplierSessionForPortalMismatch(details: {
  currentUrl: string;
  redirectDestination: string;
  reason: string;
}): void {
  replacePreviousSupplierSession(details.reason);
  logPortalAuthDecision({
    currentUrl: details.currentUrl,
    redirectTarget: details.redirectDestination,
    reason: details.reason,
  });
}

export function hasActiveSupplierSession(): boolean {
  return !!readSupplierSession()?.loggedIn;
}
