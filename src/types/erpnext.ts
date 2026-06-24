/**
 * Shared TypeScript interfaces for the ERPNext doctypes consumed by Inteva P2P.
 *
 * Notes:
 * - Frappe documents share a metadata envelope (`name`, `creation`, `modified`,
 *   `docstatus`, `idx`, ...). It lives on `ErpDoc` and every other interface
 *   extends it.
 * - Numeric flags (`disabled`, `is_group`, ...) are typed as `0 | 1` to mirror
 *   how Frappe stores booleans.
 * - The original spec used the name `PRItem` for both Purchase Requisition Item
 *   and Purchase Receipt Item. Because the same name cannot be exported twice,
 *   `PRItem` is kept for Purchase Requisition Item and the Purchase Receipt
 *   child row is exported as `PurchaseReceiptItem`.
 */

export type DocStatus = 0 | 1 | 2;

/** Common envelope returned by every Frappe document. */
export interface ErpDoc {
  name: string;
  owner?: string;
  creation?: string;
  modified?: string;
  modified_by?: string;
  docstatus?: DocStatus;
  idx?: number;
}

/* -------------------------------------------------------------------------- */
/*  Supplier                                                                  */
/* -------------------------------------------------------------------------- */

export type SupplierType = "Company" | "Individual" | "Partnership" | "Proprietorship";

/** Supplier → Company payable account mapping (Party Account child table). */
export interface PartyAccount extends ErpDoc {
  company: string;
  account: string;
}

/** ERPNext "Supplier" doctype. */
export interface Supplier extends ErpDoc {
  supplier_name: string;
  supplier_group?: string;
  supplier_type?: SupplierType;
  country?: string;
  default_currency?: string;
  accounts?: PartyAccount[];
  default_price_list?: string;
  email_id?: string;
  mobile_no?: string;
  website?: string;
  tax_id?: string;
  tax_category?: string;
  payment_terms?: string;
  represents_company?: string;
  is_internal_supplier?: 0 | 1;
  is_transporter?: 0 | 1;
  is_frozen?: 0 | 1;
  disabled?: 0 | 1;
  on_hold?: 0 | 1;
  hold_type?: "Invoices" | "Payments" | "All" | "";
  release_date?: string;
}

/** ERPNext "Supplier Group" doctype. */
export interface SupplierGroup extends ErpDoc {
  supplier_group_name: string;
  parent_supplier_group?: string;
  is_group?: 0 | 1;
  payment_terms?: string;
  lft?: number;
  rgt?: number;
  old_parent?: string;
}

/* -------------------------------------------------------------------------- */
/*  Material Request (formerly "Purchase Requisition")                         */
/*                                                                             */
/*  ERPNext does not ship a doctype called "Purchase Requisition" — the        */
/*  equivalent first-class doctype is "Material Request" with                  */
/*  `material_request_type = "Purchase"`. We keep `PurchaseRequisition` as     */
/*  a deprecated alias so existing code compiles, but all new callers should   */
/*  use `MaterialRequest` directly.                                            */
/* -------------------------------------------------------------------------- */

export type MaterialRequestType =
  | "Purchase"
  | "Material Transfer"
  | "Material Issue"
  | "Manufacture"
  | "Customer Provided";

/**
 * The full set of statuses ERPNext can attach to a Material Request. We type
 * the field as a union for autocomplete but accept any string at runtime so a
 * custom workflow status doesn't break the UI.
 */
export type MaterialRequestStatus =
  | "Draft"
  | "Submitted"
  | "Stopped"
  | "Cancelled"
  | "Pending"
  | "Partially Ordered"
  | "Ordered"
  | "Issued"
  | "Transferred"
  | "Received"
  | "Manufactured"
  | "Partially Received";

/** Child row of a Material Request. */
export interface MaterialRequestItem extends ErpDoc {
  parent?: string;
  parentfield?: string;
  parenttype?: string;
  item_code: string;
  item_name?: string;
  description?: string;
  qty: number;
  stock_qty?: number;
  uom?: string;
  stock_uom?: string;
  conversion_factor?: number;
  rate?: number;
  amount?: number;
  warehouse?: string;
  schedule_date?: string;
  cost_center?: string;
  project?: string;
  expense_account?: string;
}

