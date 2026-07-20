import { describe, expect, it } from "vitest";
import {
  classifyEnterpriseError,
  toEnterpriseUserMessage,
} from "./enterpriseUserMessage";

describe("toEnterpriseUserMessage", () => {
  it("never surfaces ERPNext / DocType details", () => {
    const msg = toEnterpriseUserMessage(
      new Error(
        'DocType Request for Quotation "RFQ-0001" does not exist in ERPNext',
      ),
    );
    expect(msg.toLowerCase()).not.toContain("erpnext");
    expect(msg.toLowerCase()).not.toContain("doctype");
    expect(msg.toLowerCase()).not.toContain("request for quotation");
  });

  it("maps network failures", () => {
    expect(classifyEnterpriseError(new Error("Network Error"))).toBe(
      "network",
    );
    expect(toEnterpriseUserMessage(new Error("Failed to fetch"))).toMatch(
      /communicating with the server/i,
    );
  });

  it("keeps short friendly validation copy", () => {
    expect(toEnterpriseUserMessage("Please select at least one supplier.")).toBe(
      "Please select at least one supplier.",
    );
  });

  it("masks stack traces", () => {
    const msg = toEnterpriseUserMessage(
      "Traceback (most recent call last):\n  File frappe.py",
    );
    expect(msg).toBe("Something went wrong. Please try again.");
  });

  it("does not treat Field not permitted as a permission denial", () => {
    const err = new Error(
      "frappe.exceptions.DataError: Field not permitted in query: custom_part_name",
    );
    expect(classifyEnterpriseError(err)).toBe("document");
    expect(toEnterpriseUserMessage(err)).toBe(
      "Field not permitted in query: custom_part_name",
    );
    expect(toEnterpriseUserMessage(err).toLowerCase()).not.toContain(
      "permission",
    );
  });
});
