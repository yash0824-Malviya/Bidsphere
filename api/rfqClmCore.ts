import { randomUUID } from "node:crypto";
import type { AccessPrincipal } from "./rbacAuth.js";
import { resolveServerRole } from "./rbacAuth.js";
import { applyClmAction, canReadClm, clmEditableFields, clmSnapshotHash, clmStatus, ClmError, parseClmData, pendingClmApprovals, rfqClmFinanceApproved, toClmAggregate, type ClmDeps } from "./clmCore.js";
import type { ClmActionInput, ClmField, ClmRecord, RfqClmCreateResult, RfqClmDecisionResult, RfqClmSourceDocument, RfqClmSummary, LegalManagerSignatoryUser, LegalSignatoryResolution } from "../src/types/clm.js";
import { validateRfqContractDetails } from "../src/utils/rfqContractContext.js";
import { collectRfqAwardDocuments } from "./rfqClmDocuments.js";
import { rfqClmWorkflowView, rfqClmRequestWorkflowView } from "../src/utils/rfqClmWorkflow.js";
import { isInitialRfqRequest } from "./rfqInitialClmRequest.js";
import { rfqRequestDraftValues } from "./rfqRequestDraft.js";
import { rfqRestData, updateRfqClmRecord } from "./rfqClmRest.js";
import { projectRfqRequestSubmission } from "./rfqRequestSubmissionProjection.js";
import { persistedRfqAwardValue } from "./rfqAwardValue.js";
import { extractSourceDepartmentMrName } from "./rfqRequestDepartment.js";

export interface RfqClmTransaction {
  rfq: string; expected_modified: string; decision: "Yes" | "No";
  actor: { id: string; role: string }; award: ClmRecord; request_document?: ClmRecord; create_contract?: boolean; contract_fields?: ClmRecord;
}
export interface RfqClmDeps extends ClmDeps {
  fields(doctype: string): Promise<ClmField[]>;
  decide?(input: RfqClmTransaction): Promise<{ created: boolean; request?: ClmRecord; contract?: ClmRecord }>;
}
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const present = (value: unknown) => value !== undefined && value !== null && (typeof value !== "string" || value.trim() !== "");
const rows = (value: unknown): ClmRecord[] => Array.isArray(value) ? value as ClmRecord[] : [];
function identity(value: unknown): string {
  let result = text(value);
  while (result.length >= 2 && ((result.startsWith('"') && result.endsWith('"')) || (result.startsWith("'") && result.endsWith("'")))) result = result.slice(1, -1).trim();
  return result;
}
const same = (left: unknown, right: unknown) => identity(left).toLocaleLowerCase() === identity(right).toLocaleLowerCase();
export const canInitiateRfqClm = (p: AccessPrincipal) => p.typ === "internal" && ["procurement", "procurement_team"].includes(p.role);
export const canReadRfqClm = (p: AccessPrincipal) => p.typ === "internal" && ["admin", "procurement", "procurement_team", "legal"].includes(p.role);
function assertReader(p: AccessPrincipal) {
  if (!canReadRfqClm(p)) throw new ClmError("Your role cannot access RFQ Contract information.", 403);
}
function assertProcurementTeam(p: AccessPrincipal) { if (!canInitiateRfqClm(p)) throw new ClmError("Only Procurement Manager or Procurement Team can record the RFQ contract decision or create CLM from its award.", 403); }
class Ineligible extends ClmError { constructor(message: string) { super(message, 409); } }
const selectedSteps = new Set(["Supplier Selected", "Pending Legal Review", "Legal Approved", "Pending Finance Review", "Finance Approved", "Approved for PO", "PO Created"]);
const blocked = (record: ClmRecord) => Number(record.docstatus) === 2 || [record.status, record.workflow_state, record.custom_workflow_step, record.review_status, record.finance_status].some(value => /^(cancelled|canceled|closed|stopped|rejected|legal rejected|finance rejected)$/i.test(text(value)));
const sourceFields = ["custom_rfq", "custom_supplier_quotation", "custom_purchase_order", "supplier", "company", "department", "contract_value", "estimated_contract_value", "currency", "custom_project", "custom_business_unit", "legal_review_required"];
const requiredSourceFields = ["custom_rfq", "custom_supplier_quotation", "supplier", "company", "contract_value", "currency"];
const defaultFields = new Set(["requester", "request_date", "request_status", "approval_status"]);
const convertibleRequest = (request: ClmRecord | undefined) => !!request && Number(request.docstatus) !== 2 && ["Draft", "Pending Review", "Approved"].includes(clmStatus("Contract Request", request));
function pendingTeamRequest(request: ClmRecord | undefined): boolean {
  if (!request || !convertibleRequest(request)) return false;
  const data = parseClmData(request.custom_clm_data);
  const route = data.rfq_request_workflow as ClmRecord | undefined;
  const source = data.rfq_source as ClmRecord | undefined;
  if (["rfq_created", "rfq_awarded"].includes(String(source?.stage))) return !!rfqClmRequestWorkflowView(request) && data.audit.some(row => row.action === "procurement_team_assigned" && row.by && row.at && ["procurement", "procurement_team", "admin"].includes(row.role || "") && ["Pending", "Pending Procurement Team"].includes(String(row.new_status)));
  return route?.version === 1 && route.phase === "procurement_team" && route.assigned_role === "procurement_team" &&
    source?.rfq === request.custom_rfq && !data.contract && data.approvals.length === 1 &&
    data.approvals[0].role === "procurement_team" && data.approvals[0].stage === 0 && data.approvals[0].status === "Pending" && !data.approvals[0].user &&
    data.audit.some(row => row.action === "procurement_team_assigned" && row.by && row.at && row.role === "procurement_team" && row.new_status === "Pending Procurement Team");
}
function routeRequestToTeam(document: ClmRecord, p: AccessPrincipal, at: string): ClmRecord {
  const data = parseClmData(document.custom_clm_data);
  if (data.rfq_request_workflow) throw new ClmError("The existing CLM request routing is inconsistent. Review its persisted assignment before retrying.", 409);
  if (data.approvals.length) throw new ClmError("The existing Contract Request has review evidence. Resolve its current review before routing it to Procurement Team.", 409);
  const by = p.typ === "internal" ? p.email || p.sub : p.sub;
  data.rfq_request_workflow = { version: 1, phase: "procurement_team", assigned_role: "procurement_team" };
  data.approvals = [{ id: randomUUID(), role: "procurement_team", stage: 0, rule: "RFQ Award: Procurement Team Processing", status: "Pending" }];
  data.audit.push({ id: randomUUID(), action: "procurement_team_assigned", by, role: "procurement_team", at, previous_status: clmStatus("Contract Request", document), new_status: "Pending Procurement Team", comment: "RFQ CLM request routed to Procurement Team for review and Contract creation.", reference_id: text(document.custom_rfq) });
  return { ...document, custom_clm_data: JSON.stringify(data) };
}

async function supplierReferenceMatches(reference: unknown, canonicalName: string, deps: ClmDeps): Promise<boolean> {
  const exact = text(reference);
  if (exact === canonicalName) return true;
  if (!exact || identity(exact) !== canonicalName) return false;
  // Only decode legacy display wrapping after proving it is not another real
  // Supplier DocName. Authoritative quotation links are never normalized.
  try { await deps.load("Supplier", exact); return false; }
  catch (error) { if (error instanceof ClmError && error.status === 404) return true; throw error; }
}
async function selectedSupplierName(reference: unknown, deps: ClmDeps): Promise<string> {
  const exact = text(reference);
  try { return text((await deps.load("Supplier", exact)).name); }
  catch (error) {
    if (!(error instanceof ClmError) || error.status !== 404 || identity(exact) === exact) throw error;
    return text((await deps.load("Supplier", identity(exact))).name);
  }
}
async function validateOptionalOrder(record: ClmRecord, deps: ClmDeps) {
  if (!text(record.custom_purchase_order)) return;
  const order = await deps.load("Purchase Order", text(record.custom_purchase_order));
  if (Number(order.docstatus) === 2 || order.supplier !== record.supplier || order.company && order.company !== record.company || !rows(order.items).some(row => row.supplier_quotation === record.custom_supplier_quotation)) throw new ClmError("The Purchase Order must belong to the winning quotation, Supplier and Company.", 403);
}

