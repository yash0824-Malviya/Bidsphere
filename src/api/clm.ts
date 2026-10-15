import { apiGet, apiPost, withoutNetworkRetry } from "./erpnext";
import { readErpProxyAccessToken, readSupplierAccessToken } from "../utils/accessToken";
import type { ClmSignature, ClmSignatureWorkflow, ClmSupplierWorkflow, ClmSla, RfqClmSummary, RfqClmCreateResult, RfqClmDecisionResult } from "../types/clm";
import { rfqClmRequestWorkflowView } from "../utils/rfqClmWorkflow";
import type { PurchaseOrder } from "../types/erpnext";
export type { RfqClmSummary, RfqClmCreateResult, RfqClmDecisionResult, LegalManagerSignatoryUser, LegalSignatoryResolution } from "../types/clm";

export type ClmRecord = Record<string, unknown> & { name: string; modified?: string };
export const CLM_RELATED_DOCTYPES = ["Contract Risk", "Contract Obligation", "Contract Milestone", "Contract Renewal", "Contract Amendment"] as const;
export interface ClmField {
  fieldname: string; label?: string; fieldtype: string; options?: string;
  reqd?: number | boolean; read_only?: number | boolean; hidden?: number | boolean;
  default?: string | number; description?: string;
}
export interface ClmAction { action: string; label: string; requires_comment?: boolean; }
export interface ClmAlert {
  id: string; kind: string; severity: string; message: string; contract: string;
  source_doctype: string; source_name: string; due_date?: string; owner?: string;
}
export interface ClmSupportingDocument {
  file_id: string; file_url: string; file_name: string;
  by?: string; at?: string; uploaded_by?: string; uploaded_at?: string; version?: string;
}
export interface ClmDetail {
  doctype: string; record: ClmRecord; actions: Array<string | ClmAction>;
  approvals?: Array<Record<string, unknown>>; versions?: Array<Record<string, unknown>>;
  audit?: Array<Record<string, unknown>>; related?: Record<string, ClmRecord[]>; warnings?: string[];
  editable_fields?: string[]; allowed_related?: string[];
  signatures?: ClmSignature[]; sla?: ClmSla[];
  signature_workflow?: ClmSignatureWorkflow;
  supplier_workflow?: ClmSupplierWorkflow;
  alerts?: ClmAlert[];
  supplier_documents?: ClmSupportingDocument[];
  rfq_request_draft_editable?: boolean;
}
export interface ClmMetadata {
  fields: Record<string, ClmField[]>; allowedCreate?: string[]; allowed_create?: string[];
  editable_fields?: Record<string, string[]>;
  editableFields?: Record<string, string[]>;
}
export interface ClmList { records: ClmRecord[]; allowedCreate?: string[]; allowed_create?: string[]; kpis?: { overdueObligations?: number; slaBreaches?: number }; alerts?: ClmAlert[]; }

