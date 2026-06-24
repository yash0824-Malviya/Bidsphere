import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  GitCompare,
  Loader2,
  Lock,
  Shield,
  ShoppingCart,
  Sparkles,
  X,
} from "lucide-react";

import type {
  AIRecommendation,
  SupplierAnalysisRow,
  SupplierVerdict,
} from "../types/erpnext";
import type { AIProvider, AIProviderAvailability } from "../api/ai";
import { formatCurrency } from "../utils/format";
import { ANALYSIS_STEPS } from "./aiAnalysisSteps";

export { ANALYSIS_STEPS };

type TabId = "overview" | "rankings" | "compare";
type RiskLevel = "Low" | "Medium" | "High";

/**
 * Supplier selection payload returned by the confirmation dialog.
 * The parent page uses this to persist the choice + audit trail.
 */
export interface SupplierSelectionPayload {
  supplierName: string;
  aiRank: number;
  riskLevel: RiskLevel;
  reason: string;
  grandTotal: number;
}

interface Props {
  open: boolean;
  loading: boolean;
  loadingStep: number;
  result: AIRecommendation | null;
  error: string | null;
  quoteAmount: number;
  quotationCount: number;
  creatingPO: boolean;
  hasApiKey: boolean;
  /** When a PO already exists for this RFQ, the modal is view-only. */
  poAlreadyExists?: boolean;
  /** The supplier already chosen for this RFQ (locks the UI). */
  chosenSupplier?: string | null;
  /** Override the primary CTA label (default: "Create Purchase Order"). */
  ctaLabel?: string;
  /** Override the loading CTA label (default: "Creating Purchase Order…"). */
  ctaLoadingLabel?: string;
  /** Override the "already exists" message shown when poAlreadyExists is true. */
  ctaDoneMessage?: string;
  /** Which provider produced the current result. */
  activeProvider?: AIProvider | null;
  /** Friendly notice when cloud AI was unavailable. */
  fallbackNotice?: string | null;
  /** Which providers are configured / available. */
  providerAvailability?: AIProviderAvailability;
  onClose: () => void;
  onRetry: () => void;
  onCreatePO: () => void;
  /** Called when the user confirms supplier selection via the new dialog. */
  onSelectSupplier?: (payload: SupplierSelectionPayload) => void;
}

