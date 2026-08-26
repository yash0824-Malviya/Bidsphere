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
  /** Custom: Direct / Indirect sourcing classification */
  custom_sourcing_type?: string;
  /** Custom: Link → Supplier Category */
  custom_supplier_category?: string;
  /** JSON array of Procurement Categories (multi-select). */
  custom_procurement_categories?: string;
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
  /** Optional engineering part label (not Item Master). */
  custom_part_name?: string;
  /** Item group snapshot at request time. */
  item_group?: string;
  /** Attach — primary drawing file URL (legacy / first attachment). */
  custom_2d_drawing?: string;
  /** Long Text JSON array of EngineeringAttachment objects. */
  custom_engineering_attachments?: string;
  /**
   * Original Department requested quantity (snapshot).
   * Provisioned by scripts/setup-rfq-procurement-qty.mjs.
   */
  custom_department_requested_qty?: number | null;
  /**
   * Warehouse available qty at review/forward time.
   * Provisioned by scripts/setup-rfq-procurement-qty.mjs.
   */
  custom_warehouse_available_qty?: number | null;
  /**
   * Hydrated at read time from JSON + File DocType (not stored on ERP row).
   * See `hydrateMaterialRequestItemsWithAttachments`.
   */
  attachments?: import("../utils/materialRequestItemFiles").EngineeringAttachment[];
  attachment_count?: number;
  attachment_file_name?: string;
  attachment_file_url?: string;
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
  /** BidSphere workflow (custom field — see setup-material-request-workflow.mjs) */
  custom_bidsphere_status?: string;
  custom_department?: string;
  custom_priority?: string;
  custom_purpose?: string;
  custom_warehouse_remarks?: string;
  custom_procurement_remarks?: string;
  custom_linked_rfq?: string;
  custom_requested_by?: string;
  /** Single source of truth for item + supplier filtering (see setup script). */
  custom_procurement_category?: string;
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
  stock_uom?: string;
  conversion_factor?: number;
  warehouse?: string;
  schedule_date?: string;
  purchase_requisition?: string;
  purchase_requisition_item?: string;
  material_request?: string;
  material_request_item?: string;
  /** Carried from Material Request Item (read-only downstream). */
  custom_part_name?: string;
  custom_2d_drawing?: string;
  custom_engineering_attachments?: string;
  /** Alias / fallback target price field */
  target_price?: number | null;
  /**
   * Internal target unit price for variance / savings analysis.
   * Set during RFQ creation. Provisioned by scripts/setup-rfq-target-price.mjs.
   */
  custom_target_price?: number | null;
  /**
   * Per-line: when enabled, this line's Target Price is visible to suppliers.
   * Falls back to RFQ.custom_show_target_price_to_supplier for older RFQs.
   */
  custom_show_target_price_to_supplier?: 0 | 1 | boolean | number;
  /**
   * Original Department requested quantity (internal only).
   * Provisioned by scripts/setup-rfq-procurement-qty.mjs.
   */
  custom_department_requested_qty?: number | null;
  /**
   * Warehouse available qty at forward time (internal only).
   */
  custom_warehouse_available_qty?: number | null;
  /**
   * Final sourcing quantity set by Procurement. RFQ Item.qty mirrors this
   * for suppliers, AI Analysis, PO, GRN, Invoice, and Payment.
   */
  custom_procurement_final_qty?: number | null;
  /** Reason when Procurement Final Qty differs from Department Requested. */
  custom_qty_change_reason?: string | null;
  /**
   * Convenience aliases for the primary attachment URL ref
   * (same File as custom_2d_drawing / first JSON entry — not a new File).
   */
  attachment_name?: string;
  attachment_url?: string;
  attachment_type?: string;
}

/** ERPNext "Request for Quotation" doctype. */
export interface RequestForQuotation extends ErpDoc {
  transaction_date: string;
  /** Link back to the originating ECR when this is a direct ECR RFQ. */
  custom_ecr_reference?: string;
  /** Hidden unique key owned by the trusted direct ECR → RFQ endpoint. */
  custom_bidsphere_ecr_idempotency_key?: string;
  /** Optional legacy/configured Purchase Requisition trace. */
  custom_purchase_requisition_reference?: string;
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
  /**
   * Custom Check field. When enabled, invited suppliers must complete a
   * Cost Breakdown on their quotation. Provisioned by
   * scripts/setup-cost-breakdown-doctype.mjs.
   */
  custom_require_cost_breakdown?: 0 | 1 | boolean;
  /**
   * When enabled, Target Price on RFQ items is visible to invited suppliers
   * and included in supplier-facing RFQ PDFs. Provisioned by
   * scripts/setup-rfq-target-price.mjs.
   */
  custom_show_target_price_to_supplier?: 0 | 1 | boolean;
  /** Active enterprise quote round (Link: RFQ Round). */
  custom_active_rfq_round?: string;
  /** Inherited from Material Request — read-only in RFQ UI. */
  custom_procurement_category?: string;
  /** Current round number (1-based). */
  custom_current_round_number?: number;
  suppliers: RFQSupplierRow[];
  items: RFQItem[];
}

