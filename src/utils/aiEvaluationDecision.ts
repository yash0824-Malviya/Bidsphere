import type { AIRecommendation, SupplierAnalysisRow } from "../types/erpnext";
import { getSupplierAwardEligibility } from "./supplierAwardEligibility";
import { evaluateQuotationCompleteness } from "./quotationCompleteness";

export type EvaluationRisk = "Low" | "Medium" | "High" | "Unavailable";

/** Missing risk is unavailable; a numerical score never establishes supplier risk. */
export function getEvaluationRisk(row: Pick<SupplierAnalysisRow, "risk">): EvaluationRisk {
  return row.risk === "Low" || row.risk === "Medium" || row.risk === "High"
    ? row.risk : "Unavailable";
}

/** Interpret one evaluation row without changing scores, verdicts or award permissions. */
export function projectSupplierDecision(
  row: SupplierAnalysisRow,
  isTopRanked = row.is_top_ranked ?? row.rank === 1,
): SupplierAnalysisRow {
  const risk = getEvaluationRisk(row);

  // Determine completeness:
  // If row has explicit is_complete or quotation_status, prioritize it.
  // Otherwise check if price/quotation indicates completion or incompleteness.
  let isQuotationIncomplete: boolean;
  let missingFields: string[] = row.missing_fields ?? [];

  if (typeof row.is_complete === "boolean") {
    isQuotationIncomplete = !row.is_complete;
  } else if (row.quotation_status === "COMPLETE") {
    isQuotationIncomplete = false;
  } else if (row.quotation_status === "INCOMPLETE") {
    isQuotationIncomplete = true;
  } else if (
    row.quote_price_status === "price_not_provided" ||
    row.quote_price_status === "not_submitted" ||
    row.grand_total === null
  ) {
    isQuotationIncomplete = true;
    if (missingFields.length === 0) missingFields = ["Pricing"];
  } else if (row.verdict === "QUOTE INCOMPLETE") {
    isQuotationIncomplete = true;
    if (missingFields.length === 0) missingFields = ["Quotation Submission"];
  } else {
    isQuotationIncomplete = false;
    missingFields = [];
  }

  const quotation_status: "COMPLETE" | "INCOMPLETE" = isQuotationIncomplete
    ? "INCOMPLETE"
    : "COMPLETE";
  const is_complete = !isQuotationIncomplete;

  const isEvaluationMissing =
    !Number.isFinite(row.score?.overall) || row.score.overall < 0 || row.score.overall > 100 || row.verdict === "NOT EVALUATED" || row.evaluation_status === "incomplete" || (typeof row.score?.cost === "number" && row.score.cost < 0);

  let verdict = row.verdict;
  if (verdict === "AVOID") {
    // AVOID is unconditionally preserved
  } else if (!isQuotationIncomplete) {
    if (verdict === "QUOTE INCOMPLETE") {
      verdict = risk === "High" ? "HIGH RISK / REVIEW" : (isTopRanked ? "BEST VALUE" : "GOOD OPTION");
    }
  } else {
    verdict = "QUOTE INCOMPLETE";
  }

  const concerns = [risk === "High" ? "High risk" : "", verdict === "AVOID" ? "AVOID verdict" : ""]
    .filter(Boolean);
  const eligibility = getSupplierAwardEligibility({
    ...row,
    verdict,
    evaluation_status: isEvaluationMissing ? "incomplete" : (row.evaluation_status ?? "complete"),
    quotation_status,
    is_complete,
  });
  const requiresReview = concerns.length > 0 || risk === "Unavailable" || !eligibility.awardEligible;
  const scoreAvailable = Number.isFinite(row.score?.overall) && row.score.overall >= 0 && row.score.overall <= 100;
  const lead = isTopRanked
    ? eligibility.awardEligible
      ? "AI top-ranked by the configured weighted score."
      : scoreAvailable ? `Highest numerical score: ${row.score.overall}/100.` : "The numerical evaluation is incomplete."
    : "Ranked alternative by the configured weighted score.";
  const recommendation_status: SupplierAnalysisRow["recommendation_status"] = isEvaluationMissing
    ? "NOT_EVALUATED"
    : isQuotationIncomplete && verdict !== "AVOID"
    ? "NOT_EVALUATED"
    : requiresReview
    ? "REQUIRES_REVIEW"
    : isTopRanked
    ? "TOP_RANKED"
    : "RANKED_ALTERNATIVE";
  const recommendation_reason = isQuotationIncomplete
    ? `${lead} ${risk !== "Unavailable" ? `Stored risk: ${risk}. ` : ""}The quotation is incomplete${missingFields.length > 0 && !missingFields.includes("Quotation Submission") ? ` (missing: ${missingFields.join(", ")})` : ""}, so this supplier is ineligible for selection and award.`
    : isEvaluationMissing
      ? `${lead} ${risk !== "Unavailable" ? `Stored risk: ${risk}. ` : ""}The evaluation or quotation pricing is incomplete; it does not establish a supplier recommendation.`
      : `${lead} ${requiresReview
        ? `${concerns.length ? concerns.join(" and ") : "Risk assessment unavailable"} requires review. `
        : ""}Score ranking is not an award recommendation or approval.` +
        (eligibility.awardEligible ? " Award eligibility remains subject to the existing procurement approvals."
          : verdict === "AVOID"
            ? " The stored AVOID verdict blocks supplier selection, reverse bidding and purchase order creation."
            : " The stored evaluation does not permit supplier selection or award.");
  return {
    ...row,
    verdict,
    quotation_status,
    is_complete,
    missing_fields: missingFields,
    evaluation_status: (isEvaluationMissing ? "incomplete" : (row.evaluation_status ?? "complete")) as SupplierAnalysisRow["evaluation_status"],
    // Older snapshots copied generic reasoning into strengths. Retain the
    // reasoning in its neutral field instead of presenting concerns as benefits.
    strengths: (row.strengths ?? []).filter((entry) => entry.trim() !== row.why_best_or_worst?.trim()),
    is_top_ranked: isTopRanked,
    recommendation_status,
    recommendation_basis: "weighted_score",
    recommendation_reason,
    ...eligibility,
    awardIneligibilityReason: eligibility.awardIneligibilityReason,
  };
}

