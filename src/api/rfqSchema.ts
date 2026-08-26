/**
 * RFQ Schema Introspection.
 *
 * Fetches the actual field list from the ERPNext "Request for Quotation"
 * DocType at runtime for read-only discovery of workflow custom fields.
 *
 * Custom fields must be created manually in ERPNext (Settings → Customize Form).
 * The frontend never creates Custom Field definitions.
 */

import { apiGet } from "./erpnext";

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

  // The /api/doctype/<DocType> endpoint is not available on this Frappe
  // installation (returns 404). Use /api/resource/DocField directly — this
  // is the authoritative source (42 fields confirmed working).
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
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[RFQSchema] Schema fetch failed:", err);
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
 *  Safe list-field mapping (All RFQs filters)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Logical UI filter keys → candidate ERPNext fieldnames (first match wins).
 * Never hardcode a single `custom_*` name into list queries.
 */
export const RFQ_LIST_FIELD_CANDIDATES = {
  company: ["company"],
  transaction_date: ["transaction_date"],
  department: ["custom_department", "department"],
  /** Standard RFQ has no priority — only bind if a real field exists. */
  priority: ["priority", "custom_priority"],
  workflow_step: ["custom_workflow_step", "workflow_state"],
} as const;

export type RfqListLogicalField = keyof typeof RFQ_LIST_FIELD_CANDIDATES;

export type RfqListFieldMap = {
  [K in RfqListLogicalField]: string | null;
};

const SAFE_LIST_FIELDS = ["name", "status", "modified", "owner"] as const;

let _listFieldMapPromise: Promise<RfqListFieldMap> | null = null;
let _listFieldMap: RfqListFieldMap | null = null;

function pickFirstField(
  fieldSet: Set<string>,
  candidates: readonly string[],
): string | null {
  for (const name of candidates) {
    if (fieldSet.has(name)) return name;
  }
  return null;
}

/**
 * Resolve which optional RFQ list/filter fields exist on this ERPNext site.
 * Missing candidates become `null` — callers must omit them from `fields`
 * and `filters` (avoids HTTP 417 Field not permitted).
 */
export async function getRfqListFieldMap(): Promise<RfqListFieldMap> {
  if (_listFieldMap) return _listFieldMap;
  if (_listFieldMapPromise) return _listFieldMapPromise;

  _listFieldMapPromise = (async () => {
    let fieldSet = new Set<string>();
    try {
      const schema = await getRFQSchema();
      fieldSet = new Set(schema.allFields);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[RFQSchema] List field map: schema unavailable", err);
    }

    const map: RfqListFieldMap = {
      company: pickFirstField(fieldSet, RFQ_LIST_FIELD_CANDIDATES.company),
      transaction_date: pickFirstField(
        fieldSet,
        RFQ_LIST_FIELD_CANDIDATES.transaction_date,
      ),
      department: pickFirstField(fieldSet, RFQ_LIST_FIELD_CANDIDATES.department),
      priority: pickFirstField(fieldSet, RFQ_LIST_FIELD_CANDIDATES.priority),
      workflow_step: pickFirstField(
        fieldSet,
        RFQ_LIST_FIELD_CANDIDATES.workflow_step,
      ),
    };

    // eslint-disable-next-line no-console
    console.log("[RFQSchema] List field map:", map);
    _listFieldMap = map;
    return map;
  })();

  return _listFieldMapPromise;
}

/**
 * Safe `fields=` for RFQ list queries.
 * All RFQs page only requests always-permitted standard fields.
 */
export async function getRfqListQueryFields(): Promise<string[]> {
  return [...SAFE_LIST_FIELDS];
}
