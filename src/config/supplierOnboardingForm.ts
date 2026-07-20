/**
 * Multi-step Supplier Onboarding form schema.
 * Category-specific fields map into form_data JSON only.
 * Common / Direct / Indirect fields map to DocType columns.
 */

export type OnboardingStepId =
  | "company"
  | "contact"
  | "business"
  | "type_details"
  | "category_details"
  | "bank"
  | "documents"
  | "review";

export type FieldKind = "text" | "textarea" | "number" | "select" | "checkbox" | "email" | "tel" | "url";

export interface OnboardingFieldDef {
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  /** DocType column vs category JSON bucket */
  storage: "column" | "form_data";
  options?: string[];
  /** Dynamically load select options (never hardcode Supplier Category). */
  optionsSource?: "supplier_category";
  placeholder?: string;
}

export interface OnboardingStepDef {
  id: OnboardingStepId;
  label: string;
  fields: OnboardingFieldDef[];
}

export const DOCUMENT_TYPES = [
  "GST Certificate",
  "PAN",
  "Company Profile",
  "Cancelled Cheque",
  "MSME Certificate",
  "ISO Certificate",
  "Factory License",
  "Financial Statements",
  "Insurance",
  "Catalog",
  "Other Documents",
] as const;

const COMPANY_FIELDS: OnboardingFieldDef[] = [
  {
    name: "custom_sourcing_type",
    label: "Supplier Type",
    kind: "select",
    required: true,
    storage: "form_data",
    options: ["Direct", "Indirect"],
  },
  {
    name: "custom_supplier_category",
    label: "Supplier Category",
    kind: "select",
    required: true,
    storage: "form_data",
    optionsSource: "supplier_category",
  },
  { name: "company_name", label: "Company Name", kind: "text", required: true, storage: "column" },
  { name: "gst_number", label: "GST Number", kind: "text", storage: "column" },
  { name: "pan", label: "PAN", kind: "text", storage: "column" },
  { name: "business_registration_number", label: "Business Registration Number", kind: "text", storage: "column" },
  { name: "website", label: "Website", kind: "url", storage: "column" },
  { name: "address_line", label: "Address", kind: "textarea", storage: "column" },
  { name: "country", label: "Country", kind: "text", storage: "column" },
  { name: "state", label: "State", kind: "text", storage: "column" },
  { name: "city", label: "City", kind: "text", storage: "column" },
  { name: "postal_code", label: "Postal Code", kind: "text", storage: "column" },
];

const CONTACT_FIELDS: OnboardingFieldDef[] = [
  { name: "contact_person", label: "Contact Person", kind: "text", required: true, storage: "column" },
  { name: "designation", label: "Designation", kind: "text", storage: "column" },
  { name: "email", label: "Email", kind: "email", required: true, storage: "column" },
  { name: "phone", label: "Phone", kind: "tel", storage: "column" },
  { name: "alternate_phone", label: "Alternate Phone", kind: "tel", storage: "column" },
  { name: "mobile_no", label: "Mobile Number", kind: "tel", storage: "column" },
];

const BUSINESS_FIELDS: OnboardingFieldDef[] = [
  { name: "years_in_business", label: "Years in Business", kind: "text", storage: "column" },
  { name: "employee_count", label: "Employee Count", kind: "text", storage: "column" },
  { name: "annual_turnover", label: "Annual Turnover", kind: "text", storage: "column" },
  { name: "preferred_currency", label: "Preferred Currency", kind: "text", storage: "column", placeholder: "INR" },
  { name: "payment_terms", label: "Payment Terms", kind: "text", storage: "column" },
];