const inSupplierPortal = () => typeof window !== "undefined" && window.location.pathname.startsWith("/supplier/");
function readClmToken(): string | null {
  if (!inSupplierPortal()) return readErpProxyAccessToken();
  const token = readSupplierAccessToken();
  // Legacy supplier sessions can use the shared storage key. Never send a staff
  // principal through the supplier workspace when both portals are open.
  if (token) {
    // rbacAuth issues body.signature HMAC tokens, not three-part JWTs. This
    // client check selects the portal principal; the server verifies the HMAC.
    try {
      const parts = token.split(".");
      if (parts.length !== 2 || !parts[0] || !parts[1] || JSON.parse(atob(parts[0].replaceAll("-", "+").replaceAll("_", "/"))).typ !== "supplier") return null;
    }
    catch { return null; }
  }
  return token;
}
let previousSession: string | null | undefined;
let sessionSequence = 0;
/** Isolate cached supplier/staff data without placing credentials in query keys. */
export function clmViewerKey(): string {
  const token = readClmToken();
  const identity = `${inSupplierPortal() ? "supplier" : "internal"}:${token || "anonymous"}`;
  if (previousSession !== identity) { previousSession = identity; sessionSequence += 1; }
  return `clm-session-${sessionSequence}`;
}
async function supplierClmRequest<T>(params?: Record<string, string>, body?: unknown): Promise<T> {
  const token = readClmToken();
  if (!token) throw new Error("Your supplier session has expired. Please sign in again.");
  const response = await fetch(`/api/clm${params ? `?${new URLSearchParams(params)}` : ""}`, {
    method: body === undefined ? "GET" : "POST", credentials: "omit", cache: "no-store",
    headers: { "X-Bidsphere-Access-Token": token, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json().catch(() => ({})) as { message?: string; error?: string; success?: boolean };
  if (!response.ok || result.success === false) throw new Error(result.message || result.error || (response.status === 401 ? "Your session has expired. Please sign in again." : "The contract request could not be completed."));
  return result as T;
}
const clmGet = <T,>(params: Record<string, string>): Promise<T> => inSupplierPortal() ? supplierClmRequest<T>(params) : apiGet<T>("/api/clm", { params });

function unwrap<T>(result: T | { data: T }): T {
  return result && typeof result === "object" && "data" in result ? result.data : result as T;
}
async function postRfqClmTransaction<T>(input: Record<string, unknown>, view: "rfq_contract" | "rfq_initial_request" | "rfq_request_draft" | "rfq_award_decision" | "purchase_order" = "rfq_contract"): Promise<T> {
  // The shared ERP interceptor unwraps data/message. Keep the envelope here so
  // a logical transaction failure cannot be mistaken for its included snapshot.
  const options = { ...withoutNetworkRetry(), _preserveResponse: true };
  const response = await apiPost<unknown>(`/api/clm?view=${view}`, input, options);
  const raw = response && typeof response === "object" && "status" in response && typeof response.status === "number" && "data" in response ? response.data : response;
  const assertSuccess = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const envelope = value as Record<string, unknown>;
    if (envelope.success === false || envelope.error !== undefined && envelope.error !== null && envelope.error !== false && envelope.error !== "") {
      const message = [envelope.message, envelope.error].find((candidate): candidate is string => typeof candidate === "string" && !!candidate.trim());
      throw new Error(message || "ERPNext reported that the RFQ CLM transaction failed. Refresh the RFQ to verify its saved decision before retrying.");
    }
  };
  assertSuccess(raw);
  const result = unwrap(raw);
  assertSuccess(result);
  return result as T;
}
export interface ClmPurchaseOrderContext {
  contract: string; expected_modified: string; rfq: string; award: string; quotation: string;
  supplier: string; award_value: number; currency: string; payload: Partial<PurchaseOrder>;
  purchase_order?: PurchaseOrder; completed: boolean;
}
export interface ClmPurchaseOrderResult {
  contract: string; purchase_order: PurchaseOrder; expected_modified: string; completed: boolean; reused: boolean;
}
export interface PurchaseOrderContractSummary {
  purchase_order: string;
  contract: null | {
    name: string; status: string; value: number; currency: string; start_date: string; end_date: string;
    supplier_id: string; supplier_name: string;
    rfq: string; award: string; quotation: string; current_version: string; pdf_available: boolean;
    pdf?: { file_id: string; version: string; hash: string; kind: string };
    signature_workflow: Pick<ClmSignatureWorkflow, "supplier_status" | "legal_status" | "can_sign" | "can_review">;
    supplier_workflow?: ClmSupplierWorkflow;
    actions: ClmAction[];
  };
}
/** Resolve only the persisted PO linkage, with ownership and award validation on the server. */
export async function getPurchaseOrderContract(name: string): Promise<PurchaseOrderContractSummary> {
  const result = unwrap(await clmGet<PurchaseOrderContractSummary | { data: PurchaseOrderContractSummary }>({ view: "purchase_order_contract", name }));
  const contract = result?.contract;
  if (result?.purchase_order !== name || contract === undefined || (contract !== null && (
    !contract.name || !contract.status || !contract.rfq || !contract.award || !contract.quotation ||
    !Number.isFinite(contract.value) || !contract.currency || !contract.current_version ||
    typeof contract.pdf_available !== "boolean" || !contract.signature_workflow ||
    !["Pending", "Signed"].includes(contract.signature_workflow.supplier_status) || !["Pending", "Signed"].includes(contract.signature_workflow.legal_status) ||
    typeof contract.signature_workflow.can_sign !== "boolean" || typeof contract.signature_workflow.can_review !== "boolean" ||
    !Array.isArray(contract.actions) || contract.actions.some(action => !action || typeof action.action !== "string")
  ))) throw new Error("The contract service did not return a verified Contract link for this Purchase Order. Refresh and try again.");
  return result;
}
/** Re-read persisted acceptance/signature evidence immediately before the separate PO action. */
export async function verifyPurchaseOrderContractAcceptance(name: string): Promise<PurchaseOrderContractSummary> {
  const result = await getPurchaseOrderContract(name);
  if (result.contract && result.contract.supplier_workflow?.can_accept_po !== true) {
    throw new Error(result.contract.supplier_workflow?.blocked_reason || "Accept and sign the linked Contract before accepting this Purchase Order.");
  }
  return result;
}
/** Read the server-authorized Contract/Award prefill, never infer approval from a URL. */
export async function getClmPurchaseOrderContext(name: string): Promise<ClmPurchaseOrderContext> {
  const result = unwrap(await clmGet<ClmPurchaseOrderContext | { data: ClmPurchaseOrderContext }>({ view: "purchase_order", name }));
  if (result?.contract !== name || !result.expected_modified || !result.rfq || !result.award || !result.quotation || !result.payload || !Array.isArray(result.payload.items)) throw new Error("The service did not return the saved Contract and award for PO creation. Refresh the Contract before retrying.");
  return result;
}
/** ERPNext creates/submits the linked PO and finalizes only after persisted submission. */
export async function saveClmPurchaseOrder(input: { name: string; expected_modified: string; operation: "save_draft" | "submit"; payload: Partial<PurchaseOrder> }): Promise<ClmPurchaseOrderResult> {
  if (!input.name.trim() || !input.expected_modified) throw new Error("Refresh the Contract before creating its Purchase Order.");
  const result = await postRfqClmTransaction<ClmPurchaseOrderResult>(input, "purchase_order");
  if (result?.contract !== input.name || !result.purchase_order?.name || typeof result.completed !== "boolean" || (result.completed && Number(result.purchase_order.docstatus) !== 1) || (input.operation === "submit" && !result.completed)) throw new Error("ERPNext did not confirm the linked Purchase Order and Contract finalization. Refresh the Contract to check its persisted state before retrying.");
  return result;
}
export async function getClmList(doctype = "Contract"): Promise<ClmList> {
  const result = unwrap(await clmGet<ClmList | { data: ClmList }>({ view: "list", doctype }));
  if (!Array.isArray(result?.records)) throw new Error(`The contract service did not return the ${doctype} list. Refresh to verify the saved records.`);
  return result;
}
export async function getClmDetail(doctype: string, name: string): Promise<ClmDetail> {
  const result = unwrap(await clmGet<ClmDetail | { data: ClmDetail }>({ view: "detail", doctype, name }));
  if (!result?.record?.name || result.record.name !== name) throw new Error("The contract service returned an incomplete record. Refresh and try again.");
  return result;
}
/** Update only the existing Request draft; never insert a Request or Contract. */
export async function saveRfqRequestDraft(input: { name: string; expected_modified: string; payload: Record<string, unknown> }): Promise<ClmDetail> {
  if (!input.name.trim() || !input.expected_modified) throw new Error("Refresh the saved Contract Request before saving its draft.");
  const result = await postRfqClmTransaction<ClmDetail>(input, "rfq_request_draft");
  if (result?.doctype !== "Contract Request" || result.record?.name !== input.name || !result.record.modified) throw new Error("ERPNext did not return the saved Contract Request. Refresh to verify its draft before retrying.");
  return result;
}
export async function getClmMetadata(): Promise<ClmMetadata> {
  return unwrap(await clmGet<ClmMetadata | { data: ClmMetadata }>({ view: "metadata" }));
}
export async function getRfqClmSummary(rfq: string): Promise<RfqClmSummary> {
  const result = unwrap(await clmGet<RfqClmSummary | { data: RfqClmSummary }>({ view: "rfq_contract", rfq }));
  if (result?.rfq?.name !== rfq) throw new Error("The contract service returned an incomplete RFQ source. Refresh and try again.");
  return result;
}
/** Apply the RFQ's saved requirement to its persisted award; never choose a new decision or create an actual Contract. */
export async function recordRfqAwardDecision(input: { rfq: string; award_id: string; quotation_id: string; supplier_id: string; decision?: "Yes" | "No" }): Promise<RfqClmDecisionResult> {
  if (inSupplierPortal()) throw new Error("Only an authorized procurement user can confirm the award Contract Requirement.");
  if (![input.rfq, input.award_id, input.quotation_id, input.supplier_id].every(value => typeof value === "string" && !!value.trim())) throw new Error("Confirm the saved supplier award before applying the RFQ contract requirement.");
  const source = { rfq: input.rfq, award_id: input.award_id, quotation_id: input.quotation_id, supplier_id: input.supplier_id };
  const result = await postRfqClmTransaction<RfqClmDecisionResult>(source, "rfq_award_decision");
  const summary = result?.summary;
  if (typeof result?.created !== "boolean" || summary?.rfq?.name !== input.rfq || !["Yes", "No"].includes(summary.decision) || summary.contract_required !== summary.decision || !summary.eligible || summary.recovery_required || summary.source?.award !== input.award_id || summary.source.supplier !== input.supplier_id || summary.source.quotation !== input.quotation_id) throw new Error("The contract service did not confirm the saved decision for this supplier award. Refresh the award before retrying.");
  if (summary.decision === "Yes") {
    if (result.request?.doctype !== "Contract Request" || !result.request.record?.name || result.request.record.custom_rfq !== input.rfq || result.request.record.supplier !== input.supplier_id || result.request.record.custom_supplier_quotation !== input.quotation_id || summary.request?.name !== result.request.record.name) throw new Error("The contract service did not confirm the persisted award-linked Contract Request. Refresh the award before retrying.");
  } else if (result.created || result.request || result.contract || summary.request || summary.contract) throw new Error("The contract service did not confirm that this No Contract decision skipped CLM.");
  return result;
}
export async function submitRfqClmRequest(input: { rfq: string; expected_modified: string; payload: Record<string, unknown> }): Promise<RfqClmCreateResult> {
  if (inSupplierPortal()) throw new Error("Only an authorized Procurement Team user can request CLM from an RFQ Award.");
  if (!input.rfq || !input.expected_modified) throw new Error("Refresh this RFQ before submitting its CLM Request.");
  const { custom_inteva_signatory: _signatory, ...cleanPayload } = input.payload || {};
  const result = await postRfqClmTransaction<RfqClmCreateResult>({ ...input, payload: cleanPayload, decision: "Yes", operation: "request" });
  return confirmedRfqClmRequest(result, input.rfq);
}
function confirmedRfqClmRequest(result: RfqClmCreateResult, rfq: string): RfqClmCreateResult {
  const request = result?.request;
  if (typeof result?.created !== "boolean" || request?.doctype !== "Contract Request" || !request.record?.name || request.record.custom_rfq !== rfq || result.summary?.rfq?.name !== rfq || result.summary.request?.name !== request.record.name || result.summary.decision !== "Yes" || result.summary.contract_required !== "Yes" || result.contract || result.summary.contract) throw new Error("The contract service did not confirm the saved CLM Request. Refresh this RFQ before retrying.");
  const workflow = rfqClmRequestWorkflowView(request.record);
  if (!workflow || result.summary.request.assigned_role !== workflow.assignedRole || result.summary.request.current_stage !== workflow.stage) throw new Error("The contract service did not confirm the persisted Procurement Team assignment. Refresh the saved request before retrying.");
  return result;
}
export async function retryInitialRfqClmRequest(rfq: string): Promise<RfqClmCreateResult> {
  if (inSupplierPortal()) throw new Error("Only an authorized RFQ creator can route its Contract Request.");
  if (!rfq.trim()) throw new Error("Select the saved RFQ before retrying its Contract Request.");
  const result = await postRfqClmTransaction<RfqClmCreateResult>({ rfq }, "rfq_initial_request");
  return confirmedRfqClmRequest(result, rfq);
}
export async function createRfqContractRequest(input: { rfq: string; expected_modified: string; payload: Record<string, unknown>; contract_fields?: Record<string, unknown> }): Promise<RfqClmCreateResult> {
  if (inSupplierPortal()) throw new Error("Only an authorized Procurement Team user can create CLM from an RFQ Award.");
  if (!input.rfq || !input.expected_modified) throw new Error("Refresh this RFQ before creating its Contract Request.");
  const result = await postRfqClmTransaction<RfqClmCreateResult>({ ...input, decision: "Yes", operation: "create_contract" });
  if (result?.summary?.recovery_required) throw new Error("Contract creation is not complete. Refresh this RFQ and resume Contract creation to finish the saved handoff.");
  if (typeof result?.created !== "boolean" || !result?.request?.record?.name || result.summary?.rfq?.name !== input.rfq || result.summary.request?.name !== result.request.record.name || result.summary.decision !== "Yes" || result.summary.contract_required !== "Yes") throw new Error("The contract service did not confirm the saved Contract Request. Refresh this RFQ before retrying.");
  // An idempotent retry must confirm the same persistent Contract as a new
  // transaction. A Contract Request alone is not a Contract Lifecycle record.
  if (!result.contract || result.contract.doctype !== "Contract" || !result.contract.record?.name || result.summary.contract?.name !== result.contract.record.name || result.contract.record.custom_rfq !== input.rfq) throw new Error("The contract service did not confirm the RFQ-linked Contract. A Contract Request alone does not complete CLM creation. Refresh this RFQ to verify the saved Contract before retrying.");
  if (result.created && (result.contract?.record.custom_contract_status !== "Pending Legal" || !result.contract.approvals?.some(row => row.role === "legal" && row.stage === 0 && row.status === "Pending"))) throw new Error("The contract service did not confirm the Legal Review assignment. Refresh the saved RFQ before retrying.");
  return result;
}
export async function decideRfqContractRequirement(input: { rfq: string; expected_modified: string; decision: "No" }): Promise<RfqClmDecisionResult> {
  if (inSupplierPortal()) throw new Error("Only an authorized Procurement Team user can decide the RFQ Contract Requirement.");
  if (!input.rfq || !input.expected_modified) throw new Error("Refresh this RFQ before saving its Contract Requirement.");
  const result = await postRfqClmTransaction<RfqClmDecisionResult>(input);
  if (result?.summary?.rfq?.name !== input.rfq || result.summary.decision !== "No" || result.summary.contract_required !== "No" || result.summary.request || result.summary.contract || result.request || result.contract || result.created !== false) throw new Error("The contract service did not confirm the saved No Contract decision. Refresh this RFQ before retrying.");
  return result;
}
export async function getDesignatedLegalSignatory(): Promise<LegalSignatoryResolution> {
  const result = unwrap(await clmGet<{ data: LegalSignatoryResolution } | LegalSignatoryResolution>({ view: "legal_signatory" }));
  return (result as { data: LegalSignatoryResolution }).data || (result as LegalSignatoryResolution);
}
export async function lookupClm(doctype: string, query: string): Promise<ClmRecord[]> {
  const result = unwrap(await clmGet<ClmList | { data: ClmList }>({ view: "lookup", doctype, query }));
  return result.records || [];
}
export async function prefillClm(doctype: string, source_doctype: string, source_name: string): Promise<Record<string, unknown>> {
  const result = unwrap(await clmGet<{ payload: Record<string, unknown> }>({ view: "prefill", doctype, source_doctype, source_name }));
  return result.payload;
}
export async function applyClmAction(input: {
  doctype: string; name?: string; action: string; payload?: Record<string, unknown>;
  comment?: string; expected_modified?: string;
}): Promise<ClmDetail> {
  if (input.action === "sign" && (input.doctype !== "Contract" || !input.name?.trim())) throw new Error("Open the existing Contract before signing.");
  if (input.name && !input.expected_modified) throw new Error("Refresh this record before making changes.");
  const result = unwrap(await (inSupplierPortal() ? supplierClmRequest<ClmDetail | { data: ClmDetail }>(undefined, input) : apiPost<ClmDetail | { data: ClmDetail }>("/api/clm", input, withoutNetworkRetry())));
  if (!result?.record?.name) throw new Error("The contract service did not return a saved record. Refresh before retrying.");
  if (input.action === "sign" && (result.doctype !== "Contract" || result.record.name !== input.name)) throw new Error("The signature response does not match this Contract. Refresh the existing Contract to verify its saved signature before retrying.");
  return result;
}
export async function getClmDocumentBlob(doctype: string, name: string, fieldname: string, fileId?: string, expectedVersion?: string): Promise<Blob> {
  const token = readClmToken();
  const response = await fetch(`/api/clm?${new URLSearchParams({ view: "file", doctype, name, ...(fileId ? { file_id: fileId, ...(fieldname === "current_pdf" ? { fieldname } : {}) } : { fieldname }), ...(expectedVersion ? { expected_version: expectedVersion } : {}) })}`, {
    credentials: "omit", cache: "no-store", headers: token ? { "X-Bidsphere-Access-Token": token } : {},
  });
  if (!response.ok) {
    if ([409, 422].includes(response.status)) {
      const problem = await response.json().catch(() => ({}));
      if (typeof problem.message === "string" && problem.message.trim()) throw new Error(problem.message);
    }
    const message = response.status === 401 ? "Your session has expired. Please sign in again."
      : response.status === 403 ? "You do not have permission to view this document."
      : response.status === 404 ? "Document not found." : "Unable to load the document. Please try again.";
    throw new Error(message);
  }
  return response.blob();
}
/** Upload privately with a server receipt; the redline action publishes the verified File ID. */
export async function uploadClmSupportingDocument(file: File, contractName: string, expectedModified: string): Promise<ClmSupportingDocument & { modified: string }> {
  const token = readClmToken();
  if (!token) throw new Error("Your session has expired. Please sign in again.");
  if (!contractName.trim()) throw new Error("Open the assigned contract before uploading supporting documents.");
  if (!expectedModified.trim()) throw new Error("Refresh this contract before uploading supporting documents.");
  const body = new FormData();
  body.append("file", file, file.name);
  const response = await fetch(`/api/clm?${new URLSearchParams({ view: "supplier_upload", name: contractName, expected_modified: expectedModified })}`, { method: "POST", credentials: "omit", cache: "no-store", headers: { "X-Bidsphere-Access-Token": token }, body });
  const result = await response.json().catch(() => ({})) as { message?: unknown; data?: unknown; error?: unknown };
  if (!response.ok) throw new Error(typeof result.message === "string" ? result.message : typeof result.error === "string" ? result.error : response.status === 401 ? "Your session has expired. Please sign in again." : response.status === 403 ? "You do not have permission to upload documents for this contract." : "The supporting document could not be uploaded. Please try again.");
  const saved = result.data as Partial<ClmSupportingDocument> & { modified?: string } | undefined;
  if (!saved?.file_id || !saved.file_url?.startsWith("/private/files/") || !saved.modified) throw new Error("The service did not confirm a private supporting document for this contract. Refresh before retrying.");
  return { file_id: saved.file_id, file_url: saved.file_url, file_name: saved.file_name || file.name, modified: saved.modified };
}
export function clmError(error: unknown): string {
  const e = error as { response?: { data?: { error?: unknown; message?: unknown } }; message?: unknown };
  const candidates = [e?.response?.data?.message, e?.response?.data?.error, e?.message];
  return candidates.find((value): value is string => typeof value === "string" && !!value.trim()) || "The contract request could not be completed.";
}
export function clmStatus(record: Record<string, unknown>): string {
  return String(record.custom_contract_status || record.request_status || record.renewal_status || record.amendment_status || record.risk_status || record.clause_status || record.status || "Draft");
}
export function clmTitle(record: Record<string, unknown>): string {
  return String(record.custom_contract_title || record.contract_purpose || record.amendment_title || record.risk_title || record.milestone_name || record.obligation || record.rule_name || record.clause_title || record.title || record.name || "");
}
export function clmRecordRoute(doctype: string, name: string, supplier = false): string {
  if (supplier) return `/supplier/contracts/${encodeURIComponent(name)}`;
  if (doctype === "Contract Request") return `/contract-requests/${encodeURIComponent(name)}`;
  if (doctype === "Contract") return `/contracts/${encodeURIComponent(name)}`;
  if ((CLM_RELATED_DOCTYPES as readonly string[]).includes(doctype)) return `/contracts/records/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`;
  return `/contracts/settings?${new URLSearchParams({ doctype, name })}`;
}
