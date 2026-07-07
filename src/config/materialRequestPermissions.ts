import type { AppRole } from "./roles";

/** Department User — create and submit own material requests. */
export function isDepartmentUser(role: AppRole | undefined): boolean {
  return role === "department";
}

export function canCreateMaterialRequest(role: AppRole | undefined): boolean {
  return role === "department" || role === "admin";
}

/** Warehouse can review, issue stock, forward, reject — not edit item lines. */
export function canReviewMaterialRequest(role: AppRole | undefined): boolean {
  return role === "warehouse" || role === "admin";
}

/**
 * Admin Manager reviews INDIRECT material requests (approve / reject) before
 * they reach Procurement. Only the admin role holds this gate.
 */
export function canReviewIndirectMaterialRequest(
  role: AppRole | undefined,
): boolean {
  return role === "admin";
}

/** Procurement views forwarded MRs and creates RFQ — never creates MRs. */
export function canViewProcurementMaterialRequests(role: AppRole | undefined): boolean {
  return role === "procurement" || role === "admin";
}

export function canCreateRfqFromMR(role: AppRole | undefined): boolean {
  return role === "procurement" || role === "admin";
}

/**
 * Who may delete a Material Request (subject to the Draft-only + no-linkage
 * gates enforced separately in the UI and on the API). Allowed: the owning
 * Department User, Procurement Admin, and System Administrator. Denied to
 * Warehouse, Finance, Legal, and Suppliers.
 */
export function canDeleteMaterialRequest(
  role: AppRole | undefined,
  isOwner: boolean,
): boolean {
  if (role === "admin" || role === "procurement") return true;
  if (role === "department") return isOwner;
  return false;
}

export function canAccessMaterialRequestModule(role: AppRole | undefined): boolean {
  return (
    isDepartmentUser(role) ||
    canReviewMaterialRequest(role) ||
    canViewProcurementMaterialRequests(role) ||
    role === "admin"
  );
}

/** Paths each role may use within /material-requests/* */
export function canAccessMaterialRequestPath(
  role: AppRole,
  pathname: string
): boolean {
  if (role === "admin") return true;

  const path = pathname.split("?")[0];

  if (role === "department") {
    const allowed = [
      "/material-requests",
      "/material-requests/list",
      "/material-requests/new",
    ];
    if (allowed.some((p) => path === p)) return true;
    if (/^\/material-requests\/[^/]+$/.test(path)) {
      return !path.includes("/warehouse") && !path.includes("/procurement");
    }
    return false;
  }

  if (role === "warehouse") {
    if (
      path === "/material-requests/warehouse" ||
      path === "/material-requests/issued"
    ) {
      return true;
    }
    if (/^\/material-requests\/[^/]+$/.test(path)) {
      return (
        !path.endsWith("/new") &&
        !path.includes("/procurement") &&
        !path.includes("/list")
      );
    }
    return path === "/material-requests";
  }

  if (role === "procurement") {
    if (path === "/material-requests/procurement") return true;
    if (/^\/material-requests\/[^/]+$/.test(path)) {
      return (
        !path.endsWith("/new") &&
        !path.includes("/warehouse") &&
        !path.includes("/issued") &&
        !path.includes("/list")
      );
    }
    return false;
  }

  return false;
}
