/**
 * Checks whether esign_envelope from list API is same as from single-record GET.
 */
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const BASE = (process.env.ERPNEXT_URL || process.env.VITE_ERPNEXT_URL || process.env.VITE_PROXY_TARGET || "").replace(/\/+$/, "");
const KEY = process.env.ERP_API_KEY || process.env.VITE_API_KEY || "";
const SECRET = process.env.ERP_API_SECRET || process.env.VITE_API_SECRET || "";
const AUTH = `token ${KEY}:${SECRET}`;

async function erpGet(path) {
  const res = await fetch(`${BASE}/api/${path}`, { headers: { Authorization: AUTH, Accept: "application/json" } });
  const json = await res.json();
  return json?.data ?? json;
}

async function run() {
  const FIELDS = ["name", "esign_envelope", "esign_status", "workflow_state", "finance_status", "review_status"];

  // 1. Via list API
  const listData = await erpGet(`resource/Legal%20Document%20Review?fields=${encodeURIComponent(JSON.stringify(FIELDS))}&filters=${encodeURIComponent(JSON.stringify([["name","=","LDC2026-00021"]]))}&limit_page_length=1`);
  const listRow = Array.isArray(listData) ? listData[0] : null;
  
  // 2. Via single-record GET
  const singleData = await erpGet(`resource/Legal%20Document%20Review/LDC2026-00021`);

  console.log("=== LIST API esign_envelope ===");
  console.log("length:", (listRow?.esign_envelope || "").length);
  console.log("first 200 chars:", (listRow?.esign_envelope || "").slice(0, 200));
  console.log("review_status:", listRow?.review_status);
  console.log("workflow_state:", listRow?.workflow_state);
  console.log("finance_status:", listRow?.finance_status);

  console.log("\n=== SINGLE GET esign_envelope ===");
  console.log("length:", (singleData?.esign_envelope || "").length);
  console.log("first 200 chars:", (singleData?.esign_envelope || "").slice(0, 200));
  console.log("review_status:", singleData?.review_status);
  console.log("workflow_state:", singleData?.workflow_state);
  console.log("finance_status:", singleData?.finance_status);

  const listLen = (listRow?.esign_envelope || "").length;
  const singleLen = (singleData?.esign_envelope || "").length;
  
  if (listLen < singleLen) {
    console.log(`\n⚠️  BUG CONFIRMED: List API truncates esign_envelope! (${listLen} vs ${singleLen} chars)`);
  } else if (listLen === 0) {
    console.log("\n⚠️  BUG CONFIRMED: List API returns EMPTY esign_envelope!");
  } else {
    console.log("\n✓ esign_envelope lengths match:", listLen, "=", singleLen);
  }
}

run().catch(console.error);
