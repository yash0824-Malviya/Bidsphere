import { apiGet, buildListConfig, buildResourceUrl, withSilent } from "./erpnext";
import type { AIRecommendation, SupplierQuotation, SupplierScoringResult } from "../types/erpnext";
import { getSupplierAwardEligibility } from "../utils/supplierAwardEligibility";

const EVALUATION_ERROR = "The current supplier evaluation could not be verified. Refresh the RFQ evaluation before selecting a supplier.";

/** Fresh ERP data only: a network/parse failure is never treated as no evaluation. */
async function loadCurrentEvaluation(rfqId: string): Promise<AIRecommendation | null> {
  const list = await apiGet<Array<{ name: string }>>(buildResourceUrl("Supplier Scoring Result"), {
    ...buildListConfig({ filters: [["rfq", "=", rfqId]], fields: ["name"], order_by: "scored_at desc, creation desc", limit_page_length: 1 }),
    ...withSilent(),
  });
  if (!Array.isArray(list)) throw new Error(EVALUATION_ERROR);
  if (list.length === 0) return null;
  const result = await apiGet<SupplierScoringResult>(buildResourceUrl("Supplier Scoring Result", list[0].name), withSilent());
  try {
    const snapshot = JSON.parse(result.analysis_snapshot ?? "");
    const analysis = (snapshot.analysis ?? snapshot) as AIRecommendation;
    if (result.rfq !== rfqId || analysis.rfq_id !== rfqId || !Array.isArray(analysis.supplier_analysis) || analysis.supplier_analysis.length === 0) {
      throw new Error(EVALUATION_ERROR);
    }
    return analysis;
  } catch {
    throw new Error(EVALUATION_ERROR);
  }
}

/** Validate the quotation's authoritative RFQ and Supplier links, not a display name. */
export function assertQuotationForAward(rfqId: string, supplierId: string, quotation: SupplierQuotation): void {
  if (!quotation?.name || quotation.supplier !== supplierId || quotation.docstatus !== 1 || quotation.status === "Cancelled" ||
    !(quotation.items ?? []).some(item => item.request_for_quotation === rfqId)) {
    throw new Error("A current submitted Supplier Quotation matching this RFQ and supplier is required before selection.");
  }
}

/** Defense in depth before mutations; the backend repeats this against its own ERP reads. */
export async function assertQuotationsAwardEligible(rfqId: string, quotations: SupplierQuotation[]): Promise<void> {
  for (const quotation of quotations) assertQuotationForAward(rfqId, quotation.supplier, quotation);
  const analysis = await loadCurrentEvaluation(rfqId);
  // Older RFQs without an evaluation retain their existing workflow.
  if (!analysis) return;
  for (const quotation of quotations) {
    const supplierRows = analysis.supplier_analysis.filter(row => row.supplier_id === quotation.supplier);
    // The latest supplier-level AVOID cannot be bypassed by choosing another quotation revision.
    for (const row of supplierRows) {
      const eligibility = getSupplierAwardEligibility(row);
      if (!eligibility.awardEligible) throw new Error(eligibility.awardIneligibilityReason || "Supplier is not eligible for award.");
    }
    const matches = supplierRows.filter(row => (row.quotation_id || row.supplier_quotation_id) === quotation.name);
    if (matches.length !== 1 || matches[0].rfq_id !== rfqId ||
      (matches[0].quotation_id && matches[0].supplier_quotation_id && matches[0].quotation_id !== matches[0].supplier_quotation_id) ||
      (analysis.evaluation_run_id && matches[0].evaluation_run_id !== analysis.evaluation_run_id)) {
      throw new Error(EVALUATION_ERROR);
    }
  }
}

/** Supplier-only legacy callers must still resolve a real, current quotation. */
export async function assertSuppliersAwardEligible(
  rfqId: string,
  supplierIds: string[],
  quotations?: SupplierQuotation[],
): Promise<SupplierQuotation[]> {
  const current = quotations ?? await (await import("./sourcing")).getSupplierQuotations(rfqId);
  const selected = supplierIds.map(supplierId => {
    const quote = current.filter(row => row.supplier === supplierId && row.docstatus === 1 && row.status !== "Cancelled" &&
      (row.items ?? []).some(item => item.request_for_quotation === rfqId))
      .sort((a, b) => b.name.localeCompare(a.name))[0];
    if (!quote) throw new Error("A current submitted Supplier Quotation matching this RFQ and supplier is required before selection.");
    return quote;
  });
  await assertQuotationsAwardEligible(rfqId, selected);
  return selected;
}

/** Validate quote-backed PO lines even when callers bypass the RFQ convenience API. */
export async function assertPurchaseOrderSuppliersAwardEligible(
  supplierId: string | undefined,
  items: Array<{ supplier_quotation?: string }> | undefined,
): Promise<void> {
  const ids = [...new Set((items ?? []).map(item => item.supplier_quotation).filter((id): id is string => Boolean(id)))];
  for (const id of ids) {
    const quote = await apiGet<SupplierQuotation>(buildResourceUrl("Supplier Quotation", id));
    if (!supplierId || quote.supplier !== supplierId || quote.name !== id) throw new Error("Purchase Order supplier does not match its Supplier Quotation.");
    const rfqIds = [...new Set((quote.items ?? []).map(item => item.request_for_quotation).filter((rfq): rfq is string => Boolean(rfq)))];
    for (const rfqId of rfqIds) await assertQuotationsAwardEligible(rfqId, [quote]);
  }
}
