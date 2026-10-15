/**
 * Multi-provider AI integration for the Smart RFQ recommendation panel.
 * Fallback chain: Claude (retries) → OpenAI (retries) → Local scoring engine.
 *
 * Claude credentials remain on the server-side gateway.
 */

import type {
  AIRecommendation,
  AIRiskFlag,
  AIPerItemAnalysis,
  SupplierAnalysisRow,
  SupplierVerdict,
  QuotePriceStatus,
} from "../types/erpnext";
import { formatCurrency } from "../utils/format";
import { isSubmittedQuoteAmount, priceFromLines } from "../utils/quotePrice";
import type { ScoringEngineResult } from "./supplierScoringEngine";
import type { SupplierPerformanceData } from "./supplierPerformance";
import { applyEvaluationDecisionProjection } from "../utils/aiEvaluationDecision";
import {
  validateAndScoreEvaluation,
  type EvaluationContext,
} from "../utils/aiEvaluationScore";
import { evaluateQuotationCompleteness } from "../utils/quotationCompleteness";

import { ANTHROPIC_MODEL } from "../config/aiConfig";

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

const OPENAI_MODEL =
  (import.meta.env.VITE_OPENAI_MODEL as string | undefined)?.trim() ||
  DEFAULT_OPENAI_MODEL;

/** Backoff delays before retry attempts 2, 3, and 4 (ms). */
const RETRY_BACKOFF_MS = [2_000, 5_000, 10_000] as const;

export type AIProvider = "claude" | "openai" | "local";

export interface AIProviderAvailability {
  claude: boolean;
  openai: boolean;
  local: boolean;
}

export interface ResolvedAIAnalysis {
  recommendation: AIRecommendation;
  provider: Exclude<AIProvider, "local">;
  tokensUsed: number;
}

/** User-facing notice when cloud AI is unavailable but local analysis succeeded. */
export const AI_FALLBACK_NOTICE =
  "Advanced AI insights temporarily unavailable. Intelligent procurement analysis generated successfully.";

export interface AIQuotationLine {
  item: string;
  requested_qty?: number;
  unit_price: number | null;
  total: number | null;
  delivery_days?: number;
  notes?: string;
}

export interface AIQuotationDocuments {
  warranty_certificate?: boolean;
  terms_conditions?: boolean;
  insurance_certificate?: boolean;
}

export interface AIQuotation {
  quotation_id?: string;
  supplier_id?: string;
  supplier_name: string;
  items: AIQuotationLine[];
  total_value: number | null;
  price_status?: QuotePriceStatus;
  payment_terms?: string;
  notes?: string;
  documents?: AIQuotationDocuments;
  historical_data?: SupplierPerformanceData;
}

export interface AIRequest {
  evaluation_run_id?: string;
  rfq_name: string;
  rfq_title: string;
  items_requested: Array<{
    item: string;
    qty: number;
    uom?: string;
  }>;
  quotations: AIQuotation[];
}

export interface AIAnalysisResponse {
  recommendation: AIRecommendation;
  tokensUsed: number;
}

export class AIRecommendationError extends Error {
  cause?: unknown;
  retryable: boolean;
  statusCode?: number;

  constructor(
    message: string,
    options?: { cause?: unknown; retryable?: boolean; statusCode?: number }
  ) {
    super(message);
    this.name = "AIRecommendationError";
    this.cause = options?.cause;
    this.retryable = options?.retryable ?? false;
    this.statusCode = options?.statusCode;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status === 529 || status === 502 || status === 503 || status === 504;
}

export function getAIProviderAvailability(): AIProviderAvailability {
  return {
    claude: true, // BidSphere backend proxy /api/ai/claude is available server-side
    openai: !!readOpenAIKeyOptional(),
    local: true,
  };
}

function readOpenAIKeyOptional(): string {
  return (import.meta.env.VITE_OPENAI_API_KEY as string | undefined)?.trim() ?? "";
}



function readOpenAIKey(): string {
  const key = readOpenAIKeyOptional();
  if (!key) {
    throw new AIRecommendationError("OpenAI API key not configured", {
      retryable: false,
    });
  }
  return key;
}

async function generateWithRetry(
  label: string,
  fn: (prompt: string) => Promise<{ text: string; tokensUsed: number }>,
  prompt: string
): Promise<{ text: string; tokensUsed: number }> {
  const maxAttempts = RETRY_BACKOFF_MS.length + 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_BACKOFF_MS[attempt - 1];
      // eslint-disable-next-line no-console
      console.warn(
        `[AI] ${label} overloaded — retry ${attempt}/${RETRY_BACKOFF_MS.length} in ${delay}ms`
      );
      await sleep(delay);
    }

    try {
      return await fn(prompt);
    } catch (err) {
      lastError = err;
      const retryable =
        err instanceof AIRecommendationError ? err.retryable : true;
      // eslint-disable-next-line no-console
      console.error(`[AI] ${label} attempt ${attempt + 1}/${maxAttempts} failed:`, err);
      if (!retryable || attempt === maxAttempts - 1) break;
    }
  }

  throw lastError;
}

function isolateJson(raw: string): string {
  let text = raw.trim();
  // Strip markdown code fences anywhere in the response.
  text = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "");
  text = text.trim();
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new AIRecommendationError("No JSON object found in AI response.");
  }
  return text.slice(firstBrace, lastBrace + 1);
}

function parseAiJson(rawText: string): unknown {
  // eslint-disable-next-line no-console
  if (import.meta.env.DEV) console.log("[AI RAW RESPONSE]", rawText);
  let cleaned = "";
  try {
    // Strip markdown fences and extract the first { … last } JSON object.
    cleaned = isolateJson(rawText);
    // eslint-disable-next-line no-console
    if (import.meta.env.DEV) console.log("[AI CLEANED RESPONSE]", cleaned);
    const parsed = JSON.parse(cleaned);
    // eslint-disable-next-line no-console
    if (import.meta.env.DEV) console.log("[AI JSON PARSE SUCCESS]");
    return parsed;
  } catch (err) {
    // eslint-disable-next-line no-console
    if (import.meta.env.DEV) console.error("[AI JSON PARSE FAILED]", {
      error: err,
      cleaned,
      raw: rawText,
    });
    throw new AIRecommendationError("AI response JSON parse failed", {
      cause: err,
      retryable: false,
    });
  }
}

function mapRiskToSeverity(
  risk: string
): "high" | "medium" | "low" {
  const r = risk.toLowerCase();
  if (r === "high") return "high";
  if (r === "low") return "low";
  return "medium";
}

function verdictFromRank(
  rank: number,
  total: number,
  hasValidPrice: boolean = true,
  score?: number,
  risk?: string
): SupplierVerdict {
  if (!hasValidPrice) return "QUOTE INCOMPLETE";
  if (risk === "High" || risk === "HIGH RISK") return "HIGH RISK / REVIEW";
  if (rank === 1) return "BEST VALUE";
  if (rank === 2) return "GOOD OPTION";
  if (score !== undefined && score >= 70) {
    return "GOOD OPTION";
  }
  if (score !== undefined && score >= 50) {
    return rank >= total ? "GOOD OPTION" : "EXPENSIVE";
  }
  if (rank >= total) return "AVOID";
  return "EXPENSIVE";
}

