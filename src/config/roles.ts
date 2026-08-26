import {
  Bell,
  Boxes,
  Briefcase,
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
  | "procurement_team"
  | "finance"
  | "finance_executive"
  | "warehouse"
  | "legal"
  | "department"
  | "executive"
  | "manufacturing"
  // ECR roles
  | "engineer"
  | "engineering"
  | "operations"
  | "quality"
  | "program_manager";

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Administrator",
  procurement: "Procurement Manager",
  procurement_team: "Procurement Team",
  finance: "Finance Manager",
  finance_executive: "Finance Executive",
  warehouse: "Warehouse Manager",
  legal: "Legal Reviewer",
  department: "Department User",
  executive: "Executive Management",
  manufacturing: "Manufacturing Manager",
  // ECR roles
  engineer: "Engineer",
  engineering: "Engineering Manager",
  operations: "Operations Manager",
  quality: "Quality Manager",
  program_manager: "Program Manager",
};

/** Default landing route after login per role. */
export const ROLE_HOME: Record<AppRole, string> = {
  admin: "/dashboard",
  procurement: "/dashboard",
  procurement_team: "/dashboard",
  finance: "/dashboard",
  finance_executive: "/dashboard",
  warehouse: "/dashboard",
  legal: "/dashboard",
  department: "/dashboard",
  executive: "/dashboard",
  manufacturing: "/dashboard",
  // ECR roles
  engineer: "/dashboard",
  engineering: "/dashboard",
  operations: "/dashboard",
  quality: "/dashboard",
  program_manager: "/dashboard",
};

/** Known role users (email → role). Comparison is case-insensitive. */
export const ROLE_USER_EMAILS: Record<string, AppRole> = {
  "admin@netlink.com": "admin",
  "procurement@netlink.com": "procurement",
  "procurement.team@netlink.com": "procurement_team",
  "finance@netlink.com": "finance",
  "finance.executive@netlink.com": "finance_executive",
  "warehouse@netlink.com": "warehouse",
  "legal@netlink.com": "legal",
  "department@netlink.com": "department",
  // department.head is merged into department — per spec, no Department Head role.
  "department.head@netlink.com": "department",
  "executive@netlink.com": "executive",
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
  /** Operational PO ownership after Manager approves the RFQ → PO path. */
  "Procurement Team": "procurement_team",
  "Procurement User": "procurement_team",
  "Purchase User": "procurement_team",
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
  "Engineer": "engineer",
  "engineer": "engineer",
  "Engineering Manager": "engineering",
  "engineering manager": "engineering",
  "Operations Manager": "operations",
  "operations manager": "operations",
  "Quality Manager": "quality",
  "quality manager": "quality",
  "Program Manager": "program_manager",
  "program manager": "program_manager",
};

/**
 * Case-insensitive role normalizer that converts any representation
 * (e.g. "Engineer", "engineer", "ENGINEER", "Engineering Manager", etc.)
 * to the canonical AppRole.
 */
export function normalizeAppRole(role?: string | null): AppRole {
  if (!role) return "procurement";
  const trimmed = role.trim();
  const lower = trimmed.toLowerCase();

  // If already a valid lowercase AppRole key
  if (lower in ROLE_LABELS) {
    return lower as AppRole;
  }

  // Check ERPNEXT_ROLE_MAP case-insensitively
  for (const [erpKey, appRole] of Object.entries(ERPNEXT_ROLE_MAP)) {
    if (erpKey.toLowerCase() === lower) {
      return appRole;
    }
  }

  // Canonical role naming mappings
  if (lower === "engineer") return "engineer";
  if (lower === "engineering manager" || lower === "engineering_manager" || lower === "engineering") return "engineering";
  if (lower === "operations manager" || lower === "operations_manager" || lower === "operations") return "operations";
  if (lower === "quality manager" || lower === "quality_manager" || lower === "quality") return "quality";
  if (lower === "program manager" || lower === "program_manager") return "program_manager";
  if (lower === "system manager" || lower === "administrator" || lower === "admin") return "admin";
  if (lower === "procurement manager" || lower === "purchase manager" || lower === "procurement") return "procurement";
  if (lower === "procurement team" || lower === "purchase user" || lower === "procurement_team") return "procurement_team";
  if (lower === "finance manager" || lower === "accounts manager" || lower === "finance") return "finance";
  if (lower === "finance executive" || lower === "accounts user" || lower === "finance_executive") return "finance_executive";
  if (lower === "warehouse manager" || lower === "stock manager" || lower === "warehouse") return "warehouse";
  if (lower === "legal reviewer" || lower === "legal") return "legal";
  if (lower === "department user" || lower === "department") return "department";
  if (lower === "manufacturing manager" || lower === "production manager" || lower === "manufacturing") return "manufacturing";

  return "procurement";
}

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
  | "intake"
  | "sourcing"
  | "p2p"
  | "material_requests"
  | "suppliers"
  | "inventory"
  | "budget"
  | "reports"
  | "admin-audit"
  | "engineering_changes";

