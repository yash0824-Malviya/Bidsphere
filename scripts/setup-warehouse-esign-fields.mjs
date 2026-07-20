/**
 * Ensures Purchase Receipt custom fields for Warehouse Digital Signature (GRN).
 *
 * Usage: node scripts/setup-warehouse-esign-fields.mjs
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

if (!baseUrl || !apiKey || !apiSecret) {
  console.error("Missing ERPNEXT_URL / ERP_API_KEY / ERP_API_SECRET");
  process.exit(1);
}

async function api(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `token ${apiKey}:${apiSecret}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      json.exception || json._server_messages || JSON.stringify(json) || res.statusText,
    );
  }
  return json.data;
}

const DOCTYPE = "Purchase Receipt";
const FIELDS = [
  { fieldname: "warehouse_signed", label: "Warehouse Signed", fieldtype: "Check", default: "0" },
  { fieldname: "warehouse_signed_by", label: "Warehouse Signed By", fieldtype: "Data" },
  { fieldname: "warehouse_signature_type", label: "Warehouse Signature Type", fieldtype: "Data" },
  { fieldname: "warehouse_signature_data", label: "Warehouse Signature Data", fieldtype: "Long Text" },
  { fieldname: "warehouse_signature_style", label: "Warehouse Signature Style", fieldtype: "Data" },
  { fieldname: "warehouse_signature_hash", label: "Warehouse Signature Hash", fieldtype: "Data" },
  { fieldname: "warehouse_signed_at", label: "Warehouse Signed At", fieldtype: "Datetime" },
  { fieldname: "warehouse_ip", label: "Warehouse IP", fieldtype: "Data" },
  { fieldname: "warehouse_browser", label: "Warehouse Browser", fieldtype: "Data" },
  { fieldname: "warehouse_device", label: "Warehouse Device", fieldtype: "Data" },
  { fieldname: "warehouse_esign_envelope", label: "Warehouse E-Sign Envelope", fieldtype: "Long Text" },
  { fieldname: "warehouse_signer_role", label: "Warehouse Signer Role", fieldtype: "Data" },
  { fieldname: "warehouse_signer_email", label: "Warehouse Signer Email", fieldtype: "Data" },
  { fieldname: "warehouse_verification_status", label: "Warehouse Verification Status", fieldtype: "Data" },
  { fieldname: "warehouse_document_version", label: "Warehouse Document Version", fieldtype: "Data" },
  /* Permanent storage fields */
  { fieldname: "warehouse_signature_image", label: "Warehouse Signature Image", fieldtype: "Attach" },
  { fieldname: "warehouse_signature_name", label: "Warehouse Signature Name", fieldtype: "Data" },
  { fieldname: "warehouse_signature_role", label: "Warehouse Signature Role", fieldtype: "Data" },
  { fieldname: "warehouse_signature_employee_id", label: "Warehouse Signature Employee ID", fieldtype: "Data" },
  { fieldname: "warehouse_signature_email", label: "Warehouse Signature Email", fieldtype: "Data" },
  { fieldname: "warehouse_signature_timestamp", label: "Warehouse Signature Timestamp", fieldtype: "Datetime" },
  { fieldname: "warehouse_signature_ip", label: "Warehouse Signature IP", fieldtype: "Data" },
  { fieldname: "warehouse_signature_device", label: "Warehouse Signature Device", fieldtype: "Data" },
  { fieldname: "warehouse_signature_verified", label: "Warehouse Signature Verified", fieldtype: "Check", default: "0" },
  { fieldname: "warehouse_signature_algorithm", label: "Warehouse Signature Algorithm", fieldtype: "Data" },
  { fieldname: "warehouse_signed_pdf_url", label: "Warehouse Signed PDF URL", fieldtype: "Small Text" },
  { fieldname: "warehouse_signed_pdf_hash", label: "Warehouse Signed PDF Hash", fieldtype: "Data" },
  { fieldname: "warehouse_signature_version", label: "Warehouse Signature Version", fieldtype: "Data" },
  /* Canonical Sign & Finalize fields (signature metadata = source of truth) */
  { fieldname: "signed", label: "Signed", fieldtype: "Check", default: "0" },
  { fieldname: "signed_pdf_url", label: "Signed PDF URL", fieldtype: "Small Text" },
  { fieldname: "signed_pdf_file", label: "Signed PDF File", fieldtype: "Attach" },
  { fieldname: "signed_pdf_path", label: "Signed PDF Path", fieldtype: "Small Text" },
  { fieldname: "signed_by", label: "Signed By", fieldtype: "Data" },
  { fieldname: "signed_at", label: "Signed At", fieldtype: "Datetime" },
  { fieldname: "sha256_hash", label: "SHA256 Hash", fieldtype: "Data" },
  { fieldname: "certificate_status", label: "Certificate Status", fieldtype: "Data" },
  { fieldname: "verification_status", label: "Verification Status", fieldtype: "Data" },
  { fieldname: "document_integrity", label: "Document Integrity", fieldtype: "Data" },
  { fieldname: "signature_image", label: "Signature Image", fieldtype: "Attach" },
  /* Legacy aliases */
  { fieldname: "signed_grn_pdf", label: "Signed GRN PDF", fieldtype: "Small Text" },
  { fieldname: "warehouse_signature", label: "Warehouse Signature", fieldtype: "Long Text" },
  { fieldname: "warehouse_signature_time", label: "Warehouse Signature Time", fieldtype: "Datetime" },
];

console.log(`Ensuring Warehouse E-Sign fields on ${DOCTYPE}…`);

const existing = await api(
  "GET",
  `/api/resource/Custom Field?filters=${encodeURIComponent(
    JSON.stringify([
      ["dt", "=", DOCTYPE],
      ["fieldname", "in", FIELDS.map((f) => f.fieldname)],
    ]),
  )}&fields=${encodeURIComponent(JSON.stringify(["name", "fieldname"]))}&limit_page_length=100`,
);

const have = new Set((existing || []).map((r) => r.fieldname));

for (const field of FIELDS) {
  if (have.has(field.fieldname)) {
    console.log(`✓ ${field.fieldname}`);
    continue;
  }
  await api("POST", "/api/resource/Custom Field", {
    doctype: "Custom Field",
    dt: DOCTYPE,
    label: field.label,
    fieldname: field.fieldname,
    fieldtype: field.fieldtype,
    insert_after: "remarks",
    default: field.default,
  });
  console.log(`+ created ${field.fieldname}`);
}

console.log("Done.");
