/**
 * Material Request fulfillment model — the single, shared derivation of
 * per-item and per-request fulfillment used by BOTH the Department User portal
 * and the Warehouse Manager portal.
 *
 * It is a PURE function of data already stored in ERPNext:
 *   • MR line items (`qty` = requested)
 *   • the warehouse decision snapshot persisted in `custom_warehouse_remarks`
 *     as `[BidSphere:ForwardedItems:JSON]` (read via `parseForwardedItemsFromMr`)
 *   • the canonical workflow status (`custom_bidsphere_status`)
 *
 * No new ERPNext calls, no localStorage, no mock data — this only reshapes what
 * the backend already returns so every screen shows a consistent picture of
 * "requested vs issued vs remaining vs procurement".
 */

import {
  getMaterialRequestWorkflowStatus,
  parseForwardedItemsFromMr,
  type MaterialRequestWorkflowRecord,
} from "../api/materialRequestWorkflow";
import type { MaterialRequestWorkflowStatus } from "../types/materialRequestWorkflow";
import { pickEngineeringDocs } from "./materialRequestItemFiles";
import {
  issuedQtyByItemFromMaterialIssueTag,
  issuedQtyByItemFromMirRemarks,
  issuedQtyByItemFromReceipts,
} from "./warehouseIssueFulfillmentSync";

/**
 * The persisted `[BidSphere:ForwardedItems]` snapshot has drifted slightly over
 * time: newer writers store `issued_qty`, older ones `issue_qty`. Read both
 * defensively so the fulfillment view is correct regardless of which writer
 * produced the record.
 */
type RawDecision = {
  item_code: string;
  issued_qty?: number;
  issue_qty?: number;
  forward_qty?: number;
  shortage_qty?: number;
  available_qty?: number;
  warehouse?: string;
};

/** Per-item fulfillment status. Drives the quantity chips and colored badges. */
export type ItemFulfillmentStatus =
  | "Draft"
  | "Pending Review"
  | "Issued"
  | "Partial"
  | "Procurement";

export interface ItemFulfillment {
  item_code: string;
  item_name: string;
  uom: string;
  warehouse: string;
  /** Quantity the department asked for. */
  requested: number;
  /** Stock available at review time (if the warehouse recorded it). */
  available: number | null;
  /** Quantity issued from stock so far. */
  issued: number;
  /** Quantity still owed to the department (requested − issued). */
  remaining: number;
  /** Quantity routed to procurement (RFQ/PO) to cover the shortage. */
  procurement: number;
  status: ItemFulfillmentStatus;
  /** Optional engineering docs from the MR item row (read-only display). */
  part_name?: string;
  drawing_2d_url?: string;
  attachments?: import("./materialRequestItemFiles").EngineeringAttachment[];
}

/** Roll-up fulfillment classification for a whole Material Request. */
export type RequestFulfillmentStatus =
  | "Draft"
  | "Pending Review"
  | "Partially Fulfilled"
  | "Fully Issued"
  | "Sent to Procurement"
  | "Cancelled"
  | "Completed";

export interface RequestFulfillment {
  workflowStatus: MaterialRequestWorkflowStatus;
  rollup: RequestFulfillmentStatus;
  items: ItemFulfillment[];
  totals: {
    requested: number;
    issued: number;
    remaining: number;
    procurement: number;
    /** 0–100, issued ÷ requested across all lines. */
    issuedPercent: number;
  };
}

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

function classifyItem(
  requested: number,
  issued: number,
  procurement: number,
  workflow: MaterialRequestWorkflowStatus,
): ItemFulfillmentStatus {
  if (workflow === "Draft") return "Draft";
  if (issued >= requested && requested > 0) return "Issued";
  if (issued > 0) return "Partial";
  if (procurement > 0) return "Procurement";
  if (
    workflow === "Procurement Required" ||
    workflow === "Forwarded to Procurement" ||
    workflow === "RFQ Created"
  ) {
    return "Procurement";
  }
  return "Pending Review";
}

/**
 * Compute the per-item + per-request fulfillment picture for one MR.
 * Safe to call with a partially-loaded record (missing items/remarks).
 */
