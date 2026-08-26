import { describe, expect, it } from "vitest";
import {
  PROTECTED_CHILD_DOCTYPES,
  protectedChildAccessDenial,
  protectedChildAccessMessage,
  protectedChildRequestDoctypeFromMany,
} from "./protectedChildGuard";

const TRACEABILITY_CHILDREN = [
  "ECR Affected Part",
  "Purchase Requisition Item",
] as const;

describe("protected child access", () => {
  it.each(TRACEABILITY_CHILDREN)(
    "denies supplier and internal direct PUTs for %s",
    (doctype) => {
      const apiPath = `resource/${encodeURIComponent(doctype)}/ROW-0001`;
      expect(protectedChildAccessDenial({
        apiPath,
        method: "PUT",
        principalType: "supplier",
      })).toBe("supplier");
      expect(protectedChildAccessDenial({
        apiPath,
        method: "PUT",
        principalType: "internal",
      })).toBe("mutation");
    },
  );

  it.each(TRACEABILITY_CHILDREN)(
    "denies supplier and internal generic set_value writes for %s",
    (doctype) => {
      expect(protectedChildAccessDenial({
        apiPath: "method/frappe.client.set_value",
        requestDoctype: doctype,
        method: "POST",
        principalType: "supplier",
      })).toBe("supplier");
      expect(protectedChildAccessDenial({
        apiPath: "method/frappe.client.set_value",
        requestDoctype: doctype,
        method: "POST",
        principalType: "internal",
      })).toBe("mutation");
    },
  );

  it("denies supplier reads but permits non-sensitive internal child lookups", () => {
    for (const doctype of PROTECTED_CHILD_DOCTYPES.filter((name) => name !== "ECR Approval")) {
      expect(protectedChildAccessDenial({
        apiPath: "method/frappe.client.get_list",
        requestDoctype: doctype,
        method: "POST",
        principalType: "supplier",
      })).toBe("supplier");
      expect(protectedChildAccessDenial({
        apiPath: "method/frappe.client.get_list",
        requestDoctype: doctype,
        method: "POST",
        principalType: "internal",
      })).toBeNull();
    }
  });

  it("prevents direct enumeration of ECR approval tasks for every principal", () => {
    for (const [apiPath, requestDoctype, method] of [
      ["resource/ECR%20Approval", undefined, "GET"],
      ["resource/ECR%20Approval/TASK-001", undefined, "GET"],
      ["method/frappe.client.get_list", "ECR Approval", "POST"],
      ["method/frappe.client.get", "ECR Approval", "POST"],
    ] as const) {
      expect(protectedChildAccessDenial({
        apiPath,
        requestDoctype,
        method,
        principalType: "internal",
      })).toBe("sensitive-read");
    }
  });

  it("provides a denial message for every guard result used by dev and production", () => {
    for (const denial of ["supplier", "mutation", "sensitive-read"] as const) {
      expect(protectedChildAccessMessage(denial)).toMatch(/Direct/i);
    }
  });

  it("does not intercept secured parent-document endpoints", () => {
    for (const doctype of ["Engineering Change Request", "Purchase Requisition"]) {
      expect(protectedChildAccessDenial({
        apiPath: `resource/${encodeURIComponent(doctype)}/DOC-0001`,
        requestDoctype: doctype,
        method: "PUT",
        principalType: "internal",
      })).toBeNull();
    }
  });

  it("finds a protected child after a benign first document in a bulk request", () => {
    expect(protectedChildRequestDoctypeFromMany(
      "method/frappe.client.bulk_update",
      ["Item", "ECR Approval"],
    )).toBe("ECR Approval");
  });
});
