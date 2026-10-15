import { ClmError, parseClmData } from "./clmCore.js";
import type { ClmRecord } from "../src/types/clm.js";
import { rfqClmRequestWorkflowView } from "../src/utils/rfqClmWorkflow.js";
import { isSubmittedRfq } from "../src/utils/rfqSubmission.js";

/** Preserve the original standalone Request requirements after ERP intake configuration changes. */
export const CONTRACT_REQUEST_REQUIRED_FIELDS = [
  "requester", "request_date", "department", "company", "contract_type", "contract_purpose", "description", "supplier",
  "contract_start_date", "contract_end_date", "contract_value", "currency", "estimated_contract_value",
] as const;
export const INITIAL_RFQ_REQUEST_DEFERRED_FIELDS = [
  "contract_type", "supplier", "contract_start_date", "contract_end_date", "contract_value", "currency", "estimated_contract_value",
] as const;
const deferred = new Set<string>(INITIAL_RFQ_REQUEST_DEFERRED_FIELDS);
const awardDeferred = new Set(["contract_type", "contract_start_date", "contract_end_date", "estimated_contract_value"]);
const present = (value: unknown) => value !== undefined && value !== null && (typeof value !== "string" || value.trim() !== "");
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

export function isHeldInitialRfqRequest(record: ClmRecord): boolean {
  const data = parseClmData(record.custom_clm_data), workflow = data.rfq_request_workflow as ClmRecord | undefined;
  if (!text(record.name) || Number(record.docstatus || 0) !== 0 || workflow?.version !== 1 || workflow.assigned_role !== "procurement_team") return false;
  const invalidated = ["Draft", "Cancelled"].includes(String(record.request_status)) && workflow.phase === "awaiting_supplier_award" && workflow.status === "Invalidated" && workflow.current_stage === "Awaiting Supplier Award";
  const legacyHold = record.request_status === "Draft" && workflow.phase === "awaiting_rfq_submission" && workflow.status === "Draft-originated" && workflow.current_stage === "Awaiting RFQ Submission";
  return (invalidated || legacyHold) && data.audit.some(row => row.action === (invalidated ? "invalidate_preaward_request" : "invalidate_draft_origin_request") && row.reference_id === record.custom_rfq && text(row.by) && text(row.at) && ["procurement", "procurement_team", "admin"].includes(row.role));
}

/** Only verified server-authored RFQ intake may defer contract-stage terms. */
export function isInitialRfqRequestPersistence(record: ClmRecord): boolean {
  if (!text(record.custom_rfq)) return false;
  const data = parseClmData(record.custom_clm_data), source = data.rfq_source as ClmRecord | undefined;
  const held = isHeldInitialRfqRequest(record);
  const assignmentRecord = held ? { ...record, request_status: "Draft", custom_clm_data: JSON.stringify({ ...data, rfq_request_workflow: { ...(data.rfq_request_workflow as ClmRecord), phase: "procurement_team", status: "Pending", current_stage: "Procurement" } }) } : record;
  if (!source || !["rfq_created", "rfq_awarded"].includes(String(source.stage)) || source.prepared !== undefined && source.prepared !== false || source.rfq !== record.custom_rfq || source.contract_required !== true || source.company !== record.company ||
      [record.custom_purchase_order, data.contract, data.rfq_context, data.rfq_workflow].some(present) ||
      Number(record.docstatus) === 2 || !["Draft", "Pending Review", ...(held ? ["Cancelled"] : [])].includes(text(record.request_status)) || !rfqClmRequestWorkflowView(assignmentRecord)) return false;
  if (source.stage === "rfq_created" && [source.award, source.legal_review, source.quotation, record.custom_supplier_quotation].some(present)) return false;
  if (source.stage === "rfq_awarded" && (!text(source.award) || !text(source.quotation) || source.supplier !== record.supplier || source.quotation !== record.custom_supplier_quotation || !present(source.amount) || !Number.isFinite(Number(source.amount)) || !text(source.currency))) return false;
  const assigned = data.audit.some(row => row.action === "procurement_team_assigned" && text(row.by) && text(row.at) && ["procurement", "procurement_team", "admin"].includes(row.role));
  const created = data.audit.some(row => row.action === "create" && row.by === record.requester && text(row.at) && ["procurement", "procurement_team", "admin"].includes(row.role));
  return assigned && created && data.versions.length === 0 && data.signatures.length === 0;
}

export type PersistedRequestAward = { source: ClmRecord; prefill: ClmRecord; review?: ClmRecord };
export function validateContractRequestPersistence(record: ClmRecord, persistedRfq?: ClmRecord, operation: "create" | "save" = "save", award?: PersistedRequestAward): void {
  const initial = isInitialRfqRequestPersistence(record);
  const source = initial ? parseClmData(record.custom_clm_data).rfq_source as ClmRecord : undefined;
  const held = initial && isHeldInitialRfqRequest(record);
  const optional = source?.stage === "rfq_awarded" && !held ? awardDeferred : deferred;
  const required = CONTRACT_REQUEST_REQUIRED_FIELDS.filter(field => !initial || !optional.has(field));
  const missing = required.filter(field => !present(record[field]));
  if (missing.length) throw new ClmError(`Contract Request requires: ${missing.join(", ")}. Complete the request before saving.`, 422);
  if (!initial) return;
  if (!persistedRfq || persistedRfq.name !== record.custom_rfq || Number(persistedRfq.docstatus) === 2 || persistedRfq.company !== record.company) throw new ClmError("The initial Contract Request must reference its saved active RFQ and the same Company.", 409);
  if (held) {
    if (operation !== "save" || award?.review?.name) throw new ClmError("A pre-award invalidation may only preserve an existing Request without a supplier award.", 409);
    return;
  }
  if (source?.stage !== "rfq_awarded" || !isSubmittedRfq(persistedRfq) || persistedRfq.contract_required !== "Yes" || !award?.review?.name) throw new ClmError("A real saved supplier award and Contract Required = Yes are required before creating or routing a Contract Request.", 409);
  let data: unknown = persistedRfq.custom_approval_data;
  if (typeof data === "string") {
    try { data = JSON.parse(data); }
    catch { throw new ClmError("The saved award confirmation evidence could not be read. Inspect the RFQ before retrying.", 409); }
  }
  const intent = data && typeof data === "object" ? (data as ClmRecord).clm_award_intent as ClmRecord | undefined : undefined;
  if (intent?.version !== 1 || intent.decision !== "Yes" || !["saving", "complete"].includes(String(intent.phase)) || intent.award !== source.award || intent.quotation !== source.quotation || intent.supplier !== source.supplier || !text(intent.by) || !text(intent.at)) throw new ClmError("The Contract Request requires its persisted award confirmation decision.", 409);
  if (["award", "quotation", "supplier", "company", "currency"].some(field => source[field] !== award.source[field]) || Number(source.amount) !== Number(award.source.amount) ||
      record.supplier !== award.prefill.supplier || record.custom_supplier_quotation !== award.prefill.custom_supplier_quotation || Number(record.contract_value) !== Number(award.prefill.contract_value) || record.currency !== award.prefill.currency) throw new ClmError("The Contract Request must preserve its authoritative supplier award, winning quotation, final award value and currency.", 409);
}
