/**
 * Creates / updates BidSphere RFI response tracking on ERPNext:
 *   1. DocType "RFI Response" — live supplier submission payload
 *   2. Tracking fields on child table "RFI Supplier"
 *        - response_status, submitted_on, documents_count, response_ref
 *
 * Usage: node scripts/setup-rfi-response-doctype.mjs
 * Requires .env: ERPNEXT_URL / VITE_ERPNEXT_URL, ERP_API_KEY, ERP_API_SECRET
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

const RESPONSE_DOCTYPE = "RFI Response";
const SUPPLIER_CHILD = "RFI Supplier";

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

const RESPONSE_FIELDS = [
  {
    fieldname: "rfi",
    label: "RFI",
    fieldtype: "Link",
    options: "RFI",
    reqd: 1,
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
    fieldname: "supplier_name",
    label: "Supplier Name",
    fieldtype: "Data",
    in_list_view: 1,
    fetch_from: "supplier.supplier_name",
    read_only: 1,
  },
  {
    fieldname: "status",
    label: "Status",
    fieldtype: "Select",
    options: "Pending\nSubmitted",
    default: "Pending",
    reqd: 1,
    in_list_view: 1,
    in_standard_filter: 1,
  },
  {
    fieldname: "submitted_at",
    label: "Submitted On",
    fieldtype: "Datetime",
    in_list_view: 1,
  },
  {
    fieldname: "submitted_by",
    label: "Submitted By",
    fieldtype: "Data",
  },
  {
    fieldname: "documents_count",
    label: "Documents",
    fieldtype: "Int",
    default: "0",
    in_list_view: 1,
  },
  {
    fieldname: "completion_pct",
    label: "Completion %",
    fieldtype: "Int",
    default: "0",
  },
  {
    fieldname: "response_locked",
    label: "Response Locked",
    fieldtype: "Check",
    default: "0",
  },
  {
    fieldname: "review_status",
    label: "Review Status",
    fieldtype: "Select",
    options: "\nUnder Review\nApproved\nRejected",
  },
  {
    fieldname: "additional_comments",
    label: "Additional Comments",
    fieldtype: "Small Text",
  },
  {
    fieldname: "answers_json",
    label: "Answers (JSON)",
    fieldtype: "Long Text",
  },
  {
    fieldname: "documents_json",
    label: "Documents (JSON)",
    fieldtype: "Long Text",
  },
  {
    fieldname: "company_snapshot_json",
    label: "Company Snapshot (JSON)",
    fieldtype: "Long Text",
  },
  {
    fieldname: "internal_notes",
    label: "Internal Notes",
    fieldtype: "Small Text",
  },
];

const CHILD_TRACKING_FIELDS = [
  {
    fieldname: "response_status",
    label: "Response Status",
    fieldtype: "Select",
    options: "Pending\nSubmitted",
    default: "Pending",
    in_list_view: 1,
  },
  {
    fieldname: "submitted_on",
    label: "Submitted On",
    fieldtype: "Datetime",
    in_list_view: 1,
  },
  {
    fieldname: "documents_count",
    label: "Documents",
    fieldtype: "Int",
    default: "0",
    in_list_view: 1,
  },
  {
    fieldname: "response_ref",
    label: "Response Ref",
    fieldtype: "Data",
    read_only: 1,
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
    console.log(`  ✓ ${doctypeName} fields already current`);
  }
}

async function ensureResponseDocType() {
  console.log(`\n[1/2] DocType "${RESPONSE_DOCTYPE}" …`);
  let existing = null;
  try {
    existing = await api(
      "GET",
      `/api/resource/DocType/${encodeURIComponent(RESPONSE_DOCTYPE)}`,
    );
  } catch {
    existing = null;
  }

  if (!existing) {
    await api("POST", "/api/resource/DocType", {
      doctype: "DocType",
      name: RESPONSE_DOCTYPE,
      module: "Buying",
      custom: 1,
      naming_rule: 'By "Naming Series" field',
      autoname: "naming_series:",
      track_changes: 1,
      engine: "InnoDB",
      fields: [
        {
          fieldname: "naming_series",
          label: "Series",
          fieldtype: "Select",
          options: "RFIR-.YYYY.-.#####",
          default: "RFIR-.YYYY.-.#####",
          reqd: 1,
          hidden: 1,
        },
        ...RESPONSE_FIELDS,
      ],
      permissions: [
        {
          role: "System Manager",
          read: 1,
          write: 1,
          create: 1,
          delete: 1,
          report: 1,
          export: 1,
        },
        {
          role: "Purchase Manager",
          read: 1,
          write: 1,
          create: 1,
          delete: 1,
          report: 1,
          export: 1,
        },
        {
          role: "Purchase User",
          read: 1,
          write: 1,
          create: 1,
          report: 1,
          export: 1,
        },
        { role: "Supplier", read: 1, write: 1, create: 1 },
      ],
    });
    console.log("  ✓ Created");
    return;
  }

  await ensureFields(RESPONSE_DOCTYPE, RESPONSE_FIELDS);
}

async function ensureSupplierChildTracking() {
  console.log(`\n[2/2] Child tracking fields on "${SUPPLIER_CHILD}" …`);
  try {
    await api(
      "GET",
      `/api/resource/DocType/${encodeURIComponent(SUPPLIER_CHILD)}`,
    );
  } catch {
    console.warn(
      `  ! "${SUPPLIER_CHILD}" missing — run scripts/setup-rfi-doctype.mjs first`,
    );
    return;
  }
  await ensureFields(SUPPLIER_CHILD, CHILD_TRACKING_FIELDS);
}

async function main() {
  console.log("BidSphere RFI Response sync setup");
  console.log("ERPNext:", baseUrl);
  await ensureResponseDocType();
  await ensureSupplierChildTracking();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
