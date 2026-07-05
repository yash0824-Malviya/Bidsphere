/**
 * Stage ERPNext-native Legal Document Review automation.
 *
 * Creates 3 Server Scripts (Python source lives in
 * scripts/erpnext/legal_document_review_automation.py):
 *
 *   1. "Legal Review Auto Create On Supplier Selection"  (DocType Event,
 *      "After Save (Submitted Document)" on Request for Quotation)
 *   2. "Legal Review Approve API"  (API — approve_legal_document_review)
 *   3. "Legal Review Reject API"   (API — reject_legal_document_review)
 *
 * These are created REGARDLESS of whether Server Scripts are currently
 * enabled on the target site — creating/storing a Server Script document
 * always works via the REST API; only *executing* one requires
 * `server_script_enabled`. So this script safely "pre-stages" the
 * automation now; it goes live the instant an administrator runs:
 *
 *   bench --site <sitename> set-config server_script_enabled 1
 *   bench restart
 *
 * (see scripts/enable-server-script.sh)
 *
 * Usage:
 *   node scripts/setup-legal-review-automation.mjs
 *
 * Requires .env:
 *   ERPNEXT_URL or VITE_ERPNEXT_URL
 *   ERP_API_KEY, ERP_API_SECRET
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

/* ── Python source (inlined so this script has no runtime dependency on
 *    the reference .py file's non-standard export format) ─────────────── */

const AUTO_CREATE_SCRIPT = `
import json
import frappe
from frappe.utils import now_datetime, flt

def _log(msg):
    frappe.logger("legal_document_review").info(msg)

try:
    legal_status = (doc.get("custom_legal_status") or "").strip()
    selected_supplier = (doc.get("custom_selected_supplier") or "").strip()

    if legal_status == "Pending" and selected_supplier:
        existing = frappe.db.exists("Legal Document Review", {"rfq_name": doc.name})

        if existing:
            _log("Legal Document Review already exists for RFQ {0} -> {1}. Skipping.".format(doc.name, existing))
        else:
            sq_rows = frappe.get_all(
                "Supplier Quotation",
                filters=[["items", "request_for_quotation", "=", doc.name]],
                fields=["name", "supplier", "docstatus"],
                order_by="modified desc",
            )

            winning_sq_name = None
            for row in sq_rows:
                if row.supplier == selected_supplier and row.docstatus != 2:
                    winning_sq_name = row.name
                    break

            if not winning_sq_name:
                _log(
                    "No matching Supplier Quotation found for RFQ {0}, supplier {1}. "
                    "Cannot auto-create Legal Document Review.".format(doc.name, selected_supplier)
                )
            else:
                sq_doc = frappe.get_doc("Supplier Quotation", winning_sq_name)

                item_summary = [
                    {
                        "item_code": it.item_code,
                        "item_name": it.item_name,
                        "qty": it.qty,
                        "uom": it.uom,
                        "rate": it.rate,
                        "amount": it.amount or flt(it.qty) * flt(it.rate),
                    }
                    for it in sq_doc.items
                ]

                review = frappe.new_doc("Legal Document Review")
                review.sq_name = sq_doc.name
                review.rfq_name = doc.name
                review.supplier = sq_doc.supplier
                review.company = sq_doc.company or doc.get("company") or ""
                review.quotation_number = sq_doc.name
                review.procurement_manager = doc.get("custom_submitted_by") or frappe.session.user
                review.submission_date = sq_doc.transaction_date or now_datetime()
                review.grand_total = sq_doc.grand_total or sq_doc.total or 0
                review.valid_till = sq_doc.valid_till
                review.item_summary = json.dumps(item_summary)
                review.terms_file_url = sq_doc.get("custom_terms__condition") or ""
                review.terms_note = sq_doc.get("custom_terms_note") or ""
                review.warranty_file_url = sq_doc.get("custom_warenty_certificate") or ""
                review.warranty_note = sq_doc.get("custom_warranty_note") or ""
                review.insurance_file_url = sq_doc.get("custom_insurance_certificate") or ""
                review.insurance_note = sq_doc.get("custom_insurance_note") or ""
                review.review_status = "Pending"
                review.workflow_state = "Pending Review"
                review.insert(ignore_permissions=True)
                frappe.db.commit()

                _log(
                    "Legal Document Review {0} auto-created for RFQ {1}, SQ {2}, supplier {3}".format(
                        review.name, doc.name, sq_doc.name, sq_doc.supplier
                    )
                )
except Exception as e:
    frappe.log_error(
        title="Legal Document Review auto-create failed",
        message="RFQ: {0}\\nError: {1}".format(doc.name, frappe.get_traceback()),
    )
    _log("ERROR auto-creating Legal Document Review for RFQ {0}: {1}".format(doc.name, str(e)))
`.trim();

