import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const base = (process.env.ERPNEXT_URL || process.env.VITE_ERPNEXT_URL || process.env.VITE_PROXY_TARGET || "").replace(/\/+$/, "");
const auth = `token ${process.env.ERP_API_KEY || process.env.VITE_API_KEY}:${process.env.ERP_API_SECRET || process.env.VITE_API_SECRET}`;

async function api(path) {
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: auth, Accept: "application/json" },
  });
  return res.json();
}

async function run() {
  const rfqId = "PUR-RFQ-2026-00089";
  const sqRes = await api(
    `/api/resource/Supplier Quotation?filters=${encodeURIComponent(
      JSON.stringify([["items.request_for_quotation", "=", rfqId]])
    )}&fields=${encodeURIComponent(JSON.stringify(["name", "supplier", "supplier_name", "grand_total", "docstatus", "status", "creation"]))}&order_by=creation%20asc`
  );
  console.log("Found", sqRes.data?.length, "Supplier Quotations:");
  for (const sq of sqRes.data || []) {
    console.log(sq);
  }
}
run();
