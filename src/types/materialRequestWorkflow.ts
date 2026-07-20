/**
 * BidSphere Material Request workflow — extends standard ERPNext Material Request
 * with custom fields provisioned by scripts/setup-material-request-workflow.mjs
 */

export const MR_WORKFLOW_FIELD = "custom_bidsphere_status";

/** ERPNext custom field storing the procurement classification of an MR. */
export const MR_PROCUREMENT_TYPE_FIELD = "custom_procurement_type";

/**
 * Request Mode — whether the requested item(s) already exist in Item Master.
 * Stored as `custom_request_mode`. Legacy MRs without this field map to Existing.
 */
export const MR_REQUEST_MODE_FIELD = "custom_request_mode";

/**
 * Every Material Request belongs to exactly one procurement class:
 *   • Direct   — manufacturing / raw materials. Routed through Warehouse first.
 *   • Indirect — office / support items. Routed through Admin approval first.
 *
 * UI label: "Request Type" (field remains custom_procurement_type for compat).
 */
export type MaterialRequestProcurementType = "Direct" | "Indirect";

export const MATERIAL_REQUEST_PROCUREMENT_TYPES: MaterialRequestProcurementType[] = [
  "Direct",
  "Indirect",
];

/**
 * Request Mode:
 *   • Existing — item already in Item Master / catalog (legacy default).
 *   • New      — item does not yet exist; manual entry; stub Item may be created.
 */
export type MaterialRequestMode = "Existing" | "New";

export const MATERIAL_REQUEST_MODES: MaterialRequestMode[] = ["Existing", "New"];

/**
 * Whether the create form should use Item Master dropdowns.
 * Only Direct + Existing keeps the classic ERP item pickers.
 * Indirect (any mode) and Direct + New use manual entry.
 */
export function usesItemMasterDropdowns(
  requestType: MaterialRequestProcurementType,
  requestMode: MaterialRequestMode,
): boolean {
  return requestType === "Direct" && requestMode === "Existing";
}
/**
 * Canonical Material Request workflow statuses — the ONLY values written to
 * ERPNext (`custom_bidsphere_status`) and rendered in the UI. This is the real
 * ERPNext procurement flow, branched by procurement type:
 *
 *   Draft (pre-submission only)
 *     ├▶ DIRECT ──▶ Under Warehouse Review
 *     │              ├─ stock ok ─▶ Stock Available ─▶ Material Issued ─▶ Completed
 *     │              └─ no stock ─▶ Procurement Required
 *     │                              └─ Confirm & Process All Decisions
 *     │                                 ─▶ Forwarded to Procurement ─▶ RFQ Created ─▶ Completed
 *     └▶ INDIRECT ─▶ Admin Review
 *                    ├─ approved  ─▶ Forwarded to Procurement ─▶ RFQ Created ─▶ Completed
 *                    └─ rejected  ─▶ Cancelled
 *   Cancelled (terminal)
 *
 * NOTE: "Procurement Required" is a legacy warehouse-owned shortage status.
 * New Confirm & Process runs write "Forwarded to Procurement" directly via
 * `forwardMaterialRequestToProcurement`. Keep the statuses distinct so legacy
 * rows stay warehouse-owned until Confirm is clicked.
 */
export type MaterialRequestWorkflowStatus =
  | "Draft"
  | "Submitted"
  | "Admin Review"
  | "Under Warehouse Review"
  | "Stock Available"
  | "Material Issued"
  | "Procurement Required"
  | "Forwarded to Procurement"
  | "RFQ Created"
  | "Completed"
  | "Cancelled";

/**
 * Statuses shown on dashboards / status filters. Excludes "Draft" because a
 * draft is not an active request — it only exists before submission.
 */
export const MR_DASHBOARD_STATUSES: MaterialRequestWorkflowStatus[] = [
  "Submitted",
  "Admin Review",
  "Under Warehouse Review",
  "Stock Available",
  "Material Issued",
  "Procurement Required",
  "Forwarded to Procurement",
  "RFQ Created",
  "Completed",
  "Cancelled",
];

/**
 * Statuses that put an Indirect Material Request in the Admin approval queue.
 */
export const ADMIN_REVIEW_STATUSES: MaterialRequestWorkflowStatus[] = [
  "Admin Review",
];

/**
 * Legacy → canonical status mapping. Older records (and any not-yet-migrated
 * writers) may still carry the previous names in ERPNext; we normalize them on
 * every read so existing Material Requests keep working across refresh/devices
 * without a data migration. "Forwarded to Procurement" is now a canonical
 * value in its own right (see `MaterialRequestWorkflowStatus`) — it is
 * intentionally NOT aliased to "Procurement Required" anymore.
 */
const LEGACY_STATUS_ALIASES: Record<string, MaterialRequestWorkflowStatus> = {
  "Procurement Review": "Forwarded to Procurement",
  "Procurement Pending": "Forwarded to Procurement",
  "RFQ Pending": "Forwarded to Procurement",
  "RFQ Requested": "Forwarded to Procurement",
  Rejected: "Cancelled",
  Stopped: "Cancelled",
};

/**
 * Statuses related to the Procurement hand-off.
 *
 * IMPORTANT — two distinct queues:
 *   • Warehouse → Procurement Required  = shortages awaiting Stock Decision
 *     (includes live Under Warehouse Review shortages + legacy
 *     "Procurement Required")
 *   • Procurement → Forwarded Material Requests = "Forwarded to Procurement"
 *     (after Confirm & Process All Decisions; RFQ can be created)
 *
 * Do not collapse these — that breaks Warehouse / Procurement screens.
 */
