import { describe, expect, it } from "vitest";
import type { AIRecommendation, SupplierAnalysisRow } from "../types/erpnext";
import { applyEvaluationDecisionProjection, buildEvaluationSummary, getEvaluationRisk, projectSupplierDecision } from "./aiEvaluationDecision";

function row(overrides: Partial<SupplierAnalysisRow> = {}): SupplierAnalysisRow {
  return {
    name: "Atlantic", quotation_id: "Q-A", supplier_id: "S-A", evaluation_run_id: "run-1",
    rank: 1, risk: "High", verdict: "AVOID", grand_total: 2500,
    score: { cost: 100, delivery: 100, quality: 59, reliability: 95, overall: 91 },
    strengths: [], weaknesses: [], why_best_or_worst: "Historical received quantity is below ordered quantity.",
    ...overrides,
  };
}

describe("same-evaluation decision projection", () => {
  it("keeps Apex 88/High/QUOTE INCOMPLETE at rank one while only Blue Ridge and Redwood are award eligible", () => {
    const apex = row({ name: "Apex Fasteners Ltd", supplier_id: "APEX", quotation_id: "Q-APEX",
      rank: 1, risk: "High", verdict: "QUOTE INCOMPLETE", score: { ...row().score, overall: 88 },
      grand_total: 30, evaluation_status: "complete", quote_price_status: "submitted",
      why_best_or_worst: "Stored quotation is incomplete.", awardEligible: true });
    const blue = row({ name: "Blue Ridge Manufacturing Inc", supplier_id: "BLUE", quotation_id: "Q-BLUE",
      rank: 2, risk: "Low", verdict: "GOOD OPTION", score: { ...row().score, overall: 85 }, why_best_or_worst: "Blue Ridge evaluation." });
    const redwood = row({ name: "Redwood Supply Chain Partners", supplier_id: "REDWOOD", quotation_id: "Q-REDWOOD",
      rank: 3, risk: "Medium", verdict: "GOOD OPTION", score: { ...row().score, overall: 81 }, why_best_or_worst: "Redwood evaluation." });
    const source = { supplier_analysis: [apex, blue, redwood], recommended_supplier: apex.name,
      recommended_supplier_id: apex.supplier_id, recommended_quotation_id: apex.quotation_id,
      recommendation_summary: "Apex is the recommended supplier.",
      evaluation_weights: { price_weight: 40, delivery_weight: 25, quality_weight: 20, reliability_weight: 15 } } as AIRecommendation;
    const before = structuredClone(source);
    const projected = applyEvaluationDecisionProjection(source);
    expect(projected.supplier_analysis.map(item => ({ rank: item.rank, score: item.score.overall, risk: item.risk, verdict: item.verdict, awardEligible: item.awardEligible }))).toEqual([
      { rank: 1, score: 88, risk: "High", verdict: "QUOTE INCOMPLETE", awardEligible: false },
      { rank: 2, score: 85, risk: "Low", verdict: "GOOD OPTION", awardEligible: true },
      { rank: 3, score: 81, risk: "Medium", verdict: "GOOD OPTION", awardEligible: true },
    ]);
    expect(projected.supplier_analysis.map(item => item.is_top_ranked)).toEqual([true, false, false]);
    expect(projected.supplier_analysis[0].recommendation_status).toBe("NOT_EVALUATED");
    expect(projected.supplier_analysis[0].awardIneligibilityReason).toBe("Quote incomplete. Complete the supplier quotation before selection.");
    expect(projected.recommendation_summary).toContain("Apex Fasteners Ltd: score 88/100; risk High; verdict QUOTE INCOMPLETE");
    expect(projected.recommendation_summary).toContain("Highest numerical score: 88/100. Stored risk: High. The quotation is incomplete, so this supplier is ineligible for selection and award.");
    expect(projected.recommendation_summary).not.toContain("Apex is the recommended supplier");
    expect(projected.supplier_analysis[0].recommendation_reason).not.toContain("AI top-ranked");
    expect(projected.evaluation_weights).toEqual(before.evaluation_weights);
    expect(source).toEqual(before);
    expect(applyEvaluationDecisionProjection(projected)).toEqual(projected);
  });
  it("preserves a high-score leader's High risk and AVOID with an explicit review interpretation", () => {
    const source = row();
    const result = projectSupplierDecision(source);
    expect(result).toMatchObject({ score: source.score, risk: "High", verdict: "AVOID", is_top_ranked: true,
      recommendation_status: "REQUIRES_REVIEW", recommendation_basis: "weighted_score" });
    expect(result.recommendation_reason).toContain("High risk and AVOID verdict requires review");
    expect(result.recommendation_reason).toContain("not an award recommendation or approval");
    expect(source).not.toHaveProperty("recommendation_status");
  });

  it("keeps a High risk warning separate from eligibility for a complete submitted GOOD OPTION", () => {
    const source = row({ name: "ABC Supplier", risk: "High", verdict: "GOOD OPTION",
      evaluation_status: "complete", quote_price_status: "submitted", score: { ...row().score, overall: 82 } });
    const projected = projectSupplierDecision(source);
    expect(projected).toMatchObject({ rank: 1, score: { overall: 82 }, risk: "High", verdict: "GOOD OPTION",
      awardEligible: true, recommendation_status: "REQUIRES_REVIEW" });
    expect(projected.awardIneligibilityReason).toBeUndefined();
    expect(projected.recommendation_reason).toContain("High risk requires review");
    expect(projected.recommendation_reason).not.toContain("ineligible");
  });

  it.each([
    { risk: "High" as const, verdict: "GOOD OPTION" as const },
    { risk: "Low" as const, verdict: "AVOID" as const },
  ])("requires review for either explicit High risk or AVOID without changing the verdict (%j)", (assessment) => {
    expect(projectSupplierDecision(row(assessment))).toMatchObject({ ...assessment, recommendation_status: "REQUIRES_REVIEW" });
  });

  it("never guesses missing risk from a high or low score", () => {
    for (const score of [99, 20]) {
      const source = row({ risk: undefined, verdict: "GOOD OPTION", score: { ...row().score, overall: score } });
      expect(getEvaluationRisk(source)).toBe("Unavailable");
      expect(projectSupplierDecision(source).recommendation_status).toBe("REQUIRES_REVIEW");
      expect(projectSupplierDecision(source).risk).toBeUndefined();
    }
  });

  it("keeps legacy generic reasoning neutral rather than presenting a negative assessment as a strength", () => {
    const source = row();
    source.strengths = [source.why_best_or_worst, "Independent positive evidence."];
    const projected = projectSupplierDecision(source);
    expect(projected.strengths).toEqual(["Independent positive evidence."]);
    expect(projected.why_best_or_worst).toBe(source.why_best_or_worst);
  });

  it("distinguishes ranked alternatives and genuine missing evaluation/pricing", () => {
    expect(projectSupplierDecision(row({ rank: 2, risk: "Low", verdict: "GOOD OPTION" })))
      .toMatchObject({ is_top_ranked: false, recommendation_status: "RANKED_ALTERNATIVE" });
    expect(projectSupplierDecision(row({ evaluation_status: "incomplete" })))
      .toMatchObject({ recommendation_status: "NOT_EVALUATED" });
    expect(projectSupplierDecision(row({ score: { ...row().score, cost: -1 } })))
      .toMatchObject({ recommendation_status: "NOT_EVALUATED" });
  });

  it("keeps supplier identities separate, replaces contradictory global guidance, and retains original narrative", () => {
    const rows = [row(), row({ name: "FEMSA", rank: 2, supplier_id: "S-F", quotation_id: "Q-F", risk: "Low",
      verdict: "GOOD OPTION", grand_total: 2600, score: { ...row().score, overall: 87 }, why_best_or_worst: "FEMSA-specific evidence." })];
    const original = { supplier_analysis: rows, recommended_supplier: "Atlantic", recommended_quotation_id: "Q-A",
      recommended_supplier_id: "S-A", recommendation_summary: "Proceed with Atlantic without concern.",
      final_verdict: "Proceed.", confidence_score: 91 } as AIRecommendation;
    const output = applyEvaluationDecisionProjection(original);
    expect(output.provider_summary).toBeUndefined();
    expect(output.preserved_evaluation_summary).toBe(original.recommendation_summary);
    expect(output.recommendation_summary).not.toContain("without concern");
    expect(output.recommendation_summary).toContain("Atlantic: score 91/100; risk High; verdict AVOID; quote total 2,500");
    expect(output.recommendation_summary).toContain("FEMSA: score 87/100; risk Low; verdict GOOD OPTION; quote total 2,600");
    expect(output.recommendation_summary).toContain("FEMSA-specific evidence");
    expect(output.final_verdict).toBe(output.recommendation_summary);
    expect(output.reason).toBe(output.recommendation_summary);
    expect(applyEvaluationDecisionProjection(output)).toEqual(output);
    expect(output.supplier_analysis.map((item) => item.recommendation_status)).toEqual(["REQUIRES_REVIEW", "RANKED_ALTERNATIVE"]);
  });

  it("does not let a duplicate display name override exact IDs", () => {
    const rows = [row({ name: "Shared" }), row({ name: "Shared", rank: 2, quotation_id: "Q-B", supplier_id: "S-B" })];
    const output = applyEvaluationDecisionProjection({ supplier_analysis: rows, recommended_supplier: "Shared",
      recommended_quotation_id: "Q-B", recommended_supplier_id: "S-B" } as AIRecommendation);
    expect(output.supplier_analysis.map((item) => item.is_top_ranked)).toEqual([false, true]);
    expect(buildEvaluationSummary(output.supplier_analysis)).toBe(output.recommendation_summary);
  });

  it("preserves explicitly captured provider narrative without claiming that a saved summary was raw provider output", () => {
    const result = applyEvaluationDecisionProjection({ supplier_analysis: [row()], recommended_supplier: "Atlantic",
      recommendation_summary: "Backend-generated summary.", provider_summary: "Actual captured provider summary." } as AIRecommendation);
    expect(result.provider_summary).toBe("Actual captured provider summary.");
    expect(result.preserved_evaluation_summary).toBeUndefined();
    expect(applyEvaluationDecisionProjection(result)).toEqual(result);
  });
});
