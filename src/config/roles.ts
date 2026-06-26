import {
  Boxes,
  FileSearch,
  LayoutDashboard,
  Shield,
  ShoppingCart,
  Users,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { NavChild, NavGroup, NavItem } from "../utils/routes";
import { NAV_GROUPS } from "../utils/routes";

/** Application roles — mapped from ERPNext login email or ERPNext roles. */
export type AppRole = "admin" | "procurement" | "finance" | "warehouse" | "legal";

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Administrator",
  procurement: "Procurement Manager",
  finance: "Finance Manager",
  warehouse: "Warehouse Manager",
  legal: "Legal Reviewer",
};

/** Default landing route after login per role. */
export const ROLE_HOME: Record<AppRole, string> = {
  admin: "/admin",
  procurement: "/dashboard",
  finance: "/dashboard",
  warehouse: "/dashboard",
  legal: "/sourcing/legal-reviews",
};

/** Known role users (email → role). Comparison is case-insensitive. */
export const ROLE_USER_EMAILS: Record<string, AppRole> = {
  "admin@netlink.com": "admin",
  "procurement@netlink.com": "procurement",
  "finance@netlink.com": "finance",
  "warehouse@netlink.com": "warehouse",
  "legal@netlink.com": "legal",
};

/**
 * Map ERPNext role names to BidSphere AppRole.
 * Used when resolving roles dynamically from ERPNext user profile.
 */
export const ERPNEXT_ROLE_MAP: Record<string, AppRole> = {
  Administrator: "admin",
  "System Manager": "admin",
  "Procurement Manager": "procurement",
  "Purchase Manager": "procurement",
  "Purchase User": "procurement",
  "Finance Manager": "finance",
  "Accounts Manager": "finance",
  "Accounts User": "finance",
  "Stock Manager": "warehouse",
  "Stock User": "warehouse",
  "Warehouse Manager": "warehouse",
  "Legal Reviewer": "legal",
};

/* ──────────────────────────────────────────────────────────────────────────
 * Centralized role-based navigation registry
 *
 * This is the single source of truth for the application's module access.
 * Both the sidebar (getNavGroupsForRole) and the route guard (canAccessPath)
 * are derived from ROLE_NAV_CONFIG, so visible menus and reachable URLs can
 * never drift apart. To grant/revoke a module for a role, edit the config
 * below — nothing else needs to change.
 * ────────────────────────────────────────────────────────────────────────── */

type NavModuleId =
  | "dashboard"
  | "sourcing"
  | "p2p"
  | "suppliers"
  | "inventory"
  | "budget"
  | "admin-audit";

type P2PChildId =
  | "requisitions"
  | "purchase-orders"
  | "new-po"
  | "grn"
  | "vouchers"
  | "invoices"
  | "payments";

interface P2PChildDef {
  label: string;
  to: string;
  /** Route prefix this child grants access to. */
  access: string;
}

const P2P_CHILD_REGISTRY: Record<P2PChildId, P2PChildDef> = {
  requisitions: {
    label: "Material Requests",
    to: "/p2p/requisitions",
    access: "/p2p/requisitions",
  },
  "purchase-orders": {
    label: "Purchase Orders",
    to: "/p2p/purchase-orders",
    access: "/p2p/purchase-orders",
  },
  "new-po": {
    label: "New PO",
    to: "/p2p/purchase-orders/create",
    access: "/p2p/purchase-orders",
  },
  grn: { label: "GRN", to: "/p2p/grn", access: "/p2p/grn" },
  vouchers: { label: "Vouchers", to: "/p2p/vouchers", access: "/p2p/vouchers" },
  invoices: { label: "Invoices", to: "/p2p/invoices", access: "/p2p/invoices" },
  payments: { label: "Payments", to: "/p2p/payments", access: "/p2p/payments" },
};

