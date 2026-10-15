import { describe, expect, it } from "vitest";
import { ANTHROPIC_MODEL, DEFAULT_ANTHROPIC_MODEL } from "../config/aiConfig";
import {
  buildLocalProcurementRecommendation,
  getAIProviderAvailability,
  type AIRequest,
} from "./ai";
import { scoreSuppliers } from "./supplierScoringEngine";

describe("Claude Model Configuration & Deduplication", () => {
  it("centralizes model configuration to claude-3-5-sonnet-20241022", () => {
    expect(DEFAULT_ANTHROPIC_MODEL).toBe("claude-3-5-sonnet-20241022");
    expect(ANTHROPIC_MODEL).toBe("claude-3-5-sonnet-20241022");
  });

  it("exposes server-side Claude availability to clients", () => {
    const availability = getAIProviderAvailability();
    expect(availability.claude).toBe(true);
  });

  it("produces exactly 3 unique supplier rows for RFQ with 3 quoted suppliers", () => {
    const payload: AIRequest = {
      rfq_name: "PUR-RFQ-2026-00089",
      rfq_title: "Test Migration RFQ",
      items_requested: [{ item: "PRECISION-BOLT-M8", qty: 100 }],
      quotations: [
        {
          supplier_name: "Atlantic Precision Manufacturing.",
          items: [{ item: "PRECISION-BOLT-M8", unit_price: 25, total: 2500 }],
          total_value: 2500,
        },
        {
          supplier_name: "Apex Fasteners Ltd",
          items: [{ item: "PRECISION-BOLT-M8", unit_price: 25, total: 2500 }],
          total_value: 2500,
        },
        {
          supplier_name: "Eagle Peak Technologies Inc.",
          items: [{ item: "PRECISION-BOLT-M8", unit_price: 25, total: 2500 }],
          total_value: 2500,
        },
      ],
    };

    const engineResult = scoreSuppliers(payload.quotations, 1, {
      price_weight: 40,
      delivery_weight: 25,
      quality_weight: 20,
      reliability_weight: 15,
    });

    const rec = buildLocalProcurementRecommendation(payload, engineResult);
    expect(rec.supplier_analysis).toHaveLength(3);
    const uniqueSuppliers = new Set(rec.supplier_analysis.map((r) => r.name));
    expect(uniqueSuppliers.size).toBe(3);
    expect(rec.supplier_analysis.map((r) => r.rank)).toEqual([1, 2, 3]);
  });
});
