"""
BidSphere Material Request workflow — reference Frappe hooks.

Copy into your procurement_app on the ERPNext bench:

  procurement_app/procurement_app/overrides/material_request.py
  procurement_app/hooks.py → doc_events for Material Request

This file is NOT executed by the React app. It documents server-side
validation that mirrors the frontend workflow API.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import flt


def on_material_request_submit(doc, method=None):
    if doc.get("custom_bidsphere_status") in (None, "", "Draft"):
        doc.db_set("custom_bidsphere_status", "Under Warehouse Review", update_modified=False)


def validate_material_request(doc, method=None):
    if doc.is_new() or (doc.docstatus or 0) == 0:
        return
    status = doc.get("custom_bidsphere_status") or ""
    if status in ("Under Warehouse Review", "Stock Available", "Procurement Required", "RFQ Created"):
        prev = frappe.get_doc("Material Request", doc.name)
        if len(prev.items) != len(doc.items):
            frappe.throw(_("Item lines cannot be changed after submission."))


@frappe.whitelist()
def bidsphere_issue_material(material_request: str, warehouse_remarks: str | None = None):
    from erpnext.stock.doctype.material_request.material_request import make_stock_entry

    source_name = (material_request or "").strip()
    if not source_name:
        frappe.throw(
            _("Material Request reference is missing. Stock Entry cannot be created.")
        )

    mr = frappe.get_doc("Material Request", source_name)
    if mr.custom_bidsphere_status not in ("Under Warehouse Review", "Stock Available"):
        frappe.throw(_("Material Request is not under warehouse review."))

    # ERPNext signature: make_stock_entry(source_name, target_doc=None)
    frappe.logger("bidsphere").info(
        "make_stock_entry source_name=%s company=%s", source_name, mr.company
    )
    se = frappe.get_doc(make_stock_entry(source_name=source_name))
    se.insert(ignore_permissions=True)
    se.submit()
    frappe.logger("bidsphere").info("Stock Entry created %s from %s", se.name, source_name)

    mr.db_set(
        {
            "custom_bidsphere_status": "Material Issued",
            "custom_warehouse_remarks": warehouse_remarks,
        }
    )
    return {"stock_entry": se.name, "status": "Material Issued"}


@frappe.whitelist()
def bidsphere_transfer_and_issue_material(material_request: str, warehouse_remarks: str | None = None):
    import traceback
    import sys

    mr = frappe.get_doc("Material Request", material_request)
    company = mr.company
    if not company:
        frappe.throw(_("Material Request has no company."))

    # Dynamic warehouses for MR.company — never hardcode Finished Goods / Stores names.
    company_warehouses = frappe.get_all(
        "Warehouse",
        filters={"company": company, "is_group": 0, "disabled": 0},
        pluck="name",
        order_by="name asc",
    )
    if not company_warehouses:
        frappe.throw(
            _("No warehouse found for Company {0}. Please configure a warehouse first.").format(
                company
            )
        )

    preferred = next(
        (w for w in company_warehouses if "stores" in w.lower()),
        company_warehouses[0],
    )

    transfer_items = []
    issue_items = []

    for item in mr.items:
        bins = frappe.get_all(
            "Bin",
            filters={
                "item_code": item.item_code,
                "warehouse": ["in", company_warehouses],
            },
            fields=["warehouse", "actual_qty"],
        )
        # Prefer non-preferred warehouses with enough qty, else best company bin.
        source_warehouse = None
        for b in bins:
            if b.warehouse != preferred and flt(b.actual_qty) >= flt(item.qty):
                source_warehouse = b.warehouse
                break
        if not source_warehouse:
            valid_bins = [b for b in bins if b.warehouse != preferred]
            if valid_bins:
                valid_bins.sort(key=lambda x: flt(x.actual_qty), reverse=True)
                source_warehouse = valid_bins[0].warehouse
        if not source_warehouse and bins:
            bins_sorted = sorted(bins, key=lambda x: flt(x.actual_qty), reverse=True)
            source_warehouse = bins_sorted[0].warehouse
        if not source_warehouse:
            frappe.throw(
                _(
                    "No stock in Company {0} warehouses for item {1}. "
                    "Cannot create Stock Entry."
                ).format(company, item.item_code)
            )

        # Validate Warehouse.company == Material Request.company
        wh_company = frappe.db.get_value("Warehouse", source_warehouse, "company")
        if wh_company != company:
            frappe.throw(
                _(
                    "Selected Warehouse {0} belongs to Company {1}. "
                    "Please choose a warehouse from Company {2}."
                ).format(source_warehouse, wh_company, company)
            )

        target_warehouse = preferred
        target_company = frappe.db.get_value("Warehouse", target_warehouse, "company")
        if target_company != company:
            frappe.throw(
                _(
                    "Selected Warehouse {0} belongs to Company {1}. "
                    "Please choose a warehouse from Company {2}."
                ).format(target_warehouse, target_company, company)
            )

        transfer_items.append({
            "doctype": "Stock Entry Detail",
            "item_code": item.item_code,
            "qty": item.qty,
            "s_warehouse": source_warehouse,
            "t_warehouse": target_warehouse,
            "uom": item.uom or "Nos",
            "stock_uom": item.uom or "Nos",
            "conversion_factor": 1
        })

        issue_items.append({
            "doctype": "Stock Entry Detail",
            "item_code": item.item_code,
            "qty": item.qty,
            "s_warehouse": target_warehouse,
            "uom": item.uom or "Nos",
            "stock_uom": item.uom or "Nos",
            "conversion_factor": 1
        })

    transfer_se = None
    try:
        # Step 1: Create Stock Entry (Material Transfer)
        print("Creating Stock Entry")
        transfer_doc = frappe.get_doc({
            "doctype": "Stock Entry",
            "stock_entry_type": "Material Transfer",
            "purpose": "Material Transfer",
            "company": mr.company,
            "items": transfer_items
        })
        transfer_doc.insert(ignore_permissions=True)
        print("Stock Entry Inserted")
        
        transfer_se = transfer_doc
        print("Stock Entry Name:", transfer_se.name)

        print("Submitting Stock Entry")
        transfer_se.submit()
        print("Transfer Successful")

        # Step 2: Create Material Issue
        print("Creating Material Issue")
        issue_doc = frappe.get_doc({
            "doctype": "Stock Entry",
            "stock_entry_type": "Material Issue",
            "purpose": "Material Issue",
            "company": mr.company,
            "items": issue_items
        })
        issue_doc.insert(ignore_permissions=True)
        issue_se = issue_doc
        issue_se.submit()
        print("Material Issue Submitted")

        # Step 3: Update Material Request
        print("Updating Material Request")
        mr.db_set({
            "custom_bidsphere_status": "Material Issued",
            "custom_warehouse_remarks": warehouse_remarks
        })

        return {
            "transfer_stock_entry": transfer_se.name,
            "issue_stock_entry": issue_se.name,
            "status": "Material Issued"
        }

    except Exception as e:
        if transfer_se and getattr(transfer_se, "docstatus", 0) == 1:
            try:
                transfer_se.cancel()
            except Exception as cancel_err:
                print("Failed to rollback/cancel transfer stock entry:", str(cancel_err))
        traceback.print_exc(file=sys.stdout)
        raise e


@frappe.whitelist()
def bidsphere_forward_to_procurement(material_request: str, warehouse_remarks: str | None = None):
    mr = frappe.get_doc("Material Request", material_request)
    if mr.custom_bidsphere_status not in ("Under Warehouse Review", "Stock Available"):
        frappe.throw(_("Only requests under warehouse review can be forwarded."))
    # ERPNext's `custom_bidsphere_status` Select field does not include the UI
    # label "Procurement Required" — its valid option is "Forwarded to
    # Procurement" (the frontend maps it back to the label on read). Writing the
    # label here would raise a ValidationError.
    mr.db_set({
        "custom_bidsphere_status": "Forwarded to Procurement",
        "custom_warehouse_remarks": warehouse_remarks
    })
    return {"status": mr.custom_bidsphere_status}
