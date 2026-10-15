import { describe, expect, it } from "vitest";
import {
  assertErpProxySecurityBoundary,
  ErpProxySecurityError,
  assertNoGenericPoShipmentMutation,
  assertNoGenericSupplierShipmentRead,
} from "./erpProxySecurityGuard";

describe("ERP proxy security boundary", () => {
  it.each([
    ["resource/PO%20Shipment", "POST"], ["resource/PO Shipment/SHIP-1", "PUT"],
    ["resource/PO Shipment/SHIP-1", "DELETE"], ["method/frappe.client.insert", "POST"],
    ["method/frappe.client.save", "POST"], ["method/frappe.client.set_value", "GET"],
    ["method/frappe.client.submit", "GET"], ["method/frappe.model.workflow.apply_workflow", "GET"],
  ])("does not permit generic shipment bypass through %s %s", (path, method) => {
    expect(() => assertNoGenericPoShipmentMutation(path, method, ["PO Shipment"])).toThrow("authenticated PO Shipment");
  });
  it("retains staff read access but requires supplier-scoped shipment reads", () => {
    for (const path of ["resource/PO Shipment/SHIP-1", "method/frappe.client.get_list"]) {
      expect(() => assertNoGenericPoShipmentMutation(path, "GET", ["PO Shipment"])).not.toThrow();
      expect(() => assertNoGenericSupplierShipmentRead(path, ["PO Shipment"], "internal")).not.toThrow();
      expect(() => assertNoGenericSupplierShipmentRead(path, ["PO Shipment"], "supplier")).toThrow("supplier-scoped");
      expect(() => assertNoGenericSupplierShipmentRead(path, ["PO Shipment"])).toThrow("supplier-scoped");
    }
    expect(() => assertNoGenericPoShipmentMutation("resource/Purchase Receipt", "POST", ["Purchase Receipt"])).not.toThrow();
  });
  it.each(["GET", "POST"])("keeps the trusted RFQ transaction RPC off the generic browser gateway for %s", method => {
    for (const principalRole of ["admin", "procurement", "supplier"]) expect(() => assertErpProxySecurityBoundary({ apiPath: "method/bidsphere_workflows.rfq_clm.decide", method, principalRole })).toThrow("authenticated RFQ contract decision");
  });
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
