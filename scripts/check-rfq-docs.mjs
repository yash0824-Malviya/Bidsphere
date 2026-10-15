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
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: auth, Accept: "application/json" },
  });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, text };
  }
}

async function main() {
  console.log("=== RFQ PUR-RFQ-2026-00085 ===");
  const rfq = await api(`/api/resource/Request%20for%20Quotation/PUR-RFQ-2026-00085`);
  console.log("RFQ status:", rfq.status);
  if (rfq.json?.data) {
    console.log("RFQ keys:", Object.keys(rfq.json.data));
    console.log("RFQ suppliers:", rfq.json.data.suppliers);
    console.log("RFQ status/workflow:", rfq.json.data.status, rfq.json.data.workflow_state);
  }

  console.log("\n=== Supplier Quotation PUR-SQTN-2026-00199 ===");
  const sq = await api(`/api/resource/Supplier%20Quotation/PUR-SQTN-2026-00199`);
  console.log("SQ status:", sq.status);
  if (sq.json?.data) {
    console.log("SQ keys:", Object.keys(sq.json.data));
    console.log("SQ supplier:", sq.json.data.supplier);
    console.log("SQ status/workflow:", sq.json.data.status, sq.json.data.workflow_state);
    for (const [k, v] of Object.entries(sq.json.data)) {
      if (typeof v === "string" && (v.includes(".pdf") || v.includes("/files") || v.includes("terms") || v.includes("doc"))) {
        console.log(`  ${k}: ${v}`);
      }
    }
  }

  console.log("\n=== Files matching Bank_Statement_2.pdf ===");
  const bankFiles = await api(`/api/resource/File?filters=${encodeURIComponent(JSON.stringify([["file_url", "=", "/private/files/Bank_Statement_2.pdf"]]))}&fields=${encodeURIComponent(JSON.stringify(["name", "file_name", "file_url", "attached_to_doctype", "attached_to_name", "attached_to_field"]))}&limit_page_length=20`);
  console.log("Bank files:", JSON.stringify(bankFiles.json, null, 2));

  const ldr2 = await api(`/api/resource/Legal%20Document%20Review?filters=${encodeURIComponent(JSON.stringify([["rfq_name", "=", "PUR-RFQ-2026-00085"]]))}&fields=${encodeURIComponent(JSON.stringify(["*"]))}`);
  console.log("LDR by rfq_name:", JSON.stringify(ldr2.json, null, 2));

  console.log("\n=== Files attached to RFQ, SQ, or LDR ===");
  const filesRfq = await api(`/api/resource/File?filters=${encodeURIComponent(JSON.stringify([["attached_to_name", "=", "PUR-RFQ-2026-00085"]]))}&fields=${encodeURIComponent(JSON.stringify(["*"]))}`);
  console.log("Files on RFQ:", JSON.stringify(filesRfq.json, null, 2));

  const filesSq = await api(`/api/resource/File?filters=${encodeURIComponent(JSON.stringify([["attached_to_name", "=", "PUR-SQTN-2026-00199"]]))}&fields=${encodeURIComponent(JSON.stringify(["*"]))}`);
  console.log("Files on SQ:", JSON.stringify(filesSq.json, null, 2));

  if (ldrDoc.json?.data?.name) {
    const ldrName = ldrDoc.json.data.name;
    const filesLdr = await api(`/api/resource/File?filters=${encodeURIComponent(JSON.stringify([["attached_to_name", "=", ldrName]]))}&fields=${encodeURIComponent(JSON.stringify(["*"]))}`);
    console.log("Files on LDR:", JSON.stringify(filesLdr.json, null, 2));
  }
}

main().catch(console.error);
