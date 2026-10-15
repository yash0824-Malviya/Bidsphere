import { createHash, randomUUID } from "node:crypto";
import type { ClmData, ClmField, ClmRecord } from "../src/types/clm.js";
import type { AccessPrincipal } from "./rbacAuth.js";
import { applyClmAction, ClmError, clmStatus, parseClmData, rfqClmFinanceApproved, type ClmDeps } from "./clmCore.js";
import { persistedRfqAwardValue } from "./rfqAwardValue.js";
import { assertERPNextDate, resolvePoHeaderScheduleDate, resolvePoItemScheduleDate } from "../src/utils/erpNextDate.js";

export interface ClmPurchaseOrderDeps extends ClmDeps {
  purchaseOrderFields(): Promise<ClmField[]>;
  createOrder(doc: ClmRecord): Promise<ClmRecord>;
  submitOrder(doc: ClmRecord): Promise<ClmRecord>;
  verifyIntegrity(contract: ClmRecord): Promise<void>;
  authorizeOrder(principal: AccessPrincipal, doc: ClmRecord, source: { contract: string; rfq: string; award: string; quotation: string }): Promise<void>;
}
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const rows = (value: unknown): ClmRecord[] => Array.isArray(value) ? value as ClmRecord[] : [];
const object = (value: unknown): ClmRecord => {
  if (typeof value === "string") { try { value = JSON.parse(value); } catch { throw new ClmError("The saved RFQ award evidence is invalid.", 409); } }
  return value && typeof value === "object" && !Array.isArray(value) ? value as ClmRecord : {};
};
const actor = (principal: AccessPrincipal) => principal.typ === "internal" ? principal.email || principal.sub : principal.sub;
function date(value: unknown, field: string): string {
  try { return assertERPNextDate(value as Parameters<typeof assertERPNextDate>[0], field); }
  catch (error) { throw new ClmError(error instanceof Error ? error.message : `Enter a valid ${field}.`, 422); }
}
export const clmPurchaseOrderKey = (contract: string, award: string, quotation: string) => createHash("sha256").update([contract, award, quotation].join("|")).digest("hex");
const requiredFields = { custom_clm_contract: "Contract", custom_clm_rfq: "Request for Quotation", custom_clm_award: "Legal Document Review" };

