import { randomUUID } from "node:crypto";
import { ClmError, parseClmData, type ClmDeps } from "./clmCore.js";
import { rfqRestData, updateRfqClmRecord } from "./rfqClmRest.js";
import type { AccessPrincipal } from "./rbacAuth.js";
import type { ClmField, ClmRecord } from "../src/types/clm.js";
import { rfqClmRequestWorkflowView } from "../src/utils/rfqClmWorkflow.js";
import { resolveAvailableRfqAward } from "./rfqClmCore.js";
import { resolveInitialRequestDepartment } from "./rfqRequestDepartment.js";
import { logRfqClmDiagnostic, rfqClmErrorDiagnostic, rfqClmRequestDiagnostic } from "./rfqClmDiagnostics.js";
import { isSubmittedRfq } from "../src/utils/rfqSubmission.js";

type Deps = ClmDeps & { fields(doctype: string): Promise<ClmField[]> };
type Award = NonNullable<Awaited<ReturnType<typeof resolveAvailableRfqAward>>>;
type Internal = AccessPrincipal & { typ: "internal" };
export type InitialRfqRequestOptions = { allowCreate?: boolean; trigger?: "award_confirmation" };
const RFQ = "Request for Quotation", REQUEST = "Contract Request";
const text = (v: unknown) => typeof v === "string" ? v.trim() : "";
const present = (v: unknown) => v !== undefined && v !== null && v !== "";
export function isInitialRfqRequest(record?: ClmRecord): boolean {
  if (!record?.custom_rfq) return false;
  const source = parseClmData(record.custom_clm_data).rfq_source as ClmRecord | undefined;
  return ["rfq_created", "rfq_awarded"].includes(String(source?.stage)) && source?.rfq === record.custom_rfq && source.contract_required === true && source.prepared !== true;
}
export function isInvalidatedPreawardRequest(record?: ClmRecord): boolean {
  if (!record || !isInitialRfqRequest(record)) return false;
  const workflow = rfqRestData(parseClmData(record.custom_clm_data).rfq_request_workflow);
  return ["Draft", "Cancelled"].includes(String(record.request_status)) && workflow.phase === "awaiting_supplier_award" && workflow.status === "Invalidated";
}
async function findRequest(rfq: string, deps: Deps): Promise<ClmRecord | undefined> {
  const rows = await deps.list(REQUEST, [["custom_rfq", "=", rfq]]);
  if (rows.length > 1) throw new ClmError("More than one Contract Request references this RFQ. Reconcile the existing records.", 409);
  return rows.length ? deps.load(REQUEST, text(rows[0].name)) : undefined;
}
function verifyInitial(record: ClmRecord, rfq: string) {
  if (record.custom_rfq !== rfq || Number(record.docstatus) === 2) throw new ClmError("The saved Contract Request does not belong to this active RFQ.", 409);
  const data = parseClmData(record.custom_clm_data);
  if (!rfqClmRequestWorkflowView(record) && !data.contract) throw new ClmError("The Contract Request's Procurement assignment was not persisted.", 409);
}
function verifyPayload(record: ClmRecord, expected: ClmRecord) {
  for (const [key, value] of Object.entries(expected)) {
    if (value === undefined || ["doctype", "name", "modified"].includes(key)) continue;
    if (value === "" && !present(record[key])) continue;
    if (typeof value === "number" ? Number(record[key]) !== value : JSON.stringify(record[key]) !== JSON.stringify(value)) throw new ClmError(`ERPNext did not persist Contract Request.${key}. Inspect the existing request before retrying.`, 409);
  }
}
function assertAwardIntent(rfq: ClmRecord, award: Award): void {
  const intent = rfqRestData(rfqRestData(rfq.custom_approval_data).clm_award_intent);
  if (!isSubmittedRfq(rfq) || rfq.contract_required !== "Yes" || !award.review?.name || intent.version !== 1 ||
      !["saving", "complete"].includes(String(intent.phase)) || intent.decision !== "Yes" ||
      intent.award !== award.source.award || intent.quotation !== award.source.quotation || intent.supplier !== award.source.supplier ||
      !text(intent.by) || !text(intent.at)) throw new ClmError("Confirm the saved supplier award with Contract Required = Yes before creating its Contract Request.", 409);
}
async function currentAward(rfqName: string, deps: Deps): Promise<{ rfq: ClmRecord; award: Award }> {
  const rfq = await deps.load(RFQ, rfqName);
  const award = isSubmittedRfq(rfq) ? await resolveAvailableRfqAward(rfq, deps) : undefined;
  if (!award?.review?.name) throw new ClmError("A real saved supplier award is required before creating a Contract Request.", 409);
  assertAwardIntent(rfq, award);
  return { rfq, award };
}
function sameAward(a: Award, b: Award): boolean {
  return ["award", "quotation", "supplier", "company", "amount", "currency"].every(field => a.source[field] === b.source[field]);
}