function persistedSelection(rfq: ClmRecord): ClmRecord {
  if (!rfq.custom_approval_data) return {};
  try {
    const data = typeof rfq.custom_approval_data === "string" ? JSON.parse(rfq.custom_approval_data) : rfq.custom_approval_data;
    if (!data || typeof data !== "object" || Array.isArray(data) || data.rfq && data.rfq !== rfq.name) throw new Error("mismatch");
    return data;
  } catch { throw new Ineligible("The saved RFQ selection evidence is invalid. Reconcile the supplier selection first."); }
}
function hasRfq(quotation: ClmRecord, rfq: string) {
  return [quotation, ...rows(quotation.items)].some(row => text(row.request_for_quotation) === rfq);
}
async function oneRequest(rfq: string, deps: ClmDeps): Promise<ClmRecord | undefined> {
  const found = await deps.list("Contract Request", [["custom_rfq", "=", rfq]]);
  if (found.length > 1) throw new ClmError("Multiple Contract Requests reference this RFQ. Reconcile the existing links before continuing.", 409);
  if (!found.length) return undefined;
  const request = await projectRfqRequestSubmission(await deps.load("Contract Request", text(found[0].name)), deps.load);
  if (request.custom_rfq !== rfq) throw new ClmError("The saved Contract Request RFQ reference is inconsistent.", 409);
  if (request.request_status === "Cancelled" && (parseClmData(request.custom_clm_data).rfq_request_workflow as ClmRecord | undefined)?.phase === "awaiting_supplier_award") return undefined;
  return request;
}
async function linkedContract(rfq: string, request: ClmRecord | undefined, deps: ClmDeps): Promise<ClmRecord | undefined> {
  const linked = await deps.list("Contract", [["custom_rfq", "=", rfq]]);
  if (request) linked.push(...await deps.list("Contract", [["custom_contract_request", "=", request.name]]));
  const names = new Set(linked.map(row => text(row.name)).filter(Boolean));
  const named = request ? text(parseClmData(request.custom_clm_data).contract) : "";
  if (named) names.add(named);
  if (names.size > 1) throw new ClmError("Multiple Contracts reference this RFQ. Review the existing Contract links.", 409);
  if (!names.size) return undefined;
  const contract = await deps.load("Contract", [...names][0]);
  if (contract.custom_rfq && contract.custom_rfq !== rfq || request && contract.custom_contract_request && contract.custom_contract_request !== request.name) throw new ClmError("The saved Contract source references are inconsistent.", 409);
  return contract;
}
function displayStatus(request?: ClmRecord, contract?: ClmRecord): string {
  if (contract) {
    const workflow = rfqClmWorkflowView(contract);
    if (workflow) return workflow.status;
    const status = clmStatus("Contract", contract);
    return ({ Draft: "Authoring", "Under Review": "Approval", "Pending Approval": "Approval", "Pending Signature": "E-Signature" } as Record<string, string>)[status] || status;
  }
  if (!request) return "Not Started";
  if (pendingTeamRequest(request)) return "Pending Procurement Team";
  const status = clmStatus("Contract Request", request);
  return ({ Draft: "Contract Request Created", "Pending Review": "Procurement Validation", "Under Legal Review": "Approval", "Pending Approval": "Approval", Approved: "Authoring" } as Record<string, string>)[status] || status;
}

interface Award { prefill: ClmRecord; review?: ClmRecord; quotation: ClmRecord; documents: RfqClmSourceDocument[]; warnings: string[]; source: ClmRecord; hasOrder: boolean }

async function awardDepartment(rfq: ClmRecord, quotation: ClmRecord, review: ClmRecord | undefined, company: string, deps: ClmDeps): Promise<string | undefined> {
  const direct = text(rfq.department) || text(rfq.custom_department) || text(review?.department) || text(quotation.department);
  const candidates = new Set<string>();
  if (direct) candidates.add(direct);
  else for (const name of new Set(rows(rfq.items).map(item => text(item.material_request)).filter(Boolean))) {
    let request: ClmRecord;
    try { request = await deps.load("Material Request", name); }
    catch (error) { if (error instanceof ClmError && [403, 404].includes(error.status)) return undefined; throw error; }
    if (Number(request.docstatus) === 2 || request.company && request.company !== company) continue;
    let department = text(request.department) || text(request.custom_department);
    if (!department) {
      const originName = extractSourceDepartmentMrName(request);
      if (originName) {
        try {
          const origin = await deps.load("Material Request", originName);
          if (Number(origin.docstatus) !== 2 && (!origin.company || origin.company === company)) {
            department = text(origin.department) || text(origin.custom_department);
          }
        } catch {}
      }
    }
    if (department) candidates.add(department);
  }
  if (candidates.size !== 1) return undefined;
  const candidate = [...candidates][0];
  try {
    const department = await deps.load("Department", candidate);
    if (!Number(department.disabled) && (!department.company || department.company === company)) return text(department.name);
    return undefined;
  } catch (error) { if (error instanceof ClmError && error.status === 403) return undefined; if (!(error instanceof ClmError) || error.status !== 404) throw error; }
  let departments: ClmRecord[];
  try { departments = await deps.list("Department", [["department_name", "=", candidate]]); }
  catch (error) { if (error instanceof ClmError && [403, 404].includes(error.status)) return undefined; throw error; }
  const matches = departments.filter(row => !Number(row.disabled) && (!row.company || row.company === company));
  return matches.length === 1 ? text(matches[0].name) : undefined;
}

const plainText = (value: unknown) => text(value).replace(/<br\s*\/?>|<\/(?:p|div|li)>/gi, "\n").replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").trim();

