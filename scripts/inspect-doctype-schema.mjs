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
  const res = await fetch(`${base}/api/resource/DocType/Legal Document Review`, {
    headers: { Authorization: auth, Accept: "application/json" },
  });
  const json = await res.json();
  const wfField = json.data?.fields?.find((f) => f.fieldname === "workflow_state");
  console.log("workflow_state options:\n", wfField?.options);
  const statusField = json.data?.fields?.find((f) => f.fieldname === "review_status");
  console.log("review_status options:\n", statusField?.options);
  const finField = json.data?.fields?.find((f) => f.fieldname === "finance_status");
  console.log("finance_status options:\n", finField?.options);
}

run().catch(console.error);
