import type { SupplierAnalysisRow } from "../types/erpnext";
import type { ReverseBiddingQuotationSelection } from "../types/reverseBidding";
import { getSupplierAwardEligibility } from "./supplierAwardEligibility";

/** A display name is never an identity for a negotiation selection. */
export function reverseBiddingSelectionForRow(
  row: SupplierAnalysisRow,
): ReverseBiddingQuotationSelection | null {
  if (!getSupplierAwardEligibility(row).awardEligible) return null;
  const quotationId = row.quotation_id || row.supplier_quotation_id;
  if (
    !quotationId?.trim() || !row.supplier_id?.trim() || !row.rfq_id?.trim() ||
    (row.quotation_id && row.supplier_quotation_id && row.quotation_id !== row.supplier_quotation_id)
  ) return null;
  return { quotation_id: quotationId, supplier_id: row.supplier_id, rfq_id: row.rfq_id };
}

export function selectedReverseBiddingQuotations(
  rows: SupplierAnalysisRow[],
  selectedQuotationIds: ReadonlySet<string>,
): ReverseBiddingQuotationSelection[] {
  const selections = [...selectedQuotationIds].map((quotationId) => {
    const selected = rows.find(row => (row.quotation_id || row.supplier_quotation_id) === quotationId);
    if (selected) {
      const eligibility = getSupplierAwardEligibility(selected);
      if (!eligibility.awardEligible) throw new Error(eligibility.awardIneligibilityReason || "Supplier is not eligible for reverse bidding.");
    }
    const matches = rows.map(reverseBiddingSelectionForRow)
      .filter((row): row is ReverseBiddingQuotationSelection => row?.quotation_id === quotationId);
    if (matches.length !== 1) {
      throw new Error("Selected quotation is no longer available. Reopen Recommendation Results and select the suppliers again.");
    }
    return matches[0];
  });
  if (new Set(selections.map((row) => row.supplier_id)).size !== selections.length) {
    throw new Error("Select one current quotation per supplier for reverse bidding.");
  }
  if (new Set(selections.map((row) => row.rfq_id)).size > 1) {
    throw new Error("Selected quotations must belong to the current RFQ.");
  }
  return selections;
}

/** Check the rendered selection against the current RFQ's loaded ERP quotations. */
export function validateReverseBiddingSelection(
  rfqId: string,
  selections: ReverseBiddingQuotationSelection[],
  quotations: { name: string; supplier: string }[],
): ReverseBiddingQuotationSelection[] {
  const seenQuotes = new Set<string>();
  const seenSuppliers = new Set<string>();
  for (const selected of selections) {
    const matchingDocuments = quotations.filter((quote) => quote.name === selected.quotation_id);
    if (
      selected.rfq_id !== rfqId ||
      !selected.quotation_id?.trim() || !selected.supplier_id?.trim() ||
      seenQuotes.has(selected.quotation_id) || seenSuppliers.has(selected.supplier_id) ||
      matchingDocuments.length === 0 || matchingDocuments.some((quote) => quote.supplier !== selected.supplier_id)
    ) {
      throw new Error("Selected quotation does not match the current RFQ. Refresh Recommendation Results and select the suppliers again.");
    }
    seenQuotes.add(selected.quotation_id);
    seenSuppliers.add(selected.supplier_id);
  }
  return selections.map((selected) => ({ ...selected }));
}