export function computeRequestFulfillment(
  mr: MaterialRequestWorkflowRecord,
): RequestFulfillment {
  const workflowStatus = getMaterialRequestWorkflowStatus(mr);
  const decisions = parseForwardedItemsFromMr(mr) as unknown as RawDecision[];
  const decisionByCode = new Map(decisions.map((d) => [d.item_code, d]));
  const remarks = mr.custom_warehouse_remarks ?? mr.remarks ?? "";
  const issuedFromTag = issuedQtyByItemFromMaterialIssueTag(remarks);
  const issuedFromMir = issuedQtyByItemFromMirRemarks(remarks);
  const issuedFromReceipts = issuedQtyByItemFromReceipts(mr.name);

  const isTerminalIssued =
    workflowStatus === "Material Issued" ||
    workflowStatus === "Pending Department Acceptance" ||
    workflowStatus === "Completed";

  const items: ItemFulfillment[] = (mr.items ?? []).map((row) => {
    const requested = num(row.qty);
    const decision = decisionByCode.get(row.item_code);
    const liveIssued = Math.max(
      issuedFromTag.get(row.item_code) || 0,
      issuedFromMir.get(row.item_code) || 0,
      issuedFromReceipts.get(row.item_code) || 0,
    );

    // Prefer the recorded warehouse decision (SSoT), then overlay live
    // Material Issue / Receipt quantities so Issued ≠ Procurement after issue.
    let issued: number;
    let procurement: number;
    let available: number | null;

    if (decision) {
      issued = Math.max(
        num(decision.issued_qty ?? decision.issue_qty),
        liveIssued,
      );
      procurement = num(decision.forward_qty ?? decision.shortage_qty);
      available =
        decision.available_qty === undefined || decision.available_qty === null
          ? null
          : num(decision.available_qty);
    } else if (liveIssued > 0) {
      issued = liveIssued;
      procurement = 0;
      available = null;
    } else if (isTerminalIssued) {
      issued = requested;
      procurement = 0;
      available = null;
    } else if (
      workflowStatus === "Procurement Required" ||
      workflowStatus === "Forwarded to Procurement" ||
      workflowStatus === "RFQ Created"
    ) {
      issued = 0;
      procurement = requested;
      available = null;
    } else {
      issued = 0;
      procurement = 0;
      available = null;
    }

    issued = Math.min(issued, requested);
    const remaining = Math.max(0, requested - issued);
    // Units already issued from warehouse stock must not stay under Procurement.
    if (issued > 0 && procurement > 0) {
      procurement = Math.min(procurement, remaining);
    }
    if (issued >= requested && requested > 0) {
      procurement = 0;
    }

    return {
      item_code: row.item_code,
      item_name: row.item_name ?? row.item_code,
      uom: row.uom ?? "Nos",
      warehouse: row.warehouse ?? decision?.warehouse ?? "—",
      requested,
      available,
      issued,
      remaining,
      procurement,
      status: classifyItem(requested, issued, procurement, workflowStatus),
      ...pickEngineeringDocs(row),
    };
  });

  const totals = items.reduce(
    (acc, it) => {
      acc.requested += it.requested;
      acc.issued += it.issued;
      acc.remaining += it.remaining;
      acc.procurement += it.procurement;
      return acc;
    },
    { requested: 0, issued: 0, remaining: 0, procurement: 0, issuedPercent: 0 },
  );
  totals.issuedPercent =
    totals.requested > 0
      ? Math.round((totals.issued / totals.requested) * 100)
      : 0;

  return {
    workflowStatus,
    rollup: rollupStatus(workflowStatus, items, totals),
    items,
    totals,
  };
}

function rollupStatus(
  workflow: MaterialRequestWorkflowStatus,
  items: ItemFulfillment[],
  totals: { requested: number; issued: number; procurement: number },
): RequestFulfillmentStatus {
  if (workflow === "Draft") return "Draft";
  if (workflow === "Cancelled") return "Cancelled";
  if (workflow === "Completed") return "Completed";

  const anyIssued = totals.issued > 0;
  const anyProcurement =
    totals.procurement > 0 ||
    workflow === "Procurement Required" ||
    workflow === "Forwarded to Procurement" ||
    workflow === "RFQ Created";
  const fullyIssued =
    items.length > 0 && items.every((it) => it.remaining === 0 && it.issued > 0);

  if (
    fullyIssued ||
    workflow === "Material Issued" ||
    workflow === "Pending Department Acceptance"
  ) {
    return "Fully Issued";
  }
  if (anyIssued && anyProcurement) return "Partially Fulfilled";
  if (anyProcurement) return "Sent to Procurement";
  return "Pending Review";
}

/** Tailwind tone for a per-item fulfillment status (green/orange/blue/gray). */
export function itemStatusClasses(status: ItemFulfillmentStatus): string {
  switch (status) {
    case "Draft":
      return "bg-neutral-100 text-neutral-500";
    case "Issued":
      return "bg-emerald-100 text-emerald-700";
    case "Partial":
      return "bg-orange-100 text-orange-700";
    case "Procurement":
      return "bg-blue-100 text-blue-700";
    default:
      return "bg-neutral-100 text-neutral-600";
  }
}
