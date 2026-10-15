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

const base = (process.env.ERPNEXT_URL || process.env.VITE_PROXY_TARGET || "").replace(/\/+$/, "");
const auth = `token ${process.env.ERP_API_KEY || process.env.VITE_API_KEY}:${process.env.ERP_API_SECRET || process.env.VITE_API_SECRET}`;

async function main() {
  const res = await fetch(`${base}/api/resource/Supplier Scoring Result/SCORE-PUR-RFQ-2026-00089-00111`, {
    headers: { Authorization: auth },
  });
  const data = await res.json();
  const snap = JSON.parse(data.data.analysis_snapshot);
  console.log("=== snap.analysis.supplier_analysis ===");
  console.log(JSON.stringify(snap.analysis?.supplier_analysis, null, 2));
  console.log("=== snap.quotations_snapshot ===");
  console.log(JSON.stringify(snap.quotations_snapshot, null, 2));
}
main();