type P2PChildId =
  | "requisitions"
  | "purchase-orders"
  | "new-po"
  | "po-amendments"
  | "supplier-confirmation"
  | "delivery-tracking"
  | "grn"
  | "vouchers"
  | "invoices"
  | "payments"
  | "total-spend";

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
  "po-amendments": {
    label: "PO Amendments",
    to: "/p2p/purchase-orders?focus=amendments",
    access: "/p2p/purchase-orders",
  },
  "supplier-confirmation": {
    label: "Supplier Confirmation",
    to: "/p2p/purchase-orders?focus=confirmation",
    access: "/p2p/purchase-orders",
  },
  "delivery-tracking": {
    label: "Delivery Tracking",
    to: "/p2p/purchase-orders?focus=delivery",
    access: "/p2p/purchase-orders",
  },
  grn: { label: "GRN", to: "/p2p/grn", access: "/p2p/grn" },
  vouchers: { label: "Vouchers", to: "/p2p/vouchers", access: "/p2p/vouchers" },
  invoices: { label: "Invoices", to: "/p2p/invoices", access: "/p2p/invoices" },
  payments: { label: "Payments", to: "/p2p/payments", access: "/p2p/payments" },
  "total-spend": {
    label: "Reports",
    to: "/p2p/total-spend",
    access: "/p2p/total-spend",
  },
};

/** Display-label overrides for P2P children (role-specific naming only). */
const P2P_LABEL_OVERRIDES: Partial<
  Record<AppRole, Partial<Record<P2PChildId, string>>>
> = {
  procurement_team: {
    grn: "GRN Monitoring (Read Only)",
  },
};

const SOURCING_CHILDREN_FULL: NavChild[] = [
  { label: "All RFIs", to: "/sourcing/rfi" },
  { label: "All RFPs", to: "/sourcing/rfp" },
  { label: "All RFQs", to: "/sourcing/rfq" },
  { label: "RFQ Template Library", to: "/sourcing/rfq-templates" },
  { label: "Legal Reviews", to: "/sourcing/legal-reviews" },
];

/** Procurement — full RFx workspace (no standalone quotations module). */
const PROCUREMENT_SOURCING_CHILDREN: NavChild[] = [
  { label: "All RFIs", to: "/sourcing/rfi" },
  { label: "All RFPs", to: "/sourcing/rfp" },
  { label: "All RFQs", to: "/sourcing/rfq" },
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

/** Procurement Team — directory + performance only (no onboarding). */
const SUPPLIERS_CHILDREN_TEAM: NavChild[] = [
  { label: "Supplier Directory", to: "/suppliers" },
  { label: "Supplier Performance", to: "/suppliers?tab=performance" },
];

const MODULE_ICONS: Record<NavModuleId, LucideIcon> = {
  dashboard: LayoutDashboard,
  intake: Briefcase,
  sourcing: FileSearch,
  p2p: ShoppingCart,
  material_requests: ClipboardList,
  suppliers: Users,
  inventory: Boxes,
  budget: Wallet,
  reports: ClipboardCheck,
  "admin-audit": Shield,
  engineering_changes: Factory,
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
    modules: ["admin-audit", "intake", "engineering_changes"],
    p2pChildren: [],
  },
  // Procurement Manager — Business Intake Queue, RFQ lifecycle through PO Approval.
  procurement: {
    modules: [
      "dashboard",
      "engineering_changes",
      "intake",
      "sourcing",
      "material_requests",
      "suppliers",
      "budget",
      "reports",
    ],
    p2pChildren: [],
  },
  procurement_team: {
    modules: ["dashboard", "engineering_changes", "intake", "p2p", "suppliers", "reports"],
    p2pChildren: ["new-po", "purchase-orders", "grn"],
  },
  warehouse: {
    modules: ["dashboard"],
    p2pChildren: [],
  },
  finance: {
    modules: ["intake", "dashboard", "p2p", "budget"],
    p2pChildren: ["vouchers", "invoices", "payments", "grn"],
  },
  finance_executive: {
    modules: ["intake", "budget"],
    p2pChildren: [],
  },
  legal: {
    modules: ["intake", "dashboard", "sourcing"],
    p2pChildren: [],
  },
  department: {
    modules: ["intake", "dashboard", "material_requests"],
    p2pChildren: [],
  },
  executive: {
    modules: ["intake", "dashboard", "reports", "budget"],
    p2pChildren: [],
  },
  manufacturing: {
    modules: ["dashboard"],
    p2pChildren: [],
  },
  // ECR roles
  engineer: {
    modules: ["dashboard", "engineering_changes"],
    p2pChildren: [],
  },
  engineering: {
    modules: ["dashboard", "engineering_changes"],
    p2pChildren: [],
  },
  operations: {
    modules: ["dashboard", "engineering_changes"],
    p2pChildren: [],
  },
  quality: {
    modules: ["dashboard", "engineering_changes"],
    p2pChildren: [],
  },
  program_manager: {
    modules: ["dashboard", "engineering_changes"],
    p2pChildren: [],
  },
};

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** True when the account is a known role mailbox (email → AppRole map). */
export function isKnownRoleMailbox(emailOrName?: string | null): boolean {
  if (!emailOrName) return false;
  const key = normalizeEmail(emailOrName);
  return Boolean(ROLE_USER_EMAILS[key]);
}

