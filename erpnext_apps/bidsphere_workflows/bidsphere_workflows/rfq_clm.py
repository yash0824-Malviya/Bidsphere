"""Atomic post-award contract branch; all writes share Frappe's POST transaction.

The app gateway authenticates its actor; only the configured ERP service user
may call decide. No client flags, permission bypasses, explicit commits, or
changes to the existing RFQ Legal/Finance/PO state machine are used here.
"""

from contextlib import contextmanager
from copy import deepcopy
from datetime import date, time, datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
import math
import uuid

import frappe
from frappe.utils import now_datetime

RFQ = "Request for Quotation"
REQUEST = "Contract Request"
_CONTEXT = "bidsphere_rfq_contract_decision"
_SYNC_CONTEXT = "bidsphere_rfq_contract_sync"
_STOPPED = {"cancelled", "canceled", "closed", "stopped", "rejected", "legal rejected", "finance rejected"}
_AWARDED = {"Supplier Selected", "Pending Legal Review", "Legal Approved", "Pending Finance Review", "Finance Approved", "Approved for PO", "PO Created"}
_AWARD_CONTRACT_TYPES = {"Supply / Procurement Contract", "Service Agreement", "NDA", "Master Service Agreement", "Other"}
_AWARD_FORM_FIELDS = ("contract_type", "contract_purpose", "description", "contract_start_date", "contract_end_date", "department", "legal_review_required")
# Keep this snapshot vocabulary aligned with api/clmCore.ts. Runtime evidence and
# ERP bookkeeping fields are deliberately outside the approved contract content.
_CONTRACT_FIELDS = "party_type party_name party_user start_date end_date contract_template contract_terms requires_fulfilment fulfilment_deadline fulfilment_terms document_type document_name custom_contract_title custom_contract_type custom_supplier custom_contract_request custom_rfq custom_supplier_quotation custom_purchase_order custom_project custom_business_unit custom_contract_value custom_currency custom_payment_terms custom_risk_level custom_legal_review_required custom_engineering_review_required custom_quality_review_required custom_compliance_required custom_contract_document custom_inteva_signatory custom_part_numbers custom_renewal_notice_days custom_auto_renewal custom_program_name custom_pricing_terms custom_delivery_terms custom_quality_requirements custom_payment_terms_description custom_sla__kpi_commitments custom_penalties custom_incentives custom_renewal_terms custom_termination_clauses custom_rfp custom_rfp_response".split()


