import type { SupplierAnalysisRow, SupplierVerdict } from "../types/erpnext";
import { buildEvaluationSummary, projectSupplierDecision } from "./aiEvaluationDecision";
import { evaluateQuotationCompleteness } from "./quotationCompleteness";

/** Shared by the Claude gateway and browser parser; no provider or UI dependency. */
export interface EvaluationWeights {
  price_weight: number;
  delivery_weight: number;
  quality_weight: number;
  reliability_weight: number;
}

export interface EvaluationDimensions {
  price_score: number;
  delivery_score: number;
  quality_score: number;
  reliability_score: number;
}

export interface EvaluationContext {
  rfq_id: string;
  evaluation_run_id: string;
  weights: EvaluationWeights;
  quotations: Array<{
    quotation_id: string;
    supplier_id: string;
    supplier_name: string;
    total_value: number | null;
  }>;
}

function scoreNumber(value: unknown, label: string, allowUnavailable = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) ||
      (value < 0 && !(allowUnavailable && value === -1)) || value > 100) {
    throw new Error(`AI evaluation incomplete: ${label} must be a finite score from 0 to 100.`);
  }
  return value;
}

/** Existing four-dimension formula, including the existing missing-price rule. */
export function calculateWeightedEvaluationScore(
  dimensions: EvaluationDimensions,
  weights: EvaluationWeights,
): number {
  const weightValues = [weights.price_weight, weights.delivery_weight,
    weights.quality_weight, weights.reliability_weight];
  if (weightValues.some((weight) =>
    !Number.isInteger(weight) || weight < 0) ||
    weightValues.reduce((sum, weight) => sum + weight, 0) !== 100) {
    throw new Error("AI evaluation weights must be non-negative integers totaling 100.");
  }
  const price = scoreNumber(dimensions.price_score, "price_score", true);
  const delivery = scoreNumber(dimensions.delivery_score, "delivery_score");
  const quality = scoreNumber(dimensions.quality_score, "quality_score");
  const reliability = scoreNumber(dimensions.reliability_score, "reliability_score");
  const nonPrice = delivery * weights.delivery_weight + quality * weights.quality_weight +
    reliability * weights.reliability_weight;
  const divisor = price < 0 ? 100 - weights.price_weight : 100;
  const numerator = price < 0 ? nonPrice : nonPrice + price * weights.price_weight;
  return divisor === 0 ? 0 : Math.max(0, Math.min(100, Math.round(numerator / divisor)));
}

/**
 * Validate one complete model evaluation per requested quotation before accepting
 * its score. Explicit identities are authoritative; response order is irrelevant.
 */
