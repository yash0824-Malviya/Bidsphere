import { randomUUID } from "node:crypto";
import type { ClmRecord } from "../src/types/clm.js";
import { RFQ_CONTRACT_TYPES } from "../src/utils/rfqContractContext.js";
import { rfqClmRequestWorkflowView } from "../src/utils/rfqClmWorkflow.js";
import { canReadClm, ClmError, parseClmData, type ClmDeps } from "./clmCore.js";
import { isInitialRfqRequestPersistence, validateContractRequestPersistence } from "./clmRequestValidation.js";
import type { AccessPrincipal } from "./rbacAuth.js";
import { resolveAvailableRfqAward } from "./rfqClmCore.js";

export const RFQ_REQUEST_DRAFT_FIELDS = [
  "contract_type", "contract_purpose", "description",
  "contract_start_date", "contract_end_date", "contract_value",
  "currency", "estimated_contract_value",
  "custom_inteva_signatory",
] as const;
const allowed = new Set<string>(RFQ_REQUEST_DRAFT_FIELDS);
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const object = (value: unknown): value is ClmRecord => !!value && typeof value === "object" && !Array.isArray(value);
const empty = (value: unknown) => value === "" || value === null || value === undefined;
const numbers = new Set(["contract_value", "estimated_contract_value"]);
const dates = new Set(["contract_start_date", "contract_end_date"]);
const awardFields = new Set(["contract_value", "currency"]);

/** A separate capability: generic Request save/submission and award checks stay strict. */
export function canEditRfqRequestDraft(principal: AccessPrincipal, request: ClmRecord): boolean {
  if (principal.typ !== "internal" || !["procurement", "procurement_team"].includes(principal.role)) return false;
  try {
    const route = rfqClmRequestWorkflowView(request);
    const source = parseClmData(request.custom_clm_data).rfq_source as ClmRecord | undefined;
    return source?.stage === "rfq_awarded" && !!source.award && !!source.quotation && !!source.supplier && isInitialRfqRequestPersistence(request) && route?.assignedRole === "procurement_team" &&
      ["Procurement", "Pending Procurement Team"].includes(route.stage) && ["Pending", "Pending Procurement Team"].includes(route.status) &&
      Number(request.docstatus || 0) === 0 && canReadClm(principal, "Contract Request", request);
  } catch { return false; }
}

