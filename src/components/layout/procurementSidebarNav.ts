import {
  Briefcase,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Factory,
  FileCode,
  FileSearch,
  FileSpreadsheet,
  FileText,
  HelpCircle,
  LayoutDashboard,
  PackagePlus,
  Receipt,
  Shield,
  ShoppingCart,
  UserCheck,
  Users,
  Wallet,
} from "lucide-react";
import type { NavGroup, NavItem } from "../../utils/routes";
import { canAccessPath, canManagePurchaseOrders, normalizeAppRole } from "../../config/roles";

export interface SidebarNavItem extends NavItem {
  childActiveState?: boolean;
  engineerNavigation?: boolean;
  engineeringManagerNavigation?: boolean;
}

export interface SidebarNavGroup extends Omit<NavGroup, "items"> {
  items: SidebarNavItem[];
}

/**
 * Procurement sidebar organization grouped under standard business pillars:
 * - Overview: Dashboard
 * - Intake & Engineering: Business Intake, Engineering Changes
 * - Sourcing: RFQs, RFIs, RFPs, Supplier Quotations, Supplier Selection and Award
 * - Contracts: Contract Lifecycle, Contracts, Contract Requests
 * - Purchasing & Receiving: Purchase Orders, Goods Receipt Notes, Invoices, Payments
 * - Supplier Management: Supplier Onboarding, Suppliers
 * - Reports & Administration: Authorized reports and administration pages
 */
export function procurementSidebarGroups(groups: NavGroup[], role: string): SidebarNavGroup[] {
  const normRole = normalizeAppRole(role);
  const supportGroup = groups.find((g) => g.label === "Support" || g.label === "Help");

  const overviewItems: SidebarNavItem[] = [
    { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard },
  ];

  const intakeEngineeringItems: SidebarNavItem[] = [];
  if (canAccessPath(normRole, "/intake/business-cases")) {
    intakeEngineeringItems.push({
      label: "Business Intake",
      to: "/intake/business-cases",
      icon: Briefcase,
      children: [
        { label: "Business Cases", to: "/intake/business-cases" },
      ],
    });
  }
  if (canAccessPath(normRole, "/ecr")) {
    intakeEngineeringItems.push({
      label: "Engineering Changes",
      to: "/ecr",
      icon: Factory,
      children: [
        { label: "ECR Queue", to: "/ecr" },
      ],
    });
  }

  const sourcingItems: SidebarNavItem[] = [];
  if (canAccessPath(normRole, "/sourcing/rfq")) {
    sourcingItems.push({
      label: "RFQs",
      to: "/sourcing/rfq",
      icon: FileSearch,
    });
  }
  if (canAccessPath(normRole, "/sourcing/rfi")) {
    sourcingItems.push({
      label: "RFIs",
      to: "/sourcing/rfi",
      icon: FileText,
    });
  }
  if (canAccessPath(normRole, "/sourcing/rfp")) {
    sourcingItems.push({
      label: "RFPs",
      to: "/sourcing/rfp",
      icon: FileCode,
    });
  }
  if (canAccessPath(normRole, "/sourcing/quotations")) {
    sourcingItems.push({
      label: "Supplier Quotations",
      to: "/sourcing/quotations",
      icon: FileSpreadsheet,
    });
  }
  if (canAccessPath(normRole, "/sourcing/rfq")) {
    sourcingItems.push({
      label: "Supplier Selection and Award",
      to: "/sourcing/rfq?status=Supplier+Selection",
      icon: CheckCircle2,
      childActiveState: true,
    });
  }

  const contractsItems: SidebarNavItem[] = [];
  if (canAccessPath(normRole, "/contracts")) {
    const contractChildren: NavItem["children"] = [{ label: "Contracts", to: "/contracts" }];
    if (canAccessPath(normRole, "/contract-requests")) {
      contractChildren.push({ label: "Contract Requests", to: "/contract-requests" });
    }
    contractsItems.push({
      label: "Contract Lifecycle",
      to: "/contracts",
      icon: FileText,
      children: contractChildren,
    });
  }

  const purchasingItems: SidebarNavItem[] = [];
  if (
    canAccessPath(normRole, "/material-requests/procurement") ||
    canAccessPath(normRole, "/material-requests")
  ) {
    purchasingItems.push({
      label: "Material Requests",
      to: "/material-requests/procurement",
      icon: ClipboardList,
    });
  }
  if (canAccessPath(normRole, "/p2p/purchase-orders")) {
    const poChildren: NavItem["children"] = [{ label: "Purchase Orders", to: "/p2p/purchase-orders" }];
    if (canManagePurchaseOrders(normRole)) {
      poChildren.push({ label: "New PO", to: "/p2p/purchase-orders/create", badgeKey: "newPoQueue" });
    }
    purchasingItems.push({
      label: "Purchase Orders",
      to: "/p2p/purchase-orders",
      icon: ShoppingCart,
      children: poChildren,
    });
  }
  if (canAccessPath(normRole, "/p2p/grn")) {
    purchasingItems.push({
      label: "Goods Receipt Notes",
      to: "/p2p/grn",
      icon: PackagePlus,
    });
  }
  if (canAccessPath(normRole, "/p2p/invoices")) {
    purchasingItems.push({
      label: "Invoices",
      to: "/p2p/invoices",
      icon: Receipt,
    });
  }
  if (canAccessPath(normRole, "/p2p/payments")) {
    purchasingItems.push({
      label: "Payments",
      to: "/p2p/payments",
      icon: Wallet,
    });
  }

  const supplierItems: SidebarNavItem[] = [];
  if (canAccessPath(normRole, "/suppliers/onboarding")) {
    supplierItems.push({
      label: "Supplier Onboarding",
      to: "/suppliers/onboarding",
      icon: UserCheck,
    });
  }
  if (canAccessPath(normRole, "/suppliers")) {
    supplierItems.push({
      label: "Suppliers",
      to: "/suppliers",
      icon: Users,
      children: [
        { label: "Supplier Directory", to: "/suppliers" },
        { label: "Supplier Performance", to: "/suppliers?tab=performance" },
      ],
    });
  }

  const reportsAdminItems: SidebarNavItem[] = [];
  if (canAccessPath(normRole, "/reports/operations")) {
    reportsAdminItems.push({
      label: "Reports",
      to: "/reports/operations",
      icon: ClipboardCheck,
    });
  }
  if (canAccessPath(normRole, "/admin")) {
    reportsAdminItems.push({
      label: "Administration",
      to: "/admin",
      icon: Shield,
    });
  }

  const result: SidebarNavGroup[] = [
    { label: "Overview", items: overviewItems },
    { label: "Intake & Engineering", items: intakeEngineeringItems },
    { label: "Sourcing", items: sourcingItems },
    { label: "Contracts", items: contractsItems },
    { label: "Purchasing & Receiving", items: purchasingItems },
    { label: "Supplier Management", items: supplierItems },
    { label: "Reports & Administration", items: reportsAdminItems },
  ];

  if (supportGroup) {
    result.push({
      label: "Help",
      items: supportGroup.items.map((it) => ({
        ...it,
        label: it.label || "Help & Support",
        icon: HelpCircle,
      })),
    });
  }

  return result.filter((g) => g.items.length > 0);
}