async function businessCaseSource(rfq: ClmRecord, deps: ClmDeps): Promise<ClmRecord> {
  if (text(rfq.custom_ecr_reference)) {
    const ecr = await deps.load("Engineering Change Request", text(rfq.custom_ecr_reference));
    let businessCase: ClmRecord = {};
    if (ecr.ecr_business_case) {
      try { businessCase = JSON.parse(String(ecr.ecr_business_case)); }
      catch { throw new Ineligible("The ECR Business Case source cannot be verified."); }
      if (businessCase.ecr_reference !== ecr.name) throw new Ineligible("The ECR Business Case source is inconsistent.");
    }
    return { ecr: ecr.name, ...(text(businessCase.business_case_id) ? { business_case: businessCase.business_case_id } : {}) };
  }
  // Some existing RFQs lack the optional back-link; read the established
  // Business Case references without querying optional/nonexistent fields.
  const cases = (await deps.list("Business Case")).filter(row => [row.rfq_id, row.custom_rfq_id, row.linked_rfq_id].includes(rfq.name));
  if (text(rfq.custom_business_case_id) && !cases.some(row => row.name === rfq.custom_business_case_id)) {
    const record = await deps.load("Business Case", text(rfq.custom_business_case_id));
    if (![record.rfq_id, record.custom_rfq_id, record.linked_rfq_id].includes(rfq.name)) throw new Ineligible("The Business Case and RFQ source links disagree.");
    cases.push(record);
  }
  if (cases.length > 1) throw new Ineligible("Multiple Business Cases reference this RFQ. Reconcile its source first.");
  return cases.length ? { business_case: cases[0].name } : {};
}
async function resolveAward(rfq: ClmRecord, deps: ClmDeps): Promise<Award> {
  const rfqName = text(rfq.name);
  if (Number(rfq.docstatus) !== 1) throw new Ineligible("A submitted RFQ and persisted supplier award are required before creating a Contract Request.");
  if (blocked(rfq)) throw new Ineligible("A cancelled, closed, stopped or rejected RFQ cannot initiate a Contract Request.");
  const selection = persistedSelection(rfq);
  if (blocked({ custom_workflow_step: selection.workflow_step })) throw new Ineligible("The RFQ selection was rejected. Resolve the existing review first.");
  const selected = text(rfq.custom_selected_supplier) || text(selection.selected_supplier);
  if (rfq.custom_selected_supplier && selection.selected_supplier && !same(rfq.custom_selected_supplier, selection.selected_supplier)) throw new Ineligible("The RFQ supplier selection records disagree. Reconcile the saved award first.");
  const reviews = await deps.list("Legal Document Review", [["rfq_name", "=", rfqName]]);
  if (reviews.length > 1) throw new Ineligible("The RFQ has ambiguous supplier selection reviews.");
  const review = reviews.length ? await deps.load("Legal Document Review", text(reviews[0].name)) : undefined;
  let quotation: ClmRecord;
  if (review) {
    if (blocked(review) || review.rfq_name !== rfqName || !text(review.sq_name) || !identity(review.supplier)) throw new Ineligible("The saved RFQ award review is unavailable or rejected.");
    if (selected && !same(selected, review.supplier)) throw new Ineligible("The selected Supplier differs from the saved RFQ award review.");
    quotation = await deps.load("Supplier Quotation", text(review.sq_name));
  } else {
    if (!selected || ![rfq.custom_workflow_step, selection.workflow_step].some(step => selectedSteps.has(text(step)))) throw new Ineligible("Select and persist the awarded supplier before creating the actual Contract.");
    const selectedName = await selectedSupplierName(selected, deps);
    const candidates = await deps.list("Supplier Quotation", [["Supplier Quotation Item", "request_for_quotation", "=", rfqName], ["supplier", "=", selectedName], ["docstatus", "=", 1]]);
    const active = text(rfq.custom_active_rfq_round);
    const eligible = await Promise.all([...new Set(candidates.map(row => text(row.name)).filter(Boolean))].map(name => deps.load("Supplier Quotation", name)));
    const names = eligible.filter(row => !active || !row.custom_rfq_round || row.custom_rfq_round === active).map(row => text(row.name));
    if (names.length !== 1) throw new Ineligible("A single winning Supplier Quotation must be identified before initiating the Contract Request.");
    quotation = await deps.load("Supplier Quotation", names[0]);
  }
  const supplierName = text(quotation.supplier);
  if (Number(quotation.docstatus) !== 1 || blocked(quotation) || !hasRfq(quotation, rfqName) || !supplierName || text(rfq.custom_active_rfq_round) && quotation.custom_rfq_round && quotation.custom_rfq_round !== rfq.custom_active_rfq_round) throw new Ineligible("The winning Supplier Quotation must be submitted and belong to this RFQ and its current award round.");
  for (const roundName of new Set([text(rfq.custom_active_rfq_round), text(quotation.custom_rfq_round)].filter(Boolean))) {
    const round = await deps.load("RFQ Round", roundName);
    if (round.rfq !== rfqName || Number(round.docstatus) === 2 || /^(cancelled|canceled)$/i.test(text(round.status))) throw new Ineligible("The awarded quotation round must belong to this RFQ and must not be cancelled.");
  }
  for (const reference of [review?.supplier, rfq.custom_selected_supplier, selection.selected_supplier].filter(present)) if (!await supplierReferenceMatches(reference, supplierName, deps)) throw new Ineligible("The winning Supplier Quotation must belong to the selected Supplier without ambiguous identities.");
  const company = text(rfq.company) || text(quotation.company);
  if (!company || quotation.company && quotation.company !== company || review?.company && review.company !== company) throw new Ineligible("The RFQ, award review and winning quotation must belong to the same Company.");
  const supplier = await deps.load("Supplier", supplierName);
  if (!supplier.name || Number(supplier.disabled) === 1) throw new Ineligible("The selected Supplier must be active.");
  let rawValue: unknown;
  if (review) {
    try { rawValue = persistedRfqAwardValue(review, quotation).amount; }
    catch (error) { if (error instanceof ClmError) throw new Ineligible(error.message); throw error; }
  } else rawValue = present(rfq.custom_selected_supplier_total) ? rfq.custom_selected_supplier_total : present(selection.selected_supplier_total) ? selection.selected_supplier_total : quotation.grand_total;
  const value = Number(rawValue);
  if (!present(rawValue) || !Number.isFinite(value) || value < 0 || !text(quotation.currency)) throw new Ineligible("The saved award must include a valid value and quotation currency.");
  const orders = await deps.list("Purchase Order", [["Purchase Order Item", "supplier_quotation", "=", quotation.name], ["docstatus", "!=", 2]]);
  const validOrders: ClmRecord[] = [];
  for (const name of new Set(orders.map(row => text(row.name)).filter(Boolean))) {
    const order = await deps.load("Purchase Order", name);
    if (Number(order.docstatus) !== 2 && order.supplier === supplier.name && (!order.company || order.company === company) && rows(order.items).some(row => row.supplier_quotation === quotation.name)) validOrders.push(order);
  }
  const department = await awardDepartment(rfq, quotation, review, company, deps);
  const supplierLabel = text(supplier.supplier_name) || text(supplier.name);
  const purpose = `Procurement of goods/services from ${supplierLabel} under RFQ ${rfqName}.`;
  const scope = plainText(rfq.message_for_supplier) || plainText(rfq.description) || plainText(rfq.title);
  const itemScope = rows(quotation.items).map(item => {
    const label = text(item.item_name) || text(item.item_code);
    return label ? `${label}${present(item.qty) ? ` — ${item.qty}${text(item.uom) ? ` ${text(item.uom)}` : ""}` : ""}` : "";
  }).filter(Boolean).join("\n");
  const description = [purpose, `Award: ${text(review?.name) || text(quotation.name)}\nWinning Quotation: ${quotation.name}\nAward Value: ${quotation.currency} ${value.toLocaleString("en-US", { maximumFractionDigits: 6 })}\nCompany: ${company}${department ? `\nDepartment: ${department}` : ""}`, scope && `RFQ scope:\n${scope}`, itemScope && `Awarded items:\n${itemScope}`].filter(Boolean).join("\n\n");
  const sourceLinks = await businessCaseSource(rfq, deps);
  let approvedEstimate: number | undefined;
  if (sourceLinks.business_case) {
    const businessCase = await deps.load("Business Case", String(sourceLinks.business_case));
    const estimate = present(businessCase.estimated_budget) ? businessCase.estimated_budget : businessCase.budget;
    if (businessCase.approval_status === "Approved" && businessCase.currency === quotation.currency && present(estimate) && Number.isFinite(Number(estimate)) && Number(estimate) >= 0) approvedEstimate = Number(estimate);
  }
  const prefill: ClmRecord = {
    custom_rfq: rfqName, custom_supplier_quotation: quotation.name, supplier: supplier.name, company,
    contract_value: value, estimated_contract_value: approvedEstimate, currency: quotation.currency,
    custom_purchase_order: validOrders.length === 1 ? validOrders[0].name : undefined,
    custom_project: rfq.project || rfq.custom_project || quotation.project || (validOrders.length === 1 ? validOrders[0].project : undefined),
    custom_business_unit: rfq.custom_business_unit || rfq.business_unit || quotation.custom_business_unit,
    department, contract_purpose: purpose, description, legal_review_required: 1,
    payment_terms: review?.payment_terms || quotation.payment_terms_template,
  };
  const { documents, warnings } = await collectRfqAwardDocuments({
    rfq,
    quotation,
    review,
    supplier,
    po: validOrders.length === 1 ? validOrders[0] : undefined,
  }, deps);
  const source = { ...sourceLinks, award: review?.name || quotation.name, quotation: quotation.name, supplier: supplier.name, company, department, amount: value, currency: quotation.currency, ...(approvedEstimate !== undefined ? { approved_estimated_value: approvedEstimate } : {}) };
  return { prefill: Object.fromEntries(Object.entries(prefill).filter(([, value]) => present(value))), quotation, review, documents, source, hasOrder: validOrders.length > 0, warnings: [...warnings, ...(validOrders.length > 1 ? ["Multiple Purchase Orders reference this award. Their existing quotation links remain available; no single Purchase Order was assumed."] : [])] };
}
/** Optional at RFQ intake; once selection exists, all authoritative award checks apply. */
export async function resolveAvailableRfqAward(rfq: ClmRecord, deps: ClmDeps & Partial<Pick<RfqClmDeps, "fields">>): Promise<Award | undefined> {
  if (blocked(rfq)) throw new Ineligible("A cancelled, closed, stopped or rejected RFQ cannot initiate a Contract Request.");
  const selection = persistedSelection(rfq);
  const selected = text(rfq.custom_selected_supplier) || text(selection.selected_supplier);
  const selectedStage = [rfq.custom_workflow_step, selection.workflow_step].some(step => selectedSteps.has(text(step)));
  if ((!selected || !selectedStage) && !(await deps.list("Legal Document Review", [["rfq_name", "=", rfq.name]])).length) return undefined;
  return resolveAward(rfq, deps);
}

export function rfqContractDecision(rfq: ClmRecord): ClmRecord | undefined {
  const raw = persistedSelection(rfq).contract_decision;
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw) || !["Yes", "No"].includes(String(raw.decision)) || !text(raw.quotation) || !text(raw.by) || !text(raw.at)) throw new ClmError("The RFQ contract decision evidence is invalid.", 409);
  if (rfq.contract_required !== raw.decision) throw new ClmError("The RFQ contract requirement and saved decision disagree.", 409);
  return raw;
}

