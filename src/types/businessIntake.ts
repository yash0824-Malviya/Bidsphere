/**
 * Enterprise Business Intake Module — Type Definitions
 *
 * Defines the 10 DocTypes & Child Tables for:
 * 1. Business Need
 * 2. Business Case
 * 3. Business Need Document (Child)
 * 4. Business Case Financial (Child)
 * 5. Business Case Technical Requirement (Child)
 * 6. Business Case Risk Assessment (Child)
 * 7. Business Case Stakeholder (Child)
 * 8. Business Case Document (Child)
 * 9. Business Case Approval History (Child)
 * 10. Business Case Procurement Strategy (Child)
 *
 * NOTE: There is NO Department Head role or Department Head approval step.
 */

export type NeedPriority = "Low" | "Medium" | "High" | "Critical";
export type NeedType = "Direct" | "Indirect";
export type BudgetType = "CAPEX" | "OPEX" | "CAPEX + OPEX" | "Mixed" | "Not Yet Determined";

export type NeedStatus =
  | "Draft"
  | "Submitted"
  | "Under Review"
  | "Approved"
  | "Rejected"
  | "Revision Required";

export type NeedDocumentType =
  | "Business"
  | "Technical"
  | "Commercial"
  | "Financial"
  | "Legal"
  | "Compliance"
  | "Engineering"
  | "CAD"
  | "Specification"
  | "Other";

export interface BusinessNeedDocument {
  name?: string;
  document_type: NeedDocumentType;
  file: string;
  description?: string;
  uploaded_by: string;
  uploaded_date: string;
  version?: string;
}

export interface IntakeAttachment {
  id?: string;
  name: string;
  file_name?: string;
  fileName?: string;
  url?: string;
  file_url?: string;
  content_type?: string;
  is_private?: boolean;
  size?: string;
  file_size?: number;
  date?: string;
  uploaded_on?: string;
  uploaded_by?: string;
  category?: string;
  type?: string;
  fileType?: string;
  file_id?: string;
  uploading?: boolean;
  uploadStatus?: "SELECTED" | "UPLOADING" | "UPLOADED" | "FAILED";
  uploadProgress?: number;
  status?: "Available" | "Pending Review" | "Reviewed" | "Requires Clarification" | "Rejected";
  version?: string;
  error?: string;
  rawFile?: File;
  document_type?: string;
  required?: boolean;
  reviewed?: boolean;
  reviewed_by?: string;
  reviewed_at?: string;
  signature_required?: boolean;
  signature_status?: "Not Required" | "Pending" | "Signed" | "Verified" | "Invalid";
  signed_by?: string;
  signed_at?: string;
  document_hash?: string;
  clarification_comment?: string;
}

export interface FinanceGateBlocker {
  code: string;
  message: string;
  field?: string;
}

export interface FinanceGateValidationResult {
  canApprove: boolean;
  blockers: FinanceGateBlocker[];
  checklistRequired?: boolean;
}

export interface FinanceChecklistState {
  budgetVerified: boolean;
  capexOpexVerified: boolean;
  financialAssumptionsReviewed: boolean;
  requiredDocumentsReviewed: boolean;
  requiredSignaturesVerified: boolean;
  businessJustificationReviewed: boolean;
  financialFeasibilityConfirmed: boolean;
}

export interface BusinessNeed {
  name: string; // Business Need ID e.g. BN-2026-00001
  business_need_id: string;
  title: string;
  description: string;
  need_type: NeedType;
  priority: NeedPriority;
  status: NeedStatus;
  workflow_status: NeedStatus;

  // Organization
  company: string;
  business_unit?: string;
  department: string;
  plant?: string;
  plant_location?: string;
  project?: string;
  project_name?: string;
  project_code?: string;
  program?: string;
  program_name?: string;
  cost_center?: string;
  business_area?: string;

  // Requester
  requester: string;
  requester_email: string;
  business_owner: string;
  business_owner_email?: string;
  required_by_date?: string;
  expected_completion_date?: string;

  // Business Justification & Requirement
  requirement_category?: string;
  requirement_type?: string;
  current_situation?: string;
  problem_statement: string;
  business_problem?: string;
  business_justification?: string;
  business_impact?: string;
  customer_impact?: string;
  operational_impact?: string;
  expected_benefits?: string;
  strategic_importance?: string;
  consequences_of_not_proceeding?: string;

  // Budget
  estimated_budget: number;
  currency: string;
  budget_type: BudgetType;
  funding_source?: string;
  estimated_quantity?: number;

