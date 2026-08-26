import { describe, expect, it } from "vitest";
import { assertSafeProxyBody, assertSafeProxyQuery } from "./proxyRequestGuard";

describe("ERP proxy query guard", () => {
  it("categorically blocks Frappe's legacy cmd dispatcher", () => {
    expect(() => assertSafeProxyQuery({
      apiPath: "resource/Item",
      method: "POST",
      query: { cmd: "frappe.core.doctype.user.user.add_role" },
    })).toThrow(/cmd query dispatcher/i);
  });

  it.each([
    "resource/Item",
    "method/frappe.client.save",
  ])("blocks top-level body cmd on %s", (apiPath) => {
    expect(() => assertSafeProxyBody({
      apiPath,
      method: "POST",
      body: {
        cmd: "frappe.model.workflow.apply_workflow",
        doc: { doctype: "Engineering Change Request", name: "ECR-1" },
        action: "Approve",
      },
    })).toThrow(/cmd body dispatcher/i);
  });

  it("also blocks a serialized body cmd but permits ordinary JSON", () => {
    expect(() => assertSafeProxyBody({
      apiPath: "resource/Item",
      method: "POST",
      body: JSON.stringify({ Cmd: "frappe.core.doctype.user.user.add_role" }),
    })).toThrow(/cmd body dispatcher/i);
    expect(() => assertSafeProxyBody({
      apiPath: "resource/Item",
      method: "POST",
      body: { item_code: "PART-1" },
    })).not.toThrow();
  });

  it.each(["select_pxfp", "docstatus", "approval_requirements", "data"])(
    "blocks query-carried ECR field %s",
    (field) => {
      expect(() => assertSafeProxyQuery({
        apiPath: "resource/Engineering Change Request/ECR-1",
        method: "PUT",
        query: { [field]: field === "docstatus" ? "1" : "forged" },
      })).toThrow(/inspected JSON body/i);
    },
  );

  it("rejects repeated mutation parameters", () => {
    expect(() => assertSafeProxyQuery({
      apiPath: "method/frappe.client.save",
      method: "POST",
      query: { doctype: ["Item", "Engineering Change Request"] },
    })).toThrow(/duplicate query parameter/i);
  });

  it("allows ordinary read filters and body-only mutation routes", () => {
    expect(() => assertSafeProxyQuery({
      apiPath: "resource/Item",
      method: "GET",
      query: { filters: "[]", fields: "[\"name\"]" },
    })).not.toThrow();
    expect(() => assertSafeProxyQuery({
      apiPath: "resource/Engineering Change Request/ECR-1",
      method: "PUT",
      query: { path: "resource/Engineering Change Request/ECR-1" },
    })).not.toThrow();
  });
});
