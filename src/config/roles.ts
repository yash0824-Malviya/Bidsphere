import {
  Bell,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  Factory,
  FileSearch,
  LayoutDashboard,
  PackageCheck,
  PackagePlus,
  Shield,
  ShoppingCart,
  Users,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { NavChild, NavGroup, NavItem } from "../utils/routes";
import { NAV_GROUPS } from "../utils/routes";
import { canAccessMaterialRequestPath } from "./materialRequestPermissions";

/** Application roles — mapped from ERPNext login email or ERPNext roles. */
export type AppRole =
  | "admin"
  | "procurement"
  | "finance"
  | "finance_executive"
  | "warehouse"
  | "legal"
  | "department"
  | "manufacturing";

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Administrator",
  procurement: "Procurement Manager",
  finance: "Finance Manager",
  finance_executive: "Finance Executive",
  warehouse: "Warehouse Manager",
  legal: "Legal Reviewer",
  department: "Department User",
  manufacturing: "Manufacturing Manager",
};

/** Default landing route after login per role. */
export const ROLE_HOME: Record<AppRole, string> = {
  admin: "/admin",
  procurement: "/dashboard",
  finance: "/dashboard",
  finance_executive: "/budget",
  warehouse: "/warehouse/dashboard",
  // The Legal Reviewer dashboard (KPI counts + pending queue) lives at
  // /dashboard and reads the "Legal Document Review" DocType — the single
  // source of truth. It must NOT land on the legacy /sourcing/legal-reviews
  // page, which reads RFQ workflow custom fields instead.
  legal: "/dashboard",
  department: "/dashboard",
  // Manufacturing / Production Manager — BOM Management is the primary workspace.
  manufacturing: "/manufacturing/boms",
};

/** Known role users (email → role). Comparison is case-insensitive. */
export const ROLE_USER_EMAILS: Record<string, AppRole> = {
  "admin@netlink.com": "admin",
  "procurement@netlink.com": "procurement",
  "finance@netlink.com": "finance",
  "finance.executive@netlink.com": "finance_executive",
  "warehouse@netlink.com": "warehouse",
  "legal@netlink.com": "legal",
  "department@netlink.com": "department",
  "manufacturing@netlink.com": "manufacturing",
  "production@netlink.com": "manufacturing",
};

/**
 * Map ERPNext role names to BidSphere AppRole.
 * Used when resolving roles dynamically from ERPNext user profile.
 */
export const ERPNEXT_ROLE_MAP: Record<string, AppRole> = {
  Administrator: "admin",
  "System Manager": "admin",
  "Finance Admin": "admin",
  "Procurement Manager": "procurement",
  "Purchase Manager": "procurement",
  "Purchase User": "procurement",
  "Finance Manager": "finance",
  "Finance Executive": "finance_executive",
  "Accounts Manager": "finance",
  "Accounts Payable": "finance",
  "Accounts User": "finance_executive",
  "Stock Manager": "warehouse",
  "Stock User": "warehouse",
  "Warehouse Manager": "warehouse",
  "Legal Reviewer": "legal",
  "Department User": "department",
  "Manufacturing Manager": "manufacturing",
  "Manufacturing User": "manufacturing",
  "Production Manager": "manufacturing",
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
  | "material_requests"
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
  { label: "Upload BOM", to: "/upload-bom" },
  { label: "RFQ Template Library", to: "/sourcing/rfq-templates" },
  { label: "Legal Reviews", to: "/sourcing/legal-reviews" },
];

/** Procurement — full RFx workspace (no standalone quotations module). */
const PROCUREMENT_SOURCING_CHILDREN: NavChild[] = [
  { label: "All RFQs", to: "/sourcing/rfq" },
  { label: "New RFQ", to: "/sourcing/rfq/new" },
  { label: "Upload BOM", to: "/upload-bom" },
  { label: "RFQ Template Library", to: "/sourcing/rfq-templates" },
  { label: "Reverse Bidding", to: "/sourcing/reverse-bidding" },
];

