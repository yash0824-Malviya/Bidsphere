/**
 * RFI (Request for Information) — standalone pre-RFQ information collection.
 *
 * Intentionally decoupled from RFQ / RFP / PO / AI so future RFx integration
 * can hang off these types without rewriting the module surface.
 */

export type RfiStatus = "Draft" | "Published" | "Under Review" | "Closed";

export type RfiResponseStatus = "Pending" | "Submitted";

export type RfiQuestionType =
  | "short_text"
  | "long_text"
  | "number"
  | "yes_no"
  | "dropdown"
  | "checkbox"
  | "file_upload";

export type RfiRequiredDocumentType =
  | "Company Profile"
  | "Product Catalogue"
  | "ISO Certificate"
  | "Technical Datasheet"
  | "Brochure"
  | "Financial Statement"
  | "Other";

export const RFI_QUESTION_TYPES: { value: RfiQuestionType; label: string }[] = [
  { value: "short_text", label: "Short Text" },
  { value: "long_text", label: "Long Text" },
  { value: "number", label: "Number" },
  { value: "yes_no", label: "Yes / No" },
  { value: "dropdown", label: "Dropdown" },
  { value: "checkbox", label: "Checkbox" },
  { value: "file_upload", label: "File Upload" },
];

export const RFI_DOCUMENT_TYPES: RfiRequiredDocumentType[] = [
  "Company Profile",
  "Product Catalogue",
  "ISO Certificate",
  "Technical Datasheet",
  "Brochure",
  "Financial Statement",
  "Other",
];

export const RFI_ALLOWED_FILE_TYPES = [
  "PDF",
  "DOC",
  "DOCX",
  "XLS",
  "XLSX",
  "PNG",
  "JPG",
  "ZIP",
] as const;

/**
 * RFI Category Master (UI Link source).
 * Stored on the RFI as the existing `category` Data field — no DocType change.
 * Keep legacy values so existing RFIs remain selectable/displayable.
 */
export const RFI_CATEGORIES = [
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
  // Legacy labels (do not remove — existing RFIs may use these)
  "Raw Materials",
  "Manufacturing Components",
  "Electrical Components",
  "Packaging Materials",
  "MRO Supplies",
  "IT Equipment",
  "Logistics & Transportation",
  "Professional Services",
  "Other",
] as const;

export type RfiCategory = (typeof RFI_CATEGORIES)[number];

export interface RfiQuestion {
  id: string;
  title: string;
  type: RfiQuestionType;
  required: boolean;
  /** Options for dropdown & checkbox question types. */
  options: string[];
  sort_order: number;
  /** Optional input placeholder shown to suppliers. */
  placeholder?: string;
  /** Optional help text shown under the question. */
  help_text?: string;
}

export interface RfiRequiredDocument {
  id: string;
  doc_type: RfiRequiredDocumentType;
  /** Custom label when doc_type is "Other". */
  label?: string;
  required: boolean;
  /** Max upload size in MB (advisory for suppliers). */
  max_file_size_mb?: number;
  /** Allowed extensions, e.g. ["PDF", "DOCX"]. */
  allowed_file_types?: string[];
}

export interface RfiSupplierInvite {
  supplier: string;
  supplier_name: string;
  invited_at?: string;
}

export interface RfiAnswer {
  question_id: string;
  /** Scalar answer (text / number / yes_no / dropdown). */
  value?: string | number | boolean | null;
  /** Multi-select for checkbox. */
  values?: string[];
  /** Uploaded file metadata for file_upload questions. */
  file?: RfiUploadedFile | null;
}

export interface RfiUploadedFile {
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

export interface RfiDocumentUpload {
  document_id: string;
  doc_type: RfiRequiredDocumentType;
  file: RfiUploadedFile;
}

export type RfiResponseReviewStatus =
  | "Under Review"
  | "Approved"
  | "Rejected";

export interface RfiResponse {
  id: string;
  rfi: string;
  supplier: string;
  supplier_name: string;
  status: RfiResponseStatus;
  answers: RfiAnswer[];
  documents: RfiDocumentUpload[];
  additional_comments?: string;
  /** Snapshot of company info pulled from Supplier profile at open time. */
  company_snapshot?: RfiCompanySnapshot;
  submitted_at?: string;
  /** Display name / user who submitted (supplier portal). */
  submitted_by?: string;
  /** 0–100 completion at submit time. */
  completion_pct?: number;
  /** When true, supplier can no longer edit answers/documents. */
  response_locked?: boolean;
  /** Buyer-side review outcome (optional). */
  review_status?: RfiResponseReviewStatus;
  created_at: string;
  modified: string;
  /** Internal procurement notes — never visible to suppliers. */
  internal_notes?: string;
}

/** Supplier-facing lifecycle status on My RFIs. */
export type SupplierRfiFacingStatus =
  | "Draft"
  | "In Progress"
  | "Submitted"
  | "Under Review"
  | "Approved"
  | "Rejected"
  | "Closed";

export interface RfiCompanySnapshot {
  supplier: string;
  supplier_name: string;
  supplier_group?: string;
  country?: string;
  email?: string;
  mobile_no?: string;
  website?: string;
  tax_id?: string;
  address?: string;
}

export interface RFI {
  name: string;
  title: string;
  category: string;
  department: string;
  description: string;
  submission_deadline: string;
  status: RfiStatus;
  questions: RfiQuestion[];
  required_documents: RfiRequiredDocument[];
  suppliers: RfiSupplierInvite[];
  owner?: string;
  company?: string;
  published_at?: string;
  closed_at?: string;
  /** Internal notes on the RFI itself. */
  internal_notes?: string;
  created_at: string;
  modified: string;
}

export interface RfiCreateInput {
  title: string;
  category: string;
  department: string;
  description: string;
  submission_deadline: string;
  questions: Omit<RfiQuestion, "id" | "sort_order">[];
  required_documents: Omit<RfiRequiredDocument, "id">[];
  suppliers: Array<{ supplier: string; supplier_name: string }>;
  owner?: string;
  company?: string;
}

export interface RfiUpdateInput {
  title?: string;
  category?: string;
  department?: string;
  description?: string;
  submission_deadline?: string;
  questions?: RfiQuestion[];
  required_documents?: RfiRequiredDocument[];
  suppliers?: RfiSupplierInvite[];
  internal_notes?: string;
}

export interface RfiSubmitResponseInput {
  answers: RfiAnswer[];
  documents: RfiDocumentUpload[];
  additional_comments?: string;
  company_snapshot?: RfiCompanySnapshot;
}