def _json_value(value):
    if isinstance(value, (date, time)):
        return str(value)
    if isinstance(value, (float, Decimal)):
        return int(value) if value == int(value) else float(value)
    if isinstance(value, dict):
        return {key: _json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    return value


def _json(value):
    return json.dumps(_json_value(value), ensure_ascii=False, separators=(",", ":"))


def _digest(value):
    return hashlib.sha256(_canonical(_json_value(value)).encode("utf-8")).hexdigest()


def _canonical(value):
    """Match JSON.stringify numbers used by the gateway's content hash.

    Python JSON emits 1e-06 and 1.0; ECMAScript emits 0.000001 and 1.
    ERP field keys use the existing ASCII snake_case schema vocabulary.
    """
    if isinstance(value, dict):
        return "{" + ",".join(_canonical(key) + ":" + _canonical(item) for key, item in sorted(value.items())) + "}"
    if isinstance(value, list):
        return "[" + ",".join(_canonical(item) for item in value) + "]"
    if isinstance(value, bool) or value is None:
        return json.dumps(value)
    if isinstance(value, (int, float, Decimal)):
        number = float(value)
        if not math.isfinite(number):
            _fail("Contract content cannot contain non-finite numbers.")
        if number == 0:
            return "0"
        shortest = repr(number)
        if 1e-6 <= abs(number) < 1e21:
            return format(Decimal(shortest), "f").rstrip("0").rstrip(".") if "." in format(Decimal(shortest), "f") else format(Decimal(shortest), "f")
        mantissa, exponent = shortest.lower().split("e")
        exponent = int(exponent)
        return mantissa.removesuffix(".0") + "e" + ("+" if exponent >= 0 else "-") + str(abs(exponent))
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return "".join("\\u%04x" % ord(char) if 0xD800 <= ord(char) <= 0xDFFF else char for char in encoded)


def _contract_snapshot(contract):
    values = contract.as_dict() if hasattr(contract, "as_dict") else contract
    return _json_value({field: values[field] for field in _CONTRACT_FIELDS if field in values})


class ContractDecisionConflict(frappe.ValidationError):
    http_status_code = 409


def _fail(message):
    frappe.throw(message, exc=ContractDecisionConflict)


def _text(value):
    return str(value).strip() if value is not None else ""


def _object(value, label):
    if not value:
        return {}
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (ValueError, TypeError):
            _fail(f"The saved {label} is invalid. Reconcile it before continuing.")
    if not isinstance(value, dict):
        _fail(f"The {label} must be an object.")
    return value


def _rows(document, field):
    value = document.get(field)
    return value if isinstance(value, list) else []


def _money(value):
    try:
        result = Decimal(str(value))
        if not result.is_finite() or result < 0:
            raise InvalidOperation
        return result
    except (ValueError, TypeError, InvalidOperation):
        _fail("The saved award must include a valid non-negative amount.")


def _blocked(document):
    return document.get("docstatus") == 2 or any(
        _text(document.get(field)).lower() in _STOPPED
        for field in ("status", "workflow_state", "custom_workflow_step", "review_status", "finance_status")
    )


def _names(doctype, filters):
    return list(dict.fromkeys(frappe.get_all(doctype, filters=filters, pluck="name")))


def _supplier_matches(reference, supplier):
    """Decode old display wrapping only if it is not a distinct real supplier."""
    value = _text(reference)
    if value == supplier:
        return True
    if not value or frappe.db.exists("Supplier", value):
        return False
    while len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        value = value[1:-1].strip()
    return value == supplier


def _selection(rfq):
    data = _object(rfq.get("custom_approval_data"), "RFQ approval data")
    if data.get("rfq") and data["rfq"] != rfq.name:
        _fail("The saved selection evidence belongs to a different RFQ.")
    return data


def _decision(rfq):
    value = _selection(rfq).get("contract_decision")
    if value is None:
        return None
    if not isinstance(value, dict) or value.get("decision") not in ("Yes", "No") or not value.get("quotation") or not value.get("by") or not value.get("at"):
        _fail("The saved contract decision is incomplete. Reconcile it before continuing.")
    return value


def _rfqs_from_quotation(quotation):
    return {_text(row.get("request_for_quotation")) for row in [quotation, *_rows(quotation, "items")] if _text(row.get("request_for_quotation"))}


def _resolve_award(rfq, expected, require_active=True):
    if require_active and _blocked(rfq):
        _fail("A cancelled, closed, stopped or rejected RFQ cannot enter CLM.")
    selection = _selection(rfq)
    if require_active and _text(selection.get("workflow_step")).lower() in _STOPPED:
        _fail("The saved RFQ award was rejected.")
    reviews = _names("Legal Document Review", {"rfq_name": rfq.name})
    if len(reviews) > 1:
        _fail("The RFQ award has ambiguous Legal Document Reviews.")
    review = frappe.get_doc("Legal Document Review", reviews[0], for_update=True) if reviews else None
    if review:
        if (require_active and _blocked(review)) or review.get("rfq_name") != rfq.name or not review.get("sq_name"):
            _fail("The saved RFQ award is unavailable or rejected.")
        if expected.get("legal_review") != review.name or _text(expected.get("legal_review_modified")) != _text(review.modified):
            _fail("The RFQ award review changed. Refresh the award before deciding.")
        quotation_name = review.sq_name
    else:
        if expected.get("legal_review"):
            _fail("The saved RFQ award review no longer exists.")
        selected = _text(rfq.get("custom_selected_supplier") or selection.get("selected_supplier"))
        if not selected or not any(value in _AWARDED for value in (rfq.get("custom_workflow_step"), selection.get("workflow_step"))):
            _fail("Select and persist the awarded supplier before deciding on a contract.")
        quotation_name = _text(expected.get("quotation"))
        candidates = _names("Supplier Quotation", [["Supplier Quotation Item", "request_for_quotation", "=", rfq.name], ["docstatus", "=", 1]])
        eligible = []
        for name in candidates:
            candidate = frappe.get_doc("Supplier Quotation", name)
            if _supplier_matches(selected, candidate.supplier) and (not rfq.get("custom_active_rfq_round") or not candidate.get("custom_rfq_round") or candidate.custom_rfq_round == rfq.custom_active_rfq_round):
                eligible.append(name)
        if eligible != [quotation_name]:
            _fail("The saved award must identify one submitted winning quotation.")
    quotation = frappe.get_doc("Supplier Quotation", quotation_name, for_update=True)
    if expected.get("quotation") != quotation.name or _text(expected.get("quotation_modified")) != _text(quotation.modified):
        _fail("The awarded quotation changed. Refresh the award before deciding.")
    if quotation.get("docstatus") != 1 or _blocked(quotation) or rfq.name not in _rfqs_from_quotation(quotation):
        _fail("The winning quotation must be submitted and belong to this RFQ.")
    supplier = frappe.get_doc("Supplier", quotation.supplier, for_update=True)
    if supplier.get("disabled") or expected.get("supplier") != supplier.name:
        _fail("The selected Supplier is unavailable or changed.")
    for reference in (rfq.get("custom_selected_supplier"), selection.get("selected_supplier"), review.get("supplier") if review else None):
        if reference and not _supplier_matches(reference, supplier.name):
            _fail("The RFQ, award review and quotation must identify the same supplier.")
    active_round = _text(rfq.get("custom_active_rfq_round"))
    if active_round and quotation.get("custom_rfq_round") and quotation.custom_rfq_round != active_round:
        _fail("The awarded quotation belongs to a different RFQ round.")
    for name in {active_round, _text(quotation.get("custom_rfq_round"))} - {""}:
        round_doc = frappe.get_doc("RFQ Round", name, for_update=True)
        if round_doc.get("rfq") != rfq.name or round_doc.get("docstatus") == 2 or _text(round_doc.get("status")).lower() in {"cancelled", "canceled"}:
            _fail("The award round is unavailable or belongs to a different RFQ.")
    company = rfq.get("company") or quotation.get("company")
    if not company or quotation.get("company") != company or review and review.get("company") and review.company != company:
        _fail("RFQ, quotation and award must belong to the same Company.")
    amounts = [review.get("grand_total") if review else None, rfq.get("custom_selected_supplier_total"), selection.get("selected_supplier_total"), quotation.get("grand_total")]
    amount = next((value for value in amounts if value is not None and value != ""), None)
    if _money(amount) != _money(expected.get("amount")) or not quotation.get("currency") or expected.get("currency") != quotation.currency:
        _fail("The saved award amount or currency changed. Refresh before deciding.")
    _validate_business_source(rfq, expected)
    return quotation, review, company, amount


def _validate_business_source(rfq, expected):
    ecr_name = _text(rfq.get("custom_ecr_reference"))
    if _text(expected.get("ecr")) != ecr_name:
        _fail("The ECR source must match the saved RFQ.")
    if ecr_name:
        ecr = frappe.get_doc("Engineering Change Request", ecr_name)
        case = _object(ecr.get("ecr_business_case"), "linked ECR Business Case")
        actual = _text(case.get("business_case_id") or case.get("name"))
        if _text(expected.get("business_case")) != actual:
            _fail("The Business Case source must match the saved ECR.")
    # General Business Intake stores its RFQ reference on Business Case. The
    # gateway resolves it; verify any supplied case against that persisted link.
    elif expected.get("business_case"):
        case = frappe.get_doc("Business Case", expected["business_case"])
        references = [case.get(field) for field in ("rfq_id", "custom_rfq_id", "linked_rfq_id")]
        if rfq.name not in references or rfq.get("custom_business_case_id") and rfq.custom_business_case_id != case.name:
            _fail("The Business Case source must reference this RFQ.")


def _linked_request(rfq_name):
    names = _names(REQUEST, {"custom_rfq": rfq_name})
    if len(names) > 1:
        _fail("Multiple Contract Requests reference this RFQ. Reconcile them first.")
    return frappe.get_doc(REQUEST, names[0], for_update=True) if names else None


def _legacy_contract_decision(rfq):
    """Read the existing audited Yes branch without rewriting legacy history."""
    if rfq.get("contract_required") != "Yes":
        return None
    request = _linked_request(rfq.name)
    if not request:
        return None
    data = _object(request.get("custom_clm_data"), "Contract lifecycle data")
    source = _object(data.get("rfq_source"), "Contract RFQ source")
    creation = next((row for row in data.get("audit", []) if row.get("action") == "create" and row.get("by") and row.get("at")), None)
    if data.get("schema") != 1 or source.get("rfq") != rfq.name or source.get("quotation") != request.get("custom_supplier_quotation") or not creation:
        _fail("The existing RFQ Contract Request must retain its source and creation audit.")
    decision = {"decision": "Yes", "request": request.name, "quotation": source["quotation"], "legal_review": source.get("legal_review"), "supplier": request.get("supplier"), "amount": request.get("contract_value"), "currency": request.get("currency"), "by": creation["by"], "at": creation["at"]}
    ecr_name = _text(rfq.get("custom_ecr_reference"))
    if ecr_name:
        ecr = frappe.get_doc("Engineering Change Request", ecr_name)
        case = _object(ecr.get("ecr_business_case"), "linked ECR Business Case")
        decision.update({"ecr": ecr_name, "business_case": case.get("business_case_id") or case.get("name")})
    elif rfq.get("custom_business_case_id"):
        decision["business_case"] = rfq.custom_business_case_id
    return decision


def _validate_new_request_details(record):
    """RFQ award creation has explicit choices; existing CLM drafts keep theirs."""
    if not isinstance(record.get("contract_type"), str) or record["contract_type"] not in _AWARD_CONTRACT_TYPES:
        _fail("Select a supported Contract Type before creating the RFQ Contract Request.")
    if record.get("legal_review_required") not in (1, "1"):
        _fail("Legal Manager review is required for a Contract Request created from an RFQ award.")
    for field, label in (("contract_purpose", "Contract Purpose"), ("description", "Contract Description"), ("department", "Department")):
        if not isinstance(record.get(field), str) or not record[field].strip():
            _fail(f"{label} is required before creating the RFQ Contract Request.")
    dates = {}
    for field, label in (("contract_start_date", "Contract Start Date"), ("contract_end_date", "Contract End Date")):
        value = record.get(field)
        try:
            parsed = date.fromisoformat(value) if isinstance(value, str) else value if type(value) is date else None
            if parsed is None or (isinstance(value, str) and parsed.isoformat() != value):
                raise ValueError
        except (TypeError, ValueError):
            _fail(f"Enter a valid {label}.")
        dates[field] = parsed
    if dates["contract_end_date"] <= dates["contract_start_date"]:
        _fail("Contract End Date must be after Contract Start Date.")


def _validate_request(record, rfq, quotation, company, amount, actor, award, new=False):
    required = {"custom_rfq": rfq.name, "custom_supplier_quotation": quotation.name, "supplier": quotation.supplier, "company": company, "currency": quotation.currency}
    if any(record.get(field) != value for field, value in required.items()):
        _fail("The Contract Request must preserve the saved RFQ, quotation, supplier and company.")
    if _money(record.get("contract_value")) != _money(amount) or _money(record.get("estimated_contract_value")) != _money(amount):
        _fail("The Contract Request must preserve the award amount.")
    data = _object(record.get("custom_clm_data"), "Contract lifecycle data")
    source = _object(data.get("rfq_source"), "Contract RFQ source")
    if data.get("schema") != 1 or source.get("rfq") != rfq.name or source.get("quotation") != quotation.name:
        _fail("The Contract Request must retain its RFQ award evidence.")
    if new and (record.get("name") or record.get("docstatus", 0) != 0 or record.get("request_status") != "Draft" or record.get("approval_status") != "Pending"):
        _fail("A new RFQ Contract Request must be an unnamed draft with pending approval.")
    if new and not any(row.get("action") == "create" and row.get("by") == actor["id"] and row.get("at") for row in data.get("audit", [])):
        _fail("The new Contract Request must retain its authenticated creation audit.")
    if record.get("custom_purchase_order"):
        po = frappe.get_doc("Purchase Order", record["custom_purchase_order"])
        if po.get("docstatus") == 2 or po.get("supplier") != quotation.supplier or not any(row.get("supplier_quotation") == quotation.name for row in _rows(po, "items")):
            _fail("The optional Purchase Order must belong to this award.")
    if new:
        _validate_new_request_details(record)
        _validate_request_routing(record, actor=actor, new=True)
        if source.get("award") != (award.get("legal_review") or quotation.name) or source.get("supplier") != quotation.supplier or source.get("contract_required") is not True:
            _fail("The Contract Request must retain its supplier award and contract decision source.")
        if source.get("company") != company or source.get("currency") != quotation.currency or _money(source.get("amount")) != _money(amount):
            _fail("The Contract Request source must preserve the award company, currency and amount.")
        department = _text(award.get("department"))
        if source.get("department") != record.get("department") or department and record.get("department") != department:
            _fail("The Contract Request must preserve its verified award department.")
        for field in ("business_case", "ecr"):
            if _text(source.get(field)) != _text(award.get(field)):
                _fail("The Contract Request Business Case and ECR source must match its award.")


def _validate_request_routing(record, actor=None, new=False, phase="procurement_team"):
    """Validate the persisted role queue instead of inferring it from Draft."""
    data = _object(record.get("custom_clm_data"), "Contract Request lifecycle data")
    expected = {"version": 1, "phase": phase, "assigned_role": "procurement_team"}
    approvals = data.get("approvals") or []
    status = "Pending" if phase == "procurement_team" else "Approved"
    if data.get("rfq_request_workflow") != expected or not isinstance(approvals, list) or len(approvals) != 1 or not isinstance(approvals[0], dict) or approvals[0].get("role") != "procurement_team" or approvals[0].get("stage") != 0 or approvals[0].get("status") != status or not _text(approvals[0].get("id")) or approvals[0].get("user"):
        _fail("The RFQ Contract Request must retain its Procurement Team assignment and approval stage.")
    if new and (not actor or record.get("requester") != actor.get("id")):
        _fail("The RFQ Contract Request requester must be the authenticated decision actor.")
    audit = data.get("audit") or []
    if not isinstance(audit, list) or not any(isinstance(row, dict) and row.get("action") == "procurement_team_assigned" and row.get("role") == "procurement_team" and _text(row.get("by")) and _text(row.get("at")) and row.get("previous_status") in ("Draft", "Approved") and row.get("new_status") == "Pending Procurement Team" and (not new or row.get("by") == actor.get("id") and row.get("previous_status") == "Draft") for row in audit):
        _fail("The RFQ Contract Request must retain its Procurement Team assignment audit.")
    if phase == "procurement_team" and (record.get("request_status") not in ("Draft", "Approved") or record.get("approval_status") not in ("Pending", "Approved") or data.get("contract")):
        _fail("The pending Procurement Team request must remain Draft or Approved without a Contract.")
    if phase == "contract_created" and (record.get("request_status") != "Completed" or not data.get("contract") or not _text(approvals[0].get("by")) or not _text(approvals[0].get("at"))):
        _fail("The completed Procurement Team request must retain its Contract and approval evidence.")
    return data


def _adopt_request_routing(request, request_document, actor):
    """Explicitly route one legacy Draft while preserving its saved evidence."""
    payload = _object(request_document, "Contract Request routing document")
    prior = _object(request.get("custom_clm_data"), "Contract Request lifecycle data")
    if prior.get("rfq_request_workflow"):
        _validate_request_routing(request)
        return request
    if not payload or request.get("docstatus") == 2 or request.get("request_status") not in ("Draft", "Approved") or prior.get("contract") or prior.get("approvals"):
        _fail("Route the existing Contract Request Draft to Procurement Team before creating its Contract. Preserve and resolve any prior request review first.")
    if any(_json_value(value) != _json_value(request.get(field)) for field, value in payload.items() if field != "custom_clm_data"):
        _fail("Procurement Team routing must preserve the existing Contract Request fields.")
    data = _object(payload.get("custom_clm_data"), "Contract Request lifecycle data")
    excluded = {"rfq_request_workflow", "approvals", "audit"}
    if {key: value for key, value in data.items() if key not in excluded} != {key: value for key, value in prior.items() if key not in excluded}:
        _fail("Procurement Team routing must preserve the existing Contract Request source and lifecycle evidence.")
    audit = data.get("audit") or []
    old_audit = prior.get("audit") or []
    additions = audit[len(old_audit):]
    if audit[:len(old_audit)] != old_audit or len(additions) != 1 or additions[0].get("action") != "procurement_team_assigned" or additions[0].get("by") != actor["id"] or additions[0].get("previous_status") != request.get("request_status"):
        _fail("Procurement Team routing must retain prior audit and record its authenticated assignment.")
    request.custom_clm_data = payload["custom_clm_data"]
    _validate_request_routing(request)
    with _decision_context(request.custom_rfq):
        request.save()
    persisted = frappe.get_doc(REQUEST, request.name, for_update=True)
    if persisted.get("custom_clm_data") != request.custom_clm_data:
        _fail("ERPNext did not persist the Procurement Team request assignment. Apply the CLM schema migration.")
    return persisted


def _pending_request_state(request):
    return {"request": request.name, "status": "Pending Procurement Team", "phase": "procurement_team", "assigned_role": "procurement_team", "contract_required": "Yes", "blocked": True}


@contextmanager
def _decision_context(name):
    previous = getattr(frappe.local, _CONTEXT, None)
    setattr(frappe.local, _CONTEXT, name)
    try:
        yield
    finally:
        setattr(frappe.local, _CONTEXT, previous)


@contextmanager
def _sync_context(name):
    previous = getattr(frappe.local, _SYNC_CONTEXT, None)
    setattr(frappe.local, _SYNC_CONTEXT, name)
    try:
        yield
    finally:
        setattr(frappe.local, _SYNC_CONTEXT, previous)


def _rfq_context(rfq, decision, contract):
    return {"rfq_id": rfq.name, "award_id": decision.get("award") or decision.get("legal_review") or decision["quotation"],
            "supplier_id": decision["supplier"], "quotation_id": decision["quotation"],
            "contract_type": contract.get("custom_contract_type"), "contract_status": contract.get("custom_contract_status") or "Draft", "contract_required": "Yes"}


def _new_award_contract(request, rfq, award, actor, contract_fields):
    """Create and route the real CLM to Legal within the Yes transaction."""
    if request.get("docstatus") == 2 or request.get("request_status") not in ("Draft", "Approved"):
        _fail("The existing Contract Request must be Draft or Approved before creating its Contract. Resolve its current review first.")
    source = _validate_request_routing(request)
    setup = dict(_object(contract_fields, "Contract creation fields"))
    if "custom_risk_level" not in setup or not setup["custom_risk_level"]:
        setup["custom_risk_level"] = "Low"
    if set(setup) != {"custom_risk_level", "custom_inteva_signatory"} or not isinstance(setup.get("custom_risk_level"), str) or setup["custom_risk_level"] not in {"Low", "Medium", "High", "Critical"} or not isinstance(setup.get("custom_inteva_signatory"), str) or not _text(setup.get("custom_inteva_signatory")):
        _fail("Select the designated Legal Manager before creating the RFQ CLM.")
    _require_legal_user(_text(setup["custom_inteva_signatory"]))
    mapping = {"custom_contract_title": "contract_purpose", "custom_contract_type": "contract_type", "contract_terms": "description",
               "start_date": "contract_start_date", "end_date": "contract_end_date", "custom_contract_value": "contract_value", "custom_currency": "currency",
               "custom_payment_terms_description": "payment_terms", "custom_renewal_notice_days": "notice_period_days", "custom_auto_renewal": "auto_renewal"}
    payload = {key: request.get(value) for key, value in mapping.items() if request.get(value) is not None}
    payload.update({"doctype": "Contract", "party_type": "Supplier", "party_name": request.supplier, "custom_supplier": request.supplier,
                    "custom_contract_request": request.name, "custom_contract_status": "Draft", "custom_approval_status": "Pending",
                    "custom_esign_status": "Not Started", "custom_legal_review_required": 1, **setup})
    payload.update({field: request.get(field) for field in ("custom_rfq", "custom_supplier_quotation", "custom_purchase_order", "custom_project", "custom_business_unit") if request.get(field)})
    decision = {**award, "supplier": request.supplier, "quotation": request.custom_supplier_quotation, "award": award.get("legal_review") or request.custom_supplier_quotation}
    at = str(now_datetime())
    data = {"schema": 1, "approvals": [], "versions": [], "signatures": [], "sla": [],
            "audit": [{"id": str(uuid.uuid4()), "action": "create_from_rfq_award", "by": actor["id"], "role": actor["role"], "at": at, "previous_status": "", "new_status": "Draft", "comment": f"Created from {rfq.name} award {decision['award']}", "reference_id": rfq.name}],
            "rfq_source": deepcopy(source["rfq_source"]), "source_documents": deepcopy(source.get("source_documents", [])),
            "rfq_context": _rfq_context(rfq, decision, payload), "rfq_workflow": {"version": 1, "phase": "draft"}}
    payload["custom_clm_data"] = _json(data)
    contract = frappe.get_doc(payload).insert()
    contract = frappe.get_doc("Contract", contract.name, for_update=True)
    if any(_text(contract.get(key)) != _text(value) for key, value in payload.items() if key not in ("doctype", "custom_clm_data")) or contract.get("custom_clm_data") != payload["custom_clm_data"]:
        _fail("ERPNext did not persist the RFQ Contract draft fields. Apply the CLM schema migration.")
    # ERP applies native defaults on insertion. Snapshot the persisted draft so
    # the first review sees exactly the content version it will approve.
    content = _contract_snapshot(contract)
    version = {"id": str(uuid.uuid4()), "number": "1.0", "author": actor["id"], "at": at, "comment": f"RFQ award {decision['award']}", "hash": _digest(content), "content": content}
    data["versions"] = [version]
    data["version"] = version["id"]
    data["approvals"] = [{"id": str(uuid.uuid4()), "role": "legal", "stage": 0, "rule": "RFQ Award: Legal Manager Review", "status": "Pending"}]
    data["rfq_workflow"] = {"version": 1, "phase": "legal_review"}
    data["audit"][0]["reference_id"] = contract.name
    data["audit"].append({"id": str(uuid.uuid4()), "action": "legal_review_started", "by": actor["id"], "role": actor["role"], "at": at, "previous_status": "Draft", "new_status": "Pending Legal", "comment": "Submitted to Legal Manager from RFQ award creation.", "reference_id": contract.name})
    contract.custom_contract_status = "Pending Legal"
    contract.custom_current_approver = ""
    contract.custom_current_version = "1.0"
    data["rfq_context"] = _rfq_context(rfq, decision, contract)
    contract.custom_clm_data = _json(data)
    contract.save()
    contract = frappe.get_doc("Contract", contract.name, for_update=True)
    if contract.get("custom_clm_data") != _json(data) or contract.get("custom_current_version") != "1.0" or contract.get("custom_contract_status") != "Pending Legal":
        _fail("ERPNext did not persist the RFQ Contract Legal review, version and context.")
    source["contract"] = contract.name
    source["rfq_context"] = deepcopy(data["rfq_context"])
    source["rfq_request_workflow"] = {"version": 1, "phase": "contract_created", "assigned_role": "procurement_team"}
    source["approvals"][0].update({"status": "Approved", "by": actor["id"], "at": at, "comment": f"Reviewed and created Contract {contract.name}."})
    source.setdefault("audit", []).append({"id": str(uuid.uuid4()), "action": "create_contract_from_rfq_award", "by": actor["id"], "role": actor["role"], "at": at, "previous_status": request.request_status, "new_status": "Completed", "comment": contract.name, "reference_id": contract.name})
    request.request_status = "Completed"
    # Completed denotes the provenance record's conversion, not a human approval.
    request.custom_clm_data = _json(source)
    request.save()
    request = frappe.get_doc(REQUEST, request.name, for_update=True)
    if request.request_status != "Completed" or request.get("custom_clm_data") != _json(source):
        _fail("ERPNext did not persist the RFQ Contract Request conversion link.")
    return request, contract


def _require_gateway(actor):
    configured = _text(frappe.conf.get("bidsphere_gateway_user"))
    if not configured or frappe.session.user != configured or frappe.session.user == "Guest":
        frappe.throw("This operation requires the configured BidSphere gateway service identity.", exc=frappe.PermissionError)
    actor = _object(actor, "authenticated actor")
    if actor.get("role") != "procurement_team" or not _text(actor.get("id")):
        frappe.throw("Only the Procurement Team may record the RFQ contract decision and create its CLM.", exc=frappe.PermissionError)
    return actor


@frappe.whitelist(methods=["POST"])
def decide(rfq, expected_modified, decision, actor, award, request_document=None, create_contract=False, contract_fields=None):
    actor = _require_gateway(actor)
    if create_contract not in (False, True, 0, 1, "0", "1", "true", "false", None):
        _fail("Invalid RFQ Contract creation option.")
    create_contract = create_contract in (True, 1, "1", "true")
    if decision not in ("Yes", "No") or not _text(rfq):
        _fail("Supply an RFQ and a Yes or No contract decision.")
    if decision == "No" and create_contract:
        _fail("A No Contract decision cannot create a Contract.")
    award = _object(award, "award")
    document = frappe.get_doc(RFQ, rfq, for_update=True)
    document.check_permission("write")
    prior = _decision(document)
    request = _linked_request(rfq)
    contracts = list(dict.fromkeys(_names("Contract", {"custom_rfq": rfq}) + (_names("Contract", {"custom_contract_request": request.name}) if request else [])))
    if len(contracts) > 1:
        _fail("Multiple Contracts reference this RFQ award. Reconcile them first.")
    # The RFQ lock serializes decisions and lifecycle mirrors. Do not acquire an
    # existing Contract row lock after it: native Contract.save holds its own row
    # before its hook takes the RFQ lock, and the inverse order can deadlock.
    contract = frappe.get_doc("Contract", contracts[0]) if contracts else None
    if prior:
        if prior["decision"] != decision or prior["quotation"] != award.get("quotation"):
            _fail("The contract decision was already recorded for this award and cannot be changed.")
        if document.get("contract_required") != decision or (decision == "Yes" and (not request or prior.get("request") != request.name)) or (decision == "No" and (request or contracts)):
            _fail("The persisted RFQ contract decision and CLM links are inconsistent.")
        if create_contract and not contract:
            # A compatible request-only client may have already chosen Yes.
            # Preserve that decision and convert its valid draft once.
            quotation, review, company, amount = _resolve_award(document, award)
            _validate_request(request, document, quotation, company, amount, actor, award)
            _validate_new_request_details(request)
            with _decision_context(document.name):
                request, contract = _new_award_contract(request, document, award, actor, contract_fields)
            sync_contract(contract)
            document = frappe.get_doc(RFQ, rfq, for_update=True)
            return {"created": True, "decision": _decision(document), "rfq": document.as_dict(), "request": request.as_dict(), "contract": contract.as_dict()}
        if decision == "Yes" and not contract:
            request = _adopt_request_routing(request, request_document, actor)
            state = _pending_request_state(request)
            if prior.get("clm") != state:
                data = _selection(document)
                prior = {**prior, "clm": state}
                data["contract_decision"] = prior
                document.custom_approval_data = _json(data)
                with _decision_context(document.name):
                    document.save()
                persisted = frappe.get_doc(RFQ, document.name, for_update=True)
                if _decision(persisted) != prior:
                    _fail("ERPNext did not persist the Procurement Team request routing state.")
                document = persisted
                if prior.get("legal_review"):
                    _save_award_state(frappe.get_doc("Legal Document Review", prior["legal_review"], for_update=True), document.name, state)
        if contract and (contract.get("custom_rfq") != rfq or not request or contract.get("custom_contract_request") != request.name or contract.get("custom_supplier_quotation") != prior["quotation"]):
            _fail("The persisted RFQ Contract and award links are inconsistent.")
        if contract:
            request_data = _object(request.get("custom_clm_data"), "Contract Request lifecycle data")
            contract_data = _object(contract.get("custom_clm_data"), "Contract lifecycle data")
            if prior.get("contract") != contract.name or request_data.get("contract") != contract.name or contract_data.get("rfq_context") != _rfq_context(document, prior, contract):
                _fail("The existing Contract's permanent RFQ Award links are incomplete. Repair its saved transaction before retrying; no new Contract was created.")
        return {"created": False, "decision": prior, "rfq": document.as_dict(), "request": request.as_dict() if request else None, "contract": contract.as_dict() if contract else None}
    if create_contract:
        _fail("Record Contract Required = Yes and route its Contract Request to Procurement Team before the separate Create Contract action.")
    if _text(expected_modified) != _text(document.modified):
        _fail("The RFQ changed. Refresh its award before deciding.")
    quotation, review, company, amount = _resolve_award(document, award)
    if decision == "No" and (request or contracts):
        _fail("An existing CLM is linked to this RFQ. It cannot be changed to No Contract.")
    if decision == "Yes" and contracts and not request:
        _fail("A Contract already references this RFQ without its request. Reconcile its source links first.")
    created = False
    if decision == "Yes":
        source_field = frappe.get_meta(REQUEST).get_field("custom_rfq")
        if not source_field or not source_field.unique:
            _fail("The Contract Request RFQ unique constraint must be installed before deciding.")
        if request:
            _validate_request(request, document, quotation, company, amount, actor, award)
            request = _adopt_request_routing(request, request_document, actor)
        else:
            payload = _object(request_document, "Contract Request document")
            if payload.get("doctype", REQUEST) != REQUEST or any(field in payload for field in ("flags", "__islocal", "__unsaved", "ignore_permissions", "ignore_mandatory")):
                _fail("Invalid Contract Request creation document.")
            _validate_request(payload, document, quotation, company, amount, actor, award, new=True)
            expected_runtime = payload.get("custom_clm_data")
            with _decision_context(document.name):
                request = frappe.get_doc({**payload, "doctype": REQUEST}).insert()
            request = frappe.get_doc(REQUEST, request.name, for_update=True)
            _validate_request(request, document, quotation, company, amount, actor, award)
            _validate_new_request_details(request)
            if any(_text(request.get(field)) != _text(payload.get(field)) for field in _AWARD_FORM_FIELDS):
                _fail("ERPNext did not persist the RFQ Contract Request form details. Inspect the Contract Request schema.")
            if request.get("custom_clm_data") != expected_runtime:
                _fail("ERPNext did not persist the Contract Request source and audit information. Apply the CLM schema migration.")
            _validate_request_routing(request)
            created = True
        if create_contract and not contract:
            _validate_new_request_details(request)
            with _decision_context(document.name):
                request, contract = _new_award_contract(request, document, award, actor, contract_fields)
            created = True
    recorded = {"decision": decision, "quotation": quotation.name, "award": review.name if review else quotation.name, "supplier": quotation.supplier, "amount": float(_money(amount)), "currency": quotation.currency, "by": actor["id"], "at": str(now_datetime())}
    if decision == "No":
        recorded["clm"] = {"contract_required": "No", "status": "Not Required", "blocked": False}
    if request:
        recorded["request"] = request.name
        recorded["clm"] = _pending_request_state(request)
    if contract:
        recorded["contract"] = contract.name
    if review:
        recorded["legal_review"] = review.name
    for key in ("business_case", "ecr"):
        if award.get(key):
            recorded[key] = award[key]
    data = _selection(document)
    data["contract_decision"] = recorded
    document.contract_required = decision
    document.custom_approval_data = json.dumps(data, separators=(",", ":"))
    with _decision_context(document.name):
        document.save()
    persisted = frappe.get_doc(RFQ, document.name, for_update=True)
    if persisted.get("contract_required") != decision or persisted.get("custom_approval_data") != document.custom_approval_data or _decision(persisted) != recorded:
        _fail("ERPNext did not persist the RFQ contract decision. Apply the RFQ CLM schema migration.")
    if contract and create_contract:
        sync_contract(contract)
        contract = frappe.get_doc("Contract", contract.name, for_update=True)
        persisted = frappe.get_doc(RFQ, document.name, for_update=True)
        recorded = _decision(persisted)
    elif review and frappe.get_meta("Legal Document Review").get_field("custom_clm_state"):
        _save_award_state(review, document.name, recorded["clm"])
    # No catch/commit: a failure anywhere rolls back both insertion and RFQ save.
    return {"created": created, "decision": recorded, "rfq": persisted.as_dict(), "request": request.as_dict() if request else None, "contract": contract.as_dict() if contract else None}


def _terminal_states(document):
    selection = _selection(document)
    return tuple(_text(document.get(key)) for key in ("status", "workflow_state", "custom_workflow_step")) + (_text(selection.get("workflow_step")),)


def _has_existing_po(rfq):
    quotations = _names("Supplier Quotation", [["Supplier Quotation Item", "request_for_quotation", "=", rfq.name]])
    return any(_names("Purchase Order", [["Purchase Order Item", "supplier_quotation", "=", name], ["docstatus", "!=", 2]]) for name in quotations)


def _historical_no_clm(rfq):
    return not _decision(rfq) and rfq.get("contract_required") != "Yes" and not _linked_request(rfq.name) and not _names("Contract", {"custom_rfq": rfq.name})


def _contract_source(contract, require_active=False):
    rfq = frappe.get_doc(RFQ, contract.custom_rfq, for_update=True)
    decision = _decision(rfq) or _legacy_contract_decision(rfq)
    if not decision or decision["decision"] != "Yes" or rfq.get("contract_required") != "Yes":
        _fail("An RFQ Contract requires the saved Yes contract decision for its award.")
    request = _linked_request(rfq.name)
    if not request or decision.get("request") != request.name or contract.get("custom_contract_request") != request.name:
        _fail("The RFQ Contract must preserve its Contract Request link.")
    if decision.get("contract") and decision["contract"] != contract.name:
        _fail("The RFQ award is already linked to a different Contract.")
    names = set(_names("Contract", {"custom_rfq": rfq.name}) + _names("Contract", {"custom_contract_request": request.name}))
    if names - {contract.name}:
        _fail("Exactly one Contract may be linked to this RFQ award.")
    quotation = frappe.get_doc("Supplier Quotation", decision["quotation"], for_update=True)
    review = frappe.get_doc("Legal Document Review", decision["legal_review"], for_update=True) if decision.get("legal_review") else None
    expected = {**decision, "quotation_modified": _text(quotation.modified), "legal_review_modified": _text(review.modified) if review else None}
    quotation, review, company, amount = _resolve_award(rfq, expected, require_active=require_active)
    _validate_request(request, rfq, quotation, company, amount, {}, expected)
    if contract.get("custom_supplier_quotation") != quotation.name or contract.get("custom_supplier") != quotation.supplier or contract.get("party_type") not in (None, "Supplier") or contract.get("party_name") not in (None, quotation.supplier):
        _fail("The RFQ Contract must preserve its awarded supplier and quotation.")
    if _money(contract.get("custom_contract_value")) != _money(amount) or contract.get("custom_currency") != quotation.currency:
        _fail("The RFQ Contract must preserve its award amount and currency.")
    return rfq, decision, review


def guard_request(doc, method=None):
    """Role routing and conversion are exclusively the atomic award actions."""
    previous = doc.get_doc_before_save()
    name = _text(doc.get("custom_rfq") or (previous.get("custom_rfq") if previous else None))
    if not name or getattr(frappe.local, _CONTEXT, None) == name:
        return
    if previous and previous.get("custom_rfq") != doc.get("custom_rfq"):
        _fail("The RFQ Contract Request source cannot be changed or removed.")
    if previous and previous.get("request_status") == "Draft" and doc.get("request_status") == "Completed":
        _fail("Convert an RFQ Contract Request Draft only through its atomic award transaction.")
    data = _object(doc.get("custom_clm_data"), "Contract Request lifecycle data")
    old_data = _object(previous.get("custom_clm_data"), "Contract Request lifecycle data") if previous else {}
    if not data.get("rfq_request_workflow") and not old_data.get("rfq_request_workflow"):
        return
    if not previous or not old_data.get("rfq_request_workflow"):
        _fail("Route the RFQ Contract Request to Procurement Team through its atomic award transaction.")
    for field in ("rfq_request_workflow", "approvals", "rfq_source", "contract", "rfq_context"):
        if data.get(field) != old_data.get(field):
            _fail("The Procurement Team assignment, approval and source evidence must be preserved; use the RFQ request action.")
    for field in ("request_status", "approval_status", "requester", "custom_supplier_quotation", "supplier", "company", "contract_value", "estimated_contract_value", "currency"):
        if doc.get(field) != previous.get(field):
            _fail("The routed Procurement Team request must preserve its status, requester and award.")
    audit = data.get("audit") or []
    old_audit = old_data.get("audit") or []
    if audit[:len(old_audit)] != old_audit:
        _fail("Existing Procurement Team request audit entries cannot be changed or removed.")
    _validate_request_routing(doc, phase=data["rfq_request_workflow"]["phase"])


def guard_contract(doc, method=None):
    """Derive permanent context before persistence; never trust client links."""
    previous = doc.get_doc_before_save()
    name = _text(doc.get("custom_rfq") or (previous.get("custom_rfq") if previous else None))
    if not name:
        return
    if getattr(frappe.local, _CONTEXT, None) == name:
        return
    if not doc.get("custom_rfq") or previous and previous.get("custom_rfq") != doc.get("custom_rfq"):
        _fail("An RFQ Contract cannot change or remove its RFQ award link.")
    protected = ("custom_clm_data", "custom_contract_status", "custom_approval_status", "custom_current_version", "custom_final_version_locked", "custom_esign_status", "custom_executed_contract", "custom_executed_date", "custom_inteva_signatory", "custom_supplier_signatory_name", "custom_supplier_signed_date", "custom_inteva_signed_date", "is_signed", "signed_by_company", "signed_on")
    if not previous or any(doc.get(field) != previous.get(field) for field in protected):
        configured = _text(frappe.conf.get("bidsphere_gateway_user"))
        if not configured or frappe.session.user != configured or frappe.session.user == "Guest":
            frappe.throw("RFQ Contract approval, signature and lifecycle evidence must be saved through the authenticated BidSphere gateway.", exc=frappe.PermissionError)
    rfq, decision, _ = _contract_source(doc, require_active=not previous)
    data = _object(doc.get("custom_clm_data"), "Contract lifecycle data")
    if data.get("schema") != 1:
        _fail("The RFQ Contract must preserve its lifecycle and source evidence.")
    context = _rfq_context(rfq, decision, doc)
    supplied = data.get("rfq_context")
    if supplied is not None and (not isinstance(supplied, dict) or any(supplied.get(key) != context[key] for key in ("rfq_id", "award_id", "supplier_id", "quotation_id", "contract_required"))):
        _fail("The RFQ Contract context must match its saved award.")
    if previous:
        old_data = _object(previous.get("custom_clm_data"), "Contract lifecycle data")
        if old_data.get("rfq_context") and supplied is None:
            _fail("The permanent RFQ Contract context cannot be removed.")
        if old_data.get("rfq_source") and old_data["rfq_source"] != data.get("rfq_source"):
            _fail("The RFQ Contract source evidence cannot be changed.")
        if old_data.get("rfq_workflow") and not data.get("rfq_workflow"):
            _fail("The RFQ Contract sequential workflow policy cannot be removed.")
        if old_data.get("procurement_completion") and old_data["procurement_completion"] != data.get("procurement_completion"):
            _fail("The RFQ Contract procurement completion receipt cannot be changed or removed.")
        old_audit = old_data.get("audit", [])
        if not isinstance(data.get("audit"), list) or data["audit"][:len(old_audit)] != old_audit:
            _fail("Existing RFQ Contract audit events cannot be changed or removed.")
    context_changed = data.get("rfq_context") != context
    data["rfq_context"] = context
    _validate_sequential_workflow(doc, data)
    if doc.get("docstatus") != 2 and doc.get("custom_contract_status") in ("Executed", "Active"):
        _validate_execution(doc)
    if context_changed:
        doc.custom_clm_data = _json(data)


def guard_award_state(doc, method=None):
    previous = doc.get_doc_before_save()
    before = previous.get("custom_clm_state") if previous else None
    after = doc.get("custom_clm_state")
    if (before or "") != (after or "") and getattr(frappe.local, _SYNC_CONTEXT, None) != doc.get("rfq_name"):
        _fail("The award CLM state is maintained by its linked Contract lifecycle.")


def _save_award_state(review, rfq_name, state):
    award_state = _json({"rfq_id": rfq_name, "award_id": review.name, **state})
    if review.get("custom_clm_state") == award_state:
        return
    with _sync_context(rfq_name):
        review.custom_clm_state = award_state
        review.save()
        persisted_review = frappe.get_doc("Legal Document Review", review.name, for_update=True)
        if persisted_review.get("custom_clm_state") != award_state:
            _fail("ERPNext did not persist the linked award CLM lifecycle state.")


def sync_contract(doc, method=None):
    """Mirror CLM state inside the same save transaction, without RFQ transitions."""
    name = _text(doc.get("custom_rfq"))
    if not name or getattr(frappe.local, _CONTEXT, None) == name or getattr(frappe.local, _SYNC_CONTEXT, None) == name:
        return
    rfq, decision, review = _contract_source(doc)
    executed = doc.get("docstatus") != 2 and doc.get("custom_contract_status") in ("Executed", "Active")
    if executed:
        _validate_execution(doc)
    state = {"contract": doc.name, "status": "Cancelled" if doc.get("docstatus") == 2 else doc.get("custom_contract_status") or "Draft", "contract_type": doc.get("custom_contract_type"), "contract_required": "Yes", "blocked": not executed}
    data = _object(doc.get("custom_clm_data"), "Contract lifecycle data")
    workflow = data.get("rfq_workflow") or {}
    if workflow.get("phase"):
        state["phase"] = workflow["phase"]
    if data.get("procurement_completion"):
        state["procurement_completion"] = deepcopy(data["procurement_completion"])
    if workflow.get("phase") == "completed":
        state["procurement_status"] = "Completed"
    if executed:
        finance = next(row for row in data["approvals"] if row["role"] == "finance")
        state["executed_at"] = finance["at"]
    # Legacy RFQs with audited requests acquire the same derived mirror only
    # when their Contract is actually saved, preserving unrelated old records.
    changed = {**decision, "contract": doc.name, "clm": state}
    saved = _selection(rfq)
    with _sync_context(name):
        if saved.get("contract_decision") != changed:
            saved["contract_decision"] = changed
            rfq.custom_approval_data = _json(saved)
            rfq.save()
            persisted = frappe.get_doc(RFQ, name, for_update=True)
            if _decision(persisted) != changed:
                _fail("ERPNext did not persist the linked RFQ CLM lifecycle state.")
        if review:
            field = frappe.get_meta("Legal Document Review").get_field("custom_clm_state")
            if not field:
                _fail("Install the RFQ award CLM state schema before saving the Contract.")
            _save_award_state(review, name, state)


def guard_rfq(doc, method=None):
    previous = doc.get_doc_before_save()
    if not previous:
        if _decision(doc):
            _fail("Record the contract decision through the RFQ award action.")
        if any(state in {"Completed", "PO Created", "Ordered"} for state in _terminal_states(doc)):
            _fail("A new RFQ must complete its supplier award and contract decision before completion.")
        return
    old_decision, new_decision = _decision(previous), _decision(doc)
    authorized = getattr(frappe.local, _CONTEXT, None) == doc.name or getattr(frappe.local, _SYNC_CONTEXT, None) == doc.name
    if not authorized and old_decision != new_decision:
        _fail("The RFQ contract decision must be preserved; use its award decision action.")
    selected = previous.get("custom_selected_supplier") or _selection(previous).get("selected_supplier") or _names("Legal Document Review", {"rfq_name": doc.name})
    if not authorized and (old_decision or selected) and previous.get("contract_required") != doc.get("contract_required"):
        _fail("Change the contract requirement only through the RFQ award decision action.")
    if old_decision:
        for key in ("company", "custom_selected_supplier", "custom_selected_supplier_total", "custom_active_rfq_round", "custom_ecr_reference", "custom_business_case_id"):
            if doc.get(key) != previous.get(key):
                _fail("The awarded RFQ source cannot be changed after the contract decision.")
        before, after = _selection(previous), _selection(doc)
        for key in ("selected_supplier", "selected_supplier_total"):
            if before.get(key) != after.get(key):
                _fail("The awarded supplier and value cannot be changed after the contract decision.")
    if any(state in {"Completed", "PO Created", "Ordered"} for state in _terminal_states(doc)):
        if getattr(frappe.local, _SYNC_CONTEXT, None) == doc.name and _terminal_states(previous) == _terminal_states(doc):
            # Expiration/cancellation after an existing PO changes only the CLM
            # mirror. It never re-enters or advances the RFQ's business workflow.
            return
        historical = _historical_no_clm(previous) and _terminal_states(previous) == _terminal_states(doc) and _has_existing_po(previous)
        if not historical:
            _assert_contract_executed(doc, new_decision)


def _assert_contract_executed(rfq, decision):
    decision = decision or _legacy_contract_decision(rfq)
    if not decision:
        _fail("Record Contract / CLM Required after supplier award before continuing to a Purchase Order.")
    quotation = frappe.get_doc("Supplier Quotation", decision["quotation"], for_update=True)
    review = frappe.get_doc("Legal Document Review", decision["legal_review"], for_update=True) if decision.get("legal_review") else None
    expected_award = {**decision, "quotation_modified": _text(quotation.modified), "legal_review_modified": _text(review.modified) if review else None}
    quotation, review, company, amount = _resolve_award(rfq, expected_award)
    if decision["decision"] == "No":
        if rfq.get("contract_required") == "Yes" or _linked_request(rfq.name) or _names("Contract", {"custom_rfq": rfq.name}):
            _fail("The RFQ No Contract decision conflicts with existing CLM records.")
        return
    request = _linked_request(rfq.name)
    if rfq.get("contract_required") != "Yes" or not request or decision.get("request") != request.name or request.get("custom_supplier_quotation") != decision["quotation"]:
        _fail("This awarded RFQ requires its linked CLM before procurement can continue.")
    _validate_request(request, rfq, quotation, company, amount, {}, decision)
    names = set(_names("Contract", {"custom_rfq": rfq.name}) + _names("Contract", {"custom_contract_request": request.name}))
    if len(names) != 1:
        _fail("Exactly one executed Contract must exist for this RFQ award.")
    # Read the last committed Contract while holding the RFQ gate lock. A
    # concurrent lifecycle save must acquire this same RFQ lock before commit.
    contract = frappe.get_doc("Contract", names.pop())
    if contract.get("custom_rfq") != rfq.name or contract.get("custom_contract_request") != request.name or contract.get("custom_supplier_quotation") != decision["quotation"] or contract.get("custom_supplier") != request.get("supplier"):
        _fail("The executed Contract must preserve this RFQ award and supplier.")
    if _money(contract.get("custom_contract_value")) != _money(amount) or contract.get("custom_currency") != quotation.currency:
        _fail("The executed Contract must preserve the award amount and currency.")
    _validate_execution(contract)
    mirror = decision.get("clm")
    if mirror is not None and (not isinstance(mirror, dict) or mirror.get("blocked") is not False or mirror.get("contract") != contract.name or mirror.get("status") != contract.get("custom_contract_status") or mirror.get("contract_type") != contract.get("custom_contract_type")):
        # A non-locking Contract read may use an older MVCC snapshot. The RFQ
        # gate's current locked mirror must agree before granting continuation.
        _fail("The linked CLM lifecycle changed. Refresh its execution state before procurement.")


def _validate_execution(contract):
    data = _object(contract.get("custom_clm_data"), "Contract lifecycle data")
    signatures = data.get("signatures", [])
    approvals = data.get("approvals", [])
    if contract.get("docstatus") == 2 or contract.get("custom_contract_status") not in ("Executed", "Active") or contract.get("custom_esign_status") != "Completed" or not contract.get("custom_final_version_locked") or not contract.get("custom_executed_contract"):
        _fail("The linked CLM must be Executed before the existing procurement/PO flow can continue.")
    if not data.get("locked_hash") or not approvals or any(row.get("status") != "Approved" for row in approvals) or len(signatures) != 2 or {row.get("party") for row in signatures} != {"supplier", "inteva"} or any(not row.get("file_id") or not row.get("hash") or not row.get("by") or not row.get("at") or not _text(row.get("file_url")).startswith("/private/files/") or row.get("version") != contract.get("custom_current_version") for row in signatures):
        _fail("The linked CLM must retain all approvals and both signatures on its executed version.")
    if len(approvals) != 2:
        _fail("The RFQ Contract requires exactly its Legal and Finance approvals before procurement.")
    _require_approval(approvals, "legal", "Approved")
    finance = _require_approval(approvals, "finance", "Approved")
    workflow = data.get("rfq_workflow")
    if workflow is not None and (not isinstance(workflow, dict) or workflow.get("version") != 1 or workflow.get("phase") not in {"procurement", "completed"}):
        _fail("The RFQ Contract must complete its sequential Finance approval before procurement.")
    _validate_signed_version(contract, data)
    company_signature = next(row for row in signatures if row["party"] == "inteva")
    if _moment(finance.get("at"), "Finance approval") < _moment(company_signature.get("at"), "Legal company signature"):
        _fail("Finance approval must follow Legal review and both signatures.")
    if workflow and workflow.get("phase") == "completed":
        _validate_procurement_completion(contract, data)


def _moment(value, label):
    try:
        parsed = datetime.fromisoformat(_text(value).replace("Z", "+00:00"))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)
    except (TypeError, ValueError):
        _fail(f"The RFQ Contract must retain the {label} timestamp.")


