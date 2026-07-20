/**
 * PO Shipment — server-owned single source of truth for Supplier → Warehouse
 * logistics (vehicle, tracking, ETA, shipment status).
 *
 * Both adapters share this module:
 *   - api/po-shipment.ts          (Vercel)
 *   - vite.config.ts middleware   (local dev)
 *
 * Storage: ERPNext DocType "PO Shipment" (one row per Purchase Order).
 * localStorage on the client is only a cache — never the cross-role SSoT.
 */
import { sanitizeErpPayloadDates } from "./erpDateSanitize.js";
import {
  formatERPNextDate,
  formatERPNextDatetime,
  sanitizePoShipmentDates,
} from "../src/utils/erpNextDate.js";

export const PO_SHIPMENT_DOCTYPE = "PO Shipment";

export const SHIPMENT_STATUS = {
  PENDING_ACCEPTANCE: "Pending Acceptance",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  IN_TRANSIT: "In Transit",
  DELIVERED: "Delivered",
  ARRIVED: "Arrived",
  PARTIALLY_RECEIVED: "Partially Received",
  COMPLETED: "Completed",
} as const;

export type ShipmentStatus =
  (typeof SHIPMENT_STATUS)[keyof typeof SHIPMENT_STATUS];

/** Statuses that unlock Warehouse Receive Goods / GRN creation. */
export const READY_FOR_GRN_STATUSES: readonly ShipmentStatus[] = [
  SHIPMENT_STATUS.IN_TRANSIT,
  SHIPMENT_STATUS.DELIVERED,
  SHIPMENT_STATUS.ARRIVED,
  SHIPMENT_STATUS.PARTIALLY_RECEIVED,
];

export interface PoShipmentRecord {
  name?: string;
  po_name: string;
  supplier?: string;
  shipment_status: ShipmentStatus;
  supplier_status?: string;
  supplier_accepted: 0 | 1;
  supplier_acceptance_date?: string;
  rejection_reason?: string;
  rejected_date?: string;
  expected_delivery_date?: string;
  vehicle_number?: string;
  tracking_number?: string;
  shipping_notes?: string;
  dispatch_date?: string;
  ready_for_grn?: 0 | 1;
  warehouse_visible?: 0 | 1;
  updated_by?: string;
  modified?: string;
}

export interface UpsertPoShipmentInput {
  po_name: string;
  /** Optional hint only — server always prefers Purchase Order.supplier. */
  supplier?: string;
  shipment_status: ShipmentStatus;
  supplier_accepted?: boolean;
  supplier_acceptance_date?: string;
  rejection_reason?: string;
  rejected_date?: string;
  expected_delivery_date?: string;
  vehicle_number?: string;
  tracking_number?: string;
  shipping_notes?: string;
  dispatch_date?: string;
  updated_by?: string;
}

export interface ErpAdminConfig {
  baseUrl: string;
  key: string;
  secret: string;
}

export class PoShipmentError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "PoShipmentError";
    this.status = status;
  }
}

export function readErpAdminConfig(): ErpAdminConfig {
  const baseUrl = (
    process.env.ERPNEXT_URL ??
    process.env.VITE_PROXY_TARGET ??
    process.env.VITE_ERPNEXT_URL ??
    ""
  )
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api$/, "");

  const key = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
  const secret = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";

  if (!baseUrl || !key || !secret) {
    throw new PoShipmentError(
      "PO Shipment backend misconfigured: missing ERPNEXT_URL / ERP_API_KEY / ERP_API_SECRET.",
      500,
    );
  }
  return { baseUrl, key, secret };
}

async function erpFetch<T = unknown>(
  cfg: ErpAdminConfig,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(`${cfg.baseUrl}/api/${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `token ${cfg.key}:${cfg.secret}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body:
      init?.body !== undefined
        ? JSON.stringify(sanitizeErpPayloadDates(init.body))
        : undefined,
  });

  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }

  if (!res.ok) {
    const data = (json ?? {}) as {
      exception?: string;
      exc_type?: string;
      _server_messages?: string;
    };
    let friendly = data.exception ?? data.exc_type ?? text ?? "ERPNext request failed";
    if (data._server_messages) {
      try {
        const parsed = JSON.parse(data._server_messages) as string[];
        const first = parsed[0] ? JSON.parse(parsed[0]) : null;
        if (first?.message) friendly = first.message;
      } catch {
        /* keep */
      }
    }
    throw new PoShipmentError(String(friendly), res.status);
  }

  return (json as { data?: T })?.data ?? (json as T);
}

