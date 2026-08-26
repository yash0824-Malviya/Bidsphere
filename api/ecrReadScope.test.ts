import { describe, expect, it } from "vitest";

import { buildEngineerEcrReadScope } from "./ecrReadScope";

describe("engineer ECR collection scope", () => {
  it("preserves business filters and replaces every caller-owned identity filter", () => {
    const scope = buildEngineerEcrReadScope(JSON.stringify([
      ["select_pxfp", "=", "Sent Back"],
      ["ecr_owner", "=", "other@example.com"],
      ["Engineering Change Request", "owner", "=", "other@example.com"],
    ]), { email: "Engineer@Netlink.com", sub: "engineer" });

    expect(JSON.parse(scope.filters)).toEqual([
      ["select_pxfp", "=", "Sent Back"],
    ]);
    expect(JSON.parse(scope.orFilters)).toEqual([
      ["ecr_owner", "in", ["Engineer@Netlink.com", "engineer@netlink.com", "engineer"]],
      ["amended_from", "in", ["Engineer@Netlink.com", "engineer@netlink.com", "engineer"]],
      ["owner", "in", ["Engineer@Netlink.com", "engineer@netlink.com", "engineer"]],
    ]);
  });

  it("fails closed for malformed filters or a missing identity", () => {
    expect(() => buildEngineerEcrReadScope("{}", { email: "engineer@example.com" }))
      .toThrow(/invalid ecr filters/i);
    expect(() => buildEngineerEcrReadScope("[]", {}))
      .toThrow(/identity is required/i);
  });
});