/** Read a supplier name from any of the key variants a model may emit. */
function rowSupplierName(row: Record<string, unknown>): string {
  return String(
    row.supplier ??
      row.supplier_name ??
      row.supplierName ??
      row.name ??
      row.vendor ??
      ""
  ).trim();
}

/** Read a 0–100 score from any of the common key variants. */
function rowScore(row: Record<string, unknown>): number {
  const raw =
    row.score ??
    row.confidence ??
    row.confidenceScore ??
    row.confidence_score ??
    row.overall ??
    row.rating;
  const n = typeof raw === "number" ? raw : Number(raw);
  return raw !== null && raw !== undefined && raw !== "" && Number.isFinite(n) ? n : -1;
}

/** Read a rank from a number or a numeric string. */
function rowRank(row: Record<string, unknown>): number {
  const raw = row.rank ?? row.position;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : 99;
}

function normalizeSupplierNameKey(str: string): string {
  return str
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .replace(/[.,]+$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** Tolerant match of an AI supplier name to a real quotation. */
function findQuote(name: string, quotations: AIQuotation[]): AIQuotation | undefined {
  const rawKey = name.trim().toLowerCase();
  const normKey = normalizeSupplierNameKey(name);
  if (!rawKey && !normKey) return undefined;

  const exact = quotations.find(
    (q) =>
      q.supplier_name.trim().toLowerCase() === rawKey ||
      normalizeSupplierNameKey(q.supplier_name) === normKey
  );
  if (exact) return exact;

  return quotations.find((q) => {
    const s = q.supplier_name.trim().toLowerCase();
    const ns = normalizeSupplierNameKey(q.supplier_name);
    return (
      s.includes(rawKey) ||
      rawKey.includes(s) ||
      ns.includes(normKey) ||
      normKey.includes(ns)
    );
  });
}

function quotePriceStatus(quote: AIQuotation | undefined): QuotePriceStatus {
  if (!quote) return "not_submitted";
  if (quote.price_status) return quote.price_status;
  const total = findQuoteTotal(quote.supplier_name, [quote]);
  return isSubmittedQuoteAmount(total)
    ? "submitted"
    : "price_not_provided";
}

/** Tolerant match of an AI supplier name to a real quotation total. */
function findQuoteTotal(name: string, quotations: AIQuotation[]): number | null {
  const quote = findQuote(name, quotations);
  if (!quote) return null;
  if (isSubmittedQuoteAmount(quote.total_value)) return quote.total_value;
  if (Array.isArray(quote.items) && quote.items.length > 0) {
    const lineTotal = priceFromLines(quote.items);
    if (isSubmittedQuoteAmount(lineTotal)) return lineTotal;
  }
  return null;
}

/** Map the simplified ranking schema to the full UI model (tolerant). */
function coerceFromRankingFormat(
  v: Record<string, unknown>,
  quotations: AIQuotation[]
): AIRecommendation {
  // Accept `ranking` or `rankings`.
  const rankingRaw = (v.ranking ?? v.rankings) as unknown;
  if (!Array.isArray(rankingRaw) || rankingRaw.length === 0) {
    throw new AIRecommendationError(
      "AI response is missing a non-empty `ranking` array."
    );
  }

  const rawRanking = (
    rankingRaw.filter(
      (row) => row && typeof row === "object"
    ) as Record<string, unknown>[]
  ).map((row) => ({
    row,
    name: rowSupplierName(row),
    rank: rowRank(row),
    score: rowScore(row),
  }));

  // Stable deduplication by supplier/quotation identifier
  const seenSuppliers = new Map<string, typeof rawRanking[0]>();
  for (const item of rawRanking) {
    // Stable IDs are opaque and case-sensitive. Only historical name-only
    // responses use tolerant name normalization.
    const key = typeof item.row.quotation_id === "string" && item.row.quotation_id
      ? `quotation:${item.row.quotation_id}`
      : typeof item.row.supplier_id === "string" && item.row.supplier_id
        ? `supplier:${item.row.supplier_id}`
        : normalizeSupplierNameKey(item.name);
    if (!key) continue;
    if (!seenSuppliers.has(key)) {
      seenSuppliers.set(key, item);
    } else {
      const existing = seenSuppliers.get(key)!;
      if (item.score > existing.score) {
        seenSuppliers.set(key, item);
      }
    }
  }
  const ranking = Array.from(seenSuppliers.values());
  ranking.sort((a, b) => a.rank - b.rank);
  ranking.forEach((r, idx) => { r.rank = idx + 1; });

  const rankOne = ranking.find((r) => r.rank === 1) ?? ranking[0];
  const explicit = String(
    v.recommendedSupplier ??
      v.recommended_supplier ??
      v.recommended ??
      v.winner ??
      ""
  ).trim();
  const recommendedSupplier = explicit || rankOne?.name || "";

  if (!recommendedSupplier) {
    throw new AIRecommendationError(
      "AI response is missing `recommendedSupplier`."
    );
  }

  const summary = appendPricingAvailability(
    String(
      v.summary ?? v.recommendation_summary ?? v.final_verdict ?? v.reason ?? ""
    ),
    quotations,
  );

  const supplier_analysis: SupplierAnalysisRow[] = ranking
    .map(({ row, name, rank, score }): SupplierAnalysisRow | null => {
      if (!name) return null;
      const reason = String(row.reason ?? row.why_best_or_worst ?? "");
      const quote = row.quotation_id
        ? quotations.find((quotation) => quotation.quotation_id === row.quotation_id)
        : findQuote(name, quotations);
      const grandTotal = quote ? findQuoteTotal(quote.supplier_name, [quote]) : null;
      const hasValidPrice = isSubmittedQuoteAmount(grandTotal);
      // Extract per-dimension scores from AI response when available;
      // never copy a single overall score to all dimensions.
      const priceScore = typeof row.price_score === "number" && row.price_score >= 0 && hasValidPrice
        ? row.price_score
        : -1;
      const deliveryScoreVal = typeof row.delivery_score === "number" ? row.delivery_score : -1;
      const reliabilityScoreVal = typeof row.reliability_score === "number" ? row.reliability_score : -1;

      const validVerdicts: SupplierVerdict[] = [
        "BEST VALUE",
        "GOOD OPTION",
        "EXPENSIVE",
        "AVOID",
        "QUOTE INCOMPLETE",
        "HIGH RISK / REVIEW",
        "NOT EVALUATED",
      ];
      const rawRisk = typeof row.risk === "string" ? row.risk.trim() : "";
      const risk: SupplierAnalysisRow["risk"] =
        rawRisk === "Low" || rawRisk === "Medium" || rawRisk === "High"
          ? rawRisk : undefined;

      const quotationId = String(row.quotation_id ?? quote?.quotation_id ?? "");
      const supplierId = String(row.supplier_id ?? quote?.supplier_id ?? "");

      const completeness = evaluateQuotationCompleteness(quote || {
        supplier: name,
        supplier_id: supplierId,
        supplier_name: name,
        grand_total: grandTotal,
        quotation_id: quotationId,
      });

      const rawVerdict = typeof row.verdict === "string" ? row.verdict.toUpperCase().trim() : "";
      let verdict: SupplierVerdict = validVerdicts.includes(rawVerdict as SupplierVerdict)
        ? (rawVerdict as SupplierVerdict)
        : verdictFromRank(rank, ranking.length, hasValidPrice, score, risk);

      if (completeness.is_complete && verdict === "QUOTE INCOMPLETE") {
        verdict = (risk === "High" || risk === "HIGH RISK") ? "HIGH RISK / REVIEW" : (rank === 1 ? "BEST VALUE" : "GOOD OPTION");
      } else if (!completeness.is_complete && verdict !== "AVOID") {
        verdict = "QUOTE INCOMPLETE";
      }

      return {
        name,
        rank,
        verdict,
        risk,
        grand_total: grandTotal,
        quote_price_status: quotePriceStatus(quote),
        quotation_status: completeness.quotation_status,
        is_complete: completeness.is_complete,
        missing_fields: completeness.missing_fields,
        // General reasoning can describe a serious concern. Do not relabel it
        // as a positive strength; preserve explicit evidence lists separately.
        strengths: asStringArray(row.strengths),
        weaknesses: !hasValidPrice
          ? [...asStringArray(row.weaknesses), "Quotation pricing was not provided"]
          : asStringArray(row.weaknesses),
        score: {
          cost: priceScore,
          delivery: deliveryScoreVal >= 0 ? deliveryScoreVal : -1,
          quality: typeof row.quality_score === "number" ? row.quality_score : -1,
          reliability: reliabilityScoreVal >= 0 ? reliabilityScoreVal : -1,
          overall: score,
        },
        why_best_or_worst: reason,
        quotation_id: quotationId || undefined,
        supplier_quotation_id: quotationId || undefined,
        supplier_id: supplierId || undefined,
        evaluation_run_id: typeof row.evaluation_run_id === "string" ? row.evaluation_run_id : undefined,
        evaluation_status: row.evaluation_status === "incomplete" ? "incomplete" : "complete",
        raw_ai_score: typeof row.raw_ai_score === "number" ? row.raw_ai_score : undefined,
      };
    })
    .filter((r): r is SupplierAnalysisRow => r !== null);

  const recommendedRow =
    ranking.find((r) => r.name === recommendedSupplier) ?? rankOne;
  const confidence_score = recommendedRow?.score ?? 0;

  const risk_flags: AIRiskFlag[] = ranking
    .map(({ row, name }): AIRiskFlag | null => {
      if (!name) return null;
      const reason = String(row.reason ?? "");
      const risk = String(row.risk ?? "Medium");
      return {
        type: "cost",
        severity: mapRiskToSeverity(risk),
        message: reason
          ? `${name} (${risk} risk): ${reason}`
          : `${name}: ${risk} risk`,
      };
    })
    .filter((f): f is AIRiskFlag => f !== null);

  const totals = quotations
    .map((q) => q.total_value)
    .filter(isSubmittedQuoteAmount);
  const lowest = totals.length ? Math.min(...totals) : 0;
  const highest = totals.length ? Math.max(...totals) : 0;

  return {
    rfq_id: typeof v.rfq_id === "string" ? v.rfq_id : undefined,
    evaluation_run_id: typeof v.evaluation_run_id === "string" ? v.evaluation_run_id : undefined,
    evaluation_weights: v.evaluation_weights as AIRecommendation["evaluation_weights"],
    recommended_quotation_id: typeof v.recommended_quotation_id === "string" ? v.recommended_quotation_id : undefined,
    recommended_supplier_id: typeof v.recommended_supplier_id === "string" ? v.recommended_supplier_id : undefined,
    recommended_supplier: recommendedSupplier,
    confidence_score,
    recommendation_summary: summary,
    provider_summary: typeof v.provider_summary === "string" ? v.provider_summary : undefined,
    preserved_evaluation_summary: typeof v.preserved_evaluation_summary === "string" ? v.preserved_evaluation_summary : undefined,
    supplier_analysis,
    cost_analysis: {
      savings_vs_expensive:
        highest > lowest
          ? `${formatCurrency(highest - lowest)} saved vs most expensive`
          : "",
      savings_percentage:
        highest > 0 ? Math.round(((highest - lowest) / highest) * 100) : 0,
      price_range:
        totals.length > 0
          ? `${formatCurrency(lowest)} to ${formatCurrency(highest)}`
          : "",
    },
    per_item_analysis: [],
    risk_flags,
    negotiation_tips: [],
    split_order_option: {
      recommended: false,
      reason: "",
      suggestion: "",
    },
    final_verdict: summary,
    reason: summary,
    cost_savings:
      highest > lowest
        ? `${formatCurrency(highest - lowest)} saved vs most expensive`
        : "",
    risk_factors: risk_flags.map((r) => r.message),
    per_item_recommendation: [],
  };
}

function asStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.filter((x): x is string => typeof x === "string");
}

function coerceSupplierAnalysis(
  val: unknown,
  quotations: AIQuotation[],
): SupplierAnalysisRow[] {
  if (!Array.isArray(val)) return [];
  const verdicts: SupplierVerdict[] = [
    "BEST VALUE",
    "GOOD OPTION",
    "EXPENSIVE",
    "AVOID",
    "QUOTE INCOMPLETE",
    "HIGH RISK / REVIEW",
    "NOT EVALUATED",
  ];
  return val
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const r = row as Record<string, unknown>;
      const score = (r.score as Record<string, unknown>) ?? {};
      const verdict = String(r.verdict ?? "GOOD OPTION");
      const name = String(r.name ?? "");
      const quote = findQuote(name, quotations);
      const grandTotal = findQuoteTotal(name, quotations);
      const rowRisk = String(r.risk ?? "");
      const completeness = evaluateQuotationCompleteness(quote || {
        supplier: name,
        supplier_name: name,
        grand_total: grandTotal,
      });
      let rowVerdict: SupplierVerdict = verdicts.includes(verdict as SupplierVerdict)
        ? (verdict as SupplierVerdict)
        : "GOOD OPTION";
      if (completeness.is_complete && rowVerdict === "QUOTE INCOMPLETE") {
        rowVerdict = (rowRisk === "High" || rowRisk === "HIGH RISK") ? "HIGH RISK / REVIEW" : "GOOD OPTION";
      } else if (!completeness.is_complete && rowVerdict !== "AVOID") {
        rowVerdict = "QUOTE INCOMPLETE";
      }
      return {
        name,
        rank: typeof r.rank === "number" ? r.rank : 99,
        verdict: rowVerdict,
        // The real quotation is authoritative; never accept an AI-invented
        // zero for a supplier whose price is absent.
        grand_total: grandTotal,
        quote_price_status: quotePriceStatus(quote),
        quotation_status: completeness.quotation_status,
        is_complete: completeness.is_complete,
        missing_fields: completeness.missing_fields,
        strengths: asStringArray(r.strengths),
        weaknesses: !hasValidPrice
          ? [...asStringArray(r.weaknesses), "Quotation pricing was not provided"]
          : asStringArray(r.weaknesses),
        score: {
          cost: hasValidPrice && typeof score.cost === "number" && score.cost >= 0 ? score.cost : -1,
          delivery: typeof score.delivery === "number" ? score.delivery : -1,
          reliability:
            typeof score.reliability === "number" ? score.reliability : -1,
          overall: typeof score.overall === "number" ? score.overall : -1,
        },
        why_best_or_worst: String(r.why_best_or_worst ?? ""),
      };
    })
    .filter((r) => r.name);
}

