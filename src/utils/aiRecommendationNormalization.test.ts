import { describe, expect, it } from "vitest";
import {
  normalizeAndDeduplicateRecommendation,
  normalizeSupplierKey,
  type AuthoritativeQuoteInfo,
} from "./aiRecommendationNormalization";
import type { AIRecommendation, SupplierAnalysisRow } from "../types/erpnext";

function evaluationRow(id: string, supplierId: string, score: number, name = supplierId): SupplierAnalysisRow {
  return {
    quotation_id: id, supplier_id: supplierId, name, rfq_id: "RFQ-1", evaluation_run_id: "RUN-current",
    rank: 1, verdict: "GOOD OPTION", risk: "Low", grand_total: 15,
    strengths: [`${id} strength`], weaknesses: [], why_best_or_worst: `${id} reason`,
    score: { overall: score, cost: score, delivery: score, reliability: score },
  };
}

function evaluation(rows: SupplierAnalysisRow[]): AIRecommendation {
  return {
    rfq_id: "RFQ-1", evaluation_run_id: "RUN-current",
    recommended_supplier: rows[0]?.supplier_id ?? "", confidence_score: 0,
    recommendation_summary: "Current evaluation summary", final_verdict: "Current evaluation verdict",
    supplier_analysis: rows, cost_analysis: { savings_vs_expensive: "", savings_percentage: 0, price_range: "" },
    per_item_analysis: [], risk_flags: [], negotiation_tips: [],
    split_order_option: { recommended: false, reason: "", suggestion: "" },
  };
}

const quotes: AuthoritativeQuoteInfo[] = [
  { quotation_id: "Q-A", supplier_id: "S-A", supplier_name: "Alpha", total: 15, rfq_id: "RFQ-1" },
  { quotation_id: "Q-B", supplier_id: "S-B", supplier_name: "Beta", total: 20, rfq_id: "RFQ-1" },
];