/**
 * Legal Reviewers only see Legal Reviews — no RFQ creation or templates.
 * Points at the "Legal Document Review" DocType–backed list (single source
 * of truth), NOT the legacy /sourcing/legal-reviews RFQ-workflow page.
 */
const LEGAL_SOURCING_CHILDREN: NavChild[] = [
  { label: "Legal Reviews", to: "/legal/reviews" },
];

const BUDGET_CHILDREN_FINANCE: NavChild[] = [
  { label: "Budget Dashboard", to: "/budget" },
  { label: "Budget Approval", to: "/budget/approvals" },
  { label: "Budget Monitoring", to: "/budget/monitoring" },
  { label: "Budget History", to: "/budget/history" },
];

const BUDGET_CHILDREN_EXECUTIVE: NavChild[] = [
  { label: "Dashboard", to: "/budget" },
  { label: "Create Budget", to: "/budget/create" },
  { label: "My Budgets", to: "/budget/my-budgets" },
  { label: "Budget Requests", to: "/budget/requests" },
];

const BUDGET_CHILDREN_READONLY: NavChild[] = [
  { label: "Budget Dashboard", to: "/budget" },
  { label: "Budget Monitoring", to: "/budget/monitoring" },
];

const SUPPLIERS_CHILDREN: NavChild[] = [
  { label: "Supplier Directory", to: "/suppliers" },
  { label: "Supplier Onboarding", to: "/suppliers/onboarding" },
  { label: "Supplier Performance", to: "/suppliers?tab=performance" },
];

const MODULE_ICONS: Record<NavModuleId, LucideIcon> = {
  dashboard: LayoutDashboard,
  sourcing: FileSearch,
  p2p: ShoppingCart,
  material_requests: ClipboardList,
  suppliers: Users,
  inventory: Boxes,
  budget: Wallet,
  "admin-audit": Shield,
};

/** Department User — My Requests only (create via dashboard). */
const DEPARTMENT_MR_CHILDREN: NavChild[] = [
  { label: "My Requests", to: "/material-requests/list" },
];

const WAREHOUSE_MR_CHILDREN: NavChild[] = [
  { label: "Warehouse Review", to: "/material-requests/warehouse" },
  { label: "Issued Materials", to: "/material-requests/issued" },
];

/** Procurement — forwarded MRs (active queue) + full forwarded history. */
const PROCUREMENT_MR_CHILDREN: NavChild[] = [
  { label: "Forwarded Material Requests", to: "/material-requests/procurement" },
  { label: "Forwarded History", to: "/material-requests/history" },
];

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
  // Procurement Manager — sourcing → PO → GRN → voucher → invoice workflow,
  // plus suppliers, budget (read-only), and forwarded material requests.
  procurement: {
    modules: ["dashboard", "sourcing", "p2p", "material_requests", "suppliers", "budget"],
    p2pChildren: ["purchase-orders", "new-po", "grn", "vouchers", "invoices"],
  },
  // Warehouse Manager — module under redevelopment; dashboard placeholder only.
  warehouse: {
    modules: ["dashboard"],
    p2pChildren: [],
  },
  // Finance Manager — payables + budget approval. GRN access is needed so
  // Finance can open a goods receipt from the voucher queue and create a
  // voucher (suppliers create invoices in the Supplier Portal).
  finance: {
    modules: ["dashboard", "p2p", "budget"],
    p2pChildren: ["vouchers", "invoices", "payments", "grn"],
  },
  // Finance Executive — budget module only; home dashboard lives at /budget.
  finance_executive: {
    modules: ["budget"],
    p2pChildren: [],
  },
  // Legal Reviewer — sourcing only (Legal Reviews page).
  legal: {
    modules: ["dashboard", "sourcing"],
    p2pChildren: [],
  },
  department: {
    modules: ["dashboard", "material_requests"],
    p2pChildren: [],
  },
  // Manufacturing / Production Manager — Manufacturing (BOM) workspace. The
  // sidebar is produced by a dedicated branch in getNavGroupsForRole; access is
  // granted to the "/manufacturing" prefix in canAccessPath.
  manufacturing: {
    modules: ["dashboard"],
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
  const priorityOrder: AppRole[] = [
    "admin",
    "legal",
    "finance",
    "finance_executive",
    "manufacturing",
    "warehouse",
    "procurement",
    "department",
  ];
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
        to: role === "legal" ? "/legal/reviews" : "/sourcing/rfq",
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
    case "material_requests": {
      const children =
        role === "warehouse"
          ? WAREHOUSE_MR_CHILDREN
          : role === "procurement"
            ? PROCUREMENT_MR_CHILDREN
            : DEPARTMENT_MR_CHILDREN;
      const defaultTo =
        role === "warehouse"
          ? "/material-requests/warehouse"
          : role === "procurement"
            ? "/material-requests/procurement"
            : "/material-requests/list";
      return {
        label: "Material Requests",
        to: defaultTo,
        icon: MODULE_ICONS.material_requests,
        children,
      };
    }
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
        children:
          role === "finance_executive"
            ? BUDGET_CHILDREN_EXECUTIVE
            : role === "finance" || role === "admin"
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
          {
            label: "Pending Approvals",
            to: "/admin/approvals/pending",
            group: "Approval Center",
          },
          { label: "Approved Requests", to: "/admin/approvals/approved" },
          { label: "Audit Trail", to: "/admin/audit-trail", group: "Administration" },
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
          { label: "SLA Dashboard", to: "/admin/sla-dashboard" },
          { label: "SLA Configuration", to: "/admin/sla-configuration" },
          { label: "SLA Reports", to: "/admin/sla-reports" },
          { label: "Security Settings", to: "/admin/security-settings" },
          { label: "System Settings", to: "/admin/settings" },
        ],
      };
  }
}