function coercePerItemAnalysis(val: unknown): AIPerItemAnalysis[] {
  if (!Array.isArray(val)) return [];
  return val
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const r = row as Record<string, unknown>;
      return {
        item: String(r.item ?? ""),
        best_supplier: String(r.best_supplier ?? ""),
        best_price: typeof r.best_price === "number" ? r.best_price : 0,
        worst_supplier: String(r.worst_supplier ?? ""),
        worst_price: typeof r.worst_price === "number" ? r.worst_price : 0,
        price_spread: String(r.price_spread ?? ""),
        recommendation: String(r.recommendation ?? ""),
      };
    })
    .filter((r) => r.item);
}

function coerceRiskFlags(val: unknown): AIRiskFlag[] {
  if (!Array.isArray(val)) return [];
  const types = ["cost", "delivery", "quality", "terms"] as const;
  const severities = ["high", "medium", "low"] as const;
  return val
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const r = row as Record<string, unknown>;
      const type = String(r.type ?? "cost");
      const severity = String(r.severity ?? "medium");
      return {
        type: types.includes(type as (typeof types)[number])
          ? (type as (typeof types)[number])
          : "cost",
        severity: severities.includes(severity as (typeof severities)[number])
          ? (severity as (typeof severities)[number])
          : "medium",
        message: String(r.message ?? ""),
      };
    })
    .filter((r) => r.message);
}