  // Attachments & Child tables
  business_need_documents: BusinessNeedDocument[];
  attachments: IntakeAttachment[];
  technical_requirements?: string | TechnicalRequirementItem[] | Record<string, unknown>[];
  technical_requirements_list?: TechnicalRequirementItem[];

  // System
  created_by: string;
  created_date: string;
  last_modified: string;
  business_case?: string;
  rejection_reason?: string;
  revision_notes?: string;
}

// ── BUSINESS CASE CHILD TABLES ─────────────────────────────────────────────

export type FinancialRisk = "Low" | "Medium" | "High" | "Not Assessed";
export type PaybackUnit = "Months" | "Years";
export type FinancialCalculationStatus =
  | "Incomplete"
  | "Calculated"
  | "Invalid"
  | "Not Applicable";

export interface BusinessCaseCashFlowRow {
  year: number;
  beginning_balance?: number;
  investment?: number;
  annual_savings?: number;
  revenue_increase?: number;
  cost_avoidance?: number;
  opex?: number;
  annual_gross_benefit?: number;
  annual_net_benefit?: number;
  discount_rate?: number;
  discount_factor?: number;
  discounted_cash_flow?: number;
  cumulative_cash_flow?: number;
  outflow?: number;
  inflow?: number;
  net?: number;
  cumulative?: number;
  discounted?: number;
}

export interface BusinessCaseFinancial {
  budget: number;
  capex: number;
  opex: number;
  annual_spend?: number;
  target_savings?: number;
  expected_savings: number;
  expected_savings_percentage?: number;
  roi: number; // percentage e.g. 24.5
  npv: number; // numeric value e.g. 150000
  irr: number; // percentage e.g. 18.2
  payback_period: number; // numeric value e.g. 14 or 1.5
  payback_unit: PaybackUnit;
  cost_avoidance?: number;
  funding_source?: string;
  financial_risk: FinancialRisk;
  financial_comments?: string;
}

export type TechnicalRequirementType =
  | "Product / Equipment"
  | "Software"
  | "Hardware"
  | "Service"
  | "System Integration"
  | "Infrastructure"
  | "Automation"
  | "IT / Digital Solution"
  | "Other";

export type TechnicalUOM =
  | "Nos."
  | "Unit"
  | "Set"
  | "License"
  | "System"
  | "Lot"
  | "Other";

export interface TechnicalRequirementItem {
  id?: string;
  requirement_type: TechnicalRequirementType;
  specification: string;
  quantity: number;
  uom: TechnicalUOM;
  priority: NeedPriority;
  is_mandatory: boolean;
  performance_requirements?: string;
  quality_requirements?: string;
  delivery_installation_requirements?: string;
  integration_requirements?: string;
  safety_compliance_requirements?: string;
  required_supplier_documents?: string[];
  attachments?: IntakeAttachment[];
  // Legacy fields compatibility
  procurement_type?: NeedType;
  item?: string;
  item_code?: string;
  part_number?: string;
  description?: string;
  installation_required?: boolean;
}

export type BusinessCaseTechnicalRequirement = TechnicalRequirementItem;


export type StrategyType = "Strategic" | "Tactical" | "Operational";
export type SourcingMethod =
  | "Competitive RFQ"
  | "RFI"
  | "RFP"
  | "Reverse Auction"
  | "Sole Source"
  | "Dual Source"
  | "Global Sourcing"
  | "Local Sourcing"
  | "Framework Agreement"
  | "Negotiation";

export interface BusinessCaseProcurementStrategy {
  strategy: StrategyType;
  sourcing_method: SourcingMethod;
  auction_required?: boolean;
  single_source?: boolean;
  dual_source?: boolean;
  global_sourcing?: boolean;
  local_sourcing?: boolean;
  supplier_category?: string;
  target_suppliers?: string;
  target_rfq_date?: string;
  strategy_notes?: string;
}

export type RiskCategory =
  | "Supply"
  | "Commercial"
  | "Technical"
  | "Quality"
  | "Country"
  | "Currency"
  | "Capacity"
  | "Cyber"
  | "ESG"
  | "Legal"
  | "Operational"
  | "Financial";

export type RiskSeverity = "Low" | "Medium" | "High" | "Critical";
export type RiskImpact = "Low" | "Medium" | "High" | "Critical";
export type RiskStatus = "Open" | "Mitigated" | "Accepted" | "Closed";

export interface BusinessCaseRiskAssessment {
  risk_category: RiskCategory;
  severity: RiskSeverity;
  probability: number; // percentage e.g. 20
  impact: RiskImpact;
  risk_score?: number;
  mitigation_plan: string;
  risk_owner?: string;
  status: RiskStatus;
}