function executedContract(contract: ClmRecord | undefined): boolean {
  if (!contract || Number(contract.docstatus) === 2 || !["Executed", "Active"].includes(clmStatus("Contract", contract))) return false;
  const data = parseClmData(contract.custom_clm_data);
  return rfqClmFinanceApproved(contract) && !!contract.custom_executed_contract && Number(contract.custom_final_version_locked) === 1 &&
    // The Contract workflow validates Legal's signature and Finance approval.
    // An optional supplier signature must not add a second procurement gate.
    !!data.version && data.locked_hash === clmSnapshotHash("Contract", contract) && data.approvals.length > 0 && data.approvals.every(row => row.status === "Approved");
}

export async function resolveDesignatedLegalSignatory(
  deps: Pick<ClmDeps, "load" | "list">
): Promise<LegalSignatoryResolution> {
  let userRows: ClmRecord[] = [];
  try {
    userRows = await deps.list("User", [["enabled", "=", 1]]);
    if (!userRows.length) userRows = await deps.list("User", []);
  } catch {
    userRows = [];
  }
  const eligible_signatories: LegalManagerSignatoryUser[] = [];
  const seenUsers = new Set<string>();

  for (const row of userRows) {
    if (row.enabled !== undefined && Number(row.enabled) !== 1) continue;
    let user = row;
    if (!Array.isArray(user.roles)) {
      try {
        user = await deps.load("User", text(row.name));
      } catch {
        // use row as is
      }
    }
    const roles = Array.isArray(user.roles) ? (user.roles as ClmRecord[]).map(r => text(r.role)) : [];
    const role = resolveServerRole({
      name: text(user.name),
      email: text(user.email || user.name),
      erpnext_roles: roles,
    });
    if (role === "legal") {
      const name = text(user.name);
      if (!seenUsers.has(name.toLowerCase())) {
        seenUsers.add(name.toLowerCase());
        eligible_signatories.push({
          name,
          email: text(user.email || user.name),
          full_name: text(user.full_name || user.first_name || user.name),
        });
      }
    }
  }

  // Check approval matrix rules
  let rules: ClmRecord[] = [];
  try {
    rules = await deps.list("Contract Approval Matrix", [["active", "=", 1]]);
  } catch {
    rules = [];
  }
  for (const rule of rules) {
    let parsed: unknown = rule.custom_approval_stages;
    if (typeof parsed === "string" && parsed.trim()) {
      try { parsed = JSON.parse(parsed); } catch { /* ignore */ }
    }
    if (Array.isArray(parsed)) {
      for (const stage of parsed) {
        if (stage && typeof stage === "object" && text(stage.role) === "legal" && text(stage.user)) {
          const designated = text(stage.user).toLowerCase();
          const matched = eligible_signatories.find(
            u => u.name.toLowerCase() === designated || u.email.toLowerCase() === designated
          );
          if (matched) {
            return {
              signatory: matched,
              eligible_signatories,
              source: "workflow_matrix",
            };
          }
        }
      }
    }
  }

  if (eligible_signatories.length === 1) {
    return {
      signatory: eligible_signatories[0],
      eligible_signatories,
      source: "unique_role",
    };
  }

  if (eligible_signatories.length === 0) {
    return {
      eligible_signatories: [],
      source: "none",
      error: "No active Legal Manager is configured in the system. An authorized administrator must configure a Legal Manager before creating a contract.",
    };
  }

  return {
    eligible_signatories,
    source: "unresolved",
    error: "Multiple eligible Legal Managers are configured, but no designated signatory is specified in the approval workflow. An authorized administrator must configure the assignment.",
  };
}

