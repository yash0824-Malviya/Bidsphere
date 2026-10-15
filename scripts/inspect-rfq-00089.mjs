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

const base = (
  process.env.ERPNEXT_URL ||
  process.env.VITE_ERPNEXT_URL ||
  process.env.VITE_PROXY_TARGET ||
  ""
).replace(/\/+$/, "");
const key = process.env.ERP_API_KEY || process.env.VITE_API_KEY || "";
const secret = process.env.ERP_API_SECRET || process.env.VITE_API_SECRET || "";
const auth = `token ${key}:${secret}`;

async function api(path) {
  const url = `${base}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: auth, Accept: "application/json" },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text };
}

async function run() {
  const rfqId = "PUR-RFQ-2026-00089";
  console.log("=== RFQ DETAILS ===");
  const rfqRes = await api(`/api/resource/Request for Quotation/${rfqId}`);
  const rfq = rfqRes.json?.data || {};
  console.log("RFQ name:", rfq.name);
  console.log("RFQ suppliers (invited):", JSON.stringify(rfq.suppliers, null, 2));

  console.log("\n=== SUPPLIER QUOTATIONS ===");
  const sqRes = await api(
    `/api/resource/Supplier Quotation?filters=${encodeURIComponent(
      JSON.stringify([["items.request_for_quotation", "=", rfqId]])
    )}&fields=${encodeURIComponent(JSON.stringify(["*"]))}`
  );
  const sqList = sqRes.json?.data || [];
  console.log(`Found ${sqList.length} Supplier Quotations:`);
  for (const sq of sqList) {
    console.log({
      name: sq.name,
      supplier: sq.supplier,
      supplier_name: sq.supplier_name,
      grand_total: sq.grand_total,
      net_total: sq.net_total,
      status: sq.status,
      docstatus: sq.docstatus,
    });
  }

  console.log("\n=== SUPPLIER SCORING RESULTS ===");
  const ssrRes = await api(
    `/api/resource/Supplier Scoring Result?filters=${encodeURIComponent(
      JSON.stringify([["rfq", "=", rfqId]])
    )}&fields=${encodeURIComponent(JSON.stringify(["*"]))}&order_by=scored_at%20desc`
  );
  const ssrList = ssrRes.json?.data || [];
  console.log(`Found ${ssrList.length} Supplier Scoring Result records:`);
  for (const ssr of ssrList) {
    console.log({
      name: ssr.name,
      scored_at: ssr.scored_at,
      recommended_supplier: ssr.recommended_supplier,
      has_snapshot: !!ssr.analysis_snapshot,
    });
    if (ssr.analysis_snapshot) {
      try {
        const snap = JSON.parse(ssr.analysis_snapshot);
        console.log("Snapshot supplier_analysis:", JSON.stringify(snap.analysis?.supplier_analysis, null, 2));
        console.log("Snapshot quotations_snapshot:", JSON.stringify(snap.quotations_snapshot, null, 2));
      } catch (e) {
        console.log("Snapshot parse error:", e.message);
      }
    }
    const fullSsr = await api(`/api/resource/Supplier Scoring Result/${ssr.name}`);
    console.log("Full SSR supplier_scores:", JSON.stringify(fullSsr.json?.data?.supplier_scores, null, 2));
    break; // only print first (latest)
  }
}

run().catch(console.error);