/**
 * Display name for the authenticated user.
 * Known role mailboxes use ROLE_LABELS[role] so profile/UI never show a
 * mismatched ERPNext full_name (e.g. Team user labeled as Manager).
 */
export function displayNameForAuthenticatedUser(user: {
  email?: string | null;
  name?: string | null;
  full_name?: string | null;
  role?: AppRole | null;
}): string {
  const email = normalizeEmail(user.email || user.name || "");
  const mappedRole = ROLE_USER_EMAILS[email];
  if (mappedRole) return ROLE_LABELS[mappedRole];
  if (user.role && ROLE_LABELS[user.role]) return user.full_name?.trim() || ROLE_LABELS[user.role];
  return user.full_name?.trim() || user.email || user.name || "—";
}

/**
 * Resolve BidSphere role from the authenticated user.
 *
 * Priority:
 * 1. Known role mailbox (email → AppRole) — authoritative for demo/role accounts
 * 2. ERPNext roles mapped via ERPNEXT_ROLE_MAP
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

  // ERPNext roles are authoritative. This keeps the application role-driven
  // for every account rather than coupling ECR behavior to login addresses.
  if (user.erpnext_roles && user.erpnext_roles.length > 0) {
    const roleFromErp = resolveFromErpNextRoles(user.erpnext_roles);
    if (roleFromErp) {
      console.log(`[Auth] Resolved role "${roleFromErp}" from ERPNext roles:`, user.erpnext_roles);
      return roleFromErp;
    }
  }

  // Compatibility fallback for installations whose role child table could
  // not be fetched during login. Product permissions never inspect email.
  const emailRole = ROLE_USER_EMAILS[email] ?? ROLE_USER_EMAILS[name];
  if (emailRole) return emailRole;

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
    // Dedicated ECR roles outrank broad Purchase/User roles that may be
    // granted only for ERP document access.
    "program_manager",
    "engineering",
    "operations",
    "quality",
    "engineer",
    "legal",
    "finance",
    "finance_executive",
    "manufacturing",
    "warehouse",
    "procurement",
    "procurement_team",
    "department",
  ];
  const resolved = new Set<AppRole>();

  for (const erpRole of erpRoles) {
    const normalized = erpRole.trim().toLowerCase();
    const mapped = Object.entries(ERPNEXT_ROLE_MAP).find(
      ([erpName]) => erpName.toLowerCase() === normalized,
    )?.[1];
    if (mapped) resolved.add(mapped);
  }

  if (resolved.size === 0) return null;

  for (const role of priorityOrder) {
    if (resolved.has(role)) return role;
  }

  return null;
}

export function getRoleHome(role: AppRole | string): string {
  const normRole = normalizeAppRole(role);
  return ROLE_HOME[normRole] ?? "/dashboard";
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

/** System / unassigned ERPNext identities that must never appear as RFQ Owner. */
function isSystemOrUnassignedRfqOwner(value?: string | null): boolean {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return true;
  if (v === "administrator" || v === "guest" || v === "admin") return true;
  if (v.startsWith("administrator@")) return true;
  if (v === "admin@example.com" || v === "administrator@example.com") return true;
  if (v === "admin@netlink.com") return true;
  return false;
}

