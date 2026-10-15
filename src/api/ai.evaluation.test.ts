import { describe, expect, it, vi } from "vitest";
import { buildAnalysisPrompt, parseGeneratedRecommendation, resolveAIRecommendation, type AIRequest } from "./ai";
import type { SupplierPerformanceData } from "./supplierPerformance";

const payload: AIRequest = {
  rfq_name: "RFQ-91", rfq_title: "Supplier scoring", evaluation_run_id: "run-current",
  items_requested: [{ item: "AP001", qty: 1 }],
  quotations: ["A", "B", "C"].map((id) => ({
    quotation_id: `Q-${id}`, supplier_id: `"Supplier ${id}"`, supplier_name: `Supplier ${id}`,
    total_value: 15, items: [{ item: "AP001", requested_qty: 1, unit_price: 15, total: 15 }],
    documents: { warranty_certificate: true, terms_conditions: true, insurance_certificate: true },
  })),
};
function response() {
  return {
    rfq_id: payload.rfq_name, evaluation_run_id: payload.evaluation_run_id,
    ranking: [...payload.quotations].reverse().map((quote) => ({
      quotation_id: quote.quotation_id, supplier_id: quote.supplier_id, supplier: quote.supplier_name,
      evaluation_run_id: payload.evaluation_run_id, rank: 1, score: 75,
      price_score: 100, delivery_score: 72, quality_score: 75, reliability_score: 80,
      risk: "Low", verdict: "GOOD OPTION", reason: "Delivery unavailable; neutral delivery assumption.",
    })),
    recommendedSupplier: "Supplier A", summary: "Equivalent quotation criteria produce a valid tie.",
  };
}

