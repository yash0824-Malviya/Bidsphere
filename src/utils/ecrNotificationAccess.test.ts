import { describe, expect, it } from "vitest";
import { canViewNotification } from "./notificationAccess";
import type { EnterpriseNotification } from "../types/notification";

const notification: EnterpriseNotification = {
  id: "ecr-review", title: "Financial review required", description: "Review the Business Case.",
  module: "Engineering Change", event_type: "ecr_finance_review", target_role: "finance",
  document_type: "Engineering Change Request", document_name: "ECR-2026-100001",
  route_path: "/ecr/ECR-2026-100001/business-case", created_at: "2026-09-15T10:00:00Z", read_status: false,
};
describe("ECR reviewer notification access", () => {
  it.each(["finance", "procurement", "quality", "program_manager", "engineer", "engineering"] as const)("permits assigned %s notifications", (role) => {
    expect(canViewNotification({ ...notification, target_role: role }, { role })).toBe(true);
  });
  it("keeps internal Business Case notices out of the supplier and unrelated-role feeds", () => {
    expect(canViewNotification(notification, { role: "supplier", supplierId: "SUP-1" })).toBe(false);
    expect(canViewNotification(notification, { role: "quality" })).toBe(false);
    expect(canViewNotification(notification, { role: "finance_executive" })).toBe(false);
    expect(canViewNotification(notification, { role: "procurement_team" })).toBe(false);
  });
});