def _require_approval(approvals, role, status):
    rows = [row for row in approvals if row.get("role") == role]
    if len(rows) != 1 or rows[0].get("status") != status or rows[0].get("stage") != (0 if role == "legal" else 1):
        _fail(f"The RFQ Contract must retain one {role.title()} Manager approval with status {status}.")
    if status != "Pending" and (not _text(rows[0].get("by")) or not rows[0].get("at")):
        _fail(f"The RFQ Contract must retain its {role.title()} Manager decision actor and timestamp.")
    return rows[0]


def _legal_signer(contract, signature):
    signer = _text(contract.get("custom_inteva_signatory"))
    if not signer or signer.casefold() != _text(signature.get("by")).casefold():
        _fail("The RFQ Contract company signature must belong to its designated Legal Manager.")
    if signature.get("role") is not None and signature["role"] != "legal":
        _fail("The RFQ Contract company signature must retain its authenticated Legal Manager role.")
    # A persisted receipt was checked when written through the gateway. A later
    # role change does not rewrite or invalidate the signer's historical act.
    previous = contract.get_doc_before_save()
    if previous is None and contract.get("name") and frappe.db.exists("Contract", contract.name):
        # A gate read has no before-save snapshot; compare the persisted receipt.
        previous = frappe.get_doc("Contract", contract.name)
    old_data = _object(previous.get("custom_clm_data"), "Contract lifecycle data") if previous else {}
    saved = next((row for row in old_data.get("signatures", []) if row.get("party") == "inteva"), None)
    if signature.get("role") == "legal" and saved == signature:
        return
    _require_legal_user(signer)


