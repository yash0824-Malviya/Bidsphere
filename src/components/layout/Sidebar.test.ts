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
