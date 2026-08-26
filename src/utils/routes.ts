import {
  Boxes,
  FileSearch,
  HelpCircle,
  LayoutDashboard,
  ShoppingCart,
  Users,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { APP_NAME } from "../config/branding";
import type { AppRole } from "../config/roles";

import { FEATURE_FLAGS } from "../config/featureFlags";
import { formatECRNumber } from "../config/ecrRoles";

export interface NavChild {
  label: string;
  to: string;
  /** Optional section header rendered above this child in the sidebar. */
  group?: string;
}

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  children?: NavChild[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

const P2P_CHILDREN: NavChild[] = [
  ...(FEATURE_FLAGS.showMaterialRequests
    ? [{ label: "Material Requests", to: "/p2p/requisitions" }]
    : []),
  { label: "Purchase Orders", to: "/p2p/purchase-orders" },
  { label: "New PO", to: "/p2p/purchase-orders/create" },
  { label: "GRN", to: "/p2p/grn" },
  { label: "Vouchers", to: "/p2p/vouchers" },
  { label: "Invoices", to: "/p2p/invoices" },
  { label: "Payments", to: "/p2p/payments" },
];

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "",
    items: [
      { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard },
      {
        label: "P2P Core",
        to: "/p2p",
        icon: ShoppingCart,
        children: P2P_CHILDREN,
      },
      { label: "Suppliers", to: "/suppliers", icon: Users,
        children: [
          { label: "Supplier Directory", to: "/suppliers" },
          { label: "Supplier Onboarding", to: "/suppliers/onboarding" },
          { label: "Supplier Performance", to: "/suppliers?tab=performance" },
        ],
      },
      {
        label: "Sourcing (RFx)",
        to: "/sourcing/rfq",
        icon: FileSearch,
        children: [
          { label: "All RFIs", to: "/sourcing/rfi" },
          { label: "All RFPs", to: "/sourcing/rfp" },
          { label: "All RFQs", to: "/sourcing/rfq" },
          { label: "RFQ Template Library", to: "/sourcing/rfq-templates" },
          { label: "Legal Reviews", to: "/legal/reviews" },
        ],
      },
      {
        label: "Budget",
        to: "/budget",
        icon: Wallet,
        children: [
          { label: "Overview", to: "/budget" },
          { label: "RFQ Financial Review", to: "/budget/pending-reviews" },
        ],
      },
      { label: "Inventory", to: "/inventory", icon: Boxes },
    ],
  },
  {
    label: "Support",
    items: [
      { label: "Help", to: "/support/help-desk", icon: HelpCircle },
    ],
  },
];

