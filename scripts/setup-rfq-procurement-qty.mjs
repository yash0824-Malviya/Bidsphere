/**
 * Provisions Procurement Final Quantity custom fields for BidSphere.
 *
 * Creates / updates on Material Request Item + Request for Quotation Item:
 *   - custom_department_requested_qty
 *   - custom_warehouse_available_qty
 *   - custom_procurement_final_qty (RFQ Item only — drives RFQ Item.qty)
 *   - custom_qty_change_reason (RFQ Item)
 *
 * Usage: node scripts/setup-rfq-procurement-qty.mjs
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

async function getCustomField(cfName) {
  try {
    return await api(
      "GET",
      `/api/resource/${encodeURIComponent("Custom Field")}/${encodeURIComponent(cfName)}`,
    );
  } catch {
    return null;
  }
}

async function ensureCustomField(payload) {
  const cfName = `${payload.dt}-${payload.fieldname}`;
  console.log(`\nCustom Field ${payload.fieldname} on ${payload.dt} …`);
  const existing = await getCustomField(cfName);
  if (existing) {
    const needsAllow =
      !existing.allow_on_submit ||
      existing.allow_on_submit === 0 ||
      existing.allow_on_submit === "0";
    if (needsAllow) {
      await api(
        "PUT",
        `/api/resource/${encodeURIComponent("Custom Field")}/${encodeURIComponent(cfName)}`,
        { allow_on_submit: 1 },
      );
      console.log("  ✓ Updated allow_on_submit = 1");
    } else {
      console.log("  ✓ Already exists (allow_on_submit enabled)");
    }
    return;
  }
  await api("POST", "/api/resource/Custom Field", {
    doctype: "Custom Field",
    allow_on_submit: 1,
    ...payload,
  });
  console.log("  ✓ Created (allow_on_submit = 1)");
}

async function main() {
  console.log("BidSphere Procurement Final Quantity setup");
  console.log(`ERPNext: ${baseUrl}`);

  await ensureCustomField({
    dt: "Material Request Item",
    fieldname: "custom_department_requested_qty",
    label: "Department Requested Qty",
    fieldtype: "Float",
    insert_after: "qty",
    allow_on_submit: 1,
    description: "Original quantity requested by the Department (immutable snapshot).",
  });

  await ensureCustomField({
    dt: "Material Request Item",
    fieldname: "custom_warehouse_available_qty",
    label: "Warehouse Available Qty",
    fieldtype: "Float",
    insert_after: "custom_department_requested_qty",
    allow_on_submit: 1,
    description: "Stock available confirmed by Warehouse at review/forward time.",
  });

  await ensureCustomField({
    dt: "Request for Quotation Item",
    fieldname: "custom_department_requested_qty",
    label: "Department Requested Qty",
    fieldtype: "Float",
    insert_after: "qty",
    allow_on_submit: 1,
    description: "Original Department requested quantity (internal only).",
  });

  await ensureCustomField({
    dt: "Request for Quotation Item",
    fieldname: "custom_warehouse_available_qty",
    label: "Warehouse Available Qty",
    fieldtype: "Float",
    insert_after: "custom_department_requested_qty",
    allow_on_submit: 1,
    description: "Warehouse available qty at forward time (internal only).",
  });

  await ensureCustomField({
    dt: "Request for Quotation Item",
    fieldname: "custom_procurement_final_qty",
    label: "Procurement Final Qty",
    fieldtype: "Float",
    insert_after: "custom_warehouse_available_qty",
    allow_on_submit: 1,
    description:
      "Final sourcing quantity set by Procurement. RFQ Item.qty mirrors this value for suppliers and downstream docs.",
  });

  await ensureCustomField({
    dt: "Request for Quotation Item",
    fieldname: "custom_qty_change_reason",
    label: "Qty Change Reason",
    fieldtype: "Small Text",
    insert_after: "custom_procurement_final_qty",
    allow_on_submit: 1,
    description:
      "Reason when Procurement Final Qty differs from Department Requested Qty.",
  });

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