def _require_legal_user(signer):
    if not frappe.db.exists("User", signer):
        _fail("The RFQ Contract company signatory must be its designated Legal Manager.")
    user = frappe.get_doc("User", signer)
    roles = {_text(row.get("role")).casefold() for row in _rows(user, "roles")}
    # Match the gateway's canonical role precedence: admin is not Legal.
    if user.get("enabled") != 1 or signer.casefold() == "administrator" or _text(user.get("email")).casefold() == "administrator@example.com" or roles & {"administrator", "system", "finance admin"} or not roles & {"legal manager", "legal reviewer", "legal user"}:
        _fail("The designated RFQ Contract company signer must be an enabled Legal Manager user.")


def _validate_signed_version(contract, data):
    signatures = data.get("signatures", [])
    legal = _require_approval(data.get("approvals", []), "legal", "Approved")
    if contract.get("custom_esign_status") != "Completed" or not contract.get("custom_final_version_locked") or not data.get("locked_hash") or len(signatures) != 2 or {row.get("party") for row in signatures} != {"supplier", "inteva"} or any(not row.get("by") or not row.get("at") or row.get("version") != contract.get("custom_current_version") for row in signatures):
        _fail("Finance review requires the approved locked version and both signatures.")
    supplier_signature = next(row for row in signatures if row["party"] == "supplier")
    company_signature = next(row for row in signatures if row["party"] == "inteva")
    _legal_signer(contract, company_signature)
    if not _moment(legal.get("at"), "Legal approval") <= _moment(supplier_signature.get("at"), "supplier signature") <= _moment(company_signature.get("at"), "Legal company signature"):
        _fail("RFQ Contract signatures must follow Legal approval, supplier signature, then Legal company signature.")
    current = next((row for row in data.get("versions", []) if row.get("id") == data.get("version")), None)
    if not current or current.get("number") != contract.get("custom_current_version") or not current.get("hash") or not isinstance(current.get("content"), dict):
        _fail("The linked CLM must retain its approved current version.")
    content = _contract_snapshot(contract)
    if current["content"] != content or current["hash"] != _digest(content) or data["locked_hash"] != _digest({"content": content, "clause_ids": data.get("clause_ids") or [], "non_standard_clause": data.get("non_standard_clause") is True}):
        _fail("The linked CLM content changed after approval. Repeat its review before procurement.")
    locked = data.get("locked_file")
    if not isinstance(locked, dict):
        _fail("The executed Contract must retain its locked approved PDF.")
    for evidence in [locked, *signatures]:
        _verify_contract_pdf(contract, evidence)
    company_signature = next(row for row in signatures if row["party"] == "inteva")
    if contract.custom_executed_contract != company_signature["file_url"] or len({row["file_id"] for row in signatures}) != 2:
        _fail("The executed Contract must use its final company-signed PDF and both signature receipts.")


