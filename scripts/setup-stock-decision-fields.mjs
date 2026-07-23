/**
 * Ensures Material Request custom fields for Stock Decision audit.
 *
 * Usage: node scripts/setup-stock-decision-fields.mjs
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

const DOCTYPE = "Material Request";
const FIELDS = [
  {
    fieldname: "custom_recommended_action",
    label: "Recommended Action",
    fieldtype: "Data",
  },
  {
    fieldname: "custom_selected_action",
    label: "Selected Action",
    fieldtype: "Data",
  },
  {
    fieldname: "custom_selected_by",
    label: "Selected By",
    fieldtype: "Data",
  },
  {
    fieldname: "custom_selected_at",
    label: "Selected At",
    fieldtype: "Datetime",
  },
  {
    fieldname: "custom_selection_reason",
    label: "Selection Reason",
    fieldtype: "Small Text",
  },
  {
    fieldname: "custom_stock_decision_audit",
    label: "Stock Decision Audit",
    fieldtype: "Long Text",
  },
];

console.log(`Ensuring Stock Decision fields on ${DOCTYPE}…`);

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
  });
  console.log(`+ created ${field.fieldname}`);
}

console.log("Done.");
