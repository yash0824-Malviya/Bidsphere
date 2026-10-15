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

const apiKey = process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY;
const model = "claude-haiku-4-5-20251001";

const quotations = [
  {
    supplier_name: "Atlantic Precision Manufacturing.",
    total_value: 2500,
    items: [{ item: "APSU005", requested_qty: 100, unit_price: 25, total: 2500, delivery_days: 7, notes: "" }],
    payment_terms: "Net 30",
    notes: ""
  },
  {
    supplier_name: "Apex Fasteners Ltd",
    total_value: 2500,
    items: [{ item: "APSU005", requested_qty: 100, unit_price: 25, total: 2500, delivery_days: 5, notes: "" }],
    payment_terms: "Net 30",
    notes: ""
  },
  {
    supplier_name: "Eagle Peak Technologies Inc.",
    total_value: 2500,
    items: [{ item: "APSU005", requested_qty: 100, unit_price: 25, total: 2500, delivery_days: 10, notes: "" }],
    payment_terms: "Net 45",
    notes: ""
  }
];

const quotesBlock = quotations.map((q, idx) => `
SUPPLIER ${idx + 1}: ${q.supplier_name}
Grand Total: $2,500.00
Items:
  - APSU005: $25.00/unit × 100 = $2,500.00 | Delivery: ${q.items[0].delivery_days} days
Payment Terms: ${q.payment_terms}
Additional Notes:`).join("\n---");

const prompt = `You are an expert procurement analyst for Netlink, a manufacturing company.
Analyze these 3 supplier quotations for RFQ: PUR-RFQ-2026-00089

ITEMS REQUESTED:
- APSU005: 100 Nos

SUPPLIER QUOTATIONS:
${quotesBlock}

ANALYSIS WEIGHTS (use these to compute the score for each supplier):
- Price/Cost: 40%
- Delivery speed: 25%
- Quality (item coverage, specs): 20%
- Reliability (documentation, terms): 15%

Score formula: Final = (PriceScore×40 + DeliveryScore×25 + QualityScore×20 + ReliabilityScore×15) / 100

Rank every supplier: Atlantic Precision Manufacturing., Apex Fasteners Ltd, Eagle Peak Technologies Inc.

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
      "supplier": "exact supplier name from quotations",
      "rank": 1,
      "score": 85,
      "price_score": 92,
      "delivery_score": 78,
      "reliability_score": 80,
      "risk": "Low",
      "reason": "Specific explanation referencing actual price difference, delivery days, item coverage, and terms"
    }
  ],
  "recommendedSupplier": "exact supplier name of rank 1 winner",
  "summary": "2-3 sentence executive summary referencing specific cost differences, delivery timelines, and completeness"
}`;

async function run() {
  const start = Date.now();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const duration = Date.now() - start;
  const json = await res.json();
  console.log("Status:", res.status, "Latency:", duration, "ms");
  let text = json.content?.[0]?.text || "";
  text = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  const cleaned = text.slice(first, last + 1);
  const parsed = JSON.parse(cleaned);
  console.log("Parsed suppliers count:", parsed.ranking?.length);
  console.log("Rankings:", parsed.ranking?.map(r => ({ rank: r.rank, supplier: r.supplier, score: r.score })));
  console.log("Recommended:", parsed.recommendedSupplier);
}

run().catch(console.error);
