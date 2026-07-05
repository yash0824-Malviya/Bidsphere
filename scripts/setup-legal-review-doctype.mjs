/**
 * Ensures the "Legal Document Review" DocType on ERPNext has every field the
 * BidSphere Supplier Quotation → Legal Review integration needs.
 *
 * Usage: node scripts/setup-legal-review-doctype.mjs
 * Requires .env: ERPNEXT_URL (or VITE_ERPNEXT_URL), ERP_API_KEY, ERP_API_SECRET
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
  const url = `${baseUrl}${path}`;
  const headers = {
    Authorization: `token ${apiKey}:${apiSecret}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      json.exception || json._server_messages || JSON.stringify(json) || res.statusText
    );
  }
  return json.data;
}

/**
 * Fields required by the Supplier Quotation → Legal Review integration.
 * `review_status` already exists but its Select options must include every
 * value the frontend writes ("Pending" was previously missing, which caused
 * every auto-created review to fail with a ValidationError).
 */
const REQUIRED_FIELDS = [
  { fieldname: "company", label: "Company", fieldtype: "Data", insert_after: "supplier" },
  {
    fieldname: "quotation_number",
    label: "Quotation Number",
    fieldtype: "Data",
    insert_after: "sq_name",
    in_list_view: 1,
  },
  {
    fieldname: "procurement_manager",
    label: "Procurement Manager",
    fieldtype: "Data",
    insert_after: "company",
  },
  {
    fieldname: "submission_date",
    label: "Submission Date",
    fieldtype: "Datetime",
    insert_after: "procurement_manager",
    in_list_view: 1,
  },
  {
    fieldname: "workflow_state",
    label: "Workflow State",
    fieldtype: "Data",
    insert_after: "review_status",
    in_list_view: 1,
  },
  {
    fieldname: "grand_total",
    label: "Grand Total",
    fieldtype: "Currency",
    insert_after: "submission_date",
  },
  {
    fieldname: "valid_till",
    label: "Quote Valid Till",
    fieldtype: "Date",
    insert_after: "grand_total",
  },
  {
    fieldname: "payment_terms",
    label: "Payment Terms",
    fieldtype: "Small Text",
    insert_after: "valid_till",
  },
  {
    fieldname: "supplier_notes",
    label: "Supplier Notes",
    fieldtype: "Small Text",
    insert_after: "payment_terms",
  },
  {
    fieldname: "item_summary",
    label: "Item Summary (JSON)",
    fieldtype: "Long Text",
    insert_after: "supplier_notes",
  },
  // ── Approve/Reject decision fields — the DocType is the single source of
  // truth for the review verdict. No client-side storage is ever authoritative.
  {
    fieldname: "approved_by",
    label: "Approved/Rejected By",
    fieldtype: "Data",
    insert_after: "review_status",
    in_list_view: 1,
  },
  {
    fieldname: "approved_on",
    label: "Approved/Rejected On",
    fieldtype: "Datetime",
    insert_after: "approved_by",
    in_list_view: 1,
  },
  {
    fieldname: "legal_comments",
    label: "Legal Comments",
    fieldtype: "Small Text",
    insert_after: "approved_on",
  },
  {
    fieldname: "rejection_reason",
    label: "Rejection Reason",
    fieldtype: "Small Text",
    insert_after: "legal_comments",
  },
  // ── Finance Review decision fields — the SAME record carries both the
  // Legal verdict and the Finance verdict. Finance never gets a separate
  // DocType; `finance_status` only becomes meaningful once `review_status`
  // (Legal) is "Approved" (see api/legalReviewCore.ts: legal approval
  // stamps finance_status = "Pending" on this exact record).
  {
    fieldname: "finance_status",
    label: "Finance Status",
    fieldtype: "Select",
    options: "\nPending\nApproved\nRejected",
    insert_after: "rejection_reason",
    in_list_view: 1,
  },
  {
    fieldname: "finance_approved_by",
    label: "Finance Approved/Rejected By",
    fieldtype: "Data",
    insert_after: "finance_status",
    in_list_view: 1,
  },
  {
    fieldname: "finance_approved_on",
    label: "Finance Approved/Rejected On",
    fieldtype: "Datetime",
    insert_after: "finance_approved_by",
    in_list_view: 1,
  },
  {
    fieldname: "finance_comments",
    label: "Finance Comments",
    fieldtype: "Small Text",
    insert_after: "finance_approved_on",
  },
  {
    fieldname: "finance_rejection_reason",
    label: "Finance Rejection Reason",
    fieldtype: "Small Text",
    insert_after: "finance_comments",
  },
];

