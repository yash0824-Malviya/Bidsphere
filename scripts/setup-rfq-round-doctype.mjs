/**
 * Creates / updates ERPNext DocTypes for Enterprise RFQ Quote Rounds.
 *
 * DocTypes:
 *   - RFQ Round Item          (child)
 *   - RFQ Round Supplier      (child)
 *   - RFQ Round Change Log    (child)
 *   - RFQ Round               (parent)
 *
 * Custom fields:
 *   - Request for Quotation.custom_active_rfq_round
 *   - Request for Quotation.custom_current_round_number
 *   - Supplier Quotation.custom_rfq_round
 *
 * Usage: node scripts/setup-rfq-round-doctype.mjs
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

// Keep in sync with RFQ_ROUND_REASON_CODES in src/api/rfqQuoteRound.ts
const REASON_CODE_OPTIONS = [
  "Engineering Change",
  "New Parts Added",
  "Parts Removed",
  "Quantity Changed",
  "Drawing Revision",
  "Specification Changed",
  "Commercial Revision",
  "New Supplier Added",
  "Supplier Removed",
  "Price Negotiation",
  "Delivery Schedule Changed",
  "Initial RFQ",
  "Other",
].join("\n");

const ROUND_STATUS_OPTIONS = "Draft\nActive\nClosed\nCancelled";

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

async function doctypeExists(name) {
  try {
    await api("GET", `/api/resource/DocType/${encodeURIComponent(name)}`);
    return true;
  } catch {
    return false;
  }
}

async function ensureChildTable(name, fields) {
  console.log(`\n• DocType "${name}" …`);
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
    fields,
    permissions: [
      { role: "System Manager", read: 1, write: 1, create: 1, delete: 1 },
    ],
  });
  console.log("  ✓ Created");
}

async function ensureRfqRoundItem() {
  await ensureChildTable("RFQ Round Item", [
    { fieldname: "item_code", fieldtype: "Link", options: "Item", label: "Item Code", in_list_view: 1, reqd: 1 },
    { fieldname: "item_name", fieldtype: "Data", label: "Item Name", in_list_view: 1 },
    { fieldname: "description", fieldtype: "Text", label: "Description" },
    { fieldname: "qty", fieldtype: "Float", label: "Qty", in_list_view: 1, reqd: 1, default: "1" },
    { fieldname: "uom", fieldtype: "Link", options: "UOM", label: "UOM", default: "Nos" },
    { fieldname: "schedule_date", fieldtype: "Date", label: "Required Date" },
    { fieldname: "warehouse", fieldtype: "Link", options: "Warehouse", label: "Warehouse" },
    { fieldname: "custom_part_name", fieldtype: "Data", label: "Part Name" },
    { fieldname: "custom_2d_drawing", fieldtype: "Data", label: "2D Drawing" },
    { fieldname: "custom_engineering_attachments", fieldtype: "Small Text", label: "Engineering Attachments" },
    { fieldname: "custom_target_price", fieldtype: "Currency", label: "Target Price" },
    { fieldname: "custom_procurement_final_qty", fieldtype: "Float", label: "Procurement Final Qty" },
    { fieldname: "custom_qty_change_reason", fieldtype: "Small Text", label: "Qty Change Reason" },
    { fieldname: "source_rfq_item", fieldtype: "Data", label: "Source RFQ Item Row" },
  ]);
}

async function ensureRfqRoundSupplier() {
  await ensureChildTable("RFQ Round Supplier", [
    { fieldname: "supplier", fieldtype: "Link", options: "Supplier", label: "Supplier", in_list_view: 1, reqd: 1 },
    { fieldname: "supplier_name", fieldtype: "Data", label: "Supplier Name", in_list_view: 1 },
    { fieldname: "email_id", fieldtype: "Data", label: "Email" },
    { fieldname: "contact", fieldtype: "Link", options: "Contact", label: "Contact" },
    { fieldname: "send_email", fieldtype: "Check", label: "Send Email", default: "1" },
    { fieldname: "quote_status", fieldtype: "Select", label: "Quote Status", options: "Pending\nReceived\nNo Quote", default: "Pending" },
    { fieldname: "source_rfq_supplier", fieldtype: "Data", label: "Source RFQ Supplier Row" },
  ]);
}

async function ensureRfqRoundChangeLog() {
  await ensureChildTable("RFQ Round Change Log", [
    { fieldname: "change_type", fieldtype: "Data", label: "Change Type", in_list_view: 1 },
    { fieldname: "reason_code", fieldtype: "Select", label: "Reason Code", options: REASON_CODE_OPTIONS, in_list_view: 1 },
    { fieldname: "remarks", fieldtype: "Small Text", label: "Remarks", in_list_view: 1 },
    { fieldname: "changed_by", fieldtype: "Data", label: "Changed By", in_list_view: 1 },
    { fieldname: "changed_on", fieldtype: "Datetime", label: "Changed On", in_list_view: 1 },
  ]);
}

const RFQ_ROUND_FIELDS = [
  { fieldname: "rfq", label: "Request for Quotation", fieldtype: "Link", options: "Request for Quotation", reqd: 1, in_list_view: 1, in_standard_filter: 1 },
  { fieldname: "round_number", label: "Round Number", fieldtype: "Int", reqd: 1, in_list_view: 1 },
  { fieldname: "tracking_id", label: "Tracking ID", fieldtype: "Data", reqd: 1, unique: 1, in_list_view: 1, in_standard_filter: 1 },
  { fieldname: "previous_round", label: "Previous Round", fieldtype: "Link", options: "RFQ Round" },
  { fieldname: "reason_code", label: "Reason Code", fieldtype: "Select", options: REASON_CODE_OPTIONS, reqd: 1, in_list_view: 1 },
  // Prefer singular `remark` to match existing BidSphere ERP installs; API also accepts legacy `remarks`.
  { fieldname: "remark", label: "Remark", fieldtype: "Small Text", reqd: 1 },
  { fieldname: "status", label: "Status", fieldtype: "Select", options: ROUND_STATUS_OPTIONS, default: "Draft", reqd: 1, in_list_view: 1, in_standard_filter: 1 },
  { fieldname: "created_by", label: "Created By", fieldtype: "Data", in_list_view: 1 },
  { fieldname: "created_on", label: "Created On", fieldtype: "Datetime" },
  { fieldname: "is_latest", label: "Is Latest", fieldtype: "Check", default: "1" },
  { fieldname: "section_commercial", fieldtype: "Section Break", label: "Commercial" },
  { fieldname: "message_for_supplier", label: "Message for Supplier", fieldtype: "Text Editor" },
  { fieldname: "terms", label: "Terms", fieldtype: "Text Editor" },
  { fieldname: "valid_till", label: "Valid Till", fieldtype: "Date" },
  { fieldname: "section_items", fieldtype: "Section Break", label: "Items" },
  { fieldname: "items", label: "Items", fieldtype: "Table", options: "RFQ Round Item" },
  { fieldname: "section_suppliers", fieldtype: "Section Break", label: "Suppliers" },
  { fieldname: "suppliers", label: "Suppliers", fieldtype: "Table", options: "RFQ Round Supplier" },
  { fieldname: "section_change_log", fieldtype: "Section Break", label: "Change Log" },
  { fieldname: "change_log", label: "Change Log", fieldtype: "Table", options: "RFQ Round Change Log" },
];

async function ensureRfqRoundParent() {
  const name = "RFQ Round";
  console.log(`\n• DocType "${name}" …`);
  if (await doctypeExists(name)) {
    const existing = await api(
      "GET",
      `/api/resource/DocType/${encodeURIComponent(name)}`,
    );
    const have = new Set(
      (existing.fields || []).map((f) => f.fieldname).filter(Boolean),
    );
    // Keep either remark or remarks; only add remark when neither exists.
    const missing = RFQ_ROUND_FIELDS.filter((f) => {
      if (f.fieldname === "remark" && (have.has("remark") || have.has("remarks"))) {
        return false;
      }
      if (f.fieldname === "created_by" && (have.has("created_by") || have.has("created_by_user"))) {
        return false;
      }
      return !have.has(f.fieldname);
    });
    if (missing.length === 0) {
      console.log("  ✓ Already exists (fields up to date)");
      return;
    }
    const nextFields = [...(existing.fields || []), ...missing];
    await api("PUT", `/api/resource/DocType/${encodeURIComponent(name)}`, {
      fields: nextFields,
    });
    console.log(
      `  ✓ Updated — added fields: ${missing.map((f) => f.fieldname).join(", ")}`,
    );
    return;
  }

  await api("POST", "/api/resource/DocType", {
    doctype: "DocType",
    name,
    module: "Buying",
    custom: 1,
    naming_rule: "Expression (old style)",
    autoname: "format:{tracking_id}",
    track_changes: 1,
    allow_rename: 0,
    fields: RFQ_ROUND_FIELDS,
    permissions: [
      { role: "System Manager", read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1 },
      { role: "Purchase Manager", read: 1, write: 1, create: 1, report: 1, export: 1 },
      { role: "Purchase User", read: 1, write: 1, create: 1, report: 1 },
      { role: "Supplier", read: 1 },
    ],
  });
  console.log("  ✓ Created");
}

async function ensureCustomField(dt, field) {
  const fieldname = field.fieldname;
  try {
    await api("GET", `/api/resource/Custom Field/${encodeURIComponent(`${dt}-${fieldname}`)}`);
    console.log(`  ✓ Custom Field ${dt}.${fieldname} exists`);
    return;
  } catch {
    /* create */
  }
  await api("POST", "/api/resource/Custom Field", {
    doctype: "Custom Field",
    dt,
    ...field,
  });
  console.log(`  ✓ Created Custom Field ${dt}.${fieldname}`);
}