def _validate_sequential_workflow(contract, data):
    workflow = data.get("rfq_workflow")
    # Legacy records stay readable/editable. Their procurement gate still
    # requires both approvals and signature evidence in _validate_execution.
    if workflow is None:
        return
    if not isinstance(workflow, dict) or workflow.get("version") != 1:
        _fail("The RFQ Contract sequential workflow policy is invalid.")
    phase, status = workflow.get("phase"), contract.get("custom_contract_status")
    approvals, signatures = data.get("approvals", []), data.get("signatures", [])
    phases = {"draft": {"Draft"}, "legal_review": {"Pending Legal", "Under Review"}, "signature": {"Approved", "Pending Signature"}, "finance_review": {"Pending Finance"}, "procurement": {"Executed", "Active", "Expired", "Terminated", "Closed"}, "completed": {"Executed", "Active", "Expired", "Terminated", "Closed"}, "rejected": {"Rejected"}}
    if phase not in phases or status not in phases[phase]:
        _fail("The RFQ Contract status must match its active sequential workflow stage.")
    if data.get("procurement_completion") and phase != "completed" and not data.get("termination"):
        _fail("The completed RFQ procurement phase cannot be reset or hidden.")
    if any(row.get("role") not in {"legal", "finance"} or row.get("status") not in {"Pending", "Approved", "Rejected", "Sent Back"} for row in approvals):
        _fail("The RFQ Contract may use only its sequential Legal and Finance approval rows.")
    if data.get("termination"):
        if phase != "legal_review" or status != "Under Review" or len(approvals) != 1:
            _fail("RFQ Contract termination requires its separate Legal review.")
        _require_approval(approvals, "legal", "Pending")
        prior = data.get("prior_approvals", [])
        if len(prior) != 2:
            _fail("RFQ Contract termination must retain its completed execution approvals.")
        _require_approval(prior, "legal", "Approved")
        _require_approval(prior, "finance", "Approved")
        _validate_signed_version(contract, {**data, "approvals": prior})
        return
    if phase == "draft":
        if signatures or any(row.get("status") == "Pending" for row in approvals):
            _fail("An RFQ Contract Draft must archive prior review evidence before correction; no reviewer is active.")
    elif phase == "legal_review":
        if len(approvals) != 1 or signatures:
            _fail("Only Legal review may be active before signature; Finance must wait.")
        _require_approval(approvals, "legal", "Pending")
    elif phase == "signature":
        _require_approval(approvals, "legal", "Approved")
        if len(approvals) != 1 or len(signatures) > 1 or signatures and signatures[0].get("party") != "supplier":
            _fail("Finance review starts only after the Legal company signature completes.")
    elif phase == "finance_review":
        if len(approvals) != 2:
            _fail("Finance review must follow the completed Legal approval.")
        _require_approval(approvals, "finance", "Pending")
        _validate_signed_version(contract, data)
    elif phase in {"procurement", "completed"}:
        _require_approval(approvals, "legal", "Approved")
        _require_approval(approvals, "finance", "Approved")
        if phase == "completed":
            _validate_procurement_completion(contract, data)
    elif phase == "rejected":
        rejected = [row for row in approvals if row.get("status") == "Rejected"]
        if len(rejected) != 1 or any(row.get("status") == "Pending" for row in approvals):
            _fail("A rejected RFQ Contract must retain its rejection decision and stop all pending reviews.")
        _require_approval(approvals, rejected[0]["role"], "Rejected")
        if rejected[0]["role"] == "finance":
            _validate_signed_version(contract, data)


