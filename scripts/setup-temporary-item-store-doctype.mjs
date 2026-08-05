/**
 * Setup ERPNext DocType "Temporary Item Store" for Department BOM workflow.
 *
 * Staging area for BOM lines not yet in Item Master. Master Data approves → ERP Item.
 *
 * Usage:
 *   node scripts/setup-temporary-item-store-doctype.mjs
 *
 * Requires .env:
 *   ERPNEXT_URL or VITE_ERPNEXT_URL / VITE_PROXY_TARGET
 *   ERP_API_KEY, ERP_API_SECRET
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
).replace(/\/$/, "");

const apiKey = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
const apiSecret =
  process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";

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
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = data?.exc_type ?? data?._server_messages ?? text;
    throw new Error(`${method} ${path} → ${res.status}: ${msg}`);
  }
  return data;
}

async function doctypeExists(name) {
  try {
    await api("GET", `/api/resource/DocType/${encodeURIComponent(name)}`);
    return true;
  } catch {
    return false;
  }
}

async function ensureTemporaryItemStore() {
  const name = "Temporary Item Store";
  console.log(`\nDocType "${name}" …`);

  if (await doctypeExists(name)) {
    console.log("  ✓ Already exists");
    return;
  }

  await api("POST", "/api/resource/DocType", {
    doctype: "DocType",
    name,
    module: "Stock",
    istable: 0,
    track_changes: 1,
    autoname: "format:TIS-{#####}",
    fields: [
      { fieldname: "item_name", fieldtype: "Data", label: "Item Name", reqd: 1, in_list_view: 1 },
      { fieldname: "proposed_item_code", fieldtype: "Data", label: "Proposed Item Code", in_list_view: 1 },
      { fieldname: "description", fieldtype: "Small Text", label: "Description" },
      { fieldname: "item_group", fieldtype: "Data", label: "Item Group", in_list_view: 1 },
      { fieldname: "commodity", fieldtype: "Data", label: "Commodity" },
      { fieldname: "default_uom", fieldtype: "Data", label: "Default UOM", default: "Nos", in_list_view: 1 },
      { fieldname: "manufacturer", fieldtype: "Data", label: "Manufacturer" },
      { fieldname: "drawing_number", fieldtype: "Data", label: "Drawing Number" },
      { fieldname: "revision", fieldtype: "Data", label: "Revision" },
      { fieldname: "qty", fieldtype: "Float", label: "Qty", default: "1" },
      {
        fieldname: "status",
        fieldtype: "Select",
        label: "Status",
        options: "Pending Review\nApproved\nRejected",
        default: "Pending Review",
        in_list_view: 1,
      },
      { fieldname: "source_upload", fieldtype: "Data", label: "Source Upload" },
      { fieldname: "department", fieldtype: "Data", label: "Department", in_list_view: 1 },
      { fieldname: "project", fieldtype: "Data", label: "Project", in_list_view: 1 },
      { fieldname: "program", fieldtype: "Data", label: "Program" },
      { fieldname: "uploaded_by", fieldtype: "Data", label: "Uploaded By" },
      { fieldname: "erp_item", fieldtype: "Link", label: "ERP Item", options: "Item" },
      { fieldname: "rejection_reason", fieldtype: "Small Text", label: "Rejection Reason" },
    ],
    permissions: [
      { role: "System Manager", read: 1, write: 1, create: 1, delete: 1 },
      { role: "Stock Manager", read: 1, write: 1, create: 1, delete: 0 },
      { role: "Stock User", read: 1, write: 0, create: 0, delete: 0 },
    ],
  });
  console.log("  ✓ Created");
}

await ensureTemporaryItemStore();
console.log("\nDone.");