export const PROCUREMENT_QUEUE_STATUSES: MaterialRequestWorkflowStatus[] = [
  "Forwarded to Procurement",
  "RFQ Created",
];

/** Map any raw stored status string to the canonical workflow status. */
export function normalizeWorkflowStatus(
  raw: string | null | undefined,
): MaterialRequestWorkflowStatus | undefined {
  const value = (raw ?? "").trim();
  if (!value) return undefined;
  if (value in LEGACY_STATUS_ALIASES) return LEGACY_STATUS_ALIASES[value];
  return value as MaterialRequestWorkflowStatus;
}

/* ──────────────────────────────────────────────────────────────────────────
 * UI label ⇄ ERPNext stored value
 *
 * The app renders friendly labels (e.g. "Procurement Required", "Cancelled")
 * everywhere — page titles, sidebars, cards, badges. ERPNext's
 * `custom_bidsphere_status` Select field, however, only accepts a FIXED set of
 * option strings. Writing a label the field doesn't know throws a Frappe
 * ValidationError ("BidSphere Status cannot be …").
 *
 * This is the single source of truth for that translation:
 *   • WRITE — always send `toErpBidsphereStatus(uiLabel)` to ERPNext.
 *   • READ  — `normalizeWorkflowStatus` maps the stored value back to the label
 *             (via LEGACY_STATUS_ALIASES), so the UI is unchanged.
 *
 *   UI label                 ERPNext stored value
 *   ───────────────────────  ────────────────────────
 *   Draft                    Draft
 *   Submitted                Submitted
 *   Under Warehouse Review   Under Warehouse Review
 *   Stock Available          Under Warehouse Review   (no ERP option — kept valid)
 *   Material Issued          Material Issued
 *   Procurement Required     Procurement Required     (shortage found, NOT yet sent)
 *   Forwarded to Procurement Forwarded to Procurement (warehouse clicked "Send")
 *   RFQ Created              RFQ Created
 *   Completed                Completed
 *   Cancelled                Rejected
 * ────────────────────────────────────────────────────────────────────────── */
const UI_TO_ERP_STATUS: Record<MaterialRequestWorkflowStatus, string> = {
  Draft: "Draft",
  Submitted: "Submitted",
  "Admin Review": "Admin Review",
  "Under Warehouse Review": "Under Warehouse Review",
  // ERPNext's field has no "Stock Available" option; store the closest valid
  // state so the write never fails. Read-back shows "Under Warehouse Review".
  "Stock Available": "Under Warehouse Review",
  "Material Issued": "Material Issued",
  "Procurement Required": "Procurement Required",
  "Forwarded to Procurement": "Forwarded to Procurement",
  "RFQ Created": "RFQ Created",
  Completed: "Completed",
  Cancelled: "Rejected",
};

/**
 * Translate a UI workflow label to the exact string ERPNext's
 * `custom_bidsphere_status` field accepts. Unknown values pass through
 * unchanged (defensive — the field validation still guards the backend).
 */
export function toErpBidsphereStatus(
  status: MaterialRequestWorkflowStatus | string,
): string {
  return (
    UI_TO_ERP_STATUS[status as MaterialRequestWorkflowStatus] ?? String(status)
  );
}

export type MaterialRequestPriority = "Low" | "Medium" | "High" | "Urgent";

export interface MaterialRequestWorkflowFields {
  [MR_WORKFLOW_FIELD]?: MaterialRequestWorkflowStatus;
  [MR_PROCUREMENT_TYPE_FIELD]?: MaterialRequestProcurementType;
  [MR_REQUEST_MODE_FIELD]?: MaterialRequestMode;
  custom_department?: string;
  custom_priority?: MaterialRequestPriority;
  custom_purpose?: string;
  custom_warehouse_remarks?: string;
  custom_procurement_remarks?: string;
  custom_linked_rfq?: string;
  custom_requested_by?: string;
  custom_admin_remarks?: string;
  /**
   * Forward-to-procurement audit fields. Optional/best-effort — persisted only
   * when provisioned in ERPNext. The canonical marker for "forwarded" remains
   * the workflow status ("Procurement Required"); these add who/when metadata.
   */
  custom_forwarded_to_procurement?: 0 | 1;
  custom_forwarded_by?: string;
  custom_forwarded_on?: string;
  /** Best-effort — when Procurement creates the RFQ (optional field). */
  custom_rfq_created_at?: string;
}

/**
 * Resolve the procurement type of a Material Request. Existing records created
 * before this feature won't carry `custom_procurement_type`; we treat those as
 * "Direct" so the legacy warehouse-first flow keeps working (backward compat).
 */
export function resolveProcurementType(
  raw: string | null | undefined,
): MaterialRequestProcurementType {
  return (raw ?? "").trim().toLowerCase() === "indirect" ? "Indirect" : "Direct";
}

/**
 * Resolve Request Mode. Legacy records without `custom_request_mode` map to
 * Existing (Direct → Direct+Existing, Indirect → Indirect+Existing).
 */
export function resolveRequestMode(
  raw: string | null | undefined,
): MaterialRequestMode {
  return (raw ?? "").trim().toLowerCase() === "new" ? "New" : "Existing";
}

export interface MaterialRequestStockLine {
  item_code: string;
  warehouse: string;
  required_qty: number;
  available_qty: number;
  sufficient: boolean;
  uom?: string;
}

export interface MaterialRequestStockCheck {
  mr_name: string;
  all_sufficient: boolean;
  lines: MaterialRequestStockLine[];
}
