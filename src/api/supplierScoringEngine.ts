/**
 * Deterministic Supplier Scoring Engine.
 *
 * Computes per-supplier dimension scores (Price, Delivery, Quality,
 * Reliability) using a combination of:
 *   1. Current quotation data (price, delivery days, item coverage)
 *   2. Real ERPNext historical performance (POs, GRNs, Invoices)
 *
 * When historical data exists, it is blended with quotation signals.
 * When no historical data exists, the dimension is flagged as
 * "insufficient_data" and confidence is reduced.
 *
 * Score formula:
 *   Final Score = (Price×PW + Delivery×DW + Quality×QW + Reliability×RW) / 100
 *
 * All dimension scores are 0–100 integers, or -1 if insufficient data.
 */

import type { ScoringWeights } from "./supplierScoring";
import { DEFAULT_SCORING_WEIGHTS } from "../types/erpnext";
import type {
  SupplierDimensionScores,
  SupplierScoreRow,
} from "../types/erpnext";
import type { AIQuotation } from "./ai";
import { nowERPDateTime } from "../utils/erpDate";
import type { HistoricalPerformanceMap } from "./supplierPerformance";

/* -------------------------------------------------------------------------- */
/*  Public types                                                              */
/* -------------------------------------------------------------------------- */

export interface ScoreSource {
  dimension: string;
  value: number;
  source: string;
  has_data: boolean;
}

export interface ScoredSupplier {
  quotation_id?: string;
  supplier_id?: string;
  evaluation_run_id?: string;
  supplier: string;
  supplier_name: string;
  dimensions: SupplierDimensionScores;
  final_score: number;
  ranking: number;
  recommendation_reason: string;
  /** Per-dimension data sources and sufficiency indicators */
  score_sources: ScoreSource[];
  /** True if all dimensions have real data */
  has_sufficient_data: boolean;
  /** Confidence level reduced when historical data is missing */
  confidence_level: "high" | "medium" | "low";
  risk_level?: "Low" | "Medium" | "High" | string;
}

export interface ScoringEngineResult {
  evaluation_run_id?: string;
  weights: ScoringWeights;
  scored_at: string;
  suppliers: ScoredSupplier[];
}

/* -------------------------------------------------------------------------- */
/*  Internal scoring helpers                                                  */
/* -------------------------------------------------------------------------- */

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Linear inverse scale: the LOWEST value gets 100, the highest gets a
 * proportionally lower score.  When all values are identical every
 * supplier scores 100 (no differentiation possible).
 */
function inverseLinearScale(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 100);
  return values.map((v) => clamp(((max - v) / (max - min)) * 100));
}

/**
 * Linear direct scale: the HIGHEST value gets 100.
 */
function directLinearScale(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 100);
  return values.map((v) => clamp(((v - min) / (max - min)) * 100));
}

/* -------------------------------------------------------------------------- */
/*  Dimension extractors — quotation-based                                    */
/* -------------------------------------------------------------------------- */

function extractTotals(quotations: AIQuotation[]): Array<number | null> {
  return quotations.map((q) => {
    if (typeof q.total_value === "number" && Number.isFinite(q.total_value)) {
      return q.total_value;
    }
    if (Array.isArray(q.items) && q.items.length > 0) {
      let sum = 0;
      let hasItemPrice = false;
      for (const item of q.items) {
        if (typeof item.total === "number" && Number.isFinite(item.total) && item.total > 0) {
          sum += item.total;
          hasItemPrice = true;
        } else if (typeof item.unit_price === "number" && Number.isFinite(item.unit_price)) {
          const qty = typeof item.requested_qty === "number" && item.requested_qty > 0 ? item.requested_qty : 1;
          sum += item.unit_price * qty;
          hasItemPrice = true;
        }
      }
      if (hasItemPrice) return sum;
    }
    return null;
  });
}

