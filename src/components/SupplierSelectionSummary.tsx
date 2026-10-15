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
import {
  formatQuoteTotal,
  isSubmittedQuoteAmount,
} from "../utils/quotePrice";
import DashboardKpiCard, {
  DashboardKpiGrid,
} from "./dashboard/DashboardKpiCard";

import { buildEvaluationSummary, getEvaluationRisk, projectSupplierDecision, type EvaluationRisk } from "../utils/aiEvaluationDecision";
import { findRecommendationWinner, normalizeSupplierKey } from "../utils/aiRecommendationNormalization";
type RiskLevel = EvaluationRisk;

interface SelectionAudit {
  selected_supplier: string;
  supplier_quotation?: string;
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
  quoteAmount: number | null;
  workflowStep?: string;
  onClose: () => void;
}

function formatScore(n: unknown): string {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100 ? `${n}/100` : "Unavailable";
}

function riskBadgeClasses(level: RiskLevel) {
  switch (level) {
    case "Low":
      return "bg-success-50 text-success-700 ring-success-200";
    case "Medium":
      return "bg-amber-50 text-amber-700 ring-amber-200";
    case "High":
      return "bg-danger-50 text-danger-700 ring-danger-200";
    default:
      return "bg-neutral-50 text-neutral-600 ring-neutral-200";
  }
}

function sortRanked(rows: SupplierAnalysisRow[]): SupplierAnalysisRow[] {
  return [...rows].sort((a, b) => a.rank - b.rank);
}

/** Prefer exact stored IDs; display-name fallback must identify one row only. */
export function resolveSelectedEvaluation(
  rows: SupplierAnalysisRow[], selectedSupplier: string, audit?: SelectionAudit | null,
): SupplierAnalysisRow | undefined {
  const key = selectedSupplier.trim();
  const sameSelection = audit && (audit.selected_supplier === key ||
    normalizeSupplierKey(audit.supplier_display_name ?? "") === normalizeSupplierKey(key));
  if (sameSelection && audit.supplier_quotation) {
    const matches = rows.filter((row) => (row.quotation_id || row.supplier_quotation_id) === audit.supplier_quotation &&
      row.supplier_id === audit.selected_supplier);
    if (matches.length === 1 && (matches[0].supplier_id === key ||
        normalizeSupplierKey(matches[0].name) === normalizeSupplierKey(key))) return matches[0];
    return undefined;
  }
  const identities = rows.filter((row) => row.supplier_id === key ||
    (row.quotation_id || row.supplier_quotation_id) === key);
  if (identities.length) return identities.length === 1 ? identities[0] : undefined;
  const names = rows.filter((row) => normalizeSupplierKey(row.name) === normalizeSupplierKey(key));
  return names.length === 1 ? names[0] : undefined;
}

function buildDecisionPoints(row: SupplierAnalysisRow, allSuppliers: SupplierAnalysisRow[]): { label: string; icon: typeof CheckCircle2 }[] {
  const points: { label: string; icon: typeof CheckCircle2 }[] = [];
  const totals = allSuppliers.map((supplier) => supplier.grand_total).filter(isSubmittedQuoteAmount);
  if (isSubmittedQuoteAmount(row.grand_total) && totals.length && row.grand_total === Math.min(...totals)) {
    points.push({ label: "Lowest submitted quotation total (including ties)", icon: DollarSign });
  }
  if (row.score.delivery >= 0 && row.score.delivery === Math.max(...allSuppliers.map((supplier) => supplier.score.delivery))) {
    points.push({ label: "Highest delivery evaluation score (including ties)", icon: Truck });
  }
  points.push({ label: `Weighted-score rank #${row.rank}`, icon: Award });
  points.push({ label: `Risk assessment: ${getEvaluationRisk(row)}`, icon: Shield });
  points.push({ label: `Evaluation verdict: ${row.verdict}`, icon: FileText });
  if (row.recommendation_reason) points.push({ label: row.recommendation_reason, icon: Target });
  return points;
}

function formatDisplayDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
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
  workflowStep,
  onClose,
}: Props) {
  const audit = useMemo(() => readSelectionAudit(rfqName), [rfqName]);

  const ranked = useMemo(() => {
    const winner = analysis ? findRecommendationWinner(analysis) : undefined;
    return sortRanked((analysis?.supplier_analysis ?? []).map((row) => projectSupplierDecision(row, row === winner)));
  }, [analysis]);
  const supplierRow = useMemo(
    () => resolveSelectedEvaluation(ranked, selectedSupplier, audit),
    [ranked, selectedSupplier, audit],
  );
  const selectionAudit = audit && (audit.selected_supplier === selectedSupplier ||
    (supplierRow && audit.selected_supplier === supplierRow.supplier_id)) ? audit : null;
  const decisionPoints = useMemo(
    () => supplierRow ? buildDecisionPoints(supplierRow, ranked) : [],
    [supplierRow, ranked],
  );
  const narrative = supplierRow ? buildEvaluationSummary([supplierRow])
    : "The selected supplier has no unambiguous evaluation in this analysis. Its score, risk and verdict are unavailable.";
  if (!open) return null;
  const score = supplierRow?.score.overall;
  const confidence = typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 100 ? score : null;
  const rank = supplierRow?.rank ?? null;
  const risk = supplierRow ? getEvaluationRisk(supplierRow) : "Unavailable";
  const displayAmount = supplierRow ? (isSubmittedQuoteAmount(supplierRow.grand_total) ? supplierRow.grand_total : null)
    : isSubmittedQuoteAmount(selectionAudit?.grand_total) ? selectionAudit.grand_total
      : isSubmittedQuoteAmount(selectedTotal) ? selectedTotal : null;

  const highestQuote =
    ranked.some((supplier) => isSubmittedQuoteAmount(supplier.grand_total))
      ? Math.max(
          ...ranked
            .map((supplier) => supplier.grand_total)
            .filter(isSubmittedQuoteAmount),
        )
      : 0;
  const estimatedSavings =
    displayAmount !== null && highestQuote > displayAmount
      ? highestQuote - displayAmount
      : 0;

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
                  Selected
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
                {selectionAudit?.selected_by && (
                  <span className="inline-flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5 text-neutral-400" />
                    {selectionAudit.selected_by}
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
              <DashboardKpiGrid columns={3} className="mt-3">
                <DashboardKpiCard
                  label="Selected Supplier"
                  value={selectedSupplier}
                  icon={Truck}
                  iconClassName="bg-primary-50 text-primary-600"
                />
                {rank !== null && (
                  <DashboardKpiCard
                    label="Supplier Rank"
                    value={`#${rank}`}
                    icon={Award}
                    iconClassName="bg-amber-50 text-amber-600"
                  />
                )}
                {confidence !== null && (
                  <DashboardKpiCard
                    label="Weighted Score"
                    value={`${confidence}/100`}
                    icon={Target}
                    iconClassName="bg-violet-50 text-violet-600"
                  />
                )}
                <DashboardKpiCard
                  label="Quoted Value"
                  value={formatQuoteTotal(
                    displayAmount,
                    supplierRow?.quote_price_status,
                  )}
                  icon={DollarSign}
                  iconClassName="bg-blue-50 text-blue-600"
                />
                {estimatedSavings > 0 && (
                  <DashboardKpiCard
                    label="Savings vs Highest"
                    value={formatCurrency(estimatedSavings)}
                    icon={TrendingDown}
                    iconClassName="bg-success-50 text-success-600"
                    className="border-success-200"
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
              </DashboardKpiGrid>
            </div>

            {selectionAudit?.selection_reason && (
              <div>
                <SectionTitle icon={FileText} title="Recorded Selection Reason" />
                <p className="mt-3 text-sm text-neutral-700">{selectionAudit.selection_reason}</p>
              </div>
            )}
            {/* Selected supplier evaluation facts */}
            {decisionPoints.length > 0 && (
              <div>
                <SectionTitle icon={Target} title="Selected Supplier Evaluation" />
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
              ((supplierRow.strengths ?? []).length > 0 ||
                (supplierRow.weaknesses ?? []).length > 0) && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {(supplierRow.strengths ?? []).length > 0 && (
                    <div className="rounded-xl border border-success-100 bg-success-50/50 p-4">
                      <p className="mb-2.5 text-[10px] font-bold uppercase tracking-widest text-success-700">
                        Strengths
                      </p>
                      <ul className="space-y-1.5">
                        {(supplierRow.strengths ?? []).map((s, i) => (
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
                  {(supplierRow.weaknesses ?? []).length > 0 && (
                    <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-4">
                      <p className="mb-2.5 text-[10px] font-bold uppercase tracking-widest text-amber-700">
                        Areas to Note
                      </p>
                      <ul className="space-y-1.5">
                        {(supplierRow.weaknesses ?? []).map((w, i) => (
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
                    const sRisk = getEvaluationRisk(s);
                    const isSelected = s === supplierRow;
                    return (
                      <div
                        key={s.quotation_id || s.supplier_id || s.name}
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
                            {formatQuoteTotal(
                              s.grand_total,
                              s.quote_price_status,
                            )}
                          </p>
                        </div>

                        {/* Score */}
                        <span className="text-xs font-medium text-neutral-500">
                          {formatScore(s.score?.overall)}
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
              <SectionTitle icon={Sparkles} title="Selected Supplier Evaluation Snapshot" />
              <div className="mt-3 rounded-xl border border-primary-100 bg-gradient-to-br from-primary-50/60 to-white p-5">
                <p className="text-sm leading-relaxed text-neutral-700">
                  {narrative}
                </p>
                {supplierRow && (
                  <div className="mt-4 flex flex-wrap gap-3">
                    <MiniStat icon={Shield} label="Verdict" value={supplierRow.verdict} />
                    <MiniStat icon={Target} label="Decision interpretation" value={supplierRow.recommendation_status === "REQUIRES_REVIEW" ? "Requires review" : supplierRow.recommendation_status === "NOT_EVALUATED" ? "Evaluation incomplete" : supplierRow.is_top_ranked ? "AI top-ranked" : "Ranked alternative"} />
                    <MiniStat
                      icon={Hash}
                      label="Price Score"
                      value={formatScore(supplierRow.score?.cost)}
                    />
                    <MiniStat
                      icon={Truck}
                      label="Delivery Score"
                      value={formatScore(supplierRow.score?.delivery)}
                    />
                    <MiniStat
                      icon={Shield}
                      label="Reliability"
                      value={formatScore(supplierRow.score?.reliability)}
                    />
                    <MiniStat
                      icon={BarChart3}
                      label="Overall"
                      value={formatScore(supplierRow.score?.overall)}
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
