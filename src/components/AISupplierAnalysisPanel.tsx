import {
  AlertTriangle,
  Award,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Lightbulb,
  Loader2,
  Package,
  RefreshCw,
  ShoppingCart,
  Shuffle,
  Sparkles,
} from "lucide-react";

import type {
  AIRecommendation,
  SupplierAnalysisRow,
  SupplierVerdict,
} from "../types/erpnext";
import { APP_NAME } from "../config/branding";
import { formatCurrency } from "../utils/format";
import { formatQuoteTotal } from "../utils/quotePrice";
import { buildEvaluationSummary, getEvaluationRisk, projectSupplierDecision } from "../utils/aiEvaluationDecision";
import { findRecommendationWinner } from "../utils/aiRecommendationNormalization";
import { getSupplierAwardEligibility } from "../utils/supplierAwardEligibility";

function hasScore(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

const LOADING_STEPS = [
  "Reading all supplier quotations...",
  "Comparing prices item by item...",
  "Analyzing delivery commitments...",
  "Calculating risk factors...",
  "Preparing final recommendation...",
] as const;

const VERDICT_STYLES: Record<
  SupplierVerdict,
  { bg: string; text: string }
> = {
  "BEST VALUE": { bg: "bg-success-100", text: "text-success-500" },
  "GOOD OPTION": { bg: "bg-warning-100", text: "text-warning-500" },
  EXPENSIVE: { bg: "bg-warning-100", text: "text-warning-500" },
  AVOID: { bg: "bg-danger-100", text: "text-danger-500" },
  "QUOTE INCOMPLETE": { bg: "bg-amber-100", text: "text-amber-700" },
  "HIGH RISK / REVIEW": { bg: "bg-rose-100", text: "text-rose-700" },
  "NOT EVALUATED": { bg: "bg-neutral-100", text: "text-neutral-600" },
};

/** Subtle, enterprise-style rank chip (replaces loud medal emoji). */
const RANK_BADGE_TONE: Record<number, string> = {
  1: "bg-amber-50 text-amber-700 ring-amber-200",
  2: "bg-neutral-100 text-neutral-600 ring-neutral-200",
  3: "bg-orange-50 text-orange-700 ring-orange-200",
};

function RankBadge({ rank }: { rank: number }) {
  const tone = RANK_BADGE_TONE[rank] ?? "bg-neutral-100 text-neutral-500 ring-neutral-200";
  return (
    <span
      className={`inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ring-1 ring-inset ${tone}`}
      aria-label={`Rank ${rank}`}
    >
      {rank}
    </span>
  );
}

interface Props {
  loading: boolean;
  loadingStep: number;
  result: AIRecommendation | null;
  error: string | null;
  tokensUsed: number;
  quotationCount: number;
  hasApiKey: boolean;
  onRun: () => void;
  onRefresh: () => void;
  onCreatePO: () => void;
}

export default function AISupplierAnalysisPanel({
  loading,
  loadingStep,
  result,
  error,
  tokensUsed,
  quotationCount,
  hasApiKey,
  onRun,
  onRefresh,
  onCreatePO,
}: Props) {
  const topRanked = result ? findRecommendationWinner(result) : undefined;
  const topRankedEligibility = getSupplierAwardEligibility(topRanked);
  return (
    <div id="ai-section" className="mt-8 overflow-hidden rounded-card border border-neutral-200 shadow-card">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-sidebar px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10 text-white/90">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <div className="text-base font-bold text-white">
              AI Procurement Intelligence
            </div>
            <div className="text-xs text-white/60">
              Powered by Claude AI • {APP_NAME}
            </div>
          </div>
        </div>
        {!result && !loading && hasApiKey && (
          <button
            type="button"
            onClick={onRun}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-600"
          >
            <Sparkles className="h-4 w-4" />
            Get AI Analysis
          </button>
        )}
        {result && !loading && (
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/20"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        )}
      </div>

      <div className="bg-white">
        {!hasApiKey && (
          <div className="p-8 text-center">
            <p className="text-sm text-danger-500">
              AI analysis is unavailable. Check the server AI configuration.
            </p>
          </div>
        )}

        {hasApiKey && loading && (
          <div className="px-6 py-12 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary-50 text-primary">
              <Sparkles className="h-6 w-6" />
            </div>
            <p className="mb-6 text-base font-semibold text-neutral-900">
              Analyzing quotations...
            </p>
            <div className="mx-auto max-w-sm space-y-1">
              {LOADING_STEPS.map((step, idx) => (
                <div
                  key={step}
                  className={`rounded-md px-4 py-1.5 text-sm transition-all ${
                    idx <= loadingStep
                      ? "bg-success-100 text-success-600"
                      : "bg-neutral-50 text-neutral-400"
                  }`}
                >
                  {idx <= loadingStep ? "✓" : "○"} {step}
                </div>
              ))}
            </div>
            <Loader2 className="mx-auto mt-6 h-6 w-6 animate-spin text-primary" />
          </div>
        )}

        {hasApiKey && error && !loading && (
          <div className="p-8 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-danger-50 text-danger-500">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <p className="mb-4 text-sm text-danger-500">{error}</p>
            <button type="button" onClick={onRun} className="btn-primary">
              Retry
            </button>
          </div>
        )}

        {hasApiKey && !loading && !error && !result && (
          <div className="px-6 py-12 text-center text-neutral-500">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary-50 text-primary">
              <Sparkles className="h-6 w-6" />
            </div>
            <p className="text-base font-medium text-neutral-700">
              Ready to analyze {quotationCount} quotation
              {quotationCount === 1 ? "" : "s"}
            </p>
            <p className="mt-1 text-sm">
              Claude AI will compare all suppliers and give you a detailed
              recommendation
            </p>
            <button
              type="button"
              onClick={onRun}
              className="btn-primary mt-6"
            >
              <Sparkles className="h-4 w-4" />
              Get AI Analysis
            </button>
          </div>
        )}

        {hasApiKey && result && !loading && (
          <div className="space-y-6 p-6">
            <WinnerBanner result={result} />

            {result.supplier_analysis?.length > 0 && (
              <section>
                <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-neutral-900">
                  <BarChart3 className="h-4 w-4 text-neutral-400" />
                  Supplier-by-Supplier Analysis
                </h3>
                <div className="flex flex-col gap-3">
                  {[...result.supplier_analysis]
                    .sort((a, b) => a.rank - b.rank)
                    .map((s) => (
                      <SupplierCard key={s.quotation_id || s.supplier_id || s.name} supplier={s} isTopRanked={s === topRanked} />
                    ))}
                </div>
              </section>
            )}

            {result.per_item_analysis?.length > 0 && (
              <section>
                <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-neutral-900">
                  <Package className="h-4 w-4 text-neutral-400" />
                  Per Item Best Source
                </h3>
                <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-50">
                  <table className="data-table">
                    <thead>
                      <tr>
                        {[
                          "Item",
                          "Best Supplier",
                          "Best Price",
                          "Worst Price",
                          "Spread",
                          "Recommendation",
                        ].map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.per_item_analysis.map((item, idx) => (
                        <tr key={`${item.item}-${idx}`}>
                          <td className="font-medium">{item.item}</td>
                          <td>
                            <span className="inline-flex rounded bg-success-100 px-2 py-0.5 text-xs font-semibold text-success-500">
                              {item.best_supplier}
                            </span>
                          </td>
                          <td className="font-semibold text-success-500">
                            {formatCurrency(item.best_price)}
                          </td>
                          <td className="text-danger-500">
                            {formatCurrency(item.worst_price)}
                          </td>
                          <td className="text-neutral-600">
                            {item.price_spread}
                          </td>
                          <td className="text-xs text-neutral-500">
                            {item.recommendation}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {result.supplier_analysis?.length > 0 && (
              <section>
                <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-neutral-900">
                  <AlertTriangle className="h-4 w-4 text-neutral-400" />
                  Risk Assessment
                </h3>
                <div className="flex flex-col gap-2">
                  {result.supplier_analysis.map((supplier) => (
                    <RiskRow key={`${supplier.evaluation_run_id ?? ""}:${supplier.quotation_id || supplier.supplier_quotation_id || ""}:${supplier.supplier_id || supplier.name}`} supplier={supplier} />
                  ))}
                </div>
              </section>
            )}

            {result.negotiation_tips?.length > 0 && (
              <section>
                <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-neutral-900">
                  <Lightbulb className="h-4 w-4 text-neutral-400" />
                  Negotiation Tips
                </h3>
                <div className="rounded-lg border border-warning-100 bg-warning-50 p-4">
                  {result.negotiation_tips.map((tip, idx) => (
                    <div
                      key={idx}
                      className={`flex gap-2 py-1.5 text-sm text-neutral-700 ${
                        idx < result.negotiation_tips.length - 1
                          ? "border-b border-warning-100"
                          : ""
                      }`}
                    >
                      <span className="font-bold text-warning-600">
                        {idx + 1}.
                      </span>
                      <span>{tip}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {result.split_order_option?.recommended && (
              <div className="rounded-lg border border-primary-200 bg-primary-50 p-4">
                <p className="flex items-center gap-2 text-sm font-bold text-primary-700">
                  <Shuffle className="h-4 w-4 text-primary-500" />
                  Split Order Opportunity
                </p>
                <p className="mt-1 text-sm text-neutral-700">
                  {result.split_order_option.reason}
                </p>
                <p className="mt-1 text-sm font-medium text-primary">
                  → {result.split_order_option.suggestion}
                </p>
              </div>
            )}

            <div className="rounded-lg bg-sidebar p-5">
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-white/60">
                <ClipboardList className="h-3.5 w-3.5" />
                Executive Summary
              </p>
              <p className="text-sm leading-relaxed text-white">
                {buildEvaluationSummary(result.supplier_analysis)}
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-neutral-100 pt-4">
              <p className="text-xs text-neutral-400">
                Analysis powered by Claude AI
                {tokensUsed > 0 && ` • ${tokensUsed.toLocaleString()} tokens`}
              </p>
              <button
                type="button"
                onClick={() => { if (topRankedEligibility.awardEligible) onCreatePO(); }}
                disabled={!topRankedEligibility.awardEligible}
                title={topRankedEligibility.awardIneligibilityReason}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-8 py-3 text-sm font-bold text-white shadow-md transition hover:bg-primary-600 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ShoppingCart className="h-4 w-4" />
                Create PO — {result.recommended_supplier}
              </button>
            </div>

            {result.cost_analysis?.savings_vs_expensive && (
              <p className="text-center text-xs text-neutral-300">
                Cost savings: {result.cost_analysis.savings_vs_expensive}
                {result.cost_analysis.price_range &&
                  ` • ${result.cost_analysis.price_range}`}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function WinnerBanner({ result }: { result: AIRecommendation }) {
  const winner = findRecommendationWinner(result);
  const score = hasScore(winner?.score.overall) ? winner.score.overall : null;
  const decision = winner ? projectSupplierDecision(winner, true) : undefined;
  const eligible = getSupplierAwardEligibility(winner).awardEligible;
  return (
    <div className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border-2 p-5 ${eligible ? "border-success-100 bg-success-50" : "border-neutral-200 bg-neutral-50"}`}>
      <div className="min-w-0 flex-1">
        <p className={`flex items-center gap-1.5 text-xs font-semibold ${eligible ? "text-success-500" : "text-neutral-600"}`}>
          {eligible ? <Award className="h-4 w-4" /> : <BarChart3 className="h-4 w-4" />}
          {eligible ? "AI TOP-RANKED SUPPLIER" : score !== null ? "TOP SCORE" : "EVALUATION UNAVAILABLE"}
        </p>
        <p className="mt-1 text-2xl font-bold text-neutral-900">
          {winner?.name ?? "Evaluation unavailable"}
        </p>
        <p className="mt-2 max-w-xl text-sm text-neutral-600">
          {decision?.recommendation_reason ?? "The evaluated quotation could not be resolved."}
        </p>
        {winner && <p className="mt-2 text-sm text-neutral-700">Risk: {getEvaluationRisk(winner)} · Verdict: {winner.verdict}</p>}
      </div>
      <div className="text-center">
        <p className="text-4xl font-bold text-success-500">{score === null ? "Unavailable" : `${score}%`}</p>
        <p className="text-xs text-neutral-500">weighted score</p>
        <div className="mt-2 h-2 w-20 overflow-hidden rounded-full bg-neutral-200">
          <div
            className={`h-full rounded-full transition-all ${
              score !== null && score > 80 ? "bg-success-500" : "bg-warning-500"
            }`}
            style={{ width: `${score ?? 0}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function SupplierCard({ supplier, isTopRanked }: { supplier: SupplierAnalysisRow; isTopRanked: boolean }) {
  const styles = VERDICT_STYLES[supplier.verdict] ?? VERDICT_STYLES["GOOD OPTION"];
  const decision = projectSupplierDecision(supplier, isTopRanked);
  const border =
    decision.recommendation_status === "REQUIRES_REVIEW"
      ? "border-danger-100 bg-danger-50"
      : isTopRanked
      ? "border-primary-200 bg-primary-50"
      : "border-neutral-200 bg-white";

  return (
    <div className={`rounded-lg border-2 p-4 ${border}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <RankBadge rank={supplier.rank} />
            <span className="text-base font-bold">{supplier.name}</span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${styles.bg} ${styles.text}`}
            >
              {supplier.verdict}
            </span>
          </div>
          <p className="mt-2 text-sm text-neutral-600">
            {supplier.why_best_or_worst}
          </p>
          <p className="mt-2 text-xs text-neutral-600">Risk: {getEvaluationRisk(supplier)}. {decision.recommendation_reason}</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold">
            {formatQuoteTotal(
              supplier.grand_total,
              supplier.quote_price_status,
            )}
          </p>
          <p className="text-xs text-neutral-500">
            Overall score: {hasScore(supplier.score?.overall) ? `${supplier.score.overall}%` : "AI evaluation unavailable"}
          </p>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(
          [
            { label: "Cost", value: supplier.score?.cost, color: "bg-primary" },
            {
              label: "Delivery",
              value: supplier.score?.delivery,
              color: "bg-primary",
            },
            {
              label: "Quality",
              value: supplier.score?.quality,
              color: "bg-primary",
            },
            {
              label: "Reliability",
              value: supplier.score?.reliability,
              color: "bg-primary",
            },
          ] as const
        ).map(({ label, value, color }) => {
          const isMissing = !hasScore(value);
          return (
            <div key={label}>
              <div className="mb-0.5 flex justify-between text-[11px] text-neutral-500">
                <span>{label}</span>
                <span>{isMissing ? "N/A" : `${value}%`}</span>
              </div>
              <div className="h-1 rounded-full bg-neutral-200">
                <div
                  className={`h-1 rounded-full ${color}`}
                  style={{ width: `${isMissing ? 0 : value}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-success-500">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Strengths
          </p>
          {decision.strengths?.map((s, i) => (
            <p key={i} className="text-xs text-neutral-600">
              • {s}
            </p>
          ))}
        </div>
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-danger-500">
            <AlertTriangle className="h-3.5 w-3.5" />
            Weaknesses
          </p>
          {supplier.weaknesses?.map((w, i) => (
            <p key={i} className="text-xs text-neutral-600">
              • {w}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

function RiskRow({ supplier }: { supplier: SupplierAnalysisRow }) {
  const risk = getEvaluationRisk(supplier);
  const bg =
    risk === "High"
      ? "border-danger-100 bg-danger-50"
      : risk === "Medium"
      ? "border-warning-100 bg-warning-50"
      : risk === "Low" ? "border-success-100 bg-success-50" : "border-neutral-200 bg-neutral-50";
  const dot =
    risk === "High"
      ? "bg-danger-500"
      : risk === "Medium"
      ? "bg-warning-500"
      : risk === "Low" ? "bg-success-500" : "bg-neutral-400";

  return (
    <div className={`flex items-start gap-3 rounded-lg border p-3 ${bg}`}
      data-quotation-id={supplier.quotation_id || supplier.supplier_quotation_id}
      data-supplier-id={supplier.supplier_id}
      data-evaluation-run-id={supplier.evaluation_run_id}>
      <span className={`mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full ${dot}`} />
      <div>
        <p className="text-[11px] font-semibold uppercase text-neutral-500">
          Supplier risk · {risk}
        </p>
        <p className="text-sm font-semibold text-neutral-900">{supplier.name}</p>
        <p className="text-sm text-neutral-700">{supplier.why_best_or_worst || "No evaluation reasoning was provided."}</p>
      </div>
    </div>
  );
}

export { LOADING_STEPS };
