import { describe, expect, it } from "vitest";
import {
  assertErpProxySecurityBoundary,
  ErpProxySecurityError,
} from "./erpProxySecurityGuard";

describe("ERP proxy security boundary", () => {
  it.each([
    ["resource/Workflow/ECR Approval Workflow", ["Workflow"]],
    ["resource/DocShare", ["DocShare"]],
    ["method/frappe.client.save", ["User"]],
    ["method/frappe.client.insert", ["Custom DocPerm"]],
  ])("blocks non-admin security metadata mutation through %s", (apiPath, doctypes) => {
    expect(() => assertErpProxySecurityBoundary({
      apiPath,
      method: "POST",
      principalRole: "engineer",
      requestDoctypes: doctypes,
    })).toThrow(ErpProxySecurityError);
  });

  it("blocks unrecognized privileged callbacks for non-admin users", () => {
    expect(() => assertErpProxySecurityBoundary({
      apiPath: "method/frappe.core.doctype.user.user.add_role",
      method: "POST",
      principalRole: "engineer",
    })).toThrow(/not available/i);
  });

  it("rejects benign-first mixed bulk procurement documents", () => {
    expect(() => assertErpProxySecurityBoundary({
      apiPath: "method/frappe.client.insert_many",
      method: "POST",
      principalRole: "procurement_team",
      requestDoctypes: ["Item", "Request for Quotation"],
    })).toThrow(/mixed bulk/i);
  });

  it("allows known business RPCs and ordinary resources", () => {
    expect(() => assertErpProxySecurityBoundary({
      apiPath: "method/frappe.client.save",
      method: "POST",
      principalRole: "engineering",
      requestDoctypes: ["BOM"],
    })).not.toThrow();
    expect(() => assertErpProxySecurityBoundary({
      apiPath: "resource/Item/ITEM-1",
      method: "PUT",
      principalRole: "procurement",
      requestDoctypes: ["Item"],
    })).not.toThrow();
  });

  it("preserves administrator access for explicit admin tools", () => {
    expect(() => assertErpProxySecurityBoundary({
      apiPath: "method/frappe.core.doctype.user.user.reset_password",
      method: "POST",
      principalRole: "admin",
      requestDoctypes: ["User"],
    })).not.toThrow();
  });
});
