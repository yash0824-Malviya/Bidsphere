/**
 * Provisions Cost Breakdown DocTypes + RFQ custom field for BidSphere.
 *
 * Creates:
 *   1. Cost Head Master
 *   2. Cost Breakdown Detail (child)
 *   3. Cost Breakdown (parent)
 *   4. Custom Field custom_require_cost_breakdown on Request for Quotation
 *   5. Seed cost heads
 *
 * Usage: node scripts/setup-cost-breakdown-doctype.mjs
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
  return data?.data ?? data?.message ?? data;
}

async function exists(doctype, name) {
  try {
    await api("GET", `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`);
    return true;
  } catch {
    return false;
  }
}

const SEED_HEADS = [
  "Raw Material",
  "Purchased Parts",
  "Labor",
  "Machine Cost",
  "Tooling",
  "Packaging",
  "Freight",
  "Insurance",
  "Tax",
  "Burden",
  "SGA",
  "Profit",
  "Other",
];

async function ensureCostHeadMaster() {
  const name = "Cost Head Master";
  console.log(`\n[1/5] DocType "${name}" …`);
  if (!(await exists("DocType", name))) {
    await api("POST", "/api/resource/DocType", {
      doctype: "DocType",
      name,
      module: "Buying",
      custom: 1,
      autoname: "field:cost_head_name",
      naming_rule: "By fieldname",
      fields: [
        {
          fieldname: "cost_head_name",
          label: "Cost Head Name",
          fieldtype: "Data",
          reqd: 1,
          unique: 1,
          in_list_view: 1,
        },
        {
          fieldname: "description",
          label: "Description",
          fieldtype: "Small Text",
        },
        {
          fieldname: "sort_order",
          label: "Sort Order",
          fieldtype: "Int",
          default: "0",
          in_list_view: 1,
        },
        {
          fieldname: "is_active",
          label: "Is Active",
          fieldtype: "Check",
          default: "1",
          in_list_view: 1,
        },
      ],
      permissions: [
        { role: "System Manager", read: 1, write: 1, create: 1, delete: 1 },
        { role: "Purchase Manager", read: 1, write: 1, create: 1, delete: 0 },
        { role: "Purchase User", read: 1, write: 0, create: 0, delete: 0 },
        // Supplier portal must read masters to map Link values correctly.
        { role: "Supplier", read: 1, write: 0, create: 0, delete: 0 },
      ],
    });
    console.log("  ✓ Created");
  } else {
    console.log("  ✓ Already exists");
  }
}

async function ensureDetail() {
  const name = "Cost Breakdown Detail";
  console.log(`\n[2/5] DocType "${name}" …`);
  if (await exists("DocType", name)) {
    console.log("  ✓ Already exists");
    return;
  }
  await api("POST", "/api/resource/DocType", {
    doctype: "DocType",
    name,
    module: "Buying",
    custom: 1,
    istable: 1,
    editable_grid: 1,
    fields: [
      {
        fieldname: "cost_head",
        label: "Cost Head",
        fieldtype: "Link",
        options: "Cost Head Master",
        reqd: 1,
        in_list_view: 1,
      },
      {
        fieldname: "description",
        label: "Description",
        fieldtype: "Data",
        in_list_view: 1,
      },
      {
        fieldname: "quantity",
        label: "Quantity",
        fieldtype: "Float",
        reqd: 1,
        default: "1",
        in_list_view: 1,
      },
      {
        fieldname: "unit_cost",
        label: "Unit Cost",
        fieldtype: "Currency",
        reqd: 1,
        default: "0",
        in_list_view: 1,
      },
      {
        fieldname: "total_cost",
        label: "Total Cost",
        fieldtype: "Currency",
        read_only: 1,
        in_list_view: 1,
      },
    ],
    permissions: [
      { role: "System Manager", read: 1, write: 1, create: 1, delete: 1 },
      { role: "Purchase Manager", read: 1, write: 1, create: 1, delete: 1 },
      { role: "Purchase User", read: 1, write: 1, create: 1, delete: 0 },
      { role: "Supplier", read: 1, write: 1, create: 1, delete: 0 },
    ],
  });
  console.log("  ✓ Created");
}

async function ensureParent() {
  const name = "Cost Breakdown";
  console.log(`\n[3/5] DocType "${name}" …`);
  if (await exists("DocType", name)) {
    console.log("  ✓ Already exists");
    return;
  }
  await api("POST", "/api/resource/DocType", {
    doctype: "DocType",
    name,
    module: "Buying",
    custom: 1,
    autoname: "format:CB-{#####}",
    track_changes: 1,
    fields: [
      {
        fieldname: "rfq",
        label: "RFQ",
        fieldtype: "Link",
        options: "Request for Quotation",
        reqd: 1,
        in_list_view: 1,
        in_standard_filter: 1,
      },
      {
        fieldname: "supplier_quotation",
        label: "Supplier Quotation",
        fieldtype: "Link",
        options: "Supplier Quotation",
        in_list_view: 1,
        in_standard_filter: 1,
      },
      {
        fieldname: "supplier",
        label: "Supplier",
        fieldtype: "Link",
        options: "Supplier",
        reqd: 1,
        in_list_view: 1,
        in_standard_filter: 1,
      },
      {
        fieldname: "item",
        label: "Item",
        fieldtype: "Link",
        options: "Item",
        reqd: 1,
        in_list_view: 1,
      },
      {
        fieldname: "item_name",
        label: "Item Name",
        fieldtype: "Data",
        fetch_from: "item.item_name",
        read_only: 1,
      },
      {
        fieldname: "currency",
        label: "Currency",
        fieldtype: "Link",
        options: "Currency",
        default: "USD",
      },
      {
        fieldname: "upload_type",
        label: "Upload Type",
        fieldtype: "Select",
        options: "Manual\nExcel",
        default: "Manual",
        in_list_view: 1,
      },
      {
        fieldname: "excel_file",
        label: "Excel File",
        fieldtype: "Attach",
      },
      {
        fieldname: "status",
        label: "Status",
        fieldtype: "Select",
        options: "Draft\nSubmitted",
        default: "Draft",
        in_list_view: 1,
      },
      {
        fieldname: "grand_total",
        label: "Grand Total",
        fieldtype: "Currency",
        read_only: 1,
        in_list_view: 1,
      },
      {
        fieldname: "remarks",
        label: "Remarks",
        fieldtype: "Small Text",
      },
      {
        fieldname: "section_details",
        fieldtype: "Section Break",
        label: "Cost Lines",
      },
      {
        fieldname: "details",
        label: "Cost Breakdown Detail",
        fieldtype: "Table",
        options: "Cost Breakdown Detail",
        reqd: 1,
      },
    ],
    permissions: [
      {
        role: "System Manager",
        read: 1,
        write: 1,
        create: 1,
        delete: 1,
        export: 1,
      },
      {
        role: "Purchase Manager",
        read: 1,
        write: 1,
        create: 1,
        delete: 1,
        export: 1,
      },
      {
        role: "Purchase User",
        read: 1,
        write: 1,
        create: 1,
        delete: 0,
        export: 1,
      },
      {
        role: "Supplier",
        read: 1,
        write: 1,
        create: 1,
        delete: 0,
        export: 0,
      },
    ],
  });
  console.log("  ✓ Created");
}

/** Patch Supplier role onto existing DocTypes (safe to re-run). */
async function ensureSupplierPermissions() {
  console.log(`\n[4b/5] Ensure Supplier permissions …`);
  const patches = [
    {
      doctype: "Cost Head Master",
      role: "Supplier",
      perm: { read: 1, write: 0, create: 0, delete: 0 },
    },
    {
      doctype: "Cost Breakdown Detail",
      role: "Supplier",
      perm: { read: 1, write: 1, create: 1, delete: 0 },
    },
    {
      doctype: "Cost Breakdown",
      role: "Supplier",
      perm: { read: 1, write: 1, create: 1, delete: 0 },
    },
  ];

  for (const { doctype, role, perm } of patches) {
    let doc;
    try {
      doc = await api(
        "GET",
        `/api/resource/DocType/${encodeURIComponent(doctype)}`,
      );
    } catch {
      console.log(`  · ${doctype}: skip (missing)`);
      continue;
    }
    const permissions = Array.isArray(doc.permissions) ? [...doc.permissions] : [];
    const idx = permissions.findIndex((p) => p.role === role);
    if (idx >= 0) {
      permissions[idx] = { ...permissions[idx], role, ...perm };
    } else {
      permissions.push({ role, ...perm });
    }
    await api("PUT", `/api/resource/DocType/${encodeURIComponent(doctype)}`, {
      permissions,
    });
    console.log(`  ✓ ${doctype} → ${role}`);
  }
}

