/**
 * Setup ERPNext DocTypes for Procurement BOM Reader.
 *
 * Creates:
 *   1. DocType "Uploaded BOM Item"  (child table)
 *   2. DocType "Uploaded BOM"       (parent)
 *
 * This is NOT Manufacturing BOM / Engineering BOM / Stock BOM.
 * It only stores procurement upload audit trails linked to RFQs.
 *
 * Usage:
 *   node scripts/setup-uploaded-bom-doctype.mjs
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

async function ensureUploadedBomItem() {
  const name = "Uploaded BOM Item";
  console.log(`\n[1/2] DocType "${name}" …`);

  if (await doctypeExists(name)) {
    console.log("  ✓ Already exists");
    return;
  }

  await api("POST", "/api/resource/DocType", {
    doctype: "DocType",
    name,
    module: "Buying",
    istable: 1,
    editable_grid: 1,
    track_changes: 0,
    fields: [
      {
        fieldname: "item_code",
        fieldtype: "Data",
        label: "Item Code",
        in_list_view: 1,
      },
      {
        fieldname: "item_name",
        fieldtype: "Data",
        label: "Item Name",
        in_list_view: 1,
        reqd: 1,
      },
      {
        fieldname: "qty",
        fieldtype: "Float",
        label: "Qty",
        in_list_view: 1,
        reqd: 1,
        default: "1",
      },
      {
        fieldname: "uom",
        fieldtype: "Data",
        label: "UOM",
        in_list_view: 1,
        default: "Nos",
      },
      {
        fieldname: "description",
        fieldtype: "Small Text",
        label: "Description",
      },
      {
        fieldname: "exists_in_erp",
        fieldtype: "Check",
        label: "Exists in ERP",
        in_list_view: 1,
        default: "0",
      },
    ],
    permissions: [
      { role: "System Manager", read: 1, write: 1, create: 1, delete: 1 },
      { role: "Purchase Manager", read: 1, write: 1, create: 1, delete: 0 },
      { role: "Purchase User", read: 1, write: 0, create: 1, delete: 0 },
    ],
  });
  console.log("  ✓ Created");
}

async function ensureUploadedBom() {
  const name = "Uploaded BOM";
  console.log(`\n[2/2] DocType "${name}" …`);

  if (await doctypeExists(name)) {
    console.log("  ✓ Already exists");
    return;
  }

  await api("POST", "/api/resource/DocType", {
    doctype: "DocType",
    name,
    module: "Buying",
    istable: 0,
    is_submittable: 0,
    editable_grid: 1,
    track_changes: 1,
    autoname: "hash",
    naming_rule: "Random",
    fields: [
      {
        fieldname: "bom_number",
        fieldtype: "Data",
        label: "BOM Number",
        in_list_view: 1,
        in_standard_filter: 1,
        reqd: 1,
      },
      {
        fieldname: "uploaded_by",
        fieldtype: "Data",
        label: "Uploaded By",
        in_list_view: 1,
      },
      {
        fieldname: "upload_date",
        fieldtype: "Date",
        label: "Upload Date",
        in_list_view: 1,
      },
      {
        fieldname: "original_file",
        fieldtype: "Attach",
        label: "Original File",
      },
      {
        fieldname: "status",
        fieldtype: "Select",
        label: "Status",
        options: "Draft\nParsed\nRFQ Created\nCancelled",
        default: "Draft",
        in_list_view: 1,
        in_standard_filter: 1,
      },
      {
        fieldname: "total_items",
        fieldtype: "Int",
        label: "Total Items",
        in_list_view: 1,
        default: "0",
      },
      {
        fieldname: "rfq",
        fieldtype: "Link",
        options: "Request for Quotation",
        label: "RFQ",
        in_list_view: 1,
      },
      {
        fieldname: "remarks",
        fieldtype: "Small Text",
        label: "Remarks",
      },
      {
        fieldname: "section_items",
        fieldtype: "Section Break",
        label: "Items",
      },
      {
        fieldname: "items",
        fieldtype: "Table",
        label: "Items",
        options: "Uploaded BOM Item",
      },
    ],
    permissions: [
      { role: "System Manager", read: 1, write: 1, create: 1, delete: 1, export: 1 },
      { role: "Purchase Manager", read: 1, write: 1, create: 1, delete: 0, export: 1 },
      { role: "Purchase User", read: 1, write: 0, create: 1, delete: 0 },
    ],
  });
  console.log("  ✓ Created");
}

async function main() {
  console.log("Setting up Uploaded BOM DocTypes on", baseUrl);
  await ensureUploadedBomItem();
  await ensureUploadedBom();
  console.log("\nDone. Procurement BOM Reader storage is ready.");
  console.log("NOTE: This does NOT create Manufacturing / Engineering BOMs.");
}

main().catch((err) => {
  console.error("\nSetup failed:", err.message || err);
  process.exit(1);
});
