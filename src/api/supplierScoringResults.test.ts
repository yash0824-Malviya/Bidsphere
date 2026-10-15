import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIRecommendation, SupplierScoringResult } from "../types/erpnext";
import type { ScoringEngineResult } from "./supplierScoringEngine";

const erp = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("./erpnext", () => ({
  apiGet: erp.get, apiPost: erp.post,
  buildResourceUrl: (doctype: string, name?: string) => `${doctype}/${name ?? ""}`,
  buildListConfig: (config: unknown) => config,
  withSilent: () => ({}),
}));

import { getLatestAnalysisSnapshot, saveScoringResult } from "./supplierScoringResults";

function fixture() {
  const result: ScoringEngineResult = {
    weights: { price_weight: 40, delivery_weight: 25, quality_weight: 20, reliability_weight: 15 },
    scored_at: "2026-09-17 10:00:00",
    suppliers: [
      { supplier: "S-A", supplier_name: "Alpha", dimensions: { price_score: 0, delivery_score: 0, quality_score: 0, reliability_score: 0 },
        final_score: 0, ranking: 2, recommendation_reason: "Alpha reason", score_sources: [], has_sufficient_data: true, confidence_level: "high" },
      { supplier: "S-B", supplier_name: "Beta", dimensions: { price_score: 90, delivery_score: 80, quality_score: 75, reliability_score: 70 },
        final_score: 81.5, ranking: 1, recommendation_reason: "Beta reason", score_sources: [], has_sufficient_data: true, confidence_level: "high" },
    ],
  };
  const analysis: AIRecommendation = {
    rfq_id: "RFQ-1", evaluation_run_id: "RUN-1", recommended_supplier: "Beta", confidence_score: 81.5,
    recommendation_summary: "Beta is recommended for this run.", final_verdict: "Beta wins.",
    supplier_analysis: result.suppliers.map((supplier) => ({
      quotation_id: supplier.supplier === "S-A" ? "Q-A" : "Q-B", supplier_id: supplier.supplier,
      evaluation_run_id: "RUN-1", rfq_id: "RFQ-1", name: supplier.supplier_name, rank: supplier.ranking,
      score: { overall: supplier.final_score, cost: supplier.dimensions.price_score, delivery: supplier.dimensions.delivery_score,
        quality: supplier.dimensions.quality_score, reliability: supplier.dimensions.reliability_score },
      grand_total: 15, verdict: "GOOD OPTION", risk: supplier.supplier === "S-A" ? "High" : "Low",
      strengths: [], weaknesses: [], why_best_or_worst: supplier.recommendation_reason,
      score_sources: [{ dimension: "Quality", value: supplier.dimensions.quality_score, source: supplier.supplier, has_data: true }],
    })),
    cost_analysis: { savings_vs_expensive: "", savings_percentage: 0, price_range: "" },
    per_item_analysis: [], risk_flags: [], negotiation_tips: [],
    split_order_option: { recommended: false, reason: "", suggestion: "" },
  };
  const snapshot = { rfq_name: "RFQ-1", analysed_at: "2026-09-17T10:00:00.000Z", recommended_supplier: "Beta", confidence_score: 81.5, analysis };
  return { result, snapshot };
}

beforeEach(() => vi.clearAllMocks());

