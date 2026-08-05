/**
 * PO Delivery Workflow API service.
 *
 * Manages the Supplier PO acceptance → delivery → GRN lifecycle.
 *
 * Persistence:
 *   1. ERPNext DocType "PO Shipment" via `/api/po-shipment/*` — single source
 *      of truth shared with Warehouse Receive Goods (cross-browser).
 *   2. localStorage cache for instant portal UX / offline resilience.
 *
 * Workflow statuses:
 *   Pending Acceptance → Accepted / Rejected
 *   Accepted → In Transit → Partially Received → Completed
 */

import { createNotification } from "./notifications";
import type { NotificationTargetRole } from "../types/notification";
import {
  fetchPoShipment,
  shipmentRecordToDeliveryState,
  upsertPoShipmentRemote,
} from "./poShipment";
import { queryClient } from "../queryClient";
import type { QueryClient } from "@tanstack/react-query";
import {
  formatERPNextDate,
  nowERPNextDatetime,
} from "../utils/erpNextDate";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export type PODeliveryStatus =
  | "Pending Acceptance"
  | "Accepted"
  | "Rejected"
  | "In Transit"
  | "Delivered"
  | "Arrived"
  | "Partially Received"
  | "Completed";

export interface PODeliveryState {
  po_name: string;
  status: PODeliveryStatus;

  /* acceptance */
  supplier_accepted: boolean;
  supplier_acceptance_date?: string;
  rejection_reason?: string;
  rejected_date?: string;

  /* delivery details */
  expected_delivery_date?: string;
  vehicle_number?: string;
  tracking_number?: string;
  shipping_notes?: string;
  /** When supplier marked the shipment In Transit. */
  dispatch_date?: string;

  /* metadata */
  created_at: string;
  updated_at: string;
  updated_by?: string;
}

export interface AcceptPOPayload {
  expected_delivery_date: string;
  vehicle_number?: string;
  tracking_number?: string;
  shipping_notes?: string;
}

export interface RejectPOPayload {
  rejection_reason: string;
}

const STORAGE_PREFIX = "po_delivery_";

function hasGrnSignal(
  submittedGrnCount: number,
  perReceived: number,
  poSubmitted = true,
): boolean {
  return submittedGrnCount > 0 || (poSubmitted && perReceived > 0);
}
/* -------------------------------------------------------------------------- */

function storageKey(poName: string): string {
  return `${STORAGE_PREFIX}${poName}`;
}

export function getDeliveryState(poName: string): PODeliveryState | null {
  try {
    const raw = localStorage.getItem(storageKey(poName));
    return raw ? (JSON.parse(raw) as PODeliveryState) : null;
  } catch {
    return null;
  }
}

export function saveDeliveryState(state: PODeliveryState): void {
  try {
    localStorage.setItem(storageKey(state.po_name), JSON.stringify(state));
  } catch {
    /* ignore storage errors */
  }
}

/**
 * Persist to ERPNext PO Shipment + invalidate warehouse incoming list.
 * Supplier Link is resolved server-side from Purchase Order.supplier — never
 * pass a company display name (ERPNext Link validation will reject it).
 */
export async function persistDeliveryStateToErp(
  state: PODeliveryState,
  _erpSupplierId?: string,
): Promise<void> {
  try {
    // eslint-disable-next-line no-console
    console.log("[PO Delivery] Shipment submitted → ERP upsert", {
      po_name: state.po_name,
      status: state.status,
      vehicle_number: state.vehicle_number,
      tracking_number: state.tracking_number,
      expected_delivery_date: state.expected_delivery_date,
    });

    const record = await upsertPoShipmentRemote({
      ...state,
      // Omit supplier — gateway resolves Link from the Purchase Order document.
      supplier: undefined,
    });

    // eslint-disable-next-line no-console
    console.log("[PO Delivery] PO updated / Ready for GRN flag", {
      po_name: record.po_name,
      shipment_status: record.shipment_status,
      ready_for_grn: record.ready_for_grn,
      warehouse_visible: record.warehouse_visible,
    });

    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["incoming-purchase-orders"],
        refetchType: "active",
      }),
      queryClient.invalidateQueries({
        queryKey: ["warehouse", "incoming-pos"],
        refetchType: "active",
      }),
      queryClient.invalidateQueries({
        queryKey: ["po-shipments"],
        refetchType: "active",
      }),
      queryClient.invalidateQueries({
        queryKey: ["po-shipment", state.po_name],
        refetchType: "active",
      }),
      queryClient.invalidateQueries({
        queryKey: ["supplier-portal-pos"],
        refetchType: "active",
      }),
    ]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[PO Delivery] ERP shipment sync failed:", err);
    throw err instanceof Error
      ? err
      : new Error("Failed to sync shipment details to warehouse.");
  }
}

