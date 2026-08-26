import { describe, expect, it } from "vitest";

import { canAccessPath } from "./roles";
import { PROCUREMENT_DASHBOARD_LINKS } from "./procurementDashboardLinks";

describe("Procurement Manager dashboard links", () => {
  it("keeps every executive and ECR summary link inside Procurement access", () => {
    for (const [key, to] of Object.entries(PROCUREMENT_DASHBOARD_LINKS)) {
      const url = new URL(to, "https://bidsphere.test");
      expect(
        canAccessPath("procurement", url.pathname, url.search),
        `${key} points to blocked dashboard route ${to}`,
      ).toBe(true);
    }
  });

  it("routes approval and PO cards to relevant Procurement-owned views", () => {
    expect(PROCUREMENT_DASHBOARD_LINKS.pendingApprovals).toBe(
      "/sourcing/rfq?preset=open",
    );
    expect(PROCUREMENT_DASHBOARD_LINKS.purchaseOrders).toBe(
      "/p2p/total-spend",
    );
    expect(PROCUREMENT_DASHBOARD_LINKS.spendByCategoryReport).toBe(
      "/p2p/total-spend",
    );
    expect(PROCUREMENT_DASHBOARD_LINKS.recentPurchaseOrders).toBe(
      "/p2p/total-spend",
    );
  });
});