function normalizeValues(input: ClmRecord): ClmRecord {
  const result: ClmRecord = {};
  for (const [field, raw] of Object.entries(input)) {
    if (!allowed.has(field)) throw new ClmError(`The ${field} field cannot be changed in a Contract Request draft.`, 403);
    if (empty(raw)) { result[field] = ""; continue; }
    if (numbers.has(field)) {
      if (typeof raw !== "number" && (typeof raw !== "string" || !/^\d+(?:\.\d+)?$/.test(raw.trim())) || !Number.isFinite(Number(raw)) || Number(raw) < 0) throw new ClmError(`${field.replaceAll("_", " ")} must be a valid non-negative amount.`, 422);
      result[field] = Number(raw); continue;
    }
    if (typeof raw !== "string") throw new ClmError(`${field.replaceAll("_", " ")} must be text.`, 422);
    const value = raw.trim();
    if (!value) { result[field] = ""; continue; }
    if (value.length > (field === "description" ? 100_000 : field === "contract_purpose" ? 10_000 : 255)) throw new ClmError(`${field.replaceAll("_", " ")} is too long.`, 422);
    if (dates.has(field)) {
      const date = new Date(`${value}T00:00:00.000Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new ClmError(`Enter a valid ${field.replaceAll("_", " ")}.`, 422);
    }
    if (field === "contract_type" && !(RFQ_CONTRACT_TYPES as readonly string[]).includes(value)) throw new ClmError("Select a supported contract type.", 422);
    result[field] = value;
  }
  if (text(result.contract_start_date) && text(result.contract_end_date) && String(result.contract_end_date) <= String(result.contract_start_date)) throw new ClmError("Contract End Date must be after Contract Start Date.", 422);
  return result;
}

/** Draft terms override defaults; final award value/currency can never be draft overrides. */
export function rfqRequestDraftValues(request: ClmRecord): ClmRecord {
  const data = parseClmData(request.custom_clm_data), draft = data.rfq_request_draft;
  if (draft === undefined) return {};
  if (!object(draft) || draft.version !== 1 || !object(draft.values) || !text(draft.by) || !text(draft.at)) throw new ClmError("The saved Contract Request draft could not be verified. Refresh or contact an administrator.", 409);
  return normalizeValues(Object.fromEntries(Object.entries(draft.values).filter(([field]) => !awardFields.has(field))));
}

export function projectRfqRequestDraft(request: ClmRecord): ClmRecord {
  return isInitialRfqRequestPersistence(request) ? { ...request, ...rfqRequestDraftValues(request) } : request;
}

export interface RfqRequestDraftInput { name: string; expected_modified: string; payload: ClmRecord }

/** Update this Request only, using the normal native ERP save and its atomic revision check. */
export async function saveRfqRequestDraft(principal: AccessPrincipal, input: RfqRequestDraftInput, deps: ClmDeps): Promise<ClmRecord> {
  if (principal.typ !== "internal" || !["procurement", "procurement_team"].includes(principal.role)) throw new ClmError("Only Procurement Manager or Procurement Team can edit this RFQ Contract Request draft.", 403);
  if (!text(input.name) || !text(input.expected_modified) || !object(input.payload)) throw new ClmError("Supply the existing Request, its revision and draft fields.", 400);
  // Reject source/workflow/attachment writes before loading or saving anything.
  const supplied = normalizeValues(input.payload);
  const request = await deps.load("Contract Request", input.name);
  if (request.name !== input.name || !canEditRfqRequestDraft(principal, request)) throw new ClmError("This Request is not assigned to you for Procurement draft preparation.", 403);
  if (request.modified !== input.expected_modified) throw new ClmError("The Contract Request changed. Refresh before saving your draft.", 409);
  const rfq = await deps.load("Request for Quotation", text(request.custom_rfq));
  const runtime: ClmRecord = (() => {
    try { const parsed: unknown = typeof rfq.custom_approval_data === "string" ? JSON.parse(rfq.custom_approval_data) : rfq.custom_approval_data; if (object(parsed)) return parsed; }
    catch { /* Invalid persisted evidence must not fall back to an unlinked draft. */ }
    throw new ClmError("The RFQ workflow evidence could not be verified.", 409);
  })();
  const initial = object(runtime.clm_initial_request) ? runtime.clm_initial_request : {};
  const decision = object(runtime.contract_decision) ? runtime.contract_decision : {};
  const operation = object(runtime.clm_rest_operation) ? runtime.clm_rest_operation : {};
  const blockedRfq = Number(rfq.docstatus) !== 1 || [rfq.status, rfq.workflow_state, rfq.custom_workflow_step, rfq.review_status, rfq.finance_status].some(value => /^(draft|cancelled|canceled|closed|stopped|rejected|legal rejected|finance rejected)$/i.test(text(value)));
  if (rfq.name !== request.custom_rfq || rfq.contract_required !== "Yes" || blockedRfq || rfq.company !== request.company ||
      initial.version !== 1 || initial.phase !== "complete" || initial.request !== request.name ||
      decision.request && decision.request !== request.name || decision.decision && decision.decision !== "Yes" || decision.contract ||
      operation.pending_insert || operation.phase && !["complete", "recorded"].includes(String(operation.phase))) throw new ClmError("The saved RFQ must link this Request with Contract Required = Yes and no Contract creation in progress.", 409);
  const [requests, contracts] = await Promise.all([
    deps.list("Contract Request", [["custom_rfq", "=", rfq.name]]),
    deps.list("Contract", [["custom_rfq", "=", rfq.name]]),
  ]);
  if (requests.length !== 1 || requests[0].name !== request.name || contracts.length) throw new ClmError("The RFQ Request or Contract linkage changed. Refresh before editing its draft.", 409);
  const award = await resolveAvailableRfqAward(rfq, deps);
  validateContractRequestPersistence(request, rfq, "save", award);
  if (!award?.review) throw new ClmError("The Contract Request requires its persisted final supplier award.", 409);
  for (const field of awardFields) {
    if (Object.hasOwn(supplied, field) && String(supplied[field]) !== String(award.prefill[field])) throw new ClmError("The Contract Request must preserve the final award value and currency. These source fields cannot be edited.", 409);
  }
  const values = normalizeValues({ ...Object.fromEntries(RFQ_REQUEST_DRAFT_FIELDS.map(field => [field, request[field] ?? ""])), ...rfqRequestDraftValues(request), ...supplied });
  if (text(values.currency)) {
    const currency = await deps.load("Currency", text(values.currency));
    if (currency.name !== values.currency || currency.enabled !== undefined && Number(currency.enabled) !== 1) throw new ClmError("Select an enabled ERPNext Currency.", 422);
  }
  const data = parseClmData(request.custom_clm_data), at = deps.now();
  data.rfq_request_draft = { version: 1, values: Object.fromEntries(Object.entries(values).filter(([field]) => !awardFields.has(field))), by: principal.sub, role: principal.role, at };
  data.audit.push({ id: randomUUID(), action: "save_rfq_request_draft", by: principal.email || principal.sub, role: principal.role, at, previous_status: "Pending", new_status: "Pending", comment: "Procurement saved Contract Request details. No Contract was created and the Request remains at Procurement.", reference_id: request.name });
  const next: ClmRecord = { ...request, custom_clm_data: JSON.stringify(data) };
  for (const field of RFQ_REQUEST_DRAFT_FIELDS) {
    // Native mandatory source text remains intact when the explicit persisted
    // draft is blank; the read projection and preparation validation use the draft.
    if (["contract_purpose", "description"].includes(field) && values[field] === "") continue;
    // Frappe Currency fields normalize empty values to zero. The explicit draft
    // retains the blank so zero is never presented as an entered/awarded amount.
    next[field] = values[field] === "" ? numbers.has(field) ? 0 : dates.has(field) ? null : "" : values[field];
  }
  const saved = await deps.save("Contract Request", next);
  if (saved.name !== request.name) throw new ClmError("ERPNext returned a different Contract Request. Refresh before retrying.", 409);
  const persisted = await deps.load("Contract Request", input.name);
  if (persisted.name !== request.name || persisted.custom_clm_data !== next.custom_clm_data || !canEditRfqRequestDraft(principal, persisted)) throw new ClmError("ERPNext did not persist the Contract Request draft and assignment. Refresh before retrying.", 409);
  for (const field of Object.keys(next).filter(field => !["modified", "modified_by", "__last_sync_onload", "__onload"].includes(field))) {
    const expected = next[field], actual = persisted[field];
    if (empty(expected) && empty(actual)) continue;
    if (numbers.has(field) && !empty(expected) && Number(expected) === Number(actual)) continue;
    const withoutChildRevisions = (value: unknown) => Array.isArray(value) ? value.map(row => object(row) && row.parent === request.name && text(row.doctype)
      ? Object.fromEntries(Object.entries(row).filter(([key]) => !["modified", "modified_by"].includes(key))) : row) : value;
    if (JSON.stringify(withoutChildRevisions(actual)) !== JSON.stringify(withoutChildRevisions(expected))) throw new ClmError(`ERPNext did not preserve Contract Request.${field}. Refresh the saved Request before retrying.`, 409);
  }
  return persisted;
}
