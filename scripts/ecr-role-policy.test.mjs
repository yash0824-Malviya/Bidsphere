import { describe, expect, it } from "vitest";
import {
  ECR_HUMAN_ROLES,
  ECR_READ_ONLY_PERMISSION_FLAGS,
  PROCUREMENT_TEAM_ERP_ROLE,
} from "./ecr-role-policy.mjs";

describe("ECR ERP role policy", () => {
  it("uses the exact Procurement Team workflow role and retains compatibility roles", () => {
    expect(PROCUREMENT_TEAM_ERP_ROLE).toBe("Procurement Team");
    expect(ECR_HUMAN_ROLES).toContain("Procurement Team");
    expect(ECR_HUMAN_ROLES).toContain("Procurement Manager");
    expect(ECR_HUMAN_ROLES).toContain("Procurement User");
    expect(new Set(ECR_HUMAN_ROLES).size).toBe(ECR_HUMAN_ROLES.length);
  });

  it("keeps every human ECR role read-only at the ERP document layer", () => {
    expect(ECR_READ_ONLY_PERMISSION_FLAGS).toEqual({
      read: 1,
      write: 0,
      create: 0,
      delete: 0,
      submit: 0,
      cancel: 0,
      amend: 0,
    });
  });
});