async function snapshot(p: AccessPrincipal, rfqName: string, deps: RfqClmDeps) {
  assertReader(p);
  if (!text(rfqName)) throw new ClmError("An RFQ reference is required.", 400);
  const rfq = await deps.load("Request for Quotation", rfqName);
  if (rfq.name !== rfqName) throw new ClmError("RFQ not found.", 404);
  const request = await oneRequest(rfqName, deps);
  const contract = await linkedContract(rfqName, request, deps);
  const decision = rfqContractDecision(rfq);
  const operation = persistedSelection(rfq).clm_rest_operation as ClmRecord | undefined;
  const awardIntent = rfqRestData(persistedSelection(rfq).clm_award_intent);
  const pendingAwardDecision = awardIntent.version === 1 && awardIntent.phase === "saving";
  const initialRequest = isInitialRfqRequest(request);
  let recovering = operation?.version === 1 && (operation.phase === "saving" || !!operation.pending_insert);
  if ((request || contract) && rfq.contract_required !== "Yes") throw new ClmError("The RFQ contract requirement conflicts with its linked CLM record. Reconcile its saved source before proceeding.", 409);
  if (decision?.decision === "No" && (request || contract)) throw new ClmError("This RFQ has a No Contract decision and a linked CLM record. Reconcile the conflicting records.", 409);
  const contractWorkflow = contract ? rfqClmWorkflowView(contract) : undefined;
  const summary: RfqClmSummary = { rfq: { name: rfqName, modified: text(rfq.modified) }, contract_required: request || contract || rfq.contract_required === "Yes" ? "Yes" : "No", decision: decision ? decision.decision as "Yes" | "No" : request || contract ? "Yes" : "Pending", can_decide: false, blocks_procurement: true, continuation_ready: false, eligible: false, reason: "", can_create: false, status: displayStatus(request, contract), request: request ? { name: text(request.name), status: clmStatus("Contract Request", request) } : undefined, contract: contract ? { name: text(contract.name), status: clmStatus("Contract", contract), phase: contractWorkflow?.phase, stage: contractWorkflow?.stage } : undefined, can_open_request: !!request && canReadClm(p, "Contract Request", request), can_open_contract: !!contract && canReadClm(p, "Contract", contract), prefill: {}, required_fields: [], locked_fields: [], source_documents: [], warnings: [] };
  if (recovering || pendingAwardDecision) summary.recovery_required = true;
  summary.rfq.docstatus = rfq.docstatus == null ? undefined : Number(rfq.docstatus);
  summary.rfq.status = text(rfq.status);
  if (Number(rfq.docstatus) === 0) {
    summary.status = "Awaiting Supplier Award";
    summary.can_request = false;
    summary.reason = "The RFQ's Contract Required choice is saved. A Contract Request is created only after supplier award when that saved choice is Yes.";
    if (summary.request && initialRequest) { summary.request.status = "Draft-originated"; summary.request.current_stage = "Awaiting RFQ Submission"; }
    return { rfq, request, contract, summary, award: undefined as Award | undefined };
  }
  let award: Award | undefined;
  if (summary.request && pendingTeamRequest(request)) {
    summary.request.assigned_role = "procurement_team";
    summary.request.current_stage = rfqClmRequestWorkflowView(request!)?.stage || "Pending Procurement Team";
    if (initialRequest) { summary.status = "Pending"; summary.request.status = "Pending"; }
  }
  try {
      award = await resolveAvailableRfqAward(rfq, deps);
      if (!award?.review) {
        summary.can_request = false;
        summary.status = "Awaiting Supplier Award";
        summary.reason = "The saved Contract Required choice stays with this RFQ during sourcing. No Contract Request is created before supplier award.";
        return { rfq, request, contract, summary, award };
      }
      summary.eligible = true;
      summary.source = award.source;
      if (decision && (decision.quotation !== award.quotation.name || decision.legal_review && decision.legal_review !== award.review?.name)) throw new Ineligible("The saved contract decision belongs to a different supplier award.");
      if (decision?.contract && decision.contract !== contract?.name) throw new Ineligible("The saved contract decision belongs to a different CLM Contract.");
      if (decision && (present(decision.supplier) && decision.supplier !== award.prefill.supplier || present(decision.amount) && Number(decision.amount) !== Number(award.prefill.contract_value) || present(decision.currency) && decision.currency !== award.prefill.currency)) throw new Ineligible("The supplier award value or currency changed after the contract decision.");
      if (request && (request.custom_supplier_quotation !== award.quotation.name || request.supplier !== award.prefill.supplier) || contract && (contract.custom_supplier_quotation !== award.quotation.name || (contract.custom_supplier || contract.party_name) !== award.prefill.supplier)) throw new Ineligible("The linked CLM no longer matches the RFQ award.");
      if (request && (request.company !== award.prefill.company || Number(request.contract_value) !== Number(award.prefill.contract_value) || request.currency !== award.prefill.currency) || contract && (Number(contract.custom_contract_value) !== Number(award.prefill.contract_value) || contract.custom_currency !== award.prefill.currency)) throw new Ineligible("The linked CLM value, currency or Company no longer matches the RFQ award.");
      const context = contract ? parseClmData(contract.custom_clm_data).rfq_context as ClmRecord | undefined : undefined;
      if (context && (context.rfq_id !== rfqName || context.award_id !== award.source.award || context.supplier_id !== award.prefill.supplier || context.quotation_id !== award.quotation.name || context.contract_required !== "Yes" || context.contract_type !== contract!.custom_contract_type || context.contract_status !== clmStatus("Contract", contract!))) throw new Ineligible("The Contract's permanent RFQ award context is inconsistent.");
      if (contract && parseClmData(contract.custom_clm_data).persistence === "erpnext_rest_v1") {
        const contractData = parseClmData(contract.custom_clm_data);
        const mirror = decision?.clm as ClmRecord | undefined;
        let awardMirror: ClmRecord | undefined;
        try { awardMirror = award.review?.custom_clm_state ? JSON.parse(String(award.review.custom_clm_state)) : undefined; } catch { /* Incomplete mirror remains blocked and recoverable. */ }
        const matches = (value: ClmRecord | undefined) => value?.contract === contract.name && value?.status === clmStatus("Contract", contract) && value?.phase === contractData.rfq_workflow?.phase && value?.contract_required === "Yes" && value?.blocked === !executedContract(contract);
        if (!matches(mirror) || award.review && (!matches(awardMirror) || awardMirror?.rfq_id !== rfqName || awardMirror?.award_id !== award.review.name)) {
          recovering = true; summary.recovery_required = true;
        }
      }
      const historicalOrder = !decision && !request && !contract && rfq.contract_required !== "Yes" && award.hasOrder;
      summary.continuation_ready = !recovering && (summary.decision === "No" || executedContract(contract) || historicalOrder);
      summary.blocks_procurement = !summary.continuation_ready;
      summary.can_decide = summary.decision === "Pending" && ["Yes", "No"].includes(String(rfq.contract_required)) && !historicalOrder && canInitiateRfqClm(p);
      summary.can_request = summary.can_decide && rfq.contract_required === "Yes" || summary.decision === "Yes" && !contract && convertibleRequest(request) && !parseClmData(request?.custom_clm_data).rfq_request_workflow && canInitiateRfqClm(p);
      summary.can_create = summary.decision === "Yes" && !contract && pendingTeamRequest(request) && canInitiateRfqClm(p);
      if (initialRequest) { summary.request_needs_details = true; summary.can_request = canInitiateRfqClm(p); summary.can_create = false; }
      if (recovering) {
        if (!operation || operation.decision !== summary.decision && summary.decision !== "Pending" || operation.quotation !== award.quotation.name || operation.award !== award.source.award || operation.supplier !== award.prefill.supplier) throw new Ineligible("The unfinished CLM save belongs to a different decision or award. Inspect its saved source before continuing.");
        summary.can_request = operation.decision === "Yes" && operation.operation === "request" && !contract && canInitiateRfqClm(p);
        summary.can_create = operation.decision === "Yes" && (operation.operation === "create_contract" || !!contract) && !!request && canInitiateRfqClm(p);
        summary.can_decide = operation.decision === "No" && canInitiateRfqClm(p);
      }
      if (summary.decision === "Pending") { summary.status = historicalOrder ? "Existing Purchase Order" : "Award Handoff Pending"; summary.reason = historicalOrder ? "This existing purchase order predates the contract decision step." : "Complete the award handoff using this RFQ's saved Contract Required choice."; }
      if (summary.decision === "Pending" && !historicalOrder && !["Yes", "No"].includes(String(rfq.contract_required))) { summary.status = "Contract Requirement Missing"; summary.reason = "The saved RFQ has no valid Contract Required choice. Verify its source before continuing the award handoff."; }
      else if (summary.decision === "No") { summary.status = "Not Required"; summary.reason = "No contract is required. Continue the existing RFQ workflow."; }
      else summary.reason = !contract ? pendingTeamRequest(request) ? "Pending Procurement Team. The team must review and create the Contract before Legal review can start." : "The saved Contract Request needs its Procurement Team assignment recorded before Contract creation." : summary.continuation_ready ? "Contract executed and Finance approved. Continue the existing procurement process." : "Complete Legal review, e-signature and Finance approval for the linked CLM before creating a purchase order.";
      if (recovering) summary.reason = "The previous CLM save is incomplete. Retry the same action to resume the persisted records; procurement remains blocked.";
      if (summary.can_create || summary.can_request) {
        // A prior request-only transaction is provenance, not a completed CLM
        // creation. Convert its saved terms once through the same ERP transaction.
        summary.prefill = request ? Object.fromEntries(clmEditableFields("Contract Request").filter(field => present(request[field])).map(field => [field, request[field]])) : { ...award.prefill };
        summary.source_documents = award.documents; summary.warnings = award.warnings;
        summary.locked_fields = request ? clmEditableFields("Contract Request").filter(field => present(request[field])) : sourceFields.filter(field => requiredSourceFields.includes(field) || present(award!.prefill[field]));
        if (initialRequest) {
          // Editable draft terms survive refresh; award value/currency remain
          // authoritative source fields for the separate creation validation.
          summary.locked_fields = sourceFields.filter(field => requiredSourceFields.includes(field) || present(award!.prefill[field]));
          summary.prefill = { ...summary.prefill, ...award.prefill, ...Object.fromEntries(Object.entries(rfqRequestDraftValues(request!)).filter(([field]) => !summary.locked_fields.includes(field))) };
        }
        const fields = await deps.fields("Contract Request");
        summary.required_fields = fields.filter(field => Number(field.reqd) === 1 && !defaultFields.has(field.fieldname) && !present(summary.prefill[field.fieldname])).map(field => field.fieldname);
        try {
          const legalResolution = await resolveDesignatedLegalSignatory(deps);
          summary.designated_legal_signatory = legalResolution;
        } catch { /* ignore */ }
      }
  } catch (error) { if (!(error instanceof Ineligible)) throw error; summary.reason = error.message; summary.eligible = false; summary.can_decide = false; summary.can_request = false; summary.can_create = false; summary.blocks_procurement = true; summary.continuation_ready = false; }
  if (initialRequest && !award) summary.reason = "A saved supplier award is required before a Contract Request can enter Procurement.";
  if (request && canInitiateRfqClm(p) && award) { summary.source_documents = award.documents; summary.warnings = award.warnings; }
  if (contract?.custom_inteva_signatory && !summary.designated_legal_signatory) {
    try {
      const legalResolution = await resolveDesignatedLegalSignatory(deps);
      const existingName = text(contract.custom_inteva_signatory);
      const matched = legalResolution.eligible_signatories.find(
        u => u.name.toLowerCase() === existingName.toLowerCase() || u.email.toLowerCase() === existingName.toLowerCase()
      );
      if (matched) {
        legalResolution.signatory = matched;
        legalResolution.source = "workflow_matrix";
      } else {
        try {
          const u = await deps.load("User", existingName);
          legalResolution.signatory = {
            name: text(u.name),
            email: text(u.email || u.name),
            full_name: text(u.full_name || u.first_name || u.name),
          };
        } catch {
          legalResolution.signatory = { name: existingName, email: existingName, full_name: existingName };
        }
      }
      summary.designated_legal_signatory = legalResolution;
    } catch { /* ignore */ }
  }
  if (pendingAwardDecision) {
    summary.can_request = false; summary.can_create = false; summary.can_decide = !!award?.review && canInitiateRfqClm(p);
    summary.blocks_procurement = true; summary.continuation_ready = false;
    summary.reason = "The saved award's Contract Required decision is incomplete. Retry the same award decision to verify its existing Request before preparing a Contract.";
  }
  return { rfq, request, contract, summary, award };
}
export async function getRfqClmSummary(p: AccessPrincipal, rfq: string, deps: RfqClmDeps): Promise<RfqClmSummary> { return (await snapshot(p, rfq, deps)).summary; }

/** This gate is in addition to the existing RFQ Legal/Finance checks. */
export async function assertRfqClmReadyForProcurement(rfq: string, deps: ClmDeps, options: { allowHistoricalOrder?: boolean } = {}): Promise<void> {
  const reader = { typ: "internal", role: "procurement_team", sub: "rfq-readiness", iat: 0, exp: 0 } as AccessPrincipal;
  const state = await snapshot(reader, rfq, { ...deps, fields: async () => [] });
  if (!state.summary.continuation_ready || state.summary.decision === "Pending" && !options.allowHistoricalOrder) throw new ClmError(state.summary.decision === "Pending" ? "Record the RFQ contract decision before continuing." : state.summary.reason || "Complete the required CLM before proceeding.", 409);
}

