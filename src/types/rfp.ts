/**
 * RFP (Request for Proposal) — standalone proposal collection module.
 *
 * Decoupled from RFQ / RFI / PO / AI so future RFx integration can hang off
 * these types without rewriting the module surface.
 *
 * Future-ready (not implemented yet):
 * - Technical Evaluation
 * - Commercial Evaluation
 * - Proposal Scoring
 * - AI Proposal Summary / Recommendation
 * - Proposal Comparison
 */

export type RfpStatus = "Draft" | "Published" | "Under Review" | "Closed";

export type RfpResponseStatus = "Pending" | "Submitted";

/** Supplier-facing lifecycle status on My RFPs. */
export type SupplierRfpFacingStatus =
  | "New"
  | "Draft"
  | "Submitted"
  | "Under Review"
  | "Clarification Requested"
  | "Awarded"
  | "Rejected"
  | "Closed";

export type RfpReviewStatus =
  | "Under Review"
  | "Clarification Requested"
  | "Awarded"
  | "Rejected";

export type RfpRequiredDocumentType =
  | "Technical Proposal"
  | "Commercial Proposal"
  | "Company Profile"
  | "Project Plan"
  | "References"
  | "Brochure"
  | "Proposal Document"
  | "Other";

export const RFP_DOCUMENT_TYPES: RfpRequiredDocumentType[] = [
  "Technical Proposal",
  "Commercial Proposal",
  "Company Profile",
  "Project Plan",
  "References",
  "Brochure",
  "Proposal Document",
  "Other",
];

export const RFP_ALLOWED_FILE_TYPES = [
  "PDF",
  "DOC",
  "DOCX",
  "XLS",
  "XLSX",
  "PNG",
  "JPG",
  "ZIP",
] as const;

export type RfpDurationUnit = "Days" | "Weeks" | "Months" | "Years";

export const RFP_DURATION_UNITS: RfpDurationUnit[] = [
  "Days",
  "Weeks",
  "Months",
  "Years",
];

/**
 * Category master for RFP (UI Link source). Stored in enrichment sidecar —
 * no DocType change. Aligns with common procurement categories.
 */
export const RFP_CATEGORIES = [
  "Raw Material",
  "Packaging",
  "Electronics",
  "Mechanical",
  "Hydraulics",
  "Casting",
  "Forging",
  "Rubber",
  "Plastic",
  "Injection Molding",
  "IT Services",
  "Maintenance",
  "Civil",
  "Logistics",
  "Professional Services",
  "Capital Equipment",
  "Facilities",
  "Other",
];

export interface RfpRequiredDocument {
  id: string;
  doc_type: RfpRequiredDocumentType;
  /** Custom label when doc_type is "Other". */
  label?: string;
  required: boolean;
  /** Optional UI / validation metadata (persisted via enrichment JSON). */
  max_file_size_mb?: number;
  allowed_file_types?: string[];
}

export interface RfpSupplierInvite {
  supplier: string;
  supplier_name: string;
  invited_at?: string;
}

export interface RfpUploadedFile {
  file_name: string;
  /** Relative ERPNext path (`/private/files/…`) or local data URL fallback. */
  file_url: string;
  /** ERPNext File DocType name when uploaded to the server. */
  file_id?: string;
  file_size?: number;
  uploaded_at: string;
  attached_to_doctype?: string;
  attached_to_name?: string;
  attached_to_field?: string;
}

export interface RfpDocumentUpload {
  document_id: string;
  doc_type: RfpRequiredDocumentType;
  file: RfpUploadedFile;
}

export interface RfpResponse {
  id: string;
  rfp: string;
  supplier: string;
  supplier_name: string;
  status: RfpResponseStatus;
  /** Free-text proposal narrative from the supplier (Proposal Summary). */
  proposal_description: string;
  documents: RfpDocumentUpload[];
  /** ERP documents_count when present (list tracking). */
  documents_count?: number;
  additional_comments?: string;
  submitted_at?: string;
  /** Buyer-side review outcome (optional). */
  review_status?: RfpReviewStatus;
  created_at: string;
  modified: string;
  /** Internal procurement notes — never visible to suppliers. */
  internal_notes?: string;
}

export interface RFP {
  name: string;
  title: string;
  description: string;
  submission_deadline: string;
  status: RfpStatus;
  required_documents: RfpRequiredDocument[];
  suppliers: RfpSupplierInvite[];
  owner?: string;
  company?: string;
  published_at?: string;
  closed_at?: string;
  internal_notes?: string;
  created_at: string;
  modified: string;
  /* ── Enterprise enrichment (optional; sidecar / merge) ── */
  category?: string;
  department?: string;
  scope_of_work?: string;
  business_objective?: string;
  technical_requirements?: string;
  estimated_duration_value?: number;
  estimated_duration_unit?: RfpDurationUnit;
}

export interface RfpCreateInput {
  title: string;
  description: string;
  submission_deadline: string;
  required_documents: Omit<RfpRequiredDocument, "id">[];
  suppliers: Array<{ supplier: string; supplier_name: string }>;
  owner?: string;
  company?: string;
  scope_of_work?: string;
  business_objective?: string;
  technical_requirements?: string;
}

export interface RfpUpdateInput {
  title?: string;
  description?: string;
  submission_deadline?: string;
  required_documents?: RfpRequiredDocument[];
  suppliers?: RfpSupplierInvite[];
  internal_notes?: string;
  scope_of_work?: string;
  business_objective?: string;
  technical_requirements?: string;
}

export interface RfpSubmitResponseInput {
  proposal_description: string;
  documents: RfpDocumentUpload[];
  additional_comments?: string;
}

/* ── Future-ready evaluation architecture (stubs — not wired) ─────────── */

export type RfpEvaluationDimension =
  | "technical"
  | "commercial"
  | "delivery"
  | "compliance"
  | "overall";

/** Placeholder for future technical / commercial evaluation scores. */
export interface RfpProposalScore {
  response_id: string;
  dimension: RfpEvaluationDimension;
  score: number;
  max_score: number;
  notes?: string;
  scored_by?: string;
  scored_at?: string;
}

/** Placeholder for future AI proposal summary / recommendation. */
export interface RfpAiInsightStub {
  rfp: string;
  response_id?: string;
  kind: "summary" | "recommendation" | "comparison";
  content?: string;
  generated_at?: string;
}
