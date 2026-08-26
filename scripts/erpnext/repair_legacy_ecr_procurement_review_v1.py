"""Targeted, transactional repair for a legacy submitted ECR.

Patch ID: bidsphere.ecr.procurement_review_repair.v1

This is deliberately *not* a ``patches.txt`` patch.  It requires an operator to
name one Engineering Change Request and runs as a dry-run unless explicitly
confirmed.  Copy it into a versioned module in the trusted custom Frappe app,
then invoke ``run`` with ``bench execute`` as documented at the end of this
file.

The repair is intentionally narrow: it converts one legacy submitted record
whose persisted state belongs at Procurement Review back to docstatus 0,
synchronizes both state fields, and ensures exactly one active Procurement Team
approval task.  Completed approval rows are never rewritten or deleted.
"""

from __future__ import annotations

import re
from html import escape
from typing import Any

import frappe
from frappe import _
from frappe.utils import now


PATCH_ID = "bidsphere.ecr.procurement_review_repair.v1"
ECR_DOCTYPE = "Engineering Change Request"
APPROVAL_DOCTYPE = "ECR Approval"
APPROVAL_PARENTFIELD = "approval_requirements"
RFQ_DOCTYPE = "Request for Quotation"
TARGET_STATE = "Procurement Review"
TARGET_ROLE = "Procurement Team"

# These are the legacy states that the reviewed sequential-workflow migration
# maps to Procurement Review.  Anything else needs its own reviewed migration.
PROCUREMENT_REVIEW_SOURCE_TOKENS = frozenset(
    {
        "APPROVED",
        "ECR APPROVED",
        "OPERATIONS REVIEW",
        "QUALITY REVIEW",
        "PROGRAM REVIEW",
        "CROSS FUNCTIONAL REVIEW",
        "PROCUREMENT",
        "PROCUREMENT REVIEW",
        "PROCUREMENT TEAM",
        "PROCUREMENT TEAM REVIEW",
        "PROCUREMENT MANAGER",
        "PURCHASE REQUISITION",
        "REQUISITION CREATION",
        "RFQ",
        "RFQ CREATED",
        "RFQ PENDING",
        "SUPPLIER RESPONSE",
        "SUPPLIER EVALUATION",
        "SUPPLIER SELECTION",
        "SUPPLIER SELECTED",
        "IMPLEMENTATION",
        "VALIDATION",
    }
)

TERMINAL_TASK_TOKENS = frozenset(
    {"APPROVED", "COMPLETED", "REJECTED", "SENT BACK"}
)


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _token(value: Any) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9]+", " ", _clean(value).upper())).strip()


def _canonical_role(value: Any) -> str:
    role = _token(value)
    if role in {
        "ENGINEERING",
        "ENGINEERING MANAGER",
        "ENGINEERING MANAGER APPROVAL",
        "ENGINEERING MANAGER REVIEW",
    }:
        return "Engineering Manager"
    if role in {
        "PROCUREMENT TEAM",
        "PROCUREMENT TEAM APPROVAL",
        "PROCUREMENT TEAM REVIEW",
        "PROCUREMENT USER",
        "PURCHASE USER",
    }:
        return TARGET_ROLE
    if role in {
        "PROCUREMENT",
        "PROCUREMENT MANAGER",
        "PROCUREMENT MANAGER APPROVAL",
        "PROCUREMENT MANAGER REVIEW",
        "PURCHASE MANAGER",
    }:
        return "Procurement Manager"
    return _clean(value)


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    value_token = _token(value)
    if value_token in {"", "TRUE", "YES", "Y", "1"}:
        return True
    if value_token in {"FALSE", "NO", "N", "0"}:
        return False
    frappe.throw(
        _("dry_run must be true or false."),
        title=_("Invalid ECR repair option"),
    )
    return True


def _fail(message: str) -> None:
    frappe.throw(_(message), title=_("Legacy ECR repair refused"))


