import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { RFQSupplier, SupplierAnalysisRow } from "../../../types/erpnext";
import RFQDetailEnterpriseLayout, { buildSubmittedSupplierScores, type RFQDetailEnterpriseLayoutProps, type SupplierQuoteView } from "./RFQDetailEnterpriseLayout";

vi.mock("../../../components/StatusBadge", () => ({
  default: ({ status }: { status: string }) => status,
}));

function supplier(id: string, name = id): RFQSupplier {
  return { name: `RFQS-${id}`, supplier: id, supplier_name: name } as RFQSupplier;
}
function quote(id: string, name = id): SupplierQuoteView {
  return { sqName: `Q-${id}`, supplier: id, supplier_name: name, total: 15, priceStatus: "submitted", notes: "", byItem: new Map() };
}
function row(id: string, score: number, rank: number): SupplierAnalysisRow {
  return { quotation_id: `Q-${id}`, supplier_id: id, name: id, score: { overall: score, cost: 100, delivery: 100, reliability: 100 },
    rank, evaluation_run_id: "RUN-current", rfq_id: "RFQ-91", verdict: "GOOD OPTION", grand_total: 15,
    strengths: [], weaknesses: [], why_best_or_worst: "" };
}
function display(suppliers: RFQSupplier[], quotes: SupplierQuoteView[], rows: SupplierAnalysisRow[], rfqId = "RFQ-91") {
  return buildSubmittedSupplierScores({
    suppliers, localQuotes: new Map(quotes.map((q) => [q.supplier, q])), analysisRows: rows,
    quoteForSupplier: (all, id) => all.get(id), itemCount: 1, rfqId,
  });
}

