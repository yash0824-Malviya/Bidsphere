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
          { label: "Supplier Performance", to: "/suppliers?tab=performance" },
        ],
      },
      {
        label: "Sourcing (RFx)",
        to: "/sourcing/rfq",
        icon: FileSearch,
        children: [
          { label: "All RFQs", to: "/sourcing/rfq" },
          { label: "New RFQ", to: "/sourcing/rfq/new" },
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
  "/p2p": "P2P Core",
  "/p2p/requisitions": "Material Requests",
  "/p2p/requisitions/new": "New Material Request",
  "/material-requests": "Material Requests",
  "/material-requests/list": "My Material Requests",
  "/material-requests/new": "New Material Request",
  "/material-requests/warehouse": "Warehouse Review",
  "/material-requests/issued": "Issued Materials",
  "/material-requests/procurement": "Forwarded Material Requests",
  "/sourcing/supplier-quotations": "Supplier Quotations",
  "/p2p/purchase-orders": "Purchase Orders",
  "/p2p/purchase-orders/create": "New PO",
  "/p2p/purchase-orders/convert": "Create Purchase Order",
  "/p2p/purchase-orders/new": "Create Purchase Order",
  "/p2p/grn": "Goods Receipt Notes",
  "/p2p/grn/new": "New GRN",
  "/p2p/vouchers": "Vouchers",
  "/p2p/vouchers/new": "Create Voucher",
  "/p2p/invoices": "Invoices",
  "/p2p/payments": "Payments",
  "/p2p/payments/new": "New Payment",
  "/suppliers": "Suppliers",
  "/suppliers/new": "Add Supplier",
  "/sourcing": "Sourcing (RFx)",
  "/sourcing/rfq": "RFQs",
  "/sourcing/rfq/new": "New RFQ",
  "/sourcing/rfq-templates": "RFQ Template Library",
  "/sourcing/legal-reviews": "Legal Reviews",
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
  "/warehouse/dashboard": "Warehouse Dashboard",
  "/warehouse/material-requests/pending": "Pending Material Requests",
  "/warehouse/material-requests/review": "Review Material Request",
  "/warehouse/material-requests/issued": "Material Issued",
  "/warehouse/material-requests/forwarded": "Forwarded Material Requests",
  "/warehouse/inventory/stock": "Stock Overview",
  "/warehouse/inventory/stock-overview": "Stock Overview",
  "/warehouse/inventory/create-grn": "Create GRN",
  "/warehouse/grn-list": "GRN List",
  "/warehouse/inventory/items": "Item Master",
  "/warehouse/reports": "Warehouse Reports",
  "/admin": "Admin",
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
  "/admin/integrations": "Integrations",
  "/assets": "Assets",
  "/notifications": "Notification Center",
  "/support": "Support",
  "/support/help-desk": "Help",
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
  for (const seg of segments) {
    acc += `/${seg}`;
    const decoded = decodePathSegment(seg);
    crumbs.push({
      label: ROUTE_TITLES[acc] ?? (decoded.includes("-") && !decoded.includes(" ") ? toTitleCase(decoded) : decoded),
      to: acc,
    });
  }
  return crumbs;
}

export function getPageTitle(pathname: string): string {
  if (ROUTE_TITLES[pathname]) return ROUTE_TITLES[pathname];
  const crumbs = getBreadcrumbs(pathname);
  return crumbs.length > 0 ? crumbs[crumbs.length - 1].label : APP_NAME;
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
