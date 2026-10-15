import metadata from "./metadata.json";

export interface ClmField { fieldname: string; label?: string; fieldtype: string; options?: string; reqd?: number | boolean; read_only?: number | boolean; hidden?: number | boolean; default?: string | number; description?: string; }
export interface ClmDetail { doctype: string; record: Record<string, unknown> & { name: string; modified: string }; actions: Array<{action: string;label: string}>; warnings?: string[]; }

let logs: Record<string, unknown>[] = [];
const listeners = new Set<() => void>();
let sequence = 0;
let failNextSubmit = false;
const records = new Map<string, ClmDetail>();
export const getFixtureLog = () => logs;
export const subscribeFixtureLog = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function logFixtureAction(entry: Record<string, unknown>) { logs = [...logs, { call: logs.length + 1, ...entry }]; for (const listener of listeners) listener(); }
export function setFailNextSubmit(value: boolean) { failNextSubmit = value; }
export const clmViewerKey = () => "contract-wizard-isolated-ui-qa";
export const clmError = (error: unknown) => error instanceof Error ? error.message : String(error);
export const clmRecordRoute = (_doctype: string, name: string) => `/contracts/${encodeURIComponent(name)}`;
export async function getClmMetadata() { return metadata; }
export async function lookupClm(doctype: string, query: string) {
  const names: Record<string, string[]> = { Supplier: ["SUP-UI-QA"], User: ["signatory-ui-qa@example.test", "party-ui-qa@example.test"], Currency: ["INR", "USD"], "Contract Template": ["TEMPLATE-UI-QA"], "Contract Request": ["REQUEST-UI-QA"], "Request for Quotation": ["RFQ-UI-QA"], "Supplier Quotation": ["QUOTATION-UI-QA"], "Purchase Order": ["PO-UI-QA"], RFP: ["RFP-UI-QA"], "RFP Response": ["RESPONSE-UI-QA"], Project: ["PROJECT-UI-QA"] };
  return (names[doctype] || []).filter(name => name.toLowerCase().includes(query.toLowerCase())).map(name => ({ name, title: name }));
}
const completeSource = {
  party_type: "Supplier", party_name: "SUP-UI-QA", party_user: "party-ui-qa@example.test", custom_supplier: "SUP-UI-QA", custom_inteva_signatory: "signatory-ui-qa@example.test", contract_template: "TEMPLATE-UI-QA",
  custom_contract_request: "REQUEST-UI-QA", custom_rfq: "RFQ-UI-QA", custom_supplier_quotation: "QUOTATION-UI-QA", custom_purchase_order: "PO-UI-QA", custom_rfp: "RFP-UI-QA", custom_rfp_response: "RESPONSE-UI-QA", document_type: "Purchase Order", document_name: "PO-UI-QA",
  custom_contract_title: "UI QA supply agreement — test fixture", custom_contract_type: "Supplier Agreement", start_date: "2026-09-17", end_date: "2027-09-17", custom_program_name: "UI QA Program", custom_project: "PROJECT-UI-QA", custom_business_unit: "UI QA Manufacturing", custom_part_numbers: "QA-PART-001\nQA-PART-002", contract_terms: "Fixture supply agreement for UI verification only. Supplier will provide the specified materials against approved orders. This content is never sent to ERPNext.", custom_auto_renewal: 1, custom_renewal_notice_days: 60, custom_renewal_terms: "Annual renewal subject to written agreement.",
  custom_contract_value: 125000, custom_currency: "INR", custom_pricing_terms: "Fixed unit pricing for the initial contract period.", custom_payment_terms: "Net 30", custom_payment_terms_description: "Payment within 30 days of accepted invoice.", custom_incentives: "Annual performance credit subject to review.", custom_penalties: "Service credits for missed contractual delivery commitments.",
  custom_risk_level: "Low", custom_sla__kpi_commitments: "On-time delivery target 98%; track monthly.", custom_quality_requirements: "Inspection report with each delivery.", custom_delivery_terms: "Deliver to the receiving site on the agreed schedule.", custom_termination_clauses: "Written notice in accordance with the agreed contract terms.", custom_legal_review_required: 1, custom_engineering_review_required: 0, custom_quality_review_required: 1, custom_compliance_required: 1, requires_fulfilment: 1, fulfilment_deadline: "2027-08-31",
};
export async function prefillClm(doctype: string, source_doctype: string, source_name: string) {
  logFixtureAction({ action: "prefill", doctype, source_doctype, source_name, noErpWrites: true });
  if (source_name === "FAIL") throw new Error("Fixture source load failed; retry with REQUEST-UI-QA.");
  if (source_doctype === "Contract Template") return { contract_template: source_name, contract_terms: "Template wording for the UI QA fixture. Verify these terms persist between all five stages.", requires_fulfilment: 1, fulfilment_terms: [{ requirement: "Fixture delivery checklist", fulfilled: 0 }] };
  return { ...completeSource };
}
export async function applyClmAction(input: { doctype: string; action: string; payload?: Record<string, unknown>; name?: string; expected_modified?: string }): Promise<ClmDetail> {
  logFixtureAction({ ...input, noErpWrites: true });
  await new Promise(resolve => setTimeout(resolve, 150));
  const existing = input.name ? records.get(input.name) : undefined;
  if (input.name && (!existing || input.expected_modified !== existing.record.modified)) throw new Error("Fixture revision mismatch. No ERP writes occurred.");
  if (input.action === "save") {
    for (const key of ["contract_terms", "custom_contract_title", "custom_contract_type", "custom_currency", "party_name", "custom_supplier", "custom_risk_level"]) if (!String(input.payload?.[key] ?? existing?.record[key] ?? "").trim()) throw new Error(`Fixture mirrors the existing save requirement: ${key} is required.`);
    sequence += 1;
    const name = input.name || `CON-UI-QA-${String(records.size + 1).padStart(3, "0")}`;
    const saved: ClmDetail = { doctype: "Contract", record: { ...existing?.record, ...input.payload, name, modified: `2026-09-17 12:00:${String(sequence).padStart(2, "0")}`, custom_contract_status: "Draft" }, actions: [{ action: "save", label: "Save draft" }, { action: "submit_review", label: "Submit for Review" }] };
    records.set(name, saved); return structuredClone(saved);
  }
  if (input.action === "submit_review") {
    if (failNextSubmit) { failNextSubmit = false; throw new Error("Fixture approval routing failure. Retry should reuse the same draft."); }
    if (!existing) throw new Error("Save the fixture draft before submitting.");
    sequence += 1;
    const saved: ClmDetail = { ...existing, record: { ...existing.record, custom_contract_status: "Under Review", modified: `2026-09-17 12:00:${String(sequence).padStart(2, "0")}` }, actions: [] };
    records.set(saved.record.name, saved); return structuredClone(saved);
  }
  throw new Error("Unsupported UI fixture action.");
}
