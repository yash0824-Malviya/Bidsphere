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

const base = (
  process.env.ERPNEXT_URL ||
  process.env.VITE_ERPNEXT_URL ||
  process.env.VITE_PROXY_TARGET ||
  ""
).replace(/\/+$/, "");
const key = process.env.ERP_API_KEY || process.env.VITE_API_KEY || "";
const secret = process.env.ERP_API_SECRET || process.env.VITE_API_SECRET || "";
const auth = `token ${key}:${secret}`;

async function run() {
  const rfqId = "PUR-RFQ-2026-00089";
  const url = `${base}/api/resource/Supplier Scoring Result?filters=${encodeURIComponent(
    JSON.stringify([["rfq", "=", rfqId]])
  )}&fields=${encodeURIComponent(
    JSON.stringify(["name", "creation", "modified", "scored_at", "recommended_supplier"])
  )}&order_by=creation desc`;
  const res = await fetch(url, { headers: { Authorization: auth, Accept: "application/json" } });
  const json = await res.json();
  console.log("All SSR records for RFQ:", json.data);
  for (const row of json.data || []) {
    const detailRes = await fetch(`${base}/api/resource/Supplier Scoring Result/${row.name}`, {
      headers: { Authorization: auth, Accept: "application/json" },
    });
    const detail = await detailRes.json();
    console.log(`\n--- ${row.name} ---`);
    console.log("scored_at:", detail.data.scored_at);
    if (detail.data.analysis_snapshot) {
      try {
        const snap = JSON.parse(detail.data.analysis_snapshot);
        const rows = snap.analysis?.supplier_analysis || [];
        console.log(
          `Snapshot rows (${rows.length}):`,
          rows.map((r) => ({
            name: r.name,
            rank: r.rank,
            overall: r.score?.overall,
            grand_total: r.grand_total,
            verdict: r.verdict,
          }))
        );
      } catch (e) {
        console.log("Snapshot error:", e.message);
      }
    }
    const scores = detail.data.supplier_scores || [];
    console.log(
      `Child scores (${scores.length}):`,
      scores.map((s) => ({
        supplier: s.supplier,
        ranking: s.ranking,
        final_score: s.final_score,
      }))
    );
  }
}
run();
