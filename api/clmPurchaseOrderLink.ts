import type { ClmAction, ClmRecord, ClmSupplierWorkflow } from "../src/types/clm.js";
import { getClmSupplierPoWorkflow } from "./clmSupplierPoWorkflow.js";
import { canReadClm, ClmError, clmStatus, parseClmData, toClmAggregate, type ClmDeps } from "./clmCore.js";
import { currentClmPdfEvidence } from "./clmPdfEvidence.js";
import { clmPurchaseOrderKey } from "./clmPurchaseOrder.js";
import { supplierOwnsProcurementDocument } from "./procurementReadScope.js";
import type { AccessPrincipal } from "./rbacAuth.js";
import { rfqClmLifecycleView } from "../src/utils/rfqClmWorkflow.js";

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const rows = (value: unknown): ClmRecord[] => Array.isArray(value) ? value as ClmRecord[] : [];
function object(value: unknown): ClmRecord {
  if (typeof value === "string") {
    try { value = JSON.parse(value); }
    catch { throw new ClmError("The saved Purchase Order Contract linkage could not be verified. Contact Procurement Team.", 409); }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as ClmRecord : {};
}

export interface PurchaseOrderContractSummary {
  name: string; status: string; value: number | null; currency: string; start_date: string; end_date: string;
  supplier_id: string; supplier_name: string;
  rfq: string; award: string; quotation: string; current_version: string;
  workflow_status?: string; stage?: string; pdf_available: boolean;
  pdf?: { file_id: string; version: string; hash: string; kind: "locked" | "signed" };
  signature_workflow: { supplier_status: "Pending" | "Signed"; legal_status: "Pending" | "Signed"; can_sign: boolean; can_review: boolean };
  actions: ClmAction[];
  supplier_workflow?: ClmSupplierWorkflow;
}
export interface PurchaseOrderContractResult { purchase_order: string; contract: PurchaseOrderContractSummary | null }

/** Internal relationship check, shared by authenticated reads and PO mutation gates. */
export async function verifyPurchaseOrderContractLink(order: ClmRecord, contract: ClmRecord, deps: Pick<ClmDeps, "load">) {
  const name = text(order.name), contractName = text(contract.name);
  if (!name || !contractName || order.custom_clm_contract !== contractName) throw new ClmError("The Purchase Order Contract reference could not be verified.", 409);
  const invalid = () => new ClmError("The Purchase Order's Contract, RFQ, award and winning quotation links do not match. Contact Procurement Team; the saved records have not been changed.", 409);
  const data = parseClmData(contract.custom_clm_data), context = object(data.rfq_context);
  const reverseLinks = [contract.custom_purchase_order, object(data.procurement_order).purchase_order, object(data.procurement_completion).purchase_order].map(text).filter(Boolean);
  const rfqName = text(order.custom_clm_rfq), awardName = text(order.custom_clm_award), quotationName = text(contract.custom_supplier_quotation);
  const supplier = text(contract.custom_supplier || contract.party_name);
  if (!rfqName || !awardName || !quotationName || !supplier || contract.custom_rfq !== rfqName || contract.party_type !== "Supplier" || contract.party_name !== supplier ||
      order.supplier !== supplier || context.rfq_id !== rfqName || context.award_id !== awardName || context.supplier_id !== supplier ||
      context.quotation_id !== quotationName || context.contract_required !== "Yes" ||
      reverseLinks.some(reference => reference !== name) ||
      order.custom_clm_creation_key && order.custom_clm_creation_key !== clmPurchaseOrderKey(contractName, awardName, quotationName)) throw invalid();

  const [rfq, award, quotation] = await Promise.all([
    deps.load("Request for Quotation", rfqName), deps.load("Legal Document Review", awardName), deps.load("Supplier Quotation", quotationName),
  ]);
  const decision = object(object(rfq.custom_approval_data).contract_decision);
  if (rfq.name !== rfqName || rfq.contract_required !== "Yes" || decision.decision !== "Yes" || decision.contract !== contractName ||
      decision.award !== awardName || decision.supplier !== supplier || decision.quotation !== quotationName ||
      award.name !== awardName || award.rfq_name !== rfqName || award.sq_name !== quotationName || award.supplier !== supplier ||
      quotation.name !== quotationName || quotation.supplier !== supplier ||
      ![quotation, ...rows(quotation.items)].some(row => row.request_for_quotation === rfqName) ||
      rows(quotation.items).some(row => row.request_for_quotation && row.request_for_quotation !== rfqName) ||
      !text(order.company) || order.company !== rfq.company || quotation.company && quotation.company !== order.company || award.company && award.company !== order.company ||
      !rows(order.items).length || rows(order.items).some(item => item.supplier_quotation !== quotationName ||
        item.request_for_quotation && item.request_for_quotation !== rfqName ||
        !rows(quotation.items).some(quoted => quoted.item_code === item.item_code && (!item.supplier_quotation_item || item.supplier_quotation_item === quoted.name)))) throw invalid();

  return { data, rfqName, awardName, quotationName };
}

/** Read the existing Contract only. Never infer/create links or advance workflow on GET. */
export async function getPurchaseOrderContract(principal: AccessPrincipal, name: string, deps: Pick<ClmDeps, "load"> & Partial<Pick<ClmDeps, "list">>): Promise<PurchaseOrderContractResult> {
  if (!name) throw new ClmError("Select a Purchase Order.", 400);
  const order = await deps.load("Purchase Order", name);
  if (order.name !== name) throw new ClmError("The Purchase Order could not be verified.", 409);
  // Check PO ownership before even looking up its Contract: a guessed PO must
  // not reveal the existence or terms of another supplier's Contract.
  if (principal.typ === "supplier" && !supplierOwnsProcurementDocument("Purchase Order", order, principal.supplier)) {
    throw new ClmError("Supplier access is restricted to your Purchase Orders.", 403);
  }
  const contractName = text(order.custom_clm_contract);
  if (!contractName) return { purchase_order: name, contract: null };
  let contract: ClmRecord;
  try { contract = await deps.load("Contract", contractName); }
  catch (error) {
    if (Number((error as { status?: number }).status) === 404) throw new ClmError("The linked Contract could not be found. Contact Procurement Team to reconcile the saved Purchase Order reference.", 409);
    throw error;
  }
  if (contract.name !== contractName || !canReadClm(principal, "Contract", contract)) throw new ClmError("You are not permitted to view this Purchase Order's Contract.", 403);

  const { data, rfqName, awardName, quotationName } = await verifyPurchaseOrderContractLink(order, contract, deps);

  const pdf = currentClmPdfEvidence(contract, data), aggregate = toClmAggregate(principal, "Contract", contract);
  const actions = aggregate.actions.filter(action => ["sign", "supplier_accept", "supplier_redline"].includes(action.action));
  const lifecycle = rfqClmLifecycleView(contract);
  const version = text(contract.custom_current_version) || pdf?.version || "";
  const signed = (party: "supplier" | "inteva") => data.signatures.some(receipt => receipt.party === party && receipt.version === version &&
    !!text(receipt.by) && !!text(receipt.at) && Number.isFinite(Date.parse(receipt.at.replace(" ", "T"))) && !!text(receipt.file_id) &&
    receipt.file_url.startsWith("/private/files/") && /^[a-f\d]{64}$/i.test(receipt.hash));
  const rawValue = contract.custom_contract_value;
  const value = rawValue !== undefined && rawValue !== null && String(rawValue).trim() !== "" && Number.isFinite(Number(rawValue)) ? Number(rawValue) : null;
  const completion = object(data.procurement_completion);
  const supplierName = text(order.supplier_name) || (completion.supplier === order.supplier ? text(completion.supplier_name) : "") || text(order.supplier);
  return { purchase_order: name, contract: {
    name: contractName, status: clmStatus("Contract", contract), value, currency: text(contract.custom_currency),
    supplier_id: text(order.supplier), supplier_name: supplierName,
    start_date: text(contract.start_date), end_date: text(contract.end_date), rfq: rfqName, award: awardName, quotation: quotationName, current_version: version,
    ...(lifecycle ? { workflow_status: lifecycle.current.status, stage: lifecycle.current.stage } : {}),
    pdf_available: !!pdf, ...(pdf ? { pdf: { file_id: pdf.file_id, version: pdf.version, hash: pdf.hash, kind: pdf.kind } } : {}),
    signature_workflow: { supplier_status: signed("supplier") ? "Signed" : "Pending", legal_status: signed("inteva") ? "Signed" : "Pending",
      can_sign: actions.some(action => action.action === "sign"), can_review: true }, actions, supplier_workflow: await getClmSupplierPoWorkflow(contract, data, principal, deps),
  } };
}