/** ERPNext "Material Request" doctype. */
export interface MaterialRequest extends ErpDoc {
  title?: string;
  material_request_type: MaterialRequestType;
  transaction_date: string;
  schedule_date?: string;
  /** Inteva-custom field — falls back to `owner` for display when absent. */
  requested_by?: string;
  department?: string;
  cost_center?: string;
  project?: string;
  company: string;
  status?: MaterialRequestStatus;
  remarks?: string;
  /** Computed field surfaced by some Inteva customisations. */
  total?: number;
  total_qty?: number;
  items: MaterialRequestItem[];
}

/** @deprecated Use `MaterialRequestStatus`. Kept for backwards compatibility. */
export type PurchaseRequisitionStatus = MaterialRequestStatus;
/** @deprecated Use `MaterialRequestItem`. */
export type PRItem = MaterialRequestItem;
/** @deprecated Use `MaterialRequest`. */
export type PurchaseRequisition = MaterialRequest;

/* -------------------------------------------------------------------------- */
/*  Request for Quotation (RFQ)                                               */
/* -------------------------------------------------------------------------- */

export interface RFQSupplierRow extends ErpDoc {
  supplier: string;
  supplier_name?: string;
  contact?: string;
  email_id?: string;
  send_email?: 0 | 1;
  quote_status?: "Pending" | "Received" | "No Quote";
}

export interface RFQItem extends ErpDoc {
  item_code: string;
  item_name?: string;
  description?: string;
  qty: number;
  uom?: string;
  warehouse?: string;
  schedule_date?: string;
  purchase_requisition?: string;
  purchase_requisition_item?: string;
}

/** ERPNext "Request for Quotation" doctype. */
export interface RequestForQuotation extends ErpDoc {
  transaction_date: string;
  /**
   * Custom field used by the Smart RFQ module so suppliers know how long
   * their quote has to be returned. Standard ERPNext stores `valid_till`
   * on Supplier Quotation, not on RFQ — add it as a Custom Field on the
   * Request for Quotation doctype if it isn't already present.
   */
  valid_till?: string;
  status?: "Draft" | "Submitted" | "Cancelled";
  company?: string;
  message_for_supplier?: string;
  terms?: string;
  suppliers: RFQSupplierRow[];
  items: RFQItem[];
}

/** Friendly aliases used by the Smart RFQ module. */
export type RFQ = RequestForQuotation;
export type RFQSupplier = RFQSupplierRow;

/* -------------------------------------------------------------------------- */
/*  RFQ Template                                                              */
/* -------------------------------------------------------------------------- */

export type RFQTemplateCategory =
  | "Raw Materials"
  | "Manufacturing Components"
  | "Electrical Components"
  | "Packaging Materials"
  | "MRO Supplies"
  | "Warehouse Consumables"
  | "IT Equipment"
  | "Logistics & Transportation";

export type RFQTemplateRfqType =
  | "Standard RFQ"
  | "Single Source"
  | "Emergency"
  | "Framework Agreement"
  | "Services";

export type RFQTemplateStatus = "Active" | "Archived";

/** Required supplier documents for RFQs created from this template. */
export interface RFQTemplateRequiredDocuments {
  terms_and_conditions: boolean;
  warranty_certificate: boolean;
  insurance_certificate: boolean;
  nda: boolean;
  compliance_certificate: boolean;
}

/** Approval gates applied when creating RFQs from this template. */
export interface RFQTemplateWorkflowRules {
  budget_approval_required: boolean;
  legal_review_required: boolean;
  finance_review_required: boolean;
  management_approval_required?: boolean;
}

export const DEFAULT_REQUIRED_DOCUMENTS: RFQTemplateRequiredDocuments = {
  terms_and_conditions: true,
  warranty_certificate: false,
  insurance_certificate: false,
  nda: false,
  compliance_certificate: false,
};

export const DEFAULT_WORKFLOW_RULES: RFQTemplateWorkflowRules = {
  budget_approval_required: true,
  legal_review_required: true,
  finance_review_required: true,
  management_approval_required: false,
};

/** @deprecated Use RFQTemplateCategory instead. */
export type RFQTemplateType = RFQTemplateCategory;

/** Child row: supplier in an RFQ Template. */
export interface RFQTemplateSupplierRow extends ErpDoc {
  supplier: string;
  supplier_name?: string;
}

/** Child row: item in an RFQ Template. */
export interface RFQTemplateItemRow extends ErpDoc {
  item_code: string;
  item_name?: string;
  qty: number;
  uom?: string;
  target_price?: number;
  specification?: string;
}

