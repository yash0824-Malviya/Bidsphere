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
 * @deprecated Admin approval gate removed — both Direct and Indirect MRs route
 * to Warehouse. Retained for legacy admin pages that may still list old records.
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

/** Department / Admin may upload & delete department attachments on MR (pre-submit). */
export function canUploadDepartmentAttachments(role: AppRole | undefined): boolean {
  return role === "department" || role === "admin";
}

/** View/download engineering attachments across the procurement lifecycle. */
export function canViewEngineeringAttachments(role: AppRole | undefined): boolean {
  return (
    role === "department" ||
    role === "warehouse" ||
    role === "procurement" ||
    role === "legal" ||
    role === "finance" ||
    role === "finance_executive" ||
    role === "admin" ||
    role === "manufacturing"
  );
}

/** Admin has full attachment control. */
export function canManageAllAttachments(role: AppRole | undefined): boolean {
  return role === "admin";
}

/**
 * Delete rules for engineering attachments (additive UI gate only).
 * - Department: delete before submission only.
 * - Admin: always.
 * - Procurement / Warehouse / Supplier / Legal / Finance: never.
 */
export function canDeleteEngineeringAttachment(
  role: AppRole | undefined,
  _attachment: { source?: string },
  opts: { documentSubmitted: boolean },
): boolean {
  if (role === "admin") return true;
  if (opts.documentSubmitted) return false;
  return role === "department";
}

/** Whether the role may upload on a Material Request that is still a draft. */
export function canEditDepartmentAttachmentsOnMr(
  role: AppRole | undefined,
  opts: { documentSubmitted: boolean },
): boolean {
  if (opts.documentSubmitted) return false;
  return canUploadDepartmentAttachments(role);
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
      // Issued Items module (legacy paths — prefer /department/issued-items/*)
      "/material-requests/issued-items",
      "/material-requests/receipts",
    ];
    if (allowed.some((p) => path === p || path.startsWith(`${p}/`))) return true;
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
