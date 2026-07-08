/**
 * Creates / updates the "Supplier RFQ Response" DocType on ERPNext.
 *
 * This DocType records an explicit supplier decision to DECLINE an RFQ
 * ("No Quote"). It is a supplier-writable record (analogous to Supplier
 * Quotation) so the decline is captured in ERPNext as the single source of
 * truth — the buyer, dashboards, and reports all read it back. RFQs are never
 * deleted and no RFQ is ever "ignored": a decline is a first-class response.
 *
 * Usage: node scripts/setup-supplier-rfq-response-doctype.mjs
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

const DOCTYPE = "Supplier RFQ Response";

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

// Keep this list in sync with DECLINE_REASONS in src/api/supplierRfqResponse.ts
const DECLINE_REASON_OPTIONS = [
  "Out of Capacity",
  "Product Not Manufactured",
  "Delivery Timeline Not Possible",
  "Commercial Reasons",
  "Pricing Not Competitive",
  "Material Not Available",
  "Technical Constraints",
  "Existing Production Commitments",
  "Not Interested",
  "Other",
].join("\n");

const FIELDS = [
  { fieldname: "rfq", label: "Request for Quotation", fieldtype: "Link", options: "Request for Quotation", reqd: 1, in_list_view: 1, in_standard_filter: 1 },
  { fieldname: "supplier", label: "Supplier", fieldtype: "Link", options: "Supplier", reqd: 1, in_list_view: 1, in_standard_filter: 1 },
  { fieldname: "supplier_name", label: "Supplier Name", fieldtype: "Data" },
  { fieldname: "rfq_supplier_row", label: "RFQ Supplier Row", fieldtype: "Data" },
  {
    fieldname: "response_status",
    label: "Supplier Response Status",
    fieldtype: "Select",
    options: "No Quote",
    default: "No Quote",
    reqd: 1,
    in_list_view: 1,
    in_standard_filter: 1,
  },
  {
    fieldname: "decline_reason",
    label: "Decline Reason",
    fieldtype: "Select",
    options: DECLINE_REASON_OPTIONS,
    reqd: 1,
    in_list_view: 1,
    in_standard_filter: 1,
  },
  { fieldname: "reason_details", label: "Reason Details", fieldtype: "Small Text" },
  { fieldname: "comment", label: "Additional Comments", fieldtype: "Small Text" },
  { fieldname: "response_date", label: "Response Date", fieldtype: "Datetime", in_list_view: 1 },
  { fieldname: "responded_by", label: "Responded By", fieldtype: "Data" },
];

function buildDocTypePayload() {
  return {
    doctype: "DocType",
    name: DOCTYPE,
    module: "Buying",
    custom: 1,
    naming_rule: "Expression (old style)",
    autoname: "format:SRR-{rfq}-{supplier}",
    track_changes: 1,
    fields: FIELDS,
    permissions: [
      { role: "System Manager", read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1 },
      { role: "Purchase Manager", read: 1, write: 1, create: 1, report: 1, export: 1 },
      { role: "Purchase User", read: 1, create: 1, report: 1 },
      { role: "Supplier", read: 1, create: 1 },
    ],
  };
}

async function ensureDocType() {
  console.log(`Checking "${DOCTYPE}" DocType on ${baseUrl}...`);
  let existing = null;
  try {
    existing = await api("GET", `/api/resource/DocType/${encodeURIComponent(DOCTYPE)}`);
  } catch {
    existing = null;
  }

  if (!existing) {
    console.log(`• Creating "${DOCTYPE}" DocType...`);
    await api("POST", "/api/resource/DocType", buildDocTypePayload());
    console.log(`✅ Created "${DOCTYPE}".`);
    return;
  }

  // Ensure every field exists and the reason options are current.
  const fields = existing.fields || [];
  let modified = false;
  for (const required of FIELDS) {
    const found = fields.find((f) => f.fieldname === required.fieldname);
    if (!found) {
      fields.push(required);
      modified = true;
      console.log(`• Adding field ${required.fieldname}...`);
    } else if (required.fieldname === "decline_reason" && found.options !== DECLINE_REASON_OPTIONS) {
      found.options = DECLINE_REASON_OPTIONS;
      modified = true;
      console.log("• Refreshing decline_reason options...");
    }
  }
  if (modified) {
    await api("PUT", `/api/resource/DocType/${encodeURIComponent(DOCTYPE)}`, { fields });
    console.log(`✅ Updated "${DOCTYPE}" fields.`);
  } else {
    console.log(`✅ "${DOCTYPE}" already up to date.`);
  }
}

async function main() {
  if (!baseUrl || !apiKey || !apiSecret) {
    console.error("Set ERPNEXT_URL, ERP_API_KEY, ERP_API_SECRET in .env");
    process.exit(1);
  }
  await ensureDocType();
  console.log(`\n✅ ${DOCTYPE} setup complete.`);
}

main().catch((err) => {
  console.error("❌ Setup failed:", err.message);
  process.exit(1);
});
