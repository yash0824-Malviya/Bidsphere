import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AIRecommendation, SupplierAnalysisRow } from "../types/erpnext";
import { RecommendationResultsScreen, SupplierDetailPanel, SupplierLeaderboard, SupplierRankCard, sortRankedSuppliers } from "./AIAnalysisModal";
import AISupplierAnalysisPanel from "./AISupplierAnalysisPanel";
import { findRecommendationWinner } from "../utils/aiRecommendationNormalization";

function row(id: string, rank: number, overall: number, quality?: number): SupplierAnalysisRow {
  return {
    quotation_id: `Q-${id}`, supplier_id: `S-${id}`, name: `Supplier ${id}`, rank,
    evaluation_run_id: "RUN-current", grand_total: 15,
    verdict: rank === 1 ? "BEST VALUE" : "GOOD OPTION", risk: id === "A" ? "High" : "Low",
    score: { cost: 100, delivery: 72, reliability: 80, overall, ...(quality === undefined ? {} : { quality }) },
    strengths: [`${id} strength`], weaknesses: [], why_best_or_worst: `${id} explanation`,
  };
}

function result(rows: SupplierAnalysisRow[]): AIRecommendation {
  return {
    recommended_supplier: rows[0].name, recommended_quotation_id: rows[0].quotation_id,
    recommended_supplier_id: rows[0].supplier_id, evaluation_run_id: "RUN-current",
    confidence_score: 88, recommendation_summary: "Current run summary", final_verdict: "Current run verdict",
    supplier_analysis: rows,
    evaluation_weights: { price_weight: 45, delivery_weight: 20, quality_weight: 25, reliability_weight: 10 },
    cost_analysis: { savings_vs_expensive: "", savings_percentage: 0, price_range: "" },
    per_item_analysis: [], risk_flags: [], negotiation_tips: [], split_order_option: { recommended: false, reason: "", suggestion: "" },
  };
}

function renderResults(analysis: AIRecommendation) {
  return renderToStaticMarkup(<RecommendationResultsScreen result={analysis}
    ranked={sortRankedSuppliers(analysis.supplier_analysis)} recommendedRow={findRecommendationWinner(analysis)!}
    quoteAmount={15} onSelectSupplier={() => {}} onViewComparison={() => {}} />);
}