def _assert_schema() -> tuple[Any, bool]:
    if not frappe.db.exists("DocType", ECR_DOCTYPE):
        _fail(f"{ECR_DOCTYPE} is not installed on this site.")
    if not frappe.db.exists("DocType", APPROVAL_DOCTYPE):
        _fail(f"{APPROVAL_DOCTYPE} is not installed on this site.")

    meta = frappe.get_meta(ECR_DOCTYPE)
    required = {"select_pxfp", "status", APPROVAL_PARENTFIELD, "rfq"}
    missing = sorted(field for field in required if not meta.has_field(field))
    if missing:
        _fail(f"{ECR_DOCTYPE} is missing required fields: {', '.join(missing)}.")

    task_field = meta.get_field(APPROVAL_PARENTFIELD)
    if task_field.fieldtype != "Table" or task_field.options != APPROVAL_DOCTYPE:
        _fail(
            f"{ECR_DOCTYPE}.{APPROVAL_PARENTFIELD} must be a Table of "
            f"{APPROVAL_DOCTYPE}."
        )

    state_field = meta.get_field("select_pxfp")
    state_options = {
        _clean(option) for option in _clean(state_field.options).splitlines() if _clean(option)
    }
    if state_field.fieldtype == "Select" and TARGET_STATE not in state_options:
        _fail(f"{ECR_DOCTYPE}.select_pxfp does not allow {TARGET_STATE}.")

    status_field = meta.get_field("status")
    status_options = {
        _clean(option) for option in _clean(status_field.options).splitlines() if _clean(option)
    }
    if (
        status_field.fieldtype == "Select"
        and status_options
        and TARGET_STATE not in status_options
    ):
        _fail(f"{ECR_DOCTYPE}.status does not allow {TARGET_STATE}.")

    return meta, bool(meta.has_field("existing_rfq_reference"))


def _lock_ecr(ecr_name: str, has_existing_rfq_reference: bool) -> dict[str, Any]:
    columns = ["name", "docstatus", "select_pxfp", "status", "rfq"]
    if has_existing_rfq_reference:
        columns.append("existing_rfq_reference")
    quoted_columns = ", ".join(f"`{column}`" for column in columns)
    rows = frappe.db.sql(
        f"""
        SELECT {quoted_columns}
          FROM `tabEngineering Change Request`
         WHERE `name` = %s
         FOR UPDATE
        """,
        (ecr_name,),
        as_dict=True,
    )
    if len(rows) != 1:
        _fail(f"Engineering Change Request {ecr_name} does not exist.")
    return dict(rows[0])


def _lock_tasks(ecr_name: str) -> list[dict[str, Any]]:
    rows = frappe.db.sql(
        """
        SELECT *
          FROM `tabECR Approval`
         WHERE `parent` = %s
         FOR UPDATE
        """,
        (ecr_name,),
        as_dict=True,
    )
    tasks = [dict(row) for row in rows]
    misplaced = [
        task
        for task in tasks
        if _clean(task.get("parenttype")) != ECR_DOCTYPE
        or _clean(task.get("parentfield")) != APPROVAL_PARENTFIELD
    ]
    if misplaced:
        _fail(
            f"{ecr_name} has {len(misplaced)} approval row(s) attached through an "
            "unexpected parent type or field. Repair those rows manually first."
        )
    return tasks


def _linked_rfqs(parent: dict[str, Any]) -> list[str]:
    links = {
        _clean(parent.get("rfq")),
        _clean(parent.get("existing_rfq_reference")),
    }
    links.discard("")

    if frappe.db.exists("DocType", RFQ_DOCTYPE):
        rfq_meta = frappe.get_meta(RFQ_DOCTYPE)
        if rfq_meta.has_field("custom_ecr_reference"):
            rows = frappe.db.sql(
                """
                SELECT `name`
                  FROM `tabRequest for Quotation`
                 WHERE `custom_ecr_reference` = %s
                 FOR UPDATE
                """,
                (parent["name"],),
                as_dict=True,
            )
            links.update(_clean(row.get("name")) for row in rows)
            links.discard("")
    return sorted(links)