export function validateAndScoreEvaluation(
  value: unknown,
  context: EvaluationContext,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AI evaluation incomplete: response must be an object.");
  }
  const result = value as Record<string, unknown>;
  if (result.rfq_id !== undefined && result.rfq_id !== context.rfq_id) {
    throw new Error("AI evaluation RFQ does not match the current request.");
  }
  if (!context.evaluation_run_id || result.evaluation_run_id !== context.evaluation_run_id) {
    throw new Error("AI evaluation run does not match the current request.");
  }
  const quotes = new Map(context.quotations.map((quote) => [quote.quotation_id, quote]));
  if (quotes.size !== context.quotations.length || !quotes.size ||
      new Set(context.quotations.map((quote) => quote.supplier_id)).size !== quotes.size ||
      context.quotations.some((quote) => !quote.quotation_id || !quote.supplier_id)) {
    throw new Error("AI evaluation requires unique quotation IDs and supplier IDs.");
  }
  const rankings = result.ranking;
  if (!Array.isArray(rankings) || rankings.length !== quotes.size) {
    throw new Error("AI evaluation incomplete: expected exactly one result per current quotation.");
  }
  const seen = new Set<string>();
  const ranking = rankings.map((value): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("AI evaluation incomplete: invalid supplier result.");
    }
    const row = value as Record<string, unknown>;
    const quotationId = typeof row.quotation_id === "string" ? row.quotation_id : "";
    const quote = quotes.get(quotationId);
    if (!quote || seen.has(quotationId) || row.supplier_id !== quote.supplier_id ||
        row.evaluation_run_id !== context.evaluation_run_id) {
      throw new Error("AI evaluation quotation, supplier, or run identity does not match the current request.");
    }
    seen.add(quotationId);
    if (!["Low", "Medium", "High"].includes(String(row.risk)) ||
        !["BEST VALUE", "GOOD OPTION", "EXPENSIVE", "AVOID", "QUOTE INCOMPLETE", "HIGH RISK / REVIEW"].includes(String(row.verdict))) {
      throw new Error(`AI evaluation incomplete: risk and verdict are required for ${quotationId}.`);
    }
    const rawScore = scoreNumber(row.score, `${quotationId}.score`);
    const dimensions = {
      price_score: scoreNumber(row.price_score, `${quotationId}.price_score`, true),
      delivery_score: scoreNumber(row.delivery_score, `${quotationId}.delivery_score`),
      quality_score: scoreNumber(row.quality_score, `${quotationId}.quality_score`),
      reliability_score: scoreNumber(row.reliability_score, `${quotationId}.reliability_score`),
    };
    if ((quote.total_value === null) !== (dimensions.price_score === -1)) {
      throw new Error(`AI evaluation price availability does not match quotation ${quotationId}.`);
    }
    const completeness = evaluateQuotationCompleteness(quote);
    const computedScore = calculateWeightedEvaluationScore(dimensions, context.weights);
    const isEvaluationIncomplete =
      dimensions.price_score === -1 ||
      !Number.isFinite(computedScore) ||
      computedScore < 0 ||
      row.verdict === "NOT EVALUATED";
    return {
      ...row,
      ...dimensions,
      supplier: quote.supplier_name,
      raw_ai_score: typeof row.raw_ai_score === "number"
        ? scoreNumber(row.raw_ai_score, `${quotationId}.raw_ai_score`) : rawScore,
      score: computedScore,
      evaluation_status: isEvaluationIncomplete ? "incomplete" : "complete",
      quotation_status: completeness.quotation_status,
      is_complete: completeness.is_complete,
      missing_fields: completeness.missing_fields,
    };
  });
  ranking.sort((left, right) => Number(right.price_score !== -1) - Number(left.price_score !== -1) ||
    Number(right.score) - Number(left.score) ||
    (typeof left.rank === "number" ? left.rank : 99) - (typeof right.rank === "number" ? right.rank : 99) ||
    String(left.quotation_id).localeCompare(String(right.quotation_id)));
  const projectedRows: SupplierAnalysisRow[] = [];
  const projectedRanking = ranking.map((row, index) => {
    const completeness = evaluateQuotationCompleteness(row);
    let verdict: SupplierVerdict;
    if (row.verdict === "AVOID") {
      verdict = "AVOID";
    } else if (!completeness.is_complete) {
      verdict = "QUOTE INCOMPLETE";
    } else if (row.risk === "High" || row.verdict === "HIGH RISK / REVIEW") {
      verdict = "HIGH RISK / REVIEW";
    } else if (index === 0 && row.verdict !== "AVOID") {
      verdict = "BEST VALUE";
    } else if (row.verdict === "BEST VALUE") {
      verdict = "GOOD OPTION";
    } else if (row.verdict === "EXPENSIVE") {
      verdict = "EXPENSIVE";
    } else {
      verdict = "GOOD OPTION";
    }
    const isRowEvaluationIncomplete =
      Number(row.price_score) === -1 ||
      !Number.isFinite(Number(row.score)) ||
      Number(row.score) < 0 ||
      row.verdict === "NOT EVALUATED" ||
      row.evaluation_status === "incomplete";
    const decision = projectSupplierDecision({
      name: String(row.supplier), rank: index + 1,
      quotation_id: String(row.quotation_id), supplier_id: String(row.supplier_id),
      evaluation_run_id: context.evaluation_run_id,
      risk: row.risk as SupplierAnalysisRow["risk"], verdict: verdict as SupplierAnalysisRow["verdict"],
      grand_total: quotes.get(String(row.quotation_id))!.total_value,
      quotation_status: completeness.quotation_status,
      is_complete: completeness.is_complete,
      missing_fields: completeness.missing_fields,
      score: { cost: Number(row.price_score), delivery: Number(row.delivery_score),
        quality: Number(row.quality_score), reliability: Number(row.reliability_score), overall: Number(row.score) },
      evaluation_status: (isRowEvaluationIncomplete ? "incomplete" : "complete") as SupplierAnalysisRow["evaluation_status"],
      why_best_or_worst: typeof row.reason === "string" ? row.reason : "",
      strengths: [], weaknesses: [],
    }, index === 0);
    projectedRows.push(decision);
    return {
      ...row, rank: index + 1, verdict: decision.verdict,
      grand_total: decision.grand_total,
      quotation_status: decision.quotation_status,
      is_complete: decision.is_complete,
      missing_fields: decision.missing_fields,
      is_top_ranked: decision.is_top_ranked,
      recommendation_status: decision.recommendation_status,
      recommendation_basis: decision.recommendation_basis,
      recommendation_reason: decision.recommendation_reason,
      awardEligible: decision.awardEligible,
      awardIneligibilityReason: decision.awardIneligibilityReason,
    };
  });
  return {
    ...result,
    rfq_id: context.rfq_id,
    evaluation_run_id: context.evaluation_run_id,
    evaluation_weights: context.weights,
    provider_summary: typeof result.provider_summary === "string" ? result.provider_summary : undefined,
    preserved_evaluation_summary: typeof result.preserved_evaluation_summary === "string"
      ? result.preserved_evaluation_summary
      : typeof result.provider_summary !== "string" && typeof result.summary === "string" ? result.summary : undefined,
    summary: buildEvaluationSummary(projectedRows),
    ranking: projectedRanking,
    recommendedSupplier: ranking[0]?.supplier,
    recommended_quotation_id: ranking[0]?.quotation_id,
    recommended_supplier_id: ranking[0]?.supplier_id,
  };
}
