import type { ClmField } from "../../api/clm";

export const CONTRACT_CREATION_STEPS = [
  { id: "source-parties", title: "Source & Parties", description: "Choose a procurement source, contracting parties, and template." },
  { id: "contract-details", title: "Contract Details", description: "Define the contract period, scope, and renewal terms." },
  { id: "commercial-terms", title: "Commercial Terms", description: "Set the value, currency, pricing, and payment terms." },
  { id: "performance-compliance", title: "Performance & Compliance", description: "Capture delivery, quality, performance, and review requirements." },
  { id: "documents-review", title: "Documents & Review", description: "Attach supporting documents and review the complete contract." },
] as const;

const STEP_FIELDS: readonly (readonly string[])[] = [
  ["party_type", "party_name", "party_user", "custom_supplier", "contract_template", "custom_inteva_signatory", "document_type", "document_name", "custom_contract_request", "custom_rfq", "custom_supplier_quotation", "custom_purchase_order", "custom_rfp", "custom_rfp_response"],
  ["custom_contract_title", "custom_contract_type", "start_date", "end_date", "custom_program_name", "custom_project", "custom_business_unit", "custom_part_numbers", "contract_terms", "custom_auto_renewal", "custom_renewal_notice_days", "custom_renewal_terms"],
  ["custom_contract_value", "custom_currency", "custom_pricing_terms", "custom_payment_terms", "custom_payment_terms_description", "custom_incentives", "custom_penalties"],
  ["custom_risk_level", "custom_sla__kpi_commitments", "custom_quality_requirements", "custom_delivery_terms", "custom_termination_clauses", "custom_legal_review_required", "custom_engineering_review_required", "custom_quality_review_required", "custom_compliance_required", "requires_fulfilment", "fulfilment_deadline", "fulfilment_terms"],
  ["custom_contract_document"],
];
const FIELD_POSITION = new Map(STEP_FIELDS.flatMap((fields, step) => fields.map((field, order) => [field, { step, order }] as const)));

/** Receives the existing editable metadata; grouping never hides or rewrites fields. */
export function groupContractFields(fields: readonly ClmField[]): ClmField[][] {
  const groups: ClmField[][] = CONTRACT_CREATION_STEPS.map(() => []);
  const seen = new Set<string>();
  for (const field of fields) {
    if (seen.has(field.fieldname)) continue;
    seen.add(field.fieldname);
    const step = field.fieldtype.startsWith("Attach") ? 4 : FIELD_POSITION.get(field.fieldname)?.step ?? 1;
    groups[step].push(field);
  }
  for (const group of groups) group.sort((a, b) => (FIELD_POSITION.get(a.fieldname)?.order ?? Number.MAX_SAFE_INTEGER) - (FIELD_POSITION.get(b.fieldname)?.order ?? Number.MAX_SAFE_INTEGER));
  return groups;
}

export interface ContractStepValidationOptions { forReview?: boolean; }
export type ContractFieldErrors = Record<string, string>;

// These names mirror the existing Contract save and submit_review contracts.
const DRAFT_REQUIRED = new Set(["contract_terms", "custom_contract_title", "custom_contract_type", "custom_currency"]);
const REVIEW_REQUIRED = new Set(["custom_risk_level", "start_date", "end_date", "custom_inteva_signatory"]);
const NUMBER_TYPES = new Set(["Currency", "Float", "Int", "Percent"]);
const RISK_LEVELS = new Set(["Low", "Medium", "High", "Critical"]);

export function contractFieldRequired(field: ClmField, options: ContractStepValidationOptions = {}): boolean {
  return Boolean(field.reqd) || DRAFT_REQUIRED.has(field.fieldname) || Boolean(options.forReview && REVIEW_REQUIRED.has(field.fieldname));
}

function isEmpty(value: unknown): boolean {
  return value == null || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && value.length === 0);
}

function validDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validDateTime(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const parts = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(value);
  return Boolean(parts && validDate(parts[1]) && Number(parts[2]) < 24 && Number(parts[3]) < 60 && (!parts[4] || Number(parts[4]) < 60));
}

/** Validate only the supplied stage; pass all editable fields for final submission. */
export function validateContractStep(fields: readonly ClmField[], values: Record<string, unknown>, options: ContractStepValidationOptions = {}): ContractFieldErrors {
  const errors: ContractFieldErrors = {};
  for (const field of fields) {
    const value = values[field.fieldname];
    const label = field.label?.trim() || field.fieldname.replace(/^custom_/, "").replaceAll("_", " ");
    if (isEmpty(value)) {
      if (contractFieldRequired(field, options)) errors[field.fieldname] = `${label} is required.`;
      continue;
    }
    // Zero and false are valid explicit answers, including required Check fields.
    if (NUMBER_TYPES.has(field.fieldtype) && (typeof value !== "number" && typeof value !== "string" || !Number.isFinite(Number(value)))) errors[field.fieldname] = `Enter a valid number for ${label}.`;
    else if (field.fieldtype === "Int" && !Number.isInteger(Number(value))) errors[field.fieldname] = `Enter a whole number for ${label}.`;
    else if (field.fieldtype === "Date" && !validDate(value)) errors[field.fieldname] = `Enter a valid date for ${label}.`;
    else if (field.fieldtype === "Datetime" && !validDateTime(value)) errors[field.fieldname] = `Enter a valid date and time for ${label}.`;
    else if (field.options === "Email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) errors[field.fieldname] = `Enter a valid email address for ${label}.`;
    else if (options.forReview && field.fieldname === "custom_risk_level" && !RISK_LEVELS.has(String(value))) errors[field.fieldname] = "Select a valid assessed Contract risk level before review.";
  }
  if (fields.some(field => field.fieldname === "end_date") && validDate(values.start_date) && validDate(values.end_date) && String(values.end_date) < String(values.start_date)) errors.end_date = "End Date must be on or after Start Date.";
  return errors;
}