/** The displayed summary is a projection of these same evaluation rows. */
export function buildEvaluationSummary(rows: SupplierAnalysisRow[]): string {
  if (!rows.length) return "AI evaluation unavailable or incomplete. Run the analysis again for the current quotations.";
  return rows.map((input) => {
    const row = projectSupplierDecision(input);
    const score = Number.isFinite(row.score?.overall) && row.score.overall >= 0 && row.score.overall <= 100
      ? `${row.score.overall}/100` : "unavailable";
    const total = typeof row.grand_total === "number" && Number.isFinite(row.grand_total) && row.grand_total >= 0
      ? row.grand_total.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "unavailable";
    const reasoning = row.why_best_or_worst?.trim();
    return `${row.name}: score ${score}; risk ${getEvaluationRisk(row)}; verdict ${row.verdict}; quote total ${total}. ` +
      `${row.recommendation_reason}${reasoning ? ` Evaluation reasoning: ${reasoning}` : ""}`;
  }).join("\n\n");
}

/** Resolve the legacy score-leader identity without mixing another supplier's fields. */
export function applyEvaluationDecisionProjection(recommendation: AIRecommendation): AIRecommendation {
  const rows = recommendation.supplier_analysis;
  const quotationId = recommendation.recommended_quotation_id;
  const supplierId = recommendation.recommended_supplier_id;
  const candidates = rows.filter((row) => quotationId || supplierId
    ? (!quotationId || (row.quotation_id || row.supplier_quotation_id) === quotationId) &&
      (!supplierId || row.supplier_id === supplierId)
    : row.supplier_id === recommendation.recommended_supplier || row.name === recommendation.recommended_supplier);
  const winner = candidates.length === 1 ? candidates[0] : undefined;
  const supplier_analysis = rows.map((row) => projectSupplierDecision(row, row === winner));
  const summary = buildEvaluationSummary(supplier_analysis);
  return {
    ...recommendation,
    preserved_evaluation_summary: recommendation.preserved_evaluation_summary ??
      (recommendation.provider_summary === undefined ? recommendation.recommendation_summary : undefined),
    supplier_analysis,
    recommendation_summary: summary,
    final_verdict: summary,
    reason: summary,
  };
}
