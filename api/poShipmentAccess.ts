import { ClmError } from "./clmCore.js";
import { clmErpRequest, clmResource } from "./clmErp.js";
import { readClmPdf } from "./clmSignature.js";
import { clmNow } from "./clmTime.js";
import { assertClmSupplierPoReady } from "./clmSupplierPoWorkflow.js";
import { supplierOwnsProcurementDocument } from "./procurementReadScope.js";
import {
  getPoShipment, listPoShipments, listReadyForGrnShipments, upsertPoShipment,
  PoShipmentError, SHIPMENT_STATUS,
  type PoShipmentRecord, type UpsertPoShipmentInput,
} from "./poShipmentCore.js";
import { requireRoles, RbacError, type AccessPrincipal, type AppRole } from "./rbacAuth.js";
import type { ClmRecord } from "../src/types/clm.js";

const READ_ROLES: AppRole[] = ["admin", "procurement", "procurement_team", "warehouse", "finance", "finance_executive"];
const WRITE_ROLES: AppRole[] = ["admin", "procurement", "procurement_team", "warehouse"];
const acceptedStatuses = new Set<string>(Object.values(SHIPMENT_STATUS).filter(status =>
  status !== SHIPMENT_STATUS.PENDING_ACCEPTANCE && status !== SHIPMENT_STATUS.REJECTED));

export interface PoShipmentAccessDeps {
  loadOrder(name: string): Promise<ClmRecord>;
  assertClmReady(principal: AccessPrincipal, name: string): Promise<{ supplierSignedAt: string } | void>;
  get: typeof getPoShipment;
  list: typeof listPoShipments;
  listReady: typeof listReadyForGrnShipments;
  upsert: typeof upsertPoShipment;
  now(): string;
}

export function createPoShipmentAccessDeps(): PoShipmentAccessDeps {
  return {
    loadOrder: name => clmErpRequest("GET", clmResource("Purchase Order", name)),
    assertClmReady: (principal, name) => assertClmSupplierPoReady(principal, name, {
      load: (doctype, id) => clmErpRequest("GET", clmResource(doctype, id)),
      verifyPdf: readClmPdf,
    }),
    get: getPoShipment, list: listPoShipments, listReady: listReadyForGrnShipments,
    upsert: upsertPoShipment, now: clmNow,
  };
}

