/**
 * Multi-provider AI integration for the Smart RFQ recommendation panel.
 * Fallback chain: Claude (retries) → OpenAI (retries) → Local scoring engine.
 *
 * SECURITY NOTE: browser-direct API calls expose keys in DevTools.
 * Acceptable for internal staging; use a server proxy in production.
 */

import type {
  AIRecommendation,
  AIRiskFlag,
  AIPerItemAnalysis,
  SupplierAnalysisRow,
  SupplierVerdict,
} from "../types/erpnext";
import { formatCurrency } from "../utils/format";
import type { ScoringEngineResult } from "./supplierScoringEngine";

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_VERSION = "2023-06-01";

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

const ANTHROPIC_MODEL =
  (import.meta.env.VITE_ANTHROPIC_MODEL as string | undefined)?.trim() ||
  DEFAULT_ANTHROPIC_MODEL;

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
  unit_price: number;
  total: number;
  delivery_days?: number;
  notes?: string;
}

export interface AIQuotation {
  supplier_name: string;
  items: AIQuotationLine[];
  total_value: number;
  payment_terms?: string;
  notes?: string;
}

export interface AIRequest {
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

interface AnthropicMessageResponse {
  content: Array<{ type: string; text?: string }>;
  usage?: { input_tokens: number; output_tokens: number };
  type?: string;
  error?: { type: string; message: string };
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
    claude: !!readAnthropicKeyOptional(),
    openai: !!readOpenAIKeyOptional(),
    local: true,
  };
}

function readAnthropicKeyOptional(): string {
  return (import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined)?.trim() ?? "";
}

function readOpenAIKeyOptional(): string {
  return (import.meta.env.VITE_OPENAI_API_KEY as string | undefined)?.trim() ?? "";
}

