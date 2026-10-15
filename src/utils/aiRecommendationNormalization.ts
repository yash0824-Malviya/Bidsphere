import type {
  AIRecommendation,
  QuotePriceStatus,
  SupplierAnalysisRow,
} from "../types/erpnext";
import { isSubmittedQuoteAmount } from "./quotePrice";
import { applyEvaluationDecisionProjection } from "./aiEvaluationDecision";
import { evaluateQuotationCompleteness } from "./quotationCompleteness";

export function normalizeSupplierKey(name: string): string {
  return (name || "")
    .trim()
    .toLowerCase()
    .replace(/^["'\\]+|["'\\]+$/g, "")
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface AuthoritativeQuoteInfo {
  quotation_id?: string;
  supplier_quotation_id?: string;
  supplier_id?: string;
  supplier_name: string;
  total?: number | null;
  grand_total?: number | null;
  priceStatus?: QuotePriceStatus;
  rfq_id?: string;
  docstatus?: number;
  status?: string;
  valid_till?: string;
  delivery_date?: string;
  delivery_days?: number;
  quotation_status?: "COMPLETE" | "INCOMPLETE";
  is_complete?: boolean;
  missing_fields?: string[];
  items?: unknown[];
  byItem?: unknown;
}

export interface NormalizationOptions {
  authoritativeQuotes?: AuthoritativeQuoteInfo[];
  rfqId?: string;
  evaluationRunId?: string;
}

export interface NormalizationParams {
  recommendation: AIRecommendation;
  authoritativeQuotes: AuthoritativeQuoteInfo[];
  rfqId: string;
  evaluationRunId?: string;
}

const identity = (value: string | undefined): string => (value ?? "").trim();

function availableScore(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : -1;
}

/** Resolve a recommendation winner without allowing its label to override IDs. */
export function findRecommendationWinner(
  recommendation: AIRecommendation,
  rows: SupplierAnalysisRow[] = recommendation.supplier_analysis,
): SupplierAnalysisRow | undefined {
  const stable = recommendation as AIRecommendation & { recommended_quotation_id?: string; recommended_supplier_id?: string };
  const quotationId = identity(stable.recommended_quotation_id);
  const supplierId = identity(stable.recommended_supplier_id);
  if (quotationId || supplierId) {
    const matches = rows.filter((row) =>
      (!quotationId || (identity(row.quotation_id) || identity(row.supplier_quotation_id)) === quotationId) &&
      (!supplierId || identity(row.supplier_id) === supplierId));
    return matches.length === 1 ? matches[0] : undefined;
  }
  const idMatches = rows.filter((row) => row.supplier_id === recommendation.recommended_supplier);
  if (idMatches.length) return idMatches.length === 1 ? idMatches[0] : undefined;
  const names = rows.filter((row) => normalizeSupplierKey(row.name) === normalizeSupplierKey(recommendation.recommended_supplier));
  return names.length === 1 ? names[0] : undefined;
}

function unavailableRecommendation(recommendation: AIRecommendation): AIRecommendation {
  const message = "AI evaluation unavailable or incomplete. Run the analysis again for the current quotations.";
  return Object.assign({
    ...recommendation,
    recommended_supplier: "",
    confidence_score: -1,
    supplier_analysis: [],
    recommendation_summary: message,
    final_verdict: message,
    reason: message,
    risk_flags: [],
    risk_factors: [],
    per_item_analysis: [],
    per_item_recommendation: [],
    negotiation_tips: [],
    split_order_option: { recommended: false, reason: message, suggestion: "" },
  }, { recommended_quotation_id: undefined, recommended_supplier_id: undefined });
}

/**
 * Normalizes, verifies, and deduplicates an AI Recommendation dataset.
 *
 * Invariant: Exactly ONE recommendation row per UNIQUE authoritative supplier quotation.
 *
 * Rules:
 * 1. Scoped strictly to the provided RFQ ID and authoritative supplier quotations.
 * 2. Deduplicates rows by stable key (quotation_id, supplier_id, normalized supplier key).
 * 3. Never merges fields across different evaluation runs or duplicates (keeps internally consistent score, risk, verdict).
 * 4. Uses the authoritative quote total from the Supplier Quotation document (replaces stale/cached $0.00).
 * 5. Preserves the gateway's complete-price priority, then sorts by overall AI score.
 * 6. Assigns sequential ranks (1..N) AFTER deduplication.
 * 7. Enforces that recommendation count === unique quotation count (or subset if uninvited).
 */
export function normalizeAndDeduplicateRecommendation(
  paramsOrRecommendation: NormalizationParams | AIRecommendation,
  legacyOptions?: NormalizationOptions
): AIRecommendation {
  let recommendation: AIRecommendation;
  let authoritativeQuotes: AuthoritativeQuoteInfo[] = [];
  let rfqId = "";
  let evaluationRunId: string | undefined;

  if (!paramsOrRecommendation) {
    throw new Error("Cannot normalize undefined or null recommendation.");
  }
  if (legacyOptions || !("recommendation" in paramsOrRecommendation)) {
    recommendation = paramsOrRecommendation as AIRecommendation;
    authoritativeQuotes = legacyOptions?.authoritativeQuotes ?? [];
    rfqId = legacyOptions?.rfqId ?? "";
    evaluationRunId = legacyOptions?.evaluationRunId;
  } else {
    recommendation = (paramsOrRecommendation as NormalizationParams).recommendation;
    authoritativeQuotes = (paramsOrRecommendation as NormalizationParams).authoritativeQuotes;
    rfqId = (paramsOrRecommendation as NormalizationParams).rfqId;
    evaluationRunId = (paramsOrRecommendation as NormalizationParams).evaluationRunId;
  }
  if (!recommendation) {
    throw new Error("Cannot normalize undefined or null recommendation.");
  }

  const rawRows: SupplierAnalysisRow[] = Array.isArray(
    recommendation.supplier_analysis
  )
    ? recommendation.supplier_analysis
    : [];

  const sourceRfq = identity(recommendation.rfq_id);
  const sourceRun = identity(recommendation.evaluation_run_id);
  const requestedRfq = identity(rfqId);
  const requestedRun = identity(evaluationRunId);
  if ((sourceRfq && requestedRfq && sourceRfq !== requestedRfq) ||
      (sourceRun && requestedRun && sourceRun !== requestedRun)) {
    return unavailableRecommendation(recommendation);
  }
  const rowRuns = new Set(rawRows.map((row) => identity(row.evaluation_run_id)).filter(Boolean));
  if (!sourceRun && !requestedRun && rowRuns.size > 1) {
    return unavailableRecommendation(recommendation);
  }
  const currentRfq = requestedRfq || sourceRfq;
  const currentRun = requestedRun || sourceRun || undefined;
  const filterRun = currentRun || [...rowRuns][0];
  const currentQuotes = authoritativeQuotes.filter((quote) =>
    !currentRfq || !quote.rfq_id || identity(quote.rfq_id) === currentRfq);
  const quoteId = (quote: AuthoritativeQuoteInfo): string =>
    identity(quote.quotation_id) || identity(quote.supplier_quotation_id);
  const authoritativeIdsExist = currentQuotes.some((quote) => quoteId(quote));

  const findMatchingQuote = (
    row: SupplierAnalysisRow
  ): AuthoritativeQuoteInfo | undefined => {
    const primaryId = identity(row.quotation_id);
    const aliasId = identity(row.supplier_quotation_id);
    if (primaryId && aliasId && primaryId !== aliasId) return undefined;
    const rowId = primaryId || aliasId;
    const supplierId = identity(row.supplier_id);
    let candidates = currentQuotes;
    if (rowId && authoritativeIdsExist) {
      candidates = candidates.filter((quote) => quoteId(quote) === rowId);
      if (candidates.length === 0) return undefined;
    }
    if (supplierId) {
      candidates = candidates.filter((quote) =>
        identity(quote.supplier_id) === supplierId ||
        (quote.supplier_id && normalizeSupplierKey(quote.supplier_id) === normalizeSupplierKey(supplierId))
      );
      if (candidates.length === 0) return undefined;
    }
    if (!rowId && !supplierId) {
      const name = normalizeSupplierKey(row.name);
      candidates = candidates.filter((quote) =>
        normalizeSupplierKey(quote.supplier_name) === name ||
        normalizeSupplierKey(quote.supplier_id ?? "") === name);
    } else if (rowId && !authoritativeIdsExist && !supplierId) {
      // A legacy snapshot without quotation IDs cannot verify an explicit ID.
      return undefined;
    }
    // A display name or supplier ID may refer to multiple quotation rounds.
    // Never select whichever happened to occur first in the array.
    const unique = new Map(candidates.map((quote) => [
      quoteId(quote) || identity(quote.supplier_id) || normalizeSupplierKey(quote.supplier_name),
      quote,
    ]));
    return unique.size === 1 ? [...unique.values()][0] : undefined;
  };

  // Group candidate recommendation rows by stable quotation / supplier key
  const groupedByStableKey = new Map<string, SupplierAnalysisRow[]>();

  for (const row of rawRows) {
    const rowRun = identity(row.evaluation_run_id);
    if ((currentRfq && row.rfq_id && identity(row.rfq_id) !== currentRfq) ||
        (filterRun && rowRun && rowRun !== filterRun) ||
        (filterRun && !rowRun && !sourceRun)) {
      continue;
    }
    if (row.quotation_id && row.supplier_quotation_id &&
        identity(row.quotation_id) !== identity(row.supplier_quotation_id)) continue;
    const matchedQuote = findMatchingQuote(row);
    // If quotes are provided, drop any recommendation that doesn't correspond to a current quotation
    if (authoritativeQuotes.length > 0 && !matchedQuote) {
      continue;
    }

    const stableKey =
      (matchedQuote && quoteId(matchedQuote)) ||
      identity(row.quotation_id) || identity(row.supplier_quotation_id) ||
      identity(matchedQuote?.supplier_id) || identity(row.supplier_id) ||
      normalizeSupplierKey(row.name);

    if (!stableKey) continue;

    const list = groupedByStableKey.get(stableKey) ?? [];
    list.push(row);
    groupedByStableKey.set(stableKey, list);
  }

  // Deduplicate: pick exactly one authoritative evaluation record per unique quotation/supplier
  const uniqueRows: SupplierAnalysisRow[] = [];

  for (const [, rows] of groupedByStableKey) {
    if (rows.length === 0) continue;
    if (new Set(rows.map((row) => identity(row.supplier_id)).filter(Boolean)).size > 1) continue;

    // Pick the most complete/authoritative row without mixing attributes
    const chosen = [...rows].sort((a, b) => {
      const aScore = availableScore(a.score?.overall);
      const bScore = availableScore(b.score?.overall);
      // Valid score (>= 0) strictly preferred over invalid/placeholder (-1)
      if ((aScore >= 0) !== (bScore >= 0)) {
        return bScore >= 0 ? 1 : -1;
      }
      // Higher score preferred
      if (aScore !== bScore) {
        return bScore - aScore;
      }
      // If scores match, row with valid price preferred
      const aPriceValid = isSubmittedQuoteAmount(a.grand_total);
      const bPriceValid = isSubmittedQuoteAmount(b.grand_total);
      if (aPriceValid !== bPriceValid) {
        return bPriceValid ? 1 : -1;
      }
      // Tie-breaker: stable name sort
      return (a.name || "").localeCompare(b.name || "");
    })[0];

    const matchedQuote = findMatchingQuote(chosen);

    // Deep clone chosen row so we don't mutate external objects
    const resolvedRow: SupplierAnalysisRow = {
      ...structuredClone(chosen),
      score: {
        ...chosen.score,
        cost: availableScore(chosen.score?.cost),
        delivery: availableScore(chosen.score?.delivery),
        reliability: availableScore(chosen.score?.reliability),
        overall: availableScore(chosen.score?.overall),
      },
      strengths: [...(chosen.strengths ?? [])],
      weaknesses: [...(chosen.weaknesses ?? [])],
      name: matchedQuote?.supplier_name || chosen.name,
      quotation_id: (matchedQuote && quoteId(matchedQuote)) || chosen.quotation_id || chosen.supplier_quotation_id,
      supplier_quotation_id:
        (matchedQuote && quoteId(matchedQuote)) || chosen.supplier_quotation_id || chosen.quotation_id,
      supplier_id: identity(matchedQuote?.supplier_id) || chosen.supplier_id,
      rfq_id: currentRfq || chosen.rfq_id,
      // Only an explicit matching envelope proves an untagged row's run.
      // A caller's requested run and another row's run are not provenance.
      evaluation_run_id: chosen.evaluation_run_id || sourceRun || undefined,
    };
    if (resolvedRow.score.overall < 0) {
      resolvedRow.verdict = "NOT EVALUATED";
      Object.assign(resolvedRow, { evaluation_status: "incomplete" });
    }

    // Reconcile quote price from authoritative Supplier Quotation
    const quoteTotal = matchedQuote ? (matchedQuote.total ?? matchedQuote.grand_total ?? null) : null;
    if (matchedQuote && isSubmittedQuoteAmount(quoteTotal)) {
      resolvedRow.grand_total = quoteTotal;
      resolvedRow.quote_price_status =
        matchedQuote.priceStatus ?? "submitted";
    } else if (matchedQuote && ("total" in matchedQuote || "grand_total" in matchedQuote)) {
      resolvedRow.grand_total = null;
      resolvedRow.quote_price_status =
        matchedQuote.priceStatus ?? "price_not_provided";
    }

    // Reconcile quotation completeness from authoritative quotation or resolved row
    let completeness: { quotation_status: "COMPLETE" | "INCOMPLETE"; is_complete: boolean; missing_fields: string[] };
    if (matchedQuote) {
      completeness = evaluateQuotationCompleteness(matchedQuote);
    } else if (typeof chosen.is_complete === "boolean") {
      completeness = {
        is_complete: chosen.is_complete,
        quotation_status: chosen.quotation_status ?? (chosen.is_complete ? "COMPLETE" : "INCOMPLETE"),
        missing_fields: chosen.missing_fields ?? [],
      };
    } else if (chosen.quotation_status === "COMPLETE" || chosen.quotation_status === "INCOMPLETE") {
      completeness = {
        is_complete: chosen.quotation_status === "COMPLETE",
        quotation_status: chosen.quotation_status,
        missing_fields: chosen.missing_fields ?? [],
      };
    } else if (
      resolvedRow.quote_price_status === "price_not_provided" ||
      resolvedRow.quote_price_status === "not_submitted" ||
      resolvedRow.grand_total === null
    ) {
      completeness = {
        is_complete: false,
        quotation_status: "INCOMPLETE",
        missing_fields: ["Pricing"],
      };
    } else if (resolvedRow.verdict === "QUOTE INCOMPLETE") {
      completeness = {
        is_complete: false,
        quotation_status: "INCOMPLETE",
        missing_fields: chosen.missing_fields ?? ["Quotation Submission"],
      };
    } else {
      completeness = {
        is_complete: true,
        quotation_status: "COMPLETE",
        missing_fields: [],
      };
    }

    resolvedRow.quotation_status = completeness.quotation_status;
    resolvedRow.is_complete = completeness.is_complete;
    resolvedRow.missing_fields = completeness.missing_fields;

    if (resolvedRow.is_complete && resolvedRow.verdict === "QUOTE INCOMPLETE") {
      resolvedRow.verdict = (resolvedRow.risk === "High" || resolvedRow.risk === "HIGH RISK") ? "HIGH RISK / REVIEW" : (resolvedRow.rank === 1 ? "BEST VALUE" : "GOOD OPTION");
    } else if (!resolvedRow.is_complete && resolvedRow.verdict !== "AVOID" && resolvedRow.verdict !== "NOT EVALUATED") {
      resolvedRow.verdict = "QUOTE INCOMPLETE";
    }

    uniqueRows.push(resolvedRow);
  }

  // Match the gateway: incomplete-price scores use different weighting and
  // cannot displace its fully quoted leader in the displayed ranking.
  uniqueRows.sort((a, b) => {
    const pricePriority = Number(b.score.cost >= 0) - Number(a.score.cost >= 0);
    if (pricePriority) return pricePriority;
    const scoreA = availableScore(a.score?.overall);
    const scoreB = availableScore(b.score?.overall);
    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }
    // Preserve the model's ordering on genuine ties and keep its winner and
    // narrative together; document IDs only break otherwise identical ranks.
    if (a.rank !== b.rank) return a.rank - b.rank;
    const idA = a.quotation_id || a.name || "";
    const idB = b.quotation_id || b.name || "";
    return idA.localeCompare(idB);
  });

  // Assign sequential ranks 1..N AFTER sorting
  const rankedRows = uniqueRows.map((row, idx) => ({
    ...row,
    rank: idx + 1,
  }));

  const recommendedRow = findRecommendationWinner(recommendation, rankedRows);
  if (rankedRows.length === 0 || (recommendation.recommended_supplier && !recommendedRow)) {
    return unavailableRecommendation(recommendation);
  }

  return applyEvaluationDecisionProjection(Object.assign({
    ...recommendation,
    rfq_id: currentRfq || recommendation.rfq_id,
    evaluation_run_id: currentRun || recommendation.evaluation_run_id,
    recommended_supplier: recommendedRow?.name ?? recommendation.recommended_supplier,
    confidence_score: availableScore(recommendation.confidence_score),
    supplier_analysis: rankedRows,
  }, {
    recommended_quotation_id: recommendedRow?.quotation_id,
    recommended_supplier_id: recommendedRow?.supplier_id,
  }));
}
