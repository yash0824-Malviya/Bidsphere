/**
 * Diagnose Warehouse Receive Goods queue vs PO Shipment SSoT.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

const baseUrl = (
  process.env.ERPNEXT_URL ||
  process.env.VITE_PROXY_TARGET ||
  process.env.VITE_ERPNEXT_URL ||
  ""
).replace(/\/+$/, "");
const key = process.env.ERP_API_KEY || process.env.VITE_API_KEY || "";
const secret = process.env.ERP_API_SECRET || process.env.VITE_API_SECRET || "";

async function list(doctype, filters, fields, limit = 50) {
  const url = new URL(`${baseUrl}/api/resource/${encodeURIComponent(doctype)}`);
  url.searchParams.set("filters", JSON.stringify(filters));
  url.searchParams.set("fields", JSON.stringify(fields));
  url.searchParams.set("limit_page_length", String(limit));
  url.searchParams.set("order_by", "modified desc");
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${key}:${secret}`,
      Accept: "application/json",
    },
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, data: json.data ?? [] };
}

const openPos = await list(
  "Purchase Order",
  [
    ["docstatus", "=", 1],
    ["status", "in", ["To Receive", "To Receive and Bill"]],
  ],
  [
    "name",
    "status",
    "schedule_date",
    "per_received",
    "supplier_name",
  ],
  50,
);

const shipments = await list(
  "PO Shipment",
  [],
  [
    "po_name",
    "shipment_status",
    "ready_for_grn",
    "warehouse_visible",
    "expected_delivery_date",
    "vehicle_number",
    "tracking_number",
  ],
  50,
);

const shipByPo = new Map((shipments.data || []).map((s) => [s.po_name, s]));

console.log("=== Open To Receive / To Receive and Bill POs (base queue) ===");
console.log("count", (openPos.data || []).length);
for (const p of openPos.data || []) {
  const ship = shipByPo.get(p.name);
  const fullyReceived = (p.per_received ?? 0) >= 100;
  console.log({
    po: p.name,
    po_status: p.status,
    schedule_date: p.schedule_date,
    per_received: p.per_received,
    shipment_status: ship?.shipment_status ?? "(none — historical / not shipped)",
    ready_for_grn: ship?.ready_for_grn ?? null,
    visible_in_receive_goods: !fullyReceived,
  });
}

console.log("\n=== PO Shipment rows ===");
console.log("count", (shipments.data || []).length, shipments.data);
