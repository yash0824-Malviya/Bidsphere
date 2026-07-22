/**
 * Creates BidSphere RFP DocTypes + supplier portal API Server Scripts.
 *
 * DocTypes:
 *   1. "RFP Supplier"  (child table — invitation rows)
 *   2. "RFP"           (parent)
 *
 * Server Scripts (API):
 *   - bidsphere_get_supplier_rfps
 *   - bidsphere_get_supplier_rfp
 *
 * Usage: node scripts/setup-rfp-doctype.mjs
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

async function doctypeExists(name) {
  try {
    await api("GET", `/api/resource/DocType/${encodeURIComponent(name)}`);
    return true;
  } catch {
    return false;
  }
}

/** Narrative fields shared with Supplier Portal RFP detail. */
const RFP_NARRATIVE_FIELDS = [
  {
    fieldname: "section_scope",
    fieldtype: "Section Break",
    label: "Scope & Requirements",
  },
  {
    fieldname: "scope_of_work",
    label: "Scope of Work",
    fieldtype: "Long Text",
  },
  {
    fieldname: "business_objective",
    label: "Business Objective",
    fieldtype: "Long Text",
  },
  {
    fieldname: "technical_requirements",
    label: "Technical Requirements",
    fieldtype: "Long Text",
  },
];

async function ensureFields(doctypeName, requiredFields) {
  const existing = await api(
    "GET",
    `/api/resource/DocType/${encodeURIComponent(doctypeName)}`,
  );
  const fields = existing.fields || [];
  let modified = false;
  for (const required of requiredFields) {
    const found = fields.find((f) => f.fieldname === required.fieldname);
    if (!found) {
      console.log(`  + Adding ${doctypeName}.${required.fieldname}`);
      fields.push({ ...required, parent: doctypeName, parenttype: "DocType" });
      modified = true;
      continue;
    }
    for (const [k, v] of Object.entries(required)) {
      if (k === "fieldname") continue;
      if (found[k] !== v) {
        found[k] = v;
        modified = true;
      }
    }
  }
  if (modified) {
    await api(
      "PUT",
      `/api/resource/DocType/${encodeURIComponent(doctypeName)}`,
      { fields },
    );
    console.log(`  ✓ Updated fields on ${doctypeName}`);
  } else {
    console.log(`  ✓ ${doctypeName} narrative fields already current`);
  }
}

async function ensureRfpSupplier() {
  const name = "RFP Supplier";
  console.log(`\n[1/4] DocType "${name}" …`);
  if (await doctypeExists(name)) {
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
    engine: "InnoDB",
    fields: [
      {
        fieldname: "supplier",
        label: "Supplier",
        fieldtype: "Link",
        options: "Supplier",
        reqd: 1,
        in_list_view: 1,
      },
      {
        fieldname: "supplier_name",
        label: "Supplier Name",
        fieldtype: "Data",
        in_list_view: 1,
        fetch_from: "supplier.supplier_name",
        read_only: 1,
      },
    ],
    permissions: [
      { role: "System Manager", read: 1, write: 1, create: 1, delete: 1 },
      { role: "Purchase Manager", read: 1, write: 1, create: 1, delete: 1 },
      { role: "Purchase User", read: 1, write: 1, create: 1, delete: 0 },
    ],
  });
  console.log("  ✓ Created");
}