/** Friendly aliases used by the Smart RFQ module. */
export type RFQ = RequestForQuotation;
export type RFQSupplier = RFQSupplierRow;

export interface RfqQuoteRoundDoc extends ErpDoc {
  rfq: string;
  round_number: number;
  tracking_id: string;
  previous_round?: string;
  reason_code: string;
  remarks: string;
  status: "Draft" | "Active" | "Closed" | "Cancelled";
  created_by_user?: string;
  message_for_supplier?: string;
  terms?: string;
  valid_till?: string;
  items?: RFQItem[];
  suppliers?: RFQSupplierRow[];
}

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
  /** Enterprise RFQ Quote Round link (custom_rfq_round). */
  custom_rfq_round?: string;
  items: SQItem[];
  total?: number;
  grand_total?: number;
  notes?: string;
  // Legal document custom fields — verified actual ERPNext fieldnames via
  // `Custom Field` metadata query (dt = "Supplier Quotation"). Note the
  // double underscore in `custom_terms__condition` and the upstream typo
  // "warenty" in `custom_warenty_certificate` — both must match exactly.
  custom_terms__condition?: string;
  custom_terms_note?: string;
  custom_warenty_certificate?: string;
  custom_warranty_note?: string;
  custom_insurance_certificate?: string;
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
  /** Header default warehouse for received items. */
  set_warehouse?: string;
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
  /* Warehouse Digital Signature (custom fields — see setup-warehouse-esign-fields.mjs) */
  warehouse_signed?: 0 | 1 | boolean;
  warehouse_signed_by?: string;
  warehouse_signature_type?: string;
  warehouse_signature_data?: string;
  warehouse_signature_style?: string;
  warehouse_signature_hash?: string;
  warehouse_signed_at?: string;
  warehouse_ip?: string;
  warehouse_browser?: string;
  warehouse_device?: string;
  warehouse_esign_envelope?: string;
  warehouse_signer_role?: string;
  warehouse_signer_email?: string;
  warehouse_verification_status?: string;
  warehouse_document_version?: string;
  warehouse_signed_pdf_url?: string;
  warehouse_signed_pdf_hash?: string;
  warehouse_signature_image?: string;
  warehouse_signature_name?: string;
  warehouse_signature_role?: string;
  warehouse_signature_employee_id?: string;
  warehouse_signature_email?: string;
  warehouse_signature_timestamp?: string;
  warehouse_signature_ip?: string;
  warehouse_signature_device?: string;
  warehouse_signature_algorithm?: string;
  warehouse_signature_version?: string;
  warehouse_signature_verified?: 0 | 1 | boolean;
  /** Canonical completion fields (Sign & Finalize). */
  signed?: 0 | 1 | boolean;
  signed_pdf_url?: string;
  signed_pdf_file?: string;
  signed_pdf_path?: string;
  signed_by?: string;
  signed_at?: string;
  sha256_hash?: string;
  certificate_status?: string;
  verification_status?: string;
  document_integrity?: string;
  signature_image?: string;
  /** Legacy aliases kept for older GRNs. */
  signed_grn_pdf?: string;
  warehouse_signature?: string;
  warehouse_signature_time?: string;
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
  min_order_qty?: number;
  weight_per_unit?: number;
  weight_uom?: string;
  default_warehouse?: string;
  custom_procurement_type?: string;
  custom_procurement_category?: string;
  custom_bidsphere_item_status?: string;
  custom_max_stock?: number;
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
  recommended_supplier?: string;
  /** Full AI recommendation envelope, JSON-serialized — see `saveScoringResult`. */
  analysis_snapshot?: string;
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

export interface FinanceReviewItem {
  rfq_name: string;
  rfq_title?: string;
  /**
   * The Legal Document Review record backing this item — the single source
   * of truth in ERPNext. Used to address Approve/Reject/Resubmit directly
   * without re-resolving by RFQ name.
   */
  legal_document_name?: string;
  supplier?: string;
  company?: string;
  department?: string;
  cost_center?: string;
  budget_reference?: string;
  rfq_value: number;
  submission_date?: string;
  created_date?: string;
  created_by?: string;
  legal_status: LegalReviewStatus;
  legal_review_date?: string;
  workflow_status?: RFQApprovalStep;
  finance_status: FinanceReviewStatus;
  finance_reviewer?: string;
  /** Finance manager assigned to review (same as reviewer once action is taken). */
  assigned_finance_manager?: string;
  finance_review_date?: string;
  finance_comments: FinanceComment[];
  /** Required context for a Finance Rejected decision; empty when Approved. */
  finance_rejection_reason?: string;
}