function coerceRecommendation(
  value: unknown,
  quotations: AIQuotation[]
): AIRecommendation {
  if (!value || typeof value !== "object") {
    throw new AIRecommendationError("AI response is not an object.");
  }

  const v = value as Record<string, unknown>;

  // Preferred simplified schema from procurement copilot prompt.
  if (Array.isArray(v.ranking) || Array.isArray(v.rankings)) {
    return coerceFromRankingFormat(v, quotations);
  }

  if (typeof v.recommended_supplier !== "string") {
    throw new AIRecommendationError(
      "AI response is missing `recommended_supplier` or `recommendedSupplier`."
    );
  }

  const costRaw = (v.cost_analysis as Record<string, unknown>) ?? {};
  const splitRaw = (v.split_order_option as Record<string, unknown>) ?? {};

  const recommendation_summary = appendPricingAvailability(
    String(v.recommendation_summary ?? v.reason ?? ""),
    quotations,
  );
  const supplier_analysis = coerceSupplierAnalysis(
    v.supplier_analysis,
    quotations,
  );
  const per_item_analysis = coercePerItemAnalysis(
    v.per_item_analysis ?? v.per_item_recommendation
  );
  const risk_flags = coerceRiskFlags(v.risk_flags);
  const legacyRiskFactors = asStringArray(v.risk_factors);

  const cost_analysis = {
    savings_vs_expensive: String(
      costRaw.savings_vs_expensive ?? v.cost_savings ?? ""
    ),
    savings_percentage:
      typeof costRaw.savings_percentage === "number"
        ? costRaw.savings_percentage
        : 0,
    price_range: String(costRaw.price_range ?? ""),
  };

  return {
    recommended_supplier: v.recommended_supplier,
    confidence_score:
      typeof v.confidence_score === "number" ? v.confidence_score : 0,
    recommendation_summary,
    supplier_analysis,
    cost_analysis,
    per_item_analysis,
    risk_flags:
      risk_flags.length > 0
        ? risk_flags
        : legacyRiskFactors.map((msg) => ({
            type: "cost" as const,
            severity: "medium" as const,
            message: msg,
          })),
    negotiation_tips: asStringArray(v.negotiation_tips),
    split_order_option: {
      recommended: Boolean(splitRaw.recommended),
      reason: String(splitRaw.reason ?? ""),
      suggestion: String(splitRaw.suggestion ?? ""),
    },
    final_verdict: appendPricingAvailability(
      String(v.final_verdict ?? recommendation_summary),
      quotations,
    ),
    reason: recommendation_summary,
    cost_savings: cost_analysis.savings_vs_expensive,
    risk_factors: legacyRiskFactors.length
      ? legacyRiskFactors
      : risk_flags.map((r) => r.message),
    per_item_recommendation: per_item_analysis.map((p) => ({
      item: p.item,
      best_supplier: p.best_supplier,
      reason: p.recommendation,
    })),
  };
}

export interface AnalysisWeights {
  price: number;
  delivery: number;
  quality: number;
  reliability: number;
}

/**
 * Fixed weighting for the "AI Procurement Copilot" Confidence Score — this is
 * intentionally independent of the admin-configurable ranking weights
 * (`Supplier Scoring Config`) so the headline confidence figure always means
 * the same thing regardless of how ranking is tuned.
 */
export const CONFIDENCE_SCORE_WEIGHTS = {
  price: 35,
  delivery: 25,
  reliability: 30,
  completeness: 10,
} as const;

export interface ConfidenceScoreInputs {
  /** Price competitiveness, 0-100 (lower total = higher score). */
  price_score: number;
  /** Delivery time score, 0-100 (faster = higher score). */
  delivery_score: number;
  /** Supplier reliability / historical performance, 0-100. */
  reliability_score: number;
  /** Quotation completeness (item coverage, terms, delivery data), 0-100. */
  completeness_score: number;
}

/** Insufficient-data sentinel (-1) is treated as neutral, never as zero. */
function neutralIfMissing(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 50;
  return Math.max(0, Math.min(100, value));
}

/**
 * Confidence Score = weighted average of price competitiveness (35%),
 * delivery time (25%), supplier reliability/performance (30%), and
 * quotation completeness (10%). Always returns an integer 0-100.
 */
export function computeConfidenceScore(inputs: ConfidenceScoreInputs): number {
  const w = CONFIDENCE_SCORE_WEIGHTS;
  const weighted =
    neutralIfMissing(inputs.price_score) * w.price +
    neutralIfMissing(inputs.delivery_score) * w.delivery +
    neutralIfMissing(inputs.reliability_score) * w.reliability +
    neutralIfMissing(inputs.completeness_score) * w.completeness;
  return Math.max(0, Math.min(100, Math.round(weighted / 100)));
}

