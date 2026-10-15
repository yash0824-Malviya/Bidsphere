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

async function api(path) {
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: auth, Accept: "application/json" },
  });
  return res.json();
}

async function run() {
  const rfqId = "PUR-RFQ-2026-00109";
  const rfqRes = await api(`/api/resource/Request for Quotation/${rfqId}`);
  console.log("RFQ Status:", rfqRes.data?.status, "Docstatus:", rfqRes.data?.docstatus);
  console.log("RFQ Suppliers:", rfqRes.data?.suppliers?.map(s => ({ supplier: s.supplier, name: s.supplier_name, quote_status: s.quote_status })));
  console.log("RFQ Items:", rfqRes.data?.items?.map(i => ({ item_code: i.item_code, item_name: i.item_name, qty: i.qty, uom: i.uom })));

  const sqRes = await api(
    `/api/resource/Supplier Quotation?filters=${encodeURIComponent(
      JSON.stringify([["items.request_for_quotation", "=", rfqId]])
    )}&fields=${encodeURIComponent(JSON.stringify(["name", "supplier", "supplier_name", "grand_total", "docstatus", "status", "creation", "currency"]))}&order_by=creation%20asc`
  );
  console.log("\nAll SQs found:", sqRes.data?.length);
  for (const sq of sqRes.data || []) {
    const detail = await api(`/api/resource/Supplier Quotation/${sq.name}`);
    const d = detail.data;
    console.log(`\n--- SQ: ${d.name} (${d.supplier_name}) Status: ${d.status} (docstatus=${d.docstatus}) Grand Total: ${d.grand_total} ${d.currency}`);
    console.log("Items:", d.items?.map(it => ({
      item_code: it.item_code,
      item_name: it.item_name,
      qty: it.qty,
      rate: it.rate,
      amount: it.amount,
      lead_time_days: it.lead_time_days,
      rfq: it.request_for_quotation,
      rfq_item: it.request_for_quotation_item
    })));
    console.log("Docs:", {
      warenty: d.custom_warenty_certificate,
      terms: d.custom_terms__condition,
      insurance: d.custom_insurance_certificate
    });
  }
}

run().catch(console.error);
