/**
 * Setup ERPNext "RFQ Template" DocType with child tables.
 *
 * Creates:
 *   1. DocType "RFQ Template Item"     (child table)
 *   2. DocType "RFQ Template Supplier"  (child table)
 *   3. DocType "RFQ Template"           (parent)
 *
 * Usage:
 *   node scripts/setup-rfq-template.mjs
 *
 * Requires .env:
 *   ERPNEXT_URL or VITE_ERPNEXT_URL
 *   ERP_API_KEY, ERP_API_SECRET
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

/* ── Load .env ──────────────────────────────────────────────────────────── */

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

/* ── HTTP helper ────────────────────────────────────────────────────────── */

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

/* ── 1. Child table: RFQ Template Item ──────────────────────────────────── */

async function ensureRFQTemplateItem() {
  const name = "RFQ Template Item";
  console.log(`\n[1/3] DocType "${name}" …`);

  if (await doctypeExists(name)) {
    console.log("  ✓ Already exists");
    return;
  }

  await api("POST", "/api/resource/DocType", {
    doctype: "DocType",
    name,
    module: "Stock",
    istable: 1,
    editable_grid: 1,
    track_changes: 0,
    fields: [
      {
        fieldname: "item_code",
        fieldtype: "Link",
        options: "Item",
        label: "Item Code",
        in_list_view: 1,
        reqd: 1,
      },
      {
        fieldname: "item_name",
        fieldtype: "Data",
        label: "Item Name",
        in_list_view: 1,
        fetch_from: "item_code.item_name",
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
        fieldtype: "Link",
        options: "UOM",
        label: "UOM",
        in_list_view: 1,
        default: "Nos",
      },
    ],
    permissions: [{ role: "System Manager", read: 1, write: 1, create: 1, delete: 1 }],
  });
  console.log("  ✓ Created");
}

/* ── 2. Child table: RFQ Template Supplier ──────────────────────────────── */

async function ensureRFQTemplateSupplier() {
  const name = "RFQ Template Supplier";
  console.log(`\n[2/3] DocType "${name}" …`);

  if (await doctypeExists(name)) {
    console.log("  ✓ Already exists");
    return;
  }

  await api("POST", "/api/resource/DocType", {
    doctype: "DocType",
    name,
    module: "Stock",
    istable: 1,
    editable_grid: 1,
    track_changes: 0,
    fields: [
      {
        fieldname: "supplier",
        fieldtype: "Link",
        options: "Supplier",
        label: "Supplier",
        in_list_view: 1,
        reqd: 1,
      },
      {
        fieldname: "supplier_name",
        fieldtype: "Data",
        label: "Supplier Name",
        in_list_view: 1,
        fetch_from: "supplier.supplier_name",
      },
    ],
    permissions: [{ role: "System Manager", read: 1, write: 1, create: 1, delete: 1 }],
  });
  console.log("  ✓ Created");
}

/* ── 3. Parent: RFQ Template ────────────────────────────────────────────── */

async function ensureRFQTemplate() {
  const name = "RFQ Template";
  console.log(`\n[3/3] DocType "${name}" …`);

  if (await doctypeExists(name)) {
    console.log("  ✓ Already exists");
    return;
  }

  const categoryOptions =
    "Raw Materials\nManufacturing Components\nElectrical Components\n" +
    "Packaging Materials\nMRO Supplies\nWarehouse Consumables\n" +
    "IT Equipment\nLogistics & Transportation";

  await api("POST", "/api/resource/DocType", {
    doctype: "DocType",
    name,
    module: "Stock",
    custom: 1,
    naming_rule: "autoincrement",
    autoname: "RFQ-TPL-.#####",
    track_changes: 1,
    allow_rename: 1,
    fields: [
      {
        fieldname: "template_name",
        fieldtype: "Data",
        label: "Template Name",
        reqd: 1,
        unique: 1,
        in_list_view: 1,
        in_standard_filter: 1,
      },
      {
        fieldname: "category",
        fieldtype: "Select",
        label: "Category",
        options: categoryOptions,
        reqd: 1,
        in_list_view: 1,
        in_standard_filter: 1,
      },
      {
        fieldname: "description",
        fieldtype: "Small Text",
        label: "Description",
      },
      {
        fieldname: "column_break_1",
        fieldtype: "Column Break",
      },
      {
        fieldname: "status",
        fieldtype: "Select",
        label: "Status",
        options: "Active\nArchived",
        default: "Active",
        reqd: 1,
        in_list_view: 1,
        in_standard_filter: 1,
      },
      {
        fieldname: "estimated_value",
        fieldtype: "Currency",
        label: "Estimated Value",
      },
      {
        fieldname: "usage_count",
        fieldtype: "Int",
        label: "Usage Count",
        read_only: 1,
        default: "0",
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
        options: "RFQ Template Item",
        reqd: 1,
      },
      {
        fieldname: "section_suppliers",
        fieldtype: "Section Break",
        label: "Suppliers",
      },
      {
        fieldname: "suppliers",
        fieldtype: "Table",
        label: "Suppliers",
        options: "RFQ Template Supplier",
        reqd: 1,
      },
    ],
    permissions: [
      { role: "System Manager", read: 1, write: 1, create: 1, delete: 1 },
      { role: "Purchase User", read: 1, write: 1, create: 1 },
      { role: "Purchase Manager", read: 1, write: 1, create: 1, delete: 1 },
    ],
  });
  console.log("  ✓ Created");
}

/* ── Main ───────────────────────────────────────────────────────────────── */

async function main() {
  if (!baseUrl || !apiKey || !apiSecret) {
    console.error("Missing ERPNEXT_URL and ERP API credentials in .env");
    process.exit(1);
  }

  console.log(`Setting up RFQ Template DocTypes on ${baseUrl}`);

  await ensureRFQTemplateItem();
  await ensureRFQTemplateSupplier();
  await ensureRFQTemplate();

  console.log("\n──────────────────────────────────────");
  console.log("Done.  RFQ Template DocTypes are ready.");
  console.log("Run `node scripts/seed-rfq-templates.mjs` to create default templates.");
  console.log("──────────────────────────────────────\n");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