export function buildAnalysisPrompt(
  payload: AIRequest,
  weights?: AnalysisWeights
): string {
  const w = weights ?? { price: 40, delivery: 25, quality: 20, reliability: 15 };
  const totals = payload.quotations
    .map((q) => q.total_value)
    .filter(isSubmittedQuoteAmount);
  const lowestTotal = totals.length ? Math.min(...totals) : 0;
  const highestTotal = totals.length ? Math.max(...totals) : 0;

  const itemsBlock = payload.items_requested
    .map((i) => `- ${i.item}: ${i.qty} ${i.uom ?? ""}`.trim())
    .join("\n");

  const quotesBlock = payload.quotations
    .map((q, idx) => {
      const flags =
        isSubmittedQuoteAmount(q.total_value) &&
        q.total_value === lowestTotal && totals.length > 1
          ? "⭐ LOWEST TOTAL"
          : isSubmittedQuoteAmount(q.total_value) &&
            q.total_value === highestTotal && totals.length > 1
          ? "⚠️ HIGHEST TOTAL"
          : "";
      const lines = q.items
        .map((i) => {
          const qty = i.requested_qty ?? 1;
          const note = i.notes ? ` | Note: ${i.notes}` : "";
          const unitPrice = isSubmittedQuoteAmount(i.unit_price)
            ? `${formatCurrency(i.unit_price)}/unit`
            : "Price Not Provided";
          const lineTotal = isSubmittedQuoteAmount(i.total)
            ? formatCurrency(i.total)
            : "Price Not Provided";
          const deliveryVal =
            i.delivery_days && i.delivery_days > 0
              ? `${i.delivery_days} days`
              : "Unavailable (supplier did not provide delivery days)";
          return `  - ${i.item}: ${unitPrice} × ${qty} = ${lineTotal} | Delivery: ${deliveryVal}${note}`;
        })
        .join("\n");

      const docList: string[] = [];
      if (q.documents?.warranty_certificate) docList.push("Warranty certificate attached; verification status unavailable");
      if (q.documents?.terms_conditions) docList.push("Terms and conditions attached; verification status unavailable");
      if (q.documents?.insurance_certificate) docList.push("Insurance certificate attached; verification status unavailable");
      const complianceText = docList.length > 0 ? docList.join(", ") : "No attachment evidence provided";

      return `
SUPPLIER ${idx + 1}: ${q.supplier_name}
Quotation ID (JSON string; preserve escaped characters): ${JSON.stringify(q.quotation_id ?? "")}
Supplier ID (JSON string; preserve escaped characters): ${JSON.stringify(q.supplier_id ?? "")}
Grand Total: ${isSubmittedQuoteAmount(q.total_value) ? formatCurrency(q.total_value) : "Price Not Provided"}
${flags}
Items:
${lines}
Payment Terms: ${q.payment_terms ?? "Not specified"}
Compliance & Certificates: ${complianceText}
Additional Notes: ${q.notes || "Unavailable"}
Historical performance: ${q.historical_data ? JSON.stringify(q.historical_data) : "Unavailable"}
Technical compliance: unavailable unless explicitly described in this quotation's item notes.`;
    })
    .join("\n---");

  const supplierNames = payload.quotations
    .map((q) => q.supplier_name)
    .join(", ");

  return `You are an expert procurement analyst for Netlink, a manufacturing company.
Analyze these ${payload.quotations.length} supplier quotations for RFQ: ${payload.rfq_name}
RFQ ID: ${JSON.stringify(payload.rfq_name)}
Evaluation run ID: ${JSON.stringify(payload.evaluation_run_id)}

ITEMS REQUESTED:
${itemsBlock}

SUPPLIER QUOTATIONS:
${quotesBlock}

ANALYSIS WEIGHTS (use these to compute the score for each supplier):
- Price/Cost: ${w.price}%
- Delivery speed: ${w.delivery}%
- Quality (item coverage, specs): ${w.quality}%
- Reliability (documentation, terms): ${w.reliability}%

Score formula: Final = (PriceScore×${w.price} + DeliveryScore×${w.delivery} + QualityScore×${w.quality} + ReliabilityScore×${w.reliability}) / 100

Rank every supplier: ${supplierNames}

CRITICAL OUTPUT RULES — YOU MUST FOLLOW EXACTLY:
1. Return ONLY valid JSON.
2. Do NOT use markdown.
3. Do NOT wrap the response in triple backticks.
4. Do NOT add any text, explanation, or commentary before or after the JSON.
5. The first character of your response must be { and the last must be }.

Return exactly this JSON structure (fill with real analysis data from the quotations above):
{
  "rfq_id": ${JSON.stringify(payload.rfq_name)},
  "evaluation_run_id": ${JSON.stringify(payload.evaluation_run_id)},
  "ranking": [
    {
      "evaluation_run_id": ${JSON.stringify(payload.evaluation_run_id)},
      "quotation_id": "exact quotation_id from quotation",
      "supplier_id": "exact supplier_id from quotation",
      "supplier": "exact supplier name from quotations",
      "rank": 1,
      "score": 85,
      "price_score": 92,
      "delivery_score": 78,
      "quality_score": 85,
      "reliability_score": 80,
      "risk": "Low",
      "verdict": "BEST VALUE",
      "reason": "Specific explanation referencing actual price difference, delivery days, item coverage, and terms"
    }
  ],
  "recommendedSupplier": "exact supplier name of rank 1 winner",
  "summary": "2-3 sentence executive summary referencing specific cost differences, delivery timelines, and completeness"
}

SCORING RULES — FOLLOW STRICTLY:
- Evaluate EACH supplier independently. Never copy the score, risk, verdict, or reasoning from another supplier.
- "score": overall weighted number 0-100 calculated using the formula above.
- "price_score": 0-100 based ONLY on the actual quoted grand total. Lowest price = highest score. If all suppliers quoted the exact same price, price_score must be equal for all.
- If a grand total is "Price Not Provided", set price_score to -1 (insufficient data). Never treat it as $0.00 or as the cheapest quote.
- Historical availability is dimension-specific: use a historical dimension only when its has_delivery_data, has_quality_data, or has_reliability_data flag is true and its corresponding score is a finite number from 0 to 100. The general has_sufficient_data flag alone does not establish that a particular metric is available. Never reinterpret or replace a supplied valid historical score.
- "delivery_score": first check has_delivery_data. If valid history and actual quoted delivery days both exist, preserve the existing blend: round(quotedDeliveryScore * 0.40 + historical_data.delivery_score * 0.60). The quotedDeliveryScore uses the existing inverse linear comparison of actual average quoted days: fastest=100, slowest=0, equal quoted days=100. Exclude unavailable quoted days from that comparison. If history is valid but quoted days are unavailable, use historical_data.delivery_score unchanged; missing quotation days must NOT erase available delivery history. If only quoted days exist, use quotedDeliveryScore. Only when BOTH quoted days and valid delivery history are unavailable, retain the existing neutral scoring rule (70-75), explicitly identify that assumption in the reason, and use the same neutral value for equivalent missing-data situations. Never invent a quoted delivery timeline.
- "quality_score": use the existing quoted-item coverage score (direct linear comparison of item coverage across quotations; equal coverage=100). If has_quality_data is true and historical_data.quality_score is valid, preserve the existing blend: round(coverageScore * 0.30 + historical_data.quality_score * 0.70). Otherwise use coverageScore and explicitly say historical quality is unavailable. Item coverage is a proxy, not an inspection result or technical-compliance verification.
- "reliability_score": if has_reliability_data is true and historical_data.reliability_score is valid, use that supplied historical score unchanged. Only when reliability history is unavailable, apply the existing quotation-completeness assessment using payment terms, notes, delivery information, and attached warranty/insurance/terms evidence. Attachment presence does not verify its contents.
- "risk": exactly "Low", "Medium", or "High", assessed from the supplier-specific evidence. A high numerical score does not mean Low risk. Explain the actual reason for risk in this same supplier's "reason"; do not invent compliance failures or evidence.
- "verdict": exactly one of "BEST VALUE", "GOOD OPTION", "EXPENSIVE", "AVOID", "HIGH RISK / REVIEW", "QUOTE INCOMPLETE".
- Complete quotations MUST NOT be marked "QUOTE INCOMPLETE". Only use "QUOTE INCOMPLETE" if mandatory quotation fields or quotation submission are missing. If a quotation is complete but carries high risk, assign "HIGH RISK / REVIEW" or "GOOD OPTION".
- A supplier must NEVER be labeled "AVOID" simply for being lowest-ranked. Only assign "AVOID" if there is severe risk, non-compliance, missing quote, or unacceptable terms.
- An AVOID verdict makes the supplier ineligible for supplier selection, reverse bidding and purchase order creation under the application's award policy. Preserve its numerical score and rank; explain the restriction in its reason and the summary. Do not invent an authorized risk-override workflow or describe AVOID as eligible for award.
- Equal scores are valid when the supplier-specific scoring criteria genuinely match. Never force differences. Compare actual delivery, quality, warranty evidence, documentation, payment terms and history independently; do not invent missing data.
- "reason": MUST reference specific data points (e.g. price difference, actual historical on-time/late deliveries, quoted delivery days, attachment presence, payment terms), and distinguish available history from missing quotation fields.
- The summary MUST distinguish suppliers with submitted pricing from suppliers with missing pricing. Never describe missing pricing as "$0.00 pricing".
- "ranking": include ONLY the ${payload.quotations.length} suppliers listed above, sorted by the configured weighted score (rank 1 = highest score, not an award approval).
- Do NOT invent, add, or reference any supplier not in the SUPPLIER QUOTATIONS section.
- "recommendedSupplier": must match the rank 1 supplier name exactly. This legacy field means the weighted-score leader only; it is not an endorsement of supplier suitability or an award decision. If the leader has High risk or AVOID, preserve those values and explicitly explain in the summary that review is required despite the high score. Never describe that supplier as an unqualified procurement recommendation. No alternative supplier may be silently promoted to score rank 1 because of risk.
- Return exactly one result per quotation_id. Preserve its exact supplier_id and the current evaluation_run_id. IDs above are JSON strings: literal quotation marks inside an ID must be escaped, never removed.
- Include all four dimension scores and their weighted overall score for EVERY quotation. The server validates identities and computes the final weighted arithmetic.
- Use supplier names, quotation_id, and supplier_id EXACTLY as shown in SUPPLIER QUOTATIONS.`;
}

