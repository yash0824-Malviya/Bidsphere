import { describe, expect, it } from "vitest";
import { getSupplierAwardEligibility } from "./supplierAwardEligibility";
import { projectSupplierDecision } from "./aiEvaluationDecision";
import type { SupplierAnalysisRow } from "../types/erpnext";

describe("supplier award eligibility", () => {
  it.each(["Low", "Medium", "High"] as const)("blocks AVOID regardless of risk %s or numerical rank", (risk) => {
    expect(getSupplierAwardEligibility({ verdict: "AVOID", risk }).awardEligible).toBe(false);
  });

  it.each(["Low", "Medium", "High"] as const)("allows a complete submitted GOOD OPTION with %s risk subject to existing approvals", (risk) => {
    expect(getSupplierAwardEligibility({ verdict: "GOOD OPTION", risk,
      evaluation_status: "complete", quote_price_status: "submitted" })).toEqual({ awardEligible: true });
  });

  it.each(["Low", "Medium", "High"] as const)("blocks QUOTE INCOMPLETE because of quotation completeness, independent of %s risk", (risk) => {
    const eligibility = getSupplierAwardEligibility({ verdict: "QUOTE INCOMPLETE", risk,
      evaluation_status: "complete", quote_price_status: "submitted" });
    expect(eligibility).toEqual({ awardEligible: false,
      awardIneligibilityReason: "Quote incomplete. Complete the supplier quotation before selection." });
    expect(eligibility.awardIneligibilityReason).not.toMatch(/risk/i);
  });

  it("does not invent a High-only veto where no authoritative rule exists", () => {
    expect(getSupplierAwardEligibility({ verdict: "GOOD OPTION", risk: "High" }).awardEligible).toBe(true);
  });

  it("fails closed for missing or incomplete assessments", () => {
    expect(getSupplierAwardEligibility(undefined).awardEligible).toBe(false);
    expect(getSupplierAwardEligibility({ verdict: "NOT EVALUATED" }).awardEligible).toBe(false);
    expect(getSupplierAwardEligibility({ verdict: "QUOTE INCOMPLETE" }).awardEligible).toBe(false);
    expect(getSupplierAwardEligibility({ verdict: "GOOD OPTION", evaluation_status: "incomplete" }).awardEligible).toBe(false);
  });

  it("preserves Atlantic at 91 and rank one while rejecting a forged eligibility flag", () => {
    const row: SupplierAnalysisRow = {
      name: "Atlantic Precision Manufacturing.", quotation_id: "PUR-SQTN-2026-00265",
      supplier_id: '\"Atlantic Precision Manufacturing.\"', rfq_id: "PUR-RFQ-2026-00094",
      rank: 1, risk: "High", verdict: "AVOID", awardEligible: true,
      score: { cost: 100, delivery: 100, quality: 59, reliability: 95, overall: 91 },
      grand_total: 2500, why_best_or_worst: "Overdue unreceived order.", strengths: [], weaknesses: [],
    };
    const projected = projectSupplierDecision(row, true);
    expect(projected).toMatchObject({ rank: 1, score: { overall: 91 }, risk: "High", verdict: "AVOID", awardEligible: false });
    expect(projected.awardIneligibilityReason).toBe("Supplier is currently marked AVOID due to high risk and cannot be selected for award.");
    expect(projected.recommendation_reason).toContain("The stored AVOID verdict blocks supplier selection, reverse bidding and purchase order creation");
    expect(row.awardEligible).toBe(true);
  });
});
