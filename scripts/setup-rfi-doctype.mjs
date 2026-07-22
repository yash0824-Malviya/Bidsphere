/**
 * Creates BidSphere RFI DocTypes + supplier portal API Server Scripts.
 *
 * DocTypes:
 *   1. "RFI Supplier"  (child table — invitation rows)
 *   2. "RFI"           (parent)
 *
 * Server Scripts (API):
 *   - bidsphere_get_supplier_rfis  → list ALL invited RFIs via RFI Supplier child
 *   - bidsphere_get_supplier_rfi   → load one RFI with invitation permission check
 *
 * Usage: node scripts/setup-rfi-doctype.mjs
 * Requires .env: ERPNEXT_URL / VITE_ERPNEXT_URL, ERP_API_KEY, ERP_API_SECRET
 * Server Scripts must be enabled: bench --site <site> set-config server_script_enabled 1
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

async function ensureRfiSupplier() {
  const name = "RFI Supplier";
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

async function ensureRfi() {
  const name = "RFI";
  console.log(`\n[2/4] DocType "${name}" …`);
  if (await doctypeExists(name)) {
    console.log("  ✓ Already exists");
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
    naming_rule: "By \"Naming Series\" field",
    allow_rename: 0,
    engine: "InnoDB",
    fields: [
      {
        fieldname: "naming_series",
        label: "Series",
        fieldtype: "Select",
        options: "RFI-.YYYY.-.#####",
        default: "RFI-.YYYY.-.#####",
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
        fieldname: "category",
        label: "Category",
        fieldtype: "Data",
        in_list_view: 1,
        in_standard_filter: 1,
      },
      {
        fieldname: "department",
        label: "Department",
        fieldtype: "Data",
        in_list_view: 1,
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
      {
        fieldname: "section_suppliers",
        fieldtype: "Section Break",
        label: "Suppliers",
      },
      {
        fieldname: "suppliers",
        label: "Suppliers",
        fieldtype: "Table",
        options: "RFI Supplier",
        reqd: 1,
      },
      {
        fieldname: "section_payload",
        fieldtype: "Section Break",
        label: "Questionnaire & Documents",
      },
      {
        fieldname: "questions_json",
        label: "Questions (JSON)",
        fieldtype: "Long Text",
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
      // Supplier portal reads via Server Script (ignore_permissions) — no direct
      // DocType permission for Supplier roles is required.
    ],
  });
  console.log("  ✓ Created");
}

const LIST_SCRIPT = `# BidSphere — supplier portal My RFIs list (history).
# Invitation is resolved ONLY via the RFI Supplier child table.
# Return ALL statuses for invited RFIs — submission must NOT remove history.
# Never filter a supplier field on the RFI parent document.

supplier = (frappe.form_dict.get("supplier") or "").strip()
if not supplier:
    frappe.throw("Supplier is required", frappe.ValidationError)

# Resolve Supplier master id when a display name was passed
if not frappe.db.exists("Supplier", supplier):
    resolved = frappe.db.get_value("Supplier", {"supplier_name": supplier}, "name")
    if resolved:
        supplier = resolved

rows = frappe.get_all(
    "RFI",
    filters=[
        ["RFI Supplier", "supplier", "=", supplier],
        ["status", "in", ["Published", "Under Review", "Closed"]],
    ],
    fields=[
        "name",
        "title",
        "description",
        "submission_deadline",
        "status",
        "category",
        "department",
        "owner",
        "modified",
    ],
    order_by="modified desc",
    limit_page_length=500,
    ignore_permissions=True,
)

frappe.logger("bidsphere_rfi").info(
    "get_supplier_rfis supplier=%s count=%s statuses=%s",
    supplier,
    len(rows),
    sorted({(r.get("status") or "") for r in rows}),
)

frappe.response["message"] = {
    "supplier": supplier,
    "count": len(rows),
    "data": rows,
}
`;

const GET_SCRIPT = `# BidSphere — supplier portal RFI detail with invitation permission check.
# Access is granted only when an RFI Supplier child row matches.

rfi_name = (frappe.form_dict.get("rfi_name") or frappe.form_dict.get("name") or "").strip()
supplier = (frappe.form_dict.get("supplier") or "").strip()

if not rfi_name:
    frappe.throw("RFI name is required", frappe.ValidationError)
if not supplier:
    frappe.throw("Supplier is required", frappe.ValidationError)

if not frappe.db.exists("Supplier", supplier):
    resolved = frappe.db.get_value("Supplier", {"supplier_name": supplier}, "name")
    if resolved:
        supplier = resolved

invited = frappe.db.exists(
    "RFI Supplier",
    {"parent": rfi_name, "parenttype": "RFI", "supplier": supplier},
)
if not invited:
    frappe.logger("bidsphere_rfi").warning(
        "get_supplier_rfi DENIED supplier=%s rfi=%s", supplier, rfi_name
    )
    frappe.throw(
        "You are not invited to this RFI.",
        frappe.PermissionError,
    )

doc = frappe.get_doc("RFI", rfi_name)
if doc.status == "Draft":
    frappe.throw("This RFI has not been published yet.", frappe.PermissionError)

frappe.logger("bidsphere_rfi").info(
    "get_supplier_rfi OK supplier=%s rfi=%s status=%s",
    supplier,
    rfi_name,
    doc.status,
)

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
  console.log("BidSphere RFI DocType setup");
  console.log("ERPNext:", baseUrl);
  await ensureRfiSupplier();
  await ensureRfi();
  console.log("\n[3/4] Server Script bidsphere_get_supplier_rfis …");
  await ensureServerScript(
    "bidsphere_get_supplier_rfis",
    "bidsphere_get_supplier_rfis",
    LIST_SCRIPT,
  );
  console.log("\n[4/4] Server Script bidsphere_get_supplier_rfi …");
  await ensureServerScript(
    "bidsphere_get_supplier_rfi",
    "bidsphere_get_supplier_rfi",
    GET_SCRIPT,
  );
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
