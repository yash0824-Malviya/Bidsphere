import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  const envPath = resolve(".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const [k, ...v] = t.split("=");
    if (!process.env[k.trim()]) process.env[k.trim()] = v.join("=").trim().replace(/^['"](.*)['"]$/, "$1");
  }
}
loadEnv();

const base = (process.env.VITE_ERPNEXT_URL || process.env.ERPNEXT_URL || process.env.VITE_PROXY_TARGET || "").replace(/\/+$/, "");
const auth = `token ${process.env.ERP_API_KEY}:${process.env.ERP_API_SECRET}`;

async function api(path) {
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: auth, Accept: "application/json" },
  });
  return await res.json();
}

async function main() {
  const rfq = await api(`/api/resource/Request%20for%20Quotation/PUR-RFQ-2026-00085`);
  for (const [k, v] of Object.entries(rfq.data || {})) {
    if (k.startsWith("custom_") || k.includes("status") || k.includes("supplier") || k.includes("date")) {
      console.log(`  ${k}:`, v);
    }
  }
}
main().catch(console.error);