const SOURCING_CHILDREN_FULL: NavChild[] = [
  { label: "All RFQs", to: "/sourcing/rfq" },
  { label: "New RFQ", to: "/sourcing/rfq/new" },
  { label: "RFQ Template Library", to: "/sourcing/rfq-templates" },
  { label: "Legal Reviews", to: "/sourcing/legal-reviews" },
];

/** Procurement Managers see RFQ management but NOT Legal Reviews. */
const PROCUREMENT_SOURCING_CHILDREN: NavChild[] = [
  { label: "All RFQs", to: "/sourcing/rfq" },
  { label: "New RFQ", to: "/sourcing/rfq/new" },
  { label: "RFQ Template Library", to: "/sourcing/rfq-templates" },
];

/** Legal Reviewers only see Legal Reviews — no RFQ creation or templates. */
const LEGAL_SOURCING_CHILDREN: NavChild[] = [
  { label: "Legal Reviews", to: "/sourcing/legal-reviews" },
];

const BUDGET_CHILDREN_FINANCE: NavChild[] = [
  { label: "Budget Dashboard", to: "/budget" },
  { label: "RFQ Financial Review", to: "/budget/pending-reviews" },
  { label: "Budget Plans", to: "/budget/plans" },
  { label: "Budget Monitoring", to: "/budget/monitoring" },
  { label: "Budget Approvals", to: "/budget/approvals" },
];

const BUDGET_CHILDREN_READONLY: NavChild[] = [
  { label: "Budget Dashboard", to: "/budget" },
  { label: "Budget Monitoring", to: "/budget/monitoring" },
];

const SUPPLIERS_CHILDREN: NavChild[] = [
  { label: "Supplier Directory", to: "/suppliers" },
  { label: "Supplier Performance", to: "/suppliers?tab=performance" },
];

const MODULE_ICONS: Record<NavModuleId, LucideIcon> = {
  dashboard: LayoutDashboard,
  sourcing: FileSearch,
  p2p: ShoppingCart,
  suppliers: Users,
  inventory: Boxes,
  budget: Wallet,
  "admin-audit": Shield,
};

interface RoleNavConfig {
  /** Ordered top-level modules shown in the sidebar. */
  modules: NavModuleId[];
  /** Ordered P2P Core children (only used when `p2p` is in `modules`). */
  p2pChildren: P2PChildId[];
}

const ROLE_NAV_CONFIG: Record<AppRole, RoleNavConfig> = {
  // Admin — governance, user access, audit, and system administration only.
  admin: {
    modules: ["admin-audit"],
    p2pChildren: [],
  },
  // Procurement Manager — sourcing → PO → GRN → Voucher workflow. Invoices are
  // visible read-only so Procurement can monitor supplier billing.
  procurement: {
    modules: ["dashboard", "sourcing", "p2p", "suppliers", "budget"],
    p2pChildren: ["purchase-orders", "new-po", "vouchers", "invoices"],
  },
  // Warehouse Manager — receiving + inventory. Vouchers are visible read-only
  // so Warehouse can track payment progress for goods they received; all
  // create/manage actions are blocked (Finance-owned).
  warehouse: {
    modules: ["dashboard", "p2p", "inventory"],
    p2pChildren: ["grn", "vouchers"],
  },
  // Finance Manager — payables + budget. GRN access is needed so Finance can
  // open a goods receipt from the "Invoices Awaiting Creation" queue and
  // create the supplier invoice.
  finance: {
    modules: ["dashboard", "p2p", "budget"],
    p2pChildren: ["vouchers", "invoices", "payments", "grn"],
  },
  // Legal Reviewer — sourcing only (Legal Reviews page).
  legal: {
    modules: ["dashboard", "sourcing"],
    p2pChildren: [],
  },
};

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Resolve BidSphere role from ERPNext user profile.
 *
 * Priority:
 * 1. Check if the user's ERPNext roles (fetched from API) map to a known AppRole
 * 2. Check the hardcoded email → role map
 * 3. Fall back to "procurement"
 */