/** Custom "RFQ Template" DocType for reusable RFQ configurations. */
export interface RFQTemplate extends ErpDoc {
  template_name: string;
  category: RFQTemplateCategory;
  rfq_type?: RFQTemplateRfqType;
  description?: string;
  status: RFQTemplateStatus;
  estimated_value?: number;
  usage_count?: number;
  last_used_at?: string;
  items: RFQTemplateItemRow[];
  suppliers: RFQTemplateSupplierRow[];
  required_documents?: RFQTemplateRequiredDocuments;
  workflow_rules?: RFQTemplateWorkflowRules;
}

/* -------------------------------------------------------------------------- */
/*  Supplier Quotation                                                        */
/* -------------------------------------------------------------------------- */

/** Child row of a Supplier Quotation. */
export interface SQItem extends ErpDoc {
  item_code: string;
  item_name?: string;
  description?: string;
  qty: number;
  rate: number;
  amount?: number;
  uom?: string;
  /** Inteva extension — captured on the comparison form. */
  delivery_days?: number;
  /** Standard child link back to the originating RFQ row. */
  request_for_quotation?: string;
  request_for_quotation_item?: string;
}

/** ERPNext "Supplier Quotation" doctype. */
export interface SupplierQuotation extends ErpDoc {
  supplier: string;
  supplier_name?: string;
  transaction_date?: string;
  valid_till?: string;
  status?: string;
  company?: string;
  /**
   * Custom Link field added by the Smart RFQ module to associate a
   * Supplier Quotation with its parent RFQ. Add as a Custom Field
   * (`rfq_no`, Link → Request for Quotation) if it isn't already.
   */
  rfq_no?: string;
  items: SQItem[];
  total?: number;
  grand_total?: number;
  notes?: string;
  // Legal document custom fields (actual ERPNext fieldnames)
  custom_terms_pdf?: string;
  custom_terms_note?: string;
  custom_warranty_pdf?: string;
  custom_warranty_note?: string;
  custom_insurance_pdf?: string;
  custom_insurance_note?: string;
  // Allow dynamic key access for field name discovery
  [key: string]: unknown;
}

/* -------------------------------------------------------------------------- */
/*  Smart RFQ — AI recommendation                                             */
/* -------------------------------------------------------------------------- */

export interface PerItemRecommendation {
  item: string;
  best_supplier: string;
  reason: string;
}

export type SupplierVerdict =
  | "BEST VALUE"
  | "GOOD OPTION"
  | "EXPENSIVE"
  | "AVOID";

export interface SupplierAnalysisScore {
  cost: number;
  delivery: number;
  reliability: number;
  overall: number;
}

export interface SupplierAnalysisRow {
  name: string;
  rank: number;
  verdict: SupplierVerdict;
  grand_total: number;
  strengths: string[];
  weaknesses: string[];
  score: SupplierAnalysisScore;
  why_best_or_worst: string;
}

export interface AICostAnalysis {
  savings_vs_expensive: string;
  savings_percentage: number;
  price_range: string;
}

export interface AIPerItemAnalysis {
  item: string;
  best_supplier: string;
  best_price: number;
  worst_supplier: string;
  worst_price: number;
  price_spread: string;
  recommendation: string;
}

export interface AIRiskFlag {
  type: "cost" | "delivery" | "quality" | "terms";
  severity: "high" | "medium" | "low";
  message: string;
}

export interface AISplitOrderOption {
  recommended: boolean;
  reason: string;
  suggestion: string;
}

/** Full output schema returned by the Anthropic procurement-analysis prompt. */
export interface AIRecommendation {
  recommended_supplier: string;
  confidence_score: number;
  recommendation_summary: string;
  supplier_analysis: SupplierAnalysisRow[];
  cost_analysis: AICostAnalysis;
  per_item_analysis: AIPerItemAnalysis[];
  risk_flags: AIRiskFlag[];
  negotiation_tips: string[];
  split_order_option: AISplitOrderOption;
  final_verdict: string;
  /** Legacy aliases — populated for backward compatibility. */
  reason?: string;
  cost_savings?: string;
  risk_factors?: string[];
  per_item_recommendation?: PerItemRecommendation[];
}

/* -------------------------------------------------------------------------- */
/*  Purchase Order                                                            */
/* -------------------------------------------------------------------------- */

export type PurchaseOrderStatus =
  | "Draft"
  | "On Hold"
  | "To Receive and Bill"
  | "To Bill"
  | "To Receive"
  | "Completed"
  | "Cancelled"
  | "Closed"
  | "Delivered";

