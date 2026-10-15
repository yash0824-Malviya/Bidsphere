import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AIRecommendation, SupplierAnalysisRow } from "../types/erpnext";
import SupplierSelectionSummary, { resolveSelectedEvaluation } from "./SupplierSelectionSummary";

function row(id: string, rank: number, score: number, risk?: SupplierAnalysisRow["risk"]): SupplierAnalysisRow {
  return { name: id === "A" ? "Atlantic" : "FEMSA", quotation_id: `Q-${id}`, supplier_id: `S-${id}`, rank,
    grand_total: id === "A" ? 2500 : 2600, risk, verdict: id === "A" ? "AVOID" : "GOOD OPTION",
    score: { cost: 100, delivery: 100, quality: 59, reliability: 95, overall: score },
    strengths: [], weaknesses: [], why_best_or_worst: `${id}-specific evaluation evidence.` };
}
function analysis(rows = [row("A", 1, 91, "High"), row("F", 2, 87, "Low")]): AIRecommendation {
  return { supplier_analysis: rows, recommended_supplier: "Atlantic", recommended_quotation_id: "Q-A",
    recommended_supplier_id: "S-A", confidence_score: 91, recommendation_summary: "Atlantic recommended for award.",
    final_verdict: "Atlantic recommended for award.", risk_flags: [] } as unknown as AIRecommendation;
}
function render(selectedSupplier: string, result: AIRecommendation | null = analysis()) {
  return renderToStaticMarkup(<SupplierSelectionSummary open rfqName="RFQ-1" selectedSupplier={selectedSupplier}
    selectedAt="2026-09-23" selectedTotal={2600} quoteAmount={2500} analysis={result} onClose={() => {}} />);
}

describe("selected supplier evaluation summary", () => {
  it("uses FEMSA's own score, risk, price and reasoning instead of the overall score leader", () => {
    const html = render("S-F");
    expect(html).toContain("Weighted Score");
    expect(html).toContain("87/100");
    expect(html).toContain("FEMSA: score 87/100; risk Low; verdict GOOD OPTION; quote total 2,600");
    expect(html).toContain("F-specific evaluation evidence");
    expect(html).not.toContain("A-specific evaluation evidence");
    expect(html).not.toContain("recommended for award");
    expect(html).not.toContain("Confidence Score");
  });

  it("keeps the high-score High / AVOID supplier's review warning without invented compliance claims", () => {
    const html = render("S-A");
    expect(html).toContain("Atlantic: score 91/100; risk High; verdict AVOID");
    expect(html).toContain("Requires review");
    expect(html).toContain("Highest numerical score: 91/100.");
    expect(html.toLowerCase()).not.toContain("ai top-ranked");
    expect(html).not.toContain("Lowest procurement risk");
    expect(html).not.toContain("Meets all technical");
    expect(html).not.toContain("Best delivery commitment");
    expect(html).not.toContain("recommended for award");
  });

  it("shows unavailable risk and missing evaluation without a score-derived assessment or award narrative", () => {
    const html = render("S-F", analysis([row("F", 1, 99)]));
    expect(html).toContain("Risk assessment: Unavailable");
    expect(html).toContain("Risk assessment unavailable requires review");
    const missing = render("S-MISSING", null);
    expect(missing).toContain("no unambiguous evaluation");
    expect(missing).not.toContain("recommended for award");
  });

  it("requires unique legacy names and prefers exact supplier IDs even when display names collide", () => {
    const rows = [row("A", 1, 91, "High"), { ...row("F", 2, 87, "Low"), name: "Atlantic" }];
    expect(resolveSelectedEvaluation(rows, "Atlantic")).toBeUndefined();
    expect(resolveSelectedEvaluation(rows, "S-F")).toBe(rows[1]);
    expect(resolveSelectedEvaluation(rows, "Q-F")).toBe(rows[1]);
    expect(resolveSelectedEvaluation([rows[0]], " ATLANTIC. ")).toBe(rows[0]);
  });

  it("uses matching selection-audit quotation and supplier IDs and rejects conflicting pairs", () => {
    const rows = [row("A", 1, 91, "High"), row("F", 2, 87, "Low")];
    expect(resolveSelectedEvaluation(rows, "S-F", { selected_supplier: "S-F", supplier_quotation: "Q-F" })).toBe(rows[1]);
    expect(resolveSelectedEvaluation(rows, "S-F", { selected_supplier: "S-F", supplier_quotation: "Q-A" })).toBeUndefined();
    expect(resolveSelectedEvaluation(rows, "S-F", { selected_supplier: "S-A", supplier_quotation: "Q-A" })).toBe(rows[1]);
  });
});
