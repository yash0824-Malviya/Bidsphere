import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadEnv() {
  const envPath = resolve(root, ".env");
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

const base = (
  process.env.ERPNEXT_URL ||
  process.env.VITE_ERPNEXT_URL ||
  process.env.VITE_PROXY_TARGET ||
  ""
).replace(/\/+$/, "");
const key = process.env.ERP_API_KEY || process.env.VITE_API_KEY || "";
const secret = process.env.ERP_API_SECRET || process.env.VITE_API_SECRET || "";
const auth = `token ${key}:${secret}`;

async function api(path) {
  const url = `${base}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: auth, Accept: "application/json" },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text };
}

async function run() {
  console.log("=== 1. Check Legal Document Review for PUR-SQTN-2026-00243 ===");
  const ldc = await api(`/api/resource/Legal Document Review?filters=${encodeURIComponent(JSON.stringify([["sq_name", "=", "PUR-SQTN-2026-00243"]]))}&fields=${encodeURIComponent(JSON.stringify(["*"]))}`);
  console.log("LDC Query Result:", JSON.stringify(ldc.json, null, 2));

  console.log("\n=== 2. Check Supplier Quotation PUR-SQTN-2026-00243 ===");
  const sq = await api(`/api/resource/Supplier Quotation/PUR-SQTN-2026-00243`);
  console.log("SQ Result:", {
    name: sq.json?.data?.name,
    supplier: sq.json?.data?.supplier,
    docstatus: sq.json?.data?.docstatus,
    custom_terms__condition: sq.json?.data?.custom_terms__condition,
    custom_warranty: sq.json?.data?.custom_warranty,
    custom_insurance: sq.json?.data?.custom_insurance,
    custom_legal_review_status: sq.json?.data?.custom_legal_review_status,
  });

  console.log("\n=== 3. Check Files with file_name or file_url containing Inteva BidSphere Documentation ===");
  const filesByUrl = await api(`/api/resource/File?filters=${encodeURIComponent(JSON.stringify([["file_name", "like", "%Inteva%"]]))}&fields=${encodeURIComponent(JSON.stringify(["*"]))}`);
  console.log("Files Found:", JSON.stringify(filesByUrl.json?.data, null, 2));

  console.log("\n=== 4. Check Files attached to PUR-SQTN-2026-00243 ===");
  const filesAttached = await api(`/api/resource/File?filters=${encodeURIComponent(JSON.stringify([["attached_to_name", "=", "PUR-SQTN-2026-00243"]]))}&fields=${encodeURIComponent(JSON.stringify(["*"]))}`);
  console.log("Files Attached to SQ:", JSON.stringify(filesAttached.json?.data, null, 2));
}

run();
