"""Portable behavior tests. A transactional fake models Frappe POST rollback.

These are not a substitute for the live database/lock acceptance checklist in
README.md. They run without installing Frappe on the frontend workstation.
"""
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime
import importlib.util
import json
from pathlib import Path
import sys
import threading
import types
import unittest


class ValidationError(Exception):
    pass


class PermissionError(Exception):
    pass


class Document(dict):
    def __getattr__(self, key):
        return self.get(key)

    def __setattr__(self, key, value):
        if key.startswith("_"):
            return object.__setattr__(self, key, value)
        self[key] = value

    def as_dict(self):
        return deepcopy(dict(self))

    def get_content(self):
        return self.get("_test_pdf_bytes")

    def check_permission(self, kind):
        if not STORE.allowed:
            raise PermissionError("ERP write permission denied")

    def insert(self):
        if STORE.fail_insert or STORE.fail_contract_insert and self.get("doctype") == "Contract":
            raise ValidationError("Contract Request validation failed")
        if self.get("doctype") == "Contract Request" and any(row.get("custom_rfq") == self.get("custom_rfq") for (dt, _), row in STORE.docs.items() if dt == "Contract Request"):
            raise ValidationError("Duplicate RFQ source")
        self["name"] = "CON-1" if self.get("doctype") == "Contract" else "CR-1"
        self["modified"] = "cr1"
        if self.get("doctype") == "Contract":
            subject.guard_contract(self)
        elif self.get("doctype") == "Contract Request":
            subject.guard_request(self)
        STORE.put(self)
        if self.get("doctype") == "Contract":
            subject.sync_contract(self)
        return self

    def save(self):
        if self["doctype"] == "Request for Quotation":
            subject.guard_rfq(self)
            if STORE.fail_rfq_save:
                raise ValidationError("RFQ validation failed after request insertion")
        elif self["doctype"] == "Contract":
            subject.guard_contract(self)
        elif self["doctype"] == "Legal Document Review":
            subject.guard_award_state(self)
            if STORE.fail_award_save:
                raise ValidationError("Award state save failed")
        elif self["doctype"] == "Contract Request":
            subject.guard_request(self)
            if STORE.fail_request_save:
                raise ValidationError("Request conversion save failed")
        self["modified"] = "r2"
        STORE.put(self)
        if self["doctype"] == "Contract":
            subject.sync_contract(self)
        return self

    def get_doc_before_save(self):
        value = STORE.docs.get((self.get("doctype"), self.get("name")))
        return Document(deepcopy(value)) if value else None


class Store:
    def __init__(self):
        self.docs = {}
        self.allowed = True
        self.fail_insert = False
        self.fail_contract_insert = False
        self.fail_rfq_save = False
        self.fail_award_save = False
        self.fail_request_save = False
        self.unique = True
        self.award_state_field = True
        self.drop_fields = {}
        self.locks = []
        self.lock = threading.RLock()

    def put(self, document):
        stored = deepcopy(dict(document))
        for field in self.drop_fields.get(document["doctype"], []):
            stored.pop(field, None)
        self.docs[(document["doctype"], document["name"])] = stored

    def load(self, doctype, name=None, for_update=False):
        if isinstance(doctype, dict):
            return Document(deepcopy(doctype))
        if for_update:
            self.locks.append((doctype, name))
        return Document(deepcopy(self.docs[(doctype, name)]))

    def list(self, doctype, filters=None, pluck=None):
        rows = [row for (dt, _), row in self.docs.items() if dt == doctype]
        if isinstance(filters, dict):
            rows = [row for row in rows if all(row.get(key) == value for key, value in filters.items())]
        elif filters:
            for clause in filters:
                if len(clause) == 4:
                    _, field, op, value = clause
                    rows = [row for row in rows if any(child.get(field) == value for child in row.get("items", []))]
                else:
                    field, op, value = clause
                    rows = [row for row in rows if (row.get(field) != value if op == "!=" else row.get(field) == value)]
        return [row[pluck] for row in rows]

    @contextmanager
    def transaction(self):
        # Models Frappe's one POST transaction and RFQ FOR UPDATE serialization.
        with self.lock:
            before = deepcopy(self.docs)
            try:
                yield
            except Exception:
                self.docs = before
                raise


STORE = Store()
frappe = types.ModuleType("frappe")
frappe.ValidationError = ValidationError
frappe.PermissionError = PermissionError
frappe.whitelist = lambda **kwargs: lambda fn: fn
frappe.throw = lambda message, exc=ValidationError: (_ for _ in ()).throw(exc(message))
frappe.get_doc = lambda *args, **kwargs: STORE.load(*args, **kwargs)
frappe.get_all = lambda *args, **kwargs: STORE.list(*args, **kwargs)
frappe.get_meta = lambda dt: types.SimpleNamespace(get_field=lambda name: None if name == "custom_clm_state" and not STORE.award_state_field else types.SimpleNamespace(unique=STORE.unique))
frappe.db = types.SimpleNamespace(exists=lambda dt, name: (dt, name) in STORE.docs)
frappe.conf = {"bidsphere_gateway_user": "gateway@example.test"}
frappe.session = types.SimpleNamespace(user="gateway@example.test")
frappe.local = threading.local()
utils = types.ModuleType("frappe.utils")
utils.now_datetime = lambda: datetime(2026, 9, 18, 15, 0, 0)
sys.modules["frappe"] = frappe
sys.modules["frappe.utils"] = utils
spec = importlib.util.spec_from_file_location("rfq_clm", Path(__file__).parents[1] / "bidsphere_workflows" / "rfq_clm.py")
subject = importlib.util.module_from_spec(spec)
spec.loader.exec_module(subject)


