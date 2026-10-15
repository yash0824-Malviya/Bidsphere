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

  // Hydrate all SQs
  const hydrated = [];
  const seen = new Set();
  for (const s of sqRes.data || []) {
    if (seen.has(s.name)) continue;
    seen.add(s.name);
    const detail = await erp(`/api/resource/Supplier Quotation/${s.name}`);
    hydrated.push(detail.data);
  }

  console.log("Hydrated unique SQs:", hydrated.length);

  // Group by supplier
  const grouped = new Map();
  for (const sq of hydrated) {
    const suppKey = (sq.supplier_name || sq.supplier || "").trim().toLowerCase();
    const list = grouped.get(suppKey) ?? [];
    list.push(sq);
    grouped.set(suppKey, list);
  }

  const eligibleQuotes = [];
  for (const [suppKey, list] of grouped) {
    // Sort docstatus desc, amount desc
    list.sort((a, b) => (b.docstatus ?? 0) - (a.docstatus ?? 0) || (b.grand_total ?? 0) - (a.grand_total ?? 0));
    const sq = list[0];
    if (sq.docstatus === 1) {
      eligibleQuotes.push(sq);
    }
  }

  console.log("Eligible submitted SQs:", eligibleQuotes.map(q => ({ name: q.name, supplier: q.supplier, supplier_name: q.supplier_name, total: q.grand_total })));

  const evaluationRunId = "test-run-" + Date.now();
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

  console.log("Evaluation context to send:", JSON.stringify(evaluation_context, null, 2));

  // Build a prompt
  const prompt = `Analyze quotations for ${rfqId} ... return valid JSON with ranking, recommendedSupplier, summary`;

  // Test calling /api/ai/claude
  const res = await fetch("http://localhost:5175/api/ai/claude", {
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

  console.log("Claude endpoint status:", res.status, res.statusText);
  const respBody = await res.text();
  console.log("Claude response body:", respBody);
}

run().catch(console.error);
