/**
 * Configure hash autoname on Reverse Bidding child DocTypes.
 *
 * Root cause of "Please set the document name" when saving bid history:
 * child tables shipped with autoname = "prompt". New rows need hash / Random
 * naming so ERPNext assigns unique names on parent save.
 *
 * Idempotent — safe to re-run.
 * Usage: node scripts/setup-reverse-bidding-naming.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadEnvFile() {
  const envPath = resolve(root, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile();

const baseUrl = (
  process.env.ERPNEXT_URL ??
  process.env.VITE_ERPNEXT_URL ??
  process.env.VITE_PROXY_TARGET ??
  ""
).replace(/\/+$/, "");
const apiKey = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
const apiSecret = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";

if (!baseUrl || !apiKey || !apiSecret) {
  console.error("Missing ERPNEXT_URL / ERP_API_KEY / ERP_API_SECRET");
  process.exit(1);
}

const headers = {
  Authorization: `token ${apiKey}:${apiSecret}`,
  "Content-Type": "application/json",
  Accept: "application/json",
};

const CHILD_DOCTYPES = [
  "Reverse Bidding Supplier",
  "Reverse Bids",
  "Reverse Bid Item",
];

async function api(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return data?.data ?? data?.message ?? data;
}

async function ensureHashNaming(child) {
  console.log(`\n=== ${child} ===`);
  const current = await api(
    "GET",
    `/api/resource/DocType/${encodeURIComponent(child)}?fields=${encodeURIComponent(JSON.stringify(["autoname", "naming_rule"]))}`,
  );
  console.log("Before:", current.autoname, "|", current.naming_rule);

  if (current.autoname === "hash" && current.naming_rule === "Random") {
    console.log("Already configured — skipping.");
    return;
  }

  await api("PUT", `/api/resource/DocType/${encodeURIComponent(child)}`, {
    autoname: "hash",
    naming_rule: "Random",
  });

  const after = await api(
    "GET",
    `/api/resource/DocType/${encodeURIComponent(child)}?fields=${encodeURIComponent(JSON.stringify(["autoname", "naming_rule"]))}`,
  );
  console.log("After:", after.autoname, "|", after.naming_rule);
}

async function run() {
  for (const dt of CHILD_DOCTYPES) {
    await ensureHashNaming(dt);
  }
  try {
    await api("POST", "/api/method/frappe.clear_cache", {});
    console.log("\n✓ Cleared ERPNext cache");
  } catch {
    /* optional */
  }
  console.log("\nDone.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
