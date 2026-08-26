import { describe, expect, it } from "vitest";

import {
  assertSupportedErpProxyPath,
  canonicalizeProxyApiPath,
  isVersionedErpApiPath,
} from "./proxyPathGuard";

describe("ERP proxy path canonicalization", () => {
  it("uses one canonical representation for encoded resource paths", () => {
    expect(canonicalizeProxyApiPath("/resource/Engineering%20Change%20Request/ECR-001"))
      .toBe("resource/Engineering%20Change%20Request/ECR-001");
  });

  it.each([
    "resource/foo/../ECR%20Approval",
    "resource/foo/%2e%2e/ECR%20Approval",
    "resource/foo/%252e%252e/ECR%20Approval",
    "resource/foo\\..\\ECR Approval",
  ])("rejects path traversal variant %s", (path) => {
    expect(() => canonicalizeProxyApiPath(path)).toThrow(/traversal|invalid/i);
  });

  it("rejects Frappe v2 and unknown namespaces from the generic proxy", () => {
    expect(() => assertSupportedErpProxyPath("v2/method/frappe.model.workflow.apply_workflow"))
      .toThrow(/unsupported/i);
    expect(() => assertSupportedErpProxyPath("ecr-workflow-action"))
      .toThrow(/unsupported/i);
    expect(() => assertSupportedErpProxyPath("resource/Item")).not.toThrow();
    expect(isVersionedErpApiPath("v2/document/ECR%20Approval")).toBe(true);
  });
});
