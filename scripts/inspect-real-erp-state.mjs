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
  const ldcRes = await api(
    `/api/resource/Legal Document Review?filters=${encodeURIComponent(
      JSON.stringify([["sq_name", "=", "PUR-SQTN-2026-00243"]]),
    )}&fields=${encodeURIComponent(JSON.stringify(["*"]))}`,
  );
  const ldc = ldcRes.json?.data?.[0] || {};

  const sqRes = await api(`/api/resource/Supplier Quotation/PUR-SQTN-2026-00243`);
  const sq = sqRes.json?.data || {};

  const rfqName = sq.request_for_quotation || ldc.rfq_name;
  let rfq = {};
  if (rfqName) {
    const rfqRes = await api(`/api/resource/Request for Quotation/${rfqName}`);
    rfq = rfqRes.json?.data || {};
  }

  const safeDiagnostic = {
    ldc_name: ldc.name,
    finance_status: ldc.finance_status ?? null,
    legal_status: ldc.review_status ?? null,
    workflow_state: ldc.workflow_state ?? null,
    status: sq.status ?? null,
    verification_status: {
      terms_viewed: ldc.terms_viewed,
      terms_approved: ldc.terms_approved,
      warranty_viewed: ldc.warranty_viewed,
      warranty_approved: ldc.warranty_approved,
      insurance_viewed: ldc.insurance_viewed,
      insurance_approved: ldc.insurance_approved,
    },
    signature_status: {
      esign_envelope_present: Boolean(ldc.esign_envelope),
      esign_envelope_length: (ldc.esign_envelope || "").length,
    },
    rfq_approval: {
      rfq_name: rfqName,
      custom_finance_status: rfq.custom_finance_status,
      custom_legal_status: rfq.custom_legal_status,
      custom_workflow_state: rfq.custom_workflow_state,
    },
    sq_approval: {
      custom_finance_status: sq.custom_finance_status,
      custom_legal_status: sq.custom_legal_status,
      custom_workflow_state: sq.custom_workflow_state,
    },
    document_attachments: {
      terms_file_url: ldc.terms_file_url,
      warranty_file_url: ldc.warranty_file_url,
      insurance_file_url: ldc.insurance_file_url,
      sq_terms: sq.custom_terms__condition,
      sq_warranty: sq.custom_warenty_certificate,
      sq_insurance: sq.custom_insurance_certificate,
    }
  };

  console.log("SAFE_DIAGNOSTIC_OBJECT:", JSON.stringify(safeDiagnostic, null, 2));

  if (ldc.esign_envelope) {
    try {
      const parsedEnvelope = JSON.parse(ldc.esign_envelope);
      console.log("PARSED_ESIGN_ENVELOPE:", JSON.stringify(parsedEnvelope, null, 2));
    } catch {
      console.log("RAW_ESIGN_ENVELOPE:", ldc.esign_envelope);
    }
  }
}

run().catch(console.error);
