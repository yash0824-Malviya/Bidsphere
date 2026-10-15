import { describe, expect, it } from "vitest";
import { resolveRfqQuotationIdentity } from "./rfqQuotationIdentity";

const quotations = [
  { name: "SQ-titan", supplier: '"Titan Industrial Products LLC"', supplier_name: "Shared Name" },
  { name: "SQ-femsa", supplier: "FEMSA", supplier_name: "Shared Name" },
];

describe("RFQ selected and awarded quotation identity", () => {
  it("resolves the exact selected quotation without relying on display name or list order", () => {
    expect(resolveRfqQuotationIdentity("RFQ", { supplier_id: "FEMSA", quotation_id: "SQ-femsa", rfq_id: "RFQ" }, quotations)).toBe(quotations[1]);
  });

  it("preserves quoted ERP supplier IDs literally", () => {
    expect(resolveRfqQuotationIdentity("RFQ", { supplier_id: quotations[0].supplier, quotation_id: "SQ-titan" }, quotations)).toBe(quotations[0]);
    expect(() => resolveRfqQuotationIdentity("RFQ", { supplier_id: "Titan Industrial Products LLC", quotation_id: "SQ-titan" }, quotations)).toThrow(/unique current/);
  });

  it("rejects a stale or mismatched quote rather than selecting another supplier", () => {
    expect(() => resolveRfqQuotationIdentity("RFQ", { supplier_id: "FEMSA", quotation_id: "SQ-titan" }, quotations)).toThrow(/unique current/);
    expect(() => resolveRfqQuotationIdentity("RFQ", { supplier_id: "FEMSA", quotation_id: "SQ-old" }, quotations)).toThrow(/unique current/);
  });

  it("rejects wrong RFQ, display-name and substring identities", () => {
    expect(() => resolveRfqQuotationIdentity("RFQ", { supplier_id: "FEMSA", rfq_id: "OTHER" }, quotations)).toThrow(/current RFQ/);
    for (const supplier_id of ["Shared Name", "FEM", ""]) {
      expect(() => resolveRfqQuotationIdentity("RFQ", { supplier_id }, quotations)).toThrow();
    }
  });

  it("supports legacy awards by exact supplier ID only when one authoritative quote is available", () => {
    expect(resolveRfqQuotationIdentity("RFQ", { supplier_id: "FEMSA" }, quotations)).toBe(quotations[1]);
    expect(() => resolveRfqQuotationIdentity("RFQ", { supplier_id: "FEMSA" }, [...quotations, { name: "SQ-femsa-new", supplier: "FEMSA", supplier_name: "FEMSA" }])).toThrow(/unique current/);
  });

  it("deduplicates identical ERP child-join records without accepting contradictory identities", () => {
    expect(resolveRfqQuotationIdentity("RFQ", { supplier_id: "FEMSA", quotation_id: "SQ-femsa" }, [...quotations, quotations[1]])).toBe(quotations[1]);
    expect(() => resolveRfqQuotationIdentity("RFQ", { supplier_id: "FEMSA", quotation_id: "SQ-femsa" }, [...quotations, { ...quotations[1], supplier: "OTHER" }])).toThrow(/Conflicting/);
  });
});