const LIST_FIELDS = [
  "name",
  "po_name",
  "supplier",
  "shipment_status",
  "supplier_status",
  "supplier_accepted",
  "supplier_acceptance_date",
  "rejection_reason",
  "rejected_date",
  "expected_delivery_date",
  "vehicle_number",
  "tracking_number",
  "shipping_notes",
  "dispatch_date",
  "ready_for_grn",
  "warehouse_visible",
  "updated_by",
  "modified",
] as const;

const EXTRA_FIELDS: Array<Record<string, unknown>> = [
  {
    fieldname: "supplier_status",
    label: "Supplier Status",
    fieldtype: "Data",
    in_list_view: 0,
  },
  {
    fieldname: "ready_for_grn",
    label: "Ready for GRN",
    fieldtype: "Check",
    default: "0",
    in_list_view: 1,
  },
  {
    fieldname: "warehouse_visible",
    label: "Warehouse Visible",
    fieldtype: "Check",
    default: "0",
    in_list_view: 1,
  },
];

let schemaEnsurePromise: Promise<void> | null = null;

function statusOptionsString(): string {
  return Object.values(SHIPMENT_STATUS).join("\n");
}

function isReadyForGrnStatus(status: string): boolean {
  return (READY_FOR_GRN_STATUSES as readonly string[]).includes(status);
}

function deriveSupplierStatus(status: ShipmentStatus, _accepted?: boolean): string {
  if (status === SHIPMENT_STATUS.REJECTED) return "Rejected";
  if (status === SHIPMENT_STATUS.PENDING_ACCEPTANCE) return "Pending";
  // Remaining ShipmentStatus values are post-acceptance. Historically this was
  // `accepted || status !== PENDING_ACCEPTANCE`, which is always true after the
  // pending early-return (the trailing "Pending" return was unreachable).
  return "Accepted";
}

async function doctypeExists(cfg: ErpAdminConfig): Promise<boolean> {
  try {
    await erpFetch(cfg, `resource/DocType/${encodeURIComponent(PO_SHIPMENT_DOCTYPE)}`);
    return true;
  } catch {
    return false;
  }
}

async function createPoShipmentDocType(cfg: ErpAdminConfig): Promise<void> {
  await erpFetch(cfg, "resource/DocType", {
    method: "POST",
    body: {
      doctype: "DocType",
      name: PO_SHIPMENT_DOCTYPE,
      module: "Buying",
      custom: 1,
      istable: 0,
      editable_grid: 0,
      track_changes: 1,
      autoname: "hash",
      fields: [
        {
          fieldname: "po_name",
          label: "Purchase Order",
          fieldtype: "Link",
          options: "Purchase Order",
          reqd: 1,
          unique: 1,
          in_list_view: 1,
        },
        {
          fieldname: "supplier",
          label: "Supplier",
          fieldtype: "Link",
          options: "Supplier",
          in_list_view: 1,
        },
        {
          fieldname: "shipment_status",
          label: "Shipment Status",
          fieldtype: "Select",
          options: statusOptionsString(),
          reqd: 1,
          default: SHIPMENT_STATUS.PENDING_ACCEPTANCE,
          in_list_view: 1,
        },
        {
          fieldname: "supplier_status",
          label: "Supplier Status",
          fieldtype: "Data",
        },
        {
          fieldname: "supplier_accepted",
          label: "Supplier Accepted",
          fieldtype: "Check",
          default: "0",
        },
        {
          fieldname: "supplier_acceptance_date",
          label: "Supplier Acceptance Date",
          fieldtype: "Datetime",
        },
        {
          fieldname: "rejection_reason",
          label: "Rejection Reason",
          fieldtype: "Small Text",
        },
        {
          fieldname: "rejected_date",
          label: "Rejected Date",
          fieldtype: "Datetime",
        },
        {
          fieldname: "expected_delivery_date",
          label: "Expected Delivery Date",
          fieldtype: "Date",
          in_list_view: 1,
        },
        {
          fieldname: "vehicle_number",
          label: "Vehicle Number",
          fieldtype: "Data",
          in_list_view: 1,
        },
        {
          fieldname: "tracking_number",
          label: "Tracking Number",
          fieldtype: "Data",
          in_list_view: 1,
        },
        {
          fieldname: "shipping_notes",
          label: "Shipping Notes",
          fieldtype: "Small Text",
        },
        {
          fieldname: "dispatch_date",
          label: "Dispatch Date",
          fieldtype: "Datetime",
        },
        {
          fieldname: "ready_for_grn",
          label: "Ready for GRN",
          fieldtype: "Check",
          default: "0",
          in_list_view: 1,
        },
        {
          fieldname: "warehouse_visible",
          label: "Warehouse Visible",
          fieldtype: "Check",
          default: "0",
          in_list_view: 1,
        },
        {
          fieldname: "updated_by",
          label: "Updated By",
          fieldtype: "Data",
        },
      ],
      permissions: [
        { role: "System Manager", read: 1, write: 1, create: 1, delete: 1 },
        { role: "Purchase Manager", read: 1, write: 1, create: 1, delete: 0 },
        { role: "Purchase User", read: 1, write: 1, create: 1, delete: 0 },
        { role: "Stock User", read: 1, write: 0, create: 0, delete: 0 },
        { role: "Stock Manager", read: 1, write: 0, create: 0, delete: 0 },
      ],
    },
  });

  // eslint-disable-next-line no-console
  console.log(`[po-shipment] Created DocType "${PO_SHIPMENT_DOCTYPE}"`);
}