export interface BusinessCaseStakeholder {
  department: string;
  employee: string;
  role: string;
  responsibility?: string;
  comments?: string;
}

export interface BusinessCaseDocument {
  category: NeedDocumentType | "Contract" | "Image" | "Video" | "Presentation";
  file: string;
  document_name: string;
  version?: string;
  uploaded_by: string;
  uploaded_date: string;
  remarks?: string;
}

export type ApprovalStage = "Finance" | "Legal" | "Procurement" | "Executive" | "Department";
export type ApprovalAction =
  | "Approved"
  | "Rejected"
  | "Revision Requested"
  | "Submitted"
  | "Resubmitted"
  | "Marked Procurement Ready"
  | "RFQ Created"
  | string;

export type BusinessCaseType =
  | "New Procurement"
  | "New Requirement"
  | "Replacement"
  | "Expansion"
  | "Regulatory / Mandatory"
  | "Emergency"
  | "Existing Supplier Replacement"
  | "Cost Reduction"
  | "Capacity Expansion"
  | "Strategic Sourcing"
  | "Operational Requirement"
  | "Other"
  | string;

export interface BusinessCaseAlternative {
  id?: string;
  name: string;
  description: string;
  estimated_cost: number;
  advantages?: string;
  disadvantages?: string;
  reason_not_selected?: string;
  feasibility?: string;
  rejection_reason?: string;
}

export interface BusinessCaseRiskItem {
  id?: string;
  risk?: string;
  category: string;
  description?: string;
  probability?: number;
  likelihood?: string | number;
  impact: string | number;
  risk_level?: string;
  risk_score?: number;
  mitigation?: string;
  mitigation_plan?: string;
  owner?: string;
  target_date?: string;
}

export interface BusinessCaseApprovalHistory {
  stage: ApprovalStage | string;
  approver: string;
  user?: string;
  role: string;
  user_role?: string;
  action: ApprovalAction | string;
  comments: string;
  approved_on: string;
  revision_number: number;
  digital_signature?: string;
  previous_state?: string;
  new_state?: string;
  status?: string;
  date?: string;
  time?: string;
}

// ── BUSINESS CASE PARENT DOCTYPE ───────────────────────────────────────────

export type CaseGateStatus =
  | "Pending"
  | "Under Review"
  | "Approved"
  | "Rejected"
  | "Revision Requested"
  | "Revision Required"
  | "Bypassed"
  | string;

export type CaseWorkflowStatus =
  | "Draft"
  | "Submitted"
  | "Pending Engineering"
  | "Pending Engineering Manager"
  | "Pending Finance"
  | "Pending Finance Executive"
  | "Pending Procurement"
  | "Pending Legal"
  | "Pending Final Approval"
  | "Returned"
  | "Rejected"
  | "Approved"
  | "Ready for RFQ"
  | "Revision Required (Finance)"
  | "Revision Required (Legal)"
  | "Revision Required (Engineering)"
  // Legacy statuses for backward compatibility:
  | "Pending Finance Review"
  | "Finance Approved"
  | "Revision Required - Finance"
  | "Pending Legal Review"
  | "Legal Approved"
  | "Revision Required - Legal"
  | "Procurement Ready"
  | "Approved - Ready for RFQ"
  | "RFQ Created"
  | "Cancelled"
  | "Closed"
  | string;

export interface CaseComment {
  id: string;
  author: string;
  role: string;
  text: string;
  date: string;
}

export interface BusinessCase {
  name: string; // Business Case ID e.g. BC-2026-00001 or BC-00001
  business_case_id: string;
  business_need?: string; // Link: Business Need
  business_need_id?: string;
  title: string;
  department: string;
  business_unit?: string;
  company?: string;
  plant?: string;
  commodity?: string;
  category?: string;
  project?: string;
  program?: string;
  cost_center?: string;
  requester?: string;
  requester_name?: string;
  requester_email?: string;
  business_owner: string;
  business_owner_email?: string;
  procurement_owner?: string;
  priority?: NeedPriority;
  case_type?: string;
  business_case_type?: BusinessCaseType | string;
  creation_date?: string;
  required_date?: string;
  required_delivery_date?: string;
  problem_statement?: string;
  current_limitations?: string;
  technical_specifications?: string;
  rfq_target_date?: string;
  risk_matrix?: BusinessCaseRiskItem[];
  technical_status?: CaseGateStatus;
  gl_account?: string;
  status?: string;
  creation?: string;
  modified?: string;

