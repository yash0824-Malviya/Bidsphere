const RFQ = "Request for Quotation";
const FIELD = "contract_required";
type Row = Record<string, unknown>;
export interface RfqContractRequirementRequest {
  apiPath: string;
  method: string;
  body?: unknown;
  query?: Row;
}
export class RfqContractRequirementError extends Error {
  readonly status = 400;
  constructor() { super("Contract Requirement must be Yes or No."); this.name = "RfqContractRequirementError"; }
}

function object(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}
function decoded(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}
function assertChoice(value: unknown): void {
  if (value !== "Yes" && value !== "No") throw new RfqContractRequirementError();
}
function isRfq(row: Row): boolean { return row.doctype === RFQ || row.dt === RFQ; }

/** Security inspection only. RFQ writes never create or reactivate CLM Requests. */
export function isRfqDocumentMutation(input: RfqContractRequirementRequest): boolean {
  const path = decodeURIComponent(input.apiPath).replace(/^\/+|\/+$/g, "");
  const method = input.method.toUpperCase();
  if (/^resource\/Request for Quotation(?:\/|$)/.test(path)) return ["POST", "PUT", "PATCH"].includes(method);
  if (!["method/frappe.client.save", "method/frappe.client.insert", "method/frappe.client.set_value", "method/frappe.client.submit"].includes(path) || !["GET", "POST"].includes(method)) return false;
  const args = { ...input.query, ...object(decoded(input.body)) };
  return isRfq(object(decoded(args.doc || args.data || args.docs || args)) || {});
}

/**
 * Apply only the existing RFQ metadata field. Missing values on an existing
 * document are deliberately untouched: a workflow update must not reset Yes.
 * Run this after the gateway's existing RFQ authentication and role checks.
 */
export function normalizeRfqContractRequirementRequest(input: RfqContractRequirementRequest): { body: unknown; query: Row | undefined } {
  const path = decodeURIComponent(input.apiPath).replace(/^\/+|\/+$/g, "");
  const method = input.method.toUpperCase();
  const resource = /^resource\/Request for Quotation(?:\/|$)/.test(path);
  const rpc = path.startsWith("method/") ? path.slice(7) : "";
  const documentRpc = ["frappe.client.save", "frappe.client.insert", "frappe.client.submit", "frappe.model.workflow.apply_workflow"].includes(rpc);
  const setValue = rpc === "frappe.client.set_value";
  if (resource ? !["POST", "PUT", "PATCH"].includes(method) : !documentRpc && !setValue) return { body: input.body, query: input.query };

  if (setValue) {
    const args = { ...input.query, ...object(decoded(input.body)) };
    if (isRfq(args)) {
      const selector = decoded(args.fieldname);
      if (selector === FIELD) assertChoice(args.value);
      else if (Array.isArray(selector)) {
        const index = selector.indexOf(FIELD);
        if (index >= 0) {
          const values = decoded(args.value);
          assertChoice(Array.isArray(values) ? values[index] : selector.length === 1 ? values : undefined);
        }
      } else {
        const fields = object(selector);
        if (fields && Object.hasOwn(fields, FIELD)) assertChoice(fields[FIELD]);
      }
    }
    return { body: input.body, query: input.query };
  }

  const resourceCreate = resource && path === `resource/${RFQ}` && method === "POST";
  const map = (value: unknown, forceRfq = false, resourceDefaults = false): unknown => {
    if (typeof value === "string") {
      const parsed = decoded(value);
      if (!object(parsed) && !Array.isArray(parsed)) return value;
      const mapped = map(parsed, forceRfq, resourceDefaults);
      return mapped === parsed ? value : JSON.stringify(mapped);
    }
    if (Array.isArray(value)) {
      const mapped = value.map(entry => map(entry, forceRfq, resourceDefaults));
      return mapped.some((entry, index) => entry !== value[index]) ? mapped : value;
    }
    const row = object(value);
    if (!row) return value;
    let next = row;
    const wrapped = forceRfq && ["doc", "data", "docs"].some(key => object(decoded(row[key])) || Array.isArray(decoded(row[key])));
    if ((forceRfq && !wrapped) || isRfq(row)) {
      if (Object.hasOwn(row, FIELD)) assertChoice(row[FIELD]);
      else if (resourceDefaults || rpc === "frappe.client.insert" || rpc === "frappe.client.save" && (!row.name || row.__islocal === true || row.__islocal === 1)) next = { ...next, [FIELD]: "No" };
    }
    for (const key of ["doc", "data", "docs"]) {
      if (!Object.hasOwn(row, key)) continue;
      const nested = map(row[key], forceRfq, resourceDefaults);
      if (nested !== row[key]) next = { ...next, [key]: nested };
    }
    return next;
  };
  // Mutation RPCs may receive JSON documents in GET arguments. Keep their
  // encoded shape intact; read/list queries never reach this branch.
  const query = map(input.query, resource, false) as Row | undefined;
  const body = map(input.body, resource, resourceCreate);
  return { body, query };
}
