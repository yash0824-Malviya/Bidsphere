/**
 * RFQ Detail — enterprise presentation (UI only).
 * Business logic, queries, and handlers remain in RFQDetailPage.
 */

import {
  memo,
  useLayoutEffect,
  useMemo,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import {
  Ban,
  Check,
  CheckCircle2,
  Eye,
  FileText,
  Loader2,
  Printer,
  Scale,
  ShoppingCart,
  Sparkles,
} from "lucide-react";

import type {
  RfqProcurementWorkflow,
  RfqWorkflowStep,
} from "../../../api/rfqProcurementWorkflow";
import type { LegalDocumentSet } from "../../../api/legalDocs";
import type { RFQ, RFQSupplier, SupplierAnalysisRow } from "../../../types/erpnext";
import type { SupplierRfqResponse } from "../../../api/supplierRfqResponse";
import type { AIQuotation } from "../../../api/ai";
import { scoreSuppliers } from "../../../api/supplierScoringEngine";
import { useOptionalLayout } from "../../../contexts/LayoutContext";
import StatusBadge from "../../../components/StatusBadge";
import EmptyState from "../../../components/EmptyState";
import ScoreRing from "../../../components/sourcing/ScoreRing";
import { formatCurrency, formatDate } from "../../../utils/format";

/* ── Design-system class tokens (main content only) ─────────────────────── */

const card = "rfq-card";
const gap = "gap-4";
const stack = "space-y-4";
const labelCls = "rfq-label";
const valueCls = "text-[14px] font-medium text-[var(--rfq-text)]";
const sectionTitle = "rfq-section-title";
const mono = "rfq-mono";

/* ── Types (unchanged contract) ─────────────────────────────────────────── */

export interface SupplierQuoteView {
  sqName: string;
  supplier: string;
  supplier_name: string;
  total: number;
  notes: string;
  payment_terms?: string;
  byItem: Map<
    string,
    { unit_price: number; total: number; delivery_days: number }
  >;
}

export interface RFQDetailEnterpriseLayoutProps {
  rfq: RFQ;
  isReadOnly: boolean;
  isCompleted: boolean;
  companyLabel: string;
  departmentLabel: string;
  ownerLabel: string;
  materialRequestLabel: string;
  validTillDisplay: string;
  currencyLabel: string;
  expectedDelivery: string;
  deliveryLocation: string;
  estimatedBudget: number;
  totalQty: number;

  workflow: RfqProcurementWorkflow;
  timeline: RfqWorkflowStep[];

  supplierCount: number;
  quotedCount: number;
  respondedCount: number;
  declinedCount: number;
  awaitingCount: number;
  responseRate: number;
  lowestQuote: number;
  avgQuote: number;
  highestQuote: number;
  allSuppliersResponded: boolean;

  hasSelectedSupplier: boolean;
  resolvedSelectedSupplier: string;
  selectedSupplierTotal: number;
  selectionReason?: string | null;

  legalDoc: LegalDocumentSet | null | undefined;
  poExists: boolean;
  poName: string | null;
  fullyApproved: boolean;
  canCreatePO: boolean;
  procurementFinalized: boolean;

  copilotHasAnalysis: boolean;
  aiConfidence?: number | null;
  copilotRiskLevel: "Low" | "Medium" | "High" | null;
  copilotSavings: { pct: number; amount: number } | null;
  recommendedSupplierLabel: string;
  aiReady: boolean;
  aiLoading: boolean;
  aiButtonMode: RfqProcurementWorkflow["aiButtonMode"];
  hasQuotations: boolean;
  hasAnthropicKey: boolean;

  canCompareQuotations: boolean;
  canViewQuotations: boolean;
  showSubmitRFQ: boolean;
  submittingRFQ: boolean;
  creatingPO: boolean;

  localQuotes: Map<string, SupplierQuoteView>;
  declineBySupplier: Map<string, SupplierRfqResponse>;
  supplierAnalysisRows: SupplierAnalysisRow[];

  quotesQueryError: boolean;
  onRetryQuotes: () => void;

  onCheckBudget: () => void;
  onSubmitRFQ: () => void;
  onCompareQuotations: () => void;
  onViewQuotation: (sqName: string) => void;
  onViewDeclineReason: (decline: SupplierRfqResponse) => void;
  onPerformAnalysis: () => void;
  onViewAnalysis: () => void;
  onReAnalyze: () => void;
  onCreatePO: () => void;
  onPrint: () => void;
  onExportPdf: () => void;

  resolveSupplierStatus: (
    s: RFQSupplier,
    hasQuote: boolean,
    validTill: string | undefined,
    hasDecline: boolean,
  ) => string;
  supplierStatusTone: (
    status: string,
  ) => "success" | "warning" | "danger" | "neutral" | "info";
  quoteForSupplier: (
    quotes: Map<string, SupplierQuoteView>,
    supplier: string,
  ) => SupplierQuoteView | undefined;

  rejectionBanners: ReactNode;
  reverseBiddingSlot: ReactNode;
  legalRejectedActions: ReactNode;
  financeRejectedActions: ReactNode;
  checkBudgetModal: ReactNode;
  modals: ReactNode;
}

type DisplayScore = { score: number; rank: number };

function normKey(value?: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

function uniqueKeys(...values: Array<string | undefined | null>): string[] {
  const out: string[] = [];
  for (const v of values) {
    const k = normKey(v);
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/**
 * Resolve AI score + rank for every Submitted supplier (has a quote).
 * Pending suppliers are omitted (UI shows "—").
 * Analysis rows are matched by supplier id OR display name; gaps are filled
 * with the same local scoring engine used for the winning supplier, then
 * ranks are reassigned 1…n by score across all scored suppliers.
 */
function buildSubmittedSupplierScores(opts: {
  suppliers: RFQSupplier[];
  localQuotes: Map<string, SupplierQuoteView>;
  analysisRows: SupplierAnalysisRow[];
  quoteForSupplier: RFQDetailEnterpriseLayoutProps["quoteForSupplier"];
  itemCount: number;
  targetPrices?: Map<string, number>;
}): Map<string, DisplayScore> {
  const {
    suppliers,
    localQuotes,
    analysisRows,
    quoteForSupplier,
    itemCount,
    targetPrices,
  } = opts;
  const result = new Map<string, DisplayScore>();

  type PartialHit = { keys: string[]; score: number };
  const hits: PartialHit[] = [];

  const findAnalysis = (keys: string[]) =>
    analysisRows.find((row) => keys.includes(normKey(row.name)));

  for (const s of suppliers) {
    const quote = quoteForSupplier(localQuotes, s.supplier);
    if (!quote) continue;

    const keys = uniqueKeys(
      s.supplier,
      s.supplier_name,
      quote.supplier,
      quote.supplier_name,
    );
    const row = findAnalysis(keys);
    const overall = row?.score?.overall;
    if (overall != null && Number.isFinite(Number(overall))) {
      hits.push({ keys, score: Math.round(Number(overall)) });
    }
  }

  const submittedCount = suppliers.filter((s) =>
    Boolean(quoteForSupplier(localQuotes, s.supplier)),
  ).length;

  if (hits.length < submittedCount && submittedCount > 0) {
    const quotations: AIQuotation[] = [];
    const keyByQuoteName = new Map<string, string[]>();

    for (const s of suppliers) {
      const quote = quoteForSupplier(localQuotes, s.supplier);
      if (!quote) continue;
      const keys = uniqueKeys(
        s.supplier,
        s.supplier_name,
        quote.supplier,
        quote.supplier_name,
      );
      const already = hits.some((h) => h.keys.some((k) => keys.includes(k)));
      const displayName = quote.supplier_name || s.supplier_name || s.supplier;
      quotations.push({
        supplier_name: displayName,
        total_value: quote.total,
        payment_terms: quote.payment_terms,
        notes: quote.notes,
        items: [...quote.byItem.entries()].map(([item, cell]) => ({
          item,
          unit_price: cell.unit_price,
          total: cell.total,
          delivery_days: cell.delivery_days,
        })),
      });
      keyByQuoteName.set(normKey(displayName), keys);
      if (!already) {
        // placeholder — filled from engine below
      }
    }

    if (quotations.length > 0) {
      const engine = scoreSuppliers(
        quotations,
        Math.max(1, itemCount),
        undefined,
        undefined,
        targetPrices && targetPrices.size > 0 ? targetPrices : undefined,
      );
      for (const scored of engine.suppliers) {
        const keys =
          keyByQuoteName.get(normKey(scored.supplier_name)) ??
          keyByQuoteName.get(normKey(scored.supplier)) ??
          uniqueKeys(scored.supplier_name, scored.supplier);
        const covered = hits.some((h) => h.keys.some((k) => keys.includes(k)));
        if (!covered) {
          hits.push({
            keys,
            score: Math.round(Number(scored.final_score) || 0),
          });
        }
      }
    }
  }

  hits.sort((a, b) => b.score - a.score);
  hits.forEach((hit, idx) => {
    const entry = { score: hit.score, rank: idx + 1 };
    for (const k of hit.keys) result.set(k, entry);
  });

  return result;
}

/* ── Small primitives ───────────────────────────────────────────────────── */

function Field({
  label: lbl,
  children,
  monoValue = false,
}: {
  label: string;
  children: ReactNode;
  monoValue?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className={labelCls}>{lbl}</div>
      <div
        className={`mt-0.5 truncate ${valueCls} ${monoValue ? mono : ""}`.trim()}
      >
        {children}
      </div>
    </div>
  );
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "blue" | "green" | "amber" | "red" | "teal";
}) {
  const map = {
    neutral: "bg-[var(--rfq-paper)] text-[var(--rfq-text-soft)]",
    blue: "bg-[var(--rfq-accent-soft)] text-[var(--rfq-accent)]",
    green: "bg-[var(--rfq-success-soft)] text-[var(--rfq-success)]",
    teal: "bg-[var(--rfq-teal-soft)] text-[var(--rfq-teal)]",
    amber: "bg-[var(--rfq-warn-soft)] text-[var(--rfq-warn)]",
    red: "bg-[var(--rfq-danger-soft)] text-[var(--rfq-danger)]",
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${map[tone]}`}
    >
      {children}
    </span>
  );
}

function ApprovalPill({
  approved,
  rejected,
  label,
  by,
  on,
}: {
  approved: boolean;
  rejected: boolean;
  label: string;
  by?: string | null;
  on?: string | null;
}) {
  if (rejected) {
    return (
      <div>
        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--rfq-danger-soft)] px-2.5 py-1 text-[12px] font-semibold text-[var(--rfq-danger)]">
          <Ban className="h-3 w-3" />
          Rejected
        </span>
        <p className={`mt-1 text-[11px] text-[var(--rfq-text-faint)]`}>
          {label}
        </p>
      </div>
    );
  }
  if (approved) {
    return (
      <div>
        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--rfq-success-soft)] px-2.5 py-1 text-[12px] font-semibold text-[var(--rfq-success)]">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Approved
        </span>
        <p className={`mt-1 text-[11px] text-[var(--rfq-text-faint)] ${mono}`}>
          {[by, on ? formatDate(on) : null].filter(Boolean).join(" · ") || label}
        </p>
      </div>
    );
  }
  return (
    <div>
      <Badge tone="amber">{label}</Badge>
    </div>
  );
}

function Btn({
  children,
  onClick,
  disabled,
  variant = "secondary",
  type = "button",
  className = "",
  href,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost";
  type?: "button" | "submit";
  className?: string;
  href?: string;
}) {
  const styles = {
    primary:
      "bg-[var(--rfq-accent)] text-white hover:opacity-90 disabled:opacity-50",
    secondary:
      "border border-[var(--rfq-border)] bg-[var(--rfq-surface)] text-[var(--rfq-text)] hover:bg-[var(--rfq-paper)] disabled:opacity-50",
    ghost:
      "text-[var(--rfq-accent)] hover:underline disabled:opacity-50",
  } as const;
  const cls = `inline-flex items-center justify-center gap-1.5 rounded-[var(--rfq-radius-control)] px-3 py-1.5 text-[13px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rfq-accent)] ${styles[variant]} ${className}`;
  if (href) {
    return (
      <Link to={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={cls}>
      {children}
    </button>
  );
}

function GaugeBar({
  label: lbl,
  valueLabel,
  pct,
}: {
  label: string;
  valueLabel: string;
  pct: number;
}) {
  const width = Math.max(0, Math.min(100, pct));
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className={labelCls}>{lbl}</span>
        <span className={`${mono} text-[13px] font-semibold text-[var(--rfq-text)]`}>
          {valueLabel}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--rfq-paper)]">
        <div
          className="h-full rounded-full bg-[var(--rfq-accent)]"
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

function Kpi({ label: lbl, children }: { label: string; children: ReactNode }) {
  return (
    <div className={`${card} px-3 py-2.5`}>
      <div className={labelCls}>{lbl}</div>
      <div className={`mt-1 ${mono} text-[18px] font-semibold text-[var(--rfq-text)]`}>
        {children}
      </div>
    </div>
  );
}

/* ── Decision bullets ───────────────────────────────────────────────────── */

function decisionBullets(opts: {
  hasAnalysis: boolean;
  selected: boolean;
  selectedTotal: number;
  lowest: number;
  risk: "Low" | "Medium" | "High" | null;
  legalOk: boolean;
  financeOk: boolean;
  rank?: number;
  strengths?: string[];
  reason?: string | null;
}): string[] {
  const out: string[] = [];
  if (
    opts.selectedTotal > 0 &&
    opts.lowest > 0 &&
    Math.abs(opts.selectedTotal - opts.lowest) < 0.01
  ) {
    out.push("Lowest commercial price");
  }
  if (opts.rank === 1) out.push("Best overall AI score");
  if (opts.legalOk) out.push("Legal approved");
  if (opts.financeOk) out.push("Finance approved");
  if (opts.risk === "Low") out.push("Low supplier risk");
  if (out.length < 4) out.push("Delivery meets requirement");
  if (out.length < 5 && opts.strengths?.[0]) {
    out.push(opts.strengths[0].trim());
  }
  if (!opts.hasAnalysis && !opts.selected) {
    return ["Run AI analysis after quotations are received"];
  }
  return out.slice(0, 5);
}

/* ── Procurement Status ─────────────────────────────────────────────────── */

const WorkflowBar = memo(function WorkflowBar({
  steps,
}: {
  steps: RfqWorkflowStep[];
}) {
  return (
    <div className={`${card} p-4`}>
      <h2 className={`${sectionTitle} mb-4`}>Procurement Status</h2>
      <ol className="hidden w-full md:flex md:items-start">
        {steps.map((step, i) => (
          <li key={step.id} className="flex min-w-0 flex-1 items-start">
            <div
              className="flex w-full flex-col items-center px-0.5 text-center"
              title={step.meta}
            >
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-semibold ${
                  step.rejected
                    ? "border-[var(--rfq-danger)] bg-[var(--rfq-danger)] text-white"
                    : step.done
                      ? "border-[var(--rfq-success)] bg-[var(--rfq-success)] text-white"
                      : step.active
                        ? "border-[var(--rfq-accent)] bg-[var(--rfq-accent)] text-white"
                        : "border-[var(--rfq-border)] bg-[var(--rfq-surface)] text-[var(--rfq-text-faint)]"
                }`}
              >
                {step.rejected ? (
                  <Ban className="h-3.5 w-3.5" />
                ) : step.done ? (
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                ) : (
                  i + 1
                )}
              </span>
              <span
                className={`mt-2 line-clamp-2 text-[11px] font-semibold leading-tight ${
                  step.active
                    ? "text-[var(--rfq-accent)]"
                    : step.done
                      ? "text-[var(--rfq-text)]"
                      : "text-[var(--rfq-text-soft)]"
                }`}
              >
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={`mt-3.5 h-0.5 min-w-[8px] flex-1 ${
                  step.done
                    ? "bg-[var(--rfq-success)]"
                    : "bg-[var(--rfq-border)]"
                }`}
              />
            )}
          </li>
        ))}
      </ol>
      <ol className="space-y-2 md:hidden">
        {steps.map((step) => (
          <li key={step.id} className="flex items-start gap-2">
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                step.rejected
                  ? "bg-[var(--rfq-danger)] text-white"
                  : step.done
                    ? "bg-[var(--rfq-success)] text-white"
                    : step.active
                      ? "bg-[var(--rfq-accent)] text-white"
                      : "bg-[var(--rfq-border)] text-[var(--rfq-text-faint)]"
              }`}
            >
              {step.done && !step.rejected ? (
                <Check className="h-3 w-3" strokeWidth={3} />
              ) : null}
            </span>
            <div>
              <div className="text-[13px] font-semibold text-[var(--rfq-text)]">
                {step.label}
              </div>
              <div className="text-[12px] text-[var(--rfq-text-soft)]">
                {step.meta}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
});

/** Read-only Target Pricing — configured at RFQ creation; used by AI Analysis. */
function ItemsWithTargetPrice({ rfq }: { rfq: RFQ }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="bg-[var(--rfq-paper)] text-[11px] font-semibold uppercase tracking-wide text-[var(--rfq-text-soft)]">
          <tr>
            <th className="px-4 py-2.5">Item</th>
            <th className="px-4 py-2.5">Qty</th>
            <th className="px-4 py-2.5">UOM</th>
            <th className="px-4 py-2.5 text-right">Target Price</th>
            <th className="px-4 py-2.5 text-center">Show to Supplier</th>
            <th className="px-4 py-2.5">Required By</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--rfq-border)]">
          {(rfq.items ?? []).map((it) => {
            const key = it.name || it.item_code;
            const displayTarget = Number(it.custom_target_price);
            const hasTarget =
              Number.isFinite(displayTarget) && displayTarget > 0;
            const showToSupplier = !!(
              it.custom_show_target_price_to_supplier ??
              rfq.custom_show_target_price_to_supplier
            );
            return (
              <tr key={key} className="bg-[var(--rfq-surface)]">
                <td className="px-4 py-2.5">
                  <div className={`${mono} font-semibold text-[var(--rfq-text)]`}>
                    {it.item_code}
                  </div>
                  <div className="text-[12px] text-[var(--rfq-text-soft)]">
                    {it.item_name || it.description || "—"}
                  </div>
                </td>
                <td className={`px-4 py-2.5 ${mono}`}>{it.qty}</td>
                <td className={`px-4 py-2.5 ${mono}`}>{it.uom || "—"}</td>
                <td className={`px-4 py-2.5 text-right ${mono} tabular-nums`}>
                  {hasTarget ? formatCurrency(displayTarget) : "—"}
                </td>
                <td className="px-4 py-2.5 text-center text-[13px] text-[var(--rfq-text)]">
                  {showToSupplier ? "Yes" : "No"}
                </td>
                <td className={`px-4 py-2.5 ${mono}`}>
                  {formatDate(it.schedule_date)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Main layout ────────────────────────────────────────────────────────── */

export default function RFQDetailEnterpriseLayout(
  props: RFQDetailEnterpriseLayoutProps,
) {
  const {
    rfq,
    isReadOnly,
    isCompleted,
    companyLabel,
    departmentLabel,
    ownerLabel,
    materialRequestLabel,
    validTillDisplay,
    currencyLabel,
    expectedDelivery,
    estimatedBudget,
    totalQty,
    workflow,
    timeline,
    supplierCount,
    quotedCount,
    respondedCount,
    declinedCount,
    responseRate,
    lowestQuote,
    avgQuote,
    hasSelectedSupplier,
    resolvedSelectedSupplier,
    selectedSupplierTotal,
    selectionReason,
    legalDoc,
    poExists,
    poName,
    canCreatePO,
    procurementFinalized,
    copilotHasAnalysis,
    aiConfidence,
    copilotRiskLevel,
    copilotSavings,
    recommendedSupplierLabel,
    aiReady,
    aiLoading,
    aiButtonMode,
    hasQuotations,
    hasAnthropicKey,
    canCompareQuotations,
    canViewQuotations,
    showSubmitRFQ,
    submittingRFQ,
    creatingPO,
    localQuotes,
    declineBySupplier,
    supplierAnalysisRows,
    quotesQueryError,
    onRetryQuotes,
    onCheckBudget,
    onSubmitRFQ,
    onCompareQuotations,
    onViewQuotation,
    onViewDeclineReason,
    onPerformAnalysis,
    onViewAnalysis,
    onReAnalyze,
    onCreatePO,
    onPrint,
    onExportPdf,
    resolveSupplierStatus,
    supplierStatusTone,
    quoteForSupplier,
    rejectionBanners,
    reverseBiddingSlot,
    checkBudgetModal,
    modals,
  } = props;

  const layout = useOptionalLayout();
  useLayoutEffect(() => {
    const register = layout?.registerPageHeader;
    const unregister = layout?.unregisterPageHeader;
    if (!register || !unregister) return;
    register();
    return () => unregister();
  }, [layout?.registerPageHeader, layout?.unregisterPageHeader]);

  const analysisBySupplier = useMemo(() => {
    const map = new Map<string, SupplierAnalysisRow>();
    for (const row of supplierAnalysisRows) {
      map.set(normKey(row.name), row);
    }
    return map;
  }, [supplierAnalysisRows]);

  const displayScores = useMemo(
    () =>
      buildSubmittedSupplierScores({
        suppliers: rfq.suppliers ?? [],
        localQuotes,
        analysisRows: supplierAnalysisRows,
        quoteForSupplier,
        itemCount: rfq.items?.length ?? 0,
        targetPrices: (() => {
          const map = new Map<string, number>();
          for (const it of rfq.items ?? []) {
            const t = Number(it.custom_target_price);
            if (Number.isFinite(t) && t > 0) map.set(it.item_code, t);
          }
          return map;
        })(),
      }),
    [
      rfq.suppliers,
      rfq.items,
      localQuotes,
      supplierAnalysisRows,
      quoteForSupplier,
    ],
  );

  const focusKey = normKey(
    hasSelectedSupplier ? resolvedSelectedSupplier : recommendedSupplierLabel,
  );
  const focusAnalysis =
    analysisBySupplier.get(focusKey) ??
    [...analysisBySupplier.values()].find(
      (row) => normKey(row.name) === focusKey,
    );
  const focusScore =
    displayScores.get(focusKey) ??
    (focusAnalysis?.score?.overall != null
      ? {
          score: Math.round(Number(focusAnalysis.score.overall)),
          rank: focusAnalysis.rank,
        }
      : undefined);

  const confidence =
    aiConfidence != null ? Math.round(Number(aiConfidence)) : 0;

  const bullets = useMemo(
    () =>
      decisionBullets({
        hasAnalysis: copilotHasAnalysis,
        selected: hasSelectedSupplier,
        selectedTotal: selectedSupplierTotal,
        lowest: lowestQuote,
        risk: copilotRiskLevel,
        legalOk: workflow.legalApproved,
        financeOk: workflow.financeApproved,
        rank: focusScore?.rank ?? focusAnalysis?.rank,
        strengths: focusAnalysis?.strengths,
        reason: selectionReason,
      }),
    [
      copilotHasAnalysis,
      hasSelectedSupplier,
      selectedSupplierTotal,
      lowestQuote,
      copilotRiskLevel,
      workflow.legalApproved,
      workflow.financeApproved,
      focusScore,
      focusAnalysis,
      selectionReason,
    ],
  );

  const recommendationFooter = useMemo(() => {
    if (selectionReason?.trim()) return selectionReason.trim();
    const who = hasSelectedSupplier
      ? resolvedSelectedSupplier
      : recommendedSupplierLabel;
    if (who && who !== "—" && (copilotHasAnalysis || hasSelectedSupplier)) {
      const rankBit = focusScore?.rank ? ` (rank #${focusScore.rank})` : "";
      return `Recommend proceeding with ${who}${rankBit} based on price, delivery, and risk balance.`;
    }
    if (!hasQuotations) {
      return "Awaiting supplier quotations before an AI recommendation can be formed.";
    }
    return "Run AI analysis to generate a plain-language award recommendation.";
  }, [
    selectionReason,
    hasSelectedSupplier,
    resolvedSelectedSupplier,
    recommendedSupplierLabel,
    copilotHasAnalysis,
    focusScore,
    hasQuotations,
  ]);

  const poStatus = poExists
    ? "Created"
    : workflow.purchaseOrderStatus === "Ready"
      ? "Ready"
      : "Pending";

  const displaySupplier = hasSelectedSupplier
    ? resolvedSelectedSupplier
    : recommendedSupplierLabel;

  const coveragePct = supplierCount
    ? (respondedCount / supplierCount) * 100
    : 0;

  return (
    <div className="rfq-detail-ds -mx-1 rounded-[var(--rfq-radius-card)] px-1 pb-8 pt-1 md:px-0">
      {isReadOnly && (
        <div className="mb-4 rounded-[var(--rfq-radius-card)] border border-[var(--rfq-accent)]/30 bg-[var(--rfq-accent-soft)] px-3 py-2 text-[13px] text-[var(--rfq-accent)]">
          Read-only view. Use Legal Reviews to approve or reject.
        </div>
      )}

      {rejectionBanners}

      <div className={stack}>
        {/* ── Top bar / header ── */}
        <header className={`${card} p-4 md:p-5`}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1
                  className={`${mono} text-[26px] font-semibold leading-tight text-[var(--rfq-text)] md:text-[28px]`}
                >
                  {rfq.name}
                </h1>
                {isCompleted ? (
                  <Badge tone="green">Completed</Badge>
                ) : (
                  <StatusBadge status={rfq.status ?? "Draft"} />
                )}
                <Badge tone="blue">{workflow.currentStage}</Badge>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {poExists && poName && poName !== "—" && (
                <Btn
                  variant="primary"
                  href={`/p2p/purchase-orders/${encodeURIComponent(poName)}`}
                >
                  View Purchase Order
                </Btn>
              )}
              {canCompareQuotations && (
                <Btn onClick={onCompareQuotations}>
                  <Scale className="h-3.5 w-3.5" />
                  Compare
                </Btn>
              )}
              <Btn variant="ghost" onClick={onExportPdf}>
                <FileText className="h-3.5 w-3.5" />
                PDF
              </Btn>
              <Btn variant="ghost" onClick={onPrint}>
                <Printer className="h-3.5 w-3.5" />
                Print
              </Btn>
              {showSubmitRFQ && (
                <>
                  <Btn onClick={onCheckBudget}>Check Budget</Btn>
                  <Btn
                    variant="primary"
                    onClick={onSubmitRFQ}
                    disabled={submittingRFQ}
                  >
                    {submittingRFQ ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    Submit RFQ
                  </Btn>
                </>
              )}
            </div>
          </div>

          {/* Meta strip — 3 cols from ~768px */}
          <div
            className={`mt-4 grid grid-cols-2 border-t border-[var(--rfq-border)] pt-4 ${gap} sm:grid-cols-3 lg:grid-cols-6`}
          >
            <Field label="Company">{companyLabel}</Field>
            <Field label="Department">{departmentLabel}</Field>
            <Field label="Owner">{ownerLabel}</Field>
            <Field label="Created" monoValue>
              {formatDate(rfq.transaction_date)}
            </Field>
            <Field label="Valid till" monoValue>
              {validTillDisplay}
            </Field>
            <Field label="Currency" monoValue>
              {currencyLabel}
            </Field>
            <Field label="MR" monoValue>
              {materialRequestLabel}
            </Field>
            <Field label="Selected supplier">
              {hasSelectedSupplier ? resolvedSelectedSupplier : "—"}
            </Field>
            <Field label="Award value" monoValue>
              {selectedSupplierTotal > 0
                ? formatCurrency(selectedSupplierTotal)
                : "—"}
            </Field>
            <Field label="PO status">
              <Badge
                tone={
                  poExists ? "green" : poStatus === "Ready" ? "blue" : "neutral"
                }
              >
                {poStatus}
              </Badge>
            </Field>
            <Field label="Delivery" monoValue>
              {expectedDelivery}
            </Field>
            <Field label="Next approver">{workflow.nextApprover}</Field>
          </div>
        </header>

        {/* ── AI recommendation ── */}
        <section className={`${card} overflow-hidden`}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--rfq-border)] px-4 py-3 md:px-5">
            <h2 className={sectionTitle}>AI recommendation</h2>
            <div className="flex flex-wrap gap-2">
              {aiButtonMode === "finalized" || procurementFinalized
                ? poExists &&
                  poName &&
                  poName !== "—" && (
                    <Btn
                      variant="primary"
                      href={`/p2p/purchase-orders/${encodeURIComponent(poName)}`}
                    >
                      View Purchase Order
                    </Btn>
                  )
                : aiButtonMode === "view_and_rerun" ? (
                    <>
                      <Btn variant="primary" onClick={onViewAnalysis}>
                        <Sparkles className="h-3.5 w-3.5" />
                        View report
                      </Btn>
                      {!isReadOnly && !isCompleted && (
                        <Btn onClick={onReAnalyze} disabled={aiLoading}>
                          Re-run
                        </Btn>
                      )}
                    </>
                  ) : (
                    <Btn
                      variant="primary"
                      onClick={onPerformAnalysis}
                      disabled={!aiReady || aiLoading || isReadOnly}
                    >
                      {aiLoading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                      {aiLoading ? "Analyzing…" : "Run AI analysis"}
                    </Btn>
                  )}
              {!isReadOnly && hasSelectedSupplier && !poExists && (
                <Btn
                  onClick={onCreatePO}
                  disabled={creatingPO || !canCreatePO}
                >
                  {creatingPO ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ShoppingCart className="h-3.5 w-3.5" />
                  )}
                  Generate PO
                </Btn>
              )}
            </div>
          </div>

          <div className={`grid ${gap} p-4 md:grid-cols-3 md:p-5`}>
            {/* (a) gauges */}
            <div className="space-y-4">
              <p className="text-[13px] font-semibold text-[var(--rfq-text)]">
                {hasSelectedSupplier ? "Selected" : "Recommended"}
              </p>
              <p className="truncate text-[15px] font-semibold text-[var(--rfq-text)]">
                {displaySupplier || "—"}
              </p>
              <GaugeBar
                label="Confidence"
                valueLabel={copilotHasAnalysis ? `${confidence}%` : "—"}
                pct={copilotHasAnalysis ? confidence : 0}
              />
              <GaugeBar
                label="Coverage"
                valueLabel={`${respondedCount}/${supplierCount}`}
                pct={coveragePct}
              />
              <Field label="Commercial rank" monoValue>
                {focusScore?.rank ? `#${focusScore.rank}` : "—"}
              </Field>
            </div>

            {/* (b) bordered stat list */}
            <div className="rounded-[var(--rfq-radius-card)] border border-[var(--rfq-border)]">
              {(
                [
                  ["Risk", copilotRiskLevel ?? "—", false],
                  [
                    "Savings",
                    copilotSavings && copilotSavings.amount > 0
                      ? formatCurrency(copilotSavings.amount)
                      : "—",
                    true,
                  ],
                  [
                    "Lowest quote",
                    lowestQuote > 0 ? formatCurrency(lowestQuote) : "—",
                    true,
                  ],
                  [
                    "Average quote",
                    avgQuote > 0 ? formatCurrency(avgQuote) : "—",
                    true,
                  ],
                  ["Response rate", `${responseRate}%`, true],
                  [
                    "PO",
                    poName && poName !== "—" ? poName : poStatus,
                    Boolean(poName && poName !== "—"),
                  ],
                ] as const
              ).map(([lbl, val, isMono], i, arr) => (
                <div
                  key={lbl}
                  className={`flex items-center justify-between gap-3 px-3 py-2.5 ${
                    i < arr.length - 1
                      ? "border-b border-[var(--rfq-border)]"
                      : ""
                  }`}
                >
                  <span className={labelCls}>{lbl}</span>
                  <span
                    className={`text-right text-[13px] font-semibold text-[var(--rfq-text)] ${
                      isMono ? mono : ""
                    }`}
                  >
                    {val}
                  </span>
                </div>
              ))}
            </div>

            {/* (c) decision checklist */}
            <div>
              <div className={labelCls}>Decision summary</div>
              <ul className="mt-2 space-y-2">
                {bullets.map((b) => (
                  <li
                    key={b}
                    className="flex items-start gap-2.5 text-[13px] text-[var(--rfq-text)]"
                  >
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--rfq-success-soft)] text-[var(--rfq-success)]">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                    {b}
                  </li>
                ))}
              </ul>
              {!procurementFinalized &&
                !hasQuotations &&
                !hasSelectedSupplier && (
                  <p className="mt-3 text-[12px] text-[var(--rfq-text-soft)]">
                    Available after quotations are submitted.
                  </p>
                )}
              {!procurementFinalized &&
                hasQuotations &&
                hasAnthropicKey &&
                !aiReady &&
                !hasSelectedSupplier && (
                  <p className="mt-3 text-[12px] text-[var(--rfq-text-soft)]">
                    Need at least 2 quotations.
                  </p>
                )}
              {!procurementFinalized &&
                hasQuotations &&
                !hasAnthropicKey &&
                !hasSelectedSupplier && (
                  <p className="mt-3 text-[12px] text-[var(--rfq-text-soft)]">
                    Local comparison will be used.
                  </p>
                )}
            </div>
          </div>

          <div className="border-t border-[var(--rfq-border)] bg-[var(--rfq-accent-soft)] px-4 py-3 text-[13px] text-[var(--rfq-accent)] md:px-5">
            {recommendationFooter}
          </div>
        </section>

        {/* ── KPIs ── */}
        <section
          className={`grid grid-cols-2 ${gap} sm:grid-cols-4 xl:grid-cols-8`}
        >
          <Kpi label="Items">{rfq.items?.length ?? 0}</Kpi>
          <Kpi label="Suppliers invited">{supplierCount}</Kpi>
          <Kpi label="Quoted">{quotedCount}</Kpi>
          <Kpi label="Responded">{respondedCount}</Kpi>
          <Kpi label="Declined">{declinedCount}</Kpi>
          <Kpi label="Response rate">{responseRate}%</Kpi>
          <Kpi label="Total qty">
            {Number.isFinite(totalQty) ? totalQty : "—"}
          </Kpi>
          <Kpi label="Est. budget">
            {estimatedBudget > 0 ? formatCurrency(estimatedBudget) : "—"}
          </Kpi>
        </section>

        {/* ── Procurement Status ── */}
        <WorkflowBar steps={timeline} />

        {/* ── Items ── */}
        <section className={`${card} overflow-hidden`}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--rfq-border)] px-4 py-3 md:px-5">
            <div>
              <h2 className={sectionTitle}>Items</h2>
              <p className="mt-0.5 text-[12px] text-[var(--rfq-text-soft)]">
                Target Price is set during RFQ creation. AI Analysis uses it
                read-only for variance, savings, and scoring.
              </p>
            </div>
            <span className={`${mono} text-[13px] text-[var(--rfq-text-soft)]`}>
              {rfq.items?.length ?? 0} lines
            </span>
          </div>
          {!rfq.items?.length ? (
            <div className="p-6">
              <EmptyState title="No items" description="This RFQ has no line items." />
            </div>
          ) : (
            <ItemsWithTargetPrice rfq={rfq} />
          )}
        </section>

        {/* ── Supplier quotations ── */}
        <section className={`${card} p-4 md:p-5`}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className={sectionTitle}>Supplier quotations</h2>
            <div className="flex items-center gap-3">
              <span className={`${mono} text-[13px] text-[var(--rfq-text-soft)]`}>
                {supplierCount} invited · {quotedCount} quoted
                {declinedCount > 0 ? ` · ${declinedCount} declined` : ""}
              </span>
              {canCompareQuotations && (
                <Btn onClick={onCompareQuotations}>
                  <Scale className="h-3.5 w-3.5" />
                  Compare
                </Btn>
              )}
            </div>
          </div>

          {!isCompleted && (
            <p className="mb-3 text-[13px] text-[var(--rfq-text-soft)]">
              Quote amounts stay hidden until AI analysis is complete.
            </p>
          )}

          {quotesQueryError ? (
            <div className="rounded-[var(--rfq-radius-card)] border border-[var(--rfq-danger)]/30 bg-[var(--rfq-danger-soft)] px-3 py-2 text-[13px] text-[var(--rfq-danger)]">
              Could not load quotations.{" "}
              <button
                type="button"
                onClick={onRetryQuotes}
                className="font-semibold underline"
              >
                Retry
              </button>
            </div>
          ) : null}

          <div className={`grid ${gap} sm:grid-cols-2 xl:grid-cols-3`}>
            {(rfq.suppliers ?? []).map((s) => {
              const quote = quoteForSupplier(localQuotes, s.supplier);
              const decline = declineBySupplier.get(
                (s.supplier ?? "").toLowerCase(),
              );
              const status = resolveSupplierStatus(
                s,
                !!quote,
                rfq.valid_till || undefined,
                !!decline,
              );
              const isWinner =
                hasSelectedSupplier &&
                (normKey(s.supplier) === normKey(resolvedSelectedSupplier) ||
                  normKey(s.supplier_name) ===
                    normKey(resolvedSelectedSupplier));
              const scoreEntry =
                displayScores.get(normKey(s.supplier)) ||
                displayScores.get(normKey(s.supplier_name)) ||
                (quote
                  ? displayScores.get(normKey(quote.supplier)) ||
                    displayScores.get(normKey(quote.supplier_name))
                  : undefined);
              const hasSubmittedQuote = Boolean(quote);
              const score = hasSubmittedQuote ? scoreEntry?.score ?? null : null;
              const rank = hasSubmittedQuote ? scoreEntry?.rank ?? null : null;
              const deliveryDays = quote
                ? [...quote.byItem.values()].find((v) => v.delivery_days)
                    ?.delivery_days
                : undefined;
              const showAmounts = canCompareQuotations && !!quote;

              return (
                <article
                  key={s.name}
                  data-supplier={s.supplier}
                  className={`flex h-full flex-col overflow-hidden rounded-[var(--rfq-radius-card)] border ${
                    isWinner
                      ? "border-[var(--rfq-teal)] shadow-[var(--rfq-shadow)]"
                      : "border-[var(--rfq-border)] bg-[var(--rfq-surface)] shadow-[var(--rfq-shadow)]"
                  }`}
                >
                  <div
                    className={`flex items-start justify-between gap-2 px-3 py-3 ${
                      isWinner ? "bg-[var(--rfq-teal-soft)]" : "bg-[var(--rfq-surface)]"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[15px] font-semibold text-[var(--rfq-text)]">
                        {s.supplier_name || s.supplier}
                      </div>
                      <div
                        className={`truncate text-[12px] text-[var(--rfq-text-soft)] ${mono}`}
                      >
                        {s.supplier}
                      </div>
                    </div>
                    {isWinner ? (
                      <Badge tone="teal">Selected</Badge>
                    ) : quote ? (
                      <Badge tone="green">Submitted</Badge>
                    ) : decline ? (
                      <Badge tone="amber">No quote</Badge>
                    ) : (
                      <StatusBadge
                        status={status}
                        tone={supplierStatusTone(status)}
                      />
                    )}
                  </div>

                  <div className="flex flex-1 items-start gap-3 px-3 py-3">
                    <ScoreRing score={score} rank={rank} />
                    <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-3 gap-y-2">
                      <Field label="Quote" monoValue>
                        {showAmounts ? formatCurrency(quote!.total) : "—"}
                      </Field>
                      <Field label="Delivery" monoValue>
                        {showAmounts && deliveryDays
                          ? `${deliveryDays} days`
                          : "—"}
                      </Field>
                      <Field label="AI score" monoValue>
                        {score != null ? score : "—"}
                      </Field>
                      <Field label="Rank" monoValue>
                        {rank != null ? `#${rank}` : "—"}
                      </Field>
                    </div>
                  </div>

                  <div className="mt-auto flex flex-wrap gap-2 border-t border-[var(--rfq-border)] px-3 py-3">
                    {quote && canViewQuotations && (
                      <Btn
                        variant="ghost"
                        onClick={() => onViewQuotation(quote.sqName)}
                        disabled={!quote.sqName}
                        className="px-0"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        View quotation
                      </Btn>
                    )}
                    {decline && (
                      <Btn
                        variant="ghost"
                        onClick={() => onViewDeclineReason(decline)}
                        className="px-0"
                      >
                        View reason
                      </Btn>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* ── Selected supplier ── */}
        {hasSelectedSupplier && (
          <section className={`${card} p-4 md:p-5`}>
            <h2 className={`${sectionTitle} mb-3`}>Selected supplier</h2>
            <div
              className={`grid grid-cols-2 ${gap} sm:grid-cols-3 lg:grid-cols-6`}
            >
              <Field label="Supplier">{resolvedSelectedSupplier}</Field>
              <Field label="Award amount" monoValue>
                {selectedSupplierTotal > 0
                  ? formatCurrency(selectedSupplierTotal)
                  : "—"}
              </Field>
              <Field label="Savings" monoValue>
                {copilotSavings && copilotSavings.amount > 0
                  ? formatCurrency(copilotSavings.amount)
                  : "—"}
              </Field>
              <Field label="Legal">
                <ApprovalPill
                  approved={workflow.legalApproved}
                  rejected={workflow.legalRejected}
                  label={workflow.legalStatus}
                  by={legalDoc?.approved_by}
                  on={legalDoc?.approved_on}
                />
              </Field>
              <Field label="Finance">
                <ApprovalPill
                  approved={workflow.financeApproved}
                  rejected={workflow.financeRejected}
                  label={workflow.financeStatus}
                  by={legalDoc?.finance_approved_by}
                  on={legalDoc?.finance_approved_on}
                />
              </Field>
              <Field label="Purchase order" monoValue>
                {poExists ? poName || "Created" : "Not created"}
              </Field>
            </div>
          </section>
        )}

        {reverseBiddingSlot}
      </div>

      {checkBudgetModal}
      {modals}
    </div>
  );
}