async function ensureCustomFields() {
  console.log("\n• Custom fields …");
  await ensureCustomField("Request for Quotation", {
    fieldname: "custom_active_rfq_round",
    label: "Active RFQ Round",
    fieldtype: "Link",
    options: "RFQ Round",
    insert_after: "status",
    read_only: 1,
  });
  await ensureCustomField("Request for Quotation", {
    fieldname: "custom_current_round_number",
    label: "Current Round Number",
    fieldtype: "Int",
    insert_after: "custom_active_rfq_round",
    read_only: 1,
    default: "1",
  });
  await ensureCustomField("Supplier Quotation", {
    fieldname: "custom_rfq_round",
    label: "RFQ Quote Round",
    fieldtype: "Link",
    options: "RFQ Round",
    insert_after: "request_for_quotation",
  });
}

async function main() {
  if (!baseUrl || !apiKey || !apiSecret) {
    console.error("Set ERPNEXT_URL, ERP_API_KEY, ERP_API_SECRET in .env");
    process.exit(1);
  }
  await ensureRfqRoundItem();
  await ensureRfqRoundSupplier();
  await ensureRfqRoundChangeLog();
  await ensureRfqRoundParent();
  await ensureCustomFields();
  console.log("\n✅ RFQ Round setup complete.");
}

main().catch((err) => {
  console.error("❌ Setup failed:", err.message);
  process.exit(1);
});
