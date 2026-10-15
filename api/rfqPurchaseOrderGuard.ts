import { RbacError, requireRoles, type AccessPrincipal } from "./rbacAuth.js";
import type { SupplierAwardSelection } from "./supplierAwardEligibilityGuard.js";

type Doc = Record<string, unknown>;
type Filters = Array<[string, string, string]>;

export interface RfqPurchaseOrderDependencies {
  loadDocument(doctype: string, name: string): Promise<Doc>;
  listReviews(filters: Filters): Promise<Doc[]>;
  assertClmReady(rfqName: string, options?: { allowHistoricalOrder?: boolean }): Promise<unknown>;
  assertReady(reviewName: string, principal: AccessPrincipal): Promise<unknown>;
  assertAwardEligible(selection: SupplierAwardSelection): Promise<void>;
}

function record(value: unknown): Doc {
  if (typeof value === "string") {
    try { return record(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Doc : {};
}

const value = (input: unknown) => typeof input === "string" ? input.trim() : "";
const rows = (input: unknown): Doc[] => Array.isArray(input) ? input.map(record) : [];
const READ_METHODS = new Set([
  "frappe.client.get", "frappe.client.get_list", "frappe.client.get_value", "frappe.client.get_count",
  "frappe.model.workflow.get_transitions", "frappe.desk.form.load.getdoctype",
]);
const WRITE_METHODS = new Set([
  "frappe.client.save", "frappe.client.insert", "frappe.client.submit", "frappe.client.cancel",
  "frappe.client.delete", "frappe.client.set_value", "frappe.model.workflow.apply_workflow",
]);
const CLM_ORDER_FIELDS = ["custom_clm_contract", "custom_clm_rfq", "custom_clm_award", "custom_clm_creation_key"] as const;

/** Internal service context only. Never copy this from a request body/query. */
export interface ClmPurchaseOrderContext {
  contractId: string;
  rfqId: string;
  awardId: string;
  quotationId: string;
}

function rfqReferences(document: Doc): Set<string> {
  const result = new Set<string>();
  for (const item of [document, ...rows(document.items)]) {
    for (const key of ["request_for_quotation", "rfq", "rfq_name", "custom_rfq_reference", "custom_clm_rfq"]) {
      const name = value(item[key]);
      if (name) result.add(name);
    }
  }
  // RFQ→PO currently persists the RFQ link in remarks as well as SQ item links.
  for (const match of value(document.remarks).matchAll(/\bPUR-RFQ-[A-Za-z0-9-]+\b/g)) result.add(match[0]);
  return result;
}

function quotationReferences(document: Doc): Set<string> {
  return new Set([document, ...rows(document.items)].map(item => value(item.supplier_quotation)).filter(Boolean));
}

/**
 * Authenticate RFQ-linked PO writes before the service-credential proxy forwards
 * them. No browser approval flags are evidence. Standalone/non-RFQ PO workflows
 * are intentionally left to their existing authorization.
 */
export async function assertRfqPurchaseOrderRequest(input: {
  apiPath: string; method: string; principal: AccessPrincipal;
  body?: unknown; query?: Record<string, unknown>;
  clmContext?: ClmPurchaseOrderContext;
}, dependencies: RfqPurchaseOrderDependencies): Promise<void> {
  const path = decodeURIComponent(input.apiPath).replace(/^\/+|\/+$/g, "");
  const method = input.method.toUpperCase();
  const isResource = /^resource\/Purchase Order(?:\/|$)/.test(path);
  const rpc = path.startsWith("method/") ? path.slice(7) : "";
  if ((isResource && ["GET", "HEAD", "OPTIONS"].includes(method)) || READ_METHODS.has(rpc)) return;
  const payload = { ...record(input.query), ...record(input.body) };
  const documents: Doc[] = [];
  const collect = (input: unknown) => {
    const candidate = record(input);
    if (candidate.doctype === "Purchase Order" || candidate.dt === "Purchase Order") documents.push(candidate);
    for (const key of ["doc", "data", "docs"]) {
      const nested = candidate[key];
      if (Array.isArray(nested)) nested.forEach(collect);
      else if (nested) collect(nested);
    }
  };
  collect(payload);
  if (!isResource && !documents.length) return;
  if (input.principal.typ !== "internal") throw new RbacError("Only Procurement Team may create or submit purchase orders.", 403);
  requireRoles(input.principal, ["procurement_team", "admin"]);
  // Cancellation/deletion cannot create or advance a PO; retain existing ERP controls.
  if (method === "DELETE" || ["frappe.client.cancel", "frappe.client.delete"].includes(rpc)) return;
  if (!isResource && !WRITE_METHODS.has(rpc)) throw new RbacError("Unsupported Purchase Order mutation route.", 403);
  if (documents.length > 1) throw new RbacError("Bulk Purchase Order mutations cannot bypass RFQ approval validation.", 403);
  if (isResource && (payload.doc || payload.data || payload.docs)) throw new RbacError("Wrapped Purchase Order resource mutations are not supported.", 403);

  let document = isResource ? payload : documents[0];
  const name = isResource ? path.slice("resource/Purchase Order/".length) : value(document.name);
  const persisted = name && path !== "resource/Purchase Order"
    ? await dependencies.loadDocument("Purchase Order", name) : null;
  if (rpc === "frappe.client.set_value") {
    const fieldname = payload.fieldname;
    const parsedFields = record(fieldname);
    const changes = typeof fieldname === "string" && !Object.keys(parsedFields).length ? { [fieldname]: payload.value } : parsedFields;
    document = { ...document, ...changes };
  }
  const candidate = { ...persisted, ...document };
  const context = input.clmContext;
  if (!context && (CLM_ORDER_FIELDS.some(field => value(candidate[field]) || value(persisted?.[field])))) {
    throw new RbacError("Create and submit this Contract's Purchase Order through Contract Procurement Finalization. Its Contract links cannot be written through the generic PO API.", 403);
  }
  if (context) {
    if (input.principal.role !== "procurement_team") throw new RbacError("Only Procurement Team may create or finalize a Contract Purchase Order.", 403);
    if (![context.contractId, context.rfqId, context.awardId, context.quotationId].every(name => value(name)) ||
        value(candidate.custom_clm_contract) !== context.contractId || value(candidate.custom_clm_rfq) !== context.rfqId ||
        value(candidate.custom_clm_award) !== context.awardId || !value(candidate.custom_clm_creation_key) ||
        persisted && CLM_ORDER_FIELDS.some(field => value(persisted[field]) !== value(candidate[field])) ||
        [...quotationReferences(candidate)].some(name => name !== context.quotationId)) {
      throw new RbacError("The Purchase Order must preserve its verified Contract, RFQ, award and quotation links.", 403);
    }
  }
  const changesSelectedQuotation = !!persisted && (
    value(candidate.supplier) !== value(persisted.supplier) ||
    JSON.stringify([...quotationReferences(candidate)].sort()) !== JSON.stringify([...quotationReferences(persisted)].sort())
  );
  // Frappe submit/workflow RPCs advance persisted state without requiring the
  // caller to include docstatus. Never infer their intent from the patch alone.
  const advancesOrder = !persisted || changesSelectedQuotation || rpc === "frappe.client.submit" ||
    rpc === "frappe.model.workflow.apply_workflow" && !/cancel/i.test(value(payload.action)) ||
    Number(candidate.docstatus ?? 0) > Number(persisted.docstatus ?? 0);
  const originalRfqs = new Set<string>();
  const checkedReviews = new Set<string>();
  const checkedContracts = new Set<string>();
  const rfqDocuments = new Map<string, Doc>();
  const loadRfq = async (name: string) => {
    if (!rfqDocuments.has(name)) rfqDocuments.set(name, await dependencies.loadDocument("Request for Quotation", name));
    return rfqDocuments.get(name)!;
  };

  const validate = async (po: Doc, existing = false): Promise<Set<string>> => {
    const explicitRfqs = rfqReferences(po);
    const quotations = quotationReferences(po);
    const linkedRfqs = new Set<string>();
    for (const quotationName of quotations) {
      const quotation = await dependencies.loadDocument("Supplier Quotation", quotationName);
      const quotationRfqs = rfqReferences(quotation);
      quotationRfqs.forEach(rfq => linkedRfqs.add(rfq));
      for (const rfqName of quotationRfqs) {
        if (!checkedContracts.has(rfqName)) {
          const rfq = await loadRfq(rfqName);
          const flag = value(rfq.contract_required);
          const decision = record(record(rfq.custom_approval_data).contract_decision);
          if (context && (rfqName !== context.rfqId || flag !== "Yes" || decision.decision !== "Yes" ||
              value(decision.contract) !== context.contractId || value(decision.award || decision.legal_review) !== context.awardId ||
              value(decision.quotation) !== context.quotationId)) {
            throw new RbacError("The saved RFQ Contract decision does not match this Purchase Order.", 403);
          }
          // All new orders for an RFQ-linked Contract use the same persisted
          // creation operation. A second generic route must not create a PO
          // while that operation is running, saved, or completed.
          if (!context && advancesOrder && flag === "Yes" && value(decision.contract)) {
            throw new RbacError("Create this RFQ's Purchase Order from its Contract Procurement Finalization stage to retain its existing PO and prevent duplicates.", 403);
          }
          const historicNoContract = (existing || originalRfqs.has(rfqName)) &&
            (!flag || flag === "No") && !Object.hasOwn(record(rfq.custom_approval_data), "contract_decision");
          // Core must also prove there is no linked CLM and an existing order.
          // A new PO never inherits this exception against the same old RFQ.
          if (historicNoContract) await dependencies.assertClmReady(rfqName, { allowHistoricalOrder: true });
          else await dependencies.assertClmReady(rfqName);
          checkedContracts.add(rfqName);
        }
      }
      const reviews = await dependencies.listReviews([["sq_name", "=", quotationName]]);
      if (!quotationRfqs.size && !reviews.length) continue; // a non-RFQ quotation
      if (reviews.length !== 1 || !value(reviews[0].name)) throw new RbacError("RFQ purchase orders require one authoritative Legal Document Review for the selected quotation.", 403);
      const review = reviews[0];
      if (context && (quotationName !== context.quotationId || value(review.name) !== context.awardId)) {
        throw new RbacError("The Purchase Order must use its Contract's exact saved award and winning quotation.", 403);
      }
      if (value(review.sq_name) !== quotationName || value(review.supplier) !== value(po.supplier) ||
          value(quotation.supplier) !== value(po.supplier) ||
          (value(po.company) && value(quotation.company) && value(po.company) !== value(quotation.company))) {
        throw new RbacError("The purchase order must use the RFQ's reviewed supplier and quotation.", 403);
      }
      const rfqName = value(review.rfq_name);
      if (!rfqName || !quotationRfqs.has(rfqName)) throw new RbacError("The reviewed quotation does not match its RFQ.", 403);
      const rfqReviews = await dependencies.listReviews([["rfq_name", "=", rfqName]]);
      if (rfqReviews.length !== 1 || value(rfqReviews[0].name) !== value(review.name)) {
        throw new RbacError("The RFQ selected quotation is ambiguous. Reconcile its legal reviews before creating a PO.", 403);
      }
      const rfq = await loadRfq(rfqName);
      if (Number(rfq.docstatus) === 2 || /^(cancelled|canceled|closed|rejected)$/i.test(value(rfq.status))) {
        throw new RbacError("A cancelled, closed, or rejected RFQ cannot create a purchase order.", 403);
      }
      if (!checkedReviews.has(value(review.name))) {
        await dependencies.assertReady(value(review.name), input.principal);
        checkedReviews.add(value(review.name));
      }
      if (!existing && advancesOrder) {
        await dependencies.assertAwardEligible({ rfqId: rfqName, supplierId: value(po.supplier), quotationId: quotationName });
      }
    }
    if (explicitRfqs.size && !quotations.size) throw new RbacError("RFQ purchase orders require persisted selected Supplier Quotation item links.", 403);
    if ([...explicitRfqs].some(rfq => !linkedRfqs.has(rfq))) throw new RbacError("Purchase Order RFQ references do not match its reviewed quotation.", 403);
    if (linkedRfqs.size && rows(po.items).some(item => !value(item.supplier_quotation))) {
      throw new RbacError("Every RFQ purchase order item must retain its reviewed Supplier Quotation link.", 403);
    }
    return linkedRfqs;
  };

  if (persisted) (await validate(persisted, true)).forEach(rfq => originalRfqs.add(rfq));
  const candidateRfqs = await validate(candidate);
  if ([...originalRfqs].some(rfq => !candidateRfqs.has(rfq))) throw new RbacError("Existing RFQ purchase order links cannot be removed to bypass approval checks.", 403);
}

/** Read-only service metadata lookup shared by production and Vite gateways. */
export async function listPurchaseOrderLegalReviews(filters: Filters): Promise<Doc[]> {
  const base = (process.env.ERPNEXT_URL || process.env.VITE_PROXY_TARGET || process.env.VITE_ERPNEXT_URL || "")
    .trim().replace(/\/+$/, "").replace(/\/api$/, "");
  const key = process.env.ERP_API_KEY || process.env.VITE_API_KEY;
  const secret = process.env.ERP_API_SECRET || process.env.VITE_API_SECRET;
  if (!base || !key || !secret) throw new RbacError("Cannot verify RFQ approval: ERP is not configured.", 403);
  const query = new URLSearchParams({ fields: JSON.stringify(["name", "sq_name", "rfq_name", "supplier", "company"]), filters: JSON.stringify(filters), limit_page_length: "100" });
  const response = await fetch(`${base}/api/resource/Legal%20Document%20Review?${query}`, {
    headers: { Accept: "application/json", Authorization: `token ${key}:${secret}` }, signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new RbacError("Unable to verify RFQ Legal and Finance approval.", 403);
  const result = await response.json() as { data?: Doc[] };
  if (!Array.isArray(result.data) || result.data.length >= 100) throw new RbacError("RFQ legal review lookup is incomplete.", 403);
  return result.data;
}
