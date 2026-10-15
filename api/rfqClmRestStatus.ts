import { ClmError, parseClmData } from "./clmCore.js";
import type { ClmRecord } from "../src/types/clm.js";

const aliases: Record<string, string> = { "Pending Legal": "Under Review", "Pending Finance": "Pending Signature", Rejected: "Draft" };
const phaseStatuses: Record<string, string[]> = {
  draft: ["Draft"], legal_review: ["Pending Legal", "Under Review"], signature: ["Approved", "Pending Signature"],
  finance_review: ["Pending Finance"], procurement: ["Executed", "Active", "Expired", "Terminated", "Closed"],
  completed: ["Executed", "Active", "Expired", "Terminated", "Closed"], rejected: ["Rejected"],
};
export function isRfqClmRestContract(record: ClmRecord): boolean {
  if (!record.custom_rfq) return false;
  let raw = record.custom_clm_data;
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { return false; } }
  return !!raw && typeof raw === "object" && !Array.isArray(raw) && (raw as ClmRecord).persistence === "erpnext_rest_v1";
}
function canonical(record: ClmRecord): string | undefined {
  if (!isRfqClmRestContract(record)) return undefined;
  const data = parseClmData(record.custom_clm_data);
  const context = data.rfq_context as ClmRecord | undefined;
  const status = typeof context?.contract_status === "string" ? context.contract_status : "";
  if (!data.rfq_workflow || context?.rfq_id !== record.custom_rfq || context.contract_required !== "Yes" || !phaseStatuses[data.rfq_workflow.phase]?.includes(status)) throw new ClmError("The ERP Contract state does not match its saved RFQ lifecycle. Refresh or inspect the record before continuing.", 409);
  return status;
}

/** Keep existing ERP workflow states; canonical stage and decision stay in audited runtime data. */
export function encodeRfqClmRestContract(record: ClmRecord): ClmRecord {
  const status = canonical(record);
  if (!status) return record;
  if (record.custom_contract_status !== status) throw new ClmError("The RFQ Contract status and lifecycle evidence must agree before saving.", 409);
  return { ...record, custom_contract_status: aliases[status] || status };
}

export function decodeRfqClmRestContract(record: ClmRecord): ClmRecord {
  const status = canonical(record);
  if (!status) return record;
  // Sites already supporting the canonical status remain readable as well.
  if (![status, aliases[status]].filter(Boolean).includes(String(record.custom_contract_status || ""))) throw new ClmError("The ERP Contract state does not match its saved RFQ lifecycle. Refresh or inspect the record before continuing.", 409);
  return { ...record, custom_contract_status: status };
}

export function isContractRestDocument(value: unknown): value is ClmRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