def _validate_procurement_completion(contract, data):
    receipt = data.get("procurement_completion")
    if not isinstance(receipt, dict) or not _text(receipt.get("purchase_order")) or not _text(receipt.get("by")) or receipt.get("role") != "procurement_team" or not isinstance(receipt.get("comment"), str):
        _fail("RFQ Contract completion requires the Procurement Team's persisted Purchase Order receipt.")
    rfq = frappe.get_doc(RFQ, contract.custom_rfq)
    decision = _decision(rfq) or _legacy_contract_decision(rfq)
    if not decision or decision.get("decision") != "Yes":
        _fail("Procurement completion requires its saved Yes RFQ contract decision.")
    expected = {"rfq": rfq.name, "award": decision.get("award") or decision.get("legal_review") or decision.get("quotation"), "quotation": contract.get("custom_supplier_quotation"), "supplier": contract.get("custom_supplier")}
    if any(receipt.get(key) != value for key, value in expected.items()):
        _fail("The procurement completion receipt must preserve its exact RFQ award, quotation and supplier.")
    if decision.get("contract") and decision["contract"] != contract.name or decision.get("quotation") != expected["quotation"] or decision.get("supplier") != expected["supplier"]:
        _fail("The procurement completion must belong to the RFQ's saved Contract and award decision.")
    quotation = frappe.get_doc("Supplier Quotation", expected["quotation"])
    if quotation.get("docstatus") != 1 or quotation.get("supplier") != expected["supplier"] or rfq.name not in _rfqs_from_quotation(quotation):
        _fail("Procurement completion requires the submitted winning quotation linked to this RFQ.")
    finance = _require_approval(data.get("approvals", []), "finance", "Approved")
    if _moment(receipt.get("at"), "procurement completion") < _moment(finance.get("at"), "Finance approval"):
        _fail("Procurement finalization must follow Finance approval.")
    for action in ("procurement_finalized", "completed"):
        if not any(row.get("action") == action and row.get("by") == receipt["by"] and row.get("role") == "procurement_team" and row.get("at") == receipt.get("at") and row.get("reference_id") == contract.name for row in data.get("audit", [])):
            _fail("Procurement completion must retain its finalization and completion audit events.")
    name = receipt["purchase_order"]
    if not frappe.db.exists("Purchase Order", name):
        _fail("The procurement completion Purchase Order does not exist.")
    po = frappe.get_doc("Purchase Order", name)
    items = _rows(po, "items")
    if po.get("docstatus") != 1 or _text(po.get("status")).lower() in {"cancelled", "canceled", "stopped", "rejected"} or po.get("supplier") != expected["supplier"] or po.get("company") != rfq.get("company") or po.get("currency") != contract.get("custom_currency") or not items or any(row.get("supplier_quotation") != expected["quotation"] for row in items):
        _fail("Procurement completion requires a submitted Purchase Order for this RFQ's supplier, company, currency and winning quotation.")
    references = {_text(row.get(field)) for row in [po, *items] for field in ("request_for_quotation", "rfq", "rfq_name", "custom_rfq", "custom_rfq_reference") if _text(row.get(field))}
    if references - {rfq.name}:
        _fail("The completion Purchase Order references another RFQ.")


