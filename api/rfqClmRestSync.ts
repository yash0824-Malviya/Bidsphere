import { ClmError, clmStatus, parseClmData, rfqClmFinanceApproved } from "./clmCore.js";
import type { ClmRecord } from "../src/types/clm.js";
import { isRfqClmRestContract } from "./rfqClmRestStatus.js";

export interface RfqClmRestSyncDependencies {
  load(doctype: string, name: string): Promise<ClmRecord>;
  save(doctype: string, record: ClmRecord): Promise<ClmRecord>;
  list(doctype: string, filters: unknown[]): Promise<ClmRecord[]>;
}
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const rows = (value: unknown): ClmRecord[] => Array.isArray(value) ? value as ClmRecord[] : [];
const has = (value: unknown) => value !== undefined && value !== null && value !== "";
function object(value: unknown, label: string): ClmRecord {
  if (typeof value === "string") { try { value = JSON.parse(value); } catch { throw new ClmError(`The saved ${label} could not be read. Reconcile its persisted links before retrying.`, 409); } }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ClmError(`The saved ${label} is invalid. Reconcile its persisted links before retrying.`, 409);
  return value as ClmRecord;
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable((value as ClmRecord)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
const equal = (left: unknown, right: unknown) => stable(left) === stable(right);
function conflict(message: string): never { throw new ClmError(message, 409); }

/** This is a derived mirror only: it never transitions an RFQ or award workflow. */
function lifecycleState(contract: ClmRecord): ClmRecord {
  const data = parseClmData(contract.custom_clm_data);
  const status = Number(contract.docstatus) === 2 ? "Cancelled" : clmStatus("Contract", contract);
  const executed = ["Executed", "Active"].includes(status);
  if (executed && (!data.version || !rfqClmFinanceApproved(contract, data))) conflict("The RFQ Contract cannot release procurement without its verified Legal, signature and Finance evidence.");
  return {
    contract: contract.name, status, contract_type: contract.custom_contract_type, contract_required: "Yes", blocked: !executed,
    ...(data.rfq_workflow?.phase ? { phase: data.rfq_workflow.phase } : {}),
    ...(data.procurement_completion ? { procurement_completion: data.procurement_completion } : {}),
    ...(data.rfq_workflow?.phase === "completed" ? { procurement_status: "Completed" } : {}),
    ...(executed ? { executed_at: data.approvals.find(row => row.role === "finance")!.at } : {}),
  };
}

async function source(contract: ClmRecord, deps: RfqClmRestSyncDependencies) {
  const rfqName = text(contract.custom_rfq), requestName = text(contract.custom_contract_request);
  const data = parseClmData(contract.custom_clm_data);
  const rfq = await deps.load("Request for Quotation", rfqName);
  if (rfq.name !== rfqName) conflict("The RFQ Contract source cannot be verified.");
  const approval = rfq.custom_approval_data ? object(rfq.custom_approval_data, "RFQ approval data") : {};
  const decision = approval.contract_decision ? object(approval.contract_decision, "RFQ contract decision") : undefined;
  const draft = clmStatus("Contract", contract) === "Draft" && (!data.rfq_workflow || data.rfq_workflow.phase === "draft");
  // During REST preparation only the new Draft may precede its permanent links.
  // Its first Legal submission must find the complete saved request/decision.
  if (!decision || !requestName || !text(decision.request)) {
    if (draft) return undefined;
    conflict("Persist the RFQ Yes decision and Contract Request links before advancing the Contract.");
  }
  if (rfq.contract_required !== "Yes" || decision.decision !== "Yes" || decision.request !== requestName || has(decision.contract) && decision.contract !== contract.name) conflict("The RFQ Contract and saved Yes decision refer to different records.");
  const request = await deps.load("Contract Request", requestName);
  const requestData = parseClmData(request.custom_clm_data);
  if (!requestData.contract) {
    if (draft) return undefined;
    conflict("Persist the Contract Request conversion link before advancing the Contract.");
  }
  const supplier = text(contract.custom_supplier || contract.party_name), quotationName = text(contract.custom_supplier_quotation);
  if (request.name !== requestName || request.custom_rfq !== rfqName || requestData.contract !== contract.name || request.custom_supplier_quotation !== quotationName || request.supplier !== supplier || decision.quotation !== quotationName || has(decision.supplier) && decision.supplier !== supplier || contract.party_type !== "Supplier" || contract.party_name !== supplier) conflict("The Contract, RFQ decision and Contract Request must preserve the same awarded supplier and quotation.");
  const provenance = data.rfq_source as ClmRecord | undefined, context = data.rfq_context as ClmRecord | undefined;
  const requestSource = requestData.rfq_source as ClmRecord | undefined;
  const awardName = text(decision.award || decision.legal_review || quotationName);
  if (!provenance || !requestSource || provenance.rfq !== rfqName || provenance.quotation !== quotationName || provenance.supplier !== supplier || provenance.contract_required !== true || text(provenance.award || provenance.legal_review || quotationName) !== awardName || requestSource.rfq !== rfqName || requestSource.quotation !== quotationName || requestSource.supplier !== supplier || requestSource.contract_required !== true || text(requestSource.award || requestSource.legal_review || quotationName) !== awardName || !context || context.rfq_id !== rfqName || context.award_id !== awardName || context.supplier_id !== supplier || context.quotation_id !== quotationName || context.contract_required !== "Yes" || context.contract_type !== contract.custom_contract_type || context.contract_status !== clmStatus("Contract", contract)) conflict("The Contract's permanent RFQ award context is inconsistent; its lifecycle was not mirrored.");
  const [quotation, byRfq, byRequest] = await Promise.all([
    deps.load("Supplier Quotation", quotationName), deps.list("Contract", [["custom_rfq", "=", rfqName]]), deps.list("Contract", [["custom_contract_request", "=", requestName]]),
  ]);
  const contractNames = new Set([...byRfq, ...byRequest].map(row => text(row.name)).filter(Boolean));
  if (contractNames.size !== 1 || !contractNames.has(text(contract.name))) conflict("Exactly one persistent Contract must reference this RFQ award.");
  if (quotation.name !== quotationName || Number(quotation.docstatus) !== 1 || /^(cancelled|canceled)$/i.test(text(quotation.status)) || quotation.supplier !== supplier || ![quotation, ...rows(quotation.items)].some(row => row.request_for_quotation === rfqName) || rfq.custom_active_rfq_round && quotation.custom_rfq_round && rfq.custom_active_rfq_round !== quotation.custom_rfq_round) conflict("The RFQ Contract must retain its submitted winning quotation and award round.");
  const review = text(decision.legal_review) ? await deps.load("Legal Document Review", text(decision.legal_review)) : undefined;
  if (review && (review.name !== decision.legal_review || review.name !== awardName || review.rfq_name !== rfqName || review.sq_name !== quotationName || review.company && review.company !== request.company)) conflict("The RFQ Contract and award review references do not match.");
  const amount = has(review?.grand_total) ? review!.grand_total : has(decision.amount) ? decision.amount : quotation.grand_total;
  if (!Number.isFinite(Number(amount)) || Number(contract.custom_contract_value) !== Number(amount) || Number(request.contract_value) !== Number(amount) || has(decision.amount) && Number(decision.amount) !== Number(amount) || contract.custom_currency !== quotation.currency || request.currency !== quotation.currency || has(decision.currency) && decision.currency !== quotation.currency || request.company !== (rfq.company || quotation.company) || quotation.company && quotation.company !== request.company) conflict("The RFQ Contract amount, currency and Company must match its saved award.");
  return { rfq, approval, decision, request, review };
}

/**
 * Standard REST saves cannot roll back earlier HTTP commits. Re-read and repair
 * these deterministic mirrors with optimistic revisions; never replace a newer
 * lifecycle state or write RFQ/award approval, owner or workflow fields.
 */
export async function syncRfqClmRestContract(saved: ClmRecord, deps: RfqClmRestSyncDependencies): Promise<{ synced: boolean }> {
  if (!isRfqClmRestContract(saved)) return { synced: false };
  if (!text(saved.name)) conflict("Save the RFQ Contract before synchronizing its lifecycle.");
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const contract = await deps.load("Contract", text(saved.name));
      if (contract.name !== saved.name || contract.custom_rfq !== saved.custom_rfq || contract.custom_contract_request !== saved.custom_contract_request) conflict("The Contract source changed before its RFQ lifecycle could be synchronized.");
      const linked = await source(contract, deps);
      if (!linked) return { synced: false };
      const state = lifecycleState(contract);
      const decision = { ...linked.decision, contract: contract.name, clm: state };
      if (!equal(linked.decision, decision)) await deps.save("Request for Quotation", { ...linked.rfq, custom_approval_data: JSON.stringify({ ...linked.approval, contract_decision: decision }) });
      const current = await deps.load("Contract", text(contract.name));
      if (current.modified !== contract.modified || current.custom_clm_data !== contract.custom_clm_data || current.custom_contract_status !== contract.custom_contract_status || current.docstatus !== contract.docstatus) continue;
      const awardState = linked.review ? { rfq_id: linked.rfq.name, award_id: linked.review.name, ...state } : undefined;
      if (linked.review && !equal(linked.review.custom_clm_state ? object(linked.review.custom_clm_state, "award CLM state") : {}, awardState)) await deps.save("Legal Document Review", { ...linked.review, custom_clm_state: JSON.stringify(awardState) });
      const [verifiedContract, verifiedRfq, verifiedReview] = await Promise.all([
        deps.load("Contract", text(contract.name)), deps.load("Request for Quotation", text(linked.rfq.name)),
        linked.review ? deps.load("Legal Document Review", text(linked.review.name)) : Promise.resolve(undefined),
      ]);
      if (verifiedContract.modified !== contract.modified || verifiedContract.custom_clm_data !== contract.custom_clm_data || verifiedContract.custom_contract_status !== contract.custom_contract_status || verifiedContract.docstatus !== contract.docstatus) continue;
      const persistedDecision = object(verifiedRfq.custom_approval_data, "RFQ approval data").contract_decision;
      if (equal(persistedDecision, decision) && (!verifiedReview || equal(object(verifiedReview.custom_clm_state, "award CLM state"), awardState))) return { synced: true };
      lastError = new ClmError("ERPNext did not retain the RFQ/Award Contract lifecycle mirrors. Verify the existing schema fields before retrying synchronization.", 409);
    } catch (error) {
      lastError = error;
      if (!(error instanceof ClmError) || ![409, 502, 503, 504].includes(error.status)) break;
    }
  }
  throw new ClmError(`The Contract was saved, but its RFQ/Award lifecycle synchronization could not be confirmed. ${lastError instanceof ClmError ? lastError.message : "Refresh the records before retrying synchronization."}`, lastError instanceof ClmError ? lastError.status : 409);
}