/** Humanize a login / email into a short display name (jane.doe@x → Jane Doe). */
function humanizeRfqOwnerIdentity(value: string): string {
  const local = (value.includes("@") ? value.split("@")[0]! : value).trim();
  if (!local || isSystemOrUnassignedRfqOwner(local)) return "";
  return local
    .replace(/[._+-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Owner label for procurement RFQ surfaces (list, detail, dashboard, export).
 *
 * Priority among candidates (first usable wins):
 * 1. Explicit RFQ owner / assigned user
 * 2. Document creator (`owner`)
 * 3. Buyer / assigned procurement user
 *
 * Never displays "Administrator". Unassigned / system accounts → "Procurement Team".
 * Known role mailboxes use ROLE_LABELS; other real users are humanized from identity.
 */
export function formatRfqOwnerLabel(
  ...candidates: Array<string | null | undefined>
): string {
  for (const raw of candidates) {
    const value = (raw ?? "").trim();
    if (!value || isSystemOrUnassignedRfqOwner(value)) continue;

    const email = normalizeEmail(value);
    const mapped = ROLE_USER_EMAILS[email] ?? ROLE_USER_EMAILS[value.toLowerCase()];
    if (mapped === "admin") continue;
    if (mapped) return ROLE_LABELS[mapped];

    const humanized = humanizeRfqOwnerIdentity(value);
    if (humanized) return humanized;
  }
  return "Procurement Team";
}

/**
 * Resolve RFQ Owner from a document-like object, preferring explicit owner /
 * buyer / assignee fields when present, then falling back to `owner`.
 */
export function formatRfqOwnerFromDoc(doc?: {
  owner?: string | null;
  rfq_owner?: string | null;
  custom_rfq_owner?: string | null;
  custom_procurement_owner?: string | null;
  buyer?: string | null;
  custom_buyer?: string | null;
  assigned_to?: string | null;
  custom_assigned_to?: string | null;
  modified_by?: string | null;
} | null): string {
  if (!doc) return "Procurement Team";
  return formatRfqOwnerLabel(
    doc.rfq_owner,
    doc.custom_rfq_owner,
    doc.custom_procurement_owner,
    doc.owner,
    doc.buyer,
    doc.custom_buyer,
    doc.assigned_to,
    doc.custom_assigned_to,
  );
}

/* ─── Sidebar generation (dynamic, no hardcoded per-role menus) ─────────── */

function buildP2PChildren(role: AppRole): NavChild[] {
  const overrides = P2P_LABEL_OVERRIDES[role];
  return ROLE_NAV_CONFIG[role].p2pChildren.map((id) => {
    const def = P2P_CHILD_REGISTRY[id];
    return { label: overrides?.[id] ?? def.label, to: def.to };
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
    case "intake": {
      let children: NavChild[];
      let defaultTo: string;

      if (role === "admin") {
        // Admin sees all Business Intake routes.
        defaultTo = "/intake/business-needs";
        children = [
          { label: "Business Needs", to: "/intake/business-needs" },
          { label: "Business Cases", to: "/intake/business-cases" },
          { label: "Pending Business Cases", to: "/intake/pending-business-cases" },
          { label: "Dashboard", to: "/intake/dashboard" },
        ];
      } else if (role === "procurement" || role === "procurement_team") {
        // Procurement: queue + cases only — no Business Needs link in sidebar.
        defaultTo = "/intake/pending-business-cases";
        children = [
          { label: "Business Cases", to: "/intake/business-cases" },
          { label: "Pending Business Cases", to: "/intake/pending-business-cases" },
        ];
      } else if (role === "finance" || role === "legal") {
        // Finance / Legal: Business Cases only — they access needs via linked records.
        defaultTo = "/intake/business-cases";
        children = [
          { label: "Business Cases", to: "/intake/business-cases" },
        ];
      } else if (role === "executive") {
        // Executive: dashboard as primary landing.
        defaultTo = "/intake/dashboard";
        children = [
          { label: "Dashboard", to: "/intake/dashboard" },
        ];
      } else if (role === "department") {
        // Department User: Business Needs only (no Cases in sidebar).
        defaultTo = "/intake/business-needs";
        children = [
          { label: "Business Needs", to: "/intake/business-needs" },
        ];
      } else {
        defaultTo = "/intake/business-needs";
        children = [
          { label: "Business Needs", to: "/intake/business-needs" },
        ];
      }

      return {
        label: "Business Intake",
        to: defaultTo,
        icon: MODULE_ICONS.intake,
        children,
      };
    }
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
        // Procurement Team uses "Purchase Orders"; Finance keeps "P2P Core".
        label: role === "procurement_team" ? "Purchase Orders" : "P2P Core",
        to: "/p2p",
        icon: MODULE_ICONS.p2p,
        children: buildP2PChildren(role),
      };
    case "reports":
      return {
        label: "Reports",
        // Team gets operational reports only — never Total Spend financial detail.
        to:
          role === "procurement_team"
            ? "/reports/operations"
            : "/p2p/total-spend",
        icon: MODULE_ICONS.reports,
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
        children:
          role === "procurement_team"
            ? SUPPLIERS_CHILDREN_TEAM
            : SUPPLIERS_CHILDREN,
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
    case "engineering_changes": {
      const ecrChildren: NavChild[] = [];

      if (role === "engineer") {
        ecrChildren.push(
          { label: "My ECRs", to: "/ecr" },
          { label: "New ECR", to: "/ecr/new" },
        );
      } else if (role === "engineering") {
        ecrChildren.push(
          { label: "Engineering Review", to: "/ecr?filter=engineering" },
          { label: "All ECRs", to: "/ecr" },
        );
      } else if (role === "operations") {
        ecrChildren.push({ label: "All ECRs", to: "/ecr" });
      } else if (role === "quality") {
        ecrChildren.push({ label: "All ECRs", to: "/ecr" });
      } else if (role === "program_manager") {
        ecrChildren.push({ label: "All ECRs", to: "/ecr" });
      } else if (role === "procurement_team") {
        ecrChildren.push(
          { label: "Procurement Review", to: "/ecr?filter=procurement-review" },
          { label: "All ECRs", to: "/ecr" },
        );
      } else if (role === "procurement") {
        ecrChildren.push(
          { label: "RFQ Pending", to: "/ecr?filter=rfq-pending" },
          { label: "All ECRs", to: "/ecr" },
        );
      } else {
        ecrChildren.push({ label: "All ECRs", to: "/ecr" });
      }

      return {
        label: "Engineering Changes",
        to: "/ecr",
        icon: MODULE_ICONS.engineering_changes,
        children: ecrChildren,
      };
    }
  }
}

/** Keep one canonical Dashboard entry at the top of every internal sidebar. */
function withDashboardFirst(items: NavItem[]): NavItem[] {
  return [
    {
      label: "Dashboard",
      to: "/dashboard",
      icon: MODULE_ICONS.dashboard,
    },
    ...items.filter(
      (item) => item.to !== "/dashboard" && item.label !== "Dashboard",
    ),
  ];
}

/** Sidebar navigation generated dynamically from the signed-in role. */
export function getNavGroupsForRole(role: AppRole | string): NavGroup[] {
  const normRole = normalizeAppRole(role);
  const supportGroup = NAV_GROUPS.find((g) => g.label === "Support");

  if (normRole === "warehouse") {
    return [
      {
        label: "Warehouse",
        items: withDashboardFirst([
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
              {
                label: "Pending Department Acceptance",
                to: "/warehouse/issue-items/pending-acceptance",
              },
              {
                label: "Issue Receipts",
                to: "/warehouse/issue-items/receipts",
              },
              {
                label: "Issued History",
                to: "/warehouse/material-requests/issued",
              },
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
        ]),
      },
      ...(supportGroup ? [supportGroup] : []),
    ];
  }

  // Department User — BOM upload, material requests, issued items, Business Intake.
  if (normRole === "department") {
    return [
      {
        label: "",
        items: withDashboardFirst([
          { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard },
          {
            label: "Department",
            to: "/material-requests/new",
            icon: ClipboardList,
            children: [
              { label: "Material Requests", to: "/material-requests/new" },
              { label: "My Requests", to: "/material-requests/list" },
              { label: "Upload BOM", to: "/department/upload-bom" },
              { label: "Temporary Item Store", to: "/department/temporary-items" },
            ],
          },
          {
            label: "Issued Items",
            to: "/department/issued-items",
            icon: PackageCheck,
            children: [
              {
                label: "Pending Acceptance",
                to: "/department/issued-items/pending-acceptance",
              },
              {
                label: "Issue Receipts",
                to: "/department/issued-items/issue-receipts",
              },
            ],
          },
          {
            // Business Intake — Department User sees only their own Business Needs.
            // Business Cases are accessed via links from Need records, not sidebar.
            label: "Business Intake",
            to: "/intake/business-needs",
            icon: Briefcase,
            children: [
              { label: "Business Needs", to: "/intake/business-needs" },
            ],
          },
          { label: "Notifications", to: "/notifications", icon: Bell },
        ]),
      },
      ...(supportGroup ? [supportGroup] : []),
    ];
  }

  // Manufacturing / Production Manager — BOM Management + Master Data review.
  if (normRole === "manufacturing") {
    return [
      {
        label: "",
        items: withDashboardFirst([
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
          {
            label: "Master Data",
            to: "/department/temporary-items",
            icon: ClipboardList,
            children: [
              { label: "Temporary Item Store", to: "/department/temporary-items" },
              { label: "Department BOM Upload", to: "/department/upload-bom" },
            ],
          },
          { label: "Notifications", to: "/notifications", icon: Bell },
        ]),
      },
      ...(supportGroup ? [supportGroup] : []),
    ];
  }

  // Finance Manager — Dashboard, Business Intake review (Cases only), RFQ Financial Review.
  // Budget approval/monitoring/history live under the Budget group;
  // payables under P2P Core.
  // Finance accesses Business Needs via linked records from Business Cases — not sidebar.
  if (normRole === "finance") {
    return [
      {
        label: "",
        items: withDashboardFirst([
          { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard },
          {
            label: "Business Intake",
            to: "/intake/business-cases",
            icon: Briefcase,
            children: [
              { label: "Business Cases", to: "/intake/business-cases" },
            ],
          },
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
        ]),
      },
      ...(supportGroup ? [supportGroup] : []),
    ];
  }

  const config = ROLE_NAV_CONFIG[normRole] ?? ROLE_NAV_CONFIG.procurement;
  const mainItems = withDashboardFirst(
    config.modules.map((id) => buildNavItem(id, normRole)),
  );

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
  const prefixes = new Set<string>([
    "/dashboard",
    "/support",
    "/notifications",
    "/account",
  ]);

  for (const id of config.modules) {
    switch (id) {
      case "dashboard":
        break;
      case "sourcing":
        prefixes.add("/sourcing");
        // Upload BOM removed from procurement — lives under /department/upload-bom.
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
      case "engineering_changes":
        prefixes.add("/ecr");
        break;
      case "budget":
        prefixes.add("/budget");
        // `/finance/*` (Finance Review approve/reject workspace) is
        // Finance-only. Procurement also carries the "budget" module for
        // read-only Budget Dashboard/Monitoring access, but must NOT be
        // able to open Finance Review detail pages by direct URL.
        if (role === "finance") prefixes.add("/finance");
        break;
      case "reports":
        if (role === "procurement_team") {
          prefixes.add("/reports/operations");
        } else {
          prefixes.add("/p2p/total-spend");
        }
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
    role === "procurement_team" ||
    role === "finance" ||
    role === "admin"
  );
}

/** Digitally sign a warehouse GRN — Warehouse Manager (+ Admin support). */
export function canDigitallySignGRN(role: AppRole | undefined): boolean {
  return role === "warehouse" || role === "admin";
}

/**
 * Operational Purchase Order ownership (create / edit / submit / amend /
 * supplier confirmation / delivery tracking). Held by Procurement Team after
 * Procurement Manager completes RFQ → PO Approval. Admin retains support access.
 */
export function canManagePurchaseOrders(role: AppRole | undefined): boolean {
  return role === "procurement_team" || role === "admin";
}

/** Submit a draft Purchase Order — Procurement Team (+ Admin). */
export function canSubmitPurchaseOrder(role: AppRole | undefined): boolean {
  return canManagePurchaseOrders(role);
}

/** Monitor GRN / Invoice / Voucher without mutating finance/warehouse docs. */
export function canMonitorPayablesReadOnly(role: AppRole | undefined): boolean {
  return role === "procurement_team" || role === "admin";
}

/** `/p2p/purchase-orders/:poId` — not list, create, new, or convert routes. */
function isPurchaseOrderDetailPath(pathname: string): boolean {
  if (!pathname.startsWith("/p2p/purchase-orders/")) return false;
  const segment = pathname.slice("/p2p/purchase-orders/".length).split("/")[0];
  if (!segment) return false;
  return segment !== "create" && segment !== "new" && segment !== "convert";
}

/** Focus deep-links removed from Procurement Team navigation. */
const PROCUREMENT_TEAM_BLOCKED_PO_FOCUS = new Set([
  "amendments",
  "confirmation",
  "delivery",
]);

/**
 * Whether `pathname` is allowed for the given role.
 * Optional `search` (e.g. `?focus=confirmation`) is checked for Team deep-link denials.
 */
export function canAccessPath(
  role: AppRole | string,
  pathname: string,
  search = "",
): boolean {
  const normRole = normalizeAppRole(role);
  const path = pathname.split("?")[0];
  const query =
    search ||
    (pathname.includes("?") ? pathname.slice(pathname.indexOf("?")) : "");

  // Supplier portal is a separate auth surface — never via internal RBAC
  if (path === "/supplier" || path.startsWith("/supplier/")) {
    return false;
  }

  // Admin may access every internal route
  if (normRole === "admin") return true;

  // Account / profile module — available to every authenticated internal role
  if (path === "/account" || path.startsWith("/account/")) return true;

  // Hard prefix denials — prevent cross-role URL access even if nav drifts
  if (path === "/admin" || path.startsWith("/admin/")) return false;
  if (path === "/warehouse" || path.startsWith("/warehouse/")) {
    return normRole === "warehouse";
  }
  if (path === "/manufacturing" || path.startsWith("/manufacturing/")) {
    return normRole === "manufacturing";
  }
  if (path === "/department" || path.startsWith("/department/")) {
    if (path === "/department/projects" || path === "/department/programs") {
      return normRole === "department" || normRole === "manufacturing";
    }
    if (normRole === "department") {
      return (
        path === "/department/upload-bom" ||
        path === "/department/temporary-items" ||
        path.startsWith("/department/temporary-items/") ||
        path === "/department/issued-items" ||
        path.startsWith("/department/issued-items/")
      );
    }
    if (normRole === "manufacturing") {
      return (
        path === "/department/temporary-items" ||
        path.startsWith("/department/temporary-items/") ||
        path === "/department/upload-bom"
      );
    }
    return false;
  }
  if (path === "/upload-bom" || path.startsWith("/upload-bom")) {
    return false;
  }
  if (path === "/finance" || path.startsWith("/finance/")) {
    return normRole === "finance";
  }
  if (path === "/legal" || path.startsWith("/legal/")) {
    return normRole === "legal";
  }

  // Engineering Changes (ECR) — route-level permission is more specific than
  // the sidebar module so direct URLs cannot expose creator/procurement actions.
  if (path === "/ecr" || path.startsWith("/ecr/")) {
    const config = ROLE_NAV_CONFIG[normRole];
    if (!config?.modules.includes("engineering_changes")) return false;
    if (path === "/ecr/new") {
      return normRole === "engineer";
    }
    if (/^\/ecr\/[^/]+\/edit$/.test(path)) {
      return normRole === "engineer";
    }
    if (path === "/ecr/purchase-requisitions") {
      return normRole === "procurement" || normRole === "procurement_team";
    }
    return true;
  }

  // Procurement Manager — financial Total Spend only under /p2p; no PO ops pages.
  if (role === "procurement") {
    if (path === "/p2p/total-spend" || path.startsWith("/p2p/total-spend/")) {
      return true;
    }
    if (path === "/p2p" || path.startsWith("/p2p/")) {
      return false;
    }
  }

  // Procurement Team — PO list/create + read-only GRN + supplier directory/performance.
  if (role === "procurement_team") {
    if (
      path === "/dashboard" ||
      path.startsWith("/support") ||
      path.startsWith("/notifications")
    ) {
      return true;
    }
    // Operational reports hub + detail reports (non-financial only).
    if (
      path === "/reports/operations" ||
      path.startsWith("/reports/operations/")
    ) {
      return true;
    }
    // Block other /reports/* financial surfaces if added later.
    if (path === "/reports" || path.startsWith("/reports/")) {
      return false;
    }
    // Financial spend / invoice reports are Manager-only.
    if (path === "/p2p/total-spend" || path.startsWith("/p2p/total-spend/")) {
      return false;
    }
    // Supplier Onboarding is Manager-owned — block Team direct URL access.
    if (
      path === "/suppliers/onboarding" ||
      path.startsWith("/suppliers/onboarding/")
    ) {
      return false;
    }
    if (path === "/suppliers" || path.startsWith("/suppliers/")) return true;
    if (path === "/p2p") return true;
    if (path.startsWith("/p2p/purchase-orders")) {
      // Block removed operational deep-links (pages remain for other roles).
      const focus = new URLSearchParams(
        query.startsWith("?") ? query.slice(1) : query,
      ).get("focus");
      if (focus && PROCUREMENT_TEAM_BLOCKED_PO_FOCUS.has(focus)) {
        return false;
      }
      return true;
    }
    // GRN monitor only — create blocked. Invoices / vouchers are Manager/Finance.
    if (path === "/p2p/grn/new") return false;
    if (path === "/p2p/grn" || path.startsWith("/p2p/grn/")) return true;
    if (path === "/p2p/invoices" || path.startsWith("/p2p/invoices/")) {
      return false;
    }
    if (path === "/p2p/vouchers" || path.startsWith("/p2p/vouchers/")) {
      return false;
    }
    if (path === "/p2p/payments" || path.startsWith("/p2p/payments/")) {
      return false;
    }
    return false;
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
      "/warehouse/material-issue-receipts",
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
    if (
      path === "/department/temporary-items" ||
      path.startsWith("/department/temporary-items/") ||
      path === "/department/upload-bom"
    ) {
      return true;
    }
    return false;
  }

  // Department User — dashboard + department portal + material requests + Business Intake.
  // Business Intake access: Business Needs (list + detail) and Business Cases (read-only).
  // Explicitly denied: Procurement Queue (/intake/pending-business-cases), Intake Dashboard.
  if (role === "department") {
    if (
      path.startsWith("/support") ||
      path.startsWith("/notifications") ||
      path === "/dashboard"
    ) {
      return true;
    }
    // Business Intake access — Department User primary use-case.
    if (path === "/intake/business-needs" || path.startsWith("/intake/business-needs/")) {
      return true;
    }
    // Business Cases: read-only via linked Need records (e.g. from detail page).
    if (path === "/intake/business-cases" || path.startsWith("/intake/business-cases/")) {
      return true;
    }
    // Hard denials for intake routes not permitted to Department User.
    if (path === "/intake/pending-business-cases") return false;
    if (path === "/intake/dashboard") return false;
    if (path === "/department" || path.startsWith("/department/")) {
      if (path === "/department/temporary-items" || path.startsWith("/department/temporary-items/")) {
        return true;
      }
      return (
        path === "/department/upload-bom" ||
        path === "/department/issued-items" ||
        path.startsWith("/department/issued-items/")
      );
    }
    if (path === "/upload-bom" || path.startsWith("/upload-bom/")) {
      return false;
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
  // Finance Executive — budget module + read-only Business Intake.
  if (role === "finance_executive") {
    if (path === "/dashboard" || path.startsWith("/support") || path.startsWith("/notifications")) {
      return true;
    }
    // Business Intake: read-only access to Business Cases and Needs.
    if (path.startsWith("/intake/")) {
      if (path === "/intake/pending-business-cases") return false;
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

  // Finance — Business Intake access (all Business Cases for Finance gate approval).
  if (role === "finance" && path.startsWith("/intake/")) {
    // Finance sees Business Cases and Business Needs but not Procurement-only queue.
    if (path === "/intake/pending-business-cases") return false;
    return true;
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
    // Business Intake: Legal sees Business Cases for Legal gate approval.
    if (path.startsWith("/intake/")) {
      if (path === "/intake/pending-business-cases") return false;
      return true;
    }
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
  if (path === "/p2p/grn/new") return canCreateGRN(normRole);

  // Voucher creation is Finance-only. Block the create screen for every other
  // role (Procurement / Warehouse view vouchers read-only) so it can't be
  // reached by URL manipulation.
  if (path === "/p2p/vouchers/new") return canManageVouchers(normRole);

  // `/p2p` is a pure redirect to the role's first P2P child. Allow the bare
  // index for any role that has the P2P module, without granting siblings.
  if (path === "/p2p") return hasP2PModule(normRole);

  // Payment Processing page lives at /payments/process/:id (outside /p2p/),
  // but should be accessible to any role that can manage payments.
  if (path.startsWith("/payments/")) return canManageVouchers(normRole);

  // Linked PO drill-down from GRN / receipt workflows: roles with GRN or PO
  // module access may open a specific PO detail page (read-only for Warehouse).
  if (isPurchaseOrderDetailPath(path)) {
    const config = ROLE_NAV_CONFIG[normRole] ?? ROLE_NAV_CONFIG.procurement;
    if (
      config.p2pChildren.includes("purchase-orders") ||
      config.p2pChildren.includes("grn")
    ) {
      return true;
    }
  }

  // Enterprise Business Intake module — route-level permissions for roles without early-return blocks.
  // Note: department, finance, finance_executive, and legal roles are handled inline above
  // (they have early-return blocks that preclude reaching this point).
  if (path.startsWith("/intake")) {
    // Procurement Queue — Procurement Manager only.
    // (admin is handled by the early-return guard above and never reaches here)
    if (path === "/intake/pending-business-cases") {
      return normRole === "procurement";
    }
    // Executive Dashboard — Executive and Procurement (read-only).
    if (path === "/intake/dashboard") {
      return normRole === "executive" || normRole === "procurement";
    }
    // All other /intake routes accessible to procurement, executive, finance_executive, etc.
    return true;
  }

  // Material Request routes — role-scoped; procurement sees forwarded queue only.
  if (path.startsWith("/material-requests")) {
    return canAccessMaterialRequestPath(normRole, path);
  }

  // Procurement may create RFQs (including from forwarded MRs / approved Business Cases).
  if (normRole === "procurement" && path === "/sourcing/rfq/new") {
    return true;
  }

  return getAccessPrefixesForRole(normRole).some(
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