/** Generate raw model text from Claude via the BidSphere server (single attempt — use generateWithRetry). */
async function generateWithClaudeOnce(
  prompt: string,
  context: EvaluationContext,
): Promise<{ text: string; tokensUsed: number }> {
  const startTime = Date.now();
  // Safe diagnostic logging — never logs keys, secrets, or quote contents.
  // eslint-disable-next-line no-console
  if (import.meta.env.DEV) console.log("[AI] Requesting Claude recommendation via BidSphere backend:", {
    model: ANTHROPIC_MODEL,
    rfq_id: context.rfq_id,
  });

  let response: Response;
  try {
    response = await fetch("/api/ai/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        max_tokens: 2048,
        rfq_id: context.rfq_id,
        evaluation_context: context,
        ...(import.meta.env.DEV ? { evaluation_debug: { enabled: true, evaluation_run_id: context.evaluation_run_id } } : {}),
        request_type: "recommendation",
      }),
    });
  } catch (err) {
    throw new AIRecommendationError("Claude backend network error", {
      cause: err,
      retryable: true,
    });
  }

  const latency = Date.now() - startTime;
  let body: { success?: boolean; text?: string; tokensUsed?: number; message?: string; evaluation_debug?: unknown };
  try {
    body = (await response.json()) as typeof body;
  } catch (err) {
    throw new AIRecommendationError("Claude non-JSON response from backend", {
      cause: err,
      retryable: false,
      statusCode: response.status,
    });
  }

  if (!response.ok || !body.success || !body.text) {
    const status = response.status;
    const apiMessage = body.message || response.statusText || "Claude error";
    // eslint-disable-next-line no-console
    console.error("[AI API] Claude backend error:", {
      status,
      model: ANTHROPIC_MODEL,
      rfq_id: context.rfq_id,
      latency_ms: latency,
      error: apiMessage,
    });

    throw new AIRecommendationError(`Claude HTTP ${status}: ${apiMessage}`, {
      retryable: isRetryableHttpStatus(status),
      statusCode: status,
    });
  }

  // eslint-disable-next-line no-console
  if (import.meta.env.DEV) console.log("[AI] Claude response received successfully:", {
    model: ANTHROPIC_MODEL,
    rfq_id: context.rfq_id,
    tokens_used: body.tokensUsed ?? 0,
    latency_ms: latency,
  });

  if (import.meta.env.DEV && body.evaluation_debug) {
    console.log("[AI EVALUATION DEBUG] Claude gateway", body.evaluation_debug);
  }

  return { text: body.text, tokensUsed: body.tokensUsed ?? 0 };
}

interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { total_tokens?: number };
  error?: { message?: string };
}

