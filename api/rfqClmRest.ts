import { randomUUID } from "node:crypto";
import { applyClmAction, clmStatus, ClmError, parseClmData, type ClmDeps } from "./clmCore.js";
import type { RfqClmTransaction } from "./rfqClmCore.js";
import type { AccessPrincipal } from "./rbacAuth.js";
import type { ClmField, ClmRecord } from "../src/types/clm.js";
import { validateRfqContractDetails } from "../src/utils/rfqContractContext.js";
import { syncRfqClmRestContract } from "./rfqClmRestSync.js";
import { isInitialRfqRequestPersistence } from "./clmRequestValidation.js";
import { persistedRfqAwardValue } from "./rfqAwardValue.js";

type Deps = ClmDeps & { fields(doctype: string): Promise<ClmField[]> };
const RFQ = "Request for Quotation", REQUEST = "Contract Request";
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
export function rfqRestData(value: unknown): ClmRecord {
  if (value == null || value === "") return {};
  if (typeof value === "string") { try { value = JSON.parse(value); } catch { throw new ClmError("The saved RFQ CLM persistence state is invalid.", 409); } }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ClmError("The saved RFQ CLM persistence state is invalid.", 409);
  return structuredClone(value) as ClmRecord;
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const conflict = (error: unknown) => error instanceof ClmError && error.status === 409;

/** Each save uses Frappe's modified check. Never overwrite concurrent source changes. */
export async function updateRfqClmRecord(deps: ClmDeps, dt: string, name: string, change: (record: ClmRecord) => ClmRecord | undefined): Promise<ClmRecord> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await deps.load(dt, name), next = change(current);
    if (!next) return current;
    try {
      await deps.save(dt, next);
      const saved = await deps.load(dt, name);
      for (const key of Object.keys(next)) {
        if (["modified", "modified_by", "creation", "owner", "__onload"].includes(key) || equal(next[key], current[key])) continue;
        if (!equal(saved[key], next[key])) throw new ClmError(`ERPNext did not persist the ${dt} ${key} field. Refresh the saved record before retrying.`, 409);
      }
      return saved;
    } catch (error) { if (!conflict(error) || attempt === 3) throw error; }
  }
  throw new ClmError("The CLM records changed. Refresh before retrying.", 409);
}
const update = updateRfqClmRecord;
async function one(deps: Deps, dt: string, field: string, value: unknown): Promise<ClmRecord | undefined> {
  const records = await deps.list(dt, [[field, "=", value]]);
  if (records.length > 1) throw new ClmError(`Multiple ${dt} records reference this RFQ award. Reconcile the existing links.`, 409);
  return records.length ? deps.load(dt, text(records[0].name)) : undefined;
}
function sameAward(saved: ClmRecord, input: RfqClmTransaction) {
  if (saved.decision !== input.decision || saved.quotation !== input.award.quotation || saved.award !== input.award.award || saved.supplier !== input.award.supplier) throw new ClmError("A different CLM decision or award is already saved for this RFQ. Refresh its source before continuing.", 409);
}
async function validateAward(input: RfqClmTransaction, deps: Deps): Promise<void> {
  const [rfq, quotation] = await Promise.all([deps.load(RFQ, input.rfq), deps.load("Supplier Quotation", text(input.award.quotation))]);
  if (rfq.contract_required !== input.decision) throw new ClmError("The award handoff must preserve the RFQ's saved Contract Required choice.", 409);
  const items = Array.isArray(quotation.items) ? quotation.items as ClmRecord[] : [];
  if (rfq.name !== input.rfq || Number(rfq.docstatus) === 2 || Number(quotation.docstatus) !== 1 || quotation.supplier !== input.award.supplier || ![quotation, ...items].some(row => row.request_for_quotation === input.rfq) || quotation.currency !== input.award.currency || quotation.modified !== input.award.quotation_modified) throw new ClmError("The winning quotation changed or does not belong to this RFQ award. Refresh before continuing.", 409);
  if (input.award.legal_review) {
    const award = await deps.load("Legal Document Review", text(input.award.legal_review));
    if (award.name !== input.award.award || award.rfq_name !== input.rfq || award.sq_name !== quotation.name || award.modified !== input.award.legal_review_modified || Number(award.docstatus) === 2) throw new ClmError("The saved supplier award changed or belongs to another RFQ. Refresh before continuing.", 409);
    const finalValue = persistedRfqAwardValue(award, quotation);
    if (Number(input.award.amount) !== finalValue.amount || input.award.currency !== finalValue.currency) throw new ClmError("Preserve the persisted final supplier award value and currency.", 409);
  }
}
function requestSource(request: ClmRecord, input: RfqClmTransaction) {
  const data = parseClmData(request.custom_clm_data), source = rfqRestData(data.rfq_source);
  if (request.custom_rfq !== input.rfq || request.custom_supplier_quotation !== input.award.quotation || request.supplier !== input.award.supplier || source.rfq !== input.rfq || source.award !== input.award.award || source.quotation !== input.award.quotation || source.contract_required !== true) throw new ClmError("The existing Contract Request does not match the RFQ award.", 409);
  if (Number(request.contract_value) !== Number(input.award.amount) || request.currency !== input.award.currency || Number(source.amount) !== Number(input.award.amount) || source.currency !== input.award.currency) throw new ClmError("The Contract Request must preserve the persisted final award value and currency.", 409);
  const intake = !input.create_contract && (data.rfq_source as ClmRecord)?.stage === "rfq_awarded" && isInitialRfqRequestPersistence(request);
  if (!intake && Object.keys(validateRfqContractDetails(request)).length || !Array.isArray(data.source_documents)) throw new ClmError("ERPNext did not persist the required Contract Request terms or supporting-document evidence.", 409);
  return data;
}
function pendingState(request: ClmRecord): ClmRecord {
  return { contract_required: "Yes", request: request.name, status: "Pending", current_stage: "Procurement", assigned_role: "procurement_team", blocked: true };
}
async function requireUnique(deps: Deps, dt: string, field: string) {
  if (Number((await deps.fields(dt)).find(row => row.fieldname === field)?.unique) !== 1) throw new ClmError(`Enable the unique constraint on the existing ${dt}.${field} field before creating this record. No custom Frappe app is required.`, 503);
}
function verifyInserted(dt: string, record: ClmRecord, payload: ClmRecord) {
  for (const [key, expected] of Object.entries(payload)) {
    if (expected === undefined || ["doctype", "name", "modified"].includes(key)) continue;
    if (typeof expected === "number" ? Number(record[key]) !== expected : !equal(record[key], expected)) throw new ClmError(`ERPNext did not persist the ${dt} ${key} field. Inspect the saved record before retrying.`, 409);
  }
}
/** Retain the original insert intent until read-back succeeds, including across retries. */
async function verifyPendingInsert(input: RfqClmTransaction, deps: Deps): Promise<void> {
  const rfq = await deps.load(RFQ, input.rfq);
  const operation = rfqRestData(rfqRestData(rfq.custom_approval_data).clm_rest_operation);
  if (!operation.pending_insert) return;
  const pending = rfqRestData(operation.pending_insert), dt = text(pending.doctype);
  if (![REQUEST, "Contract"].includes(dt) || pending.field !== (dt === REQUEST ? "custom_rfq" : "custom_contract_request")) throw new ClmError("The saved CLM insert recovery evidence is invalid.", 409);
  const record = await one(deps, dt, text(pending.field), pending.value);
  if (!record) return;
  verifyInserted(dt, record, rfqRestData(pending.payload));
  await update(deps, RFQ, input.rfq, current => {
    const data = rfqRestData(current.custom_approval_data), saved = rfqRestData(data.clm_rest_operation);
    sameAward(saved, input);
    if (!saved.pending_insert) return undefined;
    if (!equal(saved.pending_insert, pending)) throw new ClmError("The saved CLM insert changed during verification.", 409);
    saved.verified_inserts = { ...rfqRestData(saved.verified_inserts), [dt]: record.name };
    delete saved.pending_insert;
    data.clm_rest_operation = saved;
    return { ...current, custom_approval_data: JSON.stringify(data) };
  });
}
async function insertOnce(input: RfqClmTransaction, deps: Deps, dt: string, field: string, value: unknown, payload: ClmRecord): Promise<{ record: ClmRecord; created: boolean }> {
  await requireUnique(deps, dt, field);
  const existing = await one(deps, dt, field, value);
  if (existing) { await verifyPendingInsert(input, deps); return { record: existing, created: false }; }
  const reserved = await update(deps, RFQ, input.rfq, current => {
    const data = rfqRestData(current.custom_approval_data), operation = rfqRestData(data.clm_rest_operation);
    sameAward(operation, input);
    // Verification is monotonic: a delayed double-click cannot reserve the same
    // insert again after its winner has already advanced to a later stage.
    if (rfqRestData(operation.verified_inserts)[dt] || operation.phase === "complete") return undefined;
    if (operation.pending_insert) return undefined;
    operation.pending_insert = { doctype: dt, field, value, payload };
    data.clm_rest_operation = operation;
    return { ...current, custom_approval_data: JSON.stringify(data) };
  });
  const operation = rfqRestData(rfqRestData(reserved.custom_approval_data).clm_rest_operation);
  const verified = rfqRestData(operation.verified_inserts)[dt];
  if (verified || operation.phase === "complete") {
    const winner = await one(deps, dt, field, value);
    if (!winner || verified && winner.name !== verified) throw new ClmError("The verified CLM record is missing or has a different source link.", 409);
    return { record: winner, created: false };
  }
  const pending = rfqRestData(operation.pending_insert);
  if (pending.doctype !== dt || pending.field !== field || pending.value !== value) throw new ClmError("Resume the existing CLM insert before creating another record.", 409);
  const intended = rfqRestData(pending.payload);
  let record: ClmRecord, created = true;
  try {
    const result = await deps.create(dt, intended);
    if (!result.name) throw new ClmError(`ERPNext did not return the saved ${dt}. Refresh before retrying.`, 502);
    record = await deps.load(dt, text(result.name));
  } catch (error) {
    // Both a uniqueness race and a lost HTTP response can leave a real record.
    // Never delete it or issue an unguarded second insert.
    const recovered = await one(deps, dt, field, value);
    if (!recovered) throw error;
    record = recovered; created = false;
  }
  // Validation failures must never enter the lost-response recovery branch.
  verifyInserted(dt, record, intended);
  await verifyPendingInsert(input, deps);
  return { record, created };
}
async function mirrorDecision(input: RfqClmTransaction, deps: Deps, request?: ClmRecord, contract?: ClmRecord) {
  const rfq = await update(deps, RFQ, input.rfq, current => {
    if (current.contract_required !== input.decision) throw new ClmError("The RFQ Contract Required choice changed during its award handoff. Refresh before retrying.", 409);
    const data = rfqRestData(current.custom_approval_data), prior = data.contract_decision ? rfqRestData(data.contract_decision) : undefined;
    const operation = rfqRestData(data.clm_rest_operation);
    sameAward(operation, input);
    if (operation.pending_insert) throw new ClmError("The CLM insert has not passed ERPNext read-back verification.", 409);
    if (prior) sameAward(prior, input);
    if (prior?.request && prior.request !== request?.name || prior?.contract && prior.contract !== contract?.name) throw new ClmError("The RFQ already links a different CLM record.", 409);
    const decision: ClmRecord = { ...input.award, decision: input.decision, by: operation.by, at: operation.at, ...prior,
      ...(request ? { request: request.name } : {}), ...(contract ? { contract: contract.name } : {}),
      clm: contract ? prior?.clm || pendingState(request!) : request ? pendingState(request) : { contract_required: "No", status: "Not Required", blocked: false } };
    data.contract_decision = decision;
    const next = { ...current, contract_required: input.decision, custom_approval_data: JSON.stringify(data) };
    return current.contract_required === input.decision && equal(rfqRestData(current.custom_approval_data), data) ? undefined : next;
  });
  if (input.award.legal_review) {
    await update(deps, "Legal Document Review", text(input.award.legal_review), award => {
      if (award.rfq_name !== input.rfq || award.sq_name !== input.award.quotation) throw new ClmError("The award source changed while saving its CLM link.", 409);
      const decision = rfqRestData(rfqRestData(rfq.custom_approval_data).contract_decision);
      const state = { ...rfqRestData(decision.clm), rfq: input.rfq, award: input.award.award, ...(request ? { request: request.name } : {}), ...(contract ? { contract: contract.name } : {}) };
      return equal(rfqRestData(award.custom_clm_state), state) ? undefined : { ...award, custom_clm_state: JSON.stringify(state) };
    });
  }
}
async function finish(input: RfqClmTransaction, deps: Deps) {
  await update(deps, RFQ, input.rfq, rfq => {
    const data = rfqRestData(rfq.custom_approval_data), operation = rfqRestData(data.clm_rest_operation);
    sameAward(operation, input);
    if (operation.pending_insert) throw new ClmError("The CLM insert has not passed ERPNext read-back verification.", 409);
    if (operation.phase === "complete") return undefined;
    data.clm_rest_operation = { ...operation, phase: "complete" };
    return { ...rfq, custom_approval_data: JSON.stringify(data) };
  });
}

