import type { AIRecommendation } from '../types/erpnext';
import type { ScoringEngineResult } from '../api/supplierScoringEngine';
import type { ScoringWeights } from '../api/supplierScoring';
import { calculateWeightedEvaluationScore } from './aiEvaluationScore';

/** Persist the same complete evaluation shown to the user, without mixing scoring runs. */
export function scoringResultFromRecommendation(
  recommendation: AIRecommendation,
  weights: ScoringWeights,
): ScoringEngineResult {
  const run = recommendation.evaluation_run_id;
  if (!run || !recommendation.supplier_analysis.length) throw new Error('AI evaluation unavailable / incomplete.');
  const evaluatedWeights = recommendation.evaluation_weights;
  if (!evaluatedWeights ||
      evaluatedWeights.price_weight !== weights.price_weight ||
      evaluatedWeights.delivery_weight !== weights.delivery_weight ||
      evaluatedWeights.quality_weight !== weights.quality_weight ||
      evaluatedWeights.reliability_weight !== weights.reliability_weight) {
    throw new Error('AI evaluation weights do not match the configuration used for persistence.');
  }
  const quotes = new Set<string>();
  const suppliers = new Set<string>();
  const rows = recommendation.supplier_analysis.map((row) => {
    if (!row.quotation_id || !row.supplier_id || row.evaluation_run_id !== run ||
        quotes.has(row.quotation_id) || suppliers.has(row.supplier_id) ||
        (row.rfq_id !== undefined && row.rfq_id !== recommendation.rfq_id)) {
      throw new Error('AI evaluation quotation, supplier or run identity is invalid.');
    }
    quotes.add(row.quotation_id); suppliers.add(row.supplier_id);
    const dimensions = {price_score:row.score.cost, delivery_score:row.score.delivery,
      quality_score:row.score.quality!, reliability_score:row.score.reliability};
    if (row.evaluation_status === 'incomplete' || ![...Object.values(dimensions),row.score.overall]
      .every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100)) {
      throw new Error('AI evaluation unavailable / incomplete.');
    }
    if (calculateWeightedEvaluationScore(dimensions, weights) !== row.score.overall) {
      throw new Error('AI evaluation score does not match its four dimensions and configured weights.');
    }
    return { quotation_id:row.quotation_id, supplier_id:row.supplier_id, evaluation_run_id:run,
      supplier:row.supplier_id, supplier_name:row.name, dimensions, final_score:row.score.overall,
      ranking:row.rank, recommendation_reason:row.why_best_or_worst,
      score_sources:row.score_sources?.map((source) => ({...source})) ?? [], has_sufficient_data:row.has_sufficient_data ?? false,
      confidence_level:row.confidence_level ?? 'low' as const };
  });
  return {evaluation_run_id:run, weights,scored_at:new Date().toISOString(),suppliers:rows};
}