/** Child row of a Purchase Order. */
export interface POItem extends ErpDoc {
  parent?: string;
  parentfield?: string;
  parenttype?: string;
  item_code: string;
  item_name?: string;
  description?: string;
  qty: number;
  received_qty?: number;
  billed_amt?: number;
  uom?: string;
  stock_uom?: string;
  conversion_factor?: number;
  rate: number;
  amount?: number;
  base_rate?: number;
  base_amount?: number;
  warehouse?: string;
  expected_delivery_date?: string;
  schedule_date?: string;
  cost_center?: string;
  project?: string;
  purchase_requisition?: string;
  purchase_requisition_item?: string;
  material_request?: string;
  material_request_item?: string;
  supplier_quotation?: string;
  supplier_quotation_item?: string;
}

/** ERPNext "Purchase Order" doctype. */
export interface PurchaseOrder extends ErpDoc {
  supplier: string;
  supplier_name?: string;
  transaction_date: string;
  schedule_date?: string;
  company: string;
  currency?: string;
  conversion_rate?: number;
  buying_price_list?: string;
  status?: PurchaseOrderStatus;
  total_qty?: number;
  total?: number;
  net_total?: number;
  total_taxes_and_charges?: number;
  grand_total?: number;
  rounded_total?: number;
  advance_paid?: number;
  per_received?: number;
  per_billed?: number;
  taxes_and_charges?: string;
  terms?: string;
  remarks?: string;
  /** Custom / Inteva link back to the source RFQ. */
  rfq_name?: string;
  rfq?: string;
  /** Custom field linking PO back to the originating RFQ. */
  custom_rfq_reference?: string;
  items: POItem[];
}

/* -------------------------------------------------------------------------- */
/*  Purchase Receipt (GRN)                                                    */
/* -------------------------------------------------------------------------- */

export type PurchaseReceiptStatus =
  | "Draft"
  | "To Bill"
  | "Completed"
  | "Cancelled"
  | "Closed"
  | "Return Issued";

/** Child row of a Purchase Receipt. */
export interface PurchaseReceiptItem extends ErpDoc {
  parent?: string;
  parentfield?: string;
  parenttype?: string;
  item_code: string;
  item_name?: string;
  description?: string;
  received_qty: number;
  qty: number;
  rejected_qty?: number;
  uom?: string;
  stock_uom?: string;
  conversion_factor?: number;
  rate: number;
  amount?: number;
  warehouse?: string;
  rejected_warehouse?: string;
  cost_center?: string;
  project?: string;
  purchase_order?: string;
  purchase_order_item?: string;
  batch_no?: string;
  serial_no?: string;
}

/** ERPNext "Purchase Receipt" doctype. */
export interface PurchaseReceipt extends ErpDoc {
  supplier: string;
  supplier_name?: string;
  posting_date: string;
  posting_time?: string;
  set_posting_time?: 0 | 1;
  company: string;
  currency?: string;
  conversion_rate?: number;
  supplier_delivery_note?: string;
  status?: PurchaseReceiptStatus;
  total?: number;
  total_qty?: number;
  net_total?: number;
  grand_total?: number;
  per_billed?: number;
  remarks?: string;
  items: PurchaseReceiptItem[];
}

/* -------------------------------------------------------------------------- */
/*  Purchase Invoice                                                          */
/* -------------------------------------------------------------------------- */

export type PurchaseInvoiceStatus =
  | "Draft"
  | "Return"
  | "Debit Note Issued"
  | "Submitted"
  | "Paid"
  | "Partly Paid"
  | "Unpaid"
  | "Overdue"
  | "Cancelled"
  | "Internal Transfer";

/** Child row of a Purchase Invoice. */
export interface PIItem extends ErpDoc {
  parent?: string;
  parentfield?: string;
  parenttype?: string;
  item_code: string;
  item_name?: string;
  description?: string;
  qty: number;
  received_qty?: number;
  uom?: string;
  rate: number;
  amount?: number;
  base_rate?: number;
  base_amount?: number;
  expense_account?: string;
  cost_center?: string;
  project?: string;
  warehouse?: string;
  purchase_order?: string;
  purchase_order_item?: string;
  purchase_receipt?: string;
  pr_detail?: string;
}

