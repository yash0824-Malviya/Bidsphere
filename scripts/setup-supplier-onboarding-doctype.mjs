/**
 * Setup Supplier Onboarding DocTypes on ERPNext.
 *
 * Creates:
 *   1. Supplier Category (master)
 *   2. Supplier Onboarding Timeline (child)
 *   3. Supplier Onboarding Document (child)
 *   4. Supplier Onboarding Approval (child)
 *   5. Onboarding Discussion (child)
 *   6. Supplier Onboarding (parent)
 *
 * Usage: node scripts/setup-supplier-onboarding-doctype.mjs
 * Requires .env: ERPNEXT_URL, ERP_API_KEY, ERP_API_SECRET
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
    throw new Error(
      data?.exception || data?._server_messages || text || res.statusText,
    );
  }
  return data.data ?? data;
}

async function doctypeExists(name) {
  try {
    await api("GET", `/api/resource/DocType/${encodeURIComponent(name)}`);
    return true;
  } catch {
    return false;
  }
}

async function ensureDocType(name, payload) {
  console.log(`\nDocType "${name}" …`);
  if (await doctypeExists(name)) {
    console.log("  ✓ Already exists");
    return;
  }
  await api("POST", "/api/resource/DocType", payload);
  console.log("  ✓ Created");
}

const PERMS = [
  { role: "System Manager", read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1 },
  { role: "Purchase Manager", read: 1, write: 1, create: 1, delete: 0, report: 1, export: 1 },
  { role: "Purchase User", read: 1, write: 1, create: 1, delete: 0, report: 1 },
];

const STATUS_OPTIONS = [
  "Draft",
  "Link Generated",
  "Opened",
  "In Progress",
  "Submitted",
  "Under Review",
  "Changes Requested",
  "Approved",
  "Rejected",
  "Expired",
].join("\n");

const SEED_CATEGORIES = [
  { name: "Raw Material", scope: "Direct", sort: 10 },
  { name: "Packaging", scope: "Direct", sort: 20 },
  { name: "Mechanical", scope: "Direct", sort: 30 },
  { name: "Electrical", scope: "Direct", sort: 40 },
  { name: "Electronics", scope: "Direct", sort: 50 },
  { name: "Chemical", scope: "Direct", sort: 60 },
  { name: "IT Hardware", scope: "Both", sort: 70 },
  { name: "Software", scope: "Indirect", sort: 80 },
  { name: "Office Supplies", scope: "Indirect", sort: 90 },
  { name: "Stationery", scope: "Indirect", sort: 100 },
  { name: "Safety Items", scope: "Both", sort: 110 },
  { name: "Services", scope: "Indirect", sort: 120 },
  { name: "Transport", scope: "Indirect", sort: 130 },
  { name: "Logistics", scope: "Indirect", sort: 140 },
  { name: "Consulting", scope: "Indirect", sort: 150 },
  { name: "Maintenance", scope: "Both", sort: 160 },
];

async function ensureSupplierCategory() {
  await ensureDocType("Supplier Category", {
    doctype: "DocType",
    name: "Supplier Category",
    module: "Buying",
    custom: 1,
    naming_rule: "By fieldname",
    autoname: "field:category_name",
    track_changes: 1,
    fields: [
      { fieldname: "category_name", fieldtype: "Data", label: "Category Name", reqd: 1, in_list_view: 1 },
      {
        fieldname: "supplier_type_scope",
        fieldtype: "Select",
        label: "Supplier Type Scope",
        options: "Both\nDirect\nIndirect",
        default: "Both",
        in_list_view: 1,
      },
      { fieldname: "is_active", fieldtype: "Check", label: "Is Active", default: "1", in_list_view: 1 },
      { fieldname: "sort_order", fieldtype: "Int", label: "Sort Order", default: "100" },
    ],
    permissions: PERMS,
  });

  for (const cat of SEED_CATEGORIES) {
    try {
      await api("GET", `/api/resource/Supplier%20Category/${encodeURIComponent(cat.name)}`);
      console.log(`  · Category "${cat.name}" exists`);
    } catch {
      await api("POST", "/api/resource/Supplier%20Category", {
        category_name: cat.name,
        supplier_type_scope: cat.scope,
        is_active: 1,
        sort_order: cat.sort,
      });
      console.log(`  + Seeded category "${cat.name}"`);
    }
  }
}

async function ensureTimelineChild() {
  await ensureDocType("Supplier Onboarding Timeline", {
    doctype: "DocType",
    name: "Supplier Onboarding Timeline",
    module: "Buying",
    custom: 1,
    istable: 1,
    editable_grid: 1,
    fields: [
      { fieldname: "event", fieldtype: "Data", label: "Event", in_list_view: 1, reqd: 1 },
      { fieldname: "event_on", fieldtype: "Datetime", label: "Event On", in_list_view: 1 },
      { fieldname: "actor", fieldtype: "Data", label: "Actor", in_list_view: 1 },
      { fieldname: "notes", fieldtype: "Small Text", label: "Notes" },
    ],
    permissions: PERMS,
  });
}

async function ensureDocumentChild() {
  await ensureDocType("Supplier Onboarding Document", {
    doctype: "DocType",
    name: "Supplier Onboarding Document",
    module: "Buying",
    custom: 1,
    istable: 1,
    editable_grid: 1,
    fields: [
      { fieldname: "document_type", fieldtype: "Data", label: "Document Type", in_list_view: 1, reqd: 1 },
      { fieldname: "file_url", fieldtype: "Attach", label: "File", in_list_view: 1 },
      { fieldname: "file_name", fieldtype: "Data", label: "File Name", in_list_view: 1 },
      { fieldname: "uploaded_on", fieldtype: "Datetime", label: "Uploaded On" },
    ],
    permissions: PERMS,
  });
}

async function ensureApprovalChild() {
  await ensureDocType("Supplier Onboarding Approval", {
    doctype: "DocType",
    name: "Supplier Onboarding Approval",
    module: "Buying",
    custom: 1,
    istable: 1,
    editable_grid: 1,
    fields: [
      { fieldname: "stage", fieldtype: "Data", label: "Stage", in_list_view: 1, reqd: 1 },
      { fieldname: "stage_order", fieldtype: "Int", label: "Order", in_list_view: 1, default: "1" },
      {
        fieldname: "status",
        fieldtype: "Select",
        label: "Status",
        options: "Pending\nApproved\nRejected\nSkipped",
        default: "Pending",
        in_list_view: 1,
      },
      { fieldname: "acted_by", fieldtype: "Data", label: "Acted By" },
      { fieldname: "acted_on", fieldtype: "Datetime", label: "Acted On" },
      { fieldname: "comments", fieldtype: "Small Text", label: "Comments" },
    ],
    permissions: PERMS,
  });
}

const DISCUSSION_SECTION_OPTIONS = [
  "",
  "Company",
  "Contact",
  "Business",
  "Plant & Capacity",
  "Bank",
  "Documents",
  "Review",
].join("\n");

async function ensureDiscussionChild() {
  await ensureDocType("Onboarding Discussion", {
    doctype: "DocType",
    name: "Onboarding Discussion",
    module: "Buying",
    custom: 1,
    istable: 1,
    editable_grid: 1,
    fields: [
      { fieldname: "message_id", fieldtype: "Data", label: "Message Id", in_list_view: 1, reqd: 1 },
      {
        fieldname: "sender_role",
        fieldtype: "Select",
        label: "Sender Role",
        options: "Supplier\nProcurement",
        reqd: 1,
        in_list_view: 1,
      },
      { fieldname: "sender_name", fieldtype: "Data", label: "Sender Name", in_list_view: 1 },
      { fieldname: "message", fieldtype: "Text", label: "Message", in_list_view: 1, reqd: 1 },
      { fieldname: "sent_on", fieldtype: "Datetime", label: "Sent On", in_list_view: 1 },
      {
        fieldname: "section_tag",
        fieldtype: "Select",
        label: "Section Tag",
        options: DISCUSSION_SECTION_OPTIONS,
        in_list_view: 1,
      },
      { fieldname: "file_url", fieldtype: "Attach", label: "Attachment" },
      { fieldname: "file_name", fieldtype: "Data", label: "File Name" },
      { fieldname: "resolved", fieldtype: "Check", label: "Resolved", default: "0", in_list_view: 1 },
      { fieldname: "resolved_by", fieldtype: "Data", label: "Resolved By" },
      { fieldname: "resolved_on", fieldtype: "Datetime", label: "Resolved On" },
      { fieldname: "read_by_supplier", fieldtype: "Check", label: "Read by Supplier", default: "0" },
      {
        fieldname: "read_by_procurement",
        fieldtype: "Check",
        label: "Read by Procurement",
        default: "0",
      },
    ],
    permissions: PERMS,
  });
}

async function ensureParentField(parentName, fieldDef) {
  const dt = await api("GET", `/api/resource/DocType/${encodeURIComponent(parentName)}`);
  const fields = Array.isArray(dt.fields) ? dt.fields : [];
  if (fields.some((x) => x.fieldname === fieldDef.fieldname)) {
    console.log(`  · Field "${fieldDef.fieldname}" already on ${parentName}`);
    return;
  }
  const maxIdx = fields.reduce((m, f) => Math.max(m, Number(f.idx) || 0), 0);
  fields.push({ ...fieldDef, idx: maxIdx + 1, parent: parentName, parentfield: "fields", parenttype: "DocType" });
  await api("PUT", `/api/resource/DocType/${encodeURIComponent(parentName)}`, {
    ...dt,
    fields,
  });
  console.log(`  ✓ Added field "${fieldDef.fieldname}" to ${parentName}`);
}

function f(fieldname, fieldtype, label, extra = {}) {
  return { fieldname, fieldtype, label, ...extra };
}

async function ensureParent() {
  await ensureDocType("Supplier Onboarding", {
    doctype: "DocType",
    name: "Supplier Onboarding",
    module: "Buying",
    custom: 1,
    naming_rule: "Expression",
    autoname: "format:SOB-{YYYY}-{#####}",
    track_changes: 1,
    fields: [
      f("company_name", "Data", "Company Name", { reqd: 1, in_list_view: 1 }),
      f("contact_person", "Data", "Contact Person", { reqd: 1, in_list_view: 1 }),
      f("email", "Data", "Email", { reqd: 1, in_list_view: 1 }),
      f("mobile_no", "Data", "Mobile Number"),
      {
        fieldname: "supplier_type",
        fieldtype: "Select",
        label: "Supplier Type",
        options: "Direct\nIndirect",
        reqd: 1,
        in_list_view: 1,
        in_standard_filter: 1,
      },
      f("supplier_category", "Link", "Supplier Category", {
        options: "Supplier Category",
        reqd: 1,
        in_list_view: 1,
        in_standard_filter: 1,
      }),
      f("plant", "Data", "Plant"),
      f("remarks", "Small Text", "Remarks"),
      f("created_by_user", "Data", "Created By"),
      {
        fieldname: "status",
        fieldtype: "Select",
        label: "Status",
        options: STATUS_OPTIONS,
        default: "Draft",
        in_list_view: 1,
        in_standard_filter: 1,
      },
      f("secure_token", "Data", "Secure Token", { unique: 1 }),
      f("token_created_on", "Datetime", "Token Created On"),
      f("token_expires_on", "Datetime", "Token Expires On"),

      { fieldname: "sec_company", fieldtype: "Section Break", label: "Company Information" },
      f("gst_number", "Data", "GST Number"),
      f("pan", "Data", "PAN"),
      f("business_registration_number", "Data", "Business Registration Number"),
      f("website", "Data", "Website"),
      f("address_line", "Small Text", "Address"),
      f("country", "Data", "Country"),
      f("state", "Data", "State"),
      f("city", "Data", "City"),
      f("postal_code", "Data", "Postal Code"),

      { fieldname: "sec_contact", fieldtype: "Section Break", label: "Contact" },
      f("designation", "Data", "Designation"),
      f("phone", "Data", "Phone"),
      f("alternate_phone", "Data", "Alternate Phone"),

      { fieldname: "sec_business", fieldtype: "Section Break", label: "Business" },
      f("years_in_business", "Data", "Years in Business"),
      f("employee_count", "Data", "Employee Count"),
      f("annual_turnover", "Data", "Annual Turnover"),
      f("preferred_currency", "Data", "Preferred Currency"),
      f("payment_terms", "Data", "Payment Terms"),

      { fieldname: "sec_bank", fieldtype: "Section Break", label: "Bank" },
      f("bank_name", "Data", "Bank Name"),
      f("bank_account_number", "Data", "Bank Account Number"),
      f("bank_ifsc", "Data", "IFSC / SWIFT"),
      f("bank_branch", "Data", "Bank Branch"),

      { fieldname: "sec_direct", fieldtype: "Section Break", label: "Direct Supplier" },
      f("manufacturing_plant", "Data", "Manufacturing Plant"),
      f("factory_address", "Small Text", "Factory Address"),
      f("production_capacity", "Data", "Production Capacity"),
      f("monthly_capacity", "Data", "Monthly Capacity"),
      f("lead_time", "Data", "Lead Time"),
      f("moq", "Data", "MOQ"),
      f("quality_certifications", "Small Text", "Quality Certifications"),
      f("iso_certified", "Check", "ISO", { default: "0" }),
      f("iatf_certified", "Check", "IATF", { default: "0" }),
      f("production_process", "Small Text", "Production Process"),
      f("machine_list", "Small Text", "Machine List"),
      f("material_categories", "Small Text", "Material Categories"),
      f("countries_exported", "Small Text", "Countries Exported"),

      { fieldname: "sec_indirect", fieldtype: "Section Break", label: "Indirect Supplier" },
      f("business_type", "Data", "Business Type"),
      f("service_area", "Data", "Service Area"),
      f("delivery_coverage", "Data", "Delivery Coverage"),
      f("support_availability", "Data", "Support Availability"),
      f("amc_available", "Check", "AMC Available", { default: "0" }),
      f("sla_available", "Check", "SLA Available", { default: "0" }),
      f("contract_duration", "Data", "Contract Duration"),

      { fieldname: "sec_category_json", fieldtype: "Section Break", label: "Category Details" },
      f("form_data", "Long Text", "Category Form Data (JSON)"),

      { fieldname: "sec_approval", fieldtype: "Section Break", label: "Approval" },
      f("approval_stage", "Data", "Current Approval Stage"),
      {
        fieldname: "approval_status",
        fieldtype: "Select",
        label: "Approval Status",
        options: "Pending\nIn Progress\nApproved\nRejected",
        default: "Pending",
      },
      f("linked_supplier", "Link", "Linked Supplier", { options: "Supplier" }),
      f("portal_user", "Data", "Portal User"),
      f("set_password_link", "Small Text", "Set Password Link"),
      f("requested_change_sections", "Small Text", "Requested Change Sections"),

      { fieldname: "sec_tables", fieldtype: "Section Break", label: "Related" },
      f("timeline", "Table", "Timeline", { options: "Supplier Onboarding Timeline" }),
      f("documents", "Table", "Documents", { options: "Supplier Onboarding Document" }),
      f("approvals", "Table", "Approvals", { options: "Supplier Onboarding Approval" }),
      f("discussion", "Table", "Discussion", { options: "Onboarding Discussion" }),
      f("unread_for_procurement", "Int", "Unread for Procurement", { default: "0", read_only: 1 }),
      f("unread_for_supplier", "Int", "Unread for Supplier", { default: "0", read_only: 1 }),
    ],
    permissions: PERMS,
  });
}

async function ensureDiscussionOnExistingParent() {
  if (!(await doctypeExists("Supplier Onboarding"))) return;
  console.log('\nEnsuring discussion fields on "Supplier Onboarding" …');
  await ensureParentField("Supplier Onboarding", {
    fieldname: "discussion",
    fieldtype: "Table",
    label: "Discussion",
    options: "Onboarding Discussion",
  });
  await ensureParentField("Supplier Onboarding", {
    fieldname: "unread_for_procurement",
    fieldtype: "Int",
    label: "Unread for Procurement",
    default: "0",
    read_only: 1,
  });
  await ensureParentField("Supplier Onboarding", {
    fieldname: "unread_for_supplier",
    fieldtype: "Int",
    label: "Unread for Supplier",
    default: "0",
    read_only: 1,
  });
}

async function main() {
  if (!baseUrl || !apiKey || !apiSecret) {
    console.error("Set ERPNEXT_URL, ERP_API_KEY, ERP_API_SECRET in .env");
    process.exit(1);
  }
  console.log("Setting up Supplier Onboarding on", baseUrl);
  await ensureSupplierCategory();
  await ensureTimelineChild();
  await ensureDocumentChild();
  await ensureApprovalChild();
  await ensureDiscussionChild();
  await ensureParent();
  await ensureDiscussionOnExistingParent();
  console.log("\nDone. Supplier Onboarding DocTypes are ready.");
}

main().catch((err) => {
  console.error("\nSetup failed:", err.message || err);
  process.exit(1);
});
