/**
 * Provision BidSphere Item Master procurement fields on ERPNext Item doctype.
 *
 * Usage: node scripts/setup-item-master-procurement.mjs
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

const STOCK_MANAGER = "Stock Manager";
const PURCHASE_MANAGER = "Purchase Manager";

// Typed Procurement Category master — NOT ERPNext Item Groups.
// Direct: Production, Engineering, Packaging, Tooling, Raw Material
// Indirect: MRO, CAPEX, OPEX, Services, Facility, Office Supplies, IT, Housekeeping
const ALL_PROCUREMENT_CATEGORIES = [
  "Production",
  "Engineering",
  "Packaging",
  "Tooling",
  "Raw Material",
  "MRO",
  "CAPEX",
  "OPEX",
  "Services",
  "Facility",
  "Office Supplies",
  "IT",
  "Housekeeping",
].join("\n");

const CUSTOM_FIELDS = [
  {
    dt: "Item",
    fieldname: "custom_procurement_type",
    label: "Procurement Type",
    fieldtype: "Select",
    options: "Direct\nIndirect",
    // No default — type must follow Procurement Category mapping.
    reqd: 1,
    insert_after: "item_group",
    in_list_view: 1,
    in_standard_filter: 1,
  },
  {
    dt: "Item",
    fieldname: "custom_procurement_category",
    label: "Procurement Category",
    fieldtype: "Select",
    options: ALL_PROCUREMENT_CATEGORIES,
    reqd: 1,
    insert_after: "custom_procurement_type",
    in_list_view: 1,
    in_standard_filter: 1,
  },
  {
    dt: "Item",
    fieldname: "custom_bidsphere_item_status",
    label: "BidSphere Item Status",
    fieldtype: "Select",
    options: "Active\nInactive\nObsolete",
    default: "Active",
    insert_after: "custom_procurement_category",
    in_list_view: 1,
    in_standard_filter: 1,
  },
  {
    dt: "Item",
    fieldname: "custom_max_stock",
    label: "Maximum Stock",
    fieldtype: "Float",
    insert_after: "safety_stock",
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
    const updates = {};
    if (field.reqd) updates.reqd = 1;
    if (field.fieldtype === "Select" && field.options) {
      updates.options = field.options;
    }
    // Clear stale defaults (e.g. Procurement Type defaulted to Direct).
    if (!Object.prototype.hasOwnProperty.call(field, "default")) {
      updates.default = "";
    } else if (field.default !== undefined) {
      updates.default = field.default;
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

async function ensureDocPerm(role, parent, perms) {
  const filters = encodeURIComponent(
    JSON.stringify([["role", "=", role], ["parent", "=", parent]]),
  );
  const existing = await api(
    "GET",
    `/api/resource/Custom DocPerm?filters=${filters}&limit_page_length=1`,
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

async function main() {
  if (!baseUrl || !apiKey || !apiSecret) {
    console.error("Missing ERPNEXT_URL / ERP_API_KEY / ERP_API_SECRET in .env");
    process.exit(1);
  }

  console.log("BidSphere Item Master procurement setup");
  console.log(`Target: ${baseUrl}`);

  for (const field of CUSTOM_FIELDS) {
    await ensureCustomField(field);
  }

  await ensureDocPerm(STOCK_MANAGER, "Item", {
    read: 1,
    write: 1,
    create: 1,
  });
  await ensureDocPerm(PURCHASE_MANAGER, "Item", {
    read: 1,
    write: 1,
    create: 1,
  });

  console.log("\nDone. Item Master procurement fields are ready.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
