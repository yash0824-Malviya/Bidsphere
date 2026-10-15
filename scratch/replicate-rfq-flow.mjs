import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

// Mock import.meta.env
globalThis.import = { meta: { env: { DEV: true } } };

const base = (process.env.ERPNEXT_URL || process.env.VITE_ERPNEXT_URL || process.env.VITE_PROXY_TARGET || "").replace(/\/+$/, "");
const auth = `token ${process.env.ERP_API_KEY || process.env.VITE_API_KEY}:${process.env.ERP_API_SECRET || process.env.VITE_API_SECRET}`;

async function erp(path) {
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: auth, Accept: "application/json" },
  });
  return res.json();
}

// Import actual modules from codebase
async function run() {
  const { resolveAIRecommendation, buildAnalysisPrompt } = await import("../src/api/ai.ts");
  const { getSupplierPerformance } = await import("../src/api/supplierPerformance.ts");
  const { getScoringConfig } = await import("../src/api/supplierScoring.ts");
  const { scoringResultFromRecommendation } = await import("../src/api/supplierScoringEngine.ts");
  const { saveScoringResult } = await import("../src/api/supplierScoringResults.ts");
  const { normalizeAndDeduplicateRecommendation, findRecommendationWinner } = await import("../src/utils/aiRecommendationNormalization.ts");

  const rfqId = "PUR-RFQ-2026-00109";
  console.log("1. Fetching RFQ...");
  const rfqRes = await erp(`/api/resource/Request for Quotation/${rfqId}`);
  const rfq = rfqRes.data;

  console.log("2. Fetching SQs via items.request_for_quotation...");
  const sqRes = await erp(
    `/api/resource/Supplier Quotation?filters=${encodeURIComponent(
      JSON.stringify([["items.request_for_quotation", "=", rfqId]])
    )}&fields=${encodeURIComponent(JSON.stringify(["name", "supplier", "supplier_name", "grand_total", "docstatus", "status", "creation", "currency"]))}&order_by=creation%20asc`
  );

  const hydrated = [];
  const seenSqNames = new Set();
  for (const s of sqRes.data || []) {
    if (seenSqNames.has(s.name)) continue;
    seenSqNames.add(s.name);
    const detail = await erp(`/api/resource/Supplier Quotation/${s.name}`);
    hydrated.push(detail.data);
  }

  // Exactly replicate localQuotes in RFQDetailPage.tsx
  const grouped = new Map();
  for (const sq of hydrated) {
    const suppKey = (sq.supplier_name || sq.supplier || "").trim().toLowerCase();
    const list = grouped.get(suppKey) ?? [];
    list.push(sq);
    grouped.set(suppKey, list);
  }

  const localQuotes = new Map();
  for (const [suppKey, list] of grouped) {
    list.sort((a, b) => {
      const aDoc = a.docstatus ?? 0;
      const bDoc = b.docstatus ?? 0;
      if (aDoc !== bDoc) return bDoc - aDoc;
      const aPrice = a.grand_total ?? 0;
      const bPrice = b.grand_total ?? 0;
      if ((aPrice > 0) !== (bPrice > 0)) return bPrice > 0 ? 1 : -1;
      return (b.name || "").localeCompare(a.name || "");
    });
    const sq = list[0];
    const supplierName = sq.supplier_name ?? sq.supplier ?? "";
    const byItem = new Map();
    for (const it of sq.items ?? []) {
      const unitPrice = it.rate ?? null;
      const qty = it.qty ?? 1;
      const lineTotal = it.amount ?? (unitPrice !== null ? unitPrice * qty : null);
      const delivery_days = it.lead_time_days ?? 0;
      const entry = { unit_price: unitPrice, total: lineTotal, delivery_days };
      if (it.item_code) {
        byItem.set(it.item_code, entry);
        byItem.set(it.item_code.trim().toLowerCase(), entry);
      }
      if (it.item_name) {
        byItem.set(it.item_name, entry);
        byItem.set(it.item_name.trim().toLowerCase(), entry);
      }
    }
    const quoteObj = {
      sqName: sq.name,
      supplier: sq.supplier,
      supplier_name: supplierName,
      total: sq.grand_total,
      priceStatus: sq.grand_total > 0 ? "submitted" : "missing",
      notes: sq.notes || "",
      payment_terms: sq.terms,
      warrantyCertificate: Boolean(sq.custom_warenty_certificate),
      termsCondition: Boolean(sq.custom_terms__condition),
      insuranceCertificate: Boolean(sq.custom_insurance_certificate),
      byItem,
    };
    localQuotes.set(supplierName, quoteObj);
  }

  console.log("3. localQuotes populated:", Array.from(localQuotes.keys()));

  // Invited suppliers
  const invitedSuppliers = new Set(
    (rfq.suppliers ?? []).map((s) => (s.supplier ?? s.supplier_name ?? "").trim().toLowerCase())
  );
  const eligibleQuotes = [];
  for (const q of localQuotes.values()) {
    const rawKey = (q.supplier ?? q.supplier_name ?? "").trim().toLowerCase();
    if (invitedSuppliers.has(rawKey)) {
      eligibleQuotes.push(q);
    }
  }

  console.log("4. Eligible quotes:", eligibleQuotes.map(q => ({ name: q.sqName, supplier: q.supplier, supplier_name: q.supplier_name, total: q.total })));

  const evaluationRunId = "run-" + Date.now();
  const aiRequest = {
    evaluation_run_id: evaluationRunId,
    rfq_name: rfq.name,
    rfq_title: rfq.name,
    items_requested: (rfq.items ?? []).map((it) => ({
      item: it.item_name ?? it.item_code,
      qty: it.qty,
      uom: it.uom,
    })),
    quotations: eligibleQuotes.map((q) => {
      const lines = (rfq.items ?? []).map((it) => {
        const itemCodeKey = it.item_code?.trim().toLowerCase();
        const itemNameKey = it.item_name?.trim().toLowerCase();
        const cell =
          (it.item_code ? q.byItem.get(it.item_code) : undefined) ??
          (itemCodeKey ? q.byItem.get(itemCodeKey) : undefined) ??
          (it.item_name ? q.byItem.get(it.item_name) : undefined) ??
          (itemNameKey ? q.byItem.get(itemNameKey) : undefined);

        const unitPrice = cell?.unit_price ?? null;
        const qty = it.qty ?? 1;
        const lineTotal = cell?.total ?? (unitPrice !== null ? unitPrice * qty : null);
        const cellDelivery = cell?.delivery_days && cell.delivery_days > 0 ? cell.delivery_days : undefined;

        return {
          item: it.item_name ?? it.item_code,
          requested_qty: qty,
          unit_price: unitPrice,
          total: lineTotal,
          delivery_days: cellDelivery,
          notes: "",
        };
      });

      return {
        quotation_id: q.sqName,
        supplier_id: q.supplier,
        supplier_name: q.supplier_name,
        items: lines,
        total_value: q.total,
        price_status: q.priceStatus,
        payment_terms: q.payment_terms,
        notes: q.notes,
        documents: {
          warranty_certificate: q.warrantyCertificate,
          terms_conditions: q.termsCondition,
          insurance_certificate: q.insuranceCertificate,
        },
      };
    }),
  };

  const scoringConfig = await getScoringConfig();
  console.log("5. Scoring config:", scoringConfig);
  const analysisWeights = {
    price: scoringConfig.price_weight,
    delivery: scoringConfig.delivery_weight,
    quality: scoringConfig.quality_weight,
    reliability: scoringConfig.reliability_weight,
  };

  const supplierNames = aiRequest.quotations.map((q) => q.supplier_id || q.supplier_name);
  let historicalData;
  try {
    historicalData = await getSupplierPerformance(supplierNames);
    console.log("6. Historical data:", historicalData);
  } catch (err) {
    console.warn("Could not fetch historical data:", err);
  }

  for (const quote of aiRequest.quotations) {
    quote.historical_data = historicalData?.[quote.supplier_id || quote.supplier_name];
  }

  console.log("7. Calling resolveAIRecommendation...");
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const fullUrl = typeof url === "string" && url.startsWith("/") ? `http://localhost:5175${url}` : url;
    return origFetch(fullUrl, opts);
  };

  try {
    const resolved = await resolveAIRecommendation(aiRequest, analysisWeights);
    console.log("8. resolveAIRecommendation returned:", resolved ? "SUCCESS (provider: " + resolved.provider + ")" : "NULL");
    if (!resolved) {
      console.error("FAIL: resolveAIRecommendation returned null!");
      return;
    }
    let recommendation = resolved.recommendation;
    console.log("Recommendation winner:", recommendation.recommended_supplier);
    console.log("Recommendation ranking count:", recommendation.supplier_analysis?.length);

    const authoritativeQuotes = eligibleQuotes.map((q) => ({
      quotation_id: q.sqName || undefined,
      supplier_quotation_id: q.sqName || undefined,
      supplier_id: q.supplier || undefined,
      supplier_name: q.supplier_name,
      grand_total: q.total,
      rfq_id: rfq.name,
      docstatus: 1,
      byItem: q.byItem,
      priceStatus: q.priceStatus,
    }));

    recommendation = normalizeAndDeduplicateRecommendation(recommendation, {
      rfqId: rfq.name,
      authoritativeQuotes,
    });

    console.log("9. Post-normalization count:", recommendation.supplier_analysis.length);

    if (recommendation.supplier_analysis.length !== eligibleQuotes.length) {
      throw new Error(`AI evaluation unavailable / incomplete: one result per current quotation is required. (got ${recommendation.supplier_analysis.length}, expected ${eligibleQuotes.length})`);
    }

    for (const row of recommendation.supplier_analysis) {
      const quote = aiRequest.quotations.find((q) => q.quotation_id === row.quotation_id && q.supplier_id === row.supplier_id);
      if (!quote) throw new Error(`Quote not found for quotation_id=${row.quotation_id}, supplier_id=${row.supplier_id}`);
      if (row.evaluation_run_id !== evaluationRunId) throw new Error("AI evaluation identity mismatch: row=" + row.evaluation_run_id + " vs eval=" + evaluationRunId);
    }
    console.log("10. Validation checks passed!");

    const engineResult = scoringResultFromRecommendation(recommendation, scoringConfig);
    console.log("11. Scoring engine result:", JSON.stringify(engineResult, null, 2));

    const analysisRecord = {
      rfq_name: rfq.name,
      analysed_at: new Date().toISOString(),
      evaluation_run_id: evaluationRunId,
      recommended_supplier: recommendation.recommended_supplier,
      confidence_score: recommendation.confidence_score,
      analysis: recommendation,
      quotations_snapshot: eligibleQuotes.map((q) => ({ supplier: q.supplier_name, supplier_id: q.supplier, quotation_id: q.sqName, grand_total: q.total })),
    };

    console.log("12. Testing saveScoringResult...");
    const persisted = await saveScoringResult(rfq.name, engineResult, analysisRecord);
    console.log("13. Persisted result:", persisted.name);
  } catch (err) {
    console.error("FLOW ERROR:", err);
  } finally {
    globalThis.fetch = origFetch;
  }
}

run().catch(console.error);
