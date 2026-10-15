import { describe, expect, it } from "vitest";

import { DEFAULT_SCORING_WEIGHTS } from "../types/erpnext";
import { formatQuoteTotal, resolveQuotePrice } from "../utils/quotePrice";
import {
  buildLocalProcurementRecommendation,
  type AIRequest,
} from "./ai";
import { scoreSuppliers } from "./supplierScoringEngine";

describe("Quote Price Parsing & Formatting — 8 Core Cases", () => {
  it("CASE 1: Valid quote = 15000 -> $15,000.00", () => {
    const res = resolveQuotePrice(15000);
    expect(res.amount).toBe(15000);
    expect(res.status).toBe("submitted");
    expect(formatQuoteTotal(res.amount, res.status)).toBe("$15,000.00");
  });

  it("CASE 2: Quote = null -> Not Submitted", () => {
    const res = resolveQuotePrice(null);
    expect(res.amount).toBeNull();
    expect(res.status).toBe("not_submitted");
    expect(formatQuoteTotal(res.amount, res.status)).toBe("Not Submitted");
  });

  it("CASE 3: Quote = undefined -> Not Submitted", () => {
    const res = resolveQuotePrice(undefined);
    expect(res.amount).toBeNull();
    expect(res.status).toBe("not_submitted");
    expect(formatQuoteTotal(res.amount, res.status)).toBe("Not Submitted");
  });

  it("CASE 4: Quote = empty string -> Amount unavailable", () => {
    const res = resolveQuotePrice("");
    expect(res.amount).toBeNull();
    expect(res.status).toBe("price_not_provided");
    expect(formatQuoteTotal(res.amount, res.status)).toBe("Amount unavailable");
  });

  it("CASE 5: Invalid quote value -> Amount unavailable", () => {
    const res = resolveQuotePrice("invalid_abc");
    expect(res.amount).toBeNull();
    expect(res.status).toBe("price_not_provided");
    expect(formatQuoteTotal(res.amount, res.status)).toBe("Amount unavailable");
  });

  it("CASE 6: Actual supplier-submitted quote = 0 -> $0.00", () => {
    const res = resolveQuotePrice(0);
    expect(res.amount).toBe(0);
    expect(res.status).toBe("submitted");
    expect(formatQuoteTotal(res.amount, res.status)).toBe("$0.00");
  });

  it("CASE 7: Supplier A missing price, Supplier B = $10,000 -> Supplier A must NOT become BEST VALUE", () => {
    const payload: AIRequest = {
      rfq_name: "RFQ-TEST",
      rfq_title: "Pricing test",
      items_requested: [{ item: "Part A", qty: 1 }],
      quotations: [
        {
          supplier_name: "Supplier A (Missing Price)",
          total_value: null,
          price_status: "price_not_provided",
          items: [{ item: "Part A", unit_price: null, total: null }],
        },
        {
          supplier_name: "Supplier B ($10,000)",
          total_value: 10_000,
          price_status: "submitted",
          items: [{ item: "Part A", unit_price: 10_000, total: 10_000 }],
        },
      ],
    };
    const engine = scoreSuppliers(payload.quotations, 1, DEFAULT_SCORING_WEIGHTS);
    const rec = buildLocalProcurementRecommendation(payload, engine);

    const supplierA = rec.supplier_analysis.find((s) => s.name === "Supplier A (Missing Price)");
    const supplierB = rec.supplier_analysis.find((s) => s.name === "Supplier B ($10,000)");

    expect(supplierA?.verdict).toBe("QUOTE INCOMPLETE");
    expect(supplierA?.score?.cost).toBe(-1);
    expect(supplierB?.verdict).toBe("BEST VALUE");
    expect(supplierB?.score?.cost).toBe(100);
    expect(rec.recommended_supplier).toBe("Supplier B ($10,000)");
  });

  it("CASE 8: All suppliers missing valid pricing -> No supplier ranked as BEST VALUE", () => {
    const payload: AIRequest = {
      rfq_name: "RFQ-TEST",
      rfq_title: "Pricing test",
      items_requested: [{ item: "Part A", qty: 1 }],
      quotations: [
        {
          supplier_name: "Supplier 1",
          total_value: null,
          price_status: "price_not_provided",
          items: [{ item: "Part A", unit_price: null, total: null }],
        },
        {
          supplier_name: "Supplier 2",
          total_value: null,
          price_status: "not_submitted",
          items: [{ item: "Part A", unit_price: null, total: null }],
        },
      ],
    };
    const engine = scoreSuppliers(payload.quotations, 1, DEFAULT_SCORING_WEIGHTS);
    const rec = buildLocalProcurementRecommendation(payload, engine);

    for (const s of rec.supplier_analysis) {
      expect(s.verdict).toBe("QUOTE INCOMPLETE");
      expect(s.score?.cost).toBe(-1);
    }
    expect(rec.recommendation_summary).toContain(
      "Quotation pricing was not provided by the suppliers, so a valid price comparison cannot be completed."
    );
    expect(rec.cost_analysis?.savings_vs_expensive).toBe("");
  });

  it("CASE 9: Draft ERPNext quotation with line items (Quantity: 12, Unit Price: 250) -> $3,000.00", () => {
    const erpnextDoc = {
      name: "SQ-2026-0001",
      supplier: "Apex Fasteners Ltd",
      docstatus: 0,
      status: "Draft",
      items: [
        {
          item_code: "BOLT-M8",
          item_name: "Hex Bolt M8",
          qty: 12,
          rate: 250,
          amount: 3000,
        },
      ],
    };
    const res = resolveQuotePrice(erpnextDoc);
    expect(res.amount).toBe(3000);
    expect(res.status).toBe("submitted");
    expect(formatQuoteTotal(res.amount, res.status)).toBe("$3,000.00");
  });

  it("CASE 10: Multi-item quote calculation: Item 1 (10 x $100) + Item 2 (5 x $200) -> $2,000.00", () => {
    const multiItemQuote = {
      supplier: "Atlantic Precision Manufacturing.",
      docstatus: 0,
      items: [
        { item_code: "ITM-01", qty: 10, unit_price: 100 },
        { item_code: "ITM-02", qty: 5, unit_price: 200 },
      ],
    };
    const res = resolveQuotePrice(multiItemQuote);
    expect(res.amount).toBe(2000);
    expect(res.status).toBe("submitted");
    expect(formatQuoteTotal(res.amount, res.status)).toBe("$2,000.00");
  });

  it("CASE 11: End-to-end multi-supplier pricing comparison ($10k, $12k, $15k)", () => {
    const payload: AIRequest = {
      rfq_name: "RFQ-2026-0099",
      rfq_title: "Custom Fasteners",
      items_requested: [{ item: "Bracket", qty: 100 }],
      quotations: [
        {
          supplier_name: "Apex Fasteners Ltd",
          total_value: 10_000,
          items: [{ item: "Bracket", unit_price: 100, total: 10_000 }],
        },
        {
          supplier_name: "Atlantic Precision Manufacturing.",
          total_value: 12_000,
          items: [{ item: "Bracket", unit_price: 120, total: 12_000 }],
        },
        {
          supplier_name: "Blue Ridge Manufacturing Inc",
          total_value: 15_000,
          items: [{ item: "Bracket", unit_price: 150, total: 15_000 }],
        },
      ],
    };

    const engine = scoreSuppliers(payload.quotations, 1, DEFAULT_SCORING_WEIGHTS);
    const rec = buildLocalProcurementRecommendation(payload, engine);

    const apex = rec.supplier_analysis.find((s) => s.name === "Apex Fasteners Ltd");
    const atlantic = rec.supplier_analysis.find((s) => s.name === "Atlantic Precision Manufacturing.");
    const blueRidge = rec.supplier_analysis.find((s) => s.name === "Blue Ridge Manufacturing Inc");

    expect(apex?.grand_total).toBe(10_000);
    expect(apex?.verdict).toBe("BEST VALUE");
    expect(atlantic?.grand_total).toBe(12_000);
    expect(blueRidge?.grand_total).toBe(15_000);
    expect(rec.recommended_supplier).toBe("Apex Fasteners Ltd");
    expect(rec.cost_analysis?.savings_vs_expensive).toBe("$5,000.00 saved vs most expensive bid");
  });

  it("CASE 12: Exact user workflow: Blue Ridge ($7.5k with 0 header), Apex ($8.75k), Atlantic ($10k)", () => {
    const blueRidgeRaw = {
      supplier: "Blue Ridge Manufacturing Inc",
      grand_total: 0,
      items: [{ item_code: "MACH-01", qty: 1, rate: 7500 }],
    };
    const apexRaw = {
      supplier: "Apex Fasteners Ltd",
      grand_total: 8750,
      items: [{ item_code: "MACH-01", qty: 1, rate: 8750 }],
    };
    const atlanticRaw = {
      supplier: "Atlantic Precision Manufacturing",
      grand_total: 10000,
      items: [{ item_code: "MACH-01", qty: 1, rate: 10000 }],
    };

    const blueRidgeTotal = formatQuoteTotal(resolveQuotePrice(blueRidgeRaw).amount, "submitted");
    const apexTotal = formatQuoteTotal(resolveQuotePrice(apexRaw).amount, "submitted");
    const atlanticTotal = formatQuoteTotal(resolveQuotePrice(atlanticRaw).amount, "submitted");

    expect(blueRidgeTotal).toBe("$7,500.00");
    expect(apexTotal).toBe("$8,750.00");
    expect(atlanticTotal).toBe("$10,000.00");

    const payload: AIRequest = {
      rfq_name: "RFQ-2026-0001",
      rfq_title: "Precision Machining",
      items_requested: [{ item: "Machined Housing", qty: 1 }],
      quotations: [
        {
          supplier_name: "Blue Ridge Manufacturing Inc",
          total_value: resolveQuotePrice(blueRidgeRaw).amount,
          items: [{ item: "Machined Housing", unit_price: 7500, total: 7500 }],
        },
        {
          supplier_name: "Apex Fasteners Ltd",
          total_value: resolveQuotePrice(apexRaw).amount,
          items: [{ item: "Machined Housing", unit_price: 8750, total: 8750 }],
        },
        {
          supplier_name: "Atlantic Precision Manufacturing",
          total_value: resolveQuotePrice(atlanticRaw).amount,
          items: [{ item: "Machined Housing", unit_price: 10000, total: 10000 }],
        },
      ],
    };

    const engine = scoreSuppliers(payload.quotations, 1, DEFAULT_SCORING_WEIGHTS);
    const rec = buildLocalProcurementRecommendation(payload, engine);

    const blueRidgeScored = rec.supplier_analysis.find((s) => s.name === "Blue Ridge Manufacturing Inc");
    const apexScored = rec.supplier_analysis.find((s) => s.name === "Apex Fasteners Ltd");
    const atlanticScored = rec.supplier_analysis.find((s) => s.name === "Atlantic Precision Manufacturing");

    expect(blueRidgeScored?.grand_total).toBe(7500);
    expect(blueRidgeScored?.verdict).toBe("BEST VALUE");
    expect(apexScored?.grand_total).toBe(8750);
    expect(atlanticScored?.grand_total).toBe(10000);
    expect(rec.recommended_supplier).toBe("Blue Ridge Manufacturing Inc");
  });
});