describe("AI evaluation display integrity", () => {
  it("keeps the numerical leader visible but disables AVOID selection and counts only eligible quotations", () => {
    const atlantic = { ...row("A", 1, 91, 59), rfq_id: "RFQ-94", name: "Atlantic", verdict: "AVOID" as const, risk: "High" as const };
    const femsa = { ...row("F", 2, 87, 100), rfq_id: "RFQ-94", name: "FEMSA", risk: "Low" as const };
    const blue = { ...row("B", 3, 85, 100), rfq_id: "RFQ-94", name: "Blue Ridge", risk: "Medium" as const };
    const html = renderToStaticMarkup(<SupplierLeaderboard suppliers={[atlantic, femsa, blue]}
      recommendedName="Q-A" onSelect={() => {}} selectable
      selected={new Set(["Q-A", "Q-F", "Q-B", "Q-stale"])} onToggle={() => {}} maxSelectableSuppliers={2} />);
    const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((match) => match[1]);
    const leader = rows.find((line) => line.includes("Select Atlantic"))!;
    const second = rows.find((line) => line.includes("Select FEMSA"))!;
    const third = rows.find((line) => line.includes("Select Blue Ridge"))!;
    expect(leader).toContain('disabled=""');
    expect(leader).not.toContain('checked=""');
    expect(leader).not.toContain("Not eligible for selection");
    expect(leader).not.toContain("Supplier is currently marked AVOID due to high risk and cannot be selected for award.");
    expect(leader).toContain("91/100");
    expect(leader).toContain("High Risk");
    expect(leader).toContain("AVOID");
    expect(leader).toMatch(/<button(?![^>]*disabled)[^>]*>Details →<\/button>/);
    expect(second).not.toContain('disabled=""');
    expect(second).toContain('checked=""');
    expect(third).not.toContain('disabled=""');
    expect(third).toContain('checked=""');
    expect(html).toContain("2 of 2 selected");
    expect(html).toContain("Highest numerical score does not automatically mean award eligibility.");
    expect([atlantic.score.overall, femsa.score.overall, blue.score.overall]).toEqual([91, 87, 85]);
  });

  it("blocks AVOID selection from Details and the compact purchase-order action", () => {
    const atlantic = { ...row("A", 1, 91, 59), name: "Atlantic", verdict: "AVOID" as const };
    const analysis = result([atlantic, row("F", 2, 87, 100)]);
    const detail = renderToStaticMarkup(<SupplierDetailPanel supplier={atlantic} rank1={atlantic} result={analysis}
      quoteAmount={2500} creatingPO={false} canSelect chosenSupplier={null}
      onBack={() => {}} onSelectSupplier={() => {}} onCreatePO={() => {}} />);
    expect(detail).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Select Supplier<\/button>/);
    expect(detail).not.toContain("cannot be selected for award");
    expect(detail).not.toContain("Not eligible for");
    const card = renderToStaticMarkup(<SupplierRankCard supplier={atlantic} rankIndex={0} isRecommended
      onSelect={() => {}} onChooseSupplier={() => {}} />);
    expect(card).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Select Supplier<\/button>/);
    expect(card).toContain("View Details");
    expect(card).toContain("91/100");
    const compact = renderToStaticMarkup(<AISupplierAnalysisPanel loading={false} loadingStep={0}
      result={analysis} error={null} tokensUsed={0} quotationCount={2} hasApiKey
      onRun={() => {}} onRefresh={() => {}} onCreatePO={() => {}} />);
    expect(compact).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Create PO — Atlantic<\/button>/);
    expect(compact).toContain("91");
  });

  it("uses exact eligible supplier count and keeps the review notice for an eligible High-risk row", () => {
    const leader = { ...row("A", 1, 91, 59), verdict: "GOOD OPTION" as const };
    const analysis = result([leader, row("F", 2, 87, 100)]);
    const html = renderToStaticMarkup(<RecommendationResultsScreen result={analysis}
      ranked={analysis.supplier_analysis} recommendedRow={leader} quoteAmount={15}
      onSelectSupplier={() => {}} onViewComparison={() => {}} bidSelectable maxSelectableSuppliers={2} />);
    expect(html).toContain("Select 2 suppliers to run a reverse auction.");
    expect(html).toContain("Select 2 suppliers to start reverse bidding.");
    expect(html).not.toContain("Select 2–2 suppliers");
    expect(html).toContain("Review this supplier’s risk and verdict before making a selection.");
    expect(html).not.toContain("Not eligible for selection —");
  });

  it("shows the winner's own quality and saved weights instead of local source proxies", () => {
    const winner = row("B", 1, 82, 67);
    Object.assign(winner, { score_sources: [{ dimension: "Quality", value: 100, source: "Old local engine", has_data: true }] });
    const html = renderResults(result([winner, row("A", 2, 64, 24)]));
    expect(html).toContain("Evaluation Breakdown — Supplier B");
    expect(html).toContain("67%");
    expect(html).toContain("(45%)");
    expect(html).toContain("(25%)");
    expect(html).toContain("82/100");
    expect(html).toContain("64/100");
    expect(html).toContain("B explanation");
    expect(html).not.toContain("Current run verdict");
  });

  it("does not synthesize quality, reliability or an overall score from missing data", () => {
    const winner = row("B", 1, -1);
    winner.score.cost = -1;
    winner.score.delivery = -1;
    winner.score.reliability = -1;
    delete winner.risk;
    const html = renderResults(result([winner]));
    expect(html).toContain("AI evaluation unavailable");
    expect(html).toContain("Risk unavailable");
    expect(html).not.toContain("75%");
    expect(html).not.toContain("0/100");
    expect(html).not.toContain("88/100");
  });

  it("preserves supplied order on equal scores even when quotation IDs sort differently", () => {
    const first = row("Z", 1, 90, 90);
    const second = row("A", 2, 90, 90);
    const rows = sortRankedSuppliers([second, first]);
    expect(rows.map((supplier) => supplier.quotation_id)).toEqual(["Q-Z", "Q-A"]);
    expect(rows.map((supplier) => supplier.rank)).toEqual([1, 2]);
  });

  it("identifies a same-name winner by IDs and shows details from the selected evaluation", () => {
    const a = row("A", 2, 0, 24);
    const b = row("B", 1, 82, 67);
    a.name = b.name = "Shared display name";
    const analysis = result([b, a]);
    expect(findRecommendationWinner(analysis)?.quotation_id).toBe("Q-B");
    const html = renderToStaticMarkup(<SupplierDetailPanel supplier={a} rank1={b} result={analysis}
      quoteAmount={9999} creatingPO={false} canSelect={false} chosenSupplier={null}
      onBack={() => {}} onSelectSupplier={() => {}} onCreatePO={() => {}} />);
    expect(html).toContain("0/100");
    expect(html).toContain("24%");
    expect(html).toContain("A strength");
    expect(html).toContain("High Risk");
    expect(html).not.toContain("67%");
    expect(html).not.toContain("Current run summary");
    expect(html).toContain("Quote total is equal to Rank #1.");
    expect(html).not.toContain("$0.00 below Rank #1");
    expect(html).toContain("No separate weakness assessment provided.");
  });

  it("the compact panel keeps zero scores and labels absent scores unavailable", () => {
    const zero = row("A", 1, 0, 0);
    const missing = row("B", 2, -1);
    const html = renderToStaticMarkup(<AISupplierAnalysisPanel loading={false} loadingStep={0}
      result={result([zero, missing])} error={null} tokensUsed={0} quotationCount={2} hasApiKey
      onRun={() => {}} onRefresh={() => {}} onCreatePO={() => {}} />);
    expect(html).toContain("Overall score: 0%");
    expect(html).toContain("AI evaluation unavailable");
    expect(html).not.toContain("-1%");
  });

  it("keeps a high-risk AVOID score leader top-ranked without endorsing it", () => {
    const atlantic = { ...row("A", 1, 91.05, 59), name: "Atlantic", verdict: "AVOID" as const,
      grand_total: 2500, why_best_or_worst: "An overdue open purchase order remains unreceived." };
    atlantic.score = { cost: 100, delivery: 100, quality: 59, reliability: 95, overall: 91.05 };
    atlantic.strengths = [atlantic.why_best_or_worst];
    const femsa = { ...row("F", 2, 87, 80), name: "FEMSA", grand_total: 2600 };
    const blue = { ...row("B", 3, 85, 80), name: "Blue Ridge", grand_total: 2500, risk: "Medium" as const };
    const analysis = result([atlantic, femsa, blue]);
    analysis.recommendation_summary = "Choose Atlantic without concerns.";
    analysis.final_verdict = "Atlantic is recommended.";
    const html = renderResults(analysis);
    expect(html).toContain("91/100");
    expect(html).toContain("87/100");
    expect(html).toContain("85/100");
    expect(html).toContain("TOP SCORE");
    expect(html.toLowerCase()).not.toContain("ai top-ranked");
    expect(html).toContain("High Risk");
    expect(html).toContain("AVOID");
    expect(html).toContain("Requires review");
    expect(html).not.toContain("Not eligible for");
    expect(html).not.toContain("Supplier is currently marked AVOID due to high risk and cannot be selected for award.");
    expect(html).not.toContain("Review this supplier’s risk and verdict before making a selection.");
    expect(html).not.toContain("RECOMMENDED SUPPLIER");
    expect(html).not.toContain("Choose Atlantic without concerns");
    expect(html).not.toContain("Atlantic is recommended");
    expect(html).toContain("FEMSA: score 87/100; risk Low; verdict GOOD OPTION; quote total 2,600");
    expect(html).toContain("Blue Ridge: score 85/100; risk Medium; verdict GOOD OPTION; quote total 2,500");

    const detail = renderToStaticMarkup(<SupplierDetailPanel supplier={atlantic} rank1={atlantic} result={analysis}
      quoteAmount={2500} creatingPO={false} canSelect={false} chosenSupplier={null}
      onBack={() => {}} onSelectSupplier={() => {}} onCreatePO={() => {}} />);
    expect(detail).toContain("Evaluation reasoning");
    expect(detail).toContain(atlantic.why_best_or_worst);
    expect(detail).toContain("No specific strengths identified.");
    expect(detail).not.toContain("Why this supplier was selected");

    const compact = renderToStaticMarkup(<AISupplierAnalysisPanel loading={false} loadingStep={0}
      result={analysis} error={null} tokensUsed={0} quotationCount={3} hasApiKey
      onRun={() => {}} onRefresh={() => {}} onCreatePO={() => {}} />);
    expect(compact).toContain("TOP SCORE");
    expect(compact.toLowerCase()).not.toContain("ai top-ranked");
    expect(compact).not.toContain("AI RECOMMENDED SUPPLIER");
    expect(compact).toContain("High risk and AVOID verdict requires review");
    expect(analysis.supplier_analysis[0].score.overall).toBe(91.05);
  });

  it("leaves absent risk unavailable even with a high score or AVOID verdict", () => {
    const leader = { ...row("B", 1, 99, 90), risk: undefined, verdict: "AVOID" as const };
    const html = renderResults(result([leader]));
    expect(html).toContain("Risk unavailable");
    expect(html).not.toContain("High Risk");
    expect(html).not.toContain("Low Risk");
    expect(html).toContain("AVOID verdict requires review");
  });

  it("explains incomplete-quotation eligibility inline without restoring removed warning banners", () => {
    const apex = { ...row("A", 1, 88, 85), name: "Apex Fasteners Ltd", grand_total: 30,
      verdict: "QUOTE INCOMPLETE" as const, evaluation_status: "incomplete" as const };
    const analysis = result([apex]);
    const before = structuredClone(analysis);
    const results = renderToStaticMarkup(<RecommendationResultsScreen result={analysis} ranked={[apex]}
      recommendedRow={apex} quoteAmount={30} onSelectSupplier={() => {}} onViewComparison={() => {}}
      bidSelectable bidSelected={new Set([apex.quotation_id!])} maxSelectableSuppliers={2} />);
    const details = renderToStaticMarkup(<SupplierDetailPanel supplier={apex} rank1={apex} result={analysis}
      quoteAmount={30} creatingPO={false} canSelect chosenSupplier={null}
      onBack={() => {}} onSelectSupplier={() => {}} onCreatePO={() => {}} />);
    for (const html of [results, details]) {
      expect(html).not.toContain("Not eligible for");
      expect(html).not.toContain("A complete supplier evaluation and submitted quotation are required before selection.");
      expect(html).not.toContain("border-danger-200 bg-danger-50");
      expect(html).toContain("The quotation is incomplete, so this supplier is ineligible for selection and award.");
      expect(html).toContain("Apex Fasteners Ltd");
      expect(html).toContain("88/100");
      expect(html).toContain("High Risk");
      expect(html).toContain("QUOTE INCOMPLETE");
      expect(html).toContain("$30.00");
    }
    expect(results).toContain("TOP SCORE");
    expect(results.toLowerCase()).not.toContain("ai top-ranked");
    expect(results).toMatch(/<input[^>]*type="checkbox"[^>]*disabled=""/);
    expect(results).not.toContain('checked=""');
    expect(details).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Select Supplier<\/button>/);
    expect(analysis).toEqual(before);
  });

  it("the compact risk section uses exact evaluation rows without inventing risk categories", () => {
    const a = { ...row("A", 1, 91.05, 59), name: "Shared supplier name", verdict: "AVOID" as const,
      why_best_or_worst: "An open purchase order remains unreceived." };
    const b = { ...row("B", 2, 87, 80), name: "Shared supplier name", risk: undefined,
      why_best_or_worst: "Risk was not assessed for this quotation." };
    const analysis = result([a, b]);
    analysis.risk_flags = [{ type: "cost", severity: "high", message: "Stale envelope risk from another evaluation." }];
    const html = renderToStaticMarkup(<AISupplierAnalysisPanel loading={false} loadingStep={0}
      result={analysis} error={null} tokensUsed={0} quotationCount={2} hasApiKey
      onRun={() => {}} onRefresh={() => {}} onCreatePO={() => {}} />);
    const start = html.indexOf("Risk Assessment</h3>");
    const riskSection = html.slice(start, html.indexOf("</section>", start));
    expect(riskSection).toContain('data-quotation-id="Q-A" data-supplier-id="S-A" data-evaluation-run-id="RUN-current"');
    expect(riskSection).toContain('data-quotation-id="Q-B" data-supplier-id="S-B" data-evaluation-run-id="RUN-current"');
    expect(riskSection).toContain("Supplier risk · High");
    expect(riskSection).toContain("Supplier risk · Unavailable");
    expect(riskSection).toContain(a.why_best_or_worst);
    expect(riskSection).toContain(b.why_best_or_worst);
    expect(riskSection).not.toContain("cost risk");
    expect(riskSection).not.toContain("Stale envelope risk");
  });
});