/** Incorrect pre-award records remain auditable and reusable; no ERP document is deleted. */
async function invalidatePreawardRequest(principal: Internal, rfq: ClmRecord, request: ClmRecord, deps: Deps): Promise<void> {
  if (!isInitialRfqRequest(request) || Number(request.docstatus || 0) !== 0 || request.custom_contract || parseClmData(request.custom_clm_data).contract) throw new ClmError("An unawarded RFQ has an advanced Contract Request. Review its existing history before continuing.", 409);
  const rfqName = text(rfq.name), state = rfqRestData(rfqRestData(rfq.custom_approval_data).clm_initial_request);
  if (state.request && state.request !== request.name) throw new ClmError("The RFQ links a different Contract Request.", 409);
  if (state.pending_document) verifyPayload(request, rfqRestData(state.pending_document));
  await updateRfqClmRecord(deps, REQUEST, text(request.name), current => {
    if (!isInitialRfqRequest(current) || Number(current.docstatus || 0) !== 0 || current.custom_contract) throw new ClmError("The Contract Request changed before its pre-award invalidation could be saved.", 409);
    if (isInvalidatedPreawardRequest(current)) return undefined;
    const data = parseClmData(current.custom_clm_data), workflow = rfqRestData(data.rfq_request_workflow);
    if (!rfqClmRequestWorkflowView(current) && workflow.phase !== "awaiting_rfq_submission") throw new ClmError("The initial Contract Request assignment must be reconciled before invalidation.", 409);
    data.rfq_request_workflow = { ...workflow, phase: "awaiting_supplier_award", status: "Invalidated", current_stage: "Awaiting Supplier Award" };
    data.audit.push({ id: randomUUID(), action: "invalidate_preaward_request", by: principal.sub, role: principal.role, at: deps.now(), previous_status: text(current.request_status), new_status: "Invalidated", comment: "Premature Contract Request invalidated because the RFQ has no saved supplier award. The existing workflow returns it to Draft; the same record may be reused only after award confirmation with Contract Required = Yes.", reference_id: rfqName });
    // The deployed Request workflow permits Pending Review -> Draft (Send Back),
    // but has no transition into its Cancelled state. Invalidation is durable workflow evidence.
    return { ...current, request_status: "Draft", custom_clm_data: JSON.stringify(data) };
  });
  await updateRfqClmRecord(deps, RFQ, rfqName, current => {
    const data = rfqRestData(current.custom_approval_data), latest = rfqRestData(data.clm_initial_request);
    if (latest.request && latest.request !== request.name) throw new ClmError("The RFQ links a different Contract Request.", 409);
    if (latest.phase === "awaiting_award" && latest.request === request.name) return undefined;
    data.clm_initial_request = { ...latest, version: 1, phase: "awaiting_award", request: request.name, pending_document: undefined, assigned_role: "procurement_team", status: "Invalidated", current_stage: "Awaiting Supplier Award" };
    return { ...current, custom_approval_data: JSON.stringify(data) };
  });
}

