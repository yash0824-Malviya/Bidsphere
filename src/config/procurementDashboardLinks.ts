/**
 * Procurement Manager dashboard destinations.
 *
 * Keep these centralized so KPI cards cannot drift onto routes blocked by the
 * same role's route guard.
 */
export const PROCUREMENT_DASHBOARD_LINKS = {
  totalSpend: "/p2p/total-spend",
  activeRfqs: "/sourcing/rfq?preset=open",
  pendingQuotes: "/sourcing/rfq?preset=open",
  pendingApprovals: "/sourcing/rfq?preset=open",
  activeSuppliers: "/suppliers?status=active",
  purchaseOrders: "/p2p/total-spend",
  spendByCategoryReport: "/p2p/total-spend",
  recentPurchaseOrders: "/p2p/total-spend",
  averageRfqCycle: "/sourcing/rfq",
  costSavings: "/budget",
  rfqsPendingCreation: "/ecr?filter=rfq-pending",
  approvedEcrsAwaitingAction: "/ecr?filter=approved",
  ecrRfqsCreated: "/ecr?filter=rfq-created",
} as const;

export type ProcurementDashboardLinkKey =
  keyof typeof PROCUREMENT_DASHBOARD_LINKS;