function AIProviderStatusBar({
  active,
  availability,
}: {
  active: AIProvider | null;
  availability: AIProviderAvailability;
}) {
  const items: { id: AIProvider; label: string; configured: boolean }[] = [
    { id: "claude", label: "Claude", configured: availability.claude },
    { id: "openai", label: "OpenAI", configured: availability.openai },
    { id: "local", label: "Local Engine", configured: availability.local },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map(({ id, label, configured }) => {
        const isActive = active === id;
        return (
          <span
            key={id}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${
              isActive
                ? "bg-success-50 text-success-700 ring-success-200"
                : configured
                  ? "bg-neutral-50 text-neutral-500 ring-neutral-200"
                  : "bg-neutral-50/60 text-neutral-400 ring-neutral-100"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isActive ? "bg-success-500" : configured ? "bg-neutral-300" : "bg-neutral-200"
              }`}
            />
            {label} {isActive ? "Active" : configured ? "Standby" : "Off"}
          </span>
        );
      })}
    </div>
  );
}

function FallbackNoticeBanner({ message }: { message: string }) {
  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
      <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-sky-600" />
      <p>{message}</p>
    </div>
  );
}

const TABS: { id: TabId; label: string; icon: typeof BarChart3 }[] = [
  { id: "overview", label: "Overview", icon: Sparkles },
  { id: "rankings", label: "Rankings", icon: BarChart3 },
  { id: "compare", label: "Compare Top 3", icon: GitCompare },
];

const VERDICT_STYLES: Record<SupplierVerdict, { bg: string; text: string }> = {
  "BEST VALUE": { bg: "bg-success-100", text: "text-success-600" },
  "GOOD OPTION": { bg: "bg-primary-100", text: "text-primary-700" },
  EXPENSIVE: { bg: "bg-warning-100", text: "text-warning-600" },
  AVOID: { bg: "bg-danger-100", text: "text-danger-600" },
};

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Muted gold / silver / bronze tones for the top three, neutral beyond. */
function rankBadgeStyle(rank: number): string {
  switch (rank) {
    case 1:
      return "bg-amber-50 text-amber-700 ring-amber-200";
    case 2:
      return "bg-slate-100 text-slate-600 ring-slate-300";
    case 3:
      return "bg-orange-50 text-orange-700 ring-orange-200";
    default:
      return "bg-neutral-100 text-neutral-500 ring-neutral-200";
  }
}

/** Subtle numbered rank chip that replaces the medal emojis. */
function RankBadge({
  rank,
  size = "sm",
}: {
  rank: number;
  size?: "sm" | "md";
}) {
  const dims = size === "md" ? "h-7 w-7 text-xs" : "h-5 w-5 text-[11px]";
  return (
    <span
      className={`inline-flex flex-shrink-0 items-center justify-center rounded-full font-bold tabular-nums ring-1 ring-inset ${dims} ${rankBadgeStyle(
        rank
      )}`}
    >
      {rank}
    </span>
  );
}

function qualityScore(s: SupplierAnalysisRow): number {
  // Use the real quality score from the scoring engine when available
  const row = s as unknown as Record<string, unknown>;
  const sources = row.score_sources as Array<{ dimension: string; value: number }> | undefined;
  if (sources) {
    const qs = sources.find((src) => src.dimension === "Quality");
    if (qs && qs.value >= 0) return clampScore(qs.value);
  }
  // Fallback: use overall score as proxy (never average unrelated dimensions)
  return clampScore(s.score?.overall ?? 0);
}

function hasInsufficientData(s: SupplierAnalysisRow): boolean {
  const row = s as unknown as Record<string, unknown>;
  return row.has_sufficient_data === false;
}

function getConfidenceLevel(s: SupplierAnalysisRow): "high" | "medium" | "low" {
  const row = s as unknown as Record<string, unknown>;
  return (row.confidence_level as "high" | "medium" | "low") ?? "medium";
}

interface ScoreSourceInfo {
  dimension: string;
  value: number;
  source: string;
  has_data: boolean;
}

function getScoreSources(s: SupplierAnalysisRow): ScoreSourceInfo[] {
  const row = s as unknown as Record<string, unknown>;
  return (row.score_sources as ScoreSourceInfo[]) ?? [];
}

function supplierRiskLevel(s: SupplierAnalysisRow): RiskLevel {
  if (s.verdict === "AVOID") return "High";
  if (s.verdict === "EXPENSIVE") return "Medium";
  const rel = s.score?.reliability ?? 50;
  if (rel < 40 || s.weaknesses.length >= 3) return "High";
  if (rel < 65 || s.verdict === "GOOD OPTION") return "Medium";
  return "Low";
}

function riskStyles(level: RiskLevel) {
  switch (level) {
    case "High":
      return {
        label: "High Risk",
        tone: "bg-danger-50 text-danger-700 ring-danger-200",
        bar: "bg-danger-500",
      };
    case "Medium":
      return {
        label: "Medium Risk",
        tone: "bg-warning-50 text-warning-700 ring-warning-200",
        bar: "bg-warning-500",
      };
    default:
      return {
        label: "Low Risk",
        tone: "bg-success-50 text-success-700 ring-success-200",
        bar: "bg-success-500",
      };
  }
}

function sortRankedSuppliers(
  analysis: SupplierAnalysisRow[]
): SupplierAnalysisRow[] {
  return [...analysis].sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return (b.score?.overall ?? 0) - (a.score?.overall ?? 0);
  });
}

function ScoreBar({
  label,
  value,
  color = "bg-primary-500",
  source,
  hasData = true,
}: {
  label: string;
  value: number;
  color?: string;
  source?: string;
  hasData?: boolean;
}) {
  const v = value < 0 ? 0 : clampScore(value);
  const isInsufficient = value < 0 || !hasData;
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px] font-medium text-neutral-600">
        <span className="flex items-center gap-1">
          {label}
          {isInsufficient && (
            <span className="rounded bg-warning-100 px-1 py-0.5 text-[9px] font-semibold text-warning-700">
              Limited Data
            </span>
          )}
        </span>
        <span className="tabular-nums">{isInsufficient ? "—" : `${v}%`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
        <div
          className={`h-full rounded-full transition-all duration-700 ${isInsufficient ? "bg-neutral-300" : color}`}
          style={{ width: `${isInsufficient ? 0 : v}%` }}
        />
      </div>
      {source && (
        <p className="mt-0.5 text-[9px] text-neutral-400 leading-tight">{source}</p>
      )}
    </div>
  );
}

function RiskBadge({ level }: { level: RiskLevel }) {
  const s = riskStyles(level);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset ${s.tone}`}
    >
      {level === "High" ? (
        <AlertTriangle className="h-3 w-3" />
      ) : (
        <Shield className="h-3 w-3" />
      )}
      {s.label}
    </span>
  );
}

function ObservationBlock({
  title,
  children,
  tone = "neutral",
}: {
  title: string;
  children: React.ReactNode;
  tone?: "neutral" | "pricing" | "delivery" | "risk";
}) {
  const tones = {
    neutral: "border-neutral-200 bg-neutral-50/80",
    pricing: "border-emerald-200 bg-emerald-50/50",
    delivery: "border-primary-200 bg-primary-50/50",
    risk: "border-amber-200 bg-amber-50/50",
  };
  return (
    <div className={`rounded-xl border p-4 ${tones[tone]}`}>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
        {title}
      </p>
      <div className="text-sm leading-relaxed text-neutral-700">{children}</div>
    </div>
  );
}

function BulletList({ items, empty }: { items: string[]; empty: string }) {
  const list = items.length ? items : [empty];
  return (
    <ul className="space-y-1.5">
      {list.map((item, i) => (
        <li key={i} className="flex gap-2 text-sm text-neutral-700">
          <span className="mt-2 h-1 w-1 flex-shrink-0 rounded-full bg-primary-500" />
          {item}
        </li>
      ))}
    </ul>
  );
}

function buildObservations(
  supplier: SupplierAnalysisRow,
  rank1: SupplierAnalysisRow | undefined,
  result: AIRecommendation
) {
  const costDiff =
    rank1 && supplier.rank !== 1
      ? supplier.grand_total - rank1.grand_total
      : 0;
  const scoreDiff =
    rank1 && supplier.rank !== 1
      ? (rank1.score?.overall ?? 0) - (supplier.score?.overall ?? 0)
      : 0;

  const pricing =
    supplier.rank === 1
      ? `Benchmark quote at ${formatCurrency(supplier.grand_total)}. Price score ${clampScore(supplier.score?.cost ?? 0)}% — best evaluated cost position.`
      : costDiff > 0
      ? `${formatCurrency(costDiff)} above Rank #1 (${rank1?.name}). Price score ${clampScore(supplier.score?.cost ?? 0)}% vs ${clampScore(rank1?.score?.cost ?? 0)}% for the leader.`
      : `Quote ${formatCurrency(Math.abs(costDiff))} below Rank #1 on total — validate line-item coverage before selecting.`;

  const delivery = `Delivery score ${clampScore(supplier.score?.delivery ?? 0)}%. ${
    (supplier.score?.delivery ?? 0) >= 75
      ? "Competitive lead times relative to other bidders."
      : (supplier.score?.delivery ?? 0) >= 50
      ? "Acceptable delivery profile with some schedule risk."
      : "Delivery timeline may require mitigation or expediting."
  }`;

  const riskFlagMsgs = (result.risk_flags ?? [])
    .filter((f) => f.message.toLowerCase().includes(supplier.name.toLowerCase()))
    .map((f) => f.message);
  const risk =
    riskFlagMsgs.length > 0
      ? riskFlagMsgs.join(" ")
      : `${riskStyles(supplierRiskLevel(supplier)).label}. Reliability score ${clampScore(supplier.score?.reliability ?? 0)}%. ${
          supplier.weaknesses[0] ?? "No critical risk flags for this supplier."
        }`;

  return { pricing, delivery, risk, costDiff, scoreDiff };
}

function SupplierRankCard({
  supplier,
  rankIndex,
  isRecommended,
  compact,
  selected,
  chosenSupplier,
  onSelect,
  onChooseSupplier,
}: {
  supplier: SupplierAnalysisRow;
  rankIndex: number;
  isRecommended?: boolean;
  compact?: boolean;
  selected?: boolean;
  chosenSupplier?: string | null;
  onSelect: () => void;
  onChooseSupplier?: (supplier: SupplierAnalysisRow) => void;
}) {
  const score = clampScore(supplier.score?.overall ?? 0);
  const risk = supplierRiskLevel(supplier);
  const verdictStyle =
    VERDICT_STYLES[supplier.verdict] ?? VERDICT_STYLES["GOOD OPTION"];

  const isChosen = chosenSupplier === supplier.name;
  const isLocked = !!chosenSupplier && !isChosen;

  return (
    <div
      className={`w-full rounded-xl border bg-white p-4 text-left shadow-sm transition ${
        isChosen
          ? "border-success-400 ring-2 ring-success-200"
          : isLocked
          ? "border-neutral-200 opacity-60"
          : selected
          ? "border-primary-400 ring-2 ring-primary-200"
          : "border-neutral-200 hover:border-primary-300 hover:shadow-md"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <RankBadge rank={rankIndex + 1} />
            <h4 className="text-sm font-bold text-neutral-900">{supplier.name}</h4>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${verdictStyle.bg} ${verdictStyle.text}`}
            >
              {supplier.verdict}
            </span>
            {isRecommended && (
              <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-bold text-primary-700">
                AI Pick
              </span>
            )}
            {isChosen && (
              <span className="inline-flex items-center gap-1 rounded-full bg-success-100 px-2 py-0.5 text-[10px] font-bold text-success-700">
                <CheckCircle2 className="h-3 w-3" />
                Chosen Supplier
              </span>
            )}
          </div>
          {!compact && (
            <p className="mt-1 line-clamp-2 text-xs text-neutral-500">
              {supplier.why_best_or_worst}
            </p>
          )}
          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1">
              <div className="mb-1 flex justify-between text-xs text-neutral-500">
                <span>AI Score</span>
                <span className="font-bold text-primary-700">{score}/100</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-primary-100">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${score}%` }}
                />
              </div>
            </div>
            <RiskBadge level={risk} />
          </div>
        </div>
        <ChevronRight className="mt-1 h-5 w-5 flex-shrink-0 text-neutral-400" />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onSelect}
          className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 shadow-sm hover:bg-neutral-50"
        >
          View Details
          <ChevronRight className="h-3 w-3" />
        </button>
        {!isLocked && !isChosen && onChooseSupplier && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChooseSupplier(supplier);
            }}
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-primary-600"
          >
            <ShoppingCart className="h-3 w-3" />
            Select Supplier
          </button>
        )}
      </div>
    </div>
  );
}