async function ensureRfp() {
  const name = "RFP";
  console.log(`\n[2/4] DocType "${name}" …`);
  if (await doctypeExists(name)) {
    console.log("  ✓ Already exists — ensuring narrative fields");
    await ensureFields(name, RFP_NARRATIVE_FIELDS);
    return;
  }
  await api("POST", "/api/resource/DocType", {
    doctype: "DocType",
    name,
    module: "Buying",
    custom: 1,
    istable: 0,
    is_submittable: 0,
    editable_grid: 1,
    track_changes: 1,
    autoname: "naming_series:",
    naming_rule: 'By "Naming Series" field',
    allow_rename: 0,
    engine: "InnoDB",
    fields: [
      {
        fieldname: "naming_series",
        label: "Series",
        fieldtype: "Select",
        options: "RFP-.YYYY.-.#####",
        default: "RFP-.YYYY.-.#####",
        reqd: 1,
        hidden: 1,
      },
      {
        fieldname: "title",
        label: "Title",
        fieldtype: "Data",
        reqd: 1,
        in_list_view: 1,
        in_standard_filter: 1,
      },
      {
        fieldname: "status",
        label: "Status",
        fieldtype: "Select",
        options: "Draft\nPublished\nUnder Review\nClosed",
        default: "Draft",
        reqd: 1,
        in_list_view: 1,
        in_standard_filter: 1,
      },
      {
        fieldname: "submission_deadline",
        label: "Submission Deadline",
        fieldtype: "Date",
        reqd: 1,
        in_list_view: 1,
      },
      {
        fieldname: "company",
        label: "Company",
        fieldtype: "Link",
        options: "Company",
      },
      {
        fieldname: "description",
        label: "Description",
        fieldtype: "Text Editor",
      },
      ...RFP_NARRATIVE_FIELDS,
      {
        fieldname: "section_suppliers",
        fieldtype: "Section Break",
        label: "Suppliers",
      },
      {
        fieldname: "suppliers",
        label: "Suppliers",
        fieldtype: "Table",
        options: "RFP Supplier",
        reqd: 1,
      },
      {
        fieldname: "section_docs",
        fieldtype: "Section Break",
        label: "Required Documents",
      },
      {
        fieldname: "required_documents_json",
        label: "Required Documents (JSON)",
        fieldtype: "Long Text",
      },
      {
        fieldname: "section_meta",
        fieldtype: "Section Break",
        label: "Internal",
      },
      {
        fieldname: "internal_notes",
        label: "Internal Notes",
        fieldtype: "Small Text",
      },
      {
        fieldname: "published_at",
        label: "Published At",
        fieldtype: "Datetime",
        read_only: 1,
      },
      {
        fieldname: "closed_at",
        label: "Closed At",
        fieldtype: "Datetime",
        read_only: 1,
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
    ],
  });
  console.log("  ✓ Created");
}

const LIST_SCRIPT = `# BidSphere — supplier portal My RFPs list.
supplier = (frappe.form_dict.get("supplier") or "").strip()
if not supplier:
    frappe.throw("Supplier is required", frappe.ValidationError)

if not frappe.db.exists("Supplier", supplier):
    resolved = frappe.db.get_value("Supplier", {"supplier_name": supplier}, "name")
    if resolved:
        supplier = resolved

rows = frappe.get_all(
    "RFP",
    filters=[
        ["RFP Supplier", "supplier", "=", supplier],
        ["status", "in", ["Published", "Under Review", "Closed"]],
    ],
    fields=[
        "name",
        "title",
        "description",
        "submission_deadline",
        "status",
        "modified",
    ],
    order_by="modified desc",
    limit_page_length=500,
    ignore_permissions=True,
)

frappe.logger("bidsphere_rfp").info(
    "get_supplier_rfps supplier=%s count=%s", supplier, len(rows)
)

frappe.response["message"] = {
    "supplier": supplier,
    "count": len(rows),
    "data": rows,
}
`;

const GET_SCRIPT = `# BidSphere — supplier portal RFP detail with invitation permission check.
rfp_name = (frappe.form_dict.get("rfp_name") or frappe.form_dict.get("name") or "").strip()
supplier = (frappe.form_dict.get("supplier") or "").strip()

if not rfp_name:
    frappe.throw("RFP name is required", frappe.ValidationError)
if not supplier:
    frappe.throw("Supplier is required", frappe.ValidationError)

if not frappe.db.exists("Supplier", supplier):
    resolved = frappe.db.get_value("Supplier", {"supplier_name": supplier}, "name")
    if resolved:
        supplier = resolved

invited = frappe.db.exists(
    "RFP Supplier",
    {"parent": rfp_name, "parenttype": "RFP", "supplier": supplier},
)
if not invited:
    frappe.throw("You are not invited to this RFP.", frappe.PermissionError)

doc = frappe.get_doc("RFP", rfp_name)
if doc.status == "Draft":
    frappe.throw("This RFP has not been published yet.", frappe.PermissionError)

frappe.response["message"] = doc.as_dict()
`;

async function ensureServerScript(name, apiMethod, script) {
  console.log(`\nServer Script "${name}" …`);
  const payload = {
    doctype: "Server Script",
    name,
    script_type: "API",
    api_method: apiMethod,
    allow_guest: 0,
    disabled: 0,
    module: "Buying",
    script,
  };
  try {
    await api("GET", `/api/resource/Server Script/${encodeURIComponent(name)}`);
    await api("PUT", `/api/resource/Server Script/${encodeURIComponent(name)}`, {
      script_type: "API",
      api_method: apiMethod,
      allow_guest: 0,
      disabled: 0,
      script,
    });
    console.log("  ✓ Updated");
  } catch {
    await api("POST", "/api/resource/Server Script", payload);
    console.log("  ✓ Created");
  }
}

async function main() {
  console.log("BidSphere RFP DocType setup");
  console.log("ERPNext:", baseUrl);
  await ensureRfpSupplier();
  await ensureRfp();
  console.log("\n[3/4] Server Script bidsphere_get_supplier_rfps …");
  await ensureServerScript(
    "bidsphere_get_supplier_rfps",
    "bidsphere_get_supplier_rfps",
    LIST_SCRIPT,
  );
  console.log("\n[4/4] Server Script bidsphere_get_supplier_rfp …");
  await ensureServerScript(
    "bidsphere_get_supplier_rfp",
    "bidsphere_get_supplier_rfp",
    GET_SCRIPT,
  );
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
