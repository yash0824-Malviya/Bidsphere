"""
Legal Document Review — ERPNext-native automation (reference copy).

This file is the exact Python source of the three Server Scripts staged
via `scripts/setup-legal-review-automation.mjs`. It is kept here, under
version control, as the human-readable source of truth and as a
ready-to-drop-in module for a real custom Frappe app
(e.g. `procurement_app/procurement_app/legal_document_review.py` +
`hooks.py` doc_events / whitelisted method registration) once bench/SSH
access is available.

IMPORTANT — this file is NOT executed by the React app, Vercel, or the
setup script directly. The setup script uploads each function body as the
`script` field of a "Server Script" document via the ERPNext REST API.
Server Scripts only RUN once `server_script_enabled` is turned on for the
site (`bench --site <site> set-config server_script_enabled 1 && bench restart`).
Until then, they are created but dormant — see scripts/enable-server-script.sh.

──────────────────────────────────────────────────────────────────────────
1. AUTO-CREATE (DocType Event — "After Save (Submitted Document)" on
   "Request for Quotation")

   Fires every time a submitted RFQ is saved. When the RFQ has just been
   marked `custom_legal_status = "Pending"` with a `custom_selected_supplier`
   set (i.e. a Procurement Manager just selected the winning supplier),
   this creates exactly one Legal Document Review for that RFQ — deduped
   by `rfq_name`, backed by a DB-level unique constraint on that field.

2. APPROVE (whitelisted API — `approve_legal_document_review`)
3. REJECT  (whitelisted API — `reject_legal_document_review`)

   Both take `name` (Legal Document Review), `reviewed_by`, `note` via
   `frappe.form_dict`, and are the only way `review_status` may change.
──────────────────────────────────────────────────────────────────────────
"""

# ─────────────────────────────────────────────────────────────────────────
# 1. AUTO-CREATE — DocType Event on "Request for Quotation"
#    doctype_event = "After Save (Submitted Document)"
#    `doc` is injected by the Server Script engine (the RFQ being saved).
# ─────────────────────────────────────────────────────────────────────────
AUTO_CREATE_SCRIPT = r"""
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
    # Never let a bug here block the RFQ save itself.
    frappe.log_error(
        title="Legal Document Review auto-create failed",
        message="RFQ: {0}\nError: {1}".format(doc.name, frappe.get_traceback()),
    )
    _log("ERROR auto-creating Legal Document Review for RFQ {0}: {1}".format(doc.name, str(e)))
"""

# ─────────────────────────────────────────────────────────────────────────
# 2 & 3. APPROVE / REJECT — whitelisted API Server Scripts
#    api_method = "approve_legal_document_review" / "reject_legal_document_review"
# ─────────────────────────────────────────────────────────────────────────
def _decision_script(status: str) -> str:
    return r"""
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
review.review_status = "__STATUS__"
review.workflow_state = "__STATUS__"
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
""".replace("__STATUS__", status)


APPROVE_SCRIPT = _decision_script("Approved")
REJECT_SCRIPT = _decision_script("Rejected")
