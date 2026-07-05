import type { LucideIcon } from "lucide-react";
import {
  Banknote,
  ClipboardCheck,
  CreditCard,
  FileSearch,
  PackagePlus,
  Receipt,
  Truck,
  UserPlus,
  Wallet,
} from "lucide-react";

import type { AppRole } from "./roles";
import { ROLE_LABELS } from "./roles";
import type { ActivityFeedItem } from "../utils/dashboardUtils";

export type ExecutiveKpiKey =
  | "totalSpend"
  | "activeSuppliers"
  | "openRfqs"
  | "openPos"
  | "pendingInvoices"
  | "pendingApprovals"
  | "totalPayments"
  | "contractCoverage"
  | "savingsAchieved"
  | "supplierPerformance";

export interface RoleDashboardConfig {
  title: string;
  subtitle: string;
  roleLabel: string;
  statusLabel: string;
}

export interface DashboardQuickAction {
  id: string;
  label: string;
  to: string;
  icon: LucideIcon;
}

export interface ExecutiveDashboardLayout {
  kpiKeys: ExecutiveKpiKey[];
  quickActions: DashboardQuickAction[];
  showSpendCharts: boolean;
  showActivity: boolean;
  activityTitle: string;
  activityTypes: ActivityFeedItem["type"][] | "all";
  showTopSuppliers: boolean;
  showSavings: boolean;
  showAlerts: boolean;
}

// Eight balanced KPIs — fills a 4-column grid as two full rows (no gaps).
const EXECUTIVE_KPI_KEYS: ExecutiveKpiKey[] = [
  "totalSpend",
  "openRfqs",
  "openPos",
  "activeSuppliers",
  "pendingApprovals",
  "contractCoverage",
  "savingsAchieved",
  "supplierPerformance",
];

const PROCUREMENT_KPI_KEYS: ExecutiveKpiKey[] = [
  "totalSpend",
  "openRfqs",
  "openPos",
  "activeSuppliers",
  "pendingApprovals",
  "contractCoverage",
  "savingsAchieved",
  "supplierPerformance",
];

const FINANCE_KPI_KEYS: ExecutiveKpiKey[] = [
  "totalSpend",
  "pendingInvoices",
  "totalPayments",
  "pendingApprovals",
  "openPos",
];

const ADMIN_QUICK_ACTIONS: DashboardQuickAction[] = [
  {
    id: "approve-po",
    label: "Approve PO",
    to: "/p2p/purchase-orders?status=To%20Receive%20and%20Bill",
    icon: ClipboardCheck,
  },
  {
    id: "create-rfq",
    label: "Create RFQ",
    to: "/sourcing/rfq/new",
    icon: FileSearch,
  },
  {
    id: "create-po",
    label: "Create Purchase Order",
    to: "/p2p/purchase-orders/new",
    icon: PackagePlus,
  },
  {
    id: "add-supplier",
    label: "Add Supplier",
    to: "/suppliers/new",
    icon: UserPlus,
  },
  {
    id: "track-shipment",
    label: "Track Shipment",
    to: "/p2p/purchase-orders",
    icon: Truck,
  },
];

const PROCUREMENT_QUICK_ACTIONS: DashboardQuickAction[] = [
  {
    id: "create-rfq",
    label: "Create RFQ",
    to: "/sourcing/rfq/new",
    icon: FileSearch,
  },
  {
    id: "create-po",
    label: "Create Purchase Order",
    to: "/p2p/purchase-orders/new",
    icon: PackagePlus,
  },
  {
    id: "add-supplier",
    label: "Add Supplier",
    to: "/suppliers/new",
    icon: UserPlus,
  },
  {
    id: "approve-po",
    label: "Approve PO",
    to: "/p2p/purchase-orders?status=To%20Receive%20and%20Bill",
    icon: ClipboardCheck,
  },
  {
    id: "track-shipment",
    label: "Track Shipment",
    to: "/p2p/purchase-orders",
    icon: Truck,
  },
];

const FINANCE_QUICK_ACTIONS: DashboardQuickAction[] = [
  {
    id: "review-vouchers",
    label: "Review Vouchers",
    to: "/p2p/vouchers",
    icon: Receipt,
  },
  {
    id: "process-payment",
    label: "Process Payment",
    to: "/p2p/payments/new",
    icon: CreditCard,
  },
  {
    id: "view-payments",
    label: "View Payments",
    to: "/p2p/payments",
    icon: Banknote,
  },
  {
    id: "budget",
    label: "Budget Overview",
    to: "/budget",
    icon: Wallet,
  },
];