/** Sidebar navigation generated dynamically from the signed-in role. */
export function getNavGroupsForRole(role: AppRole): NavGroup[] {
  const supportGroup = NAV_GROUPS.find((g) => g.label === "Support");

  if (role === "warehouse") {
    return [
      {
        label: "Warehouse",
        items: [
          {
            label: "Dashboard",
            to: "/warehouse/dashboard",
            icon: LayoutDashboard,
          },
          // Goods Receipt — a primary daily task, promoted to top-level access.
          {
            label: "Goods Receipt",
            to: "/warehouse/inventory/create-grn",
            icon: PackagePlus,
            children: [
              { label: "Receive Goods", to: "/warehouse/inventory/create-grn" },
              { label: "GRN List", to: "/warehouse/grn-list" },
            ],
          },
          // Material Requests — the warehouse ONLY decides stock availability here.
          {
            label: "Material Requests",
            to: "/warehouse/material-requests/pending",
            icon: ClipboardList,
            children: [
              { label: "Pending Review", to: "/warehouse/material-requests/pending" },
              {
                label: "Procurement Required",
                to: "/warehouse/material-requests/forwarded",
              },
              {
                label: "Forwarded History",
                to: "/warehouse/material-requests/history",
              },
            ],
          },
          // Issue Items — a separate module for physically issuing available stock.
          {
            label: "Issue Items",
            to: "/warehouse/issue-items",
            icon: PackageCheck,
            children: [
              { label: "Ready to Issue", to: "/warehouse/issue-items" },
              { label: "Issued History", to: "/warehouse/material-requests/issued" },
            ],
          },
          {
            label: "Inventory",
            to: "/warehouse/inventory/stock",
            icon: Boxes,
            children: [
              { label: "Stock Overview", to: "/warehouse/inventory/stock" },
              { label: "Item Master", to: "/warehouse/inventory/items" },
            ],
          },
        ],
      },
      ...(supportGroup ? [supportGroup] : []),
    ];
  }

  // Department User — a focused portal: request items and track fulfillment.
  if (role === "department") {
    return [
      {
        label: "",
        items: [
          { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard },
          {
            label: "My Requests",
            to: "/material-requests/list",
            icon: ClipboardList,
            children: [
              { label: "New Request", to: "/material-requests/new" },
              { label: "Request History", to: "/material-requests/list" },
              { label: "Track Request", to: "/material-requests/list?f=procurement" },
            ],
          },
          {
            label: "Issued Items",
            to: "/material-requests/list?f=received",
            icon: PackageCheck,
            children: [
              { label: "Received Items", to: "/material-requests/list?f=received" },
            ],
          },
          { label: "Notifications", to: "/notifications", icon: Bell },
        ],
      },
      ...(supportGroup ? [supportGroup] : []),
    ];
  }

  // Manufacturing / Production Manager — a focused BOM (Bill of Materials)
  // workspace. Department Users never see this module.
  if (role === "manufacturing") {
    return [
      {
        label: "",
        items: [
          { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard },
          {
            label: "Manufacturing",
            to: "/manufacturing/boms",
            icon: Factory,
            children: [
              { label: "BOM Management", to: "/manufacturing/boms" },
              { label: "BOM List", to: "/manufacturing/boms/list" },
              { label: "Create BOM", to: "/manufacturing/boms/new" },
              {
                label: "Finished Products",
                to: "/manufacturing/finished-products",
              },
            ],
          },
          { label: "Notifications", to: "/notifications", icon: Bell },
        ],
      },
      ...(supportGroup ? [supportGroup] : []),
    ];
  }

  // Finance Manager — Dashboard and the RFQ Financial Review are primary,
  // top-level operational items (RFQ Financial Review sits directly below the
  // Dashboard, out of any Budget submenu). Budget approval/monitoring/history
  // live under the Budget group; payables under P2P Core.
  if (role === "finance") {
    return [
      {
        label: "",
        items: [
          { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard },
          {
            label: "RFQ Financial Review",
            to: "/budget/pending-reviews",
            icon: ClipboardCheck,
          },
          {
            label: "Budget",
            to: "/budget",
            icon: Wallet,
            children: BUDGET_CHILDREN_FINANCE,
          },
          {
            label: "P2P Core",
            to: "/p2p",
            icon: ShoppingCart,
            children: buildP2PChildren("finance"),
          },
        ],
      },
      ...(supportGroup ? [supportGroup] : []),
    ];
  }

  const config = ROLE_NAV_CONFIG[role] ?? ROLE_NAV_CONFIG.procurement;
  const mainItems = config.modules.map((id) => buildNavItem(id, role));

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
        prefixes.add("/upload-bom");
        // NOTE: `/legal` is intentionally NOT granted here. Legal Document
        // Review pages are Legal's domain — the `legal` role has its own
        // dedicated early-return block above with the correct allowlist.
        // Adding `/legal` to every role with the shared "sourcing" module
        // (e.g. procurement) would let Procurement open Legal review pages
        // by direct URL, which they should never be able to do.
        break;
      case "suppliers":
        prefixes.add("/suppliers");
        break;
      case "inventory":
        prefixes.add("/inventory");
        break;
      case "material_requests":
        prefixes.add("/material-requests");
        break;
      case "budget":
        prefixes.add("/budget");
        // `/finance/*` (Finance Review approve/reject workspace) is
        // Finance-only. Procurement also carries the "budget" module for
        // read-only Budget Dashboard/Monitoring access, but must NOT be
        // able to open Finance Review detail pages by direct URL.
        if (role === "finance") prefixes.add("/finance");
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
 * Finance payables roles that may create invoices, approve invoices, and
 * release payments:
 *   - Finance Manager (`finance`)
 *   - Accounts Payable (ERPNext role mapped → `finance`)
 *   - Finance Admin / Administrator (`admin`)
 *
 * Procurement Manager and Warehouse Manager are explicitly excluded.
 */
export function canManageInvoicesAndPayments(
  role: AppRole | undefined,
): boolean {
  return role === "finance" || role === "admin";
}

/**
 * Internal payables capability used by ERP Purchase Invoice helpers during
 * payment release. Finance must not create supplier invoices in the UI —
 * suppliers create those in the Supplier Portal after receiving a voucher.
 */
export function canCreateInvoice(role: AppRole | undefined): boolean {
  return canManageInvoicesAndPayments(role);
}

/** Approve / reject supplier invoices. */
export function canApproveInvoice(role: AppRole | undefined): boolean {
  return canManageInvoicesAndPayments(role);
}

/** Release Payment / process Payment Entry. */
export function canReleasePayment(role: AppRole | undefined): boolean {
  return canManageInvoicesAndPayments(role);
}

/**
 * Voucher ownership is exclusively a Finance payables operation.
 * Alias of {@link canManageInvoicesAndPayments} for existing call sites.
 */
export function canManageVouchers(role: AppRole | undefined): boolean {
  return canManageInvoicesAndPayments(role);
}

/** View existing GRN records (read-only for non-warehouse roles). */
export function canViewGRN(role: AppRole | undefined): boolean {
  return (
    role === "warehouse" ||
    role === "procurement" ||
    role === "finance" ||
    role === "admin"
  );
}

/** Digitally sign a warehouse GRN — Warehouse Manager (+ Admin support). */
export function canDigitallySignGRN(role: AppRole | undefined): boolean {
  return role === "warehouse" || role === "admin";
}

/** Submit a draft Purchase Order — Procurement (+ Admin). */
export function canSubmitPurchaseOrder(role: AppRole | undefined): boolean {
  return role === "procurement" || role === "admin";
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
  const path = pathname.split("?")[0];

  // Supplier portal is a separate auth surface — never via internal RBAC
  if (path === "/supplier" || path.startsWith("/supplier/")) {
    return false;
  }

  // Admin may access every internal route
  if (role === "admin") return true;

  // Hard prefix denials — prevent cross-role URL access even if nav drifts
  if (path === "/admin" || path.startsWith("/admin/")) return false;
  if (path === "/warehouse" || path.startsWith("/warehouse/")) {
    return role === "warehouse";
  }
  if (path === "/manufacturing" || path.startsWith("/manufacturing/")) {
    return role === "manufacturing";
  }
  if (path === "/finance" || path.startsWith("/finance/")) {
    return role === "finance";
  }
  if (path === "/legal" || path.startsWith("/legal/")) {
    return role === "legal";
  }

  // Warehouse — full access to warehouse sub-routes
  if (role === "warehouse") {
    const allowed = [
      "/dashboard",
      "/warehouse",
      "/warehouse/dashboard",
      "/warehouse/material-requests/pending",
      "/warehouse/material-requests/review",
      "/warehouse/material-requests/issued",
      "/warehouse/material-requests/forwarded",
      "/warehouse/material-requests/history",
      "/warehouse/issue-items",
      "/warehouse/inventory/stock",
      "/warehouse/inventory/stock-overview",
      "/warehouse/inventory/items",
      "/warehouse/inventory/create-grn",
      "/warehouse/grn-list",
      "/warehouse/reports",
      "/p2p/grn",
      "/p2p/purchase-orders",
    ];
    if (allowed.some((p) => path === p || path.startsWith(`${p}/`))) return true;
    if (path.startsWith("/support") || path.startsWith("/notifications")) return true;
    return false;
  }

  // Manufacturing / Production Manager — dashboard + the Manufacturing (BOM)
  // workspace only. Department Users and every other non-admin role are blocked
  // from "/manufacturing".
  if (role === "manufacturing") {
    if (
      path === "/dashboard" ||
      path.startsWith("/support") ||
      path.startsWith("/notifications")
    ) {
      return true;
    }
    if (path === "/manufacturing" || path.startsWith("/manufacturing/")) {
      return true;
    }
    return false;
  }

  // Department User — dashboard + own material requests only.
  if (role === "department") {
    if (
      path.startsWith("/support") ||
      path.startsWith("/notifications") ||
      path === "/dashboard"
    ) {
      return true;
    }
    if (path.startsWith("/material-requests")) {
      return canAccessMaterialRequestPath(role, path);
    }
    return false;
  }

  // ── Legal Reviewer: restricted sourcing access ──────────────────────
  // Legal can view /sourcing/legal-reviews and individual RFQ detail
  // pages (read-only), but NOT create RFQs, manage templates, or view
  // the RFQ list.
  // Finance Executive — budget module only (no finance manager pages).
  if (role === "finance_executive") {
    if (path === "/dashboard" || path.startsWith("/support") || path.startsWith("/notifications")) {
      return true;
    }
    const allowed = [
      "/budget",
      "/budget/create",
      "/budget/my-budgets",
      "/budget/requests",
    ];
    if (allowed.some((p) => path === p || path.startsWith(`${p}/`))) return true;
    // Detail view for own budgets
    if (path.startsWith("/budget/detail/")) return true;
    return false;
  }

  // Finance Manager may approve/monitor budgets but not create them.
  if (role === "finance" && path === "/budget/create") return false;

  // Reverse Bidding — Finance has READ-ONLY visibility (dashboard/list/detail).
  // Procurement reaches it through the shared "/sourcing" prefix below; Legal,
  // Department and Warehouse are blocked by their dedicated allowlists above.
  if (role === "finance" && path.startsWith("/sourcing/reverse-bidding")) {
    return true;
  }

  // Procurement carries the "budget" module for read-only visibility only
  // (Budget Dashboard + Monitoring) — it must not reach budget creation,
  // approvals, or pending-review workflows, which are Finance-only.
  if (role === "procurement" && path.startsWith("/budget")) {
    const readOnly = ["/budget", "/budget/monitoring"];
    return readOnly.some((p) => path === p || path.startsWith(`${p}/`));
  }

  if (role === "legal") {
    if (
      path === "/dashboard" ||
      path.startsWith("/support") ||
      path.startsWith("/notifications")
    )
      return true;
    // Legacy RFQ-workflow page — kept reachable for old bookmarks/links but
    // no longer the primary nav target (see LEGAL_SOURCING_CHILDREN).
    if (path === "/sourcing/legal-reviews") return true;
    // Legal Document Review list (canonical — reads the DocType, not RFQ).
    if (path === "/legal/reviews" || path.startsWith("/legal/reviews/")) return true;
    // Legal Document Review detail workspace, keyed by Supplier Quotation
    // name (singular "/legal/review/:sqName" — NOT the same as the plural
    // list route above). Missing this previously made every review row
    // click redirect Legal Reviewers away from the page they just opened.
    if (path.startsWith("/legal/review/")) return true;
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

  // Material Request routes — role-scoped; procurement sees forwarded queue only.
  if (path.startsWith("/material-requests")) {
    return canAccessMaterialRequestPath(role, path);
  }

  // Procurement may create RFQs (including from forwarded MRs).
  if (role === "procurement" && path === "/sourcing/rfq/new") {
    return true;
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

/**
 * BOM (Bill of Materials) management — the Manufacturing module.
 *
 * Business rule: only the Manufacturing / Production Manager (mapped to the
 * `manufacturing` role) and the System Administrator may create, edit, delete
 * or activate BOMs. Department Users and every other role have no access.
 */
export function canManageBom(role: AppRole | undefined): boolean {
  return role === "manufacturing" || role === "admin";
}

/**
 * Reverse Bidding management (create auction, invite, schedule, approve, PO).
 *
 * Business rule: only the Procurement Manager (and Admin for support) may run
 * auctions. Finance has read-only visibility; Department, Warehouse and Legal
 * have no access. Suppliers bid through the separate supplier portal.
 */
export function canManageReverseBidding(role: AppRole | undefined): boolean {
  return role === "admin" || role === "procurement";
}

/** Read-only visibility of the Reverse Bidding module (Finance + managers). */
export function canViewReverseBidding(role: AppRole | undefined): boolean {
  return (
    role === "admin" || role === "procurement" || role === "finance"
  );
}

/** First P2P route the role can land on — used by the /p2p index redirect. */
export function getFirstP2PRoute(role: AppRole): string {
  const firstChild = ROLE_NAV_CONFIG[role]?.p2pChildren[0];
  return firstChild ? P2P_CHILD_REGISTRY[firstChild].to : "/dashboard";
}