export function resolveRoleFromUser(user: {
  name: string;
  email: string;
  erpnext_roles?: string[];
}): AppRole {
  const name = normalizeEmail(user.name);
  const email = normalizeEmail(user.email);

  if (name === "administrator" || email === "administrator@example.com") {
    return "admin";
  }

  // Try hardcoded email map first (fastest path for known users)
  const emailRole = ROLE_USER_EMAILS[email] ?? ROLE_USER_EMAILS[name];
  if (emailRole) return emailRole;

  // Try resolving from ERPNext roles (supports any new user without code changes)
  if (user.erpnext_roles && user.erpnext_roles.length > 0) {
    const roleFromErp = resolveFromErpNextRoles(user.erpnext_roles);
    if (roleFromErp) {
      // eslint-disable-next-line no-console
      console.log(`[Auth] Resolved role "${roleFromErp}" from ERPNext roles:`, user.erpnext_roles);
      return roleFromErp;
    }
  }

  // eslint-disable-next-line no-console
  console.warn(`[Auth] No role mapping found for "${email}", defaulting to "procurement"`);
  return "procurement";
}

/**
 * Resolve the highest-priority BidSphere role from a list of ERPNext role names.
 * Admin > Legal > Finance > Warehouse > Procurement (priority order).
 */
export function resolveFromErpNextRoles(erpRoles: string[]): AppRole | null {
  const priorityOrder: AppRole[] = ["admin", "legal", "finance", "warehouse", "procurement"];
  const resolved = new Set<AppRole>();

  for (const erpRole of erpRoles) {
    const mapped = ERPNEXT_ROLE_MAP[erpRole];
    if (mapped) resolved.add(mapped);
  }

  if (resolved.size === 0) return null;

  for (const role of priorityOrder) {
    if (resolved.has(role)) return role;
  }

  return null;
}

export function getRoleHome(role: AppRole): string {
  return ROLE_HOME[role];
}

/**
 * Presentation-layer helper: turn a record owner's email into a clean
 * role/title for list and detail views. Raw email addresses are never shown
 * to users — the underlying value stays untouched in the backend.
 *
 * Known role mailboxes map to their title (finance@ → "Finance Manager", etc.);
 * any other authenticated user falls back to "Procurement Manager" since the
 * sourcing module is owned by Procurement.
 */
export function ownerTitleFromEmail(email?: string | null): string {
  if (!email) return "—";
  const role = resolveRoleFromUser({ name: email, email });
  return ROLE_LABELS[role];
}

/* ─── Sidebar generation (dynamic, no hardcoded per-role menus) ─────────── */

function buildP2PChildren(role: AppRole): NavChild[] {
  return ROLE_NAV_CONFIG[role].p2pChildren.map((id) => {
    const def = P2P_CHILD_REGISTRY[id];
    return { label: def.label, to: def.to };
  });
}

