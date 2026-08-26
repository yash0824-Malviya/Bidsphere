import { describe, expect, it } from "vitest";
import {
  hasProtectedRfqTraceMutation,
  PROTECTED_RFQ_TRACE_MUTATION_MESSAGE,
} from "./rfqTraceGuard";

describe("hasProtectedRfqTraceMutation", () => {
  it("directs each protected trace to its sole trusted endpoint", () => {
    expect(PROTECTED_RFQ_TRACE_MUTATION_MESSAGE).toContain("/api/create-rfq-from-ecr");
    expect(PROTECTED_RFQ_TRACE_MUTATION_MESSAGE).toContain("/api/create-rfq-from-pr");
  });

  it("detects protected fields in RFQ documents", () => {
    expect(hasProtectedRfqTraceMutation({
      doc: { custom_purchase_requisition_reference: "PR-0001" },
    })).toBe(true);
    expect(hasProtectedRfqTraceMutation({
      custom_bidsphere_ecr_idempotency_key: "ECR-0001",
    })).toBe(true);
  });

  it("detects frappe.client.set_value field selectors", () => {
    expect(hasProtectedRfqTraceMutation({
      doctype: "Request for Quotation",
      fieldname: "custom_bidsphere_pr_idempotency_key",
      value: "PR-0001",
    })).toBe(true);
    expect(hasProtectedRfqTraceMutation({
      fieldname: { custom_ecr_reference: "ECR-0001" },
    })).toBe(true);
    expect(hasProtectedRfqTraceMutation({
      fields: ["status", "custom_purchase_requisition_reference"],
    })).toBe(true);
  });

  it("allows standalone RFQ fields used by the normal sourcing flow", () => {
    expect(hasProtectedRfqTraceMutation({
      doc: {
        doctype: "Request for Quotation",
        status: "Draft",
        items: [{ item_code: "REAL-ITEM" }],
      },
    })).toBe(false);
    expect(hasProtectedRfqTraceMutation({
      fieldname: "status",
      value: "Open",
    })).toBe(false);
  });
});
