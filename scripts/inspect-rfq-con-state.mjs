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
  console.log("=== Inspecting RFQ PUR-RFQ-2026-00117 ===");
  const rfqRes = await api(`/api/resource/Request for Quotation/PUR-RFQ-2026-00117`);
  console.log("RFQ Status:", rfqRes.status);
  if (rfqRes.json?.data) {
    const d = rfqRes.json.data;
    console.log("RFQ data:", {
      name: d.name,
      status: d.status,
      docstatus: d.docstatus,
      custom_contract_required: d.custom_contract_required,
      custom_contract: d.custom_contract,
      custom_contract_request: d.custom_contract_request,
      custom_legal_review: d.custom_legal_review,
    });
  }

  console.log("\n=== Inspecting Contract CON-2026-00005 ===");
  const conRes = await api(`/api/resource/Contract/CON-2026-00005`);
  console.log("Contract Status:", conRes.status);
  if (conRes.json?.data) {
    const c = conRes.json.data;
    let clmData = null;
    try { clmData = JSON.parse(c.custom_clm_data); } catch {}
    console.log("Contract fields:", {
      name: c.name,
      status: c.status,
      custom_contract_status: c.custom_contract_status,
      custom_rfq: c.custom_rfq,
      custom_supplier: c.custom_supplier,
      party_name: c.party_name,
      custom_purchase_order: c.custom_purchase_order,
      custom_esign_status: c.custom_esign_status,
      custom_approval_status: c.custom_approval_status,
      rfq_workflow: clmData?.rfq_workflow,
      approvals: clmData?.approvals,
      signatures: clmData?.signatures?.map(s => ({ party: s.party, role: s.role, at: s.at })),
      procurement_completion: clmData?.procurement_completion,
    });
  }

  console.log("\n=== Inspecting Legal Document Reviews for RFQ PUR-RFQ-2026-00117 ===");
  const ldcRes = await api(`/api/resource/Legal Document Review?filters=${encodeURIComponent(JSON.stringify([["rfq_name", "=", "PUR-RFQ-2026-00117"]]))}&fields=${encodeURIComponent(JSON.stringify(["*"]))}`);
  console.log("LDC count:", ldcRes.json?.data?.length);
  if (ldcRes.json?.data?.length) {
    for (const l of ldcRes.json.data) {
      console.log("LDC:", {
        name: l.name,
        review_status: l.review_status,
        workflow_state: l.workflow_state,
        finance_status: l.finance_status,
        approved_by: l.approved_by,
        approved_on: l.approved_on,
        finance_approved_by: l.finance_approved_by,
        finance_approved_on: l.finance_approved_on,
        contract: l.contract || l.custom_contract,
        po_name: l.po_name,
      });
    }
  }

  console.log("\n=== Inspecting Contract Requests for RFQ PUR-RFQ-2026-00117 ===");
  const crRes = await api(`/api/resource/Contract Request?filters=${encodeURIComponent(JSON.stringify([["custom_rfq", "=", "PUR-RFQ-2026-00117"]]))}&fields=${encodeURIComponent(JSON.stringify(["*"]))}`);
  console.log("Contract Request count:", crRes.json?.data?.length);
  if (crRes.json?.data?.length) {
    for (const cr of crRes.json.data) {
      console.log("Contract Request:", {
        name: cr.name,
        request_status: cr.request_status,
        docstatus: cr.docstatus,
        custom_contract: cr.custom_contract,
      });
    }
  }
}

run().catch(console.error);