/** Generate raw model text from OpenAI (single attempt — use generateWithRetry). */
async function generateWithOpenAIOnce(
  prompt: string
): Promise<{ text: string; tokensUsed: number }> {
  const apiKey = readOpenAIKey();

  // eslint-disable-next-line no-console
  if (import.meta.env.DEV) console.log("[AI] OpenAI endpoint:", OPENAI_ENDPOINT, "model:", OPENAI_MODEL);

  let response: Response;
  try {
    response = await fetch(OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        max_tokens: 1024,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (err) {
    throw new AIRecommendationError("OpenAI network error", {
      cause: err,
      retryable: true,
    });
  }

  let body: OpenAIChatResponse;
  try {
    body = (await response.json()) as OpenAIChatResponse;
  } catch (err) {
    throw new AIRecommendationError("OpenAI non-JSON response", {
      cause: err,
      retryable: false,
      statusCode: response.status,
    });
  }

  if (!response.ok) {
    const status = response.status;
    const apiMessage = body.error?.message ?? response.statusText;
    // eslint-disable-next-line no-console
    console.error("[AI API] OpenAI error:", { status, message: apiMessage, body });

    throw new AIRecommendationError(`OpenAI HTTP ${status}: ${apiMessage}`, {
      retryable: isRetryableHttpStatus(status),
      statusCode: status,
    });
  }

  const text = body.choices?.[0]?.message?.content;
  if (!text) {
    throw new AIRecommendationError("OpenAI returned no text content", {
      retryable: false,
    });
  }

  return { text, tokensUsed: body.usage?.total_tokens ?? 0 };
}

function verdictFromEngineRank(
  rank: number,
  total: number,
  hasValidPrice: boolean = true,
  risk?: string
): SupplierVerdict {
  if (!hasValidPrice) return "QUOTE INCOMPLETE";
  if (risk === "High" || risk === "HIGH RISK") return "HIGH RISK / REVIEW";
  if (rank === 1) return "BEST VALUE";
  if (rank === 2) return "GOOD OPTION";
  if (rank >= total) return "AVOID";
  return "EXPENSIVE";
}

function buildPerItemAnalysis(payload: AIRequest): AIPerItemAnalysis[] {
  const itemNames = payload.items_requested.map((i) => i.item);
  return itemNames.map((itemName) => {
    const prices = payload.quotations
      .map((q) => {
        const line = q.items.find((i) => i.item === itemName);
        return line && isSubmittedQuoteAmount(line.unit_price)
          ? { supplier: q.supplier_name, price: line.unit_price }
          : null;
      })
      .filter((p): p is { supplier: string; price: number } => p !== null);

    if (prices.length === 0) {
      return {
        item: itemName,
        best_supplier: "—",
        best_price: 0,
        worst_supplier: "—",
        worst_price: 0,
        price_spread: "No quotes",
        recommendation: "Awaiting supplier pricing for this item.",
      };
    }

    const sorted = [...prices].sort((a, b) => a.price - b.price);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    const spread =
      best.price === worst.price
        ? "No spread"
        : formatCurrency(worst.price - best.price);

    return {
      item: itemName,
      best_supplier: best.supplier,
      best_price: best.price,
      worst_supplier: worst.supplier,
      worst_price: worst.price,
      price_spread: spread,
      recommendation: `Award ${itemName} to ${best.supplier} at ${formatCurrency(best.price)}.`,
    };
  });
}

export function buildPricingAvailabilitySummary(
  quotations: Array<Pick<AIQuotation, "total_value">>,
): string {
  const submitted = quotations.filter((q) =>
    isSubmittedQuoteAmount(q.total_value),
  );
  const missing = quotations.length - submitted.length;
  if (missing === 0) return "";

  const supplierWord = (count: number) =>
    count === 1 ? "supplier" : "suppliers";
  if (submitted.length === 0) {
    return "Quotation pricing was not provided by the suppliers, so a valid price comparison cannot be completed.";
  }
  return `${submitted.length} ${supplierWord(submitted.length)} submitted valid pricing. ${missing} ${supplierWord(missing)} did not provide a valid quotation amount.`;
}

function appendPricingAvailability(
  summary: string,
  quotations: AIQuotation[],
): string {
  const availability = buildPricingAvailabilitySummary(quotations);
  if (!availability) return summary;

  // When any supplier is missing pricing, remove ambiguous model-generated
  // zero-price sentences and replace them with deterministic availability.
  const sanitized = summary
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !/\$0(?:\.00)?/i.test(sentence))
    .join(" ")
    .trim();
  const genuineZeroCount = quotations.filter((q) => q.total_value === 0).length;
  const zeroSummary = genuineZeroCount > 0
    ? ` ${genuineZeroCount} supplier${genuineZeroCount === 1 ? "" : "s"} submitted a genuine zero-value quote.`
    : "";
  const availabilitySummary = `${availability}${zeroSummary}`;
  if (sanitized.toLowerCase().includes(availabilitySummary.toLowerCase())) {
    return sanitized.trim();
  }
  return `${sanitized} ${availabilitySummary}`.trim();
}

/**
 * Deterministic procurement recommendation when the Anthropic API is
 * unavailable. Uses quotation comparison + weighted scoring engine output.
 */
export function buildLocalProcurementRecommendation(
  payload: AIRequest,
  engineResult: ScoringEngineResult
): AIRecommendation {
  const totals = payload.quotations
    .map((q) => findQuoteTotal(q.supplier_name, payload.quotations))
    .filter(isSubmittedQuoteAmount);
  const lowest = totals.length ? Math.min(...totals) : 0;
  const highest = totals.length ? Math.max(...totals) : 0;
  const winner = engineResult.suppliers[0];

  const supplier_analysis: SupplierAnalysisRow[] = engineResult.suppliers.map(
    (s) => {
      const quote = findQuote(s.supplier_name, payload.quotations);
      const grandTotal = findQuoteTotal(s.supplier_name, payload.quotations);
      const hasValidPrice = isSubmittedQuoteAmount(grandTotal);
      const completeness = evaluateQuotationCompleteness(quote || {
        supplier: s.supplier_name,
        supplier_id: s.supplier_id,
        supplier_name: s.supplier_name,
        grand_total: grandTotal,
        quotation_id: s.quotation_id ?? quote?.quotation_id,
      });
      let verdict = verdictFromEngineRank(s.ranking, engineResult.suppliers.length, hasValidPrice, s.risk_level);
      if (completeness.is_complete && verdict === "QUOTE INCOMPLETE") {
        verdict = (s.risk_level === "High" || s.risk_level === "HIGH RISK") ? "HIGH RISK / REVIEW" : (s.ranking === 1 ? "BEST VALUE" : "GOOD OPTION");
      }
      const strengths: string[] = [];
      const weaknesses: string[] = [];
      if (!hasValidPrice || s.dimensions.price_score < 0) weaknesses.push("quotation pricing not provided");
      else if (s.dimensions.price_score >= 80) strengths.push("competitive pricing");
      else if (s.dimensions.price_score < 40) weaknesses.push("higher cost");
      if (s.dimensions.delivery_score >= 80) strengths.push("fast delivery");
      else if (s.dimensions.delivery_score < 40) weaknesses.push("slow delivery");

      return {
        quotation_id: s.quotation_id ?? quote?.quotation_id,
        supplier_quotation_id: s.quotation_id ?? quote?.quotation_id,
        supplier_id: s.supplier_id ?? quote?.supplier_id,
        evaluation_run_id: s.evaluation_run_id ?? payload.evaluation_run_id,
        name: s.supplier_name,
        rank: s.ranking,
        verdict,
        grand_total: grandTotal,
        quote_price_status: quotePriceStatus(quote),
        quotation_status: completeness.quotation_status,
        is_complete: completeness.is_complete,
        missing_fields: completeness.missing_fields,
        risk: s.risk_level === "Low" || s.risk_level === "Medium" || s.risk_level === "High" ? s.risk_level : undefined,
        strengths,
        weaknesses,
        score: {
          cost: hasValidPrice ? s.dimensions.price_score : -1,
          delivery: s.dimensions.delivery_score,
          quality: s.dimensions.quality_score,
          reliability: s.dimensions.reliability_score,
          overall: s.final_score,
        },
        why_best_or_worst: s.recommendation_reason,
      };
    }
  );

  const validPricingExists = totals.length > 0;
  const recommended_supplier = validPricingExists
    ? (winner?.supplier_name ?? payload.quotations[0]?.supplier_name ?? "")
    : (winner?.supplier_name ?? "");
  const confidence_score = validPricingExists ? (winner?.final_score ?? 0) : 0;
  const savings = highest > lowest ? highest - lowest : 0;

  const baseSummary = !validPricingExists
    ? "Quotation pricing was not provided by the suppliers, so a valid price comparison cannot be completed."
    : winner
    ? `Local procurement analysis recommends ${winner.supplier_name} with a weighted score of ${winner.final_score}/100 based on price (${engineResult.weights.price_weight}%), delivery (${engineResult.weights.delivery_weight}%), quality (${engineResult.weights.quality_weight}%), and reliability (${engineResult.weights.reliability_weight}%) across ${payload.quotations.length} submitted quotations.`
    : "Local procurement analysis could not rank suppliers — insufficient quotation data.";
  const summary = appendPricingAvailability(baseSummary, payload.quotations);

  const risk_flags: AIRiskFlag[] = engineResult.suppliers
    .filter((s) => s.confidence_level === "low" || s.dimensions.price_score < 0)
    .map(
      (s): AIRiskFlag => ({
        type: s.dimensions.price_score < 0 ? "cost" : "quality",
        severity: s.dimensions.price_score < 0 ? "high" : "medium",
        message: s.dimensions.price_score < 0
          ? `${s.supplier_name}: quotation pricing was not provided.`
          : `${s.supplier_name}: limited historical data — scores based on quotation comparison only.`,
      })
    );

  return {
    rfq_id: payload.rfq_name,
    evaluation_run_id: engineResult.evaluation_run_id ?? payload.evaluation_run_id,
    evaluation_weights: engineResult.weights,
    recommended_quotation_id: winner?.quotation_id,
    recommended_supplier_id: winner?.supplier_id,
    recommended_supplier,
    confidence_score,
    recommendation_summary: summary,
    supplier_analysis,
    cost_analysis: {
      savings_vs_expensive:
        savings > 0
          ? `${formatCurrency(savings)} saved vs most expensive bid`
          : "",
      savings_percentage:
        highest > 0 ? Math.round((savings / highest) * 100) : 0,
      price_range:
        totals.length > 0
          ? `${formatCurrency(lowest)} to ${formatCurrency(highest)}`
          : "",
    },
    per_item_analysis: buildPerItemAnalysis(payload),
    risk_flags,
    negotiation_tips: savings > 0
      ? [
          `Lowest total is ${formatCurrency(lowest)} — use ${formatCurrency(savings)} spread as negotiation leverage with higher bidders.`,
        ]
      : [],
    split_order_option: {
      recommended: false,
      reason: validPricingExists
        ? "Single-supplier award recommended based on weighted total score."
        : "Order split cannot be evaluated without valid supplier pricing.",
      suggestion: "",
    },
    final_verdict: summary,
    reason: summary,
    cost_savings:
      savings > 0
        ? `${formatCurrency(savings)} saved vs most expensive bid`
        : "",
    risk_factors: risk_flags.map((r) => r.message),
    per_item_recommendation: buildPerItemAnalysis(payload).map((p) => ({
      item: p.item,
      best_supplier: p.best_supplier,
      reason: p.recommendation,
    })),
  };
}

/**
 * Parse model JSON text into a normalized recommendation.
 */
export function parseGeneratedRecommendation(
  rawText: string,
  payload: AIRequest,
  weights?: AnalysisWeights,
): AIRecommendation {
  const parsed = parseAiJson(rawText);
  // eslint-disable-next-line no-console
  if (import.meta.env.DEV) console.log("[AI PARSED]", parsed);
  const validated = validateAndScoreEvaluation(parsed, buildEvaluationContext(payload, weights));
  const recommendation = applyEvaluationDecisionProjection(coerceRecommendation(validated, payload.quotations));
  if (import.meta.env.DEV) console.log("[AI EVALUATION DEBUG] Parsed supplier evaluations", {
    rfq_id: payload.rfq_name,
    evaluation_run_id: payload.evaluation_run_id,
    suppliers: recommendation.supplier_analysis.map((row) => ({
      quotation_id: row.quotation_id, supplier_id: row.supplier_id,
      raw_ai_score: row.raw_ai_score, parsed_score: row.score.overall,
      dimensions: row.score, risk: row.risk, verdict: row.verdict,
    })),
  });
  return recommendation;
}

function buildEvaluationContext(payload: AIRequest, weights?: AnalysisWeights): EvaluationContext {
  const w = weights ?? { price: 40, delivery: 25, quality: 20, reliability: 15 };
  return {
    rfq_id: payload.rfq_name,
    evaluation_run_id: payload.evaluation_run_id ?? "",
    weights: { price_weight: w.price, delivery_weight: w.delivery,
      quality_weight: w.quality, reliability_weight: w.reliability },
    quotations: payload.quotations.map((quote) => ({
      quotation_id: quote.quotation_id ?? "", supplier_id: quote.supplier_id ?? "",
      supplier_name: quote.supplier_name, total_value: quote.total_value,
    })),
  };
}

/**
 * Cloud AI resolution: Claude (with retries) → OpenAI (with retries).
 * Returns null when both providers fail so the caller can show evaluation unavailable.
 */
export async function resolveAIRecommendation(
  payload: AIRequest,
  weights?: AnalysisWeights
): Promise<ResolvedAIAnalysis | null> {
  payload = { ...payload, evaluation_run_id: payload.evaluation_run_id ?? crypto.randomUUID() };
  // eslint-disable-next-line no-console
  if (import.meta.env.DEV) console.log("AI Request", payload);

  const prompt = buildAnalysisPrompt(payload, weights);
  const context = buildEvaluationContext(payload, weights);

  try {
    const generated = await generateWithRetry(
      "Claude",
      (p) => generateWithClaudeOnce(p, context),
      prompt
    );
    const recommendation = parseGeneratedRecommendation(
      generated.text,
      payload,
      weights
    );
    // eslint-disable-next-line no-console
    if (import.meta.env.DEV) console.log("AI Response", recommendation);
    return {
      recommendation,
      provider: "claude",
      tokensUsed: generated.tokensUsed,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[AI] Claude exhausted retries:", err);
  }

  if (readOpenAIKeyOptional()) {
    try {
      const generated = await generateWithRetry(
        "OpenAI",
        generateWithOpenAIOnce,
        prompt
      );
      const recommendation = parseGeneratedRecommendation(
        generated.text,
        payload,
        weights
      );
      // eslint-disable-next-line no-console
      if (import.meta.env.DEV) console.log("AI Response", recommendation);
      return {
        recommendation,
        provider: "openai",
        tokensUsed: generated.tokensUsed,
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[AI] OpenAI exhausted retries:", err);
    }
  } else {
    // eslint-disable-next-line no-console
    console.warn("[AI] OpenAI skipped — VITE_OPENAI_API_KEY not set");
  }

  // eslint-disable-next-line no-console
  console.warn("[AI] All cloud providers failed — evaluation unavailable");
  return null;
}

/**
 * @deprecated Use resolveAIRecommendation — kept for compatibility.
 */
export async function getAIRecommendation(
  payload: AIRequest,
  weights?: AnalysisWeights
): Promise<AIAnalysisResponse> {
  const resolved = await resolveAIRecommendation(payload, weights);
  if (!resolved) {
    throw new AIRecommendationError("All cloud AI providers failed", {
      retryable: false,
    });
  }
  return {
    recommendation: resolved.recommendation,
    tokensUsed: resolved.tokensUsed,
  };
}