/** ERPNext "Purchase Invoice" doctype. */
export interface PurchaseInvoice extends ErpDoc {
  supplier: string;
  supplier_name?: string;
  posting_date: string;
  due_date?: string;
  bill_no?: string;
  bill_date?: string;
  company: string;
  currency?: string;
  conversion_rate?: number;
  is_paid?: 0 | 1;
  is_return?: 0 | 1;
  status?: PurchaseInvoiceStatus;
  total?: number;
  net_total?: number;
  total_taxes_and_charges?: number;
  grand_total?: number;
  rounded_total?: number;
  outstanding_amount?: number;
  paid_amount?: number;
  credit_to?: string;
  /** Currency of `credit_to` — outstanding is denominated in this currency. */
  payable_currency?: string;
  remarks?: string;
  items: PIItem[];
}

/* -------------------------------------------------------------------------- */
/*  Payment Entry                                                             */
/* -------------------------------------------------------------------------- */

export type PaymentType = "Pay" | "Receive" | "Internal Transfer";

export type PartyType = "Supplier" | "Customer" | "Employee" | "Shareholder" | "Student" | "Member";

/** Reference linking a Payment Entry to an Invoice / Order. */
export interface PaymentEntryReference extends ErpDoc {
  reference_doctype: string;
  reference_name: string;
  due_date?: string;
  total_amount?: number;
  outstanding_amount?: number;
  allocated_amount: number;
  exchange_rate?: number;
}

/** ERPNext "Payment Entry" doctype. */
export interface PaymentEntry extends ErpDoc {
  payment_type: PaymentType;
  party_type?: PartyType;
  party?: string;
  party_name?: string;
  posting_date: string;
  company: string;
  mode_of_payment?: string;
  paid_from?: string;
  paid_to?: string;
  paid_from_account_currency?: string;
  paid_to_account_currency?: string;
  paid_amount: number;
  received_amount?: number;
  source_exchange_rate?: number;
  target_exchange_rate?: number;
  reference_no?: string;
  reference_date?: string;
  status?: "Draft" | "Submitted" | "Cancelled";
  remarks?: string;
  references?: PaymentEntryReference[];
}

/* -------------------------------------------------------------------------- */
/*  Cost Center                                                               */
/* -------------------------------------------------------------------------- */

/** ERPNext "Cost Center" doctype (used in Material Request form). */
export interface CostCenter extends ErpDoc {
  cost_center_name: string;
  parent_cost_center?: string;
  company: string;
  is_group?: 0 | 1;
  disabled?: 0 | 1;
  lft?: number;
  rgt?: number;
  old_parent?: string;
}

/* -------------------------------------------------------------------------- */
/*  Inventory: Item & Bin                                                     */
/* -------------------------------------------------------------------------- */

/** ERPNext "Item" doctype (item master). */
export interface Item extends ErpDoc {
  item_code: string;
  item_name: string;
  item_group?: string;
  stock_uom?: string;
  gst_hsn_code?: string;
  description?: string;
  brand?: string;
  standard_rate?: number;
  is_stock_item?: 0 | 1;
  has_batch_no?: 0 | 1;
  has_serial_no?: 0 | 1;
  disabled?: 0 | 1;
  safety_stock?: number;
  weight_per_unit?: number;
  weight_uom?: string;
  default_warehouse?: string;
}

/* -------------------------------------------------------------------------- */
/*  Supplier Scoring Config                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Singleton settings DocType that controls how supplier scores are weighted.
 * All four weights must sum to exactly 100.
 *
 * Permissions: only Procurement Manager (and System Manager) may edit.
 */
export interface SupplierScoringConfig extends ErpDoc {
  price_weight: number;
  delivery_weight: number;
  quality_weight: number;
  reliability_weight: number;
}

/** Default weights used when no server-side config exists yet. */
export const DEFAULT_SCORING_WEIGHTS: Omit<SupplierScoringConfig, keyof ErpDoc> = {
  price_weight: 40,
  delivery_weight: 25,
  quality_weight: 20,
  reliability_weight: 15,
};

/** ERPNext "Bin" doctype — per-warehouse stock state for an Item. */
export interface Bin extends ErpDoc {
  item_code: string;
  warehouse: string;
  actual_qty: number;
  reserved_qty?: number;
  ordered_qty?: number;
  projected_qty?: number;
  reserved_qty_for_production?: number;
  reserved_qty_for_sub_contract?: number;
  valuation_rate?: number;
  stock_value?: number;
  stock_uom?: string;
}

/* -------------------------------------------------------------------------- */
/*  Supplier Scoring Result                                                   */
/* -------------------------------------------------------------------------- */

