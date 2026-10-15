import { RbacError, requireRoles, type AccessPrincipal } from "./rbacAuth.js";

type Row = Record<string, unknown>;
const RFQ = "Request for Quotation";
const SERVER_CLM_STATE = ["clm_initial_request", "clm_rest_operation", "clm_award_intent"] as const;
const READ_METHODS = new Set([
  "frappe.client.get", "frappe.client.get_list", "frappe.client.get_value", "frappe.client.get_count",
  "frappe.model.workflow.get_transitions", "frappe.desk.form.load.getdoctype",
]);
const WRITE_METHODS = new Set([
  "frappe.client.save", "frappe.client.insert", "frappe.client.submit", "frappe.client.set_value",
  "frappe.model.workflow.apply_workflow",
]);
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const has = (row: Row, key: string) => Object.hasOwn(row, key);
function decode(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}
function record(value: unknown): Row {
  const parsed = decode(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Row : {};
}
function approvalData(value: unknown): Row {
  if (value == null || value === "") return {};
  const parsed = decode(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new RbacError("Invalid RFQ approval data. Refresh the RFQ before saving.", 403);
  return parsed as Row;
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable((value as Row)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
function completion(value: unknown): boolean { return /^(completed|po created)$/i.test(text(value)); }

export interface RfqClmBranchDependencies {
  loadDocument(doctype: string, name: string): Promise<Row>;
  assertClmReady(rfqName: string, options?: { allowHistoricalOrder?: boolean }): Promise<unknown>;
}

/** Generic ERP writes cannot manufacture or remove authoritative decisions or recovery intent. */
export async function assertRfqClmBranchRequest(input: {
  apiPath: string; method: string; principal: AccessPrincipal; body?: unknown; query?: Row;
}, dependencies: RfqClmBranchDependencies): Promise<void> {
  const path = decodeURIComponent(input.apiPath).replace(/^\/+|\/+$/g, "");
  const method = input.method.toUpperCase();
  const resource = path === `resource/${RFQ}` || path.startsWith(`resource/${RFQ}/`);
  const rpc = path.startsWith("method/") ? path.slice(7) : "";
  if (resource && ["GET", "HEAD", "OPTIONS", "DELETE"].includes(method) || READ_METHODS.has(rpc) || ["frappe.client.cancel", "frappe.client.delete"].includes(rpc)) return;
  const payload = { ...record(input.query), ...record(input.body) };
  const documents: Row[] = [];
  const collect = (value: unknown, force = false) => {
    const parsed = decode(value);
    if (Array.isArray(parsed)) { parsed.forEach(row => collect(row, force)); return; }
    const row = record(parsed);
    const wrapped = ["doc", "data", "docs"].some(key => has(row, key));
    if (row.doctype === RFQ || row.dt === RFQ || force && !wrapped) documents.push(row);
    for (const key of ["doc", "data", "docs"]) if (has(row, key)) collect(row[key], force);
  };
  collect(payload, resource);
  if (!documents.length) return;
  if (input.principal.typ !== "internal") throw new RbacError("Only authorized procurement users can update RFQs.", 403);
  requireRoles(input.principal, ["procurement", "procurement_team", "admin"]);
  if (!resource && !WRITE_METHODS.has(rpc)) throw new RbacError("Unsupported RFQ mutation route.", 403);
  if (documents.length > 1) throw new RbacError("Bulk RFQ mutations cannot bypass the contract decision.", 403);
  if (resource && ["doc", "data", "docs"].some(key => has(payload, key))) throw new RbacError("Wrapped RFQ resource mutations are not supported.", 403);
  let document = documents[0];
  if (rpc === "frappe.client.set_value") {
    const selector = decode(payload.fieldname);
    let changes: Row;
    if (typeof selector === "string") changes = { [selector]: payload.value };
    else if (Array.isArray(selector)) {
      const values = decode(payload.value);
      if (selector.some(key => typeof key !== "string") || !Array.isArray(values) || values.length !== selector.length) throw new RbacError("Invalid RFQ field update.", 403);
      changes = Object.fromEntries(selector.map((key, index) => [key, values[index]]));
    } else changes = record(selector);
    document = { ...document, ...changes };
  }
  const nextData = has(document, "custom_approval_data") ? approvalData(document.custom_approval_data) : undefined;
  const workflowAction = rpc === "frappe.model.workflow.apply_workflow";
  const completes = [document.custom_workflow_step, document.workflow_state, document.status, nextData?.workflow_step].some(completion);
  if (!has(document, "contract_required") && !nextData && !completes && !workflowAction) return;
  const name = resource ? path.slice(`resource/${RFQ}/`.length) : text(document.name);
  const newDocument = resource && path === `resource/${RFQ}` || rpc === "frappe.client.insert" || !name || document.__islocal === true || document.__islocal === 1;
  if (newDocument) {
    if (nextData && SERVER_CLM_STATE.some(field => has(nextData, field))) throw new RbacError("RFQ CLM assignment and recovery state must be recorded by the secured Contract Request action.", 403);
    if (nextData && has(nextData, "contract_decision") || completes) throw new RbacError("Save the RFQ award before recording its contract decision or completing procurement.", 403);
    return;
  }
  const current = await dependencies.loadDocument(RFQ, name);
  const currentData = approvalData(current.custom_approval_data);
  if (nextData && (has(nextData, "contract_decision") || has(currentData, "contract_decision")) && stable(nextData.contract_decision) !== stable(currentData.contract_decision)) {
    throw new RbacError("Use the RFQ contract decision action. Its saved decision cannot be changed or removed through a generic update.", 403);
  }
  for (const field of SERVER_CLM_STATE) {
    if (nextData && (has(nextData, field) || has(currentData, field)) && stable(nextData[field]) !== stable(currentData[field])) {
      throw new RbacError("Use the secured Contract Request action. RFQ CLM assignment and recovery state cannot be changed or removed through a generic update.", 403);
    }
  }
  const initialRequestState = record(currentData.clm_initial_request);
  const inactivePreawardRequest = ["awaiting_award", "awaiting_supplier_award", "awaiting_rfq_submission"].includes(text(initialRequestState.phase));
  if (initialRequestState.version === 1 && !inactivePreawardRequest && has(document, "contract_required") && document.contract_required !== current.contract_required) {
    throw new RbacError("This RFQ has a saved Contract Request operation. Resolve that request before changing Contract Required.", 403);
  }
  const awarded = !!text(current.custom_selected_supplier) || !!text(currentData.selected_supplier) || has(currentData, "contract_decision");
  if (awarded && has(document, "contract_required") && document.contract_required !== current.contract_required) throw new RbacError("Use the RFQ contract decision action to change Contract / CLM Required after supplier award.", 403);
  // Workflow RPC transitions are determined by ERP configuration, so re-check
  // their persisted branch before forwarding an opaque transition action.
  if (completes || workflowAction && awarded) {
    const terminalFields = [
      [document.custom_workflow_step, current.custom_workflow_step],
      [document.workflow_state, current.workflow_state],
      [document.status, current.status],
      [nextData?.workflow_step, currentData.workflow_step],
    ].filter(([next]) => completion(next));
    const unchangedTerminal = !workflowAction && terminalFields.length > 0 && terminalFields.every(([next, previous]) => text(next) === text(previous));
    // Retain harmless saves of an already-completed historical RFQ, but core
    // must prove an existing PO and no linked CLM before granting the exception.
    if (unchangedTerminal) await dependencies.assertClmReady(name, { allowHistoricalOrder: true });
    else await dependencies.assertClmReady(name);
  }
}
