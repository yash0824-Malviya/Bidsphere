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

const base = (process.env.ERPNEXT_URL || process.env.VITE_ERPNEXT_URL || process.env.VITE_PROXY_TARGET || "").replace(/\/+$/, "");
const auth = `token ${process.env.ERP_API_KEY || process.env.VITE_API_KEY}:${process.env.ERP_API_SECRET || process.env.VITE_API_SECRET}`;

async function erp(path) {
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: auth, Accept: "application/json" },
  });
  return res.json();
}

async function run() {
  const rfqId = "PUR-RFQ-2026-00109";
  const rfqRes = await erp(`/api/resource/Request for Quotation/${rfqId}`);
  const rfq = rfqRes.data;

  const sqRes = await erp(
    `/api/resource/Supplier Quotation?filters=${encodeURIComponent(
      JSON.stringify([["items.request_for_quotation", "=", rfqId]])
    )}&fields=${encodeURIComponent(JSON.stringify(["name", "supplier", "supplier_name", "grand_total", "docstatus", "status", "creation", "currency"]))}&order_by=creation%20asc`
  );

  const hydrated = [];
  const seen = new Set();
  for (const s of sqRes.data || []) {
    if (seen.has(s.name)) continue;
    seen.add(s.name);
    const detail = await erp(`/api/resource/Supplier Quotation/${s.name}`);
    hydrated.push(detail.data);
  }

  const grouped = new Map();
  for (const sq of hydrated) {
    const suppKey = (sq.supplier_name || sq.supplier || "").trim().toLowerCase();
    const list = grouped.get(suppKey) ?? [];
    list.push(sq);
    grouped.set(suppKey, list);
  }

  const eligibleQuotes = [];
  for (const [suppKey, list] of grouped) {
    list.sort((a, b) => (b.docstatus ?? 0) - (a.docstatus ?? 0) || (b.grand_total ?? 0) - (a.grand_total ?? 0));
    const sq = list[0];
    if (sq.docstatus === 1) {
      eligibleQuotes.push(sq);
    }
  }

  const evaluationRunId = "run-" + Date.now();
  const quotations = eligibleQuotes.map(q => {
    return {
      quotation_id: q.name,
      supplier_id: q.supplier,
      supplier_name: q.supplier_name,
      total_value: q.grand_total,
      items: (q.items || []).map(it => ({
        item: it.item_name || it.item_code,
        requested_qty: it.qty,
        unit_price: it.rate,
        total: it.amount,
        delivery_days: it.lead_time_days || 0,
        notes: ""
      })),
      price_status: "submitted",
      documents: {
        warranty_certificate: !!q.custom_warenty_certificate,
        terms_conditions: !!q.custom_terms__condition,
        insurance_certificate: !!q.custom_insurance_certificate
      }
    };
  });

  const evaluation_context = {
    rfq_id: rfqId,
    evaluation_run_id: evaluationRunId,
    weights: {
      price_weight: 35,
      delivery_weight: 25,
      quality_weight: 20,
      reliability_weight: 20
    },
    quotations: quotations.map(q => ({
      quotation_id: q.quotation_id,
      supplier_id: q.supplier_id,
      supplier_name: q.supplier_name,
      total_value: q.total_value
    }))
  };

  // Build the REAL prompt
  const itemsBlock = (rfq.items || [])
    .map(i => `- ${i.item_name || i.item_code}: ${i.qty} ${i.uom || ""}`.trim())
    .join("\n");

  const quotesBlock = quotations
    .map((q, idx) => {
      const lines = q.items
        .map(i => `  - ${i.item}: $${i.unit_price}/unit × ${i.requested_qty} = $${i.total} | Delivery: ${i.delivery_days ? i.delivery_days + " days" : "Unavailable"}`)
        .join("\n");
      return `
SUPPLIER ${idx + 1}: ${q.supplier_name}
Quotation ID (JSON string; preserve escaped characters): ${JSON.stringify(q.quotation_id ?? "")}
Supplier ID (JSON string; preserve escaped characters): ${JSON.stringify(q.supplier_id ?? "")}
Grand Total: $${q.total_value}
Items:
${lines}
Payment Terms: Net 30
Compliance & Certificates: Warranty certificate attached; verification status unavailable, Terms and conditions attached; verification status unavailable, Insurance certificate attached; verification status unavailable
Additional Notes: Unavailable
Historical performance: Unavailable
Technical compliance: unavailable unless explicitly described in this quotation's item notes.`;
    })
    .join("\n---");

  const supplierNames = quotations.map(q => q.supplier_name).join(", ");

  const prompt = `You are an expert procurement analyst for Netlink, a manufacturing company.
Analyze these ${quotations.length} supplier quotations for RFQ: ${rfqId}
RFQ ID: ${JSON.stringify(rfqId)}
Evaluation run ID: ${JSON.stringify(evaluationRunId)}

ITEMS REQUESTED:
${itemsBlock}

SUPPLIER QUOTATIONS:
${quotesBlock}

ANALYSIS WEIGHTS (use these to compute the score for each supplier):
- Price/Cost: 35%
- Delivery speed: 25%
- Quality (item coverage, specs): 20%
- Reliability (documentation, terms): 20%

Score formula: Final = (PriceScore×35 + DeliveryScore×25 + QualityScore×20 + ReliabilityScore×20) / 100

Rank every supplier: ${supplierNames}

CRITICAL OUTPUT RULES — YOU MUST FOLLOW EXACTLY:
1. Return ONLY valid JSON.
2. Do NOT use markdown.
3. Do NOT wrap the response in triple backticks.
4. Do NOT add any text, explanation, or commentary before or after the JSON.
5. The first character of your response must be { and the last must be }.

Return exactly this JSON structure (fill with real analysis data from the quotations above):
{
  "rfq_id": ${JSON.stringify(rfqId)},
  "evaluation_run_id": ${JSON.stringify(evaluationRunId)},
  "ranking": [
    {
      "evaluation_run_id": ${JSON.stringify(evaluationRunId)},
      "quotation_id": "exact quotation_id from quotation",
      "supplier_id": "exact supplier_id from quotation",
      "supplier": "exact supplier name from quotations",
      "rank": 1,
      "score": 85,
      "price_score": 92,
      "delivery_score": 78,
      "quality_score": 85,
      "reliability_score": 80,
      "risk": "Low",
      "verdict": "BEST VALUE",
      "reason": "Specific explanation referencing actual price difference, delivery days, item coverage, and terms"
    }
  ],
  "recommendedSupplier": "exact supplier name of rank 1 winner",
  "summary": "2-3 sentence executive summary referencing specific cost differences, delivery timelines, and completeness"
}

SCORING RULES — FOLLOW STRICTLY:
- Evaluate EACH supplier independently. Never copy the score, risk, verdict, or reasoning from another supplier.
- "score": overall weighted number 0-100 calculated using the formula above.
- "price_score": 0-100 based ONLY on the actual quoted grand total. Lowest price = highest score. If all suppliers quoted the exact same price, price_score must be equal for all.
- If a grand total is "Price Not Provided", set price_score to -1 (insufficient data). Never treat it as $0.00 or as the cheapest quote.
- "delivery_score": when quoted days and valid delivery history are unavailable, retain the existing neutral scoring rule (70-75).
- "quality_score": 100 if equal item coverage.
- "reliability_score": 80 for complete documents.
- "risk": exactly "Low", "Medium", or "High".
- "verdict": exactly one of "BEST VALUE", "GOOD OPTION", "EXPENSIVE", "AVOID", "HIGH RISK / REVIEW", "QUOTE INCOMPLETE".
- "ranking": include ONLY the ${quotations.length} suppliers listed above.
- Return exactly one result per quotation_id. Preserve its exact supplier_id and the current evaluation_run_id. IDs above are JSON strings: literal quotation marks inside an ID must be escaped, never removed.
- Use supplier names, quotation_id, and supplier_id EXACTLY as shown in SUPPLIER QUOTATIONS.`;

  // First test direct call WITHOUT evaluation_context to see raw Claude text
  console.log("=== Testing raw Claude response ===");
  const rawRes = await fetch("http://localhost:5175/api/ai/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      max_tokens: 2048,
      rfq_id: rfqId,
      request_type: "recommendation"
    })
  });
  console.log("Raw Claude status:", rawRes.status);
  const rawBody = await rawRes.json();
  console.log("Raw Claude text returned:", rawBody.text);

  // Now test WITH evaluation_context
  console.log("\n=== Testing WITH evaluation_context ===");
  const withContextRes = await fetch("http://localhost:5175/api/ai/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      max_tokens: 2048,
      rfq_id: rfqId,
      evaluation_context,
      request_type: "recommendation"
    })
  });
  console.log("With context status:", withContextRes.status);
  const withContextBody = await withContextRes.text();
  console.log("With context body:", withContextBody);
}

run().catch(console.error);