/** The production and local adapters use this same authenticated boundary. */
export async function handlePoShipmentAction(
  principal: AccessPrincipal, action: string, body: Record<string, unknown>,
  deps: PoShipmentAccessDeps = createPoShipmentAccessDeps(),
): Promise<{ success: true; record?: PoShipmentRecord | null; records?: PoShipmentRecord[] }> {
  if (principal.typ === "internal") requireRoles(principal, action === "upsert" ? WRITE_ROLES : READ_ROLES);
  const loadOwnedOrder = async (name: string) => {
    if (!name) throw new PoShipmentError("po_name is required.", 400);
    const order = await deps.loadOrder(name);
    if (order.name !== name) throw new PoShipmentError("The Purchase Order could not be verified.", 409);
    if (principal.typ === "supplier" && !supplierOwnsProcurementDocument("Purchase Order", order, principal.supplier)) {
      throw new RbacError("Supplier access is restricted to your Purchase Orders.", 403);
    }
    return order;
  };
  if (action === "get") {
    const name = String(body.po_name ?? "").trim();
    await loadOwnedOrder(name);
    return { success: true, record: await deps.get(name) };
  }
  if (action === "list" || action === "list-ready") {
    const names = Array.isArray(body.po_names) ? [...new Set(body.po_names.map(String).map(name => name.trim()).filter(Boolean))] : undefined;
    if (principal.typ === "supplier" && names) await Promise.all(names.map(loadOwnedOrder));
    const records = action === "list-ready" ? await deps.listReady(typeof body.limit === "number" ? body.limit : 200) : await deps.list({
      poNames: names,
      statuses: Array.isArray(body.statuses) ? body.statuses.map(String) : undefined,
      readyForGrn: body.ready_for_grn === true, warehouseVisible: body.warehouse_visible === true,
      limit: typeof body.limit === "number" ? body.limit : undefined,
    });
    if (principal.typ !== "supplier") return { success: true, records };
    // Never trust the Shipment's supplier hint or caller-provided list filters.
    const owned = await Promise.all(records.map(async record => {
      const order = await deps.loadOrder(record.po_name);
      return order.name === record.po_name && supplierOwnsProcurementDocument("Purchase Order", order, principal.supplier) ? record : null;
    }));
    return { success: true, records: owned.filter((record): record is PoShipmentRecord => record !== null) };
  }
  if (action !== "upsert") throw new PoShipmentError(`Unknown po-shipment action: ${action}`, 404);

  const name = String(body.po_name ?? "").trim();
  const status = String(body.shipment_status ?? "");
  if (!Object.values(SHIPMENT_STATUS).includes(status as UpsertPoShipmentInput["shipment_status"])) {
    throw new PoShipmentError("A valid shipment_status is required.", 400);
  }
  const order = await loadOwnedOrder(name);
  const linkedClm = !!String(order.custom_clm_contract ?? "").trim();
  const acceptedFlag = body.supplier_accepted === true || Number(body.supplier_accepted) === 1;
  if (linkedClm && !acceptedStatuses.has(status) && acceptedFlag) {
    throw new ClmError("Pending or rejected Purchase Orders cannot be marked supplier accepted. Refresh the Purchase Order before retrying.", 409);
  }
  const accepted = acceptedStatuses.has(status) || acceptedFlag;
  let evidence: { supplierSignedAt: string } | void;
  if (accepted) {
    // Verify saved current-version contract acceptance, signature receipts and
    // actual PDF bytes BEFORE schema setup or any PO Shipment write can occur.
    // The helper deliberately leaves ordinary, non-CLM POs unchanged.
    evidence = await deps.assertClmReady(principal, name);
  }
  const existing = await deps.get(name);
  const signedAt = evidence?.supplierSignedAt ? Date.parse(evidence.supplierSignedAt.replace(" ", "T")) : undefined;
  const acceptedAt = Date.parse(String(existing?.supplier_acceptance_date ?? "").replace(" ", "T"));
  const priorAcceptanceValid = linkedClm
    ? Number(existing?.supplier_accepted) === 1 && acceptedStatuses.has(String(existing?.shipment_status)) && Number.isFinite(acceptedAt) && (signedAt === undefined || acceptedAt >= signedAt)
    : !!existing?.supplier_accepted;
  if (linkedClm && existing && (
    priorAcceptanceValid && !acceptedStatuses.has(status) ||
    status === SHIPMENT_STATUS.ACCEPTED && acceptedStatuses.has(existing.shipment_status) && existing.shipment_status !== SHIPMENT_STATUS.ACCEPTED
  )) {
    throw new ClmError(`This Purchase Order is already ${existing.shipment_status}. Refresh before retrying; its saved shipment progress has not been changed.`, 409);
  }
  if (linkedClm && accepted && !priorAcceptanceValid && (principal.typ !== "supplier" || status !== SHIPMENT_STATUS.ACCEPTED)) {
    throw new RbacError("The supplier must accept this Purchase Order before shipment processing.", 403);
  }
  const actor = principal.typ === "supplier" ? principal.sub : principal.email || principal.sub;
  const timestamp = deps.now();
  const input: UpsertPoShipmentInput = {
    ...(body as unknown as UpsertPoShipmentInput), po_name: name,
    shipment_status: status as UpsertPoShipmentInput["shipment_status"], supplier_accepted: accepted,
    supplier: String(order.supplier ?? ""), updated_by: actor,
    supplier_acceptance_date: accepted ? priorAcceptanceValid && existing?.supplier_acceptance_date || timestamp : undefined,
    rejected_date: status === SHIPMENT_STATUS.REJECTED ? existing?.rejected_date || timestamp : undefined,
    dispatch_date: status === SHIPMENT_STATUS.IN_TRANSIT ? existing?.dispatch_date || timestamp : existing?.dispatch_date,
  };
  await deps.upsert(input);
  // A projected request/response merge is not evidence of ERP persistence.
  const stored = await deps.get(name);
  if (!stored?.name || stored.po_name !== name || !input.supplier || stored.supplier !== input.supplier || stored.shipment_status !== status || Number(stored.supplier_accepted) !== Number(accepted) ||
      stored.updated_by !== actor || accepted && stored.supplier_acceptance_date !== input.supplier_acceptance_date) {
    throw new ClmError("ERPNext did not confirm the saved Purchase Order shipment state. Refresh the Purchase Order to verify its status before retrying.", 409);
  }
  return { success: true, record: stored };
}
