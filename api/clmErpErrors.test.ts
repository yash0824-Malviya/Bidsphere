import { describe, expect, it } from "vitest";
import { clmErpFailure } from "./clmErpErrors";

describe("safe actionable ERP Contract errors", () => {
  it("preserves native business validation and strips display markup", () => {
    expect(clmErpFailure({ _server_messages: JSON.stringify([JSON.stringify({ message: "<p>Contract End Date must be after Contract Start Date.</p>" })]) }, 417)).toEqual({ status: 417, message: "Contract End Date must be after Contract Start Date." });
  });
  it.each([
    "Traceback (most recent call last):\nFile '/srv/bench/internal.py', line 88\nValidationError: internal details",
    "Error: internal database details\n    at query (/srv/bench/db.js:33:10)",
    "pymysql.err.OperationalError: internal SQL details",
    "authorization: token foo:bar123456",
    "password=do-not-return-this",
    "api_secret: do-not-return-this",
    "private-key=do-not-return-this",
    "Bearer abcdefghijklmnopqrstuvwxyz",
    "-----BEGIN RSA PRIVATE KEY-----\nprivate-content\n-----END RSA PRIVATE KEY-----",
    "Failed connecting to https://user:pass@erp.test/private",
    "password&#61;html-encoded-secret",
    "ERP returned the configured fixture-secret in its message",
    "ERP returned the configured fixture-key in its message",
  ])("replaces unsafe upstream diagnostics with an actionable log instruction: %s", message => {
    const failure = clmErpFailure({ _server_messages: JSON.stringify([JSON.stringify({ message })]) }, 500, ["fixture-key", "fixture-secret"]);
    expect(failure).toEqual({ status: 500, message: "ERPNext could not complete the Contract action. Ask an administrator to inspect the ERP error log, then refresh the RFQ or Contract before retrying." });
  });
  it("uses a safe structured validation message while ignoring exception and trace fields", () => {
    expect(clmErpFailure({ message: "Select an enabled Legal Manager as the Contract's company signatory.", exception: "password=secret", exc: "Traceback secret" }, 409)).toEqual({ status: 409, message: "Select an enabled Legal Manager as the Contract's company signatory." });
  });
  it.each([null, [], { message: { message: "not a string" }, _server_messages: '[{"message":{"secret":"private"}}]' }, { _server_messages: "malformed" }])("handles malformed error envelopes without throwing: %j", payload => {
    expect(clmErpFailure(payload, 417)).toEqual({ status: 417, message: "ERPNext rejected the Contract action. Check the required fields and current workflow stage; ask an administrator to inspect the ERP error log if it continues." });
  });
  it("recognizes revision conflicts without returning their diagnostic timestamps", () => {
    expect(clmErpFailure({ exception: "frappe.exceptions.TimestampMismatchError: internal details" }, 417)).toEqual({ status: 409, message: "This record changed. Refresh before saving." });
  });
  it("checks the whole diagnostic for secrets before applying the display length limit", () => {
    expect(clmErpFailure({ message: "x".repeat(600) + " password=secret" }, 500).message).toContain("inspect the ERP error log");
    expect(clmErpFailure({ message: "x".repeat(600) }, 422).message).toHaveLength(500);
  });
  it("keeps missing document and permission failures actionable", () => {
    expect(clmErpFailure({ exception: "internal details" }, 403).message).toContain("gateway user's permissions");
    expect(clmErpFailure({ message: "internal details" }, 404)).toEqual({ status: 404, message: "Document not found." });
  });
});
