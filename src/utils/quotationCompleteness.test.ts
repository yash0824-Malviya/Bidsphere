import { describe, expect, it } from "vitest";
import {
  evaluateQuotationCompleteness,
  resolveSupplierVerdict,
} from "./quotationCompleteness";

describe("quotationCompleteness", () => {
  it("CASE 1: Submitted + all mandatory fields => COMPLETE", () => {
    const quote = {
      supplier: "Apex Fasteners Ltd",
      docstatus: 1,
      status: "Submitted",
      grand_total: 500,
      valid_till: "2026-10-30",
      items: [{ item_code: "FAST-001", qty: 10, rate: 50, amount: 500, delivery_days: 7 }],
    };

    const completeness = evaluateQuotationCompleteness(quote);
    expect(completeness).toEqual({
      quotation_status: "COMPLETE",
      is_complete: true,
      missing_fields: [],
    });

    const verdict = resolveSupplierVerdict({
      completeness,
      risk: "Low",
      rank: 1,
    });
    expect(verdict).toBe("BEST VALUE");
  });

  it("CASE 2: Submitted + high risk => COMPLETE + HIGH RISK (verdict: HIGH RISK / REVIEW)", () => {
    const apexQuote = {
      supplier: "Apex Fasteners Ltd",
      supplier_name: "Apex Fasteners Ltd",
      docstatus: 1,
      status: "Submitted",
      grand_total: 500,
      valid_till: "2026-10-30",
      items: [{ item_code: "FAST-001", qty: 10, rate: 50, amount: 500, delivery_days: 7 }],
    };

    const completeness = evaluateQuotationCompleteness(apexQuote);
    expect(completeness).toEqual({
      quotation_status: "COMPLETE",
      is_complete: true,
      missing_fields: [],
    });

    const verdict = resolveSupplierVerdict({
      completeness,
      risk: "High",
      rank: 1,
      existingVerdict: "QUOTE INCOMPLETE", // Even if existing verdict was incorrectly set to QUOTE INCOMPLETE
    });

    expect(verdict).toBe("HIGH RISK / REVIEW");
    expect(verdict).not.toBe("QUOTE INCOMPLETE");
  });

  it("CASE 3: AI score 88 => COMPLETE if quotation itself is complete", () => {
    const quote = {
      supplier: "Apex Fasteners Ltd",
      docstatus: 1,
      status: "Submitted",
      grand_total: 500,
      valid_till: "2026-10-30",
      items: [{ item_code: "FAST-001", qty: 10, rate: 50, amount: 500, delivery_days: 7 }],
      score: 88,
      ai_score: 88,
      reliability_score: 50,
      delivery_score: 72,
    };

    const completeness = evaluateQuotationCompleteness(quote);
    expect(completeness.is_complete).toBe(true);
    expect(completeness.quotation_status).toBe("COMPLETE");
    expect(completeness.missing_fields).toEqual([]);

    const verdict = resolveSupplierVerdict({
      completeness,
      risk: "High",
      rank: 1,
    });
    expect(verdict).toBe("HIGH RISK / REVIEW");
  });

  it("CASE 4: Missing mandatory field => INCOMPLETE + show missing field", () => {
    // Missing delivery date
    const quoteMissingDelivery = {
      supplier: "Apex Fasteners Ltd",
      docstatus: 1,
      status: "Submitted",
      grand_total: 500,
      items: [{ item_code: "FAST-001", qty: 10, rate: 50, amount: 500 }],
    };

    const completeness = evaluateQuotationCompleteness(quoteMissingDelivery);
    expect(completeness).toEqual({
      quotation_status: "INCOMPLETE",
      is_complete: false,
      missing_fields: ["Delivery Date"],
    });

    const verdict = resolveSupplierVerdict({
      completeness,
      risk: "High",
      rank: 1,
    });
    expect(verdict).toBe("QUOTE INCOMPLETE");
  });

  it("CASE 4c: Quotation with expected_delivery_date resolves Delivery Date and marks quotation COMPLETE", () => {
    const quoteWithDeliveryDate = {
      supplier: "Apex Fasteners Ltd",
      docstatus: 1,
      status: "Submitted",
      grand_total: 500,
      items: [
        {
          item_code: "FAST-001",
          qty: 10,
          rate: 50,
          amount: 500,
          expected_delivery_date: "2026-10-25",
        },
      ],
    };

    const completeness = evaluateQuotationCompleteness(quoteWithDeliveryDate);
    expect(completeness).toEqual({
      quotation_status: "COMPLETE",
      is_complete: true,
      missing_fields: [],
    });

    const verdict = resolveSupplierVerdict({
      completeness,
      risk: "Low",
      rank: 1,
    });
    expect(verdict).toBe("BEST VALUE");
  });

  it("CASE 4b: Missing pricing => INCOMPLETE + show missing field", () => {
    const quoteMissingPrice = {
      supplier: "Apex Fasteners Ltd",
      docstatus: 1,
      status: "Submitted",
      valid_till: "2026-10-30",
      items: [{ item_code: "FAST-001", qty: 10, rate: 0, amount: 0 }],
      grand_total: 0,
    };

    const completeness = evaluateQuotationCompleteness(quoteMissingPrice);
    expect(completeness).toEqual({
      quotation_status: "INCOMPLETE",
      is_complete: false,
      missing_fields: ["Pricing"],
    });
    expect(completeness.is_complete).toBe(false);
  });

  it("CASE 5: Draft quotation => INCOMPLETE / DRAFT according to existing workflow state", () => {
    const draftQuote = {
      supplier: "Apex Fasteners Ltd",
      docstatus: 0,
      status: "Draft",
      grand_total: 500,
      valid_till: "2026-10-30",
      items: [{ item_code: "FAST-001", qty: 10, rate: 50, amount: 500, delivery_days: 7 }],
    };

    const completeness = evaluateQuotationCompleteness(draftQuote);
    expect(completeness).toEqual({
      quotation_status: "INCOMPLETE",
      is_complete: false,
      missing_fields: ["Quotation Submission"],
    });

    const verdict = resolveSupplierVerdict({
      completeness,
      risk: "Low",
      rank: 1,
    });
    expect(verdict).toBe("QUOTE INCOMPLETE");
  });

  it("does not use optional fields (warranty, terms notes, insurance) to determine completeness", () => {
    const quoteWithoutOptionalDocs = {
      supplier: "Apex Fasteners Ltd",
      docstatus: 1,
      status: "Submitted",
      grand_total: 500,
      valid_till: "2026-10-30",
      items: [{ item_code: "FAST-001", qty: 10, rate: 50, amount: 500, delivery_days: 7 }],
      custom_warenty_certificate: null,
      custom_terms__condition: null,
      custom_insurance_certificate: null,
      notes: "",
    };

    const completeness = evaluateQuotationCompleteness(quoteWithoutOptionalDocs);
    expect(completeness.is_complete).toBe(true);
    expect(completeness.quotation_status).toBe("COMPLETE");
    expect(completeness.missing_fields).toEqual([]);
  });

  it("preserves AVOID verdict even if quotation is complete", () => {
    const completeQuote = {
      supplier: "Banned Supplier Inc",
      docstatus: 1,
      status: "Submitted",
      grand_total: 500,
      valid_till: "2026-10-30",
      items: [{ item_code: "FAST-001", qty: 10, rate: 50, amount: 500, delivery_days: 7 }],
    };

    const completeness = evaluateQuotationCompleteness(completeQuote);
    expect(completeness.is_complete).toBe(true);

    const verdict = resolveSupplierVerdict({
      completeness,
      risk: "High",
      rank: 1,
      existingVerdict: "AVOID",
    });
    expect(verdict).toBe("AVOID");
  });
});
