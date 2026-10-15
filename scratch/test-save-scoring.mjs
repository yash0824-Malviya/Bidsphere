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

async function testSave() {
  const payload = {
    doctype: "Supplier Scoring Result",
    rfq: "PUR-RFQ-2026-00109",
    scored_at: "2026-10-12 12:00:00",
    price_weight: 40,
    delivery_weight: 25,
    quality_weight: 20,
    reliability_weight: 15,
    recommended_supplier: '"Blue Ridge Manufacturing Inc"',
    analysis_snapshot: "{}",
    supplier_scores: [
      {
        doctype: "Supplier Score Row",
        supplier: '"Blue Ridge Manufacturing Inc"',
        supplier_name: "Blue Ridge Manufacturing Inc",
        quotation_id: "PUR-SQTN-2026-00294",
        price_score: 100,
        delivery_score: 72,
        quality_score: 100,
        reliability_score: 80,
        final_score: 89,
        ranking: 1,
        recommendation_reason: "Test reason"
      }
    ]
  };
  const res = await fetch(base + "/api/resource/Supplier Scoring Result", {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload)
  });
  console.log("Status:", res.status, res.statusText);
  const data = await res.json();
  console.log("Response:", JSON.stringify(data, null, 2));
}

testSave().catch(console.error);
