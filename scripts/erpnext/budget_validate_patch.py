"""
ERPNext v16 Budget — defensive validate_budget_amount patch.

Install in your custom Frappe app (e.g. procurement_app):

1. Copy this file to:
   procurement_app/overrides/budget_override.py

2. In procurement_app/hooks.py add:
   override_doctype_class = {
       "Budget": "procurement_app.overrides.budget_override.BudgetOverride"
   }

3. bench restart

Root cause addressed:
  Budget.validate_budget_amount() does `if self.budget_amount <= 0`
  which raises TypeError when budget_amount is None (missing from API payload).

This override converts None to 0 and throws a clear ValidationError instead.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import flt

from erpnext.accounts.doctype.budget.budget import Budget


class BudgetOverride(Budget):
    def validate_budget_amount(self):
        amount = self.budget_amount
        print("Variable: budget_amount")
        print("Value:", amount)
        print("Type:", type(amount))

        if amount is None:
            frappe.throw(
                _("Budget Amount is required."),
                title=_("Missing Budget Amount"),
            )

        amount = flt(amount)
        print("Variable: budget_amount (flt)")
        print("Value:", amount)
        print("Type:", type(amount))

        if amount <= 0:
            frappe.throw(
                _("Budget Amount can not be {0}.").format(amount),
                title=_("Invalid Budget Amount"),
            )

        self.budget_amount = amount