async function ensurePoShipmentSchemaOnce(cfg: ErpAdminConfig): Promise<void> {
  if (!(await doctypeExists(cfg))) {
    await createPoShipmentDocType(cfg);
    return;
  }

  const doc = await erpFetch<{
    name?: string;
    fields?: Array<Record<string, unknown>>;
  }>(cfg, `resource/DocType/${encodeURIComponent(PO_SHIPMENT_DOCTYPE)}`);

  const fields = Array.isArray(doc.fields) ? [...doc.fields] : [];
  const existingNames = new Set(
    fields.map((f) => String(f.fieldname ?? "")).filter(Boolean),
  );

  let modified = false;
  for (const required of EXTRA_FIELDS) {
    const fieldname = String(required.fieldname);
    if (existingNames.has(fieldname)) continue;
    fields.push({
      ...required,
      parent: PO_SHIPMENT_DOCTYPE,
      parentfield: "fields",
      parenttype: "DocType",
      doctype: "DocField",
    });
    existingNames.add(fieldname);
    modified = true;
    // eslint-disable-next-line no-console
    console.log(`[po-shipment] Adding missing DocType field: ${fieldname}`);
  }

  const statusField = fields.find((f) => f.fieldname === "shipment_status");
  const expectedOpts = statusOptionsString();
  if (statusField && String(statusField.options ?? "") !== expectedOpts) {
    statusField.options = expectedOpts;
    modified = true;
  }

  if (!modified) return;

  await erpFetch(cfg, `resource/DocType/${encodeURIComponent(PO_SHIPMENT_DOCTYPE)}`, {
    method: "PUT",
    body: { fields },
  });

  try {
    await erpFetch(cfg, "method/frappe.clear_cache", {
      method: "POST",
      body: {},
    });
  } catch {
    /* non-fatal */
  }

  // eslint-disable-next-line no-console
  console.log("[po-shipment] Schema updated (ready_for_grn / warehouse_visible / statuses)");
}

export async function ensurePoShipmentSchema(cfg?: ErpAdminConfig): Promise<void> {
  const admin = cfg ?? readErpAdminConfig();
  if (!schemaEnsurePromise) {
    schemaEnsurePromise = ensurePoShipmentSchemaOnce(admin).catch((err) => {
      schemaEnsurePromise = null;
      throw err;
    });
  }
  await schemaEnsurePromise;
}

async function findByPoName(
  cfg: ErpAdminConfig,
  poName: string,
): Promise<PoShipmentRecord | null> {
  const rows = await erpFetch<PoShipmentRecord[]>(
    cfg,
    `resource/${encodeURIComponent(PO_SHIPMENT_DOCTYPE)}?${new URLSearchParams({
      filters: JSON.stringify([["po_name", "=", poName]]),
      fields: JSON.stringify([...LIST_FIELDS]),
      limit_page_length: "1",
    }).toString()}`,
  );
  const list = Array.isArray(rows) ? rows : [];
  return list[0] ?? null;
}