/* -------------------------------------------------------------------------- */
/*  Engineering Change Request (ECR)                                           */
/* -------------------------------------------------------------------------- */

/**
 * ECR status values — stored in the `select_pxfp` field (quirky auto-generated
 * fieldname from ERPNext). The Frappe workflow "ECR Approval Workflow" controls
 * transitions between these states.
 */
export type ECRStatus =
  | "Draft"
  | "Engineering Review"
  | "Operations Review"
  | "Quality Review"
  | "Program Review"
  | "Sent Back"
  | "Approved"
  | "Procurement"
  | "Purchase Requisition"
  | "RFQ"
  | "Supplier Selection"
  | "Submitted"
  | "Needs Revision"
  | "Under Review"
  | "Cross-Functional Review"
  | "ECR Approved"
  | "Requisition Creation"
  | "Procurement Review"
  | "RFQ Pending"
  | "RFQ Created"
  | "Supplier Response"
  | "Supplier Evaluation"
  | "Supplier Selected"
  | "Implementation"
  | "Validation"
  | "Closed"
  | "Rejected"
  | "Cancelled";

export type ECRType =
  | "Part Change"
  | "Design Change"
  | "Material Change"
  | "Process Change"
  | "Tooling Change"
  | "Supplier Change"
  | "Quality Change"
  | "Packaging Change"
  | "Cost Change"
  | "Other"
  | "Regulatory"
  | "Cost Reduction"
  | "Quality Issue";

export type ECRPriority = "Low" | "Medium" | "High" | "Critical";

export type ECRSupplierResponseType =
  | "Feasibility"
  | "Quotation"
  | "Tooling"
  | "Capacity"
  | "Lead Time"
  | "Quality Validation"
  | "Technical Compliance"
  | "Commercial + Technical"
  | "Full Response"
  | "New Part Quotation"
  | "Tooling Quotation"
  | "Feasibility Study"
  | "Prototype"
  | "PPAP Submission";

export type ECRValidationStatus = "Not Started" | "Pending" | "In Progress" | "Passed" | "Failed";

/** Existing procurement document used as the source for ECR affected parts. */
export type ECRProcurementReferenceType = "None" | "RFQ" | "Purchase Order";

/** Row in the `affected_parts` child table on ECR. */
export interface ECRAffectedPart extends ErpDoc {
  /** Link → Item */
  partitem?: string;
  part_description?: string;
  current_revision?: string;
  new_revision?: string;
  quantity?: number;
  /** Link → UOM */
  uom?: string;
  program?: string;
  /** Link → Plant Floor */
  plant?: string;
  /** Link → Supplier */
  current_supplier?: string;
  /** Link → Supplier */
  proposed_supplier?: string;
  effective_date?: string;
  change_required?: string;
  technical_notes?: string;
  /** RFQ or PO selected as the authoritative source for this line. */
  source_reference_type?: Exclude<ECRProcurementReferenceType, "None">;
  /** Actual ERPNext RFQ / PO document name returned by the backend. */
  source_document_reference?: string;
  /** Actual ERPNext RFQ Item / Purchase Order Item child-row name. */
  source_item_reference?: string;
}

/** Row in the `supplier_response_requirements` child table on ECR. */
export interface ECRSupplierResponseRequirement extends ErpDoc {
  response_type?: string;
  requirement?: string;
  mandatory?: 0 | 1;
  target_value?: string;
  unit?: string;
  notes?: string;
}

/** Trusted workflow decision row maintained by the secured ECR transition API. */
export interface ECRApprovalRequirement extends ErpDoc {
  department?: string;
  approval_role: string;
  approver?: string;
  required?: 0 | 1;
  status?: "Pending" | "Approved" | "Rejected" | "Sent Back" | "Completed";
  approval_date?: string;
  comments?: string;
}

/**
 * ERPNext "Engineering Change Request" DocType.
 *
 * IMPORTANT fieldname quirks (confirmed from live instance):
 *   - Workflow state is stored in `select_pxfp`; `status` is kept in sync for
 *     list/report compatibility.
 *   - "ECR Owner" is stored in `ecr_owner` (Link → User)
 *   - `amended_from` is retained only for legacy records/Frappe amendment semantics
 *   - "Change Description" has a typo: `chnage_description`
 *   - Plant fields on child tables link to `Plant Floor` DocType (not Warehouse)
 */