/** Flat list — used by search and legacy imports. */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export const ROUTE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/ecr": "ECR",
  "/ecr/new": "New Change Request",
  "/ecr/purchase-requisitions": "Purchase Requisitions",
  "/ecr/rfq-master": "RFQ Master",
  "/intake": "Business Intake",
  "/intake/pending-business-cases": "Pending Business Cases",
  "/intake/business-needs": "Business Needs",
  "/intake/business-needs/new": "Business Need Intake",
  "/intake/business-cases": "Business Cases",
  "/intake/dashboard": "Intake Dashboard",
  "/p2p": "P2P Core",
  "/p2p/requisitions": "Material Requests",
  "/p2p/requisitions/new": "New Material Request",
  "/material-requests": "Material Requests",
  "/material-requests/list": "Request History",
  "/material-requests/new": "New Material Request",
  "/material-requests/warehouse": "Warehouse Review",
  "/material-requests/issued": "Issued Materials",
  "/material-requests/procurement": "Forwarded Material Requests",
  "/material-requests/history": "Forwarded History",
  "/department/issued-items": "Issued Items",
  "/department/issued-items/pending-acceptance": "Pending Acceptance",
  "/department/issued-items/accepted-items": "Issue Receipts",
  "/department/issued-items/issue-receipts": "Issue Receipts",
  "/p2p/purchase-orders": "Purchase Orders",
  "/p2p/purchase-orders/create": "New PO",
  "/p2p/purchase-orders/convert": "Create Purchase Order",
  "/p2p/purchase-orders/new": "Create Purchase Order",
  "/p2p/grn": "Goods Receipt Notes",
  "/p2p/grn/new": "New GRN",
  "/p2p/vouchers": "Vouchers",
  "/p2p/vouchers/new": "Create Voucher",
  "/p2p/invoices": "Invoices",
  "/p2p/total-spend": "Total Spend Details",
  "/p2p/payments": "Payments",
  "/p2p/payments/new": "New Payment",
  "/suppliers": "Suppliers",
  "/suppliers/onboarding": "Supplier Onboarding",
  "/suppliers/new": "Add Supplier",
  "/sourcing": "Sourcing (RFx)",
  "/sourcing/rfi": "RFIs",
  "/sourcing/rfi/new": "Create RFI",
  "/sourcing/rfp": "RFPs",
  "/sourcing/rfp/new": "Create RFP",
  "/sourcing/rfq": "RFQs",
  "/sourcing/rfi/responses": "Supplier Responses",
  "/sourcing/rfp/responses": "Supplier Responses",
  "/sourcing/rfq/new": "New RFQ",
  "/upload-bom": "Upload BOM",
  "/sourcing/upload-bom": "Upload BOM",
  "/department": "Department",
  "/department/upload-bom": "Department BOM Upload",
  "/department/temporary-items": "Temporary Item Store",
  "/sourcing/rfq-templates": "RFQ Template Library",
  "/sourcing/legal-reviews": "Legal Reviews",
  "/sourcing/reverse-bidding": "Reverse Bidding",
  "/legal": "Legal",
  "/legal/reviews": "Legal Reviews",
  "/finance": "Finance",
  "/finance/reviews": "Finance Reviews",
  "/budget": "Budget Dashboard",
  "/budget/plans": "Budget Plans",
  "/budget/monitoring": "Budget Monitoring",
  "/budget/approvals": "Budget Approvals",
  "/budget/pending-reviews": "RFQ Financial Review",
  "/contracts": "Contracts",
  "/inventory": "Inventory",
  "/manufacturing": "Manufacturing",
  "/manufacturing/boms": "BOM Management",
  "/manufacturing/boms/list": "BOM List",
  "/manufacturing/boms/new": "Create BOM",
  "/manufacturing/finished-products": "Finished Products",
  "/warehouse/dashboard": "Warehouse Dashboard",
  "/warehouse/material-requests/pending": "Pending Material Requests",
  "/warehouse/material-requests/review": "Review Material Request",
  "/warehouse/material-requests/issued": "Material Issued",
  "/warehouse/material-requests/forwarded": "Procurement Required",
  "/warehouse/material-requests/history": "Forwarded History",
  "/warehouse/inventory/stock": "Stock Overview",
  "/warehouse/inventory/stock-overview": "Stock Overview",
  "/warehouse/inventory/create-grn": "Create GRN",
  "/warehouse/grn-list": "GRN List",
  "/warehouse/inventory/items": "Item Master",
  "/warehouse/inventory/items/new": "Add Item",
  "/warehouse/reports": "Warehouse Reports",
  "/admin": "Admin",
  "/admin/approvals": "Approval Center",
  "/admin/approvals/pending": "Pending Approvals",
  "/admin/approvals/approved": "Approved Requests",
  "/admin/users": "User Management",
  "/admin/roles": "Role Management",
  "/admin/procurement": "Procurement Overview",
  "/admin/suppliers": "Supplier Management",
  "/admin/inventory": "Inventory Overview",
  "/admin/budget": "Budget Control",
  "/admin/audit-trail": "Audit Trail",
  "/admin/procurement-audit": "Procurement Audit",
  "/admin/workflows": "Workflow Management",
  "/admin/reports": "Reports & Analytics",
  "/admin/access-logs": "Access Logs",
  "/admin/security-settings": "Security Settings",
  "/admin/settings": "System Settings",
  "/admin/sla-configuration": "SLA Configuration",
  "/admin/sla-dashboard": "SLA Dashboard",
  "/admin/sla-reports": "SLA Reports",
  "/admin/integrations": "Integrations",
  "/assets": "Assets",
  "/notifications": "Notification Center",
  "/support": "Support",
  "/support/help-desk": "Help",
  "/account": "Account",
  "/account/profile": "My Profile",
  "/account/change-password": "Change Password",
};

