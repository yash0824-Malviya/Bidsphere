import { createHash, randomUUID } from "node:crypto";
import type { AccessPrincipal } from "./rbacAuth.js";
import { resolveServerRole } from "./rbacAuth.js";
import { canonicalErpFilePath } from "./fileProxyCore.js";
import type { ClmActionInput, ClmActionName, ClmAction, ClmAggregate, ClmApproval, ClmApprovalStage, ClmData, ClmDoctype, ClmMatrixConditions, ClmRecord, ClmSignature, ClmSignatureWorkflow, ClmSupplierDocument } from "../src/types/clm.js";
import { CLM_DOCTYPES } from "../src/types/clm.js";
import { validateRfqContractDetails } from "../src/utils/rfqContractContext.js";
import { rfqClmRequestWorkflowView } from "../src/utils/rfqClmWorkflow.js";
import { evaluateContractEffectivePeriod } from "../src/utils/contractEffectivePeriod.js";
import { currentClmPdfEvidence } from "./clmPdfEvidence.js";
import { clmSupplierPoName, clmSupplierPoWorkflow, verifyClmSupplierPoSource } from "./clmSupplierPoWorkflow.js";

export class ClmError extends Error {
  status: number;
  constructor(message: string, status = 422) { super(message); this.name = "ClmError"; this.status = status; }
}
/** RFQ Legal signatures require a separately captured and explicitly adopted mark. */
export function validateClmSignatureInput(record: ClmRecord, principal: AccessPrincipal, payload: ClmRecord): Pick<ClmSignature, "typed_name" | "full_legal_name" | "signature_method" | "signature_adopted"> {
  if (payload.consent !== true) throw new ClmError("Enter your name and confirm your intent to sign this Contract.");
  if (isRfqClmContract(record) && (principal.typ === "internal" || clmSupplierPoName(record, parseClmData(record.custom_clm_data)))) {
    const fullName = typeof payload.full_legal_name === "string" ? payload.full_legal_name.trim() : "";
    if (!fullName || fullName.length > 160) throw new ClmError("Enter your full legal name before signing (maximum 160 characters).");
    const signature = payload.signature && typeof payload.signature === "object" && !Array.isArray(payload.signature) ? payload.signature as ClmRecord : undefined;
    if (!signature || signature.method !== "typed") throw new ClmError("Provide a separate typed signature before signing this Contract.");
    const mark = typeof signature.value === "string" ? signature.value.trim() : "";
    if (!mark || mark.length > 160) throw new ClmError("Enter your signature (maximum 160 characters).");
    if (signature.adopted !== true) throw new ClmError("Explicitly adopt the captured signature before confirming this Contract.");
    return { typed_name: mark, full_legal_name: fullName, signature_method: "typed", signature_adopted: true };
  }
  const mark = typeof payload.typed_name === "string" ? payload.typed_name.trim() : "";
  if (!mark) throw new ClmError("Enter your name and confirm your intent to sign this Contract.");
  if (mark.length > 160) throw new ClmError("The signature name is too long.");
  return { typed_name: mark };
}
export interface ClmDeps {
  load(doctype: string, name: string): Promise<ClmRecord>;
  list(doctype: string, filters?: unknown[]): Promise<ClmRecord[]>;
  create(doctype: string, doc: ClmRecord): Promise<ClmRecord>;
  save(doctype: string, doc: ClmRecord): Promise<ClmRecord>;
  now(): string;
  sign?(contract: ClmRecord, principal: AccessPrincipal, payload: ClmRecord): Promise<ClmSignature>;
  lock?(contract: ClmRecord, principal: AccessPrincipal): Promise<{ file_id: string; file_url: string; hash: string }>;
  verifyPdf?(contract: ClmRecord, evidence: { file_id?: string; file_url: string; hash?: string }): Promise<unknown>;
  notify?(doctype: string, record: ClmRecord, event: string, approvals: ClmApproval[]): Promise<void>;
  closureBlockers?(contract: ClmRecord): Promise<string[]>;
}
const text = (v: unknown) => typeof v === "string" ? v.trim() : "";
const yes = (v: unknown) => v === 1 || v === true || v === "1";
const actor = (p: AccessPrincipal) => p.typ === "internal" ? p.email || p.sub : p.sub;
const internalRole = (p: AccessPrincipal, roles: readonly string[]) => p.typ === "internal" && (p.role === "admin" || roles.includes(p.role));
const coordinators = ["procurement", "procurement_team"];
const reviewerRoles = ["procurement", "finance", "legal", "engineering", "quality", "program_manager"];
const relatedTypes: ClmDoctype[] = ["Contract Risk", "Contract Milestone", "Contract Obligation", "Contract Amendment", "Contract Renewal"];
const reviewable = new Set<ClmDoctype>(["Contract", "Contract Amendment", "Contract Renewal"]);
const statusField = (dt: string) => dt === "Contract" ? "custom_contract_status" : dt === "Contract Request" ? "request_status" : dt === "Contract Amendment" ? "amendment_status" : dt === "Contract Renewal" ? "renewal_status" : dt === "Contract Risk" ? "risk_status" : "status";
export const clmStatus = (dt: string, record: ClmRecord) => text(record[statusField(dt)]) || (dt === "Contract" && ["Active", "Cancelled"].includes(text(record.status)) ? text(record.status) : "Draft");
export const isRfqClmContract = (record: ClmRecord): boolean => !!text(record.custom_rfq);
// Older RFQ contracts use the native status until their next authorized save.
// An explicit persisted phase must agree; it cannot be overridden by a stale status.
export const isRfqClmSignatureStage = (record: ClmRecord, data: ClmData): boolean => isRfqClmContract(record) &&
  (!data.rfq_workflow || data.rfq_workflow.version === 1 && data.rfq_workflow.phase === "signature") && !data.termination && Number(record.docstatus) !== 2 &&
  ["Approved", "Pending Signature"].includes(clmStatus("Contract", record));
const exactRole = (p: AccessPrincipal, role: string) => p.typ === "internal" && p.role === role;
const evidenceTime = (value: unknown) => typeof value === "string" && value.trim() ? Date.parse(value.trim().replace(" ", "T")) : NaN;

/** Legal approval and its authorized, immutable signature complete RFQ CLM e-signing.
 * Supplier receipts are validated when present, but are not a Finance prerequisite. */
export function rfqClmLegalSigned(record: ClmRecord, data = parseClmData(record.custom_clm_data)): boolean {
  const legal = data.approvals.find(row => row.role === "legal" && row.stage === 0 && row.status === "Approved" && row.by);
  const company = data.signatures.find(row => row.party === "inteva");
  const times = [legal?.at, ...data.signatures.map(row => row.at)].map(evidenceTime);
  let document;
  try { document = currentClmPdfEvidence(record, data); } catch { return false; }
  return isRfqClmContract(record) && !!legal && data.approvals.filter(row => row.role === "legal").length === 1 && !!company && data.signatures.length <= 2 &&
    new Set(data.signatures.map(row => row.party)).size === data.signatures.length && data.signatures.every(row => ["supplier", "inteva"].includes(row.party)) &&
    new Set(data.signatures.map(row => row.file_id)).size === data.signatures.length && times.every(Number.isFinite) && times.every((at, index) => !index || at >= times[index - 1]) &&
    data.signatures.every(row => row.version === record.custom_current_version && !!row.by && !!row.file_id && row.file_url.startsWith("/private/files/") && /^[a-f0-9]{64}$/.test(row.hash)) &&
    company.role === "legal" && sameIdentity(company.by, record.custom_inteva_signatory) && document?.kind === "signed" &&
    yes(record.custom_final_version_locked) && data.locked_hash === clmSnapshotHash("Contract", record);
}

export const isRfqClmSupplierSignatureStage = (record: ClmRecord, data: ClmData): boolean =>
  isRfqClmContract(record) && clmSupplierPoWorkflow(record, data)?.can_sign_contract === true;

/** RFQ procurement requires a separate Finance decision after the Legal signature. */
export function rfqClmFinanceApproved(record: ClmRecord, data = parseClmData(record.custom_clm_data)): boolean {
  const finance = data.approvals.find(row => row.role === "finance" && row.stage === 1 && row.status === "Approved" && row.by);
  const signedAt = data.signatures.find(row => row.party === "inteva")?.at;
  const completion = data.procurement_completion as ClmRecord | undefined;
  const context = data.rfq_context as ClmRecord | undefined;
  const completed = data.rfq_workflow?.phase !== "completed" || !!completion && completion.role === "procurement_team" && !!text(completion.by) && !!text(completion.purchase_order) &&
    completion.rfq === record.custom_rfq && completion.quotation === record.custom_supplier_quotation && completion.supplier === (record.custom_supplier || record.party_name) && completion.award === context?.award_id &&
    Number.isFinite(evidenceTime(completion.at)) && evidenceTime(completion.at) >= evidenceTime(finance?.at);
  return data.rfq_workflow?.version === 1 && ["procurement", "completed"].includes(data.rfq_workflow.phase) && rfqClmLegalSigned(record, data) &&
    record.custom_esign_status === "Completed" && data.signatures.some(s => s.file_url === record.custom_executed_contract) &&
    completed && data.approvals.length === 2 && data.approvals.every(row => row.status === "Approved") && !!finance &&
    Number.isFinite(evidenceTime(finance.at)) && evidenceTime(finance.at) >= evidenceTime(signedAt);
}
export function canCoordinateRfqClm(p: AccessPrincipal, record: ClmRecord): boolean {
  const team = exactRole(p, "procurement_team"), manager = exactRole(p, "procurement");
  if (!team && !manager) return false;
  const status = clmStatus("Contract", record);
  return status === "Draft" && !yes(record.custom_final_version_locked) || team && ["Executed", "Active", "Expired", "Terminated"].includes(status) && rfqClmFinanceApproved(record);
}
function allowsRelatedRfqAction(p: AccessPrincipal, parent: ClmRecord, action: ClmActionName): boolean {
  return !isRfqClmContract(parent) || canCoordinateRfqClm(p, parent) ||
    rfqClmFinanceApproved(parent) && ["approve", "reject", "send_back"].includes(action);
}

