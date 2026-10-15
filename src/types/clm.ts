/** CLM extends the existing ERP records; these are transport/evidence types, not new masters. */
export const CLM_DOCTYPES = ["Contract", "Contract Request", "Contract Clause", "Contract Approval Matrix", "Contract Renewal", "Contract Amendment", "Contract Risk", "Contract Milestone", "Contract Obligation", "Contract Template"] as const;
export type ClmDoctype = typeof CLM_DOCTYPES[number];
export type ClmRecord = Record<string, unknown> & { name?: string; modified?: string; doctype?: string };
export type ClmApprovalStatus = "Pending" | "Approved" | "Rejected" | "Sent Back";
export interface ClmApproval { id: string; role: string; user?: string; stage: number; rule: string; status: ClmApprovalStatus; by?: string; at?: string; comment?: string }
export interface ClmVersion { id: string; number: string; previous?: string; author: string; at: string; comment: string; hash: string; content: ClmRecord }
export interface ClmAudit { id: string; action: string; by: string; at: string; previous_status: string; new_status: string; comment: string; version?: string; role?: string; reference_id?: string; contract_id?: string; signature_status?: "Signed"; signature_party?: ClmSignature["party"]; signature_file_id?: string; signature_hash?: string }
export interface ClmSignature { party: "supplier" | "inteva"; by: string; at: string; version: string; hash: string; file_id: string; file_url: string; typed_name: string; request_id?: string; role?: string; signatory_role?: string; full_legal_name?: string; signature_method?: "typed"; signature_adopted?: true; signature_comment?: string; signer_email?: string; signer_email_source?: "registered_supplier_account" | "supplier_declared"; acceptance_id?: string; source_file_id?: string; source_hash?: string; contract_id?: string; purchase_order_id?: string; supplier_id?: string }
export interface ClmSupplierAcceptance { id: string; status: "Accepted"; contract: string; purchase_order: string; supplier: string; by: string; at: string; version: string; file_id: string; file_url: string; hash: string; consent: true; request_id?: string }
/** Supplier's separate PO handoff; the completed internal CLM route is preserved. */
export interface ClmSupplierWorkflow {
  purchase_order: string; acceptance_status: "Pending" | "Accepted"; signature_status: "Pending" | "Signed";
  status: string; current_stage: string; next_stage: string; responsible_role: "supplier" | ""; responsible: "Supplier" | "None / Completed";
  can_accept_contract: boolean; can_sign_contract: boolean; can_accept_po: boolean; blocked_reason?: string;
  version: string; document_file_id?: string; document_hash?: string; accepted_at?: string; signed_at?: string;
  po_acceptance_status?: "Pending" | "Accepted"; po_accepted_at?: string; shipment_status?: string;
}
/** Server-derived readiness; these flags never substitute for action authorization. */
export interface ClmSignatureWorkflow { supplier_status: "Pending" | "Signed"; legal_status: "Pending" | "Signed"; is_legal_signatory: boolean; can_sign: boolean; can_review: boolean; can_request_signatures: boolean; blocked_reason?: string; document_file_id?: string }
export interface ClmSupplierDocument { file_id: string; file_url: string; file_name: string; by: string; at: string; version?: string }
export interface ClmSla { id: string; metric: string; target: number; actual: number; operator: "gte" | "lte"; status: "Met" | "Breached"; at: string; by: string; corrective_action?: string }
export interface RfqClmWorkflow { version: 1; phase: "draft" | "legal_review" | "signature" | "finance_review" | "procurement" | "completed" | "rejected" }
export interface RfqClmRequestWorkflow { version: 1; phase: "procurement_team" | "contract_created"; assigned_role: "procurement_team" }
export interface RfqClmProcurementCompletion { purchase_order: string; by: string; role: "procurement_team"; at: string; comment: string; rfq: string; award: string; quotation: string; supplier: string }
export interface ClmData { schema: 1; approvals: ClmApproval[]; versions: ClmVersion[]; audit: ClmAudit[]; signatures: ClmSignature[]; sla: ClmSla[]; version?: string; locked_hash?: string; negotiation?: "Pending Supplier" | "Accepted" | "Redlined"; contract?: string; supplier_po_acceptance?: ClmSupplierAcceptance; termination?: { reason: string; requested_by: string; requested_at: string }; closure?: Record<string, unknown>; rfq_workflow?: RfqClmWorkflow; [key: string]: unknown }
export type ClmActionName = "save" | "submit" | "approve" | "reject" | "send_back" | "create_contract" | "submit_review" | "negotiate" | "supplier_accept" | "supplier_redline" | "new_version" | "begin_signature" | "sign" | "activate" | "expire" | "request_termination" | "close" | "record_sla" | "execute" | "finalize_procurement";
export interface ClmAction { action: ClmActionName; label: string; requires_comment?: boolean }
export interface ClmAggregate { doctype: ClmDoctype; record: ClmRecord; actions: ClmAction[]; approvals: ClmApproval[]; versions: ClmVersion[]; audit: ClmAudit[]; related?: Partial<Record<ClmDoctype, ClmRecord[]>>; warnings?: string[]; signatures?: ClmSignature[]; signature_workflow?: ClmSignatureWorkflow; supplier_workflow?: ClmSupplierWorkflow; sla?: ClmSla[]; supplier_documents?: ClmSupplierDocument[]; rfq_request_draft_editable?: boolean }
export interface ClmField { fieldname: string; label?: string; fieldtype: string; options?: string; reqd?: number; read_only?: number; unique?: number; default?: unknown }
export interface ClmActionInput { doctype: ClmDoctype; name?: string; action: ClmActionName; payload?: ClmRecord; comment?: string; expected_modified?: string }
export interface ClmApprovalStage { role: string; user?: string; stage: number }
export interface ClmMatrixConditions { business_unit?: string; currency?: string; supplier_status?: string; non_standard_clause?: boolean; new_supplier?: boolean; purpose?: "contract" | "amendment" | "renewal" | "termination" }