function transactionInput(p: AccessPrincipal, state: Awaited<ReturnType<typeof snapshot>>, decision: "Yes" | "No"): RfqClmTransaction {
  const award = state.award!;
  return { rfq: text(state.rfq.name), expected_modified: text(state.rfq.modified), decision,
    actor: { id: p.typ === "internal" ? p.email || p.sub : p.sub, role: p.typ === "internal" ? p.role : "supplier" },
    award: { ...award.source, quotation: award.quotation.name, quotation_modified: award.quotation.modified,
      legal_review: award.review?.name, legal_review_modified: award.review?.modified,
      supplier: award.prefill.supplier, amount: award.prefill.contract_value, currency: award.prefill.currency },
  };
}

export async function decideRfqContractRequirement(p: AccessPrincipal, input: { rfq: string; expected_modified?: string; decision: "Yes" | "No"; operation?: "request" | "create_contract"; payload?: ClmRecord; contract_fields?: ClmRecord }, deps: RfqClmDeps): Promise<RfqClmDecisionResult> {
  assertProcurementTeam(p);
  if (!["Yes", "No"].includes(input.decision)) throw new ClmError("Contract Required must be Yes or No.", 400);
  const sourceRfq = await deps.load("Request for Quotation", text(input.rfq));
  if (sourceRfq.contract_required !== input.decision) throw new ClmError("Use the RFQ's saved Contract Required choice. The award handoff cannot change it.", 409);
  if (input.decision === "Yes") return input.operation === "create_contract" ? createRfqContractRequest(p, input, deps) : recordRfqContractRequest(p, input, deps);
  if (input.decision !== "No") throw new ClmError("Choose Yes or No for Contract / CLM Required.", 400);
  if (input.operation === "create_contract") throw new ClmError("No Contract cannot create a Contract.", 400);
  if (input.payload && Object.keys(input.payload).length) throw new ClmError("No Contract must not include Contract Request fields.", 400);
  if (input.contract_fields && Object.keys(input.contract_fields).length) throw new ClmError("No Contract must not include Contract review fields.", 400);
  const state = await snapshot(p, text(input.rfq), deps);
  if (state.summary.decision === "No" && state.summary.eligible && !state.summary.recovery_required) return { created: false, summary: state.summary };
  if (!state.summary.can_decide || !state.award) throw new ClmError(state.summary.reason || "A contract decision has already been recorded.", 409);
  if (!input.expected_modified || input.expected_modified !== state.rfq.modified && !state.summary.recovery_required) throw new ClmError("The RFQ changed. Refresh its award before recording the contract decision.", 409);
  if (!deps.decide) throw new ClmError("The ERPNext CLM persistence service is not configured.", 503);
  try { await deps.decide(transactionInput(p, state, "No")); }
  catch (error) {
    const fresh = await snapshot(p, text(input.rfq), deps);
    if (fresh.summary.decision !== "No" || !fresh.summary.eligible || fresh.summary.recovery_required) throw error;
  }
  const summary = await getRfqClmSummary(p, text(input.rfq), deps);
  if (summary.decision !== "No" || summary.request || summary.contract) throw new ClmError("ERPNext did not persist the No Contract decision. Refresh before retrying.", 409);
  return { created: false, summary };
}

/** Generic authoring cannot sidestep the award gate or detach a unique source. */
export async function guardRfqContractRequestSave(input: ClmActionInput, p: AccessPrincipal, deps: ClmDeps): Promise<void> {
  if (!["Contract Request", "Contract"].includes(input.doctype) || !["save", "submit", "create_contract", "submit_review", "new_version"].includes(input.action)) return;
  const payload = input.payload || {};
  const current = input.name ? await deps.load(input.doctype, input.name) : undefined;
  const requestName = text(current?.custom_contract_request) || text(payload.custom_contract_request);
  const request = input.doctype === "Contract" && requestName ? await deps.load("Contract Request", requestName) : undefined;
  const original = text(current?.custom_rfq) || text(request?.custom_rfq);
  if ((!current || !original) && (original || text(payload.custom_rfq))) throw new ClmError("Create Contract from its RFQ Award and linked Contract Request to preserve the selected supplier and award.", 403);
  if (!original) return;
  if (input.action === "create_contract") assertProcurementTeam(p);
  if (!canReadClm(p, input.doctype, current!)) throw new ClmError("You cannot edit this Contract record.", 403);
  const evidence = parseClmData(current!.custom_clm_data).rfq_source as ClmRecord | undefined;
  // New requests record which optional values actually came from the award.
  // Without that evidence, preserve existing linked references conservatively.
  const locked = Array.isArray(evidence?.locked_fields)
    ? evidence.locked_fields.filter((field): field is string => typeof field === "string" && sourceFields.includes(field))
    : sourceFields.filter(field => present(current?.[field]));
  const contractFields: Record<string, string> = { supplier: "custom_supplier", contract_value: "custom_contract_value", currency: "custom_currency", legal_review_required: "custom_legal_review_required" };
  const converting = input.doctype === "Contract Request" && input.action === "create_contract";
  for (const field of new Set([...requiredSourceFields, ...locked])) {
    if (field === "estimated_contract_value" && (input.doctype === "Contract" || converting)) continue;
    const key = input.doctype === "Contract" || converting ? contractFields[field] || field : field;
    if (Object.prototype.hasOwnProperty.call(payload, key) && String(payload[key] ?? "") !== String(current?.[converting ? field : key] ?? "")) throw new ClmError("RFQ source and award information cannot be changed or detached from this Contract record.", 403);
  }
  if (input.doctype === "Contract" || converting) {
    const expected = { party_type: "Supplier", party_name: converting ? current!.supplier : current!.party_name, custom_contract_request: converting ? current!.name : current!.custom_contract_request };
    for (const [key, value] of Object.entries(expected)) if (Object.prototype.hasOwnProperty.call(payload, key) && payload[key] !== value) throw new ClmError("Contract creation must preserve its RFQ Award and Contract Request.", 403);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "custom_purchase_order")) await validateOptionalOrder({ ...current, ...payload, supplier: converting ? current!.supplier : input.doctype === "Contract" ? current!.custom_supplier || current!.party_name : current!.supplier }, deps);
  // Recheck the award and saved Yes decision before authoring or submission;
  // the final PO gate independently checks execution/signature evidence.
  const state = await snapshot(p, original, { ...deps, fields: async () => [] });
  if (state.summary.decision !== "Yes" || !state.summary.eligible || (input.doctype === "Contract Request" ? state.request?.name !== current!.name : state.contract?.name !== current!.name)) throw new ClmError(state.summary.reason || "The Contract must remain linked to the current RFQ Award with Contract Required = Yes.", 409);
}

