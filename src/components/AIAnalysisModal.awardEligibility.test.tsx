import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AIAnalysisModal, { RecommendationResultsScreen, SupplierDetailPanel, SupplierLeaderboard, SupplierRankCard } from "./AIAnalysisModal";
import AISupplierAnalysisPanel from "./AISupplierAnalysisPanel";
import type { AIRecommendation, SupplierAnalysisRow } from "../types/erpnext";

const selectionState = vi.hoisted(() => ({ value: new Set<string>(), comparison: false }));
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useEffect: vi.fn(), useMemo: (factory: () => unknown) => factory(), useState: (initial: unknown) => {
    const value = typeof initial === "function" ? initial() : initial;
    if (value instanceof Set) return [selectionState.value, (update: Set<string> | ((previous: Set<string>) => Set<string>)) => {
      selectionState.value = typeof update === "function" ? update(selectionState.value) : update;
    }];
    if (selectionState.comparison && value === "recommendation") return ["comparison", vi.fn()];
    if (selectionState.comparison && value === "compare") return ["overview", vi.fn()];
    return [value, vi.fn()];
  } };
});
vi.mock("react-dom", () => ({ createPortal: (node: ReactNode) => node }));
vi.mock("../contexts/LayoutContext", () => ({ useOptionalLayout: () => null }));
vi.mock("react-hot-toast", () => ({ toast: { error: vi.fn() } }));

function exactCase(): AIRecommendation {
  const rows: SupplierAnalysisRow[] = [
    { quotation_id: "PUR-SQTN-2026-00271", supplier_id: "Apex Fasteners Ltd", name: "Apex Fasteners Ltd", rank: 1,
      risk: "High", verdict: "QUOTE INCOMPLETE", score: { overall: 88, cost: 90, delivery: 85, quality: 85, reliability: 85 } },
    { quotation_id: "PUR-SQTN-2026-00270", supplier_id: '"Blue Ridge Manufacturing Inc"', name: "Blue Ridge Manufacturing Inc", rank: 2,
      risk: "Low", verdict: "GOOD OPTION", score: { overall: 85, cost: 85, delivery: 85, quality: 85, reliability: 85 } },
    { quotation_id: "PUR-SQTN-2026-00272", supplier_id: '"Redwood Supply Chain Partners"', name: "Redwood Supply Chain Partners", rank: 3,
      risk: "Medium", verdict: "GOOD OPTION", score: { overall: 81, cost: 81, delivery: 81, quality: 81, reliability: 81 } },
  ].map(row => ({ ...row, rfq_id: "PUR-RFQ-2026-00095", evaluation_run_id: "SCORE-PUR-RFQ-2026-00095-00123", grand_total: 30,
    evaluation_status: "complete", quote_price_status: "submitted", strengths: [], weaknesses: [], why_best_or_worst: "" } as SupplierAnalysisRow));
  return { recommended_supplier: rows[0].name, recommended_quotation_id: rows[0].quotation_id,
    recommended_supplier_id: rows[0].supplier_id, evaluation_run_id: "SCORE-PUR-RFQ-2026-00095-00123", confidence_score: 88,
    recommendation_summary: "Apex is the recommended supplier.", final_verdict: "Award Apex.", supplier_analysis: rows,
    cost_analysis: { savings_vs_expensive: "", savings_percentage: 0, price_range: "" }, per_item_analysis: [], risk_flags: [],
    negotiation_tips: [], split_order_option: { recommended: false, reason: "", suggestion: "" } };
}

