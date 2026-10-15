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
  const json = await res.json();
  return json;
}

async function run() {
  const ldc = await api(`/api/resource/Legal Document Review?filters=${encodeURIComponent(JSON.stringify([["sq_name", "=", "PUR-SQTN-2026-00243"]]))}&fields=${encodeURIComponent(JSON.stringify(["*"]))}`);
  console.log("LDC:", JSON.stringify(ldc.data, null, 2));

  const sq = await api(`/api/resource/Supplier Quotation/PUR-SQTN-2026-00243`);
  console.log("SQ:", {
    name: sq.data?.name,
    terms: sq.data?.custom_terms__condition,
    warranty: sq.data?.custom_warenty_certificate,
    insurance: sq.data?.custom_insurance_certificate,
  });
}
run();