/**
 * Push any localStorage delivery states that are Accepted / In Transit+ into ERP.
 * Recovers from earlier sync failures (e.g. invalid Supplier Link).
 */
export async function resyncLocalDeliveryStatesToErp(
  erpSupplierId?: string,
): Promise<number> {
  const states = getAllDeliveryStates().filter((s) =>
    ["Accepted", "In Transit", "Delivered", "Arrived", "Partially Received", "Completed"].includes(
      s.status,
    ),
  );
  let synced = 0;
  for (const state of states) {
    try {
      await persistDeliveryStateToErp(state, erpSupplierId);
      synced += 1;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[PO Delivery] resync failed for", state.po_name, err);
    }
  }
  // eslint-disable-next-line no-console
  console.log("[PO Delivery] resync complete", { attempted: states.length, synced });
  return synced;
}

function getAllDeliveryStates(): PODeliveryState[] {
  const result: PODeliveryState[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(STORAGE_PREFIX)) {
      try {
        const val = JSON.parse(localStorage.getItem(key)!) as PODeliveryState;
        if (val?.po_name) result.push(val);
      } catch { /* skip */ }
    }
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/*  Notifications                                                              */
/* -------------------------------------------------------------------------- */

function poRoute(role: NotificationTargetRole, poName: string): string {
  const enc = encodeURIComponent(poName);
  if (role === "supplier") return `/supplier/po/${enc}`;
  if (role === "warehouse") return `/warehouse/inventory/create-grn?po=${enc}`;
  return `/p2p/purchase-orders/${enc}`;
}

function addDeliveryNotification(input: {
  po_name: string;
  type: "po_created" | "supplier_accepted" | "supplier_rejected" | "delivery_updated";
  message: string;
  for_role: NotificationTargetRole;
  supplier_id?: string;
}): void {
  const module =
    input.for_role === "warehouse"
      ? "PO Ready for GRN"
      : "Purchase Order";
  const title =
    input.type === "po_created"
      ? `Purchase Order ${input.po_name}`
      : input.type === "supplier_accepted"
        ? `PO accepted: ${input.po_name}`
        : input.type === "supplier_rejected"
          ? `PO rejected: ${input.po_name}`
          : `Delivery update: ${input.po_name}`;

  createNotification({
    title,
    description: input.message,
    module,
    event_type: `po_delivery_${input.type}`,
    target_role: input.for_role,
    supplier_id: input.supplier_id?.trim().toLowerCase(),
    document_type: "Purchase Order",
    document_name: input.po_name,
    route_path: poRoute(input.for_role, input.po_name),
  });
}

/** @deprecated Delivery alerts are stored in the enterprise notification feed. */
export function getDeliveryNotifications(): never[] {
  return [];
}

/** @deprecated Use enterprise notification APIs instead. */
export function markNotificationRead(_id: string): void {
  /* no-op — legacy PO delivery inbox removed */
}

/** @deprecated Use enterprise notification APIs instead. */
export function getUnreadNotificationCount(_forRole?: string): number {
  return 0;
}

/* -------------------------------------------------------------------------- */
/*  Workflow actions                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Ensure a delivery state record exists for a PO.
 * Called when a PO is created or first viewed.
 */
export function ensureDeliveryState(
  poName: string,
  _supplierName?: string
): PODeliveryState {
  const existing = getDeliveryState(poName);
  if (existing) return existing;

  const now = nowERPNextDatetime();
  const state: PODeliveryState = {
    po_name: poName,
    status: "Pending Acceptance",
    supplier_accepted: false,
    created_at: now,
    updated_at: now,
  };
  saveDeliveryState(state);

  addDeliveryNotification({
    po_name: poName,
    type: "po_created",
    message: `Purchase Order ${poName} has been issued and is awaiting your acceptance.`,
    for_role: "supplier",
    supplier_id: _supplierName,
  });

  return state;
}

/** Statuses where Accept / Reject must not be offered. */
export const PO_ACCEPTANCE_LOCKED_STATUSES: readonly PODeliveryStatus[] = [
  "Accepted",
  "Rejected",
  "In Transit",
  "Delivered",
  "Arrived",
  "Partially Received",
  "Completed",
] as const;

export function isPoPendingSupplierAcceptance(
  status: string | null | undefined,
): boolean {
  return (status || "Pending Acceptance") === "Pending Acceptance";
}

/**
 * Prefer ERP PO Shipment (SSoT), fall back to local cache / seed.
 * Keeps portal UI aligned after accept across reloads / tabs.
 */
export async function hydrateDeliveryStateFromErp(
  poName: string,
  supplierName?: string,
): Promise<PODeliveryState> {
  try {
    const remote = await fetchPoShipment(poName);
    if (remote?.po_name && remote.shipment_status) {
      const mapped = shipmentRecordToDeliveryState(remote);
      saveDeliveryState(mapped);
      return mapped;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[PO Delivery] ERP hydrate failed; using local cache:", err);
  }
  return ensureDeliveryState(poName, supplierName);
}

/**
 * Supplier accepts the PO and provides delivery details.
 * Syncs to ERPNext so Warehouse sees ETA / logistics immediately.
 */
export async function acceptPO(
  poName: string,
  payload: AcceptPOPayload,
  supplierName?: string
): Promise<PODeliveryState> {
  // Re-read ERP first so a prior accept (other tab / failed UI refresh) is visible.
  const state = await hydrateDeliveryStateFromErp(poName, supplierName);
  if (state.status !== "Pending Acceptance") {
    throw new Error(`Cannot accept PO in status "${state.status}".`);
  }

  const now = nowERPNextDatetime();
  state.status = "Accepted";
  state.supplier_accepted = true;
  state.supplier_acceptance_date = now;
  state.expected_delivery_date =
    formatERPNextDate(payload.expected_delivery_date) ||
    payload.expected_delivery_date;
  state.vehicle_number = payload.vehicle_number;
  state.tracking_number = payload.tracking_number;
  state.shipping_notes = payload.shipping_notes;
  state.updated_at = now;
  state.updated_by = supplierName;
  saveDeliveryState(state);

  // eslint-disable-next-line no-console
  console.log("[PO Delivery] Accepted:", { poName, payload, supplierName });

  await persistDeliveryStateToErp(state, supplierName);

  addDeliveryNotification({
    po_name: poName,
    type: "supplier_accepted",
    message: `${supplierName ?? "Supplier"} has accepted PO ${poName}. Expected delivery: ${payload.expected_delivery_date}.`,
    for_role: "procurement",
  });

  addDeliveryNotification({
    po_name: poName,
    type: "delivery_updated",
    message: `Delivery scheduled for PO ${poName}. Expected: ${payload.expected_delivery_date}.`,
    for_role: "warehouse",
  });

  return state;
}

/**
 * Supplier rejects the PO.
 */
export async function rejectPO(
  poName: string,
  payload: RejectPOPayload,
  supplierName?: string
): Promise<PODeliveryState> {
  const state = await hydrateDeliveryStateFromErp(poName, supplierName);
  if (state.status !== "Pending Acceptance") {
    throw new Error(`Cannot reject PO in status "${state.status}".`);
  }

  const now = nowERPNextDatetime();
  state.status = "Rejected";
  state.supplier_accepted = false;
  state.rejection_reason = payload.rejection_reason;
  state.rejected_date = now;
  state.updated_at = now;
  state.updated_by = supplierName;
  saveDeliveryState(state);

  // eslint-disable-next-line no-console
  console.log("[PO Delivery] Rejected:", { poName, payload, supplierName });

  await persistDeliveryStateToErp(state, supplierName);

  addDeliveryNotification({
    po_name: poName,
    type: "supplier_rejected",
    message: `${supplierName ?? "Supplier"} has rejected PO ${poName}. Reason: ${payload.rejection_reason}`,
    for_role: "procurement",
  });

  return state;
}

/**
 * Update delivery details (vehicle, tracking, etc.) on an accepted PO.
 */
export async function updateDeliveryDetails(
  poName: string,
  patch: Partial<AcceptPOPayload>,
  supplierName?: string
): Promise<PODeliveryState> {
  const state = getDeliveryState(poName);
  if (!state) throw new Error(`No delivery state for PO ${poName}.`);
  if (state.status === "Pending Acceptance" || state.status === "Rejected") {
    throw new Error(`Cannot update delivery in status "${state.status}".`);
  }

  const now = nowERPNextDatetime();
  if (patch.expected_delivery_date) {
    state.expected_delivery_date =
      formatERPNextDate(patch.expected_delivery_date) ||
      patch.expected_delivery_date;
  }
  if (patch.vehicle_number !== undefined) state.vehicle_number = patch.vehicle_number;
  if (patch.tracking_number !== undefined) state.tracking_number = patch.tracking_number;
  if (patch.shipping_notes !== undefined) state.shipping_notes = patch.shipping_notes;
  state.updated_at = now;
  state.updated_by = supplierName;
  saveDeliveryState(state);

  await persistDeliveryStateToErp(state, supplierName);

  addDeliveryNotification({
    po_name: poName,
    type: "delivery_updated",
    message: `Delivery details updated for PO ${poName} by ${supplierName ?? "supplier"}.`,
    for_role: "warehouse",
  });

  return state;
}

/**
 * Transition PO to "In Transit" status.
 */
export async function markInTransit(
  poName: string,
  supplierName?: string
): Promise<PODeliveryState> {
  const state = getDeliveryState(poName);
  if (!state) throw new Error(`No delivery state for PO ${poName}.`);
  if (state.status !== "Accepted") {
    throw new Error(`Cannot mark in-transit from status "${state.status}".`);
  }

  const now = nowERPNextDatetime();
  state.status = "In Transit";
  state.dispatch_date = now;
  state.updated_at = now;
  state.updated_by = supplierName;
  saveDeliveryState(state);

  await persistDeliveryStateToErp(state, supplierName);

  addDeliveryNotification({
    po_name: poName,
    type: "delivery_updated",
    message: `PO ${poName} shipment is now in transit.`,
    for_role: "warehouse",
  });
  addDeliveryNotification({
    po_name: poName,
    type: "delivery_updated",
    message: `PO ${poName} shipment is now in transit.`,
    for_role: "procurement",
  });

  return state;
}

/* -------------------------------------------------------------------------- */
/*  Query helpers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Get the delivery status for a PO. Returns "Pending Acceptance" if
 * no record exists yet (i.e. it was just created).
 */
export function getEffectiveDeliveryStatus(poName: string): PODeliveryStatus {
  return getDeliveryState(poName)?.status ?? "Pending Acceptance";
}

/**
 * Check whether GRN creation is allowed for this PO.
 * Only after shipment is dispatched (In Transit / Delivered / Arrived / …).
 */
export function canCreateGRNForPO(poName: string): {
  allowed: boolean;
  reason?: string;
} {
  const status = getEffectiveDeliveryStatus(poName);
  if (
    status === "In Transit" ||
    status === "Delivered" ||
    status === "Arrived" ||
    status === "Partially Received" ||
    status === "Completed"
  ) {
    return { allowed: true };
  }
  if (status === "Rejected") {
    return { allowed: false, reason: "This PO was rejected by the supplier." };
  }
  if (status === "Accepted") {
    return {
      allowed: false,
      reason: "Shipment is accepted but not yet dispatched. Wait until the supplier marks it In Transit.",
    };
  }
  return {
    allowed: false,
    reason:
      "Supplier has not dispatched this shipment yet. GRN can only be created after the shipment is In Transit.",
  };
}

/**
 * Get delivery states for multiple POs at once.
 */
export function getDeliveryStatesForPOs(
  poNames: string[]
): Map<string, PODeliveryState> {
  const map = new Map<string, PODeliveryState>();
  for (const name of poNames) {
    const s = getDeliveryState(name);
    if (s) map.set(name, s);
  }
  return map;
}

/**
 * Summary counts for procurement dashboard.
 */
export function getDeliveryStatusCounts(): Record<PODeliveryStatus, number> {
  const all = getAllDeliveryStates();
  const counts: Record<PODeliveryStatus, number> = {
    "Pending Acceptance": 0,
    Accepted: 0,
    Rejected: 0,
    "In Transit": 0,
    Delivered: 0,
    Arrived: 0,
    "Partially Received": 0,
    Completed: 0,
  };
  for (const s of all) {
    if (s.status in counts) counts[s.status]++;
  }
  return counts;
}

/**
 * Advance local delivery status when ERPNext documents progress beyond the
 * supplier-portal milestone (e.g. GRN submitted while status still "In Transit").
 */
export function syncDeliveryStateFromERPNext(
  poName: string,
  metrics: {
    poSubmitted: boolean;
    perReceived: number;
    perBilled: number;
    submittedGrnCount: number;
    hasSubmittedInvoice: boolean;
    invoiceOutstanding?: number;
    invoiceGrandTotal?: number;
  }
): PODeliveryState | null {
  const state = getDeliveryState(poName);
  if (!state || state.status === "Rejected" || !metrics.poSubmitted) {
    return state;
  }

  const fullyReceived = metrics.perReceived >= 100;
  const hasGrn = hasGrnSignal(
    metrics.submittedGrnCount,
    metrics.perReceived,
    metrics.poSubmitted,
  );
  const paymentDone =
    metrics.hasSubmittedInvoice &&
    (metrics.invoiceGrandTotal ?? 0) > 0 &&
    (metrics.invoiceOutstanding ?? 1) === 0;

  let next: PODeliveryStatus = state.status;

  if (fullyReceived && hasGrn && metrics.hasSubmittedInvoice && paymentDone) {
    next = "Completed";
  } else if (fullyReceived && hasGrn) {
    next = "Delivered";
  } else if (hasGrn) {
    next = "Partially Received";
  }

  if (next === state.status) return state;

  const updated: PODeliveryState = {
    ...state,
    status: next,
    updated_at: nowERPNextDatetime(),
    updated_by: "ERPNext sync",
  };
  saveDeliveryState(updated);

  // eslint-disable-next-line no-console
  console.log("[PO Workflow] Delivery status transition (local sync)", {
    poName,
    from: state.status,
    to: next,
    perReceived: metrics.perReceived,
    submittedGrnCount: metrics.submittedGrnCount,
  });

  return updated;
}

/**
 * After GRN submit: reconcile PO Shipment + local cache from ERPNext PO metrics,
 * persist to ERP, and invalidate portal caches so timelines stay aligned.
 */
export async function advancePoWorkflowAfterGrnSubmit(
  poName: string,
  metrics: {
    perReceived: number;
    perBilled: number;
    submittedGrnCount: number;
    hasSubmittedInvoice?: boolean;
    invoiceOutstanding?: number;
    invoiceGrandTotal?: number;
  },
): Promise<PODeliveryState | null> {
  // eslint-disable-next-line no-console
  console.log("[PO Workflow] GRN submit → reconciling PO shipment", {
    poName,
    ...metrics,
  });

  let base: PODeliveryState;
  try {
    base = await hydrateDeliveryStateFromErp(poName);
  } catch {
    base = ensureDeliveryState(poName);
  }

  const synced =
    syncDeliveryStateFromERPNext(poName, {
      poSubmitted: true,
      perReceived: metrics.perReceived,
      perBilled: metrics.perBilled,
      submittedGrnCount: metrics.submittedGrnCount,
      hasSubmittedInvoice: metrics.hasSubmittedInvoice ?? false,
      invoiceOutstanding: metrics.invoiceOutstanding,
      invoiceGrandTotal: metrics.invoiceGrandTotal,
    }) ?? base;

  const hasGrn = hasGrnSignal(
    metrics.submittedGrnCount,
    metrics.perReceived,
    true,
  );

  if (
    hasGrn &&
    ["Accepted", "In Transit", "Delivered", "Arrived"].includes(synced.status)
  ) {
    synced.status =
      metrics.perReceived >= 100 ? "Delivered" : "Partially Received";
    synced.updated_at = nowERPNextDatetime();
    synced.updated_by = "GRN submit";
    saveDeliveryState(synced);
  }

  try {
    const record = await persistDeliveryStateToErp(synced);
    // eslint-disable-next-line no-console
    console.log("[PO Workflow] PO shipment updated after GRN", {
      poName,
      shipment_status: record.shipment_status,
      perReceived: metrics.perReceived,
      receivedPct: metrics.perReceived,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[PO Workflow] ERP shipment persist after GRN failed:", err);
  }

  invalidatePoWorkflowQueries(queryClient, poName);
  return synced;
}

/** Invalidate every React Query key that feeds PO workflow timelines. */
export function invalidatePoWorkflowQueries(
  client: QueryClient,
  poName: string,
): void {
  const keys: readonly (readonly string[])[] = [
    ["purchase-order", poName],
    ["po-grns", poName],
    ["po-shipment", poName],
    ["po-invoices", poName],
    ["supplier-portal-po", poName],
    ["supplier-portal-po-grns", poName],
    ["supplier-portal-po-invoices", poName],
    ["incoming-purchase-orders"],
    ["purchase-orders"],
    ["supplier-portal-pos"],
    ["po-shipments"],
  ];

  for (const queryKey of keys) {
    void client.invalidateQueries({ queryKey, refetchType: "active" });
  }

  // eslint-disable-next-line no-console
  console.log("[PO Workflow] Timeline refresh — cache invalidated", { poName });
}

/**
 * Auto-generate delivery states for POs that don't have one.
 * Used for seeding demo data on existing POs.
 */
export function seedDeliveryStatesForExistingPOs(
  poNames: string[]
): void {
  for (const name of poNames) {
    ensureDeliveryState(name);
  }
}