def _history_fingerprint(tasks: list[dict[str, Any]]) -> tuple[tuple[Any, ...], ...]:
    fields = (
        "name",
        "idx",
        "department",
        "approval_role",
        "approver",
        "required",
        "status",
        "approval_date",
        "comments",
    )
    rows = [
        tuple(task.get(field) for field in fields)
        for task in tasks
        if _token(task.get("status")) != "PENDING"
    ]
    return tuple(sorted(rows, key=lambda row: _clean(row[0])))


def _inspect_tasks(tasks: list[dict[str, Any]]) -> dict[str, Any]:
    invalid_status = [
        task
        for task in tasks
        if _token(task.get("status")) not in TERMINAL_TASK_TOKENS | {"PENDING"}
    ]
    if invalid_status:
        labels = ", ".join(
            f"{_clean(task.get('name')) or '(unnamed)'}={_clean(task.get('status')) or '(blank)'}"
            for task in invalid_status
        )
        _fail(f"Approval rows have unsupported statuses: {labels}.")

    pending = [task for task in tasks if _token(task.get("status")) == "PENDING"]
    if len(pending) > 1:
        _fail(
            f"Found {len(pending)} Pending approval rows. The patch will not choose "
            "between duplicate or prematurely-created downstream tasks."
        )
    if pending and _canonical_role(pending[0].get("approval_role")) != TARGET_ROLE:
        role = _clean(pending[0].get("approval_role")) or "(blank)"
        _fail(
            f"Pending task {_clean(pending[0].get('name')) or '(unnamed)'} belongs to "
            f"{role}, not {TARGET_ROLE}. The patch will not overwrite a current or "
            "future-stage assignment."
        )

    engineering_approval = [
        task
        for task in tasks
        if _canonical_role(task.get("approval_role")) == "Engineering Manager"
        and _token(task.get("status")) in {"APPROVED", "COMPLETED"}
    ]
    if not engineering_approval:
        _fail(
            "No completed Engineering Manager approval was found. The patch will "
            "not create a Procurement Team task before the preceding approval has "
            "persisted."
        )

    future_completed = [
        task
        for task in tasks
        if _token(task.get("status")) in {"APPROVED", "COMPLETED"}
        and _canonical_role(task.get("approval_role"))
        in {TARGET_ROLE, "Procurement Manager"}
    ]
    if future_completed:
        labels = ", ".join(
            f"{_clean(task.get('name')) or '(unnamed)'} "
            f"({_clean(task.get('approval_role'))}: {_clean(task.get('status'))})"
            for task in future_completed
        )
        _fail(
            "Persisted downstream completion evidence conflicts with Procurement "
            f"Review: {labels}."
        )

    return {"pending": pending[0] if pending else None}


def _assert_repairable_parent(parent: dict[str, Any]) -> None:
    state_token = _token(parent.get("select_pxfp"))
    status_token = _token(parent.get("status"))
    if state_token not in PROCUREMENT_REVIEW_SOURCE_TOKENS:
        _fail(
            f"Workflow state '{_clean(parent.get('select_pxfp')) or '(blank)'}' is not "
            "a reviewed Procurement Review migration source."
        )
    if status_token and status_token not in PROCUREMENT_REVIEW_SOURCE_TOKENS:
        _fail(
            f"Status '{_clean(parent.get('status'))}' does not resolve to Procurement "
            "Review. Resolve the state mismatch manually first."
        )
    if int(parent.get("docstatus") or 0) not in {0, 1}:
        _fail(
            f"docstatus {parent.get('docstatus')} cannot be repaired by this patch; "
            "cancelled records require a separate migration."
        )


def _is_canonical(parent: dict[str, Any], pending: dict[str, Any] | None) -> bool:
    return bool(
        int(parent.get("docstatus") or 0) == 0
        and _clean(parent.get("select_pxfp")) == TARGET_STATE
        and _clean(parent.get("status")) == TARGET_STATE
        and pending
        and _clean(pending.get("approval_role")) == TARGET_ROLE
        and _clean(pending.get("status")) == "Pending"
        and int(pending.get("required") or 0) == 1
    )


