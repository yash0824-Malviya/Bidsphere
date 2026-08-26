import { describe, expect, it } from "vitest";

import { multipartProxyPolicy } from "./multipartProxyGuard";

describe("multipart ERP proxy policy", () => {
  it("rejects multipart generic document mutations", () => {
    expect(multipartProxyPolicy(
      "method/frappe.client.save",
      "multipart/form-data; boundary=attack",
    )).toBe("reject");
  });

  it("allows only upload_file to retain an authenticated multipart stream", () => {
    expect(multipartProxyPolicy(
      "method/upload_file",
      "multipart/form-data; boundary=file",
    )).toBe("authenticated-upload");
    expect(multipartProxyPolicy("method/upload_file", "application/json"))
      .toBe("reject");
  });

  it("leaves ordinary JSON requests available for normal inspection", () => {
    expect(multipartProxyPolicy("method/frappe.client.save", "application/json"))
      .toBe("inspect");
  });
});
