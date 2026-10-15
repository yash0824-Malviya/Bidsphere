export interface SupplierAwardEligibility {
  awardEligible: boolean;
  awardIneligibilityReason?: string;
}

/** Structural input keeps this policy safe to import in the Node gateway. */
export interface SupplierAwardAssessment {
  verdict?: unknown;
  risk?: unknown;
  evaluation_status?: unknown;
  quote_price_status?: unknown;
  quotation_status?: unknown;
  is_complete?: unknown;
}

/**
 * Award suitability is independent of the numerical score and rank.
 * Callers must resolve the current quotation/supplier evaluation first. The
 * server loads it from ERPNext rather than trusting eligibility sent by a client.
 * No authorized risk-override workflow exists in the current implementation.
 */
export function getSupplierAwardEligibility(row: SupplierAwardAssessment | null | undefined): SupplierAwardEligibility {
  if (!row) return {
    awardEligible: false,
    awardIneligibilityReason: "Supplier award eligibility is unavailable. Refresh the current RFQ evaluation before selecting a supplier.",
  };
  if (row.verdict === "AVOID") return {
    awardEligible: false,
    awardIneligibilityReason: row.risk === "High"
      ? "Supplier is currently marked AVOID due to high risk and cannot be selected for award."
      : "Supplier is currently marked AVOID and cannot be selected for award.",
  };
  if (row.verdict === "QUOTE INCOMPLETE" || row.quotation_status === "INCOMPLETE" || row.is_complete === false) return {
    awardEligible: false,
    awardIneligibilityReason: "Quote incomplete. Complete the supplier quotation before selection.",
  };
  if (typeof row.verdict !== "string" || !["BEST VALUE", "GOOD OPTION", "EXPENSIVE", "HIGH RISK / REVIEW"].includes(row.verdict) ||
      row.evaluation_status === "incomplete" || row.quote_price_status === "price_not_provided" ||
      row.quote_price_status === "not_submitted") return {
    awardEligible: false,
    awardIneligibilityReason: "A complete supplier evaluation and submitted quotation are required before selection.",
  };
  // High risk by itself has no configured non-awardable rule. Preserve that
  // existing policy; the explicit AVOID verdict is an unconditional block.
  return { awardEligible: true };
}
