/**
 * Align ERPNext System Settings time zone with the business calendar.
 *
 * Root cause of GRN "PO date is in the future":
 *   - Browser / PO date = 2026-07-31 (IST)
 *   - frappe.utils.nowdate() = 2026-07-30 when System Settings.time_zone is UTC
 *     (common Docker default)
 *
 * Usage:
 *   node scripts/setup-erp-timezone.mjs
 *   ERP_TIME_ZONE=Asia/Kolkata node scripts/setup-erp-timezone.mjs
 *
 * Requires .env: ERPNEXT_URL / VITE_ERPNEXT_URL, ERP_API_KEY, ERP_API_SECRET
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
const apiSecret =
  process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";
const targetTz = (
  process.env.ERP_TIME_ZONE ||
  process.env.VITE_ERP_TIME_ZONE ||
  "Asia/Kolkata"
).trim();

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
    throw new Error(
      `${method} ${path} → ${res.status}: ${JSON.stringify(data)}`,
    );
  }
  return data?.data ?? data?.message ?? data;
}

function ymdInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

async function main() {
  if (!baseUrl || !apiKey || !apiSecret) {
    console.error("Set ERPNEXT_URL, ERP_API_KEY, ERP_API_SECRET in .env");
    process.exit(1);
  }

  console.log(`\nERP timezone setup → ${baseUrl}`);
  console.log(`Target time_zone: ${targetTz}\n`);

  let current = null;
  try {
    const viaGet = await api(
      "GET",
      "/api/method/frappe.client.get_value?doctype=System%20Settings&fieldname=time_zone",
    );
    current = viaGet?.time_zone ?? null;
  } catch {
    try {
      const doc = await api(
        "GET",
        "/api/resource/System%20Settings/System%20Settings",
      );
      current = doc?.time_zone ?? null;
    } catch (e) {
      console.error("Could not read System Settings.time_zone:", e.message);
    }
  }

  console.log(`Current System Settings.time_zone: ${current ?? "(unknown)"}`);

  const now = new Date();
  console.log(`UTC today:              ${ymdInTimeZone(now, "UTC")}`);
  console.log(`Today in ${targetTz}:   ${ymdInTimeZone(now, targetTz)}`);

  if (current === targetTz) {
    console.log("\n✓ Already configured — no change needed.");
  } else {
    console.log(`\nUpdating System Settings.time_zone → ${targetTz} …`);
    await api("PUT", "/api/resource/System Settings/System Settings", {
      time_zone: targetTz,
    });
    console.log("✓ Updated");

    try {
      const verify = await api(
        "GET",
        "/api/method/frappe.client.get_value?doctype=System%20Settings&fieldname=time_zone",
      );
      console.log(`Verified time_zone: ${verify?.time_zone ?? "(unknown)"}`);
    } catch {
      /* ignore */
    }
  }

  console.log(`
────────────────────────────────────────────────────────────
frappe.utils.nowdate() now uses this time zone for GRN
posting-date checks (StockController.validate_posting_time).

If GRN still fails, clear cache on the ERP host:
  bench --site <site> clear-cache
  bench restart

Optional Docker (host clock TZ — System Settings is still required):
  TZ=${targetTz}
────────────────────────────────────────────────────────────
`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
