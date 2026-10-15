import type { ClmRecord } from "../src/types/clm.js";
import { parseClmData, ClmError } from "./clmCore.js";
import { isInitialRfqRequest } from "./rfqInitialClmRequest.js";

/** Hide historical pre-award requests from active queues without mutating their audit records. */
export async function projectRfqRequestSubmission(record: ClmRecord, load: (doctype: string, name: string) => Promise<ClmRecord>): Promise<ClmRecord> {
  // Preserve the existing read-only legacy-history behavior for malformed
  // optional source evidence; its normal detail projection reports a warning.
  try { if (!isInitialRfqRequest(record)) return record; } catch { return record; }
  const data = parseClmData(record.custom_clm_data);
  if (data.contract || record.custom_contract) return record;
  const rfq = await load("Request for Quotation", String(record.custom_rfq));
  if (rfq.name !== record.custom_rfq) throw new ClmError("The Contract Request's source RFQ could not be verified.", 409);
  const source = data.rfq_source as ClmRecord | undefined;
  let validAward = false;
  if (Number(rfq.docstatus) === 1 && rfq.contract_required === "Yes" && source?.stage === "rfq_awarded" && source.award && source.quotation && source.supplier) {
    try {
      const award = await load("Legal Document Review", String(source.award));
      const quotation = await load("Supplier Quotation", String(source.quotation));
      let supplierMatches = award.supplier === source.supplier;
      // Preserve the established legacy display-wrapper mapping only when it
      // does not identify a different real Supplier DocName.
      const rawSupplier = String(award.supplier || "").trim();
      const unwrapped = rawSupplier.replace(/^(["'])(.*)\1$/, "$2");
      if (!supplierMatches && unwrapped !== rawSupplier && unwrapped === source.supplier) {
        try { await load("Supplier", rawSupplier); }
        catch (error) { if (error instanceof ClmError && error.status === 404) supplierMatches = true; else throw error; }
      }
      validAward = award.name === source.award && award.rfq_name === rfq.name && award.sq_name === source.quotation &&
        supplierMatches &&
        Number(award.docstatus || 0) !== 2 && Number(quotation.docstatus) === 1 && quotation.supplier === source.supplier &&
        record.supplier === source.supplier && record.custom_supplier_quotation === source.quotation &&
        Array.isArray(quotation.items) && quotation.items.some((row: ClmRecord) => row.request_for_quotation === rfq.name);
    } catch (error) { if (!(error instanceof ClmError) || error.status !== 404) throw error; }
  }
  if (validAward) return record;
  const route = data.rfq_request_workflow as ClmRecord | undefined;
  data.rfq_request_workflow = { ...route, phase: "awaiting_supplier_award", status: "Invalidated", current_stage: "Awaiting Supplier Award" };
  return { ...record, request_status: "Cancelled", custom_clm_data: JSON.stringify(data) };
}
