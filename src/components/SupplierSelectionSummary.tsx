import { useMemo } from "react";
import {
  Award,
  BarChart3,
  Calendar,
  CheckCircle2,
  DollarSign,
  FileText,
  Hash,
  Shield,
  ShoppingCart,
  Sparkles,
  Target,
  TrendingDown,
  Truck,
  User,
  Users,
  X,
} from "lucide-react";
import type { AIRecommendation, SupplierAnalysisRow } from "../types/erpnext";
import { formatCurrency } from "../utils/format";

type RiskLevel = "Low" | "Medium" | "High";

interface SelectionAudit {
  selected_supplier: string;
  supplier_display_name?: string;
  ai_rank?: number;
  risk_level?: string;
  selection_reason?: string;
  grand_total?: number;
  selected_by?: string;
  selected_at?: string;
  ai_recommended?: string;
  is_ai_top_pick?: boolean;
}

function readSelectionAudit(rfqName: string): SelectionAudit | null {
  try {
    const raw = localStorage.getItem(`rfq_selection_audit_${rfqName}`);
    return raw ? (JSON.parse(raw) as SelectionAudit) : null;
  } catch {
    return null;
  }
}

interface Props {
  open: boolean;
  rfqName: string;
  selectedSupplier: string;
  selectedAt: string;
  selectedTotal: number;
  analysis: AIRecommendation | null;
  quoteAmount: number;
  workflowStep?: string;
  onClose: () => void;
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function supplierRiskLevel(s: SupplierAnalysisRow): RiskLevel {
  if (s.verdict === "AVOID") return "High";
  if (s.verdict === "EXPENSIVE") return "Medium";
  const rel = s.score?.reliability ?? 50;
  if (rel < 40 || s.weaknesses.length >= 3) return "High";
  if (rel < 65 || s.verdict === "GOOD OPTION") return "Medium";
  return "Low";
}

function riskBadgeClasses(level: RiskLevel) {
  switch (level) {
    case "Low":
      return "bg-success-50 text-success-700 ring-success-200";
    case "Medium":
      return "bg-amber-50 text-amber-700 ring-amber-200";
    case "High":
      return "bg-danger-50 text-danger-700 ring-danger-200";
  }
}

function sortRanked(rows: SupplierAnalysisRow[]): SupplierAnalysisRow[] {
  return [...rows].sort((a, b) => a.rank - b.rank);
}

/* ── Decision-point builder ─────────────────────────────────────────────── */

function buildDecisionPoints(
  row: SupplierAnalysisRow,
  allSuppliers: SupplierAnalysisRow[],
  analysis: AIRecommendation
): { label: string; icon: typeof CheckCircle2 }[] {
  const pts: { label: string; icon: typeof CheckCircle2 }[] = [];
  const score = row.score;

  const isLowestCost =
    allSuppliers.length > 0 &&
    row.grand_total <= Math.min(...allSuppliers.map((s) => s.grand_total));
  const isBestDelivery =
    allSuppliers.length > 0 &&
    (score?.delivery ?? 0) >=
      Math.max(...allSuppliers.map((s) => s.score?.delivery ?? 0));
  const isHighestScore =
    allSuppliers.length > 0 &&
    (score?.overall ?? 0) >=
      Math.max(...allSuppliers.map((s) => s.score?.overall ?? 0));

  if (isLowestCost) {
    pts.push({ label: "Lowest evaluated procurement cost", icon: DollarSign });
  } else if ((score?.cost ?? 0) >= 65) {
    pts.push({ label: "Competitive pricing among all bidders", icon: DollarSign });
  }

  if (isBestDelivery) {
    pts.push({ label: "Best delivery commitment among all suppliers", icon: Truck });
  } else if ((score?.delivery ?? 0) >= 60) {
    pts.push({ label: "Strong delivery schedule compliance", icon: Truck });
  }

  if (isHighestScore) {
    pts.push({ label: "Highest AI confidence score", icon: Target });
  }

  if (row.rank === 1) {
    pts.push({ label: "Top-ranked supplier by AI evaluation", icon: Award });
  }

  const hasCompleteQuote = row.strengths.some(
    (s) => /complete|quotation|all items/i.test(s)
  );
  if (hasCompleteQuote) {
    pts.push({ label: "Complete quotation submission", icon: ShoppingCart });
  }

  if ((score?.reliability ?? 0) >= 65) {
    pts.push({ label: "Strong supplier reliability rating", icon: Shield });
  }

  const highRisks = analysis.risk_flags.filter(
    (f) => f.severity === "high"
  ).length;
  if (highRisks === 0) {
    pts.push({ label: "Lowest procurement risk", icon: TrendingDown });
  }

  if (pts.length < 4) {
    if ((score?.overall ?? 0) >= 60 && !pts.some((p) => p.label.includes("confidence"))) {
      pts.push({ label: "Meets all technical evaluation requirements", icon: FileText });
    }
  }

  if (pts.length === 0) {
    pts.push({ label: "Selected based on comprehensive procurement criteria", icon: CheckCircle2 });
  }

  return pts.slice(0, 6);
}

/* ── AI recommendation narrative builder ────────────────────────────────── */

function buildRecommendationNarrative(
  supplierName: string,
  row: SupplierAnalysisRow | undefined,
  analysis: AIRecommendation | null
): string {
  if (analysis?.recommendation_summary) {
    return analysis.recommendation_summary;
  }

  const factors: string[] = [];
  if (row) {
    if ((row.score?.cost ?? 0) >= 50) factors.push("price competitiveness");
    if ((row.score?.delivery ?? 0) >= 50) factors.push("delivery capability");
    if ((row.score?.reliability ?? 0) >= 50) factors.push("supplier reliability");
    const risk = supplierRiskLevel(row);
    if (risk !== "High") factors.push("risk assessment");
  }

  if (factors.length === 0) {
    factors.push("overall procurement evaluation criteria");
  }

  const joined =
    factors.length <= 2
      ? factors.join(" and ")
      : factors.slice(0, -1).join(", ") + " and " + factors[factors.length - 1];

  return `Based on ${joined}, ${supplierName} achieved the highest overall evaluation score and was recommended for award.`;
}

function formatDisplayDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Main Component                                                          */
/* ══════════════════════════════════════════════════════════════════════════ */

export default function SupplierSelectionSummary({
  open,
  rfqName,
  selectedSupplier,
  selectedAt,
  selectedTotal,
  analysis,
  quoteAmount,
  workflowStep,
  onClose,
}: Props) {
  const audit = useMemo(() => readSelectionAudit(rfqName), [rfqName]);

  const ranked = useMemo(
    () => sortRanked(analysis?.supplier_analysis ?? []),
    [analysis]
  );

  const supplierRow = useMemo(
    () =>
      ranked.find(
        (s) => s.name.toLowerCase() === (selectedSupplier ?? "").toLowerCase()
      ),
    [ranked, selectedSupplier]
  );

  const decisionPoints = useMemo(
    () =>
      supplierRow && analysis
        ? buildDecisionPoints(supplierRow, ranked, analysis)
        : audit?.selection_reason
          ? [{ label: audit.selection_reason, icon: CheckCircle2 as typeof CheckCircle2 }]
          : [],
    [supplierRow, analysis, ranked, audit]
  );

  const narrative = useMemo(
    () => buildRecommendationNarrative(selectedSupplier, supplierRow, analysis),
    [selectedSupplier, supplierRow, analysis]
  );

  if (!open) return null;

  const confidence = analysis ? clampScore(analysis.confidence_score) : null;
  const rank = supplierRow?.rank ?? audit?.ai_rank ?? null;
  const risk = supplierRow
    ? supplierRiskLevel(supplierRow)
    : (audit?.risk_level as RiskLevel | undefined) ?? null;
  const displayAmount =
    quoteAmount > 0
      ? quoteAmount
      : supplierRow?.grand_total ?? audit?.grand_total ?? selectedTotal ?? 0;

  const highestQuote =
    ranked.length > 0
      ? Math.max(...ranked.map((s) => s.grand_total))
      : 0;
  const estimatedSavings =
    highestQuote > displayAmount ? highestQuote - displayAmount : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="summary-modal-title"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-neutral-950/70 backdrop-blur-md"
        onClick={onClose}
      />

      <div className="relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-white shadow-[0_25px_80px_rgba(124,58,237,0.25)]">
        {/* ── Header ── */}
        <div className="relative shrink-0 overflow-hidden bg-sidebar px-6 py-5">
          <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-success-400/20 blur-2xl" />
          <div className="pointer-events-none absolute -left-16 bottom-0 h-24 w-24 rounded-full bg-primary-400/10 blur-xl" />
          <div className="relative flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
                <CheckCircle2 className="h-5 w-5 text-white/90" />
              </div>
              <div>
                <h2
                  id="summary-modal-title"
                  className="text-lg font-bold text-white"
                >
                  Selected Supplier Analysis Summary
                </h2>
                <p className="text-xs text-white/70">
                  Decision record for {rfqName}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-white/80 transition hover:bg-white/15"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="relative mt-4 h-1.5 overflow-hidden rounded-full bg-white/15">
            <div className="h-full w-full rounded-full bg-success-400" />
          </div>
        </div>

        {/* ── Body ── */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-8 px-6 py-6">

            {/* ═══ Selected Supplier Hero Card ═══ */}
            <div className="rounded-xl border border-success-200 bg-gradient-to-br from-success-50 to-white p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-success-600">
                    Selected Supplier
                  </p>
                  <p className="mt-1 text-2xl font-bold text-neutral-900 leading-tight">
                    {selectedSupplier}
                  </p>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success-600 px-2.5 py-1 text-[10px] font-bold uppercase text-white">
                  <CheckCircle2 className="h-3 w-3" />
                  Awarded
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-neutral-600">
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-neutral-400" />
                  {formatDisplayDate(selectedAt)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-neutral-400" />
                  {rfqName}
                </span>
                {audit?.selected_by && (
                  <span className="inline-flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5 text-neutral-400" />
                    {audit.selected_by}
                  </span>
                )}
              </div>
              {workflowStep && (
                <div className="mt-3">
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary-100 px-2.5 py-0.5 text-xs font-semibold text-primary-700">
                    {workflowStep}
                  </span>
                </div>
              )}
            </div>

            {/* ═══ SECTION 3 — Decision Summary KPIs ═══ */}
            <div>
              <SectionTitle icon={BarChart3} title="Decision Summary" />
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <KpiCard label="Selected Supplier" value={selectedSupplier} small />
                {rank !== null && (
                  <KpiCard label="Supplier Rank" value={`#${rank}`} />
                )}
                {confidence !== null && (
                  <KpiCard label="Confidence Score" value={`${confidence}%`} />
                )}
                <KpiCard label="Quoted Value" value={formatCurrency(displayAmount)} />
                {estimatedSavings > 0 && (
                  <KpiCard
                    label="Savings vs Highest"
                    value={formatCurrency(estimatedSavings)}
                    accent="success"
                  />
                )}
                {risk && (
                  <div
                    className={`rounded-xl p-4 ring-1 ring-inset ${riskBadgeClasses(risk)}`}
                  >
                    <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">
                      Risk Level
                    </p>
                    <p className="mt-1 text-lg font-bold">{risk}</p>
                  </div>
                )}
              </div>
            </div>

            {/* ═══ SECTION 1 — Why This Supplier Was Selected ═══ */}
            {decisionPoints.length > 0 && (
              <div>
                <SectionTitle icon={Target} title="Why This Supplier Was Selected" />
                <div className="mt-3 grid gap-2">
                  {decisionPoints.map(({ label, icon: Icon }) => (
                    <div
                      key={label}
                      className="flex items-center gap-3 rounded-xl border border-neutral-100 bg-white px-4 py-3 shadow-sm transition hover:border-success-200"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-success-50 ring-1 ring-inset ring-success-200/50">
                        <Icon className="h-4 w-4 text-success-600" />
                      </div>
                      <span className="text-sm font-medium text-neutral-800">
                        {label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ═══ Strengths & Areas to Note ═══ */}
            {supplierRow &&
              (supplierRow.strengths.length > 0 ||
                supplierRow.weaknesses.length > 0) && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {supplierRow.strengths.length > 0 && (
                    <div className="rounded-xl border border-success-100 bg-success-50/50 p-4">
                      <p className="mb-2.5 text-[10px] font-bold uppercase tracking-widest text-success-700">
                        Strengths
                      </p>
                      <ul className="space-y-1.5">
                        {supplierRow.strengths.map((s, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-2 text-sm text-neutral-700"
                          >
                            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-500" />
                            {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {supplierRow.weaknesses.length > 0 && (
                    <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-4">
                      <p className="mb-2.5 text-[10px] font-bold uppercase tracking-widest text-amber-700">
                        Areas to Note
                      </p>
                      <ul className="space-y-1.5">
                        {supplierRow.weaknesses.map((w, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-2 text-sm text-neutral-700"
                          >
                            <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                            {w}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

            {/* ═══ SECTION 2 — Participating Suppliers ═══ */}
            {ranked.length > 0 && (
              <div>
                <SectionTitle icon={Users} title="Participating Suppliers" />
                <div className="mt-3 space-y-2">
                  {ranked.map((s) => {
                    const sRisk = supplierRiskLevel(s);
                    const isSelected =
                      s.name.toLowerCase() === selectedSupplier.toLowerCase();
                    return (
                      <div
                        key={s.name}
                        className={`flex flex-wrap items-center gap-3 rounded-xl border p-4 transition sm:flex-nowrap ${
                          isSelected
                            ? "border-success-300 bg-success-50/60 ring-1 ring-success-200"
                            : "border-neutral-200 bg-white"
                        }`}
                      >
                        {/* Rank badge */}
                        <div
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                            s.rank === 1
                              ? "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200"
                              : s.rank === 2
                                ? "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-300"
                                : s.rank === 3
                                  ? "bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200"
                                  : "bg-neutral-100 text-neutral-600 ring-1 ring-inset ring-neutral-200"
                          }`}
                        >
                          #{s.rank}
                        </div>

                        {/* Name + amount */}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-neutral-900">
                            {s.name}
                          </p>
                          <p className="text-xs text-neutral-500">
                            {formatCurrency(s.grand_total)}
                          </p>
                        </div>

                        {/* Score */}
                        <span className="text-xs font-medium text-neutral-500">
                          {clampScore(s.score?.overall ?? 0)}/100
                        </span>

                        {/* Risk */}
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset ${riskBadgeClasses(sRisk)}`}
                        >
                          {sRisk}
                        </span>

                        {/* Selection status */}
                        {isSelected && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-success-600 px-2.5 py-0.5 text-[10px] font-bold uppercase text-white">
                            <CheckCircle2 className="h-3 w-3" />
                            Selected
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ═══ SECTION 4 — AI Recommendation Snapshot ═══ */}
            <div>
              <SectionTitle icon={Sparkles} title="AI Recommendation Snapshot" />
              <div className="mt-3 rounded-xl border border-primary-100 bg-gradient-to-br from-primary-50/60 to-white p-5">
                <p className="text-sm leading-relaxed text-neutral-700">
                  {narrative}
                </p>
                {supplierRow && (
                  <div className="mt-4 flex flex-wrap gap-3">
                    <MiniStat
                      icon={Hash}
                      label="Price Score"
                      value={`${clampScore(supplierRow.score?.cost ?? 0)}/100`}
                    />
                    <MiniStat
                      icon={Truck}
                      label="Delivery Score"
                      value={`${clampScore(supplierRow.score?.delivery ?? 0)}/100`}
                    />
                    <MiniStat
                      icon={Shield}
                      label="Reliability"
                      value={`${clampScore(supplierRow.score?.reliability ?? 0)}/100`}
                    />
                    <MiniStat
                      icon={BarChart3}
                      label="Overall"
                      value={`${clampScore(supplierRow.score?.overall ?? 0)}/100`}
                    />
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Sub-components                                                          */
/* ══════════════════════════════════════════════════════════════════════════ */

function SectionTitle({
  icon: Icon,
  title,
}: {
  icon: typeof CheckCircle2;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-neutral-400" />
      <h3 className="text-xs font-bold uppercase tracking-widest text-neutral-500">
        {title}
      </h3>
    </div>
  );
}

function KpiCard({
  label,
  value,
  accent,
  small,
}: {
  label: string;
  value: string;
  accent?: "success";
  small?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border bg-white p-4 shadow-sm ${
        accent === "success"
          ? "border-success-200"
          : "border-neutral-200"
      }`}
    >
      <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p
        className={`mt-1 font-bold text-neutral-900 ${
          small ? "truncate text-sm" : "text-lg"
        } ${accent === "success" ? "text-success-700" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CheckCircle2;
  label: string;
  value: string;
}) {
  return (
    <div className="inline-flex items-center gap-2 rounded-lg border border-primary-100 bg-white px-3 py-2 text-xs">
      <Icon className="h-3.5 w-3.5 text-primary-500" />
      <span className="text-neutral-500">{label}</span>
      <span className="font-bold text-neutral-800">{value}</span>
    </div>
  );
}