const DIRECT_FIELDS: OnboardingFieldDef[] = [
  { name: "manufacturing_plant", label: "Manufacturing Plant", kind: "text", storage: "column" },
  { name: "factory_address", label: "Factory Address", kind: "textarea", storage: "column" },
  { name: "production_capacity", label: "Production Capacity", kind: "text", storage: "column" },
  { name: "monthly_capacity", label: "Monthly Capacity", kind: "text", storage: "column" },
  { name: "lead_time", label: "Lead Time", kind: "text", storage: "column" },
  { name: "moq", label: "MOQ", kind: "text", storage: "column" },
  { name: "quality_certifications", label: "Quality Certifications", kind: "textarea", storage: "column" },
  { name: "iso_certified", label: "ISO", kind: "checkbox", storage: "column" },
  { name: "iatf_certified", label: "IATF", kind: "checkbox", storage: "column" },
  { name: "production_process", label: "Production Process", kind: "textarea", storage: "column" },
  { name: "machine_list", label: "Machine List", kind: "textarea", storage: "column" },
  { name: "material_categories", label: "Material Categories", kind: "textarea", storage: "column" },
  { name: "countries_exported", label: "Countries Exported", kind: "textarea", storage: "column" },
];

const INDIRECT_FIELDS: OnboardingFieldDef[] = [
  { name: "business_type", label: "Business Type", kind: "text", storage: "column" },
  { name: "service_area", label: "Service Area", kind: "text", storage: "column" },
  { name: "delivery_coverage", label: "Delivery Coverage", kind: "text", storage: "column" },
  { name: "support_availability", label: "Support Availability", kind: "text", storage: "column" },
  { name: "amc_available", label: "AMC Available", kind: "checkbox", storage: "column" },
  { name: "sla_available", label: "SLA Available", kind: "checkbox", storage: "column" },
  { name: "contract_duration", label: "Contract Duration", kind: "text", storage: "column" },
];

const BANK_FIELDS: OnboardingFieldDef[] = [
  { name: "bank_name", label: "Bank Name", kind: "text", storage: "column" },
  { name: "bank_account_number", label: "Bank Account Number", kind: "text", storage: "column" },
  { name: "bank_ifsc", label: "IFSC / SWIFT", kind: "text", storage: "column" },
  { name: "bank_branch", label: "Bank Branch", kind: "text", storage: "column" },
];

