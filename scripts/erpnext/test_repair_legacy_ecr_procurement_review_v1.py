"""Pure guard-policy tests for the targeted ECR repair.

Run from the BidSphere checkout with:

    python -m unittest scripts.erpnext.test_repair_legacy_ecr_procurement_review_v1

The real database transaction must still be dry-run and verified on a backed-up
Frappe site; these tests intentionally do not connect to ERPNext.
"""

from __future__ import annotations

import importlib.util
import pathlib
import sys
import types
import unittest


class RepairRefused(Exception):
    pass


def _load_patch_module():
    frappe = types.ModuleType("frappe")
    frappe.__path__ = []
    frappe._ = lambda value: value

    def throw(message, title=None):
        del title
        raise RepairRefused(message)

    frappe.throw = throw
    frappe.db = types.SimpleNamespace()
    frappe.session = types.SimpleNamespace(user="test@example.invalid")

    frappe_utils = types.ModuleType("frappe.utils")
    frappe_utils.now = lambda: "2026-01-01 00:00:00"
    sys.modules["frappe"] = frappe
    sys.modules["frappe.utils"] = frappe_utils

    path = pathlib.Path(__file__).with_name(
        "repair_legacy_ecr_procurement_review_v1.py"
    )
    spec = importlib.util.spec_from_file_location("ecr_repair_v1_under_test", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


PATCH = _load_patch_module()


def _engineering_approval():
    return {
        "name": "EM-1",
        "approval_role": "Engineering.manager",
        "status": "Approved",
        "required": 1,
    }


class LegacyEcrRepairPolicyTests(unittest.TestCase):
    def test_accepts_punctuated_procurement_team_role_after_engineering_approval(self):
        pending = {
            "name": "PT-1",
            "approval_role": "Procurement.team",
            "status": "pending",
            "required": 1,
        }
        result = PATCH._inspect_tasks([_engineering_approval(), pending])
        self.assertIs(result["pending"], pending)

    def test_refuses_to_create_downstream_task_without_engineering_approval(self):
        with self.assertRaisesRegex(RepairRefused, "Engineering Manager approval"):
            PATCH._inspect_tasks([])

    def test_refuses_duplicate_pending_rows(self):
        with self.assertRaisesRegex(RepairRefused, "2 Pending"):
            PATCH._inspect_tasks(
                [
                    _engineering_approval(),
                    {
                        "name": "PT-1",
                        "approval_role": "Procurement Team",
                        "status": "Pending",
                    },
                    {
                        "name": "PM-1",
                        "approval_role": "Procurement Manager",
                        "status": "Pending",
                    },
                ]
            )

    def test_refuses_future_pending_assignment(self):
        with self.assertRaisesRegex(RepairRefused, "Procurement Manager"):
            PATCH._inspect_tasks(
                [
                    _engineering_approval(),
                    {
                        "name": "PM-1",
                        "approval_role": "Procurement Manager",
                        "status": "Pending",
                    },
                ]
            )

    def test_refuses_persisted_downstream_completion(self):
        with self.assertRaisesRegex(RepairRefused, "downstream completion"):
            PATCH._inspect_tasks(
                [
                    _engineering_approval(),
                    {
                        "name": "PT-OLD",
                        "approval_role": "Procurement Team",
                        "status": "Completed",
                    },
                ]
            )

    def test_allows_known_legacy_state_and_status_pair(self):
        PATCH._assert_repairable_parent(
            {
                "select_pxfp": "Procurement.team Review",
                "status": "Implementation",
                "docstatus": 1,
            }
        )

    def test_allows_premature_rfq_label_only_when_task_guards_can_still_run(self):
        PATCH._assert_repairable_parent(
            {
                "select_pxfp": "RFQ",
                "status": "Implementation",
                "docstatus": 1,
            }
        )

    def test_refuses_unrelated_engineering_review_source(self):
        with self.assertRaisesRegex(RepairRefused, "not a reviewed"):
            PATCH._assert_repairable_parent(
                {
                    "select_pxfp": "Engineering Review",
                    "status": "Engineering Review",
                    "docstatus": 0,
                }
            )

    def test_canonical_state_requires_exact_team_task(self):
        parent = {
            "select_pxfp": "Procurement Review",
            "status": "Procurement Review",
            "docstatus": 0,
        }
        self.assertTrue(
            PATCH._is_canonical(
                parent,
                {
                    "approval_role": "Procurement Team",
                    "status": "Pending",
                    "required": 1,
                },
            )
        )
        self.assertFalse(
            PATCH._is_canonical(
                parent,
                {
                    "approval_role": "Procurement.team",
                    "status": "Pending",
                    "required": 1,
                },
            )
        )


if __name__ == "__main__":
    unittest.main()