export interface LegalManagerSignatoryUser { name: string; email: string; full_name: string }
export interface LegalSignatoryResolution {
  signatory?: LegalManagerSignatoryUser;
  eligible_signatories: LegalManagerSignatoryUser[];
  source: "workflow_matrix" | "unique_role" | "unresolved" | "none";
  error?: string;
}

export interface RfqClmSourceDocument {
  file_id: string;
  file_name: string;
  file_url?: string;
  document_type?: string;
  source_doctype: string;
  source_name: string;
  source_path?: string;
  status?: string;
}
export interface RfqClmSummary {
  rfq: { name: string; modified: string; docstatus?: number; status?: string };
  contract_required: "Yes" | "No";
  decision: "Pending" | "Yes" | "No";
  can_decide: boolean;
  blocks_procurement: boolean;
  continuation_ready: boolean;
  source?: { business_case?: string; ecr?: string; award?: string; supplier?: string; quotation?: string; amount?: number; currency?: string; approved_estimated_value?: number };
  eligible: boolean;
  reason: string;
  can_create: boolean;
  can_request?: boolean;
  request_needs_details?: boolean;
  initial_request_required?: boolean;
  recovery_required?: boolean;
  status: string;
  request?: { name: string; status: string; assigned_role?: "procurement_team"; current_stage?: string };
  contract?: { name: string; status: string; phase?: RfqClmWorkflow["phase"]; stage?: string };
  can_open_request: boolean;
  can_open_contract: boolean;
  prefill: ClmRecord;
  required_fields: string[];
  locked_fields: string[];
  source_documents: RfqClmSourceDocument[];
  warnings: string[];
  designated_legal_signatory?: LegalSignatoryResolution;
}
export interface RfqClmContext {
  rfq_id: string; award_id: string; supplier_id: string; quotation_id: string;
  contract_type: string; contract_status: string; contract_required: "Yes";
}
export interface RfqClmDecisionResult { created: boolean; request?: ClmAggregate; contract?: ClmAggregate; summary: RfqClmSummary }
export interface RfqClmCreateResult extends RfqClmDecisionResult { request: ClmAggregate }