type RfqRequestInput = { rfq: string; expected_modified?: string; payload?: ClmRecord; contract_fields?: ClmRecord };
export async function recordRfqContractRequest(p: AccessPrincipal, input: RfqRequestInput, deps: RfqClmDeps): Promise<RfqClmCreateResult> {
  return processRfqContractRequest(p, input, deps, false);
}
export async function createRfqContractRequest(p: AccessPrincipal, input: RfqRequestInput, deps: RfqClmDeps): Promise<RfqClmCreateResult> {
  return processRfqContractRequest(p, input, deps, true);
}
async function processRfqContractRequest(p: AccessPrincipal, input: RfqRequestInput, deps: RfqClmDeps, createContract: boolean): Promise<RfqClmCreateResult> {
  assertProcurementTeam(p);
  const state = await snapshot(p, text(input.rfq), deps);
  if (state.rfq.contract_required !== "Yes") throw new ClmError("A Contract Request requires the RFQ's saved Contract Required choice to be Yes.", 409);
  if (!createContract && isInitialRfqRequest(state.request) && state.award) {
    if (!state.summary.can_request || !input.expected_modified || input.expected_modified !== state.rfq.modified) throw new ClmError("Refresh the RFQ award before completing this Contract Request.", 409);
    const draft = rfqRequestDraftValues(state.request!);
    const omittedDraftConflicts = ["contract_value", "estimated_contract_value", "currency"].filter(field => Object.hasOwn(draft, field) && !Object.hasOwn(input.payload || {}, field) &&
      state.summary.locked_fields.includes(field) && String(draft[field] ?? "") !== String(state.summary.prefill[field] ?? ""));
    if (omittedDraftConflicts.length) {
      const labels: Record<string, string> = { contract_value: "Contract Value", estimated_contract_value: "Estimated Contract Value", currency: "Currency" };
      throw new ClmError(`Open Contract Request ${state.request!.name} and reconcile ${omittedDraftConflicts.map(field => labels[field]).join(", ")} with the saved RFQ award before preparing this request. Your saved draft has not been changed.`, 403);
    }
    const rawPayload = { ...draft, ...(input.payload || {}) };
    const { custom_inteva_signatory: _omittedSignatory, ...payload } = rawPayload;
    const allowed = new Set(clmEditableFields("Contract Request"));
    for (const [field, value] of Object.entries(payload)) {
      if (!allowed.has(field) || ["supporting_document", "additional_documents"].includes(field) && present(value)) throw new ClmError(`The ${field} field cannot be supplied for RFQ Contract Request preparation.`, 403);
      if (state.summary.locked_fields.includes(field) && String(value ?? "") !== String(state.summary.prefill[field] ?? "")) throw new ClmError("Preserve the verified RFQ award source information.", 403);
    }
    const prepared = { ...state.request, ...state.summary.prefill, ...payload };
    const errors = validateRfqContractDetails(prepared);
    const missing = ["department", "company", "supplier", "contract_value", "currency", "estimated_contract_value"].filter(field => !present(prepared[field]));
    if (Object.keys(errors).length || missing.length) throw new ClmError([...Object.values(errors), ...missing.map(field => `${field.replaceAll("_", " ")} is required.`)].join(" "), 422);
    await validateOptionalOrder(prepared, deps);
    const data = parseClmData(prepared.custom_clm_data);
    data.rfq_source = { ...state.award.source, stage: (data.rfq_source as ClmRecord)?.stage || "rfq_awarded", prepared: true, rfq: state.rfq.name, contract_required: true, quotation: state.award.quotation.name, quotation_modified: state.award.quotation.modified, legal_review: state.award.review?.name, locked_fields: state.summary.locked_fields };
    data.source_documents = state.award.documents;
    data.audit.push({ id: randomUUID(), action: "prepare_rfq_request", by: p.typ === "internal" ? p.email || p.sub : p.sub, role: p.typ === "internal" ? p.role : "", at: deps.now(), previous_status: "Pending", new_status: "Pending", comment: "Procurement completed the saved request using the verified supplier award.", reference_id: text(state.award.source.award) });
    const transaction = transactionInput(p, state, "Yes");
    const intended = { ...prepared, custom_clm_data: JSON.stringify(data) };
    const verificationPayload = Object.fromEntries(Object.entries(intended).filter(([key]) => clmEditableFields("Contract Request").includes(key) || ["custom_clm_data", "request_status", "approval_status", "requester", "request_date"].includes(key)));
    const reserved = await updateRfqClmRecord(deps, "Request for Quotation", input.rfq, current => {
      const runtime = rfqRestData(current.custom_approval_data), operation = rfqRestData(runtime.clm_rest_operation);
      if (current.contract_required !== "Yes" || current.modified !== state.rfq.modified) throw new ClmError("The RFQ changed. Refresh before completing request details.", 409);
      if (operation.version === 1) {
        if (operation.award !== transaction.award.award || operation.quotation !== transaction.award.quotation || operation.supplier !== transaction.award.supplier) throw new ClmError("The pending request preparation belongs to another award.", 409);
        if (operation.pending_insert) return undefined;
      }
      runtime.clm_rest_operation = { ...operation, version: 1, operation: "request", phase: "saving", decision: "Yes", award: transaction.award.award, quotation: transaction.award.quotation, supplier: transaction.award.supplier, by: transaction.actor.id, at: deps.now(), pending_insert: { doctype: "Contract Request", field: "custom_rfq", value: input.rfq, payload: verificationPayload } };
      return { ...current, custom_approval_data: JSON.stringify(runtime) };
    });
    const pending = rfqRestData(rfqRestData(rfqRestData(reserved.custom_approval_data).clm_rest_operation).pending_insert);
    const saved = await updateRfqClmRecord(deps, "Contract Request", text(state.request!.name), current => {
      if (current.modified !== state.request!.modified) throw new ClmError("The Contract Request changed. Refresh before completing its terms.", 409);
      return { ...current, ...rfqRestData(pending.payload) };
    });
    if (!deps.decide) throw new ClmError("The ERPNext CLM persistence service is not configured.", 503);
    await deps.decide({ ...transaction, request_document: saved });
    const summary = await getRfqClmSummary(p, input.rfq, deps);
    if (summary.recovery_required || summary.request?.name !== saved.name || !summary.can_create) throw new ClmError("The saved Request award handoff could not be confirmed. Refresh before continuing.", 409);
    return { created: false, request: toClmAggregate(p, "Contract Request", await deps.load("Contract Request", text(saved.name))), summary };
  }
  if (state.request && state.contract && state.summary.decision === "Yes" && state.summary.eligible && !state.summary.recovery_required) {
    if (!createContract) throw new ClmError("Contract already exists. Refresh the RFQ and use View Contract.", 409);
    // An idempotent response is successful only for the same persisted Contract
    // across the RFQ decision, provenance request and permanent award context.
    const requestData = parseClmData(state.request.custom_clm_data);
    const context = parseClmData(state.contract.custom_clm_data).rfq_context;
    if (!context || requestData.contract !== state.contract.name || rfqContractDecision(state.rfq)?.contract !== state.contract.name || state.contract.custom_contract_request !== state.request.name || state.contract.custom_rfq !== state.rfq.name) throw new ClmError("The existing Contract's permanent RFQ Award links are incomplete. Repair its saved transaction before retrying; no new Contract was created.", 409);
    return { created: false, request: toClmAggregate(p, "Contract Request", state.request), contract: toClmAggregate(p, "Contract", state.contract), summary: state.summary };
  }
  if (!createContract && state.request && pendingTeamRequest(state.request) && state.summary.decision === "Yes" && state.summary.eligible && !state.summary.recovery_required) return { created: false, request: toClmAggregate(p, "Contract Request", state.request), summary: state.summary };
  if (!(createContract ? state.summary.can_create : state.summary.can_request) || !state.award) throw new ClmError(createContract && !state.request ? "Submit the CLM request to Procurement Team before creating its Contract." : state.summary.reason || "This RFQ cannot initiate a Contract Request.", 409);
  if (!input.expected_modified || input.expected_modified !== state.rfq.modified && !state.summary.recovery_required) throw new ClmError("The RFQ changed. Refresh its award before creating the Contract Request.", 409);
  const contractFields = input.contract_fields;
  let reviewFields: ClmRecord = {};
  if (createContract) {
    if (!contractFields || typeof contractFields !== "object" || Array.isArray(contractFields) || Object.keys(contractFields).some(field => !["custom_risk_level", "custom_inteva_signatory"].includes(field))) throw new ClmError("Supply the designated Legal Manager before creating CLM.", 422);
    if (!text(contractFields.custom_inteva_signatory)) throw new ClmError("Select the Legal Manager who will sign this Contract.", 422);
    const legalUser = await deps.load("User", text(contractFields.custom_inteva_signatory));
    const legalRoles = rows(legalUser.roles).map(row => text(row.role));
    if (Number(legalUser.enabled) !== 1 || resolveServerRole({ name: text(legalUser.name), email: text(legalUser.email || legalUser.name), erpnext_roles: legalRoles }) !== "legal") throw new ClmError("Select an enabled Legal Manager as the Contract's company signatory.", 409);
    const riskLevel = text(contractFields.custom_risk_level) || "Low";
    if (contractFields.custom_risk_level && !["Low", "Medium", "High", "Critical"].includes(riskLevel)) {
      throw new ClmError("Select a valid assessed Contract risk level before Legal review.", 422);
    }
    reviewFields = { custom_risk_level: riskLevel, custom_inteva_signatory: text(legalUser.name) };
  } else if (contractFields && Object.keys(contractFields).length) throw new ClmError("Submit the request to Procurement Team first. Legal signatory and Contract review fields belong to the later Create Contract action.", 400);
  const fields = await deps.fields("Contract Request");
  if (Number(fields.find(field => field.fieldname === "custom_rfq")?.unique) !== 1) throw new ClmError("Apply the RFQ Contract schema migration before creating a Contract Request; the unique RFQ source constraint is required.", 503);
  const payload = input.payload || {};
  if (typeof payload !== "object" || Array.isArray(payload)) throw new ClmError("A Contract Request field object is required.", 400);
  const allowed = new Set(clmEditableFields("Contract Request"));
  for (const [field, value] of Object.entries(payload)) {
    if (!allowed.has(field)) throw new ClmError(`The ${field} field cannot be supplied for Contract Request creation.`, 403);
    if (state.request && String(value ?? "") !== String(state.request[field] ?? "")) throw new ClmError("Create the Contract using the saved Contract Request details. Open the existing request to correct its terms before retrying.", 409);
    if (state.summary.locked_fields.includes(field) && String(value ?? "") !== String(state.summary.prefill[field] ?? "")) throw new ClmError("The Contract Request must preserve the saved RFQ supplier, source and award information.", 403);
    if (["supporting_document", "additional_documents"].includes(field) && present(value)) throw new ClmError("Add new attachments after the Contract Request is created; source documents retain their original access controls.", 403);
  }
  const next = state.request ? { ...state.request } : { ...state.award.prefill, ...payload };
  await validateOptionalOrder(next, deps);
  for (const field of fields) {
    if (Number(field.reqd) === 1 && !defaultFields.has(field.fieldname) && !present(next[field.fieldname])) throw new ClmError(`${field.label || field.fieldname.replaceAll("_", " ")} is required.`);
    if (field.fieldtype === "Select" && present(next[field.fieldname]) && !String(field.options || "").split(/\r?\n/).includes(String(next[field.fieldname]))) throw new ClmError(`Select a supported ${field.label || field.fieldname.replaceAll("_", " ")}.`);
  }
  const errors = validateRfqContractDetails(next);
  if (Object.keys(errors).length) throw new ClmError(Object.values(errors).join(" "));
  if (!deps.decide) throw new ClmError("The ERPNext CLM persistence service is not configured.", 503);
  let created = true;
  let saved: ClmRecord;
  let expectedRuntime = "";
  try {
    if (state.request) {
      const routed = createContract || pendingTeamRequest(state.request) ? state.request : routeRequestToTeam(state.request, p, deps.now());
      expectedRuntime = String(routed.custom_clm_data || "");
      const result = await deps.decide({ ...transactionInput(p, state, "Yes"), create_contract: createContract, ...(createContract ? { contract_fields: reviewFields } : { request_document: routed }) });
      if (result.request?.name !== state.request.name || createContract && !result.contract?.name || !createContract && result.contract) throw new ClmError("ERPNext did not persist the requested CLM handoff. Inspect the saved records before retrying.", 502);
      created = result.created;
      saved = result.request;
    } else {
      const result = await applyClmAction({ doctype: "Contract Request", action: "save", payload: next, comment: `Created from RFQ ${input.rfq} and winning quotation ${state.award.quotation.name}.` }, p, {
        ...deps,
        notify: undefined,
        create: async (doctype, document) => {
          const data = parseClmData(document.custom_clm_data);
          data.source_documents = state.award!.documents;
          data.rfq_source = { ...state.award!.source, department: document.department, company: document.company, rfq: input.rfq, modified: state.rfq.modified, quotation: state.award!.quotation.name, quotation_modified: state.award!.quotation.modified, legal_review: state.award!.review?.name, locked_fields: state.summary.locked_fields, contract_required: true };
          const routed = routeRequestToTeam({ ...document, custom_clm_data: JSON.stringify(data) }, p, deps.now());
          expectedRuntime = String(routed.custom_clm_data);
          if (doctype !== "Contract Request") throw new ClmError("Unexpected RFQ CLM record type.", 409);
          const result = await deps.decide!({ ...transactionInput(p, state, "Yes"), create_contract: false, request_document: routed });
          if (!result.request?.name) throw new ClmError("ERPNext did not return the linked Contract Request.", 502);
          if (result.contract?.name) throw new ClmError("ERPNext returned a Contract before Procurement Team processing. Inspect the saved records.", 502);
          created = result.created;
          return result.request;
        },
      });
      saved = result.record;
    }
  } catch (error) {
    // The database unique source handles separate server instances as well as a
    // response lost after commit. Recovery never overwrites the winning record.
    const winner = await snapshot(p, input.rfq, deps);
    if (!winner.request || winner.summary.recovery_required || (createContract ? !winner.contract : !!winner.contract || !pendingTeamRequest(winner.request)) || winner.summary.decision !== "Yes" || !winner.summary.eligible || rfqContractDecision(winner.rfq)?.request !== winner.request.name) throw error;
    saved = winner.request; created = false;
  }
  saved = await deps.load("Contract Request", text(saved.name));
  const evidence = parseClmData(saved.custom_clm_data);
  const source = evidence.rfq_source as ClmRecord | undefined;
  const intended = expectedRuntime ? parseClmData(expectedRuntime) : undefined;
  if ((created ? sourceFields : state.summary.locked_fields).some(field => present(next[field]) && String(saved[field] ?? "") !== String(next[field])) || created && (JSON.stringify(source) !== JSON.stringify(intended?.rfq_source) || JSON.stringify(evidence.source_documents) !== JSON.stringify(intended?.source_documents) || !intended?.audit.every(row => evidence.audit.some(savedRow => JSON.stringify(savedRow) === JSON.stringify(row)))) || !source || source.rfq !== input.rfq || source.quotation !== state.award.quotation.name || !Array.isArray(evidence.source_documents) || !evidence.audit.some(row => row.action === "create" && row.by && row.at)) throw new ClmError("ERPNext did not persist the RFQ Contract Request source and audit information. Inspect the existing record before retrying.", 409);
  const committed = await snapshot(p, input.rfq, deps);
  const { summary, contract } = committed;
  if (summary.decision !== "Yes" || summary.request?.name !== saved.name || summary.recovery_required) throw new ClmError("ERPNext did not complete the RFQ contract decision. Retry the same action to resume its saved records.", 409);
  if (!createContract) {
    if (contract || evidence.contract || !summary.eligible || !pendingTeamRequest(saved) || summary.request.assigned_role !== "procurement_team" || summary.request.current_stage !== rfqClmRequestWorkflowView(saved)?.stage) throw new ClmError("ERPNext did not persist the Procurement Team request assignment. Inspect the saved request before retrying.", 409);
    const request = toClmAggregate(p, "Contract Request", saved);
    try { await deps.notify?.("Contract Request", saved, "procurement_team_assigned", pendingClmApprovals(evidence)); }
    catch { const warning = "The request is assigned to Procurement Team, but notification delivery failed. Open the pending CLM requests queue and ask an administrator to retry the notice."; request.warnings = [...(request.warnings || []), warning]; summary.warnings.push(warning); }
    return { created, request, summary };
  }
  const context = contract ? parseClmData(contract.custom_clm_data).rfq_context as ClmRecord | undefined : undefined;
  const decision = rfqContractDecision(committed.rfq);
  if (!contract || !summary.eligible || evidence.contract !== contract.name || contract.custom_contract_request !== saved.name || !context || context.rfq_id !== input.rfq || context.award_id !== state.award.source.award || context.supplier_id !== saved.supplier || context.quotation_id !== saved.custom_supplier_quotation || context.contract_required !== "Yes" || context.contract_type !== contract.custom_contract_type || context.contract_status !== clmStatus("Contract", contract) || decision?.contract !== contract.name) throw new ClmError("ERPNext did not persist the RFQ-linked Contract and its permanent award context. Inspect the existing transaction before retrying.", 409);
  const contractData = parseClmData(contract.custom_clm_data);
  if (!contractData.audit.some(row => row.action === "legal_review_started" && row.by && row.at)) throw new ClmError("ERPNext did not record the Contract's required Legal review assignment. Inspect the saved transaction before retrying.", 409);
  if (created && (clmStatus("Contract", contract) !== "Pending Legal" || contractData.rfq_workflow?.phase !== "legal_review" || contractData.approvals.length !== 1 || contractData.approvals[0].role !== "legal" || contractData.approvals[0].stage !== 0 || contractData.approvals[0].status !== "Pending" || contract.custom_risk_level !== reviewFields.custom_risk_level || contract.custom_inteva_signatory !== reviewFields.custom_inteva_signatory)) throw new ClmError("ERPNext created the Contract without its required Legal review assignment. Inspect the saved transaction before retrying.", 409);
  const aggregate = toClmAggregate(p, "Contract", contract);
  if (contractData.rfq_workflow?.phase === "legal_review") {
    // Delivery follows the verified commit. The notice store deduplicates the
    // persisted revision when this branch recovers a lost transaction response.
    try { await deps.notify?.("Contract", contract, "legal_review_started", pendingClmApprovals(contractData)); }
    catch {
      const warning = "The Contract was created and assigned to Legal Review, but reviewer notification could not be delivered. Refresh the assignment queue and ask an administrator to retry notification delivery.";
      aggregate.warnings = [...(aggregate.warnings || []), warning];
      summary.warnings = [...summary.warnings, warning];
    }
  }
  return { created, request: toClmAggregate(p, "Contract Request", saved), contract: aggregate, summary };
}
