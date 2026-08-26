import { describe, expect, it } from "vitest";

import { getProcurementDashboardContent } from "./dashboardSelection";

describe("Procurement dashboard content selection", () => {
  it.each([
    "procurement",
    "Procurement Manager",
    "purchase-manager",
  ])("renders the procurement overview for manager alias %s", (role) => {
    expect(getProcurementDashboardContent(role)).toBe("manager-overview");
  });

  it.each([
    "procurement_team",
    "Procurement Team",
    "Purchase User",
  ])("keeps team alias %s on its role-specific ECR queue dashboard", (role) => {
    expect(getProcurementDashboardContent(role)).toBe("team-ecr-queue");
  });

  it.each([
    "engineering",
    "buyer",
    "unknown-role",
    "",
    null,
    undefined,
  ])("fails closed for unrelated or unknown role %s", (role) => {
    expect(getProcurementDashboardContent(role)).toBeNull();
  });
});