/** Recoverable document writes, not a fictitious cross-document ERP transaction. */
export async function persistRfqClmDecision(input: RfqClmTransaction, deps: Deps): Promise<{ created: boolean; request?: ClmRecord; contract?: ClmRecord }> {
  if (!["procurement", "procurement_team"].includes(input.actor.role) || !text(input.actor.id)) throw new ClmError("Only Procurement Manager or Procurement Team may submit or create RFQ CLM.", 403);
  if (!["Yes", "No"].includes(input.decision) || input.decision === "No" && (input.create_contract || input.request_document)) throw new ClmError("Choose a valid RFQ Contract decision.", 422);
  await validateAward(input, deps);
  if (input.contract_fields && (Object.hasOwn(input.contract_fields, "custom_contract_value") && String(input.contract_fields.custom_contract_value) !== String(input.award.amount) || Object.hasOwn(input.contract_fields, "custom_currency") && input.contract_fields.custom_currency !== input.award.currency)) throw new ClmError("Contract value and currency must match the persisted final supplier award.", 403);
  let request = await one(deps, REQUEST, "custom_rfq", input.rfq);
  if (input.decision === "No" && request && ["Draft", "Cancelled"].includes(String(request.request_status)) && (parseClmData(request.custom_clm_data).rfq_request_workflow as ClmRecord | undefined)?.phase === "awaiting_supplier_award") request = undefined;
  if (input.create_contract && !request) throw new ClmError("Submit the CLM request to Procurement Team before creating its Contract.", 409);
  if (request) requestSource(request, input);
  if (input.decision === "No" && (request || await one(deps, "Contract", "custom_rfq", input.rfq))) throw new ClmError("An existing CLM record prevents a No Contract decision.", 409);
  await update(deps, RFQ, input.rfq, rfq => {
    const data = rfqRestData(rfq.custom_approval_data);
    if (rfq.contract_required !== input.decision) throw new ClmError("The award handoff must preserve the RFQ's saved Contract Required choice.", 409);
    if (data.contract_decision) sameAward(rfqRestData(data.contract_decision), input);
    if (data.clm_rest_operation) {
      const operation = rfqRestData(data.clm_rest_operation); sameAward(operation, input);
      if (input.create_contract && operation.phase === "complete" && operation.operation !== "create_contract") {
        data.clm_rest_operation = { ...operation, operation: "create_contract", phase: "saving" };
        return { ...rfq, custom_approval_data: JSON.stringify(data) };
      }
      return undefined;
    }
    if (rfq.modified !== input.expected_modified) throw new ClmError("The RFQ changed. Refresh its award before submitting CLM.", 409);
    if (input.decision === "Yes" && rfq.contract_required !== "Yes") throw new ClmError("Contract Required must be Yes before submitting the CLM request.", 409);
    data.clm_rest_operation = { version: 1, operation: input.create_contract ? "create_contract" : "request", phase: "saving", decision: input.decision, quotation: input.award.quotation, award: input.award.award, supplier: input.award.supplier, by: input.actor.id, at: deps.now() };
    return { ...rfq, custom_approval_data: JSON.stringify(data) };
  });
  await verifyPendingInsert(input, deps);
  if (input.decision === "No") { await mirrorDecision(input, deps); await finish(input, deps); return { created: false }; }
  let created = false;
  if (!request) {
    if (!input.request_document) throw new ClmError("The validated CLM request document is required.", 422);
    requestSource(input.request_document, input);
    const inserted = await insertOnce(input, deps, REQUEST, "custom_rfq", input.rfq, input.request_document);
    request = inserted.record; created = inserted.created;
  } else if (input.request_document && !parseClmData(request.custom_clm_data).rfq_request_workflow) {
    request = await update(deps, REQUEST, text(request.name), current => ({ ...current, custom_clm_data: input.request_document!.custom_clm_data }));
  }
  requestSource(request, input);
  if (!input.create_contract) {
    // Use the installed Request workflow, with Team assignment in persisted data.
    if (request.request_status === "Draft") request = await update(deps, REQUEST, text(request.name), current => current.request_status === "Draft" ? { ...current, request_status: "Pending Review" } : undefined);
    await mirrorDecision(input, deps, request);
    await finish(input, deps);
    return { created, request: await deps.load(REQUEST, text(request.name)) };
  }
  // The second user action creates the standard ERPNext Contract, never at Yes.
  if (request.request_status === "Draft") request = await update(deps, REQUEST, text(request.name), current => current.request_status === "Draft" ? { ...current, request_status: "Pending Review" } : undefined);
  if (request.request_status === "Pending Review") request = await update(deps, REQUEST, text(request.name), current => current.request_status === "Pending Review" ? { ...current, request_status: "Approved" } : undefined);
  const requestName = text(request.name), source = requestSource(request, input);
  let contract = await one(deps, "Contract", "custom_contract_request", requestName);
  if (!contract) {
    const mapping: Record<string, string> = { custom_contract_title: "contract_purpose", custom_contract_type: "contract_type", contract_terms: "description", start_date: "contract_start_date", end_date: "contract_end_date", custom_contract_value: "contract_value", custom_currency: "currency", custom_payment_terms_description: "payment_terms", custom_renewal_notice_days: "notice_period_days", custom_auto_renewal: "auto_renewal" };
    const payload: ClmRecord = { party_type: "Supplier", party_name: request.supplier, custom_supplier: request.supplier, custom_contract_request: requestName, custom_contract_status: "Draft", custom_approval_status: "Pending", custom_esign_status: "Not Started", custom_legal_review_required: 1, ...input.contract_fields };
    for (const [target, field] of Object.entries(mapping)) if (request[field] != null) payload[target] = request[field];
    for (const field of ["custom_rfq", "custom_supplier_quotation", "custom_purchase_order", "custom_project", "custom_business_unit"]) if (request[field]) payload[field] = request[field];
    const data = parseClmData(null);
    data.persistence = "erpnext_rest_v1";
    data.rfq_source = source.rfq_source; data.source_documents = source.source_documents;
    data.rfq_workflow = { version: 1, phase: "draft" };
    data.rfq_context = { rfq_id: input.rfq, award_id: input.award.award, supplier_id: request.supplier, quotation_id: request.custom_supplier_quotation, contract_type: request.contract_type, contract_status: "Draft", contract_required: "Yes" };
    data.audit.push({ id: randomUUID(), action: "create_from_rfq_award", by: input.actor.id, role: input.actor.role, at: deps.now(), previous_status: "", new_status: "Draft", comment: `Created from ${input.rfq}`, reference_id: input.rfq });
    payload.custom_clm_data = JSON.stringify(data);
    const inserted = await insertOnce(input, deps, "Contract", "custom_contract_request", requestName, payload);
    contract = inserted.record; created = inserted.created;
  }
  if (contract.custom_rfq !== input.rfq || contract.custom_contract_request !== requestName || contract.custom_supplier_quotation !== input.award.quotation || contract.custom_supplier !== input.award.supplier) throw new ClmError("The saved Contract does not match the RFQ award.", 409);
  if (Number(contract.custom_contract_value) !== Number(input.award.amount) || contract.custom_currency !== input.award.currency) throw new ClmError("The saved Contract value or currency differs from the persisted final supplier award.", 409);
  request = await update(deps, REQUEST, requestName, current => {
    const data = requestSource(current, input);
    if (data.contract && data.contract !== contract!.name) throw new ClmError("The Request already links another Contract.", 409);
    if (data.contract === contract!.name) return undefined;
    data.contract = contract!.name;
    return { ...current, custom_clm_data: JSON.stringify(data) };
  });
  await mirrorDecision(input, deps, request, contract);
  const principal = { typ: "internal", sub: input.actor.id, email: input.actor.id, role: input.actor.role } as AccessPrincipal;
  // Reuse the existing validation, versioning and Legal approval initializer.
  if (clmStatus("Contract", contract) === "Draft" && !parseClmData(contract.custom_clm_data).audit.some(row => row.action === "legal_review_started")) {
    contract = (await applyClmAction({ doctype: "Contract", name: text(contract.name), expected_modified: text(contract.modified), action: "save", payload: {}, comment: "Prepare the saved RFQ Contract for Legal review." }, principal, { ...deps, notify: undefined })).record;
    contract = (await applyClmAction({ doctype: "Contract", name: text(contract.name), expected_modified: text(contract.modified), action: "submit_review", comment: "Submitted to Legal Manager from RFQ award creation." }, principal, { ...deps, notify: undefined })).record;
  }
  if (!parseClmData(contract.custom_clm_data).audit.some(row => row.action === "legal_review_started")) throw new ClmError("The Contract was saved but its Legal review handoff is incomplete. Retry Create Contract from this RFQ to resume the same record.", 409);
  request = await update(deps, REQUEST, requestName, current => {
    const data = requestSource(current, input);
    if (current.request_status === "Completed" && rfqRestData(data.rfq_request_workflow).phase === "contract_created") return undefined;
    data.rfq_request_workflow = { version: 1, phase: "contract_created", assigned_role: "procurement_team" };
    for (const approval of data.approvals) if (approval.role === "procurement_team" && approval.status === "Pending") Object.assign(approval, { status: "Approved", by: input.actor.id, at: deps.now(), comment: "Procurement Team created the Contract." });
    data.audit.push({ id: randomUUID(), action: "procurement_team_processed", by: input.actor.id, role: input.actor.role, at: deps.now(), previous_status: "Pending Procurement Team", new_status: "Completed", comment: `Created Contract ${contract!.name}`, reference_id: text(contract!.name) });
    return { ...current, request_status: "Completed", custom_clm_data: JSON.stringify(data) };
  });
  await syncRfqClmRestContract(contract, deps);
  await finish(input, deps);
  return { created, request, contract: await deps.load("Contract", text(contract.name)) };
}