class RfqClmTests(unittest.TestCase):
    def setUp(self):
        global STORE
        STORE = Store()
        frappe.conf = {"bidsphere_gateway_user": "gateway@example.test"}
        frappe.session.user = "gateway@example.test"
        frappe.local = threading.local()
        STORE.put({"doctype": "Request for Quotation", "name": "RFQ-1", "modified": "r1", "docstatus": 1, "status": "Submitted", "company": "COMPANY", "contract_required": "No", "custom_selected_supplier": "SUP-1", "custom_workflow_step": "Pending Legal Review", "custom_approval_data": json.dumps({"rfq": "RFQ-1", "selected_supplier": "SUP-1", "workflow_step": "Pending Legal Review", "unrelated": "preserved"})})
        STORE.put({"doctype": "Supplier Quotation", "name": "SQ-1", "modified": "q1", "docstatus": 1, "supplier": "SUP-1", "company": "COMPANY", "currency": "USD", "grand_total": 100, "items": [{"request_for_quotation": "RFQ-1"}]})
        STORE.put({"doctype": "Supplier", "name": "SUP-1", "disabled": 0})
        STORE.put({"doctype": "Legal Document Review", "name": "LDR-1", "modified": "l1", "rfq_name": "RFQ-1", "sq_name": "SQ-1", "supplier": "SUP-1", "company": "COMPANY", "grand_total": 95, "workflow_state": "Pending Review"})
        STORE.put({"doctype": "User", "name": "inteva@example.test", "enabled": 1, "roles": [{"role": "Legal Manager"}]})
        self.actor = {"id": "buyer@example.test", "role": "procurement_team"}
        self.award = {"quotation": "SQ-1", "quotation_modified": "q1", "legal_review": "LDR-1", "legal_review_modified": "l1", "supplier": "SUP-1", "amount": 95, "currency": "USD", "company": "COMPANY", "department": "Production - COMPANY"}
        self.runtime = json.dumps({"schema": 1, "rfq_request_workflow": {"version": 1, "phase": "procurement_team", "assigned_role": "procurement_team"}, "approvals": [{"id": "TEAM-1", "role": "procurement_team", "stage": 0, "status": "Pending", "rule": "RFQ Award: Procurement Team"}], "versions": [], "signatures": [], "sla": [], "audit": [{"action": "create", "by": self.actor["id"], "at": "2026-09-18 15:00:00"}, {"action": "procurement_team_assigned", "by": self.actor["id"], "role": "procurement_team", "at": "2026-09-18 15:00:00", "previous_status": "Draft", "new_status": "Pending Procurement Team"}], "rfq_source": {"rfq": "RFQ-1", "quotation": "SQ-1", "award": "LDR-1", "supplier": "SUP-1", "contract_required": True, "company": "COMPANY", "department": "Production - COMPANY", "amount": 95, "currency": "USD"}, "source_documents": []})
        self.request = {"doctype": "Contract Request", "requester": self.actor["id"], "custom_rfq": "RFQ-1", "custom_supplier_quotation": "SQ-1", "supplier": "SUP-1", "company": "COMPANY", "currency": "USD", "contract_value": 95, "estimated_contract_value": 95, "request_status": "Draft", "approval_status": "Pending", "custom_clm_data": self.runtime, "department": "Production - COMPANY", "contract_type": "Supply / Procurement Contract", "contract_purpose": "Procurement from SUP-1 under RFQ-1.", "description": "Awarded procurement of the RFQ-1 items.", "contract_start_date": "2026-09-21", "contract_end_date": "2027-09-21", "legal_review_required": 1}

    def decide(self, decision="Yes", **changes):
        args = {"rfq": "RFQ-1", "expected_modified": "r1", "decision": decision, "actor": self.actor, "award": self.award, "request_document": self.request if decision == "Yes" else None, "contract_fields": {"custom_risk_level": "Medium", "custom_inteva_signatory": "inteva@example.test"}, **changes}
        with STORE.transaction():
            return subject.decide(**args)

    def create_contract(self, **changes):
        # Legal-stage tests use the real two separate commits: persist the Team
        # request first, then process it with the explicit Team creation action.
        if not json.loads(self.rfq().custom_approval_data).get("contract_decision"):
            self.decide()
        changes.setdefault("award", {**self.award, "legal_review_modified": STORE.load("Legal Document Review", "LDR-1").modified})
        return self.decide(create_contract=True, **changes)

    def rfq(self):
        return STORE.load("Request for Quotation", "RFQ-1")

    def po(self, **changes):
        return Document({"doctype": "Purchase Order", "name": "PO-NEW", "supplier": "SUP-1", "items": [{"supplier_quotation": "SQ-1"}], **changes})

    def executed(self):
        STORE.put({"doctype": "Contract", "name": "CON-1", "custom_rfq": "RFQ-1", "custom_contract_request": "CR-1", "custom_supplier_quotation": "SQ-1", "custom_supplier": "SUP-1", "custom_contract_status": "Executed", "custom_esign_status": "Completed", "custom_final_version_locked": 1, "custom_executed_contract": "/private/files/executed.pdf", "custom_current_version": "1.0", "custom_clm_data": json.dumps({"schema": 1, "locked_hash": "c" * 64, "version": "version-uuid", "versions": [{"id": "version-uuid", "number": "1.0", "hash": "b" * 64, "content": {"custom_supplier": "SUP-1"}}], "approvals": [{"role": "legal", "stage": 0, "status": "Approved", "by": "legal@example.test", "at": "2026-09-21T09:00:00Z"}, {"role": "finance", "stage": 1, "status": "Approved", "by": "finance@example.test", "at": "2026-09-21T11:00:00Z"}], "signatures": [{"party": party, "version": "1.0", "file_id": party, "hash": "a" * 64} for party in ["supplier", "inteva"]]})})
        STORE.docs[("Contract", "CON-1")].update({"custom_contract_value": 95, "custom_currency": "USD"})
        contract = STORE.docs[("Contract", "CON-1")]
        contract["custom_inteva_signatory"] = "inteva@example.test"
        data = json.loads(contract["custom_clm_data"])
        content = subject._contract_snapshot(contract)
        data["versions"][0].update({"hash": subject._digest(content), "content": content})
        data["locked_hash"] = subject._digest({"content": content, "clause_ids": [], "non_standard_clause": False})
        for signature in data["signatures"]:
            signature.update({"by": signature["party"] + "@example.test", "at": "2026-09-21T10:00:00Z", "file_url": "/private/files/" + signature["party"] + ".pdf"})
        self.execution_files(contract, data)
        contract["custom_clm_data"] = json.dumps(data)
        # Legacy execution fixtures include the matching committed RFQ mirror.
        rfq = STORE.docs[("Request for Quotation", "RFQ-1")]
        selection = json.loads(rfq["custom_approval_data"])
        if selection.get("contract_decision"):
            selection["contract_decision"]["clm"] = {"contract": "CON-1", "status": "Executed", "blocked": False}
            rfq["custom_approval_data"] = json.dumps(selection)

    def execution_files(self, contract, data):
        data["locked_file"] = {"file_id": "locked", "file_url": "/private/files/locked.pdf"}
        for evidence in [data["locked_file"], *data["signatures"]]:
            content = b"%PDF-1.7 portable signing fixture " + evidence["file_id"].encode()
            evidence["hash"] = subject.hashlib.sha256(content).hexdigest()
            STORE.put({"doctype": "File", "name": evidence["file_id"], "file_url": evidence["file_url"], "is_private": 1, "is_folder": 0, "attached_to_doctype": "Contract", "attached_to_name": contract["name"], "_test_pdf_bytes": content})
        contract["custom_executed_contract"] = next(row["file_url"] for row in data["signatures"] if row["party"] == "inteva")

    def test_yes_inserts_request_and_records_decision_together(self):
        result = self.decide()
        self.assertTrue(result["created"])
        self.assertEqual(result["request"]["custom_clm_data"], self.runtime)
        rfq = self.rfq()
        data = json.loads(rfq.custom_approval_data)
        self.assertEqual(rfq.contract_required, "Yes")
        self.assertEqual(data["contract_decision"]["request"], "CR-1")
        self.assertEqual(data["contract_decision"]["quotation"], "SQ-1")
        self.assertEqual(data["unrelated"], "preserved")
        self.assertEqual(rfq.custom_workflow_step, "Pending Legal Review")
        self.assertEqual(STORE.locks[0], ("Request for Quotation", "RFQ-1"))

    def test_yes_persists_only_procurement_team_request_before_any_legal_assignment(self):
        result = self.decide()
        request = STORE.load("Contract Request", result["request"]["name"])
        data = json.loads(request.custom_clm_data)
        self.assertIsNone(result["contract"])
        self.assertEqual(STORE.list("Contract", {}, "name"), [])
        self.assertEqual(request.requester, self.actor["id"])
        self.assertEqual(request.request_status, "Draft")
        self.assertEqual(data["rfq_request_workflow"], {"version": 1, "phase": "procurement_team", "assigned_role": "procurement_team"})
        self.assertEqual([(row["role"], row["status"]) for row in data["approvals"]], [("procurement_team", "Pending")])
        self.assertFalse(any(row["role"] in ("procurement", "legal", "finance") for row in data["approvals"]))
        self.assertEqual(result["decision"]["clm"], {"request": request.name, "status": "Pending Procurement Team", "phase": "procurement_team", "assigned_role": "procurement_team", "contract_required": "Yes", "blocked": True})
        self.assertEqual(json.loads(STORE.load("Legal Document Review", "LDR-1").custom_clm_state), {"rfq_id": "RFQ-1", "award_id": "LDR-1", **result["decision"]["clm"]})
        self.assertEqual(data["audit"][-1]["action"], "procurement_team_assigned")
        with self.assertRaises(ValidationError):
            subject.guard_purchase_order(self.po())
        contract_result = self.create_contract()
        converted = json.loads(contract_result["request"]["custom_clm_data"])
        self.assertEqual(converted["rfq_request_workflow"]["phase"], "contract_created")
        self.assertEqual(converted["approvals"][0]["status"], "Approved")
        self.assertEqual(converted["approvals"][0]["by"], self.actor["id"])
        self.assertTrue(converted["approvals"][0]["at"])
        legal = json.loads(contract_result["contract"]["custom_clm_data"])
        self.assertEqual([(row["role"], row["status"]) for row in legal["approvals"]], [("legal", "Pending")])

    def test_direct_one_step_contract_creation_is_rejected_without_saving_anything(self):
        before = deepcopy(STORE.docs)
        with self.assertRaisesRegex(ValidationError, "separate Create Contract action"):
            self.decide(create_contract=True)
        self.assertEqual(STORE.docs, before)

    def test_new_request_assignment_must_be_real_and_belong_to_procurement_team(self):
        for invalid in ("missing_marker", "wrong_role", "wrong_phase", "manager_approval", "approved", "completed", "assigned_user", "missing_audit", "wrong_actor", "wrong_requester"):
            with self.subTest(invalid=invalid):
                data = json.loads(self.runtime)
                payload = deepcopy(self.request)
                if invalid == "missing_marker":
                    del data["rfq_request_workflow"]
                elif invalid == "wrong_role":
                    data["rfq_request_workflow"]["assigned_role"] = "procurement"
                elif invalid == "wrong_phase":
                    data["rfq_request_workflow"]["phase"] = "legal_review"
                elif invalid == "manager_approval":
                    data["approvals"][0]["role"] = "procurement"
                elif invalid in ("approved", "completed"):
                    data["approvals"][0]["status"] = invalid.title()
                elif invalid == "assigned_user":
                    data["approvals"][0]["user"] = "manager@example.test"
                elif invalid == "missing_audit":
                    data["audit"].pop()
                elif invalid == "wrong_actor":
                    data["audit"][-1]["by"] = "different@example.test"
                else:
                    payload["requester"] = "different@example.test"
                payload["custom_clm_data"] = json.dumps(data)
                before = deepcopy(STORE.docs)
                with self.assertRaises(ValidationError):
                    self.decide(request_document=payload)
                self.assertEqual(STORE.docs, before)

    def test_native_request_save_cannot_reassign_or_skip_procurement_team_or_erase_audit(self):
        self.decide()
        for change in ("role", "approval", "phase", "requester", "source", "rfq", "audit"):
            with self.subTest(change=change):
                request = STORE.load("Contract Request", "CR-1")
                data = json.loads(request.custom_clm_data)
                if change == "role":
                    data["rfq_request_workflow"]["assigned_role"] = "procurement"
                elif change == "approval":
                    data["approvals"][0]["status"] = "Approved"
                elif change == "phase":
                    data["rfq_request_workflow"]["phase"] = "contract_created"
                elif change == "requester":
                    request.requester = "someone@example.test"
                elif change == "source":
                    data["rfq_source"]["award"] = "FOREIGN"
                elif change == "rfq":
                    request.custom_rfq = ""
                else:
                    data["audit"] = []
                request.custom_clm_data = json.dumps(data)
                before = deepcopy(STORE.docs)
                with self.assertRaises(ValidationError), STORE.transaction():
                    request.save()
                self.assertEqual(STORE.docs, before)

    def test_legacy_request_requires_explicit_audited_routing_before_team_conversion(self):
        self.decide()
        for status in ("Draft", "Approved"):
            with self.subTest(status=status):
                self.setUp()
                self.decide()
                request = STORE.docs[("Contract Request", "CR-1")]
                legacy_data = json.loads(request["custom_clm_data"])
                del legacy_data["rfq_request_workflow"]
                legacy_data["approvals"] = []
                legacy_data["audit"] = legacy_data["audit"][:-1]
                request["request_status"] = status
                request["custom_clm_data"] = json.dumps(legacy_data)
                before = deepcopy(STORE.docs)
                with self.assertRaisesRegex(ValidationError, "Procurement Team assignment"):
                    self.create_contract()
                self.assertEqual(STORE.docs, before)
                payload = deepcopy(request)
                routed = deepcopy(legacy_data)
                original = json.loads(self.runtime)
                routed["rfq_request_workflow"] = original["rfq_request_workflow"]
                routed["approvals"] = original["approvals"]
                routed["audit"].append({**original["audit"][-1], "previous_status": status})
                payload["custom_clm_data"] = json.dumps(routed)
                response = self.decide(request_document=payload)
                self.assertFalse(response["created"])
                self.assertIsNone(response["contract"])
                self.assertEqual(json.loads(response["request"]["custom_clm_data"]), routed)
                self.assertEqual(response["request"]["request_status"], status)
                self.assertEqual(self.create_contract()["contract"]["name"], "CON-1")

    def test_legacy_routing_does_not_rewrite_terms_source_or_existing_approvals(self):
        for change in ("purpose", "source", "old_audit", "prior_approval"):
            with self.subTest(change=change):
                self.setUp()
                self.decide()
                request = STORE.docs[("Contract Request", "CR-1")]
                prior = json.loads(request["custom_clm_data"])
                del prior["rfq_request_workflow"]
                prior["approvals"] = []
                prior["audit"].pop()
                if change == "prior_approval":
                    prior["approvals"] = [{"role": "procurement", "status": "Approved"}]
                request["custom_clm_data"] = json.dumps(prior)
                payload = deepcopy(request)
                data = json.loads(self.runtime)
                if change == "purpose":
                    payload["contract_purpose"] = "Replacement purpose"
                elif change == "source":
                    data["rfq_source"]["amount"] = 1
                elif change == "old_audit":
                    data["audit"][0]["by"] = "different@example.test"
                payload["custom_clm_data"] = json.dumps(data)
                before = deepcopy(STORE.docs)
                with self.assertRaises(ValidationError):
                    self.decide(request_document=payload)
                self.assertEqual(STORE.docs, before)

    def test_no_records_choice_without_creating_clm_and_allows_existing_path(self):
        result = self.decide("No")
        self.assertFalse(result["created"])
        self.assertIsNone(result["request"])
        self.assertEqual(result["decision"]["decision"], "No")
        subject.guard_purchase_order(self.po())

    def test_new_award_request_requires_explicit_supported_contract_type(self):
        for value in (None, "", " ", "Select Contract Type", "Supplier Agreement", "made-up", []):
            with self.subTest(value=value):
                before = deepcopy(STORE.docs)
                with self.assertRaisesRegex(ValidationError, "Contract Type"):
                    self.decide(request_document={**self.request, "contract_type": value})
                self.assertEqual(STORE.docs, before)
        for value in ("Supply / Procurement Contract", "Service Agreement", "NDA", "Master Service Agreement", "Other"):
            with self.subTest(accepted=value):
                self.setUp()
                result = self.decide(request_document={**self.request, "contract_type": value})
                self.assertEqual(result["request"]["contract_type"], value)

    def test_new_award_request_rejects_blank_purpose_description_and_department(self):
        for field in ("contract_purpose", "description", "department"):
            for value in (None, "", " \n\t ", 123):
                with self.subTest(field=field, value=value):
                    before = deepcopy(STORE.docs)
                    with self.assertRaisesRegex(ValidationError, "is required"):
                        self.decide(request_document={**self.request, field: value})
                    self.assertEqual(STORE.docs, before)

    def test_new_award_request_rejects_nonexistent_malformed_or_reversed_dates(self):
        for field in ("contract_start_date", "contract_end_date"):
            for value in (None, "", "2026-02-30", "2026-13-01", "2026-9-21", "20260921", "2026-09-21T00:00:00Z", 20260921):
                with self.subTest(field=field, value=value):
                    before = deepcopy(STORE.docs)
                    with self.assertRaisesRegex(ValidationError, "valid Contract"):
                        self.decide(request_document={**self.request, field: value})
                    self.assertEqual(STORE.docs, before)
        with self.assertRaisesRegex(ValidationError, "must be after"):
            self.decide(request_document={**self.request, "contract_end_date": "2026-09-20"})
        result = self.decide(request_document={**self.request, "contract_start_date": "2028-02-29", "contract_end_date": "2028-03-01"})
        self.assertEqual(result["request"]["contract_end_date"], "2028-03-01")

    def test_new_award_request_preserves_department_and_context_metadata(self):
        for field, value in (("company", "OTHER"), ("currency", "EUR"), ("amount", 500), ("department", "Other Department")):
            with self.subTest(field=field):
                runtime = json.loads(self.runtime)
                runtime["rfq_source"][field] = value
                before = deepcopy(STORE.docs)
                with self.assertRaises(ValidationError):
                    self.decide(request_document={**self.request, "custom_clm_data": json.dumps(runtime)})
                self.assertEqual(STORE.docs, before)
        with self.assertRaisesRegex(ValidationError, "award department"):
            self.decide(request_document={**self.request, "department": "OTHER"})
        result = self.decide()
        source = json.loads(result["request"]["custom_clm_data"])["rfq_source"]
        self.assertEqual({key: source[key] for key in ("company", "department", "amount", "currency", "award")}, {"company": "COMPANY", "department": "Production - COMPANY", "amount": 95, "currency": "USD", "award": "LDR-1"})

    def test_manual_department_is_preserved_when_award_has_no_department(self):
        award = {**self.award, "department": ""}
        result = self.decide(award=award)
        self.assertEqual(result["request"]["department"], "Production - COMPANY")
        self.assertEqual(json.loads(result["request"]["custom_clm_data"])["rfq_source"]["department"], "Production - COMPANY")

    def test_new_award_request_requires_legal_review_and_detects_dropped_form_fields(self):
        for value in (None, 0, "0"):
            with self.assertRaisesRegex(ValidationError, "Legal Manager review"):
                self.decide(request_document={**self.request, "legal_review_required": value})
        for field in subject._AWARD_FORM_FIELDS:
            with self.subTest(field=field):
                before = deepcopy(STORE.docs)
                STORE.drop_fields = {"Contract Request": [field]}
                with self.assertRaises(ValidationError):
                    self.decide()
                self.assertEqual(STORE.docs, before)
        STORE.drop_fields = {}

    def test_legacy_request_adoption_and_retry_keep_legacy_type_and_details(self):
        legacy = {**self.request, "name": "CR-OLD", "contract_type": "Supplier Agreement", "contract_purpose": "", "contract_start_date": None, "legal_review_required": 0}
        runtime = json.loads(self.runtime)
        for key in ("company", "department", "amount", "currency"):
            runtime["rfq_source"].pop(key)
        legacy["custom_clm_data"] = json.dumps(runtime)
        STORE.put(legacy)
        result = self.decide()
        self.assertFalse(result["created"])
        self.assertEqual(result["request"]["contract_type"], "Supplier Agreement")
        before = deepcopy(STORE.docs)
        retry = self.decide(request_document={"contract_type": ""})
        self.assertFalse(retry["created"])
        self.assertEqual(STORE.docs, before)

    def test_request_validation_failure_rolls_back_yes(self):
        STORE.fail_insert = True
        before = deepcopy(STORE.docs)
        with self.assertRaisesRegex(ValidationError, "Contract Request validation"):
            self.decide()
        self.assertEqual(STORE.docs, before)

    def test_rfq_save_failure_after_insert_rolls_back_request_and_flag(self):
        STORE.fail_rfq_save = True
        before = deepcopy(STORE.docs)
        with self.assertRaisesRegex(ValidationError, "RFQ validation"):
            self.decide()
        self.assertEqual(STORE.docs, before)
        self.assertIsNone(getattr(frappe.local, subject._CONTEXT, None))

    def test_same_choice_retry_ignores_old_revision_and_reuses_request(self):
        self.decide()
        before = deepcopy(STORE.docs)
        result = self.decide()
        self.assertFalse(result["created"])
        self.assertEqual(result["request"]["name"], "CR-1")
        self.assertEqual(STORE.docs, before)

    def test_concurrent_duplicate_posts_create_one_request(self):
        results, errors = [], []
        def run():
            try:
                results.append(self.decide())
            except Exception as error:
                errors.append(error)
        workers = [threading.Thread(target=run) for _ in range(2)]
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join()
        self.assertEqual(errors, [])
        self.assertEqual(sorted(row["created"] for row in results), [False, True])
        self.assertEqual(len(STORE.list("Contract Request", {}, "name")), 1)

    def test_opposite_choice_cannot_replace_saved_decision(self):
        self.decide("No")
        with self.assertRaisesRegex(ValidationError, "already recorded"):
            self.decide("Yes")

    def test_non_gateway_user_and_unconfigured_service_cannot_call(self):
        frappe.session.user = "Administrator"
        with self.assertRaises(PermissionError):
            self.decide()
        frappe.session.user = "gateway@example.test"
        frappe.conf = {}
        with self.assertRaises(PermissionError):
            self.decide()

    def test_unauthorized_actor_and_native_write_permission_denied(self):
        with self.assertRaises(PermissionError):
            self.decide(actor={"id": "supplier@example.test", "role": "supplier"})
        STORE.allowed = False
        with self.assertRaises(PermissionError):
            self.decide()

    def test_stale_revisions_and_changed_award_do_not_write(self):
        for changes in [{"expected_modified": "old"}, {"award": {**self.award, "quotation_modified": "old"}}, {"award": {**self.award, "legal_review_modified": "old"}}, {"award": {**self.award, "amount": 100}}, {"award": {**self.award, "currency": "EUR"}}]:
            before = deepcopy(STORE.docs)
            with self.assertRaises(ValidationError):
                self.decide(**changes)
            self.assertEqual(STORE.docs, before)

    def test_draft_or_mismatched_quotation_cannot_be_awarded(self):
        STORE.docs[("Supplier Quotation", "SQ-1")]["docstatus"] = 0
        with self.assertRaisesRegex(ValidationError, "submitted"):
            self.decide()

    def test_disabled_supplier_and_missing_unique_constraint_fail(self):
        STORE.docs[("Supplier", "SUP-1")]["disabled"] = 1
        with self.assertRaisesRegex(ValidationError, "Supplier"):
            self.decide()
        STORE.docs[("Supplier", "SUP-1")]["disabled"] = 0
        STORE.unique = False
        with self.assertRaisesRegex(ValidationError, "unique constraint"):
            self.decide()

    def test_preexisting_request_is_adopted_without_duplicate(self):
        STORE.put({**self.request, "name": "CR-OLD", "modified": "cr1"})
        result = self.decide()
        self.assertFalse(result["created"])
        self.assertEqual(result["decision"]["request"], "CR-OLD")

    def test_no_is_rejected_if_clm_exists(self):
        STORE.put({**self.request, "name": "CR-OLD"})
        with self.assertRaisesRegex(ValidationError, "existing CLM"):
            self.decide("No")

    def test_bad_request_source_or_approval_state_is_rejected(self):
        for changes in [{"supplier": "SUP-OTHER"}, {"contract_value": 96}, {"name": "CLIENT-ID"}, {"approval_status": "Approved"}, {"flags": {"ignore_permissions": True}}]:
            with self.assertRaises(ValidationError):
                self.decide(request_document={**self.request, **changes})

    def test_ecr_business_case_trace_is_verified_and_persisted(self):
        STORE.docs[("Request for Quotation", "RFQ-1")]["custom_ecr_reference"] = "ECR-1"
        STORE.put({"doctype": "Engineering Change Request", "name": "ECR-1", "ecr_business_case": json.dumps({"business_case_id": "BC-ECR-1"})})
        award = {**self.award, "ecr": "ECR-1", "business_case": "BC-ECR-1"}
        runtime = json.loads(self.runtime)
        runtime["rfq_source"].update({"ecr": "ECR-1", "business_case": "BC-ECR-1"})
        result = self.decide(award=award, request_document={**self.request, "custom_clm_data": json.dumps(runtime)})
        self.assertEqual(result["decision"]["business_case"], "BC-ECR-1")

    def test_business_case_backlink_is_verified(self):
        STORE.put({"doctype": "Business Case", "name": "BC-1", "rfq_id": "RFQ-OTHER"})
        with self.assertRaisesRegex(ValidationError, "Business Case source"):
            self.decide("No", award={**self.award, "business_case": "BC-1"})
        STORE.docs[("Business Case", "BC-1")]["rfq_id"] = "RFQ-1"
        self.decide("No", award={**self.award, "business_case": "BC-1"})

    def test_direct_flag_or_decision_mutations_are_blocked(self):
        doc = self.rfq()
        doc.contract_required = "Yes"
        with self.assertRaisesRegex(ValidationError, "award decision action"):
            subject.guard_rfq(doc)
        self.decide("No")
        doc = self.rfq()
        data = json.loads(doc.custom_approval_data)
        del data["contract_decision"]
        doc.custom_approval_data = json.dumps(data)
        with self.assertRaisesRegex(ValidationError, "must be preserved"):
            subject.guard_rfq(doc)

    def test_unrelated_rfqs_and_initial_draft_flag_are_unchanged(self):
        new = Document({"doctype": "Request for Quotation", "name": "RFQ-NEW", "contract_required": "Yes"})
        subject.guard_rfq(new)
        doc = self.rfq()
        doc.title = "Revised title"
        subject.guard_rfq(doc)

    def test_pending_or_yes_clm_blocks_po_until_executed(self):
        with self.assertRaisesRegex(ValidationError, "Record Contract"):
            subject.guard_purchase_order(self.po())
        self.decide()
        with self.assertRaisesRegex(ValidationError, "executed Contract"):
            subject.guard_purchase_order(self.po())
        self.executed()
        subject.guard_purchase_order(self.po())

    def test_missing_signature_and_wrong_execution_version_block_po(self):
        self.decide()
        self.executed()
        contract = STORE.docs[("Contract", "CON-1")]
        contract["custom_inteva_signatory"] = "inteva@example.test"
        data = json.loads(contract["custom_clm_data"])
        data["signatures"].pop()
        contract["custom_clm_data"] = json.dumps(data)
        with self.assertRaisesRegex(ValidationError, "both signatures"):
            subject.guard_purchase_order(self.po())

    def test_legacy_existing_po_edit_and_standalone_po_are_unchanged(self):
        existing = self.po(name="PO-OLD")
        STORE.put(existing)
        subject.guard_purchase_order(existing)
        subject.guard_purchase_order(self.po(items=[{"item_code": "ITEM-1"}]))

    def test_legacy_existing_po_with_yes_flag_still_cannot_bypass(self):
        existing = self.po(name="PO-OLD")
        STORE.put(existing)
        STORE.docs[("Request for Quotation", "RFQ-1")]["contract_required"] = "Yes"
        with self.assertRaises(ValidationError):
            subject.guard_purchase_order(existing)

    def test_po_cannot_detach_quotation_or_switch_supplier(self):
        with self.assertRaisesRegex(ValidationError, "Quotation links"):
            subject.guard_purchase_order(self.po(rfq="RFQ-1", items=[{"item_code": "ITEM-1"}]))
        with self.assertRaisesRegex(ValidationError, "awarded supplier"):
            subject.guard_purchase_order(self.po(supplier="SUP-OTHER"))

    def test_schema_omissions_are_detected_inside_transaction_and_rolled_back(self):
        for doctype, field in [("Contract Request", "custom_clm_data"), ("Contract Request", "custom_rfq"), ("Request for Quotation", "custom_approval_data"), ("Request for Quotation", "contract_required")]:
            before = deepcopy(STORE.docs)
            STORE.drop_fields = {doctype: [field]}
            with self.assertRaises(ValidationError):
                self.decide()
            self.assertEqual(STORE.docs, before)
        STORE.drop_fields = {}

    def test_closed_award_round_remains_valid(self):
        STORE.docs[("Request for Quotation", "RFQ-1")]["custom_active_rfq_round"] = "ROUND-1"
        STORE.docs[("Supplier Quotation", "SQ-1")]["custom_rfq_round"] = "ROUND-1"
        STORE.put({"doctype": "RFQ Round", "name": "ROUND-1", "rfq": "RFQ-1", "status": "Closed"})
        self.decide("No")
        subject.guard_purchase_order(self.po())

    def test_changed_award_amount_blocks_no_and_yes_continuation(self):
        self.decide("No")
        STORE.docs[("Legal Document Review", "LDR-1")]["grand_total"] = 96
        with self.assertRaisesRegex(ValidationError, "award amount"):
            subject.guard_purchase_order(self.po())

    def test_wrong_contract_or_request_award_value_blocks_po(self):
        self.decide()
        self.executed()
        STORE.docs[("Contract", "CON-1")]["custom_contract_value"] = 96
        with self.assertRaisesRegex(ValidationError, "award amount"):
            subject.guard_purchase_order(self.po())
        STORE.docs[("Contract", "CON-1")]["custom_contract_value"] = 95
        STORE.docs[("Contract Request", "CR-1")]["contract_value"] = 96
        with self.assertRaisesRegex(ValidationError, "award amount"):
            subject.guard_purchase_order(self.po())

    def test_pending_completion_cannot_bypass_using_any_state_field(self):
        for field in ("status", "workflow_state", "custom_workflow_step"):
            doc = self.rfq()
            doc[field] = "Completed"
            with self.assertRaisesRegex(ValidationError, "Record Contract"):
                subject.guard_rfq(doc)
        doc = self.rfq()
        data = json.loads(doc.custom_approval_data)
        data["workflow_step"] = "Completed"
        doc.custom_approval_data = json.dumps(data)
        with self.assertRaisesRegex(ValidationError, "Record Contract"):
            subject.guard_rfq(doc)

    def test_historical_completion_edits_remain_valid_only_without_clm(self):
        existing = self.po(name="PO-OLD")
        STORE.put(existing)
        STORE.docs[("Request for Quotation", "RFQ-1")]["custom_workflow_step"] = "PO Created"
        doc = self.rfq()
        doc.title = "Corrected title"
        subject.guard_rfq(doc)
        STORE.put({**self.request, "name": "CR-OLD"})
        with self.assertRaises(ValidationError):
            subject.guard_rfq(doc)
        with self.assertRaises(ValidationError):
            subject.guard_purchase_order(existing)

    def test_audited_legacy_yes_clm_can_release_without_rewriting_decision(self):
        STORE.docs[("Request for Quotation", "RFQ-1")]["contract_required"] = "Yes"
        data = json.loads(self.runtime)
        data["rfq_source"]["legal_review"] = "LDR-1"
        STORE.put({**self.request, "name": "CR-1", "custom_clm_data": json.dumps(data)})
        with self.assertRaisesRegex(ValidationError, "executed Contract"):
            subject.guard_purchase_order(self.po())
        self.executed()
        before = deepcopy(STORE.docs)
        subject.guard_purchase_order(self.po())
        self.assertEqual(STORE.docs, before)
        self.assertNotIn("contract_decision", json.loads(self.rfq().custom_approval_data))

    def test_legacy_yes_without_creation_audit_cannot_release(self):
        STORE.docs[("Request for Quotation", "RFQ-1")]["contract_required"] = "Yes"
        data = json.loads(self.runtime)
        data["audit"] = []
        STORE.put({**self.request, "name": "CR-1", "custom_clm_data": json.dumps(data)})
        self.executed()
        with self.assertRaisesRegex(ValidationError, "creation audit"):
            subject.guard_purchase_order(self.po())

    def test_new_rfq_reference_added_to_existing_po_is_not_grandfathered(self):
        STORE.put(self.po(name="PO-OLD", items=[{"item_code": "ITEM-1"}]))
        with self.assertRaisesRegex(ValidationError, "Record Contract"):
            subject.guard_purchase_order(self.po(name="PO-OLD"))

    def execution_document(self):
        contract = STORE.load("Contract", "CON-1")
        contract.update({"custom_contract_status": "Executed", "custom_esign_status": "Completed", "custom_final_version_locked": 1,
                         "custom_executed_contract": "/private/files/executed.pdf", "custom_current_version": "2.0", "custom_risk_level": "Medium", "custom_inteva_signatory": "inteva@example.test"})
        data = json.loads(contract.custom_clm_data)
        content = subject._contract_snapshot(contract)
        data.update({"version": "approved-version", "locked_hash": subject._digest({"content": content, "clause_ids": [], "non_standard_clause": False}),
                     "approvals": [{"role": "legal", "stage": 0, "status": "Approved", "by": "legal@example.test", "at": "2026-09-21T09:00:00Z"}, {"role": "finance", "stage": 1, "status": "Approved", "by": "finance@example.test", "at": "2026-09-21T11:00:00Z"}], "rfq_workflow": {"version": 1, "phase": "procurement"},
                     "signatures": [{"party": party, "version": "2.0", "file_id": party, "file_url": "/private/files/" + party + ".pdf", "hash": "a" * 64, "by": party + "@example.test", "at": "2026-09-21T10:00:00Z"} for party in ("supplier", "inteva")]})
        data["versions"].append({"id": "approved-version", "number": "2.0", "hash": subject._digest(content), "content": content})
        self.execution_files(contract, data)
        contract.custom_clm_data = json.dumps(data)
        return contract

    def test_direct_award_creates_real_contract_in_legal_review_and_permanent_context(self):
        result = self.create_contract()
        contract = result["contract"]
        self.assertEqual(contract["name"], "CON-1")
        self.assertEqual(contract["custom_contract_status"], "Pending Legal")
        self.assertEqual(contract["custom_risk_level"], "Medium")
        self.assertEqual(contract["custom_legal_review_required"], 1)
        self.assertEqual(result["request"]["request_status"], "Completed")
        self.assertEqual(result["request"]["approval_status"], "Pending")
        self.assertNotIn("approved_by", result["request"])
        request_data = json.loads(result["request"]["custom_clm_data"])
        data = json.loads(contract["custom_clm_data"])
        self.assertEqual(request_data["contract"], "CON-1")
        self.assertEqual(data["rfq_context"], {"rfq_id": "RFQ-1", "award_id": "LDR-1", "supplier_id": "SUP-1", "quotation_id": "SQ-1", "contract_type": "Supply / Procurement Contract", "contract_status": "Pending Legal", "contract_required": "Yes"})
        self.assertEqual(data["source_documents"], request_data["source_documents"])
        self.assertEqual(data["rfq_source"], request_data["rfq_source"])
        self.assertEqual(data["versions"][0]["hash"], subject._digest(subject._contract_snapshot(contract)))
        self.assertEqual([(row["role"], row["stage"], row["status"]) for row in data["approvals"]], [("legal", 0, "Pending")])
        self.assertEqual(data["signatures"], [])
        self.assertEqual(result["decision"]["contract"], "CON-1")
        self.assertTrue(result["decision"]["clm"]["blocked"])
        award = STORE.load("Legal Document Review", "LDR-1")
        self.assertEqual(json.loads(award.custom_clm_state)["contract"], "CON-1")
        self.assertEqual(award.workflow_state, "Pending Review")
        self.assertEqual(self.rfq().custom_workflow_step, "Pending Legal Review")
        self.assertEqual(json.loads(self.rfq().custom_approval_data)["unrelated"], "preserved")

    def test_direct_contract_retry_and_concurrent_posts_are_idempotent(self):
        results, errors = [], []
        def run():
            try:
                results.append(self.create_contract())
            except Exception as error:
                errors.append(error)
        threads = [threading.Thread(target=run) for _ in range(2)]
        for worker in threads:
            worker.start()
        for worker in threads:
            worker.join()
        self.assertEqual(errors, [])
        self.assertEqual(sorted(row["created"] for row in results), [False, True])
        self.assertEqual({row["contract"]["name"] for row in results}, {"CON-1"})
        self.assertEqual(len(STORE.list("Contract", {}, "name")), 1)
        self.assertEqual(len(STORE.list("Contract Request", {}, "name")), 1)
        before = deepcopy(STORE.docs)
        self.create_contract(expected_modified="old", request_document={"wrong": "ignored"})
        self.assertEqual(STORE.docs, before)

    def test_request_only_choice_can_be_converted_without_replacing_decision(self):
        first = self.decide()
        result = self.create_contract()
        self.assertEqual(result["request"]["name"], first["request"]["name"])
        self.assertEqual(result["decision"]["by"], first["decision"]["by"])
        self.assertEqual(result["decision"]["at"], first["decision"]["at"])
        self.assertEqual(result["contract"]["name"], "CON-1")

    def test_contract_retry_requires_the_same_persisted_contract_in_all_source_links(self):
        for missing in ("context", "request_contract", "decision_contract"):
            with self.subTest(missing=missing):
                self.setUp()
                result = self.create_contract()
                if missing == "context":
                    document = STORE.docs[("Contract", result["contract"]["name"])]
                    data = json.loads(document["custom_clm_data"])
                    del data["rfq_context"]
                    document["custom_clm_data"] = json.dumps(data)
                elif missing == "request_contract":
                    document = STORE.docs[("Contract Request", result["request"]["name"])]
                    data = json.loads(document["custom_clm_data"])
                    del data["contract"]
                    document["custom_clm_data"] = json.dumps(data)
                else:
                    document = STORE.docs[("Request for Quotation", result["rfq"]["name"])]
                    data = json.loads(document["custom_approval_data"])
                    del data["contract_decision"]["contract"]
                    document["custom_approval_data"] = json.dumps(data)
                before = deepcopy(STORE.docs)
                with self.assertRaisesRegex(ValidationError, "permanent RFQ Award links"):
                    self.create_contract()
                self.assertEqual(STORE.docs, before)

    def test_request_only_conversion_does_not_bypass_existing_review_or_rejection(self):
        for status in ("Pending Review", "Under Legal Review", "Rejected", "Completed"):
            with self.subTest(status=status):
                self.setUp()
                first = self.decide()
                request = STORE.docs[("Contract Request", first["request"]["name"])]
                request["request_status"] = status
                before = deepcopy(STORE.docs)
                with self.assertRaisesRegex(ValidationError, "Draft or Approved"):
                    self.create_contract()
                self.assertEqual(STORE.docs, before)
                self.assertEqual(STORE.list("Contract", {}, "name"), [])

    def test_request_only_conversion_failure_keeps_prior_decision_and_no_partial_contract(self):
        for flag in ("fail_contract_insert", "fail_request_save", "fail_rfq_save", "fail_award_save"):
            with self.subTest(flag=flag):
                self.setUp()
                self.decide()
                before = deepcopy(STORE.docs)
                setattr(STORE, flag, True)
                with self.assertRaises(ValidationError):
                    self.create_contract()
                self.assertEqual(STORE.docs, before)
                self.assertEqual(STORE.list("Contract", {}, "name"), [])

    def test_team_contract_failures_keep_committed_request_and_roll_back_contract_and_state(self):
        for flag in ("fail_contract_insert", "fail_request_save", "fail_rfq_save", "fail_award_save"):
            with self.subTest(flag=flag):
                self.setUp()
                self.decide()
                setattr(STORE, flag, True)
                before = deepcopy(STORE.docs)
                with self.assertRaises(ValidationError):
                    self.create_contract()
                self.assertEqual(STORE.docs, before)
                self.assertIsNone(getattr(frappe.local, subject._CONTEXT, None))
                self.assertIsNone(getattr(frappe.local, subject._SYNC_CONTEXT, None))

    def test_direct_contract_schema_omissions_roll_back(self):
        for doctype, field in (("Contract", "custom_clm_data"), ("Contract", "custom_rfq"), ("Contract", "custom_current_version"), ("Contract Request", "request_status"), ("Legal Document Review", "custom_clm_state")):
            with self.subTest(doctype=doctype, field=field):
                self.setUp()
                self.decide()
                before = deepcopy(STORE.docs)
                STORE.drop_fields = {doctype: [field]}
                with self.assertRaises(ValidationError):
                    self.create_contract()
                self.assertEqual(STORE.docs, before)
        self.setUp()
        STORE.award_state_field = False
        with self.assertRaisesRegex(ValidationError, "award CLM state schema"):
            self.create_contract()
        self.assertEqual(STORE.list("Contract", {}, "name"), [])

    def test_no_branch_mirrors_not_required_without_creating_clm(self):
        result = self.decide("No")
        self.assertIsNone(result["contract"])
        self.assertEqual(result["decision"]["clm"], {"contract_required": "No", "status": "Not Required", "blocked": False})
        self.assertEqual(json.loads(STORE.load("Legal Document Review", "LDR-1").custom_clm_state)["status"], "Not Required")
        subject.guard_purchase_order(self.po())
        with self.assertRaisesRegex(ValidationError, "cannot create"):
            self.decide("No", create_contract=True)

    def test_review_and_signature_states_stay_gated_then_execution_unlocks_existing_path(self):
        self.create_contract()
        for status in ("Draft", "Pending Legal", "Approved", "Pending Signature", "Pending Finance"):
            contract = STORE.load("Contract", "CON-1")
            data = json.loads(contract.custom_clm_data)
            if status == "Draft":
                data["approvals"] = []
            if status == "Pending Finance":
                contract = self.execution_document()
                data = json.loads(contract.custom_clm_data)
                data["approvals"][1] = {"role": "finance", "stage": 1, "status": "Pending"}
            elif status != "Draft":
                data["approvals"] = [{"role": "legal", "stage": 0, "status": "Pending" if status == "Pending Legal" else "Approved", "by": "legal@example.test", "at": "2026-09-21T09:00:00Z"}]
            data["rfq_workflow"]["phase"] = {"Draft": "draft", "Pending Legal": "legal_review", "Approved": "signature", "Pending Signature": "signature", "Pending Finance": "finance_review"}[status]
            contract.custom_contract_status = status
            contract.custom_clm_data = json.dumps(data)
            with STORE.transaction():
                contract.save()
            context = json.loads(STORE.load("Contract", "CON-1").custom_clm_data)["rfq_context"]
            state = json.loads(self.rfq().custom_approval_data)["contract_decision"]["clm"]
            self.assertEqual(context["contract_status"], status)
            self.assertEqual(state["status"], status)
            self.assertTrue(state["blocked"])
            with self.assertRaisesRegex(ValidationError, "must be Executed"):
                subject.guard_purchase_order(self.po())
        with STORE.transaction():
            self.execution_document().save()
        state = json.loads(self.rfq().custom_approval_data)["contract_decision"]["clm"]
        self.assertFalse(state["blocked"])
        self.assertEqual(state["status"], "Executed")
        self.assertEqual(state["executed_at"], "2026-09-21T11:00:00Z")
        award = STORE.load("Legal Document Review", "LDR-1")
        self.assertFalse(json.loads(award.custom_clm_state)["blocked"])
        self.assertEqual(award.workflow_state, "Pending Review")
        self.assertEqual(self.rfq().custom_workflow_step, "Pending Legal Review")
        subject.guard_purchase_order(self.po())

    def test_execution_rejects_missing_signature_approval_legal_version_or_changed_content(self):
        self.create_contract()
        for defect in ("signature", "approval", "legal", "version", "content", "locked_hash"):
            with self.subTest(defect=defect):
                contract = self.execution_document()
                data = json.loads(contract.custom_clm_data)
                if defect == "signature":
                    data["signatures"].pop()
                elif defect == "approval":
                    data["approvals"][0]["status"] = "Pending"
                elif defect == "legal":
                    data["approvals"][0]["role"] = "procurement"
                elif defect == "version":
                    data["signatures"][0]["version"] = "1.0"
                elif defect == "content":
                    contract.contract_terms = "Replaced after approval"
                else:
                    data["locked_hash"] = "forged"
                contract.custom_clm_data = json.dumps(data)
                before = deepcopy(STORE.docs)
                with STORE.transaction(), self.assertRaises(ValidationError):
                    contract.save()
                self.assertEqual(STORE.docs, before)

    def test_execution_rfqs_and_award_sync_failure_rolls_back_contract_signature(self):
        self.create_contract()
        for flag in ("fail_rfq_save", "fail_award_save"):
            setattr(STORE, flag, True)
            contract = self.execution_document()
            before = deepcopy(STORE.docs)
            with self.assertRaises(ValidationError), STORE.transaction():
                contract.save()
            self.assertEqual(STORE.docs, before)
            setattr(STORE, flag, False)

    def test_context_and_source_links_cannot_be_changed_or_removed(self):
        self.create_contract()
        for field, value in (("custom_rfq", ""), ("custom_supplier", "OTHER"), ("custom_supplier_quotation", "OTHER"), ("custom_contract_request", "OTHER"), ("custom_contract_value", 500)):
            contract = STORE.load("Contract", "CON-1")
            contract[field] = value
            with self.assertRaises(ValidationError):
                subject.guard_contract(contract)
        for field in ("rfq_id", "award_id", "supplier_id", "quotation_id", "contract_required"):
            contract = STORE.load("Contract", "CON-1")
            data = json.loads(contract.custom_clm_data)
            data["rfq_context"][field] = "OTHER"
            contract.custom_clm_data = json.dumps(data)
            with self.assertRaisesRegex(ValidationError, "context"):
                subject.guard_contract(contract)
        contract = STORE.load("Contract", "CON-1")
        data = json.loads(contract.custom_clm_data)
        del data["rfq_context"]
        contract.custom_clm_data = json.dumps(data)
        with self.assertRaisesRegex(ValidationError, "cannot be removed"):
            subject.guard_contract(contract)

    def test_correct_node_context_preserves_exact_runtime_serialization(self):
        self.create_contract()
        contract = STORE.load("Contract", "CON-1")
        contract.custom_clm_data = json.dumps(json.loads(contract.custom_clm_data), indent=2)
        before = contract.custom_clm_data
        subject.guard_contract(contract)
        self.assertEqual(contract.custom_clm_data, before)

    def test_untrusted_award_state_and_rfq_mirror_changes_are_blocked(self):
        self.create_contract()
        award = STORE.load("Legal Document Review", "LDR-1")
        award.custom_clm_state = "{\"blocked\":false}"
        with self.assertRaisesRegex(ValidationError, "maintained"):
            subject.guard_award_state(award)
        rfq = self.rfq()
        data = json.loads(rfq.custom_approval_data)
        data["contract_decision"]["clm"]["blocked"] = False
        rfq.custom_approval_data = json.dumps(data)
        with self.assertRaisesRegex(ValidationError, "must be preserved"):
            subject.guard_rfq(rfq)

    def test_standalone_contract_and_unrelated_award_hook_behavior_is_unchanged(self):
        contract = Document({"doctype": "Contract", "name": "STANDALONE", "custom_contract_status": "Executed"})
        subject.guard_contract(contract)
        subject.sync_contract(contract)
        award = STORE.load("Legal Document Review", "LDR-1")
        award.review_status = "Approved"
        subject.guard_award_state(award)

    def test_python_hash_matches_gateway_golden_fixtures(self):
        fixtures = json.loads((Path(__file__).parent / "contract-hashes.json").read_text(encoding="utf-8"))
        for fixture in fixtures:
            with self.subTest(name=fixture["name"]):
                content = subject._contract_snapshot(fixture["record"])
                runtime = fixture.get("runtime", {})
                self.assertEqual(subject._digest(content), fixture["content_hash"])
                self.assertEqual(subject._digest({"content": content, "clause_ids": runtime.get("clause_ids", []), "non_standard_clause": runtime.get("non_standard_clause", False)}), fixture["locked_hash"])
        child = {"fulfilment_terms": [{"modified": datetime(2026, 9, 21, 9, 15, 30, 123456)}]}
        self.assertEqual(subject._contract_snapshot(child)["fulfilment_terms"][0]["modified"], "2026-09-21 09:15:30.123456")

    def test_execution_validates_actual_private_files_and_exact_pdf_bytes(self):
        self.create_contract()
        for defect in ("missing", "public", "foreign_parent", "wrong_url", "bytes", "hash", "locked_pdf", "final_path"):
            with self.subTest(defect=defect):
                contract = self.execution_document()
                data = json.loads(contract.custom_clm_data)
                supplier = STORE.docs[("File", "supplier")]
                if defect == "missing":
                    del STORE.docs[("File", "supplier")]
                elif defect == "public":
                    supplier["is_private"] = 0
                elif defect == "foreign_parent":
                    supplier["attached_to_name"] = "OTHER-CONTRACT"
                elif defect == "wrong_url":
                    supplier["file_url"] = "/private/files/replaced.pdf"
                elif defect == "bytes":
                    supplier["_test_pdf_bytes"] = b"%PDF-1.7 altered after signature"
                elif defect == "hash":
                    data["signatures"][0]["hash"] = "invented"
                elif defect == "locked_pdf":
                    del data["locked_file"]
                else:
                    contract.custom_executed_contract = "/private/files/not-company-signed.pdf"
                contract.custom_clm_data = json.dumps(data)
                before = deepcopy(STORE.docs)
                with self.assertRaises(ValidationError), STORE.transaction():
                    contract.save()
                self.assertEqual(STORE.docs, before)
                self.assertTrue(json.loads(self.rfq().custom_approval_data)["contract_decision"]["clm"]["blocked"])

    def test_native_non_gateway_cannot_forge_clm_evidence_or_lifecycle_state(self):
        self.create_contract()
        frappe.session.user = "native-buyer@example.test"
        for field, value in (("custom_contract_status", "Executed"), ("custom_approval_status", "Approved"), ("custom_esign_status", "Completed"), ("custom_clm_data", "{}"), ("custom_inteva_signatory", "invented@example.test")):
            with self.subTest(field=field):
                contract = STORE.load("Contract", "CON-1")
                contract[field] = value
                with self.assertRaisesRegex(PermissionError, "authenticated BidSphere gateway"):
                    contract.save()
        standalone = Document({"doctype": "Contract", "name": "STANDALONE", "custom_contract_status": "Executed", "custom_clm_data": "{}"})
        subject.guard_contract(standalone)

    def test_closed_completed_rfq_can_record_later_expiration_without_advancing_workflow(self):
        self.create_contract()
        with STORE.transaction():
            self.execution_document().save()
        rfq = STORE.docs[("Request for Quotation", "RFQ-1")]
        rfq.update({"status": "Closed", "custom_workflow_step": "PO Created"})
        STORE.docs[("Legal Document Review", "LDR-1")]["workflow_state"] = "Closed"
        contract = STORE.load("Contract", "CON-1")
        contract.custom_contract_status = "Expired"
        with STORE.transaction():
            contract.save()
        current = self.rfq()
        self.assertEqual(current.status, "Closed")
        self.assertEqual(current.custom_workflow_step, "PO Created")
        self.assertEqual(STORE.load("Legal Document Review", "LDR-1").workflow_state, "Closed")
        self.assertEqual(json.loads(current.custom_approval_data)["contract_decision"]["clm"]["status"], "Expired")
        self.assertTrue(json.loads(current.custom_approval_data)["contract_decision"]["clm"]["blocked"])
        with self.assertRaisesRegex(ValidationError, "cannot enter CLM"):
            subject.guard_purchase_order(self.po())

    def test_rfq_locked_reads_do_not_invert_native_contract_save_lock_order(self):
        self.create_contract()
        STORE.locks = []
        self.create_contract()
        self.assertNotIn(("Contract", "CON-1"), STORE.locks)
        with STORE.transaction():
            self.execution_document().save()
        STORE.locks = []
        subject.guard_purchase_order(self.po())
        self.assertIn(("Request for Quotation", "RFQ-1"), STORE.locks)
        self.assertNotIn(("Contract", "CON-1"), STORE.locks)

    def test_current_rfq_mirror_blocks_stale_executed_contract_snapshot(self):
        self.create_contract()
        with STORE.transaction():
            self.execution_document().save()
        rfq = self.rfq()
        data = json.loads(rfq.custom_approval_data)
        data["contract_decision"]["clm"].update({"blocked": True, "status": "Expired"})
        rfq.custom_approval_data = json.dumps(data)
        STORE.put(rfq)
        with self.assertRaisesRegex(ValidationError, "lifecycle changed"):
            subject.guard_purchase_order(self.po())

    def test_contract_cancellation_mirrors_hold_without_rewriting_existing_rfq_states(self):
        self.create_contract()
        with STORE.transaction():
            self.execution_document().save()
        contract = STORE.load("Contract", "CON-1")
        contract.docstatus = 2
        with STORE.transaction():
            contract.save()
        state = json.loads(self.rfq().custom_approval_data)["contract_decision"]["clm"]
        self.assertEqual(state["status"], "Cancelled")
        self.assertTrue(state["blocked"])
        self.assertEqual(self.rfq().custom_workflow_step, "Pending Legal Review")
        with self.assertRaisesRegex(ValidationError, "must be Executed"):
            subject.guard_purchase_order(self.po())

    def test_only_procurement_team_records_yes_no_and_existing_contract_retry(self):
        for role in ("procurement", "admin", "legal", "finance", "procurement.team", "supplier"):
            for decision in ("Yes", "No"):
                with self.subTest(role=role, decision=decision):
                    before = deepcopy(STORE.docs)
                    with self.assertRaisesRegex(PermissionError, "Only the Procurement Team"):
                        self.decide(decision, actor={"id": "someone@example.test", "role": role}, create_contract=decision == "Yes")
                    self.assertEqual(STORE.docs, before)
        first = self.create_contract()
        with self.assertRaises(PermissionError):
            self.decide(actor={"id": "manager@example.test", "role": "procurement"}, create_contract=True)
        self.assertEqual(self.create_contract()["contract"]["name"], first["contract"]["name"])
        self.assertEqual(json.loads(first["contract"]["custom_clm_data"])["rfq_workflow"], {"version": 1, "phase": "legal_review"})

    def test_award_dates_must_be_strictly_increasing(self):
        before = deepcopy(STORE.docs)
        with self.assertRaisesRegex(ValidationError, "must be after"):
            self.decide(request_document={**self.request, "contract_end_date": self.request["contract_start_date"]})
        self.assertEqual(STORE.docs, before)

    def test_legacy_execution_without_finance_remains_gated_without_rewriting_record(self):
        self.decide()
        self.executed()
        contract = STORE.load("Contract", "CON-1")
        data = json.loads(contract.custom_clm_data)
        data["approvals"] = [row for row in data["approvals"] if row["role"] == "legal"]
        contract.custom_clm_data = json.dumps(data)
        STORE.put(contract)
        before = deepcopy(STORE.docs)
        with self.assertRaisesRegex(ValidationError, "Legal and Finance approvals"):
            subject.guard_purchase_order(self.po())
        self.assertEqual(STORE.docs, before)

    def test_pending_finance_requires_both_verified_signatures_and_stays_gated(self):
        self.create_contract()
        contract = self.execution_document()
        data = json.loads(contract.custom_clm_data)
        data["rfq_workflow"]["phase"] = "finance_review"
        data["approvals"][1] = {"role": "finance", "stage": 1, "status": "Pending"}
        contract.custom_contract_status = "Pending Finance"
        contract.custom_clm_data = json.dumps(data)
        with STORE.transaction():
            contract.save()
        self.assertTrue(json.loads(self.rfq().custom_approval_data)["contract_decision"]["clm"]["blocked"])
        with self.assertRaisesRegex(ValidationError, "must be Executed"):
            subject.guard_purchase_order(self.po())
        for defect in ("missing_company", "signature_hash", "legal_pending", "finance_already_approved"):
            with self.subTest(defect=defect):
                invalid = deepcopy(data)
                if defect == "missing_company":
                    invalid["signatures"].pop()
                elif defect == "signature_hash":
                    invalid["signatures"][0]["hash"] = "invented"
                elif defect == "legal_pending":
                    invalid["approvals"][0]["status"] = "Pending"
                else:
                    invalid["approvals"][1]["status"] = "Approved"
                candidate = STORE.load("Contract", "CON-1")
                candidate.custom_clm_data = json.dumps(invalid)
                before = deepcopy(STORE.docs)
                with self.assertRaises(ValidationError), STORE.transaction():
                    candidate.save()
                self.assertEqual(STORE.docs, before)

    def test_parallel_review_inverted_stages_and_policy_removal_are_rejected(self):
        self.create_contract()
        for defect in ("parallel", "finance_first", "wrong_stage", "remove_policy", "invalid_phase"):
            with self.subTest(defect=defect):
                contract = STORE.load("Contract", "CON-1")
                data = json.loads(contract.custom_clm_data)
                contract.custom_contract_status = "Pending Legal"
                data["rfq_workflow"]["phase"] = "legal_review"
                data["approvals"] = [{"role": "legal", "stage": 0, "status": "Pending"}]
                if defect == "parallel":
                    data["approvals"].append({"role": "finance", "stage": 1, "status": "Pending"})
                elif defect == "finance_first":
                    data["approvals"][0]["role"] = "finance"
                elif defect == "wrong_stage":
                    data["approvals"][0]["stage"] = 1
                elif defect == "remove_policy":
                    del data["rfq_workflow"]
                else:
                    data["rfq_workflow"]["phase"] = "procurement"
                contract.custom_clm_data = json.dumps(data)
                before = deepcopy(STORE.docs)
                with self.assertRaises(ValidationError), STORE.transaction():
                    contract.save()
                self.assertEqual(STORE.docs, before)

    def test_legal_company_signer_must_match_designated_enabled_legal_user(self):
        self.create_contract()
        for defect in ("other_signer", "not_legal", "admin", "disabled", "missing"):
            with self.subTest(defect=defect):
                STORE.put({"doctype": "User", "name": "inteva@example.test", "enabled": 1, "roles": [{"role": "Legal Manager"}]})
                contract = self.execution_document()
                data = json.loads(contract.custom_clm_data)
                if defect == "other_signer":
                    data["signatures"][1]["by"] = "other@example.test"
                elif defect == "not_legal":
                    STORE.docs[("User", "inteva@example.test")]["roles"] = [{"role": "Procurement Manager"}]
                elif defect == "admin":
                    STORE.docs[("User", "inteva@example.test")]["roles"].append({"role": "System"})
                elif defect == "disabled":
                    STORE.docs[("User", "inteva@example.test")]["enabled"] = 0
                else:
                    del STORE.docs[("User", "inteva@example.test")]
                contract.custom_clm_data = json.dumps(data)
                with self.assertRaisesRegex(ValidationError, "Legal Manager"), STORE.transaction():
                    contract.save()

    def test_review_signature_finance_timestamp_order_is_required(self):
        self.create_contract()
        for defect in ("finance_before_signature", "supplier_before_legal", "company_before_supplier", "missing_finance_time"):
            with self.subTest(defect=defect):
                contract = self.execution_document()
                data = json.loads(contract.custom_clm_data)
                if defect == "finance_before_signature":
                    data["approvals"][1]["at"] = "2026-09-21T09:30:00Z"
                elif defect == "supplier_before_legal":
                    data["signatures"][0]["at"] = "2026-09-21T08:30:00Z"
                elif defect == "company_before_supplier":
                    data["signatures"][1]["at"] = "2026-09-21T09:30:00Z"
                else:
                    data["approvals"][1].pop("at")
                contract.custom_clm_data = json.dumps(data)
                before = deepcopy(STORE.docs)
                with self.assertRaises(ValidationError), STORE.transaction():
                    contract.save()
                self.assertEqual(STORE.docs, before)

    def test_finance_reject_and_send_back_preserve_evidence_and_keep_gate_closed(self):
        self.create_contract()
        contract = self.execution_document()
        data = json.loads(contract.custom_clm_data)
        data["rfq_workflow"]["phase"] = "rejected"
        data["approvals"][1]["status"] = "Rejected"
        contract.custom_contract_status = "Rejected"
        contract.custom_clm_data = json.dumps(data)
        with STORE.transaction():
            contract.save()
        self.assertEqual(json.loads(STORE.load("Contract", "CON-1").custom_clm_data)["signatures"], data["signatures"])
        with self.assertRaises(ValidationError):
            subject.guard_purchase_order(self.po())
        data["rfq_workflow"]["phase"] = "draft"
        data["approvals"][1]["status"] = "Sent Back"
        evidence = {"approvals": data["approvals"], "signatures": data["signatures"], "locked_file": data["locked_file"], "locked_hash": data["locked_hash"]}
        data["review_history"] = [deepcopy(evidence)]
        data["approvals"], data["signatures"] = [], []
        contract.custom_contract_status = "Draft"
        contract.custom_clm_data = json.dumps(data)
        with STORE.transaction():
            contract.save()
        self.assertEqual(json.loads(STORE.load("Contract", "CON-1").custom_clm_data)["review_history"], [evidence])
        self.assertTrue(json.loads(self.rfq().custom_approval_data)["contract_decision"]["clm"]["blocked"])

    def test_standalone_clm_never_enters_rfq_sequential_guard(self):
        standalone = Document({"doctype": "Contract", "name": "STANDALONE", "custom_contract_status": "Under Review", "custom_clm_data": "{}"})
        before = deepcopy(standalone)
        subject.guard_contract(standalone)
        subject.sync_contract(standalone)
        self.assertEqual(standalone, before)

    def test_historical_legal_signature_survives_role_revocation_but_new_receipt_does_not(self):
        self.create_contract()
        contract = self.execution_document()
        data = json.loads(contract.custom_clm_data)
        data["signatures"][1]["role"] = "legal"
        contract.custom_clm_data = json.dumps(data)
        with STORE.transaction():
            contract.save()
        STORE.docs[("User", "inteva@example.test")].update({"enabled": 0, "roles": []})
        before = deepcopy(STORE.docs)
        subject.guard_purchase_order(self.po())
        self.assertEqual(STORE.docs, before)
        candidate = STORE.load("Contract", "CON-1")
        updated = json.loads(candidate.custom_clm_data)
        updated["signatures"][1]["at"] = "2026-09-21T10:01:00Z"
        candidate.custom_clm_data = json.dumps(updated)
        with self.assertRaisesRegex(ValidationError, "enabled Legal Manager"), STORE.transaction():
            candidate.save()

    def test_historical_signature_gate_read_without_before_save_snapshot(self):
        self.create_contract()
        contract = self.execution_document()
        data = json.loads(contract.custom_clm_data)
        data["signatures"][1]["role"] = "legal"
        contract.custom_clm_data = json.dumps(data)
        with STORE.transaction():
            contract.save()
        del STORE.docs[("User", "inteva@example.test")]
        read = STORE.load("Contract", "CON-1")
        original = Document.get_doc_before_save
        Document.get_doc_before_save = lambda _: None
        try:
            subject._validate_execution(read)
        finally:
            Document.get_doc_before_save = original

    def test_separate_legal_termination_preserves_finance_execution_history(self):
        self.create_contract()
        with STORE.transaction():
            self.execution_document().save()
        contract = STORE.load("Contract", "CON-1")
        data = json.loads(contract.custom_clm_data)
        completed = deepcopy(data["approvals"])
        data["prior_approvals"] = completed
        data["approvals"] = [{"role": "legal", "stage": 0, "status": "Pending"}]
        data["termination"] = {"reason": "Test termination", "requested_by": "buyer@example.test"}
        data["rfq_workflow"]["phase"] = "legal_review"
        contract.custom_contract_status = "Under Review"
        contract.custom_clm_data = json.dumps(data)
        with STORE.transaction():
            contract.save()
        with self.assertRaises(ValidationError):
            subject.guard_purchase_order(self.po())
        for approved in (False, True):
            with self.subTest(termination_approved=approved):
                final = STORE.load("Contract", "CON-1")
                runtime = json.loads(final.custom_clm_data)
                runtime.pop("termination", None)
                runtime["approvals"] = completed
                runtime["rfq_workflow"]["phase"] = "procurement"
                runtime["termination_decision"] = {"decision": "Approved" if approved else "Sent Back", "by": "legal@example.test"}
                final.custom_contract_status = "Terminated" if approved else "Active"
                final.custom_clm_data = json.dumps(runtime)
                with STORE.transaction():
                    final.save()
                if approved:
                    with self.assertRaises(ValidationError):
                        subject.guard_purchase_order(self.po())
                else:
                    subject.guard_purchase_order(self.po())

    def test_request_draft_conversion_edge_is_exclusive_to_atomic_award_transaction(self):
        self.decide()
        request = STORE.load("Contract Request", "CR-1")
        request.request_status = "Completed"
        before = deepcopy(STORE.docs)
        with self.assertRaisesRegex(ValidationError, "atomic award transaction"), STORE.transaction():
            request.save()
        self.assertEqual(STORE.docs, before)
        self.assertEqual(self.create_contract()["request"]["request_status"], "Completed")
        standalone = Document({"doctype": "Contract Request", "name": "STANDALONE", "request_status": "Completed"})
        subject.guard_request(standalone)

    def test_expired_or_terminated_rfq_contract_can_close_but_never_releases_new_po(self):
        for status in ("Expired", "Terminated"):
            with self.subTest(previous=status):
                self.setUp()
                self.create_contract()
                with STORE.transaction():
                    self.execution_document().save()
                contract = STORE.load("Contract", "CON-1")
                contract.custom_contract_status = status
                with STORE.transaction():
                    contract.save()
                contract.custom_contract_status = "Closed"
                with STORE.transaction():
                    contract.save()
                saved = STORE.load("Contract", "CON-1")
                self.assertEqual(saved.custom_contract_status, "Closed")
                state = json.loads(self.rfq().custom_approval_data)["contract_decision"]["clm"]
                self.assertEqual(state["status"], "Closed")
                self.assertTrue(state["blocked"])
                with self.assertRaisesRegex(ValidationError, "must be Executed"):
                    subject.guard_purchase_order(self.po())

    def test_atomic_creation_routes_to_legal_with_complete_role_and_reference_audit(self):
        result = self.create_contract()
        contract = result["contract"]
        data = json.loads(contract["custom_clm_data"])
        self.assertEqual(contract["custom_contract_status"], "Pending Legal")
        self.assertEqual(contract["custom_inteva_signatory"], "inteva@example.test")
        self.assertEqual(data["rfq_workflow"], {"version": 1, "phase": "legal_review"})
        self.assertEqual([(row["action"], row["role"], row["reference_id"]) for row in data["audit"]], [("create_from_rfq_award", "procurement_team", "CON-1"), ("legal_review_started", "procurement_team", "CON-1")])
        self.assertEqual(result["decision"]["clm"]["phase"], "legal_review")
        self.assertEqual(result["decision"]["clm"]["status"], "Pending Legal")
        self.assertEqual(data["approvals"][0]["status"], "Pending")
        self.assertFalse(any(row["role"] == "finance" for row in data["approvals"]))
        self.assertTrue(result["decision"]["clm"]["blocked"])
        self.assertEqual(data["versions"][0]["hash"], subject._digest(subject._contract_snapshot(contract)))
        retry = self.create_contract(contract_fields={"custom_risk_level": "fake"})
        self.assertEqual(retry["contract"], contract)

    def test_team_contract_creation_requires_assessed_risk_and_verified_legal_signer(self):
        self.decide()
        invalid = [None, {}, {"custom_risk_level": "", "custom_inteva_signatory": "inteva@example.test"}, {"custom_risk_level": [], "custom_inteva_signatory": "inteva@example.test"}, {"custom_risk_level": "Medium", "custom_inteva_signatory": "missing@example.test"}, {"custom_risk_level": "Medium", "custom_inteva_signatory": "inteva@example.test", "custom_supplier": "OTHER"}]
        for fields in invalid:
            with self.subTest(fields=fields):
                before = deepcopy(STORE.docs)
                with self.assertRaises(ValidationError):
                    self.create_contract(contract_fields=fields)
                self.assertEqual(STORE.docs, before)
        for changes in ({"roles": [{"role": "Finance Manager"}]}, {"roles": [{"role": "Legal Manager"}, {"role": "System"}]}, {"enabled": 0}, {"email": "administrator@example.com"}):
            with self.subTest(user=changes):
                self.setUp()
                self.decide()
                STORE.docs[("User", "inteva@example.test")].update(changes)
                before = deepcopy(STORE.docs)
                with self.assertRaisesRegex(ValidationError, "enabled Legal Manager"):
                    self.create_contract()
                self.assertEqual(STORE.docs, before)

    def completion_document(self):
        self.create_contract()
        with STORE.transaction():
            self.execution_document().save()
        STORE.put(self.po(name="PO-1", docstatus=1, company="COMPANY", currency="USD", status="To Receive and Bill"))
        contract = STORE.load("Contract", "CON-1")
        data = json.loads(contract.custom_clm_data)
        data["rfq_workflow"]["phase"] = "completed"
        data["procurement_completion"] = {"purchase_order": "PO-1", "by": self.actor["id"], "role": "procurement_team", "at": "2026-09-21T12:00:00Z", "comment": "Existing procurement PO completed", "rfq": "RFQ-1", "award": "LDR-1", "quotation": "SQ-1", "supplier": "SUP-1"}
        for action, previous, next_status in (("procurement_finalized", "Finance Approved", "Procurement Finalized"), ("completed", "Procurement Finalized", "Completed")):
            data["audit"].append({"id": action, "action": action, "by": self.actor["id"], "role": "procurement_team", "at": data["procurement_completion"]["at"], "previous_status": previous, "new_status": next_status, "comment": "Existing procurement PO completed", "reference_id": contract.name})
        contract.custom_clm_data = json.dumps(data)
        return contract

    def test_procurement_completion_persists_real_po_receipt_without_altering_signed_content_or_po(self):
        contract = self.completion_document()
        before_po = deepcopy(STORE.docs[("Purchase Order", "PO-1")])
        signed_content = subject._contract_snapshot(contract)
        with STORE.transaction():
            contract.save()
        self.assertEqual(contract.custom_contract_status, "Executed")
        self.assertEqual(subject._contract_snapshot(contract), signed_content)
        self.assertEqual(STORE.docs[("Purchase Order", "PO-1")], before_po)
        self.assertEqual(self.rfq().custom_workflow_step, "Pending Legal Review")
        mirror = json.loads(self.rfq().custom_approval_data)["contract_decision"]["clm"]
        self.assertEqual((mirror["phase"], mirror["procurement_status"]), ("completed", "Completed"))
        self.assertEqual(mirror["procurement_completion"]["purchase_order"], "PO-1")
        self.assertFalse(mirror["blocked"])
        self.assertEqual(json.loads(STORE.load("Legal Document Review", "LDR-1").custom_clm_state)["procurement_status"], "Completed")
        subject.guard_purchase_order(self.po())

    def test_completion_rejects_unrelated_or_unsubmitted_po_without_changing_any_record(self):
        for defect in ("missing", "draft", "cancelled", "supplier", "company", "currency", "quotation", "mixed_items", "rfq", "custom_rfq", "receipt_role", "receipt_source", "receipt_time", "audit"):
            with self.subTest(defect=defect):
                self.setUp()
                contract = self.completion_document()
                data = json.loads(contract.custom_clm_data)
                po = STORE.docs[("Purchase Order", "PO-1")]
                if defect == "missing":
                    del STORE.docs[("Purchase Order", "PO-1")]
                elif defect == "draft":
                    po["docstatus"] = 0
                elif defect == "cancelled":
                    po["docstatus"] = 2
                elif defect in ("supplier", "company", "currency"):
                    po[defect] = "OTHER"
                elif defect == "quotation":
                    po["items"][0]["supplier_quotation"] = "SQ-OTHER"
                elif defect == "mixed_items":
                    po["items"].append({"supplier_quotation": "SQ-OTHER"})
                elif defect == "rfq":
                    po["custom_rfq_reference"] = "RFQ-OTHER"
                elif defect == "custom_rfq":
                    po["items"][0]["custom_rfq"] = "RFQ-OTHER"
                elif defect == "receipt_role":
                    data["procurement_completion"]["role"] = "procurement"
                elif defect == "receipt_source":
                    data["procurement_completion"]["award"] = "LDR-OTHER"
                elif defect == "receipt_time":
                    data["procurement_completion"]["at"] = "2026-09-21T10:30:00Z"
                else:
                    data["audit"].pop()
                contract.custom_clm_data = json.dumps(data)
                before = deepcopy(STORE.docs)
                with self.assertRaises(ValidationError), STORE.transaction():
                    contract.save()
                self.assertEqual(STORE.docs, before)

    def test_completion_accepts_existing_closed_po_and_preserves_immutable_receipt_and_audit(self):
        contract = self.completion_document()
        STORE.docs[("Purchase Order", "PO-1")]["status"] = "Closed"
        with STORE.transaction():
            contract.save()
        for defect in ("receipt", "remove_receipt", "audit", "remove_audit", "phase"):
            with self.subTest(defect=defect):
                candidate = STORE.load("Contract", "CON-1")
                data = json.loads(candidate.custom_clm_data)
                if defect == "receipt":
                    data["procurement_completion"]["comment"] = "rewritten"
                elif defect == "remove_receipt":
                    del data["procurement_completion"]
                elif defect == "audit":
                    data["audit"][0]["by"] = "someone else"
                elif defect == "remove_audit":
                    data["audit"].pop(0)
                else:
                    data["rfq_workflow"]["phase"] = "procurement"
                candidate.custom_clm_data = json.dumps(data)
                with self.assertRaises(ValidationError), STORE.transaction():
                    candidate.save()

    def test_completed_contract_can_expire_and_close_with_procurement_receipt_retained(self):
        contract = self.completion_document()
        with STORE.transaction():
            contract.save()
        for status in ("Active", "Expired", "Closed"):
            contract.custom_contract_status = status
            with STORE.transaction():
                contract.save()
            mirror = json.loads(self.rfq().custom_approval_data)["contract_decision"]["clm"]
            self.assertEqual(mirror["phase"], "completed")
            self.assertEqual(mirror["procurement_completion"]["purchase_order"], "PO-1")
            self.assertEqual(mirror["blocked"], status != "Active")


if __name__ == "__main__":
    unittest.main()
