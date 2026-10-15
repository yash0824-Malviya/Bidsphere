import { describe, expect, it } from "vitest";
import type { SupplierAnalysisRow } from "../types/erpnext";
import { reverseBiddingSelectionForRow, selectedReverseBiddingQuotations, validateReverseBiddingSelection } from "./reverseBiddingSelection";

function row(id: string, supplierId = `SUP-${id}`): SupplierAnalysisRow {
  return {
    quotation_id: `SQ-${id}`, supplier_quotation_id: `SQ-${id}`, supplier_id: supplierId,
    rfq_id: "RFQ-current", name: "Same supplier display name", rank: 1,
    grand_total: 50, verdict: "BEST VALUE", score: { overall: 100, cost: 100, delivery: 100, quality: 100, reliability: 100 },
    strengths: [], weaknesses: [], why_best_or_worst: "",
  };
}

describe("reverse bidding quotation selection", () => {
  it("keeps a high-scoring AVOID row visible in source data but excludes it from selection", () => {
    const blocked = { ...row("Atlantic"), verdict: "AVOID" as const, risk: "High" as const };
    expect(reverseBiddingSelectionForRow(blocked)).toBeNull();
    expect(() => selectedReverseBiddingQuotations([blocked], new Set(["SQ-Atlantic"]))).toThrow(/AVOID/);
    expect(blocked.rank).toBe(1);
    expect(blocked.score.overall).toBe(100);
  });

  it("continues allowing Low and Medium risk GOOD OPTION rows", () => {
    const allowed = [
      { ...row("FEMSA"), verdict: "GOOD OPTION" as const, risk: "Low" as const },
      { ...row("Blue"), verdict: "GOOD OPTION" as const, risk: "Medium" as const },
    ];
    expect(selectedReverseBiddingQuotations(allowed, new Set(["SQ-FEMSA", "SQ-Blue"]))).toHaveLength(2);
  });
  it("passes the selected quotation identities regardless of row order or duplicate display names", () => {
    const titan = row("titan", '"Titan Industrial Products LLC"');
    const femsa = row("femsa", "FEMSA");
    expect(selectedReverseBiddingQuotations([row("other"), femsa, titan], new Set(["SQ-titan", "SQ-femsa"]))).toEqual([
      { quotation_id: "SQ-titan", supplier_id: '"Titan Industrial Products LLC"', rfq_id: "RFQ-current" },
      { quotation_id: "SQ-femsa", supplier_id: "FEMSA", rfq_id: "RFQ-current" },
    ]);
  });

  it("supports the existing supplier_quotation_id alias without changing its identity", () => {
    const input = row("A");
    delete input.quotation_id;
    expect(reverseBiddingSelectionForRow(input)?.quotation_id).toBe("SQ-A");
  });

  it.each(["supplier_id", "rfq_id"] as const)("rejects missing %s instead of using the display name", (field) => {
    const input = row("A");
    delete input[field];
    expect(reverseBiddingSelectionForRow(input)).toBeNull();
  });

  it("rejects missing and conflicting quotation identifiers", () => {
    const input = row("A");
    input.supplier_quotation_id = "SQ-wrong";
    expect(reverseBiddingSelectionForRow(input)).toBeNull();
    delete input.quotation_id;
    delete input.supplier_quotation_id;
    expect(reverseBiddingSelectionForRow(input)).toBeNull();
  });

  it("rejects stale selection after the current quotation changes", () => {
    expect(() => selectedReverseBiddingQuotations([row("new")], new Set(["SQ-old"]))).toThrow(/no longer available/);
  });

  it("never resolves a display name or an array index as a quotation", () => {
    for (const badId of ["Same supplier display name", "SUP-A", "0"]) {
      expect(() => selectedReverseBiddingQuotations([row("A")], new Set([badId]))).toThrow(/no longer available/);
    }
  });

  it("rejects duplicate quotation rows and two quotes for the same supplier", () => {
    expect(() => selectedReverseBiddingQuotations([row("A"), row("A")], new Set(["SQ-A"]))).toThrow(/no longer available/);
    expect(() => selectedReverseBiddingQuotations([row("A", "SUP"), row("B", "SUP")], new Set(["SQ-A", "SQ-B"]))).toThrow(/one current quotation/);
  });

  it("rejects rows from different RFQs", () => {
    const b = row("B"); b.rfq_id = "RFQ-other";
    expect(() => selectedReverseBiddingQuotations([row("A"), b], new Set(["SQ-A", "SQ-B"]))).toThrow(/current RFQ/);
  });

  it("validates exact current ERP quote IDs without mutating the selection", () => {
    const selection = selectedReverseBiddingQuotations([row("A"), row("B")], new Set(["SQ-B", "SQ-A"]));
    const result = validateReverseBiddingSelection("RFQ-current", selection, [{ name: "SQ-A", supplier: "SUP-A" }, { name: "SQ-B", supplier: "SUP-B" }]);
    expect(result).toEqual(selection);
    expect(result).not.toBe(selection);
    expect(result[0]).not.toBe(selection[0]);
  });

  it("rejects current RFQ mismatch, stale SQ and mismatched supplier instead of fuzzy fallback", () => {
    const selection = selectedReverseBiddingQuotations([row("A")], new Set(["SQ-A"]));
    expect(() => validateReverseBiddingSelection("RFQ-other", selection, [{ name: "SQ-A", supplier: "SUP-A" }])).toThrow(/current RFQ/);
    expect(() => validateReverseBiddingSelection("RFQ-current", selection, [{ name: "SQ-old", supplier: "SUP-A" }])).toThrow(/current RFQ/);
    expect(() => validateReverseBiddingSelection("RFQ-current", selection, [{ name: "SQ-A", supplier: "SUP-A-OTHER" }])).toThrow(/current RFQ/);
    expect(() => validateReverseBiddingSelection("RFQ-current", [...selection, ...selection], [{ name: "SQ-A", supplier: "SUP-A" }])).toThrow(/current RFQ/);
  });

  it("accepts repeated ERP child-join rows for one quotation but rejects conflicting suppliers", () => {
    const selection = selectedReverseBiddingQuotations([row("A")], new Set(["SQ-A"]));
    const quote = { name: "SQ-A", supplier: "SUP-A" };
    expect(validateReverseBiddingSelection("RFQ-current", selection, [quote, { ...quote }])).toEqual(selection);
    expect(() => validateReverseBiddingSelection("RFQ-current", selection, [quote, { ...quote, supplier: "SUP-other" }])).toThrow(/current RFQ/);
  });
});