function buildNavItem(id: NavModuleId, role: AppRole): NavItem {
  switch (id) {
    case "dashboard":
      return {
        label: "Dashboard",
        to: "/dashboard",
        icon: MODULE_ICONS.dashboard,
      };
    case "sourcing": {
      const sourcingChildren =
        role === "legal"
          ? LEGAL_SOURCING_CHILDREN
          : role === "procurement"
          ? PROCUREMENT_SOURCING_CHILDREN
          : SOURCING_CHILDREN_FULL;
      return {
        label: role === "legal" ? "Legal" : "Sourcing (RFx)",
        to: role === "legal" ? "/sourcing/legal-reviews" : "/sourcing/rfq",
        icon: MODULE_ICONS.sourcing,
        children: sourcingChildren,
      };
    }
    case "p2p":
      return {
        label: "P2P Core",
        to: "/p2p",
        icon: MODULE_ICONS.p2p,
        children: buildP2PChildren(role),
      };
    case "suppliers":
      return {
        label: "Suppliers",
        to: "/suppliers",
        icon: MODULE_ICONS.suppliers,
        children: SUPPLIERS_CHILDREN,
      };
    case "inventory":
      return {
        label: "Inventory",
        to: "/inventory",
        icon: MODULE_ICONS.inventory,
      };
    case "budget":
      return {
        label: "Budget",
        to: "/budget",
        icon: MODULE_ICONS.budget,
        children: role === "finance" || role === "admin"
          ? BUDGET_CHILDREN_FINANCE
          : BUDGET_CHILDREN_READONLY,
      };
    case "admin-audit":
      return {
        label: "Admin",
        to: "/admin",
        icon: MODULE_ICONS["admin-audit"],
        children: [
          { label: "Dashboard", to: "/admin" },
          { label: "Audit Trail", to: "/admin/audit-trail" },
          { label: "Procurement Audit", to: "/admin/procurement-audit" },
          { label: "Access Logs", to: "/admin/access-logs" },
          { label: "User Management", to: "/admin/users" },
          { label: "Role Management", to: "/admin/roles" },
          { label: "Workflow", to: "/admin/workflows" },
          { label: "Procurement", to: "/admin/procurement" },
          { label: "Suppliers", to: "/admin/suppliers" },
          { label: "Inventory", to: "/admin/inventory" },
          { label: "Budget", to: "/admin/budget" },
          { label: "Reports", to: "/admin/reports" },
          { label: "Security Settings", to: "/admin/security-settings" },
          { label: "System Settings", to: "/admin/settings" },
        ],
      };
  }
}

/** Sidebar navigation generated dynamically from the signed-in role. */
export function getNavGroupsForRole(role: AppRole): NavGroup[] {
  const config = ROLE_NAV_CONFIG[role] ?? ROLE_NAV_CONFIG.procurement;

  const mainItems = config.modules.map((id) => buildNavItem(id, role));

  // The Support group (Help) is shared by every role.
  const supportGroup = NAV_GROUPS.find((g) => g.label === "Support");

  return [
    { label: "", items: mainItems },
    ...(supportGroup ? [supportGroup] : []),
  ];
}

/* ─── Access control (derived from the SAME config) ─────────────────────── */

/** Route prefixes a role may access. Derived from ROLE_NAV_CONFIG. */
function getAccessPrefixesForRole(role: AppRole): string[] {
  const config = ROLE_NAV_CONFIG[role] ?? ROLE_NAV_CONFIG.procurement;
  // Dashboard + Support are reachable for every authenticated role.
  const prefixes = new Set<string>(["/dashboard", "/support", "/notifications"]);

  for (const id of config.modules) {
    switch (id) {
      case "dashboard":
        break;
      case "sourcing":
        prefixes.add("/sourcing");
        prefixes.add("/legal");
        break;
      case "suppliers":
        prefixes.add("/suppliers");
        break;
      case "inventory":
        prefixes.add("/inventory");
        break;
      case "budget":
        prefixes.add("/budget");
        prefixes.add("/finance");
        break;
      case "admin-audit":
        prefixes.add("/admin");
        break;
      case "p2p":
        // Only the role's explicitly granted P2P children are reachable —
        // we never add a broad "/p2p" prefix that would leak sibling pages.
        for (const childId of config.p2pChildren) {
          prefixes.add(P2P_CHILD_REGISTRY[childId].access);
        }
        break;
    }
  }

  return [...prefixes];
}

const hasP2PModule = (role: AppRole): boolean =>
  ROLE_NAV_CONFIG[role]?.modules.includes("p2p") ?? false;

/**
 * GRN (Goods Receipt Note) creation is a Warehouse operation.
 *
 * Business rule: the Warehouse team physically receives goods and is the only
 * team that may create / submit a GRN. Procurement (and Finance) only monitor
 * receipt progress in read-only mode — they can view GRN records and track
 * status, but never create, edit, submit, or delete them. Admin retains full
 * access for support purposes.
 */