/** Resolve the ERPNext Supplier Link from the Purchase Order (never display labels). */
async function resolveSupplierFromPo(
  cfg: ErpAdminConfig,
  poName: string,
  hint?: string,
): Promise<string | undefined> {
  try {
    const po = await erpFetch<{ supplier?: string; supplier_name?: string }>(
      cfg,
      `resource/Purchase%20Order/${encodeURIComponent(poName)}?${new URLSearchParams({
        fields: JSON.stringify(["name", "supplier", "supplier_name"]),
      }).toString()}`,
    );
    // Some legacy PO rows store Supplier.name wrapped in stray quotes.
    const fromPo = String(po?.supplier || "")
      .trim()
      .replace(/^"+|"+$/g, "")
      .trim();
    if (fromPo) return fromPo;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[po-shipment] Could not load PO for supplier resolve:", poName, err);
  }

  const candidate = String(hint || "").trim();
  if (!candidate) return undefined;

  try {
    await erpFetch(cfg, `resource/Supplier/${encodeURIComponent(candidate)}`);
    return candidate;
  } catch {
    // eslint-disable-next-line no-console
    console.warn(
      "[po-shipment] Ignoring invalid supplier Link hint (use PO.supplier):",
      candidate,
    );
    return undefined;
  }
}

export async function getPoShipment(poName: string): Promise<PoShipmentRecord | null> {
  const cfg = readErpAdminConfig();
  await ensurePoShipmentSchema(cfg);
  const name = String(poName || "").trim();
  if (!name) throw new PoShipmentError("po_name is required.", 400);
  return findByPoName(cfg, name);
}

export async function listPoShipments(input?: {
  poNames?: string[];
  statuses?: string[];
  readyForGrn?: boolean;
  warehouseVisible?: boolean;
  limit?: number;
}): Promise<PoShipmentRecord[]> {
  const cfg = readErpAdminConfig();
  await ensurePoShipmentSchema(cfg);

  const filters: unknown[] = [];
  const names = (input?.poNames ?? []).map((n) => String(n).trim()).filter(Boolean);
  if (names.length === 1) {
    filters.push(["po_name", "=", names[0]]);
  } else if (names.length > 1) {
    filters.push(["po_name", "in", names]);
  }

  const statuses = (input?.statuses ?? []).map((s) => String(s).trim()).filter(Boolean);
  if (statuses.length === 1) {
    filters.push(["shipment_status", "=", statuses[0]]);
  } else if (statuses.length > 1) {
    filters.push(["shipment_status", "in", statuses]);
  }

  if (input?.readyForGrn === true) {
    filters.push(["ready_for_grn", "=", 1]);
  }
  if (input?.warehouseVisible === true) {
    filters.push(["warehouse_visible", "=", 1]);
  }

  const limit = Math.min(Math.max(input?.limit ?? 200, 1), 500);
  const rows = await erpFetch<PoShipmentRecord[]>(
    cfg,
    `resource/${encodeURIComponent(PO_SHIPMENT_DOCTYPE)}?${new URLSearchParams({
      filters: JSON.stringify(filters),
      fields: JSON.stringify([...LIST_FIELDS]),
      limit_page_length: String(limit),
      order_by: "modified desc",
    }).toString()}`,
  );

  const list = Array.isArray(rows) ? rows : [];
  // eslint-disable-next-line no-console
  console.log("[po-shipment] list", {
    filters,
    count: list.length,
    ready_for_grn: input?.readyForGrn,
    statuses,
  });
  return list;
}

/**
 * Warehouse Receive Goods queue source.
 * Status is authoritative; ready_for_grn=0 explicitly blocks (e.g. rolled back).
 * Legacy rows without the Check field still qualify by status alone.
 */
export async function listReadyForGrnShipments(limit = 200): Promise<PoShipmentRecord[]> {
  const rows = await listPoShipments({
    statuses: [...READY_FOR_GRN_STATUSES],
    limit,
  });
  return rows.filter((r) => r.ready_for_grn !== 0);
}