describe("supplier scoring persistence", () => {
  it("reads back the saved document and preserves each quotation's entire evaluation", async () => {
    const { result, snapshot } = fixture();
    let persisted: SupplierScoringResult;
    erp.post.mockImplementation(async (_url, payload) => {
      persisted = { ...payload, name: "SSR-1", supplier_scores: [...payload.supplier_scores].reverse() };
      return { name: "SSR-1" };
    });
    erp.get.mockImplementation(async () => persisted);
    const saved = await saveScoringResult("RFQ-1", result, snapshot);
    expect(erp.get).toHaveBeenCalledWith("Supplier Scoring Result/SSR-1", {});
    expect(saved!.recommended_supplier).toBe("S-B");
    expect(JSON.parse(saved!.analysis_snapshot!)).toMatchObject({
      ...snapshot,
      analysis: {
        ...snapshot.analysis,
        recommendation_summary: expect.stringContaining("Beta: score 81.5/100; risk Low"),
        final_verdict: expect.stringContaining("Beta: score 81.5/100; risk Low"),
      },
    });
    expect(JSON.parse(saved!.analysis_snapshot!).analysis.supplier_analysis[0]).toMatchObject({
      quotation_id: "Q-A", supplier_id: "S-A", evaluation_run_id: "RUN-1", risk: "High",
      score: { overall: 0, quality: 0 }, score_sources: [{ dimension: "Quality", value: 0, source: "S-A", has_data: true }],
      recommendation_status: "REQUIRES_REVIEW", is_top_ranked: false,
    });
    expect(JSON.parse(saved!.analysis_snapshot!).analysis.supplier_analysis[1]).toMatchObject({
      recommendation_status: "TOP_RANKED", is_top_ranked: true, risk: "Low",
    });
    expect(snapshot.analysis.supplier_analysis[0].recommendation_status).toBeUndefined();
  });

  it("rejects a snapshot readback that changed any supplier score or identity", async () => {
    const { result, snapshot } = fixture();
    const corrupted = structuredClone(snapshot);
    corrupted.analysis.supplier_analysis[0].score.overall = 75;
    erp.post.mockResolvedValue({ name: "SSR-1" });
    erp.get.mockResolvedValue({ rfq: "RFQ-1", recommended_supplier: "S-B", analysis_snapshot: JSON.stringify(corrupted) });
    await expect(saveScoringResult("RFQ-1", result, snapshot)).rejects.toThrow("snapshot differs");
  });

  it("rejects child score corruption even when the full snapshot is retained", async () => {
    const { result, snapshot } = fixture();
    let persisted: SupplierScoringResult;
    erp.post.mockImplementation(async (_url, payload) => {
      persisted = structuredClone({ ...payload, name: "SSR-1" });
      persisted.supplier_scores[0].final_score = 75;
      return { name: "SSR-1" };
    });
    erp.get.mockImplementation(async () => persisted);
    await expect(saveScoringResult("RFQ-1", result, snapshot)).rejects.toThrow("supplier scores differ");
  });

  it("refuses RFQ mismatch and duplicate supplier identities before writing", async () => {
    const { result, snapshot } = fixture();
    await expect(saveScoringResult("RFQ-other", result, snapshot)).rejects.toThrow("different RFQ");
    result.suppliers.push(result.suppliers[0]);
    await expect(saveScoringResult("RFQ-1", result, snapshot)).rejects.toThrow("duplicate supplier");
    expect(erp.post).not.toHaveBeenCalled();
  });
});

describe("saved analysis reads", () => {
  function mockRead(snapshot: unknown) {
    erp.get.mockResolvedValueOnce([{ name: "SSR-1" }]).mockResolvedValueOnce({
      name: "SSR-1", rfq: "RFQ-1", analysis_snapshot: JSON.stringify(snapshot),
    });
  }

  it("keeps stable IDs, zero scores, metadata and the saved winner with its summary", async () => {
    const { snapshot } = fixture();
    mockRead(snapshot);
    const saved = await getLatestAnalysisSnapshot<typeof snapshot>("RFQ-1");
    expect(saved?.recommended_supplier).toBe("Beta");
    expect(saved?.analysis.preserved_evaluation_summary).toBe(snapshot.analysis.recommendation_summary);
    expect(saved?.analysis.provider_summary).toBeUndefined();
    expect(saved?.analysis.recommendation_summary).toContain("Beta: score 81.5/100; risk Low");
    expect(saved?.analysis.supplier_analysis.find((row) => row.quotation_id === "Q-A"))
      .toMatchObject(snapshot.analysis.supplier_analysis[0]);
    expect(saved?.analysis.supplier_analysis).toHaveLength(2);
  });

  it("does not deduplicate two different quotation IDs merely because their names match", async () => {
    const { snapshot } = fixture();
    snapshot.analysis.supplier_analysis[0].name = "Beta";
    snapshot.analysis.recommended_supplier = "S-B";
    mockRead(snapshot);
    const saved = await getLatestAnalysisSnapshot<typeof snapshot>("RFQ-1");
    expect(saved?.analysis.supplier_analysis.map((row) => row.quotation_id)).toEqual(["Q-B", "Q-A"]);
  });

  it("rejects a foreign RFQ instead of relabeling its snapshot", async () => {
    const { snapshot } = fixture();
    snapshot.analysis.rfq_id = "RFQ-other";
    mockRead(snapshot);
    expect(await getLatestAnalysisSnapshot("RFQ-1")).toBeNull();
  });

  it("drops older-run duplicates without choosing their higher score", async () => {
    const { snapshot } = fixture();
    const old = structuredClone(snapshot.analysis.supplier_analysis[0]);
    old.evaluation_run_id = "RUN-old";
    old.score.overall = 99;
    snapshot.analysis.supplier_analysis.push(old);
    mockRead(snapshot);
    const saved = await getLatestAnalysisSnapshot<typeof snapshot>("RFQ-1");
    expect(saved?.analysis.supplier_analysis).toHaveLength(2);
    expect(saved?.analysis.supplier_analysis.find((row) => row.quotation_id === "Q-A")?.score.overall).toBe(0);
    expect(saved?.analysis.recommended_supplier).toBe("Beta");
  });
});