describe("supplier-specific Claude evaluation contract", () => {
  it("keeps the model's quality and raw score while computing all four weighted dimensions", () => {
    const recommendation = parseGeneratedRecommendation(JSON.stringify(response()), payload);
    expect(recommendation.supplier_analysis).toHaveLength(3);
    expect(recommendation.supplier_analysis.map((row) => row.quotation_id)).toEqual(["Q-A", "Q-B", "Q-C"]);
    for (const row of recommendation.supplier_analysis) {
      expect(row.score).toEqual({ cost: 100, delivery: 72, quality: 75, reliability: 80, overall: 85 });
      expect(row.raw_ai_score).toBe(75);
      expect(row.evaluation_run_id).toBe("run-current");
      expect(row.risk).toBe("Low");
    }
    expect(recommendation.recommended_quotation_id).toBe("Q-A");
    expect(recommendation.evaluation_weights).toEqual({ price_weight: 40, delivery_weight: 25, quality_weight: 20, reliability_weight: 15 });
  });

  it("rejects stripped literal quotes in supplier IDs and missing model scores", () => {
    const wrongId = response();
    wrongId.ranking[0].supplier_id = "Supplier C";
    expect(() => parseGeneratedRecommendation(JSON.stringify(wrongId), payload)).toThrow(/identity/);
    const missing = response();
    delete (missing.ranking[0] as { score?: number }).score;
    expect(() => parseGeneratedRecommendation(JSON.stringify(missing), payload)).toThrow(/incomplete/);
  });

  it("keeps exact quotation IDs that differ by case, quotes or punctuation", () => {
    const ids = ["Q-A", '"Q-A"', "q-a."];
    const request: AIRequest = { ...payload, quotations: payload.quotations.map((quote, index) => ({
      ...quote, quotation_id: ids[index],
    })) };
    const raw = response();
    raw.ranking = request.quotations.map((quote, index) => ({
      ...raw.ranking[index], quotation_id: quote.quotation_id, supplier_id: quote.supplier_id,
      supplier: quote.supplier_name,
    }));
    const result = parseGeneratedRecommendation(JSON.stringify(raw), request);
    expect(result.supplier_analysis).toHaveLength(3);
    expect(new Set(result.supplier_analysis.map((row) => row.quotation_id))).toEqual(new Set(ids));
    for (const quote of request.quotations) {
      expect(result.supplier_analysis.find((row) => row.quotation_id === quote.quotation_id)?.supplier_id).toBe(quote.supplier_id);
    }
  });

  it("builds independent prompt blocks, preserves JSON-escaped IDs and explicitly permits genuine ties", () => {
    const prompt = buildAnalysisPrompt(payload);
    for (const quote of payload.quotations) {
      expect(prompt).toContain(JSON.stringify(quote.quotation_id));
      expect(prompt).toContain(JSON.stringify(quote.supplier_id));
    }
    expect(prompt).toContain('"quality_score"');
    expect(prompt).toContain("Equal scores are valid");
    expect(prompt).toContain("existing neutral scoring rule (70-75)");
    expect(prompt).not.toContain("MUST differentiate");
    expect(prompt).not.toContain("(Verified)");
    expect(prompt).not.toContain("7-14 days lead time expected");
    expect(prompt).toContain("weighted-score leader only");
    expect(prompt).toContain("A high numerical score does not mean Low risk");
    expect(prompt).toContain("review is required despite the high score");
  });

  it("keeps the score leader's High / AVOID assessment through parsing and exposes coherent summary facts", () => {
    const raw = response();
    raw.ranking = raw.ranking.map((item) => ({ ...item, score: 91, price_score: 100,
      delivery_score: item.quotation_id === "Q-A" ? 100 : 50, quality_score: 59, reliability_score: 95,
      risk: item.quotation_id === "Q-A" ? "High" : "Low", verdict: item.quotation_id === "Q-A" ? "AVOID" : "GOOD OPTION" }));
    raw.summary = "Supplier A is an unqualified recommendation.";
    const result = parseGeneratedRecommendation(JSON.stringify(raw), payload);
    expect(result.supplier_analysis[0]).toMatchObject({ quotation_id: "Q-A", supplier_id: '"Supplier A"',
      risk: "High", verdict: "AVOID", score: { overall: 91 }, is_top_ranked: true, recommendation_status: "REQUIRES_REVIEW" });
    expect(result.provider_summary).toBeUndefined();
    expect(result.preserved_evaluation_summary).toBe(raw.summary);
    expect(result.supplier_analysis[0].strengths).toEqual([]);
    expect(result.supplier_analysis[0].why_best_or_worst).toBe(raw.ranking.find((row) => row.quotation_id === "Q-A")?.reason);
    expect(result.recommendation_summary).toContain("Supplier A: score 91/100; risk High; verdict AVOID");
    expect(result.recommendation_summary).not.toContain("unqualified recommendation");
    expect(result.final_verdict).toBe(result.recommendation_summary);
  });

  it("sends the quote identity and configured weight context to the server-side gateway", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true, text: JSON.stringify(response()), tokensUsed: 123,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const recommendation = await resolveAIRecommendation(payload);
      expect(recommendation?.recommendation.supplier_analysis[0].score.overall).toBe(85);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/ai/claude");
      const request = JSON.parse(options.body);
      expect(request.evaluation_context.evaluation_run_id).toBe("run-current");
      expect(request.evaluation_context.quotations.map((quote: { quotation_id: string }) => quote.quotation_id)).toEqual(["Q-A", "Q-B", "Q-C"]);
      expect(options.headers["x-api-key"]).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps real delivery history available when all quotations omit delivery days", () => {
    function history(supplier: string, deliveryScore: number): SupplierPerformanceData {
      return {
        supplier_name: supplier, total_pos: 2, completed_pos: 2, cancelled_pos: 0,
        total_po_value: 30, total_grns: 2, on_time_deliveries: deliveryScore === 100 ? 2 : 1,
        late_deliveries: deliveryScore === 100 ? 0 : 1, avg_delay_days: deliveryScore === 100 ? 0 : 5,
        total_ordered_qty: 2, total_received_qty: 2, total_rejected_qty: 0, qty_accuracy_pct: 100,
        total_invoices: 0, invoices_on_time: 0, delivery_score: deliveryScore, quality_score: 100,
        reliability_score: 100, has_sufficient_data: true, data_sources: ["Purchase Receipts"],
        data_points_count: 4, has_delivery_data: true, has_quality_data: true, has_reliability_data: true,
      };
    }
    const withHistory: AIRequest = {
      ...payload,
      quotations: payload.quotations.map((quote, index) => ({
        ...quote, historical_data: history(quote.supplier_name, index === 2 ? 35 : 100),
      })),
    };
    const prompt = buildAnalysisPrompt(withHistory);
    const supplierBlocks = prompt.split(/SUPPLIER \d+:/).slice(1);
    expect(supplierBlocks[0]).toContain('"delivery_score":100');
    expect(supplierBlocks[1]).toContain('"delivery_score":100');
    expect(supplierBlocks[2]).toContain('"delivery_score":35');
    expect(prompt).toContain('"has_delivery_data":true');
    expect(prompt).toContain("missing quotation days must NOT erase available delivery history");
    expect(prompt).toContain("Only when BOTH quoted days and valid delivery history are unavailable");
    expect(prompt).toContain("quotedDeliveryScore * 0.40 + historical_data.delivery_score * 0.60");
    expect(prompt).toContain("coverageScore * 0.30 + historical_data.quality_score * 0.70");
    expect(prompt).toContain("use that supplied historical score unchanged");
    expect(prompt).not.toContain("verified certificates");
  });
});