export interface EngineeringChangeRequest extends ErpDoc {
  /** Auto-generated ECR number (e.g. ECR-2026-0001) */
  ecr_number?: string;
  ecr_title: string;
  ecr_type?: ECRType;
  priority: ECRPriority;
  /** ECR Owner. Link → User. */
  ecr_owner?: string;
  /** Legacy owner fallback / Frappe amendment link. */
  amended_from?: string;
  /** Link → Department */
  requesting_department: string;
  /** Link → Warehouse */
  plant: string;
  program?: string;
  project?: string;
  target_implementation_date: string;
  /** Note: fieldname has a typo — `chnage_description` */
  chnage_description: string;
  reason_for_change: string;
  business_justification?: string;
  current_state?: string;
  proposed_state?: string;

  /** Child table — Affected Parts */
  affected_parts?: ECRAffectedPart[];

  // Impact Assessment checkboxes
  product_impact?: 0 | 1;
  material_impact?: 0 | 1;
  manufacturing_impact?: 0 | 1;
  tooling_impact?: 0 | 1;
  quality_impact?: 0 | 1;
  cost_impact?: 0 | 1;
  supplier_impact?: 0 | 1;
  delivery_impact?: 0 | 1;
  customer_impact?: 0 | 1;
  contract_impact?: 0 | 1;

  // Supplier Requirement
  supplier_response_required?: "Yes" | "No";
  supplier_response_type?: ECRSupplierResponseType;
  /** Link → Supplier */
  suggested_supplier?: string;
  /** Existing procurement source; separate from downstream documents created after approval. */
  procurement_reference_type?: ECRProcurementReferenceType;
  /** Link → Request for Quotation (existing source reference). */
  existing_rfq_reference?: string;
  /** Link → Purchase Order (existing source reference). */
  existing_purchase_order_reference?: string;
  required_quantity?: number;
  /** Link → UOM */
  quantity_uom?: string;
  /** Child table — Supplier Response Requirements */
  supplier_response_requirements?: ECRSupplierResponseRequirement[];

  /** Child table — sequential review assignments and completed decisions. */
  approval_requirements?: ECRApprovalRequirement[];

  // Attachments
  engineering_drawing?: string;
  "3d_cad_file"?: string;
  specification?: string;
  supporting_documents?: string;
  engineering_notes?: string;

  // Procurement integration (read-only, set by automation)
  /** Link → Purchase Requisition */
  purchase_requisition?: string;
  /** Link → Request for Quotation */
  rfq?: string;
  /** Link → Supplier Quotation */
  supplier_quotation?: string;
  /** Link → Supplier */
  selected_supplier?: string;
  /** Link → Purchase Order */
  purchase_order?: string;

  // Implementation & Validation
  implementation_notes?: string;
  implementation_date?: string;
  validation_status?: ECRValidationStatus;
  validation_notes?: string;
  validation_documents?: string;

  /**
   * The workflow status field. Frappe auto-named this `select_pxfp`.
   * Values are the ECRStatus union above or workflow state string.
   */
  select_pxfp?: ECRStatus | string;
  /** Synchronized display/report status; server workflow actions update both. */
  status?: ECRStatus | string;
}

/* -------------------------------------------------------------------------- */
/*  Purchase Requisition (Custom — ECR-driven)                                 */
/* -------------------------------------------------------------------------- */

export type PRStatus =
  | "Draft"
  | "Submitted"
  | "Needs Revision"
  | "Under Review"
  | "Approved"
  | "Rejected"
  | "RFQ Created"
  | "Closed"
  | "Cancelled";

export type PRSourceType = "ECR" | "Business Request" | "Manual";
export type PRPriority = "Low" | "Medium" | "High" | "Critical";

/** Row in the `requisition_items` child table on Purchase Requisition. */
export interface PurchaseRequisitionItem extends ErpDoc {
  /** Link → Item */
  partitem?: string;
  description?: string;
  revision?: string;
  quantity: number;
  /** Link → UOM */
  uom: string;
  required_date?: string;
  /** Link → Plant Floor */
  plant?: string;
  /** Link → Supplier */
  supplier?: string;
  technical_requirement?: string;
  ecr_change_required?: 0 | 1;
}

/** ERPNext "Purchase Requisition" custom DocType. */
export interface CustomPurchaseRequisition extends ErpDoc {
  requisition_title: string;
  source_type: PRSourceType;
  /** Link → Engineering Change Request */
  ecr_reference?: string;
  /** Hidden unique key owned by the trusted ECR → PR endpoint. */
  custom_bidsphere_ecr_idempotency_key?: string;
  /** Link → User */
  requester: string;
  /** Link → Department */
  requesting_department: string;
  /** Link → Warehouse */
  plant: string;
  program?: string;
  project?: string;
  required_date: string;
  priority: PRPriority;
  purpose__requirement?: string;
  procurement_category?: string;
  procurement_notes?: string;
  /** Child table — Requisition Items */
  requisition_items?: PurchaseRequisitionItem[];
  /** Link → Supplier */
  suggested_supplier?: string;
  /** Link → Request for Quotation */
  rfq?: string;
  status: PRStatus;
  amended_from?: string;
}
