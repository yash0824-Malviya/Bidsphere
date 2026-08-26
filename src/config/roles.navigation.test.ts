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

  it("preserves each role's specialized module entry after Dashboard", () => {
    for (const role of INTERNAL_ROLES) {
      const primaryItems = getNavGroupsForRole(role)[0]?.items ?? [];
      expect(primaryItems, role).toEqual(
        expect.arrayContaining([
          expect.objectContaining(SPECIALIZED_PRIMARY_LINK[role]),
        ]),
      );
    }
  });
});