def _create_task(ecr_name: str, idx: int) -> str:
    task = frappe.get_doc(
        {
            "doctype": APPROVAL_DOCTYPE,
            "parent": ecr_name,
            "parenttype": ECR_DOCTYPE,
            "parentfield": APPROVAL_PARENTFIELD,
            "idx": idx,
            "department": "Procurement",
            "approval_role": TARGET_ROLE,
            "approver": "",
            "required": 1,
            "status": "Pending",
            "approval_date": None,
            "comments": "",
        }
    )
    # This trusted migration deliberately bypasses the submitted-parent save
    # restriction.  The surrounding transaction and post-write checks are the
    # safety boundary.
    task.db_insert()
    return _clean(task.name)


def _canonicalize_task(task: dict[str, Any]) -> str:
    task_name = _clean(task.get("name"))
    if not task_name:
        _fail("The current Procurement Team task has no database name.")
    frappe.db.set_value(
        APPROVAL_DOCTYPE,
        task_name,
        {
            "approval_role": TARGET_ROLE,
            "required": 1,
            "status": "Pending",
        },
        update_modified=False,
    )
    return task_name


def _add_audit_comment(
    ecr_name: str,
    previous: dict[str, Any],
    task_action: str,
) -> str:
    actor = _clean(getattr(frappe.session, "user", "")) or "Administrator"
    timestamp = now()
    content = (
        "<p><strong>BidSphere trusted data migration</strong></p>"
        f"<p>Patch <code>{escape(PATCH_ID)}</code> repaired this legacy ECR "
        f"for the simplified sequential workflow at {escape(timestamp)} by "
        f"{escape(actor)}. Previous values: docstatus="
        f"{escape(str(previous.get('docstatus')))}, state="
        f"{escape(_clean(previous.get('select_pxfp')) or '(blank)')}, status="
        f"{escape(_clean(previous.get('status')) or '(blank)')}. "
        f"Result: {escape(TARGET_STATE)}, docstatus=0, {escape(task_action)}."
        "</p>"
    )
    comment = frappe.get_doc(
        {
            "doctype": "Comment",
            "comment_type": "Edit",
            "reference_doctype": ECR_DOCTYPE,
            "reference_name": ecr_name,
            "content": content,
        }
    )
    comment.db_insert()
    return _clean(comment.name)