function readApiKey(): string {
  const key = readAnthropicKeyOptional();
  if (!key) {
    throw new AIRecommendationError("Anthropic API key not configured", {
      retryable: false,
    });
  }
  return key;
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
  console.log("[AI RAW RESPONSE]", rawText);
  let cleaned = "";
  try {
    // Strip markdown fences and extract the first { … last } JSON object.
    cleaned = isolateJson(rawText);
    // eslint-disable-next-line no-console
    console.log("[AI CLEANED RESPONSE]", cleaned);
    const parsed = JSON.parse(cleaned);
    // eslint-disable-next-line no-console
    console.log("[AI JSON PARSE SUCCESS]");
    return parsed;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[AI JSON PARSE FAILED]", {
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

function verdictFromRank(rank: number, total: number): SupplierVerdict {
  if (rank === 1) return "BEST VALUE";
  if (rank === 2) return "GOOD OPTION";
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
  return Number.isFinite(n) ? n : 0;
}

/** Read a rank from a number or a numeric string. */
function rowRank(row: Record<string, unknown>): number {
  const raw = row.rank ?? row.position;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : 99;
}

/** Tolerant match of an AI supplier name to a real quotation total. */
function findQuoteTotal(name: string, quotations: AIQuotation[]): number {
  const key = name.trim().toLowerCase();
  if (!key) return 0;
  const exact = quotations.find(
    (q) => q.supplier_name.trim().toLowerCase() === key
  );
  if (exact) return exact.total_value;
  const partial = quotations.find((q) => {
    const s = q.supplier_name.trim().toLowerCase();
    return s.includes(key) || key.includes(s);
  });
  return partial?.total_value ?? 0;
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

  const ranking = (
    rankingRaw.filter(
      (row) => row && typeof row === "object"
    ) as Record<string, unknown>[]
  ).map((row) => ({
    row,
    name: rowSupplierName(row),
    rank: rowRank(row),
    score: rowScore(row),
  }));

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

  const summary = String(
    v.summary ?? v.recommendation_summary ?? v.final_verdict ?? v.reason ?? ""
  );

  const supplier_analysis: SupplierAnalysisRow[] = ranking
    .map(({ row, name, rank, score }): SupplierAnalysisRow | null => {
      if (!name) return null;
      const reason = String(row.reason ?? row.why_best_or_worst ?? "");
      // Extract per-dimension scores from AI response when available;
      // never copy a single overall score to all dimensions.
      const priceScore = typeof row.price_score === "number" ? row.price_score : -1;
      const deliveryScoreVal = typeof row.delivery_score === "number" ? row.delivery_score : -1;
      const reliabilityScoreVal = typeof row.reliability_score === "number" ? row.reliability_score : -1;
      return {
        name,
        rank,
        verdict: verdictFromRank(rank, ranking.length),
        grand_total: findQuoteTotal(name, quotations),
        strengths: reason ? [reason] : [],
        weaknesses: [] as string[],
        score: {
          cost: priceScore >= 0 ? priceScore : score,
          delivery: deliveryScoreVal >= 0 ? deliveryScoreVal : -1,
          reliability: reliabilityScoreVal >= 0 ? reliabilityScoreVal : -1,
          overall: score,
        },
        why_best_or_worst: reason,
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

  const totals = quotations.map((q) => q.total_value).filter((t) => t > 0);
  const lowest = totals.length ? Math.min(...totals) : 0;
  const highest = totals.length ? Math.max(...totals) : 0;

  return {
    recommended_supplier: recommendedSupplier,
    confidence_score,
    recommendation_summary: summary,
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

function coerceSupplierAnalysis(val: unknown): SupplierAnalysisRow[] {
  if (!Array.isArray(val)) return [];
  const verdicts: SupplierVerdict[] = [
    "BEST VALUE",
    "GOOD OPTION",
    "EXPENSIVE",
    "AVOID",
  ];
  return val
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const r = row as Record<string, unknown>;
      const score = (r.score as Record<string, unknown>) ?? {};
      const verdict = String(r.verdict ?? "GOOD OPTION");
      return {
        name: String(r.name ?? ""),
        rank: typeof r.rank === "number" ? r.rank : 99,
        verdict: verdicts.includes(verdict as SupplierVerdict)
          ? (verdict as SupplierVerdict)
          : "GOOD OPTION",
        grand_total:
          typeof r.grand_total === "number" ? r.grand_total : 0,
        strengths: asStringArray(r.strengths),
        weaknesses: asStringArray(r.weaknesses),
        score: {
          cost: typeof score.cost === "number" ? score.cost : 0,
          delivery: typeof score.delivery === "number" ? score.delivery : 0,
          reliability:
            typeof score.reliability === "number" ? score.reliability : 0,
          overall: typeof score.overall === "number" ? score.overall : 0,
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

  const recommendation_summary = String(
    v.recommendation_summary ?? v.reason ?? ""
  );
  const supplier_analysis = coerceSupplierAnalysis(v.supplier_analysis);
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
    final_verdict: String(v.final_verdict ?? recommendation_summary),
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

function buildAnalysisPrompt(
  payload: AIRequest,
  weights?: AnalysisWeights
): string {
  const w = weights ?? { price: 40, delivery: 25, quality: 20, reliability: 15 };
  const totals = payload.quotations.map((q) => q.total_value).filter((t) => t > 0);
  const lowestTotal = totals.length ? Math.min(...totals) : 0;
  const highestTotal = totals.length ? Math.max(...totals) : 0;

  const itemsBlock = payload.items_requested
    .map((i) => `- ${i.item}: ${i.qty} ${i.uom ?? ""}`.trim())
    .join("\n");

  const quotesBlock = payload.quotations
    .map((q, idx) => {
      const flags =
        q.total_value === lowestTotal && totals.length > 1
          ? "⭐ LOWEST TOTAL"
          : q.total_value === highestTotal && totals.length > 1
          ? "⚠️ HIGHEST TOTAL"
          : "";
      const lines = q.items
        .map((i) => {
          const qty = i.requested_qty ?? 1;
          const note = i.notes ? ` | Note: ${i.notes}` : "";
          return `  - ${i.item}: ${formatCurrency(i.unit_price)}/unit × ${qty} = ${formatCurrency(i.total)} | Delivery: ${i.delivery_days ?? 7} days${note}`;
        })
        .join("\n");
      return `
SUPPLIER ${idx + 1}: ${q.supplier_name}
Grand Total: ${formatCurrency(q.total_value)}
${flags}
Items:
${lines}
Payment Terms: ${q.payment_terms ?? "Not specified"}
Additional Notes: ${q.notes ?? ""}`;
    })
    .join("\n---");

  const supplierNames = payload.quotations
    .map((q) => q.supplier_name)
    .join(", ");

  return `You are an expert procurement analyst for Netlink, a manufacturing company.
Analyze these ${payload.quotations.length} supplier quotations for RFQ: ${payload.rfq_name}

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
  "ranking": [
    {
      "supplier": "exact supplier name from quotations",
      "rank": 1,
      "score": 85,
      "price_score": 92,
      "delivery_score": 78,
      "reliability_score": 80,
      "risk": "Low",
      "reason": "Specific explanation referencing actual price difference, delivery days, item coverage, and terms"
    }
  ],
  "recommendedSupplier": "exact supplier name of rank 1 winner",
  "summary": "2-3 sentence executive summary referencing specific cost differences, delivery timelines, and completeness"
}

SCORING RULES — FOLLOW STRICTLY:
- "score": overall weighted integer 0-100 calculated using the formula above.
- "price_score": 0-100 based ONLY on the actual quoted grand total. Lowest price = highest score.
- "delivery_score": 0-100 based ONLY on actual quoted delivery days. Fastest = highest score.
- "reliability_score": 0-100 based on quotation completeness (payment terms provided, notes provided, all items quoted with delivery data).
- DO NOT assign 100 to all dimensions. Each score MUST reflect actual differences between suppliers.
- If all suppliers quoted the same price, price_score should be equal for all. Otherwise scores MUST differ.
- "risk": exactly "Low", "Medium", or "High".
- "reason": MUST reference specific data points (e.g. "$5,000 lower than next bidder", "3 days faster delivery", "missing payment terms").
- "ranking": include ONLY the ${payload.quotations.length} suppliers listed above, sorted best to worst (rank 1 = best).
- Do NOT invent, add, or reference any supplier not in the SUPPLIER QUOTATIONS section.
- "recommendedSupplier": must match the rank 1 supplier name exactly.
- Use supplier names EXACTLY as shown in SUPPLIER QUOTATIONS — no abbreviations or alternatives.`;
}

/** Generate raw model text from Claude (single attempt — use generateWithRetry). */
async function generateWithClaudeOnce(
  prompt: string
): Promise<{ text: string; tokensUsed: number }> {
  const apiKey = readApiKey();

  // eslint-disable-next-line no-console
  console.log("[AI] Claude endpoint:", ANTHROPIC_ENDPOINT, "model:", ANTHROPIC_MODEL);

  let response: Response;
  try {
    response = await fetch(ANTHROPIC_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1024,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (err) {
    throw new AIRecommendationError("Claude network error", {
      cause: err,
      retryable: true,
    });
  }

  let body: AnthropicMessageResponse;
  try {
    body = (await response.json()) as AnthropicMessageResponse;
  } catch (err) {
    throw new AIRecommendationError("Claude non-JSON response", {
      cause: err,
      retryable: false,
      statusCode: response.status,
    });
  }

  if (!response.ok || body.type === "error") {
    const status = response.status;
    const apiMessage = body.error?.message ?? response.statusText;
    // eslint-disable-next-line no-console
    console.error("[AI API] Claude error:", { status, message: apiMessage, body });

    throw new AIRecommendationError(`Claude HTTP ${status}: ${apiMessage}`, {
      retryable: isRetryableHttpStatus(status),
      statusCode: status,
    });
  }

  const textBlock = body.content?.find((c) => c.type === "text" && c.text);
  if (!textBlock?.text) {
    throw new AIRecommendationError("Claude returned no text content", {
      retryable: false,
    });
  }

  const tokensUsed =
    (body.usage?.input_tokens ?? 0) + (body.usage?.output_tokens ?? 0);

  return { text: textBlock.text, tokensUsed };
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
  console.log("[AI] OpenAI endpoint:", OPENAI_ENDPOINT, "model:", OPENAI_MODEL);

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

/**
 * Strips suppliers that aren't in the eligible set from `supplier_analysis`,
 * re-ranks sequentially, and fixes `recommended_supplier` if needed.
 */
function enforceEligibleSuppliers(
  rec: AIRecommendation,
  eligibleNames: Set<string>,
  quotations: AIQuotation[]
): AIRecommendation {
  if (eligibleNames.size === 0) return rec;

  const before = rec.supplier_analysis.length;
  rec.supplier_analysis = rec.supplier_analysis.filter((row) =>
    eligibleNames.has(row.name.trim().toLowerCase())
  );

  if (rec.supplier_analysis.length < before) {
    // eslint-disable-next-line no-console
    console.warn(
      "[AI] enforceEligibleSuppliers: removed",
      before - rec.supplier_analysis.length,
      "non-eligible supplier(s)"
    );
  }

  rec.supplier_analysis
    .sort((a, b) => a.rank - b.rank)
    .forEach((row, idx) => { row.rank = idx + 1; });

  if (!eligibleNames.has(rec.recommended_supplier.trim().toLowerCase())) {
    const fallback =
      rec.supplier_analysis[0]?.name ??
      quotations[0]?.supplier_name ??
      "";
    // eslint-disable-next-line no-console
    console.warn(
      "[AI] recommended_supplier",
      rec.recommended_supplier,
      "not in eligible set — falling back to",
      fallback
    );
    rec.recommended_supplier = fallback;
  }

  return rec;
}

function verdictFromEngineRank(rank: number, total: number): SupplierVerdict {
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
        return line && line.unit_price > 0
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

/**
 * Deterministic procurement recommendation when the Anthropic API is
 * unavailable. Uses quotation comparison + weighted scoring engine output.
 */
export function buildLocalProcurementRecommendation(
  payload: AIRequest,
  engineResult: ScoringEngineResult
): AIRecommendation {
  const totals = payload.quotations
    .map((q) => q.total_value)
    .filter((t) => t > 0);
  const lowest = totals.length ? Math.min(...totals) : 0;
  const highest = totals.length ? Math.max(...totals) : 0;
  const winner = engineResult.suppliers[0];

  const supplier_analysis: SupplierAnalysisRow[] = engineResult.suppliers.map(
    (s) => {
      const quote = payload.quotations.find(
        (q) => q.supplier_name.toLowerCase() === s.supplier_name.toLowerCase()
      );
      const strengths: string[] = [];
      const weaknesses: string[] = [];
      if (s.dimensions.price_score >= 80) strengths.push("competitive pricing");
      else if (s.dimensions.price_score < 40) weaknesses.push("higher cost");
      if (s.dimensions.delivery_score >= 80) strengths.push("fast delivery");
      else if (s.dimensions.delivery_score < 40) weaknesses.push("slow delivery");

      return {
        name: s.supplier_name,
        rank: s.ranking,
        verdict: verdictFromEngineRank(s.ranking, engineResult.suppliers.length),
        grand_total: quote?.total_value ?? 0,
        strengths,
        weaknesses,
        score: {
          cost: s.dimensions.price_score,
          delivery: s.dimensions.delivery_score,
          reliability: s.dimensions.reliability_score,
          overall: s.final_score,
        },
        why_best_or_worst: s.recommendation_reason,
      };
    }
  );

  const recommended_supplier =
    winner?.supplier_name ?? payload.quotations[0]?.supplier_name ?? "";
  const confidence_score = winner?.final_score ?? 0;
  const savings = highest > lowest ? highest - lowest : 0;

  const summary = winner
    ? `Local procurement analysis recommends ${winner.supplier_name} with a weighted score of ${winner.final_score}/100 based on price (${engineResult.weights.price_weight}%), delivery (${engineResult.weights.delivery_weight}%), quality (${engineResult.weights.quality_weight}%), and reliability (${engineResult.weights.reliability_weight}%) across ${payload.quotations.length} submitted quotations.`
    : "Local procurement analysis could not rank suppliers — insufficient quotation data.";

  const risk_flags: AIRiskFlag[] = engineResult.suppliers
    .filter((s) => s.confidence_level === "low")
    .map(
      (s): AIRiskFlag => ({
        type: "quality",
        severity: "medium",
        message: `${s.supplier_name}: limited historical data — scores based on quotation comparison only.`,
      })
    );

  return {
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
      reason: "Single-supplier award recommended based on weighted total score.",
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
function parseGeneratedRecommendation(
  rawText: string,
  payload: AIRequest,
  eligibleNames: Set<string>
): AIRecommendation {
  const parsed = parseAiJson(rawText);
  // eslint-disable-next-line no-console
  console.log("[AI PARSED]", parsed);
  let recommendation = coerceRecommendation(parsed, payload.quotations);
  recommendation = enforceEligibleSuppliers(
    recommendation,
    eligibleNames,
    payload.quotations
  );
  return recommendation;
}

/**
 * Cloud AI resolution: Claude (with retries) → OpenAI (with retries).
 * Returns null when both providers fail — caller should use local engine.
 * Errors are logged to console only; never surfaced to users.
 */
export async function resolveAIRecommendation(
  payload: AIRequest,
  weights?: AnalysisWeights
): Promise<ResolvedAIAnalysis | null> {
  // eslint-disable-next-line no-console
  console.log("AI Request", payload);

  const prompt = buildAnalysisPrompt(payload, weights);
  const eligibleNames = new Set(
    payload.quotations.map((q) => q.supplier_name.trim().toLowerCase())
  );

  if (readAnthropicKeyOptional()) {
    try {
      const generated = await generateWithRetry(
        "Claude",
        generateWithClaudeOnce,
        prompt
      );
      const recommendation = parseGeneratedRecommendation(
        generated.text,
        payload,
        eligibleNames
      );
      // eslint-disable-next-line no-console
      console.log("AI Response", recommendation);
      return {
        recommendation,
        provider: "claude",
        tokensUsed: generated.tokensUsed,
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[AI] Claude exhausted retries:", err);
    }
  } else {
    // eslint-disable-next-line no-console
    console.warn("[AI] Claude skipped — VITE_ANTHROPIC_API_KEY not set");
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
        eligibleNames
      );
      // eslint-disable-next-line no-console
      console.log("AI Response", recommendation);
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
  console.warn("[AI] All cloud providers failed — falling back to local engine");
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
