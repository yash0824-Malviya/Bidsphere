import type { TFunction } from "i18next";

/**
 * Maps the English sidebar/nav labels defined in `config/roles.ts` to i18n
 * keys, WITHOUT modifying the role config itself (so permissions, routing and
 * workflow stay byte-for-byte identical — only the visible text is localized).
 * Unknown labels fall back to their original English text.
 */
const NAV_LABEL_KEYS: Record<string, string> = {
  Dashboard: "sidebar.dashboard",
  "Material Requests": "sidebar.materialRequests",
  "Purchase Orders": "sidebar.purchaseOrders",
  "New PO": "sidebar.newPo",
  GRN: "sidebar.grn",
  Vouchers: "sidebar.vouchers",
  Invoices: "sidebar.invoices",
  Payments: "sidebar.payments",
  "All RFQs": "sidebar.allRfqs",
  "New RFQ": "sidebar.newRfq",
  "RFQ Template Library": "sidebar.rfqTemplateLibrary",
  "Legal Reviews": "sidebar.legalReviews",
  "Supplier Quotations": "sidebar.supplierQuotations",
  "Reverse Bidding": "sidebar.reverseBidding",
  "Budget Dashboard": "sidebar.budgetDashboard",
  "Budget Approval": "sidebar.budgetApproval",
  "Budget Monitoring": "sidebar.budgetMonitoring",
  "Budget History": "sidebar.budgetHistory",
  "Create Budget": "sidebar.createBudget",
  "My Budgets": "sidebar.myBudgets",
  "Budget Requests": "sidebar.budgetRequests",
  "Supplier Directory": "sidebar.supplierDirectory",
  "Supplier Performance": "sidebar.supplierPerformance",
  "My Requests": "sidebar.myRequests",
  "Warehouse Review": "sidebar.warehouseReview",
  "Issued Materials": "sidebar.issuedMaterials",
  "Forwarded Material Requests": "sidebar.forwardedMaterialRequests",
  "P2P Core": "sidebar.p2pCore",
  Suppliers: "sidebar.suppliers",
  Inventory: "sidebar.inventory",
  Budget: "sidebar.budget",
  Admin: "sidebar.admin",
  "Audit Trail": "sidebar.auditTrail",
  "Procurement Audit": "sidebar.procurementAudit",
  "Access Logs": "sidebar.accessLogs",
  "User Management": "sidebar.userManagement",
  "Role Management": "sidebar.roleManagement",
  Workflow: "sidebar.workflow",
  Procurement: "sidebar.procurement",
  Reports: "sidebar.reports",
  "Security Settings": "sidebar.securitySettings",
  "System Settings": "sidebar.systemSettings",
  Warehouse: "sidebar.warehouse",
  "Goods Receipt": "sidebar.goodsReceipt",
  "Receive Goods": "sidebar.receiveGoods",
  "GRN List": "sidebar.grnList",
  "Pending Review": "sidebar.pendingReview",
  "Issue Items": "sidebar.issueItems",
  "Ready to Issue": "sidebar.readyToIssue",
  "Issued History": "sidebar.issuedHistory",
  "Procurement Required": "sidebar.procurementRequired",
  "Stock Overview": "sidebar.stockOverview",
  "Item Master": "sidebar.itemMaster",
  "New Request": "sidebar.newRequest",
  "Request History": "sidebar.requestHistory",
  "Track Request": "sidebar.trackRequest",
  "Received Items": "sidebar.receivedItems",
  Notifications: "sidebar.notifications",
  "RFQ Financial Review": "sidebar.rfqFinancialReview",
  Finance: "sidebar.finance",
  Legal: "sidebar.legal",
  Help: "sidebar.help",
  Support: "sidebar.support",
  // Additional breadcrumb / route titles (from utils/routes.ts ROUTE_TITLES)
  "New Material Request": "sidebar.newMaterialRequest",
  "My Material Requests": "sidebar.myMaterialRequests",
  "Create Purchase Order": "sidebar.createPurchaseOrder",
  "Goods Receipt Notes": "sidebar.goodsReceiptNotes",
  "New GRN": "sidebar.newGrn",
  "Create Voucher": "sidebar.createVoucher",
  "New Payment": "sidebar.newPayment",
  "Add Supplier": "sidebar.addSupplier",
  "Sourcing (RFx)": "sidebar.sourcing",
  RFQs: "sidebar.rfqs",
  "Finance Reviews": "sidebar.financeReviews",
  "Budget Plans": "sidebar.budgetPlans",
  "Budget Approvals": "sidebar.budgetApprovals",
  Contracts: "sidebar.contracts",
  "Warehouse Dashboard": "sidebar.warehouseDashboard",
  "Pending Material Requests": "sidebar.pendingMaterialRequests",
  "Review Material Request": "sidebar.reviewMaterialRequest",
  "Material Issued": "sidebar.materialIssuedTitle",
  "Create GRN": "sidebar.createGrn",
  "Warehouse Reports": "sidebar.warehouseReports",
  "Procurement Overview": "sidebar.procurementOverview",
  "Supplier Management": "sidebar.supplierManagement",
  "Inventory Overview": "sidebar.inventoryOverview",
  "Budget Control": "sidebar.budgetControl",
  "Reports & Analytics": "sidebar.reportsAnalytics",
  "Workflow Management": "sidebar.workflowManagement",
  Integrations: "sidebar.integrations",
  Assets: "sidebar.assets",
  "Notification Center": "sidebar.notificationCenter",
  Overview: "sidebar.overview",
};

/** Alias — breadcrumb/route titles reuse the same label map. */
export const translateRouteTitle = translateNavLabel;

/** Translate a sidebar/nav label, falling back to the original English text. */
export function translateNavLabel(
  t: TFunction,
  label: string | undefined | null
): string {
  if (!label) return "";
  const key = NAV_LABEL_KEYS[label];
  return key ? (t(key, { defaultValue: label }) as string) : label;
}
