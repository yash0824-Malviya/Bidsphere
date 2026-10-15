import { describe, expect, it } from "vitest";
import { canAccessClmPath, CLM_INTERNAL_ROLES } from "./clmRoles";
import { canAccessPath, canManageRFQs, getNavGroupsForRole, normalizeAppRole, type AppRole } from "./roles";

const creators = ["admin", "procurement", "procurement_team"];
const settingsRoles = ["admin", "procurement", "legal"];
describe("CLM role and route integration", () => {
  it.each(["procurement_team", "Procurement Team"])("allows %s to open awarded RFQs for CLM without RFQ authoring permissions", role => {
    for (const path of ["/sourcing/rfq", "/sourcing/rfqs", "/sourcing/rfq/PUR-RFQ-2026-00093", "/sourcing/rfq/PUR-RFQ-2026-00093/"]) expect(canAccessPath(role, path), path).toBe(true);
    for (const path of ["/sourcing/rfq/new", "/sourcing/rfq/new/", "/sourcing/rfq/PUR-RFQ-2026-00093/edit", "/sourcing/rfi", "/sourcing/rfp", "/sourcing/reverse-bidding"]) expect(canAccessPath(role, path), path).toBe(false);
    expect(canManageRFQs(normalizeAppRole(role))).toBe(false);
  });
  it.each(CLM_INTERNAL_ROLES)("permits %s to open the assigned-contract workspace", role => {
    for (const path of ["/contracts", "/contracts/CON-2026-00001"]) {
      expect(canAccessClmPath(role, path)).toBe(true);
      expect(canAccessPath(role, path)).toBe(true);
    }
  });
  it.each(CLM_INTERNAL_ROLES)("limits %s contract/request creation and request access to coordinators", role => {
    for (const path of ["/contracts/new", "/contract-requests", "/contract-requests/new", "/contract-requests/CR-2026-00001"]) {
      expect(canAccessClmPath(role, path), path).toBe(creators.includes(role));
      expect(canAccessPath(role, path), path).toBe(creators.includes(role));
    }
  });
  it.each(CLM_INTERNAL_ROLES)("gives %s settings access only for existing configuration roles", role => {
    expect(canAccessClmPath(role, "/contracts/settings")).toBe(settingsRoles.includes(role));
    expect(canAccessPath(role, "/contracts/settings?doctype=Contract%20Clause")).toBe(settingsRoles.includes(role));
  });
  it("does not let a trailing slash turn restricted create/settings routes into details", () => {
    for (const role of ["finance", "engineering", "quality", "program_manager"]) {
      expect(canAccessClmPath(role, "/contracts/new/")).toBe(false);
      expect(canAccessClmPath(role, "/contracts/settings/")).toBe(false);
      expect(canAccessPath(role, "/contracts/new/")).toBe(false);
      expect(canAccessPath(role, "/contracts/settings/?doctype=Contract%20Approval%20Matrix")).toBe(false);
    }
  });
  it.each(["warehouse", "manufacturing", "department", "operations", "executive", "supplier", "unknown"])("does not grant CLM entry points to %s", role => {
    for (const path of ["/contracts", "/contracts/CON-1", "/contract-requests", "/contracts/settings"]) expect(canAccessClmPath(role, path)).toBe(false);
  });
  it("keeps supplier authentication separate from all internal navigation", () => {
    for (const role of CLM_INTERNAL_ROLES) {
      expect(canAccessPath(role, "/supplier/contracts")).toBe(false);
      expect(canAccessPath(role, "/supplier/contracts/CON-1")).toBe(false);
    }
  });
  it.each(CLM_INTERNAL_ROLES)("preserves %s sidebar entries while excluding CLM from the Engineer UI", role => {
    const groups = getNavGroupsForRole(role);
    expect(groups[0].items[0]).toMatchObject({ label: "Dashboard", to: "/dashboard" });
    const clm = groups.flatMap(group => group.items).filter(item => item.label === "Contract Lifecycle");
    if (role === "engineer" || role === "engineering") {
      expect(clm).toHaveLength(0);
      expect(JSON.stringify(groups)).not.toMatch(/contracts|contract lifecycle|clm/i);
      return;
    }
    expect(clm).toHaveLength(1); expect(clm[0].to).toBe("/contracts");
    expect(clm[0].children).toEqual(expect.arrayContaining([{ label: "Contracts", to: "/contracts" }]));
    expect(clm[0].children?.some(child => child.to === "/contract-requests")).toBe(creators.includes(role));
  });
  it("preserves existing procurement, ECR, Legal, Finance and onboarding route boundaries", () => {
    const routes: Array<[AppRole, string, boolean]> = [
      ["procurement", "/sourcing/rfq", true], ["procurement", "/sourcing/rfq/new", true],
      ["procurement", "/ecr", true], ["engineering", "/ecr", true],
      ["legal", "/legal/reviews", true], ["finance", "/budget/pending-reviews", true],
      ["finance", "/sourcing/rfq/new", false], ["procurement_team", "/suppliers/onboarding", false],
      ["procurement", "/suppliers/onboarding", true],
    ];
    for (const [role, path, allowed] of routes) expect(canAccessPath(role, path), `${role}: ${path}`).toBe(allowed);
    const finance = getNavGroupsForRole("finance").flatMap(group => group.items);
    expect(finance).toEqual(expect.arrayContaining([expect.objectContaining({ label: "RFQ Financial Review", to: "/budget/pending-reviews" }), expect.objectContaining({ label: "P2P Core" })]));
    const legal = getNavGroupsForRole("legal").flatMap(group => group.items).find(item => item.label === "Legal");
    expect(legal?.children).toEqual([{ label: "Legal Reviews", to: "/legal/reviews" }]);
  });
});