  // Workflow state & active ownership
  current_stage?: string;
  current_approver?: string;
  current_approver_role?: string;

  // Review Requirement Flags
  technical_review_required?: boolean;
  finance_review_required?: boolean;
  operations_review_required?: boolean;
  quality_review_required?: boolean;
  legal_review_required?: boolean;
  high_value_required?: boolean;

  // Business Justification
  executive_summary?: string;
  business_objective?: string;
  business_justification: string;
  business_problem: string;
  current_situation: string;
  why_procurement_required?: string;
  current_supplier_limitation?: string;
  customer_impact?: string;
  operational_impact?: string;
  revenue_impact?: string;
  strategic_importance?: string;
  expected_outcome: string;
  consequences_of_not_proceeding?: string;
  alternatives_considered?: string;
  alternatives?: BusinessCaseAlternative[];
  recommendation: string; // Recommended Solution

  // Financial Analysis Model
  budget: number;
  currency?: string;
  annual_spend?: number;
  need_type?: NeedType | string;
  capex: number;
  opex: number;
  target_savings?: number;
  expected_savings: number;
  expected_annual_savings?: number;
  expected_annual_benefit?: number;
  expected_revenue_impact?: number;
  revenue_increase?: number;
  cost_avoidance?: number;
  funding_source?: string;
  financial_justification?: string;
  project_duration?: number;
  discount_rate?: number;

  total_investment?: number;
  annual_gross_benefit?: number;
  annual_net_benefit?: number;
  total_net_benefit?: number;
  net_project_gain?: number;
  roi: number;
  roi_formatted?: string;
  npv: number;
  npv_formatted?: string;
  irr: number;
  irr_formatted?: string;
  payback_period: string; // e.g. "14 Months"
  payback_period_years?: number | null;
  financial_risk: FinancialRisk;

  financial_calculation_status?: FinancialCalculationStatus;
  financial_calculation_message?: string;
  financial_calculated_at?: string;

  // Technical Requirements
  technical_requirements?: string | TechnicalRequirementItem[] | Record<string, unknown>[];
  technical_notes?: string;

  // Procurement Strategy
  procurement_strategy: SourcingMethod | string;
  sourcing_strategy?: string;
  procurement_type?: string;
  supplier_strategy?: string;
  expected_supplier_count?: number;
  supplier_category?: string;
  target_suppliers?: string;
  target_rfq_date?: string;
  rfq_start_date?: string;
  rfq_closing_date?: string;
  expected_award_date?: string;
  procurement_justification?: string;
  procurement_notes?: string;

  // Risk Assessment
  risk_assessment?: string;
  risks?: BusinessCaseRiskItem[];

  // Sustainability & Compliance
  compliance_requirements?: string;
  regulatory_requirements?: string;
  environmental_requirements?: string;
  sustainability_requirements?: string;
  supplier_certification?: string;
  safety_requirements?: string;
  documentation_requirements?: string;
  compliance_notes?: string;

  // Child Tables
  financials: BusinessCaseFinancial[];
  cash_flows?: BusinessCaseCashFlowRow[];
  technical_requirements_list: BusinessCaseTechnicalRequirement[];
  procurement_strategy_detail?: BusinessCaseProcurementStrategy;
  risk_assessments: BusinessCaseRiskAssessment[];
  stakeholders: BusinessCaseStakeholder[];
  documents: BusinessCaseDocument[];
  approval_history: BusinessCaseApprovalHistory[];

  // Supporting Docs & Legacy Comments
  attachments?: IntakeAttachment[];
  supporting_documents: IntakeAttachment[];
  comments: CaseComment[];

  // Workflow Gates & Status
  finance_status: CaseGateStatus;
  finance_approved_by?: string;
  finance_approved_date?: string;
  finance_comments?: string;

  legal_status: CaseGateStatus;
  legal_approved_by?: string;
  legal_approved_date?: string;
  legal_comments?: string;
  legal_signature?: string | { signatureName: string; fontId?: string; signedAt?: string };
  legal_checklist?: string | Record<string, boolean>;
  legal_review_docs?: string | any[];

  engineering_status?: CaseGateStatus;
  engineering_approved_by?: string;
  engineering_approved_date?: string;
  engineering_comments?: string;

  procurement_status?: CaseGateStatus;
  procurement_approved_by?: string;
  procurement_approved_date?: string;
  procurement_comments?: string;

  program_manager_status?: CaseGateStatus;
  program_manager_approved_by?: string;
  program_manager_approved_date?: string;
  program_manager_comments?: string;

