import type { ClmData, ClmRecord, ClmSupplierWorkflow } from "../src/types/clm.js";
import type { AccessPrincipal } from "./rbacAuth.js";
import { ClmError, clmStatus, rfqClmFinanceApproved, type ClmDeps } from "./clmCore.js";
import { currentClmPdfEvidence, type ClmPdfEvidence } from "./clmPdfEvidence.js";
import { getPurchaseOrderContract, verifyPurchaseOrderContractLink } from "./clmPurchaseOrderLink.js";
import { supplierOwnsProcurementDocument } from "./procurementReadScope.js";

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const object = (value: unknown): ClmRecord => value && typeof value === "object" && !Array.isArray(value) ? value as ClmRecord : {};
const time = (value: unknown) => Date.parse(text(value).replace(" ", "T"));
const same = (a: unknown, b: unknown) => !!text(a) && text(a).replace(/^(["'])(.*)\1$/, "$2").toLowerCase() === text(b).replace(/^(["'])(.*)\1$/, "$2").toLowerCase();

export function clmSupplierPoName(record: ClmRecord, data: ClmData): string {
  return text(record.custom_rfq) ? text(object(data.procurement_completion).purchase_order || object(data.procurement_order).purchase_order || record.custom_purchase_order) : "";
}

/** Pure projection of independently persisted supplier acceptance and signature. */
export function clmSupplierPoWorkflow(record: ClmRecord, data: ClmData, principal?: AccessPrincipal): ClmSupplierWorkflow | undefined {
  const po = clmSupplierPoName(record, data);
  if (!po) return undefined;
  const version = text(record.custom_current_version), legal = data.signatures.find(row => row.party === "inteva"), receipt = data.supplier_po_acceptance;
  const signature = data.signatures.find(row => row.party === "supplier");
  let pdf: ClmPdfEvidence | undefined;
  let failure = "";
  try { pdf = currentClmPdfEvidence(record, data); }
  catch { failure = "The current Contract PDF evidence could not be verified. Contact Procurement Team."; }
  const supplier = text(record.custom_supplier || record.party_name), owned = !principal || principal.typ === "supplier" && same(principal.supplier, supplier);
  const accepted = !!receipt && receipt.status === "Accepted" && receipt.consent === true && !!text(receipt.id) && receipt.contract === record.name && receipt.purchase_order === po &&
    receipt.supplier === supplier && !!text(receipt.by) && receipt.version === version && Number.isFinite(time(receipt.at)) && !!legal &&
    receipt.file_id === legal.file_id && receipt.file_url === legal.file_url && receipt.hash === legal.hash && time(receipt.at) >= time(legal.at);
  const signed = accepted && !!signature && signature.version === version && signature.acceptance_id === receipt.id && signature.source_file_id === receipt.file_id && signature.source_hash === receipt.hash &&
    (signature.contract_id === undefined || signature.contract_id === receipt.contract) && (signature.purchase_order_id === undefined || signature.purchase_order_id === receipt.purchase_order) &&
    (signature.supplier_id === undefined || signature.supplier_id === receipt.supplier) &&
    !!text(signature.by) && !!text(signature.typed_name) && !!text(signature.full_legal_name) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(signature.signer_email)) &&
    Number.isFinite(time(signature.at)) && time(signature.at) >= time(receipt.at) && pdf?.file_id === signature.file_id && pdf.hash === signature.hash;
  const ready = !failure && !data.termination && Number(record.docstatus) !== 2 && ["Active", "Executed"].includes(clmStatus("Contract", record)) &&
    !!object(data.procurement_completion).purchase_order && rfqClmFinanceApproved(record, data) && !!legal && legal.version === version && !!pdf;
  if (signature && !signed && !failure) failure = "A supplier signature already exists without this version's preceding acceptance receipt. Procurement must review the preserved evidence; it will not be replaced or fabricated.";
  if (receipt && !accepted && !failure) failure = "The saved supplier acceptance does not match this Contract version and approved document. Contact Procurement Team.";
  if (!ready && !failure) {
    if (data.termination) failure = "This Contract has been terminated. Purchase Order acceptance is blocked.";
    else if (Number(record.docstatus) === 2) failure = "This Contract has been cancelled. Purchase Order acceptance is blocked.";
    else if (!["Active", "Executed"].includes(clmStatus("Contract", record))) failure = `The Contract status is ${clmStatus("Contract", record)}; it must be Active before supplier acceptance.`;
    else if (!legal || legal.version !== version) failure = "The Legal Manager signature on the current Contract version must be completed before supplier acceptance.";
    else if (!rfqClmFinanceApproved(record, data)) {
      const finance = data.approvals?.find(row => row.role === "finance" && row.stage === 1 && row.status === "Approved" && row.by);
      if (!finance) failure = "Mandatory Finance approval on the Contract must be completed before supplier acceptance.";
      else failure = "The submitted Purchase Order and completed Legal/Finance Contract approvals must be verified before supplier acceptance.";
    } else if (!object(data.procurement_completion).purchase_order) failure = "The Purchase Order must be submitted and linked to this Contract before supplier acceptance.";
    else failure = "The submitted Purchase Order and completed Legal/Finance Contract approvals must be verified before supplier acceptance.";
  }
  const stage = !accepted ? "Contract Acceptance" : !signed ? "E-Signature" : "Purchase Order Acceptance";
  return { purchase_order: po, acceptance_status: accepted ? "Accepted" : "Pending", signature_status: signed ? "Signed" : "Pending",
    status: !accepted ? "Supplier Contract Acceptance Required" : !signed ? "Pending Supplier Signature" : "Purchase Order Acceptance Required", current_stage: stage,
    next_stage: !accepted ? "Supplier E-Signature" : !signed ? "Purchase Order Acceptance" : "Existing PO Processing", responsible_role: "supplier", responsible: "Supplier",
    can_accept_contract: owned && ready && !failure && !accepted, can_sign_contract: owned && ready && !failure && accepted && !signature, can_accept_po: owned && ready && !failure && signed,
    version, ...(pdf ? { document_file_id: pdf.file_id, document_hash: pdf.hash } : {}), ...(accepted ? { accepted_at: receipt.at } : {}), ...(signed ? { signed_at: signature.at } : {}), ...(failure ? { blocked_reason: failure } : {}),
  };
}

export interface ClmSupplierPoDeps extends Pick<ClmDeps, "load"> {
  verifyPdf(contract: ClmRecord, evidence: { file_id?: string; file_url: string; hash?: string }): Promise<unknown>;
}

/** Complete the display from the real PO Shipment; no Contract mirrors or writes. */
export async function getClmSupplierPoWorkflow(record: ClmRecord, data: ClmData, principal: AccessPrincipal, deps: Pick<ClmDeps, "load"> & Partial<Pick<ClmDeps, "list">>): Promise<ClmSupplierWorkflow | undefined> {
  const workflow = clmSupplierPoWorkflow(record, data, principal);
  if (!workflow) return undefined;
  if (!deps.list) return workflow;
  const order = await deps.load("Purchase Order", workflow.purchase_order);
  if (principal.typ === "supplier" && !supplierOwnsProcurementDocument("Purchase Order", order, principal.supplier)) throw new ClmError("Supplier access is restricted to your Purchase Orders.", 403);
  await verifyPurchaseOrderContractLink(order, record, deps);
  // A receipt cannot grant acceptance through a supplier display name, a
  // missing Link value, or another PO. Keep the verified Contract readable
  // when an old, incomplete shipment row exists; it is not acceptance evidence.
  const candidates = await deps.list("PO Shipment", [["po_name", "=", workflow.purchase_order], ["supplier", "=", order.supplier]]);
  const shipments = candidates.filter(row => row.po_name === workflow.purchase_order && row.supplier === order.supplier);
  if (shipments.length > 1) throw new ClmError("Multiple supplier acceptance records exist for this Purchase Order. Contact Procurement Team.", 409);
  const shipment = shipments[0];
  const shipmentStatus = text(shipment?.shipment_status);
  const accepted = workflow.signature_status === "Signed" && !!shipment && Number(shipment.supplier_accepted) === 1 &&
    ["Accepted", "In Transit", "Delivered", "Arrived", "Partially Received", "Completed"].includes(shipmentStatus) &&
    Number.isFinite(time(shipment.supplier_acceptance_date)) && time(shipment.supplier_acceptance_date) >= time(workflow.signed_at);
  const current = { ...workflow, po_acceptance_status: accepted ? "Accepted" as const : "Pending" as const, ...(shipmentStatus ? { shipment_status: shipmentStatus } : {}) };
  if (!accepted) return current;
  const completed = shipmentStatus === "Completed";
  return { ...current, po_accepted_at: text(shipment!.supplier_acceptance_date), can_accept_po: false,
    status: completed ? "Completed" : "Purchase Order Accepted", current_stage: completed ? "Completed" : "Existing PO Processing", next_stage: completed ? "—" : "Completed",
    ...(completed ? { responsible_role: "" as const, responsible: "None / Completed" as const } : {}) };
}

/** Mutation preflight for either Contract supplier action, bound to the real PO. */
export async function verifyClmSupplierPoSource(principal: AccessPrincipal, record: ClmRecord, data: ClmData, deps: Pick<ClmDeps, "load">) {
  const name = clmSupplierPoName(record, data);
  if (!name) throw new ClmError("The Contract has no submitted Purchase Order for supplier acceptance.", 409);
  const summary = await getPurchaseOrderContract(principal, name, deps);
  const order = await deps.load("Purchase Order", name);
  if (summary.contract?.name !== record.name || Number(order.docstatus) !== 1 || ["Cancelled", "Closed"].includes(text(order.status))) throw new ClmError("The Contract's submitted Purchase Order could not be verified.", 409);
  return order;
}

/** No-CLM POs retain their existing flow. A linked PO cannot bypass this sequence. */
export async function assertClmSupplierPoReady(principal: AccessPrincipal, poName: string, deps: ClmSupplierPoDeps): Promise<{ supplierSignedAt: string } | undefined> {
  const order = await deps.load("Purchase Order", poName);
  if (order.name !== poName || principal.typ === "supplier" && !supplierOwnsProcurementDocument("Purchase Order", order, principal.supplier)) throw new ClmError("You cannot act on this Purchase Order.", 403);
  if (!text(order.custom_clm_contract)) return;
  const record = await deps.load("Contract", text(order.custom_clm_contract));
  const { data } = await verifyPurchaseOrderContractLink(order, record, deps);
  const workflow = clmSupplierPoWorkflow(record, data);
  if (!workflow?.can_accept_po || workflow.purchase_order !== poName) throw new ClmError(workflow?.blocked_reason || "Accept the linked Contract and complete the Supplier E-Signature before accepting this Purchase Order.", 409);
  if (Number(order.docstatus) !== 1 || ["Cancelled", "Closed"].includes(text(order.status))) throw new ClmError("The submitted Contract Purchase Order could not be verified.", 409);
  const pdf = currentClmPdfEvidence(record, data)!;
  await deps.verifyPdf(record, data.supplier_po_acceptance!);
  await deps.verifyPdf(record, pdf);
  return { supplierSignedAt: workflow.signed_at! };
}