async function ensureLegalReviewDocType() {
  console.log(`Checking Legal Document Review DocType on ${baseUrl}...`);
  const doc = await api(
    "GET",
    `/api/resource/DocType/${encodeURIComponent("Legal Document Review")}`
  );
  const fields = doc.fields || [];
  let modified = false;

  const reviewStatusField = fields.find((f) => f.fieldname === "review_status");
  if (reviewStatusField && reviewStatusField.options !== "Pending\nApproved\nRejected") {
    reviewStatusField.options = "Pending\nApproved\nRejected";
    modified = true;
    console.log("• Fixing review_status Select options to include Pending...");
  }

  for (const required of REQUIRED_FIELDS) {
    if (!fields.some((f) => f.fieldname === required.fieldname)) {
      fields.push(required);
      modified = true;
      console.log(`• Adding field ${required.fieldname} to Legal Document Review DocType...`);
    }
  }

  if (modified) {
    await api(
      "PUT",
      `/api/resource/DocType/${encodeURIComponent("Legal Document Review")}`,
      { fields }
    );
    console.log("✅ Legal Document Review DocType updated.");
  } else {
    console.log("✅ Legal Document Review DocType already up to date.");
  }
}

async function ensureRolePermission(role) {
  const filters = encodeURIComponent(
    JSON.stringify([
      ["role", "=", role],
      ["parent", "=", "Legal Document Review"],
    ])
  );
  const existing = await api(
    "GET",
    `/api/resource/Custom DocPerm?filters=${filters}&limit_page_length=1`
  );
  const rows = Array.isArray(existing) ? existing : [];
  const payload = {
    doctype: "Custom DocPerm",
    role,
    parent: "Legal Document Review",
    permlevel: 0,
    read: 1,
    write: 1,
    create: 1,
    report: 1,
    export: 1,
  };
  if (rows.length > 0) {
    console.log(`✓ Permission already exists: ${role} → Legal Document Review`);
    return;
  }
  await api("POST", "/api/resource/Custom DocPerm", payload);
  console.log(`• Added permission: ${role} → Legal Document Review`);
}

async function main() {
  if (!baseUrl || !apiKey || !apiSecret) {
    console.error("Set ERPNEXT_URL, ERP_API_KEY, ERP_API_SECRET in .env");
    process.exit(1);
  }

  await ensureLegalReviewDocType();

  // "System Manager" already has full access; also grant the integration
  // roles used by the app (Legal + Finance both act on this DocType) so
  // token-auth requests never get a 403. The ERPNext role actually assigned
  // to the "Finance Manager" app persona is "Accounts Manager" (see
  // finance@netlink.com's Has Role rows) — there is no ERPNext role literally
  // named "Finance Manager".
  for (const role of ["Purchase Manager", "System Manager", "Accounts Manager", "Accounts User"]) {
    try {
      await ensureRolePermission(role);
    } catch (err) {
      console.warn(`• Note: could not ensure permission for ${role}:`, err.message);
    }
  }

  console.log("\n✅ Legal Document Review setup complete.");
}

main().catch((err) => {
  console.error("❌ Setup failed:", err.message);
  process.exit(1);
});