/** Dimension scores computed by the deterministic scoring engine. */
export interface SupplierDimensionScores {
  price_score: number;
  delivery_score: number;
  quality_score: number;
  reliability_score: number;
}

/** Per-supplier scoring result row (child table of SupplierScoringResult). */
export interface SupplierScoreRow extends ErpDoc {
  supplier: string;
  supplier_name?: string;
  price_score: number;
  delivery_score: number;
  quality_score: number;
  reliability_score: number;
  final_score: number;
  ranking: number;
  recommendation_reason: string;
}

/**
 * Custom DocType storing the weighted scoring results for a given RFQ.
 * Created automatically after the AI analysis runs on submitted quotations.
 */
export interface SupplierScoringResult extends ErpDoc {
  rfq: string;
  scored_at: string;
  price_weight: number;
  delivery_weight: number;
  quality_weight: number;
  reliability_weight: number;
  supplier_scores: SupplierScoreRow[];
}

/* -------------------------------------------------------------------------- */
/*  Legal / Finance Review  (stored directly on the RFQ — no separate DocType)*/
/* -------------------------------------------------------------------------- */

export type LegalReviewStatus =
  | "Pending Legal Review"
  | "Approved"
  | "Rejected";

export type FinanceReviewStatus =
  | "Pending Finance Review"
  | "Budget Approved"
  | "Rejected";

export type RFQApprovalStep =
  | "Supplier Selected"
  | "Pending Legal Review"
  | "Legal Approved"
  | "Legal Rejected"
  | "Pending Finance Review"
  | "Finance Approved"
  | "Finance Rejected"
  | "Approved for PO"
  | "PO Created";

/**
 * Lightweight comment structure stored in the per-RFQ approval state
 * (localStorage). No separate DocType is required.
 */
export interface LegalComment {
  comment: string;
  comment_by: string;
  comment_date: string;
  action?: LegalReviewStatus | "Comment" | "Resubmit";
}

export interface FinanceComment {
  comment: string;
  comment_by: string;
  comment_date: string;
  action?: FinanceReviewStatus | "Comment" | "Resubmit";
}

/**
 * Approval workflow state for a single RFQ.
 * Persisted in localStorage and synchronised with the RFQ's
 * `custom_legal_status` / `custom_finance_status` fields in ERPNext.
 */
export interface RFQApprovalState {
  rfq: string;
  rfq_title?: string;
  company?: string;
  selected_supplier: string;
  selected_supplier_total: number;
  workflow_step: RFQApprovalStep;
  legal_status: LegalReviewStatus;
  finance_status: FinanceReviewStatus;
  submitted_by: string;
  submitted_at: string;
  legal_reviewer?: string;
  legal_review_date?: string;
  legal_comments: LegalComment[];
  finance_reviewer?: string;
  finance_review_date?: string;
  finance_comments: FinanceComment[];
  terms_approved?: boolean;
  warranty_approved?: boolean;
  insurance_approved?: boolean;
}

/**
 * Shape used by LegalReviewsPage and LegalDashboard — a projection of
 * RFQ fields plus the locally-stored approval metadata.
 */
export interface LegalReviewItem {
  rfq_name: string;
  rfq_title?: string;
  company?: string;
  supplier?: string;
  rfq_value: number;
  submission_date?: string;
  created_by?: string;
  legal_status: LegalReviewStatus;
  legal_reviewer?: string;
  legal_review_date?: string;
  legal_comments: LegalComment[];
  /** Linked Purchase Order name, populated when one exists for this RFQ. */
  po_name?: string;
  /** Finance review status — shows why PO may not exist yet. */
  finance_status?: FinanceReviewStatus;
  finance_reviewer?: string;
  finance_review_date?: string;
  /** Current workflow step from localStorage approval state. */
  workflow_step?: RFQApprovalStep;
  terms_approved?: boolean;
  warranty_approved?: boolean;
  insurance_approved?: boolean;
}

/**
 * Shape used by FinanceReviewsPage — a projection of RFQ fields plus
 * finance-specific approval metadata from localStorage.
 */
export interface FinanceReviewItem {
  rfq_name: string;
  rfq_title?: string;
  supplier?: string;
  rfq_value: number;
  submission_date?: string;
  created_by?: string;
  legal_status: LegalReviewStatus;
  finance_status: FinanceReviewStatus;
  finance_reviewer?: string;
  finance_review_date?: string;
  finance_comments: FinanceComment[];
  cost_center?: string;
}

