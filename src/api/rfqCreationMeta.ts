/**
 * RFQ creation metadata — template vs manual source, documents, and workflow gates.
 * Persisted per RFQ in localStorage for summary cards on detail views.
 */

import type {
  RFQTemplate,
  RFQTemplateRequiredDocuments,
  RFQTemplateRfqType,
  RFQTemplateWorkflowRules,
} from "../types/erpnext";
import {
  DEFAULT_REQUIRED_DOCUMENTS,
  DEFAULT_WORKFLOW_RULES,
} from "../types/erpnext";

export type RFQCreationSource = "template" | "manual";

export interface RFQCreationMeta {
  creation_source: RFQCreationSource;
  template_id?: string;
  template_name?: string;
  category?: string;
  rfq_type?: RFQTemplateRfqType | string;
  estimated_value?: number;
  required_documents?: RFQTemplateRequiredDocuments;
  workflow_rules?: RFQTemplateWorkflowRules;
  created_by?: string;
}

const META_PREFIX = "rfq_creation_meta_";
const LEGACY_TEMPLATE_PREFIX = "rfq_from_template_";

export function formatRequiredDocumentsList(
  docs?: RFQTemplateRequiredDocuments
): string {
  const merged = { ...DEFAULT_REQUIRED_DOCUMENTS, ...docs };
  const labels = [
    merged.terms_and_conditions && "Terms & Conditions",
    merged.warranty_certificate && "Warranty Certificate",
    merged.insurance_certificate && "Insurance Certificate",
    merged.nda && "NDA",
    merged.compliance_certificate && "Compliance Certificate",
  ].filter(Boolean);
  return labels.join(", ");
}

export function buildMetaFromTemplate(template: RFQTemplate): RFQCreationMeta {
  return {
    creation_source: "template",
    template_id: template.name,
    template_name: template.template_name,
    category: template.category,
    rfq_type: template.rfq_type,
    estimated_value: template.estimated_value,
    required_documents: {
      ...DEFAULT_REQUIRED_DOCUMENTS,
      ...template.required_documents,
    },
    workflow_rules: {
      ...DEFAULT_WORKFLOW_RULES,
      ...template.workflow_rules,
    },
  };
}

export function buildManualCreationMeta(input: {
  required_documents: RFQTemplateRequiredDocuments;
  workflow_rules: RFQTemplateWorkflowRules;
  created_by: string;
}): RFQCreationMeta {
  return {
    creation_source: "manual",
    required_documents: input.required_documents,
    workflow_rules: input.workflow_rules,
    created_by: input.created_by,
  };
}

export function stashRFQCreationMeta(rfqName: string, meta: RFQCreationMeta): void {
  try {
    localStorage.setItem(`${META_PREFIX}${rfqName}`, JSON.stringify(meta));
  } catch {
    /* ignore */
  }
}

/** @deprecated Use stashRFQCreationMeta with buildMetaFromTemplate */
export function stashRFQTemplateMeta(rfqName: string, template: RFQTemplate): void {
  stashRFQCreationMeta(rfqName, buildMetaFromTemplate(template));
}

export function readRFQCreationMeta(rfqName: string): RFQCreationMeta | null {
  try {
    const raw = localStorage.getItem(`${META_PREFIX}${rfqName}`);
    if (raw) return JSON.parse(raw) as RFQCreationMeta;

    const legacy = localStorage.getItem(`${LEGACY_TEMPLATE_PREFIX}${rfqName}`);
    if (!legacy) return null;

    const parsed = JSON.parse(legacy) as Partial<RFQCreationMeta> & {
      template_id?: string;
    };
    if (!parsed.template_id) return null;

    return {
      creation_source: "template",
      template_id: parsed.template_id,
      template_name: parsed.template_name,
      rfq_type: parsed.rfq_type,
      required_documents: parsed.required_documents,
      workflow_rules: parsed.workflow_rules,
    };
  } catch {
    return null;
  }
}
