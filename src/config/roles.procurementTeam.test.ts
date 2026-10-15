import { describe, expect, it } from "vitest";
import { canAccessPath, canManageRFQs, normalizeAppRole, resolveFromErpNextRoles, resolveRoleFromUser } from "./roles";

describe("Procurement Team canonical client role", () => {
  it.each(["procurement.team", "procurement_team", "Procurement Team", "procurement team", " PROCUREMENT.TEAM ", "PROCUREMENT_TEAM"])("normalizes %s without a Procurement Manager fallback", role => {
    const normalized = normalizeAppRole(role);
    expect(normalized).toBe("procurement_team");
    expect(resolveFromErpNextRoles(["Desk User", role])).toBe("procurement_team");
    expect(resolveRoleFromUser({ name: "assigned.buyer@example.test", email: "assigned.buyer@example.test", erpnext_roles: [role] })).toBe("procurement_team");
    expect(canAccessPath(role, "/contract-requests")).toBe(true);
    expect(canAccessPath(role, "/sourcing/rfq/PUR-RFQ-2026-00094")).toBe(true);
    expect(canManageRFQs(normalized)).toBe(false);
  });
  it("preserves explicit Manager and other ERP role precedence", () => {
    expect(resolveFromErpNextRoles(["procurement.team", "Procurement Manager"])).toBe("procurement");
    expect(resolveFromErpNextRoles(["procurement_team", "Finance Manager"])).toBe("finance");
    expect(resolveFromErpNextRoles(["procurement.team.other"])).toBeNull();
  });
});