describe("RFQ current supplier score and rank display", () => {
  it("shows the exact incomplete Apex score leader neutrally without promoting Blue Ridge or Redwood", () => {
    const apex = { ...row("Apex Fasteners Ltd", 88, 1), quotation_id: "PUR-SQTN-2026-00271", risk: "High" as const, verdict: "QUOTE INCOMPLETE" as const };
    const blue = { ...row("Blue Ridge Manufacturing Inc", 85, 2), supplier_id: '"Blue Ridge Manufacturing Inc"', quotation_id: "PUR-SQTN-2026-00270", risk: "Low" as const };
    const redwood = { ...row("Redwood Supply Chain Partners", 81, 3), supplier_id: '"Redwood Supply Chain Partners"', quotation_id: "PUR-SQTN-2026-00272", risk: "Medium" as const };
    const rows: SupplierAnalysisRow[] = [apex, blue, redwood].map(item => ({ ...item, rfq_id: "PUR-RFQ-2026-00095",
      evaluation_run_id: "SCORE-PUR-RFQ-2026-00095-00123", evaluation_status: "complete", quote_price_status: "submitted" }));
    const suppliers = rows.map(item => supplier(item.supplier_id!, item.name));
    const quotes = rows.map(item => ({ ...quote(item.supplier_id!, item.name), sqName: item.quotation_id! }));
    const props = {
      rfq: { name: "PUR-RFQ-2026-00095", status: "Open", items: [], suppliers },
      workflow: { currentStage: "AI Analysis", nextApprover: "Procurement", purchaseOrderStatus: "Pending", legalStatus: "Pending", financeStatus: "Pending" },
      timeline: [], localQuotes: new Map(quotes.map(item => [item.supplier, item])), declineBySupplier: new Map(), pendingInvitationSupplierIds: new Set(),
      supplierAnalysisRows: rows, quoteForSupplier: (all: Map<string, SupplierQuoteView>, id: string) => all.get(id),
      resolveSupplierStatus: () => "Submitted", supplierStatusTone: () => "success",
      companyLabel: "Company", departmentLabel: "Procurement", ownerLabel: "Owner", materialRequestLabel: "MR", validTillDisplay: "2026-09-30",
      currencyLabel: "USD", expectedDelivery: "2026-09-30", estimatedBudget: 15, totalQty: 1,
      supplierCount: 3, quotedCount: 3, respondedCount: 3, declinedCount: 0, responseRate: 100,
      lowestQuote: 15, avgQuote: 15, selectedSupplierTotal: 0,
      copilotHasAnalysis: true, aiConfidence: 88, copilotRiskLevel: "High", copilotSavings: { amount: 0, pct: 0 },
      recommendedSupplierLabel: apex.name, hasQuotations: true, aiReady: true, hasAnthropicKey: true, aiButtonMode: "view_and_rerun",
    } as unknown as RFQDetailEnterpriseLayoutProps;
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(RFQDetailEnterpriseLayout, props)));
    const start = html.indexOf("AI evaluation</h2>"), summary = html.slice(start, html.indexOf("</section>", start));
    expect(summary).toContain("Top score"); expect(summary).toContain("Apex Fasteners Ltd");
    expect(summary).toContain("88/100"); expect(summary).toContain("#1");
    expect(summary).toContain("High"); expect(summary).toContain("QUOTE INCOMPLETE");
    expect(summary.toLowerCase()).not.toContain("ai top-ranked");
    expect(summary).toContain("The quotation is incomplete, so this supplier is ineligible for selection and award.");
    const scores = display(suppliers, quotes, rows, "PUR-RFQ-2026-00095");
    expect(rows.map(item => scores.get(`quotation:${item.quotation_id}`))).toEqual([
      expect.objectContaining({ score: 88, rank: 1 }),
      expect.objectContaining({ score: 85, rank: 2 }),
      expect.objectContaining({ score: 81, rank: 3 }),
    ]);
  });

  it("renders the whole RFQ layout with the winner's matched rank and strengths", () => {
    const suppliers = [supplier("Titan"), supplier("FEMSA"), supplier("Eagle")];
    const femsa = { ...row("FEMSA", 100, 1), strengths: ["FEMSA current-run strength"] };
    const quotes = new Map(suppliers.map((s) => [s.supplier, quote(s.supplier)]));
    const props = {
      rfq: { name: "RFQ-91", status: "Open", items: [], suppliers },
      workflow: { currentStage: "AI Analysis", nextApprover: "Procurement", purchaseOrderStatus: "Pending", legalStatus: "Pending", financeStatus: "Pending" },
      timeline: [], localQuotes: quotes, declineBySupplier: new Map(), pendingInvitationSupplierIds: new Set(),
      supplierAnalysisRows: [femsa, row("Titan", 100, 2), row("Eagle", 84, 3)],
      quoteForSupplier: (all: Map<string, SupplierQuoteView>, id: string) => all.get(id),
      resolveSupplierStatus: () => "Submitted", supplierStatusTone: () => "success",
      companyLabel: "Company", departmentLabel: "Procurement", ownerLabel: "Owner", materialRequestLabel: "MR", validTillDisplay: "2026-09-30",
      currencyLabel: "USD", expectedDelivery: "2026-09-30", estimatedBudget: 15, totalQty: 1,
      supplierCount: 3, quotedCount: 3, respondedCount: 3, declinedCount: 0, responseRate: 100,
      lowestQuote: 15, avgQuote: 15, selectedSupplierTotal: 0,
      copilotHasAnalysis: true, aiConfidence: 100, copilotRiskLevel: "Low", copilotSavings: { amount: 0, pct: 0 },
      recommendedSupplierLabel: "FEMSA", hasQuotations: true, aiReady: true, hasAnthropicKey: true, aiButtonMode: "view_and_rerun",
    } as unknown as RFQDetailEnterpriseLayoutProps;
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(RFQDetailEnterpriseLayout, props)));
    expect(html).toContain("FEMSA current-run strength");
    expect(html).toContain("AI top-ranked by the configured weighted score.");
    expect(html).not.toContain("Recommend proceeding");
    expect(html).toContain("Titan");
    expect(html).toContain("Eagle");
  });

  it("shows the selected supplier's own score, risk, verdict and reasoning", () => {
    const atlantic = { ...row("Atlantic", 91.05, 1), risk: "High" as const, verdict: "AVOID" as const,
      why_best_or_worst: "Atlantic has an overdue open purchase order.", grand_total: 2500 };
    const femsa = { ...row("FEMSA", 87, 2), risk: "Low" as const,
      why_best_or_worst: "FEMSA current evaluation reason.", grand_total: 2600 };
    const suppliers = [supplier("Atlantic"), supplier("FEMSA")];
    const quotes = new Map(suppliers.map((s) => [s.supplier, { ...quote(s.supplier), total: s.supplier === "FEMSA" ? 2600 : 2500 }]));
    const props = {
      rfq: { name: "RFQ-91", status: "Open", items: [], suppliers },
      workflow: { currentStage: "Supplier Selected", nextApprover: "Procurement", purchaseOrderStatus: "Pending", legalStatus: "Pending", financeStatus: "Pending" },
      timeline: [], localQuotes: quotes, declineBySupplier: new Map(), pendingInvitationSupplierIds: new Set(),
      supplierAnalysisRows: [atlantic, femsa], quoteForSupplier: (all: Map<string, SupplierQuoteView>, id: string) => all.get(id),
      resolveSupplierStatus: () => "Submitted", supplierStatusTone: () => "success",
      companyLabel: "Company", departmentLabel: "Procurement", ownerLabel: "Owner", materialRequestLabel: "MR", validTillDisplay: "2026-09-30",
      currencyLabel: "USD", expectedDelivery: "2026-09-30", estimatedBudget: 2600, totalQty: 1,
      supplierCount: 2, quotedCount: 2, respondedCount: 2, declinedCount: 0, responseRate: 100,
      lowestQuote: 2500, avgQuote: 2550, selectedSupplierTotal: 2600,
      copilotHasAnalysis: true, aiConfidence: 94, copilotRiskLevel: "High", copilotSavings: { amount: 100, pct: 4 },
      recommendedSupplierLabel: "Atlantic", selectionReason: atlantic.why_best_or_worst,
      hasSelectedSupplier: true, resolvedSelectedSupplier: "FEMSA", hasQuotations: true, aiReady: true, hasAnthropicKey: true, aiButtonMode: "view_and_rerun",
      canCreatePO: true,
    } as unknown as RFQDetailEnterpriseLayoutProps;
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(RFQDetailEnterpriseLayout, props)));
    const start = html.indexOf("AI evaluation</h2>");
    const summary = html.slice(start, html.indexOf("</section>", start));
    expect(summary).toContain("FEMSA");
    expect(summary).toContain("87/100");
    expect(summary).toContain("Low");
    expect(summary).toContain("GOOD OPTION");
    expect(summary).toContain(femsa.why_best_or_worst);
    expect(summary).not.toContain("High");
    expect(summary).not.toContain("AVOID");
    expect(summary).not.toContain(atlantic.why_best_or_worst);
    expect(summary).not.toContain("94%");
    expect(summary).not.toContain("$100.00");
    const generatePoButton = html.match(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*Generate PO<\/button>/)?.[0];
    expect(generatePoButton).toBeDefined();
    expect(generatePoButton).not.toContain('disabled=""');

    const highRiskHtml = renderToStaticMarkup(createElement(MemoryRouter, null,
      createElement(RFQDetailEnterpriseLayout, { ...props, supplierAnalysisRows: [atlantic, { ...femsa, risk: "High", evaluation_status: "complete", quote_price_status: "submitted" }] })));
    const highRiskPoButton = highRiskHtml.match(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*Generate PO<\/button>/)?.[0];
    expect(highRiskPoButton).toBeDefined();
    expect(highRiskPoButton).not.toContain('disabled=""');
    const highRiskStart = highRiskHtml.indexOf("AI evaluation</h2>");
    expect(highRiskHtml.slice(highRiskStart, highRiskHtml.indexOf("</section>", highRiskStart))).toContain("High");

    const blockedHtml = renderToStaticMarkup(createElement(MemoryRouter, null,
      createElement(RFQDetailEnterpriseLayout, { ...props, resolvedSelectedSupplier: "Atlantic" })));
    const blockedPoButton = blockedHtml.match(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*Generate PO<\/button>/)?.[0];
    expect(blockedPoButton).toContain('disabled=""');
    expect(blockedPoButton).toContain("Supplier is currently marked AVOID due to high risk and cannot be selected for award.");
  });

  it("preserves FEMSA rank 1 and Titan rank 2 on the real 100-point tie regardless of supplier order", () => {
    const ids = ["Titan", "FEMSA", "Eagle"];
    const scores = display(ids.map((id) => supplier(id)), ids.map((id) => quote(id)), [
      row("FEMSA", 100, 1), row("Titan", 100, 2), row("Eagle", 84, 3),
    ]);
    expect(scores.get("quotation:Q-FEMSA")).toMatchObject({ score: 100, rank: 1 });
    expect(scores.get("quotation:Q-Titan")).toMatchObject({ score: 100, rank: 2 });
    expect(scores.get("name:femsa")).toMatchObject({ score: 100, rank: 1 });
    expect(scores.get("quotation:Q-Eagle")).toMatchObject({ score: 84, rank: 3 });
  });

  it("leaves missing evaluations unavailable instead of invoking the local scoring engine", () => {
    const scores = display([supplier("A"), supplier("B")], [quote("A"), quote("B")], [row("A", 0, 1)]);
    expect(scores.get("quotation:Q-A")).toMatchObject({ score: 0, rank: 1 });
    expect(scores.has("quotation:Q-B")).toBe(false);
    expect(scores.has("supplier:B")).toBe(false);
  });

  it("never replaces an explicit stale quotation or conflicting supplier ID using its name", () => {
    const stale = { ...row("A", 75, 1), quotation_id: "Q-previous" };
    const conflict = { ...row("B", 82, 2), supplier_id: "A" };
    expect(display([supplier("A"), supplier("B")], [quote("A"), quote("B")], [stale, conflict]).size).toBe(0);
  });

  it("rejects a fuzzy quote lookup that returned another supplier's quotation", () => {
    const scores = buildSubmittedSupplierScores({
      suppliers: [supplier("A")], localQuotes: new Map([["B", quote("B")]]), analysisRows: [row("B", 100, 1)],
      quoteForSupplier: () => quote("B"), itemCount: 1, rfqId: "RFQ-91",
    });
    expect(scores.size).toBe(0);
  });

  it("preserves case-sensitive IDs and does not merge same-name suppliers", () => {
    const a = { ...row("A", 82, 1), name: "Same Name" };
    const lower = { ...row("a", 64, 2), name: "Same Name" };
    const scores = display([supplier("A", "Same Name"), supplier("a", "Same Name")], [quote("A", "Same Name"), quote("a", "Same Name")], [lower, a]);
    expect(scores.get("supplier:A")).toMatchObject({ score: 82, rank: 1 });
    expect(scores.get("supplier:a")).toMatchObject({ score: 64, rank: 2 });
    expect(scores.has("name:same name")).toBe(false);
  });

  it("does not combine explicit evaluation runs or infer current results from untagged rows", () => {
    const current = row("A", 90, 1);
    const legacy = { ...row("B", 75, 2), evaluation_run_id: undefined };
    const suppliers = [supplier("A"), supplier("B")];
    const quotes = [quote("A"), quote("B")];
    const scores = display(suppliers, quotes, [current, legacy]);
    expect(scores.has("supplier:A")).toBe(true);
    expect(scores.has("supplier:B")).toBe(false);
    expect(display(suppliers, quotes, [current, { ...legacy, evaluation_run_id: "RUN-old" }]).size).toBe(0);
  });

  it("accepts a single unambiguous legacy evaluation without inventing a run", () => {
    const legacy = { ...row("A", 75, 2), quotation_id: undefined, supplier_id: undefined, evaluation_run_id: undefined };
    expect(display([supplier("A")], [quote("A")], [legacy]).get("supplier:A")).toMatchObject({ score: 75, rank: 2 });
  });
});