function requireTeam(principal: AccessPrincipal) {
  if (principal.typ !== "internal" || principal.role !== "procurement_team") throw new ClmError("Only Procurement Team can create or submit this Contract's Purchase Order.", 403);
}
async function requireSchema(deps: ClmPurchaseOrderDeps) {
  const fields = await deps.purchaseOrderFields();
  if (Object.entries(requiredFields).some(([name, target]) => !fields.some(field => field.fieldname === name && field.fieldtype === "Link" && field.options === target)) ||
      !fields.some(field => field.fieldname === "custom_clm_creation_key" && field.fieldtype === "Data" && Number(field.unique) === 1)) {
    throw new ClmError("Purchase Order CLM link fields and their unique creation key are not configured. Apply the existing CLM Purchase Order schema setup before creating a PO; no Contract has been completed.", 503);
  }
}
async function source(principal: AccessPrincipal, name: string, deps: ClmPurchaseOrderDeps) {
  requireTeam(principal);
  if (!name) throw new ClmError("Select a Contract.", 400);
  const contract = await deps.load("Contract", name), data = parseClmData(contract.custom_clm_data);
  if (contract.name !== name || Number(contract.docstatus) === 2 || !["Executed", "Active"].includes(clmStatus("Contract", contract)) || data.termination || !rfqClmFinanceApproved(contract, data)) {
    throw new ClmError("Complete this Contract's Legal review, verified e-signature and Finance approval before Procurement Finalization.", 409);
  }
  const context = object(data.rfq_context), rfqName = text(contract.custom_rfq), quotationName = text(contract.custom_supplier_quotation);
  const awardName = text(context.award_id), supplierName = text(contract.custom_supplier || contract.party_name);
  const [rfq, award, quotation, supplier] = await Promise.all([
    deps.load("Request for Quotation", rfqName), deps.load("Legal Document Review", awardName), deps.load("Supplier Quotation", quotationName), deps.load("Supplier", supplierName),
  ]);
  const decision = object(object(rfq.custom_approval_data).contract_decision);
  if (rfq.name !== rfqName || Number(rfq.docstatus) !== 1 || /^(cancelled|canceled|closed|rejected)$/i.test(text(rfq.status)) || rfq.contract_required !== "Yes" ||
      decision.decision !== "Yes" || decision.contract !== name || decision.award !== awardName || decision.quotation !== quotationName || decision.supplier !== supplierName ||
      context.rfq_id !== rfqName || context.supplier_id !== supplierName || context.quotation_id !== quotationName || context.contract_required !== "Yes" ||
      award.name !== awardName || award.rfq_name !== rfqName || award.sq_name !== quotationName || award.supplier !== supplierName ||
      quotation.name !== quotationName || Number(quotation.docstatus) !== 1 || /^(cancelled|canceled)$/i.test(text(quotation.status)) || quotation.supplier !== supplierName ||
      ![quotation, ...rows(quotation.items)].some(row => row.request_for_quotation === rfqName) || supplier.name !== supplierName || Number(supplier.disabled) === 1) {
    throw new ClmError("The Contract must retain its active RFQ, saved award, awarded supplier and submitted winning quotation.", 409);
  }
  if (rfq.custom_active_rfq_round && quotation.custom_rfq_round && rfq.custom_active_rfq_round !== quotation.custom_rfq_round) throw new ClmError("The winning quotation no longer belongs to the awarded RFQ round.", 409);
  if (rows(quotation.items).some(item => item.request_for_quotation && item.request_for_quotation !== rfqName)) throw new ClmError("The winning quotation includes items from another RFQ. Reconcile the awarded scope before creating a PO.", 409);
  const company = text(rfq.company || quotation.company), value = persistedRfqAwardValue(award, quotation);
  if (!company || quotation.company && quotation.company !== company || award.company && award.company !== company ||
      Number(contract.custom_contract_value) !== value.amount || contract.custom_currency !== value.currency) throw new ClmError("Contract value, currency and company must match the persisted final award.", 409);
  await requireSchema(deps);
  await deps.verifyIntegrity(contract);
  return { contract, data, rfq, award, quotation, supplier, company, amount: value.amount, currency: value.currency,
    ids: { contract: name, rfq: rfqName, award: awardName, quotation: quotationName }, key: clmPurchaseOrderKey(name, awardName, quotationName) };
}
type Source = Awaited<ReturnType<typeof source>>;
function links(state: Source): ClmRecord {
  return { custom_clm_contract: state.ids.contract, custom_clm_rfq: state.ids.rfq, custom_clm_award: state.ids.award, custom_clm_creation_key: state.key };
}
function verifyOrder(state: Source, order: ClmRecord) {
  if (!text(order.name) || Number(order.docstatus) === 2 || /^(cancelled|canceled|stopped|rejected)$/i.test(text(order.status)) ||
      Object.entries(links(state)).some(([key, value]) => order[key] !== value) || order.supplier !== state.supplier.name || order.company !== state.company || order.currency !== state.currency ||
      !rows(order.items).length || rows(order.items).some(row => row.supplier_quotation !== state.quotation.name)) throw new ClmError("The saved Purchase Order must match this Contract's permanent award links. It has not been finalized.", 409);
  if (Number(order.docstatus) === 1) verifyOrderValue(state, order);
}
function verifyOrderValue(state: Source, order: ClmRecord) {
  if (!Number.isFinite(Number(order.grand_total)) || Number(order.grand_total) !== state.amount) throw new ClmError("The Purchase Order total calculated by ERPNext must match the final award amount. Review its draft quantities, rates, taxes and discounts before submitting.", 409);
}
async function existing(state: Source, deps: ClmPurchaseOrderDeps): Promise<ClmRecord | undefined> {
  const matches = await deps.list("Purchase Order", [["custom_clm_creation_key", "=", state.key]]);
  const quotationOrders = await deps.list("Purchase Order", [["Purchase Order Item", "supplier_quotation", "=", state.quotation.name], ["docstatus", "!=", 2]]);
  if (quotationOrders.some(row => !matches.some(match => match.name === row.name))) throw new ClmError("A Purchase Order already exists for this awarded quotation outside this Contract creation operation. Reconcile its source before retrying; another PO will not be created.", 409);
  if (matches.length > 1) throw new ClmError("More than one Purchase Order exists for this Contract award. Reconcile the duplicate records before continuing.", 409);
  const operation = object(state.data.procurement_order), completion = object(state.data.procurement_completion);
  const expected = text(completion.purchase_order || operation.purchase_order);
  if (!matches.length) {
    if (expected) throw new ClmError("The linked Purchase Order could not be found. Do not create a replacement; reconcile the saved reference.", 409);
    return undefined;
  }
  const order = await deps.load("Purchase Order", text(matches[0].name));
  verifyOrder(state, order);
  if (expected && order.name !== expected) throw new ClmError("The Contract's Purchase Order reference conflicts with its unique creation key.", 409);
  return order;
}
function initialPayload(state: Source, deps: ClmPurchaseOrderDeps): ClmRecord {
  const today = deps.now().slice(0, 10);
  const items = rows(state.quotation.items).map(item => {
    if (item.request_for_quotation && item.request_for_quotation !== state.rfq.name) throw new ClmError("The winning quotation includes items from another RFQ. Reconcile the awarded scope before creating a PO.", 409);
    const rfqItem = rows(state.rfq.items).find(row => row.name === item.request_for_quotation_item || row.item_code === item.item_code);
    const qty = Number(item.qty), rate = Number(item.rate), uom = text(item.uom || item.stock_uom);
    if (!text(item.item_code) || !rfqItem || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(rate) || rate < 0 || !uom) throw new ClmError("The winning quotation needs complete awarded items, quantities, units and rates before creating a PO.", 409);
    return { item_code: item.item_code, item_name: item.item_name || item.item_code, description: item.description || item.item_name || item.item_code,
      qty, uom, rate, amount: qty * rate, schedule_date: resolvePoItemScheduleDate(text(rfqItem.schedule_date || item.schedule_date), today),
      ...(item.warehouse ? { warehouse: item.warehouse } : {}), supplier_quotation: state.quotation.name, supplier_quotation_item: item.name };
  });
  if (!items.length) throw new ClmError("The winning quotation has no items for Purchase Order creation.", 409);
  const inherited = Object.fromEntries(["payment_terms_template", "supplier_address", "shipping_address", "billing_address", "incoterm", "named_place"].filter(key => state.quotation[key]).map(key => [key, state.quotation[key]]));
  const terms = text(state.contract.custom_payment_terms_description) || text(state.quotation.terms) || text(state.rfq.terms);
  const taxes = rows(state.quotation.taxes).map(row => Object.fromEntries(["charge_type", "account_head", "description", "rate", "tax_amount", "cost_center", "included_in_print_rate", "add_deduct_tax", "category", "row_id"].filter(key => row[key] !== undefined).map(key => [key, row[key]])));
  const pricing = Object.fromEntries(["conversion_rate", "apply_discount_on", "additional_discount_percentage", "discount_amount"].filter(key => state.quotation[key] !== undefined).map(key => [key, state.quotation[key]]));
  return { doctype: "Purchase Order", supplier: state.supplier.name, supplier_name: state.supplier.supplier_name, company: state.company,
    currency: state.currency, transaction_date: today, schedule_date: resolvePoHeaderScheduleDate(items.map(item => item.schedule_date), today), items,
    ...inherited, ...pricing, ...(taxes.length ? { taxes } : {}), ...(terms ? { terms } : {}), ...links(state) };
}
function payloadFor(state: Source, input: ClmRecord, deps: ClmPurchaseOrderDeps, previous?: ClmRecord): ClmRecord {
  const base = previous || initialPayload(state, deps);
  const permitted = ["supplier", "company", "currency", "transaction_date", "schedule_date", "items", "terms", "payment_terms_template", "supplier_address", "shipping_address", "billing_address", "incoterm", "named_place"];
  if (Object.keys(input).some(key => !permitted.includes(key))) throw new ClmError("Unsupported Purchase Order fields. Reload the Contract PO form.", 400);
  for (const key of ["supplier", "company", "currency"]) if (input[key] !== undefined && input[key] !== base[key]) throw new ClmError(`Purchase Order ${key} must match the Contract award.`, 422);
  const doc: ClmRecord = { ...base, ...input, ...links(state), doctype: "Purchase Order" };
  doc.transaction_date = date(doc.transaction_date, "transaction_date");
  doc.schedule_date = date(doc.schedule_date, "schedule_date");
  const lines = rows(doc.items);
  if (!lines.length) throw new ClmError("Add at least one awarded item.", 422);
  doc.items = lines.map((item, index) => {
    const quoted = rows(state.quotation.items).find(row => row.item_code === item.item_code);
    if (!quoted || !Number.isFinite(Number(item.qty)) || Number(item.qty) <= 0 || !Number.isFinite(Number(item.rate)) || Number(item.rate) < 0 || !text(item.uom)) throw new ClmError("Purchase Order items need a winning quotation item, positive quantity, unit and valid rate.", 422);
    const priorItem = rows(previous?.items)[index];
    return { ...(priorItem && priorItem.item_code === item.item_code ? { name: priorItem.name } : {}), doctype: "Purchase Order Item", idx: index + 1,
      item_code: quoted.item_code, item_name: text(item.item_name) || quoted.item_name || quoted.item_code, description: text(item.description) || quoted.description || quoted.item_name || quoted.item_code,
      qty: Number(item.qty), uom: text(item.uom), rate: Number(item.rate), amount: Number(item.qty) * Number(item.rate),
      schedule_date: date(item.schedule_date || doc.schedule_date, "schedule_date"),
      ...(text(item.warehouse || quoted.warehouse) ? { warehouse: text(item.warehouse || quoted.warehouse) } : {}),
      supplier_quotation: state.quotation.name, supplier_quotation_item: quoted.name };
  });
  // Retain approved tax/discount calculations in ERPNext. In the simple
  // no-tax case reject a changed award total before creating any commitment.
  if (!rows(doc.taxes).length && !Number(doc.discount_amount) && !Number(doc.additional_discount_percentage)) {
    const total = rows(doc.items).reduce((sum, item) => sum + Number(item.amount), 0);
    if (Math.abs(total - state.amount) > 0.005) throw new ClmError("Purchase Order total must match the saved final award amount. Review the awarded item quantities and rates.", 422);
  }
  return doc;
}
function addAudit(data: ClmData, principal: AccessPrincipal, at: string, action: string, reference: string, contract: string) {
  if (data.audit.some(row => row.action === action && row.reference_id === reference)) return;
  data.audit.push({ id: randomUUID(), action, by: actor(principal), role: "procurement_team", at, previous_status: "Procurement Finalization", new_status: "Procurement Finalization", comment: reference, reference_id: reference, contract_id: contract });
}
async function saveEvidence(state: Source, data: ClmData, deps: ClmPurchaseOrderDeps) {
  const expected = JSON.stringify(data);
  await deps.save("Contract", { ...state.contract, custom_clm_data: expected });
  const persisted = await deps.load("Contract", state.ids.contract);
  if (persisted.custom_clm_data !== expected) throw new ClmError("ERPNext did not persist the Contract's Purchase Order evidence. Refresh before retrying.", 409);
  state.contract = persisted; state.data = parseClmData(persisted.custom_clm_data);
}

