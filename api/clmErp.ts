import { readErpAuthConfig } from "./authSession.js";
import { sanitizeErpPayloadDates } from "./erpDateSanitize.js";
import { CLM_DOCTYPES, type ClmField, type ClmRecord } from "../src/types/clm.js";
import { ClmError, parseClmData, type ClmDeps } from "./clmCore.js";
import { lockClmContract, readClmPdf, signClmContract } from "./clmSignature.js";
import { notifyClmAction } from "./clmNotifications.js";
import { clmNow } from "./clmTime.js";
import { clmErpFailure } from "./clmErpErrors.js";
import { syncRfqClmRestContract } from "./rfqClmRestSync.js";
import { decodeRfqClmRestContract, encodeRfqClmRestContract, isContractRestDocument, isRfqClmRestContract } from "./rfqClmRestStatus.js";
import { isInitialRfqRequestPersistence, validateContractRequestPersistence } from "./clmRequestValidation.js";
import { resolveAvailableRfqAward } from "./rfqClmCore.js";

export const clmResource = (doctype: string, name?: string) => `resource/${encodeURIComponent(doctype)}${name ? `/${encodeURIComponent(name)}` : ""}`;
export async function clmErpRequest<T = ClmRecord>(method: string, path: string, body?: unknown, options: { preservePayload?: boolean } = {}): Promise<T> {
  const config = readErpAuthConfig();
  if (!config.key || !config.secret) throw new ClmError("The ERP service is not configured.", 503);
  const contractResource = /^resource\/Contract(?:\/|\?|$)/.test(decodeURIComponent(path));
  const contractSave = path === "method/frappe.client.save" && isContractRestDocument(body) && isContractRestDocument(body.doc) && body.doc.doctype === "Contract";
  const outgoing = contractResource && isContractRestDocument(body) ? encodeRfqClmRestContract(body)
    : contractSave ? { ...body as ClmRecord, doc: encodeRfqClmRestContract((body as ClmRecord).doc as ClmRecord) } : body;
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/api/${path}`, {
      method, headers: { Authorization: `token ${config.key}:${config.secret}`, Accept: "application/json", "Content-Type": "application/json" },
      body: outgoing === undefined ? undefined : JSON.stringify(options.preservePayload ? outgoing : sanitizeErpPayloadDates(outgoing)), signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    const timeout = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
    throw new ClmError(timeout
      ? "ERPNext timed out. Refresh the RFQ or Contract to check whether the action was saved before retrying."
      : "ERPNext could not be reached. Check the ERP connection, then refresh the RFQ or Contract before retrying.", timeout ? 504 : 503);
  }
  const raw: unknown = await response.json().catch(() => null);
  const payload = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  if (!response.ok) {
    const failure = clmErpFailure(payload, response.status, [config.key, config.secret]);
    throw new ClmError(failure.message, failure.status);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ClmError("ERPNext returned an invalid Contract response. Refresh the RFQ or Contract to verify the saved state before retrying.", 502);
  const result = payload.data ?? payload.message ?? payload;
  if (contractResource || contractSave) return (Array.isArray(result) ? result.map(row => isContractRestDocument(row) ? decodeRfqClmRestContract(row) : row) : isContractRestDocument(result) ? decodeRfqClmRestContract(result) : result) as T;
  return result as T;
}

export async function listClmErp(doctype: string, filters: unknown[] = [], fields: string[] = ["*"]): Promise<ClmRecord[]> {
  const result: ClmRecord[] = [];
  for (let start = 0; start < 20_000; start += 200) {
    const query = new URLSearchParams({ fields: JSON.stringify(fields), filters: JSON.stringify(filters), limit_start: String(start), limit_page_length: "200", order_by: "creation desc" });
    const rows = await clmErpRequest<ClmRecord[]>("GET", `${clmResource(doctype)}?${query}`);
    if (!Array.isArray(rows)) throw new ClmError("ERPNext returned an invalid document list.", 502);
    result.push(...rows);
    if (rows.length < 200) return result;
  }
  throw new ClmError("Too many records. Narrow the search before continuing.", 422);
}

const schemaCache = new Map<string, { at: number; fields: ClmField[] }>();
export async function getClmFields(doctype: string): Promise<ClmField[]> {
  if (!CLM_DOCTYPES.includes(doctype as typeof CLM_DOCTYPES[number])) throw new ClmError("Unsupported Contract document type.", 400);
  const cached = schemaCache.get(doctype);
  if (cached && Date.now() - cached.at < 60_000) return cached.fields;
  const [schema, custom, setters] = await Promise.all([
    clmErpRequest("GET", clmResource("DocType", doctype)),
    listClmErp("Custom Field", [["dt", "=", doctype]]),
    listClmErp("Property Setter", [["doc_type", "=", doctype]]),
  ]);
  const fields = [...(Array.isArray(schema.fields) ? schema.fields : []), ...custom] as ClmField[];
  const unique = [...new Map(fields.map(field => [field.fieldname, { ...field }])).values()];
  for (const setter of setters) {
    const field = unique.find(row => row.fieldname === setter.field_name);
    if (!field || !["options", "reqd", "read_only", "unique", "label"].includes(String(setter.property))) continue;
    Object.assign(field, { [String(setter.property)]: ["reqd", "read_only", "unique"].includes(String(setter.property)) ? Number(setter.value) : setter.value });
  }
  schemaCache.set(doctype, { at: Date.now(), fields: unique });
  return unique;
}

async function verifyRfqSignatureSave(expected: ClmRecord, response: ClmRecord): Promise<ClmRecord> {
  const data = parseClmData(expected.custom_clm_data);
  if (!data.signatures.length || !["e_signed", "finance_review_started", "supplier_accept"].includes(String(data.audit.at(-1)?.action))) return response;
  const action = data.audit.at(-1)?.action === "supplier_accept" ? "Contract acceptance" : "signature";
  let stored: ClmRecord;
  try { stored = await clmErpRequest("GET", clmResource("Contract", String(expected.name))); }
  catch (error) {
    throw new ClmError(`The ${action} save was submitted, but its persistence could not be verified. Refresh the Contract before retrying.`, error instanceof ClmError ? error.status : 502);
  }
  if (stored.modified !== response.modified) throw new ClmError(`The Contract changed after its ${action} save. Refresh to verify the saved evidence before retrying.`, 409);
  const fields = ["name", "custom_rfq", "custom_supplier_quotation", "custom_current_version", "custom_contract_status", "custom_esign_status", "custom_supplier_signatory_name", "custom_supplier_signed_date", "custom_inteva_signed_date", "signed_by_company", "custom_executed_contract", "custom_executed_date"];
  const value = (field: string, record: ClmRecord) => record[field] == null ? "" : String(record[field]);
  const fieldMismatch = fields.find(field => value(field, stored) !== value(field, expected));
  // Native signed_on is a Date on standard ERPNext Contract. The receipt/audit
  // retain the complete signature timestamp in custom_clm_data.
  const signedDateMismatch = value("signed_on", stored).slice(0, 10) !== value("signed_on", expected).slice(0, 10);
  const checkMismatch = ["is_signed", "custom_final_version_locked"].some(field => Number(stored[field] || 0) !== Number(expected[field] || 0));
  if (stored.custom_clm_data !== expected.custom_clm_data || fieldMismatch || signedDateMismatch || checkMismatch) {
    throw new ClmError(`The saved ${action} could not be verified in ERPNext${fieldMismatch ? ` (${fieldMismatch})` : ""}. Refresh the Contract and check its signature, document and audit history before retrying; do not repeat the action until the saved state is confirmed.`, 409);
  }
  return stored;
}

export function createClmDependencies(): ClmDeps {
  const validateRequest = async (doctype: string, doc: ClmRecord, operation: "create" | "save") => {
    if (doctype !== "Contract Request") return;
    const rfq = isInitialRfqRequestPersistence(doc) ? await clmErpRequest("GET", clmResource("Request for Quotation", String(doc.custom_rfq))) : undefined;
    const award = rfq && Number(rfq.docstatus) === 1 ? await resolveAvailableRfqAward(rfq, createClmDependencies()) : undefined;
    validateContractRequestPersistence(doc, rfq, operation, award);
  };
  return {
    load: (doctype, name) => clmErpRequest("GET", clmResource(doctype, name)),
    list: listClmErp,
    create: async (doctype, doc) => {
      await validateRequest(doctype, doc, "create");
      return clmErpRequest("POST", clmResource(doctype), doc);
    },
    save: async (doctype, doc) => {
      await validateRequest(doctype, doc, "save");
      // Frappe's save checks modified atomically and keeps native Version history.
      let saved = await clmErpRequest("POST", "method/frappe.client.save", { doc: { ...doc, doctype } }, { preservePayload: true });
      if (typeof doc.custom_clm_data === "string" && saved.custom_clm_data !== doc.custom_clm_data) throw new ClmError("ERPNext did not persist the Contract workflow data. Apply the CLM schema migration.", 409);
      // Verify the actual stored signature before downstream mirrors or notices.
      // A successful save response alone is not evidence of reload persistence.
      if (doctype === "Contract" && doc.custom_rfq && doc.custom_clm_data) saved = await verifyRfqSignatureSave(doc, saved);
      if (doctype === "Contract" && isRfqClmRestContract(saved)) await syncRfqClmRestContract(saved, {
        load: (type, name) => clmErpRequest("GET", clmResource(type, name)),
        list: listClmErp,
        save: (type, record) => clmErpRequest("POST", "method/frappe.client.save", { doc: { ...record, doctype: type } }, { preservePayload: true }),
      });
      return saved;
    },
    now: clmNow,
    sign: signClmContract,
    verifyPdf: readClmPdf,
    lock: lockClmContract,
    closureBlockers: async contract => {
      const blockers: string[] = [];
      const orders = contract.custom_purchase_order ? [await clmErpRequest("GET", clmResource("Purchase Order", String(contract.custom_purchase_order)))] : [];
      for (const order of orders) {
        if (!["Closed", "Completed", "Cancelled"].includes(String(order.status))) blockers.push(`Purchase Order ${order.name} is still open.`);
        const invoices = await listClmErp("Purchase Invoice", [["Purchase Invoice Item", "purchase_order", "=", order.name]]);
        for (const invoice of invoices) if (Number(invoice.docstatus) !== 2 && (Number(invoice.docstatus) === 0 || Number(invoice.outstanding_amount) > 0)) blockers.push(`Invoice ${invoice.name} is unsettled.`);
      }
      return blockers;
    },
    notify: notifyClmAction,
  };
}
