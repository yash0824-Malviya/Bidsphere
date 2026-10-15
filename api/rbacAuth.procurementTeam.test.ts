import { describe, expect, it } from "vitest";
import { resolveServerRole } from "./rbacAuth";

const user = { name: "assigned.buyer@example.test", email: "assigned.buyer@example.test" };
describe("authoritative Procurement Team role aliases", () => {
  it.each(["procurement.team", "procurement_team", "Procurement Team", "procurement team", " PROCUREMENT.TEAM ", "PROCUREMENT_TEAM"])("resolves ERP role %s to the existing Team role", role => {
    expect(resolveServerRole({ ...user, erpnext_roles: ["Desk User", role] })).toBe("procurement_team");
  });
  it("does not override an actual Manager or other higher-priority ERP role", () => {
    expect(resolveServerRole({ ...user, erpnext_roles: ["procurement.team", "Procurement Manager"] })).toBe("procurement");
    expect(resolveServerRole({ ...user, erpnext_roles: ["procurement_team", "Finance Manager"] })).toBe("finance");
  });
  it("does not grant Team authority for unknown names or a revoked role list", () => {
    expect(resolveServerRole({ ...user, erpnext_roles: ["procurement.team.other"] })).toBeNull();
    expect(resolveServerRole({ name: "procurement.team@netlink.com", email: "procurement.team@netlink.com", erpnext_roles: [] })).toBeNull();
  });
});
