import { describe, expect, it } from "vitest";

import {
  ROLE_LABELS,
  canAccessPath,
  getNavGroupsForRole,
  getRoleHome,
  type AppRole,
} from "./roles";

const INTERNAL_ROLES = Object.keys(ROLE_LABELS) as AppRole[];

const SPECIALIZED_PRIMARY_LINK: Record<
  AppRole,
  { label: string; to: string }
> = {
  admin: { label: "Admin", to: "/admin" },
  procurement: { label: "Engineering Changes", to: "/ecr" },
  procurement_team: { label: "Engineering Changes", to: "/ecr" },
  finance: { label: "Business Intake", to: "/intake/business-cases" },
  finance_executive: { label: "Budget", to: "/budget" },
  warehouse: {
    label: "Goods Receipt",
    to: "/warehouse/inventory/create-grn",
  },
  legal: { label: "Legal", to: "/legal/reviews" },
  department: { label: "Department", to: "/material-requests/new" },
  executive: { label: "Business Intake", to: "/intake/dashboard" },
  manufacturing: { label: "Manufacturing", to: "/manufacturing/boms" },
  engineer: { label: "Engineering Changes", to: "/ecr" },
  engineering: { label: "Engineering Changes", to: "/ecr" },
  operations: { label: "Engineering Changes", to: "/ecr" },
  quality: { label: "Engineering Changes", to: "/ecr" },
  program_manager: { label: "Engineering Changes", to: "/ecr" },
};

describe("internal role dashboard navigation", () => {
  it("omits Contract navigation only from engineering workspaces without changing route access", () => {
    for (const role of ["engineer", "engineering", "Engineering Manager"]) {
      expect(getNavGroupsForRole(role).some((group) => group.label === "CONTRACTS"), role).toBe(false);
      expect(canAccessPath(role, "/contracts"), role).toBe(true);
    }
    for (const role of ["procurement", "procurement_team", "legal", "finance"]) {
      expect(getNavGroupsForRole(role).some((group) => group.label === "CONTRACTS"), role).toBe(true);
    }
  });

  it("lands every valid internal role directly on /dashboard", () => {
    for (const role of INTERNAL_ROLES) {
      expect(getRoleHome(role), role).toBe("/dashboard");
      expect(canAccessPath(role, "/dashboard"), role).toBe(true);
    }
  });

  it("generates one canonical Dashboard as the first primary item", () => {
    for (const role of INTERNAL_ROLES) {
      const primaryItems = getNavGroupsForRole(role)[0]?.items ?? [];

      expect(primaryItems[0]?.label, role).toBe("Dashboard");
      expect(primaryItems[0]?.to, role).toBe("/dashboard");
      expect(
        primaryItems.filter((item) => item.label === "Dashboard"),
        role,
      ).toHaveLength(1);
      expect(
        primaryItems.filter((item) => item.to === "/dashboard"),
        role,
      ).toHaveLength(1);
    }
  });

  it("preserves each role's specialized module entry after Dashboard or within dedicated groups", () => {
    for (const role of INTERNAL_ROLES) {
      if (role === "procurement") {
        const allItems = getNavGroupsForRole(role).flatMap((g) => g.items);
        expect(allItems).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ label: "Material Requests", to: "/material-requests/procurement" }),
            expect.objectContaining({ label: "All RFQs", to: "/sourcing/rfq" }),
            expect.objectContaining({ label: "All RFI", to: "/sourcing/rfi" }),
            expect.objectContaining({ label: "All RFP", to: "/sourcing/rfp" }),
            expect.objectContaining({ label: "Reverse Bidding", to: "/sourcing/reverse-bidding" }),
            expect.objectContaining({ label: "RFQ Template", to: "/sourcing/rfq-templates" }),
            expect.objectContaining({ label: "Business Intake", to: "/intake/business-cases" }),
            expect.objectContaining({ label: "ECR Reference", to: "/ecr" }),
          ]),
        );
        const intakeItem = allItems.find((i) => i.label === "Business Intake");
        expect(intakeItem?.children?.map((c) => c.label)).toEqual([
          "Procurement Reviews",
        ]);
        continue;
      }
      const primaryItems = getNavGroupsForRole(role)[0]?.items ?? [];
      expect(primaryItems, role).toEqual(
        expect.arrayContaining([
          expect.objectContaining(SPECIALIZED_PRIMARY_LINK[role]),
        ]),
      );
    }
  });
});

