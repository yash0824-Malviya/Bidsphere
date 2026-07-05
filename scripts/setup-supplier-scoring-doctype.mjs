/**
 * Creates the "Supplier Scoring Result" DocType (+ "Supplier Score Row" child
 * table) on ERPNext, if missing.
 *
 * Background: `src/api/supplierScoringResults.ts` has been calling
 * `saveScoringResult()` after every AI/engine analysis run, but the DocType
 * was never actually provisioned in ERPNext — every write silently failed
 * (caught + `console.warn`'d in RFQDetailPage.tsx). As a result, AI analysis
 * results were ONLY ever available from the browser's localStorage cache,
 * so a Legal/Finance reviewer opening the same RFQ from a different browser
 * or device saw no analysis at all (a Single-Source-of-Truth / cross-device
 * violation flagged during the platform-wide stabilization audit).
 *
 * This script provisions the DocType so `saveScoringResult` / the new
 * `analysis_snapshot` field can persist the FULL AI recommendation payload
 * (not just the deterministic engine scores), letting Procurement, Legal and
 * Finance all see the identical analysis regardless of which browser/device
 * generated it.
 *
 * Usage: node scripts/setup-supplier-scoring-doctype.mjs
 * Requires .env: ERPNEXT_URL (or VITE_ERPNEXT_URL), ERP_API_KEY, ERP_API_SECRET
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadEnvFile() {
  const envPath = resolve(root, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile();

const baseUrl = (
  process.env.ERPNEXT_URL ??
  process.env.VITE_ERPNEXT_URL ??
  process.env.VITE_PROXY_TARGET ??
  ""
).replace(/\/+$/, "");
const apiKey = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
const apiSecret = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";

async function api(method, path, body) {
  const url = `${baseUrl}${path}`;
  const headers = {
    Authorization: `token ${apiKey}:${apiSecret}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      json.exception || json._server_messages || JSON.stringify(json) || res.statusText
    );
  }
  return json.data;
}

const PURCHASE_MANAGER = "Purchase Manager";
const PURCHASE_USER = "Purchase User";

async function ensureChildDocType() {
  try {
    await api("GET", `/api/resource/DocType/${encodeURIComponent("Supplier Score Row")}`);
    console.log("✓ DocType exists: Supplier Score Row");
  } catch {
    console.log("• Creating DocType: Supplier Score Row (child table)");
    await api("POST", "/api/resource/DocType", {
      doctype: "DocType",
      name: "Supplier Score Row",
      module: "Buying",
      custom: 1,
      istable: 1,
      fields: [
        { fieldname: "supplier", label: "Supplier", fieldtype: "Data", in_list_view: 1 },
        { fieldname: "supplier_name", label: "Supplier Name", fieldtype: "Data", in_list_view: 1 },
        { fieldname: "price_score", label: "Price Score", fieldtype: "Float", in_list_view: 1 },
        { fieldname: "delivery_score", label: "Delivery Score", fieldtype: "Float", in_list_view: 1 },
        { fieldname: "quality_score", label: "Quality Score", fieldtype: "Float", in_list_view: 1 },
        { fieldname: "reliability_score", label: "Reliability Score", fieldtype: "Float", in_list_view: 1 },
        { fieldname: "final_score", label: "Final Score", fieldtype: "Float", in_list_view: 1 },
        { fieldname: "ranking", label: "Ranking", fieldtype: "Int", in_list_view: 1 },
        { fieldname: "recommendation_reason", label: "Recommendation Reason", fieldtype: "Small Text" },
      ],
    });
    console.log("✓ DocType created: Supplier Score Row");
  }
}

async function ensureParentDocType() {
  try {
    const doc = await api(
      "GET",
      `/api/resource/DocType/${encodeURIComponent("Supplier Scoring Result")}`
    );
    console.log("✓ DocType exists: Supplier Scoring Result");
    const fields = doc.fields || [];
    if (!fields.some((f) => f.fieldname === "analysis_snapshot")) {
      fields.push({
        fieldname: "analysis_snapshot",
        label: "Analysis Snapshot (JSON)",
        fieldtype: "Long Text",
        insert_after: "supplier_scores",
      });
      await api(
        "PUT",
        `/api/resource/DocType/${encodeURIComponent("Supplier Scoring Result")}`,
        { fields }
      );
      console.log("• Added field analysis_snapshot to Supplier Scoring Result");
    }
    if (!fields.some((f) => f.fieldname === "recommended_supplier")) {
      fields.push({
        fieldname: "recommended_supplier",
        label: "Recommended Supplier",
        fieldtype: "Data",
        insert_after: "analysis_snapshot",
      });
      await api(
        "PUT",
        `/api/resource/DocType/${encodeURIComponent("Supplier Scoring Result")}`,
        { fields }
      );
      console.log("• Added field recommended_supplier to Supplier Scoring Result");
    }
    return;
  } catch {
    // Not found — create from scratch below.
  }

  console.log("• Creating DocType: Supplier Scoring Result");
  await api("POST", "/api/resource/DocType", {
    doctype: "DocType",
    name: "Supplier Scoring Result",
    module: "Buying",
    custom: 1,
    is_submittable: 0,
    autoname: "format:SCORE-{rfq}-{#####}",
    fields: [
      { fieldname: "rfq", label: "RFQ", fieldtype: "Data", reqd: 1, in_list_view: 1 },
      { fieldname: "scored_at", label: "Scored At", fieldtype: "Datetime", in_list_view: 1 },
      { fieldname: "price_weight", label: "Price Weight", fieldtype: "Float" },
      { fieldname: "delivery_weight", label: "Delivery Weight", fieldtype: "Float" },
      { fieldname: "quality_weight", label: "Quality Weight", fieldtype: "Float" },
      { fieldname: "reliability_weight", label: "Reliability Weight", fieldtype: "Float" },
      { fieldname: "recommended_supplier", label: "Recommended Supplier", fieldtype: "Data" },
      {
        fieldname: "supplier_scores",
        label: "Supplier Scores",
        fieldtype: "Table",
        options: "Supplier Score Row",
      },
      {
        fieldname: "analysis_snapshot",
        label: "Analysis Snapshot (JSON)",
        fieldtype: "Long Text",
      },
    ],
    permissions: [
      { role: PURCHASE_MANAGER, read: 1, write: 1, create: 1 },
      { role: PURCHASE_USER, read: 1, write: 1, create: 1 },
    ],
  });
  console.log("✓ DocType created: Supplier Scoring Result");
}

async function main() {
  console.log(`Provisioning Supplier Scoring Result on ${baseUrl}...`);
  await ensureChildDocType();
  await ensureParentDocType();
  console.log("✅ Done.");
}

main().catch((err) => {
  console.error("❌ Failed:", err.message);
  process.exit(1);
});
