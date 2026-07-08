/**
 * BidSphere Material Request workflow — extends standard ERPNext Material Request
 * with custom fields provisioned by scripts/setup-material-request-workflow.mjs
 */

export const MR_WORKFLOW_FIELD = "custom_bidsphere_status";

/** ERPNext custom field storing the procurement classification of an MR. */
export const MR_PROCUREMENT_TYPE_FIELD = "custom_procurement_type";

/**
 * Every Material Request belongs to exactly one procurement class:
 *   • Direct   — manufacturing / raw materials. Routed through Warehouse first.
 *   • Indirect — office / support items. Routed through Admin approval first.
 */
export type MaterialRequestProcurementType = "Direct" | "Indirect";

export const MATERIAL_REQUEST_PROCUREMENT_TYPES: MaterialRequestProcurementType[] = [
  "Direct",
  "Indirect",
];

/**
 * Canonical Material Request workflow statuses — the ONLY values written to
 * ERPNext (`custom_bidsphere_status`) and rendered in the UI. This is the real
 * ERPNext procurement flow, branched by procurement type:
 *
 *   Draft (pre-submission only)
 *     ├▶ DIRECT ──▶ Under Warehouse Review
 *     │              ├─ stock ok ─▶ Stock Available ─▶ Material Issued ─▶ Completed
 *     │              └─ no stock ─▶ Procurement Required
 *     │                              └─ warehouse clicks "Send to Procurement"
 *     │                                 ─▶ Forwarded to Procurement ─▶ RFQ Created ─▶ Completed
 *     └▶ INDIRECT ─▶ Admin Review
 *                    ├─ approved  ─▶ Forwarded to Procurement ─▶ RFQ Created ─▶ Completed
 *                    └─ rejected  ─▶ Cancelled
 *   Cancelled (terminal)
 *
 * NOTE: "Procurement Required" and "Forwarded to Procurement" are DISTINCT,
 * genuinely-persisted statuses (both are real ERPNext Select options — see
 * scripts/setup-material-request-workflow.mjs). "Procurement Required" means
 * the warehouse review found a shortage but nobody has clicked "Send to
 * Procurement" yet — it is still a WAREHOUSE-owned item and must never be
 * visible to Procurement. "Forwarded to Procurement" means the explicit send
 * action has run (`forwardMaterialRequestToProcurement`) — the MR now belongs
 * to Procurement's active queue. Collapsing these two into one value was the
 * root cause of the "already forwarded" false-positive bug; keep them separate.
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
 * Statuses that make a Material Request eligible for the Procurement Queue —
 * everything from the moment Warehouse records a shortage up to (but not
 * including) completion.
 *
 * REGRESSION NOTE: this previously excluded "Procurement Required", requiring
 * a separate, explicit "Send to Procurement" click (on top of the Warehouse
 * review decision that already records the shortage) before a request became
 * visible to Procurement. That extra manual gate did not exist in the
 * original working workflow — Warehouse's shortage decision was ALWAYS the
 * single action that forwarded a request — and its introduction is what
 * caused genuinely-forwarded requests to silently disappear from Procurement's
 * queue. "Procurement Required" is included again so a request is visible the
 * moment Warehouse identifies the shortage, matching the original behaviour.
 */
export const PROCUREMENT_QUEUE_STATUSES: MaterialRequestWorkflowStatus[] = [
  "Procurement Required",
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
