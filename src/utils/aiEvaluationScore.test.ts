import { describe, expect, it } from "vitest";
import {
  calculateWeightedEvaluationScore,
  validateAndScoreEvaluation,
  type EvaluationContext,
  type EvaluationWeights,
} from "./aiEvaluationScore";

const weights = { price_weight: 40, delivery_weight: 25, quality_weight: 20, reliability_weight: 15 };
const context: EvaluationContext = {
  rfq_id: "RFQ-91", evaluation_run_id: "run-current", weights,
  quotations: ["A", "B", "C"].map((id) => ({
    quotation_id: `Q-${id}`, supplier_id: `S-${id}`, supplier_name: `Supplier ${id}`, total_value: 15,
  })),
};
function row(id: string, changes: Record<string, unknown> = {}) {
  return {
    quotation_id: `Q-${id}`, supplier_id: `S-${id}`, supplier: `Supplier ${id}`,
    evaluation_run_id: context.evaluation_run_id, score: 75, price_score: 100,
    delivery_score: 72, quality_score: 100, reliability_score: 80,
    risk: "Low", verdict: "GOOD OPTION", ...changes,
  };
}
function response(ranking = [row("A"), row("B"), row("C")]) {
  return { rfq_id: context.rfq_id, evaluation_run_id: context.evaluation_run_id, ranking };
}

