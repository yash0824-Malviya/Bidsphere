export const PROTECTED_RFQ_TRACE_FIELDS = [
  "custom_ecr_reference",
  "custom_bidsphere_ecr_idempotency_key",
  "custom_purchase_requisition_reference",
  "custom_bidsphere_pr_idempotency_key",
] as const;

export const PROTECTED_RFQ_TRACE_MUTATION_MESSAGE =
  "ECR-linked RFQs must use /api/create-rfq-from-ecr; standalone PR-linked RFQs must use /api/create-rfq-from-pr.";

const protectedFields = new Set<string>(PROTECTED_RFQ_TRACE_FIELDS);
const fieldSelectorKeys = new Set(["field", "fieldname", "fields"]);

/**
 * Detects both document-style writes and generic `frappe.client.set_value`
 * shapes. Frappe accepts a field name as a string, array, or object/map, so a
 * shallow own-property check is not sufficient for traceability fields.
 */
export function hasProtectedRfqTraceMutation(...values: unknown[]): boolean {
  const seen = new Set<object>();

  const visit = (value: unknown, fieldSelector = false): boolean => {
    if (typeof value === "string") {
      return fieldSelector && protectedFields.has(value.trim());
    }
    if (Array.isArray(value)) {
      return value.some((entry) => visit(entry, fieldSelector));
    }
    if (!value || typeof value !== "object") return false;
    if (seen.has(value)) return false;
    seen.add(value);

    return Object.entries(value as Record<string, unknown>).some(([key, nested]) => {
      if (protectedFields.has(key)) return true;
      return visit(nested, fieldSelector || fieldSelectorKeys.has(key.toLowerCase()));
    });
  };

  return values.some((value) => visit(value));
}
