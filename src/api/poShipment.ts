/**
 * Client for the privileged PO Shipment gateway — shared Supplier ↔ Warehouse
 * logistics SSoT (ERPNext DocType "PO Shipment").
 */
import type { PODeliveryState, PODeliveryStatus } from "./poDeliveryWorkflow";
import { sanitizePoShipmentDates } from "../utils/erpNextDate";

export interface PoShipmentRecord {
  name?: string;
  po_name: string;
  supplier?: string;
  shipment_status: PODeliveryStatus;
  supplier_status?: string;
  supplier_accepted?: 0 | 1 | boolean;
  supplier_acceptance_date?: string;
  rejection_reason?: string;
  rejected_date?: string;
  expected_delivery_date?: string;
  vehicle_number?: string;
  tracking_number?: string;
  shipping_notes?: string;
  dispatch_date?: string;
  ready_for_grn?: 0 | 1 | boolean;
  warehouse_visible?: 0 | 1 | boolean;
  updated_by?: string;
  modified?: string;
}

async function callPoShipmentApi<T>(
  action: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  try {
    const token =
      sessionStorage.getItem("bidsphere-access-token") ||
      localStorage.getItem("bidsphere-access-token-remember");
    if (token) headers["X-Bidsphere-Access-Token"] = token;
  } catch {
    /* ignore */
  }

  const res = await fetch(`/api/po-shipment/${action}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
  });

  let json: { success?: boolean; error?: string } & Record<string, unknown>;
  try {
    json = await res.json();
  } catch {
    json = {};
  }

  if (!res.ok || json.success === false) {
    const message = json.error || `PO shipment request failed (${res.status}).`;
    // eslint-disable-next-line no-console
    console.error(`[PoShipment] action="${action}" FAILED:`, message, body);
    throw new Error(message);
  }

  return json as T;
}

export async function fetchPoShipment(
  poName: string,
): Promise<PoShipmentRecord | null> {
  const res = await callPoShipmentApi<{ success?: boolean; record?: PoShipmentRecord | null }>(
    "get",
    { po_name: poName },
  );
  return res.record ?? null;
}

export async function listPoShipmentsForPos(
  poNames: string[],
): Promise<PoShipmentRecord[]> {
  if (poNames.length === 0) return [];
  const res = await callPoShipmentApi<{ success?: boolean; records?: PoShipmentRecord[] }>(
    "list",
    { po_names: poNames, limit: Math.min(Math.max(poNames.length, 50), 500) },
  );
  return Array.isArray(res.records) ? res.records : [];
}

/** Warehouse Receive Goods — shipment-driven ready queue. */
export async function listReadyForGrnShipments(
  limit = 200,
): Promise<PoShipmentRecord[]> {
  const res = await callPoShipmentApi<{ success?: boolean; records?: PoShipmentRecord[] }>(
    "list-ready",
    { limit },
  );
  const records = Array.isArray(res.records) ? res.records : [];
  // eslint-disable-next-line no-console
  console.log("[PoShipment] list-ready count:", records.length, records.map((r) => r.po_name));
  return records;
}

export async function upsertPoShipmentRemote(
  state: PODeliveryState & { supplier?: string; dispatch_date?: string },
): Promise<PoShipmentRecord> {
  // eslint-disable-next-line no-console
  console.log("[PoShipment] upsert request", {
    po_name: state.po_name,
    shipment_status: state.status,
    vehicle_number: state.vehicle_number,
    tracking_number: state.tracking_number,
    expected_delivery_date: state.expected_delivery_date,
    dispatch_date: state.dispatch_date,
    // Do NOT send display-name as Supplier Link — server resolves from PO.
  });

  // Client-side guard: convert ISO-8601 → ERPNext formats before POST.
  // Backend also sanitizes — this stops bad values leaving the browser.
  const dates = sanitizePoShipmentDates({
    supplier_acceptance_date: state.supplier_acceptance_date,
    rejected_date: state.rejected_date,
    dispatch_date: state.dispatch_date,
    expected_delivery_date: state.expected_delivery_date,
  });

  const res = await callPoShipmentApi<{ success?: boolean; record: PoShipmentRecord }>(
    "upsert",
    {
      po_name: state.po_name,
      // Never send display labels as Supplier Link — server uses PO.supplier.
      shipment_status: state.status,
      supplier_accepted: state.supplier_accepted,
      supplier_acceptance_date: dates.supplier_acceptance_date,
      rejection_reason: state.rejection_reason,
      rejected_date: dates.rejected_date,
      expected_delivery_date: dates.expected_delivery_date,
      vehicle_number: state.vehicle_number,
      tracking_number: state.tracking_number,
      shipping_notes: state.shipping_notes,
      dispatch_date: dates.dispatch_date,
      updated_by: state.updated_by,
    },
  );

  // eslint-disable-next-line no-console
  console.log("[PoShipment] upsert response", {
    po_name: res.record?.po_name,
    shipment_status: res.record?.shipment_status,
    ready_for_grn: res.record?.ready_for_grn,
    warehouse_visible: res.record?.warehouse_visible,
  });
  return res.record;
}

/** Map ERP shipment row → local PODeliveryState shape used by the portal. */
export function shipmentRecordToDeliveryState(
  record: PoShipmentRecord,
): PODeliveryState {
  return {
    po_name: record.po_name,
    status: record.shipment_status,
    supplier_accepted: Boolean(record.supplier_accepted),
    supplier_acceptance_date: record.supplier_acceptance_date,
    rejection_reason: record.rejection_reason,
    rejected_date: record.rejected_date,
    expected_delivery_date: record.expected_delivery_date,
    vehicle_number: record.vehicle_number,
    tracking_number: record.tracking_number,
    shipping_notes: record.shipping_notes,
    dispatch_date: record.dispatch_date,
    created_at: record.supplier_acceptance_date || record.modified || new Date().toISOString(),
    updated_at: record.modified || new Date().toISOString(),
    updated_by: record.updated_by,
  };
}
