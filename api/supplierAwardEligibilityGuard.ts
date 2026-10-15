import { getSupplierAwardEligibility } from "../src/utils/supplierAwardEligibility.js";
import { RbacError, type AccessPrincipal } from "./rbacAuth.js";

type Doc = Record<string, unknown>;
type Filter = string[];
export interface SupplierAwardEligibilityDependencies {
  loadDocument(doctype: string, name: string): Promise<Doc>;
  listDocuments(doctype: string, options: { filters: Filter[]; fields: string[]; order_by?: string; limit_page_length: number }): Promise<Doc[]>;
}
export interface SupplierAwardSelection { rfqId: string; supplierId: string; quotationId?: string }

const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
function record(value: unknown): Doc {
  if (typeof value === "string") { try { return record(JSON.parse(value)); } catch { return {}; } }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Doc : {};
}
const rows = (value: unknown): Doc[] => Array.isArray(value) ? value.map(record) : [];
const blocked = (message: string): never => { throw new RbacError(message, 403); };
const unverifiable = (): never => blocked("Supplier award eligibility cannot be verified from the latest saved evaluation. Refresh or complete the evaluation before selecting this supplier.");

/** Server reads are independent of any browser score, verdict or eligible flag. */
export function createSupplierAwardEligibilityDependencies(): SupplierAwardEligibilityDependencies {
  const base = (process.env.ERPNEXT_URL || process.env.VITE_PROXY_TARGET || process.env.VITE_ERPNEXT_URL || "").trim().replace(/\/+$/, "").replace(/\/api$/, "");
  const key = process.env.ERP_API_KEY || process.env.VITE_API_KEY;
  const secret = process.env.ERP_API_SECRET || process.env.VITE_API_SECRET;
  const read = async (path: string): Promise<unknown> => {
    if (!base || !key || !secret) return blocked("Cannot verify supplier award eligibility: ERP is not configured.");
    const response = await fetch(`${base}/api/${path}`, {
      headers: { Accept: "application/json", Authorization: `token ${key}:${secret}` }, signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return blocked("Cannot verify supplier award eligibility: the ERP lookup failed.");
    const result = await response.json() as { data?: unknown };
    if (result.data === undefined) return unverifiable();
    return result.data;
  };
  return {
    async loadDocument(doctype, name) {
      const document = record(await read(`resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`));
      if (!text(document.name) || text(document.name) !== name) return unverifiable();
      return document;
    },
    async listDocuments(doctype, options) {
      const params = new URLSearchParams(Object.entries(options).map(([key, value]): [string, string] => [key, typeof value === "object" ? JSON.stringify(value) : String(value)]));
      const result = await read(`resource/${encodeURIComponent(doctype)}?${params}`);
      if (!Array.isArray(result)) return unverifiable();
      return rows(result);
    },
  };
}

/**
 * A numerical rank never authorizes an award. Resolve exact ERP identities and
 * consult only the latest persisted evaluation for this RFQ. An RFQ with no
 * scoring record keeps its existing manual workflow; an unreadable or stale
 * evaluation is not equivalent to having no evaluation.
 */
export async function assertSupplierAwardEligible(
  selection: SupplierAwardSelection,
  dependencies: SupplierAwardEligibilityDependencies = createSupplierAwardEligibilityDependencies(),
): Promise<void> {
  const rfqId = text(selection.rfqId), supplierId = text(selection.supplierId);
  if (!rfqId || !supplierId) return blocked("An RFQ and exact supplier identity are required before supplier selection.");
  const rfq = await dependencies.loadDocument("Request for Quotation", rfqId);
  if (text(rfq.name) !== rfqId) return unverifiable();
  let quotationId = text(selection.quotationId);
  if (!quotationId) {
    const candidates = await dependencies.listDocuments("Supplier Quotation", {
      filters: [["supplier", "=", supplierId], ["docstatus", "=", "1"], ["Supplier Quotation Item", "request_for_quotation", "=", rfqId],
        ...(text(rfq.custom_active_rfq_round) ? [["custom_rfq_round", "=", text(rfq.custom_active_rfq_round)]] : [])],
      fields: ["name"], order_by: "name desc", limit_page_length: 1,
    });
    quotationId = text(candidates[0]?.name);
  }
  if (!quotationId) return blocked("The selected supplier must have a submitted Supplier Quotation for this RFQ.");
  const quotation = await dependencies.loadDocument("Supplier Quotation", quotationId);
  const belongsToRfq = text(quotation.request_for_quotation) === rfqId || rows(quotation.items).some(item => text(item.request_for_quotation) === rfqId);
  if (text(quotation.name) !== quotationId || text(quotation.supplier) !== supplierId || !belongsToRfq || Number(quotation.docstatus) !== 1 || /^cancelled$/i.test(text(quotation.status))) {
    return blocked("The selected submitted Supplier Quotation must belong to this supplier and the current RFQ.");
  }
  if (text(rfq.custom_active_rfq_round) && text(quotation.custom_rfq_round) && text(rfq.custom_active_rfq_round) !== text(quotation.custom_rfq_round)) {
    return blocked("The selected quotation is from a different RFQ round. Refresh the current quotations and evaluation.");
  }
  const results = await dependencies.listDocuments("Supplier Scoring Result", {
    filters: [["rfq", "=", rfqId]], fields: ["name"], order_by: "scored_at desc, creation desc", limit_page_length: 1,
  });
  if (results.length === 0) return;
  const resultName = text(results[0]?.name);
  if (!resultName) return unverifiable();
  const result = await dependencies.loadDocument("Supplier Scoring Result", resultName);
  const snapshot = record(result.analysis_snapshot);
  const analysis = record(snapshot.analysis ?? snapshot);
  if (text(result.rfq) !== rfqId || text(snapshot.rfq_name) && text(snapshot.rfq_name) !== rfqId ||
      text(analysis.rfq_id) && text(analysis.rfq_id) !== rfqId) return unverifiable();
  const evaluationRows = rows(analysis.supplier_analysis);
  const matchingSupplier = evaluationRows.filter(row => text(row.supplier_id) === supplierId);
  if (matchingSupplier.length !== 1) return unverifiable();
  const row = matchingSupplier[0];
  const runId = text(analysis.evaluation_run_id) || text(snapshot.evaluation_run_id);
  if (runId && text(row.evaluation_run_id) !== runId || text(snapshot.evaluation_run_id) && runId !== text(snapshot.evaluation_run_id) ||
      text(row.rfq_id) && text(row.rfq_id) !== rfqId) return unverifiable();
  if (text(row.quotation_id) && text(row.supplier_quotation_id) && text(row.quotation_id) !== text(row.supplier_quotation_id)) return unverifiable();
  if (!["Low", "Medium", "High"].includes(text(row.risk))) return unverifiable();
  // Check the supplier's latest verdict before the quotation match, so an
  // alternate/stale quotation cannot hide an active AVOID assessment.
  const eligibility = getSupplierAwardEligibility({ verdict: text(row.verdict), risk: text(row.risk), evaluation_status: text(row.evaluation_status), quote_price_status: text(row.quote_price_status) });
  if (!eligibility.awardEligible) return blocked(eligibility.awardIneligibilityReason || "Supplier is not eligible for award under the current saved evaluation.");
  if ((text(row.quotation_id) || text(row.supplier_quotation_id)) !== quotationId) return unverifiable();
}

const READ_METHODS = new Set(["frappe.client.get", "frappe.client.get_list", "frappe.client.get_value", "frappe.client.get_count", "frappe.model.workflow.get_transitions", "frappe.desk.form.load.getdoctype"]);
const WRITE_METHODS = new Set(["frappe.client.save", "frappe.client.insert", "frappe.client.submit", "frappe.client.set_value", "frappe.model.workflow.apply_workflow"]);

/** Guards every supported generic RFQ selection / reverse-auction mutation. */
export async function assertSupplierSelectionRequest(input: {
  apiPath: string; method: string; principal: AccessPrincipal; body?: unknown; query?: Doc;
}, dependencies: SupplierAwardEligibilityDependencies = createSupplierAwardEligibilityDependencies()): Promise<void> {
  const path = decodeURIComponent(input.apiPath).replace(/^\/+|\/+$/g, "");
  const rpc = path.startsWith("method/") ? path.slice(7) : "";
  const resourceType = path.startsWith("resource/") ? path.slice(9).split("/")[0] : "";
  if (resourceType && ["GET", "HEAD", "OPTIONS", "DELETE"].includes(input.method.toUpperCase()) || READ_METHODS.has(rpc) || ["frappe.client.cancel", "frappe.client.delete"].includes(rpc)) return;
  const relevant = new Set(["Request for Quotation", "Reverse Bidding"]);
  const payload = { ...record(input.query), ...record(input.body) };
  const documents: Doc[] = [];
  const collect = (value: unknown, forceType = "") => {
    if (typeof value === "string") { try { return collect(JSON.parse(value), forceType); } catch { return; } }
    if (Array.isArray(value)) { value.forEach(row => collect(row, forceType)); return; }
    const doc = record(value);
    const type = text(doc.doctype) || text(doc.dt) || forceType;
    const wrapped = ["doc", "data", "docs"].some(key => Object.hasOwn(doc, key));
    if (relevant.has(type) && !wrapped) documents.push({ ...doc, doctype: type });
    for (const key of ["doc", "data", "docs"]) if (Object.hasOwn(doc, key)) collect(doc[key], forceType);
  };
  collect(payload, relevant.has(resourceType) ? resourceType : "");
  if (!documents.length) return;
  if (documents.length > 1) return blocked("Bulk supplier selection mutations are not supported.");
  if (!resourceType && !WRITE_METHODS.has(rpc)) return blocked("Unsupported supplier selection mutation route.");
  let document = documents[0];
  if (rpc === "frappe.client.set_value") {
    const fieldnames = record(payload.fieldname);
    if (!Object.keys(fieldnames).length && typeof payload.fieldname !== "string") return blocked("Invalid supplier selection field update.");
    document = { ...document, ...(Object.keys(fieldnames).length ? fieldnames : { [String(payload.fieldname)]: payload.value }) };
  }
  if (rpc === "frappe.model.workflow.apply_workflow" && document.doctype === "Reverse Bidding") return blocked("Use the reverse bidding scheduling and winner actions so supplier eligibility can be verified.");
  const name = resourceType ? path.slice(`resource/${resourceType}/`.length) : text(document.name);
  const isNew = path === `resource/${resourceType}` || rpc === "frappe.client.insert" || !name || document.__islocal === true || document.__islocal === 1;
  if (document.doctype === "Request for Quotation") {
    const data = record(document.custom_approval_data);
    const selectedIds = new Set([text(document.custom_selected_supplier), text(data.selected_supplier)].filter(Boolean));
    if (selectedIds.size > 1) return blocked("RFQ supplier selection fields must identify the same supplier.");
    const selected = [...selectedIds][0];
    if (!selected) return;
    if (isNew) return blocked("Save the RFQ before selecting its supplier.");
    const current = await dependencies.loadDocument("Request for Quotation", name);
    const currentSupplier = text(current.custom_selected_supplier) || text(record(current.custom_approval_data).selected_supplier);
    if (selected === currentSupplier) return; // preserve later Legal/Finance updates
    await assertSupplierAwardEligible({ rfqId: name, supplierId: selected }, dependencies);
    return;
  }
  const current = isNew ? {} : await dependencies.loadDocument("Reverse Bidding", name);
  const candidate = { ...current, ...document };
  const rfqId = text(candidate.rfq);
  if (!isNew && text(current.rfq) !== rfqId) return blocked("An auction's RFQ link cannot change after creation.");
  const invited = rows(candidate.invited_suppliers);
  const priorInvited = new Map(rows(current.invited_suppliers).map(row => [text(row.supplier), row]));
  const suppliers = new Set<string>();
  const advancing = isNew || ["Live", "Scheduled"].includes(text(candidate.auction_status)) && text(current.auction_status) !== text(candidate.auction_status);
  for (const row of invited) {
    const supplier = text(row.supplier), previous = priorInvited.get(supplier);
    if (advancing || !previous || ["Sent", "Accepted"].includes(text(row.invitation_status)) && text(previous.invitation_status) !== text(row.invitation_status)) suppliers.add(supplier);
  }
  const winner = text(candidate.winning_supplier);
  const awardTags = (value: unknown) => text(value).split("\n").filter(line => /\[RB:(?:Approved|WinnerAccepted)\]/.test(line)).join("\n");
  const explicitlyAwards = Object.hasOwn(document, "winning_supplier") ||
    Object.hasOwn(document, "winner_price") && Number(document.winner_price) !== Number(current.winner_price) ||
    awardTags(candidate.remarks) !== awardTags(current.remarks) && !!awardTags(candidate.remarks);
  if (explicitlyAwards && !winner && awardTags(candidate.remarks)) return blocked("An explicit auction winner is required before supplier award.");
  if (winner && explicitlyAwards) suppliers.add(winner);
  const priorWinnerItems = new Set(rows(current.bid_items).filter(row => text(row.status) === "Winner").map(row => `${text(row.supplier)}\u0000${text(row.item_code)}`));
  for (const row of rows(candidate.bid_items)) {
    if (text(row.status) === "Winner" && !priorWinnerItems.has(`${text(row.supplier)}\u0000${text(row.item_code)}`)) suppliers.add(text(row.supplier));
  }
  if (isNew && !suppliers.size) return blocked("Select eligible suppliers before creating reverse bidding.");
  for (const supplierId of suppliers) await assertSupplierAwardEligible({ rfqId, supplierId }, dependencies);
}