describe("configured supplier evaluation formula", () => {
  it("corrects the observed 75 arithmetic while retaining equal scores for identical criteria", () => {
    const result = validateAndScoreEvaluation(response(), context);
    const ranking = result.ranking as Array<Record<string, unknown>>;
    expect(ranking.map((item) => item.score)).toEqual([90, 90, 90]);
    expect(ranking.map((item) => item.raw_ai_score)).toEqual([75, 75, 75]);
  });

  it("uses each quotation's criteria and IDs when response order differs", () => {
    const result = validateAndScoreEvaluation(response([
      row("C", { delivery_score: 40, risk: "High" }),
      row("A", { delivery_score: 90 }), row("B", { delivery_score: 60 }),
    ]), context);
    const ranking = result.ranking as Array<Record<string, unknown>>;
    expect(ranking.map((item) => [item.quotation_id, item.supplier_id, item.score, item.risk])).toEqual([
      ["Q-A", "S-A", 95, "Low"], ["Q-B", "S-B", 87, "Low"], ["Q-C", "S-C", 82, "High"],
    ]);
  });

  it("keeps the model's ranking for genuine ties and updates verdict and summary after arithmetic changes", () => {
    const tied = validateAndScoreEvaluation(response([
      row("A", { rank: 3 }), row("B", { rank: 1 }), row("C", { rank: 2 }),
    ]), context);
    expect(tied.recommended_quotation_id).toBe("Q-B");
    const changed = validateAndScoreEvaluation({ ...response([
      row("A", { rank: 2 }), row("B", { rank: 3 }),
      row("C", { rank: 1, verdict: "BEST VALUE", price_score: 0, delivery_score: 0, quality_score: 0, reliability_score: 0 }),
    ]), recommendedSupplier: "Supplier C", summary: "Supplier C wins." }, context);
    const ranking = changed.ranking as Array<Record<string, unknown>>;
    expect(ranking[0].verdict).toBe("BEST VALUE");
    expect(ranking[2].verdict).toBe("GOOD OPTION");
    expect(changed.summary).toContain("Supplier A: score 90/100");
    expect(changed.summary).not.toContain("Supplier C wins");
    expect(changed.provider_summary).toBeUndefined();
    expect(changed.preserved_evaluation_summary).toBe("Supplier C wins.");
  });

  it("preserves configured business weights and the existing missing-price rule", () => {
    expect(calculateWeightedEvaluationScore({ price_score: 100, delivery_score: 20, quality_score: 60, reliability_score: 80 },
      { price_weight: 10, delivery_weight: 50, quality_weight: 30, reliability_weight: 10 })).toBe(46);
    expect(calculateWeightedEvaluationScore({ price_score: -1, delivery_score: 60, quality_score: 60, reliability_score: 60 }, weights)).toBe(60);
  });

  it("accepts a genuine overall zero and retains independent row objects", () => {
    const input = response([row("A", { score: 0, price_score: 0, delivery_score: 0, quality_score: 0, reliability_score: 0 }), row("B"), row("C")]);
    const output = validateAndScoreEvaluation(input, context).ranking as Array<Record<string, unknown>>;
    expect(output.find((item) => item.quotation_id === "Q-A")?.score).toBe(0);
    output[0].score = 99;
    expect(input.ranking[1].score).toBe(75);
    expect(output[1].score).toBe(90);
  });

  it.each([undefined, null, "75", Number.NaN, 101])("rejects incomplete or invalid overall scores (%s)", (score) => {
    expect(() => validateAndScoreEvaluation(response([row("A", { score }), row("B"), row("C")]), context)).toThrow(/incomplete/);
  });

  it.each(["price_score", "delivery_score", "quality_score", "reliability_score"])("rejects a missing %s rather than inventing a score", (field) => {
    expect(() => validateAndScoreEvaluation(response([row("A", { [field]: undefined }), row("B"), row("C")]), context)).toThrow(/incomplete/);
  });

  it("rejects duplicate, wrong-supplier, wrong-run and stale-RFQ results", () => {
    expect(() => validateAndScoreEvaluation(response([row("A"), row("A"), row("C")]), context)).toThrow(/identity/);
    expect(() => validateAndScoreEvaluation(response([row("A", { supplier_id: "S-B" }), row("B"), row("C")]), context)).toThrow(/identity/);
    expect(() => validateAndScoreEvaluation(response([row("A", { evaluation_run_id: "old-run" }), row("B"), row("C")]), context)).toThrow(/identity/);
    expect(() => validateAndScoreEvaluation({ ...response(), rfq_id: "old-rfq" }, context)).toThrow(/RFQ/);
  });

  it("requires valid named weights and per-supplier risk/verdict", () => {
    expect(() => calculateWeightedEvaluationScore({ price_score: 0, delivery_score: 0, quality_score: 0, reliability_score: 0 },
      { a: 25, b: 25, c: 25, d: 25 } as unknown as EvaluationWeights)).toThrow(/weights/);
    expect(() => validateAndScoreEvaluation(response([row("A", { risk: undefined }), row("B"), row("C")]), context)).toThrow(/risk/);
  });

  it("preserves 91/87/85 ranking while distinguishing High / AVOID from selection guidance", () => {
    const result = validateAndScoreEvaluation({ ...response([
      row("A", { rank: 1, score: 91, price_score: 100, delivery_score: 100, quality_score: 59,
        reliability_score: 95, risk: "High", verdict: "AVOID", reason: "A-specific quality history." }),
      row("B", { rank: 2, score: 87, price_score: 90, delivery_score: 100, quality_score: 80, reliability_score: 67 }),
      row("C", { rank: 3, score: 85, price_score: 100, delivery_score: 76, quality_score: 60, reliability_score: 93, risk: "Medium" }),
    ]), recommendedSupplier: "Supplier A", summary: "Unqualified recommendation for A." }, context);
    const rankings = result.ranking as Array<Record<string, unknown>>;
    expect(rankings.map((item) => [item.score, item.risk, item.verdict, item.recommendation_status])).toEqual([
      [91, "High", "AVOID", "REQUIRES_REVIEW"], [87, "Low", "GOOD OPTION", "RANKED_ALTERNATIVE"],
      [85, "Medium", "GOOD OPTION", "RANKED_ALTERNATIVE"],
    ]);
    expect(rankings[0].is_top_ranked).toBe(true);
    expect(result.recommended_quotation_id).toBe("Q-A");
    expect(result.summary).toContain("risk High; verdict AVOID");
    expect(result.summary).not.toContain("Unqualified recommendation");
    expect(result.provider_summary).toBeUndefined();
    expect(result.preserved_evaluation_summary).toBe("Unqualified recommendation for A.");
  });
});
