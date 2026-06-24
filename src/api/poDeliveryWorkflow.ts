/**
 * PO Delivery Workflow API service.
 *
 * Manages the Supplier PO acceptance → delivery → GRN lifecycle.
 * State is persisted per-PO in localStorage and synced to ERPNext
 * custom fields when available.
 *
 * Workflow statuses:
 *   Pending Acceptance → Accepted / Rejected
 *   Accepted → In Transit → Partially Received → Completed
 */

const STORAGE_PREFIX = "po_delivery_";
const NOTIFICATION_KEY = "po_delivery_notifications";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export type PODeliveryStatus =
  | "Pending Acceptance"
  | "Accepted"
  | "Rejected"
  | "In Transit"
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

export interface PODeliveryNotification {
  id: string;
  po_name: string;
  type: "po_created" | "supplier_accepted" | "supplier_rejected" | "delivery_updated";
  message: string;
  timestamp: string;
  read: boolean;
  for_role: "supplier" | "procurement" | "warehouse";
}

/* -------------------------------------------------------------------------- */
/*  Local persistence                                                          */
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

function getNotifications(): PODeliveryNotification[] {
  try {
    const raw = localStorage.getItem(NOTIFICATION_KEY);
    return raw ? (JSON.parse(raw) as PODeliveryNotification[]) : [];
  } catch {
    return [];
  }
}

function saveNotifications(list: PODeliveryNotification[]): void {
  try {
    localStorage.setItem(NOTIFICATION_KEY, JSON.stringify(list));
  } catch { /* ignore */ }
}

function addNotification(
  n: Omit<PODeliveryNotification, "id" | "timestamp" | "read">
): void {
  const all = getNotifications();
  all.unshift({
    ...n,
    id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    read: false,
  });
  saveNotifications(all.slice(0, 100));
}

export function getDeliveryNotifications(
  forRole?: string
): PODeliveryNotification[] {
  const all = getNotifications();
  if (!forRole) return all;
  return all.filter((n) => n.for_role === forRole);
}

export function markNotificationRead(id: string): void {
  const all = getNotifications();
  const n = all.find((x) => x.id === id);
  if (n) {
    n.read = true;
    saveNotifications(all);
  }
}

export function getUnreadNotificationCount(forRole?: string): number {
  return getDeliveryNotifications(forRole).filter((n) => !n.read).length;
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

  const now = new Date().toISOString();
  const state: PODeliveryState = {
    po_name: poName,
    status: "Pending Acceptance",
    supplier_accepted: false,
    created_at: now,
    updated_at: now,
  };
  saveDeliveryState(state);

  addNotification({
    po_name: poName,
    type: "po_created",
    message: `Purchase Order ${poName} has been issued and is awaiting your acceptance.`,
    for_role: "supplier",
  });

  return state;
}

/**
 * Supplier accepts the PO and provides delivery details.
 */
export function acceptPO(
  poName: string,
  payload: AcceptPOPayload,
  supplierName?: string
): PODeliveryState {
  const state = ensureDeliveryState(poName);
  if (state.status !== "Pending Acceptance") {
    throw new Error(`Cannot accept PO in status "${state.status}".`);
  }

  const now = new Date().toISOString();
  state.status = "Accepted";
  state.supplier_accepted = true;
  state.supplier_acceptance_date = now;
  state.expected_delivery_date = payload.expected_delivery_date;
  state.vehicle_number = payload.vehicle_number;
  state.tracking_number = payload.tracking_number;
  state.shipping_notes = payload.shipping_notes;
  state.updated_at = now;
  state.updated_by = supplierName;
  saveDeliveryState(state);

  // eslint-disable-next-line no-console
  console.log("[PO Delivery] Accepted:", { poName, payload, supplierName });

  addNotification({
    po_name: poName,
    type: "supplier_accepted",
    message: `${supplierName ?? "Supplier"} has accepted PO ${poName}. Expected delivery: ${payload.expected_delivery_date}.`,
    for_role: "procurement",
  });

  addNotification({
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
export function rejectPO(
  poName: string,
  payload: RejectPOPayload,
  supplierName?: string
): PODeliveryState {
  const state = ensureDeliveryState(poName);
  if (state.status !== "Pending Acceptance") {
    throw new Error(`Cannot reject PO in status "${state.status}".`);
  }

  const now = new Date().toISOString();
  state.status = "Rejected";
  state.supplier_accepted = false;
  state.rejection_reason = payload.rejection_reason;
  state.rejected_date = now;
  state.updated_at = now;
  state.updated_by = supplierName;
  saveDeliveryState(state);

  // eslint-disable-next-line no-console
  console.log("[PO Delivery] Rejected:", { poName, payload, supplierName });

  addNotification({
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
export function updateDeliveryDetails(
  poName: string,
  patch: Partial<AcceptPOPayload>,
  supplierName?: string
): PODeliveryState {
  const state = getDeliveryState(poName);
  if (!state) throw new Error(`No delivery state for PO ${poName}.`);
  if (state.status === "Pending Acceptance" || state.status === "Rejected") {
    throw new Error(`Cannot update delivery in status "${state.status}".`);
  }

  const now = new Date().toISOString();
  if (patch.expected_delivery_date) state.expected_delivery_date = patch.expected_delivery_date;
  if (patch.vehicle_number !== undefined) state.vehicle_number = patch.vehicle_number;
  if (patch.tracking_number !== undefined) state.tracking_number = patch.tracking_number;
  if (patch.shipping_notes !== undefined) state.shipping_notes = patch.shipping_notes;
  state.updated_at = now;
  state.updated_by = supplierName;
  saveDeliveryState(state);

  addNotification({
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
export function markInTransit(
  poName: string,
  supplierName?: string
): PODeliveryState {
  const state = getDeliveryState(poName);
  if (!state) throw new Error(`No delivery state for PO ${poName}.`);
  if (state.status !== "Accepted") {
    throw new Error(`Cannot mark in-transit from status "${state.status}".`);
  }

  state.status = "In Transit";
  state.updated_at = new Date().toISOString();
  state.updated_by = supplierName;
  saveDeliveryState(state);

  addNotification({
    po_name: poName,
    type: "delivery_updated",
    message: `PO ${poName} shipment is now in transit.`,
    for_role: "warehouse",
  });
  addNotification({
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
 * Only allowed when supplier has accepted or shipment is in transit.
 */
export function canCreateGRNForPO(poName: string): {
  allowed: boolean;
  reason?: string;
} {
  const status = getEffectiveDeliveryStatus(poName);
  if (status === "Accepted" || status === "In Transit" || status === "Partially Received" || status === "Completed") {
    return { allowed: true };
  }
  if (status === "Rejected") {
    return { allowed: false, reason: "This PO was rejected by the supplier." };
  }
  return {
    allowed: false,
    reason: "Supplier has not confirmed delivery yet. GRN can only be created after the supplier accepts the PO.",
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
    "Partially Received": 0,
    Completed: 0,
  };
  for (const s of all) {
    if (s.status in counts) counts[s.status]++;
  }
  return counts;
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