export function canCreateGRN(role: AppRole | undefined): boolean {
  return role === "warehouse" || role === "admin";
}

/**
 * Voucher ownership is exclusively a Finance operation.
 *
 * Business rule: only Finance (and Admin for support) may create, edit, submit,
 * send, release, or confirm vouchers. Procurement and Warehouse can view
 * vouchers in read-only mode — they monitor status and linked PO/GRN data, but
 * can never mutate a voucher. This single helper backs every voucher gate:
 * sidebar/button visibility, route access, and the API-level guard.
 */
export function canManageVouchers(role: AppRole | undefined): boolean {
  return role === "finance" || role === "admin";
}

/** `/p2p/purchase-orders/:poId` — not list, create, new, or convert routes. */
function isPurchaseOrderDetailPath(pathname: string): boolean {
  if (!pathname.startsWith("/p2p/purchase-orders/")) return false;
  const segment = pathname.slice("/p2p/purchase-orders/".length).split("/")[0];
  if (!segment) return false;
  return segment !== "create" && segment !== "new" && segment !== "convert";
}

/** Whether `pathname` is allowed for the given role. */
export function canAccessPath(role: AppRole, pathname: string): boolean {
  if (role === "admin") return true;

  const path = pathname.split("?")[0];

  // ── Legal Reviewer: restricted sourcing access ──────────────────────
  // Legal can view /sourcing/legal-reviews and individual RFQ detail
  // pages (read-only), but NOT create RFQs, manage templates, or view
  // the RFQ list.
  if (role === "legal") {
    if (path === "/dashboard" || path.startsWith("/support")) return true;
    if (path === "/sourcing/legal-reviews") return true;
    // Legal Review detail workspace
    if (path.startsWith("/legal/reviews/")) return true;
    // Allow viewing individual RFQ detail pages (read-only)
    if (path.startsWith("/sourcing/rfq/") && path !== "/sourcing/rfq/new") return true;
    return false;
  }

  // GRN creation is Warehouse-only. Block direct navigation to the create
  // screen for every other role, even though they may view GRN records.
  if (path === "/p2p/grn/new") return canCreateGRN(role);

  // Voucher creation is Finance-only. Block the create screen for every other
  // role (Procurement / Warehouse view vouchers read-only) so it can't be
  // reached by URL manipulation.
  if (path === "/p2p/vouchers/new") return canManageVouchers(role);

  // `/p2p` is a pure redirect to the role's first P2P child. Allow the bare
  // index for any role that has the P2P module, without granting siblings.
  if (path === "/p2p") return hasP2PModule(role);

  // Payment Processing page lives at /payments/process/:id (outside /p2p/),
  // but should be accessible to any role that can manage payments.
  if (path.startsWith("/payments/")) return canManageVouchers(role);

  // Linked PO drill-down from GRN / receipt workflows: roles with GRN or PO
  // module access may open a specific PO detail page (read-only for Warehouse).
  if (isPurchaseOrderDetailPath(path)) {
    const config = ROLE_NAV_CONFIG[role] ?? ROLE_NAV_CONFIG.procurement;
    if (
      config.p2pChildren.includes("purchase-orders") ||
      config.p2pChildren.includes("grn")
    ) {
      return true;
    }
  }

  return getAccessPrefixesForRole(role).some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

/**
 * Whether the current role can create/edit RFQs.
 * Legal Reviewers have read-only access to RFQ details.
 */
export function canManageRFQs(role: AppRole | undefined): boolean {
  return role === "admin" || role === "procurement";
}

/** First P2P route the role can land on — used by the /p2p index redirect. */
export function getFirstP2PRoute(role: AppRole): string {
  const firstChild = ROLE_NAV_CONFIG[role]?.p2pChildren[0];
  return firstChild ? P2P_CHILD_REGISTRY[firstChild].to : "/dashboard";
}
