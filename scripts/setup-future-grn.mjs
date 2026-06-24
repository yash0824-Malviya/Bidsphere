/**
 * Setup ERPNext to allow future-dated Purchase Receipts (GRNs).
 *
 * Creates:
 *   1. Custom Field "allow_future_grn_dates" on Stock Settings (checkbox)
 *   2. Server Script "GRN Allow Future Posting Dates" (before_validate)
 *      that monkey-patches validate_posting_time() when the setting is on.
 *
 * Usage:
 *   node scripts/setup-future-grn.mjs
 *
 * Requires .env:
 *   ERPNEXT_URL or VITE_ERPNEXT_URL
 *   ERP_API_KEY, ERP_API_SECRET
 *
 * If Server Scripts are disabled on your instance, run FIRST:
 *   bench --site <sitename> set-config server_script_enabled 1
 *   bench restart
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

/* ── Load .env ──────────────────────────────────────────────────────────── */

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

/* ── HTTP helper ────────────────────────────────────────────────────────── */

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
    const msg = data?.exc_type ?? data?._server_messages ?? text;
    throw new Error(`${method} ${path} → ${res.status}: ${msg}`);
  }
  return data;
}

/* ── 1. Custom Field ────────────────────────────────────────────────────── */

const CUSTOM_FIELD_NAME = "Stock Settings-allow_future_grn_dates";

async function ensureCustomField() {
  console.log("\n[1/3] Custom Field on Stock Settings …");

  try {
    await api(
      "GET",
      `/api/resource/Custom Field/${encodeURIComponent(CUSTOM_FIELD_NAME)}`
    );
    console.log("  ✓ Already exists");
  } catch {
    console.log("  Creating allow_future_grn_dates …");
    await api("POST", "/api/resource/Custom Field", {
      doctype: "Custom Field",
      dt: "Stock Settings",
      fieldname: "allow_future_grn_dates",
      fieldtype: "Check",
      label: "Allow Future GRN Dates",
      insert_after: "allow_negative_stock",
      default: "0",
      description:
        "When enabled, Purchase Receipt (GRN) posting dates may be set to a future date. " +
        "A Before Validate Server Script skips the built-in future-date check.",
    });
    console.log("  ✓ Created");
  }
}

/* ── 2. Enable the setting ──────────────────────────────────────────────── */

async function enableSetting() {
  console.log("\n[2/3] Enabling allow_future_grn_dates in Stock Settings …");
  await api(
    "PUT",
    "/api/resource/Stock Settings/Stock Settings",
    { allow_future_grn_dates: 1 }
  );
  console.log("  ✓ Enabled");
}

/* ── 3. Server Script ───────────────────────────────────────────────────── */

const SERVER_SCRIPT_NAME = "GRN Allow Future Posting Dates";

const SERVER_SCRIPT_BODY = `
# ─── GRN Allow Future Posting Dates ─────────────────────────────────
# Before Validate hook for Purchase Receipt.
#
# When Stock Settings > Allow Future GRN Dates is checked, this script
# replaces validate_posting_time() with a version that sets defaults
# (posting_date / posting_time) but does NOT throw on future dates.
#
# Root cause:
#   erpnext/controllers/stock_controller.py → validate_posting_time()
#   unconditionally throws "Posting Date cannot be future date".
#   There is no Stock Settings flag to disable it.
#
# This targeted monkey-patch affects only the current document instance.
# ─────────────────────────────────────────────────────────────────────

import frappe
from frappe.utils import getdate, nowdate, nowtime

allow_future = frappe.db.get_single_value("Stock Settings", "allow_future_grn_dates")
posting = getdate(doc.posting_date) if doc.posting_date else None
today   = getdate(nowdate())

frappe.logger("grn_future_date").info(
    "[GRN FUTURE DATE VALIDATION] "
    "PO Date: {po_date}, Posting Date: {pd}, Today: {today}, "
    "Allow Future GRN: {af}, Result: {result}".format(
        po_date=getattr(doc, "purchase_order_date", "N/A"),
        pd=doc.posting_date,
        today=nowdate(),
        af=allow_future,
        result="FUTURE_ALLOWED" if (allow_future and posting and posting > today)
               else "STANDARD",
    )
)

if allow_future and posting and posting > today:
    def _safe_validate_posting_time():
        """Set defaults but skip future-date throw."""
        if not doc.posting_date:
            doc.posting_date = nowdate()
        if not doc.posting_time:
            doc.posting_time = nowtime()

    doc.validate_posting_time = _safe_validate_posting_time
`.trim();

async function ensureServerScript() {
  console.log("\n[3/3] Server Script (Before Validate on Purchase Receipt) …");

  try {
    await api(
      "GET",
      `/api/resource/Server Script/${encodeURIComponent(SERVER_SCRIPT_NAME)}`
    );
    console.log("  ✓ Already exists — updating script body …");
    await api(
      "PUT",
      `/api/resource/Server Script/${encodeURIComponent(SERVER_SCRIPT_NAME)}`,
      { script: SERVER_SCRIPT_BODY, disabled: 0 }
    );
    console.log("  ✓ Updated");
    return;
  } catch {
    // doesn't exist yet — create
  }

  try {
    await api("POST", "/api/resource/Server Script", {
      doctype: "Server Script",
      name: SERVER_SCRIPT_NAME,
      script_type: "Before Validate",
      reference_doctype: "Purchase Receipt",
      script: SERVER_SCRIPT_BODY,
      disabled: 0,
    });
    console.log("  ✓ Created");
  } catch (err) {
    console.error("  ✗ FAILED:", err.message);
    console.log(
      "\n  ── Server Scripts may be disabled on your ERPNext instance. ──\n" +
      "  Run on the server:\n\n" +
      "    bench --site <sitename> set-config server_script_enabled 1\n" +
      "    bench restart\n\n" +
      "  Then re-run this script.\n" +
      "  Or use the Python alternative:\n\n" +
      "    bench --site <sitename> execute scripts/enable-future-grn.setup\n"
    );
  }
}

/* ── Main ───────────────────────────────────────────────────────────────── */

async function main() {
  if (!baseUrl || !apiKey || !apiSecret) {
    console.error("Missing ERPNEXT_URL and ERP API credentials in .env");
    process.exit(1);
  }

  console.log(`Setting up future-dated GRN support on ${baseUrl}`);

  await ensureCustomField();
  await enableSetting();
  await ensureServerScript();

  console.log("\n──────────────────────────────────────");
  console.log("Done.  Future-dated GRNs are now enabled.");
  console.log("To disable: uncheck Stock Settings > Allow Future GRN Dates");
  console.log("──────────────────────────────────────\n");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