/** Dashboard title, subtitle, and badge copy per authenticated role. */
export const DASHBOARD_BY_ROLE: Record<AppRole, RoleDashboardConfig> = {
  admin: {
    title: "Admin Dashboard",
    subtitle: "Executive procurement control center",
    roleLabel: ROLE_LABELS.admin,
    statusLabel: "Live",
  },
  procurement: {
    title: "Procurement Manager Dashboard",
    subtitle: "Manage sourcing, suppliers and purchasing operations",
    roleLabel: ROLE_LABELS.procurement,
    statusLabel: "Procurement",
  },
  finance: {
    title: "Finance Manager Dashboard",
    subtitle: "Monitor invoices, payments and financial performance",
    roleLabel: ROLE_LABELS.finance,
    statusLabel: "Finance",
  },
  finance_executive: {
    title: "Finance Executive Dashboard",
    subtitle: "Create and submit budgets for approval",
    roleLabel: ROLE_LABELS.finance_executive,
    statusLabel: "Budget",
  },
  warehouse: {
    title: "Warehouse Module",
    subtitle: "This module is currently under redevelopment",
    roleLabel: ROLE_LABELS.warehouse,
    statusLabel: "Redevelopment",
  },
  legal: {
    title: "Legal Reviewer Dashboard",
    subtitle: "Review and approve RFQs pending legal clearance",
    roleLabel: ROLE_LABELS.legal,
    statusLabel: "Legal",
  },
  department: {
    title: "Department User Dashboard",
    subtitle: "Create and track your material requests",
    roleLabel: ROLE_LABELS.department,
    statusLabel: "Department User",
  },
};

/** Supplier portal dashboard copy (separate auth surface). */
export const SUPPLIER_DASHBOARD_CONFIG: RoleDashboardConfig = {
  title: "Supplier Dashboard",
  subtitle: "Manage quotations, orders and payments",
  roleLabel: "Supplier",
  statusLabel: "Supplier Portal",
};

const EXECUTIVE_LAYOUT_BY_ROLE: Record<
  Exclude<AppRole, "warehouse" | "legal" | "department">,
  ExecutiveDashboardLayout
> = {
  admin: {
    kpiKeys: EXECUTIVE_KPI_KEYS,
    quickActions: ADMIN_QUICK_ACTIONS,
    showSpendCharts: true,
    showActivity: true,
    activityTitle: "Recent Procurement Activity",
    activityTypes: "all",
    showTopSuppliers: true,
    showSavings: true,
    showAlerts: true,
  },
  procurement: {
    kpiKeys: PROCUREMENT_KPI_KEYS,
    quickActions: PROCUREMENT_QUICK_ACTIONS,
    showSpendCharts: true,
    showActivity: true,
    activityTitle: "Recent Procurement Activity",
    activityTypes: ["rfq", "po"],
    showTopSuppliers: true,
    showSavings: true,
    showAlerts: true,
  },
  finance: {
    kpiKeys: FINANCE_KPI_KEYS,
    quickActions: FINANCE_QUICK_ACTIONS,
    showSpendCharts: true,
    showActivity: true,
    activityTitle: "Recent Financial Activity",
    activityTypes: ["invoice", "payment"],
    showTopSuppliers: false,
    showSavings: false,
    showAlerts: true,
  },
  finance_executive: {
    kpiKeys: ["pendingApprovals", "totalPayments"] as ExecutiveKpiKey[],
    quickActions: [
      { id: "create-budget", label: "Create Budget", to: "/budget/create", icon: Wallet },
      { id: "my-budgets", label: "My Budgets", to: "/budget/my-budgets", icon: ClipboardCheck },
    ],
    showSpendCharts: false,
    showActivity: false,
    activityTitle: "Budget Activity",
    activityTypes: [],
    showTopSuppliers: false,
    showSavings: false,
    showAlerts: false,
  },
};

export function getDashboardConfig(role: AppRole): RoleDashboardConfig {
  return DASHBOARD_BY_ROLE[role] ?? DASHBOARD_BY_ROLE.admin;
}

export function getExecutiveDashboardLayout(
  role: Exclude<AppRole, "warehouse" | "legal" | "department">
): ExecutiveDashboardLayout {
  return EXECUTIVE_LAYOUT_BY_ROLE[role] ?? EXECUTIVE_LAYOUT_BY_ROLE.admin;
}

export function filterActivityByRole(
  items: ActivityFeedItem[],
  role: Exclude<AppRole, "warehouse" | "legal" | "department">
): ActivityFeedItem[] {
  const { activityTypes } = getExecutiveDashboardLayout(role);
  if (activityTypes === "all") return items;
  const allowed = new Set(activityTypes);
  return items.filter((item) => allowed.has(item.type));
}
