import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  for (const f of [".env", ".env.local"]) {
    const envPath = resolve(process.cwd(), f);
    if (!existsSync(envPath)) continue;
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
  console.log("=== Checking Purchase Orders in ERPNext ===");
  const pos = await api('/api/resource/Purchase Order?fields=["*"]&limit_page_length=50');
  console.log("Total POs in system:", pos.json?.data?.length);
  if (pos.json?.data) {
    for (const p of pos.json.data) {
      console.log("PO:", {
        name: p.name,
        supplier: p.supplier,
        docstatus: p.docstatus,
        status: p.status,
        custom_rfq: p.custom_rfq,
        custom_contract: p.custom_contract,
        transaction_date: p.transaction_date,
      });
    }
  }

  console.log("\n=== Checking Contract CON-2026-00005 ===");
  const con = await api("/api/resource/Contract/CON-2026-00005");
  if (con.json?.data) {
    const d = con.json.data;
    const clmData = JSON.parse(d.custom_clm_data || "{}");
    console.log("Contract fields:", {
      name: d.name,
      status: d.status,
      custom_contract_status: d.custom_contract_status,
      custom_approval_status: d.custom_approval_status,
      custom_esign_status: d.custom_esign_status,
      custom_purchase_order: d.custom_purchase_order,
      custom_rfq: d.custom_rfq,
      custom_supplier: d.custom_supplier,
      modified: d.modified,
    });
    console.log("Contract rfq_workflow:", clmData.rfq_workflow);
    console.log("Contract procurement_completion:", clmData.procurement_completion);
    console.log("Contract audit log:");
    for (const a of clmData.audit || []) {
      console.log(" - Action:", a.action, "by:", a.by, "at:", a.at, "comment:", a.comment);
    }
  }
}

run().catch(console.error);
