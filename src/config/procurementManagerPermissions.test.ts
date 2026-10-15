import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  canAccessPath,
  canManagePurchaseOrders,
  canSubmitPurchaseOrder,
} from "./roles";
import {
  createPurchaseOrder,
  createPurchaseOrderFromRFQ,
  submitPurchaseOrder,
} from "../api/purchasing";
import { useAuthStore } from "../store/authStore";

// Mock erpnext call so if permission passes, it calls erpFetch and apiGet
vi.mock("../api/erpnext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/erpnext")>();
  return {
    ...actual,
    erpFetch: vi.fn().mockResolvedValue({ message: { name: "PUR-ORD-TEST" } }),
    apiGet: vi.fn().mockResolvedValue([{ name: "Supplier A", disabled: 0 }]),
    apiPost: vi.fn().mockResolvedValue({ name: "PUR-ORD-TEST" }),
  };
});

describe("Procurement Manager Permissions & Purchase Orders Read-Only Access", () => {
  describe("Role helpers for Purchase Orders", () => {
    it("denies PO management and submission to Procurement Manager", () => {
      expect(canManagePurchaseOrders("procurement")).toBe(false);
      expect(canManagePurchaseOrders("Procurement Manager")).toBe(false);
      expect(canSubmitPurchaseOrder("procurement")).toBe(false);
      expect(canSubmitPurchaseOrder("Procurement Manager")).toBe(false);
    });

    it("preserves PO management and submission for authorized roles (procurement_team, admin)", () => {
      expect(canManagePurchaseOrders("procurement_team")).toBe(true);
      expect(canManagePurchaseOrders("Procurement Team")).toBe(true);
      expect(canManagePurchaseOrders("admin")).toBe(true);
      expect(canManagePurchaseOrders("Administrator")).toBe(true);

      expect(canSubmitPurchaseOrder("procurement_team")).toBe(true);
      expect(canSubmitPurchaseOrder("admin")).toBe(true);
    });
  });

  describe("Route access controls for Procurement Manager", () => {
    it("allows Procurement Manager read-only access to PO list and saved PO details", () => {
      expect(canAccessPath("procurement", "/p2p/purchase-orders")).toBe(true);
      expect(canAccessPath("Procurement Manager", "/p2p/purchase-orders")).toBe(true);
      expect(canAccessPath("procurement", "/p2p/purchase-orders/PUR-ORD-2026-00001")).toBe(true);
      expect(canAccessPath("Procurement Manager", "/p2p/purchase-orders/PUR-ORD-2026-00001")).toBe(true);
    });

    it("blocks Procurement Manager from PO creation and conversion routes", () => {
      expect(canAccessPath("procurement", "/p2p/purchase-orders/create")).toBe(false);
      expect(canAccessPath("Procurement Manager", "/p2p/purchase-orders/create")).toBe(false);
      expect(canAccessPath("procurement", "/p2p/purchase-orders/new")).toBe(false);
      expect(canAccessPath("Procurement Manager", "/p2p/purchase-orders/new")).toBe(false);
      expect(canAccessPath("procurement", "/p2p/purchase-orders/convert/RFQ-001")).toBe(false);
      expect(canAccessPath("Procurement Manager", "/p2p/purchase-orders/convert/RFQ-001")).toBe(false);
    });

    it("allows authorized roles (procurement_team, admin) to access PO creation routes", () => {
      expect(canAccessPath("procurement_team", "/p2p/purchase-orders/create")).toBe(true);
      expect(canAccessPath("admin", "/p2p/purchase-orders/create")).toBe(true);
      expect(canAccessPath("procurement_team", "/p2p/purchase-orders/convert/RFQ-001")).toBe(true);
      expect(canAccessPath("admin", "/p2p/purchase-orders/convert/RFQ-001")).toBe(true);
    });

    it("ensures Material Requests routes are fully accessible to Procurement Manager", () => {
      expect(canAccessPath("procurement", "/material-requests")).toBe(true);
      expect(canAccessPath("procurement", "/material-requests/procurement")).toBe(true);
      expect(canAccessPath("procurement", "/material-requests/history")).toBe(true);
      expect(canAccessPath("procurement", "/material-requests/MAT-REQ-2026-0001")).toBe(true);
    });

    it("preserves all other Procurement Manager workflows", () => {
      expect(canAccessPath("procurement", "/sourcing/rfq")).toBe(true);
      expect(canAccessPath("procurement", "/sourcing/rfq/new")).toBe(true);
      expect(canAccessPath("procurement", "/sourcing/rfq/RFQ-001")).toBe(true);
      expect(canAccessPath("procurement", "/intake/business-cases")).toBe(true);
      expect(canAccessPath("procurement", "/ecr")).toBe(true);
      expect(canAccessPath("procurement", "/suppliers")).toBe(true);
    });
  });

  describe("API Protection against PO write actions by Procurement Manager", () => {
    beforeEach(() => {
      useAuthStore.setState({
        user: {
          name: "procurement.manager@example.com",
          email: "procurement.manager@example.com",
          full_name: "Procurement Manager",
          role: "procurement",
        },
      });
    });

    it("rejects createPurchaseOrder when called by Procurement Manager", async () => {
      await expect(
        createPurchaseOrder({
          supplier: "Supplier A",
          schedule_date: "2026-10-20",
          items: [],
        }),
      ).rejects.toThrow("Purchase Order creation is restricted to authorized roles");
    });

    it("rejects createPurchaseOrderFromRFQ when called by Procurement Manager", async () => {
      await expect(
        createPurchaseOrderFromRFQ("RFQ-001"),
      ).rejects.toThrow("Purchase Order creation is restricted to authorized roles");
    });

    it("rejects submitPurchaseOrder when called by Procurement Manager", async () => {
      await expect(
        submitPurchaseOrder("PUR-ORD-001"),
      ).rejects.toThrow("Purchase Order submission is restricted to authorized roles");
    });

    it("permits createPurchaseOrder when called by authorized role (procurement_team)", async () => {
      useAuthStore.setState({
        user: {
          name: "buyer@example.com",
          email: "buyer@example.com",
          full_name: "Buyer",
          role: "procurement_team",
        },
      });

      await expect(
        createPurchaseOrder({
          supplier: "Supplier A",
          schedule_date: "2026-10-20",
          items: [],
        }),
      ).resolves.toBeDefined();
    });
  });

  describe("Sidebar Navigation for Procurement Manager", () => {
    it("includes Material Requests under Purchasing & Receiving above Purchase Orders", async () => {
      const { procurementSidebarGroups } = await import("../components/layout/procurementSidebarNav");
      const groups = procurementSidebarGroups([], "procurement");
      const purchasingGroup = groups.find((g) => g.label === "Purchasing & Receiving");
      expect(purchasingGroup).toBeDefined();

      const items = purchasingGroup!.items;
      const mrIndex = items.findIndex((it) => it.label === "Material Requests");
      const poIndex = items.findIndex((it) => it.label === "Purchase Orders");

      expect(mrIndex).toBeGreaterThanOrEqual(0);
      expect(poIndex).toBeGreaterThanOrEqual(0);
      expect(mrIndex).toBeLessThan(poIndex);

      expect(items[mrIndex].to).toBe("/material-requests/procurement");
    });

    it("highlights Material Requests menu item on MR list and detail pages", async () => {
      const { isItemActive } = await import("../components/layout/Sidebar");
      const mrRoute = "/material-requests/procurement";

      // Active on procurement queue / list
      expect(isItemActive("/material-requests/procurement", mrRoute)).toBe(true);
      expect(isItemActive("/material-requests", mrRoute)).toBe(true);
      expect(isItemActive("/material-requests/list", mrRoute)).toBe(true);

      // Active on detail page
      expect(isItemActive("/material-requests/MAT-REQ-2026-00001", mrRoute)).toBe(true);

      // Inactive on other routes
      expect(isItemActive("/p2p/purchase-orders", mrRoute)).toBe(false);
      expect(isItemActive("/dashboard", mrRoute)).toBe(false);
      expect(isItemActive("/sourcing/rfq", mrRoute)).toBe(false);
    });
  });
});
