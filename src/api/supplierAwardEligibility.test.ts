import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupplierQuotation } from "../types/erpnext";
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("./erpnext", () => ({
  apiGet: mocks.get, buildResourceUrl: (doctype: string, name?: string) => `${doctype}/${name ?? ""}`,
  buildListConfig: (config: unknown) => config, withSilent: () => ({}),
}));
import { assertPurchaseOrderSuppliersAwardEligible, assertQuotationsAwardEligible, assertSuppliersAwardEligible } from "./supplierAwardEligibility";

const rfq = "PUR-RFQ-2026-00094";
const supplier = '"Atlantic Precision Manufacturing."';
const quotation = { name: "PUR-SQTN-2026-00265", supplier, docstatus: 1, status: "Submitted",
  items: [{ item_code: "PART", qty: 100, rate: 25, request_for_quotation: rfq }] } as SupplierQuotation;
function record(verdict = "AVOID", risk = "High") {
  return { name: "SCORE-94", rfq, analysis_snapshot: JSON.stringify({ analysis: {
    rfq_id: rfq, evaluation_run_id: "run-94", supplier_analysis: [{
      rfq_id: rfq, evaluation_run_id: "run-94", quotation_id: quotation.name, supplier_quotation_id: quotation.name,
      supplier_id: supplier, name: "Atlantic Precision Manufacturing.", rank: 1,
      verdict, risk, score: { overall: 91 }, evaluation_status: "complete", quote_price_status: "submitted",
    }],
  } }) };
}
let scoring: ReturnType<typeof record>;
beforeEach(() => {
  scoring = record();
  mocks.get.mockReset().mockImplementation(async (url: string) => {
    if (url === "Supplier Scoring Result/") return [{ name: scoring.name }];
    if (url.startsWith("Supplier Scoring Result/")) return scoring;
    if (url === `Supplier Quotation/${quotation.name}`) return quotation;
    throw new Error(`Unexpected read ${url}`);
  });
});

describe("persisted supplier award eligibility", () => {
  it("blocks the latest AVOID supplier without changing score or rank", async () => {
    await expect(assertQuotationsAwardEligible(rfq, [quotation])).rejects.toThrow(/AVOID/);
    const row = JSON.parse(scoring.analysis_snapshot).analysis.supplier_analysis[0];
    expect(row.score.overall).toBe(91);
    expect(row.rank).toBe(1);
  });
  it.each(["Low", "Medium"])("allows %s risk GOOD OPTION under existing rules", async risk => {
    scoring = record("GOOD OPTION", risk);
    await expect(assertQuotationsAwardEligible(rfq, [quotation])).resolves.toBeUndefined();
  });
  it("does not infer an additional High-only block", async () => {
    scoring = record("GOOD OPTION", "High");
    await expect(assertQuotationsAwardEligible(rfq, [quotation])).resolves.toBeUndefined();
    await expect(assertSuppliersAwardEligible(rfq, [supplier], [quotation])).resolves.toEqual([quotation]);
    await expect(assertPurchaseOrderSuppliersAwardEligible(supplier, [{ supplier_quotation: quotation.name }])).resolves.toBeUndefined();
  });
  it.each(["Low", "Medium", "High"])("identifies the incomplete quotation as the blocker at %s risk", async risk => {
    scoring = record("QUOTE INCOMPLETE", risk);
    await expect(assertQuotationsAwardEligible(rfq, [quotation])).rejects.toThrow("Quote incomplete.");
    await expect(assertPurchaseOrderSuppliersAwardEligible(supplier, [{ supplier_quotation: quotation.name }])).rejects.toThrow("Quote incomplete.");
  });
  it("cannot evade latest supplier AVOID by choosing an alternate quotation", async () => {
    await expect(assertQuotationsAwardEligible(rfq, [{ ...quotation, name: "OLDER-QUOTE" }])).rejects.toThrow(/AVOID/);
  });
  it("does not match quotation ownership by supplier display name", async () => {
    await expect(assertSuppliersAwardEligible(rfq, ["Atlantic Precision Manufacturing."], [quotation])).rejects.toThrow(/matching this RFQ and supplier/);
  });
  it("preserves a legacy RFQ with a successful empty result lookup", async () => {
    mocks.get.mockResolvedValue([]);
    await expect(assertQuotationsAwardEligible(rfq, [quotation])).resolves.toBeUndefined();
  });
  it("does not treat failed reads as a legacy RFQ without evaluations", async () => {
    mocks.get.mockRejectedValue(new Error("ERP unavailable"));
    await expect(assertQuotationsAwardEligible(rfq, [quotation])).rejects.toThrow("ERP unavailable");
  });
  it.each(["", "bad JSON", "{}", '{"analysis":{"rfq_id":"OTHER","supplier_analysis":[]}}'])
    ("blocks malformed or mismatched persisted evaluations (%s)", async snapshot => {
      scoring.analysis_snapshot = snapshot;
      await expect(assertQuotationsAwardEligible(rfq, [quotation])).rejects.toThrow(/could not be verified/);
    });
  it("blocks a quote missing from the current evaluation even when its supplier is eligible", async () => {
    scoring = record("GOOD OPTION", "Low");
    await expect(assertQuotationsAwardEligible(rfq, [{ ...quotation, name: "OTHER-QUOTE" }])).rejects.toThrow(/could not be verified/);
  });
  it.each([0, 2] as const)("rejects a non-submitted quotation docstatus %s", async docstatus => {
    await expect(assertQuotationsAwardEligible(rfq, [{ ...quotation, docstatus }])).rejects.toThrow(/current submitted/);
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("revalidates a quote-backed PO against current AVOID and exact supplier identity", async () => {
    await expect(assertPurchaseOrderSuppliersAwardEligible(supplier, [{ supplier_quotation: quotation.name }])).rejects.toThrow(/AVOID/);
    await expect(assertPurchaseOrderSuppliersAwardEligible("OTHER-SUPPLIER", [{ supplier_quotation: quotation.name }])).rejects.toThrow(/does not match/);
  });
});