async function ensureRfqField() {
  console.log(`\n[4/5] Custom Field custom_require_cost_breakdown …`);
  const cfName = "Request for Quotation-custom_require_cost_breakdown";
  if (await exists("Custom Field", cfName)) {
    console.log("  ✓ Already exists");
    return;
  }
  await api("POST", "/api/resource/Custom Field", {
    doctype: "Custom Field",
    dt: "Request for Quotation",
    fieldname: "custom_require_cost_breakdown",
    label: "Require Cost Breakdown",
    fieldtype: "Check",
    insert_after: "message_for_supplier",
    default: "0",
    description:
      "When enabled, invited suppliers must complete a Cost Breakdown on their quotation.",
  });
  console.log("  ✓ Created");
}

async function seedHeads() {
  console.log(`\n[5/5] Seed Cost Head Master …`);
  for (let i = 0; i < SEED_HEADS.length; i++) {
    const head = SEED_HEADS[i];
    if (await exists("Cost Head Master", head)) {
      console.log(`  · ${head} (exists)`);
      continue;
    }
    await api("POST", "/api/resource/Cost Head Master", {
      cost_head_name: head,
      description: head,
      sort_order: (i + 1) * 10,
      is_active: 1,
    });
    console.log(`  ✓ ${head}`);
  }
}

async function main() {
  console.log("BidSphere Cost Breakdown setup");
  console.log("ERPNext:", baseUrl);
  await ensureCostHeadMaster();
  await ensureDetail();
  await ensureParent();
  await ensureRfqField();
  await ensureSupplierPermissions();
  await seedHeads();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