export interface Breadcrumb {
  label: string;
  to: string;
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function getBreadcrumbs(pathname: string): Breadcrumb[] {
  const segments = pathname.split("/").filter(Boolean);
  const crumbs: Breadcrumb[] = [];
  let acc = "";
  for (let idx = 0; idx < segments.length; idx++) {
    const seg = segments[idx];
    acc += `/${seg}`;
    const decoded = decodePathSegment(seg);
    let label: string;
    if (ROUTE_TITLES[acc]) {
      // Prefer static module titles (e.g. /sourcing → "Sourcing (RFx)", /ecr → "ECR").
      label = ROUTE_TITLES[acc];
    } else if (segments[0] === "ecr" && idx === 1 && decoded !== "new" && decoded !== "purchase-requisitions" && decoded !== "rfq-master") {
      // Format dynamic ECR business numbers (e.g. ECR-2026-85517) instead of raw DB id
      label = formatECRNumber(decoded);
    } else if (looksLikeDocumentId(seg)) {
      // Keep ERPNext document names intact (PUR-RFQ-2026-00067, MAT-MR-…).
      label = decoded;
    } else if (decoded.includes("-") && !decoded.includes(" ")) {
      label = toTitleCase(decoded);
    } else {
      label = decoded;
    }
    crumbs.push({ label, to: acc });
  }
  return crumbs;
}

/**
 * Detect ERPNext-style document identifiers / record ids. Shown as the last
 * breadcrumb crumb (and page content title) but never as a module page title.
 */
function looksLikeDocumentId(segment: string): boolean {
  const s = decodePathSegment(segment).trim();
  if (!s) return false;
  if (/\d/.test(s) && /[-_]/.test(s)) return true; // MAT-MR-2026-00001, RFQ-2026-0001
  if (/^\d+$/.test(s)) return true; // 000123
  if (/^[A-Za-z]{2,}-?\d{2,}$/.test(s)) return true; // PO-00015, SQ0008
  if (/^[0-9a-f]{8,}$/i.test(s)) return true; // uuid / hash fragment
  return false;
}

/**
 * The large title in the global header is ALWAYS the page/module name — never
 * a document number. For detail routes (…/:id) with no exact title, we walk up
 * the path to the nearest ancestor that has a static module title (so
 * `/…/review/MAT-MR-2026-00001` → "Review Material Request"). The breadcrumb is
 * unaffected and still shows the document number as its last crumb.
 */
export function getPageTitle(pathname: string): string {
  if (ROUTE_TITLES[pathname]) return ROUTE_TITLES[pathname];

  const segments = pathname.split("/").filter(Boolean);

  // Nearest ancestor path with a known static module title.
  for (let i = segments.length - 1; i > 0; i -= 1) {
    const ancestor = `/${segments.slice(0, i).join("/")}`;
    if (ROUTE_TITLES[ancestor]) return ROUTE_TITLES[ancestor];
  }

  // No known ancestor — fall back to the last readable, non-document segment.
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    if (looksLikeDocumentId(segments[i])) continue;
    const decoded = decodePathSegment(segments[i]);
    return decoded.includes("-") && !decoded.includes(" ")
      ? toTitleCase(decoded)
      : decoded;
  }

  return APP_NAME;
}

/** Landing page — no breadcrumb trail in the global header. */
export function isDashboardRoute(pathname: string, role?: AppRole): boolean {
  if (pathname === "/dashboard" || pathname === "/") return true;
  if (role === "finance_executive" && pathname === "/budget") return true;
  if ((role === "finance" || role === "admin") && pathname === "/budget") return true;
  return false;
}

function toTitleCase(seg: string): string {
  return seg
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}