/** Category-specific schemas → form_data only. Keys match Supplier Category names. */
const CATEGORY_FIELDS: Record<string, OnboardingFieldDef[]> = {
  "Raw Material": [
    { name: "raw_material_types", label: "Raw Material Types", kind: "textarea", storage: "form_data" },
    { name: "grade", label: "Grade", kind: "text", storage: "form_data" },
    { name: "specification", label: "Specification", kind: "textarea", storage: "form_data" },
    { name: "testing_facility", label: "Testing Facility", kind: "text", storage: "form_data" },
    { name: "warehouse_capacity", label: "Warehouse Capacity", kind: "text", storage: "form_data" },
    { name: "supply_capacity", label: "Supply Capacity", kind: "text", storage: "form_data" },
    { name: "packaging_type", label: "Packaging Type", kind: "text", storage: "form_data" },
  ],
  Packaging: [
    { name: "packaging_types", label: "Packaging Types", kind: "textarea", storage: "form_data" },
    { name: "printing_capability", label: "Printing Capability", kind: "text", storage: "form_data" },
    { name: "eco_friendly", label: "Eco Friendly", kind: "checkbox", storage: "form_data" },
    { name: "custom_packaging", label: "Custom Packaging", kind: "checkbox", storage: "form_data" },
  ],
  Mechanical: [
    { name: "machining", label: "Machining", kind: "checkbox", storage: "form_data" },
    { name: "casting", label: "Casting", kind: "checkbox", storage: "form_data" },
    { name: "forging", label: "Forging", kind: "checkbox", storage: "form_data" },
    { name: "heat_treatment", label: "Heat Treatment", kind: "checkbox", storage: "form_data" },
    { name: "tolerance_capability", label: "Tolerance Capability", kind: "text", storage: "form_data" },
  ],
  "IT Hardware": [
    { name: "hardware", label: "Hardware", kind: "textarea", storage: "form_data" },
    { name: "cloud", label: "Cloud", kind: "text", storage: "form_data" },
    { name: "licensing", label: "Licensing", kind: "text", storage: "form_data" },
    { name: "support_hours", label: "Support Hours", kind: "text", storage: "form_data" },
  ],
  Software: [
    { name: "software", label: "Software", kind: "textarea", storage: "form_data" },
    { name: "cloud", label: "Cloud", kind: "text", storage: "form_data" },
    { name: "licensing", label: "Licensing", kind: "text", storage: "form_data" },
    { name: "support_hours", label: "Support Hours", kind: "text", storage: "form_data" },
  ],
  Services: [
    { name: "service_type", label: "Service Type", kind: "text", storage: "form_data" },
    { name: "support_team_size", label: "Support Team Size", kind: "text", storage: "form_data" },
    { name: "response_time", label: "Response Time", kind: "text", storage: "form_data" },
    { name: "working_hours", label: "Working Hours", kind: "text", storage: "form_data" },
    { name: "emergency_support", label: "Emergency Support", kind: "checkbox", storage: "form_data" },
  ],
  Consulting: [
    { name: "service_type", label: "Service Type", kind: "text", storage: "form_data" },
    { name: "support_team_size", label: "Support Team Size", kind: "text", storage: "form_data" },
    { name: "response_time", label: "Response Time", kind: "text", storage: "form_data" },
    { name: "working_hours", label: "Working Hours", kind: "text", storage: "form_data" },
    { name: "emergency_support", label: "Emergency Support", kind: "checkbox", storage: "form_data" },
  ],
  Maintenance: [
    { name: "service_type", label: "Service Type", kind: "text", storage: "form_data" },
    { name: "support_team_size", label: "Support Team Size", kind: "text", storage: "form_data" },
    { name: "response_time", label: "Response Time", kind: "text", storage: "form_data" },
    { name: "working_hours", label: "Working Hours", kind: "text", storage: "form_data" },
    { name: "emergency_support", label: "Emergency Support", kind: "checkbox", storage: "form_data" },
  ],
};

export function getCategoryFields(categoryName: string): OnboardingFieldDef[] {
  return CATEGORY_FIELDS[categoryName] ?? [];
}

export function getOnboardingSteps(
  supplierType: "Direct" | "Indirect" | string,
  categoryName: string,
): OnboardingStepDef[] {
  const typeFields = supplierType === "Indirect" ? INDIRECT_FIELDS : DIRECT_FIELDS;
  const categoryFields = getCategoryFields(categoryName);

  const steps: OnboardingStepDef[] = [
    { id: "company", label: "Company", fields: COMPANY_FIELDS },
    { id: "contact", label: "Contact", fields: CONTACT_FIELDS },
    { id: "business", label: "Business", fields: BUSINESS_FIELDS },
    { id: "type_details", label: supplierType === "Indirect" ? "Service Details" : "Plant & Capacity", fields: typeFields },
  ];

  if (categoryFields.length > 0) {
    steps.push({ id: "category_details", label: "Category Details", fields: categoryFields });
  }

  steps.push(
    { id: "bank", label: "Bank", fields: BANK_FIELDS },
    { id: "documents", label: "Documents", fields: [] },
    { id: "review", label: "Review & Submit", fields: [] },
  );

  return steps;
}

export const COLUMN_FIELD_NAMES = new Set(
  [
    ...COMPANY_FIELDS,
    ...CONTACT_FIELDS,
    ...BUSINESS_FIELDS,
    ...DIRECT_FIELDS,
    ...INDIRECT_FIELDS,
    ...BANK_FIELDS,
  ].map((f) => f.name),
);

export function splitPayload(values: Record<string, unknown>): {
  columns: Record<string, unknown>;
  formDataFields: Record<string, unknown>;
} {
  const columns: Record<string, unknown> = {};
  const formDataFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (COLUMN_FIELD_NAMES.has(key)) columns[key] = value;
    else formDataFields[key] = value;
  }
  return { columns, formDataFields };
}
