import type { AccessPrincipal } from "./rbacAuth.js";
import type { ClmRecord, RfqClmDecisionResult } from "../src/types/clm.js";
import { ClmError, toClmAggregate } from "./clmCore.js";
import { canInitiateRfqClm, getRfqClmSummary, resolveAvailableRfqAward, type RfqClmDeps } from "./rfqClmCore.js";
import { ensureInitialRfqContractRequest, isInvalidatedPreawardRequest } from "./rfqInitialClmRequest.js";
import { persistRfqClmDecision, rfqRestData, updateRfqClmRecord } from "./rfqClmRest.js";

export interface RfqAwardClmDecisionInput { rfq: string; award_id: string; quotation_id: string; supplier_id: string; decision?: "Yes" | "No" }
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

/** Called explicitly after the existing supplier award has been persisted. Never awards a supplier itself. */
export async function recordRfqAwardClmDecision(principal: AccessPrincipal, input: RfqAwardClmDecisionInput, deps: RfqClmDeps): Promise<RfqClmDecisionResult> {
  if (!canInitiateRfqClm(principal) || principal.typ !== "internal") throw new ClmError("Only Procurement Manager or Procurement Team can process the awarded RFQ's saved Contract Required choice.", 403);
  if (input.decision !== undefined && !["Yes", "No"].includes(input.decision) || [input.rfq, input.award_id, input.quotation_id, input.supplier_id].some(value => !text(value))) throw new ClmError("Supply the persisted RFQ award, supplier and quotation.", 400);
  let rfq = await deps.load("Request for Quotation", input.rfq);
  if (!["Yes", "No"].includes(String(rfq.contract_required))) {
    if (input.decision && ["Yes", "No"].includes(input.decision)) {
      rfq = await updateRfqClmRecord(deps, "Request for Quotation", input.rfq, current => ({
        ...current,
        contract_required: input.decision,
      }));
    } else {
      throw new ClmError("The RFQ must have a saved Contract Required choice before its award can be handed off.", 409);
    }
  } else if (input.decision && input.decision !== rfq.contract_required) {
    throw new ClmError("The award decision does not match the RFQ's saved Contract Required choice.", 409);
  }
  const decision = rfq.contract_required as "Yes" | "No";
  const award = await resolveAvailableRfqAward(rfq, deps);
  if (rfq.name !== input.rfq || Number(rfq.docstatus) !== 1 || !award?.review || award.review.name !== input.award_id || award.quotation.name !== input.quotation_id || award.prefill.supplier !== input.supplier_id) throw new ClmError("Persist the supplier award for this RFQ before confirming Contract Required. The selected supplier and quotation must match the saved award.", 409);
  const actor = { id: principal.email || principal.sub, role: principal.role };
  const before = rfqRestData(rfq.custom_approval_data), previous = rfqRestData(before.contract_decision), intent = rfqRestData(before.clm_award_intent);
  if (Object.keys(intent).length && (intent.version !== 1 || !["saving", "complete"].includes(String(intent.phase)))) throw new ClmError("The saved award decision intent is invalid. Inspect the existing RFQ handoff before retrying.", 409);
  for (const evidence of [previous, intent]) {
    if (evidence.decision && (evidence.decision !== decision || evidence.award !== input.award_id || evidence.quotation !== input.quotation_id || evidence.supplier !== input.supplier_id)) throw new ClmError("A different award or Contract Required decision is already recorded. Refresh its existing handoff before continuing.", 409);
  }
  if (previous.decision) {
    const summary = await getRfqClmSummary(principal, input.rfq, deps);
    if (summary.eligible && !summary.recovery_required && summary.decision === decision && (decision === "No" ? !summary.request && !summary.contract : !!summary.request)) {
      return { created: false, summary, ...(summary.request ? { request: toClmAggregate(principal, "Contract Request", await deps.load("Contract Request", summary.request.name)) } : {}) };
    }
  }
  if (decision === "No") {
    const [requests, contracts] = await Promise.all([deps.list("Contract Request", [["custom_rfq", "=", input.rfq]]), deps.list("Contract", [["custom_rfq", "=", input.rfq]])]);
    if (contracts.length || requests.some(request => !isInvalidatedPreawardRequest(request))) throw new ClmError("An active CLM record already exists for this award. Preserve its saved Contract Required decision.", 409);
  }
  if (!intent.version) {
    rfq = await updateRfqClmRecord(deps, "Request for Quotation", input.rfq, current => {
      const data = rfqRestData(current.custom_approval_data), concurrent = rfqRestData(data.clm_award_intent);
      if (current.contract_required !== decision) throw new ClmError("The saved RFQ Contract Required choice changed. Refresh before retrying its award handoff.", 409);
      if (concurrent.version === 1) {
        if (concurrent.decision !== decision || concurrent.award !== input.award_id || concurrent.quotation !== input.quotation_id || concurrent.supplier !== input.supplier_id) throw new ClmError("Another award decision was saved. Refresh before continuing.", 409);
        return undefined;
      }
      if (current.modified !== rfq.modified || Number(current.docstatus) !== 1) throw new ClmError("The RFQ changed while confirming its award decision. Refresh and retry.", 409);
      data.clm_award_intent = { version: 1, phase: "saving", decision, award: input.award_id, quotation: input.quotation_id, supplier: input.supplier_id, by: actor.id, at: deps.now() };
      return { ...current, custom_approval_data: JSON.stringify(data) };
    });
  }
  let created = false;
  if (decision === "Yes") {
    const initial = await ensureInitialRfqContractRequest(principal, input.rfq, deps, { allowCreate: true, trigger: "award_confirmation" });
    if (!initial.request?.name) throw new ClmError("The supplier award is saved, but ERPNext did not persist its Contract Request. Retry the same award decision.", 409);
    created = initial.created;
  }
  rfq = await deps.load("Request for Quotation", input.rfq);
  if (rfq.contract_required !== decision) throw new ClmError("The RFQ Contract Required choice changed while its award was being handed off. Refresh before retrying.", 409);
  const freshAward = await resolveAvailableRfqAward(rfq, deps);
  if (!freshAward?.review || ["award", "quotation", "supplier", "amount", "currency", "company"].some(field => freshAward.source[field] !== award.source[field])) throw new ClmError("The saved supplier award changed while recording the Contract Required decision. Refresh its source before retrying.", 409);
  const source: ClmRecord = { ...freshAward.source, quotation_modified: freshAward.quotation.modified, legal_review: freshAward.review.name, legal_review_modified: freshAward.review.modified };
  const committed = await persistRfqClmDecision({ rfq: input.rfq, expected_modified: text(rfq.modified), decision: decision, actor, award: source }, deps);
  await updateRfqClmRecord(deps, "Request for Quotation", input.rfq, current => {
    const data = rfqRestData(current.custom_approval_data), saved = rfqRestData(data.clm_award_intent);
    if (saved.decision !== decision || saved.award !== input.award_id) throw new ClmError("The award decision changed during persistence verification.", 409);
    if (saved.phase === "complete") return undefined;
    data.clm_award_intent = { ...saved, phase: "complete", ...(committed.request ? { request: committed.request.name } : {}) };
    return { ...current, custom_approval_data: JSON.stringify(data) };
  });
  const summary = await getRfqClmSummary(principal, input.rfq, deps);
  if (!summary.eligible || ["award", "quotation", "supplier", "amount", "currency", "company"].some(field => summary.source?.[field] !== source[field]) || summary.decision !== decision || summary.recovery_required || decision === "Yes" && (!committed.request || summary.request?.name !== committed.request.name || summary.request.assigned_role !== "procurement_team") || decision === "No" && (summary.request || summary.contract)) throw new ClmError("The award decision and Contract Request handoff were not confirmed. Retry the same decision; no success has been reported.", 409);
  return { created, ...(committed.request ? { request: toClmAggregate(principal, "Contract Request", committed.request) } : {}), summary };
}
