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

  it("surfaces ERPNext warehouse company validation", () => {
    expect(
      toEnterpriseUserMessage(
        "frappe.exceptions.ValidationError: Warehouse Stores - B does not belong to company Netlink",
      ),
    ).toBe("Warehouse Stores - B does not belong to company Netlink");
  });

  it("surfaces Mandatory field validation", () => {
    expect(
      toEnterpriseUserMessage(
        "MandatoryError: [Stock Entry Detail, row 1]: Mandatory field warehouse is missing",
      ),
    ).toBe("[Stock Entry Detail, row 1]: Mandatory field warehouse is missing");
  });

  it("masks bare stack traces without a validation line", () => {
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
