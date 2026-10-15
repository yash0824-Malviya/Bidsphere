import { describe, expect, it } from "vitest";
import type { ClmField } from "../../api/clm";
import { CONTRACT_CREATION_STEPS, contractFieldRequired, groupContractFields, validateContractStep } from "./contractCreationSteps";

const field = (fieldname: string, fieldtype = "Data", extra: Partial<ClmField> = {}): ClmField => ({ fieldname, fieldtype, ...extra });

// Writable Contract fields from the existing ERPNext schema audit. Keep the
// original names (including double underscores); this is not a new schema.
const existingContractFields: ClmField[] = [
  field("party_type", "Select", { reqd: 1 }), field("party_name", "Dynamic Link", { reqd: 1 }), field("party_user", "Link"),
  field("start_date", "Date"), field("end_date", "Date"), field("contract_template", "Link"), field("contract_terms", "Text Editor", { reqd: 1 }),
  field("requires_fulfilment", "Check"), field("fulfilment_deadline", "Date"), field("document_type", "Select"), field("document_name", "Dynamic Link"),
  field("custom_auto_renewal", "Check"), field("custom_business_unit"), field("custom_compliance_required", "Check"),
  field("custom_contract_document", "Attach"), field("custom_contract_request", "Link"), field("custom_contract_title", "Data", { reqd: 1 }),
  field("custom_contract_type", "Select"), field("custom_contract_value", "Currency"), field("custom_currency", "Link"),
  field("custom_delivery_terms", "Small Text"), field("custom_engineering_review_required", "Check"), field("custom_incentives", "Small Text"),
  field("custom_inteva_signatory", "Link"), field("custom_legal_review_required", "Check"), field("custom_part_numbers", "Small Text"),
  field("custom_payment_terms"), field("custom_payment_terms_description", "Small Text"), field("custom_penalties", "Small Text"),
  field("custom_pricing_terms", "Small Text"), field("custom_program_name"), field("custom_project", "Link"), field("custom_purchase_order", "Link"),
  field("custom_quality_requirements", "Small Text"), field("custom_quality_review_required", "Check"), field("custom_renewal_notice_days", "Int"),
  field("custom_renewal_terms", "Small Text"), field("custom_rfp", "Link"), field("custom_rfp_response", "Link"), field("custom_rfq", "Link"),
  field("custom_risk_level", "Select", { reqd: 1 }), field("custom_sla__kpi_commitments", "Small Text"),
  field("custom_supplier", "Link", { reqd: 1 }), field("custom_supplier_quotation", "Link"), field("custom_termination_clauses", "Small Text"),
];

describe("New Contract step grouping", () => {
  it("provides the requested five stages and preserves every existing editable field exactly once", () => {
    const groups = groupContractFields(existingContractFields);
    expect(CONTRACT_CREATION_STEPS.map(step => step.title)).toEqual(["Source & Parties", "Contract Details", "Commercial Terms", "Performance & Compliance", "Documents & Review"]);
    expect(groups).toHaveLength(5);
    expect(groups.flat().map(item => item.fieldname).sort()).toEqual(existingContractFields.map(item => item.fieldname).sort());
    expect(new Set(groups.flat().map(item => item.fieldname)).size).toBe(existingContractFields.length);
    for (const item of groups.flat()) expect(existingContractFields).toContain(item);
  });

  it("places source links, commercial terms, performance fields, and documents in their relevant stages", () => {
    const groups = groupContractFields(existingContractFields).map(items => items.map(item => item.fieldname));
    expect(groups[0]).toEqual(expect.arrayContaining(["party_type", "party_name", "party_user", "contract_template", "custom_rfq", "custom_rfp_response", "custom_supplier_quotation", "custom_purchase_order"]));
    expect(groups[1]).toEqual(expect.arrayContaining(["start_date", "end_date", "contract_terms", "custom_program_name", "custom_contract_type", "custom_part_numbers"]));
    expect(groups[2]).toEqual(expect.arrayContaining(["custom_currency", "custom_contract_value", "custom_pricing_terms", "custom_payment_terms_description", "custom_incentives", "custom_penalties"]));
    expect(groups[3]).toEqual(expect.arrayContaining(["custom_sla__kpi_commitments", "custom_quality_requirements", "custom_delivery_terms", "custom_compliance_required"]));
    expect(groups[4]).toEqual(["custom_contract_document"]);
  });

  it("retains renewal settings together without changing the existing visibility policy", () => {
    const groups = groupContractFields(existingContractFields);
    expect(groups[1].map(item => item.fieldname)).toEqual(expect.arrayContaining(["custom_auto_renewal", "custom_renewal_notice_days", "custom_renewal_terms"]));
    expect(validateContractStep(groups[1], { custom_auto_renewal: 0 })).not.toHaveProperty("custom_renewal_notice_days");
  });

  it("retains newly introduced metadata and attachments instead of silently dropping them", () => {
    const extra = field("custom_new_detail");
    const image = field("custom_supporting_image", "Attach Image");
    const source = [image, extra, ...existingContractFields];
    const before = [...source];
    const groups = groupContractFields(source);
    expect(groups[1]).toContain(extra);
    expect(groups[4]).toContain(image);
    expect(groups.flat()).toHaveLength(source.length);
    expect(source).toEqual(before);
  });

  it("does not show duplicate controls if server metadata repeats a fieldname", () => {
    const groups = groupContractFields([...existingContractFields, field("party_name", "Dynamic Link")]);
    expect(groups.flat().filter(item => item.fieldname === "party_name")).toHaveLength(1);
  });
});

