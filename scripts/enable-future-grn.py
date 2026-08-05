"""
Enable future-dated GRN (Purchase Receipt) support in ERPNext.

Usage (run on the ERPNext server):

  bench --site <sitename> set-config server_script_enabled 1
  bench restart
  bench --site <sitename> execute scripts.enable-future-grn.setup

Or copy this file to a Frappe app's commands directory and run via bench.

What it does:
  1. Creates Custom Field "allow_future_grn_dates" on Stock Settings.
  2. Enables the setting.
  3. Creates a Before Validate Server Script on Purchase Receipt that
     monkey-patches validate_posting_time() to skip the future-date throw.

Root cause reference:
  File:   erpnext/controllers/stock_controller.py
  Class:  StockController
  Method: validate_posting_time()
  Line:   (varies by version) — unconditionally throws
          "Posting Date cannot be future date" when
          getdate(self.posting_date) > getdate(nowdate())
"""

import frappe


SERVER_SCRIPT_BODY = '''
# ─── GRN Posting Date (date-only + optional future) ─────────────────
# Before Validate hook for Purchase Receipt.
#
# Root cause:
#   erpnext/controllers/stock_controller.py → validate_posting_time()
#   throws "Posting Date cannot be future date" when
#   getdate(posting_date) > getdate(nowdate()).
#
# This script:
#   1) Compares DATE portions only (getdate / nowdate).
#   2) Clamps a 1-day timezone / clock skew to ERP today.
#   3) When Stock Settings.allow_future_grn_dates is on, skips the
#      future-date throw for intentional future postings.
# ─────────────────────────────────────────────────────────────────────

import frappe
from frappe.utils import getdate, nowdate, nowtime

allow_future = frappe.db.get_single_value("Stock Settings", "allow_future_grn_dates")
today_str = nowdate()
today = getdate(today_str)
posting = getdate(doc.posting_date) if doc.posting_date else None

if doc.posting_date:
    doc.posting_date = str(getdate(doc.posting_date))

result = "STANDARD"
if posting and posting > today:
    delta_days = (posting - today).days
    if allow_future:
        result = "FUTURE_ALLOWED"
        def _safe_validate_posting_time():
            if not doc.posting_date:
                doc.posting_date = nowdate()
            if not doc.posting_time:
                doc.posting_time = nowtime()
        doc.validate_posting_time = _safe_validate_posting_time
    elif delta_days == 1:
        doc.posting_date = today_str
        result = "TZ_SKEW_CLAMPED_TO_TODAY"
        frappe.logger("grn_future_date").info(
            "[GRN Posting Date] clamped 1-day skew to ERP today=%s (was %s)"
            % (today_str, posting)
        )
    else:
        result = "FUTURE_BLOCKED"

frappe.logger("grn_future_date").info(
    "[GRN FUTURE DATE VALIDATION] "
    "Posting Date: {pd}, ERP Today: {today}, "
    "Allow Future GRN: {af}, Result: {result}".format(
        pd=doc.posting_date,
        today=today_str,
        af=allow_future,
        result=result,
    )
)
'''.strip()


def setup():
    """Entry point for bench execute."""
    _ensure_custom_field()
    _enable_setting()
    _ensure_server_script()
    frappe.db.commit()
    print("\\n✓ Future-dated GRN support is fully configured.")
    print("  Disable: uncheck Stock Settings > Allow Future GRN Dates\\n")


def _ensure_custom_field():
    print("\\n[1/3] Custom Field on Stock Settings …")
    cf_name = "Stock Settings-allow_future_grn_dates"
    if frappe.db.exists("Custom Field", cf_name):
        print("  Already exists")
        return

    cf = frappe.get_doc({
        "doctype": "Custom Field",
        "dt": "Stock Settings",
        "fieldname": "allow_future_grn_dates",
        "fieldtype": "Check",
        "label": "Allow Future GRN Dates",
        "insert_after": "allow_negative_stock",
        "default": "0",
        "description": (
            "When enabled, Purchase Receipt (GRN) posting dates may be "
            "set to a future date."
        ),
    })
    cf.insert(ignore_permissions=True)
    print("  Created")


def _enable_setting():
    print("\\n[2/3] Enabling allow_future_grn_dates …")
    frappe.db.set_single_value("Stock Settings", "allow_future_grn_dates", 1)
    frappe.clear_cache(doctype="Stock Settings")
    print("  Enabled")


def _ensure_server_script():
    print("\\n[3/3] Server Script …")
    ss_name = "GRN Allow Future Posting Dates"

    if frappe.db.exists("Server Script", ss_name):
        ss = frappe.get_doc("Server Script", ss_name)
        ss.script = SERVER_SCRIPT_BODY
        ss.disabled = 0
        ss.save(ignore_permissions=True)
        print("  Updated existing script")
        return

    ss = frappe.get_doc({
        "doctype": "Server Script",
        "name": ss_name,
        "script_type": "Before Validate",
        "reference_doctype": "Purchase Receipt",
        "script": SERVER_SCRIPT_BODY,
        "disabled": 0,
    })
    ss.insert(ignore_permissions=True)
    print("  Created")
