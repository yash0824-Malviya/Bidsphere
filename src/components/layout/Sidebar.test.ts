import { describe, expect, it } from "vitest";

import { isChildNavActive } from "./sidebarNavState";

describe("ECR sidebar queue active state", () => {
  it("keeps the Engineering Manager queue active for normalized pending aliases", () => {
    expect(isChildNavActive(
      "/ecr",
      "?filter=pending-approval",
      "/ecr?filter=engineering",
      "Engineering Review",
    )).toBe(true);
  });

  it("keeps My ECRs and role-specific procurement queues active for their aliases", () => {
    expect(isChildNavActive("/ecr", "?filter=mine", "/ecr", "My ECRs"))
      .toBe(true);
    expect(isChildNavActive(
      "/ecr",
      "?filter=procurement",
      "/ecr?filter=procurement-review",
      "Procurement Review",
    )).toBe(true);
    expect(isChildNavActive(
      "/ecr",
      "?filter=procurement-review",
      "/ecr?filter=procurement-review",
      "Procurement Review",
    )).toBe(true);
    expect(isChildNavActive(
      "/ecr",
      "?filter=create-rfq",
      "/ecr?filter=rfq-pending",
      "RFQ Pending",
    )).toBe(true);
    expect(isChildNavActive(
      "/ecr",
      "?filter=rfq-pending",
      "/ecr?filter=rfq-pending",
      "RFQ Pending",
    )).toBe(true);
  });

  it("does not activate unrelated ECR children", () => {
    expect(isChildNavActive(
      "/ecr",
      "?filter=validation",
      "/ecr?filter=quality",
      "Quality Review",
    )).toBe(false);
    expect(isChildNavActive(
      "/ecr",
      "?filter=approved",
      "/ecr",
      "All ECRs",
    )).toBe(false);
  });
});

describe("Sidebar isItemActive route separation", () => {
  it("highlights Supplier Onboarding when on /suppliers/onboarding and keeps Suppliers inactive", async () => {
    const { isItemActive } = await import("./Sidebar");

    expect(isItemActive("/suppliers/onboarding", "/suppliers/onboarding")).toBe(true);
    expect(isItemActive("/suppliers/onboarding", "/suppliers")).toBe(false);
    expect(isItemActive("/suppliers/onboarding/new", "/suppliers/onboarding")).toBe(true);
    expect(isItemActive("/suppliers/onboarding/new", "/suppliers")).toBe(false);
    expect(isItemActive("/suppliers/onboarding/ONB-001", "/suppliers/onboarding")).toBe(true);
    expect(isItemActive("/suppliers/onboarding/ONB-001", "/suppliers")).toBe(false);
  }, 15000);

  it("highlights Suppliers when on /suppliers and keeps Supplier Onboarding inactive", async () => {
    const { isItemActive } = await import("./Sidebar");

    expect(isItemActive("/suppliers", "/suppliers")).toBe(true);
    expect(isItemActive("/suppliers", "/suppliers/onboarding")).toBe(false);
    expect(isItemActive("/suppliers/SUPP-001", "/suppliers")).toBe(true);
    expect(isItemActive("/suppliers/SUPP-001", "/suppliers/onboarding")).toBe(false);
    expect(isItemActive("/suppliers/new", "/suppliers")).toBe(true);
    expect(isItemActive("/suppliers/new", "/suppliers/onboarding")).toBe(false);
  }, 15000);

  it("highlights Business Cases child on repository list and detail pages", () => {
    // Repository list page
    expect(isChildNavActive("/intake/business-cases", "", "/intake/business-cases", "Business Cases")).toBe(true);
    // Detail page
    expect(isChildNavActive("/intake/business-cases/BC-2026-0001", "", "/intake/business-cases", "Business Cases")).toBe(true);
    // Edit page
    expect(isChildNavActive("/intake/business-cases/BC-2026-0001/edit", "", "/intake/business-cases", "Business Cases")).toBe(true);
    // New business case page
    expect(isChildNavActive("/intake/business-cases/new", "", "/intake/business-cases", "Business Cases")).toBe(true);

    // Business Cases is also active when redirecting from legacy Business Needs
    expect(isChildNavActive("/intake/business-needs", "", "/intake/business-cases", "Business Cases")).toBe(true);
    expect(isChildNavActive("/intake/business-needs/BN-001", "", "/intake/business-cases", "Business Cases")).toBe(true);
  });
});