  approval_status: "Pending Finance" | "Pending Legal" | "Approved" | "Rejected" | "Revision Required" | string;
  workflow_status: CaseWorkflowStatus;
  is_locked: boolean; // Locked after Program Manager final approval
  revision_number: number;

  estimated_budget?: number;
  total_budget?: number;
  submitted_date?: string;
  required_by_date?: string;
  rejection_reason?: string;
  send_back_reason?: string;
  rfq_id?: string; // Linked RFQ ID e.g. RFQ-2026-0004
  created_by: string;
  created_date: string;
  last_modified: string;
}

// ── INPUT CONTRACTS ────────────────────────────────────────────────────────

export interface CreateBusinessNeedInput {
  title: string;
  description: string;
  need_type: NeedType;
  priority: NeedPriority;
  requirement_category?: string;
  company: string;
  business_unit?: string;
  department: string;
  plant?: string;
  plant_location?: string;
  project?: string;
  project_name?: string;
  project_code?: string;
  program?: string;
  program_name?: string;
  cost_center?: string;
  business_area?: string;
  requester: string;
  requester_email: string;
  business_owner: string;
  business_owner_email?: string;
  required_by_date?: string;
  expected_completion_date?: string;
  current_situation?: string;
  problem_statement: string;
  business_impact?: string;
  customer_impact?: string;
  operational_impact?: string;
  expected_benefits?: string;
  strategic_importance?: string;
  consequences_of_not_proceeding?: string;
  business_justification?: string;
  business_problem?: string;
  expected_outcome?: string;
  business_objective?: string;
  executive_summary?: string;
  alternatives_considered?: string;
  recommendation?: string;
  estimated_budget: number;
  currency?: string;
  budget_type?: BudgetType;
  funding_source?: string;
  estimated_quantity?: number;
  requirement_type?: string;
  technical_requirements?: string | TechnicalRequirementItem[] | Record<string, unknown>[];
  technical_requirements_list?: TechnicalRequirementItem[];
  business_need_documents?: BusinessNeedDocument[];
  attachments?: IntakeAttachment[];
}

export interface CreateBusinessCaseInput extends Partial<BusinessCase> {
  business_need_id?: string;
  title?: string;
  case_type?: string;
  priority?: NeedPriority;
  business_justification?: string;
  business_problem?: string;
  current_situation?: string;
  expected_outcome?: string;
  alternatives_considered?: string;
  alternatives?: BusinessCaseAlternative[];
  recommendation?: string;
  budget?: number;
  total_investment?: number;
  estimated_budget?: number;
  capex?: number;
  opex?: number;
  opex_year?: number;
  roi?: number;
  npv?: number;
  irr?: number;
  payback_period?: string;
  expected_savings?: number;
  expected_annual_savings?: number;
  revenue_increase__year?: number;
  revenue_increase?: number;
  cost_avoidance__year?: number;
  cost_avoidance?: number;
  project_duration?: number;
  discount_rate?: number;
  financial_risk?: FinancialRisk;
  technical_requirements?: string | TechnicalRequirementItem[] | Record<string, unknown>[];
  technical_review_required?: boolean;
  finance_review_required?: boolean;
  operations_review_required?: boolean;
  quality_review_required?: boolean;
  legal_review_required?: boolean;
  high_value_required?: boolean;
  procurement_strategy?: SourcingMethod | string;
  sourcing_strategy?: string;
  procurement_type?: string;
  supplier_strategy?: string;
  expected_supplier_count?: number;
  supplier_category?: string;
  target_suppliers?: string;
  rfq_start_date?: string;
  rfq_closing_date?: string;
  expected_award_date?: string;
  target_rfq_date?: string;
  procurement_justification?: string;
  procurement_notes?: string;
  currency?: string;
  compliance_requirements?: string;
  regulatory_requirements?: string;
  environmental_requirements?: string;
  sustainability_requirements?: string;
  supplier_certification?: string;
  safety_requirements?: string;
  documentation_requirements?: string;
  compliance_notes?: string;
  risk_assessment?: string;
  risks?: BusinessCaseRiskItem[];
  attachments?: IntakeAttachment[];
  supporting_documents?: IntakeAttachment[];
  financials?: BusinessCaseFinancial[];
  technical_requirements_list?: BusinessCaseTechnicalRequirement[];
  procurement_strategy_detail?: BusinessCaseProcurementStrategy;
  risk_assessments?: BusinessCaseRiskAssessment[];
  stakeholders?: BusinessCaseStakeholder[];
  documents?: BusinessCaseDocument[];
}
