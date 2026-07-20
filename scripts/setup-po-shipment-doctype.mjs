/**
 * Ensures ERPNext DocType "PO Shipment" — shared Supplier ↔ Warehouse SSoT.
 *
 * Usage: node scripts/setup-po-shipment-doctype.mjs
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
    throw new Error(`${method} ${path} → ${res.status}: ${data?.exc_type ?? text}`);
  }
  return data;
}

const name = "PO Shipment";
console.log(`Ensuring DocType "${name}"…`);

try {
  await api("GET", `/api/resource/DocType/${encodeURIComponent(name)}`);
  console.log("✓ Already exists");
  process.exit(0);
} catch {
  /* create */
}

const statusOptions = [
  "Pending Acceptance",
  "Accepted",
  "Rejected",
  "In Transit",
  "Delivered",
  "Arrived",
  "Partially Received",
  "Completed",
].join("\n");

await api("POST", "/api/resource/DocType", {
  doctype: "DocType",
  name,
  module: "Buying",
  custom: 1,
  istable: 0,
  track_changes: 1,
  autoname: "hash",
  fields: [
    {
      fieldname: "po_name",
      label: "Purchase Order",
      fieldtype: "Link",
      options: "Purchase Order",
      reqd: 1,
      unique: 1,
      in_list_view: 1,
    },
    {
      fieldname: "supplier",
      label: "Supplier",
      fieldtype: "Link",
      options: "Supplier",
      in_list_view: 1,
    },
    {
      fieldname: "shipment_status",
      label: "Shipment Status",
      fieldtype: "Select",
      options: statusOptions,
      reqd: 1,
      default: "Pending Acceptance",
      in_list_view: 1,
    },
    { fieldname: "supplier_status", label: "Supplier Status", fieldtype: "Data" },
    { fieldname: "supplier_accepted", label: "Supplier Accepted", fieldtype: "Check", default: "0" },
    { fieldname: "supplier_acceptance_date", label: "Supplier Acceptance Date", fieldtype: "Datetime" },
    { fieldname: "rejection_reason", label: "Rejection Reason", fieldtype: "Small Text" },
    { fieldname: "rejected_date", label: "Rejected Date", fieldtype: "Datetime" },
    {
      fieldname: "expected_delivery_date",
      label: "Expected Delivery Date",
      fieldtype: "Date",
      in_list_view: 1,
    },
    { fieldname: "vehicle_number", label: "Vehicle Number", fieldtype: "Data", in_list_view: 1 },
    { fieldname: "tracking_number", label: "Tracking Number", fieldtype: "Data", in_list_view: 1 },
    { fieldname: "shipping_notes", label: "Shipping Notes", fieldtype: "Small Text" },
    { fieldname: "dispatch_date", label: "Dispatch Date", fieldtype: "Datetime" },
    { fieldname: "ready_for_grn", label: "Ready for GRN", fieldtype: "Check", default: "0", in_list_view: 1 },
    { fieldname: "warehouse_visible", label: "Warehouse Visible", fieldtype: "Check", default: "0", in_list_view: 1 },
    { fieldname: "updated_by", label: "Updated By", fieldtype: "Data" },
  ],
  permissions: [
    { role: "System Manager", read: 1, write: 1, create: 1, delete: 1 },
    { role: "Purchase Manager", read: 1, write: 1, create: 1, delete: 0 },
    { role: "Purchase User", read: 1, write: 1, create: 1, delete: 0 },
    { role: "Stock User", read: 1, write: 0, create: 0, delete: 0 },
    { role: "Stock Manager", read: 1, write: 0, create: 0, delete: 0 },
  ],
});

console.log("✓ Created");
