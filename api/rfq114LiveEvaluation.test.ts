import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { resolveAIRecommendation, type AIRequest } from "../src/api/ai";

describe("Live AI Evaluation for PUR-RFQ-2026-00114", () => {
  it.skipIf(process.env.RUN_LIVE_AI_TRACE !== "1")(
    "successfully evaluates PUR-RFQ-2026-00114 with Claude through BidSphere endpoint",
    async () => {
    // 1. Load ERP credentials
    const env: Record<string, string> = {};
    for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
        const idx = trimmed.indexOf("=");
        env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
      }
    }

    const erpUrl = (env.VITE_ERPNEXT_URL || "http://localhost:8081").replace(/\/+$/, "");
    const authHeader = `token ${env.ERP_API_KEY}:${env.ERP_API_SECRET}`;

    // 2. Fetch RFQ
    const rfqRes = await fetch(`${erpUrl}/api/resource/Request for Quotation/PUR-RFQ-2026-00114`, {
      headers: { Authorization: authHeader },
    });
    const rfq = (await rfqRes.json()).data;
    expect(rfq).toBeDefined();
    expect(rfq.name).toBe("PUR-RFQ-2026-00114");

    // 3. Fetch Submitted Quotations (docstatus = 1)
    const sqListRes = await fetch(
      `${erpUrl}/api/resource/Supplier Quotation?filters=${encodeURIComponent(
        JSON.stringify([
          ["items.request_for_quotation", "=", "PUR-RFQ-2026-00114"],
          ["docstatus", "=", 1],
        ])
      )}&fields=${encodeURIComponent(JSON.stringify(["name", "supplier", "supplier_name", "grand_total", "docstatus"]))}`,
      { headers: { Authorization: authHeader } }
    );
    const sqList = (await sqListRes.json()).data || [];
    expect(sqList.length).toBeGreaterThanOrEqual(2);

    const quotations = [];
    for (const sq of sqList) {
      const detailRes = await fetch(`${erpUrl}/api/resource/Supplier Quotation/${sq.name}`, {
        headers: { Authorization: authHeader },
      });
      const quote = (await detailRes.json()).data;
      quotations.push(quote);
    }

    // 4. Construct AIRequest
    const evaluationRunId = `live-eval-${Date.now()}`;
    const aiRequest: AIRequest = {
      evaluation_run_id: evaluationRunId,
      rfq_name: rfq.name,
      rfq_title: rfq.name,
      items_requested: (rfq.items || []).map((i: any) => ({
        item: i.item_name || i.item_code,
        qty: i.qty,
        uom: i.uom,
      })),
      quotations: quotations.map((q) => ({
        quotation_id: q.name,
        supplier_id: q.supplier,
        supplier_name: q.supplier_name,
        total_value: q.grand_total,
        price_status: "submitted",
        items: (q.items || []).map((item: any) => ({
          item: item.item_name || item.item_code,
          requested_qty: item.qty,
          unit_price: item.rate,
          total: item.amount,
          delivery_days: item.lead_time_days > 0 ? item.lead_time_days : 10,
          notes: "",
        })),
        documents: {
          warranty_certificate: !!q.custom_warenty_certificate,
          terms_conditions: !!(q.custom_terms__condition || q.terms),
          insurance_certificate: !!q.custom_insurance_certificate,
        },
      })),
    };

    // 5. Intercept fetch in Node to target local dev server
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url: any, init?: RequestInit) => {
      if (typeof url === "string" && url === "/api/ai/claude") {
        return realFetch("http://localhost:5175/api/ai/claude", init);
      }
      return realFetch(url, init);
    };

    try {
      const weights = { price: 40, delivery: 25, quality: 20, reliability: 15 };
      const resolved = await resolveAIRecommendation(aiRequest, weights);
      
      expect(resolved).toBeDefined();
      expect(resolved?.provider).toBe("claude");
      
      const rec = resolved!.recommendation;
      expect(rec.supplier_analysis).toHaveLength(quotations.length);
      expect(rec.evaluation_run_id).toBe(evaluationRunId);
      
      console.log("Evaluation Winner:", rec.recommended_supplier);
      console.log("Confidence Score:", rec.confidence_score);
      console.log("Summary:", rec.recommendation_summary);
      for (const s of rec.supplier_analysis) {
        console.log(`- ${s.name} (${s.quotation_id}): Score ${s.score.overall}, Verdict: ${s.verdict}, Risk: ${s.risk}`);
      }
    } finally {
      globalThis.fetch = realFetch;
    }
  }, 60000);
});
