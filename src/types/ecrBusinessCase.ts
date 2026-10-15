import type { EngineeringChangeRequest } from "./erpnext";

export type ECRBusinessCaseStatus = "Draft" | "Finance Review" | "Procurement BC Review" | "Quality Review" | "Approved" | "Sent Back" | "Rejected";
export type ECRBusinessCaseApprovalStatus = "Pending" | "Approved" | "Rejected" | "Sent Back" | "Not Required";
export type ECRBusinessCaseReviewRole = "finance" | "procurement" | "quality";
export interface ECRBusinessCaseDocument { file_name: string; file_url: string }

/** Editable business justification; approval and calculated fields are server-owned. */
export interface ECRBusinessCasePayload {
  why_required: string;
  problem_statement: string;
  expected_benefits: string;
  current_cost: number;
  proposed_cost: number;
  implementation_cost: number;
  one_time_cost: number;
  recurring_cost: number;
  annual_volume: number;
  revenue_impact: string;
  budget_impact: string;
  customer_impact: string;
  program_impact: string;
  plant_impact: string;
  production_impact: string;
  supplier_impact: string;
  quality_impact: string;
  timeline_impact: string;
  business_risk: string;
  financial_risk: string;
  supplier_risk: string;
  quality_risk: string;
  overall_risk: "Low" | "Medium" | "High";
  recommendation: "Approve" | "Reject" | "Need More Information";
  supporting_documents: ECRBusinessCaseDocument[];
}

export interface ECRBusinessCase extends ECRBusinessCasePayload {
  name: string;
  ecr_reference: string;
  business_case_id: string;
  status: ECRBusinessCaseStatus;
  expected_annual_savings: number;
  roi: number | null;
  payback_period: number | null;
  finance_status: ECRBusinessCaseApprovalStatus;
  finance_comment?: string;
  finance_approved_by?: string;
  finance_approved_date?: string;
  procurement_status: ECRBusinessCaseApprovalStatus;
  procurement_comment?: string;
  procurement_approved_by?: string;
  procurement_approved_date?: string;
  quality_status: ECRBusinessCaseApprovalStatus;
  quality_comment?: string;
  quality_approved_by?: string;
  quality_approved_date?: string;
  rfq_required?: "Yes" | "No";
  rfq_decision_reason?: string;
  created_by: string;
  creation: string;
  modified: string;
  history?: Array<{ action: string; role: string; actor: string; timestamp: string; comment: string; from_status: string; to_status: string }>;
}

export interface ECRBusinessCaseAggregate {
  ecr: EngineeringChangeRequest;
  businessCase: ECRBusinessCase | null;
}

export function emptyECRBusinessCasePayload(): ECRBusinessCasePayload {
  return {
    why_required: "", problem_statement: "", expected_benefits: "",
    current_cost: 0, proposed_cost: 0, implementation_cost: 0, one_time_cost: 0,
    recurring_cost: 0, annual_volume: 0, revenue_impact: "", budget_impact: "",
    customer_impact: "", program_impact: "", plant_impact: "", production_impact: "",
    supplier_impact: "", quality_impact: "", timeline_impact: "", business_risk: "",
    financial_risk: "", supplier_risk: "", quality_risk: "", overall_risk: "Low",
    recommendation: "Need More Information", supporting_documents: [],
  };
}

export function calculateECRBusinessCaseFinancials(values: Pick<ECRBusinessCasePayload, "current_cost" | "proposed_cost" | "annual_volume" | "implementation_cost">) {
  const annualSavings = (values.current_cost - values.proposed_cost) * values.annual_volume;
  return {
    expected_annual_savings: annualSavings,
    roi: values.implementation_cost > 0 ? ((annualSavings - values.implementation_cost) / values.implementation_cost) * 100 : null,
    payback_period: annualSavings > 0 ? (values.implementation_cost / annualSavings) * 12 : null,
  };
}

export function parseECRBusinessCase(value: unknown): ECRBusinessCase | null {
  if (!value) return null;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && typeof parsed.name === "string" && typeof parsed.ecr_reference === "string" ? parsed as ECRBusinessCase : null;
  } catch { return null; }
}
