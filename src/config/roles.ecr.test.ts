import { describe, expect, it } from "vitest";
import {
  canAccessPath,
  getNavGroupsForRole,
  getRoleHome,
  resolveFromErpNextRoles,
} from "./roles";

describe("ECR application role integration", () => {
  it("resolves ERP role names without treating unknown roles as procurement", () => {
    expect(resolveFromErpNextRoles(["Desk User", "Engineer"])).toBe("engineer");
    expect(resolveFromErpNextRoles(["Desk User", "Operations Manager"])).toBe("operations");
    expect(resolveFromErpNextRoles(["Purchase User", "Quality Manager"])).toBe("quality");
    expect(resolveFromErpNextRoles(["Desk User"])).toBeNull();
  });

  it("lands every ECR reviewer on the role dashboard", () => {
    for (const role of ["engineer", "engineering", "operations", "quality", "program_manager"] as const) {
      expect(getRoleHome(role)).toBe("/dashboard");
    }
  });

  it("blocks direct creator routes for approval managers", () => {
    expect(canAccessPath("engineer", "/ecr/new")).toBe(true);
    expect(canAccessPath("engineering", "/ecr/new")).toBe(false);
    expect(canAccessPath("quality", "/ecr/ECR-001/edit")).toBe(false);
    expect(canAccessPath("operations", "/ecr/ECR-001")).toBe(true);
  });

  it("builds distinct ECR navigation for each role", () => {
    const labels = (role: Parameters<typeof getNavGroupsForRole>[0]) =>
      getNavGroupsForRole(role)
        .flatMap((group) => group.items)
        .find((item) => item.label === "Engineering Changes")
        ?.children?.map((child) => child.label);

    expect(labels("engineer")).toEqual(["My ECRs", "New ECR"]);
    expect(labels("engineering")).toEqual(["Engineering Review", "All ECRs"]);
    expect(labels("operations")).toEqual(["All ECRs"]);
    expect(labels("quality")).toEqual(["All ECRs"]);
    expect(labels("program_manager")).toEqual(["All ECRs"]);
    expect(labels("procurement_team")).toEqual(["Procurement Review", "All ECRs"]);
    expect(labels("procurement")).toEqual(["RFQ Pending", "All ECRs"]);
  });

  it("puts Dashboard first and Engineering Changes second for every ECR role", () => {
    const roles = [
      "engineer",
      "engineering",
      "operations",
      "quality",
      "program_manager",
      "procurement_team",
      "procurement",
    ] as const;

    for (const role of roles) {
      const primaryItems = getNavGroupsForRole(role).flatMap(
        (group) => group.items,
      );
      expect(primaryItems[0]?.label).toBe("Dashboard");
      expect(primaryItems[0]?.to).toBe("/dashboard");
      expect(primaryItems[1]?.label).toBe("Engineering Changes");
      expect(getRoleHome(role)).toBe("/dashboard");
      expect(canAccessPath(role, "/dashboard")).toBe(true);
    }
  });

  it("keeps the requested role-specific Engineering Changes children", () => {
    const children = (role: Parameters<typeof getNavGroupsForRole>[0]) =>
      getNavGroupsForRole(role)
        .flatMap((group) => group.items)
        .find((item) => item.label === "Engineering Changes")
        ?.children?.map((child) => child.label);

    expect(children("engineer")).toEqual(["My ECRs", "New ECR"]);
    expect(children("engineering")).toEqual(["Engineering Review", "All ECRs"]);
    expect(children("operations")).toEqual(["All ECRs"]);
    expect(children("quality")).toEqual(["All ECRs"]);
    expect(children("program_manager")).toEqual(["All ECRs"]);
    expect(children("procurement_team")).toEqual(["Procurement Review", "All ECRs"]);
    expect(children("procurement")).toEqual(["RFQ Pending", "All ECRs"]);
  });
});