describe("aiRecommendationNormalization", () => {
  it("normalizes supplier keys with quotes, punctuation and case differences", () => {
    expect(normalizeSupplierKey('"Atlantic Precision Manufacturing."')).toBe(
      "atlantic precision manufacturing"
    );
    expect(normalizeSupplierKey("Atlantic Precision Manufacturing.")).toBe(
      "atlantic precision manufacturing"
    );
    expect(normalizeSupplierKey('"Eagle Peak Technologies Inc."')).toBe(
      "eagle peak technologies inc"
    );
    expect(normalizeSupplierKey("Eagle Peak Technologies Inc.")).toBe(
      "eagle peak technologies inc"
    );
    expect(normalizeSupplierKey("Apex Fasteners Ltd")).toBe(
      "apex fasteners ltd"
    );
  });

  it("resolves the exact PUR-RFQ-2026-00089 5-row anomaly to exactly 3 unique rows", () => {
    const rfqId = "PUR-RFQ-2026-00089";

    // The 3 authoritative submitted quotations in ERPNext
    const authoritativeQuotes: AuthoritativeQuoteInfo[] = [
      {
        quotation_id: "PUR-SQTN-2026-00249",
        supplier_id: '"Atlantic Precision Manufacturing."',
        supplier_name: "Atlantic Precision Manufacturing.",
        total: 2500,
        priceStatus: "submitted",
      },
      {
        quotation_id: "PUR-SQTN-2026-00251",
        supplier_id: "Apex Fasteners Ltd",
        supplier_name: "Apex Fasteners Ltd",
        total: 2500,
        priceStatus: "submitted",
      },
      {
        quotation_id: "PUR-SQTN-2026-00252",
        supplier_id: '"Eagle Peak Technologies Inc."',
        supplier_name: "Eagle Peak Technologies Inc.",
        total: 2500,
        priceStatus: "submitted",
      },
    ];

    // The raw 5-row snapshot currently in ERPNext SSR record
    const stale5RowRecommendation: AIRecommendation = {
      recommended_supplier: "Apex Fasteners Ltd",
      confidence_score: 93,
      recommendation_summary: "Apex Fasteners provides the best value.",
      supplier_analysis: [
        {
          name: "Apex Fasteners Ltd",
          rank: 1,
          verdict: "EXPENSIVE",
          grand_total: 0, // Stale from draft quote
          quote_price_status: "submitted",
          strengths: ["Strong delivery performance"],
          weaknesses: [],
          score: { cost: 100, delivery: 100, reliability: 50, overall: 93 },
          why_best_or_worst: "Apex why",
        },
        {
          name: "Eagle Peak Technologies Inc.",
          rank: 2,
          verdict: "GOOD OPTION",
          grand_total: 2500,
          quote_price_status: "submitted",
          strengths: ["Strong track record"],
          weaknesses: [],
          score: { cost: 70, delivery: 80, reliability: 50, overall: 60 },
          why_best_or_worst: "Eagle Peak why 60",
        },
        {
          name: "Atlantic Precision Manufacturing.",
          rank: 3,
          verdict: "EXPENSIVE",
          grand_total: 0, // Stale from draft quote
          quote_price_status: "submitted",
          strengths: ["Good quality"],
          weaknesses: [],
          score: { cost: 100, delivery: 100, reliability: 50, overall: 93 },
          why_best_or_worst: "Atlantic why",
        },
        {
          name: "Eagle Peak Technologies Inc.",
          rank: 4,
          verdict: "BEST VALUE",
          grand_total: 2500,
          quote_price_status: "submitted",
          strengths: ["Lower price"],
          weaknesses: [],
          score: { cost: 50, delivery: 80, reliability: 50, overall: 53 },
          why_best_or_worst: "Eagle Peak why 53",
        },
        {
          name: "Atlantic Precision Manufacturing.",
          rank: 5,
          verdict: "AVOID",
          grand_total: 0,
          quote_price_status: "submitted",
          strengths: [],
          weaknesses: ["Missing pricing"],
          score: { cost: -1, delivery: 100, reliability: 0, overall: -1 },
          why_best_or_worst: "Duplicate submission",
        },
      ],
      cost_analysis: {
        savings_vs_expensive: "$0",
        savings_percentage: 0,
        price_range: "$2,500",
      },
      per_item_analysis: [],
      risk_flags: [],
      negotiation_tips: [],
      split_order_option: { recommended: false, reason: "", suggestion: "" },
      final_verdict: "Best option evaluated.",
    };

    const normalized = normalizeAndDeduplicateRecommendation({
      recommendation: stale5RowRecommendation,
      authoritativeQuotes,
      rfqId,
    });

    // Invariants check
    expect(normalized.supplier_analysis.length).toBe(3);
    expect(normalized.rfq_id).toBe(rfqId);
    expect(normalized.evaluation_run_id).toBeUndefined();

    // Check unique suppliers
    const names = normalized.supplier_analysis.map((r) => r.name);
    expect(new Set(names).size).toBe(3);
    expect(names).toContain("Apex Fasteners Ltd");
    expect(names).toContain("Atlantic Precision Manufacturing.");
    expect(names).toContain("Eagle Peak Technologies Inc.");

    // Check authoritative pricing replaced the $0.00
    for (const row of normalized.supplier_analysis) {
      expect(row.grand_total).toBe(2500);
      expect(row.quote_price_status).toBe("submitted");
      expect(row.quotation_id).toBeDefined();
      expect(row.quotation_id).toMatch(/^PUR-SQTN-2026-/);
    }

    // Eagle Peak should keep its authoritative score 60 and not mix with 53
    const eagle = normalized.supplier_analysis.find(
      (r) => r.name === "Eagle Peak Technologies Inc."
    );
    expect(eagle?.score.overall).toBe(60);
    expect(eagle?.verdict).toBe("GOOD OPTION");
    expect(eagle?.why_best_or_worst).toBe("Eagle Peak why 60");

    // Atlantic should keep its authoritative score 93 and not the duplicate -1 (AVOID)
    const atlantic = normalized.supplier_analysis.find(
      (r) => r.name === "Atlantic Precision Manufacturing."
    );
    expect(atlantic?.score.overall).toBe(93);
    expect(atlantic?.verdict).toBe("EXPENSIVE");

    // Ranks should be sequential 1, 2, 3
    expect(normalized.supplier_analysis.map((r) => r.rank)).toEqual([1, 2, 3]);

    // Rank 1 and 2 should have score 93, Rank 3 should have score 60
    expect(normalized.supplier_analysis[0].score.overall).toBe(93);
    expect(normalized.supplier_analysis[1].score.overall).toBe(93);
    expect(normalized.supplier_analysis[2].score.overall).toBe(60);
  });

  it("does not mix scores or verdicts across duplicates", () => {
    const authoritativeQuotes: AuthoritativeQuoteInfo[] = [
      {
        quotation_id: "PUR-SQTN-1",
        supplier_id: "Supplier A",
        supplier_name: "Supplier A",
        total: 1000,
        priceStatus: "submitted",
      },
    ];

    const recommendation: AIRecommendation = {
      recommended_supplier: "Supplier A",
      confidence_score: 80,
      recommendation_summary: "Summary",
      supplier_analysis: [
        {
          name: "Supplier A",
          rank: 2,
          verdict: "GOOD OPTION",
          grand_total: 1000,
          strengths: ["Strength from run 1"],
          weaknesses: ["Weakness from run 1"],
          score: { cost: 80, delivery: 80, reliability: 80, overall: 80 },
          why_best_or_worst: "Run 1 reason",
        },
        {
          name: "Supplier A",
          rank: 1,
          verdict: "BEST VALUE",
          grand_total: 1000,
          strengths: ["Strength from run 2"],
          weaknesses: [],
          score: { cost: 95, delivery: 90, reliability: 90, overall: 92 },
          why_best_or_worst: "Run 2 reason",
        },
      ],
      cost_analysis: { savings_vs_expensive: "", savings_percentage: 0, price_range: "" },
      per_item_analysis: [],
      risk_flags: [],
      negotiation_tips: [],
      split_order_option: { recommended: false, reason: "", suggestion: "" },
      final_verdict: "Verdict",
    };

    const result = normalizeAndDeduplicateRecommendation({
      recommendation,
      authoritativeQuotes,
      rfqId: "RFQ-123",
    });

    expect(result.supplier_analysis.length).toBe(1);
    const row = result.supplier_analysis[0];
    // Higher score chosen: overall 92
    expect(row.score.overall).toBe(92);
    expect(row.verdict).toBe("BEST VALUE");
    expect(row.why_best_or_worst).toBe("Run 2 reason");
    expect(row.strengths).toEqual(["Strength from run 2"]);
  });

  it("keeps shuffled supplier-specific scores and metadata attached to stable identities", () => {
    const a = evaluationRow("Q-A", "S-A", 0, "incorrect display name");
    const b = evaluationRow("Q-B", "S-B", 82, "another incorrect display name");
    Object.assign(a, { score_sources: [{ dimension: "Quality", value: 0, source: "A only", has_data: true }] });
    const result = normalizeAndDeduplicateRecommendation({
      recommendation: evaluation([a, b]), authoritativeQuotes: [quotes[1], quotes[0]], rfqId: "RFQ-1",
    });
    expect(result.supplier_analysis.map((row) => [row.quotation_id, row.supplier_id, row.score.overall]))
      .toEqual([["Q-B", "S-B", 82], ["Q-A", "S-A", 0]]);
    expect(result.supplier_analysis[1]).toMatchObject({
      name: "Alpha", score: { overall: 0 }, risk: "Low", verdict: "GOOD OPTION",
      score_sources: [{ dimension: "Quality", value: 0, source: "A only", has_data: true }],
    });
    expect(result.recommended_supplier).toBe("Alpha");
    expect(result.preserved_evaluation_summary).toBe("Current evaluation summary");
    expect(result.provider_summary).toBeUndefined();
    expect(result.recommendation_summary).toContain("Alpha: score 0/100; risk Low; verdict GOOD OPTION; quote total 15");
    expect(result.confidence_score).toBe(0);
    expect(a.name).toBe("incorrect display name");
  });

  it.each([
    { quotation_id: "Q-old", supplier_id: "S-A" },
    { quotation_id: "Q-A", supplier_id: "S-B" },
    { quotation_id: "Q-A", supplier_quotation_id: "Q-B", supplier_id: "S-A" },
    { quotation_id: undefined, supplier_id: "S-unknown" },
  ])("rejects conflicting explicit identity instead of matching the display name: %j", (ids) => {
    const row = { ...evaluationRow("Q-A", "S-A", 75, "Alpha"), ...ids };
    const result = normalizeAndDeduplicateRecommendation({
      recommendation: evaluation([row]), authoritativeQuotes: quotes, rfqId: "RFQ-1",
    });
    expect(result.supplier_analysis).toEqual([]);
    expect(result.recommended_supplier).toBe("");
  });

  it("selects current-run rows even when an old run has a higher score", () => {
    const current = evaluationRow("Q-A", "S-A", 0, "Alpha");
    const old = { ...evaluationRow("Q-A", "S-A", 99, "Alpha"), evaluation_run_id: "RUN-old", risk: "High" as const };
    const result = normalizeAndDeduplicateRecommendation({
      recommendation: evaluation([old, current]), authoritativeQuotes: quotes, rfqId: "RFQ-1", evaluationRunId: "RUN-current",
    });
    expect(result.supplier_analysis).toHaveLength(1);
    expect(result.supplier_analysis[0]).toMatchObject({ evaluation_run_id: "RUN-current", score: { overall: 0 }, risk: "Low" });
  });

  it.each([{ rfq_id: "RFQ-old" }, { evaluation_run_id: "RUN-old" }])("never relabels a stale envelope: %j", (metadata) => {
    const source = { ...evaluation([evaluationRow("Q-A", "S-A", 75)]), ...metadata };
    const result = normalizeAndDeduplicateRecommendation({
      recommendation: source, authoritativeQuotes: quotes, rfqId: "RFQ-1", evaluationRunId: "RUN-current",
    });
    expect(result.supplier_analysis).toEqual([]);
    expect(result).toMatchObject(metadata);
    expect(result.final_verdict).toContain("unavailable or incomplete");
  });

  it("marks an unidentifiable mixture of evaluation runs unavailable", () => {
    const source = evaluation([
      evaluationRow("Q-A", "S-A", 75),
      { ...evaluationRow("Q-B", "S-B", 80), evaluation_run_id: "RUN-other" },
    ]);
    delete source.evaluation_run_id;
    expect(normalizeAndDeduplicateRecommendation(source).supplier_analysis).toEqual([]);
  });

  it("does not stamp a requested run onto an untagged historical envelope", () => {
    const source = evaluation([evaluationRow("Q-A", "S-A", 75, "Alpha")]);
    delete source.evaluation_run_id;
    delete source.supplier_analysis[0].evaluation_run_id;
    const historical = normalizeAndDeduplicateRecommendation({ recommendation: source, authoritativeQuotes: quotes, rfqId: "RFQ-1" });
    expect(historical.supplier_analysis).toHaveLength(1);
    expect(historical.evaluation_run_id).toBeUndefined();
    const requested = normalizeAndDeduplicateRecommendation({ recommendation: source, authoritativeQuotes: quotes, rfqId: "RFQ-1", evaluationRunId: "RUN-current" });
    expect(requested.supplier_analysis).toEqual([]);
    expect(requested.evaluation_run_id).toBeUndefined();
  });

  it("uses a matching explicit envelope as the provenance for an untagged row", () => {
    const source = evaluation([evaluationRow("Q-A", "S-A", 75, "Alpha")]);
    delete source.supplier_analysis[0].evaluation_run_id;
    const normalized = normalizeAndDeduplicateRecommendation({ recommendation: source, authoritativeQuotes: quotes, rfqId: "RFQ-1", evaluationRunId: "RUN-current" });
    expect(normalized.supplier_analysis[0].evaluation_run_id).toBe("RUN-current");
  });

  it("never transfers a row's run ID to a different untagged evaluation", () => {
    const source = evaluation([evaluationRow("Q-A", "S-A", 75, "Alpha"), evaluationRow("Q-B", "S-B", 80, "Beta")]);
    delete source.evaluation_run_id;
    delete source.supplier_analysis[1].evaluation_run_id;
    const normalized = normalizeAndDeduplicateRecommendation({ recommendation: source, authoritativeQuotes: quotes, rfqId: "RFQ-1" });
    expect(normalized.supplier_analysis.map((row) => row.quotation_id)).toEqual(["Q-A"]);
    expect(normalized.evaluation_run_id).toBeUndefined();
    expect(normalized.supplier_analysis[0].evaluation_run_id).toBe("RUN-current");
  });

  it("uses legacy names only when they identify exactly one quotation", () => {
    const row = evaluationRow("Q-A", "S-A", 75, "Alpha");
    delete row.quotation_id;
    delete row.supplier_id;
    const source = evaluation([row]);
    source.recommended_supplier = "Alpha";
    const options = { recommendation: source, authoritativeQuotes: quotes, rfqId: "RFQ-1" };
    expect(normalizeAndDeduplicateRecommendation(options).supplier_analysis[0].quotation_id).toBe("Q-A");
    expect(normalizeAndDeduplicateRecommendation({ ...options, authoritativeQuotes: [
      ...quotes, { quotation_id: "Q-A-other", supplier_id: "S-A-other", supplier_name: "Alpha", total: 30 },
    ] }).supplier_analysis).toEqual([]);
  });

  it("keeps missing scores unavailable without turning zero into missing", () => {
    const missing = evaluationRow("Q-B", "S-B", 75, "Beta");
    delete (missing.score as Partial<SupplierAnalysisRow["score"]>).overall;
    const source = evaluation([evaluationRow("Q-A", "S-A", 0, "Alpha"), missing]);
    const result = normalizeAndDeduplicateRecommendation({ recommendation: source, authoritativeQuotes: quotes, rfqId: "RFQ-1" });
    expect(result.supplier_analysis[0].score.overall).toBe(0);
    expect(result.supplier_analysis[1]).toMatchObject({ score: { overall: -1 }, verdict: "NOT EVALUATED", evaluation_status: "incomplete" });
  });

  it("does not assign a surviving supplier the removed winner's narrative", () => {
    const a = { ...evaluationRow("Q-A", "S-A", 99, "Alpha"), evaluation_run_id: "RUN-old" };
    const source = evaluation([a, evaluationRow("Q-B", "S-B", 75, "Beta")]);
    const result = normalizeAndDeduplicateRecommendation({ recommendation: source, authoritativeQuotes: quotes, rfqId: "RFQ-1" });
    expect(result.recommended_supplier).toBe("");
    expect(result.recommendation_summary).not.toBe(source.recommendation_summary);
  });

  it("keeps the RFQ94 scores and warnings in one evaluation while clarifying its top rank", () => {
    const atlantic = evaluationRow("PUR-SQTN-2026-00265", '\"Atlantic Precision Manufacturing.\"', 91, "Atlantic Precision Manufacturing.");
    Object.assign(atlantic, {
      risk: "High", verdict: "AVOID", grand_total: 2500,
      score: { cost: 100, delivery: 100, quality: 59, reliability: 95, overall: 91 },
      why_best_or_worst: "142 of 242 ordered units received; 100 units remain unreceived.",
    });
    const femsa = { ...evaluationRow("PUR-SQTN-2026-00267", "FEMSA", 87, "FEMSA"), rank: 2, grand_total: 2600 };
    const blue = { ...evaluationRow("PUR-SQTN-2026-00269", '\"Blue Ridge Manufacturing Inc\"', 85, "Blue Ridge Manufacturing Inc"), rank: 3, grand_total: 2500, risk: "Medium" as const };
    const source = evaluation([atlantic, femsa, blue]);
    source.recommended_quotation_id = atlantic.quotation_id;
    source.recommended_supplier_id = atlantic.supplier_id;
    const normalized = normalizeAndDeduplicateRecommendation(source);
    expect(normalized.supplier_analysis.map((row) => row.score.overall)).toEqual([91, 87, 85]);
    expect(normalized.supplier_analysis[0]).toMatchObject({
      quotation_id: atlantic.quotation_id, supplier_id: atlantic.supplier_id,
      risk: "High", verdict: "AVOID", is_top_ranked: true, recommendation_status: "REQUIRES_REVIEW",
      why_best_or_worst: atlantic.why_best_or_worst,
    });
    expect(normalized.supplier_analysis[1]).toMatchObject({ risk: "Low", verdict: "GOOD OPTION", is_top_ranked: false });
    expect(normalized.supplier_analysis[2]).toMatchObject({ risk: "Medium", verdict: "GOOD OPTION", is_top_ranked: false });
    expect(normalized.recommendation_summary).toContain("Atlantic Precision Manufacturing.: score 91/100; risk High; verdict AVOID; quote total 2,500");
    expect(normalized.recommendation_summary).toContain("High risk and AVOID verdict requires review");
    expect(normalized.recommendation_summary).toContain("FEMSA: score 87/100; risk Low; verdict GOOD OPTION; quote total 2,600");
    expect(normalized.final_verdict).toBe(normalized.recommendation_summary);
    expect(normalizeAndDeduplicateRecommendation(normalized)).toEqual(normalized);
    expect(source.supplier_analysis[0].recommendation_status).toBeUndefined();
  });

  it("preserves the gateway's complete-price leader ahead of a higher incomplete-price score", () => {
    const complete = evaluationRow("Q-A", "S-A", 70, "Alpha");
    const incomplete = evaluationRow("Q-B", "S-B", 90, "Beta");
    incomplete.rank = 2;
    incomplete.score.cost = -1;
    incomplete.grand_total = null;
    incomplete.verdict = "QUOTE INCOMPLETE";
    incomplete.evaluation_status = "incomplete";
    const normalized = normalizeAndDeduplicateRecommendation(evaluation([complete, incomplete]));
    expect(normalized.supplier_analysis.map((row) => [row.quotation_id, row.rank, row.score.overall, row.is_top_ranked]))
      .toEqual([["Q-A", 1, 70, true], ["Q-B", 2, 90, false]]);
    expect(normalized.supplier_analysis[1].recommendation_status).toBe("NOT_EVALUATED");
  });
});
