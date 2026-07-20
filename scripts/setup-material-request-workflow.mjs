/**
 * Provision BidSphere Material Request workflow on ERPNext:
 * - Custom fields on Material Request
 * - Role permissions for Department User, Stock User, Purchase User
 *
 * Usage: node scripts/setup-material-request-workflow.mjs
 *
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
).replace(/\/$/, "");

const apiKey = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
const apiSecret = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";

const DEPARTMENT_USER = "Department User";
const STOCK_MANAGER = "Stock Manager";
const PURCHASE_MANAGER = "Purchase Manager";

const CUSTOM_FIELDS = [
  {
    dt: "Material Request",
    fieldname: "custom_bidsphere_status",
    label: "BidSphere Status",
    fieldtype: "Select",
    options:
      "Draft\nSubmitted\nAdmin Review\nUnder Warehouse Review\nStock Available\nMaterial Issued\nForwarded to Procurement\nProcurement Required\nRFQ Created\nCompleted\nRejected\nCancelled",
    insert_after: "status",
    in_list_view: 1,
    allow_on_submit: 1,
  },
  {
    dt: "Material Request",
    fieldname: "custom_procurement_type",
    label: "Request Type",
    fieldtype: "Select",
    options: "Direct\nIndirect",
    default: "Direct",
    insert_after: "custom_bidsphere_status",
    in_list_view: 1,
    in_standard_filter: 1,
    allow_on_submit: 1,
  },
  {
    dt: "Material Request",
    fieldname: "custom_request_mode",
    label: "Request Mode",
    fieldtype: "Select",
    options: "Existing\nNew",
    default: "Existing",
    insert_after: "custom_procurement_type",
    in_list_view: 1,
    in_standard_filter: 1,
    allow_on_submit: 1,
  },
  {
    dt: "Material Request",
    fieldname: "custom_department",
    label: "Department",
    fieldtype: "Data",
    insert_after: "custom_request_mode",
  },
  {
    dt: "Material Request",
    fieldname: "custom_priority",
    label: "Priority",
    fieldtype: "Select",
    options: "Low\nMedium\nHigh\nUrgent",
    insert_after: "custom_department",
  },
  {
    dt: "Material Request",
    fieldname: "custom_requested_by",
    label: "Requested By",
    fieldtype: "Data",
    insert_after: "custom_priority",
  },
  {
    dt: "Material Request",
    fieldname: "custom_purpose",
    label: "Purpose",
    fieldtype: "Small Text",
    insert_after: "custom_requested_by",
  },
  {
    dt: "Material Request",
    fieldname: "custom_warehouse_remarks",
    label: "Warehouse Remarks",
    fieldtype: "Small Text",
    insert_after: "custom_purpose",
    allow_on_submit: 1,
  },
  {
    dt: "Material Request",
    fieldname: "custom_procurement_remarks",
    label: "Procurement Remarks",
    fieldtype: "Small Text",
    insert_after: "custom_warehouse_remarks",
    allow_on_submit: 1,
  },
  {
    dt: "Material Request",
    fieldname: "custom_admin_remarks",
    label: "Admin Remarks",
    fieldtype: "Small Text",
    insert_after: "custom_procurement_remarks",
    allow_on_submit: 1,
  },
  {
    dt: "Material Request",
    fieldname: "custom_linked_rfq",
    label: "Linked RFQ",
    fieldtype: "Link",
    options: "Request for Quotation",
    insert_after: "custom_admin_remarks",
    read_only: 1,
    allow_on_submit: 1,
  },
  // Per-item engineering metadata (Items Required table). Optional; stays on
  // the Material Request Item child so Warehouse / Procurement / RFQ inherit it.
  {
    dt: "Material Request Item",
    fieldname: "custom_part_name",
    label: "Part Name",
    fieldtype: "Data",
    insert_after: "description",
    allow_on_submit: 1,
  },
  {
    dt: "Material Request Item",
    fieldname: "custom_2d_drawing",
    label: "2D Drawing",
    fieldtype: "Attach",
    insert_after: "custom_part_name",
    allow_on_submit: 1,
  },
  {
    dt: "Material Request Item",
    fieldname: "custom_engineering_attachments",
    label: "Engineering Attachments",
    fieldtype: "Long Text",
    insert_after: "custom_2d_drawing",
    allow_on_submit: 1,
  },
  // RFQ Item — same Part Name + attachments so MR→RFQ create can carry
  // file URLs for Procurement / Supplier read-only visibility (no re-upload).
  {
    dt: "Request for Quotation Item",
    fieldname: "custom_part_name",
    label: "Part Name",
    fieldtype: "Data",
    insert_after: "description",
    allow_on_submit: 1,
  },
  {
    dt: "Request for Quotation Item",
    fieldname: "custom_2d_drawing",
    label: "2D Drawing",
    fieldtype: "Attach",
    insert_after: "custom_part_name",
    allow_on_submit: 1,
  },
  {
    dt: "Request for Quotation Item",
    fieldname: "custom_engineering_attachments",
    label: "Engineering Attachments",
    fieldtype: "Long Text",
    insert_after: "custom_2d_drawing",
    allow_on_submit: 1,
  },
];

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
    const msg = JSON.stringify(data);
    if (msg.includes("Duplicate") || msg.includes("already exists")) {
      return { skipped: true };
    }
    throw new Error(`${method} ${path} (${res.status}): ${msg}`);
  }
  return data?.data ?? data?.message ?? data;
}

async function ensureCustomField(field) {
  const name = `${field.dt}-${field.fieldname}`;
  try {
    await api("GET", `/api/resource/Custom Field/${encodeURIComponent(name)}`);
    // Keep the field's schema in sync on re-run. Critically, Select `options`
    // must be updated for existing fields — otherwise ERPNext rejects writes of
    // any new status value (e.g. "Stock Available", "Procurement Required",
    // "Cancelled") that isn't already in the field's option list.
    const updates = {};
    if (field.allow_on_submit) updates.allow_on_submit = 1;
    if (field.fieldtype === "Select" && field.options) {
      updates.options = field.options;
    }
    if (Object.keys(updates).length > 0) {
      await api(
        "PUT",
        `/api/resource/Custom Field/${encodeURIComponent(name)}`,
        updates,
      );
      console.log(
        `✓ Custom Field updated (${Object.keys(updates).join(", ")}): ${field.fieldname}`,
      );
    } else {
      console.log(`✓ Custom Field exists: ${field.fieldname}`);
    }
  } catch {
    console.log(`• Creating Custom Field: ${field.fieldname}`);
    await api("POST", "/api/resource/Custom Field", {
      doctype: "Custom Field",
      ...field,
    });
  }
}

async function ensureRole(roleName) {
  try {
    await api("GET", `/api/resource/Role/${encodeURIComponent(roleName)}`);
    console.log(`✓ Role exists: ${roleName}`);
  } catch {
    console.log(`• Creating role: ${roleName}`);
    await api("POST", "/api/resource/Role", {
      doctype: "Role",
      role_name: roleName,
      desk_access: 1,
    });
  }
}

async function ensureDocPerm(role, parent, perms) {
  const filters = encodeURIComponent(
    JSON.stringify([["role", "=", role], ["parent", "=", parent]])
  );
  const existing = await api(
    "GET",
    `/api/resource/Custom DocPerm?filters=${filters}&limit_page_length=1`
  );
  const rows = Array.isArray(existing) ? existing : [];
  const payload = { doctype: "Custom DocPerm", role, parent, permlevel: 0, ...perms };
  if (rows.length > 0) {
    await api("PUT", `/api/resource/Custom DocPerm/${rows[0].name}`, payload);
    console.log(`✓ Updated permissions: ${role} → ${parent}`);
  } else {
    await api("POST", "/api/resource/Custom DocPerm", payload);
    console.log(`• Added permissions: ${role} → ${parent}`);
  }
}

async function ensureDocTypeWarehouseReview() {
  try {
    await api("GET", `/api/resource/DocType/${encodeURIComponent("Warehouse Review")}`);
    console.log(`✓ DocType exists: Warehouse Review`);
  } catch {
    console.log(`• Creating DocType: Warehouse Review`);
    try {
      await api("POST", "/api/resource/DocType", {
        doctype: "DocType",
        name: "Warehouse Review",
        module: "Stock",
        custom: 1,
        is_submittable: 0,
        fields: [
          { fieldname: "material_request", label: "Material Request", fieldtype: "Link", options: "Material Request", reqd: 1, in_list_view: 1 },
          { fieldname: "warehouse_remarks", label: "Warehouse Remarks", fieldtype: "Small Text", in_list_view: 1 },
          { fieldname: "decision", label: "Decision", fieldtype: "Select", options: "Material Issued\nPartially Issued\nForwarded to Procurement\nRejected", in_list_view: 1 },
          { fieldname: "issued_qty", label: "Issued Qty", fieldtype: "Float" },
          { fieldname: "remaining_qty", label: "Remaining Qty", fieldtype: "Float" },
          { fieldname: "forwarded_qty", label: "Forwarded Qty", fieldtype: "Float" },
          { fieldname: "review_date", label: "Review Date", fieldtype: "Date" },
          { fieldname: "warehouse_user", label: "Warehouse User", fieldtype: "Data" }
        ],
        permissions: [{ role: STOCK_MANAGER, read: 1, write: 1, create: 1 }]
      });
      console.log(`✓ DocType created: Warehouse Review`);
    } catch (e) {
      console.log(`• Note: DocType Warehouse Review creation skipped/not permitted via API: ${e.message}`);
    }
  }
}

async function main() {
  if (!baseUrl || !apiKey || !apiSecret) {
    console.error("Set ERPNEXT_URL, ERP_API_KEY, ERP_API_SECRET in .env");
    process.exit(1);
  }

  console.log(`\nBidSphere Material Request workflow setup → ${baseUrl}\n`);

  for (const field of CUSTOM_FIELDS) {
    await ensureCustomField(field);
  }

  await ensureDocTypeWarehouseReview();

  await ensureRole(DEPARTMENT_USER);

  // Department User — create, edit draft, submit, read own
  await ensureDocPerm(DEPARTMENT_USER, "Material Request", {
    read: 1,
    write: 1,
    create: 1,
    submit: 1,
    cancel: 0,
    delete: 0,
  });
  await ensureDocPerm(DEPARTMENT_USER, "Material Request Item", { read: 1, write: 1, create: 1 });

  // Warehouse / API integration (Stock Manager) — full MR lifecycle via token auth.
  // The Vite/Vercel proxy authenticates all app API calls with the integration
  // API key (not the logged-in user's session), so this role must be able to
  // create, submit, and update MRs on behalf of department & warehouse users.
  await ensureDocPerm(STOCK_MANAGER, "Material Request", {
    read: 1,
    write: 1,
    create: 1,
    submit: 1,
    cancel: 0,
    delete: 0,
  });
  await ensureDocPerm(STOCK_MANAGER, "Material Request Item", {
    read: 1,
    write: 1,
    create: 1,
  });
  await ensureDocPerm(STOCK_MANAGER, "Stock Entry", {
    read: 1,
    write: 1,
    create: 1,
    submit: 1,
  });
  await ensureDocPerm(STOCK_MANAGER, "Bin", { read: 1 });
  await ensureDocPerm(STOCK_MANAGER, "Item Reorder", { read: 1 });

  // Procurement — read forwarded MRs, create RFQ (RFQ perms assumed existing)
  await ensureDocPerm(PURCHASE_MANAGER, "Material Request", {
    read: 1,
    write: 0,
    create: 0,
    submit: 0,
  });

  console.log("\n✅ Material Request workflow setup complete.");
  console.log("Run: node scripts/provision-role-users.mjs to add department@netlink.com");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