def run(
    ecr_name: str | None = None,
    dry_run: bool | str = True,
    confirm_patch_id: str | None = None,
) -> dict[str, Any]:
    """Inspect or repair exactly one ECR.

    ``dry_run`` defaults to true.  A write additionally requires
    ``confirm_patch_id`` to equal :data:`PATCH_ID`.  This function is intended
    only for a standalone ``bench --site ... execute`` invocation.
    """

    target = _clean(ecr_name)
    if not target:
        _fail("ecr_name is required; broad or all-record migrations are not allowed.")
    is_dry_run = _as_bool(dry_run)
    if not is_dry_run and _clean(confirm_patch_id) != PATCH_ID:
        _fail(
            f"A write requires confirm_patch_id='{PATCH_ID}'. Run the dry-run and "
            "take a site backup first."
        )

    try:
        _meta, has_existing_rfq_reference = _assert_schema()
        parent = _lock_ecr(target, has_existing_rfq_reference)
        tasks = _lock_tasks(target)
        _assert_repairable_parent(parent)

        linked_rfqs = _linked_rfqs(parent)
        if linked_rfqs:
            _fail(
                f"{target} is linked to RFQ record(s): {', '.join(linked_rfqs)}. "
                "Procurement Review repair is not safe after RFQ evidence exists."
            )

        task_state = _inspect_tasks(tasks)
        pending = task_state["pending"]
        completed_before = _history_fingerprint(tasks)

        if _is_canonical(parent, pending):
            frappe.db.rollback()
            return {
                "patch_id": PATCH_ID,
                "ecr_name": target,
                "dry_run": is_dry_run,
                "result": "no-op",
                "state": TARGET_STATE,
                "docstatus": 0,
                "active_task": _clean(pending.get("name")),
                "assigned_to": TARGET_ROLE,
            }

        task_plan = (
            f"canonicalize existing task {_clean(pending.get('name'))}"
            if pending
            else "create one Procurement Team task"
        )
        plan = {
            "patch_id": PATCH_ID,
            "ecr_name": target,
            "dry_run": is_dry_run,
            "result": "would-repair" if is_dry_run else "repaired",
            "previous": {
                "docstatus": int(parent.get("docstatus") or 0),
                "state": _clean(parent.get("select_pxfp")),
                "status": _clean(parent.get("status")),
            },
            "next": {
                "docstatus": 0,
                "state": TARGET_STATE,
                "status": TARGET_STATE,
                "assigned_to": TARGET_ROLE,
            },
            "task_plan": task_plan,
            "completed_history_rows_preserved": len(completed_before),
            "audit_comment": "would be added" if is_dry_run else "",
        }

        if is_dry_run:
            frappe.db.rollback()
            return plan

        frappe.db.set_value(
            ECR_DOCTYPE,
            target,
            {
                "docstatus": 0,
                "select_pxfp": TARGET_STATE,
                "status": TARGET_STATE,
            },
            update_modified=True,
        )
        if pending:
            task_name = _canonicalize_task(pending)
            task_action = f"canonicalized active task {task_name} for {TARGET_ROLE}"
        else:
            next_idx = max((int(task.get("idx") or 0) for task in tasks), default=0) + 1
            task_name = _create_task(target, next_idx)
            task_action = f"created active task {task_name} for {TARGET_ROLE}"

        verified_parent = _lock_ecr(target, has_existing_rfq_reference)
        verified_tasks = _lock_tasks(target)
        verified_task_state = _inspect_tasks(verified_tasks)
        verified_pending = verified_task_state["pending"]
        if not _is_canonical(verified_parent, verified_pending):
            _fail("Post-write verification did not produce the canonical parent/task state.")
        if _history_fingerprint(verified_tasks) != completed_before:
            _fail("Completed approval history changed during the repair.")
        if _linked_rfqs(verified_parent):
            _fail("An RFQ link appeared during the repair; the transaction was rolled back.")

        comment_name = _add_audit_comment(target, parent, task_action)
        frappe.db.commit()
        plan["active_task"] = task_name
        plan["audit_comment"] = comment_name
        return plan
    except Exception:
        # ``run`` is documented only for an isolated bench execute process, so
        # a full rollback is preferable to leaving any direct SQL repair behind.
        frappe.db.rollback()
        raise


__all__ = ["PATCH_ID", "run"]


# Safe operator procedure
# -----------------------
#
# 1. Take a site backup, then reconcile the ECR DocType schema from the
#    BidSphere deployment checkout. This must run first because the repair
#    requires the parent ``status`` field and the child ``Completed`` option:
#
#      bench --site your-site.example backup --with-files
#      node scripts/setup-ecr-doctype.mjs
#
# 2. Copy this file into a versioned module in the trusted custom app, commit
#    it, deploy it, and replace ``your_custom_app.patches.v1_0`` below with its
#    real dotted Python path. Do not install it as a Server Script or add it to
#    patches.txt because the target must be explicit.
#
# 3. Take and retain another site backup immediately before the data repair:
#
#      bench --site your-site.example backup --with-files
#
# 4. Inspect one exact record (dry_run defaults to true):
#
#      bench --site your-site.example execute \
#        your_custom_app.patches.v1_0.repair_legacy_ecr_procurement_review_v1.run \
#        --kwargs '{"ecr_name":"ECR-NAME"}'
#
# 5. After reviewing the plan and confirming there is no linked RFQ, apply it:
#
#      bench --site your-site.example execute \
#        your_custom_app.patches.v1_0.repair_legacy_ecr_procurement_review_v1.run \
#        --kwargs '{"ecr_name":"ECR-NAME","dry_run":false,"confirm_patch_id":"bidsphere.ecr.procurement_review_repair.v1"}'
#
# 6. Run the dry-run command again. It must return ``result: no-op``.
#
# 7. Only after the record repair succeeds, install/activate the simplified
#    sequential workflow from the BidSphere deployment checkout:
#
#      node scripts/setup-ecr-workflow.mjs
#
# 8. Open the ECR as a Procurement Team user and verify Procurement Review,
#    Review and approve, Procurement Team, and one active approval task.