describe("New Contract stage validation", () => {
  it("validates only current-stage fields, leaving future terms, dates, currency, and risk untouched", () => {
    const groups = groupContractFields(existingContractFields);
    const source = { party_type: "Supplier", party_name: "SUP-1", custom_supplier: "SUP-1" };
    expect(validateContractStep(groups[0], source)).toEqual({});
    expect(validateContractStep(groups[0], { party_type: "Supplier" })).toEqual({ party_name: "party name is required.", custom_supplier: "supplier is required." });
    expect(validateContractStep(groups[2], { custom_currency: "INR", start_date: "invalid", custom_contract_title: "" })).toEqual({});
  });

  it("uses schema-required flags and existing draft API requirements even when metadata flags are optional", () => {
    const fields = [field("custom_contract_title", "Data", { label: "Contract Title" }), field("custom_contract_type", "Select", { label: "Contract Type" }), field("custom_currency", "Link", { label: "Currency" }), field("contract_terms", "Text Editor", { label: "Contract Terms" }), field("party_name", "Dynamic Link", { label: "Party Name", reqd: 1 })];
    expect(validateContractStep(fields, {})).toEqual({ custom_contract_title: "Contract Title is required.", custom_contract_type: "Contract Type is required.", custom_currency: "Currency is required.", contract_terms: "Contract Terms is required.", party_name: "Party Name is required." });
    expect(validateContractStep(fields, { custom_contract_title: "  ", custom_currency: null })).toHaveProperty("custom_contract_title");
    expect(contractFieldRequired(fields[0])).toBe(true);
  });

  it("requires the existing review-only fields on final submission without changing draft requirements", () => {
    const fields = [field("start_date", "Date"), field("end_date", "Date"), field("custom_inteva_signatory", "Link"), field("custom_risk_level", "Select")];
    expect(validateContractStep(fields, {})).toEqual({});
    expect(Object.keys(validateContractStep(fields, {}, { forReview: true })).sort()).toEqual(fields.map(item => item.fieldname).sort());
    expect(contractFieldRequired(fields[2])).toBe(false);
    expect(contractFieldRequired(fields[2], { forReview: true })).toBe(true);
    expect(validateContractStep(fields, { start_date: "2026-09-17", end_date: "2027-09-17", custom_inteva_signatory: "buyer@example.test", custom_risk_level: "Low" }, { forReview: true })).toEqual({});
    expect(validateContractStep([fields[3]], { custom_risk_level: "None" }, { forReview: true })).toHaveProperty("custom_risk_level");
  });

  it("rejects impossible dates and reversed periods while accepting equal dates and valid leap days", () => {
    const fields = [field("start_date", "Date"), field("end_date", "Date")];
    expect(validateContractStep(fields, { start_date: "2026-02-30", end_date: "2026-13-10" })).toHaveProperty("start_date");
    expect(validateContractStep(fields, { start_date: "2026-02-30", end_date: "2026-13-10" })).toHaveProperty("end_date");
    expect(validateContractStep(fields, { start_date: "2026-09-18", end_date: "2026-09-17" })).toEqual({ end_date: "End Date must be on or after Start Date." });
    expect(validateContractStep(fields, { start_date: "2028-02-29", end_date: "2028-02-29" })).toEqual({});
    expect(validateContractStep([fields[0]], { start_date: "2026-09-18", end_date: "2026-09-17" })).toEqual({});
  });

  it("accepts finite numeric values including zero without adding new positive-value business rules", () => {
    const fields = [field("custom_contract_value", "Currency"), field("custom_renewal_notice_days", "Int")];
    expect(validateContractStep(fields, { custom_contract_value: 0, custom_renewal_notice_days: 0 })).toEqual({});
    expect(validateContractStep(fields, { custom_contract_value: -1.25, custom_renewal_notice_days: -1 })).toEqual({});
    expect(validateContractStep(fields, { custom_contract_value: "12.50", custom_renewal_notice_days: "30" })).toEqual({});
    expect(validateContractStep(fields, { custom_contract_value: Infinity, custom_renewal_notice_days: 1.5 })).toHaveProperty("custom_contract_value");
    expect(validateContractStep(fields, { custom_contract_value: "NaN", custom_renewal_notice_days: 1.5 })).toHaveProperty("custom_renewal_notice_days");
    expect(validateContractStep(fields, { custom_contract_value: false })).toHaveProperty("custom_contract_value");
  });

  it("treats explicit false or zero Check values as answers, preserving the ERP required-field semantics", () => {
    const fields = [field("custom_auto_renewal", "Check", { reqd: 1 })];
    expect(validateContractStep(fields, { custom_auto_renewal: false })).toEqual({});
    expect(validateContractStep(fields, { custom_auto_renewal: 0 })).toEqual({});
    expect(validateContractStep(fields, { custom_auto_renewal: 1 })).toEqual({});
    expect(validateContractStep(fields, {})).toHaveProperty("custom_auto_renewal");
  });

  it("checks optional email and datetime input only when entered", () => {
    const fields = [field("contact_email", "Data", { options: "Email" }), field("meeting", "Datetime")];
    expect(validateContractStep(fields, {})).toEqual({});
    expect(validateContractStep(fields, { contact_email: "person@example.test", meeting: "2026-09-17T13:45" })).toEqual({});
    expect(validateContractStep(fields, { meeting: "2026-09-17 13:45:00.123456" })).toEqual({});
    expect(validateContractStep(fields, { contact_email: "invalid", meeting: "2026-09-17T25:00" })).toHaveProperty("contact_email");
    expect(validateContractStep(fields, { meeting: "2026-02-30T13:45" })).toHaveProperty("meeting");
  });
});