/** Only explicit, persisted award confirmation creates a Request; saves/submission never do. */
export async function ensureInitialRfqContractRequest(principal: AccessPrincipal, rfqName: string, deps: Deps, options: InitialRfqRequestOptions = {}): Promise<{ created: boolean; request?: ClmRecord }> {
  logRfqClmDiagnostic("routing_attempt", { rfq_id: rfqName, actor_role: principal.typ === "internal" ? principal.role : undefined });
  try {
    const result = await ensureAwardRequest(principal, rfqName, deps, options);
    logRfqClmDiagnostic("routing_result", { ...rfqClmRequestDiagnostic(result.request), rfq_id: rfqName, created: result.created });
    return result;
  } catch (error) {
    logRfqClmDiagnostic("routing_failed", { rfq_id: rfqName, ...rfqClmErrorDiagnostic(error) });
    throw error;
  }
}
async function ensureAwardRequest(principal: AccessPrincipal, rfqName: string, deps: Deps, options: InitialRfqRequestOptions): Promise<{ created: boolean; request?: ClmRecord }> {
  if (principal.typ !== "internal" || !["admin", "procurement", "procurement_team"].includes(principal.role)) throw new ClmError("Only an authorized Procurement user can route its Contract Request.", 403);
  const rfq = await deps.load(RFQ, rfqName);
  logRfqClmDiagnostic("rfq_reloaded", { rfq_id: rfq.name, contract_required: rfq.contract_required });
  if (!rfqName || rfq.name !== rfqName || Number(rfq.docstatus) === 2) throw new ClmError("An active saved RFQ is required.", 409);
  let request = await findRequest(rfqName, deps);
  const award = isSubmittedRfq(rfq) ? await resolveAvailableRfqAward(rfq, deps) : undefined;
  if (!award?.review?.name) {
    if (request) await invalidatePreawardRequest(principal, rfq, request, deps);
    return { created: false };
  }
  if (rfq.contract_required !== "Yes") {
    if (request && !isInvalidatedPreawardRequest(request)) throw new ClmError("This awarded RFQ already has an active Contract Request. Resolve its saved Contract Required decision before changing it.", 409);
    logRfqClmDiagnostic("routing_skipped", { rfq_id: rfqName, contract_required: rfq.contract_required });
    return { created: false };
  }
  const data = request ? parseClmData(request.custom_clm_data) : undefined;
  const source = data ? rfqRestData(data.rfq_source) : {};
  const existingState = rfqRestData(rfqRestData(rfq.custom_approval_data).clm_initial_request);
  if (request && !isInvalidatedPreawardRequest(request) && source.stage === "rfq_awarded" && existingState.phase === "complete") {
    if (["award", "quotation", "supplier", "company", "currency"].some(field => source[field] !== award.source[field]) || Number(source.amount) !== Number(award.source.amount) || request.supplier !== award.prefill.supplier || request.custom_supplier_quotation !== award.prefill.custom_supplier_quotation) throw new ClmError("The saved supplier award changed after the Contract Request. Reconcile its existing record before continuing.", 409);
    verifyInitial(request, rfqName);
    logRfqClmDiagnostic("request_reused", rfqClmRequestDiagnostic(request));
    return { created: false, request };
  }
  if (!options.allowCreate || options.trigger !== "award_confirmation") return { created: false };
  assertAwardIntent(rfq, award);
  const fields = await deps.fields(REQUEST);
  if (Number(fields.find(row => row.fieldname === "custom_rfq")?.unique) !== 1) throw new ClmError("Contract Request.custom_rfq must be unique to prevent duplicate requests. No Frappe app installation is required.", 503);
  if (request && !isInitialRfqRequest(request)) {
    verifyInitial(request, rfqName);
    return { created: false, request };
  }
  const actor = principal.sub, at = deps.now();
  if (!actor) throw new ClmError("The Procurement user identity is missing.", 401);
  const department = text(award.prefill.department) || await resolveInitialRequestDepartment(rfq, deps);
  const nextData = data || parseClmData(null);
  nextData.rfq_source = { ...award.source, stage: "rfq_awarded", rfq: rfqName, contract_required: true, company: rfq.company, prepared: false, available_award: award.source };
  nextData.rfq_request_workflow = { version: 1, phase: "procurement_team", assigned_role: "procurement_team", status: "Pending", current_stage: "Procurement" };
  nextData.approvals = [{ id: text(nextData.approvals[0]?.id) || randomUUID(), role: "procurement_team", stage: 0, rule: "RFQ Contract Request: Procurement preparation", status: "Pending" }];
  nextData.source_documents = award.documents;
  if (!present(award.prefill.estimated_contract_value)) {
    const draft = rfqRestData(nextData.rfq_request_draft), values = rfqRestData(draft.values);
    nextData.rfq_request_draft = { version: 1, by: actor, role: principal.role, at, ...draft, values: { estimated_contract_value: "", ...values } };
  }
  if (!request) nextData.audit.push({ id: randomUUID(), action: "create", by: actor, role: principal.role, at, previous_status: "", new_status: "Pending", comment: `Contract Request from awarded RFQ ${rfqName}.`, reference_id: rfqName });
  nextData.audit.push({ id: randomUUID(), action: "procurement_team_assigned", by: actor, role: principal.role, at, previous_status: request ? text(request.request_status) : "Draft", new_status: "Pending", comment: "Assigned to Procurement after saved supplier award confirmation with Contract Required = Yes.", reference_id: text(award.source.award) });
  const payload: ClmRecord = { ...(request || {}), requester: request?.requester || actor, request_date: request?.request_date || at.slice(0, 10), company: rfq.company, contract_purpose: request?.contract_purpose || award.prefill.contract_purpose, description: request?.description || award.prefill.description, custom_rfq: rfqName, contract_type: request?.contract_type || "", contract_start_date: request?.contract_start_date || "", contract_end_date: request?.contract_end_date || "", department, request_status: "Draft", approval_status: "Pending", legal_review_required: 1, custom_clm_data: JSON.stringify(nextData) };
  for (const field of ["supplier", "custom_supplier_quotation", "contract_value", "currency"]) payload[field] = award.prefill[field];
  // ERP Currency fields normalize empty to zero; explicit draft evidence above preserves “not provided” in the app.
  payload.estimated_contract_value = present(award.prefill.estimated_contract_value) ? award.prefill.estimated_contract_value : 0;
  logRfqClmDiagnostic("request_payload", rfqClmRequestDiagnostic(payload));
  const missing = fields.filter(field => Number(field.reqd) === 1 && !present(payload[field.fieldname]) && (Object.hasOwn(payload, field.fieldname) || !present(field.default))).map(field => field.fieldname);
  if (missing.length) logRfqClmDiagnostic("request_schema_blocked", { rfq_id: rfqName, missing_fields: missing });
  if (missing.length) throw new ClmError(`The existing Contract Request schema requires contract-stage fields before an awarded RFQ request can be saved: ${missing.join(", ")}. Apply the reviewed initial-request field configuration through ERPNext's API; no bidsphere_workflows app is required.`, 503);
  const reserved = await updateRfqClmRecord(deps, RFQ, rfqName, current => {
    assertAwardIntent(current, award);
    const runtime = rfqRestData(current.custom_approval_data), state = rfqRestData(runtime.clm_initial_request);
    if (state.version === 1 && state.trigger === "award_confirmation" && ["saving", "complete"].includes(String(state.phase))) {
      if (state.award !== award.source.award || state.quotation !== award.source.quotation) throw new ClmError("The pending Contract Request references another award.", 409);
      return undefined;
    }
    runtime.clm_initial_request = { version: 1, phase: "saving", trigger: "award_confirmation", award: award.source.award, quotation: award.source.quotation, supplier: award.source.supplier, requested_by: actor, requested_at: at, ...(request ? { request: request.name } : {}), pending_document: payload };
    return { ...current, custom_approval_data: JSON.stringify(runtime) };
  });
  const state = rfqRestData(rfqRestData(reserved.custom_approval_data).clm_initial_request);
  if (!sameAward(award, (await currentAward(rfqName, deps)).award)) throw new ClmError("The supplier award changed before Contract Request persistence. Refresh its source before retrying.", 409);
  let created = false;
  request = await findRequest(rfqName, deps);
  if (!request) {
    if (state.phase === "complete" || state.request || !state.pending_document) throw new ClmError("The saved RFQ request link is missing. Inspect it before retrying.", 409);
    try {
      logRfqClmDiagnostic("request_create_attempt", rfqClmRequestDiagnostic(state.pending_document));
      const result = await deps.create(REQUEST, rfqRestData(state.pending_document));
      logRfqClmDiagnostic("request_create_response", { ...rfqClmRequestDiagnostic(result), rfq_id: rfqName });
      if (!result.name) throw new ClmError("ERPNext did not return the saved Contract Request ID.", 502);
      request = await deps.load(REQUEST, result.name); created = true;
    } catch (error) {
      logRfqClmDiagnostic("request_create_failed", { rfq_id: rfqName, ...rfqClmErrorDiagnostic(error) });
      request = await findRequest(rfqName, deps);
      if (!request) throw error;
      logRfqClmDiagnostic("request_recovered", rfqClmRequestDiagnostic(request));
    }
  } else if (state.pending_document && (isInvalidatedPreawardRequest(request) || rfqRestData(parseClmData(request.custom_clm_data).rfq_source).stage !== "rfq_awarded")) {
    const intent = rfqRestData(state.pending_document);
    request = await updateRfqClmRecord(deps, REQUEST, text(request.name), current => {
      if (!isInitialRfqRequest(current) || current.custom_contract) throw new ClmError("The existing Request advanced before its awarded source could be saved.", 409);
      if (String(current.modified) !== String(intent.modified)) throw new ClmError("The existing Request changed. Review its saved terms before resuming award confirmation.", 409);
      return { ...current, ...intent, name: current.name, modified: current.modified };
    });
  }
  const freshState = rfqRestData(rfqRestData((await deps.load(RFQ, rfqName)).custom_approval_data).clm_initial_request);
  // A concurrent winner may already have verified the original Draft and routed it.
  // Never compare that advanced record with an obsolete insert snapshot.
  if (freshState.phase === "complete" && freshState.request === request.name && !freshState.pending_document) {
    verifyInitial(request, rfqName);
    return { created, request };
  }
  if (freshState.pending_document) {
    verifyPayload(request, rfqRestData(freshState.pending_document));
    await updateRfqClmRecord(deps, RFQ, rfqName, current => {
      const runtime = rfqRestData(current.custom_approval_data), latest = rfqRestData(runtime.clm_initial_request);
      if (latest.request && latest.request !== request!.name) throw new ClmError("The RFQ links a different Contract Request.", 409);
      if (!latest.pending_document) return undefined;
      runtime.clm_initial_request = { ...latest, request: request!.name, pending_document: undefined };
      return { ...current, custom_approval_data: JSON.stringify(runtime) };
    });
  }
  if (request.request_status === "Draft") request = await updateRfqClmRecord(deps, REQUEST, text(request.name), current => current.request_status === "Draft" ? { ...current, request_status: "Pending Review" } : undefined);
  verifyInitial(request, rfqName);
  await updateRfqClmRecord(deps, RFQ, rfqName, current => {
    assertAwardIntent(current, award);
    const runtime = rfqRestData(current.custom_approval_data), latest = rfqRestData(runtime.clm_initial_request);
    if (latest.pending_document || latest.request && latest.request !== request!.name) throw new ClmError("The Contract Request has not passed persistence verification.", 409);
    if (latest.phase === "complete") return undefined;
    runtime.clm_initial_request = { ...latest, phase: "complete", request: request!.name, assigned_role: "procurement_team", status: "Pending", current_stage: "Procurement" };
    return { ...current, custom_approval_data: JSON.stringify(runtime) };
  });
  return { created, request: await deps.load(REQUEST, text(request.name)) };
}