function TopThreeComparison({
  suppliers,
  onSelect,
}: {
  suppliers: SupplierAnalysisRow[];
  onSelect: (name: string) => void;
}) {
  const top3 = suppliers.slice(0, 3);
  if (top3.length === 0) return null;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {top3.map((s, idx) => {
        const risk = supplierRiskLevel(s);
        return (
          <button
            key={s.name}
            type="button"
            onClick={() => onSelect(s.name)}
            className="flex flex-col rounded-xl border border-neutral-200 bg-white p-4 text-left shadow-sm transition hover:border-primary-300 hover:shadow-md"
          >
            <div className="mb-3 flex items-center justify-between">
              <RankBadge rank={idx + 1} size="md" />
              <RiskBadge level={risk} />
            </div>
            <p className="font-bold text-neutral-900">{s.name}</p>
            <p className="mt-1 text-2xl font-bold text-primary-700">
              {clampScore(s.score?.overall ?? 0)}
              <span className="text-sm font-normal text-neutral-400">/100</span>
            </p>
            <p className="mt-2 text-sm font-semibold text-neutral-800">
              {formatCurrency(s.grand_total)}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-neutral-500">
              <span>Price {clampScore(s.score?.cost ?? 0)}%</span>
              <span>Delivery {(s.score?.delivery ?? 0) < 0 ? "—" : `${clampScore(s.score?.delivery ?? 0)}%`}</span>
              <span>Quality {qualityScore(s) < 0 ? "—" : `${qualityScore(s)}%`}</span>
              <span>Reliability {(s.score?.reliability ?? 0) < 0 ? "—" : `${clampScore(s.score?.reliability ?? 0)}%`}</span>
            </div>
            <p className="mt-3 text-xs text-primary-600 font-medium">
              View full analysis →
            </p>
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Re-Analysis Comparison Banner (supplier already locked)                    */
/* -------------------------------------------------------------------------- */

function ReAnalysisComparisonBanner({
  previousSupplier,
  result,
}: {
  previousSupplier: string;
  result: AIRecommendation;
}) {
  const ranked = sortRankedSuppliers(result.supplier_analysis ?? []);
  const currentBest = result.recommended_supplier;
  const isSame = previousSupplier.toLowerCase() === currentBest.toLowerCase();

  const previousRow = ranked.find(
    (s) => s.name.toLowerCase() === previousSupplier.toLowerCase()
  );
  const bestRow = ranked.find(
    (s) => s.name.toLowerCase() === currentBest.toLowerCase()
  );

  const savingsAmount =
    previousRow && bestRow && previousRow.grand_total > bestRow.grand_total
      ? previousRow.grand_total - bestRow.grand_total
      : 0;

  const deliveryDiff =
    previousRow && bestRow
      ? (previousRow.score?.delivery ?? 0) - (bestRow.score?.delivery ?? 0)
      : 0;

  return (
    <div className="space-y-4">
      {/* Lock notice */}
      <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
        <Lock className="h-4 w-4 shrink-0" />
        <span>
          Supplier selection is locked. This re-analysis is for market comparison only.
        </span>
      </div>

      {/* Side-by-side comparison */}
      <div className="grid gap-3 sm:grid-cols-2">
        {/* Previous selection */}
        <div className="rounded-xl border border-success-200 bg-success-50 p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-success-600">
            Selected Supplier
          </p>
          <p className="mt-1 text-lg font-bold text-neutral-900">
            {previousSupplier}
          </p>
          {previousRow && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600">
              <span>Rank #{previousRow.rank}</span>
              <span>Score {clampScore(previousRow.score?.overall ?? 0)}/100</span>
              <span>{formatCurrency(previousRow.grand_total)}</span>
            </div>
          )}
        </div>

        {/* Current AI recommendation */}
        <div className="rounded-xl border border-primary-200 bg-primary-50 p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-primary-600">
            Current AI Recommendation
          </p>
          <p className="mt-1 text-lg font-bold text-neutral-900">
            {currentBest}
          </p>
          {bestRow && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600">
              <span>Rank #{bestRow.rank}</span>
              <span>Score {clampScore(bestRow.score?.overall ?? 0)}/100</span>
              <span>{formatCurrency(bestRow.grand_total)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Status */}
      {isSame ? (
        <div className="flex items-center gap-2 rounded-xl border border-success-200 bg-success-50 px-5 py-3.5 text-sm font-semibold text-success-700">
          <CheckCircle2 className="h-5 w-5" />
          Recommendation unchanged — AI still recommends the selected supplier.
        </div>
      ) : (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
            <AlertTriangle className="h-5 w-5" />
            Better supplier available than the originally selected supplier.
          </div>
          {(savingsAmount > 0 || deliveryDiff < 0) && (
            <div className="mt-3 flex flex-wrap gap-4 text-sm text-neutral-700">
              {savingsAmount > 0 && (
                <span className="inline-flex items-center gap-1">
                  <ArrowRight className="h-3.5 w-3.5 text-success-600" />
                  Savings Opportunity: <strong>{formatCurrency(savingsAmount)}</strong>
                </span>
              )}
              {deliveryDiff < 0 && (
                <span className="inline-flex items-center gap-1">
                  <ArrowRight className="h-3.5 w-3.5 text-success-600" />
                  Delivery Improvement: <strong>{Math.abs(deliveryDiff)} pts</strong>
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Supplier Selection Confirmation Dialog                                     */
/* -------------------------------------------------------------------------- */

function SelectionConfirmDialog({
  supplier,
  isTopPick,
  onConfirm,
  onCancel,
  busy,
}: {
  supplier: SupplierAnalysisRow;
  isTopPick: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [reason, setReason] = useState("");
  const risk = supplierRiskLevel(supplier);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-neutral-950/50" onClick={onCancel} />
      <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <h3 className="text-lg font-bold text-neutral-900">Confirm Supplier Selection</h3>

        {!isTopPick && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning-600" />
            <p className="text-sm text-warning-800">
              You are selecting a supplier that is not the top AI recommendation.
            </p>
          </div>
        )}

        <div className="mt-4 space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-neutral-500">Selected Supplier</span>
            <span className="font-semibold text-neutral-900">{supplier.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">AI Rank</span>
            <span className="font-semibold text-neutral-900">#{supplier.rank}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">Risk Level</span>
            <RiskBadge level={risk} />
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">Quote Total</span>
            <span className="font-semibold text-neutral-900">{formatCurrency(supplier.grand_total)}</span>
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-1.5 block text-sm font-medium text-neutral-700">
            Reason for Selection<span className="text-danger-500">*</span>
          </label>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Provide a business justification for selecting this supplier…"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason)}
            disabled={!reason.trim() || busy}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirm Selection
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Supplier Detail Panel                                                      */
/* -------------------------------------------------------------------------- */

function SupplierDetailPanel({
  supplier,
  rank1,
  result,
  quoteAmount,
  creatingPO,
  canSelect,
  chosenSupplier,
  onBack,
  onSelectSupplier,
  onCreatePO: _onCreatePO,
  ctaLabel: _ctaLabel = "Create Purchase Order",
  ctaLoadingLabel = "Creating Purchase Order…",
  ctaDoneMessage = "A purchase order has already been created for this RFQ.",
}: {
  supplier: SupplierAnalysisRow;
  rank1: SupplierAnalysisRow | undefined;
  result: AIRecommendation;
  quoteAmount: number;
  creatingPO: boolean;
  canSelect: boolean;
  chosenSupplier: string | null;
  onBack: () => void;
  onSelectSupplier: (supplier: SupplierAnalysisRow) => void;
  onCreatePO: () => void;
  ctaLabel?: string;
  ctaLoadingLabel?: string;
  ctaDoneMessage?: string;
}) {
  const [expandedWhy, setExpandedWhy] = useState(false);
  const risk = supplierRiskLevel(supplier);
  const obs = buildObservations(supplier, rank1, result);
  const isRank1 = supplier.rank === 1;

  const whyBetter =
    supplier.rank === 1
      ? `${supplier.why_best_or_worst} ${result.recommendation_summary} Compared to other bidders, this supplier leads on overall score (${clampScore(supplier.score?.overall ?? 0)}%), price (${clampScore(supplier.score?.cost ?? 0)}%), and total quote value at ${formatCurrency(supplier.grand_total)}.`
      : rank1
      ? `${supplier.name} ranks #${supplier.rank} with an overall score of ${clampScore(supplier.score?.overall ?? 0)}% vs ${clampScore(rank1.score?.overall ?? 0)}% for ${rank1.name}. ${supplier.why_best_or_worst} ${
          obs.costDiff > 0
            ? `The quote is ${formatCurrency(obs.costDiff)} higher than the recommended supplier.`
            : obs.costDiff < 0
            ? `Total quote is lower than Rank #1, but composite scoring favours ${rank1.name} on delivery, reliability, and risk.`
            : ""
        }`
      : supplier.why_best_or_worst;

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-700 hover:text-primary-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to rankings
      </button>

      {/* Hero */}
      <div className="overflow-hidden rounded-2xl border border-primary-200 bg-primary-50 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-primary-600">
              Supplier Analysis
            </p>
            <div className="mt-1 flex items-center gap-2">
              <RankBadge rank={supplier.rank} size="md" />
              <h3 className="text-xl font-bold text-neutral-900">
                {supplier.name}
              </h3>
            </div>
            <p className="mt-1 text-sm text-neutral-600">
              Rank #{supplier.rank} · {supplier.verdict}
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-primary-700">
              {clampScore(supplier.score?.overall ?? 0)}
              <span className="text-base font-normal text-neutral-400">/100</span>
            </p>
            <p className="text-xs text-neutral-500">Overall AI Score</p>
            <div className="mt-2">
              <RiskBadge level={risk} />
            </div>
          </div>
        </div>
        <p className="mt-4 text-lg font-semibold text-neutral-900">
          {formatCurrency(isRank1 ? quoteAmount || supplier.grand_total : supplier.grand_total)}
        </p>
      </div>

      {/* Score grid */}
      {hasInsufficientData(supplier) && (
        <div className="rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-xs text-warning-800">
          <span className="font-semibold">Insufficient Historical Data</span> — Some scores are based on quotation data only.
          Confidence level: <span className="font-bold capitalize">{getConfidenceLevel(supplier)}</span>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {(() => {
          const sources = getScoreSources(supplier);
          const priceSource = sources.find((s) => s.dimension === "Price");
          const deliverySource = sources.find((s) => s.dimension === "Delivery");
          const qualitySource = sources.find((s) => s.dimension === "Quality");
          const reliabilitySource = sources.find((s) => s.dimension === "Reliability");
          return (<>
            <ScoreBar label="Price Score" value={supplier.score?.cost ?? 0} color="bg-emerald-500" source={priceSource?.source} hasData={priceSource?.has_data ?? true} />
            <ScoreBar label="Delivery Score" value={supplier.score?.delivery ?? 0} color="bg-primary" source={deliverySource?.source} hasData={deliverySource?.has_data} />
            <ScoreBar label="Quality Score" value={qualityScore(supplier)} color="bg-primary" source={qualitySource?.source} hasData={qualitySource?.has_data} />
            <ScoreBar label="Reliability Score" value={supplier.score?.reliability ?? 0} color="bg-primary" source={reliabilitySource?.source} hasData={reliabilitySource?.has_data} />
          </>);
        })()}
      </div>

      {/* vs Rank #1 */}
      {rank1 && (
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="mb-3 text-xs font-bold uppercase tracking-wider text-neutral-500">
            Comparison vs Rank #1 — {rank1.name}
          </p>
          {isRank1 ? (
            <p className="text-sm text-success-600 font-medium">
              ✓ Benchmark supplier — highest AI ranking for this RFQ.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-neutral-50 px-3 py-2">
                <p className="text-[10px] uppercase text-neutral-500">Cost difference</p>
                <p className={`text-sm font-bold ${obs.costDiff > 0 ? "text-danger-600" : "text-success-600"}`}>
                  {obs.costDiff > 0 ? "+" : ""}
                  {formatCurrency(obs.costDiff)}
                </p>
              </div>
              <div className="rounded-lg bg-neutral-50 px-3 py-2">
                <p className="text-[10px] uppercase text-neutral-500">Score difference</p>
                <p className="text-sm font-bold text-neutral-800">
                  −{clampScore(obs.scoreDiff)} pts behind leader
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {isRank1 && (
        <ObservationBlock title="Why this supplier was selected">
          {result.recommendation_summary || supplier.why_best_or_worst}
        </ObservationBlock>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <ObservationBlock title="Strengths">
          <BulletList
            items={supplier.strengths}
            empty="No specific strengths identified."
          />
        </ObservationBlock>
        <ObservationBlock title="Weaknesses">
          <BulletList
            items={supplier.weaknesses}
            empty="No significant weaknesses identified."
          />
        </ObservationBlock>
      </div>

      <ObservationBlock title="Pricing observations" tone="pricing">
        {obs.pricing}
      </ObservationBlock>
      <ObservationBlock title="Delivery observations" tone="delivery">
        {obs.delivery}
      </ObservationBlock>
      <ObservationBlock title="Risk observations" tone="risk">
        {obs.risk}
      </ObservationBlock>

      {/* Expandable why better */}
      <div className="overflow-hidden rounded-xl border border-primary-200 bg-primary-50/40">
        <button
          type="button"
          onClick={() => setExpandedWhy((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span className="text-sm font-semibold text-primary-800">
            Why this supplier is better than others
          </span>
          <ChevronDown
            className={`h-5 w-5 text-primary-600 transition ${expandedWhy ? "rotate-180" : ""}`}
          />
        </button>
        {expandedWhy && (
          <div className="border-t border-primary-200 px-4 py-3 text-sm leading-relaxed text-neutral-700">
            {whyBetter}
          </div>
        )}
      </div>

      {/* Selection / status actions */}
      {chosenSupplier === supplier.name ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-success-200 bg-success-50 px-6 py-3.5 text-sm font-bold text-success-700">
          <CheckCircle2 className="h-5 w-5" />
          Chosen Supplier
        </div>
      ) : chosenSupplier ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-6 py-3.5 text-sm font-medium text-neutral-500">
          <CheckCircle2 className="h-4 w-4" />
          {chosenSupplier} has been selected for this RFQ.
        </div>
      ) : canSelect ? (
        <button
          type="button"
          onClick={() => onSelectSupplier(supplier)}
          disabled={creatingPO}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-4 text-base font-bold text-white shadow-lg shadow-primary-500/25 transition hover:bg-primary-600 disabled:opacity-70"
        >
          {creatingPO ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              {ctaLoadingLabel}
            </>
          ) : (
            <>
              <ShoppingCart className="h-5 w-5" />
              Select Supplier
            </>
          )}
        </button>
      ) : (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-success-200 bg-success-50 px-6 py-3.5 text-sm font-medium text-success-700">
          <CheckCircle2 className="h-4 w-4" />
          {ctaDoneMessage}
        </div>
      )}
    </div>
  );
}

export default function AIAnalysisModal({
  open,
  loading,
  loadingStep,
  result,
  error,
  quoteAmount,
  quotationCount,
  creatingPO,
  hasApiKey: _hasApiKey,
  poAlreadyExists = false,
  chosenSupplier = null,
  ctaLabel,
  ctaLoadingLabel,
  ctaDoneMessage,
  activeProvider = null,
  fallbackNotice = null,
  providerAvailability = { claude: false, openai: false, local: true },
  onClose,
  onRetry,
  onCreatePO,
  onSelectSupplier,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [selectedSupplier, setSelectedSupplier] = useState<string | null>(null);
  const [confirmingSupplier, setConfirmingSupplier] = useState<SupplierAnalysisRow | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !creatingPO) {
        if (confirmingSupplier) setConfirmingSupplier(null);
        else if (selectedSupplier) setSelectedSupplier(null);
        else onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, creatingPO, onClose, selectedSupplier, confirmingSupplier]);

  useEffect(() => {
    if (result && !loading) {
      setActiveTab("overview");
      setSelectedSupplier(null);
      setConfirmingSupplier(null);
    }
  }, [result, loading]);

  useEffect(() => {
    if (!open) {
      setSelectedSupplier(null);
      setConfirmingSupplier(null);
    }
  }, [open]);

  const ranked = useMemo(
    () => sortRankedSuppliers(result?.supplier_analysis ?? []),
    [result]
  );

  const rank1 = ranked[0];
  const selectedRow = ranked.find((s) => s.name === selectedSupplier);

  function handleSelectSupplierClick(supplier: SupplierAnalysisRow) {
    setConfirmingSupplier(supplier);
  }

  function handleConfirmSelection(reason: string) {
    if (!confirmingSupplier || !onSelectSupplier) return;
    const risk = supplierRiskLevel(confirmingSupplier);
    onSelectSupplier({
      supplierName: confirmingSupplier.name,
      aiRank: confirmingSupplier.rank,
      riskLevel: risk,
      reason,
      grandTotal: confirmingSupplier.grand_total,
    });
    setConfirmingSupplier(null);
  }

  if (!open) {
    return null;
  }

  const progressPct = loading
    ? Math.min(100, ((loadingStep + 1) / ANALYSIS_STEPS.length) * 100)
    : result
    ? 100
    : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-modal-title"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-neutral-950/70 backdrop-blur-md"
        onClick={creatingPO ? undefined : onClose}
        disabled={creatingPO}
      />

      <div className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/95 shadow-[0_25px_80px_rgba(124,58,237,0.35)] backdrop-blur-2xl">
        <div className="pointer-events-none absolute -inset-px rounded-2xl ring-1 ring-inset ring-primary-500/10" />

        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="relative shrink-0 overflow-hidden bg-sidebar px-6 py-5">
            <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary-400/20 blur-2xl" />
            <div className="relative flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
                  <Sparkles className="h-5 w-5 text-white/90" />
                </div>
                <div>
                  <h2 id="ai-modal-title" className="text-lg font-bold text-white">
                    {chosenSupplier ? "Market Re-Analysis" : "AI Procurement Intelligence"}
                  </h2>
                  <p className="text-xs text-white/70">
                    {selectedSupplier
                      ? `Detailed analysis — ${selectedSupplier}`
                      : chosenSupplier
                      ? "Comparing current market data against selected supplier"
                      : `${quotationCount} supplier quotation${quotationCount === 1 ? "" : "s"} evaluated`}
                  </p>
                </div>
              </div>
              {!creatingPO && (
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg p-1.5 text-white/80 transition hover:bg-white/15"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>
            {(loading || result) && (
              <div className="relative mt-4 h-1.5 overflow-hidden rounded-full bg-white/15">
                <div
                  className="h-full rounded-full bg-primary-400 transition-all duration-700"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            )}
            <div className="relative mt-3">
              <AIProviderStatusBar
                active={activeProvider}
                availability={providerAvailability}
              />
            </div>
          </div>

          {result && !loading && !selectedSupplier && (
            <div className="shrink-0 border-b border-neutral-200 bg-slate-50/80 px-4">
              <div className="flex gap-1 overflow-x-auto py-2">
                {TABS.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveTab(id)}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition ${
                      activeTab === id
                        ? "bg-primary-700 text-white shadow-md"
                        : "text-neutral-600 hover:bg-white hover:text-primary-700"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            {loading && (
              <div className="py-8 text-center">
                <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-primary-600" />
                <p className="font-semibold text-neutral-900">Running intelligent analysis…</p>
                <p className="mt-1 text-xs text-neutral-500">
                  Claude → OpenAI → Local Engine fallback chain
                </p>
                <div className="mx-auto mt-6 max-w-sm space-y-2">
                  {ANALYSIS_STEPS.map((step, idx) => (
                    <div
                      key={step}
                      className={`rounded-lg px-4 py-2 text-sm ${
                        idx <= loadingStep
                          ? "bg-primary-50 text-primary-800"
                          : "text-neutral-400"
                      }`}
                    >
                      {idx <= loadingStep ? "✓" : "○"} {step}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && !loading && !result && (
              <div className="py-10 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-sky-50">
                  <Sparkles className="h-7 w-7 text-sky-600" />
                </div>
                <p className="mx-auto max-w-md text-sm text-neutral-700">{error}</p>
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-800"
                >
                  <Sparkles className="h-4 w-4" />
                  Retry Analysis
                </button>
              </div>
            )}

            {result && !loading && selectedRow && (
              <SupplierDetailPanel
                supplier={selectedRow}
                rank1={rank1}
                result={result}
                quoteAmount={quoteAmount}
                creatingPO={creatingPO}
                canSelect={!poAlreadyExists && !!onSelectSupplier}
                chosenSupplier={chosenSupplier}
                onBack={() => setSelectedSupplier(null)}
                onSelectSupplier={handleSelectSupplierClick}
                onCreatePO={onCreatePO}
                ctaLabel={ctaLabel}
                ctaLoadingLabel={ctaLoadingLabel}
                ctaDoneMessage={ctaDoneMessage}
              />
            )}

            {result && !loading && !selectedSupplier && (
              <>
                {fallbackNotice && <FallbackNoticeBanner message={fallbackNotice} />}
                {activeTab === "overview" && (
                  <div className="space-y-6">
                    {/* Re-analysis comparison when supplier already locked */}
                    {chosenSupplier && (
                      <ReAnalysisComparisonBanner
                        previousSupplier={chosenSupplier}
                        result={result}
                      />
                    )}

                    <div className="rounded-xl border border-primary-200 bg-primary-50 p-5">
                      <p className="text-xs font-bold uppercase tracking-wider text-primary-700">
                        {chosenSupplier ? "Current AI Recommendation" : "Recommended Supplier"}
                      </p>
                      <p className="mt-1 text-2xl font-bold text-neutral-900">
                        {result.recommended_supplier}
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-neutral-700">
                        {result.recommendation_summary}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-4">
                        <div>
                          <p className="text-[10px] uppercase text-neutral-500">Confidence</p>
                          <p className="text-xl font-bold text-primary-700">
                            {clampScore(result.confidence_score)}%
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase text-neutral-500">Quote Amount</p>
                          <p className="text-xl font-bold text-neutral-900">
                            {formatCurrency(quoteAmount)}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div>
                      <p className="mb-3 text-xs font-bold uppercase tracking-wider text-neutral-500">
                        Top 3 Suppliers — click to compare
                      </p>
                      <TopThreeComparison
                        suppliers={ranked}
                        onSelect={setSelectedSupplier}
                      />
                    </div>

                    <div>
                      <p className="mb-3 text-xs font-bold uppercase tracking-wider text-neutral-500">
                        All Rankings
                      </p>
                      <div className="space-y-2">
                        {ranked.map((s, idx) => (
                          <SupplierRankCard
                            key={s.name}
                            supplier={s}
                            rankIndex={idx}
                            isRecommended={s.name === result.recommended_supplier}
                            compact
                            selected={false}
                            chosenSupplier={chosenSupplier}
                            onSelect={() => setSelectedSupplier(s.name)}
                            onChooseSupplier={!poAlreadyExists && onSelectSupplier ? handleSelectSupplierClick : undefined}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "rankings" && (
                  <div className="space-y-3">
                    <p className="text-sm text-neutral-600">
                      Click any supplier for a full AI breakdown and comparison vs Rank #1.
                    </p>
                    {ranked.map((s, idx) => (
                      <SupplierRankCard
                        key={s.name}
                        supplier={s}
                        rankIndex={idx}
                        isRecommended={s.name === result.recommended_supplier}
                        chosenSupplier={chosenSupplier}
                        onSelect={() => setSelectedSupplier(s.name)}
                        onChooseSupplier={!poAlreadyExists && onSelectSupplier ? handleSelectSupplierClick : undefined}
                      />
                    ))}
                  </div>
                )}

                {activeTab === "compare" && (
                  <div className="space-y-4">
                    <p className="text-sm text-neutral-600">
                      Side-by-side comparison of the top three ranked suppliers.
                    </p>
                    <TopThreeComparison
                      suppliers={ranked}
                      onSelect={setSelectedSupplier}
                    />
                    {ranked.length > 3 && (
                      <p className="text-center text-xs text-neutral-500">
                        +{ranked.length - 3} additional supplier
                        {ranked.length - 3 === 1 ? "" : "s"} in Rankings tab
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Supplier selection confirmation dialog */}
      {confirmingSupplier && (
        <SelectionConfirmDialog
          supplier={confirmingSupplier}
          isTopPick={confirmingSupplier.rank === 1}
          onConfirm={handleConfirmSelection}
          onCancel={() => setConfirmingSupplier(null)}
          busy={creatingPO}
        />
      )}
    </div>
  );
}
