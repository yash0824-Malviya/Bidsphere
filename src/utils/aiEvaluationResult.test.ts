import { describe, expect, it } from "vitest";
import { parseGeneratedRecommendation, type AIRequest } from "../api/ai";
import { scoringResultFromRecommendation } from "./aiEvaluationResult";

const weights = { price_weight: 40, delivery_weight: 25, quality_weight: 20, reliability_weight: 15 };
function recommendation() {
  const request: AIRequest = {
    rfq_name: "RFQ-91", rfq_title: "Current evaluation", evaluation_run_id: "run-current",
    items_requested: [{ item: "Part", qty: 1 }],
    quotations: ["A", "B", "C"].map((id) => ({
      quotation_id: `Q-${id}`, supplier_id: `S-${id}`, supplier_name: `Supplier ${id}`,
      total_value: 15, items: [{ item: "Part", unit_price: 15, total: 15 }],
    })),
  };
  return parseGeneratedRecommendation(JSON.stringify({
    rfq_id: request.rfq_name, evaluation_run_id: request.evaluation_run_id,
    recommendedSupplier: "Supplier B", summary: "Current run.",
    ranking: ["B", "C", "A"].map((id, index) => ({
      quotation_id: `Q-${id}`, supplier_id: `S-${id}`, supplier: `Supplier ${id}`,
      evaluation_run_id: request.evaluation_run_id, rank: index + 1, score: 75,
      price_score: 100, delivery_score: 72, quality_score: 75, reliability_score: 80,
      risk: "Low", verdict: index === 0 ? "BEST VALUE" : "GOOD OPTION", reason: `${id}'s current evaluation`,
    })),
  }), request);
}

describe("complete AI evaluation to persistence", () => {
  it("preserves each row's identity, run, quality and calculated score into persistence", () => {
    const rec = recommendation();
    rec.supplier_analysis[0].score_sources = [{ dimension: "Quality", value: 75, source: "Current quotation coverage", has_data: true }];
    const result = scoringResultFromRecommendation(rec, weights);
    expect(result.evaluation_run_id).toBe("run-current");
    expect(result.suppliers.map((row) => [row.quotation_id, row.supplier, row.final_score, row.dimensions.quality_score])).toEqual([
      ["Q-B", "S-B", 85, 75], ["Q-C", "S-C", 85, 75], ["Q-A", "S-A", 85, 75],
    ]);
    result.suppliers[0].score_sources[0].value = 99;
    expect(rec.supplier_analysis[0].score_sources[0].value).toBe(75);
  });

  it("rejects the original arithmetic bug and changed configuration before database persistence", () => {
    const rec = recommendation();
    rec.supplier_analysis[0].score.overall = 75;
    expect(() => scoringResultFromRecommendation(rec, weights)).toThrow(/four dimensions/);
    expect(() => scoringResultFromRecommendation(recommendation(), {
      price_weight: 25, delivery_weight: 25, quality_weight: 25, reliability_weight: 25,
    })).toThrow(/weights/);
  });

  it("rejects missing AI data, duplicate identities and mixed runs without a local fallback", () => {
    const missing = recommendation();
    missing.supplier_analysis[0].score.quality = undefined;
    expect(() => scoringResultFromRecommendation(missing, weights)).toThrow(/incomplete/);
    const stale = recommendation();
    stale.supplier_analysis[0].evaluation_run_id = "previous-run";
    expect(() => scoringResultFromRecommendation(stale, weights)).toThrow(/identity/);
    const duplicate = recommendation();
    duplicate.supplier_analysis[1].quotation_id = duplicate.supplier_analysis[0].quotation_id;
    expect(() => scoringResultFromRecommendation(duplicate, weights)).toThrow(/identity/);
  });

  it("preserves a genuine calculated zero", () => {
    const rec = recommendation();
    rec.supplier_analysis[0].score = { cost: 0, delivery: 0, quality: 0, reliability: 0, overall: 0 };
    expect(scoringResultFromRecommendation(rec, weights).suppliers[0].final_score).toBe(0);
  });
});