type Node = ReactElement<Record<string, unknown>>;
function elements(node: ReactNode): Node[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function modal(analysis: AIRecommendation, onStartReverseBidding = vi.fn(), onCreatePO = vi.fn()) {
  return AIAnalysisModal({ open: true, loading: false, loadingStep: 0, result: analysis, error: null,
    quoteAmount: 30, quotationCount: 3, creatingPO: false, hasApiKey: true,
    onClose: vi.fn(), onRetry: vi.fn(), onCreatePO, onSelectSupplier: vi.fn(), onStartReverseBidding });
}
function button(node: ReactNode, label: string) {
  const found = elements(node).find(element => element.type === "button" && renderToStaticMarkup(element).includes(label));
  expect(found, `Missing button ${label}`).toBeDefined();
  return found!;
}
function checkbox(node: ReactNode, name: string) {
  const results = elements(node).find(element => element.type === RecommendationResultsScreen)!;
  const resultsTree = RecommendationResultsScreen(results.props as unknown as Parameters<typeof RecommendationResultsScreen>[0]);
  const leaderboard = elements(resultsTree).find(element => element.type === SupplierLeaderboard)!;
  const leaderboardTree = SupplierLeaderboard(leaderboard.props as unknown as Parameters<typeof SupplierLeaderboard>[0]);
  return elements(leaderboardTree).find(element => element.type === "input" && element.props["aria-label"] === `Select ${name} for reverse bidding`)!;
}

describe("Apex 88 / Blue Ridge 85 / Redwood 81 award-selection UI", () => {
  beforeEach(() => { selectionState.value = new Set(); selectionState.comparison = false; vi.stubGlobal("document", { body: {} }); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("preserves every numerical rank and score while showing no recommendation badge for Apex", () => {
    const analysis = exactCase(), before = structuredClone(analysis);
    const html = renderToStaticMarkup(modal(analysis));
    const tableRows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(match => match[1]);
    for (const [index, name, score, risk, verdict] of [
      [1, "Apex Fasteners Ltd", 88, "High Risk", "QUOTE INCOMPLETE"],
      [2, "Blue Ridge Manufacturing Inc", 85, "Low Risk", "GOOD OPTION"],
      [3, "Redwood Supply Chain Partners", 81, "Medium Risk", "GOOD OPTION"],
    ] as const) {
      const row = tableRows.find(line => line.includes(`Select ${name}`))!;
      const rankCell = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)][1]?.[1];
      expect(rankCell).toContain(`>${index}</span>`);
      expect(row).toContain(`${score}/100`);
      expect(row).toContain(risk); expect(row).toContain(verdict);
      expect(row.toLowerCase()).not.toContain("ai top-ranked");
      if (index === 1) { expect(row).toContain('disabled=""'); expect(row).toContain("TOP SCORE"); }
      else { expect(row).not.toContain('disabled=""'); expect(row).not.toContain("TOP SCORE"); }
      expect(row).toMatch(/<button(?![^>]*disabled)[^>]*>Details →<\/button>/);
    }
    expect(html).toContain("Highest numerical score: 88/100.");
    expect(html).toContain("The quotation is incomplete, so this supplier is ineligible for selection and award.");
    expect(html).not.toContain("Apex is the recommended supplier.");
    expect(html).not.toContain("border-danger-200 bg-danger-50");
    expect(html).toContain("Select 2 suppliers to start reverse bidding.");
    expect(analysis).toEqual(before);
  });

  it("enables Start Reverse Bidding for Blue Ridge + Redwood and submits only their exact identities", () => {
    const analysis = exactCase(), start = vi.fn();
    let tree = modal(analysis, start);
    expect(button(tree, "Start Reverse Bidding").props.disabled).toBe(true);
    const apex = checkbox(tree, "Apex Fasteners Ltd");
    expect(apex.props.disabled).toBe(true);
    (apex.props.onChange as () => void)();
    expect(selectionState.value.size).toBe(0);
    (checkbox(tree, "Blue Ridge Manufacturing Inc").props.onChange as () => void)();
    tree = modal(analysis, start);
    expect(button(tree, "Start Reverse Bidding").props.disabled).toBe(true);
    (checkbox(tree, "Redwood Supply Chain Partners").props.onChange as () => void)();
    tree = modal(analysis, start);
    const action = button(tree, "Start Reverse Bidding");
    expect(action.props.disabled).toBe(false);
    expect(renderToStaticMarkup(action)).toContain("Start Reverse Bidding (2)");
    expect(renderToStaticMarkup(tree)).toContain("2 of 2 selected");
    (action.props.onClick as () => void)();
    expect(start).toHaveBeenCalledExactlyOnceWith([
      { rfq_id: "PUR-RFQ-2026-00095", supplier_id: '"Blue Ridge Manufacturing Inc"', quotation_id: "PUR-SQTN-2026-00270" },
      { rfq_id: "PUR-RFQ-2026-00095", supplier_id: '"Redwood Supply Chain Partners"', quotation_id: "PUR-SQTN-2026-00272" },
    ]);
  });

  it("does not count or submit Apex from stale selection state and blocks the PO handler", () => {
    const analysis = exactCase(), start = vi.fn(), createPo = vi.fn();
    selectionState.value = new Set(["PUR-SQTN-2026-00271", "PUR-SQTN-2026-00270"]);
    const tree = modal(analysis, start, createPo), action = button(tree, "Start Reverse Bidding");
    expect(action.props.disabled).toBe(true);
    expect(renderToStaticMarkup(tree)).toContain("1 of 2 selected");
    (action.props.onClick as () => void)();
    expect(start).not.toHaveBeenCalled();
    const po = button(tree, "Create Purchase Order");
    expect(po.props.disabled).toBe(true);
    (po.props.onClick as () => void)();
    expect(createPo).not.toHaveBeenCalled();
  });

  it("uses the same neutral leader label in rank cards and compact analysis", () => {
    const analysis = exactCase(), apex = analysis.supplier_analysis[0];
    const card = renderToStaticMarkup(<SupplierRankCard supplier={apex} rankIndex={0} isRecommended onSelect={vi.fn()} onChooseSupplier={vi.fn()} />);
    const compact = renderToStaticMarkup(<AISupplierAnalysisPanel loading={false} loadingStep={0} result={analysis}
      error={null} tokensUsed={0} quotationCount={3} hasApiKey onRun={vi.fn()} onRefresh={vi.fn()} onCreatePO={vi.fn()} />);
    for (const html of [card, compact]) {
      expect(html).toContain("TOP SCORE"); expect(html.toLowerCase()).not.toContain("ai top-ranked");
      expect(html).toContain("Apex Fasteners Ltd"); expect(html).toContain("QUOTE INCOMPLETE");
    }
    expect(card).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Select Supplier<\/button>/);
    expect(compact).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Create PO — Apex Fasteners Ltd<\/button>/);
  });

  it("keeps comparison and re-analysis headings neutral for the same ineligible numerical leader", () => {
    const analysis = exactCase(), apex = analysis.supplier_analysis[0];
    selectionState.comparison = true;
    const comparison = renderToStaticMarkup(modal(analysis));
    const reanalysis = renderToStaticMarkup(<RecommendationResultsScreen result={analysis} ranked={analysis.supplier_analysis}
      recommendedRow={apex} quoteAmount={30} chosenSupplier="Blue Ridge Manufacturing Inc" onSelectSupplier={vi.fn()} onViewComparison={vi.fn()} />);
    expect(comparison).toContain("Top score"); expect(reanalysis).toContain("Current top score");
    for (const html of [comparison, reanalysis]) {
      expect(html.toLowerCase()).not.toContain("ai top-ranked");
      expect(html).toContain("Apex Fasteners Ltd"); expect(html).toContain("88/100");
    }
  });

  it("allows High risk with a complete GOOD OPTION quotation and counts all three eligible suppliers", () => {
    const analysis = exactCase(), start = vi.fn();
    // A separate positive scenario; the persisted RFQ95 fixture above stays incomplete.
    analysis.supplier_analysis[0].verdict = "GOOD OPTION";
    const before = structuredClone(analysis);
    let tree = modal(analysis, start);
    expect(renderToStaticMarkup(tree)).toContain("0 of 3 selected");
    for (const supplier of analysis.supplier_analysis) {
      expect(checkbox(tree, supplier.name).props.disabled).toBe(false);
    }
    const html = renderToStaticMarkup(tree);
    const leader = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(match => match[1])
      .find(row => row.includes("Select Apex Fasteners Ltd"))!;
    expect(leader).toContain("High Risk"); expect(leader).toContain("GOOD OPTION"); expect(leader).toContain("88/100");
    expect(leader).not.toContain('disabled=""');
    (checkbox(tree, "Apex Fasteners Ltd").props.onChange as () => void)();
    tree = modal(analysis, start);
    expect(checkbox(tree, "Apex Fasteners Ltd").props.checked).toBe(true);
    expect(renderToStaticMarkup(tree)).toContain("1 of 3 selected");
    (checkbox(tree, "Blue Ridge Manufacturing Inc").props.onChange as () => void)();
    tree = modal(analysis, start);
    const action = button(tree, "Start Reverse Bidding");
    expect(action.props.disabled).toBe(false);
    expect(renderToStaticMarkup(action)).toContain("Start Reverse Bidding (2)");
    expect(renderToStaticMarkup(tree)).toContain("2 of 3 selected");
    (action.props.onClick as () => void)();
    expect(start).toHaveBeenCalledExactlyOnceWith([
      { rfq_id: "PUR-RFQ-2026-00095", supplier_id: "Apex Fasteners Ltd", quotation_id: "PUR-SQTN-2026-00271" },
      { rfq_id: "PUR-RFQ-2026-00095", supplier_id: '"Blue Ridge Manufacturing Inc"', quotation_id: "PUR-SQTN-2026-00270" },
    ]);
    (checkbox(tree, "Redwood Supply Chain Partners").props.onChange as () => void)();
    tree = modal(analysis, start);
    expect(renderToStaticMarkup(tree)).toContain("3 of 3 selected");
    expect(button(tree, "Start Reverse Bidding").props.disabled).toBe(false);
    expect(analysis).toEqual(before);
  });

  it("permits High-risk complete quotation selection from cards and details and preserves PO callback gating", () => {
    const analysis = exactCase();
    analysis.supplier_analysis[0].verdict = "GOOD OPTION";
    const high = analysis.supplier_analysis[0], choose = vi.fn(), createPo = vi.fn();
    const card = SupplierRankCard({ supplier: high, rankIndex: 0, isRecommended: true, onSelect: vi.fn(), onChooseSupplier: choose });
    const cardAction = button(card, "Select Supplier");
    expect(cardAction.props.disabled).toBe(false);
    expect(renderToStaticMarkup(card)).toContain("High Risk");
    (cardAction.props.onClick as (event: { stopPropagation: () => void }) => void)({ stopPropagation: vi.fn() });
    expect(choose).toHaveBeenCalledWith(high);

    const detail = SupplierDetailPanel({ supplier: high, rank1: high, result: analysis, quoteAmount: 30,
      creatingPO: false, canSelect: true, chosenSupplier: null, onBack: vi.fn(), onSelectSupplier: choose, onCreatePO: createPo });
    const detailAction = button(detail, "Select Supplier");
    expect(detailAction.props.disabled).toBe(false);
    expect(renderToStaticMarkup(detail)).toContain("High Risk");
    (detailAction.props.onClick as () => void)();
    expect(choose).toHaveBeenCalledTimes(2);

    const compact = AISupplierAnalysisPanel({ loading: false, loadingStep: 0, result: analysis,
      error: null, tokensUsed: 0, quotationCount: 3, hasApiKey: true, onRun: vi.fn(), onRefresh: vi.fn(), onCreatePO: createPo });
    const compactAction = button(compact, "Create PO — Apex Fasteners Ltd");
    expect(compactAction.props.disabled).toBe(false);
    (compactAction.props.onClick as () => void)();
    expect(createPo).toHaveBeenCalledTimes(1);

    const tree = AIAnalysisModal({ open: true, loading: false, loadingStep: 0, result: analysis, error: null,
      quoteAmount: 30, quotationCount: 3, creatingPO: false, hasApiKey: true, onClose: vi.fn(), onRetry: vi.fn(), onCreatePO: createPo });
    const poAction = button(tree, "Create Purchase Order");
    expect(poAction.props.disabled).toBe(false);
    (poAction.props.onClick as () => void)();
    expect(createPo).toHaveBeenCalledTimes(2);
  });
});
