import fetch from "node-fetch";

const ERP_URL = process.env.VITE_ERP_BASE_URL || "http://80.225.204.210:8090";
const API_KEY = process.env.VITE_ERP_API_KEY || "";
const API_SECRET = process.env.VITE_ERP_API_SECRET || "";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

async function erpGet(endpoint) {
  const url = `${ERP_URL}${endpoint}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${API_KEY}:${API_SECRET}`,
    },
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    console.error("Non-JSON response:", res.status, text.slice(0, 200));
    return {};
  }
}

async function run() {
  console.log("=== FETCHING RFQ PUR-RFQ-2026-00089 ===");
  const rfqRes = await erpGet(`/api/resource/Request for Quotation/PUR-RFQ-2026-00089`);
  const rfq = rfqRes.data;
  console.log("RFQ suppliers:", rfq.suppliers.map(s => ({ supplier: s.supplier, supplier_name: s.supplier_name })));
  console.log("RFQ items:", rfq.items.map(i => ({ item_code: i.item_code, item_name: i.item_name, qty: i.qty, uom: i.uom })));

  console.log("\n=== FETCHING SUPPLIER QUOTATIONS FOR RFQ ===");
  const filter = JSON.stringify([["items.request_for_quotation", "=", "PUR-RFQ-2026-00089"]]);
  const fields = JSON.stringify(["name", "supplier", "supplier_name", "grand_total", "docstatus"]);
  const sqListRes = await erpGet(`/api/resource/Supplier Quotation?filters=${encodeURIComponent(filter)}&fields=${encodeURIComponent(fields)}&limit_page_length=100`);
  console.log("All Supplier Quotations in ERPNext:", sqListRes.data);

  for (const name of ["PUR-SQTN-2026-00249", "PUR-SQTN-2026-00251", "PUR-SQTN-2026-00252"]) {
    const qRes = await erpGet(`/api/resource/Supplier Quotation/${name}`);
    console.log(`\n=== FULL DOC FOR ${name} ===`);
    console.log(JSON.stringify(qRes.data, null, 2));
  }
}

run().catch(console.error);
