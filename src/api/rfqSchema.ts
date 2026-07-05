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