export async function upsertPoShipment(
  input: UpsertPoShipmentInput,
): Promise<PoShipmentRecord> {
  const cfg = readErpAdminConfig();
  await ensurePoShipmentSchema(cfg);

  const poName = String(input.po_name || "").trim();
  if (!poName) throw new PoShipmentError("po_name is required.", 400);
  if (!input.shipment_status) {
    throw new PoShipmentError("shipment_status is required.", 400);
  }

  const ready = isReadyForGrnStatus(input.shipment_status);
  const accepted =
    input.supplier_accepted === true ||
    input.shipment_status === SHIPMENT_STATUS.ACCEPTED ||
    ready ||
    input.shipment_status === SHIPMENT_STATUS.COMPLETED;
  const warehouseVisible =
    accepted || ready || input.shipment_status === SHIPMENT_STATUS.ACCEPTED;

  const supplierLink = await resolveSupplierFromPo(cfg, poName, input.supplier);

  // Convert ISO-8601 → ERPNext MariaDB-safe formats BEFORE any DB write.
  // Datetime: YYYY-MM-DD HH:mm:ss  |  Date: YYYY-MM-DD
  // Never persist values containing T / milliseconds / Z.
  const dates = sanitizePoShipmentDates({
    supplier_acceptance_date: input.supplier_acceptance_date || undefined,
    rejected_date: input.rejected_date || undefined,
    dispatch_date: input.dispatch_date || undefined,
    expected_delivery_date:
      input.expected_delivery_date === undefined ||
      input.expected_delivery_date === null ||
      input.expected_delivery_date === ""
        ? undefined
        : input.expected_delivery_date,
  });

  const body: Record<string, unknown> = {
    po_name: poName,
    shipment_status: input.shipment_status,
    supplier_status: deriveSupplierStatus(input.shipment_status, accepted),
    supplier_accepted: accepted ? 1 : 0,
    ready_for_grn: ready ? 1 : 0,
    warehouse_visible: warehouseVisible ? 1 : 0,
  };
  if (supplierLink) body.supplier = supplierLink;
  if (dates.supplier_acceptance_date) {
    body.supplier_acceptance_date = dates.supplier_acceptance_date;
  }
  if (input.rejection_reason !== undefined) {
    body.rejection_reason = input.rejection_reason;
  }
  if (dates.rejected_date) body.rejected_date = dates.rejected_date;
  if (input.expected_delivery_date !== undefined) {
    body.expected_delivery_date = input.expected_delivery_date
      ? formatERPNextDate(input.expected_delivery_date)
      : null;
  }
  if (input.vehicle_number !== undefined) {
    body.vehicle_number = input.vehicle_number || "";
  }
  if (input.tracking_number !== undefined) {
    body.tracking_number = input.tracking_number || "";
  }
  if (input.shipping_notes !== undefined) {
    body.shipping_notes = input.shipping_notes || "";
  }
  if (input.dispatch_date !== undefined) {
    body.dispatch_date = input.dispatch_date
      ? formatERPNextDatetime(input.dispatch_date)
      : null;
  }
  if (input.updated_by) body.updated_by = input.updated_by;

  // eslint-disable-next-line no-console
  console.log("[po-shipment] upsert request", {
    po_name: poName,
    shipment_status: input.shipment_status,
    supplier: supplierLink ?? "(omit)",
    ready_for_grn: body.ready_for_grn,
    warehouse_visible: body.warehouse_visible,
    vehicle_number: input.vehicle_number,
    tracking_number: input.tracking_number,
    expected_delivery_date: body.expected_delivery_date,
    supplier_acceptance_date: body.supplier_acceptance_date,
    rejected_date: body.rejected_date,
    dispatch_date: body.dispatch_date,
  });

  const existing = await findByPoName(cfg, poName);

  const write = async (payload: Record<string, unknown>) => {
    if (existing?.name) {
      return erpFetch<PoShipmentRecord>(
        cfg,
        `resource/${encodeURIComponent(PO_SHIPMENT_DOCTYPE)}/${encodeURIComponent(existing.name)}`,
        { method: "PUT", body: payload },
      );
    }
    return erpFetch<PoShipmentRecord>(
      cfg,
      `resource/${encodeURIComponent(PO_SHIPMENT_DOCTYPE)}`,
      {
        method: "POST",
        body: {
          doctype: PO_SHIPMENT_DOCTYPE,
          ...payload,
        },
      },
    );
  };

  try {
    const saved = await write(body);
    // eslint-disable-next-line no-console
    console.log("[po-shipment] upsert OK", {
      po_name: poName,
      name: saved?.name ?? existing?.name,
      shipment_status: input.shipment_status,
      ready_for_grn: body.ready_for_grn,
    });
    return {
      ...existing,
      ...saved,
      ...body,
      name: saved?.name ?? existing?.name,
    } as PoShipmentRecord;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Retry without supplier Link if validation failed (bad hint / renamed supplier).
    if (body.supplier && /Could not find Supplier/i.test(message)) {
      // eslint-disable-next-line no-console
      console.warn("[po-shipment] Retrying upsert without supplier Link:", message);
      const { supplier: _drop, ...withoutSupplier } = body;
      const saved = await write(withoutSupplier);
      return {
        ...existing,
        ...saved,
        ...withoutSupplier,
        name: saved?.name ?? existing?.name,
      } as PoShipmentRecord;
    }
    throw err;
  }
}

/** Stamp dispatch datetime in ERPNext format when marking In Transit. */
export function nowErpDatetime(): string {
  return formatERPNextDatetime(new Date()) ?? "";
}