function decisionScript(status) {
  return `
import frappe
from frappe.utils import now_datetime

name = frappe.form_dict.get("name")
reviewed_by = frappe.form_dict.get("reviewed_by")
note = frappe.form_dict.get("note") or ""

if not name:
    frappe.throw("name is required")
if not reviewed_by:
    frappe.throw("reviewed_by is required")

review = frappe.get_doc("Legal Document Review", name)
review.review_status = "${status}"
review.workflow_state = "${status}"
review.reviewed_by = reviewed_by
review.reviewed_at = now_datetime()
review.review_note = note
review.save(ignore_permissions=True)
frappe.db.commit()

frappe.response["message"] = {
    "success": True,
    "name": review.name,
    "review_status": review.review_status,
    "reviewed_by": review.reviewed_by,
    "reviewed_at": str(review.reviewed_at),
}
`.trim();
}

/* ── Ensure Server Script (create or update) ───────────────────────────── */

async function ensureServerScript(name, doc) {
  try {
    await api("GET", `/api/resource/Server Script/${encodeURIComponent(name)}`);
    console.log(`  ✓ "${name}" already exists — updating script body …`);
    await api("PUT", `/api/resource/Server Script/${encodeURIComponent(name)}`, {
      script: doc.script,
      disabled: 1,
    });
    console.log("  ✓ Updated (left disabled=1 — see NOTE above)");
    return;
  } catch {
    // doesn't exist — create
  }

  await api("POST", "/api/resource/Server Script", {
    doctype: "Server Script",
    name,
    disabled: 1,
    ...doc,
  });
  console.log(`  ✓ Created "${name}" (disabled=1)`);
}

async function main() {
  if (!baseUrl || !apiKey || !apiSecret) {
    console.error("Missing ERPNEXT_URL and ERP API credentials in .env");
    process.exit(1);
  }

  console.log(`Staging Legal Document Review automation on ${baseUrl}\n`);
  console.log(
    "NOTE: these Server Scripts are staged with disabled=1 on purpose.\n" +
      "CRITICAL: this is NOT just about the site-wide `server_script_enabled`\n" +
      "config flag. Even while that flag is off, an ENABLED (disabled=0)\n" +
      "\"DocType Event\" script registers as an active hook — Frappe will still\n" +
      "attempt to invoke it on every save of its reference doctype, and that\n" +
      "attempt itself throws ServerScriptNotEnabled and FAILS THE ENTIRE SAVE\n" +
      "(this previously blocked every write to submitted RFQs site-wide until\n" +
      "discovered and fixed during a production audit). Only the script's own\n" +
      "`disabled=1` flag prevents Frappe from registering it as a hook at all.\n\n" +
      "To activate this automation for real, an administrator must, in this\n" +
      "exact order: (1) run `bench --site <site> set-config server_script_enabled 1`\n" +
      "and restart the bench (see scripts/enable-server-script.sh), (2) flip\n" +
      "`disabled` to 0 on all three scripts below, (3) immediately test a save\n" +
      "on a submitted RFQ to confirm it doesn't throw ServerScriptNotEnabled\n" +
      "before relying on the automation.\n"
  );

  console.log("[1/3] Auto-create on supplier selection (DocType Event) …");
  try {
    await ensureServerScript("Legal Review Auto Create On Supplier Selection", {
      script_type: "DocType Event",
      reference_doctype: "Request for Quotation",
      doctype_event: "After Save (Submitted Document)",
      script: AUTO_CREATE_SCRIPT,
    });
  } catch (err) {
    console.error("  ✗ FAILED:", err.message);
  }

  console.log("\n[2/3] Approve API (approve_legal_document_review) …");
  try {
    await ensureServerScript("Legal Review Approve API", {
      script_type: "API",
      api_method: "approve_legal_document_review",
      allow_guest: 0,
      script: decisionScript("Approved"),
    });
  } catch (err) {
    console.error("  ✗ FAILED:", err.message);
  }

  console.log("\n[3/3] Reject API (reject_legal_document_review) …");
  try {
    await ensureServerScript("Legal Review Reject API", {
      script_type: "API",
      api_method: "reject_legal_document_review",
      allow_guest: 0,
      script: decisionScript("Rejected"),
    });
  } catch (err) {
    console.error("  ✗ FAILED:", err.message);
  }

  console.log("\n──────────────────────────────────────");
  console.log("Done. Server Scripts staged (dormant until enabled).");
  console.log("To activate ERPNext-native automation, run on the server:");
  console.log("    bench --site <sitename> set-config server_script_enabled 1");
  console.log("    bench restart");
  console.log("──────────────────────────────────────\n");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