function extractAvgDeliveryDays(quotations: AIQuotation[]): number[] {
  return quotations.map((q) => {
    const days = q.items.map((i) => {
      if (typeof i.delivery_days === "number" && i.delivery_days > 0) {
        return i.delivery_days;
      }
      const itemWithDate = i as unknown as {
        expected_delivery_date?: string;
        delivery_date?: string;
      };
      const d = itemWithDate.expected_delivery_date || itemWithDate.delivery_date;
      if (typeof d === "string" && d.trim()) {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const target = new Date(d);
        target.setHours(0, 0, 0, 0);
        const diff = Math.round((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (diff > 0) return diff;
      }
      return 7;
    });
    return days.length > 0
      ? days.reduce((a, b) => a + b, 0) / days.length
      : 7;
  });
}

function extractItemCoverage(
  quotations: AIQuotation[],
  requestedItemCount: number
): number[] {
  if (requestedItemCount <= 0) return quotations.map(() => 100);
  return quotations.map((q) => {
    const quotedItems = q.items.filter(
      (i) => typeof i.unit_price === "number" && Number.isFinite(i.unit_price),
    ).length;
    return (quotedItems / requestedItemCount) * 100;
  });
}

/* -------------------------------------------------------------------------- */
/*  Main scoring function                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Score all suppliers from an RFQ's submitted quotations, enriched with
 * real ERPNext historical performance data when available.
 *
 * @param quotations          — Supplier quotation data
 * @param requestedItemCount  — Number of items in the RFQ
 * @param weights             — Configurable scoring weights (must sum to 100)
 * @param historicalData      — Real ERPNext performance data (POs, GRNs, invoices)
 */
export function scoreSuppliers(
  quotations: AIQuotation[],
  requestedItemCount: number,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
  historicalData?: HistoricalPerformanceMap,
  /** Optional RFQ Target Prices by item_code for variance / savings scoring. */
  targetPrices?: Map<string, number>,
  evaluationRunId?: string,
): ScoringEngineResult {
  if (quotations.length === 0) {
    return {
      evaluation_run_id: evaluationRunId,
      weights,
      scored_at: nowERPDateTime(),
      suppliers: [],
    };
  }

  const totals = extractTotals(quotations);
  const deliveryDays = extractAvgDeliveryDays(quotations);
  const coverage = extractItemCoverage(quotations, requestedItemCount);

  // Price: lower is better. Missing totals retain the engine's existing -1
  // insufficient-data sentinel and never participate in the price scale.
  const submittedTotals = totals.filter((total): total is number => total !== null);
  const scaledSubmittedTotals = inverseLinearScale(submittedTotals);
  let submittedIdx = 0;
  let priceScores = totals.map((total) =>
    total === null ? -1 : scaledSubmittedTotals[submittedIdx++],
  );

  // Blend competitive ranking with distance-to-target when targets exist.
  if (targetPrices && targetPrices.size > 0) {
    const vsTarget = quotations.map((q) => {
      let targetValue = 0;
      let quotedValue = 0;
      for (const line of q.items) {
        const t = targetPrices.get(line.item);
        if (
          t == null ||
          !(t > 0) ||
          line.unit_price === null ||
          !(line.unit_price > 0)
        ) continue;
        const qty = line.requested_qty && line.requested_qty > 0
          ? line.requested_qty
          : line.total !== null && line.total > 0 && line.unit_price > 0
            ? line.total / line.unit_price
            : 1;
        targetValue += t * qty;
        quotedValue += line.unit_price * qty;
      }
      if (targetValue <= 0) return 50;
      /* Below target → high score; above target → lower. Cap 0–100. */
      const ratio = quotedValue / targetValue;
      return clamp(Math.round(100 * (1.2 - ratio)));
    });
    priceScores = priceScores.map((competitive, i) =>
      competitive < 0
        ? -1
        : clamp(Math.round(competitive * 0.7 + vsTarget[i] * 0.3)),
    );
  }

  // Delivery: blend quotation delivery days with historical on-time rate
  const deliveryDayScores = inverseLinearScale(deliveryDays);

  // Quality: blend item coverage with historical qty accuracy
  const coverageScores = directLinearScale(coverage);

  const scored: Array<{
    idx: number;
    quotation_id?: string;
    supplier_id?: string;
    supplier: string;
    supplier_name: string;
    dimensions: SupplierDimensionScores;
    final_score: number;
    total: number | null;
    scoreSources: ScoreSource[];
    hasSufficientData: boolean;
    confidenceLevel: "high" | "medium" | "low";
  }> = quotations.map((q, i) => {
    const hist = historicalData?.[q.supplier_id ?? q.supplier_name] ?? historicalData?.[q.supplier_name];
    const hasPerfData = hist?.has_sufficient_data === true;

    const scoreSources: ScoreSource[] = [];

    // ── Price Score (quotation ranking + optional Target Price variance) ─
    const priceScore = priceScores[i];
    const hasPrice = totals[i] !== null;
    let priceSource = hasPrice
      ? `Current quotation: $${totals[i]!.toLocaleString()}`
      : "Quotation pricing was not provided";
    if (hasPrice && targetPrices && targetPrices.size > 0) {
      let savings = 0;
      for (const line of q.items) {
        const t = targetPrices.get(line.item);
        if (
          t == null ||
          !(t > 0) ||
          line.unit_price === null ||
          !(line.unit_price > 0) ||
          line.unit_price >= t
        )
          continue;
        const qty =
          line.requested_qty && line.requested_qty > 0
            ? line.requested_qty
            : line.total !== null && line.total > 0
              ? line.total / line.unit_price
              : 1;
        savings += (t - line.unit_price) * qty;
      }
      priceSource +=
        savings > 0
          ? ` · vs Target potential savings $${Math.round(savings).toLocaleString()}`
          : " · scored vs Target Price";
    }
    scoreSources.push({
      dimension: "Price",
      value: priceScore,
      source: priceSource,
      has_data: hasPrice,
    });

    // ── Delivery Score ──────────────────────────────────────────────
    let deliveryScore: number;
    if (hasPerfData && hist!.delivery_score >= 0) {
      // Blend: 40% quoted delivery days + 60% historical on-time rate
      deliveryScore = clamp(deliveryDayScores[i] * 0.4 + hist!.delivery_score * 0.6);
      const parts = [`Historical: ${hist!.on_time_deliveries}/${hist!.on_time_deliveries + hist!.late_deliveries} on-time`];
      if (hist!.avg_delay_days > 0) parts.push(`avg delay ${hist!.avg_delay_days}d`);
      parts.push(`Quoted: ${deliveryDays[i].toFixed(0)}d avg`);
      scoreSources.push({
        dimension: "Delivery",
        value: deliveryScore,
        source: parts.join(" · "),
        has_data: true,
      });
    } else {
      deliveryScore = deliveryDayScores[i];
      scoreSources.push({
        dimension: "Delivery",
        value: deliveryScore,
        source: `Quoted delivery: ${deliveryDays[i].toFixed(0)}d avg (no delivery history)`,
        has_data: false,
      });
    }

    // ── Quality Score ───────────────────────────────────────────────
    let qualityScore: number;
    if (hasPerfData && hist!.quality_score >= 0) {
      qualityScore = clamp(coverageScores[i] * 0.3 + hist!.quality_score * 0.7);
      scoreSources.push({
        dimension: "Quality",
        value: qualityScore,
        source: `Historical accuracy: ${hist!.qty_accuracy_pct}% · Item coverage: ${coverage[i].toFixed(0)}%`,
        has_data: true,
      });
    } else {
      qualityScore = coverageScores[i];
      scoreSources.push({
        dimension: "Quality",
        value: qualityScore,
        source: `Item coverage: ${coverage[i].toFixed(0)}% of ${requestedItemCount} items (no quality history)`,
        has_data: false,
      });
    }

    // ── Reliability Score ───────────────────────────────────────────
    let reliabilityScore: number;
    if (hasPerfData && hist!.reliability_score >= 0) {
      reliabilityScore = hist!.reliability_score;
      const parts: string[] = [];
      parts.push(`${hist!.completed_pos}/${hist!.total_pos} POs completed`);
      if (hist!.cancelled_pos > 0) parts.push(`${hist!.cancelled_pos} cancelled`);
      if (hist!.total_invoices > 0) parts.push(`${hist!.invoices_on_time}/${hist!.total_invoices} invoices on time`);
      scoreSources.push({
        dimension: "Reliability",
        value: reliabilityScore,
        source: parts.join(" · "),
        has_data: true,
      });
    } else {
      // Without history, compute a basic signal from quotation completeness
      let baseReliability = 50;
      if (q.payment_terms) baseReliability += 15;
      if (q.notes) baseReliability += 10;
      const withDelivery = q.items.filter(
        (item) => item.delivery_days !== undefined && item.delivery_days > 0
      ).length;
      if (q.items.length > 0) {
        baseReliability += Math.round((withDelivery / q.items.length) * 25);
      }
      reliabilityScore = Math.min(100, baseReliability);
      scoreSources.push({
        dimension: "Reliability",
        value: reliabilityScore,
        source: "Quotation completeness only (no order history)",
        has_data: false,
      });
    }

    const dims: SupplierDimensionScores = {
      price_score: priceScore,
      delivery_score: deliveryScore,
      quality_score: qualityScore,
      reliability_score: reliabilityScore,
    };

    let final: number;
    if (priceScore < 0) {
      // Missing price: score based only on non-price dimensions, never give price advantage
      const nonPriceWeight =
        weights.delivery_weight +
        weights.quality_weight +
        weights.reliability_weight;
      if (nonPriceWeight > 0) {
        final = clamp(
          (dims.delivery_score * weights.delivery_weight +
            dims.quality_score * weights.quality_weight +
            dims.reliability_score * weights.reliability_weight) /
            nonPriceWeight
        );
      } else {
        final = 0;
      }
    } else {
      final = clamp(
        (dims.price_score * weights.price_weight +
          dims.delivery_score * weights.delivery_weight +
          dims.quality_score * weights.quality_weight +
          dims.reliability_score * weights.reliability_weight) /
          100
      );
    }

    const dimensionsWithData = scoreSources.filter((s) => s.has_data).length;
    const hasSufficientData = dimensionsWithData >= 3 && totals[i] !== null;
    const confidenceLevel: "high" | "medium" | "low" =
      totals[i] === null
        ? "low"
        : dimensionsWithData === 4
        ? "high"
        : dimensionsWithData >= 2
        ? "medium"
        : "low";

    return {
      idx: i,
      quotation_id: q.quotation_id,
      supplier_id: q.supplier_id,
      supplier: q.supplier_id ?? q.supplier_name,
      supplier_name: q.supplier_name,
      dimensions: dims,
      final_score: final,
      total: totals[i],
      scoreSources,
      hasSufficientData,
      confidenceLevel,
    };
  });

  // Rank: suppliers with submitted pricing rank ahead of suppliers with missing pricing.
  // Within each group, rank by final_score descending (tiebreak by lowest total).
  scored.sort((a, b) => {
    const aHasPrice = a.total !== null;
    const bHasPrice = b.total !== null;
    if (aHasPrice && !bHasPrice) return -1;
    if (!aHasPrice && bHasPrice) return 1;
    if (b.final_score !== a.final_score) return b.final_score - a.final_score;
    return (a.total ?? Number.POSITIVE_INFINITY) -
      (b.total ?? Number.POSITIVE_INFINITY);
  });

  const suppliers: ScoredSupplier[] = scored.map((s, rank) => ({
    quotation_id: s.quotation_id,
    supplier_id: s.supplier_id,
    evaluation_run_id: evaluationRunId,
    supplier: s.supplier,
    supplier_name: s.supplier_name,
    dimensions: s.dimensions,
    final_score: s.final_score,
    ranking: rank + 1,
    recommendation_reason: buildReason(s, rank + 1, scored.length),
    score_sources: s.scoreSources,
    has_sufficient_data: s.hasSufficientData,
    confidence_level: s.confidenceLevel,
  }));

  return {
    evaluation_run_id: evaluationRunId,
    weights,
    scored_at: nowERPDateTime(),
    suppliers,
  };
}

/* -------------------------------------------------------------------------- */
/*  Reason generator                                                          */
/* -------------------------------------------------------------------------- */

function buildReason(
  s: {
    supplier: string;
    dimensions: SupplierDimensionScores;
    final_score: number;
    total: number | null;
    scoreSources: ScoreSource[];
    hasSufficientData: boolean;
  },
  rank: number,
  total: number
): string {
  const best = rank === 1 && s.total !== null;
  const dims = s.dimensions;
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  if (dims.price_score < 0) weaknesses.push("quotation pricing not provided");
  else if (dims.price_score >= 80) strengths.push("competitive pricing");
  else if (dims.price_score < 40) weaknesses.push("higher cost");

  if (dims.delivery_score >= 80) strengths.push("strong delivery performance");
  else if (dims.delivery_score < 40) weaknesses.push("delivery concerns");

  if (dims.quality_score >= 80) strengths.push("high quality track record");
  else if (dims.quality_score < 40) weaknesses.push("quality concerns");

  if (dims.reliability_score >= 80) strengths.push("highly reliable");
  else if (dims.reliability_score < 40) weaknesses.push("reliability concerns");

  const dataNote = !s.hasSufficientData
    ? s.total === null
      ? " (Note: Incomplete quotation — pricing not provided.)"
      : " (Note: Limited historical data — confidence reduced.)"
    : "";

  if (best) {
    const sText = strengths.length > 0
      ? strengths.join(", ")
      : "balanced performance across all dimensions";
    return `Rank #1 with a weighted score of ${s.final_score}/100. Strengths: ${sText}.${dataNote}`;
  }

  if (s.total === null) {
    return `Quotation pricing was not provided for this supplier. Evaluated on operational factors only (${s.final_score}/100).${dataNote}`;
  }

  const parts: string[] = [`Rank #${rank} of ${total} with a score of ${s.final_score}/100.`];
  if (strengths.length) parts.push(`Strengths: ${strengths.join(", ")}.`);
  if (weaknesses.length) parts.push(`Areas of concern: ${weaknesses.join(", ")}.`);
  if (dataNote) parts.push(dataNote);
  return parts.join(" ");
}

/* -------------------------------------------------------------------------- */
/*  Conversion helper — ScoredSupplier → SupplierScoreRow shape               */
/* -------------------------------------------------------------------------- */

export function toScoreRows(suppliers: ScoredSupplier[]): Omit<SupplierScoreRow, keyof import("../types/erpnext").ErpDoc>[] {
  return suppliers.map((s) => ({
    supplier: s.supplier,
    supplier_name: s.supplier_name,
    price_score: s.dimensions.price_score,
    delivery_score: s.dimensions.delivery_score,
    quality_score: s.dimensions.quality_score,
    reliability_score: s.dimensions.reliability_score,
    final_score: s.final_score,
    ranking: s.ranking,
    recommendation_reason: s.recommendation_reason,
  }));
}