export function parseClmData(raw: unknown): ClmData {
  if (raw == null || raw === "") return { schema: 1, approvals: [], versions: [], audit: [], signatures: [], sla: [] };
  let data: unknown = raw;
  if (typeof raw === "string") { try { data = JSON.parse(raw); } catch { throw new ClmError("Contract lifecycle evidence could not be read. An administrator must inspect the saved record.", 409); } }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ClmError("Invalid contract lifecycle evidence.", 409);
  const d = data as ClmData;
  if (d.schema !== 1 || ![d.approvals, d.versions, d.audit, d.signatures, d.sla].every(Array.isArray)) throw new ClmError("Unsupported contract lifecycle evidence. Refresh or contact an administrator.", 409);
  if (d.approvals.some(a => !a || !["Pending", "Approved", "Rejected", "Sent Back"].includes(a.status) || !Number.isInteger(a.stage) || a.stage < 0)) throw new ClmError("Invalid saved approval route.", 409);
  if (d.rfq_workflow && (d.rfq_workflow.version !== 1 || !["draft", "legal_review", "signature", "finance_review", "procurement", "completed", "rejected"].includes(d.rfq_workflow.phase))) throw new ClmError("Invalid RFQ Contract workflow evidence.", 409);
  if (d.rfq_request_workflow) {
    const route = d.rfq_request_workflow as ClmRecord;
    if (route.version !== 1 || !["procurement_team", "contract_created", "awaiting_rfq_submission", "awaiting_supplier_award"].includes(String(route.phase)) || route.assigned_role !== "procurement_team" ||
        route.phase === "awaiting_supplier_award" && (route.status !== "Invalidated" || route.current_stage !== "Awaiting Supplier Award") ||
        route.phase === "awaiting_rfq_submission" && (route.status !== "Draft-originated" || route.current_stage !== "Awaiting RFQ Submission")) throw new ClmError("Invalid RFQ Contract Request assignment evidence.", 409);
  }
  return structuredClone(d);
}
function dataForRead(record: ClmRecord): ClmData { try { return parseClmData(record.custom_clm_data); } catch { return parseClmData(null); } }
function hasRfqRequestRouting(record: ClmRecord): boolean {
  if (!isRfqClmContract(record)) return false;
  let raw: unknown = record.custom_clm_data;
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { return false; } }
  return !!raw && typeof raw === "object" && !Array.isArray(raw) && Object.prototype.hasOwnProperty.call(raw, "rfq_request_workflow");
}
function sameIdentity(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown) => text(value).replace(/^(["'])(.*)\1$/, "$2").trim().toLocaleLowerCase();
  return !!canonical(left) && canonical(left) === canonical(right);
}
function supplierOwns(p: AccessPrincipal, record: ClmRecord): boolean {
  if (p.typ !== "supplier" || record.party_type !== "Supplier" || !sameIdentity(record.party_name, p.supplier)) return false;
  return !record.custom_supplier || sameIdentity(record.custom_supplier, p.supplier);
}
function assigned(p: AccessPrincipal, approval: ClmApproval): boolean {
  return p.typ === "internal" && p.role === approval.role && (!approval.user || sameIdentity(approval.user, actor(p)));
}
export function pendingClmApprovals(data: ClmData): ClmApproval[] {
  if (data.approvals.some(a => a.status === "Rejected" || a.status === "Sent Back")) return [];
  const activeRole = data.rfq_workflow?.phase === "legal_review" ? "legal" : data.rfq_workflow?.phase === "finance_review" ? "finance" : undefined;
  if (data.rfq_workflow && !activeRole && !data.termination) return [];
  const pending = data.approvals.filter(a => a.status === "Pending" && (!data.rfq_workflow || data.termination || a.role === activeRole));
  const stage = Math.min(...pending.map(a => a.stage));
  return pending.filter(a => a.stage === stage);
}
export function canReadClm(p: AccessPrincipal, dt: string, record: ClmRecord, parent?: ClmRecord): boolean {
  if (!CLM_DOCTYPES.includes(dt as ClmDoctype)) return false;
  if (dt === "Contract Approval Matrix") return internalRole(p, ["procurement"]);
  if (["Contract Clause", "Contract Template"].includes(dt)) return internalRole(p, [...coordinators, ...reviewerRoles]);
  if (dt === "Contract Request") {
    let data: ClmData;
    if (hasRfqRequestRouting(record)) {
      // Explicit RFQ routing must not fall back to the legacy Manager read policy when malformed.
      try { data = parseClmData(record.custom_clm_data); } catch { return false; }
      if (!data.rfq_request_workflow) return false;
    } else data = dataForRead(record);
    const route = data.rfq_request_workflow as ClmRecord | undefined;
    const assignment = data.approvals.find(row => row.role === "procurement_team" && row.stage === 0 && row.status === "Pending");
    if (isRfqClmContract(record) && ["procurement_team", "awaiting_rfq_submission", "awaiting_supplier_award"].includes(String(route?.phase))) return (exactRole(p, "procurement_team") || exactRole(p, "procurement")) && (!assignment || !assignment.user || sameIdentity(assignment.user, actor(p)));
    return internalRole(p, coordinators);
  }
  if (relatedTypes.includes(dt as ClmDoctype)) {
    if (!parent || text(record.contract) !== text(parent.name)) return false;
    // Internal risk/approval notes never become supplier-visible through a related endpoint.
    if (p.typ === "supplier") return false;
    return canReadClm(p, "Contract", parent) || dataForRead(record).approvals.some(a => assigned(p, a));
  }
  if (dt !== "Contract") return false;
  if (p.typ === "supplier") return supplierOwns(p, record) && !!record.custom_clm_data && !["Draft", "Under Review", "Pending Approval", "Pending Legal", "Rejected"].includes(clmStatus(dt, record));
  if (internalRole(p, coordinators)) return true;
  const data = dataForRead(record);
  if (isRfqClmContract(record) && exactRole(p, "finance") && data.rfq_workflow && data.rfq_workflow.phase !== "draft") return true;
  return data.approvals.some(a => assigned(p, a)) || sameIdentity(record.custom_inteva_signatory, actor(p));
}
function assertRead(p: AccessPrincipal, dt: ClmDoctype, record: ClmRecord, parent?: ClmRecord) {
  if (!canReadClm(p, dt, record, parent)) throw new ClmError(p.typ === "supplier" ? "Supplier access is restricted to assigned contracts." : "You are not an assigned approver for this Contract.", 403);
}
const actionLabels: Record<string, string> = { save: "Save draft", submit: "Submit request", approve: "Approve", reject: "Reject", send_back: "Send Back", create_contract: "Create Contract", submit_review: "Submit for Review", negotiate: "Send to Supplier", supplier_accept: "Accept Contract", supplier_redline: "Submit Redline", new_version: "Create Revised Version", begin_signature: "Request Signatures", sign: "Sign Contract", activate: "Activate Contract", expire: "Mark Expired", request_termination: "Request Termination", close: "Close Contract", record_sla: "Record SLA / KPI", execute: "Execute Change" };
function action(name: ClmAction["action"]): ClmAction { return { action: name, label: name === "finalize_procurement" ? "Create Purchase Order" : actionLabels[name], ...(["reject", "send_back", "supplier_redline", "new_version", "request_termination", "close"].includes(name) ? { requires_comment: true } : {}) }; }
function actionsFor(p: AccessPrincipal, dt: ClmDoctype, record: ClmRecord, data: ClmData): ClmAction[] {
  const status = clmStatus(dt, record);
  const names: ClmAction["action"][] = [];
  const coordinate = internalRole(p, coordinators);
  if (isRfqClmContract(record) && ["Contract", "Contract Request"].includes(dt)) {
    const team = exactRole(p, "procurement_team");
    const preparer = team || exactRole(p, "procurement");
    if (dt === "Contract Request") {
      if (data.rfq_request_workflow) {
        const source = data.rfq_source as ClmRecord | undefined;
        if (["rfq_created", "rfq_awarded"].includes(String(source?.stage)) && source?.prepared !== true) return [];
        return preparer && rfqClmRequestWorkflowView(record) && data.approvals.some(row => row.role === "procurement_team" && row.stage === 0 && row.status === "Pending" && (!row.user || sameIdentity(row.user, actor(p)))) ? [action("create_contract")] : [];
      }
      if (team && status === "Draft") names.push("save", "submit");
      if (team && status === "Pending Review") names.push("approve", "reject", "send_back");
      if (team && status === "Approved" && !data.contract) names.push("create_contract");
    } else {
      if (preparer && status === "Draft" && !yes(record.custom_final_version_locked)) names.push("save", "submit_review");
      // Reuse the existing revision workflow before execution. A regenerated
      // PDF needs its own version and fresh Legal approval/signatures.
      if (preparer && ["Draft", "Approved", "Pending Signature"].includes(status) &&
          (!data.rfq_workflow || ["draft", "signature"].includes(data.rfq_workflow.phase)) &&
          data.signatures.length < 2 && !data.termination && !data.procurement_completion && Number(record.docstatus) !== 2) names.push("new_version");
      if (exactRole(p, "legal") && ["Pending Legal", "Under Review"].includes(status) && pendingClmApprovals(data).some(row => row.role === "legal" && assigned(p, row))) names.push("approve", "reject", "send_back");
      if (isRfqClmSignatureStage(record, data) && exactRole(p, "legal") && sameIdentity(record.custom_inteva_signatory, actor(p)) && status === "Approved" && yes(record.custom_final_version_locked)) names.push("begin_signature");
      const supplierPo = clmSupplierPoWorkflow(record, data, p);
      if (p.typ === "supplier" && supplierOwns(p, record) && supplierPo?.can_accept_contract) names.push("supplier_accept");
      if (isRfqClmSignatureStage(record, data) && status === "Pending Signature" && yes(record.custom_final_version_locked)) {
        if (exactRole(p, "legal") && sameIdentity(record.custom_inteva_signatory, actor(p)) && !data.signatures.some(row => row.party === "inteva")) names.push("sign");
      }
      if (isRfqClmSupplierSignatureStage(record, data) && p.typ === "supplier" && supplierOwns(p, record) && !data.signatures.some(row => row.party === "supplier")) names.push("sign");
      if (exactRole(p, "finance") && status === "Pending Finance" && data.rfq_workflow?.phase === "finance_review" && rfqClmLegalSigned(record, data) && pendingClmApprovals(data).some(row => row.role === "finance" && assigned(p, row))) names.push("approve", "reject", "send_back");
      if (team && status === "Executed" && rfqClmFinanceApproved(record, data)) names.push("activate");
      if (team && status === "Active" && rfqClmFinanceApproved(record, data)) names.push("record_sla", "expire", "request_termination");
      if (team && ["Executed", "Active"].includes(status) && data.rfq_workflow?.phase === "procurement" && rfqClmFinanceApproved(record, data) && !data.procurement_completion) names.push("finalize_procurement");
      if (team && ["Expired", "Terminated"].includes(status)) names.push("close");
    }
    return names.map(name => ({ ...action(name), ...(name === "submit_review" ? { label: "Submit for Legal Review" } : {}) }));
  }
  if (dt === "Contract Request") {
    if (coordinate && ["Draft"].includes(status)) names.push("save", "submit");
    if (internalRole(p, ["procurement"]) && status === "Pending Review") names.push("approve", "reject", "send_back");
    if (coordinate && status === "Approved" && !data.contract) names.push("create_contract");
  } else if (reviewable.has(dt)) {
    if (coordinate && ["Draft", "Negotiation"].includes(status) && !yes(record.custom_final_version_locked)) names.push("save", "submit_review");
    if (pendingClmApprovals(data).some(a => assigned(p, a)) && ["Under Review", "Pending Approval"].includes(status)) names.push("approve", "reject", "send_back");
    if (dt === "Contract") {
      if (coordinate && ["Draft", "Under Review", "Approved", "Pending Signature", "Negotiation"].includes(status)) names.push("negotiate");
      if (coordinate && ["Draft", "Negotiation", "Approved", "Pending Signature"].includes(status)) names.push("new_version");
      if (p.typ === "supplier" && ["Negotiation", "Pending Signature"].includes(status)) names.push("supplier_accept", "supplier_redline");
      if (coordinate && status === "Approved" && yes(record.custom_final_version_locked)) names.push("begin_signature");
      if (status === "Pending Signature" && yes(record.custom_final_version_locked)) {
        if (p.typ === "supplier" && supplierOwns(p, record) && !data.signatures.some(s => s.party === "supplier")) names.push("sign");
        if (p.typ === "internal" && sameIdentity(record.custom_inteva_signatory, actor(p)) && data.signatures.some(s => s.party === "supplier") && !data.signatures.some(s => s.party === "inteva")) names.push("sign");
      }
      if (coordinate && status === "Executed") names.push("activate");
      if (coordinate && status === "Active") names.push("record_sla", "expire", "request_termination");
      if (internalRole(p, ["procurement"]) && ["Expired", "Terminated"].includes(status)) names.push("close");
    } else if (coordinate && status === "Approved") names.push("execute");
  } else if (dt === "Contract Approval Matrix") {
    if (internalRole(p, [])) names.push("save");
  } else if (["Contract Clause", "Contract Template"].includes(dt)) {
    if (internalRole(p, ["legal", "procurement"])) names.push("save");
  } else if (coordinate) names.push("save");
  return [...new Set(names)].map(action);
}

function signatureWorkflow(p: AccessPrincipal, record: ClmRecord, data: ClmData, actions: ClmAction[]): ClmSignatureWorkflow | undefined {
  if (p.typ === "supplier") {
    const workflow = clmSupplierPoWorkflow(record, data, p);
    if (!workflow || !supplierOwns(p, record)) return undefined;
    const canSign = workflow.can_sign_contract && actions.some(row => row.action === "sign");
    const blocked = workflow.blocked_reason || (canSign ? undefined : workflow.signature_status === "Signed" ? "The Supplier signature has already been recorded." : "Accept the current Contract before Supplier E-Signature.");
    return { supplier_status: workflow.signature_status, legal_status: rfqClmLegalSigned(record, data) ? "Signed" : "Pending", is_legal_signatory: false,
      can_sign: canSign, can_review: !!workflow.document_file_id, can_request_signatures: false,
      ...(workflow.document_file_id ? { document_file_id: workflow.document_file_id } : {}), ...(blocked ? { blocked_reason: blocked } : {}) };
  }
  if (p.typ !== "internal" || !(isRfqClmSignatureStage(record, data) || isRfqClmSupplierSignatureStage(record, data) ||
      isRfqClmContract(record) && rfqClmLegalSigned(record, data) && ["finance_review", "procurement", "completed"].includes(data.rfq_workflow?.phase || ""))) return undefined;
  const signed = (party: ClmSignature["party"]) => data.signatures.find(row => row.party === party && row.version === record.custom_current_version &&
    !!text(row.by) && !!text(row.at) && !!text(row.file_id) && text(row.file_url).startsWith("/private/files/") && /^[a-f0-9]{64}$/.test(text(row.hash)));
  const supplier = signed("supplier"), legal = signed("inteva");
  const designated = exactRole(p, "legal") && sameIdentity(record.custom_inteva_signatory, actor(p));
  let document: ReturnType<typeof currentClmPdfEvidence>, documentError: string | undefined;
  try { document = currentClmPdfEvidence(record, data); }
  catch (error) { documentError = error instanceof Error ? error.message : "The current Contract PDF evidence could not be verified."; }
  const canSign = !documentError && designated && actions.some(row => row.action === "sign");
  const canRequest = !documentError && designated && actions.some(row => row.action === "begin_signature");
  const blocked = documentError || (!designated ? "Only the assigned Legal Manager can e-sign this Contract."
    : canSign ? undefined
    : legal ? "The Legal Manager signature has already been recorded."
    : canRequest ? "Request signatures to open the approved Contract for supplier and Legal Manager signing."
    : "Signing is unavailable for the saved Contract state. Refresh and review the current signature evidence.");
  return { supplier_status: supplier ? "Signed" : "Pending", legal_status: legal ? "Signed" : "Pending", is_legal_signatory: designated,
    can_sign: canSign, can_review: designated && !!text(document?.file_id), can_request_signatures: canRequest,
    ...(blocked ? { blocked_reason: blocked } : {}), ...(text(document?.file_id) ? { document_file_id: text(document?.file_id) } : {}) };
}
const supplierFields = new Set(["name", "modified", "doctype", "custom_contract_title", "custom_contract_type", "party_type", "party_name", "start_date", "end_date", "contract_terms", "custom_contract_value", "custom_currency", "custom_contract_status", "custom_esign_status", "custom_current_version", "custom_final_version_locked", "custom_contract_document", "custom_executed_contract", "custom_inteva_signatory", "custom_supplier_signatory_name", "custom_supplier_signed_date", "custom_inteva_signed_date", "custom_part_numbers", "custom_pricing_terms", "custom_delivery_terms", "custom_quality_requirements", "custom_payment_terms_description", "custom_sla__kpi_commitments", "custom_penalties", "custom_incentives", "custom_renewal_terms", "custom_termination_clauses"]);
export const clmSupplierVisibleFields = (): readonly string[] => [...supplierFields];
export function clmSupplierDocuments(data: ClmData): ClmSupplierDocument[] {
  const rows = Array.isArray(data.supplier_documents) ? data.supplier_documents : [];
  return rows.filter((row): row is ClmSupplierDocument => !!row && typeof row === "object" && !!text(row.file_id) && text(row.file_url).startsWith("/private/files/")).map(row => ({ file_id: row.file_id, file_url: row.file_url, file_name: row.file_name, by: row.by, at: row.at, version: row.version }));
}
export function toClmAggregate(p: AccessPrincipal, dt: ClmDoctype, record: ClmRecord, related?: Partial<Record<ClmDoctype, ClmRecord[]>>, parent?: ClmRecord): ClmAggregate {
  const data = dataForRead(record);
  const warnings: string[] = [];
  if (!record.custom_clm_data && ["Contract", "Contract Request"].includes(dt)) warnings.push("Existing record: lifecycle evidence will be initialized only when an authorized action is saved.");
  try { parseClmData(record.custom_clm_data); } catch (error) { warnings.push((error as Error).message); }
  if (p.typ === "supplier") {
    return { doctype: dt, record: Object.fromEntries(Object.entries(record).filter(([key]) => supplierFields.has(key))), actions: actionsFor(p, dt, record, data), approvals: [], versions: data.versions.map(v => ({ ...v, content: Object.fromEntries(Object.entries(v.content).filter(([key]) => supplierFields.has(key))), comment: "", author: "" })), audit: [], signatures: data.signatures, supplier_documents: clmSupplierDocuments(data), warnings,
      ...(dt === "Contract" && clmSupplierPoWorkflow(record, data, p) ? { supplier_workflow: clmSupplierPoWorkflow(record, data, p), signature_workflow: signatureWorkflow(p, record, data, actionsFor(p, dt, record, data)) } : {}) };
  }
  const actions = warnings.some(w => w.includes("could not") || w.includes("Unsupported") || w.includes("Invalid")) ? [] : actionsFor(p, dt, record, data);
  return { doctype: dt, record: dt === "Contract" ? { ...record, clause_ids: data.clause_ids || [], non_standard_clause: data.non_standard_clause === true } : record, actions: parent && relatedTypes.includes(dt) ? actions.filter(row => allowsRelatedRfqAction(p, parent, row.action)) : actions, approvals: data.approvals, versions: data.versions, audit: data.audit, signatures: data.signatures, ...(dt === "Contract" ? { signature_workflow: signatureWorkflow(p, record, data, actions), supplier_workflow: clmSupplierPoWorkflow(record, data, p) } : {}), supplier_documents: clmSupplierDocuments(data), sla: data.sla, related, warnings };
}

const fields = (value: string) => value.split(/\s+/).filter(Boolean);
const contractFields = fields("party_type party_name party_user start_date end_date contract_template contract_terms requires_fulfilment fulfilment_deadline fulfilment_terms document_type document_name custom_contract_title custom_contract_type custom_supplier custom_contract_request custom_rfq custom_supplier_quotation custom_purchase_order custom_project custom_business_unit custom_contract_value custom_currency custom_payment_terms custom_risk_level custom_legal_review_required custom_engineering_review_required custom_quality_review_required custom_compliance_required custom_contract_document custom_inteva_signatory custom_part_numbers custom_renewal_notice_days custom_auto_renewal custom_program_name custom_pricing_terms custom_delivery_terms custom_quality_requirements custom_payment_terms_description custom_sla__kpi_commitments custom_penalties custom_incentives custom_renewal_terms custom_termination_clauses custom_rfp custom_rfp_response");
const editableFields: Record<ClmDoctype, string[]> = {
  Contract: contractFields,
  "Contract Request": fields("department company required_by_date contract_type contract_purpose description supplier supplier_contact contact_email contact_phone supplier_address contract_start_date contract_end_date contract_value currency payment_terms renewal_type notice_period_days auto_renewal legal_review_required legal_reviewer compliance_review_required compliance_notes confidentiality_required nda_required estimated_contract_value budget_available budget_reference cost_center termination_notice_days supporting_document additional_documents document_notes internal_notes custom_rfq custom_supplier_quotation custom_purchase_order custom_project custom_business_unit"),
  "Contract Approval Matrix": fields("rule_name contract_type approval_category minimum_contract_value maximum_contract_value risk_level active procurement_manager_required finance_manager_required legal_manager_required engineering_manager_required quality_manager_required program_manager_required final_approver final_approval_required approval_sequence custom_conditions custom_approval_stages"),
  "Contract Clause": fields("clause_title clause_type description clause_text version risk clause_status standard__fallback approval_required"),
  "Contract Template": fields("title contract_terms requires_fulfilment fulfilment_terms custom_contract_type custom_active"),
  "Contract Risk": fields("contract risk_title risk_description risk_category probability impact risk_level risk_owner mitigation_plan mitigation_status target_resolution resolution_notes risk_status"),
  "Contract Milestone": fields("contract milestone_name milestone_type description planned_date actual_date responsible_person status priority milestone_document comments completion_notes"),
  "Contract Obligation": fields("contract supplier obligation_type obligation category owne due_date completed_date reminder_days_before escalation_days status completion_notes evidence is_critical custom_quantity custom_frequency custom_start_date custom_end_date"),
  "Contract Amendment": fields("contract amendment_title amendment_type amendment_reason amendment_description effective_date previous_terms revised_terms financial_impact revised_contract_value legal_review_required legal_reviewer amendment_document notes"),
  "Contract Renewal": fields("contract renewal_type current_end_date proposed_end_date renewal_reason notice_period_days renewal_notice_date proposed_contract_value revised_terms renewal_conditions renewal_owner legal_review_required legal_reviewer renewal_document notes"),
};
export const clmEditableFields = (dt: ClmDoctype): readonly string[] => [...editableFields[dt], ...(dt === "Contract" ? ["clause_ids", "non_standard_clause"] : [])];
function cleanPayload(dt: ClmDoctype, payload: ClmRecord): ClmRecord {
  const unknown = Object.keys(payload).filter(key => !editableFields[dt].includes(key));
  if (unknown.length) throw new ClmError(`These fields cannot be changed through this action: ${unknown.join(", ")}.`, 403);
  return structuredClone(payload);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function snapshot(dt: ClmDoctype, record: ClmRecord): ClmRecord { return Object.fromEntries(editableFields[dt].filter(f => record[f] !== undefined).map(f => [f, structuredClone(record[f])])); }
const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
export const clmSnapshotHash = (dt: ClmDoctype, record: ClmRecord) => {
  const content = snapshot(dt, record);
  if (dt !== "Contract") return digest(content);
  const data = parseClmData(record.custom_clm_data);
  return digest({ content, clause_ids: data.clause_ids || [], non_standard_clause: data.non_standard_clause === true });
};
function addVersion(dt: ClmDoctype, record: ClmRecord, data: ClmData, p: AccessPrincipal, now: string, comment: string, force = false) {
  const content = snapshot(dt, record); const hash = digest(content);
  const last = data.versions.at(-1);
  if (last?.hash === hash && !force) { data.version = last.id; return; }
  const version = { id: randomUUID(), number: `${data.versions.length + 1}.0`, previous: last?.id, author: actor(p), at: now, comment, hash, content };
  data.versions.push(version); data.version = version.id;
  if (dt === "Contract") record.custom_current_version = version.number;
}
function assertCurrentVersion(dt: ClmDoctype, record: ClmRecord, data: ClmData) {
  const current = data.versions.find(version => version.id === data.version);
  if (!current || current.hash !== digest(snapshot(dt, record))) throw new ClmError("The submitted Contract content changed. Create a new version and repeat the required review.", 409);
}
function resetApprovals(record: ClmRecord, data: ClmData) {
  if (data.approvals.length || data.signatures.length || data.locked_file) {
    const history = Array.isArray(data.review_history) ? data.review_history : [];
    data.review_history = [...history, structuredClone({ version: data.version, approvals: data.approvals, signatures: data.signatures, locked_file: data.locked_file, locked_hash: data.locked_hash })];
  }
  data.approvals = []; data.signatures = []; delete data.locked_hash; delete data.locked_file;
  record.custom_final_version_locked = 0; record.custom_approval_status = "Pending"; record.custom_current_approver = "";
  record.custom_esign_status = "Not Started"; record.custom_executed_contract = ""; record.custom_executed_date = "";
  record.custom_inteva_signed_date = ""; record.custom_supplier_signed_date = ""; record.custom_supplier_signatory_name = "";
  record.is_signed = 0;
}
function parseObject(raw: unknown, label: string): Record<string, unknown> {
  if (raw == null || raw === "") return {};
  let value = raw; if (typeof raw === "string") { try { value = JSON.parse(raw); } catch { throw new ClmError(`${label} is not valid JSON.`); } }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ClmError(`${label} must be a JSON object.`);
  return value as Record<string, unknown>;
}
const matrixFlags: Record<string, string> = { procurement_manager_required: "procurement", finance_manager_required: "finance", legal_manager_required: "legal", engineering_manager_required: "engineering", quality_manager_required: "quality", program_manager_required: "program_manager" };
function matrixStages(rule: ClmRecord): ClmApprovalStage[] {
  const sequence = text(rule.approval_sequence);
  if (!["Sequential", "Parallel", "Hybrid"].includes(sequence)) throw new ClmError(`Approval rule ${rule.name || rule.rule_name} has no valid approval sequence.`);
  let parsed: unknown = rule.custom_approval_stages;
  if (typeof parsed === "string" && parsed.trim()) { try { parsed = JSON.parse(parsed); } catch { throw new ClmError("Approval stages must be valid JSON."); } }
  let stages: ClmApprovalStage[] = [];
  if (parsed && parsed !== "") {
    if (!Array.isArray(parsed) || !parsed.length) throw new ClmError("Approval stages must be a non-empty array.");
    stages = parsed.map((row: Record<string, unknown>) => {
      if (!row || !reviewerRoles.includes(text(row.role)) || !Number.isInteger(row.stage) || Number(row.stage) < 0 || (row.user !== undefined && !text(row.user))) throw new ClmError("Each approval stage needs an existing reviewer role and a non-negative integer stage.");
      return { role: text(row.role), user: text(row.user) || undefined, stage: Number(row.stage) };
    });
  }
  const required = Object.entries(matrixFlags).filter(([field]) => yes(rule[field])).map(([, role]) => role);
  if (!stages.length) {
    if (sequence !== "Parallel" && required.length > 1) throw new ClmError(`Configure the explicit approval stages for ${rule.name || rule.rule_name}; sequential order must follow approved policy.`);
    stages = required.map(role => ({ role, stage: 0 }));
  }
  if (required.some(role => !stages.some(stage => stage.role === role))) throw new ClmError("Configured stages omit an approver required by the Approval Matrix.");
  if (sequence === "Parallel") stages = stages.map(s => ({ ...s, stage: 0 }));
  if (sequence === "Sequential" && new Set(stages.map(s => s.stage)).size !== stages.length) throw new ClmError("Sequential approval requires a separate stage for every approver.");
  if (yes(rule.final_approval_required)) {
    if (!text(rule.final_approver)) throw new ClmError("The Approval Matrix final approver is required.");
    if (!stages.some(s => s.user === rule.final_approver)) throw new ClmError("Include the configured final approver and their existing role in the final approval stage.");
    if (stages.find(s => s.user === rule.final_approver)?.stage !== Math.max(...stages.map(s => s.stage))) throw new ClmError("The configured final approver must be in the final stage.");
  }
  if (!stages.length) throw new ClmError("The matching Approval Matrix must require at least one human approver.");
  return stages;
}
export function generateClmApprovals(contract: ClmRecord, rules: ClmRecord[], context: ClmMatrixConditions = {}): ClmApproval[] {
  const value = Number(contract.custom_contract_value);
  if (!Number.isFinite(value) || value < 0) throw new ClmError("Contract value must be a non-negative number.");
  const rows: ClmApproval[] = [];
  for (const rule of rules.filter(r => yes(r.active))) {
    const conditions = parseObject(rule.custom_conditions, "Approval Matrix conditions");
    const keys = ["business_unit", "currency", "supplier_status", "non_standard_clause", "new_supplier", "purpose"];
    if (Object.keys(conditions).some(key => !keys.includes(key))) throw new ClmError("Approval Matrix contains an unsupported condition.");
    const min = Number(rule.minimum_contract_value || 0); const max = Number(rule.maximum_contract_value || 0);
    if (![min, max].every(Number.isFinite) || min < 0 || max < 0 || max > 0 && max < min) throw new ClmError("Approval Matrix value range is invalid.");
    if ((min > 0 || max > 0) && !text(conditions.currency)) throw new ClmError("Approval Matrix value thresholds require an explicit currency condition; configure the policy currency before review.");
    if (text(rule.contract_type) !== "All" && text(rule.contract_type) !== text(contract.custom_contract_type)) continue;
    if (value < min || max > 0 && value > max) continue;
    if (text(rule.risk_level) && rule.risk_level !== "Any" && rule.risk_level !== contract.custom_risk_level) continue;
    const actual: ClmMatrixConditions = { ...context, currency: text(contract.custom_currency), business_unit: text(contract.custom_business_unit), purpose: context.purpose || "contract" };
    const entries = Object.entries(conditions);
    if (entries.some(([key, expected]) => actual[key as keyof ClmMatrixConditions] !== undefined && actual[key as keyof ClmMatrixConditions] !== expected)) continue;
    const unknown = entries.find(([key]) => actual[key as keyof ClmMatrixConditions] === undefined);
    if (unknown) throw new ClmError(`The Approval Matrix requires verified ${unknown[0].replaceAll("_", " ")} information that is unavailable. Complete its source data before review.`, 409);
    for (const stage of matrixStages(rule)) rows.push({ id: randomUUID(), ...stage, rule: text(rule.name) || text(rule.rule_name), status: "Pending" });
  }
  if (!rows.length) throw new ClmError("No active Contract Approval Matrix matches this contract. Configure an approved policy before submitting for review.", 409);
  const unique = new Map<string, ClmApproval>();
  for (const row of rows) { const key = `${row.stage}:${row.role}:${row.user || ""}`; const previous = unique.get(key); if (previous) previous.rule += `, ${row.rule}`; else unique.set(key, row); }
  return [...unique.values()].sort((a, b) => a.stage - b.stage);
}

async function validateSources(dt: ClmDoctype, record: ClmRecord, deps: ClmDeps) {
  const supplier = dt === "Contract" ? text(record.custom_supplier || record.party_name) : text(record.supplier);
  if (dt === "Contract") {
    if (record.party_type !== "Supplier" || !supplier || !sameIdentity(record.party_name, supplier)) throw new ClmError("Supplier contracts require matching Supplier and party information.");
  }
  if (supplier) { const source = await deps.load("Supplier", supplier); if (!source.name || Number(source.disabled) === 1) throw new ClmError("Select an active Supplier."); }
  const refs: Array<[string, string]> = [["custom_rfq", "Request for Quotation"], ["custom_supplier_quotation", "Supplier Quotation"], ["custom_purchase_order", "Purchase Order"], ["custom_project", "Project"], ["custom_rfp", "RFP"], ["custom_rfp_response", "RFP Response"], ["custom_contract_request", "Contract Request"]];
  for (const [field, sourceType] of refs) {
    const name = text(record[field]); if (!name) continue;
    const source = await deps.load(sourceType, name);
    if (source.name !== name || Number(source.docstatus) === 2) throw new ClmError(`The ${sourceType} reference is unavailable or cancelled.`);
    if (["Supplier Quotation", "Purchase Order", "RFP Response", "Contract Request"].includes(sourceType) && !sameIdentity(source.supplier, supplier)) throw new ClmError(`The ${sourceType} must belong to the selected Supplier.`, 403);
    if (sourceType === "Supplier Quotation" && record.custom_rfq) {
      const items = Array.isArray(source.items) ? source.items as ClmRecord[] : [];
      if (![source.request_for_quotation, ...items.map(i => i.request_for_quotation)].includes(record.custom_rfq)) throw new ClmError("The Supplier Quotation does not belong to the selected RFQ.");
    }
    if (sourceType === "Request for Quotation" && source.custom_selected_supplier && !sameIdentity(source.custom_selected_supplier, supplier)) throw new ClmError("The contract Supplier differs from the RFQ award.");
    if (sourceType === "RFP Response" && source.rfp !== record.custom_rfp) throw new ClmError("The Supplier Response does not belong to the selected RFP.");
    if (sourceType === "Contract Request" && source.request_status !== "Approved" && source.request_status !== "Completed") throw new ClmError("Procurement validation must approve the Contract Request first.");
  }
  if (dt === "Contract" && record.contract_template) {
    const template = await deps.load("Contract Template", text(record.contract_template));
    if (template.custom_active === 0) throw new ClmError("Select an active Contract Template.");
  }
  const from = text(record[dt === "Contract" ? "start_date" : "contract_start_date"]);
  const to = text(record[dt === "Contract" ? "end_date" : "contract_end_date"]);
  if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) || from && to && from > to) throw new ClmError("Enter a valid Contract period with End Date on or after Start Date.");
  if (text(record.custom_rfq)) {
    const errors = validateRfqContractDetails(dt === "Contract" ? {
      contract_type: record.custom_contract_type, contract_purpose: record.custom_contract_title,
      description: record.contract_terms, contract_start_date: from, contract_end_date: to,
    } : record, { requireType: false });
    if (Object.keys(errors).length) throw new ClmError(Object.values(errors).join(" "));
  }
}
function required(record: ClmRecord, fields: string[]) { for (const field of fields) if (record[field] == null || record[field] === "") throw new ClmError(`${field.replaceAll("_", " ")} is required.`); }
function syncCurrent(record: ClmRecord, data: ClmData) { const pending = pendingClmApprovals(data); record.custom_current_approver = pending.length === 1 ? pending[0].user || "" : ""; }
function startRfqFinanceReview(record: ClmRecord, data: ClmData) {
  if (!rfqClmLegalSigned(record, data) || data.approvals.length !== 1 || data.approvals[0].role !== "legal") throw new ClmError("A verified Legal Manager signature and a completed Legal review are required for Finance handoff.", 409);
  const legal = data.signatures.find(row => row.party === "inteva")!;
  data.approvals.push({ id: randomUUID(), role: "finance", stage: 1, rule: "RFQ Award: Finance Approval after Legal Manager E-Signature", status: "Pending" });
  data.rfq_workflow = { version: 1, phase: "finance_review" };
  record.custom_contract_status = "Pending Finance";
  record.custom_approval_status = "Pending";
  record.custom_esign_status = "Completed";
  record.custom_executed_contract = data.signatures.at(-1)!.file_url;
  record.custom_executed_date = "";
  record.is_signed = 1;
  record.signed_on = legal.at;
  syncCurrent(record, data);
}
function requireFresh(input: ClmActionInput, record: ClmRecord) {
  if (!input.expected_modified || input.expected_modified !== record.modified) throw new ClmError("This record changed or its revision was not supplied. Refresh before saving.", 409);
}
function audit(data: ClmData, p: AccessPrincipal, at: string, action: string, from: string, to: string, comment = "", reference?: string, signature?: ClmSignature) {
  data.audit.push({ id: randomUUID(), action, by: actor(p), at, previous_status: from, new_status: to, comment, version: data.version, ...(data.rfq_workflow ? { role: p.typ === "internal" ? p.role : "supplier", reference_id: reference || text((data.rfq_context as ClmRecord | undefined)?.rfq_id) || text((data.rfq_source as ClmRecord | undefined)?.rfq) } : {}),
    ...(signature ? { contract_id: reference, signature_status: "Signed" as const, signature_party: signature.party, signature_file_id: signature.file_id, signature_hash: signature.hash } : {}) });
}
export async function verifyRfqProcurementOrder(record: ClmRecord, data: ClmData, orderName: string, deps: ClmDeps): Promise<ClmRecord> {
  if (!orderName) throw new ClmError("Create and submit the Contract Purchase Order before finalizing procurement.");
  const rfqName = text(record.custom_rfq), quotationName = text(record.custom_supplier_quotation);
  const supplier = text(record.custom_supplier || record.party_name);
  const [rfq, quotation, order] = await Promise.all([
    deps.load("Request for Quotation", rfqName), deps.load("Supplier Quotation", quotationName), deps.load("Purchase Order", orderName),
  ]);
  const source = data.rfq_source as ClmRecord | undefined;
  const context = data.rfq_context as ClmRecord | undefined;
  const operation = data.procurement_order as ClmRecord | undefined;
  const creationKey = createHash("sha256").update([record.name, context?.award_id, quotationName].join("|")).digest("hex");
  if (!operation || operation.state !== "submitted" || !text(operation.id) || !text(operation.by) || operation.role !== "procurement_team" || operation.contract !== record.name || operation.rfq !== rfqName || operation.award !== context?.award_id || operation.quotation !== quotationName || operation.supplier !== supplier || operation.purchase_order !== orderName) throw new ClmError("Finalize through Create Purchase Order for this Contract after its Purchase Order has been submitted.", 409);
  if (order.custom_clm_contract !== record.name || order.custom_clm_rfq !== rfqName || order.custom_clm_award !== context?.award_id || order.custom_clm_creation_key !== creationKey) throw new ClmError("The submitted Purchase Order must retain its persisted Contract, RFQ and Award links.", 409);
  const approval = parseObject(rfq.custom_approval_data, "RFQ approval evidence");
  const decision = approval.contract_decision as ClmRecord | undefined;
  if (rfq.name !== rfqName || rfq.contract_required !== "Yes" || !decision || decision.decision !== "Yes" || decision.contract !== record.name || decision.quotation !== quotationName || decision.supplier !== supplier || text(decision.award || decision.legal_review || decision.quotation) !== text(context?.award_id || source?.award || source?.legal_review || source?.quotation)) throw new ClmError("The saved RFQ award decision does not identify this Contract.", 409);
  const quotationItems = Array.isArray(quotation.items) ? quotation.items as ClmRecord[] : [];
  if (quotation.name !== quotationName || Number(quotation.docstatus) !== 1 || !sameIdentity(quotation.supplier, supplier) || ![quotation.request_for_quotation, ...quotationItems.map(row => row.request_for_quotation)].includes(rfqName)) throw new ClmError("The winning quotation no longer matches this RFQ Contract.", 409);
  const company = text(rfq.company || quotation.company);
  if (!company || rfq.company && quotation.company && rfq.company !== quotation.company) throw new ClmError("The RFQ award company could not be verified.", 409);
  if (order.name !== orderName || Number(order.docstatus) !== 1 || /^(cancelled|canceled|stopped|rejected)$/i.test(text(order.status))) throw new ClmError("Procurement finalization requires a successfully submitted, non-cancelled Purchase Order.", 409);
  if (!sameIdentity(order.supplier, supplier) || order.company !== company || order.currency !== record.custom_currency) throw new ClmError("The Purchase Order must match this Contract's awarded supplier, company and currency.", 409);
  if (!Number.isFinite(Number(order.grand_total)) || Number(order.grand_total) !== Number(record.custom_contract_value)) throw new ClmError("The Purchase Order total must match the saved Contract award amount.", 409);
  const items = Array.isArray(order.items) ? order.items as ClmRecord[] : [];
  const references = [order, ...items].flatMap(row => ["request_for_quotation", "rfq", "rfq_name", "custom_rfq", "custom_rfq_reference"].map(field => text(row[field]))).filter(Boolean);
  if (!items.length || items.some(row => row.supplier_quotation !== quotationName) || references.some(reference => reference !== rfqName)) throw new ClmError("Every Purchase Order item must reference this RFQ's winning quotation.", 409);
  return order;
}
async function persist(dt: ClmDoctype, record: ClmRecord, data: ClmData, deps: ClmDeps, creating = false): Promise<ClmRecord> {
  if (dt === "Contract") {
    const source = data.rfq_source as ClmRecord | undefined;
    if (source?.contract_required === true && source.rfq) {
      if (source.rfq !== record.custom_rfq || source.quotation !== record.custom_supplier_quotation || source.supplier !== (record.custom_supplier || record.party_name) || !text(source.award || source.legal_review || source.quotation)) throw new ClmError("The Contract must preserve its RFQ award context.", 409);
      const context = { rfq_id: text(record.custom_rfq), award_id: text(source.award || source.legal_review || source.quotation), supplier_id: text(record.custom_supplier || record.party_name), quotation_id: text(record.custom_supplier_quotation), contract_type: text(record.custom_contract_type), contract_status: clmStatus(dt, record), contract_required: "Yes" };
      const previous = data.rfq_context as ClmRecord | undefined;
      if (previous && ["rfq_id", "award_id", "supplier_id", "quotation_id", "contract_required"].some(key => previous[key] !== context[key as keyof typeof context])) throw new ClmError("The permanent RFQ award context cannot be changed.", 409);
      data.rfq_context = context;
      data.rfq_workflow ||= { version: 1, phase: "draft" };
    }
  }
  if (["Contract", "Contract Request", "Contract Amendment", "Contract Renewal"].includes(dt)) record.custom_clm_data = JSON.stringify(data);
  return creating ? deps.create(dt, record) : deps.save(dt, record);
}
/** Explicit maintenance repair for receipts saved under the old two-party gate.
 * This is never invoked by a GET and never creates or modifies a signature/PDF. */
export async function repairRfqLegalSignatureHandoff(name: string, expectedModified: string, deps: ClmDeps,
  verifyPdf: (record: ClmRecord, evidence: { file_id: string; file_url: string; hash: string }) => Promise<unknown>): Promise<{ changed: boolean; record: ClmRecord; warnings: string[] }> {
  const record = structuredClone(await deps.load("Contract", name));
  requireFresh({ doctype: "Contract", name, expected_modified: expectedModified, action: "sign" }, record);
  const data = parseClmData(record.custom_clm_data);
  if (data.rfq_workflow?.phase === "finance_review" && record.custom_contract_status === "Pending Finance" && rfqClmLegalSigned(record, data) && data.approvals.filter(row => row.role === "finance" && row.stage === 1 && row.status === "Pending").length === 1 || rfqClmFinanceApproved(record, data)) return { changed: false, record, warnings: [] };
  if (!isRfqClmSignatureStage(record, data) || record.custom_contract_status !== "Pending Signature" || !rfqClmLegalSigned(record, data)) throw new ClmError("This Contract does not have a verified Legal signature awaiting Finance handoff.", 409);
  await requireRfqLegalSignatory(record, deps);
  const locked = data.locked_file as { file_id: string; file_url: string; hash: string } | undefined;
  if (!locked?.file_id || !locked.file_url || !locked.hash) throw new ClmError("The approved Contract PDF evidence is missing.", 409);
  for (const evidence of [locked, ...data.signatures]) await verifyPdf(record, evidence);
  startRfqFinanceReview(record, data);
  const at = deps.now(), by = "system:rfq-legal-finance-handoff";
  const comment = "Reconciled the verified, existing Legal Manager signature with the Legal-to-Finance workflow. Supplier signature remains independently tracked. No document or signature was modified.";
  for (const action of ["legal_signature_handoff_reconciled", "finance_review_started"]) data.audit.push({ id: randomUUID(), action, by, role: "system", at, previous_status: "Pending Signature", new_status: "Pending Finance", comment, version: data.version, reference_id: record.name });
  const saved = await persist("Contract", record, data, deps);
  const warnings = await notifySaved("Contract", saved, { doctype: "Contract", name, action: "sign" }, data, deps);
  return { changed: true, record: saved, warnings };
}
async function routeFor(record: ClmRecord, deps: ClmDeps, purpose: ClmMatrixConditions["purpose"] = "contract") {
  const supplier = await deps.load("Supplier", text(record.custom_supplier || record.party_name));
  const data = parseClmData(record.custom_clm_data);
  const clauseNames = Array.isArray(data.clause_ids) ? data.clause_ids.map(text).filter(Boolean) : [];
  const clauses = await Promise.all(clauseNames.map(name => deps.load("Contract Clause", name)));
  if (clauses.some(c => c.clause_status !== "Active" || c.standard__fallback === "Prohibited")) throw new ClmError("Selected clauses must be Active and must not be Prohibited.");
  const strip = (value: unknown) => text(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const context: ClmMatrixConditions = { purpose, non_standard_clause: data.non_standard_clause === true || clauses.some(c => c.standard__fallback !== "Standard" || !strip(record.contract_terms).includes(strip(c.clause_text))) };
  // The RFQ integration has an explicit sequential policy. Generic matrices
  // still govern standalone CLM; they cannot put Finance ahead of signatures.
  if (isRfqClmContract(record) && purpose === "contract") return [{ id: randomUUID(), role: "legal", stage: 0, rule: "RFQ Award: Legal Manager Review", status: "Pending" as const }];
  const rules = await deps.list("Contract Approval Matrix", [["active", "=", 1]]);
  const conditions = rules.map(r => parseObject(r.custom_conditions, "Approval Matrix conditions"));
  if (conditions.some(c => c.supplier_status !== undefined)) {
    const onboarding = await deps.list("Supplier Onboarding", [["linked_supplier", "=", supplier.name]]);
    const latest = [...onboarding].sort((a, b) => text(b.creation).localeCompare(text(a.creation)))[0];
    if (latest && text(latest.status)) context.supplier_status = text(latest.status);
  }
  if (conditions.some(c => c.new_supplier !== undefined)) {
    const history = await deps.list("Contract", [["party_type", "=", "Supplier"], ["party_name", "=", supplier.name]]);
    context.new_supplier = !history.some(c => c.name !== record.name && (["Executed", "Active", "Expired", "Terminated", "Closed"].includes(clmStatus("Contract", c)) || yes(c.is_signed)));
  }
  const rfqSource = parseClmData(record.custom_clm_data).rfq_source as ClmRecord | undefined;
  const rfqAward = context.purpose === "contract" && !!text(record.custom_rfq) && rfqSource?.rfq === record.custom_rfq && rfqSource?.contract_required === true;
  // RFQ awards always require the existing Legal Manager role. Keep configured
  // approvals, and use this explicit RFQ policy on sites with no CLM matrix yet.
  // Standalone CLM still requires its configured matrix.
  const approvals = rfqAward && !rules.some(rule => yes(rule.active)) ? [] : generateClmApprovals(record, rules, context);
  if (rfqAward && !approvals.some(row => row.role === "legal")) {
    // Legal precedes any additional policy stages; a configured final approver
    // must stay final, and parallel reviewers must remain in the same stage.
    for (const row of approvals) row.stage += 1;
    approvals.unshift({ id: randomUUID(), role: "legal", stage: 0, rule: "RFQ Award: Legal Manager Review", status: "Pending" });
  }
  // Rules refer to existing app roles; a configured named user must actually hold that role.
  for (const row of approvals.filter(a => !!a.user)) {
    const user = await deps.load("User", row.user!);
    if (Number(user.enabled) !== 1) throw new ClmError(`The configured approver ${row.user} is not enabled.`);
    const roles = Array.isArray(user.roles) ? (user.roles as ClmRecord[]).map(r => text(r.role)) : [];
    if (resolveServerRole({ name: text(user.name), email: text(user.email || user.name), erpnext_roles: roles }) !== row.role) throw new ClmError(`The configured approver ${row.user} does not hold the required ${row.role} role.`);
  }
  return approvals;
}
async function requireRfqLegalSignatory(record: ClmRecord, deps: ClmDeps): Promise<void> {
  const user = await deps.load("User", text(record.custom_inteva_signatory));
  const roles = Array.isArray(user.roles) ? (user.roles as ClmRecord[]).map(row => text(row.role)) : [];
  if (Number(user.enabled) !== 1 || resolveServerRole({ name: text(user.name), email: text(user.email || user.name), erpnext_roles: roles }) !== "legal") throw new ClmError("Select an enabled Legal Manager as the RFQ Contract's company signatory.", 409);
}
function contractFromRequest(request: ClmRecord): ClmRecord {
  return {
    party_type: "Supplier", party_name: request.supplier, custom_supplier: request.supplier,
    custom_contract_request: request.name, custom_contract_title: request.contract_purpose,
    custom_contract_type: request.contract_type, contract_terms: request.description,
    start_date: request.contract_start_date, end_date: request.contract_end_date,
    custom_contract_value: request.contract_value, custom_currency: request.currency,
    custom_payment_terms_description: request.payment_terms, custom_renewal_notice_days: request.notice_period_days,
    custom_auto_renewal: request.auto_renewal, custom_legal_review_required: request.legal_review_required,
    custom_contract_status: "Draft", custom_approval_status: "Pending",
    custom_esign_status: "Not Started", ...Object.fromEntries(["custom_rfq", "custom_supplier_quotation", "custom_purchase_order", "custom_project", "custom_business_unit", "custom_rfp", "custom_rfp_response"].filter(k => request[k]).map(k => [k, request[k]])),
  };
}
async function authoringPayload(payload: ClmRecord, data: ClmData, deps: ClmDeps): Promise<ClmRecord> {
  const result = { ...payload };
  if ("clause_ids" in result) {
    if (!Array.isArray(result.clause_ids) || result.clause_ids.some(value => !text(value))) throw new ClmError("Choose valid Contract Clause identifiers.");
    const names = [...new Set(result.clause_ids.map(text))];
    for (const name of names) { const clause = await deps.load("Contract Clause", name); if (clause.clause_status !== "Active" || clause.standard__fallback === "Prohibited") throw new ClmError("Only Active, permitted clauses can be selected."); }
    data.clause_ids = names; delete result.clause_ids;
  }
  if ("non_standard_clause" in result) {
    if (typeof result.non_standard_clause !== "boolean") throw new ClmError("The non-standard clause declaration must be a boolean.");
    data.non_standard_clause = result.non_standard_clause; delete result.non_standard_clause;
  }
  return result;
}
async function supplierSupportingDocuments(input: unknown, record: ClmRecord, data: ClmData, principal: AccessPrincipal, deps: ClmDeps): Promise<ClmSupplierDocument[]> {
  if (input === undefined) return [];
  if (principal.typ !== "supplier" || !supplierOwns(principal, record)) throw new ClmError("Supplier access is restricted to assigned contracts.", 403);
  if (!Array.isArray(input) || input.length > 20 || input.some(value => !text(value))) throw new ClmError("Select up to twenty valid supporting document File IDs.");
  const receipts = Array.isArray(data.supplier_uploads) ? data.supplier_uploads as ClmRecord[] : [];
  const result: ClmSupplierDocument[] = [];
  for (const id of new Set(input.map(text))) {
    const receipt = receipts.find(row => row.file_id === id && sameIdentity(row.supplier, principal.supplier) && sameIdentity(row.by, principal.sub));
    if (!receipt) throw new ClmError("This supporting document was not uploaded by your supplier session for this Contract.", 403);
    const file = await deps.load("File", id);
    const path = canonicalErpFilePath(text(file.file_url));
    if (file.name !== id || Number(file.is_private) !== 1 || yes(file.is_folder) || file.attached_to_doctype !== "Contract" || file.attached_to_name !== record.name || !path?.startsWith("/private/files/") || path !== canonicalErpFilePath(text(receipt.file_url))) throw new ClmError("The supporting document must be a private attachment of this Contract.", 403);
    result.push({ file_id: id, file_url: path, file_name: text(file.file_name) || text(receipt.file_name), by: text(receipt.by), at: text(receipt.at), version: data.version });
  }
  return result;
}
async function notifySaved(dt: ClmDoctype, record: ClmRecord, input: ClmActionInput, data: ClmData, deps: ClmDeps): Promise<string[]> {
  try { await deps.notify?.(dt, record, input.action, pendingClmApprovals(data)); return []; }
  catch { return ["The action was saved, but reviewer notification could not be delivered. Refresh the assignment queue and ask an administrator to retry notification delivery."]; }
}
function defaults(dt: ClmDoctype, p: AccessPrincipal, now: string): ClmRecord {
  if (dt === "Contract") return { party_type: "Supplier", custom_contract_status: "Draft", custom_approval_status: "Pending", custom_esign_status: "Not Started", custom_risk_level: "Low" };
  if (dt === "Contract Request") return { requester: actor(p), request_date: now.slice(0, 10), request_status: "Draft", approval_status: "Pending" };
  if (dt === "Contract Amendment") return { amendment_status: "Draft", approval_status: "Pending", requested_by: actor(p), request_date: now.slice(0, 10) };
  if (dt === "Contract Renewal") return { renewal_status: "Draft", approval_status: "Pending", renewal_owner: actor(p) };
  if (dt === "Contract Risk") return { identified_by: actor(p), identified_date: now.slice(0, 10), risk_status: "Open" };
  return {};
}
async function relatedChange(input: ClmActionInput, p: AccessPrincipal, deps: ClmDeps, record: ClmRecord, parent: ClmRecord, data: ClmData): Promise<ClmAggregate | null> {
  if (!["Contract Amendment", "Contract Renewal"].includes(input.doctype)) return null;
  const dt = input.doctype; const status = clmStatus(dt, record); const at = deps.now(); const comment = text(input.comment);
  if (input.action === "submit_review") {
    const routing = { ...parent, custom_contract_value: record.revised_contract_value ?? record.proposed_contract_value ?? parent.custom_contract_value };
    data.approvals = await routeFor(routing, deps, dt === "Contract Amendment" ? "amendment" : "renewal");
    addVersion(dt, record, data, p, at, comment); record[statusField(dt)] = "Under Review";
  } else if (["approve", "reject", "send_back"].includes(input.action)) {
    assertCurrentVersion(dt, record, data);
    const row = pendingClmApprovals(data).find(a => assigned(p, a));
    if (!row) throw new ClmError("You are not an assigned approver for this Contract.", 403);
    row.status = input.action === "approve" ? "Approved" : input.action === "reject" ? "Rejected" : "Sent Back";
    row.by = actor(p); row.at = at; row.comment = comment;
    if (input.action !== "approve") { record[statusField(dt)] = input.action === "reject" ? "Rejected" : "Draft"; record.approval_status = input.action === "reject" ? "Rejected" : "Pending"; }
    else if (data.approvals.every(a => a.status === "Approved")) { record[statusField(dt)] = "Approved"; record.approval_status = "Approved"; record.approved_by = actor(p); record.approval_date = at.slice(0, 10); }
  } else if (input.action === "execute") {
    if (!data.approvals.length || data.approvals.some(a => a.status !== "Approved")) throw new ClmError("Required approval is still pending.");
    if (!data.result_contract) {
      const derived: ClmRecord = { ...snapshot("Contract", parent), custom_contract_document: "", custom_contract_status: "Draft", custom_approval_status: "Pending", custom_esign_status: "Not Started", custom_risk_level: parent.custom_risk_level || "Low" };
      if (dt === "Contract Renewal") { derived.end_date = record.proposed_end_date; derived.contract_terms = record.revised_terms || parent.contract_terms; if (record.proposed_contract_value != null) derived.custom_contract_value = record.proposed_contract_value; }
      else { derived.contract_terms = record.revised_terms; if (record.revised_contract_value != null) derived.custom_contract_value = record.revised_contract_value; }
      const nextData = parseClmData(null); nextData.source_contract = parent.name; nextData.source_change = { doctype: dt, name: record.name }; addVersion("Contract", derived, nextData, p, at, `${dt} ${record.name}`);
      audit(nextData, p, at, "create_from_change", "", "Draft", comment);
      const created = await persist("Contract", derived, nextData, deps, true);
      data.result_contract = created.name;
      audit(data, p, at, "created_revision_contract", status, status, String(created.name));
      await persist(dt, record, data, deps);
      return toClmAggregate(p, "Contract", created);
    }
    const result = await deps.load("Contract", text(data.result_contract));
    const resultData = parseClmData(result.custom_clm_data);
    if (!["Executed", "Active"].includes(clmStatus("Contract", result)) || resultData.signatures.length !== 2 || !result.custom_executed_contract) throw new ClmError("The revised Contract must complete its required approvals and both signatures before this change is Executed.");
    record[statusField(dt)] = "Executed"; record.execution_date = at.slice(0, 10);
  } else return null;
  audit(data, p, at, input.action, status, clmStatus(dt, record), comment);
  const saved = await persist(dt, record, data, deps);

  const result = toClmAggregate(p, dt, saved, undefined, parent);
  result.warnings = [...(result.warnings || []), ...await notifySaved(dt, saved, input, data, deps)];
  return result;
}

/** All decisions derive identity, stages and timestamps on the server. */
export async function applyClmAction(input: ClmActionInput, p: AccessPrincipal, deps: ClmDeps): Promise<ClmAggregate> {
  const dt = input.doctype;
  if (!CLM_DOCTYPES.includes(dt)) throw new ClmError("Unsupported Contract document type.", 400);
  const creating = !input.name; const at = deps.now(); const comment = text(input.comment); const payload = input.payload || {};
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new ClmError("Invalid action payload.", 400);
  if (creating && input.action !== "save") throw new ClmError("Save a draft before performing this action.");
  let record: ClmRecord = creating ? defaults(dt, p, at) : structuredClone(await deps.load(dt, input.name!));
  // Recover a successful response lost in transit without duplicate acceptance
  // audits or a second PDF. Only the same authenticated, version-bound action
  // qualifies; all other stale writes retain the normal conflict check.
  if (!creating && dt === "Contract" && p.typ === "supplier" && canReadClm(p, dt, record)) {
    const saved = parseClmData(record.custom_clm_data), workflow = clmSupplierPoWorkflow(record, saved, p), acceptance = saved.supplier_po_acceptance;
    if (input.action === "supplier_accept" && workflow?.acceptance_status === "Accepted" && acceptance && sameIdentity(acceptance.by, actor(p)) &&
        payload.consent === true && payload.expected_version === acceptance.version && payload.document_file_id === acceptance.file_id && payload.document_hash === acceptance.hash) return toClmAggregate(p, dt, record);
    const signature = saved.signatures.find(row => row.party === "supplier");
    const mark = payload.signature && typeof payload.signature === "object" ? payload.signature as ClmRecord : {};
    if (input.action === "sign" && workflow?.can_accept_po && signature && text(payload.request_id) && signature.request_id === text(payload.request_id) && sameIdentity(signature.by, actor(p)) &&
        signature.full_legal_name === text(payload.full_legal_name) && text(signature.signatory_role) === text(payload.signatory_role) && signature.typed_name === text(mark.value) && mark.method === "typed" && mark.adopted === true && payload.consent === true &&
        (signature.signer_email_source !== "supplier_declared" || signature.signer_email === text(payload.signer_email).toLowerCase())) return toClmAggregate(p, dt, record);
  }
  if (!creating) requireFresh(input, record);
  let parent: ClmRecord | undefined;
  if (relatedTypes.includes(dt)) {
    const parentName = text(record.contract || payload.contract);
    if (!parentName) throw new ClmError("A parent Contract is required.");
    parent = await deps.load("Contract", parentName);
    if (!allowsRelatedRfqAction(p, parent, input.action)) throw new ClmError("RFQ Contract authoring belongs to Procurement Team and is unavailable while Legal or Finance review is active.", 403);
    if (payload.contract && payload.contract !== parentName) throw new ClmError("A related record cannot be moved to another Contract.", 403);
    if (!canReadClm(p, "Contract", parent) && !(p.typ === "internal" && dataForRead(record).approvals.some(a => assigned(p, a)))) throw new ClmError("You cannot access this parent Contract.", 403);
  }
  if (creating) {
    if (dt === "Contract Approval Matrix" ? !internalRole(p, []) : ["Contract Clause", "Contract Template"].includes(dt) ? !internalRole(p, ["legal", "procurement"]) : !internalRole(p, coordinators)) throw new ClmError("Your role cannot create this Contract record.", 403);
  } else assertRead(p, dt, record, parent);
  let data = parseClmData(record.custom_clm_data);
  const from = clmStatus(dt, record);
  if (!creating && !actionsFor(p, dt, record, data).some(a => a.action === input.action)) throw new ClmError(input.action === "approve" ? "You are not an assigned approver for this Contract." : "This action is not available in the current Contract stage.", 403);
  if (!creating && dt === "Contract Request" && data.rfq_request_workflow) throw new ClmError("Create this RFQ Contract through the RFQ award transaction so the request, Contract and RFQ links are saved together.", 409);
  if (["reject", "send_back", "supplier_redline", "new_version", "request_termination", "close"].includes(input.action) && !comment) throw new ClmError("A decision rationale or comment is required.");

  if (input.action === "save") {
    record = { ...record, ...cleanPayload(dt, dt === "Contract" ? await authoringPayload(payload, data, deps) : payload) };
    if (dt === "Contract" || dt === "Contract Request") {
      if (dt === "Contract" && !record.party_name && record.custom_supplier) record.party_name = record.custom_supplier;
      await validateSources(dt, record, deps);
      if (dt === "Contract") { required(record, ["contract_terms", "custom_contract_title", "custom_contract_type", "custom_currency"]); addVersion(dt, record, data, p, at, comment); }
      else if (data.rfq_source) data.rfq_source = { ...data.rfq_source as ClmRecord, company: record.company, department: record.department };
    }
    if (dt === "Contract Approval Matrix") {
      matrixStages(record);
      const conditions = parseObject(record.custom_conditions, "Approval Matrix conditions") as ClmMatrixConditions;
      generateClmApprovals({ custom_contract_value: Number(record.minimum_contract_value || 0), custom_contract_type: record.contract_type === "All" ? "Other" : record.contract_type, custom_risk_level: record.risk_level, custom_currency: conditions.currency || "", custom_business_unit: conditions.business_unit || "" }, [{ ...record, active: 1 }], conditions);
    }
    if (dt === "Contract Obligation" && !sameIdentity(record.supplier, parent?.custom_supplier || parent?.party_name)) throw new ClmError("The obligation Supplier must match the parent Contract.");
    if (dt === "Contract Milestone" && record.status === "Completed") { record.completed_by = actor(p); record.completion_date = at.slice(0, 10); }
    if (dt === "Contract Obligation" && record.status === "Completed") { required(record, ["completion_notes"]); record.completed_date = at.slice(0, 10); }
    if (["Contract Amendment", "Contract Renewal"].includes(dt) && parent && !["Active", "Expired"].includes(clmStatus("Contract", parent))) throw new ClmError("Amendments and renewals require an Active or Expired parent Contract.");
    audit(data, p, at, creating ? "create" : "save", from, clmStatus(dt, record), comment);
    const saved = await persist(dt, record, data, deps, creating);
    return toClmAggregate(p, dt, saved, undefined, parent);
  }
  if (parent) { const changed = await relatedChange(input, p, deps, record, parent, data); if (changed) return changed; }
  if (dt === "Contract Request") {
    if (input.action === "submit") {
      required(record, ["department", "company", "contract_type", "contract_purpose", "description", "supplier", "contract_start_date", "contract_end_date", "contract_value", "currency"]);
      await validateSources(dt, record, deps); record.request_status = "Pending Review"; record.submitted_by = actor(p); record.submission_date = at;
    } else if (input.action === "approve") { record.request_status = "Approved"; record.approval_status = "Approved"; record.approved_by = actor(p); record.approval_date = at; record.approval_comments = comment; }
    else if (input.action === "reject") { record.request_status = "Rejected"; record.approval_status = "Rejected"; record.rejection_reason = comment; }
    else if (input.action === "send_back") { record.request_status = "Draft"; record.approval_status = "Pending"; record.approval_comments = comment; }
    else if (input.action === "create_contract") {
      const existing = await deps.list("Contract", [["custom_contract_request", "=", record.name]]);
      if (existing.length) throw new ClmError(`This request already has Contract ${existing[0].name}. Open that record.`, 409);
      const next = { ...contractFromRequest(record), ...cleanPayload("Contract", payload) };
      if (!["Low", "Medium", "High", "Critical"].includes(text(next.custom_risk_level))) throw new ClmError("Assess and select the Contract risk level before creating the Contract from this request.");
      if (next.custom_contract_request !== record.name || !sameIdentity(next.custom_supplier, record.supplier)) throw new ClmError("Contract creation must preserve the validated Request and Supplier.");
      await validateSources("Contract", next, deps);
      const nextData = parseClmData(null);
      if (data.rfq_source) nextData.rfq_source = { ...structuredClone(data.rfq_source) as ClmRecord, company: record.company, department: record.department };
      if (data.source_documents) nextData.source_documents = structuredClone(data.source_documents);
      if (isRfqClmContract(next)) nextData.rfq_workflow = { version: 1, phase: "draft" };
      addVersion("Contract", next, nextData, p, at, comment); audit(nextData, p, at, "create_from_request", "", "Draft", comment);
      const created = await persist("Contract", next, nextData, deps, true);
      data.contract = created.name; record.request_status = "Completed"; audit(data, p, at, "create_contract", from, "Completed", String(created.name));
      await persist(dt, record, data, deps);
      return toClmAggregate(p, "Contract", created);
    }
  } else if (dt === "Contract") {
    const rfqContract = isRfqClmContract(record);
    if (input.action === "submit_review") {
      required(record, ["contract_terms", "custom_contract_title", "custom_contract_type", "custom_currency", "custom_risk_level", "start_date", "end_date", "custom_inteva_signatory"]);
      if (!["Low", "Medium", "High", "Critical"].includes(text(record.custom_risk_level))) throw new ClmError("Select a valid assessed Contract risk level before review.");
      await validateSources(dt, record, deps);
      if (rfqContract) await requireRfqLegalSignatory(record, deps);
      const route = await routeFor(record, deps);
      resetApprovals(record, data); data.approvals = route; addVersion(dt, record, data, p, at, comment);
      if (rfqContract) data.rfq_workflow = { version: 1, phase: "legal_review" };
      record.custom_contract_status = rfqContract ? "Pending Legal" : "Under Review"; record.custom_approval_status = "Pending"; syncCurrent(record, data);
    } else if (["approve", "reject", "send_back"].includes(input.action)) {
      assertCurrentVersion(dt, record, data);
      const row = pendingClmApprovals(data).find(a => assigned(p, a));
      if (!row) throw new ClmError("You are not an assigned approver for this Contract.", 403);
      row.status = input.action === "approve" ? "Approved" : input.action === "reject" ? "Rejected" : "Sent Back";
      row.by = actor(p); row.at = at; row.comment = comment; record.custom_approval_comments = comment;
      if (rfqContract && data.termination) {
        data.termination_decision = { ...data.termination, decision: row.status, approval: structuredClone(row) };
        delete data.termination;
        data.approvals = structuredClone(data.prior_approvals as ClmApproval[]);
        delete data.prior_approvals;
        data.rfq_workflow = { version: 1, phase: data.procurement_completion ? "completed" : "procurement" };
        record.custom_contract_status = input.action === "approve" ? "Terminated" : "Active";
        record.custom_approval_status = "Approved";
      } else if (rfqContract && input.action !== "approve") {
        if (input.action === "send_back") {
          resetApprovals(record, data);
          record.custom_contract_status = "Draft";
          data.rfq_workflow = { version: 1, phase: "draft" };
        } else {
          record.custom_approval_status = "Rejected"; record.custom_contract_status = "Rejected";
          data.rfq_workflow = { version: 1, phase: "rejected" };
        }
      } else if (rfqContract && !data.termination && from === "Pending Finance" && input.action === "approve") {
        data.rfq_workflow = { version: 1, phase: "procurement" };
        if (!rfqClmFinanceApproved(record, data)) throw new ClmError("Finance approval requires the completed Legal review and verified Legal Manager signature on this Contract version.", 409);
        record.custom_approval_status = "Approved"; record.custom_approved_on = at;
        record.custom_contract_status = "Executed";
        record.custom_executed_date = at.slice(0, 10);
      } else if (input.action !== "approve") {
        record.custom_approval_status = row.status;
        record.custom_contract_status = data.termination ? "Active" : "Draft";
        if (data.termination) { data.termination_decision = { ...data.termination, decision: row.status }; delete data.termination; }
      } else if (data.approvals.length && data.approvals.every(a => a.status === "Approved")) {
        if (data.termination) { record.custom_contract_status = "Terminated"; data.termination_decision = { ...data.termination, decision: "Approved" }; delete data.termination; }
        else {
          if (!deps.lock) throw new ClmError("Contract signing storage is not configured.", 503);
          data.locked_hash = clmSnapshotHash(dt, record);
          data.locked_file = await deps.lock({ ...record, custom_clm_data: JSON.stringify(data) }, p);
          record.custom_final_version_locked = 1; record.custom_contract_status = "Approved";
          if (rfqContract) data.rfq_workflow = { version: 1, phase: "signature" };
        }
        record.custom_approval_status = "Approved"; record.custom_approved_on = at;
      }
      syncCurrent(record, data);
    } else if (input.action === "negotiate") {
      if (data.signatures.length > 1) throw new ClmError("Executed signatures require a formal amendment; they cannot be discarded.");
      record.custom_contract_status = "Negotiation"; data.negotiation = "Pending Supplier";
    } else if (input.action === "supplier_accept") {
      const workflow = clmSupplierPoWorkflow(record, data, p);
      if (workflow) {
        if (p.typ !== "supplier" || !workflow.can_accept_contract) throw new ClmError("Only the owning Supplier may accept the current Contract before signing.", 403);
        await verifyClmSupplierPoSource(p, record, data, deps);
        const document = currentClmPdfEvidence(record, data);
        if (payload.consent !== true || !document || payload.expected_version !== document.version || payload.document_file_id !== document.file_id || payload.document_hash !== document.hash) throw new ClmError("Review the current Contract PDF and explicitly accept its terms before signing.", 422);
        if (!deps.verifyPdf) throw new ClmError("Contract document verification is unavailable. Acceptance has not been recorded.", 503);
        await deps.verifyPdf(record, document);
        data.supplier_po_acceptance = { id: randomUUID(), status: "Accepted", contract: String(record.name), purchase_order: workflow.purchase_order, supplier: String(record.custom_supplier || record.party_name), by: actor(p), at,
          version: document.version, file_id: document.file_id, file_url: document.file_url, hash: document.hash, consent: true, ...(text(payload.request_id) ? { request_id: text(payload.request_id) } : {}) };
      } else {
        data.negotiation = "Accepted";
        if (from === "Negotiation") { resetApprovals(record, data); record.custom_contract_status = "Draft"; }
      }
    } else if (input.action === "supplier_redline" || input.action === "new_version") {
      if (data.signatures.length > 1) throw new ClmError("Executed versions require a formal amendment.");
      if (input.action === "supplier_redline" && Object.keys(payload).some(k => !["contract_terms", "supporting_documents"].includes(k))) throw new ClmError("Suppliers may propose redlined Contract terms and their supporting documents only.", 403);
      const documents = input.action === "supplier_redline" ? await supplierSupportingDocuments(payload.supporting_documents, record, data, p, deps) : [];
      if (input.action === "supplier_redline" && !text(payload.contract_terms) && !documents.length) throw new ClmError("Provide proposed Contract terms or supporting documents for your negotiation response.");
      const changes = { ...payload }; delete changes.supporting_documents;
      if (input.action === "supplier_redline" && !text(changes.contract_terms)) delete changes.contract_terms;
      // Snapshot the prior version before any proposed changes; never mutate historical content.
      addVersion(dt, record, data, p, at, "Previous version");
      record = { ...record, ...cleanPayload(dt, input.action === "new_version" ? await authoringPayload(changes, data, deps) : changes) };
      if (input.action === "new_version") await validateSources(dt, record, deps);
      resetApprovals(record, data); record.custom_contract_status = input.action === "supplier_redline" ? "Negotiation" : "Draft";
      if (rfqContract && input.action === "new_version") {
        data.rfq_workflow = { version: 1, phase: "draft" };
        record.signed_by_company = ""; record.signed_on = "";
      }
      if (input.action === "supplier_redline") data.negotiation = "Redlined";
      addVersion(dt, record, data, p, at, comment, documents.length > 0 || rfqContract && input.action === "new_version");
      if (documents.length) {
        const prior = clmSupplierDocuments(data);
        data.supplier_documents = [...prior, ...documents.filter(doc => !prior.some(old => old.file_id === doc.file_id)).map(doc => ({ ...doc, version: data.version }))];
      }
    } else if (input.action === "begin_signature") {
      if (rfqContract) {
        await requireRfqLegalSignatory(record, deps);
        if (data.approvals.length !== 1 || data.approvals[0].role !== "legal") throw new ClmError("Submit this RFQ Contract through Legal review before requesting signatures.", 409);
        data.rfq_workflow = { version: 1, phase: "signature" };
      }
      if (!data.approvals.length || data.approvals.some(a => a.status !== "Approved") || !data.locked_file || data.locked_hash !== clmSnapshotHash(dt, record)) throw new ClmError("All required approvals and a locked final version must be completed before signature.", 409);
      record.custom_contract_status = "Pending Signature"; record.custom_esign_status = "Pending Supplier";
    } else if (input.action === "sign") {
      if (!deps.sign) throw new ClmError("Contract signing is not configured.", 503);
      const signatureInput = validateClmSignatureInput(record, p, payload);
      const party = p.typ === "supplier" ? "supplier" : "inteva";
      const optionalSupplier = rfqContract && party === "supplier" && isRfqClmSupplierSignatureStage(record, data);
      const supplierPo = party === "supplier" ? clmSupplierPoWorkflow(record, data, p) : undefined;
      let supplierEmail: { email: string; source: "registered_supplier_account" | "supplier_declared" } | undefined;
      if (supplierPo) {
        if (!supplierPo.can_sign_contract || !data.supplier_po_acceptance) throw new ClmError("Accept the current Contract before Supplier E-Signature.", 409);
        if (payload.signatory_role !== undefined && typeof payload.signatory_role !== "string" || text(payload.signatory_role).length > 120) throw new ClmError("Use a signatory role or job title of up to 120 characters.", 422);
        await verifyClmSupplierPoSource(p, record, data, deps);
        let email = text(payload.signer_email).toLowerCase();
        supplierEmail = { email, source: "supplier_declared" };
        if (p.typ === "supplier" && p.onboarding) {
          const profile = await deps.load("Supplier Onboarding", p.onboarding);
          if (profile.name !== p.onboarding || !sameIdentity(profile.linked_supplier, p.supplier)) throw new ClmError("The supplier signing account could not be verified.", 403);
          if (text(profile.email)) supplierEmail = { email: text(profile.email).toLowerCase(), source: "registered_supplier_account" };
          email = supplierEmail.email;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new ClmError("Enter a valid signer email address.", 422);
      }
      if (data.locked_hash !== clmSnapshotHash(dt, record) || !data.approvals.length || (!optionalSupplier && data.approvals.some(a => a.status !== "Approved"))) throw new ClmError("The approved Contract version changed. Review is required before signing.", 409);
      if (rfqContract && party === "inteva") {
        if (!exactRole(p, "legal")) throw new ClmError("Only the designated Legal Manager may sign this RFQ Contract.", 403);
        await requireRfqLegalSignatory(record, deps);
      }
      if (data.signatures.some(s => s.party === party)) throw new ClmError("This party has already signed this Contract version.", 409);
      const signed = await deps.sign(record, p, payload);
      if (signed.party !== party || !sameIdentity(signed.by, actor(p)) || signed.version !== record.custom_current_version || !signed.file_id || !signed.file_url.startsWith("/private/files/") || !/^[a-f0-9]{64}$/.test(signed.hash)) throw new ClmError("The signed Contract evidence could not be verified.", 502);
      if (signatureInput.signature_method && (signed.typed_name !== signatureInput.typed_name || signed.full_legal_name !== signatureInput.full_legal_name || signed.signature_method !== signatureInput.signature_method || signed.signature_adopted !== true)) throw new ClmError("The captured signature evidence could not be verified. Refresh before retrying.", 502);
      if (rfqContract) {
        const approval = data.approvals.find(row => row.role === "legal" && row.stage === 0 && row.status === "Approved" && row.by);
        const previousAt = data.signatures.at(-1)?.at || approval?.at;
        if ((!optionalSupplier && data.approvals.length !== 1) || !approval || !Number.isFinite(evidenceTime(approval.at)) || !Number.isFinite(evidenceTime(signed.at)) || evidenceTime(signed.at) < evidenceTime(approval.at) || !Number.isFinite(evidenceTime(previousAt)) || evidenceTime(signed.at) < evidenceTime(previousAt)) throw new ClmError("Signatures must follow the approved Legal review on the current version.", 409);
      }
      if (rfqContract) data.rfq_workflow ||= { version: 1, phase: "signature" };
      if (rfqContract && party === "inteva") signed.role = "legal";
      // Keep the explicit confirmation rationale with the verified receipt as
      // well as the audit entry; never accept signer identity from form fields.
      if (rfqContract) signed.signature_comment = comment;
      if (supplierPo) {
        if (evidenceTime(signed.at) < evidenceTime(data.supplier_po_acceptance!.at)) throw new ClmError("Supplier signing must follow the saved Contract acceptance.", 409);
        signed.signer_email = supplierEmail!.email; signed.signer_email_source = supplierEmail!.source;
        if (text(payload.signatory_role)) signed.signatory_role = text(payload.signatory_role);
        signed.role = "supplier";
        signed.contract_id = String(record.name); signed.purchase_order_id = data.supplier_po_acceptance!.purchase_order; signed.supplier_id = data.supplier_po_acceptance!.supplier;
        signed.acceptance_id = data.supplier_po_acceptance!.id; signed.source_file_id = data.supplier_po_acceptance!.file_id; signed.source_hash = data.supplier_po_acceptance!.hash;
      }
      data.signatures.push(signed);
      if (party === "supplier") { record.custom_supplier_signatory_name = signed.typed_name; record.custom_supplier_signed_date = signed.at.slice(0, 10); }
      else { record.custom_inteva_signed_date = signed.at.slice(0, 10); record.signed_by_company = actor(p); }
      const bothSigned = data.signatures.some(row => row.party === "supplier") && data.signatures.some(row => row.party === "inteva");
      record.custom_esign_status = bothSigned || rfqContract && party === "inteva" ? "Completed" : party === "supplier" ? "Pending Inteva" : "Pending Supplier";
      if (bothSigned && !rfqContract) {
        record.custom_contract_status = "Executed"; record.custom_executed_contract = signed.file_url;
        record.custom_executed_date = signed.at.slice(0, 10); record.is_signed = 1; record.signed_on = signed.at;
      }
      if (rfqContract && party === "inteva") {
        if (!rfqClmLegalSigned(record, data)) throw new ClmError("The Legal Manager signature must follow the approved Legal review on the current version.", 409);
        record.custom_executed_contract = signed.file_url;
        startRfqFinanceReview(record, data);
      }
    } else if (input.action === "finalize_procurement") {
      if (!rfqContract || !exactRole(p, "procurement_team") || !rfqClmFinanceApproved(record, data) || data.rfq_workflow?.phase !== "procurement" || data.procurement_completion) throw new ClmError("Only Procurement Team can finalize this RFQ Contract after Finance approval.", 403);
      const order = await verifyRfqProcurementOrder(record, data, text(payload.purchase_order), deps);
      const context = data.rfq_context as ClmRecord;
      // Post-signature linkage belongs to workflow evidence. custom_purchase_order
      // is part of the approved content snapshot and must not be rewritten here.
      data.procurement_completion = { purchase_order: String(order.name), by: actor(p), role: "procurement_team", at, comment, rfq: text(record.custom_rfq), award: text(context.award_id), quotation: text(record.custom_supplier_quotation), supplier: text(record.custom_supplier || record.party_name), supplier_name: text(order.supplier_name), currency: text(order.currency), grand_total: Number(order.grand_total), created_at: text(order.creation), submitted: true };
      data.rfq_workflow = { version: 1, phase: "completed" };
      audit(data, p, at, "procurement_finalized", "Finance Approved", "Procurement Finalized", comment, record.name);
      audit(data, p, at, "completed", "Procurement Finalized", "Completed", comment, record.name);
    } else if (input.action === "activate") {
      if (record.custom_contract_status === "Active") throw new ClmError("This Contract is already Active.", 409);
      if (record.custom_contract_status !== "Executed") throw new ClmError("Only an Executed Contract can be activated.", 409);
      if (rfqContract && !rfqClmFinanceApproved(record, data)) throw new ClmError("Complete RFQ Contract Finance approval before procurement.", 409);
      if (!rfqContract && (!data.signatures.some(s => s.party === "supplier") || !data.signatures.some(s => s.party === "inteva") || !record.custom_executed_contract || record.custom_esign_status !== "Completed")) throw new ClmError("Both required signatures must be complete before activation.");
      const period = evaluateContractEffectivePeriod(record, at.slice(0, 10));
      if (!period.valid) throw new ClmError(period.message!, 422);
      record.custom_contract_status = "Active";
      if ("status" in record && record.status !== "Active") record.status = "Active";
    } else if (input.action === "expire") {
      if (!text(record.end_date) || text(record.end_date) > at.slice(0, 10)) throw new ClmError("The Contract end date has not been reached.");
      const renewals = await deps.list("Contract Renewal", [["contract", "=", record.name], ["renewal_status", "=", "Executed"]]);
      if (renewals.some(r => text(r.proposed_end_date) >= at.slice(0, 10))) throw new ClmError("An executed renewal covers the current period. Open the renewed Contract.");
      record.custom_contract_status = "Expired";
    } else if (input.action === "request_termination") {
      data.prior_approvals = data.approvals;
      data.approvals = rfqContract ? [{ id: randomUUID(), role: "legal", stage: 0, rule: "RFQ Contract: Legal Termination Review", status: "Pending" }] : await routeFor(record, deps, "termination");
      if (!data.approvals.some(a => a.role === "legal")) throw new ClmError("Termination policy must include Legal review.");
      if (rfqContract) data.rfq_workflow = { version: 1, phase: "legal_review" };
      data.termination = { reason: comment, requested_by: actor(p), requested_at: at }; record.custom_contract_status = "Under Review"; syncCurrent(record, data);
    } else if (input.action === "record_sla") {
      const { metric, target, actual, operator, corrective_action } = payload;
      if (!text(metric) || ![target, actual].every(v => typeof v === "number" && Number.isFinite(v)) || !["gte", "lte"].includes(String(operator))) throw new ClmError("Enter a metric, numeric target/actual values, and a valid comparison.");
      const breached = operator === "gte" ? Number(actual) < Number(target) : Number(actual) > Number(target);
      if (breached && !text(corrective_action)) throw new ClmError("A corrective action is required for an SLA breach.");
      data.sla.push({ id: randomUUID(), metric: text(metric), target: Number(target), actual: Number(actual), operator: operator as "gte" | "lte", status: breached ? "Breached" : "Met", at, by: actor(p), corrective_action: text(corrective_action) });
    } else if (input.action === "close") {
      const checks = ["settlement_complete", "documents_archived", "claims_resolved", "disputes_resolved", "warranty_resolved", "outstanding_actions_resolved"];
      if (!checks.every(k => payload[k] === true)) throw new ClmError("Confirm settlement, documents, claims, disputes, warranty issues and outstanding actions before closure.");
      const obligations = await deps.list("Contract Obligation", [["contract", "=", record.name]]);
      const milestones = await deps.list("Contract Milestone", [["contract", "=", record.name]]);
      const risks = await deps.list("Contract Risk", [["contract", "=", record.name]]);
      if (obligations.some(o => !["Completed", "Waived", "Cancelled"].includes(text(o.status))) || milestones.some(m => !["Completed", "Cancelled"].includes(text(m.status))) || risks.some(r => !["Resolved", "Closed"].includes(text(r.risk_status)))) throw new ClmError("Contract cannot be closed while open obligations, milestones or risks remain.");
      if (!deps.closureBlockers) throw new ClmError("Financial closure validation is unavailable. The Contract remains open.", 503);
      const blockers = await deps.closureBlockers(record); if (blockers.length) throw new ClmError(`Contract cannot be closed while open obligations or financial items remain. ${blockers.join(" ")}`);
      data.closure = { ...Object.fromEntries(checks.map(k => [k, true])), by: actor(p), at, comment }; record.custom_contract_status = "Closed";
    }
  } else throw new ClmError("Unsupported action for this Contract record.");
  if (input.action !== "finalize_procurement") {
    audit(data, p, at, input.action, from, clmStatus(dt, record), comment, record.name);
    if (isRfqClmContract(record) && dt === "Contract") {
      if (input.action === "submit_review") audit(data, p, at, "legal_review_started", from, "Pending Legal", comment, record.name);
      if (input.action === "approve" && from === "Pending Legal") audit(data, p, at, "legal_approved", from, "Approved", comment, record.name);
      if (input.action === "sign") {
        const receipt = data.signatures.at(-1)!;
        audit(data, p, receipt.at, "e_signed", from, clmStatus(dt, record), comment, record.name, receipt);
      }
      if (input.action === "sign" && from === "Pending Signature" && record.custom_contract_status === "Pending Finance") audit(data, p, at, "finance_review_started", "Pending Signature", "Pending Finance", comment, record.name);
      if (input.action === "approve" && from === "Pending Finance") audit(data, p, at, "finance_approved", from, "Finance Approved", comment, record.name);
    }
  }
  const saved = await persist(dt, record, data, deps);
  if (dt === "Contract" && p.typ === "supplier" && clmSupplierPoName(record, data) && ["supplier_accept", "sign"].includes(input.action)) {
    const reloaded = await deps.load("Contract", String(saved.name));
    if (reloaded.modified !== saved.modified || reloaded.custom_clm_data !== record.custom_clm_data || reloaded.custom_executed_contract !== saved.custom_executed_contract) throw new ClmError("The supplier Contract action was sent, but ERPNext persistence could not be verified. Refresh before retrying; PO acceptance remains locked.", 409);
  }
  const result = toClmAggregate(p, dt, saved, undefined, parent);
  result.warnings = [...(result.warnings || []), ...await notifySaved(dt, saved, input, data, deps)];
  return result;
}
