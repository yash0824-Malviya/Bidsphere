/**
 * Provision the BidSphere "server date" API endpoint on ERPNext.
 *
 * Creates a Frappe Server Script (type: API) exposed at:
 *
 *     GET /api/method/bidsphere_server_date
 *     → { "message": { "today": "2026-07-05", "now": "2026-07-05 14:32:10" } }
 *
 * The returned `today` is `frappe.utils.nowdate()` — the site's *local*
 * calendar date, which is exactly what ERPNext uses to validate posting dates.
 * The frontend (fetchServerDate) calls this so Goods Receipt posting-date
 * validation is never fooled by the browser clock or a UTC/site-timezone gap.
 *
 * Usage: node scripts/setup-server-date-api.mjs
 * Requires .env: ERPNEXT_URL, ERP_API_KEY, ERP_API_SECRET
 *
 * NOTE: Server Scripts must be enabled on the site
 *   (bench --site <site> set-config server_script_enabled 1).
 * If they are not, the frontend transparently falls back to the HTTP Date
 * header, so this script is an optional accuracy improvement.
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
).replace(/\/$/, "");

const apiKey = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
const apiSecret = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";

const SCRIPT_NAME = "bidsphere_server_date";
const API_METHOD = "bidsphere_server_date";

const SCRIPT_BODY = `# BidSphere — server-local date for posting-date validation.
frappe.response["message"] = {
    "today": frappe.utils.nowdate(),
    "now": frappe.utils.now_datetime().strftime("%Y-%m-%d %H:%M:%S"),
}
`;

async function api(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `token ${apiKey}:${apiSecret}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
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
    throw new Error(`${method} ${path} (${res.status}): ${JSON.stringify(data)}`);
  }
  return data?.data ?? data?.message ?? data;
}

async function ensureServerScript() {
  const payload = {
    doctype: "Server Script",
    name: SCRIPT_NAME,
    script_type: "API",
    api_method: API_METHOD,
    allow_guest: 0,
    disabled: 0,
    module: "Stock",
    script: SCRIPT_BODY,
  };

  try {
    await api("GET", `/api/resource/Server Script/${encodeURIComponent(SCRIPT_NAME)}`);
    await api("PUT", `/api/resource/Server Script/${encodeURIComponent(SCRIPT_NAME)}`, {
      script_type: "API",
      api_method: API_METHOD,
      allow_guest: 0,
      disabled: 0,
      script: SCRIPT_BODY,
    });
    console.log(`✓ Server Script updated: ${SCRIPT_NAME}`);
  } catch {
    console.log(`• Creating Server Script: ${SCRIPT_NAME}`);
    await api("POST", "/api/resource/Server Script", payload);
    console.log(`✓ Server Script created: ${SCRIPT_NAME}`);
  }
}

async function verify() {
  try {
    const res = await api("GET", `/api/method/${API_METHOD}`);
    const today = res?.today ?? res?.message?.today;
    if (today) {
      console.log(`✓ Endpoint verified — server date: ${today}`);
    } else {
      console.log("• Endpoint reachable but returned no `today` field:", JSON.stringify(res));
    }
  } catch (e) {
    console.log(`• Could not verify endpoint (may need Server Scripts enabled): ${e.message}`);
  }
}

async function main() {
  if (!baseUrl || !apiKey || !apiSecret) {
    console.error("Set ERPNEXT_URL, ERP_API_KEY, ERP_API_SECRET in .env");
    process.exit(1);
  }

  console.log(`\nBidSphere server-date API setup → ${baseUrl}\n`);

  try {
    await ensureServerScript();
  } catch (e) {
    console.error(
      `\n⚠ Server Script provisioning failed. The app will fall back to the HTTP Date header.\n  Reason: ${e.message}\n  If you want exact site-timezone dates, enable Server Scripts:\n    bench --site <site> set-config server_script_enabled 1\n`
    );
    process.exit(1);
  }

  await verify();
  console.log("\n✅ Server-date API setup complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