def _verify_contract_pdf(contract, evidence):
    name = evidence.get("file_id")
    if not name or not frappe.db.exists("File", name):
        _fail("The executed Contract signature or locked PDF File is missing.")
    file = frappe.get_doc("File", name)
    url = _text(file.get("file_url"))
    if file.get("is_private") != 1 or file.get("is_folder") or file.get("attached_to_doctype") != "Contract" or file.get("attached_to_name") != contract.name or not url.startswith("/private/files/") or url != evidence.get("file_url"):
        _fail("The executed Contract evidence must be a private File attached to this Contract.")
    content = file.get_content()
    if isinstance(content, str):
        content = content.encode("utf-8")
    if not isinstance(content, bytes) or not content.startswith(b"%PDF-") or hashlib.sha256(content).hexdigest() != evidence.get("hash"):
        _fail("The executed Contract PDF bytes do not match their saved signing evidence.")


def guard_purchase_order(doc, method=None):
    if doc.get("docstatus") == 2:
        return
    previous = doc.get_doc_before_save()
    references = {}
    explicit = set()
    original_rfqs = set()
    for candidate in ([previous, doc] if previous else [doc]):
        for row in [candidate, *_rows(candidate, "items")]:
            explicit.update(_text(row.get(key)) for key in ("request_for_quotation", "rfq", "rfq_name", "custom_rfq_reference") if _text(row.get(key)))
        for quotation_name in {_text(row.get("supplier_quotation")) for row in _rows(candidate, "items")} - {""}:
            quotation = frappe.get_doc("Supplier Quotation", quotation_name)
            for name in _rfqs_from_quotation(quotation):
                if candidate is previous:
                    original_rfqs.add(name)
                if quotation.get("supplier") != doc.get("supplier"):
                    _fail("The RFQ Purchase Order must preserve its awarded supplier.")
                references.setdefault(name, set()).add(quotation.name)
    if explicit - references.keys():
        _fail("The RFQ Purchase Order must retain its selected Supplier Quotation links.")
    if references and any(not row.get("supplier_quotation") for row in _rows(doc, "items")):
        _fail("Every RFQ Purchase Order item must retain its selected quotation link.")
    for name, quotations in references.items():
        rfq = frappe.get_doc(RFQ, name, for_update=True)
        decision = _decision(rfq) or _legacy_contract_decision(rfq)
        # Preserve historical already-created PO edits that never chose CLM.
        if previous and name in original_rfqs and _historical_no_clm(rfq):
            continue
        _assert_contract_executed(rfq, decision)
        current_quotations = {_text(row.get("supplier_quotation")) for row in _rows(doc, "items")}
        if decision["quotation"] not in quotations or len(quotations) != 1 or decision["quotation"] not in current_quotations:
            _fail("The Purchase Order must retain the quotation from this RFQ's contract decision.")