describe("Procurement Manager exact sidebar structure", () => {
  it("renders exact required sidebar structure with PROCUREMENT INTAKE and BUSINESS INTAKE", () => {
    const groups = getNavGroupsForRole("procurement");

    expect(groups.map((g) => ({ label: g.label, items: g.items.map((i) => ({ label: i.label, to: i.to })) }))).toEqual([
      {
        label: "",
        items: [{ label: "Dashboard", to: "/dashboard" }],
      },
      {
        label: "PROCUREMENT INTAKE",
        items: [{ label: "Material Requests", to: "/material-requests/procurement" }],
      },
      {
        label: "RFQ MANAGEMENT",
        items: [
          { label: "All RFQs", to: "/sourcing/rfq" },
          { label: "All RFI", to: "/sourcing/rfi" },
          { label: "All RFP", to: "/sourcing/rfp" },
          { label: "Reverse Bidding", to: "/sourcing/reverse-bidding" },
          { label: "RFQ Template", to: "/sourcing/rfq-templates" },
        ],
      },
      {
        label: "BUSINESS INTAKE",
        items: [{ label: "Business Intake", to: "/intake/business-cases" }],
      },
      {
        label: "ENGINEERING",
        items: [{ label: "ECR Reference", to: "/ecr" }],
      },
      {
        label: "SUPPLIERS",
        items: [
          { label: "Supplier Onboarding", to: "/suppliers/onboarding" },
          { label: "Suppliers", to: "/suppliers" },
        ],
      },
      {
        label: "FINANCE",
        items: [
          { label: "Budget", to: "/budget" },
          { label: "Spend", to: "/p2p/total-spend" },
        ],
      },
      {
        label: "REPORTS",
        items: [
          { label: "Reports", to: "/reports/operations" },
        ],
      },
      {
        label: "CONTRACTS",
        items: [{ label: "Contract Lifecycle", to: "/contracts" }],
      },
      {
        label: "Support",
        items: [
          { label: "Help & Support", to: "/support/help-desk" },
        ],
      },
    ]);
  });

  it("permits route access for all Procurement Manager navigation destinations", () => {
    const role = "procurement";
    const allowedRoutes = [
      "/dashboard",
      "/material-requests/procurement",
      "/material-requests/history",
      "/material-requests/MAT-MR-2026-00001",
      "/sourcing/rfq",
      "/sourcing/rfi",
      "/sourcing/rfp",
      "/sourcing/reverse-bidding",
      "/sourcing/rfq-templates",
      "/intake/business-cases",
      "/intake/business-cases/CASE-001",
      "/intake/pending-business-cases",
      "/ecr",
      "/suppliers/onboarding",
      "/suppliers/onboarding/new",
      "/suppliers/onboarding/ONB-001",
      "/suppliers",
      "/suppliers/new",
      "/budget",
      "/p2p/total-spend",
      "/reports/operations",
      "/support/help-desk",
    ];

    for (const route of allowedRoutes) {
      expect(canAccessPath(role, route), `procurement should access ${route}`).toBe(true);
    }
  });
});

describe("Finance Executive exact sidebar structure", () => {
  it("renders exact required sidebar structure with one Dashboard and no duplicate Budget Dashboard", () => {
    const groups = getNavGroupsForRole("finance_executive");
    const allItems = groups.flatMap((g) => g.items);

    // Only one Dashboard entry across the entire sidebar
    const dashboardItems = allItems.filter((i) => i.label === "Dashboard" || i.to === "/dashboard");
    expect(dashboardItems).toHaveLength(1);

    const budgetItem = allItems.find((i) => i.label === "Budget");
    expect(budgetItem).toBeDefined();
    expect(budgetItem?.children?.map((c) => c.label)).toEqual([
      "Create Budget",
      "My Budgets",
      "Budget Requests",
    ]);
  });
});

describe("Finance Manager exact sidebar structure", () => {
  it("renders exact required sidebar structure with distinct operational Dashboard and Budget module", () => {
    const groups = getNavGroupsForRole("finance");
    const allItems = groups.flatMap((g) => g.items);

    expect(allItems.map((i) => i.label)).toEqual([
      "Dashboard",
      "Business Intake",
      "RFQ Financial Review",
      "Engineering Changes",
      "Budget",
      "P2P Core",
      "Contract Lifecycle",
      "Help",
    ]);

    const budgetItem = allItems.find((i) => i.label === "Budget");
    expect(budgetItem).toBeDefined();
    expect(budgetItem?.children?.map((c) => c.label)).toEqual([
      "Budget Dashboard",
      "Budget Approval",
      "Budget Monitoring",
      "Budget History",
    ]);

    const p2pItem = allItems.find((i) => i.label === "P2P Core");
    expect(p2pItem).toBeDefined();
    expect(p2pItem?.children?.map((c) => c.label)).toEqual([
      "Vouchers",
      "Invoices",
      "Payments",
      "GRN",
    ]);

    const intakeItem = allItems.find((i) => i.label === "Business Intake");
    expect(intakeItem).toBeDefined();
    expect(intakeItem?.children?.map((c) => c.label)).toEqual([
      "Finance Approvals",
    ]);
  });
});

describe("Legal Manager exact sidebar structure", () => {
  it("renders exact required sidebar structure containing Dashboard, Business Intake, Legal, and Help", () => {
    const groups = getNavGroupsForRole("legal");
    const allItems = groups.flatMap((g) => g.items);

    expect(allItems.map((i) => i.label)).toEqual([
      "Dashboard",
      "Business Intake",
      "Legal",
      "Contract Lifecycle",
      "Help",
    ]);

    const intakeItem = allItems.find((i) => i.label === "Business Intake");
    expect(intakeItem).toBeDefined();
    expect(intakeItem?.children?.map((c) => c.label)).toEqual([
      "Legal Business Case Reviews",
    ]);

    const legalItem = allItems.find((i) => i.label === "Legal");
    expect(legalItem).toBeDefined();
    expect(legalItem?.children?.map((c) => c.label)).toEqual([
      "Legal Reviews",
    ]);
  });
});