export async function getClmPurchaseOrder(principal: AccessPrincipal, name: string, deps: ClmPurchaseOrderDeps) {
  const state = await source(principal, name, deps), order = await existing(state, deps);
  const payload = order ? { ...order } : initialPayload(state, deps);
  await deps.authorizeOrder(principal, payload, state.ids);
  return { contract: name, expected_modified: state.contract.modified, rfq: state.ids.rfq, award: state.ids.award, quotation: state.ids.quotation,
    supplier: state.supplier.name, award_value: state.amount, currency: state.currency, payload, purchase_order: order,
    completed: state.data.rfq_workflow?.phase === "completed" };
}

/** Standard ERP PO save/submit, with a DB-unique source key and verified readback.
 * Every HTTP commit is recoverable; no failed/ambiguous write can complete CLM. */
export async function createClmPurchaseOrder(principal: AccessPrincipal, input: { name: string; expected_modified: string; operation: "save_draft" | "submit"; payload: ClmRecord }, deps: ClmPurchaseOrderDeps) {
  if (!["save_draft", "submit"].includes(input.operation)) throw new ClmError("Choose save_draft or submit.", 400);
  let state = await source(principal, text(input.name), deps), order = await existing(state, deps);
  const reused = !!order;
  if (state.data.rfq_workflow?.phase === "completed") {
    if (!order || Number(order.docstatus) !== 1) throw new ClmError("The completed Contract's submitted PO could not be verified.", 409);
    return { contract: input.name, expected_modified: state.contract.modified, purchase_order: order, completed: true, reused: true };
  }
  const priorOperation = object(state.data.procurement_order);
  if (!order && !priorOperation.id && (!input.expected_modified || input.expected_modified !== state.contract.modified)) throw new ClmError("The Contract changed. Refresh before creating its PO.", 409);
  const payload = payloadFor(state, input.payload, deps, order);
  await deps.authorizeOrder(principal, payload, state.ids);
  if (!priorOperation.id) {
    const data = structuredClone(state.data), at = deps.now();
    data.procurement_order = { id: randomUUID(), key: state.key, state: "creating", by: actor(principal), role: "procurement_team", at, ...state.ids, supplier: state.supplier.name };
    addAudit(data, principal, at, "purchase_order_creation_initiated", state.key, state.ids.contract);
    try { await saveEvidence(state, data, deps); }
    catch (error) {
      state = await source(principal, input.name, deps);
      if (object(state.data.procurement_order).key !== state.key) throw error;
      order = await existing(state, deps);
    }
  } else if (priorOperation.key !== state.key || priorOperation.contract !== input.name || priorOperation.award !== state.ids.award || priorOperation.quotation !== state.ids.quotation) throw new ClmError("The saved PO creation operation does not match this Contract award.", 409);
  if (!order) {
    try { await deps.createOrder(payload); }
    catch (error) { order = await existing(state, deps); if (!order) throw error; }
    order ||= await existing(state, deps);
    if (!order) throw new ClmError("ERPNext did not persist the Purchase Order. The Contract remains at Procurement Finalization.", 502);
  } else if (Number(order.docstatus) === 0) {
    // Save edits to the same persisted draft; never create a second PO on retry.
    await deps.save("Purchase Order", payloadFor(state, input.payload, deps, order));
    order = await deps.load("Purchase Order", text(order.name)); verifyOrder(state, order);
  }
  // Link the actual draft before submission so a submit failure remains resumable.
  state = await source(principal, input.name, deps);
  const recordOrder = async () => {
    const data = structuredClone(state.data), at = deps.now();
    data.procurement_order = { ...object(data.procurement_order), key: state.key, state: Number(order!.docstatus) === 1 ? "submitted" : "draft", purchase_order: order!.name,
      created_at: order!.creation || at, currency: order!.currency, grand_total: order!.grand_total, supplier_name: order!.supplier_name || state.supplier.supplier_name };
    addAudit(data, principal, at, "purchase_order_created", text(order!.name), input.name);
    addAudit(data, principal, at, "purchase_order_linked", text(order!.name), input.name);
    if (JSON.stringify(data) !== JSON.stringify(state.data)) await saveEvidence(state, data, deps);
  };
  await recordOrder();
  if (input.operation === "submit" && Number(order.docstatus) === 0) {
    verifyOrderValue(state, order);
    await deps.authorizeOrder(principal, { ...order, docstatus: 1 }, state.ids);
    try { await deps.submitOrder(order); }
    catch (error) { const persisted = await deps.load("Purchase Order", text(order.name)); if (Number(persisted.docstatus) !== 1) throw error; }
    order = await deps.load("Purchase Order", text(order.name)); verifyOrder(state, order);
    if (Number(order.docstatus) !== 1) throw new ClmError("ERPNext has not submitted the PO. The Contract remains at Procurement Finalization.", 409);
    state = await source(principal, input.name, deps); await recordOrder();
  }
  if (Number(order.docstatus) === 1) {
    state = await source(principal, input.name, deps);
    if (state.data.rfq_workflow?.phase !== "completed") await applyClmAction({ doctype: "Contract", name: input.name, expected_modified: state.contract.modified,
      action: "finalize_procurement", payload: { purchase_order: order.name }, comment: `Purchase Order ${order.name} created and submitted from this Contract.` }, principal, deps);
    state = await source(principal, input.name, deps);
    if (state.data.rfq_workflow?.phase !== "completed" || object(state.data.procurement_completion).purchase_order !== order.name) throw new ClmError("The PO exists, but Contract finalization was not persisted. Retry to reconcile the existing PO.", 409);
  }
  return { contract: input.name, expected_modified: state.contract.modified, purchase_order: order, completed: state.data.rfq_workflow?.phase === "completed", reused };
}
