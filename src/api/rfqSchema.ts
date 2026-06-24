/**
 * RFQ Schema Introspection & Custom Field Provisioning.
 *
 * Fetches the actual field list from the ERPNext "Request for Quotation"
 * DocType at runtime. Never assumes field names — if the required custom
 * fields for the legal/finance workflow don't exist, they are created
 * automatically via the API.
 *
 * Required custom fields on RFQ:
 *   custom_legal_status      (Select)   — Pending / Approved / Rejected
 *   custom_finance_status    (Select)   — Pending / Approved / Rejected
 *   custom_legal_reviewer    (Data)
 *   custom_legal_comments    (Small Text)
 *   custom_legal_review_date (Datetime)
 *   custom_finance_reviewer  (Data)
 *   custom_finance_comments  (Small Text)
 *   custom_finance_review_date (Datetime)
 */

import { apiGet, apiPost } from "./erpnext";

const RFQ_DOCTYPE = "Request for Quotation";

/* ────────────────────────────────────────────────────────────────────────────
 *  Types
 * ──────────────────────────────────────────────────────────────────────────── */

export interface DocField {
  fieldname: string;
  fieldtype: string;
  label?: string;
  options?: string;
  reqd?: 0 | 1;
}

export interface RFQSchemaInfo {
  allFields: string[];
  customFields: string[];
  workflowFields: string[];
  hasLegalStatus: boolean;
  hasFinanceStatus: boolean;
  legalStatusFieldName: string | null;
  financeStatusFieldName: string | null;
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Singleton cache — fetched once per session
 * ──────────────────────────────────────────────────────────────────────────── */

let _schemaPromise: Promise<RFQSchemaInfo> | null = null;
let _cached: RFQSchemaInfo | null = null;

export function getCachedSchema(): RFQSchemaInfo | null {
  return _cached;
}

/**
 * Fetch the RFQ DocType schema from ERPNext (cached per session).
 * Logs the full field list to the console for debugging.
 */
export async function getRFQSchema(): Promise<RFQSchemaInfo> {
  if (_cached) return _cached;
  if (_schemaPromise) return _schemaPromise;

  _schemaPromise = _fetchSchema();
  _cached = await _schemaPromise;
  return _cached;
}

/**
 * Force-refresh the schema cache (e.g. after creating custom fields).
 */
export async function refreshRFQSchema(): Promise<RFQSchemaInfo> {
  _schemaPromise = null;
  _cached = null;
  return getRFQSchema();
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Internal: fetch from /api/doctype/Request for Quotation
 * ──────────────────────────────────────────────────────────────────────────── */

async function _fetchSchema(): Promise<RFQSchemaInfo> {
  // eslint-disable-next-line no-console
  console.log("[RFQSchema] Fetching schema for", RFQ_DOCTYPE);

  let fields: DocField[] = [];

  try {
    const resp = await apiGet<{ fields?: DocField[] }>(
      `/api/doctype/${encodeURIComponent(RFQ_DOCTYPE)}`
    );
    fields = resp?.fields ?? [];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[RFQSchema] /api/doctype failed, trying fallback:", err);

    try {
      const fallback = await apiGet<DocField[]>(
        `/api/resource/DocField`,
        {
          params: {
            filters: JSON.stringify([["parent", "=", RFQ_DOCTYPE]]),
            fields: JSON.stringify(["fieldname", "fieldtype", "label", "options", "reqd"]),
            limit_page_length: 200,
          },
        }
      );
      fields = fallback ?? [];
    } catch (err2) {
      // eslint-disable-next-line no-console
      console.error("[RFQSchema] Both schema endpoints failed:", err2);
    }
  }

  const allFields = fields.map((f) => f.fieldname);
  const customFields = fields
    .filter((f) => f.fieldname.startsWith("custom_"))
    .map((f) => f.fieldname);
  const workflowFields = allFields.filter(
    (f) => f.includes("workflow") || f.includes("status") || f.includes("legal") || f.includes("finance")
  );

  const legalCandidates = [
    "custom_legal_status",
    "legal_status",
    "custom_bidsphere_legal_status",
  ];
  const financeCandidates = [
    "custom_finance_status",
    "finance_status",
    "custom_bidsphere_finance_status",
  ];

  const fieldSet = new Set(allFields);
  const legalStatusFieldName = legalCandidates.find((f) => fieldSet.has(f)) ?? null;
  const financeStatusFieldName = financeCandidates.find((f) => fieldSet.has(f)) ?? null;

  const info: RFQSchemaInfo = {
    allFields,
    customFields,
    workflowFields,
    hasLegalStatus: legalStatusFieldName !== null,
    hasFinanceStatus: financeStatusFieldName !== null,
    legalStatusFieldName,
    financeStatusFieldName,
  };

  // eslint-disable-next-line no-console
  console.log("[RFQSchema] All fields:", allFields);
  // eslint-disable-next-line no-console
  console.log("[RFQSchema] Custom fields:", customFields);
  // eslint-disable-next-line no-console
  console.log("[RFQSchema] Workflow-related fields:", workflowFields);
  // eslint-disable-next-line no-console
  console.log("[RFQSchema] Legal status field:", legalStatusFieldName ?? "NOT FOUND");
  // eslint-disable-next-line no-console
  console.log("[RFQSchema] Finance status field:", financeStatusFieldName ?? "NOT FOUND");

  return info;
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Custom field provisioning — create missing fields on the RFQ DocType
 * ──────────────────────────────────────────────────────────────────────────── */

interface CustomFieldSpec {
  fieldname: string;
  label: string;
  fieldtype: string;
  options?: string;
  insert_after?: string;
}

const REQUIRED_FIELDS: CustomFieldSpec[] = [
  {
    fieldname: "custom_legal_status",
    label: "Legal Status",
    fieldtype: "Select",
    options: "\nPending\nApproved\nRejected",
    insert_after: "status",
  },
  {
    fieldname: "custom_legal_reviewer",
    label: "Legal Reviewer",
    fieldtype: "Data",
    insert_after: "custom_legal_status",
  },
  {
    fieldname: "custom_legal_comments",
    label: "Legal Comments",
    fieldtype: "Small Text",
    insert_after: "custom_legal_reviewer",
  },
  {
    fieldname: "custom_legal_review_date",
    label: "Legal Review Date",
    fieldtype: "Datetime",
    insert_after: "custom_legal_comments",
  },
  {
    fieldname: "custom_finance_status",
    label: "Finance Status",
    fieldtype: "Select",
    options: "\nPending\nApproved\nRejected",
    insert_after: "custom_legal_review_date",
  },
  {
    fieldname: "custom_finance_reviewer",
    label: "Finance Reviewer",
    fieldtype: "Data",
    insert_after: "custom_finance_status",
  },
  {
    fieldname: "custom_finance_comments",
    label: "Finance Comments",
    fieldtype: "Small Text",
    insert_after: "custom_finance_reviewer",
  },
  {
    fieldname: "custom_finance_review_date",
    label: "Finance Review Date",
    fieldtype: "Datetime",
    insert_after: "custom_finance_comments",
  },
  {
    fieldname: "custom_selected_supplier",
    label: "Selected Supplier",
    fieldtype: "Data",
    insert_after: "custom_finance_review_date",
  },
  {
    fieldname: "custom_selected_supplier_total",
    label: "Selected Supplier Total",
    fieldtype: "Currency",
    insert_after: "custom_selected_supplier",
  },
  {
    fieldname: "custom_workflow_step",
    label: "Workflow Step",
    fieldtype: "Data",
    insert_after: "custom_selected_supplier_total",
  },
  {
    fieldname: "custom_submitted_by",
    label: "Submitted By",
    fieldtype: "Data",
    insert_after: "custom_workflow_step",
  },
  {
    fieldname: "custom_submitted_at",
    label: "Submitted At",
    fieldtype: "Datetime",
    insert_after: "custom_submitted_by",
  },
  {
    fieldname: "custom_approval_data",
    label: "Approval Data (JSON)",
    fieldtype: "Long Text",
    insert_after: "custom_submitted_at",
  },
  {
    fieldname: "custom_terms_approved",
    label: "Terms Approved",
    fieldtype: "Check",
    insert_after: "custom_approval_data",
  },
  {
    fieldname: "custom_warranty_approved",
    label: "Warranty Approved",
    fieldtype: "Check",
    insert_after: "custom_terms_approved",
  },
  {
    fieldname: "custom_insurance_approved",
    label: "Insurance Approved",
    fieldtype: "Check",
    insert_after: "custom_warranty_approved",
  },
  {
    fieldname: "custom_legal_documents",
    label: "Legal Documents (JSON)",
    fieldtype: "Long Text",
    insert_after: "custom_insurance_approved",
  },
];

/**
 * Ensure all required custom fields exist on the RFQ DocType.
 * Creates any that are missing, silently skips fields that already exist.
 *
 * This should only be called from a one-time setup/migration script,
 * NOT on every page load.
 */
export async function ensureCustomFields(): Promise<RFQSchemaInfo> {
  const schema = await getRFQSchema();
  const existing = new Set(schema.allFields);
  const missing = REQUIRED_FIELDS.filter((f) => !existing.has(f.fieldname));

  if (missing.length === 0) {
    // eslint-disable-next-line no-console
    console.log("[RFQSchema] All required custom fields already exist.");
    return schema;
  }

  // eslint-disable-next-line no-console
  console.log(
    "[RFQSchema] Creating missing custom fields:",
    missing.map((f) => f.fieldname)
  );

  for (const spec of missing) {
    try {
      await apiPost(`/api/resource/Custom Field`, {
        doctype: "Custom Field",
        dt: RFQ_DOCTYPE,
        fieldname: spec.fieldname,
        label: spec.label,
        fieldtype: spec.fieldtype,
        options: spec.options,
        insert_after: spec.insert_after,
      });
      // eslint-disable-next-line no-console
      console.log(`[RFQSchema] Created: ${spec.fieldname}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already exists")) {
        // eslint-disable-next-line no-console
        console.log(`[RFQSchema] Skipped (already exists): ${spec.fieldname}`);
      } else {
        // eslint-disable-next-line no-console
        console.warn(`[RFQSchema] Failed to create ${spec.fieldname}:`, err);
      }
    }
  }

  return refreshRFQSchema();
}
