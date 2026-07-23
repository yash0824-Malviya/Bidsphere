/**
 * Delivery Schedule display status — always derived from PO / Shipment / GRN
 * facts. Never trust a stale cached "In Transit" label alone.
 */

import type { PODeliveryState, PODeliveryStatus } from "../api/poDeliveryWorkflow";

/** UI statuses shown on the Supplier Delivery Schedule page. */
export type ScheduleDisplayStatus =
  | "Scheduled"
  | "Ready for Dispatch"
  | "In Transit"
  | "Arrived"
  | "Delivered"
  | "Delayed";

export interface ScheduleStatusInput {
  /** Cached / ERP PO Shipment status (may be stale). */
  shipmentStatus?: PODeliveryStatus | string | null;
  supplierAccepted?: boolean;
  dispatchDate?: string | null;
  /** ERPNext Purchase Order.per_received (0–100). */
  perReceived?: number | null;
  /** ERPNext Purchase Order.status */
  poStatus?: string | null;
  /** True when at least one submitted GRN exists for the PO. */
  hasSubmittedGrn?: boolean;
  /** True when a GRN is fully completed / PO fully received via receipts. */
  grnCompleted?: boolean;
  expectedDeliveryDate?: string | null;
  /** Fallback ETA from PO.schedule_date */
  poScheduleDate?: string | null;
}

/** Statuses that mean the supplier has already dispatched (not merely accepted). */
const DISPATCHED_SHIPMENT_STATUSES = new Set<string>([
  "In Transit",
  "Arrived",
  "Partially Received",
]);

function parseDay(isoLike: string | null | undefined): Date | null {
  if (!isoLike) return null;
  const raw = String(isoLike).trim();
  if (!raw) return null;
  // Prefer date-only compare (YYYY-MM-DD) to avoid TZ off-by-one.
  const day = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function startOfToday(): Date {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
}

function isPastDue(input: ScheduleStatusInput): boolean {
  const eta =
    parseDay(input.expectedDeliveryDate) || parseDay(input.poScheduleDate);
  if (!eta) return false;
  return eta.getTime() < startOfToday().getTime();
}

function isFullyReceived(input: ScheduleStatusInput): boolean {
  // Trust PO/GRN quantities — not a cached shipment label (stale "In Transit" bug).
  const per = Number(input.perReceived);
  if (Number.isFinite(per) && per >= 100) return true;
  if (input.grnCompleted) return true;
  const poStatus = String(input.poStatus || "").toLowerCase();
  return poStatus === "completed";
}

function isDispatched(input: ScheduleStatusInput): boolean {
  if (input.dispatchDate && String(input.dispatchDate).trim()) return true;
  const ship = String(input.shipmentStatus || "");
  return DISPATCHED_SHIPMENT_STATUSES.has(ship);
}

function isSupplierConfirmed(input: ScheduleStatusInput): boolean {
  if (input.supplierAccepted) return true;
  const ship = String(input.shipmentStatus || "");
  return (
    ship === "Accepted" ||
    ship === "In Transit" ||
    ship === "Arrived" ||
    ship === "Partially Received" ||
    ship === "Delivered" ||
    ship === "Completed"
  );
}

/**
 * Derive Delivery Schedule badge status from live PO / shipment / GRN signals.
 *
 * Priority:
 * 1. GRN completed OR received qty ≥ ordered qty → Delivered
 * 2. Goods at warehouse (Arrived / partial GRN) → Arrived
 * 3. Shipment dispatched → In Transit
 * 4. Supplier confirmed shipment → Ready for Dispatch
 * 5. Else → Scheduled
 * Past ETA (and not Delivered/Arrived) → Delayed
 */
export function deriveScheduleDisplayStatus(
  input: ScheduleStatusInput,
): ScheduleDisplayStatus {
  if (isFullyReceived(input)) {
    return "Delivered";
  }

  const ship = String(input.shipmentStatus || "");
  const per = Number(input.perReceived) || 0;
  const hasGrn = !!input.hasSubmittedGrn || per > 0;

  // Warehouse has taken goods (partial or arrived) but not fully received.
  if (ship === "Arrived" || (hasGrn && (ship === "Partially Received" || per > 0))) {
    if (isPastDue(input)) return "Delayed";
    return "Arrived";
  }

  if (isDispatched(input)) {
    if (isPastDue(input)) return "Delayed";
    return "In Transit";
  }

  if (isSupplierConfirmed(input)) {
    if (isPastDue(input)) return "Delayed";
    return "Ready for Dispatch";
  }

  if (isPastDue(input)) return "Delayed";
  return "Scheduled";
}

export function scheduleStatusFromDeliveryState(
  delivery: Pick<
    PODeliveryState,
    | "status"
    | "supplier_accepted"
    | "dispatch_date"
    | "expected_delivery_date"
  > | null | undefined,
  po: {
    per_received?: number | null;
    status?: string | null;
    schedule_date?: string | null;
  },
  grn?: { hasSubmittedGrn?: boolean; grnCompleted?: boolean },
): ScheduleDisplayStatus {
  return deriveScheduleDisplayStatus({
    shipmentStatus: delivery?.status,
    supplierAccepted: delivery?.supplier_accepted,
    dispatchDate: delivery?.dispatch_date,
    expectedDeliveryDate: delivery?.expected_delivery_date,
    perReceived: po.per_received,
    poStatus: po.status,
    poScheduleDate: po.schedule_date,
    hasSubmittedGrn: grn?.hasSubmittedGrn,
    grnCompleted: grn?.grnCompleted,
  });
}

export const SCHEDULE_STATUS_BADGE_CLASSES: Record<
  ScheduleDisplayStatus,
  string
> = {
  Scheduled: "bg-neutral-100 text-neutral-700",
  "Ready for Dispatch": "bg-primary-100 text-primary-700",
  "In Transit": "bg-purple-100 text-purple-700",
  Arrived: "bg-orange-100 text-orange-800",
  Delivered: "bg-success-100 text-success-700",
  Delayed: "bg-danger-100 text-danger-700",
};

export const SCHEDULE_STATUS_DOT_CLASSES: Record<ScheduleDisplayStatus, string> =
  {
    Scheduled: "bg-neutral-400",
    "Ready for Dispatch": "bg-primary-500",
    "In Transit": "bg-purple-500",
    Arrived: "bg-orange-500",
    Delivered: "bg-success-500",
    Delayed: "bg-danger-500",
  };
