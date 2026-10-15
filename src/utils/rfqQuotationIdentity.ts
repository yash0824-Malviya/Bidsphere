export interface RfqQuotationIdentity {
  supplier_id: string;
  quotation_id?: string;
  rfq_id?: string;
}

/** Resolve only within the caller's current RFQ query; names and fuzzy aliases are not identifiers. */
export function resolveRfqQuotationIdentity<T extends { name: string; supplier: string }>(
  rfqId: string,
  identity: RfqQuotationIdentity,
  quotations: T[],
): T {
  if (!identity.supplier_id?.trim() || (identity.rfq_id && identity.rfq_id !== rfqId)) {
    throw new Error("Supplier Quotation identity does not match the current RFQ.");
  }
  const uniqueQuotations = new Map<string, T>();
  for (const quote of quotations) {
    const existing = uniqueQuotations.get(quote.name);
    if (existing && existing.supplier !== quote.supplier) {
      throw new Error("Conflicting Supplier Quotation identities were returned for the current RFQ.");
    }
    uniqueQuotations.set(quote.name, quote);
  }
  const matches = [...uniqueQuotations.values()].filter((quote) =>
    quote.supplier === identity.supplier_id &&
    (!identity.quotation_id || quote.name === identity.quotation_id));
  if (matches.length !== 1) {
    throw new Error("A unique current Supplier Quotation for the selected supplier is required. Refresh the RFQ and try again.");
  }
  return matches[0];
}
