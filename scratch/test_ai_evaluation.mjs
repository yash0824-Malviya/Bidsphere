import fetch from "node-fetch";

const ERP_URL = process.env.VITE_ERP_BASE_URL || "http://80.225.204.210:8090";
const API_KEY = process.env.VITE_ERP_API_KEY || "";
const API_SECRET = process.env.VITE_ERP_API_SECRET || "";
const PROXY_URL = "http://localhost:5175/api/ai/claude";

async function erpGet(endpoint) {
  const url = `${ERP_URL}${endpoint}`;
  const res = await fetch(url, {
    headers: { Authorization: `token ${API_KEY}:${API_SECRET}` },
  });
  return res.json();
}

async function run() {
  console.log("==================================================");
  console.log("STEP 1: FETCHING LIVE ERPNEXT DATA FOR RFQ");
  console.log("==================================================");

  const filter = JSON.stringify([["items.request_for_quotation", "=", "PUR-RFQ-2026-00089"]]);
  const fields = JSON.stringify(["name", "supplier", "supplier_name", "grand_total", "docstatus"]);
  const sqListRes = await erpGet(`/api/resource/Supplier Quotation?filters=${encodeURIComponent(filter)}&fields=${encodeURIComponent(fields)}&limit_page_length=100`);

  const submittedQuotes = sqListRes.data.filter(q => q.docstatus === 1);
  console.log(`Found ${submittedQuotes.length} submitted quotations in ERPNext.`);

  const hydratedQuotes = [];
  for (const sq of submittedQuotes) {
    const full = await erpGet(`/api/resource/Supplier Quotation/${sq.name}`);
    const d = full.data;
    hydratedQuotes.push({
      quotation_id: d.name,
      supplier_id: d.supplier,
      supplier_name: d.supplier_name,
      grand_total: d.grand_total,
      payment_terms: d.payment_terms_template || d.terms || undefined,
      notes: d.notes || "",
      documents: {
        warranty_certificate: Boolean(d.custom_warenty_certificate),
        terms_conditions: Boolean(d.custom_terms__condition || d.terms),
        insurance_certificate: Boolean(d.custom_insurance_certificate),
      },
      items: d.items.map(it => ({
        item: it.item_name || it.item_code,
        requested_qty: it.qty,
        unit_price: it.rate,
        total: it.amount,
        delivery_days: it.lead_time_days > 0 ? it.lead_time_days : undefined,
      })),
    });
  }

  console.log("\n==================================================");
  console.log("STEP 2: NORMALIZED AI INPUT PAYLOAD");
  console.log("==================================================");
  console.log(JSON.stringify(hydratedQuotes, null, 2));

  // Build the prompt exactly as in src/api/ai.ts
  const itemsBlock = "- Stabilizer Bar: 100 Nos";
  const quotesBlock = hydratedQuotes.map((q, idx) => {
    const lines = q.items.map(i => {
      const deliveryVal = i.delivery_days ? `${i.delivery_days} days` : "Not specified (standard 7-14 days lead time expected)";
      return `  - ${i.item}: $${i.unit_price.toFixed(2)}/unit × ${i.requested_qty} = $${i.total.toFixed(2)} | Delivery: ${deliveryVal}`;
    }).join("\n");

    const docList = [];
    if (q.documents.warranty_certificate) docList.push("Warranty Certificate attached (Verified)");
    if (q.documents.terms_conditions) docList.push("Terms & Conditions attached (Verified)");
    if (q.documents.insurance_certificate) docList.push("Insurance Certificate attached (Verified)");
    const complianceText = docList.length > 0 ? docList.join(", ") : "Standard documentation";

    return `
SUPPLIER ${idx + 1}: ${q.supplier_name}
Quotation ID: ${q.quotation_id}
Supplier ID: ${q.supplier_id}
Grand Total: $${q.grand_total.toFixed(2)}
Items:
${lines}
Payment Terms: ${q.payment_terms ?? "Not specified"}
Compliance & Certificates: ${complianceText}
Additional Notes: ${q.notes || "None"}`;
  }).join("\n---");

  const prompt = `You are an expert procurement analyst for Netlink, a manufacturing company.
Analyze these ${hydratedQuotes.length} supplier quotations for RFQ: PUR-RFQ-2026-00089

ITEMS REQUESTED:
${itemsBlock}

SUPPLIER QUOTATIONS:
${quotesBlock}

ANALYSIS WEIGHTS (use these to compute the score for each supplier):
- Price/Cost: 40%
- Delivery speed: 25%
- Quality (item coverage, specs): 20%
- Reliability (documentation, terms): 15%

Score formula: Final = (PriceScore×40 + DeliveryScore×25 + QualityScore×20 + ReliabilityScore×15) / 100

Rank every supplier: ${hydratedQuotes.map(q => q.supplier_name).join(", ")}

CRITICAL OUTPUT RULES — YOU MUST FOLLOW EXACTLY:
1. Return ONLY valid JSON.
2. Do NOT use markdown.
3. Do NOT wrap the response in triple backticks.
4. Do NOT add any text, explanation, or commentary before or after the JSON.
5. The first character of your response must be { and the last must be }.

Return exactly this JSON structure (fill with real analysis data from the quotations above):
{
  "ranking": [
    {
      "quotation_id": "exact quotation_id from quotation",
      "supplier_id": "exact supplier_id from quotation",
      "supplier": "exact supplier name from quotations",
      "rank": 1,
      "score": 85,
      "price_score": 92,
      "delivery_score": 78,
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
- "delivery_score": 0-100 based on actual quoted delivery days. Fastest delivery = highest score. If delivery is 'Not specified', assign a neutral score (70-75) and do NOT claim or assume 0-day delivery.
- "reliability_score": 0-100 based on quotation completeness, attached compliance certificates (warranty, insurance, terms), payment terms, and notes.
- "risk": exactly "Low", "Medium", or "High".
- "verdict": exactly one of "BEST VALUE", "GOOD OPTION", "EXPENSIVE", "AVOID", "QUOTE INCOMPLETE".
- A supplier must NEVER be labeled "AVOID" simply for being lowest-ranked. Only assign "AVOID" if there is severe risk, non-compliance, missing quote, or unacceptable terms.
- If multiple suppliers have identical pricing, overall scores MUST differentiate based on delivery speed, warranty, documentation, payment terms, and risk factors.
- "reason": MUST reference specific data points (e.g. price difference, delivery days, verified certificates, payment terms).
- The summary MUST distinguish suppliers with submitted pricing from suppliers with missing pricing. Never describe missing pricing as "$0.00 pricing".
- "ranking": include ONLY the ${hydratedQuotes.length} suppliers listed above, sorted best to worst (rank 1 = best).
- Do NOT invent, add, or reference any supplier not in the SUPPLIER QUOTATIONS section.
- "recommendedSupplier": must match the rank 1 supplier name exactly.
- Use supplier names, quotation_id, and supplier_id EXACTLY as shown in SUPPLIER QUOTATIONS.`;

  console.log("\n==================================================");
  console.log("STEP 3: CALLING CLAUDE VIA LOCAL BACKEND PROXY");
  console.log("==================================================");

  const proxyRes = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      rfq_id: "PUR-RFQ-2026-00089",
      request_type: "recommendation",
    }),
  });

  const proxyJson = await proxyRes.json();
  console.log("Proxy response success:", proxyJson.success, "Model:", proxyJson.model);

  console.log("\n==================================================");
  console.log("STEP 4: RAW CLAUDE OUTPUT");
  console.log("==================================================");
  console.log(proxyJson.text);

  let cleanText = proxyJson.text.trim();
  if (cleanText.startsWith("```json")) {
    cleanText = cleanText.slice(7);
  } else if (cleanText.startsWith("```")) {
    cleanText = cleanText.slice(3);
  }
  if (cleanText.endsWith("```")) {
    cleanText = cleanText.slice(0, -3);
  }
  const parsed = JSON.parse(cleanText.trim());

  console.log("\n==================================================");
  console.log("STEP 5: PARSED CLAUDE RESULTS");
  console.log("==================================================");
  console.log("Recommended Supplier:", parsed.recommendedSupplier);
  console.log("Summary:", parsed.summary);
  console.log("\nRanking rows:");
  for (const r of parsed.ranking) {
    console.log(`Rank ${r.rank}: ${r.supplier} (${r.quotation_id})`);
    console.log(`  Score: ${r.score} | Price: ${r.price_score} | Delivery: ${r.delivery_score} | Reliability: ${r.reliability_score}`);
    console.log(`  Risk: ${r.risk} | Verdict: ${r.verdict}`);
    console.log(`  Reason: ${r.reason}\n`);
  }
}

run().catch(console.error);
